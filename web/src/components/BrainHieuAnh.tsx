// Tab "🧠 Hiểu anh" (anh Tâm 9/11/2026: "bộ não hiện tại phải hiểu được anh thông qua các đoạn chat của anh với nhân
// viên và khách hàng"). Những điều AI hiểu về anh, kèm bằng chứng; anh duyệt / sửa / bỏ / dạy thêm. CHỈ giám đốc.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge, EmptyState, SkeletonRows } from './ui';

const KHIA_CANH: Record<string, string> = {
  cach_noi: '🗣️ Cách anh nói / xưng hô',
  nguyen_tac: '📏 Nguyên tắc làm việc',
  uu_tien: '⭐ Điều anh ưu tiên',
  cach_quyet: '⚖️ Cách anh quyết',
  nguoi: '👥 Với từng người',
  thoi_quen: '🔁 Thói quen',
  khong_thich: '🚫 Điều anh không thích',
};

interface Muc {
  id: string;
  khiaCanh: string;
  noiDung: string;
  doiTuong: string;
  bangChung: string[];
  soLanThay: number;
  trangThai: 'dung' | 'anh_sua' | 'anh_bo';
  nguon: 'zalo' | 'chat' | 'anh_day';
  capNhat: string;
}

interface DuLieu {
  ds: Muc[];
  tinZaloCho: number;
  cauChatCho: number;
  lanHocCuoi: number;
  needsMigrate?: boolean;
}

const NGUON: Record<Muc['nguon'], string> = { zalo: 'từ Zalo', chat: 'từ chat trợ lý', anh_day: 'anh dạy' };

function gioVN(ms: number): string {
  if (!ms) return 'chưa học lần nào';
  return new Date(ms).toLocaleString('vi-VN', { hour: '2-digit', minute: '2-digit', day: '2-digit', month: '2-digit' });
}

export default function BrainHieuAnh() {
  const toast = useToast();
  const [dl, setDl] = useState<DuLieu | null>(null);
  const [day, setDay] = useState({ noiDung: '', khiaCanh: 'nguyen_tac', doiTuong: '' });
  const [sua, setSua] = useState<{ id: string; noiDung: string } | null>(null);
  const [moBo, setMoBo] = useState(false);

  async function tai() {
    setDl(await api<DuLieu>('/brain/hieu-anh'));
  }
  useEffect(() => {
    tai().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function doi(id: string, body: Record<string, unknown>, bao?: string) {
    try {
      await api(`/brain/hieu-anh/${id}`, { method: 'PATCH', body });
      if (bao) toast.success(bao);
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function dayThem() {
    try {
      const r = await api<{ ok: boolean; message: string }>('/brain/hieu-anh', { body: day });
      if (r.ok) {
        toast.success(r.message);
        setDay((d) => ({ ...d, noiDung: '', doiTuong: '' }));
        await tai();
      } else toast.error(r.message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function hocNgay() {
    try {
      const r = await api<{ chay: boolean; moi: number; xacNhan: number; ghiChu: string }>('/brain/hieu-anh/hoc-ngay', { body: {} });
      toast.success(r.chay ? `Đã học: ${r.moi} điều mới, ${r.xacNhan} điều được xác nhận thêm (${r.ghiChu})` : r.ghiChu);
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function chiaSe(id: string) {
    try {
      const r = await api<{ ok: boolean; message: string }>(`/brain/hieu-anh/${id}/chia-se`, { body: {} });
      (r.ok ? toast.success : toast.error)(r.message);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!dl) return <SkeletonRows rows={5} />;
  if (dl.needsMigrate)
    return (
      <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
        Cần cập nhật cấu trúc. Vào <b>Quản trị → 🛠 Cập nhật cấu trúc DB</b>.
      </div>
    );

  const dangDung = dl.ds.filter((m) => m.trangThai !== 'anh_bo');
  const daBo = dl.ds.filter((m) => m.trangThai === 'anh_bo');
  const nhom = Object.keys(KHIA_CANH)
    .map((k) => ({ k, ds: dangDung.filter((m) => m.khiaCanh === k).sort((a, b) => b.soLanThay - a.soLanThay) }))
    .filter((g) => g.ds.length);

  return (
    <div className="space-y-4">
      <div className="card space-y-2">
        <div className="flex flex-wrap items-start justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">🧠 Em đang học để hiểu anh</div>
            <p className="text-sm text-ink-muted">
              AI đọc tin <b>anh gửi</b> trong các cuộc Zalo công việc (với nhân viên, khách) và những gì anh nói với trợ lý, rút ra
              cách anh nói, nguyên tắc, ưu tiên, cách anh quyết. Trợ lý của anh đọc phần này trước khi trả lời. Chỉ anh xem được.
              Điều anh <b>duyệt / sửa / bỏ</b> thì AI không tự đổi nữa.
            </p>
            <p className="mt-1 text-xs text-ink-faint">
              Lần học gần nhất: {gioVN(dl.lanHocCuoi)} · chờ học: {dl.tinZaloCho} tin Zalo, {dl.cauChatCho} câu chat — tự học mỗi 30 phút.
            </p>
          </div>
          <AsyncButton className="btn-ghost" busyLabel="Đang học…" onClick={hocNgay}>
            ⚡ Học ngay
          </AsyncButton>
        </div>
      </div>

      <div className="card space-y-2">
        <div className="font-semibold">✍️ Anh dạy thêm</div>
        <textarea
          className="input min-h-[70px]"
          placeholder='Vd: "Anh không nhận gói SEO dưới 6 tháng", "Với khách mới luôn gửi hồ sơ năng lực trước báo giá"'
          value={day.noiDung}
          onChange={(e) => setDay({ ...day, noiDung: e.target.value })}
          maxLength={300}
        />
        <div className="flex flex-wrap items-center gap-2">
          <select className="input w-auto" value={day.khiaCanh} onChange={(e) => setDay({ ...day, khiaCanh: e.target.value })}>
            {Object.entries(KHIA_CANH).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
          {day.khiaCanh === 'nguoi' && (
            <input className="input w-48" placeholder="Tên người / khách" value={day.doiTuong} onChange={(e) => setDay({ ...day, doiTuong: e.target.value })} />
          )}
          <AsyncButton busyLabel="Đang ghi…" disabled={day.noiDung.trim().length < 8} onClick={dayThem}>
            Ghi nhớ
          </AsyncButton>
        </div>
        <p className="text-xs text-ink-faint">Hoặc nói thẳng với trợ lý: "nhớ là anh…", "lần sau em…".</p>
      </div>

      {!nhom.length ? (
        <div className="card">
          <EmptyState icon="🌱" text="Chưa có điều gì — AI sẽ tự học dần từ tin anh nhắn. Bấm “Học ngay” để học luôn." />
        </div>
      ) : (
        nhom.map((g) => (
          <div key={g.k} className="card space-y-2">
            <div className="font-semibold">
              {KHIA_CANH[g.k]} <span className="text-sm font-normal text-ink-faint">({g.ds.length})</span>
            </div>
            <ul className="divide-y divide-brand-100">
              {g.ds.map((m) => (
                <li key={m.id} className="space-y-1 py-2">
                  {sua?.id === m.id ? (
                    <div className="space-y-2">
                      <textarea className="input min-h-[60px]" value={sua.noiDung} maxLength={300} onChange={(e) => setSua({ ...sua, noiDung: e.target.value })} />
                      <div className="flex gap-2">
                        <AsyncButton
                          busyLabel="Đang lưu…"
                          disabled={sua.noiDung.trim().length < 8}
                          onClick={async () => {
                            await doi(m.id, { noiDung: sua.noiDung.trim(), trangThai: 'anh_sua' }, 'Đã sửa');
                            setSua(null);
                          }}
                        >
                          Lưu
                        </AsyncButton>
                        <button className="btn-ghost" onClick={() => setSua(null)}>
                          Huỷ
                        </button>
                      </div>
                    </div>
                  ) : (
                    <div className="text-sm text-ink">
                      {m.doiTuong && <span className="mr-1 rounded-lg bg-ocean-50 px-1.5 py-0.5 text-xs font-semibold text-ocean-700">{m.doiTuong}</span>}
                      {m.noiDung}
                    </div>
                  )}
                  <div className="flex flex-wrap items-center gap-1.5 text-xs text-ink-faint">
                    {m.trangThai === 'anh_sua' ? <Badge variant="success">anh đã duyệt</Badge> : <Badge>AI tự rút</Badge>}
                    <span>{NGUON[m.nguon]}</span>
                    {m.soLanThay > 1 && <span>· thấy {m.soLanThay} lần</span>}
                    <span className="ml-auto flex flex-wrap gap-1">
                      {m.trangThai !== 'anh_sua' && (
                        <button className="rounded-lg px-2 py-0.5 text-emerald-700 hover:bg-emerald-50" onClick={() => doi(m.id, { trangThai: 'anh_sua' }, 'Đã duyệt')}>
                          ✓ Đúng
                        </button>
                      )}
                      <button className="rounded-lg px-2 py-0.5 text-ocean-700 hover:bg-ocean-50" onClick={() => setSua({ id: m.id, noiDung: m.noiDung })}>
                        ✎ Sửa
                      </button>
                      <button className="rounded-lg px-2 py-0.5 text-ocean-700 hover:bg-ocean-50" onClick={() => chiaSe(m.id)} title="Đưa vào kho tri thức cho cả team">
                        ↗ Chia sẻ team
                      </button>
                      <button className="rounded-lg px-2 py-0.5 text-rose-600 hover:bg-rose-50" onClick={() => doi(m.id, { trangThai: 'anh_bo' }, 'Đã bỏ — AI sẽ không thêm lại')}>
                        ✕ Bỏ
                      </button>
                    </span>
                  </div>
                  {m.bangChung.length > 0 && (
                    <details className="text-xs text-ink-muted">
                      <summary className="cursor-pointer select-none">Bằng chứng ({m.bangChung.length})</summary>
                      <ul className="mt-1 space-y-0.5 pl-3">
                        {m.bangChung.map((b, i) => (
                          <li key={i}>“{b}”</li>
                        ))}
                      </ul>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          </div>
        ))
      )}

      {daBo.length > 0 && (
        <div className="card">
          <button className="flex w-full items-center justify-between text-left text-sm text-ink-muted" onClick={() => setMoBo(!moBo)}>
            <span>Điều anh đã bỏ ({daBo.length}) — AI không thêm lại</span>
            <span className="text-xs">{moBo ? '▲' : '▼'}</span>
          </button>
          {moBo && (
            <ul className="mt-2 space-y-1">
              {daBo.map((m) => (
                <li key={m.id} className="flex items-center gap-2 text-sm text-ink-faint">
                  <span className="min-w-0 flex-1 line-through">{m.noiDung}</span>
                  <button className="text-xs text-ocean-700 underline" onClick={() => doi(m.id, { trangThai: 'dung' }, 'Đã khôi phục')}>
                    khôi phục
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
