// Zalo cá nhân → kho tri thức "có chọn lọc" (anh Tâm 5/10/2026).
//
// Chọn lọc ba lớp:
//   1. Cuộc trò chuyện mặc định TẮT — anh tự bật cuộc nào là khách. Cuộc tắt không lưu nội dung.
//   2. AI chỉ rút những ý ĐÁNG NHỚ LÂU (yêu cầu, sở thích, điều đã chốt, phàn nàn…), bỏ chào hỏi,
//      hẹn giờ gọi, OTP, chuyện vặt.
//   3. Mỗi ý đi qua bộ phân loại kho với nguồn 'zalo' → KHÔNG BAO GIỜ tự mở cho cả công ty: việc
//      công việc vào hàng chờ duyệt, chuyện riêng giữ riêng giám đốc.
import { generateJson } from '../gemini/client.js';
import { dungDoanChat, denLucRut, noiDungTin, goiYTenKhachTuNhom, type TinZalo } from '../lib/zalo.js';
import { khopKhach } from '../lib/brainGate.js';
import {
  ghiCuoc,
  ghiTin,
  dsCuoc,
  timCuoc,
  tinChuaRut,
  danhDauDaRut,
  donTinCu,
  nhomChuaXet,
  ghiKetQuaXet,
  type ZaloThread,
} from './zalo.repo.js';
import { xetDuaVaoKho, type NguoiGui } from './brainItems.service.js';
import { getCustomers, upsertCustomer, CLOSED_STATUS, type Customer } from './crm.repo.js';
import { newId } from '../util/id.js';
import { getDirectors } from './members.repo.js';
import { nowTz } from '../lib/datetime.js';

export interface TinTuWorker {
  msgId: string;
  threadId: string;
  threadName?: string;
  isGroup?: boolean;
  fromSelf?: boolean;
  sender?: string;
  content?: unknown;
  ts: string | number;
}

/**
 * Nhận một lô tin vừa đồng bộ từ Zalo. Cuộc chưa bật: chỉ đếm (để anh thấy ai nhắn mà bật), KHÔNG lưu
 * nội dung. Cuộc đã bật: lưu nội dung để lát nữa rút tri thức.
 */
export async function nhanTin(lo: TinTuWorker[]): Promise<{ luu: number; boQua: number }> {
  const now = nowTz().toISOString();
  const theoCuoc = new Map<string, TinTuWorker[]>();
  for (const t of lo) {
    if (!t?.threadId || !t?.msgId) continue;
    const arr = theoCuoc.get(t.threadId);
    if (arr) arr.push(t);
    else theoCuoc.set(t.threadId, [t]);
  }
  let luu = 0;
  let boQua = 0;
  for (const [threadId, ds] of theoCuoc) {
    const tsMax = Math.max(...ds.map((t) => Number(t.ts) || 0));
    const tenKhach = ds.find((t) => !t.fromSelf && t.threadName)?.threadName || ds.find((t) => t.threadName)?.threadName || '';
    const batt = await ghiCuoc({
      threadId,
      name: tenKhach,
      isGroup: !!ds[0]!.isGroup,
      soTin: ds.length,
      lastMsgAt: tsMax > 0 ? new Date(tsMax).toISOString() : now,
      now,
    });
    if (!batt) {
      boQua += ds.length;
      continue;
    }
    for (const t of ds) {
      const content = noiDungTin(t.content);
      if (!content) continue;
      await ghiTin({
        msgId: String(t.msgId),
        threadId,
        fromSelf: !!t.fromSelf,
        sender: String(t.sender || '').slice(0, 100),
        content,
        ts: String(Number(t.ts) || Date.now()),
      });
      luu++;
    }
  }
  return { luu, boQua };
}

const SCHEMA_RUT = {
  type: 'OBJECT',
  properties: {
    y: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { tieuDe: { type: 'STRING' }, noiDung: { type: 'STRING' } },
        required: ['tieuDe', 'noiDung'],
      },
    },
  },
  required: ['y'],
};

/** Nhờ AI rút các ý đáng nhớ lâu dài từ một đoạn chat. Trả mảng rỗng nếu không có gì đáng giữ. */
export async function rutY(
  doanChat: string,
  khach: string,
  chu: string,
  nhom = '',
): Promise<Array<{ tieuDe: string; noiDung: string }>> {
  if (!doanChat.trim()) return [];
  const prompt = [
    nhom
      ? `Đây là đoạn chat trong nhóm Zalo «${nhom}» giữa agency marketing MT Digital (${chu} là giám đốc, cùng nhân viên) và khách hàng ${khach}. Tên người nói ghi trước dấu hai chấm.`
      : `Đây là đoạn chat Zalo giữa ${chu} (giám đốc agency marketing MT Digital) và ${khach || 'một khách hàng'}.`,
    'Rút ra những Ý ĐÁNG NHỚ LÂU DÀI để nhân viên phục vụ khách này tốt hơn, mỗi ý một mục tự hiểu được.',
    'TẬP TRUNG vào LƯU Ý và YÊU CẦU của khách (anh Tâm 8/10/2026):',
    '- yêu cầu, mong muốn, sở thích, điều khách KHÔNG thích, cách khách muốn được làm việc;',
    '- lưu ý khi làm cho khách: màu sắc/giọng văn/sản phẩm cần nhấn, điều cấm, giờ duyệt bài, người duyệt;',
    '- điều hai bên đã CHỐT: phạm vi công việc, giá, hạn, cách nghiệm thu, người liên hệ phía khách;',
    '- phàn nàn của khách và cách đã xử lý; thông tin bền vững về doanh nghiệp/sản phẩm của khách.',
    'BỎ QUA: chào hỏi, cảm ơn, hẹn giờ gọi, "ok anh", gửi file không kèm nội dung, mã OTP, mật khẩu,',
    'số tài khoản, số điện thoại, chuyện cá nhân không liên quan công việc.',
    'Không có ý nào đáng giữ thì trả y = []. KHÔNG bịa điều không có trong đoạn chat. Viết tiếng Việt,',
    'nội dung mỗi ý 1-4 câu, ghi rõ ngày nếu là điều đã chốt.',
    '',
    'ĐOẠN CHAT (cũ → mới):',
    doanChat,
  ].join('\n');
  const r = await generateJson(prompt, SCHEMA_RUT, 'gemini-2.5-flash');
  const ds = Array.isArray(r?.y) ? r.y : [];
  return ds
    .map((x: { tieuDe?: unknown; noiDung?: unknown }) => ({ tieuDe: String(x.tieuDe || '').trim(), noiDung: String(x.noiDung || '').trim() }))
    .filter((x: { tieuDe: string; noiDung: string }) => x.tieuDe && x.noiDung.length >= 10)
    .slice(0, 8);
}

/** Rút tri thức cho MỘT cuộc: AI rút ý → từng ý qua bộ phân loại kho (nguồn 'zalo'). */
export async function rutCuoc(c: ZaloThread, chu: NguoiGui): Promise<{ y: number; vaoKho: string[] }> {
  const tin: TinZalo[] = await tinChuaRut(c.threadId);
  if (tin.length === 0) return { y: 0, vaoKho: [] };
  const tenKhach = c.customer || c.name;
  // Nhóm khách có cả lịch sử kéo về (vài trăm tin) → cho AI đọc dài hơn.
  const doan = dungDoanChat(tin, chu.name || 'Giám đốc', tenKhach, c.isGroup ? 40000 : 15000);
  const ys = await rutY(doan, tenKhach, chu.name || 'Giám đốc', c.isGroup ? c.name || tenKhach : '');
  const nguon = c.isGroup ? `nhóm Zalo «${c.name || tenKhach}»` : `trao đổi Zalo với ${tenKhach}`;
  const vaoKho: string[] = [];
  for (const y of ys) {
    const kq = await xetDuaVaoKho(
      { title: y.tieuDe, body: `${y.noiDung}\n\n(Rút từ ${nguon}.)`, customer: tenKhach, source: 'zalo' },
      chu,
    );
    if (kq.item) vaoKho.push(kq.message);
  }
  await danhDauDaRut(c.threadId, tin.map((t) => t.msgId), nowTz().toISOString());
  return { y: ys.length, vaoKho };
}

let dangRut = false;
let lanRutCuoi = 0;

/**
 * Rút tri thức cho các cuộc đã bật, đã lắng, có tin mới. Gọi sau mỗi lượt đồng bộ (~10 phút) và
 * từ nút "Rút ngay". Mỗi lượt tối đa vài cuộc — máy chủ chỉ sống 60 giây.
 */
export async function rutTriThucZalo(opts: { epNgay?: boolean; threadId?: string; limit?: number } = {}): Promise<{ cuoc: number; y: number }> {
  if (dangRut) return { cuoc: 0, y: 0 };
  if (!opts.epNgay && Date.now() - lanRutCuoi < 4 * 60_000) return { cuoc: 0, y: 0 };
  dangRut = true;
  lanRutCuoi = Date.now();
  try {
    const gd = (await getDirectors())[0];
    const chu: NguoiGui = { id: gd?.id || '', name: gd?.fullName || 'Giám đốc', role: 'director', teamId: '' };
    const ds = opts.threadId ? [await timCuoc(opts.threadId)].filter((x): x is ZaloThread => !!x) : await dsCuoc(300);
    const now = Date.now();
    const canRut = ds
      .filter((c) => c.enabled)
      .filter((c) => denLucRut({ chuaRut: c.chuaRut, lastMsgAt: c.lastMsgAt, now, epNgay: opts.epNgay }))
      .slice(0, opts.limit ?? 3);
    let y = 0;
    for (const c of canRut) {
      try {
        y += (await rutCuoc(c, chu)).y;
      } catch (e) {
        console.warn('[zalo] rút tri thức', c.threadId, (e as Error).message);
      }
    }
    await donTinCu(now - 30 * 24 * 3600 * 1000).catch(() => undefined);
    return { cuoc: canRut.length, y };
  } finally {
    dangRut = false;
  }
}

/** Gắn cuộc với khách trong CRM — khớp đúng một khách, không đoán. */
export async function khopKhachCuoc(ten: string): Promise<{ customerId: string; customer: string }> {
  if (!ten.trim()) return { customerId: '', customer: '' };
  const kh = khopKhach(ten, await getCustomers());
  return kh ? { customerId: kh.id, customer: kh.name } : { customerId: '', customer: ten.trim() };
}

// ── Nhóm khách (anh Tâm 8/10/2026: "tiêu đề sẽ có là TÊN KH - MT DIGITAL, 1 số sẽ khác, e cho AI vào
// và quyết định tên KH, thông tin để so khớp, tạo ở CRM") ──

const SCHEMA_NHOM = {
  type: 'OBJECT',
  properties: {
    nhom: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          id: { type: 'STRING' },
          laNhomKhach: { type: 'BOOLEAN' },
          tenKhach: { type: 'STRING' },
          lyDo: { type: 'STRING' },
        },
        required: ['id', 'laNhomKhach'],
      },
    },
  },
  required: ['nhom'],
};

export interface NhomCanXet {
  threadId: string;
  name: string;
  moTa?: string;
}

export interface KetLuanNhom {
  laNhomKhach: boolean;
  tenKhach: string;
  lyDo: string;
}

/** Nhờ AI xét một lô nhóm: nhóm nào là nhóm làm việc với KHÁCH HÀNG, tên khách là gì. */
export async function xetNhom(ds: NhomCanXet[], tenKhachCRM: string[]): Promise<Map<string, KetLuanNhom>> {
  const kq = new Map<string, KetLuanNhom>();
  if (ds.length === 0) return kq;
  const dong = ds.map((n) => {
    const g = goiYTenKhachTuNhom(n.name);
    return JSON.stringify({
      id: n.threadId,
      ten: n.name,
      ...(n.moTa ? { moTa: n.moTa.slice(0, 200) } : {}),
      ...(g.theoMau ? { goiYTenKhach: g.ten } : {}),
    });
  });
  const prompt = [
    'MT Digital là agency marketing (quảng cáo, SEO, nội dung, thiết kế, video). Giám đốc có nhiều nhóm Zalo.',
    'Với mỗi nhóm dưới đây, xét xem đó có phải NHÓM LÀM VIỆC VỚI MỘT KHÁCH HÀNG không.',
    '- Quy ước đặt tên nhóm khách: "TÊN KH - MT DIGITAL" (khi đúng quy ước có sẵn "goiYTenKhach"). Một số',
    '  nhóm khách đặt tên khác (vd "Dự án web ABC", "Savax x MT", "Ads Quốc Phong") — tự phán đoán.',
    '- KHÔNG phải nhóm khách: gia đình, bạn bè, lớp học, nhóm nội bộ chỉ có nhân viên MT Digital, hội nhóm',
    '  cộng đồng/rao vặt/chia sẻ kiến thức đông người, nhóm của đối tác/nhà cung cấp.',
    '- tenKhach: tên doanh nghiệp/thương hiệu của khách, viết gọn như khách hay dùng. Trùng với một khách',
    '  đã có trong CRM (danh sách dưới) thì ghi ĐÚNG tên trong CRM.',
    '- lyDo: một câu ngắn tiếng Việt.',
    'Không chắc thì laNhomKhach = false (giám đốc tự bật tay được).',
    '',
    'KHÁCH ĐÃ CÓ TRONG CRM:',
    tenKhachCRM.slice(0, 400).join(' | ') || '(chưa có)',
    '',
    'CÁC NHÓM (mỗi dòng một JSON):',
    ...dong,
  ].join('\n');
  const r = await generateJson(prompt, SCHEMA_NHOM, 'gemini-2.5-flash');
  const hopLe = new Set(ds.map((n) => n.threadId));
  for (const x of Array.isArray(r?.nhom) ? r.nhom : []) {
    const id = String(x?.id || '');
    if (!hopLe.has(id)) continue;
    kq.set(id, {
      laNhomKhach: !!x.laNhomKhach,
      tenKhach: String(x.tenKhach || '').trim().slice(0, 120),
      lyDo: String(x.lyDo || '').trim().slice(0, 300),
    });
  }
  return kq;
}

/**
 * Xét các nhóm chưa xét: AI quyết định nhóm khách + tên khách → khớp khách trong CRM, chưa có thì
 * TẠO khách mới → bật học. Nhóm AI không trả kết luận thì để lượt sau xét lại.
 */
export async function xacDinhNhomKhach(limit = 40): Promise<{ xet: number; nhomKhach: number; khachMoi: string[] }> {
  const ds = await nhomChuaXet(limit);
  if (ds.length === 0) return { xet: 0, nhomKhach: 0, khachMoi: [] };
  const khach: Customer[] = await getCustomers();
  // Nhóm chưa xét: ai_note đang tạm giữ "số thành viên · mô tả nhóm" (zalo.repo.ghiDanhSachNhom).
  const kl = await xetNhom(
    ds.map((n) => ({ threadId: n.threadId, name: n.name, moTa: n.aiNote })),
    khach.map((c) => c.name),
  );
  const gd = (await getDirectors())[0];
  let nhomKhach = 0;
  const khachMoi: string[] = [];
  for (const n of ds) {
    const k = kl.get(n.threadId);
    if (!k) continue;
    const ten = k.laNhomKhach ? k.tenKhach || goiYTenKhachTuNhom(n.name).ten : '';
    if (!ten) {
      await ghiKetQuaXet(n.threadId, {
        aiNote: `Không phải nhóm khách — ${k.lyDo || 'AI không thấy dấu hiệu khách hàng'}`,
        laNhomKhach: false,
        customerId: '',
        customer: '',
      });
      continue;
    }
    let kh: Customer | null = khopKhach(ten, khach);
    let ghiChu = `Nhóm khách → ${ten}`;
    if (kh) ghiChu += ' (đã có trong CRM)';
    else {
      kh = {
        id: newId('C-'),
        name: ten,
        phone: '',
        status: CLOSED_STATUS,
        note: `Tạo tự động từ nhóm Zalo «${n.name}».`,
        info: '',
        assignedTo: gd?.id || '',
        dob: '',
        closedAt: '',
        source: '',
        createdAt: nowTz().toISOString(),
      };
      await upsertCustomer(kh);
      khach.push(kh);
      khachMoi.push(ten);
      ghiChu += ' (mới tạo trong CRM)';
    }
    if (k.lyDo) ghiChu += ` — ${k.lyDo}`;
    await ghiKetQuaXet(n.threadId, { aiNote: ghiChu, laNhomKhach: true, customerId: kh.id, customer: kh.name });
    nhomKhach++;
  }
  return { xet: kl.size, nhomKhach, khachMoi };
}
