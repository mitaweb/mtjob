import { Fragment, useEffect, useMemo, useRef, useState } from 'react';
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
interface DoiChieuLuongThang {
  thang: string;
  soNguoi: number;
  tongThuNhap: number;
  thucNhan: number;
  tienMat: number;
  ckFile: number;
  ckNganHang: number;
  soGd: number;
  soKhop: number;
  lech: Array<{ ten: string; file: number; nganHang: number; ngay: string; noiDung: string; doiTac: string }>;
  thieu: Array<{ ten: string; soTien: number }>;
  thua: Array<{ ngay: string; soTien: number; noiDung: string; doiTac: string }>;
}
interface CongNoDoiTac {
  ma: string;
  ten: string;
  soDu: number;
  hoaDonSau: number;
  thanhToanSau: number;
  tienMatSau: number;
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
  doiTac: string;
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
  luongCk: DoiChieuLuongThang[];
  nganHang: {
    taiKhoan: TaiKhoan[];
    tienVaoChuaKhop: GiaoDich[];
    soTienVaoChuaKhop: number;
    soTienVaoDaKhop: number;
    tienVaoKhac: Record<'lai' | 'hoan_the' | 'noi_bo', { so: number; tong: number }>;
    tienVaoTheoHoaDon: Array<{ ngay: string; soTien: number; noiDung: string; doiTac: string; soHd: string; ten: string }>;
    canhBao5tr: { so: number; tongThue: number; ds: HoaDon[]; tienMat: { so: number; tongThue: number } };
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
  thanhToan?: string;
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
  /** Sau khi anh đánh dấu hoá đơn trả tiền mặt: tính lại công nợ + danh sách. */
  function capNhatSauDanhDau() {
    taiTongQuan().catch((e) => toast.error((e as Error).message));
    setLan((x) => x + 1);
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
              file nén. Tải thêm / tải lại chỉ <b>cập nhật</b>: số mới ghi đè đúng mục đó, dữ liệu cũ giữ nguyên, không nhân
              đôi.
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
          <BangLuongCk ds={tq.luongCk || []} coSaoKe={tq.nganHang.taiKhoan.length > 0} />
          <BangTndn tndn={tq.tndn} />
          <BangVat vat={tq.vat} nam={nam} />
          <BangCongNo thu={tq.congNo.thu} tra={tq.congNo.tra} />
          <NganHang nh={tq.nganHang} lan={lan} onDoi={capNhatSauDanhDau} />
        </>
      )}

      <DanhSachHoaDon nam={nam} lan={lan} onDoi={capNhatSauDanhDau} />
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
/**
 * Lương trả 2 đợt: đợt 1 tiền mặt, đợt 2 chuyển khoản (ngày 5 tháng sau). Chi phí lương lấy theo file lương; phần chuyển
 * khoản soát với sao kê từng người (anh Tâm 18/10/2026: "kiểm tra xem chuyển khoản có sai sót gì k").
 */
function BangLuongCk({ ds, coSaoKe }: { ds: DoiChieuLuongThang[]; coSaoKe: boolean }) {
  const [mo, setMo] = useState<string>('');
  const coCot = ds.some((x) => x.ckFile > 0);
  if (!ds.length) return null;
  const loi = (x: DoiChieuLuongThang) => x.lech.length + x.thieu.length + x.thua.length;
  return (
    <div className="card overflow-x-auto">
      <h2 className="font-semibold">💰 Lương: chuyển khoản so với bảng lương</h2>
      <p className="mb-2 text-xs text-ink-muted">
        Chi phí lương tính theo file lương. Thực lãnh trả 2 đợt: <b>đợt 1 tiền mặt</b> (không có trên sao kê), <b>đợt 2 chuyển khoản</b>{' '}
        — app so từng khoản chuyển khoản lương trên sao kê với cột chuyển khoản của từng người.
        {!coCot && <b className="text-amber-800"> File lương đã tải chưa có cột "Bằng TM / Bằng CK" — tải lại file lương để soát.</b>}
        {!coSaoKe && <b className="text-amber-800"> Chưa có sao kê ngân hàng.</b>}
      </p>
      <table className="w-full min-w-[600px] text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th className="py-1">Tháng</th>
            <th className="text-right">Tổng lương</th>
            <th className="text-right">Tiền mặt (đợt 1)</th>
            <th className="text-right">CK theo file</th>
            <th className="text-right">CK sao kê</th>
            <th className="pl-3">Kết quả</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {ds.map((x) => {
            const n = loi(x);
            const chenh = x.ckNganHang - x.ckFile;
            return (
              <Fragment key={x.thang}>
              <tr className="align-top">
                <td className="py-1.5 whitespace-nowrap">
                  {x.thang.slice(5)}/{x.thang.slice(0, 4)}
                  <div className="text-xs text-ink-faint">{x.soNguoi} người</div>
                </td>
                <td className="text-right">{vnd(x.tongThuNhap)}</td>
                <td className="text-right">{vnd(x.tienMat)}</td>
                <td className="text-right">{vnd(x.ckFile)}</td>
                <td className={`text-right ${x.ckFile && chenh ? 'font-semibold text-rose-600' : ''}`}>
                  {x.ckNganHang ? vnd(x.ckNganHang) : '—'}
                  {x.ckFile > 0 && chenh !== 0 && x.ckNganHang > 0 && <div className="text-xs">{chenh > 0 ? '+' : ''}{vnd(chenh)}</div>}
                </td>
                <td className="pl-3 text-xs">
                  {!x.ckFile ? (
                    <span className="text-ink-faint">—</span>
                  ) : n === 0 ? (
                    <span className="text-emerald-700">✓ Khớp {x.soKhop}/{x.soGd} khoản</span>
                  ) : (
                    <button className="text-left text-rose-700 underline-offset-2 hover:underline" onClick={() => setMo(mo === x.thang ? '' : x.thang)}>
                      ⚠ {n} chỗ cần xem {mo === x.thang ? '▲' : '▼'}
                    </button>
                  )}
                </td>
              </tr>
              {mo === x.thang && n > 0 && (
                <tr>
                  <td colSpan={6} className="pb-2 text-xs">
                    <ul className="sticky left-0 max-w-[calc(100vw-4.5rem)] space-y-1 rounded-xl bg-rose-50 p-2 text-ink-soft sm:max-w-none">
                      {x.lech.map((l, i) => (
                        <li key={`l${i}`}>
                          <b>{l.ten}</b>: file {vnd(l.file)}, chuyển {vnd(l.nganHang)} ({l.nganHang > l.file ? 'dư' : 'thiếu'}{' '}
                          {vnd(Math.abs(l.nganHang - l.file))}) · {ngayVN(l.ngay)}
                        </li>
                      ))}
                      {x.thieu.map((t, i) => (
                        <li key={`t${i}`}>
                          <b>{t.ten}</b>: file ghi chuyển khoản {vnd(t.soTien)} — sao kê chưa thấy
                        </li>
                      ))}
                      {x.thua.map((t, i) => (
                        <li key={`u${i}`}>
                          Sao kê chuyển {vnd(t.soTien)} {t.doiTac ? <b>→ {t.doiTac}</b> : null} ({ngayVN(t.ngay)}) — không có trong file lương
                        </li>
                      ))}
                    </ul>
                  </td>
                </tr>
              )}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

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


type CachTra = '' | 'tien_mat' | 'ngan_hang';
async function danhDauTra(khoa: string[], cach: CachTra) {
  return api<{ ok: boolean; n: number }>('/ke-toan/hoa-don/thanh-toan', { body: { khoa, cach } });
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
          ? `Số dư theo sổ kế toán chốt ngày ${ngayVN(cn.ngayChot)}, cộng hoá đơn ${loai === 'thu' ? 'bán ra' : 'mua vào'} sau ngày đó, trừ tiền đã ${loai === 'thu' ? 'thu' : 'trả'} sau ngày đó theo sao kê ngân hàng (khớp theo tên bên chuyển / MST / số hoá đơn trong nội dung chuyển khoản)${loai === 'tra' ? ' và hoá đơn đã trả tiền mặt (dưới 5 triệu không thấy chuyển khoản, hoặc anh đánh dấu)' : ''}.`
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
                <td className="text-right">
                  {x.thanhToanSau || x.tienMatSau ? (
                    <>
                      {x.thanhToanSau ? <div>−{vnd(x.thanhToanSau)}</div> : null}
                      {x.tienMatSau ? <div className="text-xs text-ink-muted">💵 −{vnd(x.tienMatSau)}</div> : null}
                    </>
                  ) : (
                    '—'
                  )}
                </td>
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

function NganHang({ nh, lan, onDoi }: { nh: TongQuan['nganHang']; lan: number; onDoi: () => void }) {
  const toast = useToast();
  const [dangDanh, setDangDanh] = useState('');
  async function danh(khoa: string[], cach: CachTra, nhan: string) {
    setDangDanh(khoa.join(','));
    try {
      const r = await danhDauTra(khoa, cach);
      toast.success(`${nhan}: ${r.n} hoá đơn`);
      onDoi();
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      setDangDanh('');
    }
  }
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

      <p className="mb-2 text-xs text-ink-muted">
        Hoá đơn đầu vào <b>dưới 5 triệu</b> không thấy chuyển khoản: app tự coi là <b>đã trả tiền mặt</b> (không báo, không tính
        công nợ). Từ 5 triệu thì cần anh xác nhận ở dưới.
      </p>
      {nh.canhBao5tr.so > 0 && (
        <div className="mb-3 rounded-xl bg-amber-50 p-3 text-sm text-amber-900">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <b>⚠ {nh.canhBao5tr.so} hoá đơn đầu vào từ 5 triệu chưa thấy chuyển khoản trả</b> (VAT {vnd(nh.canhBao5tr.tongThue)}) —
              trả tiền mặt thì VAT không được khấu trừ. Đã trả tiền mặt thì bấm 💵; đã chuyển từ tài khoản khác thì bấm 🏦.
            </div>
            {nh.canhBao5tr.ds.length > 1 && (
              <button
                className="btn-ghost shrink-0 py-1 text-xs"
                disabled={!!dangDanh}
                onClick={() =>
                  confirm(`Đánh dấu cả ${nh.canhBao5tr.ds.length} hoá đơn đã trả tiền mặt?`) &&
                  danh(nh.canhBao5tr.ds.map((h) => h.khoa).filter(Boolean), 'tien_mat', 'Đã đánh dấu tiền mặt')
                }
              >
                💵 Tất cả đã trả tiền mặt
              </button>
            )}
          </div>
          <ul className="mt-2 divide-y divide-amber-200/60 text-xs">
            {nh.canhBao5tr.ds.map((h) => (
              <li key={h.khoa || `${h.kyHieu}-${h.soHd}-${h.mstDoiTac}`} className="flex flex-wrap items-center gap-x-2 gap-y-1 py-1">
                <span className="min-w-0 flex-1">
                  {ngayVN(h.ngay)} · {h.tenDoiTac} · HĐ {h.kyHieu}-{h.soHd} · <b>{vnd(h.tongTien)}</b>
                </span>
                {h.khoa && (
                  <span className="flex gap-1">
                    <button className="rounded-full bg-white px-3 py-1.5 hover:bg-brand-100" disabled={!!dangDanh} onClick={() => danh([h.khoa], 'tien_mat', 'Đã trả tiền mặt')}>
                      💵 Tiền mặt
                    </button>
                    <button className="rounded-full bg-white px-3 py-1.5 hover:bg-brand-100" disabled={!!dangDanh} onClick={() => danh([h.khoa], 'ngan_hang', 'Đã chuyển khoản')}>
                      🏦 Đã CK
                    </button>
                  </span>
                )}
              </li>
            ))}
          </ul>
        </div>
      )}
      {nh.canhBao5tr.tienMat.so > 0 && (
        <p className="mb-3 text-xs text-ink-muted">
          💵 Anh đã đánh dấu {nh.canhBao5tr.tienMat.so} hoá đơn từ 5 triệu trả tiền mặt — VAT {vnd(nh.canhBao5tr.tienMat.tongThue)} không được
          khấu trừ (báo kế toán loại khỏi tờ khai). Bỏ đánh dấu ở danh sách Hoá đơn bên dưới.
        </p>
      )}
      {(nh.tienVaoKhac.lai.so > 0 || nh.tienVaoKhac.hoan_the.so > 0 || nh.tienVaoKhac.noi_bo.so > 0) && (
        <p className="mb-2 text-xs text-ink-muted">
          Tiền vào không phải khách trả (không tính công nợ):
          {nh.tienVaoKhac.lai.so > 0 && ` lãi tiền gửi ${nh.tienVaoKhac.lai.so} lần ${vnd(nh.tienVaoKhac.lai.tong)};`}
          {nh.tienVaoKhac.hoan_the.so > 0 && ` tiền thẻ hoàn về ${nh.tienVaoKhac.hoan_the.so} lần ${vnd(nh.tienVaoKhac.hoan_the.tong)};`}
          {nh.tienVaoKhac.noi_bo.so > 0 && ` chuyển nội bộ ${nh.tienVaoKhac.noi_bo.so} lần ${vnd(nh.tienVaoKhac.noi_bo.tong)};`}
        </p>
      )}
      {nh.tienVaoTheoHoaDon.length > 0 && (
        <details className="mb-2 text-sm">
          <summary className="cursor-pointer text-ink-soft">
            {nh.tienVaoTheoHoaDon.length} khoản khớp theo số hoá đơn / số tiền (không có tên trong nội dung) — anh soát lại
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
            {nh.tienVaoTheoHoaDon.map((x, i) => (
              <li key={i}>
                {ngayVN(x.ngay)} · <b>{vnd(x.soTien)}</b> · {x.doiTac ? <b>{x.doiTac} · </b> : null}
                {x.noiDung} → <span className="text-ink">{x.ten} (HĐ {x.soHd})</span>
              </li>
            ))}
          </ul>
        </details>
      )}

      {nh.soTienVaoChuaKhop > 0 && (
        <details className="mb-3 text-sm">
          <summary className="cursor-pointer text-ink-soft">
            {nh.soTienVaoChuaKhop} khoản tiền vào sau ngày chốt sổ chưa khớp được khách nào
          </summary>
          <ul className="mt-1 space-y-0.5 text-xs text-ink-muted">
            {nh.tienVaoChuaKhop.map((g) => (
              <li key={g.id}>
                {ngayVN(g.ngay)} · <b>{vnd(g.ghiCo)}</b> · {g.doiTac ? <b className="text-ink">{g.doiTac} · </b> : null}
                {g.noiDung}
              </li>
            ))}
          </ul>
          <p className="mt-1 text-xs text-ink-faint">
            Thường là khách chưa xuất hoá đơn / chưa có trong sổ công nợ. Sao kê tải trước hôm nay chưa có cột tên bên chuyển —
            tải lại file sao kê để app đọc thêm cột đó (không nhân đôi giao dịch).
          </p>
        </details>
      )}

      <div className="mb-2 flex flex-wrap items-center gap-2">
        <select className="input w-auto py-1 text-sm" value={loai} onChange={(e) => (setLoai(e.target.value as '' | 'vao' | 'ra'), setTrang(1))}>
          <option value="">Tiền vào + ra</option>
          <option value="vao">Tiền vào</option>
          <option value="ra">Tiền ra</option>
        </select>
        <input className="input ml-auto w-56 py-1 text-sm" placeholder="Tìm nội dung, tên bên chuyển…" value={tim} onChange={(e) => (setTim(e.target.value), setTrang(1))} />
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
                <td className="max-w-md" title={g.noiDung}>
                  {g.doiTac && <div className="truncate text-xs font-medium">{g.doiTac}</div>}
                  <div className="truncate">{g.noiDung}</div>
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

function DanhSachHoaDon({ nam, lan, onDoi }: { nam: number; lan: number; onDoi: () => void }) {
  const toast = useToast();
  async function doiCachTra(h: HoaDon) {
    // Vòng: tự xét → tiền mặt → đã chuyển khoản → tự xét
    const tiep: CachTra = h.thanhToan === 'tien_mat' ? 'ngan_hang' : h.thanhToan === 'ngan_hang' ? '' : 'tien_mat';
    try {
      await danhDauTra([h.khoa], tiep);
      onDoi();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
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
        <table className="w-full min-w-[820px] text-sm">
          <thead>
            <tr className="text-left text-xs text-ink-muted">
              <th className="py-1">Ngày</th>
              <th>Số HĐ</th>
              <th>Đối tác</th>
              <th className="text-right">Tiền hàng</th>
              <th className="text-right">VAT</th>
              <th className="pl-3">Kỳ</th>
              <th>Trạng thái</th>
              <th title="Hoá đơn đầu vào: bấm để đổi cách trả">Trả</th>
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
                <td className="whitespace-nowrap text-xs">
                  {h.huong === 'vao' && (
                    <button
                      className={`rounded-full px-2.5 py-1 ${h.thanhToan ? 'bg-brand-100 text-ink' : 'text-ink-faint hover:bg-brand-50'}`}
                      title="Bấm để đổi: tự xét → tiền mặt → chuyển khoản"
                      onClick={() => doiCachTra(h)}
                    >
                      {h.thanhToan === 'tien_mat' ? '💵 Tiền mặt' : h.thanhToan === 'ngan_hang' ? '🏦 CK' : 'tự xét'}
                    </button>
                  )}
                </td>
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
