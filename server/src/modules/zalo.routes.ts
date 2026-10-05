// Zalo cá nhân → kho tri thức (anh Tâm 5/10/2026).
//
//   /api/zalo/worker/*  — worker (thư mục zalo-worker/, chạy trên máy của anh) gọi, xác thực bằng
//                         Bearer ZALO_WORKER_SECRET. Worker chỉ gửi TIN NHẮN và TRẠNG THÁI, không
//                         bao giờ gửi phiên đăng nhập Zalo.
//   /api/zalo/*         — giám đốc/admin xem trạng thái, bật/tắt từng cuộc, rút tri thức ngay.
import { Router } from 'express';
import { z } from 'zod';
import { timingSafeEqual } from 'node:crypto';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { runInBackground } from '../util/background.js';
import { nowTz } from '../lib/datetime.js';
import { docTrangThai, ghiTrangThai, dsCuoc, suaCuoc, timCuoc } from './zalo.repo.js';
import { nhanTin, rutTriThucZalo, khopKhachCuoc } from './zalo.service.js';
import { isMissingTable } from './brain.repo.js';

export const zaloRouter = Router();

/** Chỉ worker có đúng khoá mới gửi tin được. Chưa đặt khoá trên Vercel thì đóng cửa hẳn. */
function checkWorker(auth: string | undefined): void {
  const secret = process.env.ZALO_WORKER_SECRET || '';
  if (secret.length < 24) throw new ApiError(503, 'Chưa cấu hình ZALO_WORKER_SECRET (≥ 24 ký tự) trên máy chủ');
  const got = Buffer.from(String(auth || '').replace(/^Bearer\s+/i, ''));
  const want = Buffer.from(secret);
  if (got.length !== want.length || !timingSafeEqual(got, want)) throw new ApiError(401, 'Sai khoá worker');
}

const statusSchema = z.object({
  status: z.enum(['offline', 'waiting_qr', 'scanned', 'online', 'error']),
  qr: z.string().max(200_000).optional().default(''),
  account: z.string().max(100).optional().default(''),
  note: z.string().max(300).optional().default(''),
});

/** Worker báo trạng thái (mỗi ~5 phút là nhịp tim). Nhịp tim cũng là lúc rút tri thức chạy nền. */
zaloRouter.post(
  '/worker/status',
  asyncHandler(async (req, res) => {
    checkWorker(req.headers.authorization);
    const b = statusSchema.parse(req.body);
    // QR chỉ giữ lúc đang chờ quét — đăng nhập xong là xoá, không để ảnh QR nằm lại.
    await ghiTrangThai({ ...b, qr: b.status === 'waiting_qr' ? b.qr : '', lastSeen: nowTz().toISOString() });
    if (b.status === 'online') runInBackground(rutTriThucZalo().catch((e) => console.warn('[zalo] rút nền:', e)));
    res.json({ ok: true });
  }),
);

const tinSchema = z.object({
  messages: z
    .array(
      z.object({
        msgId: z.string().min(1).max(64),
        threadId: z.string().min(1).max(64),
        threadName: z.string().max(200).optional(),
        isGroup: z.boolean().optional(),
        fromSelf: z.boolean().optional(),
        sender: z.string().max(200).optional(),
        content: z.unknown(),
        ts: z.union([z.string(), z.number()]),
      }),
    )
    .max(300),
});

zaloRouter.post(
  '/worker/messages',
  asyncHandler(async (req, res) => {
    checkWorker(req.headers.authorization);
    const b = tinSchema.parse(req.body);
    res.json({ ok: true, ...(await nhanTin(b.messages)) });
  }),
);

// ── Giám đốc ──

zaloRouter.use(requireAuth, requireRole('director', 'admin'));

zaloRouter.get(
  '/status',
  asyncHandler(async (_req, res) => {
    try {
      const [st, cuoc] = await Promise.all([docTrangThai(), dsCuoc(300)]);
      const lastMs = Date.parse(st.lastSeen);
      // Quá 12 phút không có nhịp tim → coi như worker đã tắt, dù dòng cuối ghi gì.
      const matKetNoi = st.status === 'online' && (!Number.isFinite(lastMs) || Date.now() - lastMs > 12 * 60_000);
      res.json({
        configured: (process.env.ZALO_WORKER_SECRET || '').length >= 24,
        ...st,
        status: matKetNoi ? 'offline' : st.status,
        threads: cuoc,
      });
    } catch (e) {
      if (isMissingTable(e) || /zalo_/.test((e as Error).message)) {
        res.json({ configured: false, status: 'offline', qr: '', account: '', note: '', lastSeen: '', threads: [], needsMigrate: true });
        return;
      }
      throw e;
    }
  }),
);

const suaSchema = z.object({ enabled: z.boolean().optional(), customer: z.string().max(200).optional() });

zaloRouter.post(
  '/threads/:id',
  asyncHandler(async (req, res) => {
    const b = suaSchema.parse(req.body);
    const id = String(req.params.id);
    if (!(await timCuoc(id))) throw new ApiError(404, 'Không tìm thấy cuộc trò chuyện');
    const kh = b.customer !== undefined ? await khopKhachCuoc(b.customer) : undefined;
    await suaCuoc(id, { enabled: b.enabled, ...(kh || {}) });
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
