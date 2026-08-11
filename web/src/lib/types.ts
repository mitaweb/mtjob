export type Role = 'member' | 'leader' | 'director' | 'admin' | 'accountant' | 'sale';

export interface Customer {
  id: string;
  name: string;
  phone: string;
  status: string;
  note: string;
  info: string;
  assignedTo: string;
  dob: string; // ngày sinh khách — để chuẩn bị quà/lời chúc
  closedAt: string; // ngày chốt hợp đồng — mốc tính tái tục
  source: string; // nguồn khách — chọn từ danh sách cố định
  createdAt: string;
}

export interface Appointment {
  id: string;
  customerId: string;
  customerName: string;
  at: string;
  note: string;
  ownerId: string;
  done: boolean;
}

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
  /** Tiền các kỳ TRƯỚC còn thiếu (đã trừ phần đã thu một phần). */
  carryOver?: number;
  /** Nợ cũ + kỳ này − đã thu kỳ này. */
  totalDue?: number;
  /** Các kỳ cũ còn thiếu, dạng YYYY-MM. */
  unpaidMonths?: string[];
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
  taskName: string; // loại việc trong danh mục
  title?: string; // loại việc + ghi chú (tên khách) — máy chủ ghép sẵn, ưu tiên hiển thị
  note?: string;
  points: number;
  startedAt: string;
  elapsedMinutes: number;
}

export interface TodoTask {
  id: string;
  taskCode: string;
  taskName: string;
  points: number;
  createdAt: string;
  assignedBy: string;
}

export interface Assignee {
  id: string;
  fullName: string;
  username: string;
  teamId: string;
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
