// Zalo cá nhân → kho tri thức "có chọn lọc" (anh Tâm 5/10/2026).
//
// Từ 10/10/2026 (anh Tâm: "AI tự đọc sau đó tự học những thứ liên quan đến công việc luôn, không cần
// anh phải duyệt, cái nào phân vân mới tới lượt anh"):
//   1. AI đọc MỌI cuộc (không cần bật "Học"). Chuyện cá nhân → thôi đọc, xoá nội dung đã lưu.
//   2. Cuộc công việc: AI rút ý ĐÁNG NHỚ LÂU, bỏ chào hỏi, OTP, chuyện vặt. Mỗi ý qua bộ phân loại kho
//      nguồn 'zalo': rõ ràng → vào kho luôn; phân vân / trùng mục cũ → chờ giám đốc duyệt.
//   3. Cập nhật khách: khớp/tạo khách trong CRM, thêm điều mới vào "Thông tin khách".
//   4. Việc giám đốc cần làm (khách hỏi báo giá chưa trả lời…) → đặt nhắc hẹn cho giám đốc.
import { aiKhoJson } from '../ai/brainAi.js';
import { dungDoanChat, denLucRut, noiDungTin, goiYTenKhachTuNhom, noiThongTinKhach, nhacGop, ghiChuViecAi, tachViec, gopThemViec, dangDoc, nhomKhongLienQuan, coDauHieuCongViec, type TinZalo } from '../lib/zalo.js';
import { khopKhach, xoaLienHe, chuanTen } from '../lib/brainGate.js';
import {
  ghiNhieuCuoc,
  ghiNhieuTin,
  cuocCanRut,
  tinGanDay,
  danhDauCaNhan,
  danhDauCongViec,
  ghiGhiChuAi,
  hoiAnh,
  cuocCuaKhach,
  viDuAnhQuyet,
  timCuoc,
  tinChuaRut,
  danhDauDaRut,
  donTinCu,
  nhomChuaXet,
  ghiKetQuaXet,
  nhomAiDaChoHoc,
  demNhomAiDaChoHoc,
  DA_LOC_LAI,
  CHUA_RO_THEO_TEN,
  cuocBiLoai,
  moLaiCuoc,
  type ZaloThread,
} from './zalo.repo.js';
import { xetDuaVaoKho, suaMuc, type NguoiGui } from './brainItems.service.js';
import { listItems } from './brainItems.repo.js';
import { getCustomers, upsertCustomer, CLOSED_STATUS, type Customer } from './crm.repo.js';
import { newId } from '../util/id.js';
import { getDirectors, getActiveMembers } from './members.repo.js';
import { findReminder, luuNhacGop, tatNhac, tatNhacTheoTienTo, nhacDangBatTheoTienTo } from './reminders.repo.js';
import { notify } from './notifications.service.js';
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
 * Nhận một lô tin vừa đồng bộ từ Zalo. Lưu nội dung để AI đọc — trừ cuộc đã bị loại (AI thấy là chuyện
 * cá nhân, hoặc anh tự tắt): chỉ đếm số tin, KHÔNG lưu nội dung.
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
  // Một lượt ghi mọi cuộc + một lượt ghi mọi tin (trước đây mỗi cuộc / mỗi tin một lượt — 12/10/2026: tăng tốc).
  const cuoc = [...theoCuoc].map(([threadId, ds]) => {
    const tsMax = Math.max(...ds.map((t) => Number(t.ts) || 0));
    const tenKhach = ds.find((t) => !t.fromSelf && t.threadName)?.threadName || ds.find((t) => t.threadName)?.threadName || '';
    return {
      threadId,
      name: tenKhach,
      isGroup: !!ds[0]!.isGroup,
      soTin: ds.length,
      lastMsgAt: tsMax > 0 ? new Date(tsMax).toISOString() : now,
    };
  });
  const luuCuoc = cuoc.length ? await ghiNhieuCuoc(cuoc, now) : new Map<string, boolean>();
  // Cuộc đang bị loại mà có tin công việc mới → mở lại (lỗi thì bỏ qua, không làm hỏng việc lưu tin).
  for (const id of await moLaiKhiCoViec(theoCuoc, luuCuoc, now).catch(() => [] as string[])) luuCuoc.set(id, true);
  let boQua = 0;
  const tinGhi: TinZalo[] = [];
  for (const [threadId, ds] of theoCuoc) {
    if (!luuCuoc.get(threadId)) {
      boQua += ds.length;
      continue;
    }
    for (const t of ds) {
      const content = noiDungTin(t.content);
      if (!content) continue;
      tinGhi.push({
        msgId: String(t.msgId),
        threadId,
        fromSelf: !!t.fromSelf,
        sender: String(t.sender || '').slice(0, 100),
        content,
        ts: String(Number(t.ts) || Date.now()),
      });
    }
  }
  if (tinGhi.length) await ghiNhieuTin(tinGhi);
  return { luu: tinGhi.length, boQua };
}

/** Mỗi cuộc mở lại nhiều nhất một lần trong khoảng này — tránh tốn AI vì nhóm hay nhắc chữ "thiết kế", "giá"… */
const MO_LAI_CACH_MS = 14 * 24 * 3600 * 1000;

/**
 * Cuộc đang KHÔNG học mà người đó phát sinh công việc (anh Tâm 12/10/2026: "nếu hiện đang không học, người đó sau
 * này phát sinh công việc thì sao"). Tin mới (7 ngày) có dấu hiệu công việc — xét bằng luật, không tốn AI:
 * - AI tự loại → mở lại, AI đọc tin đó và quyết lại (vẫn cá nhân thì AI loại lại, xoá tin);
 * - anh đã tự tắt → không tự đổi, chỉ đưa vào "❓ AI hỏi" kèm thông báo — quyết định của anh thắng AI;
 * - nhóm bị loại theo luật (chợ, chung cư, nhóm đông…) → không bao giờ mở lại.
 * Trả mã các cuộc được lưu tin lần này.
 */
async function moLaiKhiCoViec(theoCuoc: Map<string, TinTuWorker[]>, luuCuoc: Map<string, boolean>, now: string): Promise<string[]> {
  const nowMs = Date.parse(now) || Date.now();
  const nghi = new Map<string, string>();
  for (const [id, ds] of theoCuoc) {
    if (luuCuoc.get(id)) continue;
    const t = ds.find((x) => Number(x.ts) > nowMs - 7 * 24 * 3600 * 1000 && coDauHieuCongViec(noiDungTin(x.content)));
    if (t) nghi.set(id, noiDungTin(t.content).slice(0, 120));
  }
  if (!nghi.size) return [];
  const moi: string[] = [];
  let hoi = 0;
  for (const c of await cuocBiLoai([...nghi.keys()])) {
    if (c.moLaiAt && Date.parse(c.moLaiAt) > nowMs - MO_LAI_CACH_MS) continue;
    if (c.isGroup && (nhomKhongLienQuan(c.name) || /tên nhóm kiểu|nhóm đông/.test(c.aiNote))) continue;
    const trich = nghi.get(c.threadId)!;
    if (c.anhQuyet === 'bo') {
      if (c.aiHoi) continue;
      await moLaiCuoc(c.threadId, { hoiAnh: true, aiNote: `Hỏi anh: anh đã cho bỏ qua, nay có tin công việc mới — "${trich}"`, now });
      hoi++;
    } else {
      const ghiChu = `Mở lại vì có tin công việc mới — "${trich}"`;
      await moLaiCuoc(c.threadId, { hoiAnh: false, aiNote: c.isGroup ? `${CHUA_RO_THEO_TEN} · ${ghiChu}` : ghiChu, now });
    }
    moi.push(c.threadId);
  }
  if (hoi > 0) {
    const chu = (await getDirectors())[0];
    if (chu?.id) {
      await notify(chu.id, {
        type: 'zalo_hoi',
        title: `❓ ${hoi} cuộc Zalo anh đã bỏ qua nay có tin công việc`,
        body: 'Anh xem tin rồi chọn Học hoặc Bỏ qua.',
        url: '/brain?tab=zalo',
      }).catch(() => undefined);
    }
  }
  return moi;
}

const SCHEMA_DOC = {
  type: 'OBJECT',
  properties: {
    loai: { type: 'STRING', enum: ['cong_viec', 'ca_nhan', 'phan_van', 'chua_ro'] },
    lyDo: { type: 'STRING' },
    laNhanSu: { type: 'BOOLEAN' },
    laKhachHang: { type: 'BOOLEAN' },
    tenKhach: { type: 'STRING' },
    nguoiLienHe: { type: 'STRING' },
    tomTat: { type: 'STRING' },
    y: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { tieuDe: { type: 'STRING' }, noiDung: { type: 'STRING' }, khach: { type: 'STRING' } },
        required: ['tieuDe', 'noiDung'],
      },
    },
    boSungKhach: { type: 'STRING' },
    daXong: { type: 'ARRAY', items: { type: 'STRING' } },
    nhac: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { viec: { type: 'STRING' }, han: { type: 'STRING' }, khach: { type: 'STRING' } },
        required: ['viec'],
      },
    },
  },
  required: ['loai', 'y'],
};

export interface KetQuaDoc {
  /** cong_viec: học; ca_nhan: thôi đọc cuộc này; phan_van: hỏi giám đốc; chua_ro: đọc thêm lần sau. */
  loai: 'cong_viec' | 'ca_nhan' | 'phan_van' | 'chua_ro';
  lyDo: string;
  /** Bên kia là nhân sự MT Digital (chat nội bộ) — không bao giờ là khách. */
  laNhanSu: boolean;
  laKhachHang: boolean;
  /** Tên DOANH NGHIỆP / thương hiệu của khách (không phải tên người nhắn). */
  tenKhach: string;
  /** Người nhắn phía khách + vai trò, vd "chị Hồng Thanh — marketing". */
  nguoiLienHe: string;
  tomTat: string;
  /** khach = khách mà ý đó nói về (có thể khác khách của cuộc — vd nhân viên nói về Tín Đạt). */
  y: Array<{ tieuDe: string; noiDung: string; khach: string }>;
  boSungKhach: string;
  nhac: Array<{ viec: string; han: string; khach: string }>;
  /** Mã các mục "riêng giám đốc" đang mở mà chat cho thấy ĐÃ XỬ LÝ (vd khách đã thanh toán). */
  daXong: string[];
}

/**
 * AI đọc MỘT đoạn chat (anh Tâm 10/10/2026: "AI tự đọc sau đó tự học những thứ liên quan đến công việc
 * luôn ... Đọc và cập nhật khách hàng, nội dung khách hàng, lên lịch nhắc cho anh nếu cần, ví dụ khách
 * hỏi báo giá chưa trả lời"). Một lời gọi trả đủ: công việc hay cá nhân, tri thức đáng nhớ, điều mới về
 * khách, việc cần nhắc anh.
 */
/** Ví dụ những cuộc giám đốc đã tự quyết — AI học theo để lần sau tự quyết giống anh. */
export type ViDuQuyet = Array<{ ten: string; nhom: boolean; tomTat: string; quyet: 'hoc' | 'bo'; ghiChu?: string }>;

export function dongViDu(viDu: ViDuQuyet): string[] {
  if (!viDu.length) return [];
  return [
    'GIÁM ĐỐC ĐÃ TỰ QUYẾT những cuộc sau — học theo cách anh ấy chọn (cuộc tương tự thì quyết giống vậy):',
    ...viDu
      .slice(0, 40)
      .map(
        (v) =>
          `- ${v.quyet === 'hoc' ? 'HỌC' : 'BỎ QUA'}: ${v.nhom ? 'nhóm' : 'chat'} «${v.ten}»${v.tomTat ? ` — ${v.tomTat}` : ''}` +
          (v.ghiChu ? ` (giám đốc giải thích: "${v.ghiChu.slice(0, 200)}")` : ''),
      ),
  ];
}

export async function docCuoc(
  doanChat: string,
  o: {
    chu: string;
    ten: string;
    nhom: boolean;
    khachDaGan: string;
    thongTinKhach: string;
    bayGio: string;
    viDu?: ViDuQuyet;
    /** Tên nhân sự MT Digital — để AI biết ai là người trong công ty (anh Tâm 11/10/2026). */
    nhanSu?: string[];
    /** Các việc đang theo dõi với khách này (nhắc gộp hiện có) — AI trả lại danh sách mới nhất. */
    dangTheoDoi?: string;
    /** Lời giám đốc giải thích về cuộc này — AI phải làm theo (anh Tâm 11/10/2026). */
    ghiChuAnh?: string;
    /** Mục "riêng giám đốc" đang mở của khách này (hoá đơn, công nợ, lịch hẹn…) — AI báo cái nào đã xong. */
    viecMo?: Array<{ id: string; tieuDe: string; tomTat: string }>;
  },
): Promise<KetQuaDoc> {
  const rong: KetQuaDoc = {
    loai: 'chua_ro',
    lyDo: '',
    laNhanSu: false,
    laKhachHang: false,
    tenKhach: '',
    nguoiLienHe: '',
    tomTat: '',
    y: [],
    boSungKhach: '',
    nhac: [],
    daXong: [],
  };
  if (!doanChat.trim()) return rong;
  const prompt = [
    o.nhom
      ? `Đây là đoạn chat trong nhóm Zalo «${o.ten}» mà ${o.chu} (giám đốc agency marketing MT Digital) là thành viên. Tên người nói ghi trước dấu hai chấm; "${o.chu}" là giám đốc.`
      : `Đây là đoạn chat Zalo 1-1 giữa ${o.chu} (giám đốc agency marketing MT Digital) và «${o.ten}».`,
    o.khachDaGan ? `Cuộc này đã gắn với khách hàng "${o.khachDaGan}" trong CRM.` : '',
    o.ghiChuAnh ? `GIÁM ĐỐC GIẢI THÍCH VỀ CUỘC NÀY (làm theo đúng như vậy): "${o.ghiChuAnh.slice(0, 500)}"` : '',
    `Bây giờ là ${o.bayGio} (giờ Việt Nam).`,
    o.nhanSu?.length ? `NHÂN SỰ MT DIGITAL (người trong công ty, KHÔNG phải khách): ${o.nhanSu.slice(0, 80).join(', ')}.` : '',
    'Nhận ra nhân sự cả theo VĂN PHONG và NỘI DUNG, kể cả khi tên Zalo khác danh sách: xưng "em" báo cáo / nhận',
    'việc với giám đốc, nói "bên mình", "khách bên …", gửi bản thiết kế / video / bài cho anh duyệt, hỏi cách làm',
    'cho khách. Trong nhóm, xác định từng người nói là nhân sự hay khách theo cách đó.',
    '',
    '1) loai — TỰ QUYẾT, chỉ hỏi giám đốc khi thật sự 50:50:',
    '   "cong_viec": có liên quan công việc của MT Digital (khách hàng, khách tiềm năng hỏi dịch vụ, đối tác, nhà',
    '   cung cấp, nhân viên, việc công ty, kiến thức nghề marketing dùng được cho công ty).',
    '   "ca_nhan": KHÔNG liên quan — gia đình, bạn bè, chuyện riêng; nhóm CHỢ / mua bán / rao vặt / sỉ lẻ / thanh',
    '   lý / săn sale / bất động sản / việc làm / tuyển dụng đông người; quảng cáo, spam, hội nhóm chung chung.',
    '   "phan_van": thật sự 50:50 (vd người quen mà vừa chuyện riêng vừa nhắc việc, nhóm không rõ mục đích) —',
    '   giám đốc sẽ quyết; ghi lyDo ngắn gọn vì sao phân vân.',
    '   "chua_ro": quá ít tin để biết.',
    ...dongViDu(o.viDu || []),
    '2) CHỦ THỂ — xác định đúng bên kia là ai:',
    '   laNhanSu = true nếu bên kia là nhân sự MT Digital (danh sách trên, hoặc chat rõ là nhân viên công ty) →',
    '   chat nội bộ, laKhachHang = false.',
    '   laKhachHang = true nếu bên kia là KHÁCH HÀNG (đang dùng hoặc đang hỏi dịch vụ MT Digital). Đối tác, nhà',
    '   cung cấp thì false.',
    '   tenKhach = TÊN DOANH NGHIỆP / THƯƠNG HIỆU của khách (vd "Tín Đạt Controls", "Welllife"), KHÔNG phải tên',
    '   người nhắn; chỉ khi khách là cá nhân / quán nhỏ không rõ tên thương hiệu mới dùng tên người.',
    '   nguoiLienHe = người nhắn phía khách + vai trò nếu biết (vd "chị Hồng Thanh — phụ trách marketing").',
    '3) tomTat: MỘT câu ngắn cuộc này nói về gì (vd "Khách hỏi báo giá web bán nội thất").',
    '   GOM THEO CHỦ THỂ: mỗi ý / mỗi việc ghi khach = khách hàng (tên doanh nghiệp) mà nó NÓI VỀ — kể cả khi là',
    '   nhân viên nói về khách trong chat nội bộ (vd nhân viên báo "Tín Đạt muốn đổi màu logo" → khach = "Tín Đạt").',
    '   Ý chung của công ty (quy trình, quy định) thì khach = "".',
    '4) y: Ý ĐÁNG NHỚ LÂU DÀI cho công ty, mỗi ý một mục tự hiểu được — yêu cầu, mong muốn, điều khách không',
    '   thích, lưu ý khi làm cho khách (màu sắc, giọng văn, người duyệt, giờ duyệt), điều hai bên đã CHỐT (phạm',
    '   vi, giá, hạn, nghiệm thu), phàn nàn và cách xử lý, thông tin bền vững về doanh nghiệp khách; quy trình,',
    '   quyết định nội bộ nếu là chat công việc với nhân viên. Mỗi ý 1-4 câu, ghi ngày nếu là điều đã chốt.',
    '5) boSungKhach: điều MỚI về khách nên ghi vào hồ sơ CRM (lĩnh vực, sản phẩm, nhu cầu, dịch vụ đang dùng,',
    '   người liên hệ và vai trò) — một câu, KHÔNG số điện thoại/email; không có gì mới thì để trống.',
    o.thongTinKhach ? `   Hồ sơ CRM hiện có: "${o.thongTinKhach.slice(0, 600)}" — đừng lặp lại điều đã có.` : '',
    '6) nhac: DANH SÁCH ĐẦY ĐỦ, MỚI NHẤT các việc giám đốc cần theo dõi với khách/cuộc này (gộp thành MỘT nhắc',
    '   cho mỗi khách). Việc cần theo dõi: khách hỏi báo giá / thông tin mà tin cuối chưa thấy trả lời, hứa gửi',
    '   tài liệu, hẹn gọi lại, chờ khách gửi tư liệu, hạn khách đặt ra.',
    o.dangTheoDoi
      ? `   ĐANG THEO DÕI: "${o.dangTheoDoi.slice(0, 600)}" — giữ việc chưa xong, BỎ việc chat cho thấy đã xong, thêm việc mới.`
      : '',
    '   Mỗi việc: viec (ngắn gọn, KHÔNG lặp tên khách), han = "YYYY-MM-DD HH:mm" lúc nên nhắc (theo hẹn trong',
    '   chat; không rõ thì để trống). Tối đa 5 việc. Hết việc thì nhac = [].',
    ...(o.viecMo?.length
      ? [
          '7) daXong: các LƯU Ý / VIỆC ĐANG MỞ dưới đây của khách này — chat cho thấy đã XỬ LÝ XONG (vd khách đã',
          '   thanh toán / đã xác nhận hoá đơn, đã gửi báo giá, lịch hẹn đã diễn ra) thì ghi mã vào daXong. Chưa chắc',
          '   thì KHÔNG ghi.',
          ...o.viecMo.map((v) => `   [${v.id}] ${v.tieuDe}${v.tomTat ? ` — ${v.tomTat}` : ''}`),
        ]
      : []),
    'Nếu loai khác "cong_viec" thì y, boSungKhach, nhac đều để trống.',
    'BỎ QUA: chào hỏi, cảm ơn, "ok anh", OTP, mật khẩu, số tài khoản, số điện thoại. KHÔNG bịa điều không',
    'có trong đoạn chat. Viết tiếng Việt.',
    '',
    'ĐOẠN CHAT (cũ → mới):',
    doanChat,
  ]
    .filter((d) => d !== '')
    .join('\n');
  const r = await aiKhoJson(prompt, SCHEMA_DOC);
  const loai: KetQuaDoc['loai'] = ['cong_viec', 'ca_nhan', 'phan_van'].includes(r?.loai) ? r.loai : 'chua_ro';
  const chu = (x: unknown, n: number) => String(x ?? '').trim().slice(0, n);
  const hoc = loai === 'cong_viec';
  return {
    loai,
    lyDo: chu(r?.lyDo, 200),
    laNhanSu: !!r?.laNhanSu,
    laKhachHang: !!r?.laKhachHang && !r?.laNhanSu,
    tenKhach: chu(r?.tenKhach, 120),
    nguoiLienHe: chu(r?.nguoiLienHe, 120),
    tomTat: chu(r?.tomTat, 200),
    y: (Array.isArray(r?.y) ? r.y : [])
      .map((x: { tieuDe?: unknown; noiDung?: unknown; khach?: unknown }) => ({
        tieuDe: chu(x?.tieuDe, 200),
        noiDung: chu(x?.noiDung, 2000),
        khach: chu(x?.khach, 120),
      }))
      .filter((x: { tieuDe: string; noiDung: string }) => x.tieuDe && x.noiDung.length >= 10)
      .slice(0, 8),
    boSungKhach: hoc ? chu(r?.boSungKhach, 400) : '',
    daXong: (Array.isArray(r?.daXong) ? r.daXong : []).map((x: unknown) => String(x ?? '').trim()).filter(Boolean).slice(0, 20),
    nhac: !hoc
      ? []
      : (Array.isArray(r?.nhac) ? r.nhac : [])
            .map((x: { viec?: unknown; han?: unknown; khach?: unknown }) => ({ viec: chu(x?.viec, 200), han: chu(x?.han, 20), khach: chu(x?.khach, 120) }))
            .filter((x: { viec: string }) => x.viec.length >= 5)
            .slice(0, 5),
  };
}

/** Mã nhắc gộp: theo khách nếu đã gắn khách, không thì theo cuộc. */
export function khoaNhac(customerId: string | undefined, threadId: string): string {
  return customerId ? `ZR-K-${customerId}` : `ZR-T-${threadId}`;
}

/** Tên trùng một nhân sự công ty (so tên đã chuẩn hoá, bỏ dấu). */
export function laNhanSu(ten: string, nhanSu: string[]): boolean {
  const t = chuanTen(ten || '');
  return !!t && nhanSu.some((n) => chuanTen(n) === t);
}

export interface KetQuaRut {
  y: number;
  vaoKho: string[];
  loai: KetQuaDoc['loai'];
  nhac: number;
}

/**
 * Đọc MỘT cuộc: AI xét công việc hay cá nhân → tri thức qua bộ phân loại kho (nguồn 'zalo': rõ ràng thì
 * vào kho luôn, phân vân thì chờ giám đốc) → bổ sung hồ sơ khách → đặt nhắc việc cho giám đốc.
 */
export async function rutCuoc(c: ZaloThread, chu: NguoiGui, viDu: ViDuQuyet = []): Promise<KetQuaRut> {
  const tin: TinZalo[] = await tinChuaRut(c.threadId);
  if (tin.length === 0) return { y: 0, vaoKho: [], loai: 'chua_ro', nhac: 0 };
  const now = nowTz();
  // Tin mới chỉ là "ok", "dạ", "cảm ơn", sticker → đánh dấu đã đọc, KHÔNG gọi AI (anh Tâm 11/10/2026:
  // "đỡ tốn token đọc tin"). Tin đã đọc không bao giờ đọc lại.
  if (!dangDoc(tin)) {
    await danhDauDaRut(c.threadId, tin.map((t) => t.msgId), now.toISOString());
    return { y: 0, vaoKho: [], loai: 'chua_ro', nhac: 0 };
  }
  const khachDs: Customer[] = await getCustomers().catch(() => []);
  const daGan = c.customerId ? khachDs.find((k) => k.id === c.customerId) : undefined;
  // Cuộc AI chưa xếp loại: đọc cả tin cũ đã xem (lần trước "chưa rõ") làm ngữ cảnh.
  // Chỉ lấy 60 tin gần nhất làm ngữ cảnh — đủ để xếp loại, khỏi tốn token đọc lại cả lịch sử.
  const docTu = c.aiChecked ? tin : await tinGanDay(c.threadId, 60);
  // Nhóm khách có cả lịch sử kéo về (vài trăm tin) → cho AI đọc dài hơn.
  const doan = dungDoanChat(docTu, chu.name || 'Giám đốc', c.customer || c.name, c.isGroup ? 40000 : 15000);
  const nhanSu = (await getActiveMembers().catch(() => [])).map((m) => m.fullName).filter(Boolean);
  // Nhắc gộp: mỗi khách MỘT nhắc (mã theo khách); chưa gắn khách thì theo cuộc.
  const maNhacTruoc = khoaNhac(daGan?.id, c.threadId);
  const nhacCu = await findReminder(maNhacTruoc).catch(() => undefined);
  // Lưu ý / việc riêng đang mở của khách (hoá đơn, công nợ, lịch hẹn…) — AI báo cái nào đã xong để tự gỡ
  // (anh Tâm 11/10/2026: "nếu đã xử lý thì em cập nhật, vd khách đã thanh toán thì bỏ cái lưu ý đó đi").
  const viecMo = daGan
    ? await listItems({ directorScope: true, status: 'published', category: 'rieng', customerId: daGan.id, limit: 20 }).catch(() => [])
    : [];
  const kq = await docCuoc(doan, {
    chu: chu.name || 'Giám đốc',
    ten: c.name || c.customer || 'người nhắn',
    nhom: c.isGroup,
    khachDaGan: daGan?.name || c.customer,
    thongTinKhach: daGan?.info || '',
    bayGio: now.format('HH:mm DD/MM/YYYY'),
    viDu,
    nhanSu,
    dangTheoDoi: nhacCu?.active ? nhacCu.title : '',
    viecMo: viecMo.map((i) => ({ id: i.id, tieuDe: i.title, tomTat: i.summary })),
    ghiChuAnh: c.anhGhiChu,
  });
  // Việc đã xử lý → chuyển sang "đã xong" (lưu trữ), không còn trong tab Riêng anh.
  const moIds = new Set(viecMo.map((i) => i.id));
  for (const id of kq.daXong.filter((x) => moIds.has(x))) {
    await suaMuc(id, { status: 'archived' }, chu).catch((e) => console.warn('[zalo] đánh dấu xong', id, (e as Error).message));
  }
  const xongTin = () => danhDauDaRut(c.threadId, tin.map((t) => t.msgId), now.toISOString());

  // Anh đã tự bật / AI đã xếp là công việc thì không bao giờ tự loại.
  const daChotCongViec = c.enabled;
  if (kq.loai === 'ca_nhan' && !daChotCongViec) {
    await danhDauCaNhan(c.threadId, `Không liên quan công việc — AI thôi đọc${kq.lyDo ? ` (${kq.lyDo})` : ''}`, kq.tomTat);
    return { y: 0, vaoKho: [], loai: 'ca_nhan', nhac: 0 };
  }
  if (kq.loai === 'phan_van' && !daChotCongViec) {
    // 50:50 → hỏi anh; anh quyết xong AI lấy làm ví dụ. Chưa học gì; anh chọn Học thì AI đọc lại tin.
    await hoiAnh(c.threadId, { lyDo: kq.lyDo, tomTat: kq.tomTat });
    await xongTin();
    return { y: 0, vaoKho: [], loai: 'phan_van', nhac: 0 };
  }
  if (kq.loai === 'chua_ro' && !daChotCongViec) {
    // Ít tin quá để biết → không gửi gì vào kho. Đánh dấu đã đọc (khỏi đọc lại mỗi lượt); khi có tin
    // mới, các tin này được đọc lại làm ngữ cảnh (tinGanDay).
    await ghiGhiChuAi(c.threadId, `AI chưa rõ là việc gì — đọc thêm khi có tin mới${kq.tomTat ? ` (${kq.tomTat})` : ''}`);
    await xongTin();
    return { y: 0, vaoKho: [], loai: 'chua_ro', nhac: 0 };
  }

  // Công việc: gắn khách (khớp CRM; khách mới thì tạo khách tiềm năng).
  // Nhân sự công ty (AI nhận ra, hoặc tên trùng nhân sự) → chat nội bộ, không bao giờ thành khách.
  const noiBo = kq.laNhanSu || laNhanSu(kq.tenKhach, nhanSu) || (!c.isGroup && !daGan && laNhanSu(c.name, nhanSu));
  let kh: Customer | undefined = daGan;
  // Tên khách: AI đọc ra, hoặc tên chờ của nhóm khách (xét theo tên nhóm, chưa tạo CRM).
  const tenTao = kq.laKhachHang && kq.tenKhach ? kq.tenKhach : c.isGroup && !c.customerId && c.customer ? c.customer : '';
  if (!kh && !noiBo && tenTao) {
    kh = khopKhach(tenTao, khachDs) || undefined;
    // Chỉ TẠO khách khi có tương tác trong 60 ngày (tin mới nhất đang đọc) — lịch sử cũ kéo về không tính.
    const tinMoiNhat = Math.max(...tin.map((t) => Number(t.ts) || 0));
    const ganDay = now.valueOf() - tinMoiNhat <= 60 * 24 * 3600_000;
    if (!kh && ganDay) {
      const gd = (await getDirectors())[0];
      kh = {
        id: newId('C-'),
        name: tenTao,
        phone: '',
        // Nhóm làm việc riêng với MT Digital mà còn nhắn gần đây → đang là khách; chat 1-1 → khách tiềm năng.
        status: c.isGroup ? CLOSED_STATUS : 'Mới',
        note: `Tạo tự động từ Zalo «${c.name || tenTao}».`,
        info: '',
        assignedTo: gd?.id || chu.id,
        dob: '',
        closedAt: '',
        source: '',
        createdAt: now.toISOString(),
      };
      await upsertCustomer(kh);
    }
  }
  await danhDauCongViec(c.threadId, {
    aiNote: `${noiBo ? 'Nội bộ · nhân sự công ty' : `Công việc${kh ? ` · khách ${kh.name}` : ''}`}${kq.tomTat ? ` — ${kq.tomTat}` : ''}`,
    customerId: kh?.id || '',
    customer: kh?.name || '',
    tomTat: kq.tomTat,
  });

  const tenKhach = kh?.name || c.customer || '';
  const nguon = c.isGroup ? `nhóm Zalo «${c.name || tenKhach}»` : `trao đổi Zalo với ${c.name || tenKhach}`;
  const vaoKho: string[] = [];
  for (const y of kq.y) {
    const r = await xetDuaVaoKho(
      { title: y.tieuDe, body: `${y.noiDung}\n\n(Rút từ ${nguon}.)`, customer: y.khach || tenKhach, source: 'zalo' },
      chu,
    );
    if (r.item) vaoKho.push(r.message);
  }

  // Hồ sơ khách: "Thông tin khách" chỉ THÊM dòng mới (kèm người liên hệ); "Ghi chú" giữ MỘT dòng việc cần
  // theo dõi do AI quản lý. Điều anh đã ghi giữ nguyên.
  const ngay = now.format('YYYY-MM-DD');
  // Việc nói về khách KHÁC (đã có trong CRM) → gộp vào nhắc của khách đó; còn lại là việc của cuộc này.
  const khachKhac = new Map<string, { kh: Customer; viec: Array<{ viec: string; han: string }> }>();
  const viecCuocNay: Array<{ viec: string; han: string; khach: string }> = [];
  for (const v of kq.nhac) {
    const k = v.khach ? khopKhach(v.khach, khachDs) : null;
    if (k && k.id !== kh?.id) {
      const g = khachKhac.get(k.id) || { kh: k, viec: [] };
      g.viec.push(v);
      khachKhac.set(k.id, g);
    } else viecCuocNay.push(v);
  }
  const bayGio = { ngay, gio: now.format('HH:mm') };
  const nhacMoi = nhacGop(kh?.name || c.name || tenKhach || 'Zalo', viecCuocNay, bayGio);
  if (kh) {
    const boSung = [kq.boSungKhach, kq.nguoiLienHe && !kh.info.includes(kq.nguoiLienHe) ? `Người liên hệ: ${kq.nguoiLienHe}.` : '']
      .filter(Boolean)
      .join(' ');
    const info = boSung ? noiThongTinKhach(kh.info, xoaLienHe(boSung).text, ngay) : kh.info;
    const note = ghiChuViecAi(kh.note, viecCuocNay.map((v) => v.viec), ngay);
    if (info !== kh.info || note !== kh.note) await upsertCustomer({ ...kh, info, note });
  }

  // Nhắc việc: MỘT nhắc gộp cho mỗi khách (anh Tâm 11/10/2026), chỉ bắn lại khi nội dung đổi.
  let nhac = 0;
  const maNhac = khoaNhac(kh?.id, c.threadId);
  try {
    const hienCo = maNhac === maNhacTruoc ? nhacCu : await findReminder(maNhac);
    if (nhacMoi) {
      if (!hienCo?.active || hienCo.title !== nhacMoi.title) {
        await luuNhacGop({
          id: maNhac,
          memberId: chu.id,
          title: nhacMoi.title,
          atTime: nhacMoi.atTime,
          repeatKind: 'once',
          onDate: nhacMoi.onDate,
          weekday: 1,
          dayOfMonth: 1,
          active: true,
          lastFired: '',
          createdAt: now.toISOString(),
        });
        nhac = 1;
      }
    } else if (hienCo?.active) {
      await tatNhac(maNhac); // hết việc cần theo dõi
    }
    // Dọn: nhắc theo cuộc khi đã gắn được khách, và nhắc lẻ kiểu cũ (ZR-<cuộc>-<tin>-<i>).
    if (maNhac !== maNhacTruoc) await tatNhac(maNhacTruoc);
    for (const { kh: k, viec } of khachKhac.values()) {
      const ma = khoaNhac(k.id, '');
      const cu = await findReminder(ma);
      const gop = gopThemViec(cu?.active ? cu.title : '', k.name, viec, bayGio);
      if (!gop || (cu?.active && cu.title === gop.title)) continue;
      await luuNhacGop({
        id: ma,
        memberId: chu.id,
        title: gop.title,
        atTime: gop.atTime,
        repeatKind: 'once',
        onDate: gop.onDate,
        weekday: 1,
        dayOfMonth: 1,
        active: true,
        lastFired: '',
        createdAt: now.toISOString(),
      });
      const note = ghiChuViecAi(k.note, tachViec(gop.title), ngay);
      if (note !== k.note) await upsertCustomer({ ...k, note });
      nhac++;
    }
    await tatNhacTheoTienTo(`ZR-${c.threadId}-`);
  } catch (e) {
    console.warn('[zalo] nhắc gộp', (e as Error).message);
  }

  await xongTin();
  return { y: kq.y.length, vaoKho, loai: 'cong_viec', nhac };
}

let dangRut = false;
let lanRutCuoi = 0;

/**
 * AI đọc các cuộc có tin mới (mọi cuộc chưa bị loại, không cần anh bật), đã lắng. Mỗi lượt vài cuộc —
 * máy chủ chỉ sống 60 giây; ban đêm cron gọi lặp tới khi hết.
 */
export async function rutTriThucZalo(
  opts: { epNgay?: boolean; threadId?: string; limit?: number; han?: number } = {},
): Promise<{ cuoc: number; y: number; nhac: number; caNhan: number; hoi: number; loi: string }> {
  const rong = { cuoc: 0, y: 0, nhac: 0, caNhan: 0, hoi: 0, loi: '' };
  if (dangRut) return rong;
  if (!opts.epNgay && Date.now() - lanRutCuoi < 4 * 60_000) return rong;
  dangRut = true;
  lanRutCuoi = Date.now();
  try {
    const gd = (await getDirectors())[0];
    const chu: NguoiGui = { id: gd?.id || '', name: gd?.fullName || 'Giám đốc', role: 'director', teamId: '' };
    const ds = opts.threadId ? [await timCuoc(opts.threadId)].filter((x): x is ZaloThread => !!x) : await cuocCanRut(60);
    const now = Date.now();
    const canRut = ds
      .filter((c) => denLucRut({ chuaRut: c.chuaRut, lastMsgAt: c.lastMsgAt, now, epNgay: opts.epNgay }))
      .slice(0, opts.limit ?? 3);
    const kq = { ...rong };
    const viDu = canRut.length ? await viDuAnhQuyet(40).catch(() => []) : [];
    for (const c of canRut) {
      // Có hạn giờ (nút "Đọc & phân loại ngay"): hết giờ thì dừng, lượt sau đọc tiếp.
      if (opts.han && Date.now() > opts.han) break;
      try {
        const r = await rutCuoc(c, chu, viDu);
        kq.cuoc++;
        kq.y += r.y;
        kq.nhac += r.nhac;
        if (r.loai === 'ca_nhan') kq.caNhan++;
        if (r.loai === 'phan_van') kq.hoi++;
      } catch (e) {
        const m = (e as Error).message;
        console.warn('[zalo] rút tri thức', c.threadId, m);
        // AI hết lượt → dừng luôn, đọc tiếp cũng chỉ lỗi.
        if (/429|quota|RESOURCE_EXHAUSTED|rate.?limit|overloaded/i.test(m)) {
          kq.loi = m.slice(0, 200);
          break;
        }
      }
    }
    if (kq.hoi > 0 && chu.id) {
      await notify(chu.id, {
        type: 'zalo_hoi',
        title: `❓ AI cần anh quyết ${kq.hoi} cuộc Zalo`,
        body: 'AI phân vân không biết có liên quan công việc không — anh chọn Học hoặc Bỏ qua, lần sau AI tự quyết theo.',
        url: '/brain?tab=zalo',
      }).catch(() => undefined);
    }
    await donTinCu(now - 30 * 24 * 3600 * 1000).catch(() => undefined);
    return kq;
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
          loai: { type: 'STRING', enum: ['khach', 'cong_viec', 'khac', 'chua_ro'] },
          laNhomKhach: { type: 'BOOLEAN' },
          tenKhach: { type: 'STRING' },
          lyDo: { type: 'STRING' },
        },
        required: ['id', 'loai'],
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
  /** khach: nhóm làm việc với một khách; cong_viec: nhóm công việc khác (nội bộ, đối tác);
   *  khac: không liên quan công việc; chua_ro: tên nhóm không đủ để biết → AI đọc tin rồi xét. */
  loai: 'khach' | 'cong_viec' | 'khac' | 'chua_ro';
  laNhomKhach: boolean;
  tenKhach: string;
  lyDo: string;
}

/** Nhờ AI xét một lô nhóm: nhóm nào là nhóm làm việc với KHÁCH HÀNG, tên khách là gì. */
export async function xetNhom(dsVao: NhomCanXet[], tenKhachCRM: string[], viDu: ViDuQuyet = []): Promise<Map<string, KetLuanNhom>> {
  let ds = dsVao;
  const kq = new Map<string, KetLuanNhom>();
  // Lọc RẺ trước (luật theo tên / số thành viên — không tốn lượt AI); chỉ nhóm còn lại mới gửi AI (12/10/2026).
  const conLai: NhomCanXet[] = [];
  for (const n of ds) {
    const lyDo = nhomKhongLienQuan(n.name, n.moTa || '');
    if (lyDo) kq.set(n.threadId, { loai: 'khac', laNhomKhach: false, tenKhach: '', lyDo });
    else conLai.push(n);
  }
  ds = conLai;
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
    'Với mỗi nhóm dưới đây, xếp loai:',
    '- "khach": NHÓM LÀM VIỆC VỚI MỘT KHÁCH HÀNG. Quy ước đặt tên "TÊN KH - MT DIGITAL" (khi đúng quy ước có',
    '  sẵn "goiYTenKhach"); một số nhóm khách đặt tên khác (vd "Dự án web ABC", "Savax x MT", "Ads Quốc Phong").',
    '- "cong_viec": CHỈ nhóm mà công ty học được cách làm việc — nội bộ triển khai dự án / phòng ban của MT Digital',
    '  (Ads, SEO, Content, thiết kế, video), hoặc đối tác / nhà cung cấp đang làm CHUNG dự án cho khách.',
    '- "khac": mọi nhóm còn lại — giám đốc muốn TIẾT KIỆM, không cho AI đọc nhóm thừa. Gồm: gia đình, bạn bè, lớp',
    '  học, khoá học; nhóm CHỢ / mua bán / rao vặt / sỉ lẻ / thanh lý / săn sale / bất động sản / việc làm / tuyển',
    '  dụng; hội nhóm cộng đồng, nhóm KẾT NỐI / liên minh / networking (kể cả BNI), CLB; sự kiện một lần (team',
    '  building, tiệc, chung kết, YEP); việc hành chính vặt (BHXH, mở tài khoản ngân hàng, sửa máy tính, tài khoản',
    '  phần mềm); chung cư, ban quản trị, cư dân; nhóm chỉ vài người nói chuyện riêng.',
    '- "chua_ro": tên và mô tả thật sự không đủ để biết (AI sẽ đọc tin nhắn rồi xét sau). Nghiêng về "khac" nếu',
    '  không có dấu hiệu làm việc với khách / dự án.',
    '- tenKhach (chỉ khi "khach"): tên doanh nghiệp/thương hiệu của khách, viết gọn như khách hay dùng. Trùng',
    '  với một khách đã có trong CRM (danh sách dưới) thì ghi ĐÚNG tên trong CRM.',
    '- lyDo: một câu ngắn tiếng Việt.',
    ...dongViDu(viDu.filter((v) => v.nhom)),
    '',
    'KHÁCH ĐÃ CÓ TRONG CRM:',
    tenKhachCRM.slice(0, 400).join(' | ') || '(chưa có)',
    '',
    'CÁC NHÓM (mỗi dòng một JSON):',
    ...dong,
  ].join('\n');
  const r = await aiKhoJson(prompt, SCHEMA_NHOM);
  const hopLe = new Set(ds.map((n) => n.threadId));
  for (const x of Array.isArray(r?.nhom) ? r.nhom : []) {
    const id = String(x?.id || '');
    if (!hopLe.has(id)) continue;
    const loai: KetLuanNhom['loai'] = ['khach', 'cong_viec', 'khac', 'chua_ro'].includes(x.loai)
      ? x.loai
      : x.laNhomKhach
        ? 'khach'
        : 'khac';
    kq.set(id, {
      loai,
      laNhomKhach: loai === 'khach',
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
export async function xacDinhNhomKhach(limit = 40): Promise<{ xet: number; nhomKhach: number }> {
  const ds = await nhomChuaXet(limit);
  if (ds.length === 0) return { xet: 0, nhomKhach: 0 };
  const khach: Customer[] = await getCustomers();
  // Nhóm chưa xét: ai_note đang tạm giữ "số thành viên · mô tả nhóm" (zalo.repo.ghiDanhSachNhom).
  const kl = await xetNhom(
    ds.map((n) => ({ threadId: n.threadId, name: n.name, moTa: n.aiNote })),
    khach.map((c) => c.name),
    await viDuAnhQuyet(40).catch(() => []),
  );
  let nhomKhach = 0;
  for (const n of ds) {
    const k = kl.get(n.threadId);
    if (!k) continue;
    if (k.loai === 'cong_viec') {
      await danhDauCongViec(n.threadId, { aiNote: `Nhóm công việc${k.lyDo ? ` — ${k.lyDo}` : ''}`, customerId: '', customer: '' });
      continue;
    }
    if (k.loai === 'chua_ro') {
      // Không xét lại theo tên nữa; AI đọc tin nhắn của nhóm (rutCuoc) rồi tự xếp.
      await ghiGhiChuAi(n.threadId, `${CHUA_RO_THEO_TEN} — AI sẽ đọc tin nhắn để xét${k.lyDo ? ` (${k.lyDo})` : ''}`);
      continue;
    }
    const ten = k.laNhomKhach ? k.tenKhach || goiYTenKhachTuNhom(n.name).ten : '';
    if (!ten) {
      await ghiKetQuaXet(n.threadId, {
        aiNote: `Không liên quan công việc — AI thôi đọc${k.lyDo ? ` (${k.lyDo})` : ''}`,
        laNhomKhach: false,
        customerId: '',
        customer: '',
      });
      continue;
    }
    // KHÔNG tạo khách chỉ vì tên nhóm (anh Tâm 11/10/2026: 117 khách "Đã chốt" tạo theo tên nhóm đa phần
    // sai — "chỉ lấy khách hàng có tương tác gần đây, lâu rồi không tương tác đa phần đã ngưng dịch vụ").
    // Có sẵn trong CRM thì gắn; chưa có thì ghi tên chờ — khi AI đọc thấy tin trong 60 ngày mới tạo (rutCuoc).
    const kh: Customer | null = khopKhach(ten, khach);
    let ghiChu = kh ? `Nhóm khách → ${ten} (đã có trong CRM)` : `Nhóm khách → ${ten} (chưa tạo trong CRM — chờ có tương tác gần đây)`;
    if (k.lyDo) ghiChu += ` — ${k.lyDo}`;
    await ghiKetQuaXet(n.threadId, { aiNote: ghiChu, laNhomKhach: true, customerId: kh?.id || '', customer: kh?.name || ten });
    nhomKhach++;
  }
  return { xet: kl.size, nhomKhach };
}

/**
 * Dọn nhắc lẻ kiểu cũ (mỗi việc một nhắc, mã "ZR-<cuộc>-<tin>-<i>") thành MỘT nhắc gộp mỗi khách (anh Tâm
 * 11/10/2026: "1 khách hàng có rất nhiều thông báo ... 1 khách hàng 1 thông báo"). Chạy lại vô hại.
 */
export async function gopNhacCu(): Promise<{ gop: number; khach: number }> {
  const cu = (await nhacDangBatTheoTienTo('ZR-')).filter((x) => /^ZR-\d+-/.test(x.id));
  if (!cu.length) return { gop: 0, khach: 0 };
  const now = nowTz();
  const bayGio = { ngay: now.format('YYYY-MM-DD'), gio: now.format('HH:mm') };
  const khachDs: Customer[] = await getCustomers().catch(() => []);
  const theoMa = new Map<string, { ten: string; kh?: Customer; viec: Array<{ viec: string; han: string }>; ids: string[]; memberId: string }>();
  for (const n of cu) {
    const threadId = /^ZR-(\d+)-/.exec(n.id)![1]!;
    const c = await timCuoc(threadId);
    const kh = c?.customerId ? khachDs.find((k) => k.id === c.customerId) : undefined;
    const ma = khoaNhac(kh?.id, threadId);
    const ten = kh?.name || c?.name || /\(Zalo: ([^)]*)\)$/.exec(n.title)?.[1] || 'Zalo';
    const g = theoMa.get(ma) || { ten, kh, viec: [], ids: [], memberId: n.memberId };
    g.viec.push({ viec: n.title.replace(/\s*\(Zalo: [^)]*\)$/, ''), han: n.onDate ? `${n.onDate} ${n.atTime}` : '' });
    g.ids.push(n.id);
    theoMa.set(ma, g);
  }
  for (const [ma, g] of theoMa) {
    const dang = await findReminder(ma);
    const gop = gopThemViec(dang?.active ? dang.title : '', g.ten, g.viec, bayGio);
    if (gop) {
      await luuNhacGop({
        id: ma,
        memberId: g.memberId,
        title: gop.title,
        atTime: gop.atTime,
        repeatKind: 'once',
        onDate: gop.onDate,
        weekday: 1,
        dayOfMonth: 1,
        active: true,
        lastFired: '',
        createdAt: now.toISOString(),
      });
      if (g.kh) {
        const note = ghiChuViecAi(g.kh.note, tachViec(gop.title), bayGio.ngay);
        if (note !== g.kh.note) await upsertCustomer({ ...g.kh, note });
      }
    }
    for (const id of g.ids) await tatNhac(id);
  }
  return { gop: cu.length, khach: theoMa.size };
}

const SCHEMA_XET_NHAC = {
  type: 'OBJECT',
  properties: {
    con: {
      type: 'ARRAY',
      items: { type: 'OBJECT', properties: { viec: { type: 'STRING' }, han: { type: 'STRING' } }, required: ['viec'] },
    },
  },
  required: ['con'],
};

export type KetQuaXetNhac = { ket: 'giu' } | { ket: 'xong' } | { ket: 'doi' } | { ket: 'moi'; title: string };

/**
 * Ngay trước khi bắn nhắc gộp của một khách, AI đọc lại chat gần nhất của khách đó và bỏ việc đã xong /
 * đã chốt, cập nhật việc theo tin mới (anh Tâm 11/10/2026: "c Hồng Thanh đã giải quyết và hẹn T2 gửi clip,
 * phương án lồng tiếng 50 đô đã chốt mà giờ còn nhắc lại").
 *   - 'xong': hết việc → tắt nhắc, không bắn;   - 'doi': mọi việc còn lại đều có hẹn sau → dời nhắc;
 *   - 'moi': bắn với danh sách mới;              - 'giu': không có tin / AI lỗi → bắn như cũ.
 */
export async function xetLaiNhacZalo(r: { id: string; title: string; memberId: string }): Promise<KetQuaXetNhac> {
  const mK = /^ZR-K-(.+)$/.exec(r.id);
  const mT = /^ZR-T-(.+)$/.exec(r.id);
  if (!mK && !mT) return { ket: 'giu' };
  const khachDs: Customer[] = await getCustomers().catch(() => []);
  const kh = mK ? khachDs.find((k) => k.id === mK[1]) : undefined;
  const cuoc = mK ? await cuocCuaKhach(mK[1]!) : [await timCuoc(mT![1]!)].filter((x): x is ZaloThread => !!x);
  const tin: TinZalo[] = [];
  for (const c of cuoc.slice(0, 6)) tin.push(...(await tinGanDay(c.threadId, 60)));
  if (!tin.length) return { ket: 'giu' };
  const gd = (await getDirectors())[0];
  const ten = kh?.name || cuoc[0]?.name || 'khách';
  const doan = dungDoanChat(tin, gd?.fullName || 'Giám đốc', ten, 20000);
  const now = nowTz();
  const prompt = [
    `Giám đốc agency MT Digital đang theo dõi các việc sau với ${ten}: "${r.title}".`,
    `Bây giờ là ${now.format('HH:mm DD/MM/YYYY')} (giờ Việt Nam). Đọc đoạn chat gần nhất bên dưới và trả về con = các việc`,
    'CÒN CẦN LÀM: BỎ việc đã xong / đã trả lời / đã chốt (vd khách đã đồng ý phương án, đã thanh toán, đã nhận file);',
    'CẬP NHẬT việc theo tin mới (vd khách hẹn thứ Hai gửi clip → "Nhận / nhắc gửi clip" với han là thứ Hai đó).',
    'Mỗi việc: viec ngắn gọn (không lặp tên khách), han = "YYYY-MM-DD HH:mm" nếu có hẹn cụ thể, không thì để trống.',
    'Hết việc thì con = []. KHÔNG bịa việc không có trong chat hoặc danh sách.',
    '',
    'ĐOẠN CHAT (cũ → mới):',
    doan,
  ].join('\n');
  let con: Array<{ viec: string; han: string }>;
  try {
    const kq = await aiKhoJson(prompt, SCHEMA_XET_NHAC);
    con = (Array.isArray(kq?.con) ? kq.con : [])
      .map((x: { viec?: unknown; han?: unknown }) => ({ viec: String(x?.viec ?? '').trim().slice(0, 200), han: String(x?.han ?? '').trim().slice(0, 20) }))
      .filter((x: { viec: string }) => x.viec.length >= 5)
      .slice(0, 5);
  } catch (e) {
    console.warn('[zalo] xét lại nhắc', r.id, (e as Error).message);
    return { ket: 'giu' };
  }
  const ngay = now.format('YYYY-MM-DD');
  const bayGio = { ngay, gio: now.format('HH:mm') };
  if (kh) {
    const note = ghiChuViecAi(kh.note, con.map((v) => v.viec), ngay);
    if (note !== kh.note) await upsertCustomer({ ...kh, note }).catch(() => undefined);
  }
  if (!con.length) return { ket: 'xong' };
  const moi = nhacGop(ten, con, bayGio)!;
  // Mọi việc đều có hẹn cụ thể ở tương lai → dời nhắc tới hẹn sớm nhất, chưa bắn bây giờ.
  const hienTai = `${ngay} ${bayGio.gio}`;
  const henSau = con.every((v) => /^\d{4}-\d{2}-\d{2} \d{1,2}:\d{2}$/.test(v.han) && v.han > hienTai);
  if (henSau) {
    await luuNhacGop({
      id: r.id,
      memberId: r.memberId,
      title: moi.title,
      atTime: moi.atTime,
      repeatKind: 'once',
      onDate: moi.onDate,
      weekday: 1,
      dayOfMonth: 1,
      active: true,
      lastFired: '',
      createdAt: now.toISOString(),
    });
    return { ket: 'doi' };
  }
  return { ket: 'moi', title: moi.title };
}

/**
 * "🧹 Lọc lại nhóm" (anh Tâm 12/10/2026: "lọc bỏ các nhóm không liên quan sẽ tiết kiệm được rất nhiều"): xét lại
 * các nhóm AI đã TỰ cho học theo tiêu chí chặt (luật rẻ trước, rồi AI theo tên). Không liên quan / không rõ → thôi
 * học, xoá tin đã lưu. Nhóm anh đã tự quyết thì không đụng. Mỗi lượt vài lô tới `han` (ms).
 */
export async function locLaiNhom(han: number): Promise<{ xet: number; giu: number; bo: number; conLai: number }> {
  const kq = { xet: 0, giu: 0, bo: 0, conLai: 0 };
  const khach: Customer[] = await getCustomers().catch(() => []);
  const viDu = await viDuAnhQuyet(40).catch(() => []);
  while (Date.now() < han) {
    const ds = await nhomAiDaChoHoc(40);
    if (!ds.length) break;
    const kl = await xetNhom(
      ds.map((n) => ({ threadId: n.threadId, name: n.name, moTa: n.tomTat })),
      khach.map((c) => c.name),
      viDu,
    );
    if (!kl.size) break; // AI không trả gì (hết lượt?) — dừng, lượt sau thử lại
    for (const n of ds) {
      const k = kl.get(n.threadId);
      if (!k) continue;
      kq.xet++;
      if (k.loai === 'khach' || k.loai === 'cong_viec') {
        await ghiGhiChuAi(n.threadId, `${n.aiNote} ${DA_LOC_LAI}`.trim());
        kq.giu++;
      } else {
        await ghiKetQuaXet(n.threadId, {
          aiNote: `Không liên quan công việc — AI thôi đọc${k.lyDo ? ` (${k.lyDo})` : ''} ${DA_LOC_LAI}`,
          laNhomKhach: false,
          customerId: '',
          customer: '',
        });
        kq.bo++;
      }
    }
  }
  kq.conLai = await demNhomAiDaChoHoc();
  return kq;
}
