// "Bộ não thứ hai" (anh Tâm 4/10/2026): mỗi thứ đưa vào kho đều được HIỂU và GẮN NHÃN trước,
// và lúc hỏi thì tra theo nhãn để trả đúng.
//
//   Đưa vào:  xetDuaVaoKho  — một cửa duy nhất cho mọi đường (form, nút lưu trong chat, trợ lý,
//             Google Sheets, AI tự vơ, phân loại lại, chuyển Lưu ý KH).
//   Hỏi:      timTriThuc    — đúng khách (theo id CRM), đúng nhóm, đúng quyền; tìm lai vector + chữ;
//             trả theo MỤC (tiêu đề · nhóm · ngày) để trợ lý trích được nguồn.
//   Chưa có:  chuyenCauHoi → giám đốc traLoiCauHoi một lần → thành mục, báo lại người hỏi.
import { generateJson, embedTexts, embeddingsAvailable } from '../gemini/client.js';
import {
  NHOM,
  NHOM_KEYS,
  QUY_TAC_KHO,
  laNhom,
  timBiMat,
  xoaLienHe,
  xepTrangThai,
  cauBaoNguoiGui,
  khopKhach,
  cauHoiGiong,
  tuKhoaTimKiem,
  type NhomKey,
  type QuyetDinh,
} from '../lib/brainGate.js';
import {
  upsertItem,
  findItem,
  itemsByIds,
  keywordItems,
  listQuestions,
  upsertQuestion,
  findQuestion,
  type BrainItem,
  type BrainQuestion,
} from './brainItems.repo.js';
import { searchChunks, deleteBySource, isMissingTable, type BrainHit } from './brain.repo.js';
import { ingest, removeSource, htmlToText } from './brain.service.js';
import { getCustomers } from './crm.repo.js';
import { getDirectors } from './members.repo.js';
import { notifyMany } from './notifications.service.js';
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';

export interface NguoiGui {
  id: string;
  name: string;
  role: string;
  teamId: string;
}

const laGiamDoc = (role: string) => role === 'director' || role === 'admin';

// ── Hiểu nội dung (AI) ──

const SCHEMA_PHAN_LOAI = {
  type: 'OBJECT',
  properties: {
    quyetDinh: { type: 'STRING', enum: ['cong_viec', 'rieng_giam_doc', 'khong_luu', 'can_duyet'] },
    category: { type: 'STRING', enum: NHOM_KEYS },
    customerName: { type: 'STRING' },
    teamId: { type: 'STRING', enum: ['', 'Ads', 'Content', 'SEO'] },
    tieuDe: { type: 'STRING' },
    tomTat: { type: 'STRING' },
    tags: { type: 'ARRAY', items: { type: 'STRING' } },
    lyDo: { type: 'STRING' },
  },
  required: ['quyetDinh', 'category', 'tieuDe', 'tomTat', 'lyDo'],
};

export interface PhanLoai {
  quyetDinh: QuyetDinh;
  category: NhomKey;
  customerName: string;
  teamId: string;
  tieuDe: string;
  tomTat: string;
  tags: string[];
  lyDo: string;
}

/** Nhờ AI đọc và gắn nhãn. Ném lỗi nếu AI không trả lời được — chỗ gọi tự quyết đi hàng chờ. */
export async function phanLoaiNoiDung(
  input: { title: string; body: string; customerHint?: string },
  nguoi: NguoiGui,
  tenKhach: string[],
): Promise<PhanLoai> {
  const prompt = [
    'Bạn là người giữ KHO TRI THỨC của agency marketing MT Digital. Nhân viên sẽ hỏi trợ lý AI và',
    'trợ lý trả lời từ kho này thay vì hỏi giám đốc. Đọc nội dung dưới đây, quyết định có đưa vào',
    'kho không, và gắn nhãn chính xác để lần sau tra đúng.',
    '',
    QUY_TAC_KHO,
    '',
    'quyetDinh:',
    '- cong_viec: kiến thức làm việc dùng chung, rõ ràng, đã chốt → đưa vào kho cho nhân viên.',
    '- rieng_giam_doc: thuộc nhóm CHỈ GIÁM ĐỐC XEM ở trên.',
    '- khong_luu: thuộc nhóm KHÔNG LƯU ở trên.',
    '- can_duyet: có vẻ là quy định nhưng chưa rõ đã chốt chưa, mâu thuẫn, hoặc em không chắc.',
    `category: một trong ${NHOM_KEYS.join(', ')} (rieng chỉ dùng khi quyetDinh = rieng_giam_doc).`,
    'customerName: nếu nội dung nói về MỘT khách cụ thể, chép ĐÚNG tên trong danh sách khách dưới đây;',
    '  không có trong danh sách hoặc không nói về khách nào thì để rỗng. Không tự bịa tên.',
    'teamId: Ads | Content | SEO nếu CHỈ phòng đó dùng; dùng chung cả công ty thì để rỗng.',
    'tieuDe: tiêu đề ngắn, rõ, để người khác đọc là biết mục nói gì (tối đa 12 từ).',
    'tomTat: một câu tóm ý chính.',
    'tags: 3-6 từ khoá người ta có thể gõ khi tìm (tên khách, tên dịch vụ, mã việc, thuật ngữ).',
    'lyDo: một câu giải thích vì sao em xếp như vậy.',
    '',
    `NGƯỜI GỬI: ${nguoi.name || 'hệ thống'} (${nguoi.role || '—'}${nguoi.teamId ? `, phòng ${nguoi.teamId}` : ''}).`,
    input.customerHint ? `NGƯỜI GỬI GẮN VỚI KHÁCH: ${input.customerHint}` : '',
    `DANH SÁCH KHÁCH TRONG CRM: ${tenKhach.slice(0, 400).join(' | ') || '(trống)'}`,
    '',
    `TIÊU ĐỀ: ${input.title.slice(0, 300)}`,
    `NỘI DUNG:\n${input.body.slice(0, 6000)}`,
  ]
    .filter((x) => x !== '')
    .join('\n');

  const r = await generateJson(prompt, SCHEMA_PHAN_LOAI, 'gemini-2.5-flash');
  const qd = String(r?.quyetDinh || '');
  if (!['cong_viec', 'rieng_giam_doc', 'khong_luu', 'can_duyet'].includes(qd)) {
    throw new Error('AI không trả về quyết định hợp lệ');
  }
  return {
    quyetDinh: qd as QuyetDinh,
    category: laNhom(r.category) ? r.category : 'quy_trinh',
    customerName: String(r.customerName || '').trim(),
    teamId: String(r.teamId || '').trim(),
    tieuDe: String(r.tieuDe || '').trim(),
    tomTat: String(r.tomTat || '').trim(),
    tags: Array.isArray(r.tags) ? r.tags.map((t: unknown) => String(t).trim()).filter(Boolean).slice(0, 8) : [],
    lyDo: String(r.lyDo || '').trim(),
  };
}

// ── Đồng bộ mục → đoạn tìm kiếm ──

/** Mục đã ban hành thì cắt đoạn vào brain_chunks; còn lại thì gỡ hết đoạn của nó. */
export async function dongBoDoan(item: BrainItem): Promise<void> {
  if (item.status !== 'published') {
    await removeSource('item', item.id);
    return;
  }
  // Tóm tắt đặt đầu để đoạn đầu tiên luôn mang ý chính — tra ra đoạn nào cũng hiểu mục nói gì.
  const text = [item.summary ? `Tóm tắt: ${item.summary}` : '', item.body].filter(Boolean).join('\n\n');
  await ingest({
    sourceType: 'item',
    sourceId: item.id,
    title: `${NHOM[item.category as NhomKey] || 'Tri thức'}: ${item.title}`,
    text,
    visibility: item.scope,
    customer: item.customer,
    category: item.category,
    customerId: item.customerId,
  });
}

// ── Một cửa đưa vào kho ──

export interface DuaVaoInput {
  title: string;
  body: string;
  /** Tên khách người gửi gắn kèm (gợi ý cho AI). */
  customer?: string;
  /** manual | chat | auto | sheet | answer | customer_note | reclassify */
  source: string;
  /** Cố định mã mục (để chạy lại không nhân bản: chuyển Lưu ý KH, phân loại lại). */
  itemId?: string;
  /** Ép kết quả cho nguồn đã biết chắc (vd Lưu ý KH luôn là nhóm Khách hàng, luôn lưu). */
  ep?: { category?: NhomKey; quyetDinh?: QuyetDinh };
  /** Giữ người tạo/ngày gốc khi chuyển dữ liệu cũ. */
  goc?: { submittedBy?: string; submittedName?: string; createdAt?: string };
}

export interface DuaVaoKetQua {
  /** null khi không lưu gì cả (có bí mật, hoặc AI tự vơ mà không đáng lưu). */
  item: BrainItem | null;
  message: string;
}

const NGUONG_TRUNG = 0.85;

export async function xetDuaVaoKho(input: DuaVaoInput, nguoi: NguoiGui): Promise<DuaVaoKetQua> {
  const tieuDeGoc = String(input.title || '').trim();
  const thanGoc = String(input.body || '').trim();
  if (thanGoc.length < 10) return { item: null, message: 'Nội dung quá ngắn để lưu.' };

  // 1) Bí mật → chặn cứng, KHÔNG ghi nội dung ở đâu cả.
  const biMat = timBiMat(`${tieuDeGoc}\n${thanGoc}`);
  if (biMat) {
    return {
      item: null,
      message: `Không lưu: nội dung có ${biMat}. Kho tri thức không giữ mật khẩu, khoá hay số tài khoản — bỏ phần đó rồi gửi lại.`,
    };
  }

  // 2) Liên lạc của khách → xoá rồi mới xét.
  const title = xoaLienHe(tieuDeGoc).text;
  const body = xoaLienHe(thanGoc).text;

  const now = nowTz().toISOString();
  const khach = await getCustomers().catch(() => []);
  const truoc = input.itemId ? await findItem(input.itemId).catch(() => undefined) : undefined;

  const goc: BrainItem = {
    id: input.itemId || newId('BI-'),
    title: title || body.slice(0, 80),
    body,
    summary: '',
    category: input.ep?.category || 'quy_trinh',
    customerId: '',
    customer: '',
    teamId: '',
    tags: [],
    scope: 'director',
    status: 'pending',
    source: input.source,
    submittedBy: input.goc?.submittedBy ?? nguoi.id,
    submittedName: input.goc?.submittedName ?? nguoi.name,
    approvedBy: '',
    aiReason: '',
    createdAt: truoc?.createdAt || input.goc?.createdAt || now,
    updatedAt: now,
  };

  // 3) AI hiểu và gắn nhãn. AI lỗi → hàng chờ, không bao giờ tự ban hành khi chưa phân loại được.
  let pl: PhanLoai;
  try {
    pl = await phanLoaiNoiDung({ title, body, customerHint: input.customer }, nguoi, khach.map((k) => k.name));
  } catch (e) {
    console.warn('[brain] phân loại lỗi:', (e as Error).message);
    const kh = input.customer ? khopKhach(input.customer, khach) : null;
    const item: BrainItem = {
      ...goc,
      customerId: kh?.id || '',
      customer: kh?.name || input.customer || '',
      aiReason: 'AI chưa phân loại được lúc gửi — chờ giám đốc xem.',
    };
    await upsertItem(item);
    await dongBoDoan(item);
    return { item, message: cauBaoNguoiGui({ ...item, lyDo: item.aiReason }) };
  }

  if (input.ep?.category) pl.category = input.ep.category;
  if (input.ep?.quyetDinh) pl.quyetDinh = input.ep.quyetDinh;

  // AI tự vơ mà không đáng lưu → không để lại rác trong hàng chờ.
  if (input.source === 'auto' && pl.quyetDinh === 'khong_luu') return { item: null, message: '' };

  // 4) Khách: khớp ĐÚNG một khách trong CRM, không đoán theo chữ chứa.
  const kh = khopKhach(pl.customerName, khach) || (input.customer ? khopKhach(input.customer, khach) : null);

  // 5) Trùng/trái với mục đang có → để giám đốc xem (trừ khi chính giám đốc gửi).
  let lyDo = pl.lyDo;
  if (pl.quyetDinh === 'cong_viec' && !laGiamDoc(nguoi.role) && (await embeddingsAvailable())) {
    try {
      const [vec] = await embedTexts([`${pl.tieuDe}\n${pl.tomTat}`], 'RETRIEVAL_QUERY');
      if (vec) {
        const hits = await searchChunks(vec, { directorScope: true, sourceType: 'item', limit: 3 });
        const giong = hits.find((h) => h.sourceId !== goc.id && h.score >= NGUONG_TRUNG);
        if (giong) {
          pl.quyetDinh = 'can_duyet';
          lyDo = `Gần giống mục đã có "${giong.title.replace(/^[^:]*:\s*/, '')}" — giám đốc xem trùng hay cần cập nhật.`;
        }
      }
    } catch (e) {
      if (!isMissingTable(e)) console.warn('[brain] kiểm trùng:', (e as Error).message);
    }
  }

  const xep = xepTrangThai(
    { quyetDinh: pl.quyetDinh, category: pl.category, teamId: pl.teamId },
    { laGiamDoc: laGiamDoc(nguoi.role), nguon: input.source },
  );

  const item: BrainItem = {
    ...goc,
    title: pl.tieuDe || goc.title,
    summary: pl.tomTat,
    category: xep.category,
    customerId: kh?.id || '',
    customer: kh?.name || '',
    teamId: xep.scope.startsWith('team:') ? xep.scope.slice(5) : '',
    tags: pl.tags,
    scope: xep.scope,
    status: xep.status,
    approvedBy: xep.status === 'published' && laGiamDoc(nguoi.role) ? nguoi.name : '',
    aiReason: lyDo,
  };
  await upsertItem(item);
  await dongBoDoan(item);

  // Đóng góp của nhân viên cần duyệt → báo giám đốc (không báo cho đợt chạy hàng loạt).
  if (item.status === 'pending' && (input.source === 'manual' || input.source === 'chat') && !laGiamDoc(nguoi.role)) {
    const gd = await getDirectors().catch(() => []);
    await notifyMany(
      gd.map((d) => d.id),
      {
        type: 'brain_pending',
        title: 'Có đóng góp kho tri thức chờ duyệt 🧠',
        body: `${nguoi.name}: "${item.title}"`,
        url: '/brain?tab=duyet',
      },
      { background: true },
    );
  }

  return { item, message: cauBaoNguoiGui({ ...item, lyDo }) };
}

// ── Giám đốc sửa / ban hành / lưu trữ ──

export interface SuaMuc {
  title?: string;
  body?: string;
  category?: string;
  scope?: string;
  status?: BrainItem['status'];
  customer?: string;
}

export async function suaMuc(id: string, patch: SuaMuc, nguoi: NguoiGui): Promise<BrainItem> {
  const cu = await findItem(id);
  if (!cu) throw new Error('Không tìm thấy mục');
  const gd = laGiamDoc(nguoi.role);
  if (!gd && !(cu.submittedBy === nguoi.id && cu.status === 'pending')) {
    throw new Error('Chỉ giám đốc sửa được mục này');
  }
  const moi: BrainItem = { ...cu, updatedAt: nowTz().toISOString() };
  if (patch.title !== undefined) moi.title = xoaLienHe(patch.title.trim()).text || cu.title;
  if (patch.body !== undefined) {
    const b = patch.body.trim();
    if (timBiMat(b)) throw new Error('Nội dung có mật khẩu/khoá/số tài khoản — không lưu được.');
    moi.body = xoaLienHe(b).text || cu.body;
  }
  if (gd) {
    if (patch.category !== undefined && laNhom(patch.category)) moi.category = patch.category;
    if (patch.scope !== undefined && /^(all|director|team:(Ads|Content|SEO))$/.test(patch.scope)) moi.scope = patch.scope;
    if (moi.category === 'rieng') moi.scope = 'director';
    if (patch.customer !== undefined) {
      const kh = patch.customer.trim() ? khopKhach(patch.customer, await getCustomers()) : null;
      moi.customerId = kh?.id || '';
      moi.customer = kh?.name || '';
    }
    if (patch.status !== undefined) {
      moi.status = patch.status;
      if (patch.status === 'published') moi.approvedBy = nguoi.name;
    }
  }
  moi.teamId = moi.scope.startsWith('team:') ? moi.scope.slice(5) : '';
  await upsertItem(moi);
  await dongBoDoan(moi);
  return moi;
}

// ── Tra cứu theo nhãn ──

export interface TimOpts {
  directorScope: boolean;
  memberId?: string;
  teamId?: string;
  customer?: string;
  category?: string;
}

/** Bỏ dòng ngữ cảnh "[Tiêu đề — KH — ngày]" ở đầu đoạn. */
function bo1Dong(content: string): string {
  const nl = content.indexOf('\n');
  return nl > 0 && content.startsWith('[') ? content.slice(nl + 1) : content;
}

const fmtNgay = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}` : '');

const NGUON_VI: Record<string, string> = {
  profile: 'Hồ sơ khách (tổng hợp)',
  customer: 'Hồ sơ CRM',
  customer_note: 'Lưu ý KH',
  appointment: 'Lịch hẹn',
  document: 'Tài liệu',
  sheet: 'Bảng Google Sheets',
  note: 'Ghi chú cũ',
  auto: 'Ghi chú cũ (AI tự lưu)',
};

/** Câu đánh dấu "kho chưa có" — trợ lý nhân viên đọc thấy thì chuyển câu hỏi cho giám đốc. */
export const CHUA_CO = 'CHƯA CÓ TRONG KHO';

export async function timTriThuc(query: string, opts: TimOpts): Promise<string> {
  const text = String(query || '').trim();
  if (!text) return 'Chưa có câu tìm kiếm.';
  if (!(await embeddingsAvailable())) return 'Kho tri thức chưa được bật.';

  const category = laNhom(opts.category) ? opts.category : undefined;
  let customerId = '';
  let customerName = '';
  if ((opts.customer || '').trim()) {
    const kh = khopKhach(opts.customer!, await getCustomers().catch(() => []));
    if (kh) {
      customerId = kh.id;
      customerName = kh.name;
    }
  }
  const scope = { directorScope: opts.directorScope, memberId: opts.memberId, teamId: opts.teamId };

  let hits: BrainHit[] = [];
  let theoChu: Array<BrainItem & { hits: number }> = [];
  try {
    const [vec] = await embedTexts([text], 'RETRIEVAL_QUERY');
    [hits, theoChu] = await Promise.all([
      vec
        ? searchChunks(vec, {
            ...scope,
            customerId: customerId || undefined,
            customerName,
            customer: customerId ? undefined : opts.customer,
            category,
            limit: 14,
          })
        : Promise.resolve([]),
      keywordItems(tuKhoaTimKiem(text), { directorScope: opts.directorScope, teamId: opts.teamId, category, customerId: customerId || undefined }, 5).catch(() => []),
    ]);
  } catch (e) {
    if (isMissingTable(e)) return 'Kho tri thức chưa được khởi tạo (Quản trị → Cập nhật cấu trúc DB).';
    console.warn('[brain] tìm kiếm lỗi:', e);
    return 'Không tìm được trong kho tri thức lúc này.';
  }

  // Gom đoạn về MỤC gốc: mỗi mục một kết quả, lấy đoạn khớp nhất.
  const theoMuc = new Map<string, { score: number; doan: string }>();
  const khac: BrainHit[] = [];
  for (const h of hits) {
    if (h.sourceType === 'item') {
      const cu = theoMuc.get(h.sourceId);
      if (!cu || h.score > cu.score) theoMuc.set(h.sourceId, { score: h.score, doan: bo1Dong(h.content) });
    } else {
      khac.push(h);
    }
  }
  for (const k of theoChu) {
    const cu = theoMuc.get(k.id);
    const thuong = 0.05 * k.hits;
    if (cu) cu.score += thuong;
    else theoMuc.set(k.id, { score: 0.58 + thuong, doan: '' });
  }

  const NGUONG = 0.5;
  const muc = (await itemsByIds([...theoMuc.keys()]))
    .filter((i) => i.status === 'published')
    .map((i) => ({ i, ...theoMuc.get(i.id)! }))
    .filter((x) => x.score >= NGUONG)
    .sort((a, b) => b.score - a.score)
    .slice(0, 5);
  const le = khac.filter((h) => h.score >= NGUONG).slice(0, 4);

  if (muc.length === 0 && le.length === 0) {
    return `${CHUA_CO}: không có mục nào nói về "${text}"${customerName ? ` của khách ${customerName}` : ''}.`;
  }

  const tot = Math.max(...muc.map((m) => m.score), ...le.map((h) => h.score));
  const parts: string[] = [];
  if (tot < 0.62) parts.push('(Độ khớp thấp — có thể kho chưa có đúng điều được hỏi; đừng suy diễn thành quy định.)');
  const MAX = 5000;
  let tong = 0;
  for (const m of muc) {
    const nhom = NHOM[m.i.category as NhomKey] || m.i.category;
    const noiDung = (m.doan || m.i.body).slice(0, 1500);
    const block = [
      `📘 [${nhom}] ${m.i.title}${m.i.customer ? ` · KH ${m.i.customer}` : ''} — cập nhật ${fmtNgay(m.i.updatedAt)}`,
      m.i.summary ? `Tóm tắt: ${m.i.summary}` : '',
      noiDung,
    ]
      .filter(Boolean)
      .join('\n');
    if (tong + block.length > MAX) break;
    parts.push(block);
    tong += block.length;
  }
  for (const h of le) {
    const block = `— ${NGUON_VI[h.sourceType] || h.sourceType}${h.customer ? ` · ${h.customer}` : ''} · ${fmtNgay(h.createdAt)}:\n${bo1Dong(h.content).slice(0, 1200)}`;
    if (tong + block.length > MAX) break;
    parts.push(block);
    tong += block.length;
  }
  return parts.join('\n\n');
}

// ── Câu hỏi chưa có lời giải ──

export async function chuyenCauHoi(question: string, nguoi: NguoiGui): Promise<string> {
  const cau = xoaLienHe(String(question || '').trim()).text;
  if (cau.length < 5) return 'Chưa rõ câu hỏi.';
  const now = nowTz().toISOString();
  const dangMo = await listQuestions('open', 300);
  const giong = dangMo.find((x) => cauHoiGiong(x.question, cau));
  if (giong) {
    const askers = giong.askers.includes(nguoi.id) ? giong.askers : [...giong.askers, nguoi.id];
    await upsertQuestion({ ...giong, askers, times: giong.times + 1 });
    return 'Câu này đã có người hỏi và đang chờ giám đốc trả lời — có lời giải mình sẽ báo bạn.';
  }
  const x: BrainQuestion = {
    id: newId('BQ-'),
    question: cau,
    askedBy: nguoi.id,
    askedName: nguoi.name,
    teamId: nguoi.teamId,
    askers: [nguoi.id],
    times: 1,
    status: 'open',
    answerItemId: '',
    createdAt: now,
    answeredAt: '',
  };
  await upsertQuestion(x);
  const gd = await getDirectors().catch(() => []);
  await notifyMany(
    gd.map((d) => d.id),
    {
      type: 'brain_question',
      title: 'Nhân viên hỏi điều kho chưa có ❓',
      body: `${nguoi.name}: ${cau.slice(0, 160)}`,
      url: '/brain?tab=hoi',
    },
    { background: true },
  );
  return 'Đã chuyển câu hỏi cho giám đốc. Khi có lời giải, mình sẽ báo bạn và lần sau ai hỏi cũng có câu trả lời.';
}

/** Giám đốc trả lời → thành mục kho (qua bộ phân loại để gắn nhãn) → đóng câu hỏi → báo người hỏi. */
export async function traLoiCauHoi(
  id: string,
  answer: string,
  nguoi: NguoiGui,
  title?: string,
): Promise<{ question: BrainQuestion; ketQua: DuaVaoKetQua }> {
  const x = await findQuestion(id);
  if (!x) throw new Error('Không tìm thấy câu hỏi');
  if (x.status !== 'open') throw new Error('Câu hỏi này đã xử lý rồi');
  const traLoi = String(answer || '').trim();
  if (traLoi.length < 5) throw new Error('Câu trả lời quá ngắn');

  const ketQua = await xetDuaVaoKho(
    { title: (title || '').trim() || x.question, body: `Hỏi: ${x.question}\n\n${traLoi}`, source: 'answer' },
    nguoi,
  );
  if (!ketQua.item) throw new Error(ketQua.message || 'Không lưu được câu trả lời');

  const xong: BrainQuestion = { ...x, status: 'answered', answerItemId: ketQua.item.id, answeredAt: nowTz().toISOString() };
  await upsertQuestion(xong);
  // Chỉ báo lại khi câu trả lời thật sự tới tay họ được (ban hành, không phải riêng giám đốc).
  if (ketQua.item.status === 'published' && ketQua.item.scope !== 'director') {
    await notifyMany(
      x.askers,
      {
        type: 'brain_answer',
        title: 'Câu hỏi của bạn đã có lời giải ✅',
        body: `${x.question.slice(0, 100)} → ${traLoi.slice(0, 160)}`,
        url: '/brain',
      },
      { background: true },
    );
  }
  return { question: xong, ketQua };
}

export async function boQuaCauHoi(id: string): Promise<void> {
  const x = await findQuestion(id);
  if (!x) throw new Error('Không tìm thấy câu hỏi');
  await upsertQuestion({ ...x, status: 'dismissed', answeredAt: nowTz().toISOString() });
}

/** Giám đốc trả lời qua trợ lý: tìm câu hỏi đang mở gần nhất với gợi ý. */
export async function timCauHoiDangMo(goiY: string): Promise<BrainQuestion | undefined> {
  const mo = await listQuestions('open', 300);
  return mo.find((x) => cauHoiGiong(x.question, goiY)) || mo.find((x) => x.question.toLowerCase().includes(goiY.toLowerCase()));
}

// ── Dọn kho cũ ──

const HE_THONG: NguoiGui = { id: '', name: 'Phân loại lại kho', role: 'system', teamId: '' };

/** Còn bao nhiêu nguồn kiểu cũ (AI tự lưu / lưu tay) chưa được phân loại thành mục. */
export async function demChuaPhanLoai(): Promise<number> {
  const r = await q(`SELECT COUNT(DISTINCT source_id)::int AS n FROM brain_chunks WHERE source_type IN ('auto', 'note')`);
  return Number(r[0]?.n) || 0;
}

/**
 * Chạy bộ phân loại trên các mục kiểu cũ — theo lô (máy chủ Vercel chỉ sống 60 giây/lượt),
 * trang Quản trị gọi lặp tới khi hết. Mã mục cố định 'RC-<nguồn>' nên chạy lại không nhân bản.
 */
export async function phanLoaiLaiKho(limit = 6): Promise<{ done: number; remaining: number; ketQua: string[] }> {
  const nguon = await q(
    `SELECT source_type, source_id, MIN(title) AS title, MIN(created_at) AS created_at,
            string_agg(content, E'\n' ORDER BY chunk_id) AS content
     FROM brain_chunks WHERE source_type IN ('auto', 'note')
     GROUP BY source_type, source_id ORDER BY MIN(created_at) LIMIT $1`,
    [limit],
  );
  const ketQua: string[] = [];
  for (const r of nguon) {
    const body = String(r.content || '')
      .split('\n')
      .filter((d) => !/^\[.*\]$/.test(d.trim()))
      .join('\n')
      .trim();
    try {
      if (body.length >= 10) {
        const kq = await xetDuaVaoKho(
          {
            title: String(r.title || ''),
            body,
            source: 'reclassify',
            itemId: `RC-${r.source_id}`,
            goc: { submittedBy: '', submittedName: r.source_type === 'auto' ? 'AI tự lưu từ chat' : 'Lưu từ chat', createdAt: String(r.created_at || '') },
          },
          HE_THONG,
        );
        ketQua.push(`${String(r.title || '').slice(0, 60)} → ${kq.message}`);
      }
    } catch (e) {
      console.warn('[brain] phân loại lại', r.source_id, e);
      ketQua.push(`${String(r.title || '').slice(0, 60)} → lỗi: ${(e as Error).message}`);
    }
    // Mục đã thành brain_items (hoặc bị loại) → bỏ đoạn kiểu cũ, kẻo trợ lý đọc hai lần.
    await deleteBySource(String(r.source_type), String(r.source_id));
  }
  return { done: nguon.length, remaining: await demChuaPhanLoai(), ketQua };
}

/** Còn bao nhiêu Lưu ý KH chưa chuyển vào kho. */
export async function demLuuYChuaChuyen(): Promise<number> {
  const r = await q(
    `SELECT COUNT(*)::int AS n FROM customer_notes c
     WHERE COALESCE(c.content, '') <> '' AND NOT EXISTS (SELECT 1 FROM brain_items b WHERE b.item_id = 'CN-' || c.note_id)`,
  );
  return Number(r[0]?.n) || 0;
}

/**
 * Chuyển Lưu ý KH thành mục nhóm Khách hàng (anh Tâm 4/10/2026: "lưu ý khách hàng chúng ta có
 * thể bỏ luôn, thay vào đó là kho tri thức"). Bảng customer_notes GIỮ NGUYÊN làm bản lưu.
 */
export async function chuyenLuuYKhach(limit = 6): Promise<{ done: number; remaining: number }> {
  const rows = await q(
    `SELECT note_id, customer, content, created_by, created_name, created_at FROM customer_notes c
     WHERE COALESCE(c.content, '') <> '' AND NOT EXISTS (SELECT 1 FROM brain_items b WHERE b.item_id = 'CN-' || c.note_id)
     ORDER BY created_at LIMIT $1`,
    [limit],
  );
  for (const r of rows) {
    const body = htmlToText(String(r.content || ''));
    try {
      const kq = await xetDuaVaoKho(
        {
          title: `Lưu ý khách hàng${r.customer ? `: ${r.customer}` : ''}`,
          body: body.length >= 10 ? body : `${body} (ghi chú ngắn)`,
          customer: String(r.customer || ''),
          source: 'customer_note',
          itemId: `CN-${r.note_id}`,
          ep: { category: 'khach_hang', quyetDinh: 'cong_viec' },
          goc: { submittedBy: String(r.created_by || ''), submittedName: String(r.created_name || ''), createdAt: String(r.created_at || '') },
        },
        { ...HE_THONG, role: 'director', name: 'Chuyển từ Lưu ý KH' },
      );
      // Có bí mật nên không lưu → vẫn đánh dấu đã xét để không lặp mãi (mục rỗng, trạng thái rejected).
      if (!kq.item) {
        await upsertItem({
          id: `CN-${r.note_id}`, title: `Lưu ý khách hàng: ${r.customer || ''}`, body: '(không chuyển: ' + kq.message + ')',
          summary: '', category: 'khach_hang', customerId: '', customer: String(r.customer || ''), teamId: '', tags: [],
          scope: 'director', status: 'rejected', source: 'customer_note', submittedBy: String(r.created_by || ''),
          submittedName: String(r.created_name || ''), approvedBy: '', aiReason: kq.message,
          createdAt: String(r.created_at || ''), updatedAt: nowTz().toISOString(),
        });
      }
    } catch (e) {
      console.warn('[brain] chuyển lưu ý KH', r.note_id, e);
    }
    await deleteBySource('customer_note', String(r.note_id));
  }
  return { done: rows.length, remaining: await demLuuYChuaChuyen() };
}

