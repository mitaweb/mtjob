import { describe, it, expect } from 'vitest';
import { inRange, sumPointsForMember, aggregateByMember, rankMembers } from './scores.js';
import type { ScoreTask } from './scores.js';

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
