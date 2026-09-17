import { describe, it, expect } from 'vitest';
import { ngayKemThu, directorPrompt, memberPrompt } from './assistant.prompts.js';

describe('ngayKemThu', () => {
  it('ghi đúng thứ — 17/9/2026 là Thứ 5', () => {
    expect(ngayKemThu('2026-09-17')).toBe('2026-09-17 (Thứ 5)');
    expect(ngayKemThu('2026-09-20')).toBe('2026-09-20 (Chủ nhật)');
    expect(ngayKemThu('2026-09-19')).toBe('2026-09-19 (Thứ 7)');
  });

  it('chuỗi lạ thì trả nguyên, không nổ', () => {
    expect(ngayKemThu('hôm nay')).toBe('hôm nay');
  });
});

describe('prompt', () => {
  it('giám đốc: có thứ trong ngày và luật không nhắc lại lượt trước', () => {
    const p = directorPrompt({ today: '2026-09-17', names: 'A, B' });
    expect(p).toContain('2026-09-17 (Thứ 5)');
    expect(p).toContain('CHỈ NÓI VỀ YÊU CẦU VỪA NHẮN');
  });

  it('nhân viên: cũng có thứ và luật không tổng kết lượt trước', () => {
    const p = memberPrompt({ today: '2026-09-17', fullName: 'An', teamId: 'Ads', isSale: false });
    expect(p).toContain('(Thứ 5)');
    expect(p).toContain('không nhắc lại hay tổng kết');
  });
});
