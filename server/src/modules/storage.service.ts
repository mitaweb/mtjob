import { q } from '../db/client.js';

// Dung lượng hệ thống — anh Tâm 1/8/2026 muốn nhìn được trong màn Quản trị.
//
// Mục đích thật: biết trước khi chạm trần gói Neon, và biết bảng nào đang phình để dọn
// đúng chỗ. Neon gói miễn phí cho 512MB; chạm trần thì DB chuyển sang chỉ đọc, cả app
// dừng ghi — không có cảnh báo nào trước đó.

/** Ngưỡng cảnh báo: gói miễn phí của Neon là 512MB. */
export const DB_LIMIT_BYTES = 512 * 1024 * 1024;

export interface TableSize {
  name: string;
  bytes: number;
  /** Số dòng ƯỚC LƯỢNG (Postgres thống kê nền, không đếm lại cả bảng). */
  rows: number;
}

export interface StorageInfo {
  dbBytes: number;
  dbLimitBytes: number;
  tables: TableSize[];
  blob: { bytes: number; files: number; available: boolean };
}

/** Dung lượng từng bảng + số dòng ước lượng, lớn trước. */
export async function tableSizes(limit = 12): Promise<TableSize[]> {
  const rows = await q(
    `SELECT c.relname AS name,
            pg_total_relation_size(c.oid)::bigint AS bytes,
            COALESCE(s.n_live_tup, 0)::bigint AS rows
     FROM pg_class c
     JOIN pg_namespace n ON n.oid = c.relnamespace
     LEFT JOIN pg_stat_user_tables s ON s.relid = c.oid
     WHERE n.nspname = 'public' AND c.relkind = 'r'
     ORDER BY bytes DESC
     LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    name: String(r.name || ''),
    bytes: Number(r.bytes || 0) || 0,
    rows: Number(r.rows || 0) || 0,
  }));
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
  const [sizeRows, tables, blob] = await Promise.all([
    q('SELECT pg_database_size(current_database())::bigint AS bytes'),
    tableSizes(),
    blobUsage(),
  ]);
  return {
    dbBytes: Number(sizeRows[0]?.bytes || 0) || 0,
    dbLimitBytes: DB_LIMIT_BYTES,
    tables,
    blob,
  };
}
