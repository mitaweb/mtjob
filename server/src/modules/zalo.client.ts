// Kết nối Zalo cá nhân CHẠY THẲNG TRÊN VERCEL (anh Tâm 8/10/2026: "worker luôn trên vercel").
//
// Vercel không giữ được kết nối nghe tin liên tục (mỗi lượt tối đa 60 giây), và anh Tâm cũng không
// cần liên tục ("chạy vào ban đêm là được"). Nên MỖI ĐÊM (lib/zalo.viecBanDem, ăn theo cron nhắc hẹn):
//   1. một lượt đồng bộ: đăng nhập bằng phiên đã lưu, mở kết nối ~20 giây, xin Zalo gửi lại các tin
//      gần đây (requestOldMessages — chính cách Zalo Web lấy tin lúc mở lại tab), gom rồi ngắt;
//   2. nhóm (anh Tâm 8/10/2026): cập nhật danh sách nhóm, AI xét nhóm nào là nhóm khách (tên kiểu
//      "TÊN KH - MT DIGITAL"), khớp/tạo khách ở CRM, bật học và kéo lịch sử cũ của nhóm đó về;
//   3. các lượt sau trong đêm: AI xem xét cuộc đã bật, cái nào ổn thì đưa vào kho tri thức.
//
// AN TOÀN:
//   - Phiên đăng nhập lưu dạng BẢN MÃ (lib/maHoa.ts); khoá ở biến môi trường ZALO_SESSION_KEY.
//   - Chỉ ĐỌC tin. Không gửi tin, không kết bạn, không làm gì thay anh.
//   - Thư viện KHÔNG CHÍNH THỨC (zca-js giả lập Zalo Web): Zalo có thể khoá tài khoản. Anh đang mở
//     Zalo trên TRÌNH DUYỆT (chat.zalo.me) thì lượt đồng bộ đó bị đẩy ra — Zalo điện thoại/PC không sao.
import { maHoa, giaiMa } from '../lib/maHoa.js';
import { maTinLonNhat, viecBanDem, gioTin } from '../lib/zalo.js';
import { nowTz } from '../lib/datetime.js';
import {
  docTrangThai,
  ghiTrangThai,
  docPhienMa,
  ghiPhienMa,
  ghiMocDongBo,
  ghiDanhSachNhom,
  nhomDaBiet,
  nhomCanKeoLichSu,
  daKeoLichSu,
  demViecNhom,
  demNhomAiDaChoHoc,
  moLaiNhomMtDigital,
} from './zalo.repo.js';
import { demNhacZaloSapToi } from './reminders.repo.js';
import { nhanTin, rutTriThucZalo, xacDinhNhomKhach, gopNhacCu, locLaiNhom, type TinTuWorker } from './zalo.service.js';

const now = () => nowTz().toISOString();

let daMoLaiMtDigital = false;

/**
 * Gọi từ cron nhắc hẹn (~5 phút/lần), CẢ NGÀY (anh Tâm 11/10/2026): ban ngày cứ 3 tiếng đồng bộ một lượt, ban
 * đêm chỉ một lượt lúc 5h sáng (lib/zalo.viecBanDem); rồi xét nhóm và AI đọc tin MỚI dần (mỗi lượt vài cuộc — máy chủ chỉ sống 60 giây)
 * tới khi hết; hết tin mới thì không gọi AI.
 */
export async function chayBanDem(batDau = Date.now()): Promise<string> {
  // Máy chủ sống tối đa 60 giây kể từ lúc cron gọi (`batDau`). Một cuộc AI đọc (kèm tải ảnh / mở link) có thể
  // tới ~20 giây → không bắt đầu cuộc mới sau giây thứ 38.
  const han = batDau + 38_000;
  const st = await docTrangThai();
  const gioVN = nowTz().hour();
  if (!st.coPhien) return xetLaiKhoBanDem();
  // Một lần mỗi máy chủ: mở lại nhóm "… MT DIGITAL …" bị luật tên loại nhầm (17/10/2026).
  if (!daMoLaiMtDigital) {
    daMoLaiMtDigital = true;
    await moLaiNhomMtDigital().catch(() => 0);
  }
  const vn = await demViecNhom().catch(() => ({ chuaXet: 0, chuaKeo: 0 }));
  // Nhắc Zalo sắp tới giờ (25 phút tới) → đồng bộ trước cho AI xét lại với tin mới nhất.
  const bayGio = nowTz();
  const sau = bayGio.add(25, 'minute');
  const sapNhac =
    sau.format('YYYY-MM-DD') === bayGio.format('YYYY-MM-DD') &&
    (await demNhacZaloSapToi(bayGio.format('YYYY-MM-DD'), bayGio.format('HH:mm'), sau.format('HH:mm')).catch(() => 0)) > 0;
  const viec = viecBanDem({ gioVN, lastSync: st.lastSync, now: Date.now(), viecNhom: vn.chuaXet + vn.chuaKeo, sapNhac });
  if (viec === 'nghi') return 'ngoài giờ ban đêm';
  if (viec === 'dong_bo') {
    // Lấy tin xong thì AI xử lý LUÔN trong lượt này, không đợi lượt sau (anh Tâm 14/10/2026: "khi lấy dữ liệu xong
    // thì em hãy xử lý luôn, như vậy sẽ tránh việc bị delay tin nhắn").
    const db = await dongBoZalo();
    if (!db.ok || Date.now() > han - 8_000) return db.note;
    const r = await rutTriThucZalo({ limit: 20, han, boQuaNhip: true });
    return r.cuoc ? `${db.note} — rồi đọc luôn ${r.cuoc} cuộc: ${r.y} ý, ${r.nhac} nhắc việc` : db.note;
  }
  if (viec === 'nhom') return (await quetNhomKhach()).note;
  // Tự lọc lại nhóm AI đã cho học theo tiêu chí chặt — không cần anh bấm nút (anh Tâm 12/10/2026: "giảm nút lại
  // ít nhất có thể, tự động nhiều nhất có thể"). Hết nhóm cần lọc thì bước này không tốn gì.
  if ((await demNhomAiDaChoHoc().catch(() => 0)) > 0) {
    const l = await locLaiNhom(Date.now() + 40_000).catch((e) => ({ xet: 0, giu: 0, bo: 0, conLai: 0, loi: (e as Error).message }));
    if (l.xet > 0) return `lọc lại ${l.xet} nhóm: giữ ${l.giu}, bỏ ${l.bo}, còn ${l.conLai}`;
  }
  await gopNhacCu().catch(() => undefined);
  // Cả ngày: đọc trong khoảng thời gian còn lại của lượt; cuộc đang nói dở (tin cuối < 10 phút) để lượt sau.
  const r = await rutTriThucZalo({ limit: 20, han });
  if (r.cuoc) return `đọc ${r.cuoc} cuộc: ${r.y} ý, ${r.nhac} nhắc việc, ${r.caNhan} cuộc không liên quan bỏ qua, ${r.hoi} cuộc cần anh quyết`;
  return xetLaiKhoBanDem();
}

/** Hết tin Zalo để đọc → cho AI xét lại các mục chờ duyệt chỉ vì lúc gửi AI lỗi (hết lượt…). */
async function xetLaiKhoBanDem(): Promise<string> {
  const { xetLaiMucCho } = await import('./brainItems.service.js');
  const x = await xetLaiMucCho({ han: Date.now() + 35_000, limit: 10 });
  return x.xong ? `AI xét lại ${x.xong} mục chờ: ban hành ${x.banHanh}, còn chờ anh ${x.conCho}, bỏ ${x.bo}` : 'không còn gì để làm';
}

export function khoaPhien(): string {
  const k = process.env.ZALO_SESSION_KEY || '';
  if (k.length < 32) throw new Error('Chưa cấu hình ZALO_SESSION_KEY (≥ 32 ký tự) trên Vercel');
  return k;
}

/** Nạp thư viện khi cần — không làm chậm mọi request khác của app. */
const taiZca = () => import('zca-js');

/**
 * Khoá "đang chạy" CÓ HẠN (anh Tâm 17/10/2026: Zalo ngừng đồng bộ 3 ngày). Trước đây là biến true/false: lượt bị
 * Vercel cắt ở 60 giây thì khối finally không chạy, instance được dùng lại vẫn tưởng "đang chạy" → mọi lượt sau bỏ
 * qua mãi. Giờ khoá tự hết sau 75 giây (lâu hơn mọi lượt sống được).
 */
export const KHOA_MS = 75_000;
let dangNhapTu = 0;

/**
 * Đăng nhập bằng QR. Chạy NỀN (trang đã trả lời ngay); ảnh QR ghi vào zalo_status để tab Zalo
 * hiện ra cho anh quét. Một lượt máy chủ chỉ sống 60 giây → QR hết hạn thì dừng, anh bấm lại.
 */
export async function dangNhapQR(): Promise<void> {
  if (Date.now() - dangNhapTu < KHOA_MS) return;
  dangNhapTu = Date.now();
  let huy: (() => unknown) | null = null;
  const hetGio = setTimeout(() => {
    void ghiTrangThai({ status: 'error', note: 'Hết giờ chờ quét — bấm Đăng nhập lại', lastSeen: now() });
    huy?.();
  }, 52_000);
  try {
    const key = khoaPhien();
    const { Zalo, LoginQRCallbackEventType: E } = await taiZca();
    const zalo = new Zalo({ selfListen: true, checkUpdate: false, logging: false });
    const api = await zalo.loginQR({}, async (ev) => {
      switch (ev.type) {
        case E.QRCodeGenerated:
          huy = ev.actions.abort;
          await ghiTrangThai({
            status: 'waiting_qr',
            qr: ev.data.image,
            note: 'Mở Zalo trên điện thoại → Quét mã QR. Mã hết hạn sau khoảng 1 phút.',
            lastSeen: now(),
          });
          break;
        case E.QRCodeExpired:
          await ghiTrangThai({ status: 'error', note: 'Mã QR hết hạn — bấm Đăng nhập lại', lastSeen: now() });
          ev.actions.abort();
          break;
        case E.QRCodeScanned:
          huy = ev.actions.abort;
          await ghiTrangThai({
            status: 'scanned',
            account: ev.data.display_name,
            note: 'Đã quét — bấm Đăng nhập trên điện thoại',
            lastSeen: now(),
          });
          break;
        case E.QRCodeDeclined:
          await ghiTrangThai({ status: 'error', note: 'Đăng nhập bị từ chối trên điện thoại', lastSeen: now() });
          ev.actions.abort();
          break;
        case E.GotLoginInfo:
          await ghiPhienMa(maHoa(JSON.stringify(ev.data), key));
          break;
      }
    });
    if (!api) return; // đã huỷ (hết hạn / từ chối) — trạng thái ghi ở trên
    let account = '';
    try {
      const info = (await api.fetchAccountInfo()) as { profile?: { displayName?: string } };
      account = info?.profile?.displayName || '';
    } catch {
      /* không bắt buộc */
    }
    await ghiTrangThai({ status: 'online', account, note: 'Đã đăng nhập — tự đồng bộ và rút tri thức mỗi đêm', lastSeen: now() });
    // Lấy ngay một lượt cho anh thấy danh sách cuộc trò chuyện mà bật cuộc nào cần học.
    await dongBoZalo().catch(() => undefined);
  } catch (e) {
    const st = await docTrangThai().catch(() => null);
    if (st?.status !== 'error') {
      await ghiTrangThai({ status: 'error', note: `Chưa đăng nhập được: ${(e as Error).message}`.slice(0, 250), lastSeen: now() });
    }
  } finally {
    clearTimeout(hetGio);
    dangNhapTu = 0;
  }
}

export async function dangXuat(): Promise<void> {
  await ghiPhienMa('');
  await ghiTrangThai({ status: 'offline', note: 'Đã đăng xuất — phiên đăng nhập đã xoá', lastSeen: now() });
}

/** Tin Zalo (dạng thư viện trả) → dạng nhanTin nhận. Tên cuộc: tên người kia (không phải tên mình). */
type TinThuVien = {
  /** ThreadType: 0 = chat 1-1, 1 = nhóm. */
  type?: number;
  threadId: string;
  isSelf: boolean;
  data: { msgId?: string; cliMsgId?: string; dName?: string; content?: unknown; ts?: string };
};

let dongBoTu = 0;
const dangDongBo = () => Date.now() - dongBoTu < KHOA_MS;

type Zca = Awaited<ReturnType<typeof taiZca>>;
type ApiZalo = Awaited<ReturnType<InstanceType<Zca['Zalo']>['login']>>;

/** Đăng nhập bằng phiên đã lưu. Phiên hỏng / hết hạn / bị đăng xuất → xoá phiên, báo anh đăng nhập lại. */
async function moPhien(): Promise<{ api: ApiZalo; zca: Zca } | { loi: string }> {
  let credentials: unknown;
  try {
    credentials = JSON.parse(giaiMa(await docPhienMa(), khoaPhien()));
  } catch (e) {
    await ghiPhienMa('');
    const note = `Không mở được phiên đã lưu (${(e as Error).message}) — bấm Đăng nhập lại`;
    await ghiTrangThai({ status: 'expired', note, lastSeen: now() });
    return { loi: note };
  }
  const zca = await taiZca();
  try {
    const api = await new zca.Zalo({ selfListen: true, checkUpdate: false, logging: false }).login(
      credentials as Parameters<InstanceType<Zca['Zalo']>['login']>[0],
    );
    return { api, zca };
  } catch (e) {
    await ghiPhienMa('');
    const note = 'Phiên Zalo hết hạn hoặc đã bị đăng xuất — bấm Đăng nhập lại';
    await ghiTrangThai({ status: 'expired', note: `${note} (${(e as Error).message})`.slice(0, 250), lastSeen: now() });
    return { loi: note };
  }
}

/**
 * Cập nhật danh sách nhóm Zalo (kể cả nhóm im lâu không có tin mới). Chỉ hỏi thông tin những nhóm
 * chưa biết tên.
 */
async function capNhatDanhSachNhom(api: ApiZalo): Promise<{ tong: number; moi: number }> {
  const all = await api.getAllGroups();
  const ids = Object.keys(all?.gridVerMap || {});
  const daBiet = await nhomDaBiet();
  const can = ids.filter((id) => !daBiet.has(id));
  const gio = now();
  for (let i = 0; i < can.length; i += 50) {
    const lo = can.slice(i, i + 50);
    try {
      const info = await api.getGroupInfo(lo);
      const ds: Array<{ threadId: string; name: string; moTa: string }> = [];
      for (const id of lo) {
        const g = info?.gridInfoMap?.[id];
        if (!g?.name) continue;
        const moTa = [g.totalMember ? `${g.totalMember} thành viên` : '', String(g.desc || '').trim()].filter(Boolean).join(' · ');
        ds.push({ threadId: id, name: String(g.name).slice(0, 200), moTa: moTa.slice(0, 300) });
      }
      await ghiDanhSachNhom(ds, gio);
    } catch (e) {
      console.warn('[zalo] thông tin nhóm', (e as Error).message);
    }
  }
  return { tong: ids.length, moi: can.length };
}

/** Tin nhóm (thư viện) → dạng nhanTin. Người nói ghi theo tên hiển thị trong nhóm. */
function tinNhom(m: TinThuVien): TinTuWorker {
  return {
    msgId: String(m.data.msgId || m.data.cliMsgId),
    threadId: String(m.threadId),
    threadName: '', // tên nhóm lấy từ danh sách nhóm, không lấy tên người nói
    isGroup: true,
    fromSelf: !!m.isSelf,
    sender: m.isSelf ? '' : String(m.data.dName || ''),
    content: m.data.content,
    ts: String(m.data.ts || Date.now()),
  };
}

/**
 * Kéo lịch sử cũ của các nhóm khách vừa bật — Zalo CHO lấy lịch sử nhóm (không cho lấy lịch sử chat
 * 1-1 trước lúc đăng nhập). Mỗi nhóm một lần, ~200 tin gần nhất.
 */
async function keoLichSuNhom(api: ApiZalo, han: number): Promise<number> {
  let xong = 0;
  for (const n of await nhomCanKeoLichSu(10)) {
    if (Date.now() > han) break;
    try {
      const r = await api.getGroupChatHistory(n.threadId, 200).catch(() => api.getGroupChatHistory(n.threadId, 50));
      const ds = ((r?.groupMsgs || []) as unknown as TinThuVien[]).filter((m) => m?.data?.msgId || m?.data?.cliMsgId);
      if (ds.length) await nhanTin(ds.map(tinNhom));
      xong++;
    } catch (e) {
      console.warn('[zalo] lịch sử nhóm', n.threadId, (e as Error).message);
    }
    // Lỗi cũng đánh dấu — khỏi kẹt mãi một nhóm; tin mới của nhóm vẫn vào qua đồng bộ hằng đêm.
    await daKeoLichSu(n.threadId);
  }
  return xong;
}

/**
 * Quét nhóm khách (anh Tâm 8/10/2026): cập nhật danh sách nhóm → AI xét nhóm nào là nhóm khách,
 * khớp/tạo khách ở CRM, bật học → kéo lịch sử cũ. Chạy ~45 giây (máy chủ sống 60 giây); còn việc thì
 * lượt sau làm tiếp (ban đêm tự chạy, hoặc anh bấm lại).
 */
export async function quetNhomKhach(): Promise<{ ok: boolean; note: string; conLai: number }> {
  const st = await docTrangThai();
  if (!st.coPhien) return { ok: false, note: 'Chưa đăng nhập Zalo', conLai: 0 };
  if (dangDongBo()) return { ok: true, note: 'Đang có lượt đồng bộ khác — thử lại sau ít phút', conLai: 1 };
  dongBoTu = Date.now();
  const han = Date.now() + 45_000;
  try {
    const p = await moPhien();
    if ('loi' in p) return { ok: false, note: p.loi, conLai: 0 };
    const ds = await capNhatDanhSachNhom(p.api);
    let xet = 0;
    let nhomKhach = 0;
    while (Date.now() < han - 15_000) {
      const r = await xacDinhNhomKhach(40);
      xet += r.xet;
      nhomKhach += r.nhomKhach;
      if (r.xet === 0) break;
    }
    const keo = await keoLichSuNhom(p.api, han);
    const con = await demViecNhom();
    const conLai = con.chuaXet + con.chuaKeo;
    const note =
      `Quét nhóm lúc ${nowTz().format('HH:mm DD/MM')} — ${ds.tong} nhóm (${ds.moi} mới), AI xét ${xet}: ${nhomKhach} nhóm khách` +
      `; kéo lịch sử ${keo} nhóm` +
      (conLai ? ` · còn ${conLai} việc, lượt sau làm tiếp` : '');
    await ghiTrangThai({ status: 'online', note: note.slice(0, 600), lastSeen: now() });
    return { ok: true, note, conLai };
  } catch (e) {
    const note = `Quét nhóm lỗi: ${(e as Error).message}`.slice(0, 250);
    await ghiTrangThai({ status: 'online', note, lastSeen: now() }).catch(() => undefined);
    return { ok: false, note, conLai: 0 };
  } finally {
    dongBoTu = 0;
  }
}

/**
 * Một lượt đồng bộ (chỉ lấy tin, KHÔNG rút tri thức — việc đó để ban đêm hoặc nút "Rút ngay").
 * Lỗi đăng nhập (phiên hết hạn / bị đăng xuất) → xoá phiên, báo anh đăng nhập lại.
 */
export async function dongBoZalo(): Promise<{ ok: boolean; tin: number; note: string }> {
  const st = await docTrangThai();
  if (!st.coPhien) return { ok: false, tin: 0, note: 'Chưa đăng nhập Zalo' };
  if (dangDongBo()) return { ok: true, tin: 0, note: 'Đang đồng bộ' };
  dongBoTu = Date.now();
  try {
    const p = await moPhien();
    if ('loi' in p) return { ok: false, tin: 0, note: p.loi };
    const { api } = p;
    const { ThreadType } = p.zca;

    const gom = new Map<string, TinThuVien>();
    let biDay = '';
    // Chẩn đoán cho dòng trạng thái: kết nối có nhận khoá không, Zalo trả mấy lô / mấy tin.
    const chanDoan = { khoa: false, lo: 0, tinLo: 0, trucTiep: 0, loNhom: 0, cacLo: [] as string[], tuDau: false };
    await new Promise<void>((resolve) => {
      let xong = false;
      const ket = () => {
        if (xong) return;
        xong = true;
        try {
          api.listener.stop();
        } catch {
          /* đã đóng */
        }
        resolve();
      };
      // Nhiều lô (tới 40) sau mấy ngày không đồng bộ → cho tới 32 giây.
      const tong = setTimeout(ket, 32_000);
      let chot: ReturnType<typeof setTimeout> | null = null;
      const henChot = (ms: number) => {
        if (chot) clearTimeout(chot);
        chot = setTimeout(() => {
          clearTimeout(tong);
          ket();
        }, ms);
      };
      /** Xin từ đầu (không mốc) — một lần mỗi lượt: khi chưa có mốc, hoặc xin từ mốc không ra tin mới hơn. */
      const xinTuDau = () => {
        if (chanDoan.tuDau || chanDoan.lo > 0) return;
        chanDoan.tuDau = true;
        api.listener.requestOldMessages(ThreadType.User, null);
      };
      /** Các mốc đã xin lô tin cũ trong lượt này. */
      const daXin = new Set<string>();
      /** Trả true nếu là tin CHƯA có trong lượt này. */
      const nhan = (m: TinThuVien): boolean => {
        const id = String(m.data?.msgId || m.data?.cliMsgId || '');
        if (!id || gom.has(id)) return false;
        gom.set(id, m);
        return true;
      };
      api.listener.on('cipher_key', () => {
        chanDoan.khoa = true;
        // Lấy tin MỚI NHẤT trước (anh Tâm 18/10/2026: "18 chạy thì phải lấy được tin từ ngày 18 luôn"): đi tiếp từ
        // mốc tin mới nhất app đã có. Không mốc (lần đầu) mới xin từ đầu. Xin "null" mỗi lần như trước thì Zalo trả
        // lại từ tin cũ nhất nó giữ (08/10) → tốn hết số lô vào tin đã có, không tới được tin hôm nay.
        if (st.lastMsgId) {
          daXin.add(st.lastMsgId);
          api.listener.requestOldMessages(ThreadType.User, st.lastMsgId);
          // Đường lui: 6 giây chưa có lô nào → xin từ đầu như cũ.
          setTimeout(xinTuDau, 6_000);
        } else {
          xinTuDau();
        }
        // Tin nhóm gần đây (anh Tâm 8/10/2026: cần cả nhóm khách). Lịch sử cũ của nhóm khách kéo
        // riêng bằng getGroupChatHistory ở bước quét nhóm.
        api.listener.requestOldMessages(ThreadType.Group, null);
        henChot(12_000);
      });
      api.listener.on('old_messages', (msgs, type) => {
        if (type === ThreadType.Group) {
          chanDoan.loNhom++;
          chanDoan.tinLo += msgs.length;
          for (const m of msgs as unknown as TinThuVien[]) nhan(m);
          henChot(2_500);
          return;
        }
        if (type !== ThreadType.User) return;
        chanDoan.lo++;
        chanDoan.tinLo += msgs.length;
        for (const m of msgs as unknown as TinThuVien[]) nhan(m);
        // Ghi khoảng thời gian từng lô (chẩn đoán chiều phân trang của Zalo).
        const tsLo = (msgs as unknown as TinThuVien[]).map((m) => Number(m.data?.ts)).filter((x) => x > 0);
        if (tsLo.length) chanDoan.cacLo.push(`${gioTin(String(Math.min(...tsLo)))}→${gioTin(String(Math.max(...tsLo)))}`);
        // Đi TIẾP về phía tin mới hơn: xin từ tin MỚI NHẤT của lô (18/10/2026 — xin từ tin cũ nhất chỉ lấy lại tin cũ
        // đã có). Mỗi mốc một lần; dừng khi lô rỗng / không tiến thêm; tối đa 40 lô.
        const ids = (msgs as unknown as TinThuVien[]).map((m) => String(m.data?.msgId || '')).filter((x) => /^\d+$/.test(x));
        // Lô đầu xin từ mốc mà không có tin nào mới hơn mốc → xin từ đầu (đường lui).
        const moc = st.lastMsgId;
        if (chanDoan.lo === 1 && moc && !chanDoan.tuDau && !ids.some((x) => BigInt(x) > BigInt(moc))) {
          chanDoan.lo = 0;
          xinTuDau();
          henChot(5_000);
          return;
        }
        let xin = false;
        if (ids.length) {
          const moiNhat = ids.reduce((a, b) => (BigInt(a) > BigInt(b) ? a : b));
          if (!daXin.has(moiNhat) && daXin.size < 40) {
            daXin.add(moiNhat);
            api.listener.requestOldMessages(ThreadType.User, moiNhat);
            xin = true;
          }
        }
        henChot(xin ? 5_000 : 2_500);
      });
      api.listener.on('message', (m) => {
        chanDoan.trucTiep++;
        nhan(m as unknown as TinThuVien);
      });
      api.listener.on('closed', (code) => {
        if (code === 3000 || code === 3003) biDay = 'Zalo Web đang mở ở trình duyệt khác nên lượt này bị đẩy ra.';
        clearTimeout(tong);
        ket();
      });
      api.listener.on('error', () => undefined);
      api.listener.start({ retryOnClose: false });
    });

    const tatCa = [...gom.values()];
    const laNhom = (m: TinThuVien) => m.type === ThreadType.Group;
    const nhom = tatCa.filter(laNhom);
    // Tên cuộc = tên người kia. Tin của mình không mang tên người kia → tra hồ sơ.
    // CHỈ tin MỚI sau mốc đã lấy (anh Tâm 18/10/2026: "mỗi mốc đã lấy tin thì lấy từ đó trở đi, không xem tin cũ làm
    // gì nữa") — tin cũ hơn / bằng mốc (Zalo trả lại khi xin từ đầu) bỏ luôn, không lưu, không cho AI đọc.
    const mocCu = /^\d+$/.test(st.lastMsgId || '') ? BigInt(st.lastMsgId!) : null;
    const sauMoc = (m: TinThuVien) => {
      const id = String(m.data?.msgId || '');
      return mocCu === null || !/^\d+$/.test(id) || BigInt(id) > mocCu;
    };
    const ds = tatCa.filter((m) => !laNhom(m) && sauMoc(m));
    const ten = new Map<string, string>();
    for (const m of ds) if (!m.isSelf && m.data?.dName) ten.set(m.threadId, String(m.data.dName));
    const thieu = [...new Set(ds.map((m) => m.threadId).filter((id) => !ten.has(id)))];
    if (thieu.length) {
      try {
        const u = (await api.getUserInfo(thieu)) as { changed_profiles?: Record<string, { displayName?: string; zaloName?: string }> };
        for (const id of thieu) {
          const p = u?.changed_profiles?.[id] || u?.changed_profiles?.[`${id}_0`];
          if (p?.displayName || p?.zaloName) ten.set(id, String(p.displayName || p.zaloName));
        }
      } catch {
        /* thiếu tên thì để trống, lần sau bổ sung */
      }
    }

    const lo: TinTuWorker[] = ds.map((m) => ({
      msgId: String(m.data.msgId || m.data.cliMsgId),
      threadId: String(m.threadId),
      threadName: ten.get(m.threadId) || '',
      isGroup: false,
      fromSelf: !!m.isSelf,
      sender: m.isSelf ? '' : String(m.data.dName || ''),
      content: m.data.content,
      ts: String(m.data.ts || Date.now()),
    }));
    // Danh sách nhóm trước (để có tên nhóm), rồi mới ghi tin nhóm.
    let dsNhom = { tong: 0, moi: 0 };
    try {
      dsNhom = await capNhatDanhSachNhom(api);
    } catch (e) {
      console.warn('[zalo] danh sách nhóm', (e as Error).message);
    }
    lo.push(...nhom.map(tinNhom));
    const kq = lo.length ? await nhanTin(lo) : { luu: 0, boQua: 0 };
    const gio = now();
    await ghiMocDongBo(maTinLonNhat(ds.map((m) => String(m.data.msgId || '')), st.lastMsgId), gio);
    // Khoảng thời gian tin Zalo trả về — nhìn là biết có tới tin mới nhất không.
    const tsDs = lo.map((t) => Number(t.ts)).filter((x) => x > 0);
    const khoang = tsDs.length ? ` · tin từ ${gioTin(String(Math.min(...tsDs)))} đến ${gioTin(String(Math.max(...tsDs)))}` : '';
    const chiTiet =
      `kết nối ${chanDoan.khoa ? '✓' : '✗ (không nhận được khoá)'}, Zalo trả ${chanDoan.lo} lô 1-1 + ${chanDoan.loNhom} lô nhóm / ` +
      `${chanDoan.tinLo} tin, tin trực tiếp ${chanDoan.trucTiep} · ${dsNhom.tong} nhóm${dsNhom.moi ? ` (${dsNhom.moi} mới)` : ''}${khoang}` +
      (chanDoan.cacLo.length
        ? ` · các lô${chanDoan.tuDau ? ' (xin từ đầu)' : ''}: ${chanDoan.cacLo.slice(0, 6).join(', ')}` +
          (chanDoan.cacLo.length > 6 ? ` … ${chanDoan.cacLo[chanDoan.cacLo.length - 1]}` : '')
        : '');
    const note =
      biDay ||
      `Đồng bộ lúc ${nowTz().format('HH:mm DD/MM')} — ${lo.length} tin (${nhom.length} tin nhóm; ${kq.luu} tin ở cuộc đã bật) · ${chiTiet}`;
    await ghiTrangThai({ status: 'online', note, lastSeen: gio });
    return { ok: true, tin: lo.length, note };
  } finally {
    dongBoTu = 0;
  }
}

/**
 * Nút "⚡ Đọc & phân loại ngay" (anh Tâm 10/10/2026: "cho anh 1 nút chủ động đọc và phân loại không cần
 * chờ đến tối"). Mỗi lần gọi làm MỘT bước ~40 giây theo thứ tự ban đêm — nhóm (xét theo tên + kéo lịch
 * sử) → AI đọc cuộc → AI xét lại mục chờ duyệt — trang gọi lặp tới khi `buoc = 'xong'`.
 */
export async function xuLyNgay(): Promise<{
  ok: boolean;
  buoc: 'nhom' | 'doc' | 'kho' | 'xong';
  note: string;
  con: { nhom: number; doc: number };
}> {
  const { demCuocCanRut } = await import('./zalo.repo.js');
  const demCon = async () => {
    const vn = await demViecNhom().catch(() => ({ chuaXet: 0, chuaKeo: 0 }));
    return { nhom: vn.chuaXet + vn.chuaKeo, doc: await demCuocCanRut().catch(() => 0) };
  };
  // Nhắc lẻ kiểu cũ → mỗi khách MỘT nhắc gộp (nhanh, không cần AI).
  const gop = await gopNhacCu().catch(() => ({ gop: 0, khach: 0 }));
  if (gop.gop > 0) {
    return { ok: true, buoc: 'nhom', note: `Gộp ${gop.gop} nhắc lẻ thành ${gop.khach} nhắc (mỗi khách một nhắc)`, con: await demCon() };
  }
  const truoc = await demCon();
  const st = await docTrangThai();

  if (truoc.nhom > 0) {
    if (st.coPhien) {
      const r = await quetNhomKhach();
      return { ok: r.ok, buoc: 'nhom', note: r.note, con: await demCon() };
    }
    // Chưa đăng nhập Zalo: vẫn xét được nhóm theo tên (không cần Zalo), chỉ không kéo lịch sử.
    const r = await xacDinhNhomKhach(40);
    if (r.xet > 0) return { ok: true, buoc: 'nhom', note: `AI xét ${r.xet} nhóm: ${r.nhomKhach} nhóm khách`, con: await demCon() };
  }

  // Lọc lại nhóm AI đã cho học (tiêu chí chặt) — trước khi đọc, để khỏi tốn AI đọc nhóm thừa.
  if ((await demNhomAiDaChoHoc().catch(() => 0)) > 0) {
    const l = await locLaiNhom(Date.now() + 40_000);
    if (l.xet > 0) {
      return { ok: true, buoc: 'nhom', note: `Lọc lại ${l.xet} nhóm: giữ ${l.giu}, bỏ ${l.bo} nhóm không liên quan — còn ${l.conLai}`, con: await demCon() };
    }
  }

  if (truoc.doc > 0) {
    const r = await rutTriThucZalo({ epNgay: true, limit: 40, han: Date.now() + 40_000 });
    if (r.loi) return { ok: false, buoc: 'doc', note: `AI hết lượt: ${r.loi}`, con: await demCon() };
    if (r.cuoc > 0) {
      const note = `AI đọc ${r.cuoc} cuộc: ${r.y} ý vào kho, ${r.nhac} nhắc việc, ${r.caNhan} cuộc không liên quan bỏ qua, ${r.hoi} cuộc cần anh quyết`;
      return { ok: true, buoc: 'doc', note, con: await demCon() };
    }
  }

  const { xetLaiMucCho } = await import('./brainItems.service.js');
  const x = await xetLaiMucCho({ han: Date.now() + 40_000, limit: 20 });
  if (x.xong > 0) {
    return {
      ok: true,
      buoc: 'kho',
      note: `AI xét lại ${x.xong} mục chờ: ban hành ${x.banHanh}, còn chờ anh ${x.conCho}, bỏ ${x.bo}`,
      con: await demCon(),
    };
  }
  return { ok: true, buoc: 'xong', note: 'Đã đọc và phân loại hết', con: await demCon() };
}
