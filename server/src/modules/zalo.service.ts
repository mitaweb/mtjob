// Zalo cá nhân → kho tri thức "có chọn lọc" (anh Tâm 5/10/2026).
//
// Chọn lọc ba lớp:
//   1. Cuộc trò chuyện mặc định TẮT — anh tự bật cuộc nào là khách. Cuộc tắt không lưu nội dung.
//   2. AI chỉ rút những ý ĐÁNG NHỚ LÂU (yêu cầu, sở thích, điều đã chốt, phàn nàn…), bỏ chào hỏi,
//      hẹn giờ gọi, OTP, chuyện vặt.
//   3. Mỗi ý đi qua bộ phân loại kho với nguồn 'zalo' → KHÔNG BAO GIỜ tự mở cho cả công ty: việc
//      công việc vào hàng chờ duyệt, chuyện riêng giữ riêng giám đốc.
import { generateJson } from '../gemini/client.js';
import { dungDoanChat, denLucRut, noiDungTin, type TinZalo } from '../lib/zalo.js';
import { khopKhach } from '../lib/brainGate.js';
import {
  ghiCuoc,
  ghiTin,
  dsCuoc,
  timCuoc,
  tinChuaRut,
  danhDauDaRut,
  donTinCu,
  type ZaloThread,
} from './zalo.repo.js';
import { xetDuaVaoKho, type NguoiGui } from './brainItems.service.js';
import { getCustomers } from './crm.repo.js';
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
 * Nhận một lô tin từ worker. Cuộc chưa bật: chỉ đếm (để anh thấy ai nhắn mà bật), KHÔNG lưu
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
export async function rutY(doanChat: string, khach: string, chu: string): Promise<Array<{ tieuDe: string; noiDung: string }>> {
  if (!doanChat.trim()) return [];
  const prompt = [
    `Đây là đoạn chat Zalo giữa ${chu} (giám đốc agency marketing MT Digital) và ${khach || 'một khách hàng'}.`,
    'Rút ra những Ý ĐÁNG NHỚ LÂU DÀI để nhân viên phục vụ khách này tốt hơn, mỗi ý một mục tự hiểu được:',
    '- yêu cầu, mong muốn, sở thích, điều khách KHÔNG thích;',
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
  const doan = dungDoanChat(tin, chu.name || 'Giám đốc', tenKhach);
  const ys = await rutY(doan, tenKhach, chu.name || 'Giám đốc');
  const vaoKho: string[] = [];
  for (const y of ys) {
    const kq = await xetDuaVaoKho(
      { title: y.tieuDe, body: `${y.noiDung}\n\n(Rút từ trao đổi Zalo với ${tenKhach}.)`, customer: tenKhach, source: 'zalo' },
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
 * Rút tri thức cho các cuộc đã bật, đã lắng, có tin mới. Gọi từ nhịp tim của worker (~5 phút) và
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
