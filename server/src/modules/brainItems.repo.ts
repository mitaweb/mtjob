// Mục tri thức + câu hỏi chưa có lời giải ("bộ não thứ hai", anh Tâm 4/10/2026).
import { q } from '../db/client.js';

export interface BrainItem {
  id: string;
  title: string;
  body: string;
  summary: string;
  category: string;
  customerId: string;
  customer: string;
  teamId: string;
  tags: string[];
  scope: string; // 'all' | 'team:Ads' | 'director'
  status: 'published' | 'pending' | 'rejected' | 'archived';
  source: string;
  submittedBy: string;
  submittedName: string;
  approvedBy: string;
  aiReason: string;
  createdAt: string;
  updatedAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function rowToItem(r: any): BrainItem {
  const st = String(r.status || 'published');
  return {
    id: String(r.item_id || ''),
    title: String(r.title || ''),
    body: String(r.body || ''),
    summary: String(r.summary || ''),
    category: String(r.category || ''),
    customerId: String(r.customer_id || ''),
    customer: String(r.customer || ''),
    teamId: String(r.team_id || ''),
    tags: String(r.tags || '').split(',').map((s) => s.trim()).filter(Boolean),
    scope: String(r.scope || 'all'),
    status: (['published', 'pending', 'rejected', 'archived'].includes(st) ? st : 'published') as BrainItem['status'],
    source: String(r.source || ''),
    submittedBy: String(r.submitted_by || ''),
    submittedName: String(r.submitted_name || ''),
    approvedBy: String(r.approved_by || ''),
    aiReason: String(r.ai_reason || ''),
    createdAt: String(r.created_at || ''),
    updatedAt: String(r.updated_at || ''),
  };
}

export const SQL_GHI_MUC = `INSERT INTO brain_items
  (item_id, title, body, summary, category, customer_id, customer, team_id, tags, search_text, scope, status,
   source, submitted_by, submitted_name, approved_by, ai_reason, created_at, updated_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,$16,$17,$18,$19)
  ON CONFLICT (item_id) DO UPDATE SET
    title = EXCLUDED.title, body = EXCLUDED.body, summary = EXCLUDED.summary, category = EXCLUDED.category,
    customer_id = EXCLUDED.customer_id, customer = EXCLUDED.customer, team_id = EXCLUDED.team_id,
    tags = EXCLUDED.tags, search_text = EXCLUDED.search_text, scope = EXCLUDED.scope, status = EXCLUDED.status,
    approved_by = EXCLUDED.approved_by, ai_reason = EXCLUDED.ai_reason, updated_at = EXCLUDED.updated_at`;

/** Chuỗi để tìm bằng chữ: bỏ dấu, chữ thường — người gõ "mau thuong hieu" vẫn ra "Màu thương hiệu". */
export function chuoiTim(i: Pick<BrainItem, 'title' | 'summary' | 'tags' | 'customer'>): string {
  return [i.title, i.summary, i.tags.join(' '), i.customer]
    .join(' ')
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/đ/gi, 'd')
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim();
}

export async function upsertItem(i: BrainItem): Promise<void> {
  await q(SQL_GHI_MUC, [
    i.id, i.title, i.body, i.summary, i.category, i.customerId, i.customer, i.teamId,
    i.tags.join(','), chuoiTim(i), i.scope, i.status, i.source, i.submittedBy, i.submittedName,
    i.approvedBy, i.aiReason, i.createdAt, i.updatedAt,
  ]);
}

export async function findItem(id: string): Promise<BrainItem | undefined> {
  const r = await q('SELECT * FROM brain_items WHERE item_id = $1 LIMIT 1', [id]);
  return r.length ? rowToItem(r[0]) : undefined;
}

export async function itemsByIds(ids: string[]): Promise<BrainItem[]> {
  if (ids.length === 0) return [];
  return (await q('SELECT * FROM brain_items WHERE item_id = ANY($1)', [ids])).map(rowToItem);
}

/** Quyền xem MỤC (không phải đoạn): giám đốc thấy hết; người khác thấy 'all' + phòng mình. */
export interface ItemScope {
  directorScope: boolean;
  teamId?: string;
}

function dieuKienPhamVi(s: ItemScope, params: unknown[]): string {
  if (s.directorScope) return '';
  params.push(s.teamId ? `team:${s.teamId}` : '');
  return ` AND scope IN ('all', $${params.length})`;
}

export interface ListItemsOpts extends ItemScope {
  status?: string;
  category?: string;
  customerId?: string;
  /** Từ khoá đã bỏ dấu (khớp search_text). */
  keyword?: string;
  /** Chỉ mục do người này gửi — mọi trạng thái (để xem "đóng góp của tôi"). */
  submittedBy?: string;
  limit?: number;
}

export function sqlListItems(o: ListItemsOpts): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  let where = 'TRUE';
  if (o.submittedBy) {
    params.push(o.submittedBy);
    where += ` AND submitted_by = $${params.length}`;
  } else {
    params.push(o.status || 'published');
    where += ` AND status = $${params.length}`;
    where += dieuKienPhamVi(o, params);
  }
  if (o.category) {
    params.push(o.category);
    where += ` AND category = $${params.length}`;
  }
  if (o.customerId) {
    params.push(o.customerId);
    where += ` AND customer_id = $${params.length}`;
  }
  if (o.keyword) {
    params.push(o.keyword);
    where += ` AND (search_text LIKE '%' || $${params.length} || '%' OR lower(body) LIKE '%' || lower($${params.length}) || '%')`;
  }
  params.push(Math.min(Math.max(o.limit ?? 100, 1), 300));
  return {
    sql: `SELECT * FROM brain_items WHERE ${where} ORDER BY updated_at DESC LIMIT $${params.length}`,
    params,
  };
}

export async function listItems(o: ListItemsOpts): Promise<BrainItem[]> {
  const { sql, params } = sqlListItems(o);
  return (await q(sql, params)).map(rowToItem);
}

/** Số mục đã ban hành theo nhóm (trong phạm vi người xem). */
export async function countByCategory(s: ItemScope): Promise<Record<string, number>> {
  const params: unknown[] = [];
  const rows = await q(
    `SELECT category, COUNT(*)::int AS n FROM brain_items WHERE status = 'published'${dieuKienPhamVi(s, params)} GROUP BY category`,
    params,
  );
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.category || '')] = Number(r.n) || 0;
  return out;
}

/** Số mục theo trạng thái — cho huy hiệu "chờ duyệt" của giám đốc. */
export async function countByStatus(): Promise<Record<string, number>> {
  const rows = await q('SELECT status, COUNT(*)::int AS n FROM brain_items GROUP BY status');
  const out: Record<string, number> = {};
  for (const r of rows) out[String(r.status || '')] = Number(r.n) || 0;
  return out;
}

/**
 * Tìm bằng CHỮ trên mục đã ban hành: đếm bao nhiêu từ khoá khớp `search_text`.
 * Bù cho tìm ngữ nghĩa ở những câu ngắn/tên riêng ("CON05", "Savax") mà vector hay trượt.
 */
export function sqlKeywordItems(
  words: string[],
  s: ItemScope & { category?: string; customerId?: string },
  limit: number,
): { sql: string; params: unknown[] } {
  const params: unknown[] = [];
  const hit = words
    .map((w) => {
      params.push(w);
      return `(CASE WHEN search_text LIKE '%' || $${params.length} || '%' THEN 1 ELSE 0 END)`;
    })
    .join(' + ');
  let where = "status = 'published'";
  where += dieuKienPhamVi(s, params);
  if (s.category) {
    params.push(s.category);
    where += ` AND category = $${params.length}`;
  }
  if (s.customerId) {
    params.push(s.customerId);
    where += ` AND customer_id = $${params.length}`;
  }
  params.push(limit);
  return {
    sql: `SELECT * FROM (SELECT *, (${hit || '0'}) AS hits FROM brain_items WHERE ${where}) x
          WHERE hits > 0 ORDER BY hits DESC, updated_at DESC LIMIT $${params.length}`,
    params,
  };
}

export async function keywordItems(
  words: string[],
  s: ItemScope & { category?: string; customerId?: string },
  limit = 5,
): Promise<Array<BrainItem & { hits: number }>> {
  if (words.length === 0) return [];
  const { sql, params } = sqlKeywordItems(words, s, limit);
  return (await q(sql, params)).map((r) => ({ ...rowToItem(r), hits: Number(r.hits) || 0 }));
}

// ── Câu hỏi chưa có lời giải ──

export interface BrainQuestion {
  id: string;
  question: string;
  askedBy: string;
  askedName: string;
  teamId: string;
  askers: string[];
  times: number;
  status: 'open' | 'answered' | 'dismissed';
  answerItemId: string;
  createdAt: string;
  answeredAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToQuestion(r: any): BrainQuestion {
  const st = String(r.status || 'open');
  return {
    id: String(r.question_id || ''),
    question: String(r.question || ''),
    askedBy: String(r.asked_by || ''),
    askedName: String(r.asked_name || ''),
    teamId: String(r.team_id || ''),
    askers: String(r.askers || '').split(',').map((s) => s.trim()).filter(Boolean),
    times: Number(r.times) || 1,
    status: (['open', 'answered', 'dismissed'].includes(st) ? st : 'open') as BrainQuestion['status'],
    answerItemId: String(r.answer_item_id || ''),
    createdAt: String(r.created_at || ''),
    answeredAt: String(r.answered_at || ''),
  };
}

export const SQL_GHI_CAU_HOI = `INSERT INTO brain_questions
  (question_id, question, asked_by, asked_name, team_id, askers, times, status, answer_item_id, created_at, answered_at)
  VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
  ON CONFLICT (question_id) DO UPDATE SET
    askers = EXCLUDED.askers, times = EXCLUDED.times, status = EXCLUDED.status,
    answer_item_id = EXCLUDED.answer_item_id, answered_at = EXCLUDED.answered_at`;

export async function upsertQuestion(x: BrainQuestion): Promise<void> {
  await q(SQL_GHI_CAU_HOI, [
    x.id, x.question, x.askedBy, x.askedName, x.teamId, x.askers.join(','), x.times, x.status,
    x.answerItemId, x.createdAt, x.answeredAt,
  ]);
}

export async function listQuestions(status = 'open', limit = 100): Promise<BrainQuestion[]> {
  const rows = await q(
    `SELECT * FROM brain_questions WHERE status = $1 ORDER BY times DESC, created_at DESC LIMIT $2`,
    [status, limit],
  );
  return rows.map(rowToQuestion);
}

export async function findQuestion(id: string): Promise<BrainQuestion | undefined> {
  const r = await q('SELECT * FROM brain_questions WHERE question_id = $1 LIMIT 1', [id]);
  return r.length ? rowToQuestion(r[0]) : undefined;
}

export async function countOpenQuestions(): Promise<number> {
  const r = await q("SELECT COUNT(*)::int AS n FROM brain_questions WHERE status = 'open'");
  return Number(r[0]?.n) || 0;
}
