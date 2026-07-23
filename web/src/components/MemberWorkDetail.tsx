import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toaster';
import { Badge, EmptyState, SkeletonRows } from './ui';
import { vnd, fmtMin } from '../lib/format';

// Chi tiết công việc THEO NGÀY của một thành viên — giám đốc/leader bấm vào tên
// trong bảng xếp hạng là xem được họ làm gì mỗi ngày.

interface DetailTask {
  id: string;
  title: string;
  points: number;
  completedAt: string;
}

interface DayBlock {
  date: string;
  points: number;
  minutes: number;
  tasks: DetailTask[];
}

interface Detail {
  member: { id: string; fullName: string; teamId: string };
  year: number;
  month: number;
  score: { monthPoints: number; bonus: number; rank: number };
  days: DayBlock[];
}

const currentYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
  return `${weekday}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};

export default function MemberWorkDetail({
  memberId,
  fullName,
  onClose,
}: {
  memberId: string;
  fullName: string;
  onClose: () => void;
}) {
  const toast = useToast();
  const [ym, setYm] = useState(currentYm());
  const [data, setData] = useState<Detail | null>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const [y, m] = ym.split('-');
    setLoading(true);
    api<Detail>(`/scores/member/${memberId}/detail?year=${y}&month=${Number(m)}`)
      .then(setData)
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [memberId, ym]);

  const totalTasks = data?.days.reduce((s, d) => s + d.tasks.length, 0) ?? 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-slate-900/40 p-4"
      onClick={onClose}
    >
      <div className="card my-8 w-full max-w-2xl" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-start justify-between gap-2">
          <div>
            <h2 className="font-semibold">{data?.member.fullName || fullName}</h2>
            {data && (
              <div className="mt-1 flex flex-wrap items-center gap-2 text-xs text-slate-500">
                {data.member.teamId && <Badge variant="neutral">{data.member.teamId}</Badge>}
                <span>
                  Tháng {data.month}/{data.year}: <b className="text-slate-700">{data.score.monthPoints}đ</b>
                </span>
                {data.score.rank > 0 && <span>Hạng #{data.score.rank}</span>}
                {data.score.bonus > 0 && <span className="text-emerald-600">Thưởng {vnd(data.score.bonus)}</span>}
                <span>· {totalTasks} việc</span>
              </div>
            )}
          </div>
          <button className="btn-ghost px-2 py-1 text-sm" onClick={onClose}>
            ✕ Đóng
          </button>
        </div>

        <div className="mt-3 flex items-center gap-2">
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
        </div>

        {loading && <div className="mt-3"><SkeletonRows rows={4} /></div>}

        {!loading && data && data.days.length === 0 && (
          <EmptyState icon="📭" text="Tháng này chưa ghi nhận việc nào." />
        )}

        {!loading &&
          data?.days.map((d) => (
            <div key={d.date} className="mt-3 rounded-xl border border-slate-100 p-3">
              <div className="flex items-center justify-between gap-2 text-sm">
                <span className="font-medium text-slate-800">📅 {fmtDay(d.date)}</span>
                <span className="text-xs text-slate-500">
                  {d.tasks.length} việc · <b className="text-brand-600">+{d.points}đ</b>
                  {d.minutes > 0 && ` · ⏱ ${fmtMin(d.minutes)}`}
                </span>
              </div>
              <ul className="mt-1.5 space-y-1">
                {d.tasks.map((t) => (
                  <li key={t.id} className="flex items-start justify-between gap-2 text-sm">
                    <span className="text-slate-700">• {t.title}</span>
                    <span className="whitespace-nowrap text-xs text-slate-400">+{t.points}đ</span>
                  </li>
                ))}
              </ul>
            </div>
          ))}
      </div>
    </div>
  );
}
