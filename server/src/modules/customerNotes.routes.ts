import { Router } from 'express';
import { z } from 'zod';
import { del } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { verifyToken } from '../auth/jwt.js';
import { getNotes, findNote, upsertNote, deleteNote, type CustomerNote } from './customerNotes.repo.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';

export const customerNotesRouter = Router();

// Ảnh + PDF được phép tải lên (video chỉ dán link, không upload file).
const ALLOWED_CONTENT_TYPES = [
  'image/jpeg',
  'image/png',
  'image/webp',
  'image/gif',
  'application/pdf',
];

// Endpoint cấp token cho Vercel Blob (client-upload). KHÔNG bọc requireAuth vì
// callback onUploadCompleted do hạ tầng Vercel gọi, không mang JWT. Thay vào đó
// xác thực JWT ngay trong onBeforeGenerateToken qua clientPayload do frontend gửi.
customerNotesRouter.post(
  '/upload',
  asyncHandler(async (req, res) => {
    const body = req.body as HandleUploadBody;
    const json = await handleUpload({
      body,
      request: req,
      onBeforeGenerateToken: async (_pathname, clientPayload) => {
        try {
          verifyToken(String(clientPayload || ''));
        } catch {
          throw new ApiError(401, 'Phiên đăng nhập không hợp lệ');
        }
        return {
          allowedContentTypes: ALLOWED_CONTENT_TYPES,
          maximumSizeInBytes: 20 * 1024 * 1024, // 20MB / tệp
          addRandomSuffix: true,
        };
      },
      onUploadCompleted: async () => {
        // Không cần xử lý thêm — URL được lưu cùng note khi bấm Lưu.
      },
    });
    res.json(json);
  }),
);

// Các route còn lại: mọi thành viên đăng nhập đều dùng được.
customerNotesRouter.use(requireAuth);

customerNotesRouter.get(
  '/',
  asyncHandler(async (_req, res) => {
    res.json({ notes: await getNotes() });
  }),
);

const attachmentSchema = z.object({
  kind: z.enum(['image', 'pdf', 'video']),
  url: z.string().min(1),
  name: z.string().optional().default(''),
});

const noteSchema = z.object({
  id: z.string().optional(),
  customer: z.string().min(1, 'Nhập tên khách hàng'),
  content: z.string().optional().default(''),
  color: z.string().optional().default(''),
  attachments: z.array(attachmentSchema).optional().default([]),
});

customerNotesRouter.post(
  '/',
  asyncHandler(async (req, res) => {
    const b = noteSchema.parse(req.body);
    const existing = b.id ? await findNote(b.id) : undefined;
    const now = nowTz().toISOString();
    const note: CustomerNote = {
      id: existing?.id || b.id || newId('CN-'),
      customer: b.customer,
      content: b.content,
      color: b.color,
      attachments: b.attachments,
      createdBy: existing?.createdBy || req.user!.sub,
      createdName: existing?.createdName || req.user!.name,
      createdAt: existing?.createdAt || now,
      updatedAt: now,
    };
    await upsertNote(note);
    res.json({ ok: true, id: note.id });
  }),
);

customerNotesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const note = await findNote(String(req.params.id));
    await deleteNote(String(req.params.id));
    // Best-effort dọn ảnh/PDF trên Blob (bỏ qua link video).
    const urls = (note?.attachments || []).filter((a) => a.kind !== 'video').map((a) => a.url);
    if (urls.length) {
      try {
        await del(urls);
      } catch {
        // Không chặn xóa note nếu dọn blob lỗi.
      }
    }
    res.json({ ok: true });
  }),
);
