import { describe, it, expect } from 'vitest';
import {
  deleteMemberBlock,
  usernameTaken,
  leaderAddBlock,
  safeTeamMember,
  type MemberLike,
} from './hr.js';

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

// Leader tự lập tài khoản cho thành viên phòng mình (anh Tâm 4/8/2026).
describe('leaderAddBlock', () => {
  it('leader có phòng thì lập được', () => {
    expect(leaderAddBlock('Ads')).toBe('');
  });

  it('leader chưa được gán phòng thì chặn, và nói rõ phải làm gì', () => {
    expect(leaderAddBlock('')).toMatch(/chưa được gán phòng/);
    expect(leaderAddBlock('   ')).toMatch(/chưa được gán phòng/);
  });
});

describe('safeTeamMember', () => {
  it('giữ đúng những ô leader được điền', () => {
    const out = safeTeamMember(
      {
        fullName: '  Trần Thị An Thùy ',
        username: ' anthuy ',
        position: 'Chuyên viên Content',
        dob: '2000-05-01',
        joinDate: '2026-08-01',
      },
      'Content',
    );
    expect(out.fullName).toBe('Trần Thị An Thùy');
    expect(out.username).toBe('anthuy');
    expect(out.position).toBe('Chuyên viên Content');
    expect(out.dob).toBe('2000-05-01');
    expect(out.joinDate).toBe('2026-08-01');
  });

  // Ba test dưới đây là phần quan trọng nhất của cả tính năng: leader gọi thẳng API,
  // gửi thêm trường gì cũng không vượt được ba giới hạn này.
  it('KHÔNG cho leader tự phong vai — luôn là nhân viên', () => {
    expect(safeTeamMember({ fullName: 'X', role: 'director' } as never, 'Ads').role).toBe('member');
    expect(safeTeamMember({ fullName: 'X', role: 'admin' } as never, 'Ads').role).toBe('member');
  });

  it('KHÔNG cho leader cấy người sang phòng khác — luôn là phòng của chính leader', () => {
    expect(safeTeamMember({ fullName: 'X', teamId: 'SEO' } as never, 'Ads').teamId).toBe('Ads');
  });

  it('KHÔNG cho leader đặt lương hay BHXH — luôn bằng 0', () => {
    const out = safeTeamMember({ fullName: 'X', salary: 99_000_000, bhxh: 5_000_000 } as never, 'Ads');
    expect(out.salary).toBe(0);
    expect(out.bhxh).toBe(0);
  });

  it('không để lọt bất kỳ ô lạ nào sang bản ghi', () => {
    const out = safeTeamMember(
      { fullName: 'X', id: 'M-1', passwordHash: 'abc', active: false } as never,
      'Ads',
    );
    expect(out.active).toBe(true);
    expect(Object.keys(out).sort()).toEqual([
      'active',
      'bhxh',
      'dob',
      'fullName',
      'joinDate',
      'position',
      'role',
      'salary',
      'teamId',
      'username',
    ]);
  });

  it('ô không phải chuỗi thì thành rỗng, không nhét số vào tên', () => {
    const out = safeTeamMember({ fullName: 123, dob: null } as never, 'Ads');
    expect(out.fullName).toBe('');
    expect(out.dob).toBe('');
  });
});
