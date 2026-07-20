// Kho tri thức ("bộ não thứ hai"): cắt nội dung thành đoạn, mã hoá vector, tìm theo ngữ nghĩa.
// Mọi thao tác nạp đều chạy nền và nuốt lỗi — KHÔNG được làm hỏng thao tác lưu dữ liệu gốc.
import { embedTexts, embeddingsAvailable } from '../gemini/client.js';
import {
  insertChunks,
  deleteBySource,
  searchChunks,
  pendingSources,
  countPending,
  type NewChunk,
  type BrainHit,
} from './brain.repo.js';
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { runInBackground } from '../util/background.js';
import { nowTz } from '../lib/datetime.js';

const CHUNK_SIZE = 1000;
const CHUNK_OVERLAP = 150;
const MIN_CHUNK = 20;

export { embeddingsAvailable as brainAvailable };

/** Bỏ thẻ HTML (nội dung lưu ý KH là rich text) → văn bản thuần. */
export function htmlToText(html: string): string {
  return String(html || '')
    .replace(/<(script|style)[\s\S]*?<\/\1>/gi, ' ')
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/(p|div|li|h[1-6])>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/[ \t]+/g, ' ')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

/** Cắt văn bản dài thành đoạn ~1000 ký tự, ưu tiên cắt ở cuối câu/đoạn, có gối đầu. */
export function chunkText(text: string): string[] {
  const clean = String(text || '').trim();
  if (!clean) return [];
  if (clean.length <= CHUNK_SIZE) return [clean];

  const out: string[] = [];
  let start = 0;
  while (start < clean.length) {
    let end = Math.min(start + CHUNK_SIZE, clean.length);
    if (end < clean.length) {
      // Lùi về ranh giới câu/đoạn gần nhất trong 200 ký tự cuối để đoạn không bị cắt ngang.
      const window = clean.slice(end - 200, end);
      const m = window.lastIndexOf('\n') >= 0 ? window.lastIndexOf('\n') : window.lastIndexOf('. ');
      if (m > 0) end = end - 200 + m + 1;
    }
    const piece = clean.slice(start, end).trim();
    if (piece.length >= MIN_CHUNK) out.push(piece);
    if (end >= clean.length) break;
    start = Math.max(end - CHUNK_OVERLAP, start + 1);
  }
  return out;
}

export interface IngestInput {
  sourceType: string;
  sourceId: string;
  title: string;
  text: string;
  visibility: string; // 'all' | 'director' | <member_id>
  customer?: string;
}

/**
 * Nạp một nguồn vào kho: xoá đoạn cũ rồi ghi đoạn mới (nên sửa nội dung = gọi lại hàm này).
 * Mỗi đoạn được gắn 1 dòng ngữ cảnh ở đầu để khi tìm ra vẫn biết nó thuộc về đâu.
 */
export async function ingest(input: IngestInput): Promise<number> {
  if (!(await embeddingsAvailable())) return 0;
  const body = String(input.text || '').trim();
  await deleteBySource(input.sourceType, input.sourceId);
  if (!body) return 0;

  const now = nowTz().toISOString();
  const header = `[${input.title}${input.customer ? ` — KH: ${input.customer}` : ''} — ${now.slice(0, 10)}]`;
  const pieces = chunkText(body).map((p) => `${header}\n${p}`);
  if (pieces.length === 0) return 0;

  const vectors = await embedTexts(pieces, 'RETRIEVAL_DOCUMENT');
  const rows: NewChunk[] = pieces.map((content, i) => ({
    id: newId('K-'),
    sourceType: input.sourceType,
    sourceId: input.sourceId,
    title: input.title,
    content,
    embedding: vectors[i]!,
    visibility: input.visibility,
    customer: input.customer || '',
    createdAt: now,
  }));
  await insertChunks(rows);
  return rows.length;
}

export async function removeSource(sourceType: string, sourceId: string): Promise<void> {
  await deleteBySource(sourceType, sourceId).catch((e) => console.warn('[brain] xoá nguồn:', e));
}

/** Nạp chạy nền — dùng ở các điểm ghi dữ liệu để không làm chậm response. */
export function ingestInBackground(input: IngestInput): void {
  runInBackground(
    ingest(input).catch((e) => console.warn('[brain] nạp thất bại', input.sourceType, input.sourceId, e)),
  );
}

/** Tìm trong kho, trả về đoạn văn bản gọn cho AI đọc. */
export async function searchKnowledgeText(
  query: string,
  opts: { directorScope: boolean; memberId?: string; customer?: string },
): Promise<string> {
  if (!(await embeddingsAvailable())) return 'Kho tri thức chưa được bật.';
  const text = String(query || '').trim();
  if (!text) return 'Chưa có từ khoá tìm kiếm.';

  let hits: BrainHit[];
  try {
    const [vec] = await embedTexts([text], 'RETRIEVAL_QUERY');
    if (!vec) return 'Không tìm được trong kho tri thức lúc này.';
    hits = await searchChunks(vec, { ...opts, limit: 8 });
  } catch (e) {
    console.warn('[brain] tìm kiếm lỗi:', e);
    return 'Không tìm được trong kho tri thức lúc này.';
  }
  if (hits.length === 0) return 'Không tìm thấy gì liên quan trong kho tri thức.';

  const SOURCE_VI: Record<string, string> = {
    customer_note: 'Lưu ý KH',
    customer: 'Hồ sơ KH',
    appointment: 'Lịch hẹn',
    task: 'Ghi chú việc',
    chat: 'Hội thoại cũ',
    document: 'Tài liệu',
  };
  // Giới hạn tổng độ dài: đây là chỗ tốn token nhất trong mỗi lượt hỏi.
  const MAX_CHARS = 4000;
  const parts: string[] = [];
  let total = 0;
  for (const h of hits) {
    const block = `— ${SOURCE_VI[h.sourceType] || h.sourceType}${h.customer ? ` · ${h.customer}` : ''} · ${h.createdAt.slice(0, 10)} (độ khớp ${h.score.toFixed(2)}):\n${h.content}`;
    if (total + block.length > MAX_CHARS) break;
    parts.push(block);
    total += block.length;
  }
  return parts.join('\n\n');
}

// ── Nạp dữ liệu cũ, tự động, không cần bấm nút ──

interface SourceSpec {
  sourceType: string;
  table: string;
  idCol: string;
  where: string;
  load: (ids: string[]) => Promise<IngestInput[]>;
}

const SOURCES: SourceSpec[] = [
  {
    sourceType: 'customer_note',
    table: 'customer_notes',
    idCol: 'note_id',
    where: "COALESCE(t.content, '') <> ''",
    load: async (ids) => {
      const rows = await q(
        'SELECT note_id, customer, content FROM customer_notes WHERE note_id = ANY($1)',
        [ids],
      );
      return rows.map((r) => ({
        sourceType: 'customer_note',
        sourceId: r.note_id,
        title: `Lưu ý khách hàng${r.customer ? `: ${r.customer}` : ''}`,
        text: htmlToText(r.content || ''),
        visibility: 'all',
        customer: r.customer || '',
      }));
    },
  },
  {
    sourceType: 'customer',
    table: 'customers',
    idCol: 'customer_id',
    where: '1 = 1',
    load: async (ids) => {
      const rows = await q(
        'SELECT customer_id, name, status, note, info FROM customers WHERE customer_id = ANY($1)',
        [ids],
      );
      // KHÔNG đưa số điện thoại vào kho (nhân viên tra được kho; SĐT chỉ giám đốc xem).
      return rows.map((r) => ({
        sourceType: 'customer',
        sourceId: r.customer_id,
        title: `Hồ sơ khách hàng: ${r.name || ''}`,
        text: [
          `Khách hàng: ${r.name || ''}`,
          r.status ? `Tình trạng: ${r.status}` : '',
          r.info ? `Thông tin: ${r.info}` : '',
          r.note ? `Ghi chú: ${r.note}` : '',
        ].filter(Boolean).join('\n'),
        visibility: 'all',
        customer: r.name || '',
      }));
    },
  },
  {
    sourceType: 'appointment',
    table: 'appointments',
    idCol: 'appt_id',
    where: "COALESCE(t.note, '') <> ''",
    load: async (ids) => {
      const rows = await q(
        'SELECT appt_id, customer_name, at, note FROM appointments WHERE appt_id = ANY($1)',
        [ids],
      );
      return rows.map((r) => ({
        sourceType: 'appointment',
        sourceId: r.appt_id,
        title: `Lịch hẹn: ${r.customer_name || ''}`,
        text: `Hẹn ${r.customer_name || ''} lúc ${String(r.at || '').slice(0, 16).replace('T', ' ')}: ${r.note || ''}`,
        visibility: 'all',
        customer: r.customer_name || '',
      }));
    },
  },
  {
    sourceType: 'task',
    table: 'tasks',
    idCol: 'task_id',
    where: "COALESCE(t.note, '') <> '' AND t.status = 'done'",
    load: async (ids) => {
      const rows = await q(
        'SELECT task_id, member_name, task_name, note, completed_at, created_at FROM tasks WHERE task_id = ANY($1)',
        [ids],
      );
      return rows.map((r) => ({
        sourceType: 'task',
        sourceId: r.task_id,
        title: `Việc: ${r.task_name || ''}`,
        text: `${String(r.completed_at || r.created_at || '').slice(0, 10)} ${r.member_name || ''} hoàn thành "${r.task_name || ''}": ${r.note || ''}`,
        visibility: 'all',
      }));
    },
  },
];

/** Nạp một lượt (~30 nguồn) dữ liệu cũ chưa có trong kho. */
export async function backfillPage(limit = 30): Promise<{ ingested: number; remaining: number }> {
  if (!(await embeddingsAvailable())) return { ingested: 0, remaining: 0 };
  let ingested = 0;
  for (const s of SOURCES) {
    if (ingested >= limit) break;
    const ids = await pendingSources(s.table, s.idCol, s.sourceType, s.where, limit - ingested);
    if (ids.length === 0) continue;
    for (const input of await s.load(ids)) {
      try {
        await ingest(input);
      } catch (e) {
        console.warn('[brain] backfill lỗi', input.sourceType, input.sourceId, e);
      }
      ingested++;
    }
  }
  return { ingested, remaining: await countRemaining() };
}

export async function countRemaining(): Promise<number> {
  let n = 0;
  for (const s of SOURCES) n += await countPending(s.table, s.idCol, s.sourceType, s.where);
  return n;
}

// Tự kích hoạt nạp dần: throttle theo instance để không quét liên tục.
let lastSweep = 0;
let allDoneUntil = 0;
const SWEEP_EVERY_MS = 2 * 60_000;
const RECHECK_DONE_MS = 30 * 60_000;

/** Gọi sau mỗi request chat: kho tự đầy dần khi mọi người dùng app, không ai phải bấm nút. */
export function autoBackfill(): void {
  const now = Date.now();
  if (now < allDoneUntil || now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  runInBackground(
    backfillPage()
      .then((r) => {
        if (r.remaining === 0) allDoneUntil = Date.now() + RECHECK_DONE_MS;
        if (r.ingested > 0) console.log(`[brain] đã nạp ${r.ingested} mục, còn ${r.remaining}`);
      })
      .catch((e) => console.warn('[brain] auto backfill:', e)),
  );
}
