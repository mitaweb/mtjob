import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import {
  getAllMembers,
  findById,
  publicMember,
  upsertMember,
  memberFootprint,
  purgeMember,
} from './members.repo.js';
import { upsertTeam, findTeam, getTeams } from './teams.repo.js';
import { deleteMemberBlock, usernameTaken } from '../lib/hr.js';
import { vnUsername } from '../lib/people.js';
import { hashPassword } from '../auth/password.js';
import { newId } from '../util/id.js';

// Nhân sự: danh sách, thêm/sửa, đặt mật khẩu, cho nghỉ, xoá hẳn.
//
// Tách khỏi admin.routes.ts (từng ôm 18 miền trong 588 dòng): mỗi lần anh Tâm đổi một
// thứ về nhân sự, người sửa chỉ cần đọc file này thay vì lội qua cả migrate DB, model AI
// và bảng lương. Đường dẫn API giữ NGUYÊN nên giao diện không phải đổi gì.
//
// Router này được gắn vào adminRouter nên đã thừa hưởng requireAuth + requireRole.

export const adminMembersRouter = Router();

adminMembersRouter.get(
  '/members',
  asyncHandler(async (_req, res) => {
    res.json({ members: (await getAllMembers()).map(publicMember) });
  }),
);

const memberSchema = z.object({
  id: z.string().optional(),
  fullName: z.string().min(1),
  username: z.string().optional().default(''),
  role: z.enum(['member', 'leader', 'director', 'admin', 'accountant', 'sale']),
  teamId: z.string().optional().default(''),
  dob: z.string().optional().default(''),
  position: z.string().optional().default(''),
  salary: z.number().min(0).optional().default(0),
  bhxh: z.number().min(0).optional().default(0),
  joinDate: z.string().optional().default(''),
  active: z.boolean().optional().default(true),
  password: z.string().min(6).optional(),
});

adminMembersRouter.post(
  '/members',
  asyncHandler(async (req, res) => {
    const b = memberSchema.parse(req.body);
    const all = await getAllMembers();
    const existing = b.id ? all.find((m) => m.id === b.id) : undefined;
    const id = existing?.id || b.id || newId('M-');

    // Tên đăng nhập: giữ tên cũ, hoặc sinh từ họ tên khi tạo mới ("Lương Thị Thu Hà" → luongha).
    const username = (b.username || '').trim() || existing?.username || vnUsername(b.fullName);
    // Trùng tài khoản thì BÁO LỖI chứ không tự thêm số vào đuôi như bản đồng bộ Sheet cũ:
    // gõ `hotam` mà máy lặng lẽ lưu thành `hotam2` là đăng nhập không được mà không hiểu vì sao.
    const clash = usernameTaken(all, username, id);
    if (clash) throw new ApiError(409, clash);

    const passwordHash = b.password ? await hashPassword(b.password) : existing?.passwordHash || '';
    await upsertMember({
      id,
      fullName: b.fullName.trim(),
      dob: b.dob || null,
      position: b.position,
      teamId: b.teamId as never,
      role: b.role,
      salary: b.salary,
      bhxh: b.bhxh,
      joinDate: b.joinDate || null,
      username,
      email: existing?.email || '',
      passwordHash,
      active: b.active,
    });

    // Vai Leader gắn liền với cột leader_member_id của phòng, phải đi đôi cả hai chiều:
    const stillLeader = b.role === 'leader' && !!b.teamId && b.active;
    if (stillLeader) {
      const team = await findTeam(b.teamId);
      await upsertTeam({ id: b.teamId, name: team?.name || b.teamId, leaderMemberId: id });
    }
    // Hạ vai, đổi phòng hay cho nghỉ thì phải GỠ khỏi phòng cũ. Bỏ bước này là người đã
    // hạ vai vẫn nhận thông báo "thành viên hoàn thành task" của phòng cũ dài dài.
    for (const t of await getTeams()) {
      if (t.leaderMemberId === id && !(stillLeader && t.id === b.teamId)) {
        await upsertTeam({ ...t, leaderMemberId: '' });
      }
    }

    res.json({ ok: true, id, username });
  }),
);

/**
 * Xoá HẲN một nhân sự. Anh Tâm chốt 29/7/2026 khi chuyển quản lý nhân sự vào app.
 * Không có đường lui nên chốt chặn nằm ở `deleteMemberBlock` (thuần, có test).
 */
adminMembersRouter.delete(
  '/members/:id',
  asyncHandler(async (req, res) => {
    const id = String(req.params.id);
    const blocked = deleteMemberBlock(await getAllMembers(), id, req.user!.sub);
    if (blocked) throw new ApiError(blocked.startsWith('Không tìm thấy') ? 404 : 403, blocked);
    await purgeMember(id);
    res.json({ ok: true });
  }),
);

/** Người này để lại bao nhiêu việc/công/tháng lương — hộp xác nhận cần con số thật. */
adminMembersRouter.get(
  '/members/:id/footprint',
  asyncHandler(async (req, res) => {
    const m = await findById(String(req.params.id));
    if (!m) throw new ApiError(404, 'Không tìm thấy nhân sự');
    res.json(await memberFootprint(m.id));
  }),
);

adminMembersRouter.post(
  '/members/:id/password',
  asyncHandler(async (req, res) => {
    const { password } = z.object({ password: z.string().min(6) }).parse(req.body);
    const m = await findById(String(req.params.id));
    if (!m) throw new ApiError(404, 'Không tìm thấy thành viên');
    await upsertMember({ ...m, passwordHash: await hashPassword(password) });
    res.json({ ok: true });
  }),
);
