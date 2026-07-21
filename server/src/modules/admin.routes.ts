import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { syncMembersFromSource, syncCatalogFromSource } from './admin.sync.js';
import { getAllMembers, getActiveMembers, findById, publicMember, upsertMember } from './members.repo.js';
import { upsertCatalogItem } from './catalog.repo.js';
import { upsertHoliday } from './holidays.repo.js';
import { upsertTeam } from './teams.repo.js';
import { getForMemberRange, saveAttendance } from './attendance.repo.js';
import {
  payrollForMonth,
  isMonthLocked,
  getPayrollSnapshot,
  lockPayrollMonth,
  unlockPayrollMonth,
} from './payroll.service.js';
import { hashPassword } from '../auth/password.js';
import { setConfigValue, getConfig } from '../config.js';
import { pool, closePool } from '../db/client.js';
import { DDL, BRAIN_DDL } from '../db/schema.js';
import { newId } from '../util/id.js';
import { nowTz, monthRange, fmtHm, dayjs, TZ } from '../lib/datetime.js';
import { dayFractionFromShifts } from '../lib/attendance.js';

export const adminRouter = Router();
adminRouter.use(requireAuth, requireRole('admin', 'director'));

adminRouter.post(
  '/sync-members',
  asyncHandler(async (req, res) => {
    res.json(await syncMembersFromSource(req.user!.sub));
  }),
);

adminRouter.post(
  '/sync-catalog',
  asyncHandler(async (_req, res) => {
    res.json(await syncCatalogFromSource());
  }),
);

// Link Google Sheet nguồn để admin mở chỉnh sửa trực tiếp (dựng từ ID trong env).
adminRouter.get(
  '/sync-info',
  asyncHandler(async (_req, res) => {
    const cfg = await getConfig();
    const hrId = process.env.SHEET_HR_SOURCE_ID || '';
    const hrGid = process.env.SHEET_HR_SOURCE_GID || '0';
    res.json({
      hrSheetUrl: hrId ? `https://docs.google.com/spreadsheets/d/${hrId}/edit#gid=${hrGid}` : '',
      taskSheetUrl: cfg.taskSheetUrl || '',
    });
  }),
);

adminRouter.get(
  '/members',
  asyncHandler(async (_req, res) => {
    res.json({ members: (await getAllMembers()).map(publicMember) });
  }),
);

const memberSchema = z.object({
  id: z.string().optional(),
  fullName: z.string().min(1),
  username: z.string().optional().default(''),
  role: z.enum(['member', 'leader', 'director', 'admin']),
  teamId: z.string().optional().default(''),
  dob: z.string().optional().default(''),
  position: z.string().optional().default(''),
  salary: z.number().optional().default(0),
  bhxh: z.number().optional().default(0),
  joinDate: z.string().optional().default(''),
  active: z.boolean().optional().default(true),
  password: z.string().min(6).optional(),
});

adminRouter.post(
  '/members',
  asyncHandler(async (req, res) => {
    const b = memberSchema.parse(req.body);
    const existing = b.id ? await findById(b.id) : undefined;
    const id = existing?.id || b.id || newId('M-');
    const passwordHash = b.password ? await hashPassword(b.password) : existing?.passwordHash || '';
    const { vnUsername } = await import('../lib/people.js');
    await upsertMember({
      id,
      fullName: b.fullName,
      dob: b.dob || null,
      position: b.position,
      teamId: b.teamId as never,
      role: b.role,
      salary: b.salary,
      bhxh: b.bhxh,
      joinDate: b.joinDate || null,
      username: b.username || existing?.username || vnUsername(b.fullName),
      email: existing?.email || '',
      passwordHash,
      active: b.active,
    });
    res.json({ ok: true, id });
  }),
);

adminRouter.post(
  '/members/:id/password',
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(6) }).parse(req.body);
    const m = await findById(String(req.params.id));
    if (!m) throw new ApiError(404, 'Không tìm thấy thành viên');
    await upsertMember({ ...m, passwordHash: await hashPassword(password) });
    res.json({ ok: true });
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

function ymOf(req: { query: Record<string, unknown> }): { year: number; month: number } {
  const now = nowTz();
  return { year: Number(req.query.year) || now.year(), month: Number(req.query.month) || now.month() + 1 };
}

// Bảng lương & công: từng nhân viên (trừ giám đốc) + base salary/bhxh để sửa thủ công.
adminRouter.get(
  '/payroll',
  asyncHandler(async (req, res) => {
    const { year, month } = ymOf(req);
    const locked = await isMonthLocked(year, month);
    // Đã chốt → đọc snapshot đóng băng (gồm cả nhân sự đã nghỉ); chưa chốt → tính live.
    const lines = locked ? await getPayrollSnapshot(year, month) : await payrollForMonth(year, month);
    const byId = new Map((await getActiveMembers()).map((m) => [m.id, m]));
    const rows = lines.map((l) => {
      const m = byId.get(l.memberId);
      return {
        memberId: l.memberId,
        fullName: l.fullName,
        teamId: l.teamId,
        salary: l.grossSalary, // Mức lương (base) — snapshot đóng băng khi đã chốt
        bhxh: m?.bhxh ?? 0, // mức đóng BHXH (base, không hiển thị)
        standardDays: l.standardDays,
        actualDays: l.actualDays,
        proratedSalary: l.proratedSalary, // lương theo công (trước trừ BHXH)
        bhxhDeduction: l.bhxh, // khoản trừ BHXH thực tế
        netSalary: l.netSalary,
      };
    });
    res.json({ year, month, locked, rows });
  }),
);

const lockSchema = z.object({ year: z.number().int(), month: z.number().int().min(1).max(12) });

// Chốt lương tháng (đóng băng snapshot).
adminRouter.post(
  '/payroll/lock',
  asyncHandler(async (req, res) => {
    const { year, month } = lockSchema.parse(req.body);
    await lockPayrollMonth(year, month, req.user!.name, nowTz().toISOString());
    res.json({ ok: true, locked: true });
  }),
);

// Mở lại tháng đã chốt để sửa.
adminRouter.post(
  '/payroll/unlock',
  asyncHandler(async (req, res) => {
    const { year, month } = lockSchema.parse(req.body);
    await unlockPayrollMonth(year, month);
    res.json({ ok: true, locked: false });
  }),
);

// Chấm công của 1 thành viên trong tháng (để sửa giờ vào/ra cho đúng công).
adminRouter.get(
  '/attendance',
  asyncHandler(async (req, res) => {
    const memberId = String(req.query.memberId || '');
    if (!memberId) throw new ApiError(400, 'Thiếu memberId');
    const { year, month } = ymOf(req);
    const { start, end } = monthRange(year, month);
    const records = (await getForMemberRange(memberId, start, end)).map((r) => ({
      date: r.date,
      morningIn: r.morningInAt ? fmtHm(r.morningInAt) : '',
      morningOut: r.morningOutAt ? fmtHm(r.morningOutAt) : '',
      afternoonIn: r.afternoonInAt ? fmtHm(r.afternoonInAt) : '',
      afternoonOut: r.afternoonOutAt ? fmtHm(r.afternoonOutAt) : '',
      dayFraction: r.dayFraction,
      mode: r.mode,
    }));
    res.json({ year, month, records });
  }),
);

const attnSchema = z.object({
  memberId: z.string().min(1),
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'Ngày không hợp lệ'),
  morningIn: z.string().optional().default(''),
  morningOut: z.string().optional().default(''),
  afternoonIn: z.string().optional().default(''),
  afternoonOut: z.string().optional().default(''),
  dayFraction: z.number().min(0).max(1).optional(),
  mode: z.enum(['office', 'online', 'leave', 'holiday']).optional().default('office'),
});

// Sửa/ghi đè 1 ngày chấm công (giờ HH:mm); công tự tính lại từ ca có giờ vào, hoặc nhập tay.
adminRouter.post(
  '/attendance',
  asyncHandler(async (req, res) => {
    const b = attnSchema.parse(req.body);
    const member = await findById(b.memberId);
    if (!member) throw new ApiError(404, 'Không tìm thấy thành viên');
    const [yy, mm] = [Number(b.date.slice(0, 4)), Number(b.date.slice(5, 7))];
    if (await isMonthLocked(yy, mm)) {
      throw new ApiError(400, `Lương tháng ${mm}/${yy} đã chốt. Bấm "Mở lại" ở Bảng lương nếu cần sửa.`);
    }
    const toIso = (t: string) => (t ? dayjs.tz(`${b.date} ${t}`, 'YYYY-MM-DD HH:mm', TZ).toISOString() : '');
    const morningInAt = toIso(b.morningIn);
    const afternoonInAt = toIso(b.afternoonIn);
    const afternoonOutAt = toIso(b.afternoonOut);
    const fraction =
      b.dayFraction != null
        ? b.dayFraction
        : dayFractionFromShifts({ morningIn: morningInAt, afternoonIn: afternoonInAt, afternoonOut: afternoonOutAt });
    const status = b.mode === 'leave' ? 'leave' : fraction >= 1 ? 'present' : fraction > 0 ? 'half' : 'absent';
    await saveAttendance({
      date: b.date,
      memberId: b.memberId,
      name: member.fullName,
      morningInAt,
      morningOutAt: toIso(b.morningOut),
      afternoonInAt,
      afternoonOutAt,
      dayFraction: fraction,
      mode: b.mode,
      status,
      note: 'Sửa bởi quản trị',
    });
    res.json({ ok: true, dayFraction: fraction });
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
