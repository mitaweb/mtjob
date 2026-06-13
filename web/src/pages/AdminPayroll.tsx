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
  const [msg, setMsg] = useState('');

  // Attendance editor state
  const [editing, setEditing] = useState<PayRow | null>(null);
  const [records, setRecords] = useState<AttnRow[]>([]);
  const [form, setForm] = useState<AttnRow>(blankAttn());
  const [savingAttn, setSavingAttn] = useState(false);

  function qs() {
    const [y, m] = ym.split('-');
    return `year=${y}&month=${Number(m)}`;
  }

  async function loadPayroll() {
    const r = await api<{ rows: PayRow[] }>(`/admin/payroll?${qs()}`);
    setRows(r.rows);
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
      await loadPayroll();
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
          <h1 className="text-lg font-bold">Bảng lương & công</h1>
          <p className="text-sm text-slate-500">
            Mức lương lấy từ Google Sheet (tự tính, không sửa ở đây). Cần chỉnh công thì bấm “Sửa công” để sửa giờ vào/ra.
          </p>
        </div>
        <input type="month" className="input max-w-[10rem]" value={ym} onChange={(e) => setYm(e.target.value)} />
      </div>

      {msg && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{msg}</div>}

      <div className="card overflow-x-auto">
        <table className="w-full text-sm">
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
                <td className="py-2">{r.fullName}</td>
                <td>{r.teamId}</td>
                <td className="text-right">{vnd(r.salary)}</td>
                <td className="text-center">
                  {r.actualDays}/{r.standardDays}
                </td>
                <td className="text-right font-medium text-emerald-600">{vnd(r.netSalary)}</td>
                <td className="text-right">
                  <button className="btn-ghost text-xs px-2 py-1" onClick={() => openEditor(r)}>
                    Sửa công
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
              <h2 className="font-semibold">Sửa công — {editing.fullName} ({ym})</h2>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setEditing(null)}>
                ✕ Đóng
              </button>
            </div>

            {/* Form sửa/thêm 1 ngày */}
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
                        <button className="text-brand-600 underline text-xs" onClick={() => setForm({ ...a })}>
                          sửa
                        </button>
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
