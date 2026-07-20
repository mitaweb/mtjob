// Shared domain types for MTJOB.

export type Role = 'member' | 'leader' | 'director' | 'admin' | 'accountant' | 'sale';
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
  username: string; // tên đăng nhập (vd luongha)
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

export type TaskStatus = 'todo' | 'doing' | 'done';

export interface TaskRow {
  id: string;
  createdAt: string;
  memberId: string;
  memberName: string;
  teamId: Team;
  taskCode: string;
  taskName: string;
  points: number;
  startedAt: string; // '' nếu ghi nhận trực tiếp (không qua bước bắt đầu)
  completedAt: string; // '' khi đang làm
  status: TaskStatus;
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
  dailyReportTime: string; // "17:15"
  monthlyReportDay: number;
  bonusThreshold: number;
  bonusStep: number;
  bonusAmount: number;
  bhxhMode: 'direct' | 'percent';
  tz: string;
  taskSheetUrl: string;
  geminiApiKey: string; // lưu trong config DB để admin dán key ngay trên UI
  geminiModel: string; // admin chọn model trong UI ('' = theo env/mặc định flash)
  aiProvider: 'gemini' | 'claude'; // nhà cung cấp cho hỏi-đáp dữ liệu (NLU luôn dùng Gemini)
  claudeApiKey: string;
  claudeModel: string; // '' = mặc định claude-sonnet-5
  claudeBaseUrl: string; // '' = endpoint mặc định của Anthropic
}

export const DEFAULT_CONFIG: AppConfig = {
  companyLat: 10.762622,
  companyLng: 106.660172,
  checkinRadiusM: 150,
  morningStart: '08:30',
  morningEnd: '12:00',
  afternoonStart: '13:30',
  afternoonEnd: '17:00',
  dailyReportTime: '17:15',
  monthlyReportDay: 1,
  bonusThreshold: 6000,
  bonusStep: 1000,
  bonusAmount: 800000,
  bhxhMode: 'percent', // 10.5% x mức đóng BHXH (cột BHXH trong sheet nhân sự)
  tz: 'Asia/Ho_Chi_Minh',
  taskSheetUrl: '',
  geminiApiKey: '',
  geminiModel: '',
  aiProvider: 'gemini',
  claudeApiKey: '',
  claudeModel: '',
  claudeBaseUrl: '',
};
