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
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (project_id) DO UPDATE SET
       name = EXCLUDED.name, customer_id = EXCLUDED.customer_id, customer_name = EXCLUDED.customer_name,
       status = EXCLUDED.status, start_date = EXCLUDED.start_date, end_date = EXCLUDED.end_date,
       note = EXCLUDED.note`,
    [p.id, p.name, p.customerId, p.customerName, p.status, p.startDate, p.endDate, p.note, p.createdBy, p.createdAt],
  );
}

/** Xoá dự án kèm KPI và mọi số đã nhập — không có FK cascade nên phải tự dọn. */
export async function deleteProject(id: string): Promise<void> {
  const kpis = await q('SELECT kpi_id FROM project_kpis WHERE project_id = $1', [id]);
  const ids = kpis.map((r: { kpi_id: string }) => r.kpi_id);
  if (ids.length) await q('DELETE FROM kpi_entries WHERE kpi_id = ANY($1)', [ids]);
  await q('DELETE FROM project_kpis WHERE project_id = $1', [id]);
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
       (kpi_id, project_id, team_id, name, unit, period, target, active, sort_order, created_at, input_mode)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)
     ON CONFLICT (kpi_id) DO UPDATE SET
       team_id = EXCLUDED.team_id, name = EXCLUDED.name, unit = EXCLUDED.unit,
       period = EXCLUDED.period, target = EXCLUDED.target, active = EXCLUDED.active,
       sort_order = EXCLUDED.sort_order, input_mode = EXCLUDED.input_mode`,
    [k.id, k.projectId, k.teamId, k.name, k.unit, k.period, k.target, k.active, k.sortOrder, k.createdAt, k.inputMode],
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
