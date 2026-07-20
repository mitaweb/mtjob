// Kho tri thức ("bộ não thứ hai"): cắt nội dung thành đoạn, mã hoá vector, tìm theo ngữ nghĩa.
// Mọi thao tác nạp đều chạy nền và nuốt lỗi — KHÔNG được làm hỏng thao tác lưu dữ liệu gốc.
import {
  embedTexts,
  embeddingsAvailable,
  generateJson,
  generateContent,
  type GeminiPart,
} from '../gemini/client.js';
import { removeAccents } from '../lib/people.js';
import { parseSheetUrl, sheetCsvUrl, rowsToLabeledText } from '../lib/table.js';
import { parseCsv } from './admin.sync.js';
import {
  insertChunks,
  deleteBySource,
  searchChunks,
  pendingSources,
  countPending,
  isMissingTable,
  markProfileDirty,
  listDirtyProfiles,
  countDirtyProfiles,
  saveProfile,
  findProfiles,
  claimDocument,
  finishDocument,
  failDocument,
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
  // Có dữ liệu mới về khách → hẹn dựng lại hồ sơ 360°. Bỏ qua chính chunk hồ sơ để khỏi lặp vô hạn.
  if (input.customer && input.sourceType !== 'profile') markCustomerDirty(input.customer);
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
    if (isMissingTable(e)) return 'Kho tri thức chưa được khởi tạo (Quản trị → Cập nhật cấu trúc DB).';
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
  // KHÔNG nạp ghi chú công việc: là dữ liệu vận hành, không phải tri thức.
  // Trợ lý tra thẳng bảng tasks qua get_member_tasks/get_my_tasks; hồ sơ 360° cũng
  // đọc bảng tasks trực tiếp trong gatherCustomerData.
];

/** Nạp một lượt (~30 nguồn) dữ liệu cũ chưa có trong kho. */
export async function backfillPage(limit = 30): Promise<{ ingested: number; remaining: number }> {
  if (!(await embeddingsAvailable())) return { ingested: 0, remaining: 0 };
  let ingested = 0;
  try {
    for (const s of SOURCES) {
      if (ingested >= limit) break;
      const ids = await pendingSources(s.table, s.idCol, s.sourceType, s.where, limit - ingested);
      if (ids.length === 0) continue;
      for (const input of await s.load(ids)) {
        try {
          await ingest(input);
        } catch (e) {
          if (isMissingTable(e)) throw e; // chưa migrate → dừng cả lượt, không log rác từng mục
          console.warn('[brain] backfill lỗi', input.sourceType, input.sourceId, e);
        }
        ingested++;
      }
    }
    // Dựng lại hồ sơ khách có dữ liệu mới (sau khi các mảnh rời đã vào kho).
    await rebuildDirtyProfiles(5);
    return { ingested, remaining: await countRemaining() };
  } catch (e) {
    if (isMissingTable(e)) return { ingested: 0, remaining: 0 }; // chờ bấm Cập nhật cấu trúc DB
    throw e;
  }
}

export async function countRemaining(): Promise<number> {
  let n = 0;
  for (const s of SOURCES) n += await countPending(s.table, s.idCol, s.sourceType, s.where);
  return n + (await countDirtyProfiles());
}

// ── Hồ sơ 360° khách hàng ──
// Thông tin về 1 khách nằm rải rác ở 4 nguồn; tìm theo ngữ nghĩa chỉ lấy được vài mảnh gần
// câu hỏi nhất nên dễ sót. Hồ sơ là bản tổng hợp do AI viết từ TẤT CẢ nguồn của khách đó.

/** Chuẩn hoá tên khách làm khoá (không dấu, chữ thường, gọn khoảng trắng). */
export function customerKey(name: string): string {
  return removeAccents(String(name || '')).toLowerCase().replace(/\s+/g, ' ').trim();
}

/** Đánh dấu khách có dữ liệu mới — gọi ở mọi điểm ghi liên quan tới khách. */
export function markCustomerDirty(customer: string): void {
  const key = customerKey(customer);
  if (!key) return;
  runInBackground(
    markProfileDirty(key, customer.trim()).catch((e) => {
      if (!isMissingTable(e)) console.warn('[brain] đánh dấu hồ sơ:', e);
    }),
  );
}

/** Gom MỌI dữ liệu đang có về một khách hàng thành văn bản thô. */
async function gatherCustomerData(customer: string): Promise<string> {
  const like = `%${customer.trim()}%`;
  const [notes, crm, appts, tasks] = await Promise.all([
    q('SELECT content, updated_at, created_at FROM customer_notes WHERE customer ILIKE $1 ORDER BY updated_at DESC LIMIT 20', [like]),
    q('SELECT name, status, info, note, assigned_to FROM customers WHERE name ILIKE $1 LIMIT 5', [like]),
    q('SELECT at, note, done FROM appointments WHERE customer_name ILIKE $1 ORDER BY at DESC LIMIT 20', [like]),
    q("SELECT task_name, note, member_name, completed_at FROM tasks WHERE note ILIKE $1 AND status = 'done' ORDER BY completed_at DESC LIMIT 30", [like]),
  ]);

  const parts: string[] = [];
  if (crm.length) {
    parts.push(
      'HỒ SƠ CRM:\n' +
        crm.map((r) => [
          `Tên: ${r.name}`,
          r.status ? `Tình trạng: ${r.status}` : '',
          r.info ? `Thông tin: ${r.info}` : '',
          r.note ? `Ghi chú: ${r.note}` : '',
        ].filter(Boolean).join(' · ')).join('\n'),
    );
  }
  if (notes.length) {
    parts.push(
      'LƯU Ý KHÁCH HÀNG (mới nhất trước):\n' +
        notes.map((r) => `[${String(r.updated_at || r.created_at || '').slice(0, 10)}] ${htmlToText(r.content || '').slice(0, 1500)}`).join('\n---\n'),
    );
  }
  if (appts.length) {
    parts.push(
      'LỊCH HẸN:\n' +
        appts.map((r) => `[${String(r.at || '').slice(0, 16).replace('T', ' ')}]${r.done ? ' (đã xong)' : ''} ${r.note || ''}`).join('\n'),
    );
  }
  if (tasks.length) {
    parts.push(
      'CÔNG VIỆC ĐÃ LÀM:\n' +
        tasks.map((r) => `[${String(r.completed_at || '').slice(0, 10)}] ${r.member_name}: ${r.task_name} — ${r.note || ''}`).join('\n'),
    );
  }
  return parts.join('\n\n');
}

const PROFILE_SCHEMA = {
  type: 'OBJECT',
  properties: { summary: { type: 'STRING' } },
  required: ['summary'],
};

/** Dựng lại hồ sơ 1 khách: gom dữ liệu → AI tổng hợp → lưu + nạp vào kho để tìm được. */
export async function rebuildProfile(key: string, customer: string): Promise<boolean> {
  const raw = await gatherCustomerData(customer);
  const now = nowTz().toISOString();
  if (!raw.trim()) {
    // Không còn dữ liệu nào (khách đã xoá) → dọn hồ sơ cũ.
    await saveProfile(key, customer, '', now);
    await deleteBySource('profile', key);
    return false;
  }

  const prompt = [
    `Tổng hợp hồ sơ khách hàng "${customer}" cho một agency marketing, bằng tiếng Việt.`,
    'Viết NGẮN GỌN theo các mục (bỏ mục nào không có dữ liệu, KHÔNG bịa):',
    '- Tình trạng & người phụ trách',
    '- Nhu cầu / dịch vụ quan tâm / ngân sách',
    '- Diễn biến chính theo thời gian (ngày → sự việc)',
    '- Công việc đã làm cho khách',
    '- Điểm cần lưu ý / việc cần theo dõi tiếp',
    'Tối đa khoảng 250 từ. Giữ nguyên con số và ngày tháng có trong dữ liệu.',
    '',
    'DỮ LIỆU:',
    // Chặn độ dài đầu vào để không đội chi phí khi khách có quá nhiều ghi chú.
    raw.slice(0, 12000),
  ].join('\n');

  // Dùng Gemini Flash: đây là việc tóm tắt, không cần model mạnh — giữ chi phí thấp
  // kể cả khi trợ lý đang chạy model cao cấp.
  const r = await generateJson(prompt, PROFILE_SCHEMA, 'gemini-2.5-flash');
  const summary = String(r?.summary || '').trim();
  if (!summary) return false;

  await saveProfile(key, customer, summary, now);
  await ingest({
    sourceType: 'profile',
    sourceId: key,
    title: `Hồ sơ khách hàng: ${customer}`,
    text: summary,
    visibility: 'all',
    customer,
  });
  return true;
}

/** Dựng lại các hồ sơ đang chờ (gọi từ lượt quét tự động + job hằng ngày). */
export async function rebuildDirtyProfiles(limit = 3): Promise<number> {
  if (!(await embeddingsAvailable())) return 0;
  try {
    const dirty = await listDirtyProfiles(limit);
    let done = 0;
    for (const p of dirty) {
      try {
        if (await rebuildProfile(p.key, p.customer)) done++;
        else await saveProfile(p.key, p.customer, '', nowTz().toISOString()); // hết dirty, khỏi lặp lại
      } catch (e) {
        if (isMissingTable(e)) throw e;
        console.warn('[brain] dựng hồ sơ lỗi', p.customer, e);
        // Đánh dấu đã xử lý để 1 khách lỗi không chặn hàng đợi mãi.
        await saveProfile(p.key, p.customer, p.summary, nowTz().toISOString()).catch(() => undefined);
      }
    }
    return done;
  } catch (e) {
    if (isMissingTable(e)) return 0;
    throw e;
  }
}

/** Lấy hồ sơ theo tên gần đúng — cho tool của trợ lý. */
export async function customerProfileText(name: string): Promise<string> {
  const needle = customerKey(name);
  if (!needle) return 'Chưa cho biết tên khách hàng.';
  try {
    const hits = await findProfiles(needle, 3);
    if (hits.length === 0) {
      return `Chưa có hồ sơ tổng hợp cho "${name}". Thử dùng search_knowledge để tìm các ghi chú rời.`;
    }
    return hits
      .map((p) => `📋 HỒ SƠ: ${p.customer} (cập nhật ${p.builtAt.slice(0, 10)})\n${p.summary}`)
      .join('\n\n');
  } catch (e) {
    if (isMissingTable(e)) return 'Kho tri thức chưa được khởi tạo (Quản trị → Cập nhật cấu trúc DB).';
    throw e;
  }
}

// ── Nhập bảng từ Google Sheets ──

/**
 * Đọc một sheet công khai rồi nạp vào kho. Mỗi HÀNG thành một dòng tự chứa kèm tên cột
 * (xem lib/table.ts) nên cắt đoạn kiểu gì cũng không đứt quan hệ hàng–cột.
 * Sheet phải share "Anyone with the link – Viewer" — đây cũng là cách app đọc sheet nhân sự.
 */
export async function importGoogleSheet(input: {
  url: string;
  title?: string;
  customer?: string;
}): Promise<{ ok: boolean; message: string; rows?: number }> {
  const parsed = parseSheetUrl(input.url);
  if (!parsed) return { ok: false, message: 'Link không phải Google Sheets.' };
  if (!(await embeddingsAvailable())) return { ok: false, message: 'Kho tri thức cần API key Gemini.' };

  const res = await fetch(sheetCsvUrl(parsed.id, parsed.gid), { redirect: 'follow' });
  if (!res.ok) {
    return {
      ok: false,
      message: `Không đọc được sheet (lỗi ${res.status}). Mở sheet → Share → "Anyone with the link" → Viewer rồi thử lại.`,
    };
  }
  const text = await res.text();
  if (/<html/i.test(text.slice(0, 300))) {
    return { ok: false, message: 'Sheet chưa share công khai nên không tải được. Hãy share ở chế độ "Anyone with the link – Viewer".' };
  }

  const rows = parseCsv(text);
  const body = rowsToLabeledText(rows);
  if (!body.trim()) return { ok: false, message: 'Sheet không có dữ liệu.' };

  const title = (input.title || '').trim() || 'Bảng từ Google Sheets';
  // sourceId theo id+gid → nhập lại cùng sheet là CẬP NHẬT, không nhân bản.
  await ingest({
    sourceType: 'sheet',
    sourceId: `${parsed.id}-${parsed.gid}`,
    title,
    text: body,
    visibility: 'all',
    customer: (input.customer || '').trim(),
  });
  return { ok: true, message: `Đã nạp "${title}" vào kho tri thức.`, rows: Math.max(0, rows.length - 1) };
}

// ── Tài liệu tải lên: AI đọc rồi nạp nội dung vào kho ──

const DOC_TIMEOUT_MS = 50_000; // response đã trả rồi, waitUntil giữ hàm sống tới 60s
const MAX_DOC_BYTES = 10 * 1024 * 1024; // base64 nở 4/3, giữ dưới hạn 20MB của Gemini

/** Đọc tài liệu bằng Gemini (PDF/ảnh/text) → trích xuất nội dung + tóm tắt → nạp vào kho. */
export async function processDocument(docId: string): Promise<void> {
  const doc = await claimDocument(docId);
  if (!doc) return; // đang được xử lý ở nơi khác, hoặc đã xong

  try {
    if (!(await embeddingsAvailable())) throw new Error('Chưa cấu hình API key Gemini.');

    const res = await fetch(doc.url);
    if (!res.ok) throw new Error(`Không tải được tệp (${res.status}).`);
    const buf = Buffer.from(await res.arrayBuffer());
    if (buf.byteLength > MAX_DOC_BYTES) {
      throw new Error(`Tệp ${Math.round(buf.byteLength / 1024 / 1024)}MB, vượt giới hạn 10MB.`);
    }

    const prompt = [
      `Đây là tài liệu "${doc.name}"${doc.customer ? ` của khách hàng ${doc.customer}` : ''}.`,
      'Trích xuất TOÀN BỘ nội dung chữ có ý nghĩa (bảng thì ghi thành dòng, giữ nguyên số liệu),',
      'sau đó xuống dòng và viết "TÓM TẮT:" kèm 3-5 ý chính.',
      'Trả lời bằng tiếng Việt. KHÔNG bịa thêm thông tin không có trong tài liệu.',
    ].join('\n');

    // CSV (Excel xuất ra) xử lý riêng: mỗi hàng thành một dòng tự chứa kèm tên cột.
    // Nhờ vậy cắt đoạn không làm đứt quan hệ hàng–cột, và KHÔNG tốn lượt gọi AI.
    if (doc.mime === 'text/csv' || /\.csv$/i.test(doc.name)) {
      const body = rowsToLabeledText(parseCsv(buf.toString('utf8')));
      if (!body.trim()) throw new Error('Tệp CSV không có dữ liệu.');
      await ingest({
        sourceType: 'document',
        sourceId: doc.id,
        title: `Tài liệu: ${doc.name}`,
        text: body,
        visibility: 'all',
        customer: doc.customer,
      });
      await finishDocument(doc.id, body, nowTz().toISOString());
      return;
    }

    // text/* thì đọc thẳng, khỏi tốn token cho ảnh hoá.
    const parts: GeminiPart[] = doc.mime.startsWith('text/')
      ? [{ text: `${prompt}\n\nNỘI DUNG:\n${buf.toString('utf8').slice(0, 30000)}` }]
      : [{ inlineData: { mimeType: doc.mime, data: buf.toString('base64') } }, { text: prompt }];

    const out = await generateContent({
      contents: [{ role: 'user', parts }],
      model: 'gemini-2.5-flash', // đọc/trích xuất — không cần model cao cấp
      timeoutMs: DOC_TIMEOUT_MS,
    });
    const transcript = out.map((p) => p.text || '').join('').trim();
    if (!transcript) throw new Error('AI không đọc được nội dung tệp.');

    await ingest({
      sourceType: 'document',
      sourceId: doc.id,
      title: `Tài liệu: ${doc.name}`,
      text: transcript,
      visibility: 'all',
      customer: doc.customer,
    });
    await finishDocument(doc.id, transcript, nowTz().toISOString());
  } catch (e) {
    console.error('[brain] xử lý tài liệu', docId, e);
    await failDocument(docId, (e as Error).message).catch(() => undefined);
  }
}

/** Đăng ký tài liệu rồi xử lý nền — người dùng không phải chờ. */
export function processDocumentInBackground(docId: string): void {
  runInBackground(processDocument(docId));
}

// Tự kích hoạt nạp dần: gom thành lô lớn, quét thưa để đỡ tải máy chủ.
let lastSweep = 0;
let allDoneUntil = 0;
const SWEEP_EVERY_MS = 8 * 60_000; // ~8 phút/lượt
const SWEEP_BATCH = 60; // gom nhiều mục mỗi lượt thay vì nạp nhỏ giọt
const RECHECK_DONE_MS = 30 * 60_000;

/** Gọi sau mỗi request chat: kho tự đầy dần khi mọi người dùng app, không ai phải bấm nút. */
export function autoBackfill(): void {
  const now = Date.now();
  if (now < allDoneUntil || now - lastSweep < SWEEP_EVERY_MS) return;
  lastSweep = now;
  runInBackground(
    backfillPage(SWEEP_BATCH)
      .then((r) => {
        if (r.remaining === 0) allDoneUntil = Date.now() + RECHECK_DONE_MS;
        if (r.ingested > 0) console.log(`[brain] đã nạp ${r.ingested} mục, còn ${r.remaining}`);
      })
      .catch((e) => console.warn('[brain] auto backfill:', e)),
  );
}
