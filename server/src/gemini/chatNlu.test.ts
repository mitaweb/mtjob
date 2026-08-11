import { describe, it, expect } from 'vitest';
import { heuristic, laCauHoi } from './chatNlu.js';
import type { TaskCatalogItem } from '../types.js';

// Anh Tâm 2/8/2026 gõ "Thiết kế post 1 hình — Maple": danh mục ghi "ảnh" nên khớp nguyên
// chuỗi trượt, việc không được mở, mà trợ lý lại nói "đã ghi nhận, đang chạy". Trượt ở
// đây nghĩa là nhân sự làm xong mà không có điểm.

const CATALOG: TaskCatalogItem[] = [
  { code: 'TK1A', name: 'Thiết kế post 1 ảnh', points: 20, active: true },
  { code: 'TKNA', name: 'Thiết kế post nhiều ảnh', points: 50, active: true },
  { code: 'CTPG', name: 'Content cho page', points: 10, active: true },
  { code: 'LADS', name: 'Lên Ads', points: 20, active: true },
  { code: 'EDVD', name: 'Edit video', points: 145, active: true },
];

const code = (msg: string) => heuristic(msg, CATALOG).taskCode;

describe('heuristic — khớp loại việc', () => {
  it('“hình” hiểu là “ảnh” — đúng ca anh Tâm gặp', () => {
    expect(code('Thiết kế post 1 hình — Maple')).toBe('TK1A');
  });

  it('vẫn khớp khi gõ đúng chữ trong danh mục', () => {
    expect(code('thiết kế post 1 ảnh cho king pen')).toBe('TK1A');
  });

  it('phân biệt 1 ảnh với nhiều ảnh', () => {
    expect(code('thiết kế post nhiều hình cho X Salon')).toBe('TKNA');
  });

  it('“ads” hiểu là “quảng cáo” và ngược lại', () => {
    expect(code('lên ads X Salon')).toBe('LADS');
  });

  it('gõ thẳng mã việc thì lấy luôn', () => {
    expect(code('EDVD savax')).toBe('EDVD');
  });

  it('không dấu vẫn khớp', () => {
    expect(code('content cho page Tin Dat')).toBe('CTPG');
  });

  it('“clip” hiểu là “video”', () => {
    expect(code('edit clip cho Savax')).toBe('EDVD');
  });

  it('câu hỏi về điểm không bị hiểu thành ghi việc', () => {
    expect(heuristic('điểm của tôi tháng này', CATALOG).intent).toBe('query_stats');
  });

  it('câu không liên quan thì trả help, KHÔNG đoán bừa một việc', () => {
    expect(heuristic('hôm nay trời đẹp quá', CATALOG).intent).toBe('help');
  });

  it('trùng một từ lẻ thì KHÔNG khớp — dễ nhận nhầm sang việc khác', () => {
    // "ảnh" có trong hai loại việc nhưng câu này không đủ nghĩa để chọn cái nào.
    expect(heuristic('gửi ảnh cho khách', CATALOG).intent).toBe('help');
  });

  it('giữ nguyên câu gốc vào note để bước sau tách tên khách', () => {
    expect(heuristic('Thiết kế post 1 hình — Maple', CATALOG).note).toBe('Thiết kế post 1 hình — Maple');
  });

  // Anh Tâm 4/8/2026: hỏi CÁCH làm mà máy mở việc ra là ghi nhầm giờ làm của người ta.
  it('CÂU HỎI không bị mở thành việc, dù có đủ từ của tên việc', () => {
    expect(heuristic('cách lên ads thế nào?', CATALOG).intent).toBe('help');
    expect(heuristic('lên ads sao cho hiệu quả', CATALOG).intent).toBe('help');
    expect(heuristic('edit video mất bao lâu', CATALOG).intent).toBe('help');
  });

  it('câu báo việc bình thường vẫn mở được — chặn câu hỏi không được chặn nhầm', () => {
    expect(heuristic('lên ads cho X Salon', CATALOG).intent).toBe('start_task');
    expect(heuristic('thiết kế post 1 hình Tín Đạt', CATALOG).intent).toBe('start_task');
  });
});

describe('laCauHoi', () => {
  it('nhận ra câu hỏi', () => {
    for (const c of ['cách lên ads thế nào?', 'ai làm việc này', 'bao nhiêu điểm', 'khi nào xong']) {
      expect(laCauHoi(c)).toBe(true);
    }
  });

  it('câu báo việc KHÔNG bị coi là câu hỏi', () => {
    for (const c of ['thiết kế post 1 hình Tín Đạt', 'lên ads cho X Salon', 'edit video đăng facebook']) {
      expect(laCauHoi(c)).toBe(false);
    }
  });
});
