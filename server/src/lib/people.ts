// HR-source parsing: position -> team/role/leader, money & dates. Pure & unit-tested.
import { parseVnDate } from './datetime.js';
import type { Role, Team } from '../types.js';

export interface ParsedPosition {
  team: Team;
  role: Role;
  isLeader: boolean;
}

/** Strip Vietnamese accents and normalise d-stroke for keyword matching. */
export function removeAccents(s: string): string {
  return s
    .normalize('NFD')
    .replace(/\p{Diacritic}/gu, '')
    .replace(/đ/g, 'd') // đ
    .replace(/Đ/g, 'D'); // Đ
}

/**
 * Parse the combined "Chức vụ" column (e.g. "Ads Leader", "Giám đốc", "SEO").
 * Derives team (Ads/SEO/Content), role, and whether the person leads a team.
 */
export function parsePosition(positionRaw: string): ParsedPosition {
  const raw = (positionRaw || '').trim();
  const noAccent = removeAccents(raw).toLowerCase();

  let role: Role = 'member';
  if (noAccent.includes('giam doc')) role = 'director';

  const leaderKeyword = noAccent.includes('leader') || noAccent.includes('truong');
  if (role !== 'director' && leaderKeyword) role = 'leader';

  let team: Team = '';
  if (/\bads\b/.test(noAccent)) team = 'Ads';
  else if (/\bseo\b/.test(noAccent)) team = 'SEO';
  else if (/content/.test(noAccent)) team = 'Content';

  return { team, role, isLeader: role === 'leader' };
}

/** Parse a money cell ("5.400.000", "7500000", 8000000, "") into a number. */
export function parseMoney(s: unknown): number {
  if (typeof s === 'number') return Number.isFinite(s) ? s : 0;
  const digits = String(s ?? '').replace(/[^\d]/g, '');
  return digits ? Number(digits) : 0;
}

export interface HrPerson {
  fullName: string;
  position: string;
  team: Team;
  role: Role;
  isLeader: boolean;
  salary: number;
  bhxh: number;
  joinDate: string | null;
  dob: string | null;
}

/**
 * Parse one row of the HR source sheet. Fixed 6 columns, no header:
 *   [0] Ho ten  [1] Chuc vu  [2] Muc luong  [3] BHXH  [4] Ngay vao lam  [5] Nam sinh (DOB)
 */
export function parseHrRow(row: Array<string | number | null | undefined>): HrPerson | null {
  const fullName = String(row[0] ?? '').trim();
  if (!fullName) return null;
  const position = String(row[1] ?? '').trim();
  const p = parsePosition(position);
  return {
    fullName,
    position,
    team: p.team,
    role: p.role,
    isLeader: p.isLeader,
    salary: parseMoney(row[2]),
    bhxh: parseMoney(row[3]),
    joinDate: parseVnDate(row[4] as string),
    dob: parseVnDate(row[5] as string),
  };
}

/**
 * Username từ họ tên: từ ĐẦU + từ CUỐI, bỏ dấu, viết liền thường.
 * "Lương Thị Thu Hà" → "luongha"; "Hồ Minh Tâm" → "hotam"; "Thu Thanh" → "thuthanh".
 */
export function vnUsername(fullName: string): string {
  const words = removeAccents(fullName)
    .toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
  if (words.length === 0) return 'user';
  if (words.length === 1) return words[0]!;
  return words[0]! + words[words.length - 1]!;
}

export interface BirthdayPerson {
  fullName: string;
  dob: string | null;
}

/** People whose birthday falls in the given month (1-12). */
export function birthdaysInMonth<T extends BirthdayPerson>(people: T[], month: number): T[] {
  return people.filter((p) => p.dob && Number(p.dob.slice(5, 7)) === month);
}
