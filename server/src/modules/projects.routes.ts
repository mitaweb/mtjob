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
  getTeamBonuses,
  upsertTeamBonus,
  getAssignees,
  addAssignee,
  endAssignee,
  type Project,
  type ProjectKpi,
} from './projects.repo.js';
import { projectBonusForMonth, projectBonusForMember } from './projectBonus.service.js';
import { isMonthLocked } from './payroll.service.js';
import { phanCongBlock } from '../lib/assign.js';
import { findById, getActiveMembers } from './members.repo.js';
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
            inputMode: k.inputMode,
            current: pr.current,
            target: pr.target,
            percent: pr.percent,
            periodLabel: pr.periodLabel,
          };
        });
        // Chỉ số CHƯA đặt mục tiêu không đo được tiến độ — gộp vào trung bình sẽ kéo con
        // số đứng im dù nhập bao nhiêu. `projectProgress` loại chúng ra và đếm riêng.
        const prog = projectProgress(chiTiet.map((k) => ({ percent: k.percent, target: k.target })));

        // `prog` chỉ còn dùng cho bộ lọc tiến độ và mức cảnh báo. Thẻ dự án KHÔNG hiện thanh
        // gộp nữa — anh Tâm 4/8/2026: "chỉ cần KPI của từng phòng ban theo thời kỳ".
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
          series: seriesFor(own, k.period, 8, today, project.startDate, k.inputMode),
          // Chỉ số có mốc riêng thì đo theo mốc riêng; không có thì theo thời gian cả dự án.
          timePercent: timeProgress(
            k.startDate || project.startDate,
            k.endDate || project.endDate,
            today,
          ),
          /** Mốc riêng có được khai không — màn hình cần biết để nói "riêng chỉ số này". */
          ownDates: !!(k.startDate && k.endDate),
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
  // daily = so cua ngay do (cong lai trong ky); cumulative = so tong den ngay do (lay so
  // moi nhat). Thieu thi giu nguyen kieu cu de moi chi so da co khong bi doi cach tinh.
  inputMode: z.enum(['daily', 'cumulative']).optional(),
  // Khung thời gian riêng của chỉ số — SEO hay có kiểu "120 từ khoá trong 6–8 tháng".
  // Để trống thì chỉ số chạy theo thời gian của cả dự án như trước.
  startDate: z.string().optional().default(''),
  endDate: z.string().optional().default(''),
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
      // Thiếu thì giữ nguyên kiểu cũ của chỉ số — đừng lặng lẽ đổi cách tính của số đã nhập.
      inputMode: b.inputMode || existing?.inputMode || 'daily',
      startDate: b.startDate,
      endDate: b.endDate,
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

// ── Thưởng KPI dự án (anh Tâm 21/8/2026) ──
//
// KHÔNG dùng lại `canManage` cho phần tiền — nó bao gồm leader, mà anh Tâm chốt leader
// không được thấy con số tiền.
const canMoney = requireRole('director', 'admin');

/** Năm/tháng từ query, mặc định tháng này. */
function ymQuery(req: { query: Record<string, unknown> }): { year: number; month: number } {
  const now = nowTz();
  return {
    year: Number(req.query.year) || now.year(),
    month: Number(req.query.month) || now.month() + 1,
  };
}

/** Mức thưởng của mọi phòng trong dự án — CHỈ giám đốc/admin. */
projectsRouter.get(
  '/:id/bonus',
  canMoney,
  asyncHandler(async (req, res) => {
    res.json({ bonuses: await getTeamBonuses(String(req.params.id)) });
  }),
);

const bonusSchema = z.object({
  amount: z.number().int().min(0).max(2_000_000_000),
  note: z.string().max(200).optional().default(''),
});

/**
 * Đặt mức thưởng cho một (dự án × phòng). Chỉ giám đốc/admin.
 * Chặn tháng đã chốt lương: đổi mức lúc này là làm lệch số đã trả.
 */
projectsRouter.put(
  '/:id/bonus/:teamId',
  canMoney,
  asyncHandler(async (req, res) => {
    const b = bonusSchema.parse(req.body);
    const now = nowTz();
    if (await isMonthLocked(now.year(), now.month() + 1)) {
      throw new ApiError(409, 'Tháng này đã chốt lương nên không đổi được mức thưởng.');
    }
    const project = await findProject(String(req.params.id));
    if (!project) throw new ApiError(404, 'Không tìm thấy dự án');
    const teamId = String(req.params.teamId);
    const coKpi = (await getKpis(project.id)).some((k) => k.active && k.teamId === teamId);
    if (!coKpi) throw new ApiError(400, `Dự án này chưa có chỉ số nào của phòng ${teamId}.`);

    await upsertTeamBonus({ projectId: project.id, teamId, amount: b.amount, note: b.note }, req.user!.name);
    res.json({ ok: true });
  }),
);

/** Danh sách phân công của dự án. Ai xem được dự án thì xem được danh sách này. */
projectsRouter.get(
  '/:id/assignees',
  asyncHandler(async (req, res) => {
    res.json({ assignees: await getAssignees(String(req.params.id)) });
  }),
);

/**
 * Leader phân công người trong PHÒNG MÌNH vào dự án.
 *
 * `teamId` LUÔN lấy từ hồ sơ người đang bấm, không đọc từ body — đọc từ body là mở đường
 * cho leader phòng này phân công người phòng khác. Giám đốc/admin thì lấy theo phòng của
 * chính người được thêm.
 */
projectsRouter.post(
  '/:id/assignees',
  requireRole('leader', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const { memberId } = z.object({ memberId: z.string().min(1) }).parse(req.body);
    const now = nowTz();
    if (await isMonthLocked(now.year(), now.month() + 1)) {
      throw new ApiError(409, 'Tháng này đã chốt lương nên không đổi được danh sách dự án.');
    }
    const project = await findProject(String(req.params.id));
    if (!project) throw new ApiError(404, 'Không tìm thấy dự án');

    const nguoi = await findById(memberId);
    if (!nguoi) throw new ApiError(404, 'Không tìm thấy nhân sự');

    const boss = req.user!.role === 'director' || req.user!.role === 'admin';
    const teamId = boss ? nguoi.teamId : await myTeam(req.user!.sub);
    const coKpi = (await getKpis(project.id)).some((k) => k.active && k.teamId === teamId);

    const chan = phanCongBlock(teamId, { teamId: nguoi.teamId, role: nguoi.role, active: nguoi.active }, coKpi);
    if (chan) throw new ApiError(403, chan);

    await addAssignee({
      projectId: project.id,
      memberId,
      teamId,
      startDate: todayIso(),
      endDate: '',
      assignedBy: req.user!.name,
    });
    res.json({ ok: true });
  }),
);

/** Gỡ người khỏi dự án — ghi ngày kết thúc, không xoá dòng. */
projectsRouter.delete(
  '/:id/assignees/:memberId',
  requireRole('leader', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const now = nowTz();
    if (await isMonthLocked(now.year(), now.month() + 1)) {
      throw new ApiError(409, 'Tháng này đã chốt lương nên không đổi được danh sách dự án.');
    }
    const memberId = String(req.params.memberId);
    if (req.user!.role === 'leader') {
      const nguoi = await findById(memberId);
      const phong = await myTeam(req.user!.sub);
      if (!nguoi || nguoi.teamId !== phong) throw new ApiError(403, 'Chỉ gỡ được người trong phòng của bạn.');
    }
    await endAssignee(String(req.params.id), memberId, todayIso());
    res.json({ ok: true });
  }),
);

/** Thưởng KPI dự án của CHÍNH MÌNH. */
projectsRouter.get(
  '/bonus/me',
  asyncHandler(async (req, res) => {
    const { year, month } = ymQuery(req);
    res.json({ year, month, lines: await projectBonusForMember(req.user!.sub, year, month) });
  }),
);

/**
 * Leader xem phòng mình — CHỈ tỉ lệ đạt, KHÔNG có tiền.
 * Anh Tâm chốt leader không thấy con số tiền; chặn ở đây chứ không ẩn ở giao diện.
 */
projectsRouter.get(
  '/bonus/team',
  requireRole('leader', 'director', 'admin'),
  asyncHandler(async (req, res) => {
    const { year, month } = ymQuery(req);
    const phong = await myTeam(req.user!.sub);
    const lines = (await projectBonusForMonth(year, month)).filter((l) => l.teamId === phong);
    res.json({
      year,
      month,
      teamId: phong,
      lines: lines.map((l) => ({
        memberId: l.memberId,
        fullName: l.fullName,
        projectId: l.projectId,
        projectName: l.projectName,
        vaiTro: l.vaiTro,
        tyLe: l.tyLe,
      })),
    });
  }),
);

/** Toàn công ty — chỉ giám đốc/admin. */
projectsRouter.get(
  '/bonus/all',
  canMoney,
  asyncHandler(async (req, res) => {
    const { year, month } = ymQuery(req);
    const [lines, members, assignees] = await Promise.all([
      projectBonusForMonth(year, month),
      getActiveMembers(),
      getAssignees(),
    ]);
    // Ai chưa được phân công dự án nào — anh Tâm chốt "luôn luôn phân công", nên đây là
    // danh sách phải rỗng. Hiện ra để người bị quên không âm thầm mất thưởng.
    const coDuAn = new Set(assignees.filter((a) => !a.endDate).map((a) => a.memberId));
    const chuaPhanCong = members
      .filter((m) => m.role === 'member' && !coDuAn.has(m.id))
      .map((m) => ({ id: m.id, fullName: m.fullName, teamId: m.teamId }));
    res.json({ year, month, lines, chuaPhanCong });
  }),
);
