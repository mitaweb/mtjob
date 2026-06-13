import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { vnd, currentYm } from '../lib/format';
import type { Party, FinanceEntry } from '../lib/types';

interface Summary {
  income: number;
  expense: number;
  profit: number;
  receivableTotal: number;
  entries: FinanceEntry[];
}
interface PayRow {
  memberId: string;
  fullName: string;
  teamId: string;
  salary: number;
  actualDays: number;
  standardDays: number;
  netSalary: number;
}
interface Mem {
  id: string;
  fullName: string;
}

const emptyParty = (): Partial<Party> => ({ name: '', dueDay: 30, receivable: 0, startDate: '', notifyMemberIds: [], active: true });

export default function Finance() {
  const { user } = useAuth();
  const canEdit = user?.role === 'director' || user?.role === 'admin';
  const init = currentYm();
  const [ym, setYm] = useState(`${init.year}-${String(init.month).padStart(2, '0')}`);
  const [sum, setSum] = useState<Summary | null>(null);
  const [parties, setParties] = useState<Party[]>([]);
  const [members, setMembers] = useState<Mem[]>([]);
  const [pay, setPay] = useState<PayRow[]>([]);
  const [msg, setMsg] = useState('');

  const [pForm, setPForm] = useState<Partial<Party>>(emptyParty());
  const [eForm, setEForm] = useState({ kind: 'thu', name: '', amount: 0, date: '', recurring: false });

  function ymQuery() {
    const [y, m] = ym.split('-');
    return `year=${y}&month=${Number(m)}`;
  }

  async function loadAll() {
    const [s, p, mb, py] = await Promise.all([
      api<Summary>(`/finance/summary?month=${ym}`),
      api<{ parties: Party[] }>('/finance/parties'),
      api<{ members: Mem[] }>('/finance/members'),
      api<{ rows: PayRow[] }>(`/finance/payroll?${ymQuery()}`),
    ]);
    setSum(s);
    setParties(p.parties);
    setMembers(mb.members);
    setPay(py.rows);
  }
  useEffect(() => {
    loadAll().catch((e) => setMsg((e as Error).message));
  }, [ym]);

  async function saveParty() {
    if (!pForm.name) return setMsg('Nhập tên bên.');
    try {
      await api('/finance/parties', {
        body: {
          id: pForm.id,
          name: pForm.name,
          startDate: pForm.startDate || '',
          dueDay: Number(pForm.dueDay) || 30,
          receivable: Number(pForm.receivable) || 0,
          notifyMemberIds: pForm.notifyMemberIds || [],
          active: pForm.active ?? true,
        },
      });
      setPForm(emptyParty());
      setMsg('Đã lưu bên ✅');
      await loadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function delParty(id: string) {
    await api(`/finance/parties/${id}`, { method: 'DELETE' }).catch(() => {});
    await loadAll();
  }
  async function saveEntry() {
    if (!eForm.name) return setMsg('Nhập tên khoản.');
    try {
      await api('/finance/entries', { body: { month: ym, ...eForm, amount: Number(eForm.amount) || 0 } });
      setEForm({ kind: 'thu', name: '', amount: 0, date: '', recurring: false });
      setMsg('Đã lưu khoản ✅');
      await loadAll();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  async function delEntry(id: string) {
    await api(`/finance/entries/${id}`, { method: 'DELETE' }).catch(() => {});
    await loadAll();
  }
  function toggleNotify(id: string) {
    const cur = pForm.notifyMemberIds || [];
    setPForm({ ...pForm, notifyMemberIds: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">Tài chính</h1>
          <p className="text-sm text-slate-500">Công nợ các bên · thu/chi theo tháng · lãi lỗ{canEdit ? '' : ' (chế độ xem)'}</p>
        </div>
        <input type="month" className="input max-w-[10rem]" value={ym} onChange={(e) => setYm(e.target.value)} />
      </div>
      {msg && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{msg}</div>}

      {/* Tổng hợp */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <Stat label="Thu" value={vnd(sum?.income ?? 0)} cls="text-emerald-600" />
        <Stat label="Chi" value={vnd(sum?.expense ?? 0)} cls="text-red-600" />
        <Stat label="Lãi / Lỗ" value={vnd(sum?.profit ?? 0)} cls={(sum?.profit ?? 0) >= 0 ? 'text-emerald-600' : 'text-red-600'} />
        <Stat label="Tổng phải thu/tháng" value={vnd(sum?.receivableTotal ?? 0)} cls="text-brand-600" />
      </div>

      {/* Các bên */}
      <div className="card">
        <h2 className="font-semibold mb-2">Các bên & công nợ phải thu</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Tên bên</th>
                <th className="text-right">Phải thu</th>
                <th className="text-center">Ngày thu</th>
                <th>Hạn kế tiếp</th>
                <th>Nhắc cho</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {parties.map((p) => (
                <tr key={p.id} className="border-t">
                  <td className="py-1">{p.name}</td>
                  <td className="text-right">{vnd(p.receivable)}</td>
                  <td className="text-center">{p.dueDay}</td>
                  <td>{p.nextDue}</td>
                  <td className="text-xs">
                    {(p.notifyMemberIds || []).map((id) => members.find((m) => m.id === id)?.fullName).filter(Boolean).join(', ') || '— (giám đốc)'}
                  </td>
                  {canEdit && (
                    <td className="text-right whitespace-nowrap">
                      <button className="text-brand-600 underline text-xs mr-2" onClick={() => setPForm({ ...p })}>
                        sửa
                      </button>
                      <button className="text-red-600 underline text-xs" onClick={() => delParty(p.id)}>
                        xóa
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {parties.length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="py-2 text-slate-500">
                    Chưa có bên nào.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="bg-slate-50 rounded-xl p-3 mt-3 space-y-2">
            <div className="font-medium text-sm">{pForm.id ? 'Sửa bên' : '➕ Thêm bên'}</div>
            <div className="grid sm:grid-cols-4 gap-2">
              <input className="input py-1" placeholder="Tên bên / khách hàng" value={pForm.name || ''} onChange={(e) => setPForm({ ...pForm, name: e.target.value })} />
              <input className="input py-1" type="number" placeholder="Số tiền phải thu" value={pForm.receivable || ''} onChange={(e) => setPForm({ ...pForm, receivable: Number(e.target.value) })} />
              <label className="text-xs text-slate-500">
                Ngày thu hàng tháng
                <input className="input py-1" type="number" min={1} max={31} value={pForm.dueDay || 30} onChange={(e) => setPForm({ ...pForm, dueDay: Number(e.target.value) })} />
              </label>
              <label className="text-xs text-slate-500">
                Ngày bắt đầu
                <input className="input py-1" type="date" value={pForm.startDate || ''} onChange={(e) => setPForm({ ...pForm, startDate: e.target.value })} />
              </label>
            </div>
            <div>
              <div className="text-xs text-slate-500 mb-1">Người nhận nhắc thu (5 ngày trước hạn):</div>
              <div className="flex flex-wrap gap-2">
                {members.map((m) => (
                  <label key={m.id} className={`text-xs px-2 py-1 rounded-lg cursor-pointer border ${(pForm.notifyMemberIds || []).includes(m.id) ? 'bg-brand-600 text-white border-brand-600' : 'bg-white border-slate-300'}`}>
                    <input type="checkbox" className="hidden" checked={(pForm.notifyMemberIds || []).includes(m.id)} onChange={() => toggleNotify(m.id)} />
                    {m.fullName}
                  </label>
                ))}
              </div>
            </div>
            <div className="flex gap-2">
              <button className="btn-primary" onClick={saveParty}>
                {pForm.id ? 'Lưu' : 'Thêm bên'}
              </button>
              {pForm.id && (
                <button className="btn-ghost" onClick={() => setPForm(emptyParty())}>
                  Hủy
                </button>
              )}
            </div>
          </div>
        )}
      </div>

      {/* Thu / Chi */}
      <div className="card">
        <h2 className="font-semibold mb-2">Thu / Chi tháng {ym}</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
              <tr>
                <th className="py-1">Khoản</th>
                <th>Loại</th>
                <th className="text-right">Số tiền</th>
                <th>Ngày</th>
                <th>Hàng tháng</th>
                {canEdit && <th></th>}
              </tr>
            </thead>
            <tbody>
              {(sum?.entries || []).map((e) => (
                <tr key={e.id} className="border-t">
                  <td className="py-1">{e.name}</td>
                  <td className={e.kind === 'thu' ? 'text-emerald-600' : 'text-red-600'}>{e.kind === 'thu' ? 'Thu' : 'Chi'}</td>
                  <td className="text-right">{vnd(e.amount)}</td>
                  <td>{e.date || '—'}</td>
                  <td>{e.recurring ? '🔁' : ''}</td>
                  {canEdit && (
                    <td className="text-right">
                      <button className="text-red-600 underline text-xs" onClick={() => delEntry(e.id)}>
                        xóa
                      </button>
                    </td>
                  )}
                </tr>
              ))}
              {(sum?.entries || []).length === 0 && (
                <tr>
                  <td colSpan={canEdit ? 6 : 5} className="py-2 text-slate-500">
                    Chưa có khoản thu/chi nào trong tháng.
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>

        {canEdit && (
          <div className="bg-slate-50 rounded-xl p-3 mt-3 grid sm:grid-cols-6 gap-2 items-end">
            <select className="input py-1" value={eForm.kind} onChange={(e) => setEForm({ ...eForm, kind: e.target.value })}>
              <option value="thu">Thu</option>
              <option value="chi">Chi</option>
            </select>
            <input className="input py-1 sm:col-span-2" placeholder="Tên khoản" value={eForm.name} onChange={(e) => setEForm({ ...eForm, name: e.target.value })} />
            <input className="input py-1" type="number" placeholder="Số tiền" value={eForm.amount || ''} onChange={(e) => setEForm({ ...eForm, amount: Number(e.target.value) })} />
            <input className="input py-1" type="date" value={eForm.date} onChange={(e) => setEForm({ ...eForm, date: e.target.value })} />
            <label className="text-xs text-slate-600 flex items-center gap-1">
              <input type="checkbox" checked={eForm.recurring} onChange={(e) => setEForm({ ...eForm, recurring: e.target.checked })} />
              Hàng tháng
            </label>
            <button className="btn-primary sm:col-span-6" onClick={saveEntry}>
              ➕ Thêm khoản
            </button>
          </div>
        )}
      </div>

      {/* Lương nhân sự (xem) */}
      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Lương nhân sự (tháng {ym})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Họ tên</th>
              <th>Team</th>
              <th className="text-right">Mức lương</th>
              <th className="text-center">Công</th>
              <th className="text-right">Thực lãnh</th>
            </tr>
          </thead>
          <tbody>
            {pay.map((r) => (
              <tr key={r.memberId} className="border-t">
                <td className="py-1">{r.fullName}</td>
                <td>{r.teamId}</td>
                <td className="text-right">{vnd(r.salary)}</td>
                <td className="text-center">
                  {r.actualDays}/{r.standardDays}
                </td>
                <td className="text-right font-medium text-emerald-600">{vnd(r.netSalary)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Stat({ label, value, cls }: { label: string; value: string; cls: string }) {
  return (
    <div className="card text-center">
      <div className={`text-xl font-bold ${cls}`}>{value}</div>
      <div className="text-xs text-slate-500">{label}</div>
    </div>
  );
}
