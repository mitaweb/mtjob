import { describe, it, expect } from 'vitest';
import { taskTitle, cleanNote } from './tasks.js';

describe('cleanNote', () => {
  it('bỏ cụm hành động mở đầu, còn lại đúng bằng tên việc thì không giữ gì', () => {
    // Đây là ca thật: bảng điểm hiện "bắt đầu tối ưu quảng cáo" thay vì "Tối ưu Quảng Cáo".
    expect(cleanNote('bắt đầu tối ưu quảng cáo', 'Tối ưu Quảng Cáo')).toBe('');
    expect(cleanNote('đã đăng bài page', 'Đăng bài page')).toBe('');
    expect(cleanNote('bắt đầu lên ads', 'Lên Ads')).toBe('');
  });

  it('giữ lại mô tả thật (tên khách) sau khi bỏ hành động và tên việc', () => {
    expect(cleanNote('đã đăng bài page cho X Salon', 'Đăng bài page')).toBe('X Salon');
    expect(cleanNote('bắt đầu lên ads Quốc Phong', 'Lên Ads')).toBe('Quốc Phong');
    expect(cleanNote('vừa xong báo cáo ads - Ba Spa', 'Báo cáo Ads')).toBe('Ba Spa');
  });

  it('ghi chú vốn đã sạch thì giữ nguyên', () => {
    expect(cleanNote('X Salon', 'Đăng bài page')).toBe('X Salon');
    expect(cleanNote('Quốc Phong tháng 8', 'Lên Ads')).toBe('Quốc Phong tháng 8');
  });

  it('chịu được đầu vào rỗng', () => {
    expect(cleanNote('', 'Lên Ads')).toBe('');
    expect(cleanNote('   ', 'Lên Ads')).toBe('');
    expect(cleanNote('X Salon')).toBe('X Salon');
  });

  it('không cắt nhầm khi mô tả chỉ TÌNH CỜ bắt đầu bằng chữ giống tên việc', () => {
    // "Lên Ads Studio" là tên khách, không phải lặp tên việc → giữ nguyên phần còn lại.
    expect(cleanNote('lên ads cho Ads Studio', 'Lên Ads')).toBe('Ads Studio');
  });
});

describe('taskTitle', () => {
  it('ghép loại việc + mô tả cụ thể', () => {
    expect(taskTitle({ taskName: 'Đăng post', note: 'X Salon' })).toBe('Đăng post — X Salon');
  });
  it('note rỗng → chỉ loại việc', () => {
    expect(taskTitle({ taskName: 'Đăng post', note: '' })).toBe('Đăng post');
    expect(taskTitle({ taskName: 'Đăng post' })).toBe('Đăng post');
  });
  it('note đã chứa loại việc → dùng note (tránh lặp)', () => {
    expect(taskTitle({ taskName: 'Đăng post', note: 'đăng post X Salon' })).toBe('đăng post X Salon');
  });
  it('việc được giao: taskName đã đầy đủ, bỏ note "Giao bởi"', () => {
    expect(taskTitle({ taskName: 'Đăng post X Salon', note: 'Giao bởi Nam', source: 'assign' })).toBe('Đăng post X Salon');
    expect(taskTitle({ taskName: 'Viết bài', note: 'Giao bởi Lan' })).toBe('Viết bài');
  });
});
