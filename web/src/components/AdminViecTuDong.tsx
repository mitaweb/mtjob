// Việc tự động (học Javis — anh Tâm 11/11/2026): việc lặp theo lịch do trợ lý CHỈ ĐỌC chạy, kết quả qua bước kiểm lại,
// sai 3 lần liền thì tự dừng. Tạo bằng lời trong chat ("mỗi sáng 8h báo chi tiêu Ads khách X") hoặc ở đây.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';

interface Viec {
  id: string;
  ten: string;
  yeuCau: string;
  lich: string;
  trangThai: 'chay' | 'dung' | 'tu_dung';
  soLanLoi: number;
  ketQua: string;
  lyDo: string;
  lanChay: string;
}

const TT: Record<Viec['trangThai'], { chu: string; mau: string }> = {
  chay: { chu: 'đang chạy', mau: 'bg-green-100 text-green-800' },
  dung: { chu: 'đã tắt', mau: 'bg-gray-100 text-gray-700' },
  tu_dung: { chu: 'tự dừng — sai 3 lần', mau: 'bg-red-100 text-red-800' },
};
const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const gio = (iso: string) => (iso ? new Date(iso).toLocaleString('vi-VN', { timeZone: 'Asia/Ho_Chi_Minh', hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' }) : '');

export default function AdminViecTuDong() {
  const toast = useToast();
  const [ds, setDs] = useState<Viec[] | null>(null);
  const [canDb, setCanDb] = useState(false);
  const [moRong, setMoRong] = useState('');
  const [f, setF] = useState({ ten: '', yeuCau: '', atTime: '08:00', repeatKind: 'daily', weekday: 1, dayOfMonth: 1, onDate: '' });

  async function tai() {
    const r = await api<{ ds: Viec[]; canCapNhatDb: boolean }>('/viec-tu-dong');
    setDs(r.ds);
    setCanDb(r.canCapNhatDb);
  }
  useEffect(() => {
    tai().catch(() => setDs([]));
  }, []);

  async function tao() {
    await api('/viec-tu-dong', {
      body: { ...f, weekday: Number(f.weekday), dayOfMonth: Number(f.dayOfMonth), onDate: f.repeatKind === 'once' ? f.onDate : undefined },
    });
    setF({ ...f, ten: '', yeuCau: '' });
    toast.success('Đã tạo việc tự động');
    await tai();
  }
  async function chayThu(v: Viec) {
    const r = await api<{ ketQua: string; dat: boolean; lyDo: string }>(`/viec-tu-dong/${v.id}/chay-thu`, { method: 'POST' });
    if (r.dat) toast.success('Chạy thử ĐẠT — xem kết quả bên dưới');
    else toast.error(`Chạy thử TRƯỢT: ${r.lyDo}`);
    setMoRong(v.id);
    await tai();
  }
  async function doi(v: Viec, tt: 'chay' | 'dung') {
    await api(`/viec-tu-dong/${v.id}/trang-thai`, { body: { tt } });
    await tai();
  }
  async function xoa(v: Viec) {
    if (!confirm(`Xoá việc tự động «${v.ten}»?`)) return;
    await api(`/viec-tu-dong/${v.id}`, { method: 'DELETE' });
    await tai();
  }

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">🔁 Việc tự động</h2>
        <p className="text-sm text-ink-muted">
          Tới giờ, trợ lý tự tra số liệu (<b>chỉ đọc</b>, không ghi gì) rồi gửi báo cáo vào chat của anh + thông báo. Kết quả được
          kiểm lại; <b>sai 3 lần liền thì tự dừng</b> và báo khẩn. Tạo nhanh bằng lời trong chat, vd: "mỗi sáng 8h báo chi tiêu
          Google Ads 7 ngày của khách X so với tuần trước".
        </p>
      </div>
      {canDb && <p className="rounded-xl bg-amber-50 p-3 text-sm">Cần bấm <b>🛠 Cập nhật cấu trúc DB</b> trước.</p>}

      {ds === null ? (
        <p className="text-sm text-ink-muted">Đang tải…</p>
      ) : ds.length === 0 ? (
        <p className="text-sm text-ink-muted">Chưa có việc tự động nào.</p>
      ) : (
        <ul className="divide-y divide-brand-100">
          {ds.map((v) => (
            <li key={v.id} className="space-y-2 py-3">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{v.ten}</span>
                <span className={`rounded-full px-2 py-0.5 text-xs ${TT[v.trangThai].mau}`}>{TT[v.trangThai].chu}</span>
                <span className="text-sm text-ink-muted">{v.lich}</span>
              </div>
              <p className="text-sm text-ink-muted">{v.yeuCau}</p>
              {v.lanChay && (
                <button type="button" className="text-left text-sm text-ocean-700 hover:underline" onClick={() => setMoRong(moRong === v.id ? '' : v.id)}>
                  Lần chạy {gio(v.lanChay)} · {v.lyDo ? `trượt: ${v.lyDo}` : 'đạt'} {moRong === v.id ? '▲' : '▼ xem kết quả'}
                </button>
              )}
              {moRong === v.id && v.ketQua && <pre className="max-h-80 overflow-auto whitespace-pre-wrap rounded-xl bg-brand-50 p-3 text-sm">{v.ketQua}</pre>}
              <div className="flex flex-wrap gap-2">
                <AsyncButton className="btn-ghost py-1 text-sm" onClick={() => chayThu(v)} busyLabel="Đang chạy thử (1–3 phút)…">
                  ▶ Chạy thử
                </AsyncButton>
                {v.trangThai === 'chay' ? (
                  <AsyncButton className="btn-ghost py-1 text-sm" onClick={() => doi(v, 'dung')}>
                    ⏸ Tắt
                  </AsyncButton>
                ) : (
                  <AsyncButton className="btn-ghost py-1 text-sm" onClick={() => doi(v, 'chay')}>
                    ▶ Bật lại
                  </AsyncButton>
                )}
                <AsyncButton className="btn-ghost py-1 text-sm text-red-700" onClick={() => xoa(v)}>
                  Xoá
                </AsyncButton>
              </div>
            </li>
          ))}
        </ul>
      )}

      <div className="space-y-2 rounded-xl border border-brand-100 p-3">
        <p className="text-sm font-medium">Thêm việc</p>
        <input className="input" placeholder="Tên ngắn, vd Báo Ads khách X mỗi sáng" value={f.ten} onChange={(e) => setF({ ...f, ten: e.target.value })} />
        <textarea
          className="input min-h-20"
          placeholder="Yêu cầu như anh hỏi trợ lý, vd: Chi tiêu, click, chuyển đổi Google Ads 7 ngày qua của khách X, so với 7 ngày trước đó, nêu chiến dịch tăng / giảm mạnh"
          value={f.yeuCau}
          onChange={(e) => setF({ ...f, yeuCau: e.target.value })}
        />
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <input className="input w-28 py-1.5" type="time" value={f.atTime} onChange={(e) => setF({ ...f, atTime: e.target.value })} />
          <select className="input w-auto py-1.5" value={f.repeatKind} onChange={(e) => setF({ ...f, repeatKind: e.target.value })}>
            <option value="daily">hằng ngày</option>
            <option value="weekly">hằng tuần</option>
            <option value="monthly">hằng tháng</option>
            <option value="once">một lần</option>
          </select>
          {f.repeatKind === 'weekly' && (
            <select className="input w-auto py-1.5" value={f.weekday} onChange={(e) => setF({ ...f, weekday: Number(e.target.value) })}>
              {THU.map((t, i) => (
                <option key={t} value={i}>
                  {t}
                </option>
              ))}
            </select>
          )}
          {f.repeatKind === 'monthly' && (
            <input className="input w-20 py-1.5" type="number" min={1} max={31} value={f.dayOfMonth} onChange={(e) => setF({ ...f, dayOfMonth: Number(e.target.value) })} />
          )}
          {f.repeatKind === 'once' && <input className="input w-40 py-1.5" type="date" value={f.onDate} onChange={(e) => setF({ ...f, onDate: e.target.value })} />}
        </div>
        <AsyncButton className="btn-primary" onClick={tao} busyLabel="Đang tạo…">
          Tạo việc tự động
        </AsyncButton>
      </div>
    </div>
  );
}
