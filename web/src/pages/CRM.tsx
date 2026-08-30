import { useEffect, useMemo, useState } from 'react';
import { api, ApiError } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import TimeInput from '../components/TimeInput';
import DateInput from '../components/DateInput';
import { useToast } from '../components/Toaster';
import { Badge, type BadgeVariant } from '../components/ui';
import type { Customer, Appointment } from '../lib/types';
import { NGAY_GIO_VN } from '../lib/gio';
import { NGUON } from '../lib/nguon';

interface Mem {
  id: string;
  fullName: string;
}

const STATUSES = ['Mới', 'Đang chăm sóc', 'Đã chốt', 'Tạm dừng', 'Mất'];

const CLOSED = 'Đã chốt';
const LOST = ['Tạm dừng', 'Mất'];
const blankCustomer = (): Partial<Customer> => ({
  name: '', phone: '', status: 'Mới', note: '', info: '', assignedTo: '', dob: '', closedAt: '', source: '',
});

type Tab = 'lead' | 'closed' | 'other';
const TABS: Array<{ key: Tab; label: string; hint: string }> = [
  { key: 'lead', label: '🎯 Tiềm năng', hint: 'Cần theo đuổi để chốt hợp đồng' },
  { key: 'closed', label: '🤝 Đã chốt', hint: 'Chăm sóc hậu mãi để giữ khách và tái tục' },
  { key: 'other', label: 'Tạm dừng / Mất', hint: 'Khách ngưng hợp tác' },
];

const fmtDT = (iso: string) =>
  new Date(iso).toLocaleString('vi-VN', NGAY_GIO_VN);

function statusVariant(s: string): BadgeVariant {
  if (s === CLOSED) return 'success';
  if (s === 'Đang chăm sóc') return 'warn';
  if (s === 'Mất') return 'danger';
  if (s === 'Tạm dừng') return 'neutral';
  return 'info';
}

function tabOf(status: string): Tab {
  if (status === CLOSED) return 'closed';
  if (LOST.includes(status)) return 'other';
  return 'lead';
}

/** Ngày trong tháng của sinh nhật (dob dạng YYYY-MM-DD hoặc --MM-DD). */
function birthdayThisMonth(dob: string, month: number): number | null {
  if (!dob) return null;
  const m = Number(dob.slice(-5, -3));
  const d = Number(dob.slice(-2));
  return m === month && d > 0 ? d : null;
}

/** Số ngày kể từ lúc chốt hợp đồng — để nhắc tái tục. */
function daysSince(iso: string): number | null {
  if (!iso) return null;
  const t = Date.parse(iso.slice(0, 10));
  if (!Number.isFinite(t)) return null;
  return Math.floor((Date.now() - t) / 86400000);
}

export default function CRM() {
  const toast = useToast();
  const [customers, setCustomers] = useState<Customer[]>([]);
  const [members, setMembers] = useState<Mem[]>([]);
  const [upcoming, setUpcoming] = useState<Appointment[]>([]);

  const [tab, setTab] = useState<Tab>('lead');

  // modal khách hàng
  const [edit, setEdit] = useState<Partial<Customer> | null>(null);
  const [appts, setAppts] = useState<Appointment[]>([]);
  const [apForm, setApForm] = useState({ at: '', note: '', ownerId: '' });
  // Máy chủ đã báo trùng giờ cho đúng giờ hẹn đang chọn — bấm lần nữa là đặt chồng.
  const [daCanhBao, setDaCanhBao] = useState(false);

  const now = new Date();
  const thisMonth = now.getMonth() + 1;
  const today = now.getDate();

  const counts = useMemo<Record<Tab, number>>(() => {
    const c: Record<Tab, number> = { lead: 0, closed: 0, other: 0 };
    for (const x of customers) c[tabOf(x.status)]++;
    return c;
  }, [customers]);

  const shown = useMemo(() => customers.filter((c) => tabOf(c.status) === tab), [customers, tab]);

  /**
   * Thống kê theo nguồn khách (anh Tâm 4/8/2026).
   *
   * Đếm kèm SỐ ĐÃ CHỐT và tỉ lệ chốt, không chỉ tổng số khách. Nguồn mang về 50 khách mà
   * chốt 2 thì kém hơn hẳn nguồn mang về 10 khách chốt 5 — nhìn mỗi cột tổng thì kết luận
   * ngược. Sắp theo số chốt giảm dần: nguồn nào ra tiền đứng đầu.
   */
  const theoNguon = useMemo(() => {
    const m = new Map<string, { tong: number; chot: number }>();
    for (const c of customers) {
      const nguon = (c.source || '').trim() || 'Chưa rõ';
      const o = m.get(nguon) || { tong: 0, chot: 0 };
      o.tong++;
      if (c.status === CLOSED) o.chot++;
      m.set(nguon, o);
    }
    return [...m.entries()]
      .map(([nguon, o]) => ({ nguon, ...o, tyLe: o.tong > 0 ? Math.round((o.chot / o.tong) * 100) : 0 }))
      .sort((a, b) => b.chot - a.chot || b.tong - a.tong);
  }, [customers]);

  const birthdays = useMemo(
    () =>
      customers
        .map((c) => ({ c, day: birthdayThisMonth(c.dob, thisMonth) }))
        .filter((x): x is { c: Customer; day: number } => x.day !== null)
        .sort((a, b) => a.day - b.day),
    [customers, thisMonth],
  );

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
      await api<{ id: string }>('/crm/customers', {
        body: {
          id: edit.id,
          name: edit.name,
          phone: edit.phone || '',
          status: edit.status || 'Mới',
          note: edit.note || '',
          info: edit.info || '',
          assignedTo: edit.assignedTo || '',
          dob: edit.dob || '',
          closedAt: edit.closedAt || '',
          source: edit.source || '',
        },
      });
      toast.success('Đã lưu khách hàng');
      // Đóng luôn sau khi lưu — anh Tâm 21/8/2026. Lịch hẹn của khách MỚI thì mở lại hồ sơ
      // rồi thêm, vì phải có mã khách mới gắn hẹn vào được.
      setEdit(null);
      setAppts([]);
      await loadCustomers();
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
  // Ngày và giờ hẹn nhập ở hai ô nhưng gửi đi vẫn là một chuỗi 'YYYY-MM-DDTHH:mm'.
  const apNgay = apForm.at.slice(0, 10);
  const apGio = apForm.at.slice(11, 16);
  /**
   * Chọn ngày mà chưa đặt giờ thì mặc định 09:00 — không để trống rồi báo lỗi lúc bấm lưu.
   * Đổi ngày/giờ là thành lịch khác nên phải kiểm trùng lại từ đầu.
   */
  const datNgayHen = (ngay: string) => {
    setDaCanhBao(false);
    setApForm({ ...apForm, at: ngay ? `${ngay}T${apGio || '09:00'}` : '' });
  };
  const datGioHen = (gio: string) => {
    setDaCanhBao(false);
    setApForm({ ...apForm, at: apNgay ? `${apNgay}T${gio || '09:00'}` : '' });
  };

  async function addAppt() {
    if (!edit?.id || !apForm.at) return toast.error('Lưu khách & chọn thời gian hẹn trước.');
    try {
      await api('/crm/appointments', {
        body: { customerId: edit.id, at: apForm.at, note: apForm.note, ownerId: apForm.ownerId, boQuaTrung: daCanhBao },
      });
      const r = await api<{ appointments: Appointment[] }>(`/crm/customers/${edit.id}/appointments`);
      setAppts(r.appointments);
      setApForm({ at: '', note: '', ownerId: edit.assignedTo || '' });
      setDaCanhBao(false);
      await loadUpcoming();
      toast.success('Đã thêm lịch hẹn');
    } catch (e) {
      toast.error((e as Error).message);
      // 409 = trùng giờ; xem ghi chú trong Reminders.tsx. Lỗi khác không mở cửa bỏ qua.
      if (e instanceof ApiError && e.status === 409) setDaCanhBao(true);
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
          <p className="text-sm text-ink-muted">Thông tin khách · tình trạng · lịch hẹn & nhắc hẹn</p>
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
                {a.note ? <span className="text-ink-muted"> — {a.note}</span> : null}
                {a.ownerId ? <span className="text-xs text-ink-faint"> ({memberName(a.ownerId)})</span> : null}
              </div>
              <button className="btn-ghost text-xs px-2 py-1" onClick={() => toggleDone(a)}>
                Xong
              </button>
            </li>
          ))}
          {upcoming.length === 0 && <li className="py-2 text-sm text-ink-muted">Không có lịch hẹn nào sắp tới.</li>}
        </ul>
      </div>

      {/* Nguồn khách: nguồn nào RA TIỀN, không phải nguồn nào đông khách. */}
      {theoNguon.length > 0 && (
        <div className="card">
          <h2 className="font-semibold">Nguồn khách</h2>
          <p className="mb-3 text-xs text-ink-muted">
            Sắp theo số khách đã chốt. Nguồn mang về nhiều khách mà chốt ít thì không bằng nguồn
            ít khách mà chốt nhiều.
          </p>
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
            {theoNguon.map((n) => (
              <div key={n.nguon} className="rounded-xl border border-brand-100 bg-brand-50/50 p-3">
                <div className="truncate text-xs font-medium text-ink-soft" title={n.nguon}>
                  {n.nguon}
                </div>
                <div className="mt-1 flex items-baseline gap-1.5">
                  <span className="text-xl font-bold text-ink">{n.chot}</span>
                  <span className="text-xs text-ink-muted">/ {n.tong} khách</span>
                </div>
                <div className="mt-1 text-xs">
                  <span className={n.tyLe >= 50 ? 'text-emerald-700' : 'text-ink-muted'}>
                    chốt {n.tyLe}%
                  </span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Sinh nhật khách trong tháng — để chuẩn bị quà/lời chúc */}
      {birthdays.length > 0 && (
        <div className="card border-amber-200 bg-amber-50">
          <h2 className="mb-2 font-semibold text-amber-900">🎂 Sinh nhật khách tháng {thisMonth}</h2>
          <ul className="divide-y divide-amber-200/60">
            {birthdays.map(({ c, day }) => (
              <li key={c.id} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <button className="text-left font-medium text-amber-900 underline" onClick={() => openCustomer(c)}>
                  {c.name}
                </button>
                <span className="whitespace-nowrap text-xs text-amber-700">
                  ngày {day}/{thisMonth}
                  {day === today ? ' — HÔM NAY 🎉' : day > today ? ` (còn ${day - today} ngày)` : ' (đã qua)'}
                </span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {/* Tabs: tiềm năng / đã chốt / khác */}
      <div className="flex w-fit gap-1 rounded-xl bg-brand-100 p-1">
        {TABS.map((t) => (
          <button
            key={t.key}
            className={`rounded-lg px-3 py-1.5 text-sm font-medium transition ${
              tab === t.key ? 'bg-white text-ink shadow-sm' : 'text-ink-muted hover:text-ink-soft'
            }`}
            onClick={() => setTab(t.key)}
          >
            {t.label}
            <span className={`ml-1.5 text-xs ${tab === t.key ? 'text-brand-600' : 'text-ink-faint'}`}>
              {counts[t.key]}
            </span>
          </button>
        ))}
      </div>

      <div className="card">
        <h2 className="font-semibold">{TABS.find((t) => t.key === tab)?.label}</h2>
        <p className="mb-2 text-sm text-ink-muted">{TABS.find((t) => t.key === tab)?.hint}</p>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1">Tên</th>
                <th>SĐT</th>
                <th>Tình trạng</th>
                <th>Phụ trách</th>
                {/* Cột riêng theo nhóm: tiềm năng quan tâm ghi chú, đã chốt quan tâm tái tục */}
                <th>{tab === 'closed' ? 'Đã hợp tác' : 'Ghi chú'}</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {shown.map((c) => {
                const days = daysSince(c.closedAt);
                return (
                  <tr key={c.id} className="border-t">
                    <td className="py-2 font-medium">{c.name}</td>
                    <td>{c.phone || '—'}</td>
                    <td>
                      <Badge variant={statusVariant(c.status)}>{c.status}</Badge>
                    </td>
                    <td>{memberName(c.assignedTo) || '—'}</td>
                    <td className="max-w-[16rem] truncate text-ink-muted">
                      {tab === 'closed'
                        ? days === null
                          ? 'chưa ghi ngày chốt'
                          : `${days} ngày${days >= 330 ? ' — sắp tròn năm, nhắc tái tục!' : ''}`
                        : c.note || '—'}
                    </td>
                    <td className="text-right">
                      <button className="text-xs text-brand-600 underline" onClick={() => openCustomer(c)}>
                        chi tiết
                      </button>
                    </td>
                  </tr>
                );
              })}
              {shown.length === 0 && (
                <tr>
                  <td colSpan={6} className="py-2 text-ink-muted">
                    {tab === 'lead'
                      ? 'Chưa có khách tiềm năng nào.'
                      : tab === 'closed'
                        ? 'Chưa có khách nào đã chốt.'
                        : 'Không có khách nào ở nhóm này.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      </div>

      {/* Modal chi tiết khách */}
      {edit && (
        <div className="fixed inset-0 z-50 bg-ink/40 flex items-start justify-center p-4 overflow-y-auto" onClick={() => setEdit(null)}>
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
                <label className="label">Nguồn khách</label>
                <select
                  className="input"
                  value={edit.source || ''}
                  onChange={(e) => setEdit({ ...edit, source: e.target.value })}
                >
                  <option value="">— Chưa rõ —</option>
                  {NGUON.map((n) => (
                    <option key={n} value={n}>
                      {n}
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
              <div>
                <label className="label">🎂 Ngày sinh khách</label>
                <DateInput value={edit.dob || ''} onChange={(v) => setEdit({ ...edit, dob: v })} />
                <p className="mt-1 text-xs text-ink-muted">Để nhắc chuẩn bị quà/lời chúc trong tháng sinh nhật.</p>
              </div>
              <div>
                <label className="label">🤝 Ngày chốt hợp đồng</label>
                <DateInput value={edit.closedAt || ''} onChange={(v) => setEdit({ ...edit, closedAt: v })} />
                <p className="mt-1 text-xs text-ink-muted">
                  Bỏ trống — hệ thống tự ghi khi anh chuyển sang “Đã chốt”.
                </p>
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
              <div className="mt-4 border-t border-brand-100 pt-3">
                <h3 className="font-semibold text-sm mb-2">Lịch hẹn</h3>
                <ul className="divide-y mb-2">
                  {appts.map((a) => (
                    <li key={a.id} className="py-1.5 flex items-center justify-between text-sm">
                      <span className={a.done ? 'line-through text-ink-faint' : ''}>
                        {fmtDT(a.at)}
                        {a.note ? ` — ${a.note}` : ''}
                      </span>
                      <button className="text-xs text-brand-600 underline" onClick={() => toggleDone(a)}>
                        {a.done ? 'mở lại' : 'xong'}
                      </button>
                    </li>
                  ))}
                  {appts.length === 0 && <li className="py-1.5 text-sm text-ink-muted">Chưa có lịch hẹn.</li>}
                </ul>
                <div className="grid sm:grid-cols-4 gap-2 items-end bg-brand-50 rounded-xl p-3">
                  {/* Tách ngày và giờ: ô datetime-local hiện SA/CH theo cài đặt máy người
                      dùng, không ép 24h được. Giá trị gửi đi vẫn là 'YYYY-MM-DDTHH:mm'. */}
                  <label className="text-xs text-ink-muted">
                    Ngày hẹn
                    <input
                      type="date"
                      className="input py-1"
                      value={apNgay}
                      onChange={(e) => datNgayHen(e.target.value)}
                    />
                  </label>
                  <label className="text-xs text-ink-muted">
                    Giờ hẹn
                    <TimeInput className="py-1" value={apGio} onChange={datGioHen} />
                  </label>
                  <input className="input py-1" placeholder="Ghi chú hẹn" value={apForm.note} onChange={(e) => setApForm({ ...apForm, note: e.target.value })} />
                  <AsyncButton
                    className={daCanhBao ? 'btn bg-amber-500 text-ink hover:bg-amber-400' : 'btn-primary'}
                    onClick={addAppt}
                    busyLabel="Đang lưu…"
                  >
                    {daCanhBao ? '⚠️ Vẫn đặt' : '＋ Thêm hẹn'}
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
