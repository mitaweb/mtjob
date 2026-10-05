import { describe, it, expect, vi } from 'vitest';

// Tệp đính kèm trong khung chat (anh Tâm 5/10/2026).
vi.mock('../db/client.js', () => ({ q: vi.fn(async () => []) }));
const { khoiTepChoHoi } = await import('./brain.service.js');
const { SQL_TEP_CUA_NGUOI } = await import('./brain.repo.js');

describe('khoiTepChoHoi — ghép nội dung tệp vào câu hỏi', () => {
  it('mỗi tệp một khối có tên, có dấu kết thúc để AI biết đâu là dữ liệu tệp', () => {
    const s = khoiTepChoHoi([{ name: 'bao-gia.pdf', transcript: 'Gói SEO 20tr' }]);
    expect(s).toBe('[TỆP ĐÍNH KÈM: bao-gia.pdf]\nGói SEO 20tr\n[HẾT TỆP: bao-gia.pdf]');
  });

  it('tệp dài bị cắt và ghi rõ là đã lược; tổng nhiều tệp không vượt trần', () => {
    const dai = 'z'.repeat(20000);
    const s = khoiTepChoHoi([
      { name: '1.pdf', transcript: dai },
      { name: '2.pdf', transcript: dai },
      { name: '3.pdf', transcript: dai },
    ]);
    expect(s).toContain('phần sau đã lược bớt');
    expect((s.match(/z/g) || []).length).toBeLessThanOrEqual(24000);
    expect(s).not.toContain('3.pdf'); // hết hạn mức thì dừng, không gửi khối rỗng
  });

  it('nhãn riêng cho tệp của lượt trước', () => {
    expect(khoiTepChoHoi([{ name: 'x.png', transcript: 'chữ' }], 'TỆP ĐÃ GỬI Ở LƯỢT TRƯỚC')).toContain('[TỆP ĐÃ GỬI Ở LƯỢT TRƯỚC: x.png]');
    expect(khoiTepChoHoi([])).toBe('');
  });
});

describe('chỉ đọc được tệp của chính mình', () => {
  it('câu SQL lọc theo người tải lên và chỉ lấy tệp đã đọc xong', () => {
    expect(SQL_TEP_CUA_NGUOI).toContain('uploaded_by = $2');
    expect(SQL_TEP_CUA_NGUOI).toContain("transcript <> ''");
  });
});
