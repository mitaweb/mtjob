// Khoảng thời gian như Trình quản lý quảng cáo Facebook (anh Tâm 11/11/2026: "Các chỉ số em cho phép xem theo ngày tuần
// tháng... như fb nhé"): chọn khoảng (hôm nay, hôm qua, N ngày, tuần, tháng, tuỳ chọn) và chia số theo ngày / tuần / tháng.

export type MauKhoang = 'hom_nay' | 'hom_qua' | '7' | '14' | '30' | '90' | 'tuan_nay' | 'tuan_truoc' | 'thang_nay' | 'thang_truoc' | 'tuy_chon';
export const MAU_KHOANG: MauKhoang[] = ['hom_nay', 'hom_qua', '7', '14', '30', '90', 'tuan_nay', 'tuan_truoc', 'thang_nay', 'thang_truoc', 'tuy_chon'];

const ISO = /^\d{4}-\d{2}-\d{2}$/;
const ms = (d: string) => Date.parse(`${d}T00:00:00Z`);
export const congNgay = (d: string, n: number) => new Date(ms(d) + n * 86_400_000).toISOString().slice(0, 10);
/** Thứ Hai đầu tuần của ngày `d`. */
export const dauTuan = (d: string) => congNgay(d, -((new Date(ms(d)).getUTCDay() + 6) % 7));
const TOI_DA = 400;

export function khoangNgay(mau: string, homNay: string, tu?: string, den?: string): { tu: string; den: string } {
  const homQua = congNgay(homNay, -1);
  switch (mau) {
    case 'hom_nay':
      return { tu: homNay, den: homNay };
    case 'hom_qua':
      return { tu: homQua, den: homQua };
    case '14':
    case '30':
    case '90':
      return { tu: congNgay(homNay, -Number(mau)), den: homQua };
    case 'tuan_nay':
      return { tu: dauTuan(homNay), den: homNay };
    case 'tuan_truoc': {
      const t = congNgay(dauTuan(homNay), -7);
      return { tu: t, den: congNgay(t, 6) };
    }
    case 'thang_nay':
      return { tu: `${homNay.slice(0, 7)}-01`, den: homNay };
    case 'thang_truoc': {
      const dau = `${homNay.slice(0, 7)}-01`;
      const cuoi = congNgay(dau, -1);
      return { tu: `${cuoi.slice(0, 7)}-01`, den: cuoi };
    }
    case 'tuy_chon': {
      if (tu && den && ISO.test(tu) && ISO.test(den)) {
        let [a, b] = tu <= den ? [tu, den] : [den, tu];
        if (b > homNay) b = homNay;
        if ((ms(b) - ms(a)) / 86_400_000 >= TOI_DA) a = congNgay(b, -(TOI_DA - 1));
        return { tu: a, den: b };
      }
      return khoangNgay('7', homNay);
    }
    default:
      return { tu: congNgay(homNay, -7), den: homQua };
  }
}

// ── Cộng chỉ số ──

/** Chỉ số cộng được (tiền, lượt…). Tỷ lệ tính lại sau khi cộng. */
const CONG = ['chi', 'hienThi', 'click', 'chuyenDoi', 'giaTriCD', 'tiepCan', 'clickLink', 'tinNhan', 'lead', 'mua', 'giaTriMua', 'ketQua'];
/** Tỷ lệ hiển thị (Google Ads) — bình quân theo số hiển thị. */
const TY_LE_HT = ['tyLeHienThi', 'matNganSach', 'matXepHang', 'dauTrang', 'dauTrangTuyetDoi'];

export type ChiSo = Record<string, number | undefined>;

export function gopChiTiet(ds: ChiSo[]): ChiSo {
  const t: Record<string, number> = {};
  for (const c of ds) for (const k of CONG) if (c[k] !== undefined) t[k] = (t[k] || 0) + (c[k] || 0);
  const ra: ChiSo = { ...t };
  for (const k of TY_LE_HT) {
    let tu = 0;
    let mau = 0;
    for (const c of ds) {
      if (c[k] === undefined || !c.hienThi) continue;
      tu += c[k]! * c.hienThi;
      mau += c.hienThi;
    }
    if (mau) ra[k] = tu / mau;
  }
  const kq = t.chuyenDoi || t.ketQua || 0;
  ra.ctr = t.hienThi ? (t.click || 0) / t.hienThi : 0;
  ra.cpc = t.click ? (t.chi || 0) / t.click : 0;
  ra.cpm = t.hienThi ? ((t.chi || 0) / t.hienThi) * 1000 : 0;
  ra.tyLeCD = t.click ? (t.chuyenDoi || 0) / t.click : 0;
  ra.cpa = kq ? (t.chi || 0) / kq : 0;
  ra.roas = t.chi ? ((t.giaTriCD || 0) + (t.giaTriMua || 0)) / t.chi : 0;
  if (t.tiepCan) ra.tanSuat = (t.hienThi || 0) / t.tiepCan;
  return ra;
}

// ── Chia theo ngày / tuần / tháng ──

export type Nhom = 'ngay' | 'tuan' | 'thang';
const dm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`;

export function nhomThoiGian(ds: Array<{ ngay: string; chiSo: ChiSo }>, nhom: Nhom): Array<{ ky: string; nhan: string; chiSo: ChiSo }> {
  const theoKy = new Map<string, ChiSo[]>();
  for (const d of ds) {
    const ky = nhom === 'ngay' ? d.ngay : nhom === 'tuan' ? dauTuan(d.ngay) : d.ngay.slice(0, 7);
    theoKy.set(ky, [...(theoKy.get(ky) || []), d.chiSo]);
  }
  const ra = [...theoKy.entries()].map(([ky, cs]) => ({
    ky,
    nhan: nhom === 'ngay' ? dm(ky) : nhom === 'tuan' ? `${dm(ky)}–${dm(congNgay(ky, 6))}` : `${ky.slice(5, 7)}/${ky.slice(0, 4)}`,
    chiSo: gopChiTiet(cs),
  }));
  // Ngày: mới nhất trước (như bảng chia theo ngày); tuần / tháng: theo thứ tự thời gian.
  return ra.sort((a, b) => (nhom === 'ngay' ? b.ky.localeCompare(a.ky) : a.ky.localeCompare(b.ky)));
}
