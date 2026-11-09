// Bộ não hiểu anh Tâm (9/11/2026) — đọc / ghi bảng hieu_anh, con trỏ "đã học" trên tin Zalo + chat trợ lý.
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { KHIA_CANH_KEYS, type MucHieuAnh, type KhiaCanh, type ThemHieuAnh, type SuaHieuAnh, type NguonHieuAnh, type TrangThaiHieuAnh } from '../lib/hieuAnh.js';

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToMuc(r: any): MucHieuAnh {
  let bangChung: string[] = [];
  try {
    const x = JSON.parse(String(r.bang_chung || '[]'));
    if (Array.isArray(x)) bangChung = x.map(String);
  } catch {
    /* hỏng thì bỏ */
  }
  const kc = String(r.khia_canh || '');
  return {
    id: String(r.id),
    khiaCanh: ((KHIA_CANH_KEYS as string[]).includes(kc) ? kc : 'nguyen_tac') as KhiaCanh,
    noiDung: String(r.noi_dung || ''),
    doiTuong: String(r.doi_tuong || ''),
    bangChung,
    soLanThay: Number(r.so_lan_thay) || 1,
    trangThai: (['dung', 'anh_sua', 'anh_bo'].includes(r.trang_thai) ? r.trang_thai : 'dung') as TrangThaiHieuAnh,
    nguon: (['zalo', 'chat', 'anh_day'].includes(r.nguon) ? r.nguon : 'zalo') as NguonHieuAnh,
    capNhat: String(r.cap_nhat || ''),
  };
}

export async function dsHieuAnh(limit = 500): Promise<MucHieuAnh[]> {
  return (await q('SELECT * FROM hieu_anh ORDER BY cap_nhat DESC LIMIT $1', [limit])).map(rowToMuc);
}

export async function timHieuAnh(id: string): Promise<MucHieuAnh | undefined> {
  const r = await q('SELECT * FROM hieu_anh WHERE id = $1', [id]);
  return r[0] ? rowToMuc(r[0]) : undefined;
}

export async function themHieuAnh(ds: ThemHieuAnh[], nguon: NguonHieuAnh, luc: string, trangThai: TrangThaiHieuAnh = 'dung'): Promise<string[]> {
  const ids: string[] = [];
  for (const m of ds) {
    const id = newId('HA');
    await q(
      `INSERT INTO hieu_anh (id, khia_canh, noi_dung, doi_tuong, bang_chung, so_lan_thay, trang_thai, nguon, tao_luc, cap_nhat)
       VALUES ($1, $2, $3, $4, $5, 1, $6, $7, $8, $8)`,
      [id, m.khiaCanh, m.noiDung, m.doiTuong, JSON.stringify(m.bangChung), trangThai, nguon, luc],
    );
    ids.push(id);
  }
  return ids;
}

/** Ghi điều AI xác nhận / chỉnh. Chặn lần nữa ở SQL: chỉ điều đang 'dung' mới bị AI đổi. */
export async function suaHieuAnhAi(ds: SuaHieuAnh[], luc: string): Promise<void> {
  for (const s of ds) {
    await q(
      `UPDATE hieu_anh SET so_lan_thay = $2, bang_chung = $3, noi_dung = COALESCE($4, noi_dung), cap_nhat = $5
       WHERE id = $1 AND trang_thai = 'dung'`,
      [s.id, s.soLanThay, JSON.stringify(s.bangChung), s.noiDung ?? null, luc],
    );
  }
}

/** Anh sửa / duyệt / bỏ một điều. */
export async function anhSuaHieuAnh(
  id: string,
  p: { noiDung?: string; khiaCanh?: KhiaCanh; doiTuong?: string; trangThai: TrangThaiHieuAnh },
  luc: string,
): Promise<boolean> {
  const r = await q(
    `UPDATE hieu_anh SET noi_dung = COALESCE($2, noi_dung), khia_canh = COALESCE($3, khia_canh),
       doi_tuong = COALESCE($4, doi_tuong), trang_thai = $5, cap_nhat = $6
     WHERE id = $1 RETURNING id`,
    [id, p.noiDung ?? null, p.khiaCanh ?? null, p.doiTuong ?? null, p.trangThai, luc],
  );
  return r.length > 0;
}

// ── Tin Zalo của anh chưa học ──

/** Cuộc CÔNG VIỆC (đang bật) còn tin anh gửi chưa học — cuộc có tin chờ lâu nhất trước (tin đã đọc 30 ngày là bị xoá). */
export async function cuocCoTinAnhChuaHoc(limit: number): Promise<Array<{ threadId: string; name: string; isGroup: boolean; customer: string }>> {
  const rows = await q(
    `SELECT t.thread_id, t.name, t.is_group, t.customer, x.cu FROM zalo_threads t
     JOIN (SELECT thread_id, MIN(ts::bigint) AS cu FROM zalo_messages WHERE from_self AND NOT hoc_anh GROUP BY thread_id) x
       ON x.thread_id = t.thread_id
     WHERE t.enabled
     ORDER BY x.cu LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({ threadId: String(r.thread_id), name: String(r.name || ''), isGroup: !!r.is_group, customer: String(r.customer || '') }));
}

export async function idTinAnhChuaHoc(threadId: string): Promise<Set<string>> {
  const rows = await q('SELECT msg_id FROM zalo_messages WHERE thread_id = $1 AND from_self AND NOT hoc_anh', [threadId]);
  return new Set(rows.map((r) => String(r.msg_id)));
}

export async function danhDauHocZalo(ids: string[]): Promise<void> {
  if (ids.length) await q('UPDATE zalo_messages SET hoc_anh = true WHERE msg_id = ANY($1::text[])', [ids]);
}

export async function demTinAnhChuaHoc(): Promise<number> {
  const r = await q(
    `SELECT COUNT(*)::int AS n FROM zalo_messages m JOIN zalo_threads t ON t.thread_id = m.thread_id
     WHERE m.from_self AND NOT m.hoc_anh AND t.enabled`,
  );
  return Number(r[0]?.n) || 0;
}

// ── Câu anh nhắn trợ lý chưa học ──

export interface CauChat {
  id: string;
  text: string;
  /** Câu trả lời của trợ lý ngay trước (để hiểu anh đang sửa / phản hồi gì) */
  truoc: string;
  createdAt: string;
}

export async function chatAnhChuaHoc(memberId: string, tuLuc: string, limit: number): Promise<CauChat[]> {
  const rows = await q(
    `SELECT u.msg_id, u.text, u.created_at,
       (SELECT m.text FROM chat_messages m WHERE m.member_id = u.member_id AND m.role = 'model' AND m.created_at < u.created_at
        ORDER BY m.created_at DESC LIMIT 1) AS truoc
     FROM chat_messages u
     WHERE u.member_id = $1 AND u.role = 'user' AND NOT COALESCE(u.hoc_anh, false) AND u.created_at >= $2
     ORDER BY u.created_at LIMIT $3`,
    [memberId, tuLuc, limit],
  );
  return rows.map((r) => ({ id: String(r.msg_id), text: String(r.text || ''), truoc: String(r.truoc || ''), createdAt: String(r.created_at || '') }));
}

export async function danhDauHocChat(ids: string[]): Promise<void> {
  if (ids.length) await q('UPDATE chat_messages SET hoc_anh = true WHERE msg_id = ANY($1::text[])', [ids]);
}

export async function demChatAnhChuaHoc(memberId: string, tuLuc: string): Promise<number> {
  const r = await q(
    `SELECT COUNT(*)::int AS n FROM chat_messages WHERE member_id = $1 AND role = 'user' AND NOT COALESCE(hoc_anh, false) AND created_at >= $2`,
    [memberId, tuLuc],
  );
  return Number(r[0]?.n) || 0;
}

// ── Khoá chạy + mốc ──

/** Giữ khoá `khoa` trong `ms` mili-giây; true = lấy được (không lượt nào khác đang chạy). */
export async function layKhoa(khoa: string, ms: number): Promise<boolean> {
  const now = Date.now();
  const r = await q(
    `INSERT INTO hieu_anh_trang_thai (khoa, gia_tri) VALUES ($1, $2)
     ON CONFLICT (khoa) DO UPDATE SET gia_tri = EXCLUDED.gia_tri WHERE hieu_anh_trang_thai.gia_tri < $3
     RETURNING khoa`,
    [khoa, now + ms, now],
  );
  return r.length > 0;
}

export async function thaKhoa(khoa: string): Promise<void> {
  await q('UPDATE hieu_anh_trang_thai SET gia_tri = 0 WHERE khoa = $1', [khoa]);
}

export async function docMoc(khoa: string): Promise<number> {
  const r = await q('SELECT gia_tri FROM hieu_anh_trang_thai WHERE khoa = $1', [khoa]);
  return Number(r[0]?.gia_tri) || 0;
}

export async function ghiMoc(khoa: string, giaTri: number): Promise<void> {
  await q(
    'INSERT INTO hieu_anh_trang_thai (khoa, gia_tri) VALUES ($1, $2) ON CONFLICT (khoa) DO UPDATE SET gia_tri = EXCLUDED.gia_tri',
    [khoa, giaTri],
  );
}
