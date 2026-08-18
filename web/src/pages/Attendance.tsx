import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { GIO_VN } from '../lib/gio';
import { getPosition } from '../lib/geo';
import { enablePush } from '../lib/push';

interface Record_ {
  date: string;
  morningInAt?: string;
  morningOutAt?: string;
  afternoonInAt?: string;
  afternoonOutAt?: string;
  dayFraction: number;
  mode: string;
  status: string;
}
interface MeResponse {
  totalDays: number;
  records: Record_[];
  /** Ngày làm việc chưa có công — quên chấm hoặc quên làm đơn. */
  missing?: string[];
}

const thangNay = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
};

// Ô giờ có thể chứa cờ thay cho mốc giờ thật (đơn online, đơn quên chấm công) — dịch ra tiếng Việt.
const CO_GIO: Record<string, string> = { online: 'online', quencham: 'quên chấm' };
const hm = (iso?: string) =>
  iso && iso.includes('T')
    ? new Date(iso).toLocaleTimeString('vi-VN', GIO_VN)
    : CO_GIO[iso || ''] || iso || '—';

export default function Attendance() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);
  // Xem lại tháng cũ để soi ngày nào còn thiếu — anh Tâm 2/8/2026.
  const [ym, setYm] = useState(thangNay());

  async function load() {
    const r = await api<MeResponse>(`/attendance/me?month=${ym}`);
    setData(r);
  }
  useEffect(() => {
    load().catch((e) => setMsg((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ym]);

  async function punch(kind: 'checkin' | 'checkout') {
    setBusy(true);
    setMsg('Đang lấy vị trí…');
    try {
      const pos = await getPosition();
      const r = await api<{ shift: string; time: string; late: boolean; distanceM: number; dayFraction: number }>(
        `/attendance/${kind}`,
        // Gửi kèm sai số: máy chủ cần biết con số khoảng cách có đáng tin không.
        { body: { lat: pos.lat, lng: pos.lng, accuracy: Math.round(pos.accuracy || 0) } },
      );
      setMsg(
        `✅ Chấm công thành công — ca ${r.shift === 'morning' ? 'sáng' : 'chiều'}, ${kind === 'checkin' ? 'giờ vào' : 'giờ ra'} ${hm(
          r.time,
        )}${r.late ? ' (đi trễ)' : ''}. Cách công ty ~${r.distanceM}m. Ngày công: ${r.dayFraction}.`,
      );
      await load();
    } catch (e) {
      setMsg(`⚠️ ${(e as Error).message}`);
    } finally {
      setBusy(false);
    }
  }

  const today = new Date().toISOString().slice(0, 10);
  const todayRec = data?.records.find((r) => r.date === today);

  return (
    <div className="space-y-4">
      <div className="card">
        <h1 className="text-lg font-bold mb-1">Chấm công GPS</h1>
        <p className="text-sm text-ink-muted">Ca sáng 08:30–12:00 · Ca chiều 13:30–17:00. Hãy ở gần văn phòng khi chấm công.</p>
        <div className="flex gap-2 mt-3">
          <button className="btn-primary flex-1" onClick={() => punch('checkin')} disabled={busy}>
            ⬇️ Giờ vào
          </button>
          <button className="btn-ghost flex-1" onClick={() => punch('checkout')} disabled={busy}>
            ⬆️ Giờ ra
          </button>
        </div>
        {msg && <div className="mt-3 text-sm rounded-lg bg-brand-50 px-3 py-2">{msg}</div>}
        <button
          className="mt-3 text-sm text-brand-600 underline"
          onClick={() => enablePush().then((r) => setMsg(r.message))}
        >
          Bật thông báo đẩy
        </button>
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Hôm nay ({today})</h2>
        {todayRec ? (
          <div className="grid grid-cols-2 gap-2 text-sm">
            <div>Ca sáng vào: <b>{hm(todayRec.morningInAt)}</b></div>
            <div>Ca sáng ra: <b>{hm(todayRec.morningOutAt)}</b></div>
            <div>Ca chiều vào: <b>{hm(todayRec.afternoonInAt)}</b></div>
            <div>Ca chiều ra: <b>{hm(todayRec.afternoonOutAt)}</b></div>
            <div>Ngày công: <b>{todayRec.dayFraction}</b></div>
            <div>Trạng thái: <b>{todayRec.status}</b></div>
          </div>
        ) : (
          <p className="text-sm text-ink-muted">Chưa chấm công hôm nay.</p>
        )}
      </div>

      <div className="card">
        <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">Tổng công: {data?.totalDays ?? 0} ngày</h2>
          <input
            type="month"
            className="input max-w-[10rem] py-1"
            value={ym}
            max={thangNay()}
            onChange={(e) => e.target.value && setYm(e.target.value)}
          />
        </div>

        {/* Ngày làm việc chưa có công — thứ nhân sự cần thấy nhất, nên đặt trên bảng. */}
        {!!data?.missing?.length && (
          <div className="mb-3 rounded-xl border border-amber-200 bg-amber-50 p-3">
            <div className="text-sm font-medium text-amber-800">
              ⚠️ {data.missing.length} ngày làm việc chưa có công
            </div>
            <div className="mt-1 flex flex-wrap gap-1.5">
              {data.missing.map((d) => (
                <span key={d} className="rounded-md bg-white px-2 py-0.5 text-xs text-amber-800">
                  {d.slice(8, 10)}/{d.slice(5, 7)}
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-xs text-amber-700">
              Quên chấm công hoặc quên làm đơn nghỉ/online. Vào mục Đơn từ nộp bù, hoặc báo quản lý.
            </p>
          </div>
        )}
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-ink-muted">
              <tr>
                <th className="py-1">Ngày</th>
                <th>Sáng</th>
                <th>Chiều</th>
                <th>Công</th>
                <th>Chế độ</th>
              </tr>
            </thead>
            <tbody>
              {(data?.records ?? []).map((r) => (
                <tr key={r.date} className="border-t">
                  <td className="py-1">{r.date}</td>
                  <td>{hm(r.morningInAt)}–{hm(r.morningOutAt)}</td>
                  <td>{hm(r.afternoonInAt)}–{hm(r.afternoonOutAt)}</td>
                  <td>{r.dayFraction}</td>
                  <td>{r.mode}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}
