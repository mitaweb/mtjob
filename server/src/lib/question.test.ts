import { describe, it, expect } from 'vitest';
import { looksLikeQuestion } from './question.js';

describe('looksLikeQuestion', () => {
  it('nhận ra câu hỏi có dấu ?', () => {
    expect(looksLikeQuestion('đã đăng bài page chưa?')).toBe(true);
    expect(looksLikeQuestion('khách Ba Spa cần gì?')).toBe(true);
  });

  it('nhận ra câu hỏi KHÔNG có dấu ? (người Việt hay bỏ)', () => {
    expect(looksLikeQuestion('tháng trước tôi được bao nhiêu điểm')).toBe(true);
    expect(looksLikeQuestion('đơn nghỉ của tôi duyệt chưa')).toBe(true);
    expect(looksLikeQuestion('ai đang phụ trách khách này')).toBe(true);
    expect(looksLikeQuestion('lên ads thế nào')).toBe(true);
    expect(looksLikeQuestion('làm được không')).toBe(true);
  });

  it('KHÔNG nhầm câu báo việc thành câu hỏi', () => {
    expect(looksLikeQuestion('đã đăng bài page')).toBe(false);
    expect(looksLikeQuestion('bắt đầu lên ads')).toBe(false);
    expect(looksLikeQuestion('xong video quảng cáo cho X Salon')).toBe(false);
    expect(looksLikeQuestion('đã thiết kế post 1 ảnh')).toBe(false);
  });

  it('chịu được đầu vào rỗng', () => {
    expect(looksLikeQuestion('')).toBe(false);
    expect(looksLikeQuestion('   ')).toBe(false);
  });
});
