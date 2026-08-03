import { describe, it, expect } from 'vitest';
import {
  haversineMeters,
  withinRadius,
  classifyShift,
  isLate,
  dayFractionFromShifts,
  fractionForScope,
  locationVerdict,
  DEFAULT_SHIFTS,
} from './attendance.js';

describe('haversineMeters', () => {
  it('is 0 for the same point', () => {
    expect(haversineMeters(10.776, 106.7, 10.776, 106.7)).toBe(0);
  });

  it('approximates 1 degree of longitude at the equator (~111km)', () => {
    const d = haversineMeters(0, 0, 0, 1);
    expect(d).toBeGreaterThan(111_000);
    expect(d).toBeLessThan(111_400);
  });

  it('measures a short office-radius distance', () => {
    // ~111m north (0.001 deg latitude)
    const d = haversineMeters(10.762622, 106.660172, 10.763622, 106.660172);
    expect(d).toBeGreaterThan(100);
    expect(d).toBeLessThan(125);
  });
});

describe('withinRadius', () => {
  it('includes the boundary', () => {
    expect(withinRadius(150, 150)).toBe(true);
    expect(withinRadius(151, 150)).toBe(false);
  });
});

describe('classifyShift', () => {
  it('splits at the afternoon start (13:30)', () => {
    expect(classifyShift(8 * 60 + 30)).toBe('morning');
    expect(classifyShift(11 * 60)).toBe('morning');
    expect(classifyShift(12 * 60 + 30)).toBe('morning'); // lunch counts as morning
    expect(classifyShift(13 * 60 + 30)).toBe('afternoon');
    expect(classifyShift(16 * 60)).toBe('afternoon');
  });
});

describe('isLate', () => {
  it('flags check-in after shift start', () => {
    expect(isLate(8 * 60 + 30, 'morning')).toBe(false); // exactly on time
    expect(isLate(8 * 60 + 31, 'morning')).toBe(true);
    expect(isLate(13 * 60 + 45, 'afternoon')).toBe(true);
    expect(isLate(13 * 60 + 30, 'afternoon')).toBe(false);
  });

  it('respects a grace window', () => {
    expect(isLate(8 * 60 + 35, 'morning', DEFAULT_SHIFTS, 10)).toBe(false);
    expect(isLate(8 * 60 + 41, 'morning', DEFAULT_SHIFTS, 10)).toBe(true);
  });
});

describe('dayFractionFromShifts', () => {
  it('morning only (noon checkout) = 0.5', () => {
    expect(dayFractionFromShifts({ morningIn: '2026-06-04T08:30:00' })).toBe(0.5);
  });
  it('morning in + afternoon out (cả ngày) = 1.0', () => {
    expect(dayFractionFromShifts({ morningIn: 'x', afternoonOut: 'z' })).toBe(1);
  });
  it('both shifts = 1.0', () => {
    expect(dayFractionFromShifts({ morningIn: 'x', afternoonIn: 'y' })).toBe(1);
  });
  it('afternoon only = 0.5', () => {
    expect(dayFractionFromShifts({ afternoonIn: 'y' })).toBe(0.5);
  });
  it('afternoon checkout only = 0.5', () => {
    expect(dayFractionFromShifts({ afternoonOut: 'z' })).toBe(0.5);
  });
  it('nothing = 0', () => {
    expect(dayFractionFromShifts({})).toBe(0);
  });
});

describe('fractionForScope', () => {
  it('maps request scopes to day credit', () => {
    expect(fractionForScope('full')).toBe(1);
    expect(fractionForScope('half_am')).toBe(0.5);
    expect(fractionForScope('half_pm')).toBe(0.5);
  });
});

describe('locationVerdict', () => {
  const R = 300;

  it('đứng trong văn phòng, đo chính xác → cho chấm', () => {
    expect(locationVerdict(20, 15, R)).toBe('ok');
  });

  it('trừ sai số trước khi so — đứng ngay cửa không bị phạt oan', () => {
    // Đo 350m nhưng sai số 100m: vị trí thật có thể là 250m, vẫn trong vùng.
    expect(locationVerdict(350, 100, R)).toBe('ok');
  });

  it('thật sự ở xa thì vẫn chặn', () => {
    expect(locationVerdict(2000, 50, R)).toBe('too_far');
  });

  it('WiFi cho sai số khổng lồ → KHÔNG kết luận là ở xa', () => {
    // Đúng ca anh Tâm gặp: 6121m nhưng sai số hàng nghìn mét.
    expect(locationVerdict(6121, 5000, R)).toBe('inaccurate');
  });

  it('sai số vượt ngưỡng thì luôn là không đo được, dù đo ra gần', () => {
    expect(locationVerdict(50, 900, R)).toBe('inaccurate');
  });

  it('máy không báo sai số thì so thẳng khoảng cách như cũ', () => {
    expect(locationVerdict(100, 0, R)).toBe('ok');
    expect(locationVerdict(500, 0, R)).toBe('too_far');
  });

  it('sai số âm hoặc không hợp lệ được bỏ qua', () => {
    expect(locationVerdict(100, -5, R)).toBe('ok');
    expect(locationVerdict(100, NaN, R)).toBe('ok');
  });
});
