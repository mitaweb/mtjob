// Thưởng KPI — luật anh Tâm 21/9/2026 (thay luật 21/8/2026 đặt mức theo từng dự án × phòng).
//
//   · LEADER (theo CHỨC VỤ `members.role = 'leader'`): gom mọi chỉ số của phòng mình trên mọi
//     dự án; ≥ ngưỡng (80%) số chỉ số đạt 100% → nhận trọn mức thưởng của team tháng đó
//     (`teams.leader_kpi_bonus`: Ads 3tr, SEO/Content 2tr). Mỗi leader MỘT dòng mỗi tháng.
//   · THÀNH VIÊN: không có tiền KPI riêng. ≥ ngưỡng số dự án mình được phân công "đạt" →
//     đủ thưởng điểm; dưới đó → thưởng điểm × 0,5.
//
// Luật tiền nằm ở lib/money.ts, luật quy tỉ lệ về tháng nằm ở lib/kpi.ts — file này chỉ đọc
// DB và ghép.
import { q } from '../db/client.js';
import { getProjects, getKpis, getEntries, getAssignees, getBonusLines } from './projects.repo.js';
import { getActiveMembers } from './members.repo.js';
import { getTeams } from './teams.repo.js';
import { getHolidaySet } from './holidays.repo.js';
import { isBonusLocked } from './bonusLock.js';
import { getConfig } from '../config.js';
import { phanTramTheoThang } from '../lib/kpi.js';
import { tyLeDat, thuongLeaderThang, duAnDat, heSoDiemThanhVien } from '../lib/money.js';
import { todayIso } from '../lib/datetime.js';

/** % đạt của MỘT chỉ số trong tháng. */
export interface ChiSoThang {
  projectId: string;
  projectName: string;
  teamId: string;
  kpiName: string;
  /** null = tháng đó không đo được (ngoài khung, chưa có kỳ nào chốt, chưa đặt mục tiêu). */
  percent: number | null;
}

export interface ProjectBonusLine {
  memberId: string;
  fullName: string;
  teamId: string;
  /** Luôn rỗng từ luật 21/9/2026 — thưởng leader tính trên cả phòng, không theo dự án. */
  projectId: string;
  projectName: string;
  vaiTro: 'leader' | 'member';
  /** % số chỉ số đạt; null = không chỉ số nào đo được. */
  tyLe: number | null;
  soDat: number;
  soChiSo: number;
  mucThuong: number;
  amount: number;
  /** Chỉ số chưa đạt, để giải thích vì sao trượt. Chỉ có khi tính live. */
  truot: string[];
}

/**
 * % đạt của mọi chỉ số đang bật trong tháng.
 *
 * MỘT lượt nạp cho cả công ty. `scores.service.ts` đã có bài học đắt: gọi trong vòng lặp
 * là quét lại bảng 15 lần và job báo cáo hết giờ trước khi chạy xong.
 *
 * Dự án đang TẠM DỪNG bị bỏ qua: không ai nhập số cho nó, tính vào là mọi chỉ số ra 0% và
 * kéo cả phòng trượt vì một việc không ai được làm.
 */
export async function chiSoTheoThang(year: number, month: number): Promise<ChiSoThang[]> {
  const thang = `${year}-${String(month).padStart(2, '0')}`;
  const [projects, kpis, holidays] = await Promise.all([getProjects(), getKpis(), getHolidaySet()]);
  const entries = await getEntries(kpis.map((k) => k.id));

  const entriesTheoKpi = new Map<string, typeof entries>();
  for (const e of entries) {
    const arr = entriesTheoKpi.get(e.kpiId);
    if (arr) arr.push(e);
    else entriesTheoKpi.set(e.kpiId, [e]);
  }

  const duAnTheoId = new Map(projects.map((p) => [p.id, p]));
  const homNay = todayIso();
  const ra: ChiSoThang[] = [];
  for (const k of kpis) {
    if (!k.active) continue;
    const p = duAnTheoId.get(k.projectId);
    if (!p || p.status === 'paused') continue;
    const r = phanTramTheoThang(
      entriesTheoKpi.get(k.id) || [],
      k,
      thang,
      { startDate: p.startDate, endDate: p.endDate },
      homNay,
      holidays,
    );
    ra.push({ projectId: p.id, projectName: p.name, teamId: k.teamId, kpiName: k.name, percent: r.percent });
  }
  return ra;
}

async function nguongDat(): Promise<number> {
  return (await getConfig()).kpiPassRate;
}

/**
 * Thưởng leader của cả công ty trong một tháng — mỗi người chức vụ leader một dòng.
 *
 * Tháng ĐÃ CHỐT THƯỞNG thì đọc số đã chụp lại, không tính lại: giám đốc nâng mức thưởng
 * tháng 11 không được phép làm đổi tiền của tháng 8 đã trả. Khoá LƯƠNG không liên quan ở
 * đây — anh Tâm chốt 13/9/2026 hai thứ chốt riêng.
 */
export async function projectBonusForMonth(year: number, month: number): Promise<ProjectBonusLine[]> {
  const members = await getActiveMembers();
  const nguoi = new Map(members.map((m) => [m.id, m]));

  if (await isBonusLocked(year, month)) {
    return (await getBonusLines(year, month)).map((l) => ({
      memberId: l.memberId,
      fullName: nguoi.get(l.memberId)?.fullName || '',
      teamId: l.teamId,
      projectId: l.projectId,
      projectName: '',
      vaiTro: l.vaiTro,
      tyLe: l.tyLe,
      soDat: l.soDat,
      soChiSo: l.soChiSo,
      mucThuong: l.mucThuong,
      amount: l.amount,
      truot: [],
    }));
  }

  const [chiSo, teams, nguong] = await Promise.all([chiSoTheoThang(year, month), getTeams(), nguongDat()]);
  const mucCuaTeam = new Map(teams.map((t) => [t.id, t.leaderKpiBonus || 0]));

  const theoPhong = new Map<string, ChiSoThang[]>();
  for (const c of chiSo) {
    const arr = theoPhong.get(c.teamId);
    if (arr) arr.push(c);
    else theoPhong.set(c.teamId, [c]);
  }

  const ra: ProjectBonusLine[] = [];
  // Leader căn cứ theo CHỨC VỤ trong công ty (anh Tâm 21/9/2026), không theo ô "leader của
  // team" — team có hai người chức vụ leader thì mỗi người một dòng.
  for (const m of members) {
    if (m.role !== 'leader' || !m.teamId) continue;
    const cua = theoPhong.get(m.teamId) || [];
    // Phòng không có chỉ số ở dự án nào thì không có gì để thưởng hay giải thích.
    if (cua.length === 0) continue;
    const percents = cua.map((c) => c.percent);
    const dem = tyLeDat(percents);
    const muc = mucCuaTeam.get(m.teamId) || 0;
    ra.push({
      memberId: m.id,
      fullName: m.fullName,
      teamId: m.teamId,
      projectId: '',
      projectName: '',
      vaiTro: 'leader',
      tyLe: dem.tyLe,
      soDat: dem.dat,
      soChiSo: dem.tong,
      mucThuong: muc,
      amount: thuongLeaderThang(percents, muc, nguong),
      truot: cua
        .filter((c) => c.percent !== null && c.percent < 100)
        .map((c) => `${c.projectName} · ${c.kpiName} (${Math.round(c.percent as number)}%)`),
    });
  }
  return ra;
}

/** Dòng thưởng leader của một người trong tháng (rỗng nếu không phải leader). */
export async function projectBonusForMember(
  memberId: string,
  year: number,
  month: number,
): Promise<ProjectBonusLine[]> {
  return (await projectBonusForMonth(year, month)).filter((l) => l.memberId === memberId);
}

export interface DuAnCuaToi {
  projectId: string;
  projectName: string;
  /** true = đạt · false = trượt · null = tháng này không đo được (không tính). */
  dat: boolean | null;
  soDat: number;
  soChiSo: number;
}

export interface HeSoDiem {
  heSo: number;
  /** "2/4 dự án đạt" — rỗng khi không có dự án nào tính được. */
  lyDo: string;
  duAn: DuAnCuaToi[];
}

export const SQL_DOC_HE_SO_DA_CHOT =
  'SELECT member_id, he_so_pct, ly_do FROM point_bonus_lines WHERE year = $1 AND month = $2';

/**
 * Hệ số thưởng điểm của TỪNG THÀNH VIÊN có dự án, kèm lý do.
 *
 * Người chức vụ leader không nằm trong này: leader chịu trách nhiệm qua khoản thưởng riêng,
 * thưởng điểm của họ không bị cắt. Tháng đã chốt thưởng thì đọc hệ số đã chụp.
 */
export async function heSoDiemChiTiet(year: number, month: number): Promise<Map<string, HeSoDiem>> {
  const ra = new Map<string, HeSoDiem>();

  if (await isBonusLocked(year, month)) {
    for (const r of await q(SQL_DOC_HE_SO_DA_CHOT, [year, month])) {
      const heSo = Number(r.he_so_pct ?? 100) / 100;
      const lyDo = String(r.ly_do || '');
      if (heSo !== 1 || lyDo) ra.set(String(r.member_id || ''), { heSo, lyDo, duAn: [] });
    }
    return ra;
  }

  const [chiSo, assignees, members, nguong] = await Promise.all([
    chiSoTheoThang(year, month),
    getAssignees(),
    getActiveMembers(),
    nguongDat(),
  ]);
  const nguoi = new Map(members.map((m) => [m.id, m]));
  const dauThang = `${year}-${String(month).padStart(2, '0')}-01`;
  const cuoiThang = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  // % các chỉ số theo (dự án × phòng) + tên dự án.
  const theoKhoa = new Map<string, ChiSoThang[]>();
  for (const c of chiSo) {
    const key = `${c.projectId}|${c.teamId}`;
    const arr = theoKhoa.get(key);
    if (arr) arr.push(c);
    else theoKhoa.set(key, [c]);
  }

  const duAnTheoNguoi = new Map<string, DuAnCuaToi[]>();
  for (const a of assignees) {
    const m = nguoi.get(a.memberId);
    if (!m || m.role === 'leader' || m.role === 'director') continue;
    // Có tham gia trong tháng đó — gỡ giữa tháng vẫn tính, gỡ từ tháng trước thì không.
    if (a.startDate && a.startDate > cuoiThang) continue;
    if (a.endDate && a.endDate < dauThang) continue;
    const cua = theoKhoa.get(`${a.projectId}|${a.teamId}`);
    if (!cua || cua.length === 0) continue; // dự án tạm dừng / phòng không có chỉ số ở đó
    const percents = cua.map((c) => c.percent);
    const dem = tyLeDat(percents);
    const dong: DuAnCuaToi = {
      projectId: a.projectId,
      projectName: cua[0].projectName,
      dat: duAnDat(percents, nguong),
      soDat: dem.dat,
      soChiSo: dem.tong,
    };
    const arr = duAnTheoNguoi.get(a.memberId);
    if (arr) arr.push(dong);
    else duAnTheoNguoi.set(a.memberId, [dong]);
  }

  for (const [id, duAn] of duAnTheoNguoi) {
    const tinhDuoc = duAn.filter((d) => d.dat !== null);
    ra.set(id, {
      heSo: heSoDiemThanhVien(duAn.map((d) => d.dat), nguong),
      lyDo: tinhDuoc.length ? `${tinhDuoc.filter((d) => d.dat).length}/${tinhDuoc.length} dự án đạt` : '',
      duAn,
    });
  }
  return ra;
}

/**
 * Hệ số nhân vào thưởng ĐIỂM: 1 hoặc 0,5.
 * Chỉ trả về người CÓ hệ số khác 1, để chỗ gọi chỉ cần `map.get(id) ?? 1`.
 */
export async function heSoThuongDiem(year: number, month: number): Promise<Map<string, number>> {
  const ra = new Map<string, number>();
  for (const [id, h] of await heSoDiemChiTiet(year, month)) if (h.heSo !== 1) ra.set(id, h.heSo);
  return ra;
}

/**
 * Ai chưa được phân công dự án nào.
 *
 * Anh Tâm chốt "luôn luôn phân công", nên đây là danh sách phải rỗng. Với luật mới, người
 * không có dự án thì thưởng điểm không bị soi theo kết quả dự án — hiện ra để không ai
 * đứng ngoài luật chỉ vì bị quên. Dùng chung cho trang Dự án và bảng thưởng trang lương.
 *
 * (Việc chụp thưởng lúc chốt đã chuyển sang `bonusMonth.service.chotThuong`.)
 */
export async function chuaPhanCongDuAn(): Promise<Array<{ id: string; fullName: string; teamId: string }>> {
  const [members, assignees] = await Promise.all([getActiveMembers(), getAssignees()]);
  const coDuAn = new Set(assignees.filter((a) => !a.endDate).map((a) => a.memberId));
  return members
    .filter((m) => m.role === 'member' && !coDuAn.has(m.id))
    .map((m) => ({ id: m.id, fullName: m.fullName, teamId: m.teamId }));
}
