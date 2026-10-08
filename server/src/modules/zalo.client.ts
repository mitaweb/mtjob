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
import { maTinLonNhat, viecBanDem } from '../lib/zalo.js';
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
} from './zalo.repo.js';
import { nhanTin, rutTriThucZalo, xacDinhNhomKhach, type TinTuWorker } from './zalo.service.js';

const now = () => nowTz().toISOString();

/**
 * Gọi từ cron nhắc hẹn (~5 phút/lần). Ban ngày không làm gì; ban đêm đồng bộ một lượt rồi rút tri
 * thức dần (mỗi lượt vài cuộc — máy chủ chỉ sống 60 giây) tới khi hết.
 */
export async function chayBanDem(): Promise<string> {
  const st = await docTrangThai();
  if (!st.coPhien) return 'chưa đăng nhập Zalo';
  const vn = await demViecNhom().catch(() => ({ chuaXet: 0, chuaKeo: 0 }));
  const viec = viecBanDem({ gioVN: nowTz().hour(), lastSync: st.lastSync, now: Date.now(), viecNhom: vn.chuaXet + vn.chuaKeo });
  if (viec === 'nghi') return 'ngoài giờ ban đêm';
  if (viec === 'dong_bo') return (await dongBoZalo()).note;
  if (viec === 'nhom') return (await quetNhomKhach()).note;
  const r = await rutTriThucZalo({ epNgay: true, limit: 3 });
  return r.cuoc ? `rút ${r.y} ý từ ${r.cuoc} cuộc` : 'không còn gì để rút';
}

export function khoaPhien(): string {
  const k = process.env.ZALO_SESSION_KEY || '';
  if (k.length < 32) throw new Error('Chưa cấu hình ZALO_SESSION_KEY (≥ 32 ký tự) trên Vercel');
  return k;
}

/** Nạp thư viện khi cần — không làm chậm mọi request khác của app. */
const taiZca = () => import('zca-js');

let dangDangNhap = false;

/**
 * Đăng nhập bằng QR. Chạy NỀN (trang đã trả lời ngay); ảnh QR ghi vào zalo_status để tab Zalo
 * hiện ra cho anh quét. Một lượt máy chủ chỉ sống 60 giây → QR hết hạn thì dừng, anh bấm lại.
 */
export async function dangNhapQR(): Promise<void> {
  if (dangDangNhap) return;
  dangDangNhap = true;
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
    dangDangNhap = false;
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

let dangDongBo = false;

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
  if (dangDongBo) return { ok: true, note: 'Đang có lượt đồng bộ khác — thử lại sau ít phút', conLai: 1 };
  dangDongBo = true;
  const han = Date.now() + 45_000;
  try {
    const p = await moPhien();
    if ('loi' in p) return { ok: false, note: p.loi, conLai: 0 };
    const ds = await capNhatDanhSachNhom(p.api);
    let xet = 0;
    let nhomKhach = 0;
    const khachMoi: string[] = [];
    while (Date.now() < han - 15_000) {
      const r = await xacDinhNhomKhach(40);
      xet += r.xet;
      nhomKhach += r.nhomKhach;
      khachMoi.push(...r.khachMoi);
      if (r.xet === 0) break;
    }
    const keo = await keoLichSuNhom(p.api, han);
    const con = await demViecNhom();
    const conLai = con.chuaXet + con.chuaKeo;
    const note =
      `Quét nhóm lúc ${nowTz().format('HH:mm DD/MM')} — ${ds.tong} nhóm (${ds.moi} mới), AI xét ${xet}: ${nhomKhach} nhóm khách` +
      (khachMoi.length ? `, tạo mới trong CRM: ${khachMoi.join(', ')}` : '') +
      `; kéo lịch sử ${keo} nhóm` +
      (conLai ? ` · còn ${conLai} việc, lượt sau làm tiếp` : '');
    await ghiTrangThai({ status: 'online', note: note.slice(0, 600), lastSeen: now() });
    return { ok: true, note, conLai };
  } catch (e) {
    const note = `Quét nhóm lỗi: ${(e as Error).message}`.slice(0, 250);
    await ghiTrangThai({ status: 'online', note, lastSeen: now() }).catch(() => undefined);
    return { ok: false, note, conLai: 0 };
  } finally {
    dangDongBo = false;
  }
}

/**
 * Một lượt đồng bộ (chỉ lấy tin, KHÔNG rút tri thức — việc đó để ban đêm hoặc nút "Rút ngay").
 * Lỗi đăng nhập (phiên hết hạn / bị đăng xuất) → xoá phiên, báo anh đăng nhập lại.
 */
export async function dongBoZalo(): Promise<{ ok: boolean; tin: number; note: string }> {
  const st = await docTrangThai();
  if (!st.coPhien) return { ok: false, tin: 0, note: 'Chưa đăng nhập Zalo' };
  if (dangDongBo) return { ok: true, tin: 0, note: 'Đang đồng bộ' };
  dangDongBo = true;
  try {
    const p = await moPhien();
    if ('loi' in p) return { ok: false, tin: 0, note: p.loi };
    const { api } = p;
    const { ThreadType } = p.zca;

    const gom = new Map<string, TinThuVien>();
    let biDay = '';
    // Chẩn đoán cho dòng trạng thái: kết nối có nhận khoá không, Zalo trả mấy lô / mấy tin.
    const chanDoan = { khoa: false, lo: 0, tinLo: 0, trucTiep: 0, loNhom: 0 };
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
      const tong = setTimeout(ket, 22_000);
      let chot: ReturnType<typeof setTimeout> | null = null;
      const henChot = (ms: number) => {
        if (chot) clearTimeout(chot);
        chot = setTimeout(() => {
          clearTimeout(tong);
          ket();
        }, ms);
      };
      /** Trả true nếu là tin CHƯA có trong lượt này. */
      const nhan = (m: TinThuVien): boolean => {
        const id = String(m.data?.msgId || m.data?.cliMsgId || '');
        if (!id || gom.has(id)) return false;
        gom.set(id, m);
        return true;
      };
      api.listener.on('cipher_key', () => {
        chanDoan.khoa = true;
        // Xin tin gần đây — cả lô mới nhất lẫn từ mốc lần trước. Trùng thì tự bỏ (msg_id).
        api.listener.requestOldMessages(ThreadType.User, null);
        if (st.lastMsgId) api.listener.requestOldMessages(ThreadType.User, st.lastMsgId);
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
        let moi = 0;
        for (const m of msgs as unknown as TinThuVien[]) if (nhan(m)) moi++;
        // Lô có tin mới → xin tiếp lô kế từ tin CŨ NHẤT của lô này (tối đa 8 lô). Zalo không nói rõ
        // chiều phân trang; lô trùng thì không có tin mới và dừng.
        const ids = (msgs as unknown as TinThuVien[]).map((m) => String(m.data?.msgId || '')).filter((x) => /^\d+$/.test(x));
        if (moi > 0 && chanDoan.lo < 8 && ids.length) {
          const cuNhat = ids.reduce((a, b) => (BigInt(a) < BigInt(b) ? a : b));
          api.listener.requestOldMessages(ThreadType.User, cuNhat);
          henChot(5_000);
        } else {
          henChot(2_500);
        }
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
    const ds = tatCa.filter((m) => !laNhom(m));
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
    const chiTiet =
      `kết nối ${chanDoan.khoa ? '✓' : '✗ (không nhận được khoá)'}, Zalo trả ${chanDoan.lo} lô 1-1 + ${chanDoan.loNhom} lô nhóm / ` +
      `${chanDoan.tinLo} tin, tin trực tiếp ${chanDoan.trucTiep} · ${dsNhom.tong} nhóm${dsNhom.moi ? ` (${dsNhom.moi} mới)` : ''}`;
    const note =
      biDay ||
      `Đồng bộ lúc ${nowTz().format('HH:mm DD/MM')} — ${lo.length} tin (${nhom.length} tin nhóm; ${kq.luu} tin ở cuộc đã bật) · ${chiTiet}`;
    await ghiTrangThai({ status: 'online', note, lastSeen: gio });
    return { ok: true, tin: lo.length, note };
  } finally {
    dangDongBo = false;
  }
}
