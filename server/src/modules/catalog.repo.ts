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

// Mã task có prefix theo team (ADS01, CON03, SEO12...) — dùng để LỌC: mỗi người chỉ thấy và ghi được việc team mình.
const TEAM_PREFIX: Record<string, string> = { Ads: 'ADS', Content: 'CON', SEO: 'SEO' };

export function teamPrefix(teamId: string): string {
  return TEAM_PREFIX[teamId] || '';
}

/**
 * Mã này người thuộc `teamId` có được dùng không.
 *
 * Anh Tâm 18/9/2026: "em setup để lọc theo team". Trước đây app chỉ XẾP việc của team mình
 * lên đầu, không lọc — nên team Content ghi 56 việc "Edit video" 135đ bằng mã ADS17 của tab
 * Ads (tháng 8–9/2026), trong khi team mình có sẵn "Video đăng facebook" 60đ.
 *
 * Chỉ chặn khi mã mang tiền tố của TEAM KHÁC. Mã không thuộc team nào (BOSUNG…) ai cũng
 * dùng được; người không có team (giám đốc, sale, kế toán) thì không có gì để lọc theo.
 */
export function maThuocTeam(code: string, teamId: string): boolean {
  const cuaToi = teamPrefix(teamId);
  if (!cuaToi) return true;
  const ma = String(code || '').trim().toUpperCase();
  if (ma.startsWith(cuaToi)) return true;
  return !Object.values(TEAM_PREFIX).some((p) => ma.startsWith(p));
}

/** Danh mục chỉ còn việc của team mình (+ mã dùng chung). Giữ nguyên thứ tự. */
export function locCatalogTheoTeam<T extends { code: string }>(items: T[], teamId: string): T[] {
  return items.filter((i) => maThuocTeam(i.code, teamId));
}

/** Câu từ chối khi ghi việc bằng mã của team khác; '' nếu được. Dùng ở mọi chốt tạo việc. */
export function chanMaKhacTeam(code: string, tenViec: string, teamId: string): string {
  if (maThuocTeam(code, teamId)) return '';
  return `"${tenViec}" là đầu việc của team khác nên team ${teamId} không ghi được. Chọn việc trong danh sách của team mình nhé.`;
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
