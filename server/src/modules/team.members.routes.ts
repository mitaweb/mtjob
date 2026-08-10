import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { getAllMembers, findById, upsertMember } from './members.repo.js';
import { leaderAddBlock, safeTeamMember, usernameTaken } from '../lib/hr.js';
import { vnUsername } from '../lib/people.js';
import { hashPassword } from '../auth/password.js';
import { newId } from '../util/id.js';

// Leader tự lập tài khoản cho thành viên phòng mình (anh Tâm 4/8/2026).
//
// Router RIÊNG, cố ý KHÔNG gắn vào adminRouter. adminRouter đang gác cả 25 đường dẫn:
// bảng lương, cấu hình tài chính, khoá API của AI, nút chạy DDL. Nới vai của nó để leader
// vào được phần nhân sự là mở toang cả 24 cái còn lại. Ở đây leader chỉ chạm đúng hai việc,
// và nếu xoá cả file này đi thì leader mất đúng khả năng lập tài khoản, không mất gì khác.
//
// Ba giới hạn (vai luôn là nhân viên, phòng luôn là phòng của leader, lương luôn 0) nằm
// trong `safeTeamMember` ở lib/hr.ts — thuần và có test bám sát.

export const teamMembersRouter = Router();
teamMembersRouter.use(requireAuth, requireRole('leader'));

/** Phòng của leader đang đăng nhập. `req.user` không mang teamId nên phải tra lại. */
async function myTeam(memberId: string): Promise<string> {
  return (await findById(memberId))?.teamId || '';
}

/**
 * Thành viên phòng mình. KHÔNG kèm lương/BHXH — anh Tâm chốt leader không được thấy lương,
 * nên chặn ngay ở máy chủ chứ không chỉ ẩn trên giao diện: ẩn ở giao diện thì mở tab Network
 * ra là đọc được.
 */
teamMembersRouter.get(
  '/members',
  asyncHandler(async (req, res) => {
    const teamId = await myTeam(req.user!.sub);
    const members = (await getAllMembers())
      .filter((m) => m.teamId === teamId && !!teamId)
      .map((m) => ({
        id: m.id,
        fullName: m.fullName,
        username: m.username,
        position: m.position,
        role: m.role,
        dob: m.dob || '',
        joinDate: m.joinDate || '',
        active: m.active,
      }));
    res.json({ teamId, members });
  }),
);

const newMemberSchema = z.object({
  fullName: z.string().min(1, 'Nhập họ tên'),
  username: z.string().optional().default(''),
  position: z.string().optional().default(''),
  dob: z.string().optional().default(''),
  joinDate: z.string().optional().default(''),
  // Bắt buộc: leader lập xong là đưa tài khoản cho bạn đó dùng ngay. Để trống thì bạn ấy
  // không đăng nhập được mà lại phải nhờ tới giám đốc — đúng cái vòng mình đang gỡ.
  password: z.string().min(6, 'Mật khẩu ít nhất 6 ký tự'),
});

teamMembersRouter.post(
  '/members',
  asyncHandler(async (req, res) => {
    const teamId = await myTeam(req.user!.sub);
    const blocked = leaderAddBlock(teamId);
    if (blocked) throw new ApiError(403, blocked);

    const b = newMemberSchema.parse(req.body);
    // Mọi thứ leader gửi lên đi qua bộ lọc này trước khi chạm tới bản ghi.
    const an = safeTeamMember(b, teamId);
    if (!an.fullName) throw new ApiError(400, 'Nhập họ tên');

    const all = await getAllMembers();
    const id = newId('M-');
    const username = an.username || vnUsername(an.fullName);
    const clash = usernameTaken(all, username, id);
    if (clash) throw new ApiError(409, clash);

    await upsertMember({
      id,
      fullName: an.fullName,
      dob: an.dob || null,
      position: an.position,
      teamId: an.teamId as never,
      role: an.role,
      salary: an.salary,
      bhxh: an.bhxh,
      joinDate: an.joinDate || null,
      username,
      email: '',
      passwordHash: await hashPassword(b.password),
      active: an.active,
    });

    res.json({ ok: true, id, username });
  }),
);
