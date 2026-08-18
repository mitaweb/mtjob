export type RequestKind = 'online' | 'leave' | 'forgot' | 'late' | 'early';

/** Ba loại đơn giải trình chấm công — cùng chung luật 24h. Khớp với server/src/lib/requests.ts. */
export const GIAI_TRINH: RequestKind[] = ['forgot', 'late', 'early'];

export const TEN_DON: Record<string, string> = {
  online: 'Làm online',
  leave: 'Nghỉ phép',
  forgot: 'Quên chấm công',
  late: 'Đi trễ',
  early: 'Về sớm',
};

export const laGiaiTrinh = (kind: string): boolean => GIAI_TRINH.includes(kind as RequestKind);

/** Ngày dạng YYYY-MM-DD theo giờ Việt Nam — máy nhân viên để múi giờ nào cũng ra đúng ngày. */
function isoVn(d: Date): string {
  return new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(d);
}

export const homNayIso = (): string => isoVn(new Date());

/** Ngày sớm nhất còn nộp đơn giải trình được: hôm qua. Hôm kia là quá hạn. */
export const homQuaIso = (): string => isoVn(new Date(Date.now() - 86400000));
