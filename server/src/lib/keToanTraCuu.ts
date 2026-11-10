// Tra cứu sao kê / hoá đơn của mục Kế toán thuế cho TRỢ LÝ GIÁM ĐỐC (anh Tâm 10/11/2026: "Anh cần bộ não nắm, hiểu toàn
// bộ phần mềm, những thông tin nhạy cảm về tài chính thì chỉ có anh, giám đốc hỏi được thôi"). Hàm THUẦN.
import type { GiaoDich } from './saoKe.js';
import type { HoaDon } from './keToan.js';
import { removeAccents } from './people.js';

const chuan = (s: string) =>
  removeAccents(String(s || '').toLowerCase())
    .replace(/[^\p{L}\p{N}\s]/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();

/** "5.500.000" / "5,5tr" / "5500000" → số tiền; không phải số tiền → null. */
function soTienTim(tim: string): number | null {
  const t = tim.trim().toLowerCase().replace(/\s/g, '');
  const tr = /^(\d+(?:[.,]\d+)?)(tr|trieu|triệu)$/.exec(t);
  if (tr) return Math.round(Number(tr[1]!.replace(',', '.')) * 1_000_000);
  if (/^\d{1,3}([.,]\d{3})+$/.test(t) || /^\d{5,}$/.test(t)) return Number(t.replace(/[.,]/g, ''));
  return null;
}

function khopChu(nguon: string, tim: string): boolean {
  const n = chuan(nguon);
  const ns = n.replace(/ /g, '');
  return chuan(tim)
    .split(' ')
    .filter(Boolean)
    .every((w) => n.includes(w) || ns.includes(w));
}

export interface LocGd {
  tim?: string;
  loai?: 'vao' | 'ra' | '';
  tuNgay?: string;
  denNgay?: string;
}

export function locGiaoDich(ds: GiaoDich[], o: LocGd): GiaoDich[] {
  const tim = String(o.tim || '').trim();
  const tien = tim ? soTienTim(tim) : null;
  return ds
    .filter((g) => (o.loai === 'vao' ? g.ghiCo > 0 : o.loai === 'ra' ? g.ghiNo > 0 : true))
    .filter((g) => (!o.tuNgay || g.ngay >= o.tuNgay) && (!o.denNgay || g.ngay <= o.denNgay))
    .filter((g) => {
      if (!tim) return true;
      if (tien !== null) return Math.abs(g.ghiCo - tien) <= 1000 || Math.abs(g.ghiNo - tien) <= 1000;
      return khopChu(`${g.noiDung} ${g.doiTac}`, tim);
    })
    .sort((a, b) => b.ngay.localeCompare(a.ngay) || b.thuTu - a.thuTu);
}

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;

export function vanBanGiaoDich(ds: GiaoDich[], gioiHan = 40): string {
  if (!ds.length) return 'Không có giao dịch nào khớp trong sao kê đã tải lên.';
  const vao = ds.reduce((s, g) => s + g.ghiCo, 0);
  const ra = ds.reduce((s, g) => s + g.ghiNo, 0);
  return [
    `${ds.length} giao dịch · vào ${vnd(vao)} · ra ${vnd(ra)}${ds.length > gioiHan ? ` (hiện ${gioiHan} giao dịch mới nhất)` : ''}:`,
    ...ds
      .slice(0, gioiHan)
      .map((g) => `- ${g.ngay} · ${g.ghiCo ? `VÀO ${vnd(g.ghiCo)}` : `RA ${vnd(g.ghiNo)}`} · ${g.noiDung.slice(0, 160)}${g.doiTac ? ` · đối tác: ${g.doiTac}` : ''}${g.nganHang ? ` (${g.nganHang})` : ''}`),
  ].join('\n');
}

export interface LocHd {
  tim?: string;
  huong?: 'ra' | 'vao' | '';
  tuNgay?: string;
  denNgay?: string;
}

export function locHoaDon(ds: HoaDon[], o: LocHd): HoaDon[] {
  const tim = String(o.tim || '').trim();
  const tien = tim ? soTienTim(tim) : null;
  return ds
    .filter((h) => !o.huong || h.huong === o.huong)
    .filter((h) => (!o.tuNgay || h.ngay >= o.tuNgay) && (!o.denNgay || h.ngay <= o.denNgay))
    .filter((h) => {
      if (!tim) return true;
      if (tien !== null && Math.abs(h.tongTien - tien) <= 1000) return true;
      if (/^\d{6,}$/.test(tim.replace(/[\s-]/g, ''))) return h.mstDoiTac.replace(/\D/g, '').includes(tim.replace(/\D/g, ''));
      return khopChu(`${h.tenDoiTac} ${h.mstDoiTac} ${h.soHd} ${h.kyHieu} ${h.dienGiai}`, tim);
    })
    .sort((a, b) => b.ngay.localeCompare(a.ngay));
}

export function vanBanHoaDon(ds: HoaDon[], gioiHan = 40): string {
  if (!ds.length) return 'Không có hoá đơn nào khớp.';
  const tong = ds.reduce((s, h) => s + h.tongTien, 0);
  return [
    `${ds.length} hoá đơn · tổng ${vnd(tong)} (gồm VAT)${ds.length > gioiHan ? ` (hiện ${gioiHan} hoá đơn mới nhất)` : ''}:`,
    ...ds
      .slice(0, gioiHan)
      .map(
        (h) =>
          `- ${h.ngay} · ${h.huong === 'ra' ? 'BÁN RA' : 'MUA VÀO'} số ${h.soHd} (${h.kyHieu}) · ${h.tenDoiTac || h.mstDoiTac} · ${vnd(h.tongTien)}` +
          `${h.trangThai && !/mới/i.test(h.trangThai) ? ` · ${h.trangThai}` : ''}${h.thanhToan === 'tien_mat' ? ' · trả tiền mặt' : ''}`,
      ),
  ].join('\n');
}
