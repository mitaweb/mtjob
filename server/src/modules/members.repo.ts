// Data access for members (Postgres).
import { q } from '../db/client.js';
import type { Member, Role, Team } from '../types.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMember(r: any): Member {
  return {
    id: r.member_id || '',
    fullName: r.full_name || '',
    dob: r.dob || null,
    position: r.position || '',
    teamId: (r.team_id || '') as Team,
    role: (r.role || 'member') as Role,
    salary: Number(r.salary || 0) || 0,
    bhxh: Number(r.bhxh || 0) || 0,
    joinDate: r.join_date || null,
    username: r.username || '',
    email: r.email || '',
    passwordHash: r.password_hash || '',
    active: !!r.active,
  };
}

export type PublicMember = Omit<Member, 'passwordHash' | 'email'>;

export function publicMember(m: Member): PublicMember {
  const { passwordHash: _omit, email: _omit2, ...rest } = m;
  return rest;
}

export async function getAllMembers(): Promise<Member[]> {
  const rows = await q('SELECT * FROM members ORDER BY full_name');
  return rows.map(rowToMember);
}

export async function getActiveMembers(): Promise<Member[]> {
  const rows = await q('SELECT * FROM members WHERE active = true ORDER BY full_name');
  return rows.map(rowToMember);
}

export async function findByEmail(email: string): Promise<Member | undefined> {
  const rows = await q('SELECT * FROM members WHERE lower(email) = lower($1) LIMIT 1', [email.trim()]);
  return rows.length ? rowToMember(rows[0]) : undefined;
}

/** Tra cứu theo tên đăng nhập (chỉ username — email đã bỏ hoàn toàn). */
export async function findByLogin(login: string): Promise<Member | undefined> {
  const rows = await q('SELECT * FROM members WHERE lower(username) = lower($1) LIMIT 1', [login.trim()]);
  return rows.length ? rowToMember(rows[0]) : undefined;
}

export async function findById(id: string): Promise<Member | undefined> {
  const rows = await q('SELECT * FROM members WHERE member_id = $1 LIMIT 1', [id]);
  return rows.length ? rowToMember(rows[0]) : undefined;
}

export async function membersInTeam(teamId: string): Promise<Member[]> {
  const rows = await q('SELECT * FROM members WHERE active = true AND team_id = $1 ORDER BY full_name', [teamId]);
  return rows.map(rowToMember);
}

export async function getDirectors(): Promise<Member[]> {
  const rows = await q("SELECT * FROM members WHERE active = true AND role = 'director'");
  return rows.map(rowToMember);
}

export async function deleteMember(id: string): Promise<void> {
  await q('DELETE FROM members WHERE member_id = $1', [id]);
}

export async function upsertMember(m: Member): Promise<void> {
  await q(
    `INSERT INTO members (member_id, full_name, dob, position, team_id, role, salary, bhxh, join_date, username, email, password_hash, active)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13)
     ON CONFLICT (member_id) DO UPDATE SET
       full_name = EXCLUDED.full_name,
       dob = EXCLUDED.dob,
       position = EXCLUDED.position,
       team_id = EXCLUDED.team_id,
       role = EXCLUDED.role,
       salary = EXCLUDED.salary,
       bhxh = EXCLUDED.bhxh,
       join_date = EXCLUDED.join_date,
       username = EXCLUDED.username,
       email = EXCLUDED.email,
       password_hash = EXCLUDED.password_hash,
       active = EXCLUDED.active`,
    [
      m.id, m.fullName, m.dob || '', m.position, m.teamId, m.role,
      m.salary, m.bhxh, m.joinDate || '', m.username || '', m.email, m.passwordHash, m.active,
    ],
  );
}

export interface MemberFootprint {
  tasks: number;
  attendanceDays: number;
  payrollMonths: number;
}

/** Người này để lại bao nhiêu dấu vết — để hộp xác nhận nói con số thật, không nói chung chung. */
export async function memberFootprint(id: string): Promise<MemberFootprint> {
  const [t, a, p] = await Promise.all([
    q('SELECT count(*)::int AS n FROM tasks WHERE member_id = $1', [id]),
    q('SELECT count(*)::int AS n FROM attendance WHERE member_id = $1', [id]),
    q('SELECT count(*)::int AS n FROM payroll WHERE member_id = $1', [id]),
  ]);
  return {
    tasks: Number(t[0]?.n || 0),
    attendanceDays: Number(a[0]?.n || 0),
    payrollMonths: Number(p[0]?.n || 0),
  };
}

/**
 * Xoá hẳn một nhân sự và dọn những gì đi theo họ.
 *
 * GIỮ LẠI việc đã làm, chấm công và bảng lương các tháng cũ: ba bảng đó đã lưu sẵn tên
 * người (`tasks.member_name`, `attendance.name`, `payroll.full_name`) nên báo cáo tháng
 * cũ vẫn đọc được, xoá đi là thủng lịch sử công ty.
 *
 * XOÁ những thứ chỉ có nghĩa với người còn làm: đăng ký nhận thông báo đẩy, hộp thư,
 * nhắc hẹn cá nhân. Không có khoá ngoại nào trong DB nên phải tự dọn từng bảng.
 */
export async function purgeMember(id: string): Promise<void> {
  await q('DELETE FROM push_subscriptions WHERE member_id = $1', [id]);
  await q('DELETE FROM notifications WHERE member_id = $1', [id]);
  await q('DELETE FROM reminders WHERE member_id = $1', [id]);
  // Đang là leader của phòng nào thì gỡ ra, đừng để trỏ vào dòng vừa mất.
  await q("UPDATE teams SET leader_member_id = '' WHERE leader_member_id = $1", [id]);
  await q('DELETE FROM members WHERE member_id = $1', [id]);
}
