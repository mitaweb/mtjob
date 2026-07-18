import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { vnd, currentYm } from '../lib/format';

interface PayRow {
  memberId: string;
  fullName: string;
  teamId: string;
  salary: number;
  bhxh: number;
  standardDays: number;
  actualDays: number;
  proratedSalary: number;
  bhxhDeduction: number;
  netSalary: number;
}
interface AttnRow {
  date: string;
  morningIn: string;
  morningOut: string;
  afternoonIn: string;
  afternoonOut: string;
  dayFraction: number;
  mode: string;
}

const blankAttn = (date = ''): AttnRow => ({
  date,
  morningIn: '',
  morningOut: '',
  afternoonIn: '',
  afternoonOut: '',
  dayFraction: 0,
  mode: 'office',
});

export default function AdminPayroll() {
  const init = currentYm();
  const [ym, setYm] = useState(`${init.year}-${String(init.month).padStart(2, '0')}`);
  const [rows, setRows] = useState<PayRow[]>([]);
  const [locked, setLocked] = useState(false);
  const [msg, setMsg] = useState('');

  function ymNums() {
    const [y, m] = ym.split('-');
    return { year: Number(y), month: Number(m) };
  }

  // Attendance editor state
  const [editing, setEditing] = useState<PayRow | null>(null);
  const [records, setRecords] = useState<AttnRow[]>([]);
  const [form, setForm] = useState<AttnRow>(blankAttn());
  const [savingAttn, setSavingAttn] = useState(false);

  function qs() {
    const [y, m] = ym.split('-');
    return `year=${y}&month=${Number(m)}`;
  }

  async function loadPayroll(): Promise<PayRow[]> {
    const r = await api<{ rows: PayRow[]; locked: boolean }>(`/admin/payroll?${qs()}`);
    setRows(r.rows);
    setLocked(!!r.locked);
    return r.rows;
  }

  async function lockMonth() {
    if (
      !confirm(
        'Chốt lương tháng này? Số liệu sẽ được đóng băng — nhân sự nghỉ sau vẫn giữ nguyên, sửa mức lương/công về sau không làm đổi tháng này. Vẫn có thể "Mở lại" nếu cần.',
      )
    )
      return;
    try {
      await api('/admin/payroll/lock', { body: ymNums() });
      await loadPayroll();
      setMsg('Đã chốt lương tháng này 🔒');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function unlockMonth() {
    if (!confirm('Mở lại tháng đã chốt để sửa? Số liệu sẽ tính lại theo dữ liệu hiện tại.')) return;
    try {
      await api('/admin/payroll/unlock', { body: ymNums() });
      await loadPayroll();
      setMsg('Đã mở lại tháng — có thể sửa công.');
    } catch (e) {
      setMsg((e as Error).message);
    }
  }
  useEffect(() => {
    loadPayroll().catch((e) => setMsg((e as Error).message));
  }, [ym]);

  async function openEditor(row: PayRow) {
    setEditing(row);
    setForm(blankAttn());
    try {
      const r = await api<{ records: AttnRow[] }>(`/admin/attendance?memberId=${row.memberId}&${qs()}`);
      setRecords(r.records);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function saveAttn() {
    if (!editing || !form.date) {
      setMsg('Chọn ngày trước khi lưu.');
      return;
    }
    setSavingAttn(true);
    try {
      await api('/admin/attendance', {
        body: {
          memberId: editing.memberId,
          date: form.date,
          morningIn: form.morningIn,
          morningOut: form.morningOut,
          afternoonIn: form.afternoonIn,
          afternoonOut: form.afternoonOut,
          mode: form.mode,
        },
      });
      // reload danh sách ngày + bảng lương (công/net đổi theo)
      const r = await api<{ records: AttnRow[] }>(`/admin/attendance?memberId=${editing.memberId}&${qs()}`);
      setRecords(r.records);
      const fresh = await loadPayroll();
      // Cập nhật lại khối chi tiết lương trong modal theo công mới.
      const updated = fresh.find((x) => x.memberId === editing.memberId);
      if (updated) setEditing(updated);
      setForm(blankAttn());
      setMsg('Đã lưu chấm công ✅');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setSavingAttn(false);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="flex items-center gap-2 text-lg font-bold">
            Bảng lương & công
            {locked && (
              <span className="rounded-full bg-slate-800 px-2 py-0.5 text-xs font-medium text-white">🔒 Đã chốt</span>
            )}
          </h1>
          <p className="text-sm text-slate-500">
            {locked
              ? 'Tháng đã chốt — số liệu đóng băng, không đổi khi sửa lương/công hay nhân sự nghỉ. Bấm “Mở lại” nếu cần sửa.'
              : 'Mức lương lấy từ Google Sheet (tự tính). Bấm tên để xem chi tiết & sửa công. Xong thì “Chốt lương” để đóng băng tháng.'}
          </p>
        </div>
        <div className="flex items-center gap-2">
          <input type="month" className="input max-w-[10rem]" value={ym} onChange={(e) => setYm(e.target.value)} />
          {locked ? (
            <button className="btn-ghost whitespace-nowrap" onClick={unlockMonth}>
              Mở lại
            </button>
          ) : (
            <button className="btn-primary whitespace-nowrap" onClick={lockMonth} disabled={rows.length === 0}>
              🔒 Chốt lương
            </button>
          )}
        </div>
      </div>

      {msg && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{msg}</div>}

      <div className="card overflow-x-auto">
        {/* Mobile: dạng thẻ cho dễ đọc */}
        <ul className="md:hidden divide-y">
          {rows.map((r) => (
            <li key={r.memberId} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <button
                  className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                  onClick={() => openEditor(r)}
                >
                  {r.fullName}
                </button>
                <span className="font-semibold text-emerald-600">{vnd(r.netSalary)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="text-xs text-slate-500">
                  {r.teamId || '—'} · Công {r.actualDays}/{r.standardDays} · Mức lương {vnd(r.salary)}
                </span>
                <button className="btn-ghost text-xs px-2 py-1 whitespace-nowrap" onClick={() => openEditor(r)}>
                  Chi tiết
                </button>
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="py-3 text-sm text-slate-500">Chưa có dữ liệu.</li>}
        </ul>
        <table className="w-full text-sm hidden md:table">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Họ tên</th>
              <th>Team</th>
              <th className="text-right">Mức lương</th>
              <th className="text-center">Công</th>
              <th className="text-right">Lương thực lãnh</th>
              <th></th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.memberId} className="border-t">
                <td className="py-2">
                  <button
                    className="font-medium text-brand-700 underline-offset-2 hover:underline"
                    onClick={() => openEditor(r)}
                  >
                    {r.fullName}
                  </button>
                </td>
                <td>{r.teamId}</td>
                <td className="text-right">{vnd(r.salary)}</td>
                <td className="text-center">
                  {r.actualDays}/{r.standardDays}
                </td>
                <td className="text-right font-medium text-emerald-600">{vnd(r.netSalary)}</td>
                <td className="text-right">
                  <button className="btn-ghost text-xs px-2 py-1" onClick={() => openEditor(r)}>
                    Chi tiết
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={6} className="py-3 text-slate-500">
                  Chưa có dữ liệu.
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      {editing && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-start justify-center p-4 overflow-y-auto"
          onClick={() => setEditing(null)}
        >
          <div className="card w-full max-w-2xl my-8" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">
                {editing.fullName} {editing.teamId ? `· ${editing.teamId}` : ''} ({ym})
              </h2>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(null)}>
                ✕ Đóng
              </button>
            </div>

            {/* Chi tiết lương tháng — tự cập nhật khi sửa công bên dưới */}
            <div className="mb-3 rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
              <div className="grid grid-cols-2 gap-x-4 gap-y-1 text-sm sm:grid-cols-3">
                <div>
                  <div className="text-xs text-slate-500">Mức lương</div>
                  <div className="font-medium">{vnd(editing.salary)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Công thực tế / chuẩn</div>
                  <div className="font-medium">
                    {editing.actualDays}/{editing.standardDays} ngày
                  </div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Lương theo công</div>
                  <div className="font-medium">{vnd(editing.proratedSalary)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Trừ BHXH</div>
                  <div className="font-medium text-rose-600">−{vnd(editing.bhxhDeduction)}</div>
                </div>
                <div>
                  <div className="text-xs text-slate-500">Thực lãnh</div>
                  <div className="font-semibold text-emerald-600">{vnd(editing.netSalary)}</div>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-slate-400">
                Lương theo công = mức lương ÷ công chuẩn × công thực tế. Sửa giờ vào/ra bên dưới, số liệu tự tính lại.
              </p>
            </div>

            {locked && (
              <div className="mb-3 rounded-xl bg-slate-100 px-3 py-2 text-sm text-slate-600">
                🔒 Tháng đã chốt — chỉ xem. Bấm “Mở lại” ở trên nếu cần sửa công.
              </div>
            )}

            {/* Form sửa/thêm 1 ngày (ẩn khi tháng đã chốt) */}
            {!locked && (
            <div className="bg-slate-50 rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <label className="text-xs text-slate-500">
                  Ngày
                  <input
                    type="date"
                    className="input py-1"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </label>
                <label className="text-xs text-slate-500">
                  Sáng vào
                  <input type="time" className="input py-1" value={form.morningIn} onChange={(e) => setForm({ ...form, morningIn: e.target.value })} />
                </label>
                <label className="text-xs text-slate-500">
                  Sáng ra
                  <input type="time" className="input py-1" value={form.morningOut} onChange={(e) => setForm({ ...form, morningOut: e.target.value })} />
                </label>
                <label className="text-xs text-slate-500">
                  Chiều vào
                  <input type="time" className="input py-1" value={form.afternoonIn} onChange={(e) => setForm({ ...form, afternoonIn: e.target.value })} />
                </label>
                <label className="text-xs text-slate-500">
                  Chiều ra
                  <input type="time" className="input py-1" value={form.afternoonOut} onChange={(e) => setForm({ ...form, afternoonOut: e.target.value })} />
                </label>
                <label className="text-xs text-slate-500">
                  Chế độ
                  <select className="input py-1" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                    <option value="office">Tại văn phòng</option>
                    <option value="online">Online</option>
                    <option value="leave">Nghỉ phép</option>
                    <option value="holiday">Nghỉ lễ</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-slate-400">
                Công tự tính: có giờ vào ca sáng = 0.5, có giờ vào ca chiều = 0.5 (đủ 2 ca = 1 công).
              </p>
              <button className="btn-primary" onClick={saveAttn} disabled={savingAttn}>
                {savingAttn ? 'Đang lưu…' : 'Lưu ngày này'}
              </button>
            </div>
            )}

            {/* Danh sách ngày trong tháng */}
            <div className="overflow-x-auto mt-3">
              <table className="w-full text-sm">
                <thead className="text-left text-slate-500">
                  <tr>
                    <th className="py-1">Ngày</th>
                    <th>Sáng</th>
                    <th>Chiều</th>
                    <th className="text-center">Công</th>
                    <th>Chế độ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((a) => (
                    <tr key={a.date} className="border-t">
                      <td className="py-1">{a.date}</td>
                      <td>{a.morningIn || '—'}–{a.morningOut || '—'}</td>
                      <td>{a.afternoonIn || '—'}–{a.afternoonOut || '—'}</td>
                      <td className="text-center">{a.dayFraction}</td>
                      <td>{a.mode}</td>
                      <td className="text-right">
                        {!locked && (
                          <button className="text-brand-600 underline text-xs" onClick={() => setForm({ ...a })}>
                            sửa
                          </button>
                        )}
                      </td>
                    </tr>
                  ))}
                  {records.length === 0 && (
                    <tr>
                      <td colSpan={6} className="py-2 text-slate-500">
                        Chưa có ngày chấm công nào trong tháng.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
