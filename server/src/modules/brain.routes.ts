import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { browseChunks, statsBySource, deleteChunk } from './brain.repo.js';
import { backfillPage, countRemaining, brainAvailable } from './brain.service.js';

export const brainRouter = Router();
brainRouter.use(requireAuth);

const DIRECTOR_ROLES = new Set(['director', 'admin']);

/** Tổng quan kho tri thức: số mục theo nguồn + số còn chờ nạp + trạng thái bật/tắt. */
brainRouter.get(
  '/stats',
  asyncHandler(async (_req, res) => {
    const enabled = await brainAvailable();
    if (!enabled) {
      res.json({ enabled: false, total: 0, bySource: [], remaining: 0 });
      return;
    }
    const [bySource, remaining] = await Promise.all([statsBySource(), countRemaining()]);
    res.json({
      enabled: true,
      total: bySource.reduce((s, x) => s + x.count, 0),
      bySource,
      remaining,
    });
  }),
);

/** Duyệt/tìm theo từ khoá chữ (không tốn API embeddings) — cho trang Kho tri thức. */
brainRouter.get(
  '/chunks',
  asyncHandler(async (req, res) => {
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
