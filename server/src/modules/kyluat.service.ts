// Đọc dữ liệu để đếm đi trễ / về sớm một tháng. Luật nằm trong lib/kyluat.ts.
import { q } from '../db/client.js';
import { getConfig } from '../config.js';
import { getAttendanceBetween, getForMemberRange } from './attendance.repo.js';
import { shiftConfigFrom } from '../lib/attendance.js';
import { monthRange } from '../lib/datetime.js';
import { tongKetKyLuat, RONG, type DongChamCong, type TongKetKyLuat } from '../lib/kyluat.js';

interface DonTheoNguoi {
  tre: Set<string>;
  som: Set<string>;
}

function lay(m: Map<string, DonTheoNguoi>, id: string): DonTheoNguoi {
  let d = m.get(id);
  if (!d) {
    d = { tre: new Set(), som: new Set() };
    m.set(id, d);
  }
  return d;
}

/**
 * Đơn đi trễ / về sớm ĐÃ DUYỆT, lọc thô theo tháng.
 *
 * Cột `dates` là chuỗi ngày nối bằng dấu phẩy nên không lọc khoảng bằng SQL được. LIKE
 * '%YYYY-MM%' chỉ để khỏi kéo cả lịch sử đơn về; ngày nào thuộc khoảng thì soi lại trong
 * bộ nhớ. Tách ra hằng số để chạy thử được trên Postgres thật.
 */
export const SQL_DON_GIAI_TRINH =
  'SELECT member_id, kind, dates FROM requests' +
  " WHERE kind IN ('late','early') AND final_status = 'approved' AND dates LIKE $1";

export const SQL_DON_GIAI_TRINH_MOT_NGUOI = `${SQL_DON_GIAI_TRINH} AND member_id = $2`;

/** Ngày đã có đơn đi trễ / về sớm được duyệt, gom theo thành viên. */
async function donGiaiTrinh(
  start: string,
  end: string,
  memberId?: string,
): Promise<Map<string, DonTheoNguoi>> {
  const thang = `%${start.slice(0, 7)}%`;
  const rows = memberId
    ? await q(SQL_DON_GIAI_TRINH_MOT_NGUOI, [thang, memberId])
    : await q(SQL_DON_GIAI_TRINH, [thang]);

  const out = new Map<string, DonTheoNguoi>();
  for (const r of rows) {
    const id = String(r.member_id || '');
    if (!id) continue;
    const bo = String(r.kind) === 'late' ? 'tre' : 'som';
    for (const d of String(r.dates || '').split(',')) {
      const ngay = d.trim();
      if (ngay >= start && ngay <= end) lay(out, id)[bo].add(ngay);
    }
  }
  return out;
}

/** Tổng kết đi trễ/về sớm của MỌI thành viên trong tháng — một lượt quét, không lặp query. */
export async function kyLuatThang(year: number, month: number): Promise<Map<string, TongKetKyLuat>> {
  const { start, end } = monthRange(year, month);
  const [cfg, att, don] = await Promise.all([
    getConfig(),
    getAttendanceBetween(start, end),
    donGiaiTrinh(start, end),
  ]);
  const shifts = shiftConfigFrom(cfg);

  const theoNguoi = new Map<string, DongChamCong[]>();
  for (const a of att) {
    const arr = theoNguoi.get(a.memberId);
    if (arr) arr.push(a);
    else theoNguoi.set(a.memberId, [a]);
  }
  // Người không có dòng chấm công nào mà có đơn vẫn phải xuất hiện.
  for (const id of don.keys()) if (!theoNguoi.has(id)) theoNguoi.set(id, []);

  const out = new Map<string, TongKetKyLuat>();
  for (const [id, rows] of theoNguoi) {
    const d = don.get(id);
    out.set(id, tongKetKyLuat(rows, shifts, d?.tre ?? new Set(), d?.som ?? new Set()));
  }
  return out;
}

/** Tổng kết của MỘT người — chỉ đọc chấm công của người đó, không quét cả công ty. */
export async function kyLuatCuaThanhVien(
  memberId: string,
  year: number,
  month: number,
): Promise<TongKetKyLuat> {
  if (!memberId) return RONG;
  const { start, end } = monthRange(year, month);
  const [cfg, rows, don] = await Promise.all([
    getConfig(),
    getForMemberRange(memberId, start, end),
    donGiaiTrinh(start, end, memberId),
  ]);
  const d = don.get(memberId);
  return tongKetKyLuat(rows, shiftConfigFrom(cfg), d?.tre ?? new Set(), d?.som ?? new Set());
}
