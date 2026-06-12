import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { findByLogin, findById, publicMember } from './members.repo.js';
import { verifyPassword } from '../auth/password.js';
import { signToken } from '../auth/jwt.js';
import { requireAuth } from '../auth/middleware.js';

export const authRouter = Router();

const loginSchema = z.object({ username: z.string().min(1), password: z.string().min(1) });

authRouter.post(
  '/login',
  asyncHandler(async (req, res) => {
    const { username, password } = loginSchema.parse(req.body);
    const m = await findByLogin(username);
    if (!m || !m.active) throw new ApiError(401, 'Sai tên đăng nhập hoặc mật khẩu');
    const ok = await verifyPassword(password, m.passwordHash);
    if (!ok) throw new ApiError(401, 'Sai tên đăng nhập hoặc mật khẩu');
    res.json({
      token: signToken({ sub: m.id, role: m.role, name: m.fullName }),
      user: publicMember(m),
    });
  }),
);

authRouter.get(
  '/me',
  requireAuth,
  asyncHandler(async (req, res) => {
    const m = await findById(req.user!.sub);
    if (!m) throw new ApiError(404, 'Không tìm thấy người dùng');
    res.json({ user: publicMember(m) });
  }),
);
