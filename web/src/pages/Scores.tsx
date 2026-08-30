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

/** Một dòng thưởng KPI của một dự án. */
interface KpiBonusLine {
  projectId: string;
  projectName: string;
  vaiTro: 'leader' | 'member';
  /** null = tháng đó chưa đo được (dự án chưa chạy, chưa có kỳ nào chốt…). */
  tyLe: number | null;
  amount: number;
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
  const [kpiBonus, setKpiBonus] = useState<KpiBonusLine[]>([]);

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
    // Thưởng KPI đi theo tháng đang xem. Lỗi thì để trống — không chặn cả trang Điểm
    // chỉ vì phần thưởng dự án chưa cấu hình xong.
    api<{ lines: KpiBonusLine[] }>(`/projects/bonus/me?year=${y}&month=${Number(m)}`)
      .then((r) => setKpiBonus(r.lines))
      .catch(() => setKpiBonus([]));
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
              <div className="text-xs text-ink-muted">Điểm hôm nay</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold">{score?.monthPoints ?? 0}</div>
              <div className="text-xs text-ink-muted">Lũy kế tháng</div>
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-emerald-700">{vnd(score?.bonus ?? 0)}</div>
              <div className="text-xs text-ink-muted">Thưởng điểm</div>
              {/* Cắt nửa mà không nói vì sao thì người ta tưởng hệ thống tính sai. */}
              {(score?.heSoKpi ?? 1) < 1 && (
                <div className="mt-1 text-xs text-amber-700">
                  Đã cắt một nửa (từ {vnd(score?.bonusGoc ?? 0)}) vì có dự án đạt dưới 50%
                </div>
              )}
            </div>
            <div className="card text-center">
              <div className="text-2xl font-bold text-brand-600">{fmtMin(score?.workMinutesToday ?? 0)}</div>
              <div className="text-xs text-ink-muted">⏱ Giờ làm hôm nay</div>
            </div>
          </>
        )}
      </div>

      {msg && <div className="text-sm text-ink-soft">{msg}</div>}

      {/* Thưởng KPI dự án — tách riêng khỏi thưởng điểm, tính theo kết quả dự án. */}
      {kpiBonus.length > 0 && (
        <div className="card">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">🎯 Thưởng KPI dự án</h2>
            <span className="text-lg font-bold text-emerald-700">
              {vnd(kpiBonus.reduce((s, l) => s + l.amount, 0))}
            </span>
          </div>
          <ul className="divide-y">
            {kpiBonus.map((l) => (
              <li key={`${l.projectId}-${l.vaiTro}`} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0">
                  <span className="font-medium">{l.projectName}</span>
                  {l.vaiTro === 'leader' && <span className="ml-1 text-xs text-brand-600">(leader)</span>}
                  <span className="block text-xs text-ink-muted">
                    {l.tyLe === null ? 'Tháng này chưa đo được' : `Đạt ${l.tyLe}% KPI`}
                  </span>
                </span>
                <span className={`shrink-0 font-medium ${l.amount > 0 ? 'text-emerald-700' : 'text-ink-faint'}`}>
                  {vnd(l.amount)}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

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
