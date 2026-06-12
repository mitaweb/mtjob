// Shared domain types for MTJOB.

export type Role = 'member' | 'leader' | 'director' | 'admin';
export type Team = 'Ads' | 'SEO' | 'Content' | '';
export type AttendanceMode = 'office' | 'online' | 'leave' | 'holiday';
export type RequestStatus = 'pending' | 'approved' | 'rejected';
export type RequestScope = 'half_am' | 'half_pm' | 'full';

export interface Member {
  id: string;
  fullName: string;
  dob: string | null; // YYYY-MM-DD
  position: string;
  teamId: Team;
  role: Role;
  salary: number;
  bhxh: number;
  joinDate: string | null; // YYYY-MM-DD
  email: string;
  passwordHash: string;
  active: boolean;
}

export interface Team_ {
  id: string;
  name: string;
  leaderMemberId: string;
}

export interface TaskCatalogItem {
  code: string;
  name: string;
  points: number;
  active: boolean;
  note?: string;
}

export interface TaskRow {
  id: string;
  createdAt: string;
  memberId: string;
  memberName: string;
  teamId: Team;
  taskCode: string;
  taskName: string;
  points: number;
  completedAt: string;
  source: string;
  note?: string;
}

export interface AttendanceRow {
  date: string; // YYYY-MM-DD
  memberId: string;
  name: string;
  morningInAt?: string;
  morningOutAt?: string;
  afternoonInAt?: string;
  afternoonOutAt?: string;
  lat?: number;
  lng?: number;
  distM?: number;
  dayFraction: number;
  mode: AttendanceMode;
  status: string;
  note?: string;
}

export interface AppConfig {
  companyLat: number;
  companyLng: number;
  checkinRadiusM: number;
  morningStart: string; // "08:30"
  morningEnd: string;
  afternoonStart: string;
  afternoonEnd: string;
  dailyReportTime: string; // "18:00"
  monthlyReportDay: number;
  bonusThreshold: number;
  bonusStep: number;
  bonusAmount: number;
  bhxhMode: 'direct' | 'percent';
  tz: string;
  taskSheetUrl: string;
}

export const DEFAULT_CONFIG: AppConfig = {
  companyLat: 10.762622,
  companyLng: 106.660172,
  checkinRadiusM: 150,
  morningStart: '08:30',
  morningEnd: '12:00',
  afternoonStart: '13:30',
  afternoonEnd: '17:00',
  dailyReportTime: '18:00',
  monthlyReportDay: 1,
  bonusThreshold: 6000,
  bonusStep: 1000,
  bonusAmount: 800000,
  bhxhMode: 'percent', // 10.5% x mức đóng BHXH (cột BHXH trong sheet nhân sự)
  tz: 'Asia/Ho_Chi_Minh',
  taskSheetUrl: '',
};
