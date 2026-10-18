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
}
interface CongNoDoiTac {
  ma: string;
  ten: string;
  soDu: number;
  hoaDonSau: number;
  tong: number;
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
      .slice(0, 6000)
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
        className={`card border-2 border-dashed ${keo ? 'border-brand-500 bg-brand-50' : 'border-brand-100'}`}
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
              Bảng kê hoá đơn MV-BR, hoá đơn XML, tờ khai GTGT (XML), tổng hợp công nợ phải thu / phải trả, báo cáo kết quả kinh
              doanh. Chọn cả thư mục cũng được — app tự lọc file cần, bỏ qua PDF / file nén. Tải lại file cũ không bị nhân đôi.
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
              mau="text-brand-700"
            />
          </div>

          <BangVat vat={tq.vat} nam={nam} />
          <BangTndn tndn={tq.tndn} />
          <BangCongNo thu={tq.congNo.thu} tra={tq.congNo.tra} />
        </>
      )}

      <DanhSachHoaDon nam={nam} lan={lan} />
      <CaiDat tq={tq} onDoi={() => taiTongQuan()} />
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

function BangTndn({ tndn }: { tndn: Tndn[] }) {
  const NGUON: Record<Tndn['nguon'], string> = {
    bao_cao: 'Báo cáo KQKD cả năm',
    bao_cao_luy_ke: 'Báo cáo KQKD luỹ kế',
    uoc_tinh: 'Ước tính thô từ hoá đơn (chưa trừ lương, chi phí không hoá đơn)',
  };
  return (
    <div className="card overflow-x-auto">
      <h2 className="font-semibold">Thuế thu nhập doanh nghiệp (TNDN)</h2>
      <p className="mb-2 text-xs text-ink-muted">
        Thuế suất từ năm 2025: doanh thu năm ≤ 3 tỷ 15%, ≤ 50 tỷ 17%. Lỗ thì không có thuế. Muốn số đúng, tải báo cáo kết quả kinh
        doanh cả năm của kế toán.
      </p>
      <table className="w-full min-w-[720px] text-sm">
        <thead>
          <tr className="text-left text-xs text-ink-muted">
            <th className="py-1">Năm</th>
            <th className="text-right">Doanh thu</th>
            <th className="text-right">Lợi nhuận trước thuế</th>
            <th className="text-right">Thuế suất</th>
            <th className="text-right">Nếu không miễn</th>
            <th className="text-right">Phải nộp</th>
            <th className="pl-3">Nguồn số liệu</th>
          </tr>
        </thead>
        <tbody className="divide-y">
          {tndn.map((t) => (
            <tr key={t.nam}>
              <td className="py-1.5 font-medium">
                {t.nam} {t.mien && <Badge variant="success">Miễn</Badge>}
              </td>
              <td className="text-right">{vnd(t.doanhThu)}</td>
              <td className={`text-right ${t.loiNhuan < 0 ? 'text-rose-600' : ''}`}>{vnd(t.loiNhuan)}</td>
              <td className="text-right">{Math.round(t.thueSuat * 100)}%</td>
              <td className="text-right text-ink-muted">{vnd(t.thueNeuKhongMien)}</td>
              <td className={`text-right font-semibold ${t.phaiNop ? 'text-rose-600' : 'text-emerald-700'}`}>{vnd(t.phaiNop)}</td>
              <td className="pl-3 text-xs text-ink-muted">
                {NGUON[t.nguon]}
                {t.denNgay ? ` tới ${ngayVN(t.denNgay)}` : ''}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
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
            className={`rounded-full px-3 py-1 text-sm ${loai === l ? 'bg-brand-600 text-white' : 'bg-brand-50 text-ink-soft'}`}
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
          ? `Số dư theo sổ kế toán chốt ngày ${ngayVN(cn.ngayChot)}, cộng hoá đơn ${loai === 'thu' ? 'bán ra' : 'mua vào'} phát sinh sau ngày đó (chưa trừ tiền đã ${loai === 'thu' ? 'thu' : 'trả'} sau ngày chốt).`
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
              <th className="text-right">Tổng</th>
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
