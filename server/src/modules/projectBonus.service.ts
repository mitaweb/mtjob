// Thưởng KPI dự án — anh Tâm 21/8/2026.
//
// Mỗi (dự án × phòng) có một mức thưởng bằng tiền. Leader phòng đó ăn theo tỉ lệ đạt KPI
// của phòng mình trong dự án đó; thành viên được phân công ăn theo bậc. Luật tiền nằm ở
// lib/money.ts, luật quy tỉ lệ về tháng nằm ở lib/kpi.ts — file này chỉ đọc DB và ghép.
import { getProjects, getKpis, getEntries, getTeamBonuses, getAssignees, getBonusLines, saveBonusLines } from './projects.repo.js';
import { getActiveMembers } from './members.repo.js';
import { getTeams } from './teams.repo.js';
import { getHolidaySet } from './holidays.repo.js';
import { isMonthLocked } from './payroll.service.js';
import { phanTramTheoThang, tyLeTheoThang } from '../lib/kpi.js';
import { thuongLeader, thuongThanhVien } from '../lib/money.js';
import { todayIso } from '../lib/datetime.js';

export interface ProjectBonusLine {
  memberId: string;
  fullName: string;
  teamId: string;
  projectId: string;
  projectName: string;
  vaiTro: 'leader' | 'member';
  /** % đạt KPI của phòng trong dự án đó; null = tháng đó không đo được. */
  tyLe: number | null;
  mucThuong: number;
  amount: number;
}

const khoa = (projectId: string, teamId: string) => `${projectId}|${teamId}`;

/**
 * Tỉ lệ đạt của mọi (dự án × phòng) trong tháng. Khoá `projectId|teamId`.
 *
 * MỘT lượt nạp cho cả công ty. `scores.service.ts` đã có bài học đắt: gọi trong vòng lặp
 * là quét lại bảng 15 lần và job báo cáo hết giờ trước khi chạy xong.
 */
export async function tyLeDuAnTheoThang(
  year: number,
  month: number,
): Promise<Map<string, number | null>> {
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
  // Gom % của từng chỉ số về đúng (dự án × phòng).
  const gom = new Map<string, Array<number | null>>();
  for (const k of kpis) {
    if (!k.active) continue;
    const p = duAnTheoId.get(k.projectId);
    if (!p) continue;
    const r = phanTramTheoThang(
      entriesTheoKpi.get(k.id) || [],
      k,
      thang,
      { startDate: p.startDate, endDate: p.endDate },
      todayIso(),
      holidays,
    );
    const key = khoa(k.projectId, k.teamId);
    const arr = gom.get(key);
    if (arr) arr.push(r.percent);
    else gom.set(key, [r.percent]);
  }

  const ra = new Map<string, number | null>();
  for (const [key, list] of gom) ra.set(key, tyLeTheoThang(list));
  return ra;
}

/**
 * Thưởng KPI dự án của cả công ty trong một tháng.
 *
 * Tháng ĐÃ CHỐT LƯƠNG thì đọc số đã chụp lại, không tính lại: giám đốc nâng mức thưởng
 * tháng 11 không được phép làm đổi tiền của tháng 8 đã trả.
 */
export async function projectBonusForMonth(year: number, month: number): Promise<ProjectBonusLine[]> {
  const [projects, kpis, members, teams, rates, assignees] = await Promise.all([
    getProjects(),
    getKpis(),
    getActiveMembers(),
    getTeams(),
    getTeamBonuses(),
    getAssignees(),
  ]);
  const nguoi = new Map(members.map((m) => [m.id, m]));
  const duAn = new Map(projects.map((p) => [p.id, p]));
  const mucTheoKhoa = new Map(rates.map((r) => [khoa(r.projectId, r.teamId), r.amount]));
  const leaderCuaPhong = new Map(teams.map((t) => [t.id, t.leaderMemberId || '']));

  // Tháng đã khoá lương → trả đúng số đã chụp.
  if (await isMonthLocked(year, month)) {
    return (await getBonusLines(year, month)).map((l) => ({
      memberId: l.memberId,
      fullName: nguoi.get(l.memberId)?.fullName || '',
      teamId: l.teamId,
      projectId: l.projectId,
      projectName: duAn.get(l.projectId)?.name || '',
      vaiTro: l.vaiTro,
      tyLe: l.tyLe,
      mucThuong: l.mucThuong,
      amount: l.amount,
    }));
  }

  const tyLe = await tyLeDuAnTheoThang(year, month);
  const dauThang = `${year}-${String(month).padStart(2, '0')}-01`;
  const cuoiThang = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);

  // Phòng nào có chỉ số trong dự án nào — leader chịu trách nhiệm đúng những cặp này.
  const phongCuaDuAn = new Map<string, Set<string>>();
  for (const k of kpis) {
    if (!k.active) continue;
    const s = phongCuaDuAn.get(k.projectId);
    if (s) s.add(k.teamId);
    else phongCuaDuAn.set(k.projectId, new Set([k.teamId]));
  }

  const ra: ProjectBonusLine[] = [];

  for (const [projectId, phongs] of phongCuaDuAn) {
    const p = duAn.get(projectId);
    if (!p) continue;
    for (const teamId of phongs) {
      const muc = mucTheoKhoa.get(khoa(projectId, teamId)) || 0;
      if (muc <= 0) continue; // chưa đặt mức thưởng thì không sinh dòng nào
      const r = tyLe.get(khoa(projectId, teamId)) ?? null;

      // ── Leader: suy ra từ phòng, KHÔNG cần có tên trong bảng phân công ──
      const leaderId = leaderCuaPhong.get(teamId) || '';
      if (leaderId && nguoi.has(leaderId)) {
        ra.push({
          memberId: leaderId,
          fullName: nguoi.get(leaderId)!.fullName,
          teamId,
          projectId,
          projectName: p.name,
          vaiTro: 'leader',
          tyLe: r,
          mucThuong: muc,
          amount: thuongLeader(muc, r),
        });
      }

      // ── Thành viên: từ bảng phân công, có tham gia trong tháng đó ──
      for (const a of assignees) {
        if (a.projectId !== projectId || a.teamId !== teamId) continue;
        // Leader lỡ tự thêm mình vào bảng phân công thì dòng leader ở trên thắng,
        // không sinh dòng thứ hai.
        if (a.memberId === leaderId) continue;
        if (a.startDate && a.startDate > cuoiThang) continue;
        if (a.endDate && a.endDate < dauThang) continue;
        const m = nguoi.get(a.memberId);
        if (!m) continue;
        ra.push({
          memberId: a.memberId,
          fullName: m.fullName,
          teamId,
          projectId,
          projectName: p.name,
          vaiTro: 'member',
          tyLe: r,
          mucThuong: muc,
          amount: thuongThanhVien(muc, r),
        });
      }
    }
  }
  return ra;
}

/** Thưởng KPI dự án của một người trong tháng. */
export async function projectBonusForMember(
  memberId: string,
  year: number,
  month: number,
): Promise<ProjectBonusLine[]> {
  return (await projectBonusForMonth(year, month)).filter((l) => l.memberId === memberId);
}

/**
 * Hệ số nhân vào thưởng ĐIỂM: 1 hoặc 0,5.
 *
 * Bất kỳ dự án nào của người đó dưới 50% là còn một nửa. Dự án không đo được bị bỏ qua —
 * người được phân vào một dự án đang tạm dừng không đáng bị cắt thưởng vì chuyện đó.
 *
 * Chỉ trả về người CÓ hệ số khác 1, để chỗ gọi chỉ cần `map.get(id) ?? 1`.
 */
export async function heSoThuongDiem(year: number, month: number): Promise<Map<string, number>> {
  const lines = await projectBonusForMonth(year, month);
  const theoNguoi = new Map<string, Array<number | null>>();
  for (const l of lines) {
    const arr = theoNguoi.get(l.memberId);
    if (arr) arr.push(l.tyLe);
    else theoNguoi.set(l.memberId, [l.tyLe]);
  }
  const ra = new Map<string, number>();
  for (const [id, list] of theoNguoi) {
    const doDuoc = list.filter((r): r is number => r !== null && Number.isFinite(r));
    if (doDuoc.length > 0 && doDuoc.some((r) => r < 50)) ra.set(id, 0.5);
  }
  return ra;
}

/** Chụp lại thưởng của tháng — gọi lúc chốt lương để số không trôi về sau. */
export async function snapshotProjectBonus(year: number, month: number): Promise<number> {
  const lines = await projectBonusForMonth(year, month);
  await saveBonusLines(
    year,
    month,
    lines.map((l) => ({
      memberId: l.memberId,
      projectId: l.projectId,
      teamId: l.teamId,
      vaiTro: l.vaiTro,
      tyLe: l.tyLe ?? 0,
      mucThuong: l.mucThuong,
      amount: l.amount,
    })),
  );
  return lines.length;
}
