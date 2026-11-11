// Mức độ thông báo (học Javis — anh Tâm 11/11/2026): chỉ việc khẩn mới đổ chuông; còn lại hiện im lặng hoặc chỉ nằm
// trong chuông app. Áp cho mọi người trong công ty. Chỉ giám đốc chỉnh.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';

type MucDo = 'khan' | 'thuong' | 'im';
interface DuLieu {
  loai: Record<string, { ten: string; macDinh: MucDo }>;
  mucDo: Record<MucDo, string>;
  caiDat: Record<string, MucDo>;
}

const MAU: Record<MucDo, string> = { khan: 'text-red-700', thuong: 'text-ocean-700', im: 'text-ink-muted' };

export default function AdminMucDoThongBao() {
  const toast = useToast();
  const [d, setD] = useState<DuLieu | null>(null);
  const [chon, setChon] = useState<Record<string, MucDo>>({});

  useEffect(() => {
    api<DuLieu>('/admin/muc-do-thong-bao')
      .then((r) => {
        setD(r);
        setChon(r.caiDat);
      })
      .catch(() => undefined);
  }, []);

  if (!d) return <div className="card text-sm text-ink-muted">Đang tải…</div>;
  const muc = (k: string): MucDo => chon[k] || d.loai[k]!.macDinh;

  async function luu() {
    // Chỉ lưu loại khác mặc định — sau này đổi mặc định thì loại anh chưa chỉnh tự theo.
    const caiDat: Record<string, MucDo> = {};
    for (const k of Object.keys(d!.loai)) if (muc(k) !== d!.loai[k]!.macDinh) caiDat[k] = muc(k);
    const r = await api<{ caiDat: Record<string, MucDo> }>('/admin/muc-do-thong-bao', { body: { caiDat } });
    setChon(r.caiDat);
    toast.success('Đã lưu mức độ thông báo');
  }

  return (
    <div className="card space-y-3">
      <div>
        <h2 className="font-semibold">🔔 Mức độ thông báo</h2>
        <p className="text-sm text-ink-muted">
          Chỉ việc <b>khẩn</b> mới đổ chuông / rung. <b>Thường</b>: hiện trên máy nhưng im lặng. <b>Chỉ trong app</b>: không đẩy ra
          máy, vẫn nằm trong chuông 🔔 của app. Áp cho mọi người.
        </p>
      </div>
      <div className="divide-y divide-brand-100">
        {Object.entries(d.loai).map(([k, v]) => (
          <label key={k} className="flex flex-wrap items-center justify-between gap-2 py-2">
            <span className="text-sm">{v.ten}</span>
            <select className={`input w-auto py-1 text-sm ${MAU[muc(k)]}`} value={muc(k)} onChange={(e) => setChon({ ...chon, [k]: e.target.value as MucDo })}>
              {(Object.keys(d.mucDo) as MucDo[]).map((m) => (
                <option key={m} value={m}>
                  {d.mucDo[m]}
                  {m === v.macDinh ? ' (mặc định)' : ''}
                </option>
              ))}
            </select>
          </label>
        ))}
      </div>
      <AsyncButton className="btn-primary" onClick={luu} busyLabel="Đang lưu…">
        Lưu
      </AsyncButton>
    </div>
  );
}
