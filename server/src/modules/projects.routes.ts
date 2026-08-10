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
import { findCustomer, getCustomers } from './crm.repo.js';
import {
  progressOf,
  seriesFor,
  canWriteEntry,
  entryWindowOpen,
  openEntryDates,
  projectProgress,
  timeProgress,
  projectAlert,
  type KpiPeriod,
} from '../lib/kpi.js';
import { getHolidaySet } from './holidays.repo.js';
import { newId } from '../util/id.js';
import { nowTz, todayIso, fmtDate } from '../lib/datetime.js';

export const projectsRouter = Router();
projectsRouter.use(requireAuth);

/** Thứ tự và tên hiển thị của các kỳ trên thẻ dự án — ngắn dần về phía trên. */
const KY_HIEN_THI = [
  { period: 'day', ten: 'KPI ngày' },
  { period: 'week', ten: 'KPI tuần' },
  { period: 'month', ten: 'KPI tháng' },
  { period: 'total', ten: 'KPI cả dự án' },
] as const satisfies ReadonlyArray<{ period: KpiPeriod; ten: string }>;

/** Ai được tạo/sửa khung dự án và chỉ số. Nhân viên chỉ nhập SỐ, không đụng cấu trúc. */
const canManage = requireRole('leader', 'director', 'admin');

/**
 * Ai xem được MỌI dự án.
 *
 * Anh Tâm 3/8/2026: "leader có thể thấy toàn bộ dự án" — leader cần nhìn bức tranh chung
 * để điều phối, chứ không chỉ phần phòng mình. Riêng NHÂN VIÊN vẫn chỉ thấy dự án có chỉ
 * số của phòng mình, để màn hình của họ gọn đúng việc phải làm.
 */
const seesAll = (role: string) => role === 'director' || role === 'admin' || role === 'leader';

/**
 * Ai ghi được số cho MỌI phòng — chỉ giám đốc/admin.
 *
 * TÁCH RIÊNG khỏi quyền xem, cố ý. Leader nay xem được mọi dự án, nhưng anh Tâm đã chốt
 * 28/7/2026: "leader không sửa được số". Dùng chung một cờ cho cả xem lẫn ghi thì mở
 * quyền xem là vô tình mở luôn quyền sửa số của phòng khác.
 */
const canWriteAnyTeam = (role: string) => role === 'director' || role === 'admin';

/** Phòng ban của người đang đăng nhập — req.user không mang teamId nên phải tra lại. */
async function myTeam(memberId: string): Promise<string> {
  return (await findById(memberId))?.teamId || '';
}

/**
 * Dự án người này được xem.
 *
 * Giám đốc, admin và leader thấy TẤT CẢ. Nhân viên chỉ thấy dự án có ít nhất một chỉ số
 * thuộc phòng mình — anh Tâm chốt 3/8/2026: "các bạn nhân sự thấy được dự án mà bạn phụ
 * trách để theo dõi KPI theo phòng ban thôi, không thấy được toàn bộ".
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
        // Từng chỉ số một, đủ số liệu để hiện thẳng trên thẻ — anh Tâm 4/8/2026 muốn
        // "theo dõi không cần bấm vào". Tính MỘT lần rồi dùng lại cho phần trăm tổng.
        // Mốc = ngày bắt đầu dự án: tuần/tháng đếm từ đó, không theo lịch.
        const chiTiet = own.map((k) => {
          const pr = progressOf(entries.filter((e) => e.kpiId === k.id), k, today, p.startDate);
          return {
            id: k.id,
            teamId: k.teamId,
            name: k.name,
            unit: k.unit,
            period: k.period,
            current: pr.current,
            target: pr.target,
            percent: pr.percent,
            periodLabel: pr.periodLabel,
          };
        });
        // Chỉ số CHƯA đặt mục tiêu không đo được tiến độ — gộp vào trung bình sẽ kéo con
        // số đứng im dù nhập bao nhiêu. `projectProgress` loại chúng ra và đếm riêng.
        const prog = projectProgress(chiTiet.map((k) => ({ percent: k.percent, target: k.target })));

        // Tách tiến độ theo KỲ (anh Tâm 4/8/2026: "nếu KPI theo tuần thì tách theo tuần").
        //
        // Một thanh gộp chung chỉ số tuần với chỉ số tháng là con số không đọc được: chỉ số
        // tuần vừa reset về 0 sáng thứ Hai, chỉ số tháng thì đang chạy dở — cộng trung bình
        // hai thứ đó ra một số không nói lên điều gì. Mỗi kỳ một thanh, và thanh nào cũng
        // đo ĐÚNG kỳ đang chạy nên qua tuần là tự sang thanh tuần mới.
        const kpiGroups = KY_HIEN_THI.map(({ period, ten }) => {
          const ks = chiTiet.filter((k) => k.period === period);
          if (ks.length === 0) return null;
          const g = projectProgress(ks.map((k) => ({ percent: k.percent, target: k.target })));
          return {
            period,
            ten,
            // Các chỉ số cùng kỳ trong một dự án luôn cùng nhãn kỳ (cùng mốc, cùng hôm nay).
            kyLabel: ks[0]!.periodLabel,
            percent: g.percent,
            measured: g.counted,
            noTarget: g.noTarget,
            kpiCount: ks.length,
          };
        }).filter((g) => g !== null);
        const alert = projectAlert(timeProgress(p.startDate, p.endDate, today), prog.percent, prog.counted);
        return {
          ...p,
          kpiCount: own.length,
          percent: prog.percent,
          /** Bao nhiêu chỉ số thực sự được tính vào phần trăm. */
          measured: prog.counted,
          /** Bao nhiêu chỉ số còn thiếu mục tiêu — màn hình nhắc leader đặt nốt. */
          noTarget: prog.noTarget,
          /** Các phòng có chỉ số trong dự án này — để lọc theo phòng. */
          teams: [...new Set(own.map((k) => k.teamId).filter(Boolean))].sort(),
          /** Từng chỉ số kèm số đã đạt — thẻ dự án hiện thẳng, khỏi phải mở ra xem. */
          kpis: chiTiet,
          /** Tiến độ tách theo kỳ: mỗi kỳ một thanh, luôn là kỳ ĐANG chạy. */
          kpiGroups,
          timePercent: alert.timePercent,
          alert: alert.level,
          alertReason: alert.reason,
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
    // Ngày nghỉ không ai đi làm nên cửa sổ nhập phải nhảy qua chúng: thứ Hai mở cho cả
    // thứ Sáu, thứ Bảy và Chủ nhật (anh Tâm chốt 3/8/2026).
    const dates = openEntryDates(today, await getHolidaySet());

    if (!teamId) {
      res.json({ teamId: '', dates, rows: [] });
      return;
    }

    const [projects, kpis] = await Promise.all([getProjects(), getKpis()]);
    const mine = kpis.filter((k) => k.active && k.teamId === teamId);
    const byProject = new Map(projects.map((p) => [p.id, p]));
    const entries = await getEntriesForDates(mine.map((k) => k.id), dates);

    res.json({
      teamId,
      dates,
      rows: mine
        .filter((k) => byProject.get(k.projectId)?.status === 'active')
        .map((k) => ({
          kpi: k,
          projectName: byProject.get(k.projectId)?.name || '',
          // Số đã nhập theo từng ngày đang mở: { '2026-07-31': 86, … }
          values: Object.fromEntries(
            dates.map((d) => [d, entries.find((e) => e.kpiId === k.id && e.date === d)?.value ?? null]),
          ),
        })),
    });
  }),
);

// ── Danh sách khách để gắn vào dự án ──

/**
 * Leader không vào được /api/crm (chỉ sale/giám đốc/admin) nhưng vẫn cần chọn khách khi
 * tạo dự án. Trả về ĐÚNG tên + mã, không kèm điện thoại hay ghi chú — nhân sự không có
 * việc gì phải thấy thông tin liên hệ của khách.
 */
projectsRouter.get(
  '/customer-options',
  canManage,
  asyncHandler(async (_req, res) => {
    const customers = await getCustomers();
    res.json({ customers: customers.map((c) => ({ id: c.id, name: c.name })) });
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
          progress: progressOf(own, k, today, project.startDate),
          series: seriesFor(own, k.period, 8, today, project.startDate),
          // Nhân viên phòng khác chỉ xem; giám đốc nhập bù được mọi ngày.
          canWrite: canWriteAnyTeam(req.user!.role) || k.teamId === teamId,
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
    if (!canWriteAnyTeam(role) && kpi.teamId !== (await myTeam(req.user!.sub))) {
      throw new ApiError(403, `Chỉ số này của phòng ${kpi.teamId} — bạn không nhập được.`);
    }

    const today = todayIso();
    const holidays = await getHolidaySet();
    if (!canWriteEntry(b.date, today, role, holidays)) {
      const reason = entryWindowOpen(b.date, today, holidays)
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
      late: !entryWindowOpen(b.date, today, holidays),
      updatedAt: nowTz().toISOString(),
    });
    res.json({ ok: true });
  }),
);
