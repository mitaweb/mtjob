import { describe, it, expect } from 'vitest';
import {
  parsePosition,
  parseMoney,
  parseHrRow,
  birthdaysInMonth,
  removeAccents,
} from './people.js';

describe('removeAccents', () => {
  it('strips Vietnamese accents and d-stroke', () => {
    expect(removeAccents('Giám đốc')).toBe('Giam doc');
    expect(removeAccents('Trưởng nhóm')).toBe('Truong nhom');
  });
});

describe('parsePosition', () => {
  it('parses team + leader from the combined column', () => {
    expect(parsePosition('Ads Leader')).toEqual({ team: 'Ads', role: 'leader', isLeader: true });
    expect(parsePosition('Content Leader')).toEqual({ team: 'Content', role: 'leader', isLeader: true });
    expect(parsePosition('SEO Leader')).toEqual({ team: 'SEO', role: 'leader', isLeader: true });
  });
  it('parses plain members', () => {
    expect(parsePosition('Ads')).toEqual({ team: 'Ads', role: 'member', isLeader: false });
    expect(parsePosition('Content')).toEqual({ team: 'Content', role: 'member', isLeader: false });
  });
  it('parses the director (no team)', () => {
    expect(parsePosition('Giám đốc')).toEqual({ team: '', role: 'director', isLeader: false });
  });
});

describe('parseMoney', () => {
  it('parses digits from formatted strings and numbers', () => {
    expect(parseMoney('7500000')).toBe(7_500_000);
    expect(parseMoney('5.400.000')).toBe(5_400_000);
    expect(parseMoney(8_000_000)).toBe(8_000_000);
    expect(parseMoney('')).toBe(0);
    expect(parseMoney(null)).toBe(0);
  });
});

describe('parseHrRow', () => {
  it('maps the 6 fixed columns', () => {
    const row = ['Lương Thị Thu Hà', 'Ads Leader', '11500000', '5400000', '12/09/2022', '03/08/2000'];
    expect(parseHrRow(row)).toEqual({
      fullName: 'Lương Thị Thu Hà',
      position: 'Ads Leader',
      team: 'Ads',
      role: 'leader',
      isLeader: true,
      salary: 11_500_000,
      bhxh: 5_400_000,
      joinDate: '2022-09-12',
      dob: '2000-08-03',
    });
  });
  it('returns null for an empty name', () => {
    expect(parseHrRow(['', 'Ads', '1', '0', '', ''])).toBeNull();
  });
  it('parses the director row (blank salary, BHXH in col 4)', () => {
    const r = parseHrRow(['Hồ Minh Tâm', 'Giám đốc', '', '6000000', '01/01/2021', '08/01/1999']);
    expect(r).toMatchObject({ role: 'director', team: '', salary: 0, bhxh: 6_000_000, dob: '1999-01-08' });
  });
});

describe('birthdaysInMonth', () => {
  it('selects people whose DOB month matches', () => {
    const people = [
      { fullName: 'A', dob: '2003-02-03' },
      { fullName: 'B', dob: '2004-06-14' },
      { fullName: 'C', dob: '1999-01-08' },
      { fullName: 'D', dob: null },
    ];
    expect(birthdaysInMonth(people, 6).map((p) => p.fullName)).toEqual(['B']);
    expect(birthdaysInMonth(people, 1).map((p) => p.fullName)).toEqual(['C']);
  });
});
