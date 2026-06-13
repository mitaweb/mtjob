export type Role = 'member' | 'leader' | 'director' | 'admin' | 'accountant';

export interface Party {
  id: string;
  name: string;
  startDate: string;
  dueDay: number;
  receivable: number;
  notifyMemberIds: string[];
  note: string;
  active: boolean;
  nextDue?: string;
}

export interface FinanceEntry {
  id: string;
  month: string;
  kind: 'thu' | 'chi';
  name: string;
  amount: number;
  date: string;
  recurring: boolean;
  partyId: string;
}

export interface User {
  id: string;
  fullName: string;
  username: string;
  role: Role;
  teamId: string;
  position: string;
  dob: string | null;
}

export interface MemberScore {
  memberId: string;
  fullName: string;
  teamId: string;
  todayPoints: number;
  monthPoints: number;
  bonus: number;
  workMinutesToday: number;
  rank?: number;
}

export interface DoingTask {
  id: string;
  taskCode: string;
  taskName: string;
  points: number;
  startedAt: string;
  elapsedMinutes: number;
}

export interface PayrollLine {
  memberId: string;
  fullName: string;
  teamId: string;
  standardDays: number;
  actualDays: number;
  grossSalary: number;
  bhxh: number;
  netSalary: number;
}

export interface CatalogItem {
  code: string;
  name: string;
  points: number;
}

export interface NotificationItem {
  id: string;
  type: string;
  title: string;
  body: string;
  createdAt: string;
  readAt: string;
}
