import { Router } from 'express';
import { z } from 'zod';
import { del } from '@vercel/blob';
import { handleUpload, type HandleUploadBody } from '@vercel/blob/client';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { verifyToken } from '../auth/jwt.js';
import {
  getNotes,
  findNote,
  upsertNote,
  deleteNote,
  addHistory,
  getHistory,
  deleteHistory,
  type CustomerNote,
} from './customerNotes.repo.js';
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
      token: process.env.mt_READ_WRITE_TOKEN,
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

    // Lưu đè note cũ → chụp bản cũ vào lịch sử (chỉ khi nội dung thực sự đổi).
    if (existing && (existing.content !== b.content || existing.customer !== b.customer || existing.color !== b.color)) {
      await addHistory({
        id: newId('CNH-'),
        noteId: existing.id,
        customer: existing.customer,
        content: existing.content,
        color: existing.color,
        savedAt: existing.updatedAt || existing.createdAt,
        savedName: existing.updatedName || existing.createdName,
      });
    }

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
      updatedBy: req.user!.sub,
      updatedName: req.user!.name,
    };
    await upsertNote(note);
    res.json({ ok: true, id: note.id });
  }),
);

// Lịch sử các lần sửa của 1 note (mới nhất trước).
customerNotesRouter.get(
  '/:id/history',
  asyncHandler(async (req, res) => {
    res.json({ history: await getHistory(String(req.params.id)) });
  }),
);

// Lấy các URL ảnh/PDF đã upload lên Vercel Blob có trong note (cả nội dung HTML
// lẫn mảng attachments cũ) để dọn khi xóa. Bỏ qua link video (không phải Blob).
function blobUrlsOf(note: { content?: string; attachments?: { url: string }[] } | undefined): string[] {
  if (!note) return [];
  const found = new Set<string>();
  const re = /https?:\/\/[^\s"'<>]+\.blob\.vercel-storage\.com[^\s"'<>]*/g;
  for (const m of (note.content || '').match(re) || []) found.add(m);
  for (const a of note.attachments || []) if (/\.blob\.vercel-storage\.com/.test(a.url)) found.add(a.url);
  return [...found];
}

customerNotesRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const note = await findNote(id);
    // Gom blob từ cả bản hiện tại lẫn các bản lịch sử trước khi xóa.
    const history = await getHistory(id);
    await deleteNote(id);
    await deleteHistory(id);
    const urls = new Set<string>(blobUrlsOf(note));
    for (const h of history) for (const u of blobUrlsOf({ content: h.content })) urls.add(u);
    if (urls.size) {
      try {
        await del([...urls], { token: process.env.mt_READ_WRITE_TOKEN });
      } catch {
        // Không chặn xóa note nếu dọn blob lỗi.
      }
    }
    res.json({ ok: true });
  }),
);
