// Mã hoá / giải mã chuỗi bí mật để lưu vào DB (AES-256-GCM). Dùng cho phiên đăng nhập Zalo:
// ai đọc được bản rõ là vào được Zalo của anh Tâm, nên DB chỉ giữ bản mã, KHOÁ nằm ở biến môi
// trường Vercel — lộ DB thôi thì chưa đủ để dùng phiên.
import { createCipheriv, createDecipheriv, createHash, randomBytes } from 'node:crypto';

/** Khoá 32 byte từ chuỗi bí mật bất kỳ (≥ 32 ký tự). */
function khoa(secret: string): Buffer {
  if (!secret || secret.length < 32) throw new Error('Khoá mã hoá phải dài ít nhất 32 ký tự');
  return createHash('sha256').update(secret, 'utf8').digest();
}

/** "v1.<iv>.<tag>.<dữ liệu>" — base64url. Mỗi lần mã hoá ra một chuỗi khác (iv ngẫu nhiên). */
export function maHoa(banRo: string, secret: string): string {
  const iv = randomBytes(12);
  const c = createCipheriv('aes-256-gcm', khoa(secret), iv);
  const data = Buffer.concat([c.update(banRo, 'utf8'), c.final()]);
  return ['v1', iv.toString('base64url'), c.getAuthTag().toString('base64url'), data.toString('base64url')].join('.');
}

/** Giải mã; sai khoá hoặc bị sửa thì ném lỗi (GCM kiểm toàn vẹn). */
export function giaiMa(banMa: string, secret: string): string {
  const [v, iv, tag, data] = String(banMa || '').split('.');
  if (v !== 'v1' || !iv || !tag || !data) throw new Error('Bản mã không đúng định dạng');
  const d = createDecipheriv('aes-256-gcm', khoa(secret), Buffer.from(iv, 'base64url'));
  d.setAuthTag(Buffer.from(tag, 'base64url'));
  return Buffer.concat([d.update(Buffer.from(data, 'base64url')), d.final()]).toString('utf8');
}
