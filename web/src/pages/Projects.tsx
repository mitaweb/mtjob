import { useEffect, useMemo, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, LineChart, Line } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from '../components/Toaster';
import { Badge, EmptyState, SkeletonRows, type BadgeVariant } from '../components/ui';
import AsyncButton from '../components/AsyncButton';

// Dự án đo KẾT QUẢ cam kết với khách (bao nhiêu tin nhắn, bao nhiêu khách mới) — khác
// trang Điểm vốn đo công sức bỏ ra.

type Period = 'day' | 'week' | 'month' | 'total';

const PERIODS: Array<{ value: Period; label: string }> = [
  { value: 'day', label: 'Mỗi ngày' },
  { value: 'week', label: 'Mỗi tuần' },
  { value: 'month', label: 'Mỗi tháng' },
  { value: 'total', label: 'Cả dự án' },
];

const TEAMS = ['Ads', 'Content', 'SEO'];

const STATUS: Record<string, { label: string; variant: BadgeVariant }> = {
  active: { label: 'Đang chạy', variant: 'success' },
  paused: { label: 'Tạm dừng', variant: 'warn' },
  done: { label: 'Đã xong', variant: 'neutral' },
};

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
}

interface Kpi {
  id: string;
  projectId: string;
  teamId: string;
  name: string;
  unit: string;
  period: Period;
  target: number;
  active: boolean;
  progress: { periodKey: string; current: number; target: number; percent: number };
  series: Array<{ key: string; label: string; value: number }>;
  canWrite: boolean;
}

interface TodayRow {
  kpi: Kpi;
  projectName: string;
  today: number | null;
  yesterday: number | null;
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
  target: 0,
  active: true,
});

type KpiDraft = ReturnType<typeof blankKpi>;

/**
 * Chỉ số hay dùng của từng phòng — bấm một cái là điền sẵn tên/đơn vị/kỳ, leader chỉ
 * còn phải gõ con số mục tiêu. Vẫn tự gõ tên khác được.
 */
const KPI_PRESETS: Array<Omit<KpiDraft, 'id' | 'active'>> = [
  { teamId: 'Ads', name: 'Tin nhắn khách inbox', unit: 'tin', period: 'week', target: 0 },
  { teamId: 'Ads', name: 'Khách mới', unit: 'khách', period: 'month', target: 0 },
  { teamId: 'Ads', name: 'Lượt tiếp cận', unit: 'lượt', period: 'week', target: 0 },
  { teamId: 'Content', name: 'Bài đăng', unit: 'bài', period: 'week', target: 0 },
  { teamId: 'Content', name: 'Video / Reels', unit: 'video', period: 'month', target: 0 },
  { teamId: 'SEO', name: 'Từ khoá lên top 10', unit: 'từ khoá', period: 'month', target: 0 },
  { teamId: 'SEO', name: 'Bài chuẩn SEO', unit: 'bài', period: 'month', target: 0 },
];

/** Thanh tiến độ. Vượt mục tiêu vẫn hiện đầy nhưng đổi màu để thấy ngay là dư. */
function Bar100({ percent }: { percent: number }) {
  const w = Math.min(100, Math.max(0, percent));
  const color = percent >= 100 ? 'bg-emerald-500' : percent >= 60 ? 'bg-brand-500' : 'bg-amber-400';
  return (
    <div className="h-2 w-full overflow-hidden rounded-full bg-slate-100">
      <div className={`h-full rounded-full ${color}`} style={{ width: `${w}%` }} />
    </div>
  );
}

export default function Projects() {
  const { user } = useAuth();
  const toast = useToast();
  const canManage = user?.role === 'leader' || user?.role === 'director' || user?.role === 'admin';
  const isDirector = user?.role === 'director' || user?.role === 'admin';

  const [projects, setProjects] = useState<ProjectRow[]>([]);
  const [today, setToday] = useState<{ teamId: string; dates: { today: string; yesterday: string }; rows: TodayRow[] } | null>(null);
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
  const [draft, setDraft] = useState<Record<string, string>>({});

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
      setOpen({ project: p, kpis: r.kpis });
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

  /** Ghi số cho một (chỉ số, ngày). Server chặn nếu sai phòng hoặc quá hạn sửa. */
  async function saveEntry(kpiId: string, date: string, raw: string) {
    const value = Number(raw);
    if (!raw.trim() || !Number.isFinite(value) || value < 0) return toast.error('Nhập số không âm.');
    try {
      await api(`/projects/kpis/${kpiId}/entries`, { body: { date, value: Math.round(value) } });
      setDraft((d) => ({ ...d, [`${kpiId}|${date}`]: '' }));
      await Promise.all([loadToday(), loadProjects(), open ? openProject(open.project) : Promise.resolve()]);
      toast.success('Đã lưu số.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const overview = useMemo(
    () => projects.filter((p) => p.status === 'active' && p.kpiCount > 0).map((p) => ({ name: p.name, percent: p.percent })),
    [projects],
  );

  return (
    <div className="space-y-4">
      <div className="card flex flex-wrap items-center justify-between gap-3">
        <div>
          <h1 className="text-lg font-bold">Dự án &amp; KPI</h1>
          <p className="text-sm text-slate-500">
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
      {today && (
        <div className="card">
          <h2 className="mb-1 font-semibold">Chỉ số cần nhập {today.teamId && `— phòng ${today.teamId}`}</h2>
          {!today.teamId ? (
            <p className="text-sm text-slate-500">
              Bạn không thuộc phòng ban nào nên không có chỉ số để nhập. Vẫn xem được tiến độ các dự án bên dưới.
            </p>
          ) : today.rows.length === 0 ? (
            <p className="text-sm text-slate-500">Phòng bạn chưa có chỉ số nào trong các dự án đang chạy.</p>
          ) : (
            <>
              <p className="mb-3 text-xs text-slate-500">
                Số của hôm qua còn sửa được tới hết hôm nay. Sau đó phải nhờ giám đốc nhập bù.
              </p>
              <div className="space-y-2">
                {today.rows.map((r) => (
                  <div key={r.kpi.id} className="rounded-xl border border-slate-100 p-3">
                    <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
                      <span className="text-sm font-medium text-slate-800">
                        {r.kpi.name}
                        {r.kpi.unit && <span className="text-slate-400"> ({r.kpi.unit})</span>}
                      </span>
                      <span className="text-xs text-slate-400">{r.projectName}</span>
                    </div>
                    <div className="grid gap-2 sm:grid-cols-2">
                      {(['today', 'yesterday'] as const).map((which) => {
                        const date = today.dates[which];
                        const saved = r[which];
                        const key = `${r.kpi.id}|${date}`;
                        return (
                          <div key={which} className="flex items-center gap-2">
                            <span className="w-16 shrink-0 text-xs text-slate-500">
                              {which === 'today' ? 'Hôm nay' : 'Hôm qua'}
                            </span>
                            <input
                              className="input py-1 text-sm"
                              type="number"
                              min={0}
                              placeholder={saved === null ? 'chưa nhập' : String(saved)}
                              value={draft[key] ?? ''}
                              onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                              onKeyDown={(e) => e.key === 'Enter' && saveEntry(r.kpi.id, date, draft[key] ?? '')}
                            />
                            <AsyncButton
                              className="btn-ghost shrink-0 px-3 py-1 text-sm"
                              busyLabel="…"
                              onClick={() => saveEntry(r.kpi.id, date, draft[key] ?? '')}
                            >
                              Lưu
                            </AsyncButton>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            </>
          )}
        </div>
      )}

      {/* Biểu đồ toàn cảnh — chỉ có nghĩa khi nhìn nhiều dự án cùng lúc. */}
      {isDirector && overview.length > 0 && (
        <div className="card">
          <h2 className="mb-2 font-semibold">Tiến độ các dự án đang chạy (kỳ hiện tại)</h2>
          <div style={{ width: '100%', height: Math.max(160, overview.length * 44) }}>
            <ResponsiveContainer>
              <BarChart data={overview} layout="vertical" margin={{ left: 8, right: 24 }}>
                <XAxis type="number" domain={[0, 100]} tick={{ fontSize: 12 }} unit="%" />
                <YAxis type="category" dataKey="name" width={140} tick={{ fontSize: 12 }} />
                <Tooltip formatter={(v: number) => `${v}%`} />
                <Bar dataKey="percent" fill="#7367f0" radius={[0, 6, 6, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        </div>
      )}

      <div className="card">
        <h2 className="mb-2 font-semibold">Dự án ({projects.length})</h2>
        {loading ? (
          <SkeletonRows rows={3} />
        ) : projects.length === 0 ? (
          <EmptyState icon="📁" text="Chưa có dự án nào. Leader bấm “+ Dự án mới” để bắt đầu." />
        ) : (
          <div className="grid gap-2 sm:grid-cols-2">
            {projects.map((p) => (
              <button
                key={p.id}
                className="rounded-xl border border-slate-100 p-3 text-left hover:border-brand-200 hover:bg-slate-50"
                onClick={() => openProject(p)}
              >
                <div className="flex items-start justify-between gap-2">
                  <div className="min-w-0">
                    <div className="truncate font-medium text-slate-800">{p.name}</div>
                    {p.customerName && <div className="truncate text-xs text-slate-500">{p.customerName}</div>}
                  </div>
                  <Badge variant={STATUS[p.status]?.variant || 'neutral'}>
                    {STATUS[p.status]?.label || p.status}
                  </Badge>
                </div>
                <div className="mt-2 flex items-center gap-2">
                  <Bar100 percent={p.percent} />
                  <span className="w-12 shrink-0 text-right text-sm font-medium text-slate-700">{p.percent}%</span>
                </div>
                <div className="mt-1 text-xs text-slate-400">{p.kpiCount} chỉ số</div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Chi tiết dự án */}
      {open && (
        <div
          className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
          onClick={() => { setOpen(null); setKpiEdit(null); setChartKpi(null); }}
        >
          <div className="card my-8 w-full max-w-3xl" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-start justify-between gap-2">
              <div>
                <h2 className="font-semibold">{open.project.name}</h2>
                <div className="mt-1 text-xs text-slate-500">
                  {open.project.customerName || 'Dự án nội bộ'}
                  {open.project.startDate && ` · từ ${open.project.startDate}`}
                  {open.project.endDate && ` → ${open.project.endDate}`}
                </div>
              </div>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setOpen(null)}>
                ✕ Đóng
              </button>
            </div>

            {open.project.note && <p className="mt-2 text-sm text-slate-600">{open.project.note}</p>}

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
                <h3 className="mb-2 text-sm font-semibold text-slate-700">Phòng {team}</h3>
                <div className="space-y-2">
                  {open.kpis
                    .filter((k) => k.teamId === team)
                    .map((k) => (
                      <div key={k.id} className={`rounded-xl border p-3 ${k.active ? 'border-slate-100' : 'border-slate-100 bg-slate-50 opacity-70'}`}>
                        <div className="flex flex-wrap items-baseline justify-between gap-2">
                          <span className="text-sm font-medium text-slate-800">
                            {k.name}
                            {k.unit && <span className="text-slate-400"> ({k.unit})</span>}
                            {!k.active && <span className="ml-2 text-xs text-slate-400">đã tắt</span>}
                          </span>
                          <span className="text-xs text-slate-500">
                            {PERIODS.find((p) => p.value === k.period)?.label} ·{' '}
                            <b className="text-slate-700">
                              {k.progress.current}/{k.target || '—'}
                            </b>
                          </span>
                        </div>
                        <div className="mt-2 flex items-center gap-2">
                          <Bar100 percent={k.progress.percent} />
                          <span className="w-12 shrink-0 text-right text-sm font-medium text-slate-700">
                            {k.progress.percent}%
                          </span>
                        </div>
                        <div className="mt-2 flex flex-wrap gap-2 text-xs">
                          <button className="text-brand-600 underline" onClick={() => setChartKpi(chartKpi?.id === k.id ? null : k)}>
                            {chartKpi?.id === k.id ? 'Ẩn biểu đồ' : 'Xem biểu đồ'}
                          </button>
                          {canManage && (
                            <>
                              <button className="text-slate-500 underline" onClick={() => setKpiEdit({ ...blankKpi(k.teamId), ...k })}>
                                Sửa chỉ số
                              </button>
                              <button className="text-rose-600 underline" onClick={() => removeKpi(k)}>
                                Xoá
                              </button>
                            </>
                          )}
                        </div>

                        {chartKpi?.id === k.id && (
                          <div className="mt-3" style={{ width: '100%', height: 200 }}>
                            <ResponsiveContainer>
                              <LineChart data={k.series} margin={{ left: -20, right: 8 }}>
                                <XAxis dataKey="label" tick={{ fontSize: 11 }} />
                                <YAxis tick={{ fontSize: 11 }} />
                                <Tooltip />
                                <Line type="monotone" dataKey="value" stroke="#7367f0" strokeWidth={2} dot={{ r: 3 }} />
                              </LineChart>
                            </ResponsiveContainer>
                          </div>
                        )}

                        {/* Giám đốc nhập bù cho ngày đã khoá. */}
                        {isDirector && k.active && <BackfillRow kpiId={k.id} onSaved={() => openProject(open.project)} />}
                      </div>
                    ))}
                </div>
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
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={closeProjectForm}>
          <div className="card my-8 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
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
              <div className="mt-5 border-t border-slate-100 pt-4">
                <h3 className="font-semibold">Chỉ số KPI của dự án</h3>
                <p className="mb-3 text-xs text-slate-500">
                  Mỗi chỉ số gắn một phòng — chỉ người phòng đó nhập số. Bỏ trống cũng được, thêm sau
                  trong phần chi tiết dự án.
                </p>

                <div className="mb-3 flex flex-wrap gap-1.5">
                  {KPI_PRESETS.map((p) => (
                    <button
                      key={`${p.teamId}-${p.name}`}
                      type="button"
                      className="rounded-full border border-slate-200 px-3 py-1 text-xs text-slate-600 hover:border-brand-300 hover:bg-brand-50 hover:text-brand-700"
                      onClick={() => setKpiRows((rows) => [...rows, { ...p, id: '', active: true }])}
                    >
                      + {p.teamId}: {p.name}
                    </button>
                  ))}
                </div>

                {kpiRows.length > 0 && (
                  <div className="hidden gap-2 px-1 pb-1 text-xs text-slate-400 sm:grid sm:grid-cols-12">
                    <span className="sm:col-span-2">Phòng</span>
                    <span className="sm:col-span-4">Tên chỉ số</span>
                    <span className="sm:col-span-2">Đơn vị</span>
                    <span className="sm:col-span-2">Tính theo</span>
                    <span className="sm:col-span-2">Mục tiêu</span>
                  </div>
                )}

                <div className="space-y-2">
                  {kpiRows.map((k, i) => {
                    const set = (patch: Partial<KpiDraft>) =>
                      setKpiRows((rows) => rows.map((r, j) => (j === i ? { ...r, ...patch } : r)));
                    return (
                      <div key={i} className="grid gap-2 rounded-xl border border-slate-100 p-2 sm:grid-cols-12 sm:items-center sm:border-0 sm:p-0">
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
                        <select className="input py-1.5 text-sm sm:col-span-2" value={k.period} onChange={(e) => set({ period: e.target.value as Period })}>
                          {PERIODS.map((p) => (
                            <option key={p.value} value={p.value}>{p.label}</option>
                          ))}
                        </select>
                        <div className="flex items-center gap-1 sm:col-span-2">
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
                            className="shrink-0 rounded-lg px-2 py-1 text-slate-400 hover:bg-rose-50 hover:text-rose-600"
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
        <div className="fixed inset-0 z-[60] flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4" onClick={() => setKpiEdit(null)}>
          <div className="card my-8 w-full max-w-xl" onClick={(e) => e.stopPropagation()}>
            <h2 className="mb-1 font-semibold">{kpiEdit.id ? 'Sửa chỉ số' : 'Chỉ số mới'}</h2>
            <p className="mb-3 text-xs text-slate-500">
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
                  {PERIODS.map((p) => (
                    <option key={p.value} value={p.value}>{p.label}</option>
                  ))}
                </select>
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
    <div className="mt-3 flex flex-wrap items-center gap-2 rounded-lg bg-slate-50 p-2">
      <span className="text-xs text-slate-500">Nhập bù</span>
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
