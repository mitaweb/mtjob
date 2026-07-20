import { describe, it, expect } from 'vitest';
import { parseSheetUrl, sheetCsvUrl, rowsToLabeledText } from './table.js';

describe('parseSheetUrl', () => {
  it('lấy được id và gid từ link thường', () => {
    expect(
      parseSheetUrl('https://docs.google.com/spreadsheets/d/1XuHb05EIngHjjAYTKiBcmzj3abF8lgyfxiSTWTdhYPw/edit?gid=0#gid=0'),
    ).toEqual({ id: '1XuHb05EIngHjjAYTKiBcmzj3abF8lgyfxiSTWTdhYPw', gid: '0' });
  });

  it('lấy đúng gid của tab khác', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/ABC123/edit#gid=987654')).toEqual({
      id: 'ABC123',
      gid: '987654',
    });
  });

  it('không có gid thì mặc định 0', () => {
    expect(parseSheetUrl('https://docs.google.com/spreadsheets/d/ABC123/edit')).toEqual({ id: 'ABC123', gid: '0' });
  });

  it('trả null với link không phải Sheets', () => {
    expect(parseSheetUrl('https://example.com/a.csv')).toBeNull();
    expect(parseSheetUrl('')).toBeNull();
  });
});

describe('sheetCsvUrl', () => {
  it('dựng đúng link tải CSV', () => {
    expect(sheetCsvUrl('ABC', '5')).toBe('https://docs.google.com/spreadsheets/d/ABC/export?format=csv&gid=5');
  });
});

describe('rowsToLabeledText', () => {
  it('mỗi hàng thành một dòng tự chứa kèm tên cột', () => {
    const out = rowsToLabeledText([
      ['Ngày', 'Chủ đề', 'Định dạng'],
      ['21/7', 'Chăm sóc da mùa hè', 'Reels'],
      ['22/7', 'Review khách', 'Ảnh đơn'],
    ]);
    expect(out).toContain('Các cột: Ngày, Chủ đề, Định dạng');
    expect(out).toContain('Ngày: 21/7 · Chủ đề: Chăm sóc da mùa hè · Định dạng: Reels');
    expect(out).toContain('Ngày: 22/7 · Chủ đề: Review khách · Định dạng: Ảnh đơn');
  });

  it('bỏ ô rỗng để dòng không loãng', () => {
    const out = rowsToLabeledText([
      ['Ngày', 'Chủ đề', 'Ghi chú'],
      ['21/7', 'Bài A', ''],
    ]);
    expect(out).toContain('Ngày: 21/7 · Chủ đề: Bài A');
    expect(out).not.toContain('Ghi chú:');
  });

  it('bỏ hàng trống hoàn toàn', () => {
    const out = rowsToLabeledText([
      ['Ngày', 'Chủ đề'],
      ['', ''],
      ['21/7', 'Bài A'],
    ]);
    expect(out.split('\n').filter((l) => l.startsWith('Ngày:'))).toHaveLength(1);
  });

  it('bảng chỉ có một hàng thì giữ nguyên dữ liệu, không coi là tiêu đề', () => {
    const out = rowsToLabeledText([
      ['', ''],
      ['giá trị A', 'giá trị B'],
    ]);
    expect(out).toContain('giá trị A · giá trị B');
  });

  it('tiêu đề chỉ có 1 cột có chữ thì nối thô, không mất dữ liệu', () => {
    const out = rowsToLabeledText([
      ['Ngày', ''],
      ['21/7', 'Bài A'],
    ]);
    expect(out).toContain('21/7 · Bài A');
  });

  it('bảng rỗng trả chuỗi rỗng', () => {
    expect(rowsToLabeledText([])).toBe('');
    expect(rowsToLabeledText([['', '']])).toBe('');
  });

  it('cắt bớt khi bảng quá dài và báo còn bao nhiêu hàng', () => {
    const rows = [['Ngày', 'Chủ đề'], ...Array.from({ length: 10 }, (_, i) => [`${i}/7`, `Bài ${i}`])];
    const out = rowsToLabeledText(rows, 3);
    expect(out).toContain('… và 7 hàng nữa.');
  });
});
