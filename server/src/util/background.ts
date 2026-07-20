import { waitUntil } from '@vercel/functions';

/**
 * Giữ promise sống sau khi response đã trả (Vercel); ngoài Vercel thì promise vẫn chạy
 * bình thường trên event loop của process dài hạn.
 */
export function runInBackground(p: Promise<unknown>): void {
  try {
    waitUntil(p);
  } catch {
    // Không phải môi trường Vercel — không cần làm gì thêm.
  }
}
