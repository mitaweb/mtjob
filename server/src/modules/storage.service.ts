import { q } from '../db/client.js';

// Dung lượng hệ thống — anh Tâm 1/8/2026 muốn nhìn được trong màn Quản trị.
//
// Mục đích thật: biết trước khi chạm trần gói Neon, và biết bảng nào đang phình để dọn
// đúng chỗ. Neon gói miễn phí cho 512MB; chạm trần thì DB chuyển sang chỉ đọc, cả app
// dừng ghi — không có cảnh báo nào trước đó.

/** Ngưỡng cảnh báo: gói miễn phí của Neon là 512MB. */
export const DB_LIMIT_BYTES = 512 * 1024 * 1024;

export interface StorageInfo {
  dbBytes: number;
  dbLimitBytes: number;
  blob: { bytes: number; files: number; available: boolean };
}

/**
 * Dung lượng kho ảnh/PDF của Lưu ý KH (Vercel Blob).
 *
 * Không có token thì trả available=false thay vì ném lỗi — màn Quản trị vẫn phải hiện
 * được phần database.
 */
async function blobUsage(): Promise<StorageInfo['blob']> {
  const token = process.env.mt_READ_WRITE_TOKEN || process.env.BLOB_READ_WRITE_TOKEN;
  if (!token) return { bytes: 0, files: 0, available: false };
  try {
    const { list } = await import('@vercel/blob');
    let bytes = 0;
    let files = 0;
    let cursor: string | undefined;
    // Duyệt hết các trang; kho ảnh của công ty nhỏ nên vài vòng là xong.
    do {
      const page = await list({ token, cursor, limit: 1000 });
      for (const b of page.blobs) {
        bytes += b.size || 0;
        files += 1;
      }
      cursor = page.hasMore ? page.cursor : undefined;
    } while (cursor);
    return { bytes, files, available: true };
  } catch (e) {
    console.warn('[storage] không đọc được kho ảnh:', (e as Error).message);
    return { bytes: 0, files: 0, available: false };
  }
}

export async function storageInfo(): Promise<StorageInfo> {
  const [sizeRows, blob] = await Promise.all([
    q('SELECT pg_database_size(current_database())::bigint AS bytes'),
    blobUsage(),
  ]);
  return {
    dbBytes: Number(sizeRows[0]?.bytes || 0) || 0,
    dbLimitBytes: DB_LIMIT_BYTES,
    blob,
  };
}
