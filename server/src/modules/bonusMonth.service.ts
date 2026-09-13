// Chốt THƯỞNG tháng — tách khỏi chốt lương.
//
// Anh Tâm 13/9/2026: "Phần thưởng cũng có nút chốt riêng, chốt xong sẽ qua phần chi phí
// luôn" và "thưởng và lương chốt khác nhau". Chốt thì đóng băng CẢ HAI loại thưởng (điểm +
// KPI dự án) và ghi MỘT khoản chi vào tháng sau — giống lương tháng M chi ở tháng M+1.
import { q } from '../db/client.js';
import { ApiError } from '../util/errors.js';
import { getActiveMembers } from './members.repo.js';
import { scoresFor } from './scores.service.js';
import { projectBonusForMonth } from './projectBonus.service.js';
import { saveBonusLines } from './projects.repo.js';
import { upsertEntry, deleteEntry } from './finance.repo.js';
import { gopThuong, tongThuong, type DongThuongDiem, type ThuongNguoi } from '../lib/thuong.js';
import { todayIso } from '../lib/datetime.js';

export const SQL_DOC_KHOA_THUONG =
  'SELECT locked_at, locked_by FROM bonus_locks WHERE year = $1 AND month = $2 LIMIT 1';
export const SQL_GHI_KHOA_THUONG = `INSERT INTO bonus_locks (year, month, locked_at, locked_by)
  VALUES ($1,$2,$3,$4)
  ON CONFLICT (year, month) DO UPDATE SET locked_at = EXCLUDED.locked_at, locked_by = EXCLUDED.locked_by`;
export const SQL_XOA_KHOA_THUONG = 'DELETE FROM bonus_locks WHERE year = $1 AND month = $2';

export const SQL_DOC_THUONG_DIEM = 'SELECT * FROM point_bonus_lines WHERE year = $1 AND month = $2';
export const SQL_XOA_THUONG_DIEM = 'DELETE FROM point_bonus_lines WHERE year = $1 AND month = $2';
export const SQL_GHI_THUONG_DIEM = `INSERT INTO point_bonus_lines
  (year, month, member_id, full_name, team_id, points, bonus_goc, he_so_pct, amount)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`;

const hai = (n: number) => String(n).padStart(2, '0');

/** Mã cố định của khoản chi thưởng một tháng — chốt lại / mở lại không sinh bản trùng. */
export function thuongEntryId(year: number, month: number): string {
  return `THUONG-${year}-${hai(month)}`;
}

function thangSau(year: number, month: number): { year: number; month: number } {
  return month >= 12 ? { year: year + 1, month: 1 } : { year, month: month + 1 };
}

async function thuongDiemLive(year: number, month: number): Promise<DongThuongDiem[]> {
  // Giám đốc không có điểm/thưởng cá nhân — cùng luật với báo cáo tổng kết tháng.
  const nguoi = (await getActiveMembers()).filter((m) => m.role !== 'director');
  return (await scoresFor(nguoi, year, month)).map((s) => ({
    memberId: s.memberId,
    fullName: s.fullName,
    teamId: s.teamId,
    points: s.monthPoints,
    bonusGoc: s.bonusGoc,
    heSo: s.heSoKpi,
    amount: s.bonus,
  }));
}

async function thuongDiemDaChot(year: number, month: number): Promise<DongThuongDiem[]> {
  const rows = await q(SQL_DOC_THUONG_DIEM, [year, month]);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return rows.map((r: any) => ({
    memberId: String(r.member_id || ''),
    fullName: String(r.full_name || ''),
    teamId: String(r.team_id || ''),
    points: Number(r.points) || 0,
    bonusGoc: Number(r.bonus_goc) || 0,
    heSo: Number(r.he_so_pct ?? 100) / 100,
    amount: Number(r.amount) || 0,
  }));
}

export interface BangThuong {
  year: number;
  month: number;
  locked: boolean;
  lockedAt: string;
  lockedBy: string;
  rows: ThuongNguoi[];
  tong: number;
}

/**
 * Bảng thưởng một tháng. Đã chốt thì đọc số đã chụp; chưa chốt thì tính live.
 *
 * `projectBonusForMonth` tự biết đọc bản chụp khi tháng đã chốt thưởng, nên ở đây chỉ phải
 * rẽ nhánh cho thưởng điểm.
 */
export async function bangThuongThang(year: number, month: number): Promise<BangThuong> {
  const khoa = await q(SQL_DOC_KHOA_THUONG, [year, month]);
  const locked = khoa.length > 0;
  const [diem, kpi] = await Promise.all([
    locked ? thuongDiemDaChot(year, month) : thuongDiemLive(year, month),
    projectBonusForMonth(year, month),
  ]);
  const rows = gopThuong(diem, kpi);
  return {
    year,
    month,
    locked,
    lockedAt: String(khoa[0]?.locked_at || ''),
    lockedBy: String(khoa[0]?.locked_by || ''),
    rows,
    tong: tongThuong(rows),
  };
}

/**
 * Chốt thưởng: chụp cả hai loại thưởng, ghi khoá, ghi một khoản chi vào tháng sau.
 *
 * Chụp và tính tiền từ CÙNG MỘT bảng `bang` — tính hai lần là có kẽ hở để số trên bảng và
 * số vào chi phí lệch nhau, chỉ cần ai đó sửa mức thưởng đúng lúc đang bấm.
 */
export async function chotThuong(year: number, month: number, byName: string, atIso: string): Promise<BangThuong> {
  // Tháng chưa hết thì điểm còn đang cộng, kỳ KPI còn đang chạy — chốt lúc này là chi thiếu.
  if (`${year}-${hai(month)}` >= todayIso().slice(0, 7)) {
    throw new ApiError(400, `Tháng ${month}/${year} chưa hết nên chưa chốt thưởng được.`);
  }

  // Tính LIVE trước khi ghi dòng khoá: ghi khoá rồi thì mọi hàm đọc chuyển sang bản chụp,
  // lúc đó bản chụp còn rỗng.
  const bang = await bangThuongThang(year, month);
  if (bang.locked) throw new ApiError(409, `Tháng ${month}/${year} đã chốt thưởng rồi.`);

  await q(SQL_XOA_THUONG_DIEM, [year, month]);
  for (const r of bang.rows) {
    await q(SQL_GHI_THUONG_DIEM, [
      year,
      month,
      r.memberId,
      r.fullName,
      r.teamId,
      r.points,
      r.thuongDiemGoc,
      Math.round(r.heSo * 100),
      r.thuongDiem,
    ]);
  }
  await saveBonusLines(
    year,
    month,
    bang.rows.flatMap((r) =>
      r.duAn.map((k) => ({
        memberId: k.memberId,
        projectId: k.projectId,
        teamId: k.teamId,
        vaiTro: k.vaiTro,
        tyLe: k.tyLe,
        mucThuong: k.mucThuong,
        amount: k.amount,
      })),
    ),
  );

  await q(SQL_GHI_KHOA_THUONG, [year, month, atIso, byName]);

  const nxt = thangSau(year, month);
  if (bang.tong > 0) {
    await upsertEntry({
      id: thuongEntryId(year, month),
      month: `${nxt.year}-${hai(nxt.month)}`,
      kind: 'chi',
      name: `Thưởng tháng ${month}/${year}`,
      amount: bang.tong,
      date: '',
      recurring: false,
      partyId: '',
      source: '',
      customerId: '',
    });
  } else {
    // Tháng không ai có thưởng thì không ghi dòng chi 0đ cho rối sổ.
    await deleteEntry(thuongEntryId(year, month));
  }

  return { ...bang, locked: true, lockedAt: atIso, lockedBy: byName };
}

/** Mở lại tháng đã chốt thưởng: gỡ khoá và gỡ khoản chi tự ghi. Bản chụp để nguyên, chốt lại sẽ ghi đè. */
export async function moThuong(year: number, month: number): Promise<void> {
  await q(SQL_XOA_KHOA_THUONG, [year, month]);
  await deleteEntry(thuongEntryId(year, month));
}
