import { describe, it, expect } from 'vitest';
import { deleteMemberBlock, usernameTaken, type MemberLike } from './hr.js';

const m = (id: string, fullName: string, role: string, username = id, active = true): MemberLike => ({
  id,
  fullName,
  username,
  role,
  active,
});

const TEAM = [
  m('M-1', 'Hồ Minh Tâm', 'director', 'hotam'),
  m('M-2', 'Lương Thị Thu Hà', 'admin', 'luongha'),
  m('M-3', 'Trần Thị An Thùy', 'member', 'tranthuy'),
  m('M-4', 'Nguyễn Anh Tú', 'leader', 'nguyentu'),
];

describe('deleteMemberBlock', () => {
  it('xoá được nhân viên thường', () => {
    expect(deleteMemberBlock(TEAM, 'M-3', 'M-1')).toBe('');
  });

  it('xoá được leader — leader không phải vai quản trị', () => {
    expect(deleteMemberBlock(TEAM, 'M-4', 'M-1')).toBe('');
  });

  it('không tự xoá chính mình', () => {
    expect(deleteMemberBlock(TEAM, 'M-1', 'M-1')).toMatch(/chính mình/);
  });

  it('mã không có thật thì báo không tìm thấy', () => {
    expect(deleteMemberBlock(TEAM, 'M-99', 'M-1')).toMatch(/Không tìm thấy/);
  });

  it('còn người quản trị khác thì xoá được một người', () => {
    // Giám đốc xoá admin: vẫn còn chính giám đốc giữ quyền.
    expect(deleteMemberBlock(TEAM, 'M-2', 'M-1')).toBe('');
  });

  it('CHẶN khi đó là người quản trị cuối cùng', () => {
    const only = [m('M-1', 'Hồ Minh Tâm', 'director', 'hotam'), m('M-3', 'An Thùy', 'member')];
    expect(deleteMemberBlock(only, 'M-1', 'M-3')).toMatch(/duy nhất còn quyền quản trị/);
  });

  it('người quản trị ĐÃ NGHỈ vẫn tính là người thay được — họ bật lại được', () => {
    const withRetired = [
      m('M-1', 'Hồ Minh Tâm', 'director', 'hotam'),
      m('M-2', 'Thu Hà', 'admin', 'luongha', false),
      m('M-3', 'An Thùy', 'member'),
    ];
    expect(deleteMemberBlock(withRetired, 'M-1', 'M-3')).toBe('');
  });
});

describe('usernameTaken', () => {
  it('tên chưa ai dùng thì cho qua', () => {
    expect(usernameTaken(TEAM, 'vongoc', 'M-3')).toBe('');
  });

  it('giữ nguyên tên của chính mình thì không coi là trùng', () => {
    expect(usernameTaken(TEAM, 'tranthuy', 'M-3')).toBe('');
  });

  it('trùng tên người khác thì báo rõ trùng với AI', () => {
    expect(usernameTaken(TEAM, 'hotam', 'M-3')).toMatch(/Hồ Minh Tâm/);
  });

  it('không phân biệt hoa thường và khoảng trắng thừa', () => {
    expect(usernameTaken(TEAM, '  HoTam  ', 'M-3')).toMatch(/đã là của/);
  });

  it('bỏ trống thì bỏ qua — máy chủ sẽ tự sinh tên', () => {
    expect(usernameTaken(TEAM, '', 'M-3')).toBe('');
  });
});
