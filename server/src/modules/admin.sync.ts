// Member sync: parse HR people (from the public CSV of the source sheet, or a
// seed snapshot) and upsert members + teams/leaders. No Google credentials needed —
// the source sheet just has to be shared "anyone with the link – viewer".
import { getAllMembers, upsertMember } from './members.repo.js';
import { upsertTeam } from './teams.repo.js';
import { upsertCatalogItem } from './catalog.repo.js';
import { parseHrRow, vnUsername, type HrPerson } from '../lib/people.js';
import { summarizePointChanges, type PointChange, type PointChangeSummary } from '../lib/scores.js';
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { ApiError } from '../util/errors.js';

export interface SyncResult {
  imported: number;
  teams: string[];
  deactivated: string[]; // người không còn trong sheet → bị ẩn (active=false)
  people: Array<{ fullName: string; team: string; role: string; username: string }>;
}

export interface UpsertOpts {
  /** Ẩn (active=false) các thành viên KHÔNG còn trong sheet — dùng khi đồng bộ thật. */
  deactivateMissing?: boolean;
  /** Các member_id không bao giờ bị ẩn (vd người đang bấm đồng bộ). */
  protectIds?: Set<string>;
}

/** Upsert parsed HR people into members + teams. Keeps existing username/email/password (matched by full name). */
export async function upsertHrPeople(people: HrPerson[], opts: UpsertOpts = {}): Promise<SyncResult> {
  const existing = await getAllMembers();
  const byName = new Map(existing.map((m) => [m.fullName.trim().toLowerCase(), m]));
  const takenUsernames = new Set(existing.map((m) => m.username.toLowerCase()).filter(Boolean));

  const teamLeaders = new Map<string, string>();
  const teamSeen = new Set<string>();
  const syncedIds = new Set<string>();
  const out: SyncResult['people'] = [];

  for (const p of people) {
    const prior = byName.get(p.fullName.trim().toLowerCase());
    const id = prior?.id || newId('M-');
    syncedIds.add(id);
    let username = prior?.username || '';
    if (!username) {
      const base = vnUsername(p.fullName);
      username = base;
      let i = 2;
      while (takenUsernames.has(username.toLowerCase())) username = base + i++;
      takenUsernames.add(username.toLowerCase());
    }

    await upsertMember({
      id,
      fullName: p.fullName,
      dob: p.dob,
      position: p.position,
      teamId: p.team,
      role: p.role,
      salary: p.salary,
      bhxh: p.bhxh,
      joinDate: p.joinDate,
      username,
      email: prior?.email || '',
      passwordHash: prior?.passwordHash || '',
      active: true,
    });

    if (p.team) {
      teamSeen.add(p.team);
      if (p.isLeader) teamLeaders.set(p.team, id);
    }
    out.push({ fullName: p.fullName, team: p.team, role: p.role, username });
  }

  for (const team of teamSeen) {
    await upsertTeam({ id: team, name: team, leaderMemberId: teamLeaders.get(team) || '' });
  }

  // Người đã nghỉ: còn trong DB (đang active) nhưng KHÔNG còn trong sheet → ẩn đi.
  // Không đụng tài khoản admin (vd super-admin không nằm trong sheet) và người đang bấm đồng bộ.
  const deactivated: string[] = [];
  if (opts.deactivateMissing) {
    for (const m of existing) {
      if (syncedIds.has(m.id) || !m.active) continue;
      if (m.role === 'admin') continue;
      if (opts.protectIds?.has(m.id)) continue;
      await upsertMember({ ...m, active: false });
      deactivated.push(m.fullName);
    }
  }

  return { imported: people.length, teams: [...teamSeen], deactivated, people: out };
}

/** Tiny CSV parser (handles quoted fields). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let cur: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else inQuotes = false;
      } else field += c;
    } else if (c === '"') {
      inQuotes = true;
    } else if (c === ',') {
      cur.push(field);
      field = '';
    } else if (c === '\n') {
      cur.push(field.replace(/\r$/, ''));
      rows.push(cur);
      cur = [];
      field = '';
    } else {
      field += c;
    }
  }
  if (field !== '' || cur.length) {
    cur.push(field.replace(/\r$/, ''));
    rows.push(cur);
  }
  return rows.filter((r) => r.some((c) => c.trim() !== ''));
}

function looksLikeHeader(row: string[]): boolean {
  const j = row.join('|').toLowerCase();
  return j.includes('họ tên') || j.includes('ho ten') || j.includes('chức vụ') || j.includes('bhxh');
}

/** Read the HR source sheet via its public CSV export and upsert members.
 *  `selfId`: member đang bấm đồng bộ — không bao giờ bị ẩn (tránh tự khoá mình). */
export async function syncMembersFromSource(selfId?: string): Promise<SyncResult> {
  const id = process.env.SHEET_HR_SOURCE_ID;
  const gid = process.env.SHEET_HR_SOURCE_GID || '0';
  if (!id) throw new ApiError(400, 'SHEET_HR_SOURCE_ID chưa được cấu hình');

  const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
  const res = await fetch(url, { redirect: 'follow' });
  if (!res.ok) {
    throw new ApiError(
      502,
      `Không đọc được sheet nhân sự (HTTP ${res.status}). Hãy mở share sheet ở chế độ "Anyone with the link – Viewer", hoặc quản lý thành viên trong màn Quản trị.`,
    );
  }
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 300))) {
    throw new ApiError(502, 'Sheet nhân sự chưa share công khai — không tải được CSV.');
  }

  const rows = parseCsv(text);
  if (rows.length === 0) throw new ApiError(400, 'Sheet nhân sự trống');
  const start = looksLikeHeader(rows[0] ?? []) ? 1 : 0;
  const people: HrPerson[] = [];
  for (let i = start; i < rows.length; i++) {
    const p = parseHrRow(rows[i] ?? []);
    if (p) people.push(p);
  }
  return upsertHrPeople(people, {
    deactivateMissing: true,
    protectIds: selfId ? new Set([selfId]) : undefined,
  });
}

export interface CatalogSyncResult {
  updated: number;
  tabs: string[];
  /** Kết quả áp bảng điểm mới lên việc đã ghi — xem `applyCatalogPoints`. */
  points: PointSyncResult;
}

export interface PointSyncResult extends PointChangeSummary {
  /** Có lý do thì KHÔNG đụng gì vào dữ liệu — vd bảng điểm có mục 0đ (Sheet hỏng). */
  skipped?: string;
  /** Tháng đã khoá lương, được giữ nguyên. */
  lockedMonths: string[];
}

/**
 * Áp bảng điểm hiện tại lên những việc ĐÃ GHI.
 *
 * Điểm vốn được copy một lần vào từng việc lúc ghi, nên sửa bảng điểm chỉ ăn với việc
 * ghi từ đó về sau. Anh Tâm chốt 26/7/2026: sửa bảng điểm thì việc cũ phải đổi theo.
 *
 * CHỈ đụng tháng CHƯA khoá lương. Lưu ý `isMonthLocked` (payroll.service) chỉ bảo vệ
 * công/lương — bảng điểm luôn tính lại live từ `tasks.points`, nên phải tự chặn ở đây.
 */
export async function applyCatalogPoints(): Promise<PointSyncResult> {
  const locked = (await q('SELECT year, month FROM payroll_locks')).map(
    (r: { year: number; month: number }) => `${String(r.year).padStart(4, '0')}-${String(r.month).padStart(2, '0')}`,
  );
  const empty = { ...summarizePointChanges([]), lockedMonths: locked };

  // Chốt chặn: một ô sai trong Google Sheet là cả bảng điểm bay. Thà không làm gì.
  const bad = await q('SELECT task_code, task_name FROM task_catalog WHERE points IS NULL OR points <= 0 LIMIT 5');
  if (bad.length > 0) {
    const ten = bad.map((r: { task_name: string }) => r.task_name).join(', ');
    return { ...empty, skipped: `Bảng điểm có mục 0đ (${ten}) — không đổi điểm việc cũ. Kiểm tra lại Google Sheet.` };
  }

  // Tháng của việc: lấy theo ngày hoàn thành, chưa xong thì theo ngày tạo.
  // Việc leader giao chưa chọn loại (task_code rỗng) thì bỏ qua.
  const WHERE = `
    t.task_code <> '' AND t.points <> c.points
    AND substring(COALESCE(NULLIF(t.completed_at, ''), t.created_at), 1, 7) <> ALL($1::text[])`;

  const rows: PointChange[] = await q(
    `SELECT t.member_name AS "memberName", c.task_name AS "taskName", t.points AS cu, c.points AS moi
     FROM tasks t JOIN task_catalog c ON c.task_code = t.task_code
     WHERE ${WHERE}`,
    [locked],
  );
  if (rows.length === 0) return empty;

  await q(
    `UPDATE tasks t SET points = c.points
     FROM task_catalog c WHERE c.task_code = t.task_code AND ${WHERE}`,
    [locked],
  );
  return { ...summarizePointChanges(rows), lockedMonths: locked };
}

/**
 * Sync the task catalog from the points sheet (public CSV per tab).
 * Each row: STT | Tên việc | EXPERT | MID | BEGINNER | Ghi chú — points = EXPERT.
 * Tabs are configured as SHEET_TASKS_SOURCE_GIDS="gid:PREFIX,..." (e.g. "0:ADS,123:CON").
 * Codes = PREFIX + STT (2 digits) so re-syncs update in place.
 */
export async function syncCatalogFromSource(): Promise<CatalogSyncResult> {
  const id = process.env.SHEET_TASKS_SOURCE_ID;
  if (!id) throw new ApiError(400, 'SHEET_TASKS_SOURCE_ID chưa được cấu hình');
  const spec = process.env.SHEET_TASKS_SOURCE_GIDS || '0:ADS';

  const pairs = spec
    .split(',')
    .map((s) => s.trim())
    .filter(Boolean)
    .map((p) => {
      const [gid, prefix] = p.split(':');
      return { gid: (gid || '0').trim(), prefix: (prefix || 'TSK').trim().toUpperCase() };
    });

  let updated = 0;
  const tabs: string[] = [];
  for (const { gid, prefix } of pairs) {
    const url = `https://docs.google.com/spreadsheets/d/${id}/export?format=csv&gid=${gid}`;
    const res = await fetch(url, { redirect: 'follow' });
    if (!res.ok) {
      throw new ApiError(502, `Không đọc được tab gid=${gid} (HTTP ${res.status}) — sheet điểm cần share "Anyone with the link – Viewer".`);
    }
    const text = await res.text();
    if (/<html/i.test(text.slice(0, 300))) {
      throw new ApiError(502, `Tab gid=${gid}: sheet điểm chưa share công khai.`);
    }
    for (const r of parseCsv(text)) {
      const stt = Number(String(r[0] ?? '').trim());
      const name = String(r[1] ?? '').trim();
      const points = Number(String(r[2] ?? '').trim());
      // Header/empty rows have a non-numeric STT or EXPERT column — skip them.
      if (!Number.isFinite(stt) || stt <= 0 || !name || !Number.isFinite(points) || points <= 0) continue;
      await upsertCatalogItem({
        code: `${prefix}${String(stt).padStart(2, '0')}`,
        name,
        points,
        active: true,
        note: String(r[5] ?? '').trim(),
      });
      updated++;
    }
    tabs.push(`${prefix} (gid=${gid})`);
  }
  // Đặt trong hàm này (không phải trong route) để CLI `npm run sync-catalog` cũng được hưởng.
  return { updated, tabs, points: await applyCatalogPoints() };
}
