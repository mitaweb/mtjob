import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import { useToast } from '../components/Toaster';
import { Badge, EmptyState, SkeletonRows } from '../components/ui';

interface Req {
  kind: 'online' | 'leave';
  id: string;
  name: string;
  dates: string[];
  scope?: string;
  type?: string;
  reason: string;
  directorAt?: string;
  leaderAt?: string;
}

type Tab = 'pending' | 'approved' | 'rejected';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'pending', label: 'Chờ duyệt' },
  { key: 'approved', label: 'Đã duyệt' },
  { key: 'rejected', label: 'Từ chối' },
];

function kindLabel(r: Req): string {
  return r.kind === 'online'
    ? `Làm online (${r.scope === 'full' ? 'cả ngày' : r.scope === 'half_am' ? 'sáng' : 'chiều'})`
    : 'Nghỉ phép';
}

const fmtD = (iso?: string) =>
  iso ? new Date(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' }) : '';

export default function Approvals() {
  const toast = useToast();
  const [tab, setTab] = useState<Tab>('pending');
  const [pending, setPending] = useState<Req[]>([]);
  const [approved, setApproved] = useState<Req[]>([]);
  const [rejected, setRejected] = useState<Req[]>([]);
  const [canRedecide, setCanRedecide] = useState(false);
  const [loading, setLoading] = useState(true);

  async function load() {
    const [p, d] = await Promise.all([
      api<{ requests: Req[] }>('/requests/pending'),
      api<{ approved: Req[]; rejected: Req[]; canRedecide: boolean }>('/requests/decided'),
    ]);
    setPending(p.requests);
    setApproved(d.approved);
    setRejected(d.rejected);
    setCanRedecide(d.canRedecide);
  }
  useEffect(() => {
    load()
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function decide(r: Req, decision: 'approve' | 'reject') {
    try {
      await api(`/requests/${r.kind}/${r.id}/decide`, { body: { decision } });
      toast.success(decision === 'approve' ? 'Đã duyệt' : 'Đã từ chối');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function redecide(r: Req, decision: 'approve' | 'reject') {
    const ask =
      decision === 'reject'
        ? `Huỷ duyệt đơn của ${r.name}? Ngày công đã ghi từ đơn này sẽ bị gỡ.`
        : `Duyệt lại đơn của ${r.name}? Ngày công sẽ được ghi như duyệt bình thường.`;
    if (!window.confirm(ask)) return;
    try {
      await api(`/requests/${r.kind}/${r.id}/redecide`, { body: { decision } });
      toast.success(decision === 'approve' ? 'Đã duyệt lại đơn' : 'Đã huỷ duyệt — ngày công từ đơn được gỡ');
      await load();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const list = tab === 'pending' ? pending : tab === 'approved' ? approved : rejected;
  const counts: Record<Tab, number> = { pending: pending.length, approved: approved.length, rejected: rejected.length };

  return (
    <div className="space-y-3">
      <h1 className="text-lg font-bold">Duyệt đơn</h1>

      {/* Tabs */}
      <div className="flex gap-1 rounded-xl bg-slate-100 p-1 w-fit">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-slate-800 shadow-sm' : 'text-slate-500 hover:text-slate-700'
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-brand-600' : 'text-slate-400'}`}>{counts[t.key]}</span>
          </button>
        ))}
      </div>

      {loading && <SkeletonRows rows={3} />}
      {!loading && list.length === 0 && (
        <div className="card">
          <EmptyState
            icon={tab === 'pending' ? '🎉' : '📭'}
            text={
              tab === 'pending'
                ? 'Không có đơn nào chờ bạn duyệt.'
                : tab === 'approved'
                  ? 'Chưa có đơn nào được duyệt.'
                  : 'Chưa có đơn nào bị từ chối.'
            }
          />
        </div>
      )}

      {list.map((r) => (
        <div key={`${r.kind}-${r.id}`} className="card">
          <div className="flex items-start justify-between gap-2">
            <div className="font-medium">
              {r.name} — {kindLabel(r)}
            </div>
            {tab === 'approved' && <Badge variant="success">Đã duyệt{r.directorAt ? ` ${fmtD(r.directorAt)}` : ''}</Badge>}
            {tab === 'rejected' && <Badge variant="danger">Từ chối{r.directorAt || r.leaderAt ? ` ${fmtD(r.directorAt || r.leaderAt)}` : ''}</Badge>}
          </div>
          <div className="text-sm text-slate-500">
            {r.dates.join(', ')}
            {r.reason ? ` · ${r.reason}` : ''}
          </div>

          {tab === 'pending' && (
            <div className="flex gap-2 mt-2">
              <AsyncButton className="btn-primary" onClick={() => decide(r, 'approve')} busyLabel="Đang duyệt…">
                Duyệt
              </AsyncButton>
              <AsyncButton className="btn-ghost" onClick={() => decide(r, 'reject')} busyLabel="Đang xử lý…">
                Từ chối
              </AsyncButton>
            </div>
          )}
          {tab === 'approved' && canRedecide && (
            <div className="flex gap-2 mt-2">
              <AsyncButton className="btn-ghost text-rose-600" onClick={() => redecide(r, 'reject')} busyLabel="Đang xử lý…">
                Huỷ duyệt (gỡ công)
              </AsyncButton>
            </div>
          )}
          {tab === 'rejected' && canRedecide && (
            <div className="flex gap-2 mt-2">
              <AsyncButton className="btn-primary" onClick={() => redecide(r, 'approve')} busyLabel="Đang duyệt…">
                Duyệt lại
              </AsyncButton>
            </div>
          )}
        </div>
      ))}
    </div>
  );
}
