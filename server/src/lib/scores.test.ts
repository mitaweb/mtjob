import { describe, it, expect } from 'vitest';
import {
  inRange,
  sumPointsForMember,
  aggregateByMember,
  rankMembers,
  summarizePointChanges,
  moTaDoiNghia,
} from './scores.js';
import type { ScoreTask, PointChange, MaDoiNghia } from './scores.js';

describe('summarizePointChanges', () => {
  // Ca thật: anh Tâm hạ "Báo cáo Ads" từ 35đ xuống 10đ.
  const ch = (memberName: string, taskName: string, cu: number, moi: number): PointChange => ({
    memberName,
    taskName,
    cu,
    moi,
  });

  it('gom theo người, chênh lệch âm khi hạ điểm', () => {
    const r = summarizePointChanges([
      ch('Anh Tú', 'Báo cáo Ads', 35, 10),
      ch('Anh Tú', 'Báo cáo Ads', 35, 10),
      ch('Thảo Nhiên', 'Báo cáo Ads', 35, 10),
    ]);
    expect(r.updated).toBe(3);
    expect(r.byMember).toEqual([
      { memberName: 'Anh Tú', tasks: 2, delta: -50 },
      { memberName: 'Thảo Nhiên', tasks: 1, delta: -25 },
    ]);
  });

  it('người bị ảnh hưởng nặng nhất lên đầu, kể cả khi là tăng điểm', () => {
    const r = summarizePointChanges([
      ch('Ít', 'Lên Ads', 20, 25),
      ...Array.from({ length: 5 }, () => ch('Nhiều', 'Lên Ads', 20, 40)),
    ]);
    expect(r.byMember[0]).toEqual({ memberName: 'Nhiều', tasks: 5, delta: 100 });
  });

  it('tách riêng khi cùng loại việc đổi từ nhiều mức cũ khác nhau', () => {
    const r = summarizePointChanges([
      ch('A', 'Báo cáo Ads', 35, 10),
      ch('A', 'Báo cáo Ads', 20, 10),
    ]);
    expect(r.byTask).toEqual([
      { taskName: 'Báo cáo Ads', cu: 35, moi: 10, tasks: 1 },
      { taskName: 'Báo cáo Ads', cu: 20, moi: 10, tasks: 1 },
    ]);
  });

  it('không có gì đổi thì báo cáo rỗng', () => {
    expect(summarizePointChanges([])).toEqual({ updated: 0, byMember: [], byTask: [] });
  });
});

const tasks: ScoreTask[] = [
  { memberId: 'm1', points: 100, completedAt: '2026-06-01T09:00:00' },
  { memberId: 'm1', points: 50, completedAt: '2026-06-15T10:00:00' },
  { memberId: 'm2', points: 200, completedAt: '2026-06-10T10:00:00' },
  { memberId: 'm1', points: 999, completedAt: '2026-05-31T10:00:00' }, // out of range
  { memberId: 'm3', points: 200, createdAt: '2026-06-20T10:00:00' }, // falls back to createdAt
];

describe('inRange', () => {
  it('is inclusive on both ends', () => {
    expect(inRange('2026-06-01T00:00:00', '2026-06-01', '2026-06-30')).toBe(true);
    expect(inRange('2026-06-30T23:59:59', '2026-06-01', '2026-06-30')).toBe(true);
    expect(inRange('2026-07-01T00:00:00', '2026-06-01', '2026-06-30')).toBe(false);
    expect(inRange(undefined, '2026-06-01', '2026-06-30')).toBe(false);
  });
});

describe('sumPointsForMember', () => {
  it('sums only in-range tasks for the member', () => {
    expect(sumPointsForMember(tasks, 'm1', '2026-06-01', '2026-06-30')).toBe(150);
    expect(sumPointsForMember(tasks, 'm2', '2026-06-01', '2026-06-30')).toBe(200);
  });
});

describe('aggregateByMember', () => {
  it('groups points by member within range', () => {
    const m = aggregateByMember(tasks, '2026-06-01', '2026-06-30');
    expect(m.get('m1')).toBe(150);
    expect(m.get('m2')).toBe(200);
    expect(m.get('m3')).toBe(200);
  });
});

describe('rankMembers', () => {
  it('ranks by points desc with shared ranks on ties', () => {
    const ranked = rankMembers(new Map([
      ['m1', 150],
      ['m2', 200],
      ['m3', 200],
      ['m4', 50],
    ]));
    expect(ranked[0]).toMatchObject({ points: 200, rank: 1 });
    expect(ranked[1]).toMatchObject({ points: 200, rank: 1 });
    expect(ranked[2]).toMatchObject({ memberId: 'm1', points: 150, rank: 3 });
    expect(ranked[3]).toMatchObject({ memberId: 'm4', points: 50, rank: 4 });
  });
});

describe('moTaDoiNghia', () => {
  const md = (code: string, tenCu: string, tenMoi: string, soViec: number): MaDoiNghia => ({
    code,
    tenCu,
    tenMoi,
    soViec,
    diemCu: 10,
    diemMoi: 25,
  });

  it('không có mã nào đổi nghĩa thì không cảnh báo', () => {
    expect(moTaDoiNghia([])).toBe('');
  });

  it('nói rõ bao nhiêu mã, bao nhiêu việc, và đã giữ nguyên điểm', () => {
    // Ca thật: chèn một dòng giữa tab Ads làm ADS05 tụt xuống thành việc khác.
    const s = moTaDoiNghia([md('ADS05', 'Lên ads', 'Viết bài', 12), md('ADS06', 'Tối ưu ads', 'Lên ads', 3)]);
    expect(s).toContain('2 mã việc');
    expect(s).toContain('15 việc');
    expect(s).toContain('GIỮ NGUYÊN');
  });
});
