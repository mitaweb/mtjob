import { describe, it, expect } from 'vitest';
import { maThuocTeam, locCatalogTheoTeam, chanMaKhacTeam } from './catalog.repo.js';

// Anh Tâm 18/9/2026: "em setup để lọc theo team".
describe('maThuocTeam', () => {
  it('việc của team mình thì dùng được', () => {
    expect(maThuocTeam('CON04', 'Content')).toBe(true);
    expect(maThuocTeam('ADS17', 'Ads')).toBe(true);
    expect(maThuocTeam('seo23', 'SEO')).toBe(true); // không phân biệt hoa thường
  });

  it('việc mang tiền tố team KHÁC thì không — đúng ca Content ghi ADS17 "Edit video"', () => {
    expect(maThuocTeam('ADS17', 'Content')).toBe(false);
    expect(maThuocTeam('CON05', 'Ads')).toBe(false);
    expect(maThuocTeam('SEO23', 'Content')).toBe(false);
  });

  it('mã không thuộc team nào thì ai cũng dùng được', () => {
    expect(maThuocTeam('BOSUNG', 'Content')).toBe(true);
    expect(maThuocTeam('TSK01', 'Ads')).toBe(true);
  });

  it('người không có team (giám đốc, sale, kế toán) không bị lọc', () => {
    expect(maThuocTeam('ADS17', '')).toBe(true);
    expect(maThuocTeam('CON04', 'Khác')).toBe(true);
  });
});

describe('locCatalogTheoTeam', () => {
  const ds = [{ code: 'ADS17' }, { code: 'CON04' }, { code: 'CON05' }, { code: 'SEO23' }, { code: 'BOSUNG' }];

  it('team Content chỉ còn việc CON + mã dùng chung, giữ nguyên thứ tự', () => {
    expect(locCatalogTheoTeam(ds, 'Content').map((x) => x.code)).toEqual(['CON04', 'CON05', 'BOSUNG']);
  });

  it('không có team thì thấy hết', () => {
    expect(locCatalogTheoTeam(ds, '')).toHaveLength(5);
  });

  it('không sửa mảng gốc', () => {
    locCatalogTheoTeam(ds, 'Ads');
    expect(ds).toHaveLength(5);
  });
});

describe('chanMaKhacTeam', () => {
  it('mã team khác → có câu từ chối nêu tên việc và team', () => {
    const s = chanMaKhacTeam('ADS17', 'Edit video', 'Content');
    expect(s).toContain('Edit video');
    expect(s).toContain('Content');
  });

  it('mã team mình hoặc mã chung → rỗng', () => {
    expect(chanMaKhacTeam('CON04', 'Video đăng facebook', 'Content')).toBe('');
    expect(chanMaKhacTeam('BOSUNG', 'Bù điểm', 'Content')).toBe('');
  });
});
