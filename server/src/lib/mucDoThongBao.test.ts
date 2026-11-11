import { describe, it, expect } from 'vitest';
import { mucDoCua, chuanCaiDat } from './mucDoThongBao.js';

// Javis mục 4 (anh Tâm 11/11/2026): chỉ việc KHẨN mới đổ chuông, còn lại hiện im lặng hoặc chỉ nằm trong chuông app.
describe('mucDoCua — một thông báo đổ chuông tới đâu', () => {
  it('mặc định: nhắc hẹn khẩn, việc xong thường, mục kho chờ duyệt chỉ trong app', () => {
    expect(mucDoCua('reminder', {})).toBe('khan');
    expect(mucDoCua('task_done', {})).toBe('thuong');
    expect(mucDoCua('brain_pending', {})).toBe('im');
  });
  it('giám đốc chỉnh thì theo giám đốc; ép tại chỗ gửi thắng cả hai', () => {
    expect(mucDoCua('task_done', { task_done: 'im' })).toBe('im');
    expect(mucDoCua('task_done', { task_done: 'im' }, 'khan')).toBe('khan');
  });
  it('loại lạ → thường; gửi thử luôn khẩn', () => {
    expect(mucDoCua('loai_moi', {})).toBe('thuong');
    expect(mucDoCua('test', { test: 'im' })).toBe('khan');
  });
});

describe('chuanCaiDat — chỉ giữ cài đặt hợp lệ', () => {
  it('bỏ loại lạ và mức sai', () => {
    expect(chuanCaiDat({ reminder: 'im', task_done: 'to', khong_co: 'khan', x: 1 })).toEqual({ reminder: 'im' });
    expect(chuanCaiDat('rác')).toEqual({});
  });
});
