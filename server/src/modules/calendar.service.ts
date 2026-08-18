// Lịch của tôi: gộp mọi thứ có ngày vào một dãy ngày liên tiếp.
//
// Anh Tâm 18/8/2026: "bấm vào sẽ hiển thị lịch 30 ngày, xem được ngày nào có lịch gì".
// Gộp ở MÁY CHỦ chứ không để màn hình gọi 4-5 API rồi trộn: mỗi nguồn một luật quyền
// riêng, trộn ở màn hình là sớm muộn cũng lộ dữ liệu cho người không được xem.
//
// Cùng một hàm này phục vụ hai việc: vẽ lịch, và bắt trùng giờ khi đặt hẹn mới — hai
// đường mà nhìn hai bộ dữ liệu khác nhau thì lịch trống trơn vẫn báo trùng.
import { getReminders } from './reminders.repo.js';
import { getUpcoming, getCustomers } from './crm.repo.js';
import { getHolidaysBetween } from './holidays.repo.js';
import { getAllRequests } from './requests.repo.js';
import { dayNgay, roiVaoNgay, laSinhNhat, trungGio } from '../lib/lich.js';
import { TEN_DON, laDonGiaiTrinh } from '../lib/requests.js';
import { dayjs, TZ, ngayVn, fmtHm } from '../lib/datetime.js';

export type LoaiMuc = 'reminder' | 'appointment' | 'birthday' | 'holiday' | 'request';

export interface MucLich {
  loai: LoaiMuc;
  /** 'HH:mm' hoặc rỗng nếu là việc cả ngày (lễ, sinh nhật). */
  gio: string;
  ten: string;
  ghiChu?: string;
}

export interface NgayLich {
  ngay: string;
  mucs: MucLich[];
}

const TEN_DON_DAY: Record<string, string> = { ...TEN_DON, online: 'Làm online', leave: 'Nghỉ phép' };

/** Chỉ mấy vai này mới được xem dữ liệu khách hàng — giữ đúng hàng rào của /api/crm. */
const XEM_DUOC_CRM = new Set(['sale', 'director', 'admin']);

export async function layLich(opts: {
  memberId: string;
  role: string;
  from: string;
  days: number;
}): Promise<NgayLich[]> {
  const ngays = dayNgay(opts.from, opts.days);
  if (ngays.length === 0) return [];
  const den = ngays[ngays.length - 1];

  const theoNgay = new Map<string, MucLich[]>(ngays.map((d) => [d, []]));
  const them = (ngay: string, m: MucLich) => theoNgay.get(ngay)?.push(m);

  // 1. Nhắc hẹn của chính mình. Hẹn đã tắt thì không nhắc nữa nên cũng không vẽ.
  for (const r of await getReminders(opts.memberId)) {
    if (!r.active) continue;
    for (const ngay of ngays) {
      if (roiVaoNgay(r, ngay)) them(ngay, { loai: 'reminder', gio: r.atTime, ten: r.title });
    }
  }

  // 2. Đơn của chính mình đã duyệt — nghỉ phép, làm online, giải trình chấm công.
  const donCuaToi = (await getAllRequests()).filter(
    (r) => r.memberId === opts.memberId && r.finalStatus === 'approved',
  );
  for (const don of donCuaToi) {
    for (const ngay of don.dates) {
      them(ngay, {
        loai: 'request',
        gio: '',
        ten: TEN_DON_DAY[don.kind] ?? don.kind,
        ghiChu: laDonGiaiTrinh(don.kind) ? don.reason : don.type || '',
      });
    }
  }

  // 3. Ngày lễ — ai cũng thấy.
  for (const l of await getHolidaysBetween(opts.from, den)) {
    them(l.date, { loai: 'holiday', gio: '', ten: l.name });
  }

  // 4-5. Lịch hẹn và sinh nhật khách: dữ liệu CRM, chỉ mở cho vai được xem CRM.
  if (XEM_DUOC_CRM.has(opts.role)) {
    const tuIso = dayjs.tz(opts.from, 'YYYY-MM-DD', TZ).startOf('day').toISOString();
    const denIso = dayjs.tz(den, 'YYYY-MM-DD', TZ).endOf('day').toISOString();
    for (const a of await getUpcoming(tuIso, denIso)) {
      them(ngayVn(a.at), {
        loai: 'appointment',
        gio: fmtHm(a.at),
        ten: a.customerName || 'Khách hàng',
        ghiChu: a.note,
      });
    }
    for (const c of await getCustomers()) {
      if (!c.dob) continue;
      for (const ngay of ngays) {
        if (laSinhNhat(c.dob, ngay)) them(ngay, { loai: 'birthday', gio: '', ten: c.name });
      }
    }
  }

  // Trong một ngày: việc có giờ xếp theo giờ, việc cả ngày (lễ, sinh nhật) lên đầu.
  return ngays.map((ngay) => ({
    ngay,
    mucs: (theoNgay.get(ngay) || []).sort((a, b) => a.gio.localeCompare(b.gio)),
  }));
}

export interface Trung {
  ngay: string;
  muc: MucLich;
}

/**
 * Giờ định đặt có đụng cái gì đang có không?
 *
 * `dip`: các lần xảy ra của lịch sắp đặt, dạng { ngay, gio }. Nhắc hẹn lặp thì có nhiều
 * lần — chỉ cần đụng MỘT lần là đã đáng báo.
 *
 * Chỉ so với mục CÓ GIỜ: ngày lễ và sinh nhật không chiếm giờ nào nên không tính là trùng.
 */
export async function timTrung(opts: {
  memberId: string;
  role: string;
  dip: Array<{ ngay: string; gio: string }>;
}): Promise<Trung[]> {
  const ngays = opts.dip.map((d) => d.ngay).filter(Boolean);
  if (ngays.length === 0) return [];
  const from = ngays.reduce((a, b) => (a < b ? a : b));
  const den = ngays.reduce((a, b) => (a > b ? a : b));
  const soNgay = dayjs(den).diff(dayjs(from), 'day') + 1;

  const lich = await layLich({ memberId: opts.memberId, role: opts.role, from, days: soNgay });
  const theoNgay = new Map(lich.map((d) => [d.ngay, d.mucs]));

  const ra: Trung[] = [];
  for (const d of opts.dip) {
    for (const muc of theoNgay.get(d.ngay) || []) {
      if (muc.gio && trungGio(muc.gio, d.gio)) ra.push({ ngay: d.ngay, muc });
    }
  }
  return ra;
}

/** Câu báo trùng cho người dùng đọc — dùng chung cho form, cho API và cho trợ lý. */
export function loiTrung(ts: Trung[]): string {
  if (ts.length === 0) return '';
  const t = ts[0];
  const ngay = `${t.ngay.slice(8, 10)}/${t.ngay.slice(5, 7)}`;
  const them = ts.length > 1 ? ` (và ${ts.length - 1} lịch khác nữa)` : '';
  return `Giờ này đã có lịch: ${t.muc.gio} ngày ${ngay} — ${t.muc.ten}${them}.`;
}
