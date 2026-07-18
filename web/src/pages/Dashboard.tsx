import { useEffect, useState } from 'react';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer } from 'recharts';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { vnd, fmtMin } from '../lib/format';
import { Skeleton, SkeletonRows } from '../components/ui';
import type { MemberScore } from '../lib/types';

export default function Dashboard() {
  const { user } = useAuth();
  const isDirector = user?.role === 'director' || user?.role === 'admin';
  const [scores, setScores] = useState<MemberScore[]>([]);
  const [loading, setLoading] = useState(true);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const scoreUrl = isDirector ? '/scores/all' : '/scores/team';
    setLoading(true);
    api<{ members: MemberScore[] }>(scoreUrl)
      .then((r) => setScores(r.members))
      .catch((e) => setMsg((e as Error).message))
      .finally(() => setLoading(false));
  }, [isDirector]);

  const chartData = scores.map((s) => ({ name: s.fullName.split(' ').slice(-1)[0], points: s.monthPoints }));

  return (
    <div className="space-y-4">
      <h1 className="text-lg font-bold">{isDirector ? 'Tổng quan toàn công ty' : 'Tổng quan team'}</h1>
      {msg && <div className="text-sm text-rose-600">{msg}</div>}

      <div className="card">
        <h2 className="font-semibold mb-2">Điểm tháng này</h2>
        {loading ? (
          <Skeleton className="h-[260px] w-full" />
        ) : (
          <div style={{ width: '100%', height: 260 }}>
            <ResponsiveContainer>
              <BarChart data={chartData}>
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="points" fill="#7367f0" radius={[6, 6, 0, 0]} />
              </BarChart>
            </ResponsiveContainer>
          </div>
        )}
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Bảng xếp hạng</h2>
        {loading ? (
          <SkeletonRows rows={5} />
        ) : (
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">#</th>
              <th>Họ tên</th>
              <th>Team</th>
              <th>Điểm</th>
              <th>Thưởng</th>
              <th>⏱ Hôm nay</th>
            </tr>
          </thead>
          <tbody>
            {scores.map((s) => (
              <tr key={s.memberId} className="border-t">
                <td className="py-1">{s.rank}</td>
                <td>{s.fullName}</td>
                <td>{s.teamId}</td>
                <td className="font-medium">{s.monthPoints}</td>
                <td className="text-emerald-600">{vnd(s.bonus)}</td>
                <td>{fmtMin(s.workMinutesToday)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        )}
      </div>
    </div>
  );
}
