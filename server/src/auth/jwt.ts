import jwt from 'jsonwebtoken';
import type { Role } from '../types.js';

const SECRET: jwt.Secret = process.env.JWT_SECRET || 'dev-secret-doi-ngay';
const EXPIRES = (process.env.JWT_EXPIRES_IN || '7d') as jwt.SignOptions['expiresIn'];

export interface JwtUser {
  sub: string;
  role: Role;
  name: string;
}

export function signToken(user: JwtUser): string {
  return jwt.sign(user, SECRET, { expiresIn: EXPIRES });
}

export function verifyToken(token: string): JwtUser {
  return jwt.verify(token, SECRET) as JwtUser;
}

/** `state` ký cho luồng đăng nhập bên ngoài (OAuth kết nối nền tảng) — sống 10 phút, gắn đúng người bắt đầu. */
export function signState(o: { sub: string; muc: string }): string {
  return jwt.sign(o, SECRET, { expiresIn: '10m' });
}

export function verifyState(token: string, muc: string): { sub: string } {
  const x = jwt.verify(token, SECRET) as { sub: string; muc: string };
  if (x.muc !== muc) throw new Error('state không đúng mục đích');
  return { sub: x.sub };
}
