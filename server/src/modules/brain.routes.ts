import { Router } from 'express';
import { z } from 'zod';
import { del } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { verifyToken } from '../auth/jwt.js';
import {
  isMissingTable,
  browseChunks,
  statsBySource,
  deleteChunk,
  brainTableReady,
  listProfiles,
  addDocument,
  listDocuments,
  findDocument,
  deleteDocument,
  type BrainDocument,
} from './brain.repo.js';
import {
  backfillPage,
  countRemaining,
  brainAvailable,
  processDocumentInBackground,
  removeSource,
  docTepChat,
  duaTepVaoKho,
} from './brain.service.js';
import {
  xetDuaVaoKho,
  suaMuc,
  traLoiCauHoi,
  boQuaCauHoi,
  phanLoaiLaiKho,
  demChuaPhanLoai,
  chuyenLuuYKhach,
  demLuuYChuaChuyen,
  type NguoiGui,
} from './brainItems.service.js';
import {
  listItems,
  findItem,
  countByCategory,
  countByStatus,
  listQuestions,
  countOpenQuestions,
} from './brainItems.repo.js';
import { NHOM, chuanTen } from '../lib/brainGate.js';
import { findById } from './members.repo.js';
import { getCustomers } from './crm.repo.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';

export const brainRouter = Router();

// Tệp cho phép tải lên kho. Ảnh cũng nhận vì Gemini đọc được chữ trong ảnh
// (chụp hợp đồng, báo giá giấy…). Ghi âm để sẵn cho lần sau, hiện chưa bật.
const ALLOWED_CONTENT_TYPES = [
  'application/pdf',
  'text/plain',
  'text/markdown',
  'text/csv',
  'image/jpeg',
  'image/png',
  'image/webp',
];

// Cấp token cho Vercel Blob (client upload). KHÔNG bọc requireAuth vì callback
// onUploadCompleted do hạ tầng Vercel gọi, không mang JWT — xác thực qua clientPayload.
brainRouter.post(
  '/upload',
  asyncHandler(async (req, res) => {
    const body = req.body as HandleUploadBody;
    const json = await handleUpload({
      body,
      request: req,
      token: process.env.mt_READ_WRITE_TOKEN,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        try {
          verifyToken(String(clientPayload || ''));
        } catch {
          throw new ApiError(401, 'Phiên đăng nhập không hợp lệ');
        }
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: 10 * 1024 * 1024, // 10MB — AI phải đọc trọn tệp trong 1 lần gọi
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Tài liệu được đăng ký qua POST /documents ngay sau khi upload xong.
      },
    });
    res.json(json);
  }),
);

brainRouter.use(requireAuth);

const DIRECTOR_ROLES = new Set(['director', 'admin']);

/** Người đang đăng nhập theo dạng bộ phân loại cần — req.user không mang phòng ban nên tra lại. */
async function nguoiDangNhap(req: { user?: { sub: string; name: string; role: string } }): Promise<NguoiGui> {
  const m = await findById(req.user!.sub).catch(() => undefined);
  return { id: req.user!.sub, name: m?.fullName || req.user!.name, role: req.user!.role, teamId: m?.teamId || '' };
}

function chiGiamDoc(req: { user?: { role: string } }): void {
  if (!DIRECTOR_ROLES.has(req.user!.role)) throw new ApiError(403, 'Chỉ giám đốc/admin làm được việc này');
}

/** Tổng quan kho tri thức: số mục theo nguồn + số còn chờ nạp + trạng thái sẵn sàng. */
brainRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    // Chưa chạy migrate → báo rõ việc cần làm thay vì ném lỗi SQL ra màn hình.
    if (!(await brainTableReady())) {
      res.json({
        enabled: false,
        needsMigrate: true,
        reason: 'Chưa tạo bảng kho tri thức. Vào Quản trị → bấm "Cập nhật cấu trúc DB".',
        total: 0,
        bySource: [],
        remaining: 0,
      });
      return;
    }
    if (!(await brainAvailable())) {
      res.json({
        enabled: false,
        needsMigrate: false,
        reason: 'Kho cần API key Gemini (phần ghi nhớ luôn dùng Gemini kể cả khi trợ lý chạy Claude).',
        total: 0,
        bySource: [],
        remaining: 0,
      });
      return;
    }
    const [bySource, remaining] = await Promise.all([statsBySource(), countRemaining()]);
    res.json({
      enabled: true,
      needsMigrate: false,
      total: bySource.reduce((s, x) => s + x.count, 0),
      bySource,
      remaining,
    });
  }),
);

/** Hồ sơ 360° các khách hàng đã tổng hợp — cho trang Kho tri thức. */
brainRouter.get(
  '/profiles',
  asyncHandler(async (_req, res) => {
    if (!(await brainTableReady())) {
      res.json({ profiles: [] });
      return;
    }
    res.json({ profiles: await listProfiles(100) });
  }),
);

/** Duyệt/tìm theo từ khoá chữ (không tốn API embeddings) — cho trang Kho tri thức. */
brainRouter.get(
  '/chunks',
  asyncHandler(async (req, res) => {
    if (!(await brainTableReady())) {
      res.json({ chunks: [], canDelete: false, needsMigrate: true });
      return;
    }
    const directorScope = DIRECTOR_ROLES.has(req.user!.role);
    const chunks = await browseChunks({
      keyword: String(req.query.q || ''),
      sourceType: String(req.query.source || '') || undefined,
      directorScope,
      memberId: req.user!.sub,
      teamId: directorScope ? undefined : (await nguoiDangNhap(req)).teamId,
      limit: 60,
    });
    res.json({ chunks, canDelete: directorScope });
  }),
);

/** Xoá một mục sai/lỗi thời khỏi kho (chỉ giám đốc/admin). */
brainRouter.delete(
  '/chunks/:id',
  asyncHandler(async (req, res) => {
    if (!DIRECTOR_ROLES.has(req.user!.role)) {
      res.status(403).json({ error: 'Chỉ giám đốc/admin được xoá mục trong kho' });
      return;
    }
    await deleteChunk(String(req.params.id));
    res.json({ ok: true });
  }),
);

/**
 * Chốt một kết luận từ hội thoại vào kho tri thức (nút "📌 Lưu vào kho tri thức" trong chat).
 * Người dùng chủ động bấm, nhưng vẫn qua bộ phân loại: anh Tâm 4/10/2026 "tất cả đều đưa nhưng
 * em phải lựa" — chặn bí mật, ẩn SĐT khách, gắn nhãn, chuyện riêng của giám đốc giữ riêng.
 */
const noteSchema = z.object({
  title: z.string().min(1).max(200),
  content: z.string().min(10).max(20000),
  customer: z.string().max(200).optional().default(''),
});

brainRouter.post(
  '/notes',
  asyncHandler(async (req, res) => {
    if (!(await brainTableReady())) throw new ApiError(400, 'Kho tri thức chưa khởi tạo (Quản trị → Cập nhật cấu trúc DB)');
    const b = noteSchema.parse(req.body);
    const r = await xetDuaVaoKho(
      { title: b.title.trim(), body: b.content.trim(), customer: b.customer.trim(), source: 'chat' },
      await nguoiDangNhap(req),
    );
    res.json({ ok: !!r.item && r.item.status !== 'rejected', id: r.item?.id || '', status: r.item?.status || 'rejected', message: r.message });
  }),
);

// ── Mục tri thức ("bộ não thứ hai", anh Tâm 4/10/2026) ──

/** Nhóm + số mục đã ban hành mỗi nhóm (trong phạm vi người xem); giám đốc kèm số chờ duyệt/câu hỏi. */
brainRouter.get(
  '/categories',
  asyncHandler(async (req, res) => {
    const gd = DIRECTOR_ROLES.has(req.user!.role);
    const nguoi = await nguoiDangNhap(req);
    try {
      const [dem, trangThai, cauHoi] = await Promise.all([
        countByCategory({ directorScope: gd, teamId: nguoi.teamId }),
        gd ? countByStatus() : Promise.resolve({} as Record<string, number>),
        gd ? countOpenQuestions() : Promise.resolve(0),
      ]);
      res.json({
        categories: Object.entries(NHOM)
          .filter(([k]) => gd || k !== 'rieng')
          .map(([key, label]) => ({ key, label, count: dem[key] || 0 })),
        pending: trangThai.pending || 0,
        openQuestions: cauHoi,
        isDirector: gd,
      });
    } catch (e) {
      if (isMissingTable(e)) {
        res.json({ categories: [], pending: 0, openQuestions: 0, isDirector: gd, needsMigrate: true });
        return;
      }
      throw e;
    }
  }),
);

/**
 * Danh sách mục. Người thường chỉ thấy mục đã ban hành trong phạm vi của mình, hoặc "của tôi"
 * (mọi trạng thái, để biết đóng góp của mình đang ở đâu). Giám đốc xem được mọi trạng thái.
 */
brainRouter.get(
  '/items',
  asyncHandler(async (req, res) => {
    const gd = DIRECTOR_ROLES.has(req.user!.role);
    const nguoi = await nguoiDangNhap(req);
    const mine = String(req.query.mine || '') === '1';
    const status = gd ? String(req.query.status || 'published') : 'published';
    const kw = chuanTen(String(req.query.q || ''));
    try {
      const items = await listItems({
        directorScope: gd,
        teamId: nguoi.teamId,
        status,
        category: String(req.query.category || '') || undefined,
        customerId: String(req.query.customerId || '') || undefined,
        keyword: kw || undefined,
        submittedBy: mine ? nguoi.id : undefined,
        limit: 200,
      });
      res.json({ items });
    } catch (e) {
      if (isMissingTable(e)) {
        res.json({ items: [], needsMigrate: true });
        return;
      }
      throw e;
    }
  }),
);

const itemSchema = z.object({
  title: z.string().min(1).max(200),
  body: z.string().min(10).max(30000),
  customer: z.string().max(200).optional().default(''),
});

/** Đóng góp một mục — ai cũng gửi được, bộ phân loại quyết định đi đâu. */
brainRouter.post(
  '/items',
  asyncHandler(async (req, res) => {
    const b = itemSchema.parse(req.body);
    const r = await xetDuaVaoKho(
      { title: b.title.trim(), body: b.body.trim(), customer: b.customer.trim(), source: 'manual' },
      await nguoiDangNhap(req),
    );
    res.json({ ok: !!r.item, item: r.item, message: r.message });
  }),
);

const patchSchema = z.object({
  title: z.string().min(1).max(200).optional(),
  body: z.string().min(10).max(30000).optional(),
  category: z.string().max(40).optional(),
  scope: z.string().max(40).optional(),
  status: z.enum(['published', 'pending', 'rejected', 'archived']).optional(),
  customer: z.string().max(200).optional(),
});

/** Giám đốc: ban hành / sửa nhãn / lưu trữ. Người gửi: sửa mục đang chờ duyệt của chính mình. */
brainRouter.patch(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const patch = patchSchema.parse(req.body);
    try {
      const item = await suaMuc(String(req.params.id), patch, await nguoiDangNhap(req));
      res.json({ ok: true, item });
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
  }),
);

/** Đọc một mục — kiểm phạm vi phía máy chủ. */
brainRouter.get(
  '/items/:id',
  asyncHandler(async (req, res) => {
    const item = await findItem(String(req.params.id));
    const gd = DIRECTOR_ROLES.has(req.user!.role);
    const nguoi = await nguoiDangNhap(req);
    const xemDuoc =
      !!item &&
      (gd ||
        item.submittedBy === nguoi.id ||
        (item.status === 'published' && (item.scope === 'all' || item.scope === `team:${nguoi.teamId}`)));
    if (!xemDuoc) throw new ApiError(404, 'Không tìm thấy mục');
    res.json({ item });
  }),
);

/** Khách hàng để chọn ở tab Khách hàng — CHỈ tên + mã (không SĐT), kèm số mục tri thức của mỗi khách. */
brainRouter.get(
  '/customers',
  asyncHandler(async (req, res) => {
    const gd = DIRECTOR_ROLES.has(req.user!.role);
    const nguoi = await nguoiDangNhap(req);
    const [khach, muc] = await Promise.all([
      getCustomers(),
      listItems({ directorScope: gd, teamId: nguoi.teamId, category: 'khach_hang', limit: 300 }).catch(() => []),
    ]);
    const dem = new Map<string, number>();
    for (const i of muc) if (i.customerId) dem.set(i.customerId, (dem.get(i.customerId) || 0) + 1);
    res.json({
      customers: khach
        .map((c) => ({ id: c.id, name: c.name, count: dem.get(c.id) || 0 }))
        .sort((a, b) => b.count - a.count || a.name.localeCompare(b.name, 'vi')),
    });
  }),
);

// ── Câu hỏi chưa có lời giải (giám đốc) ──

brainRouter.get(
  '/questions',
  asyncHandler(async (req, res) => {
    chiGiamDoc(req);
    const st = ['open', 'answered', 'dismissed'].includes(String(req.query.status)) ? String(req.query.status) : 'open';
    try {
      res.json({ questions: await listQuestions(st, 100) });
    } catch (e) {
      if (isMissingTable(e)) {
        res.json({ questions: [], needsMigrate: true });
        return;
      }
      throw e;
    }
  }),
);

const answerSchema = z.object({ answer: z.string().min(5).max(20000), title: z.string().max(200).optional() });

brainRouter.post(
  '/questions/:id/answer',
  asyncHandler(async (req, res) => {
    chiGiamDoc(req);
    const b = answerSchema.parse(req.body);
    try {
      const r = await traLoiCauHoi(String(req.params.id), b.answer, await nguoiDangNhap(req), b.title);
      res.json({ ok: true, message: r.ketQua.message, item: r.ketQua.item });
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
  }),
);

brainRouter.post(
  '/questions/:id/dismiss',
  asyncHandler(async (req, res) => {
    chiGiamDoc(req);
    await boQuaCauHoi(String(req.params.id)).catch((e) => {
      throw new ApiError(400, (e as Error).message);
    });
    res.json({ ok: true });
  }),
);

// ── Dọn kho cũ (giám đốc, chạy theo lô — trang gọi lặp tới khi còn 0) ──

brainRouter.get(
  '/cleanup',
  asyncHandler(async (req, res) => {
    chiGiamDoc(req);
    try {
      const [chuaPhanLoai, luuYChuaChuyen] = await Promise.all([demChuaPhanLoai(), demLuuYChuaChuyen()]);
      res.json({ chuaPhanLoai, luuYChuaChuyen });
    } catch (e) {
      if (isMissingTable(e)) {
        res.json({ chuaPhanLoai: 0, luuYChuaChuyen: 0, needsMigrate: true });
        return;
      }
      throw e;
    }
  }),
);

brainRouter.post(
  '/reclassify',
  asyncHandler(async (req, res) => {
    chiGiamDoc(req);
    res.json(await phanLoaiLaiKho(6));
  }),
);

brainRouter.post(
  '/migrate-customer-notes',
  asyncHandler(async (req, res) => {
    chiGiamDoc(req);
    res.json(await chuyenLuuYKhach(6));
  }),
);

// ── Tài liệu ──

brainRouter.get(
  '/documents',
  asyncHandler(async (_req, res) => {
    if (!(await brainTableReady())) {
      res.json({ documents: [], needsMigrate: true });
      return;
    }
    res.json({ documents: await listDocuments(100) });
  }),
);

const docSchema = z.object({
  url: z.string().url(),
  name: z.string().min(1),
  mime: z.string().min(1),
  customer: z.string().optional().default(''),
});

/** Đăng ký tài liệu vừa upload → trả về ngay, AI đọc nội dung chạy nền. */
brainRouter.post(
  '/documents',
  asyncHandler(async (req, res) => {
    const b = docSchema.parse(req.body);
    if (!ALLOWED_CONTENT_TYPES.includes(b.mime)) throw new ApiError(400, 'Định dạng tệp không được hỗ trợ');
    const doc: BrainDocument = {
      id: newId('D-'),
      kind: b.mime === 'application/pdf' ? 'pdf' : b.mime.startsWith('image/') ? 'image' : 'text',
      url: b.url,
      name: b.name,
      mime: b.mime,
      customer: b.customer.trim(),
      uploadedBy: req.user!.sub,
      uploadedName: req.user!.name,
      status: 'pending',
      error: '',
      transcript: '',
      createdAt: nowTz().toISOString(),
      processedAt: '',
    };
    await addDocument(doc);
    res.json({ ok: true, id: doc.id });
    processDocumentInBackground(doc.id);
  }),
);

/**
 * Tệp đính kèm trong khung chat (anh Tâm 5/10/2026): tải lên xong gọi đây để AI ĐỌC ngay — tách
 * khỏi lượt hỏi để đọc PDF dài không ăn vào 60 giây của lượt trả lời. Chưa đưa vào kho.
 */
brainRouter.post(
  '/attachments',
  asyncHandler(async (req, res) => {
    const b = docSchema.parse(req.body);
    if (!ALLOWED_CONTENT_TYPES.includes(b.mime)) {
      throw new ApiError(400, 'Chỉ đọc được PDF, ảnh (JPG/PNG/WEBP), TXT, MD, CSV. Excel/Word thì xuất ra PDF hoặc CSV.');
    }
    if (!(await brainAvailable())) throw new ApiError(400, 'Đọc tệp cần API key Gemini (Quản trị → Trợ lý AI).');
    const doc: BrainDocument = {
      id: newId('D-'),
      kind: b.mime === 'application/pdf' ? 'pdf' : b.mime.startsWith('image/') ? 'image' : 'text',
      url: b.url,
      name: b.name,
      mime: b.mime,
      customer: b.customer.trim(),
      uploadedBy: req.user!.sub,
      uploadedName: req.user!.name,
      status: 'pending',
      error: '',
      transcript: '',
      createdAt: nowTz().toISOString(),
      processedAt: '',
    };
    await addDocument(doc);
    const r = await docTepChat(doc.id);
    res.json({ id: doc.id, name: doc.name, ok: r.ok, chars: r.chars, error: r.error || '' });
  }),
);

/** Đưa một tệp (đính kèm trong chat) vào kho — qua bộ phân loại. Chỉ người gửi tệp hoặc giám đốc. */
brainRouter.post(
  '/documents/:id/ingest',
  asyncHandler(async (req, res) => {
    const doc = await findDocument(String(req.params.id));
    if (!doc) throw new ApiError(404, 'Không tìm thấy tệp');
    if (doc.uploadedBy !== req.user!.sub && !DIRECTOR_ROLES.has(req.user!.role)) {
      throw new ApiError(403, 'Chỉ người gửi tệp được đưa tệp này vào kho');
    }
    try {
      res.json({ ok: true, message: await duaTepVaoKho(doc.id) });
    } catch (e) {
      throw new ApiError(400, (e as Error).message);
    }
  }),
);

/** Xử lý lại tài liệu bị lỗi. */
brainRouter.post(
  '/documents/:id/retry',
  asyncHandler(async (req, res) => {
    const doc = await findDocument(String(req.params.id));
    if (!doc) throw new ApiError(404, 'Không tìm thấy tài liệu');
    res.json({ ok: true });
    processDocumentInBackground(doc.id);
  }),
);

brainRouter.delete(
  '/documents/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const doc = await findDocument(id);
    await deleteDocument(id);
    await removeSource('document', id);
    if (doc?.url) {
      await del(doc.url, { token: process.env.mt_READ_WRITE_TOKEN }).catch(() => undefined);
    }
    res.json({ ok: true });
  }),
);

/** Ép nạp ngay một lượt (kho vẫn tự nạp dần khi dùng app — nút này chỉ để không phải chờ). */
const sweepSchema = z.object({ limit: z.number().min(1).max(60).optional().default(30) });
brainRouter.post(
  '/backfill',
  asyncHandler(async (req, res) => {
    if (!DIRECTOR_ROLES.has(req.user!.role)) {
      res.status(403).json({ error: 'Không đủ quyền' });
      return;
    }
    const { limit } = sweepSchema.parse(req.body ?? {});
    res.json(await backfillPage(limit));
  }),
);
