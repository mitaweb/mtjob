// Vị trí chấm công (anh Tâm 22/10/2026: "có bạn ở cty nhưng gps nhận 2000m"). Toạ độ công ty cài lệch thì ai cũng
// "cách công ty" cùng một khoảng — 22/10 mọi người ~280m trong khi bán kính 300m, GPS lệch thêm chút là bị chặn.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { getPosition } from '../lib/geo';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';

interface ViTri {
  lat: number;
  lng: number;
  banKinh: number;
  goiY: null | { lat: number; lng: number; soLan: number; khoangCachTrungVi: number };
}

/** Khoảng cách (m) giữa hai toạ độ. */
function khoangCach(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371000;
  const r = (d: number) => (d * Math.PI) / 180;
  const x = Math.sin(r(b.lat - a.lat) / 2) ** 2 + Math.cos(r(a.lat)) * Math.cos(r(b.lat)) * Math.sin(r(b.lng - a.lng) / 2) ** 2;
  return Math.round(2 * R * Math.asin(Math.min(1, Math.sqrt(x))));
}

export default function AdminViTriChamCong() {
  const toast = useToast();
  const [vt, setVt] = useState<ViTri | null>(null);
  const [banKinh, setBanKinh] = useState('');

  async function tai() {
    const r = await api<ViTri>('/admin/vi-tri-cham-cong');
    setVt(r);
    setBanKinh(String(r.banKinh));
  }
  useEffect(() => {
    tai().catch(() => undefined);
  }, []);

  async function datToaDo(lat: number, lng: number, nguon: string) {
    if (!confirm(`Đặt vị trí công ty = ${nguon}\n(${lat.toFixed(6)}, ${lng.toFixed(6)})?`)) return;
    await api('/admin/config', { body: { key: 'companyLat', value: lat.toFixed(7) } });
    await api('/admin/config', { body: { key: 'companyLng', value: lng.toFixed(7) } });
    toast.success('Đã lưu vị trí công ty');
    await tai();
  }

  async function luuBanKinh() {
    const n = Math.round(Number(banKinh));
    if (!(n >= 50 && n <= 2000)) return toast.error('Bán kính từ 50 đến 2000 m');
    await api('/admin/config', { body: { key: 'checkinRadiusM', value: String(n) } });
    toast.success('Đã lưu bán kính');
    await tai();
  }

  if (!vt) return null;
  const lech = vt.goiY ? khoangCach(vt, vt.goiY) : 0;
  return (
    <div className="card space-y-2">
      <h2 className="font-semibold">📍 Vị trí chấm công</h2>
      <p className="text-sm text-ink-soft">
        Đang cài: <b>{vt.lat.toFixed(6)}, {vt.lng.toFixed(6)}</b> · bán kính <b>{vt.banKinh} m</b> ·{' '}
        <a className="text-ocean-600 underline" href={`https://www.google.com/maps?q=${vt.lat},${vt.lng}`} target="_blank" rel="noreferrer">
          xem bản đồ
        </a>
      </p>
      {vt.goiY && (
        <div className={`rounded-xl p-3 text-sm ${lech > 100 ? 'bg-amber-50 text-amber-900' : 'bg-brand-50'}`}>
          Theo {vt.goiY.soLan} lần chấm công ở văn phòng 30 ngày qua, mọi người thường "cách công ty" <b>~{vt.goiY.khoangCachTrungVi} m</b>.
          Vị trí văn phòng thực tế (trung vị): <b>{vt.goiY.lat.toFixed(6)}, {vt.goiY.lng.toFixed(6)}</b> — lệch {lech} m so với toạ độ
          đang cài.{' '}
          <a className="text-ocean-600 underline" href={`https://www.google.com/maps?q=${vt.goiY.lat},${vt.goiY.lng}`} target="_blank" rel="noreferrer">
            xem bản đồ
          </a>
          {lech > 100 && ' Toạ độ đang cài lệch nhiều — ai GPS lệch thêm chút là bị báo "ở xa".'}
          <div className="mt-2">
            <AsyncButton className="btn-primary py-1.5 text-sm" onClick={() => datToaDo(vt.goiY!.lat, vt.goiY!.lng, 'vị trí trung vị các lần chấm công')}>
              Dùng vị trí này
            </AsyncButton>
          </div>
        </div>
      )}
      <div className="flex flex-wrap items-end gap-2">
        <AsyncButton
          className="btn-ghost py-1.5 text-sm"
          busyLabel="Đang lấy vị trí…"
          onClick={async () => {
            const p = await getPosition();
            if (p.accuracy > 50) return toast.error(`Vị trí điện thoại chưa đủ chính xác (sai số ${Math.round(p.accuracy)} m) — ra gần cửa sổ rồi thử lại`);
            await datToaDo(p.lat, p.lng, 'vị trí điện thoại anh đang đứng (phải đang ở văn phòng)');
          }}
        >
          📱 Lấy vị trí điện thoại tôi (đang ở văn phòng)
        </AsyncButton>
        <label className="text-sm">
          <span className="label">Bán kính (m)</span>
          <input className="input w-28 py-1.5" inputMode="numeric" value={banKinh} onChange={(e) => setBanKinh(e.target.value)} />
        </label>
        <AsyncButton className="btn-ghost py-1.5 text-sm" onClick={luuBanKinh}>
          Lưu bán kính
        </AsyncButton>
      </div>
    </div>
  );
}
