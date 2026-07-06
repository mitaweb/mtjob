import { describe, it, expect } from 'vitest';
import { taskTitle } from './tasks.js';

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
