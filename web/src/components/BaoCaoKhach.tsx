// Báo cáo quảng cáo gửi khách (anh Tâm 11/11/2026: "báo cáo hàng tuần, tháng cho các bên chạy ads, GG và FB… chi phí sẽ
// tổng cả thuế"). Đến kỳ hệ thống tự lấy số + AI nhận xét; người phụ trách xem ảnh, sửa nhận xét, bấm Gửi Zalo.
import { useEffect, useRef, useState } from 'react';
import { toJpeg } from 'html-to-image';
import { api } from '../lib/api';
import { useToast } from './Toaster';
import { Badge, EmptyState, SkeletonRows } from './ui';
import AnhBaoCao, { RONG_ANH, type DuLieuAnh } from './AnhBaoCao';

interface TkCh {
  id: string;
  thue: number;
  ten?: string;
}
interface CauHinh {
  id: string;
  ten: string;
  logo: string;
  mau: string;
  taiKhoan: TkCh[];
  ngayChuKy: number;
  tuan: boolean;
  thang: boolean;
  zaloThread: string;
  zaloNhom: boolean;
  zaloTen: string;
  bat: boolean;
}
interface BaoCao extends DuLieuAnh {
  id: string;
  cauHinhId: string;
  trangThai: string;
  loi: string;
  nguoiGui: string;
  guiLuc: string;
  taoLuc: string;
  zaloTen: string;
}
interface TaiKhoanQc {
  id: string;
  loai: string;
  ten: string;
  khach: string;
}

const TEN_NT: Record<string, string> = { gads: 'Google Ads', meta: 'Facebook Ads' };
const TEN_KY: Record<string, string> = { tuan: 'Tuần', thang: 'Tháng', tuy_chon: 'Tự chọn' };
const ngayVn = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}`;

export default function BaoCaoKhach() {
  const toast = useToast();
  const [d, setD] = useState<{ cauHinh: CauHinh[]; baoCao: BaoCao[]; canCapNhatDb: boolean } | null>(null);
  const [sua, setSua] = useState<CauHinh | null>(null);
  const [xem, setXem] = useState<string>('');
  const [dang, setDang] = useState('');

  const tai = () =>
    api<{ cauHinh: CauHinh[]; baoCao: BaoCao[]; canCapNhatDb: boolean }>('/bao-cao-khach')
      .then(setD)
      .catch((e) => toast.error((e as Error).message));
  useEffect(() => {
    tai();
  }, []);

  const taoNgay = async (ch: CauHinh, ky: string) => {
    setDang(ch.id);
    try {
      const r = await api<{ ids: string[] }>(`/bao-cao-khach/cau-hinh/${ch.id}/tao`, { body: { ky } });
      toast.success(`Đã tạo ${r.ids.length} báo cáo — xem trong mục Chờ duyệt`);
      await tai();
      if (r.ids[0]) setXem(r.ids[0]);
    } catch (e) {
      toast.error((e as Error).message);
      await tai();
    } finally {
      setDang('');
    }
  };

  if (!d) return <SkeletonRows rows={4} />;
  if (d.canCapNhatDb) return <EmptyState icon="🛠" text="Cần bấm Quản trị → Cập nhật cấu trúc DB trước khi dùng báo cáo khách." />;

  const cho = d.baoCao.filter((b) => b.trangThai === 'cho' || b.trangThai === 'loi');
  const daGui = d.baoCao.filter((b) => b.trangThai === 'da_gui' || b.trangThai === 'bo').slice(0, 20);
  const dangXem = d.baoCao.find((b) => b.id === xem);

  return (
    <div className="space-y-4">
      {dangXem && <XemBaoCao b={dangXem} dong={() => setXem('')} doi={tai} />}

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="font-semibold">⏳ Chờ duyệt ({cho.length})</h3>
            <p className="text-xs text-ink-muted">
              Thứ Hai hệ thống tự làm báo cáo tuần trước; đến ngày chu kỳ thì làm báo cáo tháng. Số lấy thẳng từ Google / Facebook, chi
              phí đã cộng thuế, AI viết nhận xét — anh / chị xem lại rồi bấm Gửi.
            </p>
          </div>
        </div>
        {cho.length === 0 ? (
          <p className="mt-2 text-sm text-ink-muted">Không có báo cáo chờ duyệt.</p>
        ) : (
          <ul className="mt-3 space-y-2">
            {cho.map((b) => (
              <DongBaoCao key={b.id} b={b} chon={() => setXem(b.id)} />
            ))}
          </ul>
        )}
      </div>

      <div className="card">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="font-semibold">👥 Khách nhận báo cáo ({d.cauHinh.length})</h3>
          <button
            className="btn-primary py-1.5 text-sm"
            onClick={() => setSua({ id: '', ten: '', logo: '', mau: '#5f6f52', taiKhoan: [], ngayChuKy: 0, tuan: true, thang: true, zaloThread: '', zaloNhom: false, zaloTen: '', bat: true })}
          >
            ＋ Thêm khách
          </button>
        </div>
        {sua && (
          <SuaCauHinh
            c={sua}
            dong={() => setSua(null)}
            luu={async () => {
              setSua(null);
              await tai();
            }}
          />
        )}
        {d.cauHinh.length === 0 && !sua ? (
          <p className="mt-2 text-sm text-ink-muted">Chưa có khách nào — bấm "Thêm khách", chọn các tài khoản Google / Facebook của khách.</p>
        ) : (
          <ul className="mt-3 divide-y divide-ink/10">
            {d.cauHinh.map((c) => (
              <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                <div className="flex items-center gap-3">
                  {c.logo ? <img src={c.logo} alt="" className="h-9 w-14 object-contain" /> : <span className="grid h-9 w-14 place-items-center rounded-lg text-white" style={{ background: c.mau || '#5f6f52' }}>{c.ten.slice(0, 2)}</span>}
                  <div>
                    <p className="font-medium">
                      {c.ten} {!c.bat && <Badge>Tắt</Badge>}
                    </p>
                    <p className="text-xs text-ink-muted">
                      {c.taiKhoan.length} tài khoản · {[c.tuan && 'tuần', c.thang && `tháng${c.ngayChuKy ? ` (chu kỳ ngày ${c.ngayChuKy})` : ''}`].filter(Boolean).join(' + ') || 'không tự gửi'} ·{' '}
                      {c.zaloTen ? `Zalo: ${c.zaloTen}` : 'chưa chọn Zalo (chỉ tải ảnh)'}
                    </p>
                  </div>
                </div>
                <div className="flex flex-wrap gap-1.5">
                  <select
                    className="input w-auto py-1 text-sm"
                    disabled={!!dang}
                    value=""
                    aria-label="Tạo báo cáo ngay"
                    onChange={(e) => e.target.value && taoNgay(c, e.target.value)}
                  >
                    <option value="">{dang === c.id ? 'Đang tạo…' : '⚡ Tạo ngay…'}</option>
                    <option value="tuan">Tuần vừa rồi</option>
                    <option value="thang">Tháng (chu kỳ) vừa rồi</option>
                  </select>
                  <button className="btn-ghost py-1 text-sm" onClick={() => setSua(c)}>
                    Sửa
                  </button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>

      {daGui.length > 0 && (
        <div className="card">
          <h3 className="font-semibold">📤 Đã gửi / đã bỏ gần đây</h3>
          <ul className="mt-2 space-y-2">
            {daGui.map((b) => (
              <DongBaoCao key={b.id} b={b} chon={() => setXem(b.id)} />
            ))}
          </ul>
        </div>
      )}
    </div>
  );
}

function DongBaoCao({ b, chon }: { b: BaoCao; chon: () => void }) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-ink/15 px-3 py-2">
      <div className="text-sm">
        <b>{b.tenKhach}</b> · {TEN_NT[b.nenTang]} · {TEN_KY[b.ky] || b.ky} {ngayVn(b.tu)} → {ngayVn(b.den)}
        {b.trangThai === 'loi' ? (
          <div className="text-xs text-rose-600">Lỗi: {b.loi}</div>
        ) : (
          <div className="text-xs text-ink-muted">
            {b.soLieu.tong.chuyenDoi.toLocaleString('vi-VN')} {b.nenTang === 'gads' ? 'chuyển đổi' : 'kết quả'} · {b.soLieu.tong.chiSauThue.toLocaleString('vi-VN')}đ (gồm thuế)
            {b.trangThai === 'da_gui' && ` · đã gửi bởi ${b.nguoiGui} ${b.guiLuc.slice(0, 10)}`}
            {b.trangThai === 'bo' && ' · đã bỏ'}
          </div>
        )}
      </div>
      {b.trangThai !== 'loi' && (
        <button className="btn-ghost py-1 text-sm" onClick={chon}>
          {b.trangThai === 'cho' ? 'Xem & gửi' : 'Xem'}
        </button>
      )}
    </li>
  );
}

// ── Xem ảnh, sửa nhận xét, gửi ──

/**
 * Phông của ảnh (Lora tiêu đề, Be Vietnam Pro nội dung) nhúng sẵn dạng data URL. html-to-image không tự đọc được stylesheet
 * Google Fonts khác nguồn → ảnh chụp rơi về Times / Arial, tiêu đề tràn dòng (thử thật 11/11/2026).
 */
const URL_PHONG = 'https://fonts.googleapis.com/css2?family=Be+Vietnam+Pro:wght@400;500;600;700&family=Lora:wght@600;700&display=swap';
let phong: Promise<string> | null = null;
function cssPhong(): Promise<string> {
  if (!phong)
    phong = (async () => {
      const css = await fetch(URL_PHONG).then((r) => r.text());
      const urls = [...new Set(css.match(/https:\/\/fonts\.gstatic\.com\/[^)'"]+/g) || [])];
      const daNhung = new Map(
        await Promise.all(
          urls.map(async (u) => {
            const blob = await fetch(u).then((r) => r.blob());
            const data = await new Promise<string>((ok, loi) => {
              const fr = new FileReader();
              fr.onload = () => ok(String(fr.result));
              fr.onerror = () => loi(fr.error);
              fr.readAsDataURL(blob);
            });
            return [u, data] as const;
          }),
        ),
      );
      return css.replace(/https:\/\/fonts\.gstatic\.com\/[^)'"]+/g, (u) => daNhung.get(u) || u);
    })().catch(() => {
      phong = null;
      return '';
    });
  return phong;
}

function XemBaoCao({ b, dong, doi }: { b: BaoCao; dong: () => void; doi: () => Promise<void> }) {
  const toast = useToast();
  const anh = useRef<HTMLDivElement>(null);
  const khung = useRef<HTMLDivElement>(null);
  const [danhGia, setDanhGia] = useState(b.danhGia.join('\n'));
  const [deXuat, setDeXuat] = useState(b.deXuat.join('\n'));
  const [loiNhan, setLoiNhan] = useState(`Dạ MT Digital gửi anh/chị báo cáo ${TEN_NT[b.nenTang]} ${b.ky === 'tuan' ? 'tuần' : 'tháng'} (${ngayVn(b.tu)} – ${ngayVn(b.den)}) ạ.`);
  const [tiLe, setTiLe] = useState(0.5);
  const [cao, setCao] = useState(1060);
  const [dang, setDang] = useState('');
  const daGui = b.trangThai === 'da_gui';
  const tach = (s: string) =>
    s
      .split('\n')
      .map((x) => x.replace(/^[-•*\s]+/, '').trim())
      .filter(Boolean);
  const duLieu: DuLieuAnh = { ...b, danhGia: tach(danhGia), deXuat: tach(deXuat) };

  useEffect(() => {
    const doiCo = () => khung.current && setTiLe(Math.min(1, khung.current.clientWidth / RONG_ANH));
    doiCo();
    window.addEventListener('resize', doiCo);
    const ro = new ResizeObserver(() => anh.current && setCao(anh.current.offsetHeight));
    if (anh.current) ro.observe(anh.current);
    return () => {
      window.removeEventListener('resize', doiCo);
      ro.disconnect();
    };
  }, []);

  const chup = async () => {
    if (!anh.current) throw new Error('Chưa dựng xong ảnh');
    await document.fonts.ready;
    return toJpeg(anh.current, { quality: 0.93, pixelRatio: 1, backgroundColor: '#ffffff', cacheBust: true, fontEmbedCSS: await cssPhong() });
  };
  const luuNhanXet = () => api(`/bao-cao-khach/${b.id}/nhan-xet`, { body: { danhGia: duLieu.danhGia, deXuat: duLieu.deXuat } });

  const lam = async (viec: string, f: () => Promise<unknown>, xong: string) => {
    setDang(viec);
    try {
      await f();
      toast.success(xong);
      await doi();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDang('');
    }
  };

  return (
    <div className="card space-y-3 border-2 border-brand-600">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h3 className="font-semibold">
          {b.tenKhach} · {TEN_NT[b.nenTang]} · {TEN_KY[b.ky] || b.ky} {ngayVn(b.tu)} → {ngayVn(b.den)}
        </h3>
        <button className="btn-ghost py-1 text-sm" onClick={dong}>
          Đóng ✕
        </button>
      </div>

      <div ref={khung} className="overflow-hidden rounded-xl border border-ink/15">
        <div style={{ width: RONG_ANH * tiLe, height: cao * tiLe }}>
          <div style={{ transform: `scale(${tiLe})`, transformOrigin: 'top left', width: RONG_ANH }}>
            <AnhBaoCao ref={anh} d={duLieu} />
          </div>
        </div>
      </div>

      {!daGui && (
        <div className="grid gap-3 md:grid-cols-2">
          <label className="text-sm">
            <span className="font-medium">Đánh giá</span> <span className="text-xs text-ink-muted">(mỗi dòng một ý)</span>
            <textarea className="input mt-1 min-h-[110px]" value={danhGia} onChange={(e) => setDanhGia(e.target.value)} />
          </label>
          <label className="text-sm">
            <span className="font-medium">Đề xuất</span> <span className="text-xs text-ink-muted">(mỗi dòng một ý)</span>
            <textarea className="input mt-1 min-h-[110px]" value={deXuat} onChange={(e) => setDeXuat(e.target.value)} />
          </label>
          <label className="text-sm md:col-span-2">
            <span className="font-medium">Lời nhắn kèm ảnh</span>
            <input className="input mt-1" value={loiNhan} onChange={(e) => setLoiNhan(e.target.value)} />
          </label>
        </div>
      )}

      <div className="flex flex-wrap gap-2">
        {!daGui && b.zaloTen && (
          <button
            className="btn-primary"
            disabled={!!dang}
            onClick={() => {
              if (!window.confirm(`Gửi ảnh báo cáo vào Zalo "${b.zaloTen}"?`)) return;
              lam(
                'gui',
                async () => {
                  await luuNhanXet();
                  const data = await chup();
                  await api(`/bao-cao-khach/${b.id}/gui`, { body: { anh: data, rong: anh.current!.offsetWidth, cao: anh.current!.offsetHeight, loiNhan } });
                },
                `Đã gửi vào Zalo ${b.zaloTen}`,
              );
            }}
          >
            {dang === 'gui' ? 'Đang gửi…' : '📤 Gửi Zalo'}
          </button>
        )}
        <button
          className="btn-ghost"
          disabled={!!dang}
          onClick={() =>
            lam(
              'tai',
              async () => {
                const data = await chup();
                const a = document.createElement('a');
                a.href = data;
                a.download = `bao-cao-${b.nenTang}-${b.tenKhach.replace(/[^\p{L}\p{N}]+/gu, '-')}-${b.tu}_${b.den}.jpg`;
                a.click();
              },
              'Đã tải ảnh',
            )
          }
        >
          ⬇️ Tải ảnh
        </button>
        {!daGui && (
          <>
            <button className="btn-ghost" disabled={!!dang} onClick={() => lam('luu', luuNhanXet, 'Đã lưu nhận xét')}>
              💾 Lưu nhận xét
            </button>
            <button
              className="btn-ghost"
              disabled={!!dang}
              onClick={() => window.confirm('Đánh dấu đã gửi (anh / chị tự gửi bằng cách khác)?') && lam('da', () => api(`/bao-cao-khach/${b.id}/trang-thai`, { body: { trangThai: 'da_gui' } }), 'Đã đánh dấu đã gửi')}
            >
              ✓ Đã tự gửi
            </button>
            {b.trangThai === 'cho' && (
              <button className="btn-ghost" disabled={!!dang} onClick={() => lam('bo', () => api(`/bao-cao-khach/${b.id}/trang-thai`, { body: { trangThai: 'bo' } }), 'Đã bỏ báo cáo này')}>
                Bỏ
              </button>
            )}
          </>
        )}
      </div>
    </div>
  );
}

// ── Cấu hình khách ──

/** Thu nhỏ logo về ≤ 420px ngang (PNG giữ nền trong) — lưu thẳng trong DB. */
async function thuNhoLogo(f: File): Promise<string> {
  const url = URL.createObjectURL(f);
  try {
    const img = await new Promise<HTMLImageElement>((ok, loi) => {
      const i = new Image();
      i.onload = () => ok(i);
      i.onerror = () => loi(new Error('Không đọc được ảnh logo'));
      i.src = url;
    });
    const k = Math.min(1, 420 / img.width, 220 / img.height);
    const c = document.createElement('canvas');
    c.width = Math.round(img.width * k);
    c.height = Math.round(img.height * k);
    c.getContext('2d')!.drawImage(img, 0, 0, c.width, c.height);
    return c.toDataURL('image/png');
  } finally {
    URL.revokeObjectURL(url);
  }
}

function SuaCauHinh({ c, dong, luu }: { c: CauHinh; dong: () => void; luu: () => Promise<void> }) {
  const toast = useToast();
  const [f, setF] = useState<CauHinh>(c);
  const [tk, setTk] = useState<TaiKhoanQc[]>([]);
  const [tim, setTim] = useState('');
  const [zalo, setZalo] = useState<Array<{ id: string; ten: string; laNhom: boolean; khach: string }>>([]);
  const [timZalo, setTimZalo] = useState(c.zaloTen ? '' : c.ten);
  const [dang, setDang] = useState(false);

  useEffect(() => {
    api<{ ds: TaiKhoanQc[] }>('/bao-cao-khach/tai-khoan')
      .then((r) => setTk(r.ds))
      .catch(() => undefined);
  }, []);
  useEffect(() => {
    const t = setTimeout(() => {
      api<{ ds: typeof zalo }>(`/bao-cao-khach/zalo?q=${encodeURIComponent(timZalo)}`)
        .then((r) => setZalo(r.ds))
        .catch(() => setZalo([]));
    }, 300);
    return () => clearTimeout(t);
  }, [timZalo]);

  const chon = new Map(f.taiKhoan.map((t) => [t.id, t]));
  const loc = tk.filter((t) => chon.has(t.id) || !tim || `${t.ten} ${t.khach}`.toLowerCase().includes(tim.toLowerCase()));
  const doiTk = (id: string, patch: Partial<TkCh> | null) =>
    setF((x) => ({
      ...x,
      taiKhoan: patch === null ? x.taiKhoan.filter((t) => t.id !== id) : x.taiKhoan.some((t) => t.id === id) ? x.taiKhoan.map((t) => (t.id === id ? { ...t, ...patch } : t)) : [...x.taiKhoan, { id, thue: 10, ...patch }],
    }));

  const nop = async () => {
    if (!f.ten.trim()) return toast.error('Nhập tên khách');
    if (!f.taiKhoan.length) return toast.error('Chọn ít nhất một tài khoản quảng cáo');
    setDang(true);
    try {
      await api('/bao-cao-khach/cau-hinh', { body: { ...f, id: f.id || undefined } });
      toast.success('Đã lưu');
      await luu();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDang(false);
    }
  };

  return (
    <div className="mt-3 space-y-3 rounded-xl border border-ink/15 bg-brand-50/40 p-3">
      <div className="grid gap-3 md:grid-cols-3">
        <label className="text-sm md:col-span-2">
          Tên khách (hiện trên ảnh)
          <input className="input mt-1" value={f.ten} onChange={(e) => setF({ ...f, ten: e.target.value })} placeholder="Mịn Skinlab & Mịn Skinlab 2" />
        </label>
        <label className="text-sm">
          Màu chủ đạo
          <input className="input mt-1 h-10 p-1" type="color" value={f.mau || '#5f6f52'} onChange={(e) => setF({ ...f, mau: e.target.value })} />
        </label>
        <div className="text-sm">
          Logo khách
          <div className="mt-1 flex items-center gap-2">
            {f.logo && <img src={f.logo} alt="" className="h-10 w-20 rounded border border-ink/15 object-contain" />}
            <input
              type="file"
              accept="image/png,image/jpeg,image/webp"
              className="text-xs"
              onChange={async (e) => {
                const file = e.target.files?.[0];
                if (file) setF({ ...f, logo: await thuNhoLogo(file).catch(() => f.logo) });
              }}
            />
            {f.logo && (
              <button className="text-xs text-rose-600" onClick={() => setF({ ...f, logo: '' })}>
                Bỏ
              </button>
            )}
          </div>
        </div>
        <label className="text-sm">
          Chu kỳ tháng bắt đầu ngày
          <input className="input mt-1" type="number" min={0} max={28} value={f.ngayChuKy} onChange={(e) => setF({ ...f, ngayChuKy: Math.max(0, Math.min(28, Number(e.target.value) || 0)) })} />
          <span className="text-xs text-ink-muted">0 = tháng dương lịch; 11 = 11 tháng trước → 10 tháng này</span>
        </label>
        <div className="text-sm">
          Tự làm báo cáo
          <div className="mt-2 flex gap-4">
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.tuan} onChange={(e) => setF({ ...f, tuan: e.target.checked })} /> Tuần (thứ Hai)
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.thang} onChange={(e) => setF({ ...f, thang: e.target.checked })} /> Tháng
            </label>
            <label className="flex items-center gap-1.5">
              <input type="checkbox" checked={f.bat} onChange={(e) => setF({ ...f, bat: e.target.checked })} /> Bật
            </label>
          </div>
        </div>
      </div>

      <div>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-medium">Tài khoản quảng cáo của khách ({f.taiKhoan.length} đã chọn)</p>
          <input className="input w-56 py-1 text-sm" placeholder="Tìm tài khoản…" value={tim} onChange={(e) => setTim(e.target.value)} />
        </div>
        <div className="mt-2 max-h-72 overflow-y-auto rounded-lg border border-ink/15 bg-white">
          {loc.slice(0, 80).map((t) => {
            const c1 = chon.get(t.id);
            return (
              <div key={t.id} className="flex flex-wrap items-center gap-2 border-b border-ink/10 px-2 py-1.5 text-sm">
                <label className="flex min-w-[240px] flex-1 items-center gap-2">
                  <input type="checkbox" checked={!!c1} onChange={(e) => doiTk(t.id, e.target.checked ? {} : null)} />
                  <span className="text-xs text-ink-muted">{t.loai === 'gads' ? 'Google' : 'FB'}</span>
                  <span>{t.khach || t.ten}</span>
                  {t.khach && <span className="text-xs text-ink-muted">({t.ten})</span>}
                </label>
                {c1 && (
                  <>
                    <input className="input w-48 py-0.5 text-xs" placeholder="Tên hiện trên bảng" value={c1.ten || ''} onChange={(e) => doiTk(t.id, { ten: e.target.value })} />
                    <label className="flex items-center gap-1 text-xs">
                      Thuế
                      <input className="input w-16 py-0.5 text-xs" type="number" min={0} max={100} value={c1.thue} onChange={(e) => doiTk(t.id, { thue: Math.max(0, Math.min(100, Number(e.target.value) || 0)) })} />%
                    </label>
                  </>
                )}
              </div>
            );
          })}
        </div>
      </div>

      <div>
        <p className="text-sm font-medium">
          Zalo nhận báo cáo:{' '}
          {f.zaloTen ? (
            <>
              <b>{f.zaloTen}</b>{' '}
              <button className="text-xs text-rose-600" onClick={() => setF({ ...f, zaloThread: '', zaloNhom: false, zaloTen: '' })}>
                Bỏ chọn
              </button>
            </>
          ) : (
            <span className="text-ink-muted">chưa chọn (chỉ tải ảnh, không gửi Zalo)</span>
          )}
        </p>
        <input className="input mt-1 py-1 text-sm" placeholder="Tìm nhóm / người trên Zalo…" value={timZalo} onChange={(e) => setTimZalo(e.target.value)} />
        <div className="mt-1 flex flex-wrap gap-1.5">
          {zalo.map((z) => (
            <button
              key={z.id}
              className={`rounded-lg border px-2 py-1 text-xs ${f.zaloThread === z.id ? 'border-brand-600 bg-brand-600' : 'border-ink/15 bg-white'}`}
              onClick={() => setF({ ...f, zaloThread: z.id, zaloNhom: z.laNhom, zaloTen: z.ten })}
            >
              {z.laNhom ? '👥' : '👤'} {z.ten}
            </button>
          ))}
        </div>
      </div>

      <div className="flex gap-2">
        <button className="btn-primary" disabled={dang} onClick={nop}>
          {dang ? 'Đang lưu…' : 'Lưu'}
        </button>
        <button className="btn-ghost" onClick={dong}>
          Huỷ
        </button>
      </div>
    </div>
  );
}
