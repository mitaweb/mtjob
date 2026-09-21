import { describe, it, expect } from 'vitest';
import { gopThuong, tongThuong, type DongThuongDiem, type DongThuongKpi } from './thuong.js';

const diem = (memberId: string, fullName: string, amount: number, heSo = 1, points = 0): DongThuongDiem => ({
  memberId,
  fullName,
  teamId: 'Ads',
  points,
  bonusGoc: heSo < 1 ? Math.round(amount / heSo) : amount,
  heSo,
  amount,
});

const kpi = (memberId: string, fullName: string, projectId: string, amount: number, tyLe: number | null = 90): DongThuongKpi => ({
  memberId,
  fullName,
  teamId: 'Ads',
  projectId,
  projectName: projectId,
  vaiTro: 'leader',
  tyLe,
  soDat: 9,
  soChiSo: 10,
  mucThuong: 1_000_000,
  amount,
});

describe('gopThuong', () => {
  it('gộp thưởng điểm và thưởng KPI của cùng một người thành một dòng', () => {
    const r = gopThuong([diem('A', 'An', 400_000)], [kpi('A', 'An', 'Savax', 500_000)]);
    expect(r).toHaveLength(1);
    expect(r[0]).toMatchObject({ memberId: 'A', thuongDiem: 400_000, thuongKpi: 500_000, tong: 900_000 });
  });

  it('một người ăn thưởng nhiều dự án thì cộng dồn, giữ từng dự án để giải thích', () => {
    const r = gopThuong([], [kpi('A', 'An', 'Savax', 500_000), kpi('A', 'An', 'Luxury', 300_000)]);
    expect(r[0].thuongKpi).toBe(800_000);
    expect(r[0].duAn.map((d) => d.projectId)).toEqual(['Savax', 'Luxury']);
  });

  it('người không có đồng thưởng nào thì bỏ khỏi bảng', () => {
    const r = gopThuong([diem('A', 'An', 400_000), diem('B', 'Bình', 0)], []);
    expect(r.map((x) => x.memberId)).toEqual(['A']);
  });

  it('GIỮ người có dự án mà 0đ — để bảng nói được vì sao họ không có tiền', () => {
    const r = gopThuong([diem('B', 'Bình', 0)], [kpi('B', 'Bình', 'Savax', 0, 40)]);
    expect(r).toHaveLength(1);
    expect(r[0].tong).toBe(0);
  });

  it('mang theo lý do của hệ số thưởng điểm', () => {
    const r = gopThuong([{ ...diem('B', 'Bình', 200_000, 0.5), lyDo: '2/4 dự án đạt' }], []);
    expect(r[0]).toMatchObject({ heSo: 0.5, lyDoHeSo: '2/4 dự án đạt' });
  });

  it('GIỮ người bị cắt nửa thưởng điểm dù còn 0đ', () => {
    const r = gopThuong([{ ...diem('B', 'Bình', 0), heSo: 0.5 }], []);
    expect(r).toHaveLength(1);
  });

  it('xếp tổng cao → thấp, bằng tiền thì theo tên tiếng Việt', () => {
    const r = gopThuong(
      [diem('V', 'Võ Thị Oanh', 500_000), diem('D', 'Đặng Hà', 500_000), diem('L', 'Lê Thuyên', 900_000)],
      [],
    );
    expect(r.map((x) => x.fullName)).toEqual(['Lê Thuyên', 'Đặng Hà', 'Võ Thị Oanh']);
  });

  it('người đã nghỉ thiếu tên ở một nguồn thì lấy tên từ nguồn kia', () => {
    const r = gopThuong([{ ...diem('A', '', 400_000), teamId: '' }], [kpi('A', 'An', 'Savax', 100_000)]);
    expect(r[0]).toMatchObject({ fullName: 'An', teamId: 'Ads' });
  });
});

describe('tongThuong', () => {
  it('bằng đúng tổng các dòng — là số ghi vào chi phí', () => {
    const r = gopThuong(
      [diem('A', 'An', 400_000), diem('B', 'Bình', 250_000, 0.5)],
      [kpi('A', 'An', 'Savax', 500_000), kpi('C', 'Chi', 'Luxury', 850_000)],
    );
    expect(tongThuong(r)).toBe(400_000 + 250_000 + 500_000 + 850_000);
  });

  it('bảng rỗng là 0', () => {
    expect(tongThuong([])).toBe(0);
  });
});
