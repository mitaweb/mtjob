// Zalo cá nhân → kho tri thức (anh Tâm 5/10/2026). Chỉ lưu TIN NHẮN; phiên đăng nhập Zalo nằm
// trên máy chạy worker, không bao giờ về đây.
import { q } from '../db/client.js';
import type { TinZalo } from '../lib/zalo.js';

export interface ZaloThread {
  threadId: string;
  name: string;
  isGroup: boolean;
  enabled: boolean;
  customerId: string;
  customer: string;
  msgCount: number;
  lastMsgAt: string;
  lastDigestAt: string;
  /** Số tin đã lưu mà chưa rút tri thức (chỉ cuộc đang bật mới có). */
  chuaRut: number;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToThread(r: any): ZaloThread {
  return {
    threadId: String(r.thread_id || ''),
    name: String(r.name || ''),
    isGroup: !!r.is_group,
    enabled: !!r.enabled,
    customerId: String(r.customer_id || ''),
    customer: String(r.customer || ''),
    msgCount: Number(r.msg_count) || 0,
    lastMsgAt: String(r.last_msg_at || ''),
    lastDigestAt: String(r.last_digest_at || ''),
    chuaRut: Number(r.chua_rut) || 0,
  };
}

/** Ghi nhận có tin ở một cuộc: tạo cuộc nếu mới (MẶC ĐỊNH TẮT), cộng số tin, cập nhật tên + giờ. */
export const SQL_GHI_CUOC = `INSERT INTO zalo_threads (thread_id, name, is_group, enabled, msg_count, last_msg_at, created_at)
  VALUES ($1, $2, $3, false, $4, $5, $6)
  ON CONFLICT (thread_id) DO UPDATE SET
    name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE zalo_threads.name END,
    msg_count = zalo_threads.msg_count + EXCLUDED.msg_count,
    last_msg_at = GREATEST(zalo_threads.last_msg_at, EXCLUDED.last_msg_at)
  RETURNING enabled`;

/** Lưu nội dung tin (chỉ gọi cho cuộc đang bật). Gửi trùng (worker gửi lại khi mạng chập) thì bỏ qua. */
export const SQL_GHI_TIN = `INSERT INTO zalo_messages (msg_id, thread_id, from_self, sender, content, ts, digested)
  VALUES ($1, $2, $3, $4, $5, $6, false) ON CONFLICT (msg_id) DO NOTHING`;

export async function ghiCuoc(c: { threadId: string; name: string; isGroup: boolean; soTin: number; lastMsgAt: string; now: string }): Promise<boolean> {
  const r = await q(SQL_GHI_CUOC, [c.threadId, c.name, c.isGroup, c.soTin, c.lastMsgAt, c.now]);
  return !!r[0]?.enabled;
}

export async function ghiTin(t: TinZalo): Promise<void> {
  await q(SQL_GHI_TIN, [t.msgId, t.threadId, t.fromSelf, t.sender, t.content, t.ts]);
}

export const SQL_DS_CUOC = `SELECT t.*, (SELECT COUNT(*) FROM zalo_messages m WHERE m.thread_id = t.thread_id AND NOT m.digested)::int AS chua_rut
  FROM zalo_threads t ORDER BY t.enabled DESC, t.last_msg_at DESC LIMIT $1`;

export async function dsCuoc(limit = 200): Promise<ZaloThread[]> {
  return (await q(SQL_DS_CUOC, [limit])).map(rowToThread);
}

export async function timCuoc(threadId: string): Promise<ZaloThread | undefined> {
  const r = await q(
    `SELECT t.*, (SELECT COUNT(*) FROM zalo_messages m WHERE m.thread_id = t.thread_id AND NOT m.digested)::int AS chua_rut
     FROM zalo_threads t WHERE t.thread_id = $1`,
    [threadId],
  );
  return r.length ? rowToThread(r[0]) : undefined;
}

/**
 * Bật/tắt + gắn khách. TẮT thì xoá luôn nội dung đã lưu của cuộc đó — anh tắt nghĩa là không
 * muốn hệ thống giữ chuyện của cuộc này nữa (tri thức đã rút vào kho thì vẫn còn, xoá ở kho).
 */
export async function suaCuoc(threadId: string, patch: { enabled?: boolean; customerId?: string; customer?: string }): Promise<void> {
  const sets: string[] = [];
  const params: unknown[] = [threadId];
  if (patch.enabled !== undefined) {
    params.push(patch.enabled);
    sets.push(`enabled = $${params.length}`);
  }
  if (patch.customerId !== undefined) {
    params.push(patch.customerId);
    sets.push(`customer_id = $${params.length}`);
    params.push(patch.customer || '');
    sets.push(`customer = $${params.length}`);
  }
  if (sets.length) await q(`UPDATE zalo_threads SET ${sets.join(', ')} WHERE thread_id = $1`, params);
  if (patch.enabled === false) await q('DELETE FROM zalo_messages WHERE thread_id = $1', [threadId]);
}

export async function tinChuaRut(threadId: string, limit = 400): Promise<TinZalo[]> {
  const rows = await q(
    `SELECT * FROM zalo_messages WHERE thread_id = $1 AND NOT digested ORDER BY ts DESC LIMIT $2`,
    [threadId, limit],
  );
  return rows.map((r) => ({
    msgId: String(r.msg_id),
    threadId: String(r.thread_id),
    fromSelf: !!r.from_self,
    sender: String(r.sender || ''),
    content: String(r.content || ''),
    ts: String(r.ts || ''),
  }));
}

export async function danhDauDaRut(threadId: string, msgIds: string[], at: string): Promise<void> {
  if (msgIds.length) await q('UPDATE zalo_messages SET digested = true WHERE msg_id = ANY($1)', [msgIds]);
  await q('UPDATE zalo_threads SET last_digest_at = $2 WHERE thread_id = $1', [threadId, at]);
}

/** Xoá nội dung tin đã rút xong quá 30 ngày — không giữ chuyện của khách lâu hơn cần thiết. */
export async function donTinCu(truocMs: number): Promise<void> {
  await q('DELETE FROM zalo_messages WHERE digested AND ts::bigint < $1', [truocMs]);
}

// ── Trạng thái kết nối ──

export interface ZaloStatus {
  status: string; // offline | waiting_qr | scanned | online | expired | error
  qr: string;
  account: string;
  note: string;
  lastSeen: string;
  /** Đã có phiên đăng nhập (bản mã) chưa — KHÔNG trả bản mã ra ngoài. */
  coPhien: boolean;
  lastMsgId: string;
  lastSync: string;
}

export async function docTrangThai(): Promise<ZaloStatus> {
  const r = await q("SELECT * FROM zalo_status WHERE id = 'main'");
  const x = r[0] || {};
  return {
    status: String(x.status || 'offline'),
    qr: String(x.qr || ''),
    account: String(x.account || ''),
    note: String(x.note || ''),
    lastSeen: String(x.last_seen || ''),
    coPhien: !!String(x.session_enc || ''),
    lastMsgId: String(x.last_msg_id || ''),
    lastSync: String(x.last_sync || ''),
  };
}

/** Bản mã phiên đăng nhập — chỉ zalo.client đọc, để giải mã ngay trước khi đăng nhập. */
export async function docPhienMa(): Promise<string> {
  const r = await q("SELECT session_enc FROM zalo_status WHERE id = 'main'");
  return String(r[0]?.session_enc || '');
}

/** Lưu (hoặc xoá với '') bản mã phiên. Đăng xuất / phiên hết hạn thì xoá luôn mốc đồng bộ. */
export async function ghiPhienMa(banMa: string): Promise<void> {
  await q(
    `INSERT INTO zalo_status (id, session_enc) VALUES ('main', $1)
     ON CONFLICT (id) DO UPDATE SET session_enc = EXCLUDED.session_enc`,
    [banMa],
  );
  if (!banMa) await q("UPDATE zalo_status SET last_msg_id = '' WHERE id = 'main'");
}

export async function ghiMocDongBo(lastMsgId: string, at: string): Promise<void> {
  await q(
    `UPDATE zalo_status SET last_sync = $2,
       last_msg_id = CASE WHEN $1 <> '' THEN $1 ELSE last_msg_id END WHERE id = 'main'`,
    [lastMsgId, at],
  );
}

export async function ghiTrangThai(s: Partial<ZaloStatus> & { lastSeen: string }): Promise<void> {
  await q(
    `INSERT INTO zalo_status (id, status, qr, account, note, last_seen) VALUES ('main', $1, $2, $3, $4, $5)
     ON CONFLICT (id) DO UPDATE SET status = EXCLUDED.status, qr = EXCLUDED.qr,
       account = CASE WHEN EXCLUDED.account <> '' THEN EXCLUDED.account ELSE zalo_status.account END,
       note = EXCLUDED.note, last_seen = EXCLUDED.last_seen`,
    [s.status || 'online', s.qr || '', s.account || '', s.note || '', s.lastSeen],
  );
}
