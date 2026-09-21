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

/** Dòng thưởng leader của chính mình (luật 21/9/2026: mỗi leader một dòng mỗi tháng). */
interface KpiBonusLine {
  teamId: string;
  /** % số chỉ số của phòng đạt 100%; null = chưa đo được chỉ số nào. */
  tyLe: number | null;
  soDat: number;
  soChiSo: number;
  mucThuong: number;
  amount: number;
  truot?: string[];
}

/** Hệ số thưởng điểm của thành viên + từng dự án đạt/trượt. */
interface HeSoDiem {
  heSo: number;
  lyDo: string;
  duAn: Array<{ projectId: string; projectName: string; dat: boolean | null; soDat: number; soChiSo: number }>;
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
  const [heSo, setHeSo] = useState<HeSoDiem | null>(null);

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
    api<{ lines: KpiBonusLine[]; heSo: HeSoDiem | null }>(`/projects/bonus/me?year=${y}&month=${Number(m)}`)
      .then((r) => {
        setKpiBonus(r.lines);
        setHeSo(r.heSo);
      })
      .catch(() => {
        setKpiBonus([]);
        setHeSo(null);
      });
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
                  Còn một nửa (từ {vnd(score?.bonusGoc ?? 0)}) vì {score?.lyDoHeSo || 'chưa đủ số dự án đạt KPI'}
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

      {/* Leader: thưởng KPI tháng — trọn mức hoặc 0, theo số chỉ số của phòng đạt 100%. */}
      {kpiBonus.map((l) => (
        <div key={l.teamId} className="card">
          <div className="mb-1 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">🎯 Thưởng leader team {l.teamId}</h2>
            <span className={`text-lg font-bold ${l.amount > 0 ? 'text-emerald-700' : 'text-ink-faint'}`}>
              {vnd(l.amount)}
            </span>
          </div>
          <p className="text-sm text-ink-soft">
            {l.tyLe === null
              ? 'Tháng này chưa đo được chỉ số nào.'
              : `${l.soDat}/${l.soChiSo} chỉ số của phòng đạt 100% (${Math.round(l.tyLe)}%).`}
            {l.amount === 0 && l.mucThuong > 0 && ` Đủ tỉ lệ sẽ nhận ${vnd(l.mucThuong)}.`}
          </p>
          {(l.truot?.length ?? 0) > 0 && (
            <ul className="mt-2 space-y-0.5 text-xs text-ink-muted">
              {l.truot!.map((t) => (
                <li key={t}>• Chưa đạt: {t}</li>
              ))}
            </ul>
          )}
        </div>
      ))}

      {/* Thành viên: dự án nào đạt, dự án nào trượt — thứ quyết định thưởng điểm ×1 hay ×0,5. */}
      {heSo && heSo.duAn.length > 0 && (
        <div className="card">
          <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
            <h2 className="font-semibold">🎯 Dự án của tôi</h2>
            <span className={`text-sm font-semibold ${heSo.heSo < 1 ? 'text-amber-700' : 'text-emerald-700'}`}>
              {heSo.lyDo || 'Chưa đo được'} → thưởng điểm ×{String(heSo.heSo).replace('.', ',')}
            </span>
          </div>
          <ul className="divide-y">
            {heSo.duAn.map((d) => (
              <li key={d.projectId} className="flex items-center justify-between gap-2 py-2 text-sm">
                <span className="min-w-0 font-medium">{d.projectName}</span>
                <span
                  className={`shrink-0 text-xs font-medium ${
                    d.dat === null ? 'text-ink-faint' : d.dat ? 'text-emerald-700' : 'text-amber-700'
                  }`}
                >
                  {d.dat === null
                    ? 'Chưa đo được'
                    : `${d.dat ? '✓ Đạt' : '✗ Chưa đạt'} · ${d.soDat}/${d.soChiSo} chỉ số`}
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
