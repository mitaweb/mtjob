import { useEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { vnd } from '../lib/format';
import { useToast } from '../components/Toaster';
import { Badge, EmptyState, PageHeader, PhanTrang, SkeletonRows } from '../components/ui';

// Kế toán thuế (anh Tâm 18/10/2026): "update hóa đơn, update con số để nắm được chỉ số quan trọng: Thuế VAT cần đóng,
// Thuế TNDN cần đóng, 3 năm 2024, 2025, 2026 anh được miễn thuế TNDN. Và công nợ các bên". Chỉ giám đốc.

interface DongVat {
  ky: string;
  dauRa: number;
  dauVao: number;
  kyTruoc: number;
  phaiNop: number;
  chuyenKySau: number;
  nguon: 'to_khai' | 'uoc_tinh';
  hanNop: string;
  soHdRa: number;
  soHdVao: number;
}
interface Tndn {
  nam: number;
  loiNhuan: number;
  doanhThu: number;
  nguon: 'bao_cao' | 'bao_cao_luy_ke' | 'uoc_tinh';
  denNgay: string;
  thueSuat: number;
  thueNeuKhongMien: number;
  mien: boolean;
  phaiNop: number;
  chiPhiLuong: number;
  loiNhuanKeToan: number;
  chiPhiKhongTru: number;
  loiNhuanTinhThueKeToanGhi: number | null;
  tuKeToan: boolean;
}
interface DongKetQuaThang {
  thang: string;
  thu: number;
  chi: number;
  luong: number;
  laiLo: number;
  soHdRa: number;
  soHdVao: number;
  coLuong: boolean;
}
interface ViecKeToan {
  id: string;
  loai: string;
  noiDung: string;
  soTien: number;
  doiTac: string;
  ngay: string;
  xong: boolean;
}
interface CongNoDoiTac {
  ma: string;
  ten: string;
  soDu: number;
  hoaDonSau: number;
  thanhToanSau: number;
  tong: number;
}
interface GiaoDich {
  id: string;
  soTk: string;
  nganHang: string;
  ngay: string;
  ghiNo: number;
  ghiCo: number;
  soDu: number;
  noiDung: string;
  soRef: string;
}
interface TaiKhoan {
  soTk: string;
  nganHang: string;
  tuNgay: string;
  denNgay: string;
  soGd: number;
  tongVao: number;
  tongRa: number;
  soDuCuoi: number;
}
interface CongNo {
  ngayChot: string;
  ds: CongNoDoiTac[];
  tong: number;
  phai: number;
  truoc: number;
}
interface TongQuan {
  nam: number;
  homNay: string;
  quyNay: string;
  caiDat: { mst: string; namMien: number[] };
  vat: DongVat[];
  quyDangChay: DongVat | null;
  sapToi: DongVat | null;
  tndn: Tndn[];
  congNo: { thu: CongNo; tra: CongNo };
  ketQuaThang: DongKetQuaThang[];
  nganHang: {
    taiKhoan: TaiKhoan[];
    tienVaoChuaKhop: GiaoDich[];
    soTienVaoChuaKhop: number;
    canhBao5tr: { so: number; tongThue: number; ds: HoaDon[] };
  };
  soHoaDon: number;
  coDuLieu: boolean;
}
interface HoaDon {
  khoa: string;
  huong: 'ra' | 'vao';
  kyHieu: string;
  soHd: string;
  ngay: string;
  mstDoiTac: string;
  tenDoiTac: string;
  dienGiai: string;
  tienHang: number;
  tienThue: number;
  tongTien: number;
  thueSuat: string;
  trangThai: string;
  kyKeKhai: string;
  nguon: string;
}
interface KetQuaTep {
  ten: string;
  loai: string;
  ok: boolean;
  thongDiep: string;
}

const ngayVN = (iso: string) => (iso ? iso.split('-').reverse().join('/') : '');
const tenKy = (ky: string) => ky.replace(/^(\d{4})-Q(\d)$/, 'Quý $2/$1');
const DUOI_BANG = /\.(xlsx|xlsm|xls|csv)$/i;
const DUOI_XML = /\.xml$/i;

type FileTho = { kieu: 'bang'; ten: string; sheets: Array<{ ten: string; rows: string[][] }> } | { kieu: 'xml'; ten: string; noiDung: string };

/** Đọc file ngay trên trình duyệt (không tải file lên máy chủ): Excel/CSV → các dòng chữ, XML → nội dung. */
async function docFile(f: File): Promise<FileTho | null> {
  if (DUOI_XML.test(f.name)) return { kieu: 'xml', ten: f.name, noiDung: await f.text() };
  if (!DUOI_BANG.test(f.name)) return null;
  const XLSX = await import('xlsx');
  const wb = XLSX.read(await f.arrayBuffer(), { type: 'array' });
  const sheets = wb.SheetNames.slice(0, 20).map((ten) => {
    const rows = XLSX.utils
      .sheet_to_json<unknown[]>(wb.Sheets[ten]!, { header: 1, raw: false, defval: '', blankrows: false, dateNF: 'dd/mm/yyyy' })
      .slice(0, 10000)
      .map((r) => {
        const o = r.slice(0, 40).map((x) => String(x ?? '').slice(0, 2000));
        while (o.length && !o[o.length - 1]!.trim()) o.pop();
        return o;
      });
    return { ten: ten.slice(0, 100), rows };
  });
  return { kieu: 'bang', ten: f.name, sheets };
}

export default function KeToanThue() {
  const toast = useToast();
  const namNay = new Date().getFullYear();
  const [nam, setNam] = useState(namNay);
  const [tq, setTq] = useState<TongQuan | null>(null);
  const [nhatKy, setNhatKy] = useState<KetQuaTep[]>([]);
  const [dangTai, setDangTai] = useState('');
  const [keo, setKeo] = useState(false);
  const [lan, setLan] = useState(0); // đổi → tải lại danh sách hoá đơn
  const oFile = useRef<HTMLInputElement>(null);
  const oThuMuc = useRef<HTMLInputElement>(null);

  async function taiTongQuan(n = nam) {
    setTq(await api<TongQuan>(`/ke-toan/tong-quan?nam=${n}`));
  }
  useEffect(() => {
    taiTongQuan(nam).catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nam]);

  async function xuLy(ds: FileList | File[] | null) {
    const files = [...(ds || [])];
    if (!files.length) return;
    const ketQua: KetQuaTep[] = [];
    let boQua = 0;
    const xml: Array<{ ten: string; noiDung: string }> = [];
    try {
      for (let i = 0; i < files.length; i++) {
        const f = files[i]!;
        setDangTai(`Đang đọc ${i + 1}/${files.length}: ${f.name}`);
        if (f.size > 15 * 1024 * 1024) {
          ketQua.push({ ten: f.name, loai: 'Quá lớn', ok: false, thongDiep: 'File trên 15 MB — bỏ qua' });
          continue;
        }
        const d = await docFile(f).catch((e) => {
          ketQua.push({ ten: f.name, loai: 'Lỗi đọc', ok: false, thongDiep: (e as Error).message });
          return null;
        });
        if (!d) {
          if (!DUOI_BANG.test(f.name) && !DUOI_XML.test(f.name)) boQua++;
          continue;
        }
        if (d.kieu === 'xml') xml.push({ ten: d.ten, noiDung: d.noiDung.slice(0, 400_000) });
        else ketQua.push(await api<KetQuaTep>('/ke-toan/tai-len/bang', { body: { ten: d.ten, sheets: d.sheets } }));
      }
      // XML gửi theo lô (≤ 25 file, ≤ ~3 MB mỗi lô).
      let lo: typeof xml = [];
      let coLo = 0;
      const gui = async () => {
        if (!lo.length) return;
        setDangTai(`Đang ghi ${lo.length} file XML…`);
        const r = await api<{ ketQua: KetQuaTep[] }>('/ke-toan/tai-len/xml', { body: { files: lo } });
        ketQua.push(...r.ketQua.filter((x) => x.ok || x.loai !== 'XML khác'));
        boQua += r.ketQua.filter((x) => !x.ok && x.loai === 'XML khác').length;
        lo = [];
        coLo = 0;
      };
      for (const x of xml) {
        if (lo.length >= 25 || coLo + x.noiDung.length > 3_000_000) await gui();
        lo.push(x);
        coLo += x.noiDung.length;
      }
      await gui();
      if (boQua) ketQua.push({ ten: `${boQua} file`, loai: 'Bỏ qua', ok: true, thongDiep: 'PDF, file nén, thông báo / tờ khai khác — không cần cho số liệu thuế' });
      setNhatKy(ketQua);
      const ok = ketQua.filter((x) => x.ok && x.loai !== 'Bỏ qua').length;
      if (ok) toast.success(`Đã cập nhật ${ok} mục`);
      await taiTongQuan();
      setLan((x) => x + 1);
    } catch (e) {
      toast.error((e as Error).message);
      setNhatKy(ketQua);
    } finally {
      setDangTai('');
      if (oFile.current) oFile.current.value = '';
      if (oThuMuc.current) oThuMuc.current.value = '';
    }
  }

  const tndnNam = tq?.tndn.find((t) => t.nam === nam);
  const cacNam = useMemo(() => {
    const s = new Set<number>([namNay, ...(tq?.tndn.map((t) => t.nam) || [])]);
    return [...s].filter((n) => n >= 2024).sort((a, b) => b - a);
  }, [tq, namNay]);

  return (
    <div className="space-y-4">
      <PageHeader
        title="🧾 Kế toán thuế"
        desc="Số liệu theo sổ sách thuế: VAT phải nộp, thuế TNDN, công nợ các bên — chỉ giám đốc xem."
        action={
          <select className="input w-auto" value={nam} onChange={(e) => setNam(Number(e.target.value))} aria-label="Năm">
            {cacNam.map((n) => (
              <option key={n} value={n}>
                Năm {n}
              </option>
            ))}
          </select>
        }
      />

      {/* Tải file — một chỗ cho mọi loại */}
      <div
        className={`card border-2 border-dashed ${keo ? 'border-ink bg-brand-50' : 'border-ink/40'}`}
        onDragOver={(e) => {
          e.preventDefault();
          setKeo(true);
        }}
        onDragLeave={() => setKeo(false)}
        onDrop={(e) => {
          e.preventDefault();
          setKeo(false);
          void xuLy(e.dataTransfer.files);
        }}
      >
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1">
            <div className="font-semibold">Kéo thả file kế toán gửi vào đây</div>
            <p className="text-sm text-ink-muted">
              Sao kê ngân hàng, bảng kê hoá đơn, hoá đơn / tờ khai XML, công nợ, báo cáo kết quả kinh doanh, bảng lương — file
              Excel mẫu lạ thì AI tự đọc nhận ra loại và cột. Chọn cả thư mục cũng được — app tự lọc file cần, bỏ qua PDF /
              file nén. Tải lại file cũ không bị nhân đôi.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button className="btn-primary" disabled={!!dangTai} onClick={() => oFile.current?.click()}>
              ＋ Chọn file
            </button>
            <button className="btn-ghost" disabled={!!dangTai} onClick={() => oThuMuc.current?.click()}>
              📁 Chọn thư mục
            </button>
          </div>
        </div>
        <input ref={oFile} type="file" multiple accept=".xlsx,.xlsm,.xls,.csv,.xml" className="hidden" onChange={(e) => xuLy(e.target.files)} />
        <input
          ref={oThuMuc}
          type="file"
          multiple
          className="hidden"
          onChange={(e) => xuLy(e.target.files)}
          {...({ webkitdirectory: '', directory: '' } as Record<string, string>)}
        />
        {dangTai && <div className="mt-3 rounded-xl bg-brand-50 px-3 py-2 text-sm text-ink-soft">{dangTai}</div>}
        {nhatKy.length > 0 && !dangTai && (
          <ul className="mt-3 space-y-1 text-sm">
            {nhatKy.map((x, i) => (
              <li key={i} className={x.ok ? 'text-ink-soft' : 'text-rose-600'}>
                {x.ok ? '✓' : '✗'} <b>{x.loai}</b> · {x.ten} — {x.thongDiep}
              </li>
            ))}
          </ul>
        )}
      </div>

      <BaoCaoKeToan
        onXong={async () => {
          await taiTongQuan();
        }}
      />

      <LayCongThue
        mstMacDinh={tq?.caiDat.mst || ''}
        onXong={async () => {
          await taiTongQuan();
          setLan((x) => x + 1);
        }}
      />

      {!tq ? (
        <SkeletonRows rows={4} />
      ) : !tq.coDuLieu ? (
        <div className="card">
          <EmptyState icon="🧾" text="Chưa có số liệu — kéo thả thư mục kế toán gửi vào ô trên." />
        </div>
      ) : (
        <>
          {/* Chỉ số chính */}
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <ChiSo
              nhan={tq.sapToi ? `VAT ${tenKy(tq.sapToi.ky)} phải nộp` : 'VAT phải nộp'}
              giaTri={tq.sapToi ? vnd(tq.sapToi.phaiNop) : '—'}
              phu={
                tq.sapToi
                  ? `Hạn ${ngayVN(tq.sapToi.hanNop)}${tq.sapToi.nguon === 'uoc_tinh' ? ' · ước tính' : ' · theo tờ khai'}${tq.sapToi.chuyenKySau ? ` · còn khấu trừ ${vnd(tq.sapToi.chuyenKySau)}` : ''}`
                  : 'Không có quý nào sắp tới hạn'
              }
              mau={tq.sapToi?.phaiNop ? 'text-rose-600' : 'text-emerald-700'}
            />
            <ChiSo
              nhan={`VAT ${tenKy(tq.quyNay)} (đang chạy)`}
              giaTri={tq.quyDangChay ? vnd(tq.quyDangChay.phaiNop) : '—'}
              phu={
                tq.quyDangChay
                  ? `Ước tính: ra ${vnd(tq.quyDangChay.dauRa)} − vào ${vnd(tq.quyDangChay.dauVao)} − kỳ trước ${vnd(tq.quyDangChay.kyTruoc)}`
                  : ''
              }
              mau="text-ink"
            />
            <ChiSo
              nhan={`Thuế TNDN năm ${nam}`}
              giaTri={tndnNam ? vnd(tndnNam.phaiNop) : '—'}
              phu={
                tndnNam?.mien
                  ? `Được miễn${tndnNam.thueNeuKhongMien ? ` — nếu không miễn: ${vnd(tndnNam.thueNeuKhongMien)}` : ''}`
                  : tndnNam
                    ? `${Math.round(tndnNam.thueSuat * 100)}% × lợi nhuận ${vnd(tndnNam.loiNhuan)}`
                    : ''
              }
              mau={tndnNam?.phaiNop ? 'text-rose-600' : 'text-emerald-700'}
            />
            <ChiSo
              nhan="Công nợ phải thu"
              giaTri={vnd(tq.congNo.thu.phai)}
              phu={`Phải trả ${vnd(tq.congNo.tra.phai)}${tq.congNo.thu.ngayChot ? ` · sổ chốt ${ngayVN(tq.congNo.thu.ngayChot)}` : ''}`}
              mau="text-ocean-700"
            />
          </div>

          <BangThuChi ds={tq.ketQuaThang} nam={nam} />
          <BangTndn tndn={tq.tndn} />
          <BangVat vat={tq.vat} nam={nam} />
          <BangCongNo thu={tq.congNo.thu} tra={tq.congNo.tra} />
          <NganHang nh={tq.nganHang} lan={lan} />
        </>
      )}

      <DanhSachHoaDon nam={nam} lan={lan} />
      <CaiDat tq={tq} onDoi={() => taiTongQuan()} />
    </div>
  );
}

// ── Lấy hoá đơn từ cổng hoá đơn điện tử Tổng cục Thuế (anh Tâm 18/10/2026: "các hóa đơn đầu vào sẽ tìm cách lấy từ
// cổng thuế"). Anh tự gõ captcha. Mật khẩu không lưu; mã phiên chỉ giữ trong tab này (sessionStorage). ──

const KHOA_PHIEN = 'kt_cong_thue';

interface PhienCongThue {
  token: string;
  mst: string;
  /** ms — hết hạn (đọc từ token nếu được, không thì ước 8 tiếng) */
  het: number;
}

function docPhien(): PhienCongThue | null {
  try {
    const p = JSON.parse(sessionStorage.getItem(KHOA_PHIEN) || 'null') as PhienCongThue | null;
    return p && p.token && p.het > Date.now() ? p : null;
  } catch {
    return null;
  }
}

function hetHanToken(token: string): number {
  try {
    const exp = Number(JSON.parse(atob(token.split('.')[1]!.replace(/-/g, '+').replace(/_/g, '/'))).exp);
    if (exp > 0) return exp * 1000;
  } catch {
    /* không phải JWT */
  }
  return Date.now() + 8 * 3600_000;
}

const thangNay = () => new Date().toISOString().slice(0, 7);
function dauQuyTruoc(): string {
  const d = new Date();
  const q = Math.floor(d.getMonth() / 3); // 0..3 — quý hiện tại
  const y = q === 0 ? d.getFullYear() - 1 : d.getFullYear();
  const thang = q === 0 ? 10 : (q - 1) * 3 + 1;
  return `${y}-${String(thang).padStart(2, '0')}`;
}
function cacThang(tu: string, den: string): string[] {
  const ra: string[] = [];
  let [y, m] = tu.split('-').map(Number) as [number, number];
  const [y2, m2] = den.split('-').map(Number) as [number, number];
  while ((y < y2 || (y === y2 && m <= m2)) && ra.length < 36) {
    ra.push(`${y}-${String(m).padStart(2, '0')}`);
    m++;
    if (m > 12) {
      m = 1;
      y++;
    }
  }
  return ra;
}

function LayCongThue({ mstMacDinh, onXong }: { mstMacDinh: string; onXong: () => Promise<void> }) {
  const toast = useToast();
  const [mo, setMo] = useState(false);
  const [phien, setPhien] = useState<PhienCongThue | null>(() => docPhien());
  const [mst, setMst] = useState('');
  const [matKhau, setMatKhau] = useState('');
  const [cap, setCap] = useState<{ key: string; svg: string } | null>(null);
  const [maCap, setMaCap] = useState('');
  const [dangLam, setDangLam] = useState('');
  const [tu, setTu] = useState(dauQuyTruoc());
  const [den, setDen] = useState(thangNay());
  const [vao, setVao] = useState(true);
  const [ra, setRa] = useState(true);
  const [nhatKy, setNhatKy] = useState<string[]>([]);
  const dung = useRef(false);

  useEffect(() => {
    if (!mst && mstMacDinh) setMst(mstMacDinh);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mstMacDinh]);

  async function moiCaptcha() {
    setMaCap('');
    try {
      setCap(await api<{ key: string; svg: string }>('/ke-toan/cong-thue/captcha'));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  useEffect(() => {
    if (mo && !phien && !cap) void moiCaptcha();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [mo, phien]);

  async function dangNhap() {
    if (!cap) return;
    setDangLam('Đang đăng nhập cổng thuế…');
    try {
      const r = await api<{ token: string }>('/ke-toan/cong-thue/dang-nhap', {
        body: { username: mst.trim(), password: matKhau, cvalue: maCap.trim(), ckey: cap.key },
      });
      const p = { token: r.token, mst: mst.trim(), het: hetHanToken(r.token) };
      try {
        sessionStorage.setItem(KHOA_PHIEN, JSON.stringify(p));
      } catch {
        /* trình duyệt chặn lưu — vẫn dùng được trong lúc mở trang */
      }
      setPhien(p);
      setMatKhau('');
      toast.success('Đã đăng nhập cổng thuế');
    } catch (e) {
      toast.error((e as Error).message);
      void moiCaptcha();
    } finally {
      setDangLam('');
    }
  }

  function dangXuat() {
    try {
      sessionStorage.removeItem(KHOA_PHIEN);
    } catch {
      /* bỏ qua */
    }
    setPhien(null);
    setCap(null);
  }

  async function layHoaDon() {
    if (!phien) return;
    const huongs = [...(vao ? (['vao'] as const) : []), ...(ra ? (['ra'] as const) : [])];
    const ds = cacThang(tu, den);
    if (!huongs.length || !ds.length) return;
    dung.current = false;
    const ghi = (x: string) => setNhatKy((cu) => [...cu, x]);
    setNhatKy([]);
    let tong = 0;
    try {
      for (const thang of ds) {
        for (const huong of huongs) {
          if (dung.current) throw new Error('Đã dừng theo yêu cầu');
          for (let lan = 0; lan < 3; lan++) {
            setDangLam(`Đang lấy ${huong === 'vao' ? 'mua vào' : 'bán ra'} tháng ${thang.slice(5)}/${thang.slice(0, 4)}…`);
            const r = await api<{ ten: string; thongDiep: string; xong: boolean; soHd: number }>('/ke-toan/cong-thue/lay', {
              body: { token: phien.token, thang, huong },
            });
            ghi(`✓ ${r.ten}: ${r.thongDiep}`);
            tong += r.soHd;
            if (r.xong) break;
          }
        }
      }
      toast.success(`Đã lấy ${tong} hoá đơn từ cổng thuế`);
    } catch (e) {
      const m = (e as Error).message;
      ghi(`✗ ${m}`);
      toast.error(m);
      if (/hết hạn|đăng nhập/i.test(m)) dangXuat();
    } finally {
      setDangLam('');
      await onXong().catch(() => undefined);
    }
  }

  return (
    <div className="card">
      <button className="flex w-full items-center justify-between text-left" onClick={() => setMo(!mo)}>
        <span>
          <span className="font-semibold">🔗 Lấy hoá đơn từ cổng thuế</span>
          <span className="ml-2 text-sm text-ink-muted">
            {phien ? `đã đăng nhập (MST ${phien.mst})` : 'hoadondientu.gdt.gov.vn — hoá đơn mua vào & bán ra'}
          </span>
        </span>
        <span className="text-xs text-ink-faint">{mo ? '▲' : '▼'}</span>
      </button>
      {mo && (
        <div className="mt-3 space-y-3">
          {!phien ? (
            <>
              <p className="text-xs text-ink-muted">
                Đăng nhập bằng tài khoản cổng hoá đơn điện tử của công ty. Anh tự gõ mã captcha. Mật khẩu chỉ dùng để đăng nhập
                lần này, app không lưu; phiên đăng nhập chỉ giữ trong tab này, đóng tab là hết.
              </p>
              <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <label className="text-sm">
                  <span className="label">MST (tên đăng nhập)</span>
                  <input className="input" value={mst} onChange={(e) => setMst(e.target.value)} autoComplete="username" autoCapitalize="off" autoCorrect="off" spellCheck={false} />
                </label>
                <label className="text-sm">
                  <span className="label">Mật khẩu cổng thuế</span>
                  <input className="input" type="password" value={matKhau} onChange={(e) => setMatKhau(e.target.value)} autoComplete="current-password" />
                </label>
                <div className="text-sm">
                  <span className="label">Mã captcha</span>
                  <div className="flex items-center gap-2">
                    {cap ? (
                      <img
                        src={`data:image/svg+xml;charset=utf-8,${encodeURIComponent(cap.svg)}`}
                        alt="Mã captcha"
                        className="h-14 rounded-xl border-2 border-ink/20 bg-white px-1"
                      />
                    ) : (
                      <span className="text-xs text-ink-faint">đang lấy…</span>
                    )}
                    <button className="btn-ghost px-2 py-1 text-sm" onClick={moiCaptcha} title="Lấy mã khác">
                      ↻
                    </button>
                  </div>
                </div>
                <label className="text-sm">
                  <span className="label">Gõ mã captcha</span>
                  <input
                    className="input font-mono tracking-widest"
                    value={maCap}
                    onChange={(e) => setMaCap(e.target.value)}
                    onKeyDown={(e) => e.key === "Enter" && dangNhap()}
                    autoCapitalize="off"
                    autoCorrect="off"
                    autoComplete="off"
                    spellCheck={false}
                  />
                </label>
              </div>
              <button className="btn-primary" disabled={!!dangLam || !mst || !matKhau || !maCap || !cap} onClick={dangNhap}>
                {dangLam || 'Đăng nhập cổng thuế'}
              </button>
            </>
          ) : (
            <>
              <div className="flex flex-wrap items-end gap-3">
                <label className="text-sm">
                  <span className="label">Từ tháng</span>
                  <input className="input" type="month" value={tu} onChange={(e) => setTu(e.target.value)} />
                </label>
                <label className="text-sm">
                  <span className="label">Đến tháng</span>
                  <input className="input" type="month" value={den} onChange={(e) => setDen(e.target.value)} />
                </label>
                <label className="flex items-center gap-1.5 pb-2 text-sm">
                  <input type="checkbox" checked={vao} onChange={(e) => setVao(e.target.checked)} /> Mua vào
                </label>
                <label className="flex items-center gap-1.5 pb-2 text-sm">
                  <input type="checkbox" checked={ra} onChange={(e) => setRa(e.target.checked)} /> Bán ra
                </label>
                {dangLam ? (
                  <button className="btn-ghost text-rose-600" onClick={() => (dung.current = true)}>
                    ⏹ Dừng
                  </button>
                ) : (
                  <button className="btn-primary" onClick={layHoaDon} disabled={!vao && !ra}>
                    ⬇ Lấy hoá đơn
                  </button>
                )}
                <button className="pb-2 text-sm text-ink-muted underline" onClick={dangXuat}>
                  đăng xuất cổng thuế
                </button>
              </div>
              <p className="text-xs text-ink-muted">
                Lấy từng tháng, cả hoá đơn thường lẫn hoá đơn máy tính tiền. Hoá đơn đã có trong bảng kê của kế toán giữ nguyên
                kỳ kê khai kế toán đã ghi; lấy lại nhiều lần không bị nhân đôi.
              </p>
            </>
          )}
          {dangLam && <div className="rounded-xl bg-brand-50 px-3 py-2 text-sm text-ink-soft">{dangLam}</div>}
          {nhatKy.length > 0 && (
            <ul className="space-y-0.5 text-sm text-ink-soft">
              {nhatKy.map((x, i) => (
                <li key={i} className={x.startsWith('✗') ? 'text-rose-600' : ''}>
                  {x}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}

function ChiSo({ nhan, giaTri, phu, mau }: { nhan: string; giaTri: string; phu: string; mau: string }) {
  return (
    <div className="card">
      <div className="text-xs text-ink-muted">{nhan}</div>
      <div className={`text-2xl font-bold ${mau}`}>{giaTri}</div>
      {phu && <div className="mt-1 text-xs text-ink-muted">{phu}</div>}
    </div>
  );
}

function BangVat({ vat, nam }: { vat: DongVat[]; nam: number }) {
  return (
    <div className="card overflow-x-auto">
      <h2 className="font-semibold">Thuế GTGT (VAT) theo quý — năm {nam}</h2>
      <p className="mb-2 text-xs text-ink-muted">
        Quý đã có tờ khai: lấy số chính thức. Quý chưa khai: <b>ước tính</b> = VAT đầu ra − VAT đầu vào − số còn khấu trừ kỳ trước
        (chưa loại hoá đơn đầu vào không đủ điều kiện khấu trừ, nên số thật thường cao hơn).
      </p>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th className="py-1">Quý</th>
            <th className="text-right">VAT đầu ra</th>
            <th className="text-right">VAT đầu vào được trừ</th>
            <th className="text-right">Kỳ trước chuyển sang</th>
            <th className="text-right">Phải nộp</th>
            <th className="text-right">Chuyển kỳ sau</th>
            <th className="pl-3">Hạn nộp</th>
            <th>Nguồn</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {vat.map((v) => (
            <tr key={v.ky}>
              <td className="py-1.5 font-medium">{tenKy(v.ky)}</td>
              <td className="text-right">{vnd(v.dauRa)}</td>
              <td className="text-right">{vnd(v.dauVao)}</td>
              <td className="text-right">{vnd(v.kyTruoc)}</td>
              <td className={`text-right font-semibold ${v.phaiNop ? 'text-rose-600' : ''}`}>{vnd(v.phaiNop)}</td>
              <td className="text-right">{vnd(v.chuyenKySau)}</td>
              <td className="pl-3">{ngayVN(v.hanNop)}</td>
              <td>
                {v.nguon === 'to_khai' ? (
                  <Badge variant="success">Tờ khai</Badge>
                ) : (
                  <Badge variant="warn">Ước tính · {v.soHdRa + v.soHdVao} HĐ</Badge>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/** Thu / chi / lương / lãi lỗ theo tháng (anh Tâm 18/10/2026: "Thu, chi, lương, tách ra"). */
function BangThuChi({ ds, nam }: { ds: DongKetQuaThang[]; nam: number }) {
  const tong = ds.reduce(
    (t, x) => ({ thu: t.thu + x.thu, chi: t.chi + x.chi, luong: t.luong + x.luong, laiLo: t.laiLo + x.laiLo }),
    { thu: 0, chi: 0, luong: 0, laiLo: 0 },
  );
  const thieuLuong = ds.filter((x) => (x.thu || x.chi) && !x.coLuong).map((x) => x.thang.slice(5));
  return (
    <div className="card overflow-x-auto">
      <h2 className="font-semibold">Thu · Chi · Lương theo tháng — năm {nam}</h2>
      <p className="mb-2 text-xs text-ink-muted">
        Thu = tiền hàng hoá đơn bán ra · Chi = tiền hàng hoá đơn mua vào · Lương = tổng thu nhập + BHXH công ty đóng (bảng lương).
        Tính theo ngày hoá đơn, chưa gồm chi phí không có hoá đơn và bút toán kế toán (khấu hao, phân bổ…) — số chính thức xem phần
        TNDN bên dưới.
        {thieuLuong.length > 0 && <b className="text-amber-800"> Chưa có bảng lương tháng {thieuLuong.join(', ')}.</b>}
      </p>
      <table className="w-full min-w-[640px] text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th className="py-1">Tháng</th>
            <th className="text-right">Thu</th>
            <th className="text-right">Chi (có hoá đơn)</th>
            <th className="text-right">Lương + BHXH</th>
            <th className="text-right">Lãi / lỗ</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {ds.map((x) => (
            <tr key={x.thang}>
              <td className="py-1.5 font-medium">
                {x.thang.slice(5)}/{x.thang.slice(0, 4)}
              </td>
              <td className="text-right">{vnd(x.thu)}</td>
              <td className="text-right">{vnd(x.chi)}</td>
              <td className="text-right">{x.coLuong ? vnd(x.luong) : <span className="text-ink-faint">chưa có</span>}</td>
              <td className={`text-right font-semibold ${x.laiLo < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{vnd(x.laiLo)}</td>
            </tr>
          ))}
          <tr className="border-t-2 border-ink font-bold">
            <td className="py-1.5">Cộng</td>
            <td className="text-right">{vnd(tong.thu)}</td>
            <td className="text-right">{vnd(tong.chi)}</td>
            <td className="text-right">{vnd(tong.luong)}</td>
            <td className={`text-right ${tong.laiLo < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>{vnd(tong.laiLo)}</td>
          </tr>
        </tbody>
      </table>
    </div>
  );
}

function BangTndn({ tndn }: { tndn: Tndn[] }) {
  const NGUON: Record<Tndn['nguon'], string> = {
    bao_cao: 'Báo cáo cả năm',
    bao_cao_luy_ke: 'Báo cáo luỹ kế',
    uoc_tinh: 'Ước tính từ hoá đơn',
  };
  return (
    <div className="card">
      <h2 className="font-semibold">Thuế thu nhập doanh nghiệp (TNDN)</h2>
      <p className="mb-3 text-xs text-ink-muted">
        Lãi / lỗ tính thuế = lãi / lỗ kế toán + chi phí KHÔNG được trừ (hoá đơn sai thông tin, chi không phục vụ kinh doanh…).
        Thuế suất từ 2025: doanh thu năm ≤ 3 tỷ 15%, ≤ 50 tỷ 17%. Dán báo cáo kế toán gửi ở ô trên để có số đúng.
      </p>
      <div className="grid gap-3 lg:grid-cols-2">
        {[...tndn].reverse().map((t) => {
          const lech = t.loiNhuanTinhThueKeToanGhi !== null && t.loiNhuanTinhThueKeToanGhi !== t.loiNhuan ? t.loiNhuanTinhThueKeToanGhi : null;
          const Dong = ({ nhan, so, dam, mau }: { nhan: string; so: number; dam?: boolean; mau?: string }) => (
            <div className={`flex justify-between gap-3 py-1 ${dam ? 'font-bold' : ''}`}>
              <span className="text-ink-soft">{nhan}</span>
              <span className={mau || (so < 0 ? 'text-rose-600' : 'text-ink')}>{vnd(so)}</span>
            </div>
          );
          return (
            <div key={t.nam} className="rounded-2xl border-2 border-ink/15 p-4 text-sm">
              <div className="mb-1 flex flex-wrap items-center gap-2">
                <span className="font-brand text-lg font-bold text-ink">{t.nam}</span>
                {t.mien && <Badge variant="success">Được miễn</Badge>}
                <span className="text-xs text-ink-muted">
                  {t.tuKeToan ? 'Số kế toán gửi' : NGUON[t.nguon]}
                  {t.denNgay ? ` đến ${ngayVN(t.denNgay)}` : ''}
                </span>
              </div>
              <Dong nhan="Doanh thu" so={t.doanhThu} mau="text-ink" />
              {t.nguon === 'uoc_tinh' && t.chiPhiLuong > 0 && <Dong nhan="(đã trừ lương + BHXH)" so={-t.chiPhiLuong} />}
              <Dong nhan={t.nguon === 'uoc_tinh' ? 'Lãi / lỗ ước tính' : 'Lãi / lỗ kế toán'} so={t.loiNhuanKeToan} />
              <Dong nhan="+ Chi phí không được trừ" so={t.chiPhiKhongTru} mau="text-ink" />
              <div className="border-t border-ink/15" />
              <Dong nhan="= Lãi / lỗ tính thuế" so={t.loiNhuan} dam />
              {lech !== null && (
                <div className="my-1 rounded-xl bg-amber-50 px-2 py-1 text-xs text-amber-900">
                  Kế toán ghi {vnd(lech)} — tự tính ra {vnd(t.loiNhuan)} (chênh {vnd(Math.abs(t.loiNhuan - lech))}). Anh hỏi lại kế toán.
                </div>
              )}
              <Dong nhan={`Thuế suất ${Math.round(t.thueSuat * 100)}% — nếu không miễn`} so={t.thueNeuKhongMien} mau="text-ink-muted" />
              <div className="mt-1 flex justify-between gap-3 rounded-xl bg-brand-50 px-2 py-1.5 font-bold">
                <span>Phải nộp</span>
                <span className={t.phaiNop ? 'text-rose-600' : 'text-emerald-700'}>{vnd(t.phaiNop)}</span>
              </div>
              {t.nguon === 'uoc_tinh' && !t.chiPhiLuong && (
                <p className="mt-1 text-xs text-ink-faint">Chưa trừ lương — tải bảng lương / BHXH, hoặc dán báo cáo kế toán.</p>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}

const TEN_VIEC: Record<string, string> = {
  xac_nhan_cong_no: 'Xác nhận công nợ',
  bo_sung_hoa_don: 'Bổ sung hoá đơn',
  xac_nhan_giao_dich: 'Xác nhận giao dịch',
  khac: 'Việc khác',
};

/** Dán thư / ảnh báo cáo kế toán gửi → AI tách kết quả kinh doanh + việc cần xác nhận (anh Tâm 18/10/2026). */
function BaoCaoKeToan({ onXong }: { onXong: () => Promise<void> }) {
  const toast = useToast();
  const [noiDung, setNoiDung] = useState('');
  const [anh, setAnh] = useState<{ mimeType: string; data: string; ten: string } | null>(null);
  const [dangDoc, setDangDoc] = useState(false);
  const [kq, setKq] = useState<null | {
    ketQua: null | { tuNgay: string; denNgay: string; loiNhuanKeToan: number; chiPhiKhongTru: number; loiNhuanTinhThueGhi: number | null; loiNhuanTinhThueTinh: number; ghiChu: string };
    soViec: number;
    viecMoi: number;
  }>(null);
  const [viec, setViec] = useState<ViecKeToan[]>([]);
  const [xemXong, setXemXong] = useState(false);

  async function taiViec() {
    setViec((await api<{ ds: ViecKeToan[] }>('/ke-toan/viec')).ds);
  }
  useEffect(() => {
    taiViec().catch(() => undefined);
  }, []);

  function docAnh(file: File) {
    if (!/^image\/(png|jpeg|webp)$/.test(file.type)) {
      toast.error('Chỉ nhận ảnh PNG / JPG / WEBP');
      return;
    }
    if (file.size > 3_300_000) {
      toast.error('Ảnh quá lớn (tối đa ~3 MB)');
      return;
    }
    const r = new FileReader();
    r.onload = () => {
      const url = String(r.result || '');
      setAnh({ mimeType: file.type, data: url.slice(url.indexOf(',') + 1), ten: file.name || 'ảnh dán' });
    };
    r.readAsDataURL(file);
  }

  async function gui() {
    setDangDoc(true);
    try {
      const r = await api<NonNullable<typeof kq>>('/ke-toan/bao-cao-ke-toan', {
        body: { ...(noiDung.trim() ? { noiDung } : {}), ...(anh ? { anh: { mimeType: anh.mimeType, data: anh.data } } : {}) },
      });
      setKq(r);
      toast.success(r.ketQua ? 'Đã tách kết quả kinh doanh và việc cần làm' : `Đã tách ${r.soViec} việc`);
      setNoiDung('');
      setAnh(null);
      await Promise.all([taiViec(), onXong()]);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDangDoc(false);
    }
  }

  async function doiXong(v: ViecKeToan) {
    try {
      await api(`/ke-toan/viec/${v.id}`, { body: { xong: !v.xong } });
      setViec((ds) => ds.map((x) => (x.id === v.id ? { ...x, xong: !x.xong } : x)));
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const conMo = viec.filter((v) => !v.xong);
  const hien = xemXong ? viec : conMo;
  return (
    <div className="card">
      <h2 className="font-semibold">📨 Báo cáo kế toán gửi</h2>
      <p className="mb-2 text-xs text-ink-muted">
        Dán nguyên thư kế toán gửi, hoặc dán / chọn ảnh chụp — AI tách: kết quả kinh doanh (lãi lỗ kế toán, chi phí không được
        trừ, lãi lỗ tính thuế) đưa vào phần TNDN; các việc kế toán nhờ anh xác nhận / bổ sung đưa vào danh sách bên dưới.
      </p>
      <textarea
        className="input min-h-[96px]"
        placeholder="Dán nội dung thư kế toán (Ctrl+V) — dán ảnh chụp vào đây cũng được"
        value={noiDung}
        onChange={(e) => setNoiDung(e.target.value)}
        onPaste={(e) => {
          const f = [...e.clipboardData.files].find((x) => x.type.startsWith('image/'));
          if (f) {
            e.preventDefault();
            docAnh(f);
          }
        }}
      />
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <label className="btn-ghost cursor-pointer text-sm">
          🖼 Chọn ảnh
          <input type="file" accept="image/png,image/jpeg,image/webp" className="hidden" onChange={(e) => e.target.files?.[0] && docAnh(e.target.files[0])} />
        </label>
        {anh && (
          <span className="text-sm text-ink-soft">
            Ảnh: {anh.ten}{' '}
            <button className="text-rose-600 underline" onClick={() => setAnh(null)}>
              bỏ
            </button>
          </span>
        )}
        <button className="btn-primary ml-auto" disabled={dangDoc || (!noiDung.trim() && !anh)} onClick={gui}>
          {dangDoc ? 'AI đang đọc…' : 'AI đọc & tách'}
        </button>
      </div>

      {kq?.ketQua && (
        <div className="mt-3 rounded-2xl bg-brand-50 p-3 text-sm">
          <b>
            Kết quả kinh doanh {ngayVN(kq.ketQua.tuNgay)} → {ngayVN(kq.ketQua.denNgay)}:
          </b>{' '}
          lãi / lỗ kế toán <b className={kq.ketQua.loiNhuanKeToan < 0 ? 'text-rose-600' : ''}>{vnd(kq.ketQua.loiNhuanKeToan)}</b>, chi phí
          không được trừ <b>{vnd(kq.ketQua.chiPhiKhongTru)}</b> → lãi / lỗ tính thuế <b>{vnd(kq.ketQua.loiNhuanTinhThueTinh)}</b>
          {kq.ketQua.loiNhuanTinhThueGhi !== null && kq.ketQua.loiNhuanTinhThueGhi !== kq.ketQua.loiNhuanTinhThueTinh && (
            <span className="text-amber-900">
              {' '}
              (thư ghi {vnd(kq.ketQua.loiNhuanTinhThueGhi)} — chênh {vnd(Math.abs(kq.ketQua.loiNhuanTinhThueTinh - kq.ketQua.loiNhuanTinhThueGhi))})
            </span>
          )}
          {kq.ketQua.ghiChu && <div className="mt-1 text-xs text-ink-muted">Chi phí không được trừ: {kq.ketQua.ghiChu}</div>}
        </div>
      )}

      <div className="mt-4">
        <div className="mb-1 flex items-center justify-between">
          <h3 className="text-sm font-bold">Kế toán cần anh xác nhận ({conMo.length})</h3>
          {viec.length > conMo.length && (
            <button className="text-xs text-ink-muted underline" onClick={() => setXemXong(!xemXong)}>
              {xemXong ? 'ẩn việc đã xong' : `xem cả ${viec.length - conMo.length} việc đã xong`}
            </button>
          )}
        </div>
        {hien.length === 0 ? (
          <p className="text-xs text-ink-faint">Không còn việc nào.</p>
        ) : (
          <ul className="divide-y">
            {hien.map((v) => (
              <li key={v.id} className="flex items-start gap-3 py-2">
                <input type="checkbox" className="mt-1 h-5 w-5" checked={v.xong} onChange={() => doiXong(v)} aria-label="Đã xong" />
                <div className={`min-w-0 flex-1 text-sm ${v.xong ? 'text-ink-faint line-through' : 'text-ink-soft'}`}>
                  <Badge variant={v.loai === 'bo_sung_hoa_don' ? 'warn' : v.loai === 'khac' ? 'neutral' : 'info'}>{TEN_VIEC[v.loai] || v.loai}</Badge>{' '}
                  {v.noiDung}
                  {(v.soTien > 0 || v.doiTac || v.ngay) && (
                    <span className="text-xs text-ink-muted">
                      {' '}
                      · {[v.soTien ? vnd(v.soTien) : '', v.doiTac, v.ngay ? ngayVN(v.ngay) : ''].filter(Boolean).join(' · ')}
                    </span>
                  )}
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}

function BangCongNo({ thu, tra }: { thu: CongNo; tra: CongNo }) {
  const [loai, setLoai] = useState<'thu' | 'tra'>('thu');
  const [tim, setTim] = useState('');
  const [trang, setTrang] = useState(1);
  const cn = loai === 'thu' ? thu : tra;
  const ds = cn.ds.filter((x) => !tim.trim() || `${x.ten} ${x.ma}`.toLowerCase().includes(tim.trim().toLowerCase()));
  const CO = 15;
  const t = Math.min(trang, Math.max(1, Math.ceil(ds.length / CO)));
  return (
    <div className="card overflow-x-auto">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 font-semibold">Công nợ các bên</h2>
        {(['thu', 'tra'] as const).map((l) => (
          <button
            key={l}
            className={`rounded-full px-3 py-1 text-sm ${loai === l ? 'bg-brand-600 text-ink' : 'bg-brand-50 text-ink-soft'}`}
            onClick={() => {
              setLoai(l);
              setTrang(1);
            }}
          >
            {l === 'thu' ? `Phải thu ${vnd(thu.phai)}` : `Phải trả ${vnd(tra.phai)}`}
          </button>
        ))}
        <input className="input ml-auto w-48 py-1 text-sm" placeholder="Tìm đối tác…" value={tim} onChange={(e) => setTim(e.target.value)} />
      </div>
      <p className="mb-2 text-xs text-ink-muted">
        {cn.ngayChot
          ? `Số dư theo sổ kế toán chốt ngày ${ngayVN(cn.ngayChot)}, cộng hoá đơn ${loai === 'thu' ? 'bán ra' : 'mua vào'} sau ngày đó, trừ tiền đã ${loai === 'thu' ? 'thu' : 'trả'} sau ngày đó theo sao kê ngân hàng (khớp theo tên / MST trong nội dung chuyển khoản).`
          : `Chưa có sổ tổng hợp công nợ ${loai === 'thu' ? 'phải thu (TK 131)' : 'phải trả (TK 331)'} — tải file kế toán gửi.`}
        {cn.truoc > 0 && ` Số âm = ${loai === 'thu' ? 'khách trả trước' : 'mình đã trả trước'}: tổng ${vnd(cn.truoc)}.`}
      </p>
      {ds.length === 0 ? (
        <EmptyState icon="✅" text="Không có công nợ." />
      ) : (
        <table className="w-full min-w-[640px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1">Đối tác</th>
              <th className="text-right">Số dư sổ</th>
              <th className="text-right">HĐ sau ngày chốt</th>
              <th className="text-right">{loai === 'thu' ? 'Đã thu sau chốt' : 'Đã trả sau chốt'}</th>
              <th className="text-right">Còn lại</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {ds.slice((t - 1) * CO, t * CO).map((x) => (
              <tr key={x.ma}>
                <td className="py-1.5">
                  <div className="font-medium">{x.ten}</div>
                  <div className="text-xs text-ink-faint">{x.ma}</div>
                </td>
                <td className="text-right">{vnd(x.soDu)}</td>
                <td className="text-right">{x.hoaDonSau ? vnd(x.hoaDonSau) : '—'}</td>
                <td className="text-right">{x.thanhToanSau ? `−${vnd(x.thanhToanSau)}` : '—'}</td>
                <td className={`text-right font-semibold ${x.tong < 0 ? 'text-emerald-700' : ''}`}>{vnd(x.tong)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PhanTrang trang={t} tong={ds.length} co={CO} onDoi={setTrang} />
    </div>
  );
}

function NganHang({ nh, lan }: { nh: TongQuan['nganHang']; lan: number }) {
  const toast = useToast();
  const [loai, setLoai] = useState<'' | 'vao' | 'ra'>('');
  const [tim, setTim] = useState('');
  const [trang, setTrang] = useState(1);
  const [kq, setKq] = useState<{ ds: GiaoDich[]; tong: number } | null>(null);
  const CO = 20;
  useEffect(() => {
    if (!nh.taiKhoan.length) return;
    const h = setTimeout(() => {
      const p = new URLSearchParams({ page: String(trang), size: String(CO) });
      if (loai) p.set('loai', loai);
      if (tim.trim()) p.set('q', tim.trim());
      api<{ ds: GiaoDich[]; tong: number }>(`/ke-toan/giao-dich?${p}`)
        .then(setKq)
        .catch((e) => toast.error((e as Error).message));
    }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loai, tim, trang, lan, nh.taiKhoan.length]);

  if (!nh.taiKhoan.length) {
    return (
      <div className="card">
        <h2 className="font-semibold">🏦 Ngân hàng</h2>
        <EmptyState icon="🏦" text="Chưa có sao kê — kéo thả file Excel sao kê (Shinhan, MB, ACB, VPBank…) vào ô trên để trừ công nợ đã thu / đã trả." />
      </div>
    );
  }
  return (
    <div className="card overflow-x-auto">
      <h2 className="mb-2 font-semibold">🏦 Ngân hàng</h2>
      <div className="mb-3 grid gap-2 sm:grid-cols-2 lg:grid-cols-3">
        {nh.taiKhoan.map((t) => (
          <div key={`${t.nganHang}|${t.soTk}`} className="rounded-xl bg-brand-50 p-3 text-sm">
            <div className="font-semibold">
              {t.nganHang || 'Ngân hàng'} {t.soTk ? `···${t.soTk.slice(-4)}` : ''}
            </div>
            <div className="text-xs text-ink-muted">
              {ngayVN(t.tuNgay)} → {ngayVN(t.denNgay)} · {t.soGd} giao dịch
            </div>
            <div className="mt-1">
              Số dư cuối: <b>{vnd(t.soDuCuoi)}</b>
            </div>
            <div className="text-xs text-ink-muted">
              Vào {vnd(t.tongVao)} · Ra {vnd(t.tongRa)}
            </div>
          </div>
        ))}
      </div>

      {nh.canhBao5tr.so > 0 && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <b>⚠ {nh.canhBao5tr.so} hoá đơn đầu vào từ 5 triệu chưa thấy chuyển khoản trả</b> (VAT {vnd(nh.canhBao5tr.tongThue)}) — trả
          tiền mặt thì không được khấu trừ VAT. Kiểm tra lại hoặc tải thêm sao kê tài khoản khác.
          <ul className="mt-1 list-disc pl-5 text-xs">
            {nh.canhBao5tr.ds.slice(0, 8).map((h) => (
              <li key={h.khoa || `${h.kyHieu}-${h.soHd}-${h.mstDoiTac}`}>
                {ngayVN(h.ngay)} · {h.tenDoiTac} · HĐ {h.kyHieu}-{h.soHd} · {vnd(h.tongTien)}
              </li>
            ))}
          </ul>
        </div>
      )}

      {nh.soTienVaoChuaKhop > 0 && (
        <details className="mb-3 text-sm">
          <summary className="cursor-pointer text-ink-soft">
            {nh.soTienVaoChuaKhop} khoản tiền vào sau ngày chốt sổ chưa khớp được khách nào
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
            {nh.tienVaoChuaKhop.map((g) => (
              <li key={g.id}>
                {ngayVN(g.ngay)} · <b>{vnd(g.ghiCo)}</b> · {g.noiDung}
              </li>
            ))}
          </ul>
        </details>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select className="input w-auto py-1 text-sm" value={loai} onChange={(e) => (setLoai(e.target.value as '' | 'vao' | 'ra'), setTrang(1))}>
          <option value="">Tiền vào + ra</option>
          <option value="vao">Tiền vào</option>
          <option value="ra">Tiền ra</option>
        </select>
        <input className="input ml-auto w-56 py-1 text-sm" placeholder="Tìm nội dung…" value={tim} onChange={(e) => (setTim(e.target.value), setTrang(1))} />
      </div>
      {!kq ? (
        <SkeletonRows rows={4} />
      ) : (
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1">Ngày</th>
              <th>Tài khoản</th>
              <th>Nội dung</th>
              <th className="text-right">Vào</th>
              <th className="text-right">Ra</th>
              <th className="text-right">Số dư</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {kq.ds.map((g) => (
              <tr key={g.id}>
                <td className="py-1.5 whitespace-nowrap">{ngayVN(g.ngay)}</td>
                <td className="whitespace-nowrap text-xs">
                  {g.nganHang} {g.soTk ? `···${g.soTk.slice(-4)}` : ''}
                </td>
                <td className="max-w-md truncate" title={g.noiDung}>
                  {g.noiDung}
                </td>
                <td className="text-right text-emerald-700">{g.ghiCo ? vnd(g.ghiCo) : ''}</td>
                <td className="text-right text-rose-600">{g.ghiNo ? vnd(g.ghiNo) : ''}</td>
                <td className="text-right text-ink-muted">{g.soDu ? vnd(g.soDu) : ''}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PhanTrang trang={trang} tong={kq?.tong || 0} co={CO} onDoi={setTrang} />
    </div>
  );
}

function DanhSachHoaDon({ nam, lan }: { nam: number; lan: number }) {
  const toast = useToast();
  const [huong, setHuong] = useState<'' | 'ra' | 'vao'>('');
  const [ky, setKy] = useState('');
  const [tim, setTim] = useState('');
  const [trang, setTrang] = useState(1);
  const [kq, setKq] = useState<{ ds: HoaDon[]; tong: number; tongTienHang: number; tongThue: number } | null>(null);
  const CO = 20;

  useEffect(() => {
    setKy('');
    setTrang(1);
  }, [nam]);

  useEffect(() => {
    const h = setTimeout(() => {
      const p = new URLSearchParams({ page: String(trang), size: String(CO) });
      if (huong) p.set('huong', huong);
      if (ky) p.set('ky', ky);
      if (tim.trim()) p.set('q', tim.trim());
      api<{ ds: HoaDon[]; tong: number; tongTienHang: number; tongThue: number }>(`/ke-toan/hoa-don?${p}`)
        .then(setKq)
        .catch((e) => toast.error((e as Error).message));
    }, 250);
    return () => clearTimeout(h);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [huong, ky, tim, trang, lan]);

  return (
    <div className="card overflow-x-auto">
      <div className="mb-2 flex flex-wrap items-center gap-2">
        <h2 className="mr-2 font-semibold">Hoá đơn</h2>
        <select className="input w-auto py-1 text-sm" value={huong} onChange={(e) => (setHuong(e.target.value as '' | 'ra' | 'vao'), setTrang(1))}>
          <option value="">Bán ra + mua vào</option>
          <option value="ra">Bán ra (đầu ra)</option>
          <option value="vao">Mua vào (đầu vào)</option>
        </select>
        <select className="input w-auto py-1 text-sm" value={ky} onChange={(e) => (setKy(e.target.value), setTrang(1))}>
          <option value="">Mọi kỳ</option>
          {[1, 2, 3, 4].map((q) => (
            <option key={q} value={`${nam}-Q${q}`}>
              Quý {q}/{nam}
            </option>
          ))}
        </select>
        <input className="input ml-auto w-56 py-1 text-sm" placeholder="Tìm tên, MST, số HĐ…" value={tim} onChange={(e) => (setTim(e.target.value), setTrang(1))} />
      </div>
      {kq && (
        <p className="mb-2 text-xs text-ink-muted">
          {kq.tong} hoá đơn · tiền hàng {vnd(kq.tongTienHang)} · VAT {vnd(kq.tongThue)}
        </p>
      )}
      {!kq ? (
        <SkeletonRows rows={4} />
      ) : kq.ds.length === 0 ? (
        <EmptyState icon="🧾" text="Không có hoá đơn." />
      ) : (
        <table className="w-full min-w-[760px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1">Ngày</th>
              <th>Số HĐ</th>
              <th>Đối tác</th>
              <th className="text-right">Tiền hàng</th>
              <th className="text-right">VAT</th>
              <th className="pl-3">Kỳ</th>
              <th>Trạng thái</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {kq.ds.map((h) => (
              <tr key={h.khoa} className={/huỷ|hủy|bị thay thế/i.test(h.trangThai) ? 'text-ink-faint line-through' : ''}>
                <td className="py-1.5 whitespace-nowrap">{ngayVN(h.ngay)}</td>
                <td className="whitespace-nowrap">
                  <Badge variant={h.huong === 'ra' ? 'info' : 'neutral'}>{h.huong === 'ra' ? 'Ra' : 'Vào'}</Badge> {h.kyHieu}-{h.soHd}
                </td>
                <td className="max-w-xs">
                  <div className="truncate">{h.tenDoiTac}</div>
                  <div className="truncate text-xs text-ink-faint" title={h.dienGiai}>
                    {h.mstDoiTac} · {h.dienGiai}
                  </div>
                </td>
                <td className="text-right">{vnd(h.tienHang)}</td>
                <td className="text-right">{vnd(h.tienThue)}</td>
                <td className="pl-3 whitespace-nowrap text-xs">{tenKy(h.kyKeKhai)}</td>
                <td className="text-xs">{h.trangThai}</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
      <PhanTrang trang={trang} tong={kq?.tong || 0} co={CO} onDoi={setTrang} />
    </div>
  );
}

function CaiDat({ tq, onDoi }: { tq: TongQuan | null; onDoi: () => void }) {
  const toast = useToast();
  const [mo, setMo] = useState(false);
  const [mst, setMst] = useState('');
  const [mien, setMien] = useState('');
  useEffect(() => {
    if (!tq) return;
    setMst(tq.caiDat.mst);
    setMien(tq.caiDat.namMien.join(', '));
  }, [tq]);
  async function luu() {
    try {
      await api('/ke-toan/cai-dat', { body: { mst, mienTndn: mien } });
      toast.success('Đã lưu');
      onDoi();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <div className="card">
      <button className="flex w-full items-center justify-between text-left text-sm font-semibold" onClick={() => setMo(!mo)}>
        ⚙️ Cài đặt kế toán thuế <span className="text-xs text-ink-faint">{mo ? '▲' : '▼'}</span>
      </button>
      {mo && (
        <div className="mt-3 grid gap-3 sm:grid-cols-3">
          <label className="text-sm">
            <span className="label">MST công ty</span>
            <input className="input" value={mst} onChange={(e) => setMst(e.target.value)} placeholder="Tự nhận từ tờ khai" />
          </label>
          <label className="text-sm">
            <span className="label">Năm được miễn thuế TNDN</span>
            <input className="input" value={mien} onChange={(e) => setMien(e.target.value)} placeholder="2024, 2025, 2026" />
          </label>
          <div className="flex items-end">
            <button className="btn-primary" onClick={luu}>
              Lưu
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
