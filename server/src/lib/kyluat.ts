// Đếm đi trễ / về sớm trong tháng để cảnh báo lúc chốt lương.
//
// Anh Tâm 31/8/2026: "Hiện cảnh báo số lần đi trễ trong tháng khi chốt lương. Tháng rồi
// bạn đi trễ, về sớm ... lần, nếu không cải thiện bạn sẽ bị phạt."
//
// Kết luận đọc từ MỐC GIỜ THẬT trong bảng chấm công, KHÔNG đọc cột `status`: quản trị sửa
// một ngày công là `status` bị ghi đè thành 'present'/'half' (admin.payroll.routes) — cờ
// 'late' biến mất, đếm theo nó sẽ hụt số. Mốc giờ thì còn nguyên và tính lại được bất cứ
// lúc nào, nên con số tháng trước không đổi chỉ vì ai đó sửa một ngày công khác.
import { dayjs, TZ } from './datetime.js';
import type { ShiftConfig } from './attendance.js';

/** Ô giờ vào/ra có khi chứa CỜ chứ không phải mốc giờ: 'online', 'quencham'. */
const MOC_GIO = /^\d{4}-\d{2}-\d{2}T/;

/** Ngày nghỉ phép / nghỉ lễ: không có mặt thì không có chuyện trễ hay sớm. */
const BO_QUA_MODE = new Set(['leave', 'holiday']);

/** Phút trong ngày (giờ VN) của một mốc ISO; null nếu không phải mốc giờ thật. */
export function phutTrongNgay(iso: string | undefined | null): number | null {
  if (!iso || !MOC_GIO.test(iso)) return null;
  const d = dayjs(iso);
  if (!d.isValid()) return null;
  const t = d.tz(TZ);
  return t.hour() * 60 + t.minute();
}

function hhmm(phut: number): string {
  return `${String(Math.floor(phut / 60)).padStart(2, '0')}:${String(phut % 60).padStart(2, '0')}`;
}

/** Chỉ những cột cần để kết luận — để lib không phải biết tới kiểu của tầng DB. */
export interface DongChamCong {
  date: string;
  morningInAt?: string;
  afternoonInAt?: string;
  afternoonOutAt?: string;
  mode?: string;
}

export interface NgayViPham {
  date: string;
  tre: boolean;
  /** Trễ bao nhiêu phút so với giờ bắt đầu ca. 0 khi chỉ biết qua đơn. */
  treMin: number;
  /** Giờ vào bị tính là trễ (HH:mm) — để nhìn là biết trễ buổi nào. */
  gioVao: string;
  donTre: boolean;
  som: boolean;
  somMin: number;
  gioRa: string;
  donSom: boolean;
}

export interface TongKetKyLuat {
  soLanTre: number;
  soLanSom: number;
  /** Số lần vi phạm CHƯA có đơn giải trình — nặng hơn, vì đơn là bắt buộc trong 24h. */
  soLanKhongDon: number;
  ngay: NgayViPham[];
}

export const RONG: TongKetKyLuat = { soLanTre: 0, soLanSom: 0, soLanKhongDon: 0, ngay: [] };

/**
 * Soát một ngày. Trả null khi ngày đó sạch.
 *
 * Đi trễ: xét từng buổi CÓ chấm giờ vào thật; một ngày tính MỘT lần dù trễ cả hai buổi.
 * Về sớm: chỉ so giờ ra BUỔI CHIỀU với giờ tan làm. Ngày chỉ làm buổi sáng (không có giờ
 *   ra chiều) không tính về sớm — công đã bị trừ một nửa rồi, đếm thêm là phạt hai lần
 *   cho cùng một chuyện.
 * Đơn ĐÃ DUYỆT không xoá vi phạm, chỉ đánh dấu là có xin phép — đúng luật anh Tâm chốt
 *   cho đơn đi trễ/về sớm: "xin phép, không phải xin bù công".
 */
export function soatNgay(
  row: DongChamCong,
  cfg: ShiftConfig,
  don: { tre?: boolean; som?: boolean } = {},
): NgayViPham | null {
  let treMin = 0;
  let gioVao = '';
  let somMin = 0;
  let gioRa = '';

  if (!BO_QUA_MODE.has(String(row.mode || ''))) {
    const caVao: Array<[string | undefined, number]> = [
      [row.morningInAt, cfg.morningStart],
      [row.afternoonInAt, cfg.afternoonStart],
    ];
    for (const [moc, batDau] of caVao) {
      const p = phutTrongNgay(moc);
      if (p == null) continue;
      if (p - batDau > treMin) {
        treMin = p - batDau;
        gioVao = hhmm(p);
      }
    }
    const pRa = phutTrongNgay(row.afternoonOutAt);
    if (pRa != null && pRa < cfg.afternoonEnd) {
      somMin = cfg.afternoonEnd - pRa;
      gioRa = hhmm(pRa);
    }
  }

  const tre = treMin > 0 || !!don.tre;
  const som = somMin > 0 || !!don.som;
  if (!tre && !som) return null;

  return {
    date: row.date,
    tre,
    treMin,
    gioVao,
    donTre: tre && !!don.tre,
    som,
    somMin,
    gioRa,
    donSom: som && !!don.som,
  };
}

/**
 * Tổng kết một tháng của MỘT người.
 *
 * Duyệt hợp của ngày có chấm công và ngày có đơn: người quên chấm hẳn một ngày rồi nộp
 * đơn đi trễ vẫn phải được đếm — bỏ qua thì nộp đơn hoá ra lại là cách né.
 */
export function tongKetKyLuat(
  rows: DongChamCong[],
  cfg: ShiftConfig,
  donTre: Set<string>,
  donSom: Set<string>,
): TongKetKyLuat {
  const theoNgay = new Map<string, DongChamCong>();
  for (const r of rows) if (r.date) theoNgay.set(r.date, r);
  const moiNgay = new Set<string>([...theoNgay.keys(), ...donTre, ...donSom]);

  const ngay: NgayViPham[] = [];
  for (const d of [...moiNgay].sort()) {
    const v = soatNgay(theoNgay.get(d) ?? { date: d }, cfg, {
      tre: donTre.has(d),
      som: donSom.has(d),
    });
    if (v) ngay.push(v);
  }

  return {
    soLanTre: ngay.filter((n) => n.tre).length,
    soLanSom: ngay.filter((n) => n.som).length,
    soLanKhongDon: ngay.reduce(
      (s, n) => s + (n.tre && !n.donTre ? 1 : 0) + (n.som && !n.donSom ? 1 : 0),
      0,
    ),
    ngay,
  };
}

/**
 * Câu cảnh báo gửi cho nhân sự. Rỗng khi tháng đó sạch — không có gì thì không nói gì.
 *
 * Viết ở đây chứ không ở giao diện: cùng một câu phải xuất hiện y hệt trong thông báo đẩy
 * lúc chốt lương và trên trang Lương của nhân sự.
 */
export function cauCanhBao(t: TongKetKyLuat, thang: string): string {
  const ve: string[] = [];
  if (t.soLanTre > 0) ve.push(`đi trễ ${t.soLanTre} lần`);
  if (t.soLanSom > 0) ve.push(`về sớm ${t.soLanSom} lần`);
  if (ve.length === 0) return '';
  let s = `Tháng ${thang} bạn ${ve.join(', ')}. Nếu không cải thiện, bạn sẽ bị phạt.`;
  if (t.soLanKhongDon > 0) s += ` Trong đó ${t.soLanKhongDon} lần chưa có đơn giải trình.`;
  return s;
}
