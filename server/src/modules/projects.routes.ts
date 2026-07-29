import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import {
  getProjects,
  findProject,
  upsertProject,
  deleteProject,
  getKpis,
  findKpi,
  upsertKpi,
  deleteKpi,
  getEntries,
  getEntriesForDates,
  saveEntry,
  type Project,
  type ProjectKpi,
} from './projects.repo.js';
import { findById } from './members.repo.js';
import { findCustomer } from './crm.repo.js';
import { progressOf, seriesFor, canWriteEntry, entryWindowOpen, type KpiPeriod } from '../lib/kpi.js';
import { newId } from '../util/id.js';
import { nowTz, todayIso, fmtDate } from '../lib/datetime.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

/** Ai được tạo/sửa khung dự án và chỉ số. Nhân viên chỉ nhập SỐ, không đụng cấu trúc. */
const canManage = requireRole('leader', 'director', 'admin');

const seesAll = (role: string) => role === 'director' || role === 'admin';

/** Phòng ban của người đang đăng nhập — req.user không mang teamId nên phải tra lại. */
async function myTeam(memberId: string): Promise<string> {
  return (await findById(memberId))?.teamId || '';
}

/**
 * Dự án người này được xem: giám đốc/admin thấy tất cả; còn lại chỉ thấy dự án có ít nhất
 * một chỉ số thuộc phòng mình.
 */
function visibleProjects(projects: Project[], kpis: ProjectKpi[], role: string, teamId: string): Project[] {
  if (seesAll(role)) return projects;
  const mine = new Set(kpis.filter((k) => k.teamId === teamId).map((k) => k.projectId));
  return projects.filter((p) => mine.has(p.id));
}

// ── Danh sách + tiến độ tổng ──

projectsRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const [projects, kpis] = await Promise.all([getProjects(), getKpis()]);
    const teamId = await myTeam(req.user!.sub);
    const visible = visibleProjects(projects, kpis, req.user!.role, teamId);

    const activeKpis = kpis.filter((k) => k.active && visible.some((p) => p.id === k.projectId));
    const entries = await getEntries(activeKpis.map((k) => k.id));
    const today = todayIso();

    res.json({
      projects: visible.map((p) => {
        const own = activeKpis.filter((k) => k.projectId === p.id);
        const percents = own.map(
          (k) => progressOf(entries.filter((e) => e.kpiId === k.id), k, today).percent,
        );
        return {
          ...p,
          kpiCount: own.length,
          // Tiến độ tổng = trung bình % các chỉ số của kỳ đang chạy.
          percent: percents.length ? Math.round(percents.reduce((s, x) => s + x, 0) / percents.length) : 0,
        };
      }),
    });
  }),
);

// ── Chỉ số cần nhập hôm nay và hôm qua ──

projectsRouter.get(
  '/my-today',
  asyncHandler(async (req, res) => {
    const teamId = await myTeam(req.user!.sub);
    const today = todayIso();
    const yesterday = nowTz().subtract(1, 'day').format('YYYY-MM-DD');

    if (!teamId) {
      res.json({ teamId: '', dates: { today, yesterday }, rows: [] });
      return;
    }

    const [projects, kpis] = await Promise.all([getProjects(), getKpis()]);
    const mine = kpis.filter((k) => k.active && k.teamId === teamId);
    const byProject = new Map(projects.map((p) => [p.id, p]));
    const entries = await getEntriesForDates(mine.map((k) => k.id), [today, yesterday]);

    res.json({
      teamId,
      dates: { today, yesterday },
      rows: mine
        .filter((k) => byProject.get(k.projectId)?.status === 'active')
        .map((k) => ({
          kpi: k,
          projectName: byProject.get(k.projectId)?.name || '',
          today: entries.find((e) => e.kpiId === k.id && e.date === today)?.value ?? null,
          yesterday: entries.find((e) => e.kpiId === k.id && e.date === yesterday)?.value ?? null,
        })),
    });
  }),
);

// ── Chi tiết một dự án ──

projectsRouter.get(
  '/:id',
  asyncHandler(async (req, res) => {
    const project = await findProject(String(req.params.id));
    if (!project) throw new ApiError(404, 'Không tìm thấy dự án');

    const kpis = await getKpis(project.id);
    const teamId = await myTeam(req.user!.sub);
    if (!seesAll(req.user!.role) && !kpis.some((k) => k.teamId === teamId)) {
      throw new ApiError(403, 'Dự án này không có chỉ số nào của phòng bạn');
    }

    const entries = await getEntries(kpis.map((k) => k.id));
    const today = todayIso();

    res.json({
      project,
      kpis: kpis.map((k) => {
        const own = entries.filter((e) => e.kpiId === k.id);
        return {
          ...k,
          progress: progressOf(own, k, today),
          series: seriesFor(own, k.period, 8, today),
          // Nhân viên phòng khác chỉ xem; giám đốc nhập bù được mọi ngày.
          canWrite: seesAll(req.user!.role) || k.teamId === teamId,
        };
      }),
    });
  }),
);

// ── Tạo / sửa dự án ──

const projectSchema = z.object({
  id: z.string().optional(),
  name: z.string().min(1),
  customerId: z.string().optional().default(''),
  status: z.enum(['active', 'paused', 'done']).optional().default('active'),
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
  note: z.string().optional().default(''),
});

projectsRouter.post(
  '/',
  canManage,
  asyncHandler(async (req, res) => {
    const b = projectSchema.parse(req.body);
    const existing = b.id ? await findProject(b.id) : undefined;
    // Khách hàng là tuỳ chọn; lưu kèm tên để xoá khách khỏi CRM vẫn còn dấu vết.
    const customer = b.customerId ? await findCustomer(b.customerId) : undefined;

    const p: Project = {
      id: existing?.id || b.id || newId('PJ-'),
      name: b.name.trim(),
      customerId: customer?.id || '',
      customerName: customer?.name || '',
      status: b.status,
      startDate: b.startDate,
      endDate: b.endDate,
      note: b.note,
      createdBy: existing?.createdBy || req.user!.name,
      createdAt: existing?.createdAt || nowTz().toISOString(),
    };
    await upsertProject(p);
    res.json({ ok: true, id: p.id });
  }),
);

projectsRouter.delete(
  '/:id',
  canManage,
  asyncHandler(async (req, res) => {
    await deleteProject(String(req.params.id));
    res.json({ ok: true });
  }),
);

// ── Tạo / sửa chỉ số ──

const kpiSchema = z.object({
  id: z.string().optional(),
  teamId: z.string().min(1),
  name: z.string().min(1),
  unit: z.string().optional().default(''),
  period: z.enum(['day', 'week', 'month', 'total']).optional().default('month'),
  target: z.number().int().min(0).optional().default(0),
  active: z.boolean().optional().default(true),
  sortOrder: z.number().int().optional().default(0),
});

projectsRouter.post(
  '/:id/kpis',
  canManage,
  asyncHandler(async (req, res) => {
    const project = await findProject(String(req.params.id));
    if (!project) throw new ApiError(404, 'Không tìm thấy dự án');
    const b = kpiSchema.parse(req.body);
    const existing = b.id ? await findKpi(b.id) : undefined;

    const k: ProjectKpi = {
      id: existing?.id || b.id || newId('KPI-'),
      projectId: project.id,
      teamId: b.teamId,
      name: b.name.trim(),
      unit: b.unit.trim(),
      period: b.period as KpiPeriod,
      target: b.target,
      active: b.active,
      sortOrder: b.sortOrder,
      createdAt: existing?.createdAt || nowTz().toISOString(),
    };
    await upsertKpi(k);
    res.json({ ok: true, id: k.id });
  }),
);

projectsRouter.delete(
  '/kpis/:kpiId',
  canManage,
  asyncHandler(async (req, res) => {
    await deleteKpi(String(req.params.kpiId));
    res.json({ ok: true });
  }),
);

// ── Nhập số ──

const entrySchema = z.object({
  // Bắt buộc truyền ngày: nhân sự cần nhập số của HÔM QUA khi kết quả về muộn.
  date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
  value: z.number().int().min(0),
});

projectsRouter.post(
  '/kpis/:kpiId/entries',
  asyncHandler(async (req, res) => {
    const kpi = await findKpi(String(req.params.kpiId));
    if (!kpi) throw new ApiError(404, 'Không tìm thấy chỉ số');
    const b = entrySchema.parse(req.body);
    const role = req.user!.role;

    // Chặn ở TẦNG SERVER, không chỉ ẩn nút: người Content không ghi vào chỉ số của Ads.
    if (!seesAll(role) && kpi.teamId !== (await myTeam(req.user!.sub))) {
      throw new ApiError(403, `Chỉ số này của phòng ${kpi.teamId} — bạn không nhập được.`);
    }

    const today = todayIso();
    if (!canWriteEntry(b.date, today, role)) {
      const reason = entryWindowOpen(b.date, today)
        ? 'Không nhập được số của ngày chưa tới.'
        : `Số ngày ${fmtDate(b.date)} đã khoá. Nhờ giám đốc nhập bù giúp nhé.`;
      throw new ApiError(403, reason);
    }

    await saveEntry({
      kpiId: kpi.id,
      date: b.date,
      value: b.value,
      memberId: req.user!.sub,
      memberName: req.user!.name,
      // Giám đốc ghi ngoài cửa sổ = nhập bù; đánh dấu để phân biệt với số nhân sự tự nhập.
      late: !entryWindowOpen(b.date, today),
      updatedAt: nowTz().toISOString(),
    });
    res.json({ ok: true });
  }),
);
