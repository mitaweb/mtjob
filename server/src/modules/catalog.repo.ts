import { q } from '../db/client.js';
import type { TaskCatalogItem } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToItem(r: any): TaskCatalogItem {
  return {
    code: (r.task_code || '').trim(),
    name: r.task_name || '',
    points: Number(r.points || 0) || 0,
    active: !!r.active,
    note: r.note || '',
  };
}

export async function getCatalog(): Promise<TaskCatalogItem[]> {
  const rows = await q('SELECT * FROM task_catalog ORDER BY task_code');
  return rows.map(rowToItem);
}

export async function getActiveCatalog(): Promise<TaskCatalogItem[]> {
  const rows = await q('SELECT * FROM task_catalog WHERE active = true ORDER BY task_code');
  return rows.map(rowToItem);
}

export async function findCatalogItem(code: string): Promise<TaskCatalogItem | undefined> {
  const rows = await q('SELECT * FROM task_catalog WHERE upper(task_code) = upper($1) LIMIT 1', [code.trim()]);
  return rows.length ? rowToItem(rows[0]) : undefined;
}

// Mã task có prefix theo team (ADS01, CON03, SEO12...) — dùng để ưu tiên task của team mình.
const TEAM_PREFIX: Record<string, string> = { Ads: 'ADS', Content: 'CON', SEO: 'SEO' };

export function teamPrefix(teamId: string): string {
  return TEAM_PREFIX[teamId] || '';
}

/** Sắp task của team thành viên lên đầu (ổn định trong từng nhóm). */
export function sortCatalogForTeam<T extends { code: string }>(items: T[], teamId: string): T[] {
  const p = teamPrefix(teamId);
  if (!p) return items;
  return [...items].sort((a, b) => Number(b.code.startsWith(p)) - Number(a.code.startsWith(p)));
}

/**
 * Tắt các đầu việc KHÔNG còn trong Google Sheet. Trả về tên các mục vừa tắt.
 *
 * Tắt chứ không xoá hẳn: bảng này dựng lại được từ Sheet, nhưng lỡ tay xoá một dòng trong
 * Sheet rồi đồng bộ thì mục đó biến mất không dấu vết. Tắt thì app không còn thấy nó nữa
 * (giống hệt xoá với người dùng), mà thêm lại dòng trong Sheet là nó sống lại nguyên vẹn.
 * Cùng cách đồng bộ nhân sự đang ẩn người đã nghỉ.
 *
 * `codes` RỖNG thì không làm gì — mảng rỗng sẽ khớp mọi dòng và tắt sạch bảng điểm.
 */
export async function deactivateCatalogExcept(codes: string[]): Promise<string[]> {
  if (codes.length === 0) return [];
  const rows = await q(
    `UPDATE task_catalog SET active = false
     WHERE active = true AND upper(task_code) <> ALL($1::text[])
     RETURNING task_name`,
    [codes.map((c) => c.trim().toUpperCase())],
  );
  return rows.map((r) => String(r.task_name || '').trim()).filter(Boolean);
}

export async function upsertCatalogItem(i: TaskCatalogItem): Promise<void> {
  await q(
    `INSERT INTO task_catalog (task_code, task_name, points, active, note)
     VALUES ($1,$2,$3,$4,$5)
     ON CONFLICT (task_code) DO UPDATE SET
       task_name = EXCLUDED.task_name, points = EXCLUDED.points,
       active = EXCLUDED.active, note = EXCLUDED.note`,
    [i.code.toUpperCase(), i.name, i.points, i.active, i.note || ''],
  );
}
