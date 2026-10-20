// Gửi tin Zalo hàng loạt (anh Tâm 20/10/2026: "bổ sung trong đó phần gửi tin nhắn hàng loạt qua zalo nữa, lọc các
// yếu tố mà zalo cho phép, tích chọn vào những người để gửi"). Chỉ giám đốc. Máy chủ gửi chậm theo nhịp cron
// (8h–21h, giới hạn mỗi ngày) để giảm nguy cơ Zalo khoá tài khoản.
import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge, EmptyState, PhanTrang, SkeletonRows, type BadgeVariant } from './ui';

interface NguoiNhan {
  id: string;
  ten: string;
  laNhom: boolean;
  laBan: boolean;
  gioiTinh: number;
  nhan: string[];
  khach: null | { id: string; ten: string; trangThai: string; nguon: string };
  tinCuoi: string;
  daLoai: boolean;
  guiCuoi: string;
}
interface NhanZalo {
  id: string;
  ten: string;
  mau: string;
  emoji: string;
  soCuoc: number;
}
interface DuLieu {
  ds: NguoiNhan[];
  nhan: NhanZalo[];
  danhBaLuc: string;
  daGuiHomNay: number;
  gioiHanNgay: number;
  gioGui: [number, number];
  toiDaNguoi: number;
  needsMigrate?: boolean;
}
interface ChienDich {
  id: string;
  noiDung: string;
  taoLuc: string;
  trangThai: string;
  tong: number;
  ghiChu: string;
  daGui: number;
  loi: number;
  bo: number;
  cho: number;
}
interface DongGui {
  id: string;
  ten: string;
  laNhom: boolean;
  trangThai: string;
  loi: string;
  guiLuc: string;
}

const NGAY = 24 * 3600 * 1000;
const CO_TRANG = 30;
const ngayGio = (iso: string) =>
  iso ? new Date(iso).toLocaleString('vi-VN', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';

/** Nội dung mẫu cho một người — giống máy chủ (lib/zaloGui.traiNoiDung), lấy phương án đầu cho dễ đọc. */
function xemTruoc(mau: string, ten: string): string {
  const goi = ten.replace(/\(.*?\)|\[.*?\]/g, ' ').split(/\s[-–|]\s/)[0]!.replace(/\s+/g, ' ').trim();
  let s = mau.replace(/\{([^{}]*\|[^{}]*)\}/g, (_, nhom: string) => nhom.split('|')[0] ?? '').replace(/\{\s*ten\s*\}/gi, goi);
  if (!goi) s = s.replace(/[ \t]+([,.!?])/g, '$1').replace(/,(\s*[,.!?])/g, '$1');
  return s
    .split('\n')
    .map((d) => d.replace(/[ \t]{2,}/g, ' ').trim())
    .join('\n')
    .trim();
}

const TRANG_THAI_CD: Record<string, { label: string; variant: BadgeVariant }> = {
  dang_gui: { label: 'Đang gửi', variant: 'info' },
  tam_dung: { label: 'Tạm dừng', variant: 'warn' },
  dung: { label: 'Đã dừng', variant: 'neutral' },
  xong: { label: 'Xong', variant: 'success' },
};
const TRANG_THAI_GUI: Record<string, string> = { cho: '⏳ chờ', da_gui: '✓ đã gửi', loi: '✗ lỗi', bo: '— bỏ' };

export default function ZaloGuiHangLoat() {
  const toast = useToast();
  const [dl, setDl] = useState<DuLieu | null>(null);
  const [cd, setCd] = useState<ChienDich[]>([]);
  const [chon, setChon] = useState<Set<string>>(new Set());
  const [noiDung, setNoiDung] = useState('');
  const [trang, setTrang] = useState(1);
  const [moCd, setMoCd] = useState<{ id: string; ds: DongGui[] } | null>(null);
  // Bộ lọc
  const [tim, setTim] = useState('');
  const [loai, setLoai] = useState<'' | 'rieng' | 'nhom'>('');
  const [ban, setBan] = useState<'' | 'ban' | 'chua'>('');
  const [nhan, setNhan] = useState('');
  const [gioiTinh, setGioiTinh] = useState<'' | '0' | '1'>('');
  const [khach, setKhach] = useState<'' | 'co' | 'khong'>('');
  const [trangThaiKh, setTrangThaiKh] = useState('');
  const [nguon, setNguon] = useState('');
  const [tinCuoi, setTinCuoi] = useState<'' | '7' | '30' | '90' | 'cu' | 'chua'>('');
  const [anLoai, setAnLoai] = useState(true);
  const [an24h, setAn24h] = useState(true);

  async function tai() {
    setDl(await api<DuLieu>('/zalo/gui/nguoi-nhan'));
  }
  async function taiCd() {
    setCd((await api<{ ds: ChienDich[] }>('/zalo/gui')).ds);
  }
  useEffect(() => {
    tai().catch((e) => toast.error((e as Error).message));
    taiCd().catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Đang có chiến dịch gửi → cập nhật tiến độ mỗi 30 giây.
  const dangChay = cd.some((c) => c.trangThai === 'dang_gui');
  useEffect(() => {
    if (!dangChay) return;
    const h = setInterval(() => taiCd().catch(() => undefined), 30_000);
    return () => clearInterval(h);
  }, [dangChay]);

  const dsTrangThai = useMemo(() => [...new Set((dl?.ds || []).map((x) => x.khach?.trangThai || '').filter(Boolean))].sort(), [dl]);
  const dsNguon = useMemo(() => [...new Set((dl?.ds || []).map((x) => x.khach?.nguon || '').filter(Boolean))].sort(), [dl]);

  const loc = useMemo(() => {
    const bayGio = Date.now();
    const t = tim.trim().toLowerCase();
    return (dl?.ds || []).filter((x) => {
      if (t && !`${x.ten} ${x.khach?.ten || ''}`.toLowerCase().includes(t)) return false;
      if (loai === 'rieng' && x.laNhom) return false;
      if (loai === 'nhom' && !x.laNhom) return false;
      if (ban === 'ban' && !x.laBan) return false;
      if (ban === 'chua' && (x.laBan || x.laNhom)) return false;
      if (nhan && !x.nhan.includes(nhan)) return false;
      if (gioiTinh && String(x.gioiTinh) !== gioiTinh) return false;
      if (khach === 'co' && !x.khach) return false;
      if (khach === 'khong' && x.khach) return false;
      if (trangThaiKh && x.khach?.trangThai !== trangThaiKh) return false;
      if (nguon && x.khach?.nguon !== nguon) return false;
      if (tinCuoi) {
        const ms = x.tinCuoi ? bayGio - Date.parse(x.tinCuoi) : Infinity;
        if (tinCuoi === 'chua' && x.tinCuoi) return false;
        if (tinCuoi === 'cu' && !(x.tinCuoi && ms > 90 * NGAY)) return false;
        if (['7', '30', '90'].includes(tinCuoi) && !(ms <= Number(tinCuoi) * NGAY)) return false;
      }
      if (anLoai && x.daLoai) return false;
      if (an24h && x.guiCuoi && bayGio - Date.parse(x.guiCuoi) < NGAY) return false;
      return true;
    });
  }, [dl, tim, loai, ban, nhan, gioiTinh, khach, trangThaiKh, nguon, tinCuoi, anLoai, an24h]);

  useEffect(() => setTrang(1), [tim, loai, ban, nhan, gioiTinh, khach, trangThaiKh, nguon, tinCuoi, anLoai, an24h]);

  const toiDa = dl?.toiDaNguoi || 500;
  const daChonTrongLoc = loc.filter((x) => chon.has(x.id)).length;
  const nguoiDau = (dl?.ds || []).find((x) => chon.has(x.id));
  const tenNhan = (id: string) => dl?.nhan.find((n) => n.id === id);

  function bat(id: string) {
    setChon((cu) => {
      const m = new Set(cu);
      if (m.has(id)) m.delete(id);
      else if (m.size < toiDa) m.add(id);
      else toast.error(`Mỗi lần gửi tối đa ${toiDa} người`);
      return m;
    });
  }
  function chonHet() {
    setChon((cu) => {
      const m = new Set(cu);
      for (const x of loc) {
        if (m.size >= toiDa) break;
        m.add(x.id);
      }
      if (loc.length + cu.size > toiDa) toast.error(`Chỉ chọn được tối đa ${toiDa} người mỗi lần gửi`);
      return m;
    });
  }

  async function capNhatDanhBa() {
    const r = await api<{ ok: boolean; note: string }>('/zalo/gui/danh-ba', { body: {} });
    if (r.ok) toast.success(`Đã lấy từ Zalo: ${r.note}`);
    else toast.error(r.note);
    await tai();
  }

  async function gui() {
    if (!chon.size) return toast.error('Chưa tích chọn người nhận');
    if (noiDung.trim().length < 2) return toast.error('Chưa soạn nội dung');
    const conHomNay = Math.max(0, (dl?.gioiHanNgay || 100) - (dl?.daGuiHomNay || 0));
    const ngay = chon.size <= conHomNay ? 'trong hôm nay' : `khoảng ${Math.ceil((chon.size - conHomNay) / (dl?.gioiHanNgay || 100)) + 1} ngày`;
    if (
      !confirm(
        `Gửi tin cho ${chon.size} người / nhóm?\n\nMáy chủ gửi chậm (vài tin mỗi phút, ${dl?.gioGui[0]}h–${dl?.gioGui[1]}h, tối đa ${dl?.gioiHanNgay} tin/ngày) — xong ${ngay}. Có thể dừng giữa chừng.`,
      )
    )
      return;
    const r = await api<{ ok: boolean; soNguoi: number; boQua: number }>('/zalo/gui', { body: { noiDung, ids: [...chon] } });
    toast.success(`Đã xếp lịch gửi ${r.soNguoi} người${r.boQua ? ` (bỏ ${r.boQua} không hợp lệ)` : ''}`);
    setChon(new Set());
    setNoiDung('');
    await taiCd();
  }

  async function doiTrangThai(id: string, trangThai: 'dung' | 'tam_dung' | 'dang_gui') {
    if (trangThai === 'dung' && !confirm('Dừng hẳn chiến dịch này? Người chưa gửi sẽ bị bỏ.')) return;
    await api(`/zalo/gui/${id}/trang-thai`, { body: { trangThai } });
    await taiCd();
  }
  async function xemCd(id: string) {
    if (moCd?.id === id) return setMoCd(null);
    setMoCd({ id, ds: (await api<{ ds: DongGui[] }>(`/zalo/gui/${id}`)).ds });
  }

  if (!dl) return <SkeletonRows rows={5} />;
  if (dl.needsMigrate)
    return (
      <div className="card border-amber-200 bg-amber-50 text-sm text-amber-800">
        Vào <b>Quản trị → 🛠 Cập nhật cấu trúc DB</b> trước để bật gửi tin hàng loạt.
      </div>
    );

  const sel = 'input w-full py-1.5 pl-3 pr-7 text-sm';
  return (
    <div className="space-y-3">
      <div className="card space-y-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h2 className="font-semibold">📣 Gửi tin Zalo hàng loạt</h2>
          <AsyncButton className="btn-ghost py-1.5 text-sm" busyLabel="Đang lấy…" onClick={capNhatDanhBa}>
            🔄 Cập nhật danh bạ Zalo
          </AsyncButton>
        </div>
        <p className="text-xs text-ink-muted">
          Gửi từ tài khoản Zalo đã kết nối, cho người / nhóm anh tích chọn. Máy chủ gửi <b>chậm và rải đều</b>: chỉ {dl.gioGui[0]}h–
          {dl.gioGui[1]}h, tối đa <b>{dl.gioiHanNgay} tin/ngày</b>, mỗi tin cách nhau ngẫu nhiên, một người không nhận 2 tin trong 24
          giờ — Zalo cá nhân gửi dồn dập dễ bị khoá. Hôm nay đã gửi <b>{dl.daGuiHomNay}</b>/{dl.gioiHanNgay}.
          {dl.danhBaLuc ? ` Danh bạ cập nhật ${ngayGio(dl.danhBaLuc)}.` : ' Chưa lấy danh bạ bạn bè / thẻ phân loại — bấm "Cập nhật danh bạ Zalo".'}
        </p>
      </div>

      <div className="card space-y-3">
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
          <input className={`${sel} col-span-2 sm:col-span-1`} placeholder="Tìm tên…" value={tim} onChange={(e) => setTim(e.target.value)} />
          <select className={sel} value={loai} onChange={(e) => setLoai(e.target.value as typeof loai)}>
            <option value="">Loại: tất cả</option>
            <option value="rieng">Chỉ cá nhân</option>
            <option value="nhom">Chỉ nhóm</option>
          </select>
          <select className={sel} value={ban} onChange={(e) => setBan(e.target.value as typeof ban)}>
            <option value="">Bạn bè: tất cả</option>
            <option value="ban">Bạn bè Zalo</option>
            <option value="chua">Chưa kết bạn</option>
          </select>
          <select className={sel} value={nhan} onChange={(e) => setNhan(e.target.value)}>
            <option value="">Thẻ: tất cả</option>
            {dl.nhan.map((n) => (
              <option key={n.id} value={n.id}>
                {n.emoji} {n.ten} ({n.soCuoc})
              </option>
            ))}
          </select>
          <select className={sel} value={gioiTinh} onChange={(e) => setGioiTinh(e.target.value as typeof gioiTinh)}>
            <option value="">Giới tính</option>
            <option value="0">Nam</option>
            <option value="1">Nữ</option>
          </select>
          <select className={sel} value={khach} onChange={(e) => setKhach(e.target.value as typeof khach)}>
            <option value="">Khách CRM</option>
            <option value="co">Là khách CRM</option>
            <option value="khong">Chưa là khách</option>
          </select>
          <select className={sel} value={trangThaiKh} onChange={(e) => setTrangThaiKh(e.target.value)}>
            <option value="">Trạng thái KH</option>
            {dsTrangThai.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className={sel} value={nguon} onChange={(e) => setNguon(e.target.value)}>
            <option value="">Nguồn KH</option>
            {dsNguon.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select className={sel} value={tinCuoi} onChange={(e) => setTinCuoi(e.target.value as typeof tinCuoi)}>
            <option value="">Lần nhắn cuối</option>
            <option value="7">Trong 7 ngày</option>
            <option value="30">Trong 30 ngày</option>
            <option value="90">Trong 90 ngày</option>
            <option value="cu">Hơn 90 ngày</option>
            <option value="chua">Chưa nhắn trong app</option>
          </select>
        </div>
        <div className="flex flex-wrap gap-x-4 gap-y-1 text-sm">
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={anLoai} onChange={(e) => setAnLoai(e.target.checked)} /> Ẩn cuộc đã loại (không liên quan)
          </label>
          <label className="flex items-center gap-1.5">
            <input type="checkbox" checked={an24h} onChange={(e) => setAn24h(e.target.checked)} /> Ẩn người đã nhận tin trong 24 giờ
          </label>
        </div>
        <div className="flex flex-wrap items-center gap-2 text-sm">
          <span className="text-ink-muted">
            {loc.length} khớp bộ lọc · <b className="text-ink">đã chọn {chon.size}</b>
            {chon.size > daChonTrongLoc ? ` (${chon.size - daChonTrongLoc} ngoài bộ lọc)` : ''}
          </span>
          <button className="btn-ghost ml-auto px-3 py-1 text-sm" onClick={chonHet} disabled={!loc.length}>
            ☑ Chọn hết {Math.min(loc.length, toiDa)}
          </button>
          <button className="btn-ghost px-3 py-1 text-sm" onClick={() => setChon(new Set())} disabled={!chon.size}>
            Bỏ chọn
          </button>
        </div>
        {!loc.length ? (
          <EmptyState icon="🔍" text="Không có ai khớp bộ lọc." />
        ) : (
          <ul className="divide-y">
            {loc.slice((trang - 1) * CO_TRANG, trang * CO_TRANG).map((x) => (
              <li key={x.id}>
                <label className="flex cursor-pointer items-start gap-3 py-2">
                  <input type="checkbox" className="mt-1 h-4 w-4 shrink-0" checked={chon.has(x.id)} onChange={() => bat(x.id)} />
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-medium">{x.ten}</span>
                    <span className="mt-0.5 flex flex-wrap gap-1 text-xs text-ink-muted">
                      {x.laNhom ? <Badge variant="info">Nhóm</Badge> : x.laBan ? <Badge variant="neutral">Bạn bè</Badge> : null}
                      {x.nhan.map((id) => {
                        const n = tenNhan(id);
                        return n ? (
                          <span key={id} className="rounded-md px-1.5" style={{ background: n.mau ? `${n.mau}22` : undefined }}>
                            {n.emoji} {n.ten}
                          </span>
                        ) : null;
                      })}
                      {x.khach && (
                        <span className="rounded-md bg-brand-50 px-1.5">
                          👤 {x.khach.trangThai || 'khách'}
                          {x.khach.nguon ? ` · ${x.khach.nguon}` : ''}
                        </span>
                      )}
                      {x.tinCuoi && <span>💬 {ngayGio(x.tinCuoi)}</span>}
                      {x.guiCuoi && <span className="text-amber-700">📣 đã gửi {ngayGio(x.guiCuoi)}</span>}
                    </span>
                  </span>
                </label>
              </li>
            ))}
          </ul>
        )}
        <PhanTrang trang={trang} tong={loc.length} co={CO_TRANG} onDoi={setTrang} />
      </div>

      <div className="card space-y-2">
        <h3 className="font-semibold">✍️ Nội dung</h3>
        <textarea
          className="input min-h-[120px] w-full text-sm"
          maxLength={2000}
          placeholder={'{Chào|Xin chào} {ten}, MT Digital gửi anh/chị ưu đãi tháng này…'}
          value={noiDung}
          onChange={(e) => setNoiDung(e.target.value)}
        />
        <div className="flex flex-wrap items-center gap-2 text-xs text-ink-muted">
          <button className="rounded-full bg-brand-50 px-2.5 py-1 hover:bg-brand-100" onClick={() => setNoiDung((s) => `${s}{ten}`)}>
            + {'{ten}'} tên người nhận
          </button>
          <button className="rounded-full bg-brand-50 px-2.5 py-1 hover:bg-brand-100" onClick={() => setNoiDung((s) => `${s}{Chào|Xin chào}`)}>
            + {'{Chào|Xin chào}'} chọn ngẫu nhiên
          </button>
          <span className="ml-auto">{noiDung.length}/2000</span>
        </div>
        <p className="text-xs text-ink-muted">
          Mỗi người nhận một câu hơi khác nhau (tên riêng, lời chào ngẫu nhiên) — Zalo ít coi là tin rác hơn so với gửi y hệt.
        </p>
        {noiDung.trim() && nguoiDau && (
          <div className="rounded-xl bg-brand-50 p-3 text-sm">
            <div className="mb-1 text-xs text-ink-muted">Xem trước — gửi {nguoiDau.ten}:</div>
            <div className="whitespace-pre-wrap">{xemTruoc(noiDung, nguoiDau.ten)}</div>
          </div>
        )}
        <div className="flex justify-end">
          <AsyncButton className="btn-primary" disabled={!chon.size || noiDung.trim().length < 2} onClick={gui} busyLabel="Đang xếp lịch…">
            📣 Gửi cho {chon.size} người
          </AsyncButton>
        </div>
      </div>

      <div className="card space-y-2">
        <h3 className="font-semibold">Các lần gửi</h3>
        {!cd.length ? (
          <EmptyState icon="📭" text="Chưa gửi lần nào." />
        ) : (
          <ul className="divide-y">
            {cd.map((c) => {
              const tt = TRANG_THAI_CD[c.trangThai] || { label: c.trangThai, variant: 'neutral' as BadgeVariant };
              const pct = c.tong ? Math.round(((c.daGui + c.loi + c.bo) / c.tong) * 100) : 0;
              return (
                <li key={c.id} className="space-y-1.5 py-2">
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge variant={tt.variant}>{tt.label}</Badge>
                    <span className="text-xs text-ink-muted">{ngayGio(c.taoLuc)}</span>
                    <span className="ml-auto flex gap-2 text-xs">
                      {c.trangThai === 'dang_gui' && (
                        <button className="text-amber-700 underline" onClick={() => doiTrangThai(c.id, 'tam_dung')}>
                          tạm dừng
                        </button>
                      )}
                      {c.trangThai === 'tam_dung' && (
                        <button className="text-ocean-600 underline" onClick={() => doiTrangThai(c.id, 'dang_gui')}>
                          chạy tiếp
                        </button>
                      )}
                      {(c.trangThai === 'dang_gui' || c.trangThai === 'tam_dung') && (
                        <button className="text-rose-600 underline" onClick={() => doiTrangThai(c.id, 'dung')}>
                          dừng hẳn
                        </button>
                      )}
                      <button className="text-ocean-600 underline" onClick={() => xemCd(c.id).catch((e) => toast.error((e as Error).message))}>
                        {moCd?.id === c.id ? 'ẩn' : 'chi tiết'}
                      </button>
                    </span>
                  </div>
                  <p className="line-clamp-2 whitespace-pre-wrap text-sm">{c.noiDung}</p>
                  <div className="h-1.5 overflow-hidden rounded-full bg-brand-50">
                    <div className="h-full bg-emerald-500" style={{ width: `${pct}%` }} />
                  </div>
                  <p className="text-xs text-ink-muted">
                    Đã gửi {c.daGui}/{c.tong}
                    {c.cho ? ` · chờ ${c.cho}` : ''}
                    {c.loi ? ` · lỗi ${c.loi}` : ''}
                    {c.bo ? ` · bỏ ${c.bo}` : ''}
                    {c.ghiChu && <span className="block text-amber-800">{c.ghiChu}</span>}
                  </p>
                  {moCd?.id === c.id && (
                    <ul className="max-h-72 space-y-0.5 overflow-y-auto rounded-xl bg-brand-50 p-2 text-xs">
                      {moCd.ds.map((d) => (
                        <li key={d.id} className="flex gap-2">
                          <span className="w-16 shrink-0">{TRANG_THAI_GUI[d.trangThai] || d.trangThai}</span>
                          <span className="min-w-0 flex-1 truncate">
                            {d.ten}
                            {d.loi && <span className="text-ink-muted"> — {d.loi}</span>}
                          </span>
                          {d.guiLuc && <span className="shrink-0 text-ink-faint">{ngayGio(d.guiLuc)}</span>}
                        </li>
                      ))}
                    </ul>
                  )}
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}
