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
];
