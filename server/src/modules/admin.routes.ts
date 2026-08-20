import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { syncCatalogFromSource, applyCatalogPoints } from './admin.sync.js';
import { adminMembersRouter } from './admin.members.routes.js';
import { adminPayrollRouter } from './admin.payroll.routes.js';
import { upsertCatalogItem } from './catalog.repo.js';
import { upsertHoliday } from './holidays.repo.js';
import { upsertTeam } from './teams.repo.js';
import { storageInfo } from './storage.service.js';
import { setConfigValue, getConfig } from '../config.js';
import { pool, closePool } from '../db/client.js';
import { DDL, BRAIN_DDL } from '../db/schema.js';
import { findDuplicateTasks, markDuplicates, restoreDuplicates } from './tasks.dedupe.js';
import { nowTz } from '../lib/datetime.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'director'));

// Hai miền lớn tách ra file riêng — file này từng ôm 18 miền trong 588 dòng, mỗi lần sửa
// một thứ phải lội qua tất cả. Gắn KHÔNG kèm tiền tố nên đường dẫn API giữ nguyên
// (/api/admin/members, /api/admin/payroll…), giao diện không phải đổi gì.
adminRouter.use(adminMembersRouter);
adminRouter.use(adminPayrollRouter);

adminRouter.post(
  '/sync-catalog',
  asyncHandler(async (_req, res) => {
    res.json(await syncCatalogFromSource());
  }),
);

/**
 * Xem trước điểm sẽ đổi — CHỈ ĐỌC, không sửa gì.
 *
 * Đồng bộ ghi đè thẳng vào tasks.points, không để lại lịch sử. Nên muốn trả lời câu
 * "đợt vừa rồi có cộng nhầm điểm cho phòng nào không" thì phải xem được TRƯỚC khi chạy.
 */
adminRouter.post(
  '/check-points',
  asyncHandler(async (_req, res) => {
    res.json(await applyCatalogPoints(true));
  }),
);

// Link Google Sheet nguồn để admin mở chỉnh sửa trực tiếp (dựng từ ID trong env).
adminRouter.get(
  '/sync-info',
  asyncHandler(async (_req, res) => {
    // Nhân sự đã chuyển hẳn vào app (29/7/2026) nên không còn trả link Sheet nhân sự.
    const cfg = await getConfig();
    res.json({ taskSheetUrl: cfg.taskSheetUrl || '' });
  }),
);

adminRouter.post(
  '/config',
  asyncHandler(async (req, res) => {
    const { key, value } = z.object({ key: z.string().min(1), value: z.string() }).parse(req.body);
    await setConfigValue(key, value);
    res.json({ ok: true });
  }),
);

/**
 * Chạy DDL schema (toàn CREATE TABLE/INDEX IF NOT EXISTS — idempotent, không mất dữ liệu)
 * ngay trên server, nơi có sẵn DATABASE_URL. Thay cho việc chạy tay setup-db với env prod.
 * Dùng pool pg (không phải driver HTTP) vì DDL nhiều câu lệnh; đóng pool ngay sau khi xong.
 */
adminRouter.post(
  '/migrate-db',
  asyncHandler(async (_req, res) => {
    try {
      await pool().query(DDL);
      // Kho tri thức chạy RIÊNG: cần extension pgvector, lỗi ở đây không được
      // kéo đổ phần schema chính (bảng/index còn lại vẫn phải được tạo).
      let brain = 'ok';
      try {
        await pool().query(BRAIN_DDL);
      } catch (e) {
        brain = (e as Error).message;
        console.error('[migrate-db] kho tri thức:', e);
      }
      res.json({ ok: true, core: 'ok', brain });
    } finally {
      await closePool().catch(() => undefined);
    }
  }),
);

/**
 * Kiểm tra kết nối thật: gọi thử từng thành phần rồi báo cái nào chạy, cái nào hỏng.
 * Mỗi mục tự bắt lỗi để một cái hỏng không che mất kết quả các cái còn lại.
 */
adminRouter.post(
  '/test-connection',
  asyncHandler(async (_req, res) => {
    interface Check {
      name: string;
      ok: boolean;
      detail: string;
    }
    const checks: Check[] = [];
    const run = async (name: string, fn: () => Promise<string>): Promise<void> => {
      const t0 = Date.now();
      try {
        const detail = await fn();
        checks.push({ name, ok: true, detail: `${detail} (${Date.now() - t0}ms)` });
      } catch (e) {
        checks.push({ name, ok: false, detail: (e as Error).message.slice(0, 300) });
      }
    };

    await run('Cơ sở dữ liệu', async () => {
      const { q } = await import('../db/client.js');
      const rows = await q('SELECT COUNT(*) AS n FROM members');
      return `Kết nối tốt — ${Number(rows[0]?.n) || 0} thành viên`;
    });

    await run('Bảng kho tri thức', async () => {
      const { brainTableReady } = await import('./brain.repo.js');
      if (!(await brainTableReady())) {
        throw new Error('Chưa có bảng. Bấm nút Cập nhật cấu trúc DB ở trên.');
      }
      const { q } = await import('../db/client.js');
      const rows = await q('SELECT COUNT(*) AS n FROM brain_chunks');
      return `Sẵn sàng — ${Number(rows[0]?.n) || 0} mục trong kho`;
    });

    await run('Trợ lý AI', async () => {
      const { getProvider, currentProviderName } = await import('../ai/index.js');
      const provider = await getProvider();
      const configured = await currentProviderName();
      if (!provider) throw new Error(`Chưa cấu hình ${configured === 'claude' ? 'Claude' : 'Gemini'} (thiếu API key).`);
      const parts = await provider.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Trả lời đúng hai chữ: xin chào' }] }],
      });
      const text = parts.map((p) => p.text || '').join('').trim();
      if (!text) throw new Error('Gọi được nhưng không nhận được nội dung trả lời.');
      return `${provider.name === 'claude' ? 'Claude' : 'Gemini'} trả lời: "${text.slice(0, 60)}"`;
    });

    // Trợ lý thật LUÔN gửi kèm bộ công cụ. Nhiều endpoint chỉ hỗ trợ hội thoại thường,
    // không hỗ trợ gọi hàm — phép thử này tách bạch đúng chỗ hỏng.
    await run('Trợ lý AI — gọi hàm (tool calling)', async () => {
      const { getProvider } = await import('../ai/index.js');
      const provider = await getProvider();
      if (!provider) throw new Error('Chưa cấu hình nhà cung cấp AI.');
      const parts = await provider.generateContent({
        contents: [{ role: 'user', parts: [{ text: 'Hôm nay ai chưa chấm công? Dùng hàm được cấp.' }] }],
        systemInstruction: { parts: [{ text: 'Bạn là trợ lý dữ liệu. Dùng hàm khi cần dữ liệu.' }] },
        tools: [
          {
            functionDeclarations: [
              {
                name: 'get_attendance',
                description: 'Chấm công của tất cả nhân sự trong 1 ngày.',
                parameters: {
                  type: 'OBJECT',
                  properties: { date: { type: 'STRING', description: 'Ngày YYYY-MM-DD.' } },
                },
              },
            ],
          },
        ],
      });
      const called = parts.find((p) => p.functionCall);
      if (called) return `Gọi hàm được — AI yêu cầu chạy "${called.functionCall!.name}"`;
      const text = parts.map((p) => p.text || '').join('').trim();
      // Không lỗi nhưng cũng không gọi hàm: mô hình yếu hoặc endpoint bỏ qua tools.
      return `Không lỗi, nhưng AI trả lời thẳng thay vì gọi hàm: "${text.slice(0, 80)}"`;
    });

    await run('Ghi nhớ kho tri thức (Gemini)', async () => {
      const { embedTexts, embeddingsAvailable } = await import('../gemini/client.js');
      if (!(await embeddingsAvailable())) {
        throw new Error('Cần API key Gemini — phần ghi nhớ luôn dùng Gemini kể cả khi trợ lý chạy Claude.');
      }
      const [vec] = await embedTexts(['kiểm tra kết nối'], 'RETRIEVAL_QUERY');
      if (!vec?.length) throw new Error('Không nhận được vector.');
      return `Hoạt động — vector ${vec.length} chiều`;
    });

    await run('Lưu trữ tệp tải lên', async () => {
      if (!process.env.mt_READ_WRITE_TOKEN) throw new Error('Thiếu token lưu trữ (mt_READ_WRITE_TOKEN).');
      return 'Đã cấu hình';
    });

    res.json({ checks, allOk: checks.every((c) => c.ok) });
  }),
);

/**
 * Gửi NGAY bản báo cáo công việc cho chính người bấm — để kiểm tra đường thông báo
 * mà không phải chờ tới giờ báo cáo tự động (17:15).
 */
adminRouter.post(
  '/test-report',
  asyncHandler(async (req, res) => {
    const { previewDirectorReport } = await import('../jobs/dailyReport.js');
    const { notify } = await import('./notifications.service.js');
    const body = await previewDirectorReport();
    await notify(req.user!.sub, {
      type: 'daily_all',
      title: `Báo cáo công việc (gửi thử) — ${nowTz().format('DD/MM HH:mm')}`,
      body,
      url: '/dashboard',
    });
    res.json({ ok: true, preview: body.slice(0, 400) });
  }),
);

/**
 * Rà soát việc bị tính điểm hai lần. `apply=false` (mặc định) chỉ liệt kê để xem trước;
 * `apply=true` mới đánh dấu — và chỉ đổi trạng thái nên khôi phục lại được.
 */
const dedupeSchema = z.object({
  month: z.string().regex(/^\d{4}-\d{2}$/).optional(),
  apply: z.boolean().optional().default(false),
});

adminRouter.post(
  '/dedupe-tasks',
  requireRole('director', 'admin'),
  asyncHandler(async (req, res) => {
    const b = dedupeSchema.parse(req.body ?? {});
    const report = await findDuplicateTasks(b.month);
    if (!b.apply) {
      res.json({ applied: false, ...report, items: report.items.slice(0, 200) });
      return;
    }
    // Trả về số dòng ĐỔI ĐƯỢC THẬT và số điểm tương ứng — không phải con số của lượt quét.
    const markedIds = new Set(await markDuplicates(report.items.map((i) => i.id)));
    const done = report.items.filter((i) => markedIds.has(i.id));
    res.json({
      applied: true,
      marked: done.length,
      found: report.totalTasks,
      totalPoints: done.reduce((s, i) => s + i.points, 0),
      byMember: report.byMember,
    });
  }),
);

/** Khôi phục toàn bộ việc đã đánh dấu trùng — lối lui nếu dọn nhầm. */
adminRouter.post(
  '/dedupe-restore',
  requireRole('director', 'admin'),
  asyncHandler(async (_req, res) => {
    res.json({ ok: true, restored: await restoreDuplicates() });
  }),
);

/** Danh sách model lấy từ API của nhà cung cấp — không cài cứng trong code. */
adminRouter.get(
  '/ai-models',
  asyncHandler(async (req, res) => {
    const which = String(req.query.provider || '') === 'claude' ? 'claude' : 'gemini';
    try {
      if (which === 'claude') {
        const { listClaudeModels } = await import('../ai/claude.js');
        res.json({ provider: which, models: await listClaudeModels() });
      } else {
        const { listGeminiModels } = await import('../gemini/client.js');
        res.json({ provider: which, models: await listGeminiModels() });
      }
    } catch (e) {
      // Endpoint tuỳ biến có thể không hỗ trợ liệt kê model → UI cho gõ tay.
      res.json({ provider: which, models: [], error: (e as Error).message.slice(0, 300) });
    }
  }),
);

/** Thông tin cấu hình Trợ lý AI cho UI Quản trị (không trả về key). */
adminRouter.get(
  '/ai-info',
  asyncHandler(async (_req, res) => {
    const cfg = await getConfig({ fresh: true });
    res.json({
      model: cfg.geminiModel || '',
      provider: cfg.aiProvider || 'gemini',
      hasClaudeKey: !!cfg.claudeApiKey,
      claudeModel: cfg.claudeModel || '',
      claudeBaseUrl: cfg.claudeBaseUrl || '',
      autoCapture: cfg.brainAutoCapture !== 'off',
    });
  }),
);

adminRouter.post(
  '/catalog',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        code: z.string().min(1),
        name: z.string().min(1),
        points: z.number(),
        active: z.boolean().optional().default(true),
        note: z.string().optional().default(''),
      })
      .parse(req.body);
    await upsertCatalogItem({ code: b.code, name: b.name, points: b.points, active: b.active, note: b.note });
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/holidays',
  asyncHandler(async (req, res) => {
    const b = z.object({ date: z.string().min(1), name: z.string().min(1) }).parse(req.body);
    await upsertHoliday(b.date, b.name);
    res.json({ ok: true });
  }),
);

adminRouter.post(
  '/teams',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ id: z.string().min(1), name: z.string().optional(), leaderMemberId: z.string().optional().default('') })
      .parse(req.body);
    await upsertTeam({ id: b.id, name: b.name || b.id, leaderMemberId: b.leaderMemberId });
    res.json({ ok: true });
  }),
);

// Gemini OAuth: return the Google consent URL (admin pastes the resulting
// refresh token into GEMINI_OAUTH_REFRESH_TOKEN). See gemini/auth.ts.
adminRouter.get(
  '/google/auth-url',
  asyncHandler(async (_req, res) => {
    if (!process.env.GOOGLE_OAUTH_CLIENT_ID || !process.env.GOOGLE_OAUTH_CLIENT_SECRET) {
      throw new ApiError(
        400,
        'Chưa cấu hình GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET. Cách nhanh hơn: lấy API key tại aistudio.google.com/apikey rồi thêm biến GEMINI_API_KEY.',
      );
    }
    const { getAuthUrl } = await import('../gemini/auth.js');
    res.json({ url: getAuthUrl() });
  }),
);

/**
 * Dung lượng hệ thống — anh Tâm 1/8/2026 muốn nhìn được ngay trong màn Quản trị.
 *
 * Neon gói miễn phí cho 512MB; chạm trần thì database chuyển sang chỉ đọc và cả app
 * dừng ghi, không có cảnh báo nào trước. Bảng nào phình cũng hiện luôn để dọn đúng chỗ.
 */
adminRouter.get(
  '/storage',
  asyncHandler(async (_req, res) => {
    res.json(await storageInfo());
  }),
);
