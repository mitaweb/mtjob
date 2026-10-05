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
  saveChatTranscript,
  findDocument,
  type BrainDocument,
  type NewChunk,
  type BrainHit,
} from './brain.repo.js';
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { runInBackground } from '../util/background.js';
import { getConfig } from '../config.js';
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
  visibility: string; // 'all' | 'director' | 'team:Ads' | <member_id>
  customer?: string;
  /** Nhãn của mục tri thức (brainItems.service) — đi theo từng đoạn để tra theo nhóm/khách. */
  category?: string;
  customerId?: string;
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
    category: input.category || '',
    customerId: input.customerId || '',
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

// ── Nạp dữ liệu cũ, tự động, không cần bấm nút ──

interface SourceSpec {
  sourceType: string;
  table: string;
  idCol: string;
  where: string;
  load: (ids: string[]) => Promise<IngestInput[]>;
}

const SOURCES: SourceSpec[] = [
  // Lưu ý KH KHÔNG còn nạp ở đây: anh Tâm 4/10/2026 gộp hẳn vào kho thành mục nhóm Khách hàng
  // (brainItems.service.chuyenLuuYKhach) — nạp thêm ở đây là trợ lý đọc một ghi chú hai lần.
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
        // Lịch trình là chuyện riêng của giám đốc (anh Tâm 4/10/2026) — nhân viên không tra được.
        visibility: 'director',
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

/**
 * Gom MỌI dữ liệu đang có về một khách hàng thành văn bản thô.
 *
 * CỐ Ý không đọc bảng `tasks`: anh Tâm chốt 25/7/2026 bỏ mục "công việc đã làm" khỏi
 * hồ sơ khách. Ghi chú việc là dữ liệu vận hành để soi giờ làm, không phải tri thức
 * về khách — và nó từng kéo cả những chuỗi rác kiểu "bắt đầu tối ưu quảng cáo" vào đây.
 */
async function gatherCustomerData(customer: string): Promise<string> {
  const like = `%${customer.trim()}%`;
  const [notes, crm, appts] = await Promise.all([
    // Tri thức về khách nay là mục nhóm Khách hàng; Lưu ý KH cũ chưa chuyển thì vẫn đọc.
    q(
      `SELECT body AS content, updated_at, created_at FROM brain_items
        WHERE status = 'published' AND category = 'khach_hang' AND customer ILIKE $1
       UNION ALL
       SELECT content, updated_at, created_at FROM customer_notes c
        WHERE customer ILIKE $1 AND NOT EXISTS (SELECT 1 FROM brain_items b WHERE b.item_id = 'CN-' || c.note_id)
       ORDER BY updated_at DESC LIMIT 20`,
      [like],
    ).catch(() => q('SELECT content, updated_at, created_at FROM customer_notes WHERE customer ILIKE $1 ORDER BY updated_at DESC LIMIT 20', [like])),
    q('SELECT name, status, info, note, assigned_to FROM customers WHERE name ILIKE $1 LIMIT 5', [like]),
    q('SELECT at, note, done FROM appointments WHERE customer_name ILIKE $1 ORDER BY at DESC LIMIT 20', [like]),
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

// ── Tự động ghi tri thức từ hội thoại ──
//
// Trước đây từng nhồi MỌI cặp hỏi-đáp vào kho → nhiễu nặng, phải bỏ.
// Giờ lọc hai tầng: chặn rẻ bằng luật, rồi mới nhờ AI phán đoán (chạy nền, không làm chậm chat).

const AUTO_MIN_ANSWER = 300; // câu trả lời ngắn thường là tra số liệu, không phải tri thức
const AUTO_MIN_QUESTION = 15;

const CAPTURE_SCHEMA = {
  type: 'OBJECT',
  properties: {
    worth: { type: 'BOOLEAN' },
    title: { type: 'STRING' },
    customer: { type: 'STRING' },
  },
  required: ['worth'],
};

/**
 * Xét xem một lượt hỏi-đáp có chứa tri thức đáng nhớ lâu dài không; có thì tự lưu vào kho.
 * Chạy NỀN sau khi đã trả lời người dùng nên không ảnh hưởng tốc độ chat.
 */
export async function autoCaptureKnowledge(
  question: string,
  answer: string,
  nguoi: { id: string; name: string; role: string; teamId: string } = { id: '', name: '', role: '', teamId: '' },
): Promise<boolean> {
  const q = (question || '').trim();
  const a = (answer || '').trim();
  // Tầng 1 — luật rẻ tiền, loại phần lớn trước khi tốn một lượt gọi AI.
  if (q.length < AUTO_MIN_QUESTION || a.length < AUTO_MIN_ANSWER) return false;
  if (!(await embeddingsAvailable())) return false;
  // Công tắc trong Quản trị — tắt được ngay mà không cần deploy lại.
  try {
    if ((await getConfig()).brainAutoCapture === 'off') return false;
  } catch {
    // DB chưa sẵn sàng → cứ chạy như mặc định.
  }

  const prompt = [
    'Xét đoạn hội thoại giữa nhân sự agency marketing và trợ lý AI.',
    'Nó có chứa TRI THỨC đáng lưu lâu dài để lần sau khỏi hỏi lại không?',
    '',
    'ĐÁNG lưu: quy trình/cách làm, quyết định đã chốt, định hướng nội dung, kinh nghiệm xử lý',
    'tình huống với khách, thông tin bền vững về một khách hàng, bảng giá/chính sách.',
    '',
    'KHÔNG đáng lưu: tra cứu số liệu tại thời điểm (ai chưa chấm công, điểm tháng này, còn bao nhiêu đơn),',
    'chào hỏi, câu trả lời chung chung ai cũng biết, hoặc trợ lý báo lỗi/không tra được dữ liệu.',
    '',
    'Trả JSON: worth (true/false), title (tiêu đề ngắn gọn nếu đáng lưu),',
    'customer (tên khách hàng nếu nội dung nói về một khách cụ thể, không thì để rỗng).',
    '',
    `HỎI: ${q.slice(0, 1000)}`,
    `ĐÁP: ${a.slice(0, 4000)}`,
  ].join('\n');

  try {
    // Tầng 2 — Gemini Flash phán đoán: việc phân loại đơn giản, giữ chi phí thấp.
    const r = await generateJson(prompt, CAPTURE_SCHEMA, 'gemini-2.5-flash');
    if (!r?.worth) return false;
    const title = String(r.title || '').trim() || q.slice(0, 120);
    // Qua bộ phân loại như mọi đường khác. Nguồn 'auto' KHÔNG BAO GIỜ tự mở cho cả công ty
    // (lib/brainGate.xepTrangThai): việc công việc vào hàng chờ, chuyện riêng giữ riêng giám đốc.
    const { xetDuaVaoKho } = await import('./brainItems.service.js');
    const kq = await xetDuaVaoKho(
      { title, body: `Hỏi: ${q}\n\n${a}`, customer: String(r.customer || '').trim(), source: 'auto' },
      nguoi,
    );
    return !!kq.item;
  } catch (e) {
    console.warn('[brain] tự ghi tri thức:', e);
    return false;
  }
}

// ── Nhập bảng từ Google Sheets ──

/**
 * Đọc một sheet công khai rồi nạp vào kho. Mỗi HÀNG thành một dòng tự chứa kèm tên cột
 * (xem lib/table.ts) nên cắt đoạn kiểu gì cũng không đứt quan hệ hàng–cột.
 * Sheet phải share "Anyone with the link – Viewer" — đây cũng là cách app đọc sheet nhân sự.
 */
export async function importGoogleSheet(
  input: {
    url: string;
    title?: string;
    customer?: string;
  },
  nguoi: { id: string; name: string; role: string; teamId: string } = { id: '', name: '', role: '', teamId: '' },
): Promise<{ ok: boolean; message: string; rows?: number }> {
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
  // Mã mục theo id+gid → nhập lại cùng sheet là CẬP NHẬT, không nhân bản. Qua bộ phân loại để
  // gắn nhãn và chặn bảng không nên vào kho (bảng lương, số liệu sống…).
  const { xetDuaVaoKho } = await import('./brainItems.service.js');
  const kq = await xetDuaVaoKho(
    { title, body, customer: (input.customer || '').trim(), source: 'sheet', itemId: `SH-${parsed.id}-${parsed.gid}` },
    nguoi,
  );
  return { ok: !!kq.item && kq.item.status !== 'rejected', message: kq.message, rows: Math.max(0, rows.length - 1) };
}

// ── Tài liệu tải lên: AI đọc rồi nạp nội dung vào kho ──

const DOC_TIMEOUT_MS = 50_000; // response đã trả rồi, waitUntil giữ hàm sống tới 60s
const MAX_DOC_BYTES = 10 * 1024 * 1024; // base64 nở 4/3, giữ dưới hạn 20MB của Gemini

/**
 * ĐỌC nội dung một tệp (PDF/ảnh/text/CSV) thành chữ. Dùng chung cho tài liệu tải lên kho và
 * tệp đính kèm trong khung chat. Ném lỗi có câu tiếng Việt để hiện thẳng cho người dùng.
 */
export async function docNoiDung(doc: Pick<BrainDocument, 'url' | 'name' | 'mime' | 'customer'>): Promise<string> {
  const res = await fetch(doc.url);
  if (!res.ok) throw new Error(`Không tải được tệp (${res.status}).`);
  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.byteLength > MAX_DOC_BYTES) {
    throw new Error(`Tệp ${Math.round(buf.byteLength / 1024 / 1024)}MB, vượt giới hạn 10MB.`);
  }

  // CSV (Excel xuất ra) xử lý riêng: mỗi hàng thành một dòng tự chứa kèm tên cột.
  // Nhờ vậy cắt đoạn không làm đứt quan hệ hàng–cột, và KHÔNG tốn lượt gọi AI.
  if (doc.mime === 'text/csv' || /\.csv$/i.test(doc.name)) {
    const body = rowsToLabeledText(parseCsv(buf.toString('utf8')));
    if (!body.trim()) throw new Error('Tệp CSV không có dữ liệu.');
    return body;
  }

  const prompt = [
    `Đây là tệp "${doc.name}"${doc.customer ? ` của khách hàng ${doc.customer}` : ''}.`,
    'Trích xuất TOÀN BỘ nội dung chữ có ý nghĩa (bảng thì ghi thành dòng, giữ nguyên số liệu).',
    'Nếu là ẢNH: ghi lại mọi chữ trong ảnh; ảnh chụp đoạn chat thì ghi theo dạng "Người gửi: nội dung"',
    'theo đúng thứ tự; ảnh thiết kế/hình thì mô tả ngắn bố cục, màu sắc, nội dung chính.',
    'Sau đó xuống dòng và viết "TÓM TẮT:" kèm 3-5 ý chính.',
    'Trả lời bằng tiếng Việt. KHÔNG bịa thêm thông tin không có trong tệp.',
  ].join('\n');

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
  return transcript;
}

/**
 * Tệp đính kèm trong khung chat (anh Tâm 5/10/2026: "khung chat cho phép dán file, đính kèm
 * file vào để hỏi"): đọc ngay để trợ lý trả lời được, lưu nội dung lại cho câu hỏi nối tiếp.
 * CHƯA đưa vào kho — người dùng bấm "Đưa vào kho" thì mới qua bộ phân loại (duaTepVaoKho).
 */
export async function docTepChat(docId: string): Promise<{ ok: boolean; chars: number; error?: string }> {
  const doc = await findDocument(docId);
  if (!doc) return { ok: false, chars: 0, error: 'Không tìm thấy tệp.' };
  try {
    const transcript = await docNoiDung(doc);
    await saveChatTranscript(doc.id, transcript, nowTz().toISOString());
    return { ok: true, chars: transcript.length };
  } catch (e) {
    const msg = (e as Error).message;
    await failDocument(doc.id, msg).catch(() => undefined);
    return { ok: false, chars: 0, error: msg };
  }
}

/** Nội dung các tệp, gói lại để ghép vào câu hỏi gửi trợ lý (giới hạn độ dài — chỗ tốn token nhất). */
export function khoiTepChoHoi(docs: Array<Pick<BrainDocument, 'name' | 'transcript'>>, nhan = 'TỆP ĐÍNH KÈM'): string {
  const MAX_MOI_TEP = 12000;
  const MAX_TONG = 24000;
  let tong = 0;
  const parts: string[] = [];
  for (const d of docs) {
    const nd = d.transcript.slice(0, Math.max(0, Math.min(MAX_MOI_TEP, MAX_TONG - tong)));
    if (!nd) break;
    tong += nd.length;
    const cat = d.transcript.length > nd.length ? '\n…(tệp dài, phần sau đã lược bớt)' : '';
    parts.push(`[${nhan}: ${d.name}]\n${nd}${cat}\n[HẾT TỆP: ${d.name}]`);
  }
  return parts.join('\n\n');
}

/**
 * Đưa một tệp đã đọc vào kho — qua bộ phân loại như mọi thứ khác: có bí mật thì không nạp,
 * AI xếp nhóm và phạm vi (bảng lương, tài chính → chỉ giám đốc).
 */
export async function duaTepVaoKho(docId: string): Promise<string> {
  const doc = await findDocument(docId);
  if (!doc) throw new Error('Không tìm thấy tệp.');
  if (!doc.transcript) throw new Error('Tệp chưa đọc xong.');
  const input = await nhanTaiLieu(doc, doc.transcript);
  await ingest({ ...input, text: doc.transcript });
  await finishDocument(doc.id, doc.transcript, nowTz().toISOString());
  const { NHOM } = await import('../lib/brainGate.js');
  const nhom = input.category && input.category in NHOM ? NHOM[input.category as keyof typeof NHOM] : '';
  if (input.visibility === 'director') return `Đã đưa "${doc.name}" vào kho — chỉ giám đốc xem được.`;
  return `Đã đưa "${doc.name}" vào kho${nhom ? ` — nhóm ${nhom}` : ''}${input.customer ? ` · ${input.customer}` : ''}.`;
}

/** Đọc tài liệu bằng Gemini (PDF/ảnh/text) → trích xuất nội dung + tóm tắt → nạp vào kho. */
export async function processDocument(docId: string): Promise<void> {
  const doc = await claimDocument(docId);
  if (!doc) return; // đang được xử lý ở nơi khác, hoặc đã xong

  try {
    if (!(await embeddingsAvailable())) throw new Error('Chưa cấu hình API key Gemini.');
    const transcript = await docNoiDung(doc);
    await ingest({ ...(await nhanTaiLieu(doc, transcript)), text: transcript });
    await finishDocument(doc.id, transcript, nowTz().toISOString());
  } catch (e) {
    console.error('[brain] xử lý tài liệu', docId, e);
    await failDocument(docId, (e as Error).message).catch(() => undefined);
  }
}

/**
 * Gắn nhãn cho tài liệu như mọi thứ khác vào kho: có mật khẩu/khoá/số tài khoản thì không nạp;
 * AI xếp nhóm và phạm vi (bảng lương, tài chính → chỉ giám đốc). AI lỗi thì giữ riêng giám đốc.
 */
export async function nhanTaiLieu(
  doc: { id: string; name: string; customer: string; uploadedBy: string; uploadedName: string },
  text: string,
): Promise<IngestInput> {
  const { timBiMat, xepTrangThai, khopKhach } = await import('../lib/brainGate.js');
  const biMat = timBiMat(text);
  if (biMat) throw new Error(`Tài liệu có ${biMat} — kho tri thức không giữ thông tin này.`);
  const base: IngestInput = {
    sourceType: 'document',
    sourceId: doc.id,
    title: `Tài liệu: ${doc.name}`,
    text,
    visibility: 'director',
    customer: doc.customer,
  };
  try {
    const { phanLoaiNoiDung } = await import('./brainItems.service.js');
    const { getCustomers } = await import('./crm.repo.js');
    const khach = await getCustomers();
    const pl = await phanLoaiNoiDung(
      { title: doc.name, body: text, customerHint: doc.customer },
      { id: doc.uploadedBy, name: doc.uploadedName, role: '', teamId: '' },
      khach.map((k) => k.name),
    );
    // Tài liệu là người ta CHỦ ĐỘNG tải lên: "không lưu"/"chưa chắc" vẫn nạp, nhưng chỉ giám đốc xem.
    const xep = xepTrangThai({ quyetDinh: pl.quyetDinh, category: pl.category, teamId: pl.teamId }, { laGiamDoc: false, nguon: 'document' });
    const kh = khopKhach(pl.customerName || doc.customer, khach);
    return {
      ...base,
      visibility: xep.status === 'published' ? xep.scope : 'director',
      category: xep.category,
      customer: kh?.name || doc.customer,
      customerId: kh?.id || '',
    };
  } catch (e) {
    console.warn('[brain] gắn nhãn tài liệu:', (e as Error).message);
    return base;
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
