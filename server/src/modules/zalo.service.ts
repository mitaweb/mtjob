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
import { dungDoanChat, denLucRut, noiDungTin, goiYTenKhachTuNhom, gioNhac, noiThongTinKhach, type TinZalo } from '../lib/zalo.js';
import { khopKhach, xoaLienHe } from '../lib/brainGate.js';
import {
  ghiCuoc,
  ghiTin,
  cuocCanRut,
  tinGanDay,
  danhDauCaNhan,
  danhDauCongViec,
  ghiGhiChuAi,
  hoiAnh,
  viDuAnhQuyet,
  timCuoc,
  tinChuaRut,
  danhDauDaRut,
  donTinCu,
  nhomChuaXet,
  ghiKetQuaXet,
  CHUA_RO_THEO_TEN,
  type ZaloThread,
} from './zalo.repo.js';
import { xetDuaVaoKho, type NguoiGui } from './brainItems.service.js';
import { getCustomers, upsertCustomer, CLOSED_STATUS, type Customer } from './crm.repo.js';
import { newId } from '../util/id.js';
import { getDirectors } from './members.repo.js';
import { addReminder } from './reminders.repo.js';
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

const SCHEMA_DOC = {
  type: 'OBJECT',
  properties: {
    loai: { type: 'STRING', enum: ['cong_viec', 'ca_nhan', 'phan_van', 'chua_ro'] },
    lyDo: { type: 'STRING' },
    laKhachHang: { type: 'BOOLEAN' },
    tenKhach: { type: 'STRING' },
    tomTat: { type: 'STRING' },
    y: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { tieuDe: { type: 'STRING' }, noiDung: { type: 'STRING' } },
        required: ['tieuDe', 'noiDung'],
      },
    },
    boSungKhach: { type: 'STRING' },
    nhac: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { viec: { type: 'STRING' }, han: { type: 'STRING' } },
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
  laKhachHang: boolean;
  tenKhach: string;
  tomTat: string;
  y: Array<{ tieuDe: string; noiDung: string }>;
  boSungKhach: string;
  nhac: Array<{ viec: string; han: string }>;
}

/**
 * AI đọc MỘT đoạn chat (anh Tâm 10/10/2026: "AI tự đọc sau đó tự học những thứ liên quan đến công việc
 * luôn ... Đọc và cập nhật khách hàng, nội dung khách hàng, lên lịch nhắc cho anh nếu cần, ví dụ khách
 * hỏi báo giá chưa trả lời"). Một lời gọi trả đủ: công việc hay cá nhân, tri thức đáng nhớ, điều mới về
 * khách, việc cần nhắc anh.
 */
/** Ví dụ những cuộc giám đốc đã tự quyết — AI học theo để lần sau tự quyết giống anh. */
export type ViDuQuyet = Array<{ ten: string; nhom: boolean; tomTat: string; quyet: 'hoc' | 'bo' }>;

export function dongViDu(viDu: ViDuQuyet): string[] {
  if (!viDu.length) return [];
  return [
    'GIÁM ĐỐC ĐÃ TỰ QUYẾT những cuộc sau — học theo cách anh ấy chọn (cuộc tương tự thì quyết giống vậy):',
    ...viDu.slice(0, 40).map((v) => `- ${v.quyet === 'hoc' ? 'HỌC' : 'BỎ QUA'}: ${v.nhom ? 'nhóm' : 'chat'} «${v.ten}»${v.tomTat ? ` — ${v.tomTat}` : ''}`),
  ];
}

export async function docCuoc(
  doanChat: string,
  o: { chu: string; ten: string; nhom: boolean; khachDaGan: string; thongTinKhach: string; bayGio: string; viDu?: ViDuQuyet },
): Promise<KetQuaDoc> {
  const rong: KetQuaDoc = { loai: 'chua_ro', lyDo: '', laKhachHang: false, tenKhach: '', tomTat: '', y: [], boSungKhach: '', nhac: [] };
  if (!doanChat.trim()) return rong;
  const prompt = [
    o.nhom
      ? `Đây là đoạn chat trong nhóm Zalo «${o.ten}» mà ${o.chu} (giám đốc agency marketing MT Digital) là thành viên. Tên người nói ghi trước dấu hai chấm; "${o.chu}" là giám đốc.`
      : `Đây là đoạn chat Zalo 1-1 giữa ${o.chu} (giám đốc agency marketing MT Digital) và «${o.ten}».`,
    o.khachDaGan ? `Cuộc này đã gắn với khách hàng "${o.khachDaGan}" trong CRM.` : '',
    `Bây giờ là ${o.bayGio} (giờ Việt Nam).`,
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
    '2) laKhachHang + tenKhach: người/nhóm bên kia có phải KHÁCH HÀNG (đang dùng hoặc đang hỏi dịch vụ của MT',
    '   Digital) không; tenKhach = tên doanh nghiệp/thương hiệu nếu biết, không thì tên người. Đối tác, nhân viên,',
    '   nhà cung cấp thì laKhachHang = false.',
    '3) tomTat: MỘT câu ngắn cuộc này nói về gì (vd "Khách hỏi báo giá web bán nội thất").',
    '4) y: Ý ĐÁNG NHỚ LÂU DÀI cho công ty, mỗi ý một mục tự hiểu được — yêu cầu, mong muốn, điều khách không',
    '   thích, lưu ý khi làm cho khách (màu sắc, giọng văn, người duyệt, giờ duyệt), điều hai bên đã CHỐT (phạm',
    '   vi, giá, hạn, nghiệm thu), phàn nàn và cách xử lý, thông tin bền vững về doanh nghiệp khách; quy trình,',
    '   quyết định nội bộ nếu là chat công việc với nhân viên. Mỗi ý 1-4 câu, ghi ngày nếu là điều đã chốt.',
    '5) boSungKhach: điều MỚI về khách nên ghi vào hồ sơ CRM (lĩnh vực, sản phẩm, nhu cầu, dịch vụ đang dùng,',
    '   người liên hệ và vai trò) — một câu, KHÔNG số điện thoại/email; không có gì mới thì để trống.',
    o.thongTinKhach ? `   Hồ sơ CRM hiện có: "${o.thongTinKhach.slice(0, 600)}" — đừng lặp lại điều đã có.` : '',
    '6) nhac: việc GIÁM ĐỐC cần làm mà có vẻ CHƯA làm — vd khách hỏi báo giá / hỏi thông tin mà tin cuối',
    '   chưa thấy trả lời, hứa gửi tài liệu, hẹn gọi lại, hạn khách đặt ra. Mỗi việc: viec (ngắn, có tên khách),',
    '   han = "YYYY-MM-DD HH:mm" lúc nên nhắc (theo hẹn trong chat; không rõ thì để trống). Đã trả lời / đã',
    '   xong rồi thì KHÔNG nhắc. Không có thì nhac = [].',
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
    laKhachHang: !!r?.laKhachHang,
    tenKhach: chu(r?.tenKhach, 120),
    tomTat: chu(r?.tomTat, 200),
    y: (Array.isArray(r?.y) ? r.y : [])
      .map((x: { tieuDe?: unknown; noiDung?: unknown }) => ({ tieuDe: chu(x?.tieuDe, 200), noiDung: chu(x?.noiDung, 2000) }))
      .filter((x: { tieuDe: string; noiDung: string }) => x.tieuDe && x.noiDung.length >= 10)
      .slice(0, 8),
    boSungKhach: hoc ? chu(r?.boSungKhach, 400) : '',
    nhac: !hoc
      ? []
      : (Array.isArray(r?.nhac) ? r.nhac : [])
            .map((x: { viec?: unknown; han?: unknown }) => ({ viec: chu(x?.viec, 200), han: chu(x?.han, 20) }))
            .filter((x: { viec: string }) => x.viec.length >= 5)
            .slice(0, 3),
  };
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
  const khachDs: Customer[] = await getCustomers().catch(() => []);
  const daGan = c.customerId ? khachDs.find((k) => k.id === c.customerId) : undefined;
  // Cuộc AI chưa xếp loại: đọc cả tin cũ đã xem (lần trước "chưa rõ") làm ngữ cảnh.
  const docTu = c.aiChecked ? tin : await tinGanDay(c.threadId, 200);
  // Nhóm khách có cả lịch sử kéo về (vài trăm tin) → cho AI đọc dài hơn.
  const doan = dungDoanChat(docTu, chu.name || 'Giám đốc', c.customer || c.name, c.isGroup ? 40000 : 15000);
  const kq = await docCuoc(doan, {
    chu: chu.name || 'Giám đốc',
    ten: c.name || c.customer || 'người nhắn',
    nhom: c.isGroup,
    khachDaGan: daGan?.name || c.customer,
    thongTinKhach: daGan?.info || '',
    bayGio: now.format('HH:mm DD/MM/YYYY'),
    viDu,
  });
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
  let kh: Customer | undefined = daGan;
  if (!kh && kq.laKhachHang && kq.tenKhach) {
    kh = khopKhach(kq.tenKhach, khachDs) || undefined;
    if (!kh) {
      const gd = (await getDirectors())[0];
      kh = {
        id: newId('C-'),
        name: kq.tenKhach,
        phone: '',
        status: 'Mới',
        note: `Tạo tự động từ Zalo «${c.name || kq.tenKhach}».`,
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
    aiNote: `Công việc${kh ? ` · khách ${kh.name}` : ''}${kq.tomTat ? ` — ${kq.tomTat}` : ''}`,
    customerId: kh?.id || '',
    customer: kh?.name || '',
    tomTat: kq.tomTat,
  });

  const tenKhach = kh?.name || c.customer || '';
  const nguon = c.isGroup ? `nhóm Zalo «${c.name || tenKhach}»` : `trao đổi Zalo với ${c.name || tenKhach}`;
  const vaoKho: string[] = [];
  for (const y of kq.y) {
    const r = await xetDuaVaoKho(
      { title: y.tieuDe, body: `${y.noiDung}\n\n(Rút từ ${nguon}.)`, customer: tenKhach, source: 'zalo' },
      chu,
    );
    if (r.item) vaoKho.push(r.message);
  }

  // Hồ sơ khách: chỉ THÊM dòng mới, không sửa điều anh đã ghi.
  if (kh && kq.boSungKhach) {
    const info = noiThongTinKhach(kh.info, xoaLienHe(kq.boSungKhach).text, now.format('YYYY-MM-DD'));
    if (info !== kh.info) await upsertCustomer({ ...kh, info });
  }

  // Nhắc việc cho giám đốc.
  let nhac = 0;
  for (const [i, n] of kq.nhac.entries()) {
    const gio = gioNhac(n.han, { ngay: now.format('YYYY-MM-DD'), gio: now.format('HH:mm') });
    try {
      await addReminder({
        id: `ZR-${c.threadId}-${tin[tin.length - 1]!.msgId}-${i}`.slice(0, 120),
        memberId: chu.id,
        title: `${n.viec} (Zalo: ${c.name || tenKhach})`.slice(0, 200),
        atTime: gio.atTime,
        repeatKind: 'once',
        onDate: gio.onDate,
        weekday: 1,
        dayOfMonth: 1,
        active: true,
        lastFired: '',
        createdAt: now.toISOString(),
      });
      nhac++;
    } catch (e) {
      console.warn('[zalo] đặt nhắc', (e as Error).message); // trùng mã = đã đặt ở lượt trước
    }
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
export async function xetNhom(ds: NhomCanXet[], tenKhachCRM: string[], viDu: ViDuQuyet = []): Promise<Map<string, KetLuanNhom>> {
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
    'Với mỗi nhóm dưới đây, xếp loai:',
    '- "khach": NHÓM LÀM VIỆC VỚI MỘT KHÁCH HÀNG. Quy ước đặt tên "TÊN KH - MT DIGITAL" (khi đúng quy ước có',
    '  sẵn "goiYTenKhach"); một số nhóm khách đặt tên khác (vd "Dự án web ABC", "Savax x MT", "Ads Quốc Phong").',
    '- "cong_viec": nhóm công việc nhưng không phải của một khách — nội bộ nhân viên MT Digital, đối tác, nhà',
    '  cung cấp, dự án chung.',
    '- "khac": không liên quan công việc — gia đình, bạn bè, lớp học; nhóm CHỢ / mua bán / rao vặt / sỉ lẻ /',
    '  thanh lý / săn sale / bất động sản / việc làm / tuyển dụng; hội nhóm cộng đồng đông người, chia sẻ chung',
    '  chung. Những nhóm này AI KHÔNG đọc tin luôn.',
    '- "chua_ro": tên và mô tả không đủ để biết (AI sẽ đọc tin nhắn rồi xét sau).',
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
export async function xacDinhNhomKhach(limit = 40): Promise<{ xet: number; nhomKhach: number; khachMoi: string[] }> {
  const ds = await nhomChuaXet(limit);
  if (ds.length === 0) return { xet: 0, nhomKhach: 0, khachMoi: [] };
  const khach: Customer[] = await getCustomers();
  // Nhóm chưa xét: ai_note đang tạm giữ "số thành viên · mô tả nhóm" (zalo.repo.ghiDanhSachNhom).
  const kl = await xetNhom(
    ds.map((n) => ({ threadId: n.threadId, name: n.name, moTa: n.aiNote })),
    khach.map((c) => c.name),
    await viDuAnhQuyet(40).catch(() => []),
  );
  const gd = (await getDirectors())[0];
  let nhomKhach = 0;
  const khachMoi: string[] = [];
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
