import { q } from '../db/client.js';

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
