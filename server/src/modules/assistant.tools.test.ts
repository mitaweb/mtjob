import { describe, it, expect } from 'vitest';
import { resolveToolName } from './assistant.service.js';

// Tên hàm có thể bị hỏng khi truyền qua stream — đã gặp thật:
// "get_customer_profile" về thành "get_customer_prof_ide_ide".
const TOOLS = [
  'get_roster',
  'get_attendance',
  'get_ranking',
  'get_pending_requests',
  'get_finance_summary',
  'get_member_tasks',
  'get_customer_contact',
  'get_customer_profile',
  'search_knowledge',
  'create_reminder',
  'import_google_sheet',
  'save_to_knowledge',
];

describe('resolveToolName', () => {
  it('khớp chính xác thì trả về luôn', () => {
    expect(resolveToolName('search_knowledge', TOOLS)).toBe('search_knowledge');
    expect(resolveToolName('get_roster', TOOLS)).toBe('get_roster');
  });

  it('cứu được tên bị hỏng đuôi (lỗi thật đã gặp)', () => {
    expect(resolveToolName('get_customer_prof_ide_ide', TOOLS)).toBe('get_customer_profile');
    expect(resolveToolName('search_knowledg', TOOLS)).toBe('search_knowledge');
    expect(resolveToolName('create_remind', TOOLS)).toBe('create_reminder');
  });

  it('không đoán bừa khi tên quá ngắn hoặc lạ hoắc', () => {
    expect(resolveToolName('abc', TOOLS)).toBeNull();
    expect(resolveToolName('', TOOLS)).toBeNull();
    expect(resolveToolName('hoan_toan_khac', TOOLS)).toBeNull();
  });

  it('không đoán khi hai hàm cùng tiền tố dài bằng nhau (dễ chọn nhầm)', () => {
    // "get_customer_" là tiền tố chung của contact và profile → phải chịu thua, không đoán bừa.
    expect(resolveToolName('get_customer_xyz', TOOLS)).toBeNull();
  });

  it('chọn được khi một hàm có tiền tố chung dài hơn hẳn', () => {
    expect(resolveToolName('get_customer_contac', TOOLS)).toBe('get_customer_contact');
  });
});
