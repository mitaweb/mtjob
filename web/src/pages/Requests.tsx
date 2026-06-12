import { useEffect, useState } from 'react';
import { api } from '../lib/api';

interface Req {
  kind: string;
  id: string;
  dates: string[];
  scope?: string;
  type?: string;
  reason: string;
  leaderStatus: string;
  directorStatus: string;
  finalStatus: string;
}

const statusVi: Record<string, string> = {
  pending: 'Chờ duyệt',
  approved: 'Đã duyệt',
  rejected: 'Từ chối',
};

// Tiến trình duyệt: Đỏ (chờ leader) → Vàng (leader đã duyệt, chờ giám đốc) → Xanh (duyệt xong).
function stageOf(r: Req): { label: string; badge: string; border: string } {
  if (r.finalStatus === 'rejected')
    return { label: '❌ Từ chối', badge: 'bg-slate-200 text-slate-600', border: 'border-slate-300' };
  if (r.finalStatus === 'approved')
    return { label: '✅ Đã duyệt', badge: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-400' };
  if (r.leaderStatus === 'approved')
    return { label: '🟡 Chờ giám đốc', badge: 'bg-amber-100 text-amber-700', border: 'border-amber-400' };
  return { label: '🔴 Chờ leader', badge: 'bg-red-100 text-red-700', border: 'border-red-400' };
}

export default function Requests() {
  const [tab, setTab] = useState<'online' | 'leave'>('online');
  const [date, setDate] = useState('');
  const [scope, setScope] = useState('full');
  const [leaveType, setLeaveType] = useState('Nghỉ phép năm');
  const [reason, setReason] = useState('');
  const [list, setList] = useState<Req[]>([]);
  const [msg, setMsg] = useState('');

  async function load() {
    const r = await api<{ requests: Req[] }>('/requests/me');
    setList(r.requests);
  }
  useEffect(() => {
    load().catch((e) => setMsg((e as Error).message));
  }, []);

  async function submit() {
    if (!date) {
      setMsg('Chọn ngày trước nhé.');
      return;
    }
    try {
      if (tab === 'online') {
        await api('/requests/online', { body: { dates: [date], scope, reason } });
      } else {
        await api('/requests/leave', { body: { dates: [date], type: leaveType, reason } });
      }
      setMsg('Đã gửi đơn, chờ leader/giám đốc duyệt ✅');
      setReason('');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card">
        <div className="flex gap-2 mb-3">
          <button className={tab === 'online' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('online')}>
            Làm online
          </button>
          <button className={tab === 'leave' ? 'btn-primary' : 'btn-ghost'} onClick={() => setTab('leave')}>
            Nghỉ phép
          </button>
        </div>

        <div className="grid sm:grid-cols-2 gap-3">
          <div>
            <label className="label">Ngày</label>
            <input type="date" className="input" value={date} onChange={(e) => setDate(e.target.value)} />
          </div>
          {tab === 'online' ? (
            <div>
              <label className="label">Buổi</label>
              <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="full">Cả ngày</option>
                <option value="half_am">Nửa ngày (sáng)</option>
                <option value="half_pm">Nửa ngày (chiều)</option>
              </select>
            </div>
          ) : (
            <div>
              <label className="label">Loại nghỉ</label>
              <input className="input" value={leaveType} onChange={(e) => setLeaveType(e.target.value)} />
            </div>
          )}
        </div>
        <div className="mt-3">
          <label className="label">Lý do</label>
          <input className="input" value={reason} onChange={(e) => setReason(e.target.value)} />
        </div>
        <button className="btn-primary mt-3" onClick={submit}>
          Gửi đơn
        </button>
        {msg && <div className="mt-2 text-sm text-slate-600">{msg}</div>}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Đơn của tôi</h2>
        <ul className="divide-y">
          {list.map((r) => {
            const stage = stageOf(r);
            return (
              <li key={r.id} className={`py-2 pl-3 text-sm border-l-4 ${stage.border}`}>
                <div className="flex justify-between">
                  <span className="font-medium">
                    {r.kind === 'online' ? 'Làm online' : 'Nghỉ phép'} · {r.dates.join(', ')}
                  </span>
                  <span className={`rounded-full px-2 py-0.5 text-xs ${stage.badge}`}>{stage.label}</span>
                </div>
                <div className="text-xs text-slate-500">
                  Leader: {statusVi[r.leaderStatus]} · Giám đốc: {statusVi[r.directorStatus]}
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
              </li>
            );
          })}
          {list.length === 0 && <li className="py-2 text-sm text-slate-500">Chưa có đơn nào.</li>}
        </ul>
      </div>
    </div>
  );
}

