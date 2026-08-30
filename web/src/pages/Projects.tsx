import { lazy, Suspense, useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Badge, EmptyState, Skeleton, SkeletonRows, type BadgeVariant } from '../components/ui';
import AsyncButton from '../components/AsyncButton';
import DailyKpiEntry, { type TodayData } from '../components/DailyKpiEntry';
import { vnd } from '../lib/format';

// Thư viện biểu đồ nặng 360KB — tải riêng để danh sách dự án và ô nhập chỉ số hiện trước.
const KpiLineChart = lazy(() => import('../components/charts/KpiLineChart'));

// Dự án đo KẾT QUẢ cam kết với khách (bao nhiêu tin nhắn, bao nhiêu khách mới) — khác
// trang Điểm vốn đo công sức bỏ ra.

type Period = 'day' | 'week' | 'month' | 'total';

/** Người nhập đang điền con số kiểu gì (anh Tâm 4/8/2026 — hai cách nhập). */
type CachNhap = 'daily' | 'cumulative';

const CACH_NHAP: Array<{ value: CachNhap; label: string; giaiThich: string }> = [
  {
    value: 'daily',
    label: 'Số của ngày đó',
    giaiThich:
      'Mỗi ngày điền phần làm được trong ngày, hệ thống cộng lại trong kỳ. Hợp với thứ đếm được: tin nhắn, bài đăng, lượt tiếp cận.',
  },
  {
    value: 'cumulative',
    label: 'Số tổng đến ngày đó',
    giaiThich:
      'Điền con số tổng tại thời điểm đó, hệ thống lấy số mới nhất chứ KHÔNG cộng. Hợp với thứ đo trạng thái: số keyword đang top 10, số follower.',
  },
];

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Mỗi ngày' },
  { value: 'week', label: 'Mỗi tuần' },
  { value: 'month', label: 'Mỗi tháng' },
];

/**
 * Kỳ chọn được khi khai chỉ số.
 *
 * Anh Tâm 4/8/2026 bỏ "Cả dự án": "cái nào là tuần thì tuần mà tháng thì tháng". Nhưng
 * chỉ số CŨ đang để 'total' thì vẫn phải hiện ra trong ô chọn — bỏ hẳn khỏi danh sách là
 * ô select không khớp giá trị nào, trình duyệt hiện đại lựa chọn đầu tiên, và chỉ cần bấm
 * Lưu một cái là kỳ bị đổi lặng lẽ sang "Mỗi ngày".
 */
const CHON_KY = (hienTai: Period): Array<{ value: Period; label: string }> =>
  hienTai === 'total'
    ? [...PERIODS, { value: 'total', label: 'Cả dự án (kiểu cũ — nên đổi sang tuần/tháng)' }]
    : PERIODS;

const TEAMS = ['Ads', 'Content', 'SEO'];

const STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Đang chạy', variant: 'success' },
  paused: { label: 'Tạm dừng', variant: 'warn' },
  done: { label: 'Đã xong', variant: 'neutral' },
};

/** Một chỉ số kèm số đã đạt, đủ để hiện một dòng trên thẻ dự án. */
interface KpiTomTat {
  id: string;
  teamId: string;
  name: string;
  unit: string;
  period: Period;
  inputMode?: CachNhap;
  current: number;
  target: number;
  percent: number;
  periodLabel: string;
}

interface ProjectRow {
  id: string;
  name: string;
  customerId: string;
  customerName: string;
  status: string;
  startDate: string;
  endDate: string;
  note: string;
  kpiCount: number;
  percent: number;
  /** Số chỉ số thực sự được tính vào phần trăm (có đặt mục tiêu). */
  measured?: number;
  /** Số chỉ số chưa đặt mục tiêu — chưa đo được tiến độ. */
  noTarget?: number;
  /** Các phòng có chỉ số trong dự án. */
  teams?: string[];
  /** Từng chỉ số kèm số đã đạt — hiện thẳng trên thẻ, khỏi phải mở dự án ra xem. */
  kpis?: KpiTomTat[];
  /** % thời gian đã trôi; null khi chưa khai ngày bắt đầu/kết thúc. */
  timePercent?: number | null;
  alert?: 'none' | 'warn' | 'danger';
  alertReason?: string;
}

/**
 * Viền và nền theo mức cảnh báo. Đỏ phải NỔI HƠN vàng — nếu không thì mức nặng lại chìm
 * hơn mức nhẹ, mắt đọc ngược mức độ nghiêm trọng.
 */
const ALERT_STYLE: Record<string, string> = {
  danger: 'border-rose-400 bg-rose-50 hover:border-rose-500',
  warn: 'border-amber-300 bg-amber-50/70 hover:border-amber-400',
  none: 'border-brand-100 hover:border-brand-200 hover:bg-brand-50',
};

interface Kpi {
  id: string;
  projectId: string;
  teamId: string;
  name: string;
  unit: string;
  period: Period;
  inputMode: CachNhap;
  /** Khung thời gian riêng của chỉ số; rỗng = chạy theo thời gian cả dự án. */
  startDate?: string;
  endDate?: string;
  /** Chỉ số có khai mốc riêng hay đang mượn mốc của dự án. */
  ownDates?: boolean;
  timePercent?: number | null;
  target: number;
  active: boolean;
  /** `periodLabel` là kỳ đang đo viết cho người đọc: 'Tuần 1 (31/7–6/8)'. */
  progress: { periodKey: string; periodLabel: string; current: number; target: number; percent: number };
  series: Array<{ key: string; label: string; value: number }>;
  canWrite: boolean;
}

const blankProject = () => ({
  id: '',
  name: '',
  customerId: '',
  status: 'active',
  startDate: '',
  endDate: '',
  note: '',
});

const blankKpi = (teamId: string) => ({
  id: '',
  teamId,
  name: '',
  unit: '',
  period: 'month' as Period,
  inputMode: 'daily' as CachNhap,
  // Khung thời gian riêng của chỉ số; rỗng = chạy theo thời gian cả dự án.
  startDate: '',
  endDate: '',
  target: 0,
  active: true,
});

type KpiDraft = ReturnType<typeof blankKpi>;

/**
 * Chỉ số hay dùng của từng phòng — bấm một cái là điền sẵn tên/đơn vị/kỳ, leader chỉ
 * còn phải gõ con số mục tiêu. Vẫn tự gõ tên khác được.
 */
const KPI_PRESETS: Array<Omit<KpiDraft, 'id' | 'active' | 'startDate' | 'endDate'>> = [
  { teamId: 'Ads', name: 'Tin nhắn khách inbox', unit: 'tin', period: 'week', inputMode: 'daily', target: 0 },
  { teamId: 'Ads', name: 'Khách mới', unit: 'khách', period: 'month', inputMode: 'daily', target: 0 },
  { teamId: 'Ads', name: 'Lượt tiếp cận', unit: 'lượt', period: 'week', inputMode: 'daily', target: 0 },
  { teamId: 'Content', name: 'Bài đăng', unit: 'bài', period: 'week', inputMode: 'daily', target: 0 },
  { teamId: 'Content', name: 'Video / Reels', unit: 'video', period: 'month', inputMode: 'daily', target: 0 },
  // Số từ khoá đang ở top 10 là TRẠNG THÁI, không phải việc đếm được — cộng dồn là sai.
  { teamId: 'SEO', name: 'Từ khoá lên top 10', unit: 'từ khoá', period: 'month', inputMode: 'cumulative', target: 0 },
  { teamId: 'SEO', name: 'Bài chuẩn SEO', unit: 'bài', period: 'month', inputMode: 'daily', target: 0 },
];

/** '2026-08-04' → '4/8/2026'. Rỗng thì trả rỗng, không hiện 'Invalid Date'. */
const fmtNgay = (iso?: string) => {
  const p = (iso || '').split('-');
  return p.length === 3 ? `${Number(p[2])}/${Number(p[1])}/${p[0]}` : '';
};

/** Ba mức màu dùng chung cho thanh tiến độ và con số phần trăm — đọc phải khớp nhau. */
const mucMau = (percent: number) => (percent >= 100 ? 'emerald' : percent >= 60 ? 'brand' : 'amber');

/**
 * Thanh tiến độ. Vượt mục tiêu vẫn hiện đầy nhưng đổi màu để thấy ngay là dư.
 * `thin` cho thanh của từng chỉ số — mảnh hơn thanh tổng của cả dự án để nhìn ra
 * ngay cái nào là con, cái nào là tổng.
 */
function Bar100({ percent, thin }: { percent: number; thin?: boolean }) {
  const w = Math.min(100, Math.max(0, percent));
  const color = { emerald: 'bg-emerald-500', brand: 'bg-brand-500', amber: 'bg-amber-400' }[mucMau(percent)];
  return (
    <div className={`${thin ? 'h-1' : 'h-2'} w-full overflow-hidden rounded-full bg-brand-100`}>
      <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

/**
 * Chi tiết từng chỉ số ngay trên thẻ dự án, gom theo phòng.
 *
 * Anh Tâm 4/8/2026: "hiển thị đầy đủ các chỉ số của các team để theo dõi không cần bấm
 * vào". Trước đây thẻ chỉ nói "2 chỉ số · Ads, SEO" — biết có hai chỉ số mà không biết
 * chúng đang ở đâu, muốn xem phải mở từng dự án một.
 */
function ChiSoTheoTeam({ kpis }: { kpis: KpiTomTat[] }) {
  const PHAN_TRAM_MAU = {
    emerald: 'text-emerald-700',
    brand: 'text-brand-600',
    amber: 'text-amber-700',
  };
  const theoTeam = TEAMS.map((t) => [t, kpis.filter((k) => k.teamId === t)] as const)
    .concat([['Khác', kpis.filter((k) => !TEAMS.includes(k.teamId))] as const])
    .filter(([, ks]) => ks.length > 0);

  return (
    <div className="mt-2 space-y-1.5 border-t border-brand-100 pt-2">
      {theoTeam.map(([team, ks]) => (
        <div key={team}>
          <div className="text-[11px] font-semibold uppercase tracking-wide text-ink-faint">{team}</div>
          {ks.map((k) => (
            <div key={k.id} className="mt-1.5">
              <div className="flex items-baseline justify-between gap-2 text-xs">
                <span className="min-w-0 truncate text-ink-soft" title={k.name}>
                  {k.name}
                  {/* Kỳ đi kèm TỪNG chỉ số — anh Tâm 4/8/2026: "chỉ cần KPI của từng phòng
                      ban theo thời kỳ". Bỏ thanh gộp rồi thì đây là chỗ duy nhất nói kỳ. */}
                  <span className="text-ink-faint"> · {k.periodLabel}</span>
                </span>
                {k.target > 0 ? (
                  <span className="shrink-0 tabular-nums text-ink-muted">
                    <b className="text-ink-soft">
                      {k.current}/{k.target}
                    </b>
                    {k.unit && ` ${k.unit}`} ·{' '}
                    <b className={PHAN_TRAM_MAU[mucMau(k.percent)]}>{k.percent}%</b>
                  </span>
                ) : (
                  <span className="shrink-0 text-amber-700">chưa đặt mục tiêu</span>
                )}
              </div>
              {/* Chưa đặt mục tiêu thì không vẽ thanh: một thanh rỗng dài thượt trông y hệt
                  "làm mãi chưa được gì", trong khi thật ra là chưa có gì để đo. */}
              {k.target > 0 && (
                <div className="mt-0.5">
                  <Bar100 percent={k.percent} thin />
                </div>
              )}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}

export default function Projects() {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user?.role === 'leader' || user?.role === 'director' || user?.role === 'admin';
  const isDirector = user?.role === 'director' || user?.role === 'admin';
  // Leader chỉ phân công được người phòng mình — lấy phòng từ hồ sơ đang đăng nhập.
  const myTeamId = user?.teamId || '';

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [today, setToday] = useState<TodayData | null>(null);
  const [customers, setCustomers] = useState<Array<{ id: string; name: string }>>([]);
  const [loading, setLoading] = useState(true);

  // Phòng của người đang tạo — gợi ý sẵn cho dòng chỉ số đầu tiên.
  const myTeam = user?.teamId && TEAMS.includes(user.teamId) ? user.teamId : TEAMS[0]!;

  const [edit, setEdit] = useState<ReturnType<typeof blankProject> | null>(null);
  // Chỉ số nhập kèm ngay trong form dự án mới (dự án đã có thì sửa ở phần chi tiết).
  const [kpiRows, setKpiRows] = useState<KpiDraft[]>([]);
  const [open, setOpen] = useState<{ project: ProjectRow; kpis: Kpi[] } | null>(null);
  const [kpiEdit, setKpiEdit] = useState<ReturnType<typeof blankKpi> | null>(null);
  const [chartKpi, setChartKpi] = useState<Kpi | null>(null);

  async function loadProjects() {
    const r = await api<{ projects: ProjectRow[] }>('/projects');
    setProjects(r.projects);
  }
  async function loadToday() {
    setToday(await api('/projects/my-today'));
  }

  useEffect(() => {
    Promise.all([loadProjects(), loadToday()])
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // Danh sách khách rút gọn (chỉ tên) — leader không vào được CRM nhưng vẫn cần gắn khách
    // vào dự án. Vai không tạo được dự án thì gọi hỏng, bỏ qua im lặng.
    if (canManage) {
      api<{ customers: Array<{ id: string; name: string }> }>('/projects/customer-options')
        .then((r) => setCustomers(r.customers))
        .catch(() => setCustomers([]));
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function openProject(p: ProjectRow) {
    try {
      const r = await api<{ project: ProjectRow; kpis: Kpi[] }>(`/projects/${p.id}`);
      // Giữ phần trăm từ danh sách (route chi tiết không tính), còn lại lấy bản mới nhất
      // từ máy chủ — sửa tên hay đổi khách xong mở lại phải thấy ngay.
      setOpen({ project: { ...p, ...r.project }, kpis: r.kpis });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  function newProject() {
    setKpiRows([blankKpi(myTeam)]);
    setEdit(blankProject());
  }

  function closeProjectForm() {
    setEdit(null);
    setKpiRows([]);
  }

  async function saveProject() {
    if (!edit?.name.trim()) return toast.error('Nhập tên dự án.');
    // Dòng chỉ số bỏ trống tên coi như không nhập — không bắt anh phải xoá từng dòng thừa.
    const rows = kpiRows.filter((k) => k.name.trim());
    try {
      const r = await api<{ id: string }>('/projects', { body: edit });
      // Chỉ số phải gắn sau vì cần mã dự án; lưu tuần tự để lỗi dòng nào biết dòng đó.
      for (const k of rows) await api(`/projects/${r.id}/kpis`, { body: { ...k, name: k.name.trim() } });
      toast.success(rows.length ? `Đã lưu dự án và ${rows.length} chỉ số.` : 'Đã lưu dự án.');
      closeProjectForm();
      await Promise.all([loadProjects(), loadToday()]);
    } catch (e) {
      // Dự án có thể đã tạo xong rồi mới hỏng ở phần chỉ số — nạp lại để thấy đúng thực tế.
      toast.error((e as Error).message);
      await Promise.all([loadProjects(), loadToday()]).catch(() => undefined);
    }
  }

  async function removeProject(p: ProjectRow) {
    if (!window.confirm(`Xoá dự án "${p.name}"? Mọi chỉ số và số đã nhập sẽ mất theo.`)) return;
    try {
      await api(`/projects/${p.id}`, { method: 'DELETE' });
      setOpen(null);
      await loadProjects();
      toast.success('Đã xoá dự án.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveKpi() {
    if (!open || !kpiEdit?.name.trim()) return toast.error('Nhập tên chỉ số.');
    try {
      await api(`/projects/${open.project.id}/kpis`, { body: kpiEdit });
      setKpiEdit(null);
      await Promise.all([openProject(open.project), loadProjects(), loadToday()]);
      toast.success('Đã lưu chỉ số.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeKpi(k: Kpi) {
    if (!open || !window.confirm(`Xoá chỉ số "${k.name}"? Số đã nhập sẽ mất theo.`)) return;
    try {
      await api(`/projects/kpis/${k.id}`, { method: 'DELETE' });
      await Promise.all([openProject(open.project), loadProjects(), loadToday()]);
      toast.success('Đã xoá chỉ số.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Nhập xong một lô chỉ số → làm mới mọi chỗ đang hiện số đó (tiến độ dự án, ô chi tiết). */
  async function reloadAfterEntry() {
    await Promise.all([loadToday(), loadProjects(), open ? openProject(open.project) : Promise.resolve()]);
  }

  // Bộ lọc — dự án nhiều lên thì nhìn cả danh sách không ra vấn đề nằm ở đâu.
  const [fTeam, setFTeam] = useState('');
  const [fProgress, setFProgress] = useState('');
  const [fAlert, setFAlert] = useState(false);

  const shown = useMemo(
    () =>
      projects.filter((p) => {
        if (fTeam && !(p.teams || []).includes(fTeam)) return false;
        if (fAlert && p.alert !== 'warn' && p.alert !== 'danger') return false;
        if (fProgress === 'low' && p.percent >= 50) return false;
        if (fProgress === 'mid' && (p.percent < 50 || p.percent >= 100)) return false;
        if (fProgress === 'done' && p.percent < 100) return false;
        return true;
      }),
    [projects, fTeam, fProgress, fAlert],
  );
  const soCanhBao = projects.filter((p) => p.alert === 'warn' || p.alert === 'danger').length;

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Dự án &amp; KPI</h1>
          <p className="text-sm text-ink-muted">
            Theo dõi kết quả cam kết với khách. Mỗi phòng nhập chỉ số của phòng mình hằng ngày.
          </p>
        </div>
        {canManage && (
          <button className="btn-primary" onClick={newProject}>
            + Dự án mới
          </button>
        )}
      </div>

      {/* Việc hằng ngày của nhân sự — đặt trên cùng vì đây là thứ họ mở app để làm. */}
      {today && <DailyKpiEntry today={today} onSaved={reloadAfterEntry} />}

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">
            Dự án ({shown.length}
            {shown.length !== projects.length && ` / ${projects.length}`})
          </h2>
          <div className="flex flex-wrap items-center gap-2">
            <select className="input max-w-[9rem] py-1 text-sm" value={fTeam} onChange={(e) => setFTeam(e.target.value)}>
              <option value="">Mọi phòng</option>
              {TEAMS.map((t) => (
                <option key={t} value={t}>{t}</option>
              ))}
            </select>
            <select
              className="input max-w-[11rem] py-1 text-sm"
              value={fProgress}
              onChange={(e) => setFProgress(e.target.value)}
            >
              <option value="">Mọi tiến độ</option>
              <option value="low">Dưới 50%</option>
              <option value="mid">50–99%</option>
              <option value="done">Đạt 100%</option>
            </select>
            {/* Nút này là thứ giám đốc bấm đầu tiên mỗi sáng — cho nó nổi hơn hai ô kia. */}
            <button
              className={`rounded-lg border px-3 py-1 text-sm ${
                fAlert
                  ? 'border-rose-400 bg-rose-50 font-medium text-rose-700'
                  : 'border-brand-100 text-ink-soft hover:bg-brand-50'
              }`}
              onClick={() => setFAlert((v) => !v)}
            >
              ⚠️ Cần chú ý{soCanhBao > 0 && ` (${soCanhBao})`}
            </button>
          </div>
        </div>
        {loading ? (
          <SkeletonRows rows={3} />
        ) : projects.length === 0 ? (
          <EmptyState icon="📁" text="Chưa có dự án nào. Leader bấm “+ Dự án mới” để bắt đầu." />
        ) : shown.length === 0 ? (
          <EmptyState icon="🔍" text="Không có dự án nào khớp bộ lọc." />
        ) : (
          <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
            {/* grid-cols-1 chứ KHÔNG để trống: không khai cột thì cột tự giãn theo nội dung
                dài nhất, dòng chỉ số dài là cả thẻ phình ra khỏi màn hình điện thoại.
                min-w-0 để tên dài trong thẻ cắt bằng dấu … thay vì đẩy thẻ rộng ra. */}
            {shown.map((p) => (
              <button
                key={p.id}
                title={p.alertReason || ''}
                // self-start: thẻ cao bằng đúng nội dung. Không có nó thì thẻ ngắn bị kéo
                // giãn bằng thẻ dài cùng hàng, mà trình duyệt lại canh giữa nội dung trong
                // <button> — thành ra chữ trôi lơ lửng giữa thẻ.
                className={`min-w-0 self-start rounded-xl border p-3 text-left ${ALERT_STYLE[p.alert || 'none']}`}
                onClick={() => openProject(p)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-ink">{p.name}</div>
                    {p.customerName && <div className="truncate text-xs text-ink-muted">{p.customerName}</div>}
                  </div>
                  <Badge variant={STATUS[p.status]?.variant || 'neutral'}>
                    {STATUS[p.status]?.label || p.status}
                  </Badge>
                </div>
                {/* Chưa chỉ số nào có mục tiêu thì 0% là vô nghĩa — nói thẳng ra thay vì
                    để anh tưởng nhập số mà tiến độ không nhúc nhích.
                    KHÔNG còn thanh tổng gộp theo kỳ: anh Tâm 4/8/2026 chốt bỏ, chỉ xem
                    chỉ số của từng phòng ban. */}
                {p.measured === 0 && p.kpiCount > 0 && (
                  <div className="mt-2 text-xs text-amber-700">Chưa đặt mục tiêu nên chưa đo được tiến độ</div>
                )}
                {/* Thời gian đã trôi — đặt cạnh tiến độ KPI để so được bằng mắt. */}
                {typeof p.timePercent === 'number' && (
                  <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
                    <span className="w-14 shrink-0">Thời gian</span>
                    <div className="h-1 w-full overflow-hidden rounded-full bg-brand-100">
                      <div
                        className="h-full rounded-full bg-brand-300"
                        style={{ width: `${Math.min(100, p.timePercent)}%` }}
                      />
                    </div>
                    <span className="w-10 shrink-0 text-right">{p.timePercent}%</span>
                  </div>
                )}
                {p.kpis && p.kpis.length > 0 ? (
                  <ChiSoTheoTeam kpis={p.kpis} />
                ) : (
                  <div className="mt-1 text-xs text-ink-faint">Chưa có chỉ số nào</div>
                )}
                {p.alertReason && (
                  <div
                    className={`mt-1.5 text-xs font-medium ${
                      p.alert === 'danger' ? 'text-rose-700' : 'text-amber-700'
                    }`}
                  >
                    {p.alert === 'danger' ? '🔴' : '🟡'} {p.alertReason}
                  </div>
                )}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chi tiết dự án */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4"
          onClick={() => { setOpen(null); setKpiEdit(null); setChartKpi(null); }}
        >
          <div className="card hien-len my-8 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{open.project.name}</h2>
                <div className="mt-1 text-xs text-ink-muted">
                  {open.project.customerName || 'Dự án nội bộ'}
                  {open.project.startDate && ` · từ ${open.project.startDate}`}
                  {open.project.endDate && ` → ${open.project.endDate}`}
                </div>
              </div>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setOpen(null)}>
                ✕ Đóng
              </button>
            </div>

            {/* Tuần/tháng của dự án đếm từ ngày bắt đầu. Thiếu ngày đó thì phải quay về
                tuần lịch — nói thẳng ra, vì đây đúng là chỗ làm tiến độ trông như đứng im. */}
            {!open.project.startDate && open.kpis.some((k) => k.period === 'week' || k.period === 'month') && (
              <p className="mt-2 rounded-xl bg-amber-50 p-2.5 text-xs text-amber-800">
                Dự án chưa khai <b>ngày bắt đầu</b> nên tuần/tháng đang tính theo lịch (tuần mới bắt đầu
                mỗi thứ Hai). Bấm <b>Sửa dự án</b> để khai ngày bắt đầu — khi đó tuần 1 chạy từ đúng ngày
                ấy cộng 7 ngày.
              </p>
            )}

            {open.project.note && <p className="mt-2 text-sm text-ink-soft">{open.project.note}</p>}

            {canManage && (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  className="btn-ghost text-sm"
                  onClick={() => setEdit({ ...blankProject(), ...open.project })}
                >
                  Sửa dự án
                </button>
                <button className="btn-ghost text-sm" onClick={() => setKpiEdit(blankKpi(TEAMS[0]!))}>
                  + Thêm chỉ số
                </button>
                <button className="btn-ghost text-sm text-rose-600" onClick={() => removeProject(open.project)}>
                  Xoá dự án
                </button>
              </div>
            )}

            {TEAMS.filter((t) => open.kpis.some((k) => k.teamId === t)).map((team) => (
              <div key={team} className="mt-4">
                <h3 className="mb-2 text-sm font-semibold text-ink-soft">Phòng {team}</h3>
                <div className="space-y-2">
                  {open.kpis
                    .filter((k) => k.teamId === team)
                    .map((k) => (
                      <div key={k.id} className={`rounded-xl border p-3 ${k.active ? 'border-brand-100' : 'border-brand-100 bg-brand-50 opacity-70'}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-ink">
                            {k.name}
                            {k.unit && <span className="text-ink-faint"> ({k.unit})</span>}
                            {!k.active && <span className="ml-2 text-xs text-ink-faint">đã tắt</span>}
                          </span>
                          {/* Ghi rõ ĐANG ĐO KỲ NÀO. Trước đây chỉ hiện "Mỗi tuần · 0/68" nên
                              thấy số 0 mà không biết nó là 0 của kỳ nào, tưởng máy không ghi nhận. */}
                          <span className="text-xs text-ink-muted">
                            {k.period !== 'total' && <>{k.progress.periodLabel} · </>}
                            <b className="text-ink-soft">
                              {k.progress.current}/{k.target || '—'}
                            </b>
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Bar100 percent={k.progress.percent} />
                          <span className="w-12 shrink-0 text-right text-sm font-medium text-ink-soft">
                            {k.progress.percent}%
                          </span>
                        </div>
                        {/* Chỉ số có hạn riêng thì so tiến độ với hạn CỦA NÓ, không phải của
                            cả dự án — "120 từ khoá trong 8 tháng" dài hơn hẳn dự án mẹ. */}
                        {k.ownDates && typeof k.timePercent === 'number' && (
                          <div className="mt-1 flex items-center gap-2 text-xs text-ink-faint">
                            <span className="shrink-0">
                              Hạn riêng {fmtNgay(k.startDate)} → {fmtNgay(k.endDate)}
                            </span>
                            <div className="h-1 w-full overflow-hidden rounded-full bg-brand-100">
                              <div
                                className="h-full rounded-full bg-brand-300"
                                style={{ width: `${Math.min(100, k.timePercent)}%` }}
                              />
                            </div>
                            <span className="w-10 shrink-0 text-right">{k.timePercent}%</span>
                          </div>
                        )}
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <button className="text-brand-600 underline" onClick={() => setChartKpi(chartKpi?.id === k.id ? null : k)}>
                            {chartKpi?.id === k.id ? 'Ẩn biểu đồ' : 'Xem biểu đồ'}
                          </button>
                          {canManage && (
                            <>
                              <button className="text-ink-muted underline" onClick={() => setKpiEdit({ ...blankKpi(k.teamId), ...k })}>
                                Sửa chỉ số
                              </button>
                              <button className="text-rose-600 underline" onClick={() => removeKpi(k)}>
                                Xoá
                              </button>
                            </>
                          )}
                        </div>

                        {chartKpi?.id === k.id && (
                          <div className="mt-3">
                            <Suspense fallback={<Skeleton className="h-[200px] w-full" />}>
                              <KpiLineChart data={k.series} />
                            </Suspense>
                          </div>
                        )}

                        {/* Giám đốc nhập bù cho ngày đã khoá. */}
                        {isDirector && k.active && <BackfillRow kpiId={k.id} onSaved={() => openProject(open.project)} />}
                      </div>
                    ))}
                </div>
                <ThuongVaThanhVien
                  projectId={open.project.id}
                  team={team}
                  isDirector={isDirector}
                  myTeam={myTeamId}
                  canAssign={canManage}
                />
              </div>
            ))}

            {open.kpis.length === 0 && (
              <EmptyState icon="🎯" text="Dự án này chưa có chỉ số nào." />
            )}
          </div>
        </div>
      )}

      {/* Form dự án */}
      {edit && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink/40 p-4" onClick={closeProjectForm}>
          <div className="card hien-len my-8 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-3 font-semibold">{edit.id ? 'Sửa dự án' : 'Dự án mới'}</h2>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Tên dự án</label>
                <input className="input" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Khách hàng (tuỳ chọn)</label>
                <select className="input" value={edit.customerId} onChange={(e) => setEdit({ ...edit, customerId: e.target.value })}>
                  <option value="">— Dự án nội bộ —</option>
                  {customers.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Trạng thái</label>
                <select className="input" value={edit.status} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {Object.entries(STATUS).map(([v, s]) => (
                    <option key={v} value={v}>{s.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Bắt đầu</label>
                <input className="input" type="date" value={edit.startDate} onChange={(e) => setEdit({ ...edit, startDate: e.target.value })} />
              </div>
              <div>
                <label className="label">Kết thúc</label>
                <input className="input" type="date" value={edit.endDate} onChange={(e) => setEdit({ ...edit, endDate: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Ghi chú</label>
                <textarea className="input" rows={2} value={edit.note} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
              </div>
            </div>

            {/* Chỉ số đặt luôn ở đây: tạo dự án xong là các phòng có ô để nhập ngay hôm sau. */}
            {!edit.id && (
              <div className="mt-5 border-t border-brand-100 pt-4">
                <h3 className="font-semibold">Chỉ số KPI của dự án</h3>
                <p className="mb-3 text-xs text-ink-muted">
                  Mỗi chỉ số gắn một phòng — chỉ người phòng đó nhập số. Bỏ trống cũng được, thêm sau
                  trong phần chi tiết dự án.
                </p>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {KPI_PRESETS.map((p) => (
                    <button
                      key={`${p.teamId}-${p.name}`}
                      type="button"
                      className="rounded-full border border-brand-100 px-3 py-1 text-xs text-ink-soft hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                      onClick={() =>
                        setKpiRows((rows) => [...rows, { ...p, id: '', active: true, startDate: '', endDate: '' }])
                      }
                    >
                      + {p.teamId}: {p.name}
                    </button>
                  ))}
                </div>

                {kpiRows.length > 0 && (
                  <div className="hidden gap-2 px-1 pb-1 text-xs text-ink-faint sm:grid sm:grid-cols-12">
                    <span className="sm:col-span-2">Phòng</span>
                    <span className="sm:col-span-3">Tên chỉ số</span>
                    <span className="sm:col-span-2">Đơn vị</span>
                    <span className="sm:col-span-1">Tính theo</span>
                    <span className="sm:col-span-1">Cách nhập</span>
                    <span className="sm:col-span-3">Mục tiêu</span>
                  </div>
                )}

                <div className="space-y-2">
                  {kpiRows.map((k, i) => {
                    const set = (patch: Partial<KpiDraft>) =>
                      setKpiRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                    return (
                      <div key={i} className="grid gap-2 rounded-xl border border-brand-100 p-2 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0">
                        <select className="input py-1.5 text-sm sm:col-span-2" value={k.teamId} onChange={(e) => set({ teamId: e.target.value })}>
                          {TEAMS.map((t) => (
                            <option key={t} value={t}>{t}</option>
                          ))}
                        </select>
                        <input
                          className="input py-1.5 text-sm sm:col-span-4"
                          placeholder="vd: Tin nhắn khách inbox"
                          value={k.name}
                          onChange={(e) => set({ name: e.target.value })}
                        />
                        <input
                          className="input py-1.5 text-sm sm:col-span-2"
                          placeholder="tin, khách…"
                          value={k.unit}
                          onChange={(e) => set({ unit: e.target.value })}
                        />
                        <select className="input py-1.5 text-sm sm:col-span-1" value={k.period} onChange={(e) => set({ period: e.target.value as Period })}>
                          {CHON_KY(k.period).map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <select
                          className="input py-1.5 text-sm sm:col-span-1"
                          value={k.inputMode}
                          title="Cách nhập số"
                          onChange={(e) => set({ inputMode: e.target.value as CachNhap })}
                        >
                          {CACH_NHAP.map((c) => (
                            <option key={c.value} value={c.value}>{c.label}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1 sm:col-span-3">
                          <input
                            className="input py-1.5 text-sm"
                            type="number"
                            min={0}
                            placeholder="mục tiêu"
                            value={k.target || ''}
                            onChange={(e) => set({ target: Number(e.target.value) })}
                          />
                          <button
                            type="button"
                            className="shrink-0 rounded-lg px-2 py-1 text-ink-faint hover:bg-rose-50 hover:text-rose-600"
                            aria-label={`Bỏ chỉ số ${k.name || 'chưa đặt tên'}`}
                            onClick={() => setKpiRows((rows) => rows.filter((_, j) => j !== i))}
                          >
                            ✕
                          </button>
                        </div>
                      </div>
                    );
                  })}
                </div>

                <button
                  type="button"
                  className="btn-ghost mt-2 text-sm"
                  onClick={() => setKpiRows((rows) => [...rows, blankKpi(myTeam)])}
                >
                  + Thêm dòng trống
                </button>
              </div>
            )}

            <div className="mt-4 flex gap-2">
              <AsyncButton className="btn-primary" onClick={saveProject} busyLabel="Đang lưu…">Lưu</AsyncButton>
              <button className="btn-ghost" onClick={closeProjectForm}>Huỷ</button>
            </div>
          </div>
        </div>
      )}

      {/* Form chỉ số */}
      {kpiEdit && (
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-ink/40 p-4" onClick={() => setKpiEdit(null)}>
          <div className="card hien-len my-8 w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 font-semibold">{kpiEdit.id ? 'Sửa chỉ số' : 'Chỉ số mới'}</h2>
            <p className="mb-3 text-xs text-ink-muted">
              Bạn đặt tên và mục tiêu; nhân sự trong phòng sẽ nhập số hằng ngày.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="sm:col-span-2">
                <label className="label">Tên chỉ số</label>
                <input
                  className="input"
                  placeholder="vd: Số tin nhắn khách inbox"
                  value={kpiEdit.name}
                  onChange={(e) => setKpiEdit({ ...kpiEdit, name: e.target.value })}
                />
              </div>
              <div>
                <label className="label">Phòng phụ trách</label>
                <select className="input" value={kpiEdit.teamId} onChange={(e) => setKpiEdit({ ...kpiEdit, teamId: e.target.value })}>
                  {TEAMS.map((t) => (
                    <option key={t} value={t}>{t}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Đơn vị</label>
                <input className="input" placeholder="tin, khách, bài…" value={kpiEdit.unit} onChange={(e) => setKpiEdit({ ...kpiEdit, unit: e.target.value })} />
              </div>
              <div>
                <label className="label">Chỉ tiêu tính theo</label>
                <select className="input" value={kpiEdit.period} onChange={(e) => setKpiEdit({ ...kpiEdit, period: e.target.value as Period })}>
                  {CHON_KY(kpiEdit.period).map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
                <label className="label mt-3">Cách nhập số</label>
                <select
                  className="input"
                  value={kpiEdit.inputMode}
                  onChange={(e) => setKpiEdit({ ...kpiEdit, inputMode: e.target.value as CachNhap })}
                >
                  {CACH_NHAP.map((c) => (
                    <option key={c.value} value={c.value}>{c.label}</option>
                  ))}
                </select>
                <p className="mt-1 text-xs text-ink-muted">
                  {CACH_NHAP.find((c) => c.value === kpiEdit.inputMode)?.giaiThich}
                </p>

                {/* Khung thời gian riêng — SEO hay có kiểu "120 từ khoá trong 6–8 tháng",
                    dài hơn hẳn một tháng nên không mượn được mốc của dự án. */}
                <label className="label mt-3">Thời gian riêng của chỉ số (nếu có)</label>
                <div className="grid grid-cols-2 gap-2">
                  <input
                    className="input"
                    type="date"
                    aria-label="Ngày bắt đầu chỉ số"
                    value={kpiEdit.startDate}
                    onChange={(e) => setKpiEdit({ ...kpiEdit, startDate: e.target.value })}
                  />
                  <input
                    className="input"
                    type="date"
                    aria-label="Ngày kết thúc chỉ số"
                    value={kpiEdit.endDate}
                    onChange={(e) => setKpiEdit({ ...kpiEdit, endDate: e.target.value })}
                  />
                </div>
                <p className="mt-1 text-xs text-ink-muted">
                  Bỏ trống thì chỉ số chạy theo thời gian của cả dự án. Khai riêng khi chỉ tiêu có
                  hạn riêng — vd “120 từ khoá lên top 10 trong 8 tháng”.
                </p>
                {kpiEdit.period === 'total' && (
                  <p className="mt-1 text-xs text-amber-700">
                    Chỉ số này đang để “Cả dự án” — kiểu cũ, cộng dồn mãi không bao giờ về 0. Đổi
                    sang <b>Mỗi tuần</b> hoặc <b>Mỗi tháng</b> để theo dõi đúng kỳ.
                  </p>
                )}
              </div>
              <div>
                <label className="label">Mục tiêu</label>
                <input
                  className="input"
                  type="number"
                  min={0}
                  value={kpiEdit.target || ''}
                  onChange={(e) => setKpiEdit({ ...kpiEdit, target: Number(e.target.value) })}
                />
              </div>
              <label className="flex items-center gap-2 text-sm sm:col-span-2">
                <input type="checkbox" checked={kpiEdit.active} onChange={(e) => setKpiEdit({ ...kpiEdit, active: e.target.checked })} />
                Đang dùng (bỏ chọn để tắt mà vẫn giữ số đã nhập)
              </label>
            </div>
            <div className="mt-4 flex gap-2">
              <AsyncButton className="btn-primary" onClick={saveKpi} busyLabel="Đang lưu…">Lưu</AsyncButton>
              <button className="btn-ghost" onClick={() => setKpiEdit(null)}>Huỷ</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

/** Ô nhập bù của giám đốc — chọn ngày tự do, kể cả ngày đã khoá với nhân sự. */
function BackfillRow({ kpiId, onSaved }: { kpiId: string; onSaved: () => Promise<void> | void }) {
  const toast = useToast();
  const [date, setDate] = useState('');
  const [value, setValue] = useState('');

  async function save() {
    if (!date) return toast.error('Chọn ngày cần nhập bù.');
    const n = Number(value);
    if (!value.trim() || !Number.isFinite(n) || n < 0) return toast.error('Nhập số không âm.');
    try {
      await api(`/projects/kpis/${kpiId}/entries`, { body: { date, value: Math.round(n) } });
      setValue('');
      toast.success('Đã nhập bù.');
      await onSaved();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-brand-50 p-2">
      <span className="text-xs text-ink-muted">Nhập bù</span>
      <input className="input max-w-[9.5rem] py-1 text-sm" type="date" value={date} onChange={(e) => setDate(e.target.value)} />
      <input
        className="input max-w-[7rem] py-1 text-sm"
        type="number"
        min={0}
        placeholder="số"
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />
      <AsyncButton className="btn-ghost px-3 py-1 text-sm" busyLabel="…" onClick={save}>
        Lưu
      </AsyncButton>
    </div>
  );
}
/**
 * Thưởng KPI và thành viên của một phòng trong một dự án.
 *
 * Giám đốc đặt mức thưởng; leader tích người phòng mình. Leader KHÔNG thấy con số tiền —
 * chặn thật ở tầng route (`GET /:id/bonus` chỉ mở cho giám đốc), đây chỉ là không vẽ ra.
 */
function ThuongVaThanhVien({
  projectId,
  team,
  isDirector,
  myTeam,
  canAssign,
}: {
  projectId: string;
  team: string;
  isDirector: boolean;
  /** Phòng của người đang xem — leader chỉ sửa được phòng mình. */
  myTeam: string;
  canAssign: boolean;
}) {
  const toast = useToast();
  const [muc, setMuc] = useState('');
  const [mucLuu, setMucLuu] = useState(0);
  const [assignees, setAssignees] = useState<Array<{ memberId: string; endDate: string }>>([]);
  const [nguoi, setNguoi] = useState<Array<{ id: string; fullName: string; teamId: string }>>([]);
  const [mo, setMo] = useState(false);

  const suaDuoc = canAssign && (isDirector || myTeam === team);

  async function load() {
    const [as, ds] = await Promise.all([
      api<{ assignees: Array<{ memberId: string; endDate: string }> }>(`/projects/${projectId}/assignees`),
      api<{ assignees: Array<{ id: string; fullName: string; teamId: string }> }>('/tasks/assignees').catch(
        () => ({ assignees: [] }),
      ),
    ]);
    setAssignees(as.assignees);
    setNguoi(ds.assignees.filter((m) => m.teamId === team));
    if (isDirector) {
      const b = await api<{ bonuses: Array<{ teamId: string; amount: number }> }>(
        `/projects/${projectId}/bonus`,
      ).catch(() => ({ bonuses: [] }));
      const m = b.bonuses.find((x) => x.teamId === team)?.amount ?? 0;
      setMucLuu(m);
      setMuc(m ? String(m) : '');
    }
  }

  useEffect(() => {
    if (mo) load().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mo, projectId, team]);

  const dangThamGia = assignees.filter((a) => !a.endDate).map((a) => a.memberId);

  async function luuMuc() {
    try {
      await api(`/projects/${projectId}/bonus/${team}`, {
        method: 'PUT',
        body: { amount: Number(muc) || 0 },
      });
      toast.success('Đã lưu mức thưởng');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function doiThamGia(memberId: string, them: boolean) {
    try {
      if (them) await api(`/projects/${projectId}/assignees`, { body: { memberId } });
      else await api(`/projects/${projectId}/assignees/${memberId}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!mo) {
    return (
      <button className="mt-2 text-xs text-brand-600 underline" onClick={() => setMo(true)}>
        ⚙️ Thưởng KPI &amp; thành viên phòng {team}
      </button>
    );
  }

  return (
    <div className="mt-2 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
      <div className="mb-2 flex items-center justify-between">
        <span className="text-xs font-medium text-ink-soft">Thưởng KPI &amp; thành viên</span>
        <button className="text-xs text-ink-muted underline" onClick={() => setMo(false)}>
          thu gọn
        </button>
      </div>

      {isDirector && (
        <div className="mb-3">
          <label className="label text-xs">Mức thưởng nếu đạt 100% KPI (mỗi tháng)</label>
          <div className="flex flex-wrap items-center gap-2">
            <input
              className="input max-w-[12rem] py-1"
              type="number"
              min={0}
              placeholder="0"
              value={muc}
              onChange={(e) => setMuc(e.target.value)}
            />
            <AsyncButton className="btn-primary px-3 py-1 text-sm" onClick={luuMuc} busyLabel="Đang lưu…">
              Lưu mức
            </AsyncButton>
            {mucLuu > 0 && <span className="text-xs text-ink-muted">đang là {vnd(mucLuu)}</span>}
          </div>
          <p className="mt-1 text-xs text-ink-muted">
            Leader phòng {team} nhận số này khi đạt 100%; đạt 50% thì nhận một nửa. Thành viên đạt 80–99%
            nhận nửa mức, từ 100% nhận trọn mức.
          </p>
        </div>
      )}

      <div>
        <div className="mb-1 text-xs font-medium text-ink-soft">
          Thành viên tham gia ({dangThamGia.length})
        </div>
        {nguoi.length === 0 ? (
          <p className="text-xs text-ink-muted">Phòng {team} chưa có ai để phân công.</p>
        ) : (
          <div className="flex flex-wrap gap-1.5">
            {nguoi.map((m) => {
              const co = dangThamGia.includes(m.id);
              return (
                <button
                  key={m.id}
                  disabled={!suaDuoc}
                  onClick={() => doiThamGia(m.id, !co)}
                  className={`rounded-lg border px-2 py-1 text-xs ${
                    co ? 'border-brand-600 bg-brand-600 text-white' : 'border-brand-200 bg-white text-ink-soft'
                  } ${suaDuoc ? '' : 'cursor-not-allowed opacity-60'}`}
                >
                  {co ? '✓ ' : '+ '}
                  {m.fullName}
                </button>
              );
            })}
          </div>
        )}
        {!suaDuoc && (
          <p className="mt-1 text-xs text-ink-muted">Chỉ leader phòng {team} phân công được.</p>
        )}
        {suaDuoc && dangThamGia.length === 0 && (
          <p className="mt-1 text-xs text-amber-700">
            Chưa phân công ai — phòng này sẽ không có ai được thưởng KPI dự án.
          </p>
        )}
      </div>
    </div>
  );
}
