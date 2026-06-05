import { useEffect, useState } from 'react';
import { api } from '../lib/api';
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
}

const hm = (iso?: string) => (iso && iso.includes('T') ? new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' }) : iso || '—');

export default function Attendance() {
  const [data, setData] = useState<MeResponse | null>(null);
  const [msg, setMsg] = useState('');
  const [busy, setBusy] = useState(false);

  async function load() {
    const r = await api<MeResponse>('/attendance/me');
    setData(r);
  }
  useEffect(() => {
    load().catch((e) => setMsg((e as Error).message));
  }, []);

  async function punch(kind: 'checkin' | 'checkout') {
    setBusy(true);
    setMsg('Đang lấy vị trí…');
    try {
      const pos = await getPosition();
      const r = await api<{ shift: string; time: string; late: boolean; distanceM: number; dayFraction: number }>(
        `/attendance/${kind}`,
        { body: { lat: pos.lat, lng: pos.lng } },
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
        <p className="text-sm text-slate-500">Ca sáng 08:30–12:00 · Ca chiều 13:30–17:00. Hãy ở gần văn phòng khi chấm công.</p>
        <div className="flex gap-2 mt-3">
          <button className="btn-primary flex-1" onClick={() => punch('checkin')} disabled={busy}>
            ⬇️ Giờ vào
          </button>
          <button className="btn-ghost flex-1" onClick={() => punch('checkout')} disabled={busy}>
            ⬆️ Giờ ra
          </button>
        </div>
        {msg && <div className="mt-3 text-sm rounded-lg bg-slate-50 px-3 py-2">{msg}</div>}
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
          <p className="text-sm text-slate-500">Chưa chấm công hôm nay.</p>
        )}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Tháng này — tổng công: {data?.totalDays ?? 0} ngày</h2>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead className="text-left text-slate-500">
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
