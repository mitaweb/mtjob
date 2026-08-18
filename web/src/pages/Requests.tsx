import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import { TEN_DON, laGiaiTrinh, homNayIso, homQuaIso, type RequestKind } from '../lib/requests';

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

const TABS: Array<{ key: RequestKind; label: string }> = [
  { key: 'online', label: 'Làm online' },
  { key: 'leave', label: 'Nghỉ phép' },
  { key: 'forgot', label: 'Quên chấm công' },
  { key: 'late', label: 'Đi trễ' },
  { key: 'early', label: 'Về sớm' },
];

// Tiến trình duyệt: Đỏ (chờ leader) → Vàng (leader đã duyệt, chờ giám đốc) → Xanh (duyệt xong).
function stageOf(r: Req): { label: string; badge: string; border: string } {
  if (r.finalStatus === 'rejected')
    return { label: '❌ Từ chối', badge: 'bg-brand-200 text-ink-soft', border: 'border-brand-200' };
  if (r.finalStatus === 'approved')
    return { label: '✅ Đã duyệt', badge: 'bg-emerald-100 text-emerald-700', border: 'border-emerald-400' };
  if (r.leaderStatus === 'approved')
    return { label: '🟡 Chờ giám đốc', badge: 'bg-amber-100 text-amber-700', border: 'border-amber-400' };
  return { label: '🔴 Chờ leader', badge: 'bg-rose-100 text-rose-700', border: 'border-rose-400' };
}

export default function Requests() {
  const [tab, setTab] = useState<RequestKind>('online');
  const [date, setDate] = useState('');
  const [scope, setScope] = useState('full');
  const [reason, setReason] = useState('');
  const [list, setList] = useState<Req[]>([]);
  const [msg, setMsg] = useState('');

  const giaiTrinh = laGiaiTrinh(tab);

  async function load() {
    const r = await api<{ requests: Req[] }>('/requests/me');
    setList(r.requests);
  }
  useEffect(() => {
    load().catch((e) => setMsg((e as Error).message));
  }, []);

  // Đổi loại đơn thì bỏ ngày đã chọn: ngày hợp lệ của đơn giải trình khác hẳn đơn nghỉ/online.
  function doiTab(k: RequestKind) {
    setTab(k);
    setDate('');
    setMsg('');
  }

  async function submit() {
    if (!date) {
      setMsg('Chọn ngày trước nhé.');
      return;
    }
    if (giaiTrinh && !reason.trim()) {
      setMsg('Đơn giải trình phải ghi lý do.');
      return;
    }
    try {
      if (tab === 'online') {
        await api('/requests/online', { body: { dates: [date], scope, reason } });
      } else if (tab === 'leave') {
        await api('/requests/leave', { body: { dates: [date], reason } });
      } else {
        await api(`/requests/${tab}`, { body: { date, reason } });
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
        <div className="mb-3 flex flex-wrap gap-2">
          {TABS.map((t) => (
            <button
              key={t.key}
              className={tab === t.key ? 'btn-primary' : 'btn-ghost'}
              onClick={() => doiTab(t.key)}
            >
              {t.label}
            </button>
          ))}
        </div>

        {giaiTrinh && (
          <div className="mb-3 rounded-xl bg-brand-50 px-3 py-2 text-sm text-ink-soft">
            Đơn <strong>{TEN_DON[tab]}</strong> phải nộp trong <strong>24 giờ</strong>: chỉ chọn được hôm nay hoặc
            hôm qua. Quá hạn thì hệ thống không nhận đơn nữa.
          </div>
        )}

        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="label">Ngày</label>
            <input
              type="date"
              className="input"
              value={date}
              min={giaiTrinh ? homQuaIso() : undefined}
              max={giaiTrinh ? homNayIso() : undefined}
              onChange={(e) => setDate(e.target.value)}
            />
          </div>
          {tab === 'online' && (
            <div>
              <label className="label">Buổi</label>
              <select className="input" value={scope} onChange={(e) => setScope(e.target.value)}>
                <option value="full">Cả ngày</option>
                <option value="half_am">Nửa ngày (sáng)</option>
                <option value="half_pm">Nửa ngày (chiều)</option>
              </select>
            </div>
          )}
        </div>
        <div className="mt-3">
          <label className="label">Lý do{giaiTrinh ? ' (bắt buộc)' : ''}</label>
          <input
            className="input"
            value={reason}
            placeholder={giaiTrinh ? 'Ví dụ: kẹt xe ở cầu Sài Gòn, tới trễ 20 phút' : ''}
            onChange={(e) => setReason(e.target.value)}
          />
        </div>
        <AsyncButton className="btn-primary mt-3" onClick={submit}>
          Gửi đơn
        </AsyncButton>
        {msg && <div className="mt-2 text-sm text-ink-soft">{msg}</div>}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Đơn của tôi</h2>
        <ul className="divide-y">
          {list.map((r) => {
            const stage = stageOf(r);
            return (
              <li key={r.id} className={`py-2 pl-3 text-sm border-l-4 ${stage.border}`}>
                <div className="flex justify-between gap-2">
                  <span className="min-w-0 font-medium">
                    {TEN_DON[r.kind] ?? r.kind} · {r.dates.join(', ')}
                  </span>
                  <span className={`shrink-0 rounded-full px-2 py-0.5 text-xs ${stage.badge}`}>{stage.label}</span>
                </div>
                <div className="text-xs text-ink-muted">
                  Leader: {statusVi[r.leaderStatus]} · Giám đốc: {statusVi[r.directorStatus]}
                  {r.reason ? ` · ${r.reason}` : ''}
                </div>
              </li>
            );
          })}
          {list.length === 0 && <li className="py-2 text-sm text-ink-muted">Chưa có đơn nào.</li>}
        </ul>
      </div>
    </div>
  );
}
