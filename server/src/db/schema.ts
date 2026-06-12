// Single source of truth for the Postgres schema + seed data.
// Dates/timestamps are stored as ISO text — the app compares them lexicographically.

export const DDL = `
CREATE TABLE IF NOT EXISTS members (
  member_id     text PRIMARY KEY,
  full_name     text NOT NULL,
  dob           text DEFAULT '',
  position      text DEFAULT '',
  team_id       text DEFAULT '',
  role          text DEFAULT 'member',
  salary        integer DEFAULT 0,
  bhxh          integer DEFAULT 0,
  join_date     text DEFAULT '',
  email         text DEFAULT '',
  password_hash text DEFAULT '',
  active        boolean DEFAULT true
);

CREATE TABLE IF NOT EXISTS teams (
  team_id          text PRIMARY KEY,
  team_name        text NOT NULL,
  leader_member_id text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS task_catalog (
  task_code text PRIMARY KEY,
  task_name text NOT NULL,
  points    integer NOT NULL DEFAULT 0,
  active    boolean DEFAULT true,
  note      text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS tasks (
  task_id      text PRIMARY KEY,
  created_at   text NOT NULL,
  member_id    text NOT NULL,
  member_name  text DEFAULT '',
  team_id      text DEFAULT '',
  task_code    text NOT NULL,
  task_name    text DEFAULT '',
  points       integer NOT NULL DEFAULT 0,
  completed_at text NOT NULL,
  source       text DEFAULT 'app',
  note         text DEFAULT ''
);
CREATE INDEX IF NOT EXISTS tasks_member_idx ON tasks (member_id);

CREATE TABLE IF NOT EXISTS attendance (
  date             text NOT NULL,
  member_id        text NOT NULL,
  name             text DEFAULT '',
  morning_in_at    text DEFAULT '',
  morning_out_at   text DEFAULT '',
  afternoon_in_at  text DEFAULT '',
  afternoon_out_at text DEFAULT '',
  lat              double precision,
  lng              double precision,
  dist_m           integer,
  day_fraction     real NOT NULL DEFAULT 0,
  mode             text DEFAULT 'office',
  status           text DEFAULT '',
  note             text DEFAULT '',
  PRIMARY KEY (date, member_id)
);

CREATE TABLE IF NOT EXISTS requests (
  req_id          text PRIMARY KEY,
  kind            text NOT NULL,
  member_id       text NOT NULL,
  name            text DEFAULT '',
  dates           text DEFAULT '',
  scope           text DEFAULT '',
  type            text DEFAULT '',
  reason          text DEFAULT '',
  leader_status   text DEFAULT 'pending',
  leader_by       text DEFAULT '',
  leader_at       text DEFAULT '',
  director_status text DEFAULT 'pending',
  director_by     text DEFAULT '',
  director_at     text DEFAULT '',
  final_status    text DEFAULT 'pending',
  created_at      text NOT NULL
);

CREATE TABLE IF NOT EXISTS holidays (
  date text PRIMARY KEY,
  name text NOT NULL,
  year integer
);

CREATE TABLE IF NOT EXISTS config (
  key   text PRIMARY KEY,
  value text NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS push_subscriptions (
  endpoint   text PRIMARY KEY,
  sub_id     text DEFAULT '',
  member_id  text NOT NULL,
  p256dh     text NOT NULL,
  auth       text NOT NULL,
  ua         text DEFAULT '',
  created_at text DEFAULT ''
);

CREATE TABLE IF NOT EXISTS notifications (
  notif_id   text PRIMARY KEY,
  member_id  text NOT NULL,
  type       text DEFAULT '',
  title      text NOT NULL,
  body       text DEFAULT '',
  created_at text NOT NULL,
  read_at    text DEFAULT ''
);
CREATE INDEX IF NOT EXISTS notifications_member_idx ON notifications (member_id, created_at DESC);

CREATE TABLE IF NOT EXISTS monthly_scores (
  year         integer NOT NULL,
  month        integer NOT NULL,
  member_id    text NOT NULL,
  total_points integer DEFAULT 0,
  rank         integer DEFAULT 0,
  bonus_vnd    integer DEFAULT 0,
  PRIMARY KEY (year, month, member_id)
);

CREATE TABLE IF NOT EXISTS payroll (
  year          integer NOT NULL,
  month         integer NOT NULL,
  member_id     text NOT NULL,
  standard_days real DEFAULT 0,
  actual_days   real DEFAULT 0,
  gross_salary  integer DEFAULT 0,
  bhxh          integer DEFAULT 0,
  net_salary    integer DEFAULT 0,
  PRIMARY KEY (year, month, member_id)
);
`;

/** Seed rows for the config table (key/value). */
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
  ['taskSheetUrl', 'https://docs.google.com/spreadsheets/d/1C0-uJxZwzaBWWDqSbwPhJI0YJEPBxbOwTOBflATMcJc/edit?gid=0#gid=0'],
];

/**
 * Task catalog snapshot from the points sheet (read 2026-06-12).
 * Points = the EXPERT-minutes column. [code, name, points, note]
 * Codes are PREFIX + STT so the sync keeps them stable per tab.
 */
export const TASK_CATALOG_SEED: Array<[string, string, number, string]> = [
  // ── Tab ADS ──
  ['ADS01', 'Backup tài khoản', 20, ''],
  ['ADS02', 'Lên Ads', 20, ''],
  ['ADS03', 'Chuẩn bị nội dung quảng cáo', 25, ''],
  ['ADS04', 'Xây dựng chân dung KH', 60, ''],
  ['ADS05', 'Xác minh/kháng TKQC', 20, ''],
  ['ADS06', 'Cài đặt chuyển đổi', 25, ''],
  ['ADS07', 'Sửa website nhỏ', 30, ''],
  ['ADS08', 'Ladipage', 480, ''],
  ['ADS09', 'Sửa toàn bộ Web', 360, ''],
  ['ADS10', 'Chuẩn bị Page', 20, ''],
  ['ADS11', 'Đăng bài page', 15, ''],
  ['ADS12', 'Đăng bài website', 25, ''],
  ['ADS13', 'Báo cáo Ads', 35, ''],
  ['ADS14', 'Tối ưu Quảng Cáo', 35, ''],
  ['ADS15', 'Nuôi nick', 5, ''],
  ['ADS16', 'Tạo tài khoản(FB/GG/Tiktok)', 15, ''],
  ['ADS17', 'Seeding', 20, ''],
  ['ADS18', 'Spam Inbox', 25, ''],
  ['ADS19', 'Edit video', 145, ''],
  ['ADS20', 'Đề xuất quảng cáo', 30, ''],
  // ── Tab Thiết kế / Content ──
  ['CON01', 'Thiết kế post 1 ảnh', 20, ''],
  ['CON02', 'Thiết kế post nhiều ảnh', 50, ''],
  ['CON03', 'Thiết kế ấn phẩm', 70, ''],
  ['CON04', 'Video đăng facebook', 50, ''],
  ['CON05', 'Video quảng cáo', 135, ''],
  ['CON06', 'Content cho page', 10, ''],
  ['CON07', 'Plan 30 content cho page/tiktok/insta', 50, ''],
  ['CON08', 'Bài đăng SEO Youtube', 20, ''],
  ['CON09', 'Thiết kế Profile (dưới 20 trang)', 390, ''],
  ['CON10', 'Thiết kế Profile (trên 20 trang)', 580, ''],
  ['CON11', 'Thiết kế ladipage', 360, ''],
  ['CON13', 'Thiết kế bao bì', 600, ''],
  ['CON14', 'Chỉnh sửa profile/ catalog', 60, ''],
  // ── Tab SEO ──
  ['SEO01', 'Check 1 outline', 10, ''],
  ['SEO02', 'Check 2 outline', 15, ''],
  ['SEO03', 'Check 3 outline', 20, ''],
  ['SEO04', 'Check 1 content', 15, ''],
  ['SEO05', 'Check 2 content', 25, ''],
  ['SEO06', 'Check 3 content', 40, ''],
  ['SEO07', 'Check entity/backlink (20 link)', 15, ''],
  ['SEO08', 'Check entity/backlink (50 link)', 45, ''],
  ['SEO09', 'Thực hiện entity (10 social)', 25, 'Thực hiện rag profile'],
  ['SEO10', 'Thực hiện entity (20 social)', 45, ''],
  ['SEO11', 'Tạo tài khoản podcast', 80, 'Thực hiện từ lúc cài plugin, chuyển đổi voice và submit feed lên social podcast'],
  ['SEO12', 'Sửa giao diện web (1 section)', 60, ''],
  ['SEO13', 'Lading page', 420, ''],
  ['SEO14', 'Thực hiện thông tin entity', 10, ''],
  ['SEO15', 'Cài temple Bit Social', 30, 'Thực hiện cài plugin và thiết lập temple cho social chạy'],
  ['SEO16', 'Plan internal link (10 bài)', 20, ''],
  ['SEO17', 'Plan internal link (20 bài)', 40, ''],
  ['SEO18', 'Nghiên cứu keyword (200 keyword)', 420, ''],
  ['SEO19', 'Schema', 35, ''],
  ['SEO20', 'Thực hiện outline tổng', 40, 'Thực hiện tạo file mới, phân định dạng bài - danh mục'],
  ['SEO21', 'Plan book báo', 150, 'Thực hiện nghiên cứu key liên quan và lập plan'],
  ['SEO22', 'Check content gap', 150, 'Thực hiện check content gap với đối thủ và lọc key trùng/ liên quan đến ngành'],
  ['SEO23', 'Task tự do (20 phút)', 20, 'Thay thế cho task có thgian tương đương'],
  ['SEO24', 'Lọc textlink (1k báo)', 35, ''],
];

/** Vietnam public holidays 2026 — fixed-date part only (lunar Tết must be added by admin). */
export const HOLIDAYS_2026_SEED: Array<[string, string]> = [
  ['2026-01-01', 'Tết Dương lịch'],
  ['2026-04-30', 'Ngày Giải phóng miền Nam'],
  ['2026-05-01', 'Quốc tế Lao động'],
  ['2026-09-02', 'Quốc khánh'],
];
