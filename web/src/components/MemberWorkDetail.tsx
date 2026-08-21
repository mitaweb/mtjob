import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { useToast } from './Toaster';
import { Badge, SkeletonRows } from './ui';
import { vnd } from '../lib/format';
import AsyncButton from './AsyncButton';
import WorkDayList, { type DayBlock, type DetailTask } from './WorkDayList';

// Chi tiết công việc THEO NGÀY của một thành viên — giám đốc/leader bấm vào tên
// trong bảng xếp hạng là xem được họ làm gì mỗi ngày.

interface Detail {
  member: { id: string; fullName: string; teamId: string };
  year: number;
  month: number;
  score: { monthPoints: number; bonus: number; rank: number };
  days: DayBlock[];
}

interface Adjustment {
  id: string;
  date: string;
  points: number;
  note: string;
}

const currentYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

/** Hôm nay theo giờ máy — KHÔNG dùng toISOString() vì nó ra ngày UTC, lệch mất một ngày
 *  trong khoảng nửa đêm tới 7h sáng giờ VN. */
const todayYmd = () => {
  const d = new Date();
  return `${currentYm()}-${String(d.getDate()).padStart(2, '0')}`;
};

export default function MemberWorkDetail({
  memberId,
  fullName,
  onClose,
  initialYm,
  onChanged,
}: {
  memberId: string;
  fullName: string;
  onClose: () => void;
  /** Tháng mở sẵn ('2026-07'). Bảng xếp hạng đang xem tháng nào thì mở đúng tháng đó. */
  initialYm?: string;
  /** Gọi khi điểm của người này vừa đổi, để bảng xếp hạng phía sau tải lại. */
  onChanged?: () => void;
}) {
  const { user } = useAuth();
  const toast = useToast();
  const canAdjust = user?.role === 'director' || user?.role === 'admin';

  const [ym, setYm] = useState(initialYm || currentYm());
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  // Bù điểm cho ngày nhân sự quên ghi việc.
  const [adjustOpen, setAdjustOpen] = useState(false);
  const [adjustments, setAdjustments] = useState<Adjustment[]>([]);
  const [form, setForm] = useState({ date: todayYmd(), points: '', reason: '' });

  async function loadDetail() {
    const [y, m] = ym.split('-');
    setData(await api<Detail>(`/scores/member/${memberId}/detail?year=${y}&month=${Number(m)}`));
  }

  async function loadAdjustments() {
    if (!canAdjust) return;
    const r = await api<{ adjustments: Adjustment[] }>(`/scores/adjustments?memberId=${memberId}&month=${ym}`);
    setAdjustments(r.adjustments);
  }

  useEffect(() => {
    setLoading(true);
    Promise.all([loadDetail(), loadAdjustments()])
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, ym]);

  /**
   * Xoá hẳn một dòng việc — dùng dọn dòng ghi trùng (cùng giờ, cùng tên).
   *
   * Hỏi lại kèm ĐÚNG tên việc và số điểm sẽ mất: nút "−" nằm sát nhau trong danh sách
   * dài, bấm nhầm là xoá mất việc thật của người ta.
   */
  async function xoaViec(t: DetailTask) {
    const mat = `${t.title} (${t.points >= 0 ? '+' : ''}${t.points}đ)`;
    if (!window.confirm(`Xoá việc này khỏi bảng điểm?\n\n${mat}\n\nĐiểm sẽ bị trừ lại và không khôi phục được.`)) {
      return;
    }
    try {
      await api(`/tasks/${t.id}/force`, { method: 'DELETE' });
      toast.success(`Đã xoá "${t.title}".`);
      await Promise.all([loadDetail(), loadAdjustments()]);
      onChanged?.();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveAdjust() {
    const points = Number(form.points);
    if (!form.points.trim() || !Number.isFinite(points)) return toast.error('Nhập số điểm.');
    if (!form.reason.trim()) return toast.error('Ghi rõ lý do bù điểm.');
    try {
      await api('/scores/adjust', {
        body: { memberId, date: form.date, points: Math.trunc(points), reason: form.reason.trim() },
      });
      // Nhảy sang tháng của ngày vừa bù, nếu không anh bù xong mà màn hình không đổi gì.
      const ymOfDate = form.date.slice(0, 7);
      setForm({ date: form.date, points: '', reason: '' });
      toast.success(`Đã ghi ${points > 0 ? '+' : ''}${Math.trunc(points)}đ cho ngày ${form.date}.`);
      if (ymOfDate !== ym) setYm(ymOfDate);
      else await Promise.all([loadDetail(), loadAdjustments()]);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function removeAdjust(a: Adjustment) {
    if (!window.confirm(`Gỡ dòng bù ${a.points > 0 ? '+' : ''}${a.points}đ ngày ${a.date}?`)) return;
    try {
      await api(`/scores/adjust/${a.id}`, { method: 'DELETE' });
      await Promise.all([loadDetail(), loadAdjustments()]);
      toast.success('Đã gỡ dòng bù điểm.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const totalTasks = data?.days.reduce((s, d) => s + d.tasks.length, 0) ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4"
      onClick={onClose}
    >
      <div className="card hien-len my-8 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{data?.member.fullName || fullName}</h2>
            {data && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-ink-muted">
                {data.member.teamId && <Badge variant="neutral">{data.member.teamId}</Badge>}
                <span>
                  Tháng {data.month}/{data.year}: <b className="text-ink-soft">{data.score.monthPoints}đ</b>
                </span>
                {data.score.rank > 0 && <span>Hạng #{data.score.rank}</span>}
                {data.score.bonus > 0 && <span className="text-emerald-700">Thưởng {vnd(data.score.bonus)}</span>}
                <span>· {totalTasks} việc</span>
              </div>
            )}
          </div>
          <button className="btn-ghost px-2 py-1 text-sm" onClick={onClose}>
            ✕ Đóng
          </button>
        </div>

        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="label mb-0 text-xs" htmlFor="detail-month">
            Xem tháng
          </label>
          <input
            id="detail-month"
            type="month"
            className="input max-w-[10rem] py-1"
            value={ym}
            onChange={(e) => setYm(e.target.value)}
          />
          {canAdjust && (
            <button className="btn-ghost ml-auto px-3 py-1 text-sm" onClick={() => setAdjustOpen((v) => !v)}>
              {adjustOpen ? 'Đóng bù điểm' : '± Bù điểm'}
            </button>
          )}
        </div>

        {/* Bù điểm cho ngày nhân sự quên ghi việc — hoặc trừ lại nếu ghi dư. */}
        {canAdjust && adjustOpen && (
          <div className="mt-3 rounded-xl border border-brand-100 bg-brand-50/40 p-3">
            <p className="mb-2 text-xs text-ink-muted">
              Cộng thêm khi bạn ấy quên ghi việc, hoặc để số âm để trừ lại nếu ghi dư. Dòng bù hiện
              trong bảng dưới đây như một việc thường, ghi rõ lý do và tên người nhập.
            </p>
            <div className="grid gap-2 sm:grid-cols-12">
              <input
                className="input py-1.5 text-sm sm:col-span-3"
                type="date"
                max={todayYmd()}
                value={form.date}
                onChange={(e) => setForm({ ...form, date: e.target.value })}
              />
              <input
                className="input py-1.5 text-sm sm:col-span-2"
                type="number"
                placeholder="điểm"
                value={form.points}
                onChange={(e) => setForm({ ...form, points: e.target.value })}
              />
              <input
                className="input py-1.5 text-sm sm:col-span-5"
                placeholder="lý do, vd: nhập bổ sung"
                value={form.reason}
                onChange={(e) => setForm({ ...form, reason: e.target.value })}
              />
              <AsyncButton className="btn-primary py-1.5 text-sm sm:col-span-2" busyLabel="…" onClick={saveAdjust}>
                Ghi
              </AsyncButton>
            </div>

            {adjustments.length > 0 && (
              <div className="mt-3 space-y-1 border-t border-brand-100 pt-2">
                <div className="text-xs font-medium text-ink-muted">Đã bù trong tháng {ym.slice(5)}</div>
                {adjustments.map((a) => (
                  <div key={a.id} className="flex flex-wrap items-baseline gap-2 text-xs">
                    <span className="text-ink-muted">{a.date}</span>
                    <b className={a.points >= 0 ? 'text-emerald-700' : 'text-rose-600'}>
                      {a.points > 0 ? '+' : ''}
                      {a.points}đ
                    </b>
                    <span className="min-w-0 flex-1 truncate text-ink-soft">{a.note}</span>
                    <button className="text-rose-600 underline" onClick={() => removeAdjust(a)}>
                      Gỡ
                    </button>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}

        {loading && <div className="mt-3"><SkeletonRows rows={4} /></div>}

        {!loading && data && (
          <WorkDayList
            days={data.days}
            emptyText="Tháng này chưa ghi nhận việc nào."
            onDelete={canAdjust ? xoaViec : undefined}
          />
        )}
      </div>
    </div>
  );
}
