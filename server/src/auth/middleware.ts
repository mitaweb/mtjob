import type { Request, Response, NextFunction } from 'express';
import { verifyToken, type JwtUser } from './jwt.js';
import type { Role } from '../types.js';

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtUser;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const header = req.headers.authorization || '';
  const m = header.match(/^Bearer (.+)$/);
  if (!m || !m[1]) {
    res.status(401).json({ error: 'Chưa đăng nhập' });
    return;
  }
  try {
    req.user = verifyToken(m[1]);
    next();
  } catch {
    res.status(401).json({ error: 'Phiên đăng nhập không hợp lệ' });
  }
}

export function requireRole(...roles: Role[]) {
  return (req: Request, res: Response, next: NextFunction): void => {
    if (!req.user) {
      res.status(401).json({ error: 'Chưa đăng nhập' });
      return;
    }
    if (!roles.includes(req.user.role)) {
      res.status(403).json({ error: 'Không đủ quyền truy cập' });
      return;
    }
    next();
  };
}
