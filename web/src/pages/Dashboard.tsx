import { lazy, Suspense, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { vnd, fmtMin, currentYm } from '../lib/format';
import { Skeleton, SkeletonRows } from '../components/ui';
import MemberWorkDetail from '../components/MemberWorkDetail';
import type { MemberScore } from '../lib/types';

// Thư viện biểu đồ nặng 360KB — tải riêng để bảng xếp hạng hiện ra trước, khỏi bắt chờ.
const PointsBarChart = lazy(() => import('../components/charts/PointsBarChart'));

const thangNay = () => {
  const { year, month } = currentYm();
  return `${year}-${String(month).padStart(2, '0')}`;
};

export default function Dashboard() {
  const { user } = useAuth();
  const isDirector = user?.role === 'director' || user?.role === 'admin';
  const [scores, setScores] = useState<MemberScore[]>([]);
  const [ym, setYm] = useState(thangNay());
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');
  const [detail, setDetail] = useState<{ id: string; name: string } | null>(null);
  // Tăng lên để tải lại bảng xếp hạng — điểm đổi trong hộp thoại chi tiết thì thứ hạng
  // phía sau phải đổi theo, không thì anh đóng ra vẫn thấy số cũ.
  const [refresh, setRefresh] = useState(0);

  // Cột "⏱ Hôm nay" là số phút làm việc CỦA HÔM NAY, không dính gì tới tháng đang xem.
  // Để nó nằm trong bảng tháng 6 thì đọc thành "tháng 6 làm 6g11p" — sai hẳn.
  const laThangNay = ym === thangNay();

  useEffect(() => {
    const [y, m] = ym.split('-');
    const scoreUrl = isDirector ? '/scores/all' : '/scores/team';
    setLoading(true);
    setMsg('');
    api<{ members: MemberScore[] }>(`${scoreUrl}?year=${y}&month=${Number(m)}`)
      .then((r) => setScores(r.members))
      .catch((e) => setMsg((e as Error).message))
      .finally(() => setLoading(false));
  }, [isDirector, ym, refresh]);

  const chartData = scores.map((s) => ({ name: s.fullName.split(' ').slice(-1)[0], points: s.monthPoints }));
  const nhanThang = laThangNay ? 'tháng này' : `tháng ${Number(ym.slice(5))}/${ym.slice(0, 4)}`;

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-lg font-bold">{isDirector ? 'Tổng quan toàn công ty' : 'Tổng quan team'}</h1>
        <div className="flex items-center gap-2">
          <label className="label mb-0 text-xs" htmlFor="dash-month">
            Xem tháng
          </label>
          <input
            id="dash-month"
            type="month"
            className="input max-w-[10rem] py-1"
            value={ym}
            onChange={(e) => e.target.value && setYm(e.target.value)}
          />
        </div>
      </div>
      {msg && <div className="text-sm text-rose-600">{msg}</div>}

      <div className="card">
        <h2 className="mb-2 font-semibold">Điểm {nhanThang}</h2>
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : scores.every((s) => s.monthPoints === 0) ? (
          <p className="py-12 text-center text-sm text-ink-muted">Chưa ai có điểm trong {nhanThang}.</p>
        ) : (
          <Suspense fallback={<Skeleton className="h-[260px] w-full" />}>
            <PointsBarChart data={chartData} />
          </Suspense>
        )}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold">Bảng xếp hạng {nhanThang}</h2>
        <p className="mb-2 text-xs text-ink-muted">Bấm vào tên để xem chi tiết công việc từng ngày.</p>
        {loading ? (
          <SkeletonRows rows={5} />
        ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-ink-muted">
            <tr>
              <th className="py-1">#</th>
              <th>Họ tên</th>
              <th>Team</th>
              <th>Điểm</th>
              <th>Thưởng</th>
              {laThangNay && <th>⏱ Hôm nay</th>}
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr
                key={s.memberId}
                className="cursor-pointer border-t hover:bg-brand-50"
                onClick={() => setDetail({ id: s.memberId, name: s.fullName })}
              >
                <td className="py-1">{s.rank}</td>
                <td className="font-medium text-brand-700 underline">{s.fullName}</td>
                <td>{s.teamId}</td>
                <td className="font-medium">{s.monthPoints}</td>
                <td className="text-emerald-700">{vnd(s.bonus)}</td>
                {laThangNay && <td>{fmtMin(s.workMinutesToday)}</td>}
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>

      {detail && (
        <MemberWorkDetail
          memberId={detail.id}
          fullName={detail.name}
          initialYm={ym}
          onClose={() => setDetail(null)}
          onChanged={() => setRefresh((n) => n + 1)}
        />
      )}
    </div>
  );
}
