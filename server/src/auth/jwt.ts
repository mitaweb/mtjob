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
