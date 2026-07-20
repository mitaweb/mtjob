import { q } from '../db/client.js';

/**
 * Bảng kho tri thức chưa được tạo (chưa bấm "Cập nhật cấu trúc DB", hoặc pgvector lỗi).
 * Postgres 42P01 = undefined_table. Dùng để degrade êm thay vì ném lỗi kỹ thuật ra UI.
 */
export function isMissingTable(e: unknown): boolean {
  const err = e as { code?: string; message?: string };
  return err?.code === '42P01' || /relation .*(brain_chunks|chat_messages).* does not exist/i.test(err?.message || '');
}

/** Kho đã sẵn sàng chưa (bảng tồn tại)? */
export async function brainTableReady(): Promise<boolean> {
  try {
    await q('SELECT 1 FROM brain_chunks LIMIT 1');
    return true;
  } catch (e) {
    if (isMissingTable(e)) return false;
    throw e;
  }
}

// LƯU Ý về pgvector qua driver Neon HTTP: truyền embedding dạng CHUỖI JSON ('[0.1,0.2,...]')
// rồi cast `$n::vector` trong SQL. Truyền mảng JS thô sẽ bị serialize thành array literal
// kiểu Postgres ('{...}') và pgvector từ chối. Không bao giờ SELECT cột embedding về (rất dài).

export interface BrainChunk {
  id: string;
  sourceType: string;
  sourceId: string;
  title: string;
  content: string;
  visibility: string; // 'all' | 'director' | <member_id>
  customer: string;
  createdAt: string;
}

export interface BrainHit extends BrainChunk {
  score: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToChunk(r: any): BrainChunk {
  return {
    id: r.chunk_id || '',
    sourceType: r.source_type || '',
    sourceId: r.source_id || '',
    title: r.title || '',
    content: r.content || '',
    visibility: r.visibility || 'all',
    customer: r.customer || '',
    createdAt: r.created_at || '',
  };
}

export interface NewChunk extends Omit<BrainChunk, 'id'> {
  id: string;
  embedding: number[];
}

/** Ghi nhiều đoạn cùng lúc (1 câu lệnh INSERT nhiều dòng). */
export async function insertChunks(rows: NewChunk[]): Promise<void> {
  if (rows.length === 0) return;
  const params: unknown[] = [];
  const values = rows.map((r) => {
    const i = params.length;
    params.push(
      r.id, r.sourceType, r.sourceId, r.title, r.content,
      JSON.stringify(r.embedding), r.visibility, r.customer, r.createdAt,
    );
    return `($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6}::vector,$${i + 7},$${i + 8},$${i + 9})`;
  });
  await q(
    `INSERT INTO brain_chunks
       (chunk_id, source_type, source_id, title, content, embedding, visibility, customer, created_at)
     VALUES ${values.join(',')}`,
    params,
  );
}

/** Xoá mọi đoạn của một nguồn — dùng cho cả sửa (xoá rồi nạp lại) lẫn xoá hẳn. */
export async function deleteBySource(sourceType: string, sourceId: string): Promise<void> {
  await q('DELETE FROM brain_chunks WHERE source_type = $1 AND source_id = $2', [sourceType, sourceId]);
}

export async function deleteChunk(chunkId: string): Promise<void> {
  await q('DELETE FROM brain_chunks WHERE chunk_id = $1', [chunkId]);
}

export interface SearchOpts {
  /** true = giám đốc/admin: không lọc quyền xem. */
  directorScope: boolean;
  /** Bắt buộc khi không phải giám đốc: chỉ thấy 'all' + đoạn riêng của mình. */
  memberId?: string;
  customer?: string;
  limit?: number;
}

/** Tìm theo ngữ nghĩa (cosine). Quyền xem lọc ngay trong SQL, không phụ thuộc prompt. */
export async function searchChunks(embedding: number[], opts: SearchOpts): Promise<BrainHit[]> {
  const vec = JSON.stringify(embedding);
  const customer = (opts.customer || '').trim();
  const limit = opts.limit ?? 8;
  const params: unknown[] = [vec, customer];
  let where = "($2 = '' OR customer ILIKE '%' || $2 || '%')";
  if (!opts.directorScope) {
    params.push(opts.memberId || '');
    where += ` AND visibility IN ('all', $${params.length})`;
  }
  params.push(limit);
  const rows = await q(
    `SELECT chunk_id, source_type, source_id, title, content, visibility, customer, created_at,
            1 - (embedding <=> $1::vector) AS score
     FROM brain_chunks
     WHERE ${where}
     ORDER BY embedding <=> $1::vector
     LIMIT $${params.length}`,
    params,
  );
  return rows.map((r) => ({ ...rowToChunk(r), score: Number(r.score) || 0 }));
}

/** Duyệt kho theo từ khoá chữ (trang Kho tri thức) — không cần gọi API embeddings. */
export async function browseChunks(opts: {
  keyword?: string;
  sourceType?: string;
  directorScope: boolean;
  memberId?: string;
  limit?: number;
}): Promise<BrainChunk[]> {
  const kw = (opts.keyword || '').trim();
  const params: unknown[] = [kw];
  let where = "($1 = '' OR content ILIKE '%' || $1 || '%' OR title ILIKE '%' || $1 || '%')";
  if (opts.sourceType) {
    params.push(opts.sourceType);
    where += ` AND source_type = $${params.length}`;
  }
  if (!opts.directorScope) {
    params.push(opts.memberId || '');
    where += ` AND visibility IN ('all', $${params.length})`;
  }
  params.push(opts.limit ?? 50);
  const rows = await q(
    `SELECT chunk_id, source_type, source_id, title, content, visibility, customer, created_at
     FROM brain_chunks WHERE ${where}
     ORDER BY created_at DESC LIMIT $${params.length}`,
    params,
  );
  return rows.map(rowToChunk);
}

/** Thống kê cho trang Kho tri thức: số đoạn theo từng loại nguồn. */
export async function statsBySource(): Promise<Array<{ sourceType: string; count: number }>> {
  const rows = await q('SELECT source_type, COUNT(*) AS n FROM brain_chunks GROUP BY source_type ORDER BY n DESC');
  return rows.map((r) => ({ sourceType: r.source_type || '', count: Number(r.n) || 0 }));
}

/** Id các nguồn CHƯA có trong kho (để nạp dần dữ liệu cũ). */
export async function pendingSources(
  table: string,
  idCol: string,
  sourceType: string,
  extraWhere: string,
  limit: number,
): Promise<string[]> {
  const rows = await q(
    `SELECT t.${idCol} AS id FROM ${table} t
     WHERE ${extraWhere} AND NOT EXISTS (
       SELECT 1 FROM brain_chunks b WHERE b.source_type = $1 AND b.source_id = t.${idCol}
     )
     LIMIT $2`,
    [sourceType, limit],
  );
  return rows.map((r) => String(r.id || ''));
}

// ── Hồ sơ 360° khách hàng ──

export interface CustomerProfile {
  key: string;
  customer: string;
  summary: string;
  dirty: boolean;
  builtAt: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToProfile(r: any): CustomerProfile {
  return {
    key: r.customer_key || '',
    customer: r.customer || '',
    summary: r.summary || '',
    dirty: !!r.dirty,
    builtAt: r.built_at || '',
  };
}

/** Đánh dấu khách có dữ liệu mới → lượt quét kế tiếp sẽ dựng lại hồ sơ. */
export async function markProfileDirty(key: string, customer: string): Promise<void> {
  await q(
    `INSERT INTO brain_profiles (customer_key, customer, dirty) VALUES ($1,$2,true)
     ON CONFLICT (customer_key) DO UPDATE SET dirty = true, customer = EXCLUDED.customer`,
    [key, customer],
  );
}

export async function listDirtyProfiles(limit: number): Promise<CustomerProfile[]> {
  const rows = await q('SELECT * FROM brain_profiles WHERE dirty = true LIMIT $1', [limit]);
  return rows.map(rowToProfile);
}

export async function countDirtyProfiles(): Promise<number> {
  const rows = await q('SELECT COUNT(*) AS n FROM brain_profiles WHERE dirty = true');
  return Number(rows[0]?.n) || 0;
}

export async function saveProfile(key: string, customer: string, summary: string, builtAt: string): Promise<void> {
  await q(
    `INSERT INTO brain_profiles (customer_key, customer, summary, dirty, built_at) VALUES ($1,$2,$3,false,$4)
     ON CONFLICT (customer_key) DO UPDATE SET
       customer = EXCLUDED.customer, summary = EXCLUDED.summary, dirty = false, built_at = EXCLUDED.built_at`,
    [key, customer, summary, builtAt],
  );
}

/** Tìm hồ sơ theo tên gần đúng (khách "ba spa" khớp "Ba Spa Quận 7"). */
export async function findProfiles(needle: string, limit = 3): Promise<CustomerProfile[]> {
  const rows = await q(
    `SELECT * FROM brain_profiles
     WHERE customer_key ILIKE '%' || $1 || '%' AND summary <> ''
     ORDER BY length(customer_key) LIMIT $2`,
    [needle, limit],
  );
  return rows.map(rowToProfile);
}

export async function listProfiles(limit = 100): Promise<CustomerProfile[]> {
  const rows = await q(
    "SELECT * FROM brain_profiles WHERE summary <> '' ORDER BY customer LIMIT $1",
    [limit],
  );
  return rows.map(rowToProfile);
}

/** Tổng số nguồn còn chờ nạp (hiển thị tiến độ). */
export async function countPending(
  table: string,
  idCol: string,
  sourceType: string,
  extraWhere: string,
): Promise<number> {
  const rows = await q(
    `SELECT COUNT(*) AS n FROM ${table} t
     WHERE ${extraWhere} AND NOT EXISTS (
       SELECT 1 FROM brain_chunks b WHERE b.source_type = $1 AND b.source_id = t.${idCol}
     )`,
    [sourceType],
  );
  return Number(rows[0]?.n) || 0;
}
