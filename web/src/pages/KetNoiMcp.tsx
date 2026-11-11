// Trang "Kết nối MCP" (anh Tâm 11/11/2026: "đưa riêng phần MCP, kết nối nền tảng ra riêng để các phòng ban có thể sử
// dụng, xem đc các chỉ số cơ bản"; "đổi Nền tảng thành Kết nối MCP").
//  - Mọi người: chỉ số 7 ngày so 7 ngày trước + biểu đồ 30 ngày của các tài khoản giao cho phòng mình.
//  - Giám đốc: xem tất cả (lọc theo phòng), giao tài khoản cho phòng, Fanpage, cài đặt kết nối.
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { PageHeader } from '../components/ui';
import AsyncButton from '../components/AsyncButton';
import AdminKetNoi from '../components/AdminKetNoi';
import AdminFanpage from '../components/AdminFanpage';
import AdsDieuChinh from '../components/AdsDieuChinh';
import AdsNhatKy from '../components/AdsNhatKy';
import { useToast } from '../components/Toaster';
import { MAU } from '../components/charts/mau';

type Loai = 'meta' | 'gads' | 'ga4' | 'gsc';
interface DongSo {
  ngay: string;
  chiTieu?: number;
  hienThi?: number;
  click?: number;
  ketQua?: number;
  phien?: number;
  nguoiDung?: number;
  viTri?: number;
}
interface TongKy {
  chiTieu: number;
  hienThi: number;
  click: number;
  ketQua: number;
  phien: number;
  nguoiDung: number;
  ctr: number;
  viTri: number;
}
interface TomTat {
  denNgay: string;
  ky: TongKy;
  truoc: TongKy;
  chuoi: DongSo[];
}
interface ChiSoTaiSan {
  id: string;
  ten: string;
  khach: string;
  teamId: string;
  tienTe: string;
  loi: string;
  dongBoCuoi: number;
  tomTat: TomTat;
}
interface Team {
  id: string;
  name: string;
}

// ── Chỉ số mỗi nền tảng ──

type KhoaSo = keyof TongKy | 'cpa';
interface ChiSoDef {
  khoa: KhoaSo;
  ten: string;
  kieu: 'tien' | 'so' | 'pt' | 'vitri';
  /** true = tăng là tốt; false = giảm là tốt; null = không đánh giá (vd chi tiêu) */
  tangTot: boolean | null;
}
const CHI_SO: Record<Loai, ChiSoDef[]> = {
  meta: [
    { khoa: 'chiTieu', ten: 'Chi tiêu', kieu: 'tien', tangTot: null },
    { khoa: 'ketQua', ten: 'Kết quả (tin nhắn, lead, mua)', kieu: 'so', tangTot: true },
    { khoa: 'cpa', ten: 'Chi phí / kết quả', kieu: 'tien', tangTot: false },
    { khoa: 'click', ten: 'Click', kieu: 'so', tangTot: true },
    { khoa: 'ctr', ten: 'CTR', kieu: 'pt', tangTot: true },
    { khoa: 'hienThi', ten: 'Hiển thị', kieu: 'so', tangTot: true },
  ],
  gads: [
    { khoa: 'chiTieu', ten: 'Chi phí', kieu: 'tien', tangTot: null },
    { khoa: 'ketQua', ten: 'Chuyển đổi', kieu: 'so', tangTot: true },
    { khoa: 'cpa', ten: 'Chi phí / chuyển đổi', kieu: 'tien', tangTot: false },
    { khoa: 'click', ten: 'Click', kieu: 'so', tangTot: true },
    { khoa: 'ctr', ten: 'CTR', kieu: 'pt', tangTot: true },
    { khoa: 'hienThi', ten: 'Hiển thị', kieu: 'so', tangTot: true },
  ],
  ga4: [
    { khoa: 'phien', ten: 'Phiên truy cập', kieu: 'so', tangTot: true },
    { khoa: 'nguoiDung', ten: 'Người dùng', kieu: 'so', tangTot: true },
    { khoa: 'ketQua', ten: 'Sự kiện chính', kieu: 'so', tangTot: true },
  ],
  gsc: [
    { khoa: 'click', ten: 'Click từ Google', kieu: 'so', tangTot: true },
    { khoa: 'hienThi', ten: 'Hiển thị', kieu: 'so', tangTot: true },
    { khoa: 'ctr', ten: 'CTR', kieu: 'pt', tangTot: true },
    { khoa: 'viTri', ten: 'Vị trí trung bình', kieu: 'vitri', tangTot: false },
  ],
};
const TEN_LOAI: Record<Loai, string> = { meta: 'Meta Ads', gads: 'Google Ads', ga4: 'Google Analytics 4', gsc: 'Search Console' };

// Chưa có kết quả thì chi phí / kết quả không xác định (NaN → hiện —), không phải 0đ.
const giaTri = (t: TongKy, k: KhoaSo): number => (k === 'cpa' ? (t.ketQua ? t.chiTieu / t.ketQua : Number.NaN) : t[k]);
const giaTriNgay = (d: DongSo, k: KhoaSo): number => {
  if (k === 'cpa') return d.ketQua ? (d.chiTieu || 0) / d.ketQua : 0;
  if (k === 'ctr') return d.hienThi ? (d.click || 0) / d.hienThi : 0;
  return Number((d as unknown as Record<string, number>)[k]) || 0;
};

function dinhDang(v: number, kieu: ChiSoDef['kieu'], tienTe = 'VND'): string {
  if (!Number.isFinite(v)) return '—';
  if (kieu === 'pt') return `${(v * 100).toLocaleString('vi-VN', { maximumFractionDigits: 2 })}%`;
  if (kieu === 'vitri') return v ? v.toLocaleString('vi-VN', { maximumFractionDigits: 1 }) : '—';
  if (kieu === 'tien') {
    const n = tienTe && tienTe !== 'VND' ? v.toLocaleString('vi-VN', { maximumFractionDigits: 2 }) : Math.round(v).toLocaleString('vi-VN');
    return `${n} ${tienTe === 'VND' || !tienTe ? 'đ' : tienTe}`;
  }
  return Math.round(v).toLocaleString('vi-VN');
}

/** Mức thay đổi so kỳ trước: mũi tên + phần trăm + chữ (không chỉ dựa vào màu). */
function ThayDoi({ nay, truoc, tangTot }: { nay: number; truoc: number; tangTot: boolean | null }) {
  if (!Number.isFinite(nay)) return <span className="text-xs text-ink-muted">—</span>;
  if (!truoc || !Number.isFinite(truoc)) return <span className="text-xs text-ink-muted">{nay ? 'chưa có số tuần trước' : '—'}</span>;
  const pt = ((nay - truoc) / truoc) * 100;
  if (Math.abs(pt) < 0.5) return <span className="text-xs text-ink-muted">→ như tuần trước</span>;
  const tang = pt > 0;
  const tot = tangTot === null ? null : tang === tangTot;
  const mau = tot === null ? 'text-ink-soft' : tot ? 'text-green-700' : 'text-red-700';
  return (
    <span className={`text-xs font-medium ${mau}`}>
      {tang ? '▲' : '▼'} {Math.abs(pt).toLocaleString('vi-VN', { maximumFractionDigits: 0 })}% {tang ? 'tăng' : 'giảm'}
    </span>
  );
}

/** Biểu đồ nhỏ 30 ngày (SVG, không cần thư viện). */
function BieuDoNho({ chuoi, khoa, ten }: { chuoi: DongSo[]; khoa: KhoaSo; ten: string }) {
  const v = chuoi.map((d) => giaTriNgay(d, khoa));
  const max = Math.max(...v, 0);
  const min = Math.min(...v.filter((x) => x > 0), max);
  const W = 120;
  const H = 32;
  if (!max) return <div className="h-8" aria-hidden />;
  const lat = khoa === 'viTri'; // vị trí: nhỏ là tốt → vẽ ngược để đi lên là tốt
  const y = (x: number) => {
    if (!x) return H - 1;
    const t = max === min ? 0.5 : (x - min) / (max - min);
    return 2 + (lat ? t : 1 - t) * (H - 4);
  };
  const diem = v.map((x, i) => `${((i / (v.length - 1)) * W).toFixed(1)},${y(x).toFixed(1)}`).join(' ');
  return (
    <svg viewBox={`0 0 ${W} ${H}`} className="h-8 w-full" role="img" aria-label={`${ten} 30 ngày`} preserveAspectRatio="none">
      <polyline points={diem} fill="none" stroke={MAU.nhan} strokeWidth="1.5" vectorEffect="non-scaling-stroke" />
    </svg>
  );
}

const ngayVn = (iso: string) => (iso ? `${iso.slice(8, 10)}/${iso.slice(5, 7)}` : '');
const truNgay = (iso: string, n: number) => new Date(Date.parse(`${iso}T00:00:00Z`) - n * 86_400_000).toISOString().slice(0, 10);
const tenTeam = (id: string, teams: Team[]) => (id === '*' ? 'Mọi phòng' : id ? teams.find((t) => t.id === id)?.name || id : 'Chỉ giám đốc');

function TabChiSo({ loai, laGd }: { loai: Loai; laGd: boolean }) {
  const toast = useToast();
  const [team, setTeam] = useState('');
  const [dieuChinh, setDieuChinh] = useState<ChiSoTaiSan | null>(null);
  const [d, setD] = useState<{ taiSan: ChiSoTaiSan[]; tong: TomTat | null; tongTien?: TomTat; tienTeTong?: string; boQuaTien?: number; teams: Team[]; canCapNhatDb: boolean } | null>(null);
  const tai = () =>
    api<{ taiSan: ChiSoTaiSan[]; tong: TomTat | null; tongTien?: TomTat; tienTeTong?: string; boQuaTien?: number; teams: Team[]; canCapNhatDb: boolean }>(`/nen-tang/chi-so?loai=${loai}${team ? `&team=${encodeURIComponent(team)}` : ''}`)
      .then(setD)
      .catch(() => setD({ taiSan: [], tong: null, teams: [], canCapNhatDb: false }));
  useEffect(() => {
    setD(null);
    void tai();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loai, team]);

  async function dongBo() {
    const r = await api<{ so: number; loi: string[] }>('/nen-tang/dong-bo', { body: { loai } });
    if (r.loi.length) toast.error(r.loi.join(' · '));
    else toast.success(`Đã cập nhật ${r.so} tài khoản`);
    await tai();
  }

  if (!d) return <div className="card text-sm text-ink-muted">Đang tải…</div>;
  const defs = CHI_SO[loai];
  const t = d.tong;
  // Tiền / chi phí mỗi kết quả: chỉ cộng tài khoản cùng loại tiền đa số (máy chủ tính sẵn).
  const tt = d.tongTien || d.tong;
  const tienTeTong = d.tienTeTong || 'VND';
  // Bảng: tài khoản có số lớn nhất lên đầu (chỉ số chính của nền tảng).
  const xep = [...d.taiSan].sort((a, b) => (giaTri(b.tomTat.ky, defs[0]!.khoa) || 0) - (giaTri(a.tomTat.ky, defs[0]!.khoa) || 0));
  const coSo = xep.filter((x) => (giaTri(x.tomTat.ky, defs[0]!.khoa) || 0) > 0);
  const khongSo = xep.filter((x) => !((giaTri(x.tomTat.ky, defs[0]!.khoa) || 0) > 0));
  const laAds = loai === 'meta' || loai === 'gads';

  const bang = (ds: ChiSoTaiSan[], gon = false) =>
    ds.length > 0 && (
      <div className={gon ? 'overflow-x-auto' : 'card overflow-x-auto p-0'}>
        <table className="w-full min-w-[640px] text-sm">
          <thead className="bg-brand-50 text-left text-xs text-ink-muted">
            <tr>
              <th className="px-3 py-2">Tài khoản</th>
              {defs.slice(0, 4).map((c) => (
                <th key={c.khoa} className="px-3 py-2 text-right">
                  {c.ten}
                </th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-brand-100">
            {ds.map((x) => (
              <tr key={x.id} className={dieuChinh?.id === x.id ? 'bg-brand-50' : ''}>
                <td className="px-3 py-2">
                  <p className="font-medium">{x.khach || x.ten}</p>
                  {x.khach && <p className="text-xs text-ink-muted">{x.ten}</p>}
                  {x.loi && <p className="text-xs text-red-700">⚠ {x.loi}</p>}
                  {!x.dongBoCuoi && <p className="text-xs text-ink-muted">chưa lấy số — chờ vài phút</p>}
                  {laAds && (
                    <button
                      type="button"
                      className="mt-1 text-xs text-ocean-700 hover:underline"
                      onClick={() => {
                        setDieuChinh(x);
                        window.scrollTo({ top: 0, behavior: 'smooth' });
                      }}
                    >
                      🛠 Điều chỉnh{loai === 'gads' ? ' · từ khoá' : ''}
                    </button>
                  )}
                </td>
                {defs.slice(0, 4).map((c) => (
                  <td key={c.khoa} className="px-3 py-2 text-right tabular-nums">
                    <p>{dinhDang(giaTri(x.tomTat.ky, c.khoa), c.kieu, x.tienTe)}</p>
                    <ThayDoi nay={giaTri(x.tomTat.ky, c.khoa)} truoc={giaTri(x.tomTat.truoc, c.khoa)} tangTot={c.tangTot} />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    );

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        {laGd && (
          <select className="input w-auto py-1.5" value={team} onChange={(e) => setTeam(e.target.value)} aria-label="Lọc theo phòng">
            <option value="">Tất cả phòng</option>
            {d.teams.map((x) => (
              <option key={x.id} value={x.id}>
                {x.name}
              </option>
            ))}
          </select>
        )}
        {t && (
          <span className="text-ink-muted">
            7 ngày {ngayVn(truNgay(t.denNgay, 6))}–{ngayVn(t.denNgay)} so với 7 ngày trước
            {loai === 'gsc' ? ' · Search Console trễ 2–3 ngày' : ''}
          </span>
        )}
        {laGd && (
          <AsyncButton className="btn-ghost ml-auto py-1 text-sm" onClick={dongBo} busyLabel="Đang lấy số…">
            ↻ Cập nhật ngay
          </AsyncButton>
        )}
      </div>

      {d.canCapNhatDb && <p className="card bg-amber-50 text-sm">Cần bấm <b>Quản trị → 🛠 Cập nhật cấu trúc DB</b> trước.</p>}

      {!d.taiSan.length ? (
        <div className="card text-sm text-ink-muted">
          {laGd ? (
            <>
              Chưa theo dõi tài khoản {TEN_LOAI[loai]} nào. Vào tab <b>⚙️ Tài khoản</b> bấm “Lấy danh sách”, bật <b>Theo dõi</b> và giao cho phòng.
            </>
          ) : (
            <>Phòng của bạn chưa được giao tài khoản {TEN_LOAI[loai]} nào — nhờ giám đốc giao ở trang này.</>
          )}
        </div>
      ) : (
        <>
          {t && (
            <div className="grid grid-cols-2 gap-3 md:grid-cols-3">
              {defs.map((c) => {
                const laTien = c.kieu === 'tien';
                const nguon = laTien && tt ? tt : t;
                const nay = giaTri(nguon.ky, c.khoa);
                return (
                  <div key={c.khoa} className="card space-y-1 p-3">
                    <p className="text-xs text-ink-muted">{c.ten}</p>
                    <p className="text-xl font-bold tabular-nums">{dinhDang(nay, c.kieu, tienTeTong)}</p>
                    <ThayDoi nay={nay} truoc={giaTri(nguon.truoc, c.khoa)} tangTot={c.tangTot} />
                    {laTien && !!d.boQuaTien && <span className="block text-xs text-ink-muted">không gồm {d.boQuaTien} tài khoản khác loại tiền</span>}
                    <BieuDoNho chuoi={nguon.chuoi} khoa={c.khoa} ten={c.ten} />
                  </div>
                );
              })}
            </div>
          )}

          {dieuChinh && (loai === 'meta' || loai === 'gads') && (
            <AdsDieuChinh key={dieuChinh.id} taiSanId={dieuChinh.id} ten={dieuChinh.khach || dieuChinh.ten} loai={loai} dong={() => setDieuChinh(null)} />
          )}

          {bang(coSo)}
          {/* Anh Tâm 11/11/2026: tài khoản không chi tiêu 7 ngày thì không cần hiện — gom vào mục mở ra được. */}
          {khongSo.length > 0 && (
            <details className="card p-0">
              <summary className="cursor-pointer px-3 py-2 text-sm text-ocean-700">
                {loai === 'meta' || loai === 'gads' ? 'Tài khoản không chi tiêu' : 'Không có số'} 7 ngày qua ({khongSo.length})
              </summary>
              {bang(khongSo, true)}
            </details>
          )}
        </>
      )}
    </div>
  );
}

// ── Giám đốc: giao tài khoản ──

interface TaiSan {
  id: string;
  loai: Loai;
  ten: string;
  ghiChu: string;
  teamId: string;
  khach: string;
  theoDoi: boolean;
  dongBoCuoi: number;
  loi: string;
}

function TabTaiKhoan() {
  const toast = useToast();
  const [d, setD] = useState<{ ds: TaiSan[]; teams: Team[]; canCapNhatDb: boolean } | null>(null);
  const tai = () => api<{ ds: TaiSan[]; teams: Team[]; canCapNhatDb: boolean }>('/nen-tang/tai-san').then(setD);
  useEffect(() => {
    tai().catch(() => undefined);
  }, []);

  async function lamMoi() {
    const r = await api<{ so: number; loi: string[] }>('/nen-tang/tai-san/lam-moi', { method: 'POST' });
    if (r.loi.length) toast.error(r.loi.join(' · '));
    toast.success(`Thấy ${r.so} tài khoản`);
    await tai();
  }
  async function sua(id: string, patch: Partial<Pick<TaiSan, 'teamId' | 'khach' | 'theoDoi'>>) {
    await api(`/nen-tang/tai-san/${encodeURIComponent(id)}`, { method: 'PATCH', body: patch });
    setD((x) => (x ? { ...x, ds: x.ds.map((t) => (t.id === id ? { ...t, ...patch } : t)) } : x));
  }

  if (!d) return <div className="card text-sm text-ink-muted">Đang tải…</div>;
  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm text-ink-muted">
          Bật <b>Theo dõi</b> và chọn <b>phòng</b> được xem — nhân sự phòng đó thấy chỉ số ở các tab bên cạnh. Gắn tên khách cho dễ đọc. Số
          tự cập nhật 6 tiếng / lần.
        </p>
        <AsyncButton className="btn-primary ml-auto py-1.5 text-sm" onClick={lamMoi} busyLabel="Đang lấy…">
          ↻ Lấy danh sách từ kết nối
        </AsyncButton>
      </div>
      {d.canCapNhatDb && <p className="rounded-xl bg-amber-50 p-3 text-sm">Cần bấm <b>Quản trị → 🛠 Cập nhật cấu trúc DB</b> trước.</p>}
      {!d.ds.length && !d.canCapNhatDb && <p className="text-sm text-ink-muted">Chưa có tài khoản — kết nối Facebook / Google ở tab 🔌 Kết nối rồi bấm “Lấy danh sách”.</p>}
      {(['meta', 'gads', 'ga4', 'gsc'] as Loai[]).map((loai) => {
        const ds = d.ds.filter((t) => t.loai === loai);
        if (!ds.length) return null;
        return (
          <div key={loai}>
            <p className="mb-1 font-medium">{TEN_LOAI[loai]}</p>
            <ul className="divide-y divide-brand-100">
              {ds.map((t) => (
                <li key={t.id} className="flex flex-wrap items-center gap-2 py-2 text-sm">
                  <label className="flex min-w-0 flex-1 items-center gap-2">
                    <input type="checkbox" className="h-5 w-5" checked={t.theoDoi} onChange={(e) => sua(t.id, { theoDoi: e.target.checked })} />
                    <span className="min-w-0">
                      <span className="block truncate font-medium">{t.ten}</span>
                      <span className="block truncate text-xs text-ink-muted">
                        {t.ghiChu}
                        {t.loi ? ` · ⚠ ${t.loi}` : ''}
                      </span>
                    </span>
                  </label>
                  <select className="input w-auto py-1" value={t.teamId} onChange={(e) => sua(t.id, { teamId: e.target.value })} aria-label={`Phòng xem ${t.ten}`}>
                    <option value="">Chỉ giám đốc</option>
                    <option value="*">Mọi phòng</option>
                    {d.teams.map((x) => (
                      <option key={x.id} value={x.id}>
                        {x.name}
                      </option>
                    ))}
                  </select>
                  <input
                    className="input w-40 py-1"
                    placeholder="Tên khách"
                    defaultValue={t.khach}
                    aria-label={`Khách của ${t.ten}`}
                    onBlur={(e) => e.target.value.trim() !== t.khach && sua(t.id, { khach: e.target.value.trim() })}
                  />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </div>
  );
}

// ── Trang ──

type Tab = Loai | 'nhat_ky' | 'tai_khoan' | 'fanpage' | 'ket_noi';

export default function KetNoiMcp() {
  const { user } = useAuth();
  const laGd = user?.role === 'director';
  const [params, setParams] = useSearchParams();
  const tabs: Array<{ key: Tab; label: string }> = [
    { key: 'meta', label: 'Meta Ads' },
    { key: 'gads', label: 'Google Ads' },
    { key: 'ga4', label: 'GA4' },
    { key: 'gsc', label: 'Search Console' },
    { key: 'nhat_ky', label: '📝 Nhật ký & đề xuất' },
    ...(laGd
      ? ([
          { key: 'tai_khoan', label: '⚙️ Tài khoản' },
          { key: 'fanpage', label: '📣 Fanpage' },
          { key: 'ket_noi', label: '🔌 Kết nối' },
        ] as Array<{ key: Tab; label: string }>)
      : []),
  ];
  const tab = (tabs.find((t) => t.key === params.get('tab'))?.key || 'meta') as Tab;

  return (
    <div className="space-y-4">
      <PageHeader
        title="🔌 Kết nối MCP"
        desc="Chỉ số Meta Ads, Google Ads, GA4, Search Console của các tài khoản giao cho phòng bạn — 7 ngày gần nhất so với 7 ngày trước."
      />
      <div className="-mx-1 overflow-x-auto">
        <div className="flex gap-1.5 px-1 pb-1" role="tablist">
          {tabs.map((t) => (
            <button
              key={t.key}
              role="tab"
              aria-selected={tab === t.key}
              className={`whitespace-nowrap rounded-xl border px-3 py-1.5 text-sm ${tab === t.key ? 'border-brand-600 bg-brand-600 text-ink' : 'border-brand-200 bg-white text-ink-soft'}`}
              onClick={() => setParams({ tab: t.key })}
            >
              {t.label}
            </button>
          ))}
        </div>
      </div>
      {(['meta', 'gads', 'ga4', 'gsc'] as Tab[]).includes(tab) && <TabChiSo loai={tab as Loai} laGd={laGd} />}
      {tab === 'tai_khoan' && laGd && <TabTaiKhoan />}
      {tab === 'fanpage' && laGd && <AdminFanpage />}
      {tab === 'ket_noi' && laGd && <AdminKetNoi />}
      {tab === 'nhat_ky' && <AdsNhatKy />}
    </div>
  );
}
