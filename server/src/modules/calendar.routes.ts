// Lịch của tôi: gộp mọi thứ có ngày vào một dãy ngày liên tiếp.
//
// Anh Tâm 18/8/2026: "bấm vào sẽ hiển thị lịch 30 ngày, xem được ngày nào có lịch gì".
// Gộp ở MÁY CHỦ chứ không để màn hình tự gọi 4-5 API rồi trộn: mỗi nguồn một luật quyền
// riêng, trộn ở màn hình là sớm muộn cũng lộ dữ liệu cho người không được xem.
import { Router } from 'express';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { getReminders } from './reminders.repo.js';
import { getUpcoming, getCustomers } from './crm.repo.js';
import { getHolidaysBetween } from './holidays.repo.js';
import { getAllRequests } from './requests.repo.js';
import { dayNgay, roiVaoNgay, laSinhNhat } from '../lib/lich.js';
import { TEN_DON, laDonGiaiTrinh } from '../lib/requests.js';
import { dayjs, TZ, todayIso, ngayVn, fmtHm } from '../lib/datetime.js';

export const calendarRouter = Router();
calendarRouter.use(requireAuth);

/** Số ngày tối đa một lần xem — chặn gọi ?days=99999 quét cả bảng. */
const TOI_DA_NGAY = 62;

type LoaiMuc = 'reminder' | 'appointment' | 'birthday' | 'holiday' | 'request';

interface MucLich {
  loai: LoaiMuc;
  /** 'HH:mm' hoặc rỗng nếu là việc cả ngày (lễ, sinh nhật). */
  gio: string;
  ten: string;
  ghiChu?: string;
}

const TEN_DON_DAY: Record<string, string> = { ...TEN_DON, online: 'Làm online', leave: 'Nghỉ phép' };

/** Chỉ mấy vai này mới được xem dữ liệu khách hàng — giữ đúng hàng rào của /api/crm. */
const XEM_DUOC_CRM = new Set(['sale', 'director', 'admin']);

calendarRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const from = /^\d{4}-\d{2}-\d{2}$/.test(String(req.query.from || ''))
      ? String(req.query.from)
      : todayIso();
    const days = Math.min(Math.max(Number(req.query.days) || 30, 1), TOI_DA_NGAY);
    const ngays = dayNgay(from, days);
    const den = ngays[ngays.length - 1];

    const theoNgay = new Map<string, MucLich[]>(ngays.map((d) => [d, []]));
    const them = (ngay: string, m: MucLich) => theoNgay.get(ngay)?.push(m);

    // 1. Nhắc hẹn của chính mình. Hẹn đã tắt thì không nhắc nữa nên cũng không vẽ.
    for (const r of await getReminders(req.user!.sub)) {
      if (!r.active) continue;
      for (const ngay of ngays) {
        if (roiVaoNgay(r, ngay)) them(ngay, { loai: 'reminder', gio: r.atTime, ten: r.title });
      }
    }

    // 2. Đơn của chính mình đã duyệt — nghỉ phép, làm online, giải trình chấm công.
    const donCuaToi = (await getAllRequests()).filter(
      (r) => r.memberId === req.user!.sub && r.finalStatus === 'approved',
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
    for (const l of await getHolidaysBetween(from, den)) {
      them(l.date, { loai: 'holiday', gio: '', ten: l.name });
    }

    // 4-5. Lịch hẹn và sinh nhật khách: dữ liệu CRM, chỉ mở cho vai được xem CRM.
    if (XEM_DUOC_CRM.has(req.user!.role)) {
      const tuIso = dayjs.tz(from, 'YYYY-MM-DD', TZ).startOf('day').toISOString();
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
    const ketQua = ngays.map((ngay) => ({
      ngay,
      mucs: (theoNgay.get(ngay) || []).sort((a, b) => a.gio.localeCompare(b.gio)),
    }));

    res.json({ from, den, days: ketQua });
  }),
);
