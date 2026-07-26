import { useEffect, useState } from 'react';
import { api, cachedGet } from '../lib/api';
import { vnd, fmtMin } from '../lib/format';
import { Skeleton, SkeletonRows } from '../components/ui';
import WorkDayList, { type DayBlock } from '../components/WorkDayList';
import type { MemberScore } from '../lib/types';

// Trang Điểm của nhân viên. Việc được phân THEO NGÀY kèm khung giờ làm — nhìn thấy
// đúng thứ giám đốc nhìn thấy, để ai cũng tự đối chiếu được điểm với giờ làm.

interface Detail {
  year: number;
  month: number;
  score: { monthPoints: number; bonus: number; rank: number };
  days: DayBlock[];
}

const currentYm = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

export default function Scores() {
  const [score, setScore] = useState<MemberScore | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [ym, setYm] = useState(currentYm());
  const [sheetUrl, setSheetUrl] = useState('');
  const [loading, setLoading] = useState(true);
  const [loadingDays, setLoadingDays] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<MemberScore>('/scores/me')
      .then(setScore)
      .catch((e) => setMsg((e as Error).message))
      .finally(() => setLoading(false));
    cachedGet<{ sheetUrl?: string }>('/tasks/catalog')
      .then((r) => setSheetUrl(r.sheetUrl || ''))
      .catch(() => {});
  }, []);

  useEffect(() => {
    const [y, m] = ym.split('-');
    setLoadingDays(true);
    api<Detail>(`/scores/me/detail?year=${y}&month=${Number(m)}`)
      .then(setDetail)
      .catch((e) => setMsg((e as Error).message))
      .finally(() => setLoadingDays(false));
  }, [ym]);

  const totalTasks = detail?.days.reduce((s, d) => s + d.tasks.length, 0) ?? 0;

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        {loading ? (
          <>
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
            <Skeleton className="h-20" />
          </>
        ) : (
          <>
            <div className="card text-center">
              <div className="text-2xl font-bold">{score?.todayPoints ?? 0}</div>
              <div className="text-xs text-slate-500">Điểm hôm nay</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold">{score?.monthPoints ?? 0}</div>
              <div className="text-xs text-slate-500">Lũy kế tháng</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-emerald-600">{vnd(score?.bonus ?? 0)}</div>
              <div className="text-xs text-slate-500">Thưởng hiện tại</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-brand-600">{fmtMin(score?.workMinutesToday ?? 0)}</div>
              <div className="text-xs text-slate-500">⏱ Giờ làm hôm nay</div>
            </div>
          </>
        )}
      </div>

      {msg && <div className="text-sm text-slate-600">{msg}</div>}

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Việc theo ngày ({totalTasks})</h2>
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-brand-600 underline whitespace-nowrap"
            >
              📄 Bảng điểm gốc ↗
            </a>
          )}
        </div>

        <div className="flex items-center gap-2">
          <label className="label mb-0 text-xs" htmlFor="my-month">
            Xem tháng
          </label>
          <input
            id="my-month"
            type="month"
            className="input max-w-[10rem] py-1"
            value={ym}
            onChange={(e) => setYm(e.target.value)}
          />
        </div>

        {loadingDays ? (
          <div className="mt-3">
            <SkeletonRows rows={4} />
          </div>
        ) : (
          <WorkDayList
            days={detail?.days ?? []}
            emptyText="Tháng này chưa ghi nhận việc nào — qua tab Trợ lý gõ tên việc + tên khách để bắt đầu nhé."
          />
        )}
      </div>
    </div>
  );
}
