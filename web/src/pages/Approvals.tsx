import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from '../components/AsyncButton';

interface Req {
  kind: 'online' | 'leave';
  id: string;
  name: string;
  dates: string[];
  scope?: string;
  type?: string;
  reason: string;
}

export default function Approvals() {
  const [list, setList] = useState<Req[]>([]);
  const [msg, setMsg] = useState('');

  async function load() {
    const r = await api<{ requests: Req[] }>('/requests/pending');
    setList(r.requests);
  }
  useEffect(() => {
    load().catch((e) => setMsg((e as Error).message));
  }, []);

  async function decide(r: Req, decision: 'approve' | 'reject') {
    try {
      await api(`/requests/${r.kind}/${r.id}/decide`, { body: { decision } });
      setMsg(decision === 'approve' ? 'Đã duyệt ✅' : 'Đã từ chối');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Đơn chờ duyệt</h1>
      {msg && <div className="text-sm text-slate-600">{msg}</div>}
      {list.length === 0 && <div className="card text-sm text-slate-500">Không có đơn nào chờ bạn duyệt.</div>}
      {list.map((r) => (
        <div key={r.id} className="card">
          <div className="font-medium">
            {r.name} —{' '}
            {r.kind === 'online'
              ? `Làm online (${r.scope === 'full' ? 'cả ngày' : r.scope === 'half_am' ? 'sáng' : 'chiều'})`
              : 'Nghỉ phép'}
          </div>
          <div className="text-sm text-slate-500">
            {r.dates.join(', ')}
            {r.reason ? ` · ${r.reason}` : ''}
          </div>
          <div className="flex gap-2 mt-2">
            <AsyncButton className="btn-primary" onClick={() => decide(r, 'approve')} busyLabel="Đang duyệt…">
              Duyệt
            </AsyncButton>
            <AsyncButton className="btn-ghost" onClick={() => decide(r, 'reject')} busyLabel="Đang xử lý…">
              Từ chối
            </AsyncButton>
          </div>
        </div>
      ))}
    </div>
  );
}
