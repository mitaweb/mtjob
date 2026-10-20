// Zalo cá nhân → kho tri thức (anh Tâm 5/10/2026), chạy thẳng trên Vercel (8/10/2026).
// CHỈ GIÁM ĐỐC — kể cả admin cũng không (anh Tâm 8/10/2026: "chỉ giám đốc thấy được tab zalo này
// thôi"): đây là tin nhắn riêng của anh với khách. Đồng bộ ban đêm ăn theo cron nhắc hẹn.
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { runInBackground } from '../util/background.js';
import { docTrangThai, suaCuoc, timCuoc, trangCuoc, tinGanDay } from './zalo.repo.js';
import { rutTriThucZalo, khopKhachCuoc, locLaiNhom } from './zalo.service.js';
import { dangNhapQR, dangXuat, dongBoZalo, quetNhomKhach, xuLyNgay, khoaPhien } from './zalo.client.js';
import { isMissingTable } from './brain.repo.js';

export const zaloRouter = Router();
zaloRouter.use(requireAuth, requireRole('director'));

const daCauHinh = (): boolean => {
  try {
    khoaPhien();
    return true;
  } catch {
    return false;
  }
};

zaloRouter.get(
  '/status',
  asyncHandler(async (req, res) => {
    try {
      const LOC = ['hoi', 'hoc', 'bo', 'nhom', 'rieng', 'tat_ca'] as const;
      const locHoi = LOC.find((x) => x === req.query.loc);
      const tim = String(req.query.q || '').slice(0, 100);
      const trang = Math.max(1, Math.floor(Number(req.query.page)) || 1);
      const co = Math.min(100, Math.max(5, Math.floor(Number(req.query.size)) || 30));
      // Trạng thái + trang cuộc trò chuyện cùng lúc; chưa chọn lọc thì trangCuoc tự chọn (12/10/2026: tăng tốc).
      const [st, ds] = await Promise.all([docTrangThai(), trangCuoc({ loc: locHoi || 'tu_dong', tim, trang, co })]);
      res.json({ configured: daCauHinh(), ...st, threads: ds.threads, dem: ds.dem, loc: ds.loc, page: trang, size: co });
    } catch (e) {
      if (isMissingTable(e) || /zalo_|session_enc|last_sync|ai_checked|ai_note|history_done|ai_hoi|anh_quyet|tom_tat|anh_ghi_chu|mo_lai_at/.test((e as Error).message)) {
        res.json({ configured: daCauHinh(), status: 'offline', qr: '', account: '', note: '', coPhien: false, threads: [], needsMigrate: true });
        return;
      }
      throw e;
    }
  }),
);

/** Bắt đầu đăng nhập QR — trả lời ngay, chạy nền; trang hỏi /status 2 giây/lần để hiện QR. */
zaloRouter.post(
  '/login',
  asyncHandler(async (_req, res) => {
    if (!daCauHinh()) throw new ApiError(400, 'Chưa cấu hình ZALO_SESSION_KEY trên Vercel (chuỗi ngẫu nhiên ≥ 32 ký tự) rồi Redeploy.');
    runInBackground(dangNhapQR());
    res.json({ ok: true });
  }),
);

zaloRouter.post(
  '/logout',
  asyncHandler(async (_req, res) => {
    await dangXuat();
    res.json({ ok: true });
  }),
);

/** Đồng bộ ngay (chỉ lấy tin; rút tri thức để ban đêm hoặc bấm "Rút tri thức ngay"). */
zaloRouter.post(
  '/sync',
  asyncHandler(async (_req, res) => {
    res.json(await dongBoZalo());
  }),
);

/**
 * Quét nhóm khách (anh Tâm 8/10/2026): AI xét nhóm nào là nhóm khách, khớp/tạo khách ở CRM, bật học,
 * kéo lịch sử cũ. Mỗi lần ~45 giây; `conLai` > 0 thì trang tự gọi tiếp.
 */
zaloRouter.post(
  '/groups',
  asyncHandler(async (_req, res) => {
    res.json(await quetNhomKhach());
  }),
);

const suaSchema = z.object({
  enabled: z.boolean().optional(),
  customer: z.string().max(200).optional(),
  /** Lời anh giải thích cho AI về cuộc này (anh Tâm 11/10/2026). */
  ghiChu: z.string().max(500).optional(),
});

zaloRouter.post(
  '/threads/:id',
  asyncHandler(async (req, res) => {
    const b = suaSchema.parse(req.body);
    const id = String(req.params.id);
    if (!(await timCuoc(id))) throw new ApiError(404, 'Không tìm thấy cuộc trò chuyện');
    const kh = b.customer !== undefined ? await khopKhachCuoc(b.customer) : undefined;
    await suaCuoc(id, { enabled: b.enabled, ghiChu: b.ghiChu, ...(kh || {}) });
    res.json({ ok: true, thread: await timCuoc(id) });
  }),
);

zaloRouter.post(
  '/digest',
  asyncHandler(async (req, res) => {
    const threadId = typeof req.body?.threadId === 'string' ? req.body.threadId : undefined;
    res.json(await rutTriThucZalo({ epNgay: true, threadId, limit: threadId ? 1 : 3 }));
  }),
);

/**
 * "⚡ Đọc & phân loại ngay" (anh Tâm 10/10/2026: "không cần chờ đến tối") — một bước ~40 giây; trang
 * gọi lặp tới khi `buoc = 'xong'`.
 */
zaloRouter.post(
  '/process',
  asyncHandler(async (_req, res) => {
    res.json(await xuLyNgay());
  }),
);

/** Vài tin gần đây của một cuộc — để anh xem nội dung rồi quyết Học / Bỏ qua. */
zaloRouter.get(
  '/threads/:id/messages',
  asyncHandler(async (req, res) => {
    const tin = await tinGanDay(String(req.params.id), 20);
    res.json({ messages: tin.reverse() });
  }),
);

/** "🧹 Lọc lại nhóm" — xét lại nhóm AI đã tự cho học theo tiêu chí chặt; mỗi lần ~40 giây, trang gọi lặp. */
zaloRouter.post(
  '/loc-lai',
  asyncHandler(async (_req, res) => {
    try {
      res.json({ ok: true, ...(await locLaiNhom(Date.now() + 40_000)) });
    } catch (e) {
      res.json({ ok: false, note: (e as Error).message.slice(0, 300), xet: 0, giu: 0, bo: 0, conLai: 0 });
    }
  }),
);

// ── Gửi tin hàng loạt (anh Tâm 20/10/2026). Tin chỉ đi ra khi anh soạn + tích chọn người nhận ở đây; máy chủ gửi
// chậm theo nhịp cron (lib/zaloGui.ts). ──

/** Mọi người / nhóm có thể nhận + thẻ phân loại Zalo + tình hình gửi hôm nay. */
zaloRouter.get(
  '/gui/nguoi-nhan',
  asyncHandler(async (_req, res) => {
    const { dsNguoiNhan, demDaGuiTu } = await import('./zaloGui.repo.js');
    const g = await import('../lib/zaloGui.js');
    const { nowTz } = await import('../lib/datetime.js');
    try {
      const [d, daGui] = await Promise.all([dsNguoiNhan(), demDaGuiTu(nowTz().startOf('day').toISOString())]);
      res.json({ ...d, daGuiHomNay: daGui, gioiHanNgay: g.GIOI_HAN_NGAY, gioGui: g.GIO_GUI, toiDaNguoi: g.TOI_DA_NGUOI });
    } catch (e) {
      if (isMissingTable(e)) res.json({ needsMigrate: true, ds: [], nhan: [], danhBaLuc: '', daGuiHomNay: 0, gioiHanNgay: g.GIOI_HAN_NGAY, gioGui: g.GIO_GUI, toiDaNguoi: g.TOI_DA_NGUOI });
      else throw e;
    }
  }),
);

/** Lấy bạn bè + thẻ phân loại + nhóm từ Zalo về (~10 giây). */
zaloRouter.post(
  '/gui/danh-ba',
  asyncHandler(async (_req, res) => {
    const { capNhatDanhBaZalo } = await import('./zalo.client.js');
    res.json(await capNhatDanhBaZalo());
  }),
);

zaloRouter.get(
  '/gui',
  asyncHandler(async (_req, res) => {
    const { dsChienDich } = await import('./zaloGui.repo.js');
    try {
      res.json({ ds: await dsChienDich(20) });
    } catch (e) {
      if (isMissingTable(e)) res.json({ ds: [], needsMigrate: true });
      else throw e;
    }
  }),
);

zaloRouter.get(
  '/gui/:id',
  asyncHandler(async (req, res) => {
    const { chiTietChienDich } = await import('./zaloGui.repo.js');
    res.json({ ds: await chiTietChienDich(String(req.params.id)) });
  }),
);

/** Tạo chiến dịch: nội dung + danh sách người đã tích chọn. Chỉ nhận người có trong danh bạ / các cuộc của app. */
zaloRouter.post(
  '/gui',
  asyncHandler(async (req, res) => {
    const g = await import('../lib/zaloGui.js');
    const anhSchema = z.object({
      url: z.string().url().max(500),
      ten: z.string().min(1).max(200),
      kichThuoc: z.number().int().min(1).max(g.ANH_TOI_DA_BYTE),
      rong: z.number().int().min(0).max(20000),
      cao: z.number().int().min(0).max(20000),
    });
    const b = z
      .object({
        noiDung: z.string().trim().max(2000).default(''),
        anh: z.array(anhSchema).max(g.TOI_DA_ANH).default([]),
        ids: z.array(z.string().min(1).max(64)).min(1).max(g.TOI_DA_NGUOI),
      })
      .refine((x) => x.noiDung.length >= 2 || x.anh.length > 0, { message: 'Soạn nội dung hoặc chọn ảnh' })
      .parse(req.body);
    if (b.anh.some((a) => !g.laAnhHopLe(a))) throw new ApiError(400, 'Ảnh không hợp lệ — chỉ JPG / PNG / WEBP tải lên từ trang này');
    const { dsNguoiNhan, taoChienDich } = await import('./zaloGui.repo.js');
    const { newId } = await import('../util/id.js');
    const { nowTz } = await import('../lib/datetime.js');
    const theoId = new Map((await dsNguoiNhan()).ds.map((x) => [x.id, x]));
    const chon = [...new Set(b.ids)].map((id) => theoId.get(id)).filter((x): x is NonNullable<typeof x> => !!x);
    if (!chon.length) throw new ApiError(400, 'Không có người nhận hợp lệ');
    const id = newId('ZG-');
    await taoChienDich({ id, noiDung: b.noiDung, nguoi: req.user!.name, taoLuc: nowTz().toISOString(), anh: b.anh }, chon);
    res.json({ ok: true, id, soNguoi: chon.length, boQua: b.ids.length - chon.length });
  }),
);

/** Dừng hẳn / tạm dừng / chạy tiếp một chiến dịch. */
zaloRouter.post(
  '/gui/:id/trang-thai',
  asyncHandler(async (req, res) => {
    const b = z.object({ trangThai: z.enum(['dung', 'tam_dung', 'dang_gui']) }).parse(req.body);
    const { doiTrangThaiChienDich } = await import('./zaloGui.repo.js');
    if (!(await doiTrangThaiChienDich(String(req.params.id), b.trangThai))) throw new ApiError(404, 'Không tìm thấy chiến dịch');
    res.json({ ok: true });
  }),
);
