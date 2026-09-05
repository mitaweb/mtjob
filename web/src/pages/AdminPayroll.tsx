import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { vnd, currentYm } from '../lib/format';
import TimeInput from '../components/TimeInput';
import KyLuatThang, { type TongKetKyLuat } from '../components/KyLuatThang';
import { sapXep, TEN_COT, type XepTheo } from '../lib/xep';

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
  soLanTre: number;
  soLanSom: number;
  soLanKhongDon: number;
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
  const [xep, setXep] = useState<XepTheo>('');
  const [nguoc, setNguoc] = useState(false);

  // Chưa chọn cột nào thì giữ nguyên thứ tự máy chủ trả về (theo tên).
  const daXep = useMemo(() => sapXep(rows, xep, nguoc), [rows, xep, nguoc]);

  /**
   * Bấm một cột: cột mới thì xếp theo chiều DỄ ĐỌC NHẤT của kiểu dữ liệu đó
   * (chữ A→Z, số cao→thấp); bấm lại chính cột đó thì đảo chiều.
   */
  function bamCot(cot: XepTheo) {
    if (cot === xep) setNguoc((v) => !v);
    else {
      setXep(cot);
      setNguoc(false);
    }
  }

  function ymNums() {
    const [y, m] = ym.split('-');
    return { year: Number(y), month: Number(m) };
  }

  // Attendance editor state
  const [editing, setEditing] = useState<PayRow | null>(null);
  const [records, setRecords] = useState<AttnRow[]>([]);
  const [form, setForm] = useState<AttnRow>(blankAttn());
  const [savingAttn, setSavingAttn] = useState(false);
  const [kyLuat, setKyLuat] = useState<TongKetKyLuat | null>(null);

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
    // Bày số đi trễ/về sớm NGAY TRÊN hộp xác nhận: chốt xong là mỗi người nhận một tin
    // nhắn cảnh báo, nên anh phải nhìn thấy danh sách trước khi nó gửi đi.
    const viPham = rows.filter((r) => r.soLanTre > 0 || r.soLanSom > 0);
    const bang = viPham
      .map((r) => {
        const ve = [r.soLanTre > 0 ? `trễ ${r.soLanTre}` : '', r.soLanSom > 0 ? `sớm ${r.soLanSom}` : '']
          .filter(Boolean)
          .join(', ');
        return `• ${r.fullName}: ${ve}${r.soLanKhongDon > 0 ? ` (${r.soLanKhongDon} lần chưa có đơn)` : ''}`;
      })
      .join('\n');
    const nhac = viPham.length
      ? `\n\nTháng này có ${viPham.length} người đi trễ / về sớm:\n${bang}\n\nChốt xong, mỗi người sẽ nhận một thông báo nhắc nhở.`
      : '\n\nTháng này không ai đi trễ hay về sớm.';

    if (
      !confirm(
        'Chốt lương tháng này? Số liệu sẽ được đóng băng — nhân sự nghỉ sau vẫn giữ nguyên, sửa mức lương/công về sau không làm đổi tháng này. Vẫn có thể "Mở lại" nếu cần.' +
          nhac,
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
      const r = await api<{ records: AttnRow[]; kyLuat: TongKetKyLuat }>(
        `/admin/attendance?memberId=${row.memberId}&${qs()}`,
      );
      setRecords(r.records);
      setKyLuat(r.kyLuat);
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
      const r = await api<{ records: AttnRow[]; kyLuat: TongKetKyLuat }>(
        `/admin/attendance?memberId=${editing.memberId}&${qs()}`,
      );
      setRecords(r.records);
      setKyLuat(r.kyLuat); // sửa giờ vào/ra là số lần trễ đổi theo — phải tính lại ngay

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
              <span className="rounded-full bg-ink px-2 py-0.5 text-xs font-medium text-white">🔒 Đã chốt</span>
            )}
          </h1>
          <p className="text-sm text-ink-muted">
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

      {msg && <div className="text-sm text-ink-soft bg-brand-50 rounded-lg px-3 py-2">{msg}</div>}

      <div className="card overflow-x-auto">
        {/* Điện thoại không có tiêu đề cột để bấm → chọn thứ tự bằng ô này. */}
        <label className="mb-2 flex items-center gap-2 md:hidden">
          <span className="text-xs text-ink-muted whitespace-nowrap">Xếp theo</span>
          <select
            className="input py-1 text-sm"
            value={xep ? `${xep}:${nguoc ? 'd' : 'a'}` : ''}
            onChange={(e) => {
              const [cot, chieu] = e.target.value.split(':');
              setXep(cot as XepTheo);
              setNguoc(chieu === 'd');
            }}
          >
            <option value="">Mặc định (theo tên)</option>
            <option value="teamId:a">Team A → Z</option>
            <option value="salary:a">Mức lương cao → thấp</option>
            <option value="salary:d">Mức lương thấp → cao</option>
            <option value="bhxhDeduction:a">Trừ BHXH cao → thấp</option>
            <option value="netSalary:a">Thực lãnh cao → thấp</option>
            <option value="actualDays:d">Công ít → nhiều</option>
          </select>
        </label>

        {/* Mobile: dạng thẻ cho dễ đọc */}
        <ul className="md:hidden divide-y">
          {daXep.map((r) => (
            <li key={r.memberId} className="py-2 text-sm">
              <div className="flex items-center justify-between gap-2">
                <button
                  className="font-semibold text-brand-700 underline-offset-2 hover:underline"
                  onClick={() => openEditor(r)}
                >
                  {r.fullName}
                </button>
                <span className="font-semibold text-emerald-700">{vnd(r.netSalary)}</span>
              </div>
              <div className="mt-0.5 flex items-center justify-between gap-2">
                <span className="text-xs text-ink-muted">
                  {r.teamId || '—'} · Công {r.actualDays}/{r.standardDays} · Mức lương {vnd(r.salary)}
                  {r.bhxhDeduction > 0 && <> · BHXH −{vnd(r.bhxhDeduction)}</>}
                </span>
                <button className="btn-ghost text-xs px-2 py-1 whitespace-nowrap" onClick={() => openEditor(r)}>
                  Chi tiết
                </button>
              </div>
            </li>
          ))}
          {rows.length === 0 && <li className="py-3 text-sm text-ink-muted">Chưa có dữ liệu.</li>}
        </ul>
        <table className="w-full text-sm hidden md:table">
          <thead className="text-left text-ink-muted">
            <tr>
              <ThXep cot="fullName" xep={xep} nguoc={nguoc} onBam={bamCot} className="py-1" />
              <ThXep cot="teamId" xep={xep} nguoc={nguoc} onBam={bamCot} />
              <ThXep cot="salary" xep={xep} nguoc={nguoc} onBam={bamCot} canh="right" />
              <ThXep cot="actualDays" xep={xep} nguoc={nguoc} onBam={bamCot} canh="center" />
              <ThXep cot="bhxhDeduction" xep={xep} nguoc={nguoc} onBam={bamCot} canh="right" />
              <ThXep cot="netSalary" xep={xep} nguoc={nguoc} onBam={bamCot} canh="right" />
              <th></th>
            </tr>
          </thead>
          <tbody>
            {daXep.map((r) => (
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
                <td className="text-right">
                  {r.bhxhDeduction > 0 ? (
                    <span className="text-rose-700">−{vnd(r.bhxhDeduction)}</span>
                  ) : (
                    <span className="text-ink-faint">—</span>
                  )}
                </td>
                <td className="text-right font-medium text-emerald-700">{vnd(r.netSalary)}</td>
                <td className="text-right">
                  <button className="btn-ghost text-xs px-2 py-1" onClick={() => openEditor(r)}>
                    Chi tiết
                  </button>
                </td>
              </tr>
            ))}
            {rows.length === 0 && (
              <tr>
                <td colSpan={7} className="py-3 text-ink-muted">
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
                  <div className="text-xs text-ink-muted">Mức lương</div>
                  <div className="font-medium">{vnd(editing.salary)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Công thực tế / chuẩn</div>
                  <div className="font-medium">
                    {editing.actualDays}/{editing.standardDays} ngày
                  </div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Lương theo công</div>
                  <div className="font-medium">{vnd(editing.proratedSalary)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Trừ BHXH</div>
                  <div className="font-medium text-rose-600">−{vnd(editing.bhxhDeduction)}</div>
                </div>
                <div>
                  <div className="text-xs text-ink-muted">Thực lãnh</div>
                  <div className="font-semibold text-emerald-700">{vnd(editing.netSalary)}</div>
                </div>
              </div>
              <p className="mt-1.5 text-xs text-ink-faint">
                Lương theo công = mức lương ÷ công chuẩn × công thực tế. Sửa giờ vào/ra bên dưới, số liệu tự tính lại.
              </p>
            </div>

            <div className="mb-3">
              <KyLuatThang kyLuat={kyLuat} tieuDe="Đi trễ / về sớm tháng này" />
            </div>

            {locked && (
              <div className="mb-3 rounded-xl bg-brand-100 px-3 py-2 text-sm text-ink-soft">
                🔒 Tháng đã chốt — chỉ xem. Bấm “Mở lại” ở trên nếu cần sửa công.
              </div>
            )}

            {/* Form sửa/thêm 1 ngày (ẩn khi tháng đã chốt) */}
            {!locked && (
            <div className="bg-brand-50 rounded-xl p-3 space-y-2">
              <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
                <label className="text-xs text-ink-muted">
                  Ngày
                  <input
                    type="date"
                    className="input py-1"
                    value={form.date}
                    onChange={(e) => setForm({ ...form, date: e.target.value })}
                  />
                </label>
                <label className="text-xs text-ink-muted">
                  Sáng vào
                  <TimeInput className="py-1" value={form.morningIn} onChange={(v) => setForm({ ...form, morningIn: v })} />
                </label>
                <label className="text-xs text-ink-muted">
                  Sáng ra
                  <TimeInput className="py-1" value={form.morningOut} onChange={(v) => setForm({ ...form, morningOut: v })} />
                </label>
                <label className="text-xs text-ink-muted">
                  Chiều vào
                  <TimeInput className="py-1" value={form.afternoonIn} onChange={(v) => setForm({ ...form, afternoonIn: v })} />
                </label>
                <label className="text-xs text-ink-muted">
                  Chiều ra
                  <TimeInput className="py-1" value={form.afternoonOut} onChange={(v) => setForm({ ...form, afternoonOut: v })} />
                </label>
                <label className="text-xs text-ink-muted">
                  Chế độ
                  <select className="input py-1" value={form.mode} onChange={(e) => setForm({ ...form, mode: e.target.value })}>
                    <option value="office">Tại văn phòng</option>
                    <option value="online">Online</option>
                    <option value="leave">Nghỉ phép</option>
                    <option value="holiday">Nghỉ lễ</option>
                  </select>
                </label>
              </div>
              <p className="text-xs text-ink-faint">
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
                <thead className="text-left text-ink-muted">
                  <tr>
                    <th className="py-1 w-8 text-right pr-2">#</th>
                    <th className="py-1">Ngày</th>
                    <th>Sáng</th>
                    <th>Chiều</th>
                    <th className="text-center">Công</th>
                    <th>Chế độ</th>
                    <th></th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((a, i) => (
                    <tr key={a.date} className="border-t">
                      {/* Đánh số theo thứ tự đang hiển thị (mới nhất là 1) để dễ đối chiếu khi đọc cùng nhau. */}
                      <td className="py-1 pr-2 text-right text-xs text-ink-faint">{i + 1}</td>
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
                      <td colSpan={7} className="py-2 text-ink-muted">
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

      <ThuongKpiThang ym={ym} />
    </div>
  );
}

interface BonusLine {
  memberId: string;
  fullName: string;
  teamId: string;
  projectId: string;
  projectName: string;
  vaiTro: 'leader' | 'member';
  tyLe: number | null;
  amount: number;
}

/**
 * Thưởng KPI dự án của cả công ty trong tháng — để giám đốc xem rồi tự chi.
 * KHÔNG cộng vào lương thực lãnh (anh Tâm chốt để riêng như thưởng điểm).
 */
function ThuongKpiThang({ ym }: { ym: string }) {
  const [lines, setLines] = useState<BonusLine[]>([]);
  const [chuaPhanCong, setChuaPhanCong] = useState<Array<{ id: string; fullName: string; teamId: string }>>([]);
  const [msg, setMsg] = useState('');

  useEffect(() => {
    const [y, m] = ym.split('-');
    api<{ lines: BonusLine[]; chuaPhanCong: Array<{ id: string; fullName: string; teamId: string }> }>(
      `/projects/bonus/all?year=${y}&month=${Number(m)}`,
    )
      .then((r) => {
        setLines(r.lines);
        setChuaPhanCong(r.chuaPhanCong);
        setMsg('');
      })
      .catch((e) => setMsg((e as Error).message));
  }, [ym]);

  // Gom theo người: một người có thể ăn thưởng từ nhiều dự án.
  const theoNguoi = new Map<string, { fullName: string; teamId: string; tong: number; duAn: BonusLine[] }>();
  for (const l of lines) {
    const o = theoNguoi.get(l.memberId) || { fullName: l.fullName, teamId: l.teamId, tong: 0, duAn: [] };
    o.tong += l.amount;
    o.duAn.push(l);
    theoNguoi.set(l.memberId, o);
  }
  const dsNguoi = [...theoNguoi.entries()].sort((a, b) => b[1].tong - a[1].tong);
  const tongChi = lines.reduce((s, l) => s + l.amount, 0);

  return (
    <div className="card">
      <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
        <h2 className="font-semibold">🎯 Thưởng KPI dự án (tháng {ym})</h2>
        <span className="text-lg font-bold text-emerald-700">{vnd(tongChi)}</span>
      </div>
      <p className="mb-2 text-xs text-ink-muted">
        Không cộng vào lương thực lãnh — bảng này để anh xem rồi chi riêng.
      </p>

      {msg && <p className="text-sm text-amber-700">{msg}</p>}

      {/* Ai chưa được phân công — bảng này PHẢI rỗng, vì không phân công là không có thưởng. */}
      {chuaPhanCong.length > 0 && (
        <div className="mb-3 rounded-xl border border-amber-300 bg-amber-50 p-3">
          <div className="text-sm font-semibold text-amber-900">
            ⚠️ {chuaPhanCong.length} người chưa được phân công dự án nào
          </div>
          <p className="mt-1 text-xs text-amber-800">
            Không thuộc dự án nào thì không có thưởng KPI. Nhắc leader phân công trước khi chốt lương —
            chốt rồi thì không sửa được nữa.
          </p>
          <div className="mt-2 flex flex-wrap gap-1.5">
            {chuaPhanCong.map((m) => (
              <span key={m.id} className="rounded-md bg-white px-2 py-0.5 text-xs text-amber-800">
                {m.fullName}
                {m.teamId ? ` · ${m.teamId}` : ''}
              </span>
            ))}
          </div>
        </div>
      )}

      {dsNguoi.length === 0 ? (
        <p className="text-sm text-ink-muted">
          Tháng này chưa có thưởng KPI nào. Đặt mức thưởng cho từng (dự án × phòng) ở trang Dự án.
        </p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1">Nhân sự</th>
                <th>Phòng</th>
                <th>Dự án</th>
                <th className="text-right">Thưởng</th>
              </tr>
            </thead>
            <tbody>
              {dsNguoi.map(([id, o]) => (
                <tr key={id} className="border-t align-top">
                  <td className="py-1 font-medium">{o.fullName}</td>
                  <td className="text-ink-muted">{o.teamId}</td>
                  <td className="text-xs text-ink-muted">
                    {o.duAn.map((l) => (
                      <div key={`${l.projectId}-${l.vaiTro}`}>
                        {l.projectName}
                        {l.vaiTro === 'leader' && <span className="text-brand-600"> (leader)</span>}
                        {' · '}
                        {l.tyLe === null ? 'chưa đo được' : `${l.tyLe}%`}
                        {' → '}
                        {vnd(l.amount)}
                      </div>
                    ))}
                  </td>
                  <td className="text-right font-medium text-emerald-700">{vnd(o.tong)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

/**
 * Tiêu đề cột bấm được để xếp thứ tự.
 *
 * Cả ô `th` là nút chứ không phải chỉ chữ bên trong: vùng bấm rộng bằng cả ô, không phải
 * nhắm đúng mấy chữ nhỏ. Mũi tên chỉ hiện ở cột đang xếp — hiện ở mọi cột thì rối mắt mà
 * không nói thêm được gì.
 */
function ThXep({
  cot,
  xep,
  nguoc,
  onBam,
  canh = 'left',
  className = '',
}: {
  cot: Exclude<XepTheo, ''>;
  xep: XepTheo;
  nguoc: boolean;
  onBam: (c: XepTheo) => void;
  canh?: 'left' | 'center' | 'right';
  className?: string;
}) {
  const dangXep = xep === cot;
  const canhCol = canh === 'right' ? 'text-right' : canh === 'center' ? 'text-center' : 'text-left';
  const canhNut = canh === 'right' ? 'justify-end' : canh === 'center' ? 'justify-center' : 'justify-start';
  return (
    <th className={`${canhCol} ${className}`} aria-sort={dangXep ? (nguoc ? 'descending' : 'ascending') : 'none'}>
      <button
        type="button"
        onClick={() => onBam(cot)}
        title={`Xếp theo ${TEN_COT[cot]}`}
        className={`flex w-full items-center gap-1 py-1 ${canhNut} ${
          dangXep ? 'font-semibold text-ink' : 'text-ink-muted'
        } hover:text-ink`}
      >
        <span>{TEN_COT[cot]}</span>
        <span aria-hidden="true" className={dangXep ? '' : 'invisible'}>
          {nguoc ? '▲' : '▼'}
        </span>
      </button>
    </th>
  );
}
