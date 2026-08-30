import { describe, it, expect } from 'vitest';
import { phanCongBlock } from './assign.js';

const nhanVien = { teamId: 'Ads', role: 'member', active: true };

describe('phanCongBlock', () => {
  it('nhân viên trong phòng, dự án có KPI của phòng → cho phép', () => {
    expect(phanCongBlock('Ads', nhanVien, true)).toBe('');
  });

  it('chặn người phòng khác', () => {
    expect(phanCongBlock('Ads', { ...nhanVien, teamId: 'SEO' }, true)).toContain('trong phòng của bạn');
  });

  it('chặn người đã nghỉ', () => {
    expect(phanCongBlock('Ads', { ...nhanVien, active: false }, true)).toContain('đã nghỉ việc');
  });

  it('chặn thêm leader/giám đốc vào danh sách thành viên — họ ăn thưởng đường riêng', () => {
    expect(phanCongBlock('Ads', { ...nhanVien, role: 'leader' }, true)).toContain('tính thưởng riêng');
    expect(phanCongBlock('Ads', { ...nhanVien, role: 'director' }, true)).toContain('tính thưởng riêng');
  });

  it('chặn phân công vào dự án không có chỉ số của phòng mình', () => {
    expect(phanCongBlock('Ads', nhanVien, false)).toContain('chưa có chỉ số nào của phòng bạn');
  });

  it('người bấm chưa thuộc phòng nào thì không phân công được', () => {
    expect(phanCongBlock('', nhanVien, true)).toContain('chưa thuộc phòng nào');
  });
});
