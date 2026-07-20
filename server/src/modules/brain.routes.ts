import { Router } from 'express';
import { z } from 'zod';
import { del } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { verifyToken } from '../auth/jwt.js';
import {
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
} from './brain.service.js';
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
