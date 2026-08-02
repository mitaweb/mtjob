import { describe, it, expect } from 'vitest';
import { fmtHm, fmtDate } from './datetime.js';

// Anh Tâm 1/8/2026 gửi ảnh bảng chấm công có dòng "Invalid Date——". Gốc: chấm công duyệt
// online ghi cờ 'online' vào ô giờ vào (requests.service.ts) để tính đủ công, rồi màn hình
// đem format nó thành giờ. Hai hàm này là chỗ cuối cùng chặn được.

describe('fmtHm', () => {
  it('format mốc thời gian thật theo giờ VN', () => {
    // 2026-07-30T01:26:00Z = 08:26 giờ VN
    expect(fmtHm('2026-07-30T01:26:00.000Z')).toBe('08:26');
  });

  it('cờ "online" KHÔNG được hiện thành Invalid Date', () => {
    expect(fmtHm('online')).toBe('');
  });

  it('chuỗi rỗng và chuỗi rác trả về rỗng', () => {
    expect(fmtHm('')).toBe('');
    expect(fmtHm('chưa chấm')).toBe('');
  });
});

describe('fmtDate', () => {
  it('format ngày theo kiểu Việt Nam', () => {
    expect(fmtDate('2026-07-30')).toBe('30/07/2026');
  });

  it('giá trị không hợp lệ trả về rỗng, không phải Invalid Date', () => {
    expect(fmtDate('online')).toBe('');
    expect(fmtDate('')).toBe('');
  });
});
