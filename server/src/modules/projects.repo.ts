import { q } from '../db/client.js';
import type { KpiPeriod, KpiInputMode } from '../lib/kpi.js';

export interface Project {
  id: string;
  name: string;
  customerId: string;
  customerName: string; // snapshot — xoá khách khỏi CRM vẫn còn tên trên dự án
  status: string; // active | paused | done
  startDate: string;
  endDate: string;
  note: string;
  createdBy: string;
  createdAt: string;
}

export interface ProjectKpi {
  id: string;
  projectId: string;
  teamId: string; // Ads | Content | SEO
  name: string;
  unit: string;
  period: KpiPeriod;
  target: number;
  /** daily = so cua ngay do; cumulative = so tong den ngay do. */
  inputMode: KpiInputMode;
  /** Khung thoi gian rieng cua chi so; rong = chay theo thoi gian ca du an. */
  startDate: string;
  endDate: string;
  active: boolean;
  sortOrder: number;
  createdAt: string;
}

export interface KpiEntry {
  kpiId: string;
  date: string;
  value: number;
  memberId: string;
  memberName: string;
  late: boolean; // giám đốc nhập bù sau khi đã quá hạn
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToProject(r: any): Project {
  return {
    id: r.project_id || '',
    name: r.name || '',
    customerId: r.customer_id || '',
    customerName: r.customer_name || '',
    status: r.status || 'active',
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    note: r.note || '',
    createdBy: r.created_by || '',
    createdAt: r.created_at || '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToKpi(r: any): ProjectKpi {
  return {
    id: r.kpi_id || '',
    projectId: r.project_id || '',
    teamId: r.team_id || '',
    name: r.name || '',
    unit: r.unit || '',
    period: (r.period || 'month') as KpiPeriod,
    inputMode: (r.input_mode === 'cumulative' ? 'cumulative' : 'daily') as KpiInputMode,
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    target: Number(r.target || 0) || 0,
    active: !!r.active,
    sortOrder: Number(r.sort_order || 0) || 0,
    createdAt: r.created_at || '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntry(r: any): KpiEntry {
  return {
    kpiId: r.kpi_id || '',
    date: r.date || '',
    value: Number(r.value || 0) || 0,
    memberId: r.member_id || '',
    memberName: r.member_name || '',
    late: !!r.late,
    updatedAt: r.updated_at || '',
  };
}

// ── Dự án ──

export async function getProjects(): Promise<Project[]> {
  return (await q('SELECT * FROM projects ORDER BY created_at DESC')).map(rowToProject);
}

export async function findProject(id: string): Promise<Project | undefined> {
  const r = await q('SELECT * FROM projects WHERE project_id = $1 LIMIT 1', [id]);
  return r.length ? rowToProject(r[0]) : undefined;
}

export async function upsertProject(p: Project): Promise<void> {
  await q(
    `INSERT INTO projects
       (project_id, name, customer_id, customer_name, status, start_date, end_date, note, created_by, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (project_id) DO UPDATE SET
       name = EXCLUDED.name, customer_id = EXCLUDED.customer_id, customer_name = EXCLUDED.customer_name,
       status = EXCLUDED.status, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
       note = EXCLUDED.note`,
    [p.id, p.name, p.customerId, p.customerName, p.status, p.startDate, p.endDate, p.note, p.createdBy, p.createdAt],
  );
}

/**
 * Xoá dự án kèm KPI và mọi số đã nhập — không có FK cascade nên phải tự dọn.
 *
 * Dọn cả mức thưởng và danh sách phân công: bỏ sót thì một dự án mới trùng mã sẽ thừa kế
 * mức thưởng cũ và cả danh sách người của dự án đã xoá.
 *
 * KHÔNG dọn `project_bonus_lines` — đó là số đã chốt của tháng đã khoá lương, xoá dự án
 * không được phép làm đổi tiền đã trả.
 */
export async function deleteProject(id: string): Promise<void> {
  const kpis = await q('SELECT kpi_id FROM project_kpis WHERE project_id = $1', [id]);
  const ids = kpis.map((r: { kpi_id: string }) => r.kpi_id);
  if (ids.length) await q('DELETE FROM kpi_entries WHERE kpi_id = ANY($1)', [ids]);
  await q('DELETE FROM project_kpis WHERE project_id = $1', [id]);
  await q('DELETE FROM project_team_bonus WHERE project_id = $1', [id]);
  await q('DELETE FROM project_assignees WHERE project_id = $1', [id]);
  await q('DELETE FROM projects WHERE project_id = $1', [id]);
}

// ── Chỉ số ──

export async function getKpis(projectId?: string): Promise<ProjectKpi[]> {
  const rows = projectId
    ? await q('SELECT * FROM project_kpis WHERE project_id = $1 ORDER BY team_id, sort_order, created_at', [projectId])
    : await q('SELECT * FROM project_kpis ORDER BY team_id, sort_order, created_at');
  return rows.map(rowToKpi);
}

export async function findKpi(id: string): Promise<ProjectKpi | undefined> {
  const r = await q('SELECT * FROM project_kpis WHERE kpi_id = $1 LIMIT 1', [id]);
  return r.length ? rowToKpi(r[0]) : undefined;
}

export async function upsertKpi(k: ProjectKpi): Promise<void> {
  await q(
    `INSERT INTO project_kpis
       (kpi_id, project_id, team_id, name, unit, period, target, active, sort_order, created_at, input_mode, start_date, end_date)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (kpi_id) DO UPDATE SET
       team_id = EXCLUDED.team_id, name = EXCLUDED.name, unit = EXCLUDED.unit,
       period = EXCLUDED.period, target = EXCLUDED.target, active = EXCLUDED.active,
       sort_order = EXCLUDED.sort_order, input_mode = EXCLUDED.input_mode,
       start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date`,
    [k.id, k.projectId, k.teamId, k.name, k.unit, k.period, k.target, k.active, k.sortOrder, k.createdAt, k.inputMode, k.startDate, k.endDate],
  );
}

export async function deleteKpi(id: string): Promise<void> {
  await q('DELETE FROM kpi_entries WHERE kpi_id = $1', [id]);
  await q('DELETE FROM project_kpis WHERE kpi_id = $1', [id]);
}

// ── Số nhập theo ngày ──

/** Mọi số của các KPI cho trước. Lọc ở SQL chứ không kéo cả bảng về rồi lọc trong JS. */
export async function getEntries(kpiIds: string[]): Promise<KpiEntry[]> {
  if (kpiIds.length === 0) return [];
  return (await q('SELECT * FROM kpi_entries WHERE kpi_id = ANY($1) ORDER BY date', [kpiIds])).map(rowToEntry);
}

/** Số của một ngày cụ thể — dùng cho bảng "nhập hôm nay / hôm qua". */
export async function getEntriesForDates(kpiIds: string[], dates: string[]): Promise<KpiEntry[]> {
  if (kpiIds.length === 0 || dates.length === 0) return [];
  return (
    await q('SELECT * FROM kpi_entries WHERE kpi_id = ANY($1) AND date = ANY($2)', [kpiIds, dates])
  ).map(rowToEntry);
}

/** Ghi đè số của (KPI, ngày) — mỗi ngày đúng một dòng, không cộng dồn. */
export async function saveEntry(e: KpiEntry): Promise<void> {
  await q(
    `INSERT INTO kpi_entries (kpi_id, date, value, member_id, member_name, late, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7)
     ON CONFLICT (kpi_id, date) DO UPDATE SET
       value = EXCLUDED.value, member_id = EXCLUDED.member_id, member_name = EXCLUDED.member_name,
       late = EXCLUDED.late, updated_at = EXCLUDED.updated_at`,
    [e.kpiId, e.date, e.value, e.memberId, e.memberName, e.late, e.updatedAt],
  );
}

// ── Thưởng KPI dự án ──

/** Mức thưởng của một (dự án × phòng). */
export interface TeamBonus {
  projectId: string;
  teamId: string;
  amount: number;
  note: string;
}

/** Một người được phân công vào dự án. */
export interface Assignee {
  projectId: string;
  memberId: string;
  teamId: string;
  startDate: string;
  /** Rỗng = còn tham gia. */
  endDate: string;
  assignedBy: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToBonus(r: any): TeamBonus {
  return {
    projectId: r.project_id || '',
    teamId: r.team_id || '',
    amount: Number(r.amount || 0) || 0,
    note: r.note || '',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToAssignee(r: any): Assignee {
  return {
    projectId: r.project_id || '',
    memberId: r.member_id || '',
    teamId: r.team_id || '',
    startDate: r.start_date || '',
    endDate: r.end_date || '',
    assignedBy: r.assigned_by || '',
  };
}

/** Mức thưởng — của một dự án, hoặc của tất cả khi bỏ trống. */
export async function getTeamBonuses(projectId?: string): Promise<TeamBonus[]> {
  const rows = projectId
    ? await q('SELECT * FROM project_team_bonus WHERE project_id = $1', [projectId])
    : await q('SELECT * FROM project_team_bonus');
  return rows.map(rowToBonus);
}

export async function upsertTeamBonus(b: TeamBonus, by: string): Promise<void> {
  await q(
    `INSERT INTO project_team_bonus (project_id, team_id, amount, note, updated_by, updated_at)
     VALUES ($1,$2,$3,$4,$5,$6)
     ON CONFLICT (project_id, team_id) DO UPDATE SET
       amount = EXCLUDED.amount, note = EXCLUDED.note,
       updated_by = EXCLUDED.updated_by, updated_at = EXCLUDED.updated_at`,
    [b.projectId, b.teamId, Math.max(0, Math.round(b.amount) || 0), b.note || '', by, new Date().toISOString()],
  );
}

/** Phân công — của một dự án, hoặc của tất cả khi bỏ trống. */
export async function getAssignees(projectId?: string): Promise<Assignee[]> {
  const rows = projectId
    ? await q('SELECT * FROM project_assignees WHERE project_id = $1 ORDER BY created_at', [projectId])
    : await q('SELECT * FROM project_assignees ORDER BY created_at');
  return rows.map(rowToAssignee);
}

/**
 * Thêm người vào dự án. Thêm lại người đã gỡ thì XOÁ ngày kết thúc chứ không đẻ dòng mới —
 * PK là (dự án, người) nên mỗi người chỉ có đúng một dòng.
 */
export async function addAssignee(a: Assignee): Promise<void> {
  await q(
    `INSERT INTO project_assignees
       (project_id, member_id, team_id, start_date, end_date, assigned_by, created_at)
     VALUES ($1,$2,$3,$4,'',$5,$6)
     ON CONFLICT (project_id, member_id) DO UPDATE SET
       team_id = EXCLUDED.team_id, start_date = EXCLUDED.start_date,
       end_date = '', assigned_by = EXCLUDED.assigned_by`,
    [a.projectId, a.memberId, a.teamId, a.startDate, a.assignedBy, new Date().toISOString()],
  );
}

/**
 * Gỡ người khỏi dự án = ghi ngày kết thúc, KHÔNG xoá dòng.
 * Thưởng chốt theo tháng nên tháng 9 gỡ người vẫn phải tính được thưởng tháng 8 của họ.
 */
export async function endAssignee(projectId: string, memberId: string, ngay: string): Promise<void> {
  await q('UPDATE project_assignees SET end_date = $1 WHERE project_id = $2 AND member_id = $3', [
    ngay,
    projectId,
    memberId,
  ]);
}

/** Thưởng đã chốt cứng của một tháng (tháng đã khoá lương thì đọc cái này). */
export interface BonusLine {
  memberId: string;
  projectId: string;
  teamId: string;
  vaiTro: 'leader' | 'member';
  tyLe: number;
  mucThuong: number;
  amount: number;
}

export async function getBonusLines(year: number, month: number): Promise<BonusLine[]> {
  const rows = await q('SELECT * FROM project_bonus_lines WHERE year = $1 AND month = $2', [year, month]);
  return rows.map((r) => ({
    memberId: String(r.member_id || ''),
    projectId: String(r.project_id || ''),
    teamId: String(r.team_id || ''),
    vaiTro: r.vai_tro === 'leader' ? ('leader' as const) : ('member' as const),
    tyLe: Number(r.ty_le || 0) || 0,
    mucThuong: Number(r.muc_thuong || 0) || 0,
    amount: Number(r.amount || 0) || 0,
  }));
}

/** Chụp lại thưởng của tháng lúc chốt lương. Chạy lại được — ghi đè theo khoá. */
export async function saveBonusLines(year: number, month: number, lines: BonusLine[]): Promise<void> {
  for (const l of lines) {
    await q(
      `INSERT INTO project_bonus_lines
         (year, month, member_id, project_id, team_id, vai_tro, ty_le, muc_thuong, amount)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
       ON CONFLICT (year, month, member_id, project_id) DO UPDATE SET
         team_id = EXCLUDED.team_id, vai_tro = EXCLUDED.vai_tro, ty_le = EXCLUDED.ty_le,
         muc_thuong = EXCLUDED.muc_thuong, amount = EXCLUDED.amount`,
      [year, month, l.memberId, l.projectId, l.teamId, l.vaiTro, l.tyLe, l.mucThuong, l.amount],
    );
  }
}
