import { describe, it, expect } from 'vitest';
import { loiTrung, type Trung } from './calendar.service.js';

const t = (ngay: string, gio: string, ten: string): Trung => ({
  ngay,
  muc: { loai: 'appointment', gio, ten },
});

describe('loiTrung', () => {
  it('không trùng thì không có câu báo nào', () => {
    expect(loiTrung([])).toBe('');
  });

  it('nói rõ giờ, ngày và trùng với cái gì', () => {
    expect(loiTrung([t('2026-08-21', '14:00', 'Bs Hải Yến')])).toBe(
      'Giờ này đã có lịch: 14:00 ngày 21/08 — Bs Hải Yến.',
    );
  });

  it('trùng nhiều thì nêu cái đầu và đếm phần còn lại', () => {
    const ts = [t('2026-08-21', '14:00', 'Bs Hải Yến'), t('2026-08-21', '14:10', 'Họp Savax')];
    expect(loiTrung(ts)).toBe('Giờ này đã có lịch: 14:00 ngày 21/08 — Bs Hải Yến (và 1 lịch khác nữa).');
  });
});
