// Single source of truth for the Google-Sheets "database": tab names + headers.
// Used by the repository layer and by scripts/setup-sheet.ts.

export const TABS = {
  Members: [
    'MemberID', 'FullName', 'DOB', 'Position', 'TeamID', 'Role',
    'Salary', 'BHXH', 'JoinDate', 'Email', 'PasswordHash', 'Active',
  ],
  Teams: ['TeamID', 'TeamName', 'LeaderMemberID'],
  TaskCatalog: ['TaskCode', 'TaskName', 'Points', 'Active', 'Note'],
  Tasks: [
    'TaskID', 'CreatedAt', 'MemberID', 'MemberName', 'TeamID',
    'TaskCode', 'TaskName', 'Points', 'CompletedAt', 'Source', 'Note',
  ],
  Attendance: [
    'Date', 'MemberID', 'Name', 'MorningInAt', 'MorningOutAt',
    'AfternoonInAt', 'AfternoonOutAt', 'Lat', 'Lng', 'DistM',
    'DayFraction', 'Mode', 'Status', 'Note',
  ],
  OnlineRequests: [
    'ReqID', 'MemberID', 'Name', 'Dates', 'Scope', 'Reason',
    'LeaderStatus', 'LeaderBy', 'LeaderAt',
    'DirectorStatus', 'DirectorBy', 'DirectorAt', 'FinalStatus', 'CreatedAt',
  ],
  LeaveRequests: [
    'ReqID', 'MemberID', 'Name', 'Dates', 'Type', 'Reason',
    'LeaderStatus', 'LeaderBy', 'LeaderAt',
    'DirectorStatus', 'DirectorBy', 'DirectorAt', 'FinalStatus', 'CreatedAt',
  ],
  Holidays: ['Date', 'Name', 'Year'],
  Config: ['Key', 'Value'],
  PushSubscriptions: ['SubID', 'MemberID', 'Endpoint', 'P256dh', 'Auth', 'UA', 'CreatedAt'],
  Notifications: ['NotifID', 'MemberID', 'Type', 'Title', 'Body', 'CreatedAt', 'ReadAt'],
  MonthlyScores: ['Year', 'Month', 'MemberID', 'TotalPoints', 'Rank', 'BonusVND'],
  Payroll: ['Year', 'Month', 'MemberID', 'StandardDays', 'ActualDays', 'GrossSalary', 'BHXH', 'NetSalary'],
} as const;

export type TabName = keyof typeof TABS;

/** Seed rows for the Config tab (Key/Value). */
export const CONFIG_SEED: Array<[string, string]> = [
  ['companyLat', '10.762622'],
  ['companyLng', '106.660172'],
  ['checkinRadiusM', '150'],
  ['morningStart', '08:30'],
  ['morningEnd', '12:00'],
  ['afternoonStart', '13:30'],
  ['afternoonEnd', '17:00'],
  ['dailyReportTime', '18:00'],
  ['monthlyReportDay', '1'],
  ['bonusThreshold', '6000'],
  ['bonusStep', '1000'],
  ['bonusAmount', '800000'],
  ['bhxhMode', 'direct'],
  ['tz', 'Asia/Ho_Chi_Minh'],
];

/** A small example task catalog so the bot has something to map to on day one. */
export const TASK_CATALOG_SEED: Array<[string, string, number]> = [
  ['POST', 'Viết & đăng 1 bài post', 100],
  ['DESIGN', 'Thiết kế 1 ấn phẩm', 150],
  ['VIDEO', 'Dựng 1 video ngắn', 250],
  ['ADS_SETUP', 'Set up 1 chiến dịch quảng cáo', 200],
  ['REPORT', 'Báo cáo hiệu quả cho khách', 120],
  ['MEETING', 'Họp với khách hàng', 80],
  ['SEO_ARTICLE', 'Viết 1 bài chuẩn SEO', 150],
];

/** Vietnam public holidays 2026 — fixed-date part only (lunar Tết must be added by admin). */
export const HOLIDAYS_2026_SEED: Array<[string, string]> = [
  ['2026-01-01', 'Tết Dương lịch'],
  ['2026-04-30', 'Ngày Giải phóng miền Nam'],
  ['2026-05-01', 'Quốc tế Lao động'],
  ['2026-09-02', 'Quốc khánh'],
  // Lunar holidays (Tết Nguyên đán, Giỗ Tổ Hùng Vương) — admin nhập theo lịch âm.
];
