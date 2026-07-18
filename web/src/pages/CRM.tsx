import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import { useToast } from '../components/Toaster';
import { Badge, type BadgeVariant } from '../components/ui';
import type { Customer, Appointment } from '../lib/types';

interface Mem {
  id: string;
  fullName: string;
}

const STATUSES = ['Mới', 'Đang chăm sóc', 'Đã chốt', 'Tạm dừng', 'Mất'];
const blankCustomer = (): Partial<Customer> => ({ name: '', phone: '', status: 'Mới', note: '', info: '', assignedTo: '' });

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Ho_Chi_Minh' });

function statusVariant(s: string): BadgeVariant {
  if (s === 'Đã chốt') return 'success';
  if (s === 'Đang chăm sóc') return 'warn';
  if (s === 'Mất') return 'danger';
  if (s === 'Tạm dừng') return 'neutral';
  return 'info';
}

export default function CRM() {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [members, setMembers] = useState<Mem[]>([]);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);

  // modal khách hàng
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [apForm, setApForm] = useState({ at: '', note: '', ownerId: '' });

  async function loadCustomers() {
    const c = await api<{ customers: Customer[] }>('/crm/customers');
    setCustomers(c.customers);
  }
  async function loadUpcoming() {
    const u = await api<{ appointments: Appointment[] }>('/crm/appointments/upcoming');
    setUpcoming(u.appointments);
  }
  useEffect(() => {
    // Danh sách thành viên gần như tĩnh → chỉ tải 1 lần lúc mở trang.
    Promise.all([
      loadCustomers(),
      loadUpcoming(),
      api<{ members: Mem[] }>('/crm/members').then((m) => setMembers(m.members)),
    ]).catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const memberName = (id: string) => members.find((m) => m.id === id)?.fullName || '';

  async function openCustomer(c: Partial<Customer>) {
    setEdit({ ...c });
    setApForm({ at: '', note: '', ownerId: c.assignedTo || '' });
    if (c.id) {
      const r = await api<{ appointments: Appointment[] }>(`/crm/customers/${c.id}/appointments`);
      setAppts(r.appointments);
    } else {
      setAppts([]);
    }
  }

  async function saveCustomer() {
    if (!edit?.name) return toast.error('Nhập tên khách.');
    try {
      const r = await api<{ id: string }>('/crm/customers', {
        body: {
          id: edit.id,
          name: edit.name,
          phone: edit.phone || '',
          status: edit.status || 'Mới',
          note: edit.note || '',
          info: edit.info || '',
          assignedTo: edit.assignedTo || '',
        },
      });
      toast.success('Đã lưu khách hàng');
      await loadCustomers();
      setEdit({ ...edit, id: r.id });
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function delCustomer(id: string) {
    await api(`/crm/customers/${id}`, { method: 'DELETE' }).catch(() => {});
    setEdit(null);
    setCustomers((list) => list.filter((c) => c.id !== id));
    await loadUpcoming(); // lịch hẹn của khách vừa xoá cũng biến mất
  }
  async function addAppt() {
    if (!edit?.id || !apForm.at) return toast.error('Lưu khách & chọn thời gian hẹn trước.');
    try {
      await api('/crm/appointments', { body: { customerId: edit.id, at: apForm.at, note: apForm.note, ownerId: apForm.ownerId } });
      const r = await api<{ appointments: Appointment[] }>(`/crm/customers/${edit.id}/appointments`);
      setAppts(r.appointments);
      setApForm({ at: '', note: '', ownerId: edit.assignedTo || '' });
      await loadUpcoming();
      toast.success('Đã thêm lịch hẹn');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function toggleDone(a: Appointment) {
    try {
      await api(`/crm/appointments/${a.id}/done`, { body: { done: !a.done } });
    } catch {
      return; // đổi trạng thái thất bại thì giữ nguyên UI
    }
    const done = !a.done;
    // Cập nhật tại chỗ thay vì tải lại tất cả: 1 request cho 1 cú bấm.
    setAppts((list) => list.map((x) => (x.id === a.id ? { ...x, done } : x)));
    if (done) setUpcoming((list) => list.filter((x) => x.id !== a.id));
    else await loadUpcoming(); // mở lại → hẹn có thể quay về danh sách sắp tới
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Khách hàng (CRM)</h1>
          <p className="text-sm text-slate-500">Thông tin khách · tình trạng · lịch hẹn & nhắc hẹn</p>
        </div>
        <button className="btn-primary" onClick={() => openCustomer(blankCustomer())}>
          ＋ Thêm khách
        </button>
      </div>

      {/* Lịch hẹn sắp tới */}
      <div className="card">
        <h2 className="font-semibold mb-2">📅 Lịch hẹn sắp tới (14 ngày)</h2>
        <ul className="divide-y">
          {upcoming.map((a) => (
            <li key={a.id} className="py-2 flex items-center justify-between text-sm">
              <div>
                <span className="font-medium">{fmtDT(a.at)}</span> · {a.customerName}
                {a.note ? <span className="text-slate-500"> — {a.note}</span> : null}
                {a.ownerId ? <span className="text-xs text-slate-400"> ({memberName(a.ownerId)})</span> : null}
              </div>
              <button className="btn-ghost text-xs px-2 py-1" onClick={() => toggleDone(a)}>
                Xong
              </button>
            </li>
          ))}
          {upcoming.length === 0 && <li className="py-2 text-sm text-slate-500">Không có lịch hẹn nào sắp tới.</li>}
        </ul>
      </div>

      {/* Danh sách khách */}
      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Danh sách khách ({customers.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Tên</th>
              <th>SĐT</th>
              <th>Tình trạng</th>
              <th>Phụ trách</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {customers.map((c) => (
              <tr key={c.id} className="border-t">
                <td className="py-2 font-medium">{c.name}</td>
                <td>{c.phone || '—'}</td>
                <td>
                  <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                </td>
                <td>{memberName(c.assignedTo) || '—'}</td>
                <td className="text-right">
                  <button className="text-brand-600 underline text-xs" onClick={() => openCustomer(c)}>
                    chi tiết
                  </button>
                </td>
              </tr>
            ))}
            {customers.length === 0 && (
              <tr>
                <td colSpan={5} className="py-2 text-slate-500">
                  Chưa có khách hàng nào.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {/* Modal chi tiết khách */}
      {edit && (
        <div className="fixed inset-0 z-50 bg-slate-900/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setEdit(null)}>
          <div className="card w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-3">
              <h2 className="font-semibold">{edit.id ? 'Chi tiết khách hàng' : 'Khách hàng mới'}</h2>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setEdit(null)}>
                ✕ Đóng
              </button>
            </div>

            <div className="grid sm:grid-cols-2 gap-3">
              <div>
                <label className="label">Tên khách *</label>
                <input className="input" value={edit.name || ''} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
              </div>
              <div>
                <label className="label">Số điện thoại</label>
                <input className="input" value={edit.phone || ''} onChange={(e) => setEdit({ ...edit, phone: e.target.value })} />
              </div>
              <div>
                <label className="label">Tình trạng</label>
                <select className="input" value={edit.status || 'Mới'} onChange={(e) => setEdit({ ...edit, status: e.target.value })}>
                  {STATUSES.map((s) => (
                    <option key={s} value={s}>
                      {s}
                    </option>
                  ))}
                </select>
              </div>
              <div>
                <label className="label">Phụ trách (Account)</label>
                <select className="input" value={edit.assignedTo || ''} onChange={(e) => setEdit({ ...edit, assignedTo: e.target.value })}>
                  <option value="">— Chưa gán —</option>
                  {members.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.fullName}
                    </option>
                  ))}
                </select>
              </div>
              <div className="sm:col-span-2">
                <label className="label">Thông tin khách</label>
                <textarea className="input" rows={2} value={edit.info || ''} onChange={(e) => setEdit({ ...edit, info: e.target.value })} />
              </div>
              <div className="sm:col-span-2">
                <label className="label">Ghi chú</label>
                <textarea className="input" rows={2} value={edit.note || ''} onChange={(e) => setEdit({ ...edit, note: e.target.value })} />
              </div>
            </div>
            <div className="flex gap-2 mt-3">
              <AsyncButton className="btn-primary" onClick={saveCustomer} busyLabel="Đang lưu…">
                {edit.id ? 'Lưu thay đổi' : 'Tạo khách'}
              </AsyncButton>
              {edit.id && (
                <button className="btn-ghost text-rose-600" onClick={() => delCustomer(edit.id!)}>
                  Xóa khách
                </button>
              )}
            </div>

            {/* Lịch hẹn */}
            {edit.id && (
              <div className="mt-4 border-t border-slate-100 pt-3">
                <h3 className="font-semibold text-sm mb-2">Lịch hẹn</h3>
                <ul className="divide-y mb-2">
                  {appts.map((a) => (
                    <li key={a.id} className="py-1.5 flex items-center justify-between text-sm">
                      <span className={a.done ? 'line-through text-slate-400' : ''}>
                        {fmtDT(a.at)}
                        {a.note ? ` — ${a.note}` : ''}
                      </span>
                      <button className="text-xs text-brand-600 underline" onClick={() => toggleDone(a)}>
                        {a.done ? 'mở lại' : 'xong'}
                      </button>
                    </li>
                  ))}
                  {appts.length === 0 && <li className="py-1.5 text-sm text-slate-500">Chưa có lịch hẹn.</li>}
                </ul>
                <div className="grid sm:grid-cols-4 gap-2 items-end bg-slate-50 rounded-xl p-3">
                  <label className="text-xs text-slate-500 sm:col-span-2">
                    Thời gian hẹn
                    <input type="datetime-local" className="input py-1" value={apForm.at} onChange={(e) => setApForm({ ...apForm, at: e.target.value })} />
                  </label>
                  <input className="input py-1" placeholder="Ghi chú hẹn" value={apForm.note} onChange={(e) => setApForm({ ...apForm, note: e.target.value })} />
                  <AsyncButton className="btn-primary" onClick={addAppt} busyLabel="Đang lưu…">
                    ＋ Thêm hẹn
                  </AsyncButton>
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
