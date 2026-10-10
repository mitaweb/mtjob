// Zalo cá nhân → kho tri thức (anh Tâm 5/10/2026). Tin nhắn + trạng thái kết nối; phiên đăng nhập
// chỉ ở dạng bản mã (zalo.client.ts).
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
  /** Nhóm: AI đã xét là nhóm khách hay không chưa, và kết luận. */
  aiChecked: boolean;
  aiNote: string;
  /** Nhóm khách: đã kéo lịch sử cũ chưa. */
  historyDone: boolean;
  /** AI phân vân (50:50) — chờ anh quyết. */
  aiHoi: boolean;
  /** 'hoc' | 'bo' khi anh tự quyết; '' khi để AI quyết. */
  anhQuyet: string;
  /** Một câu AI tóm cuộc này nói gì. */
  tomTat: string;
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
    aiChecked: !!r.ai_checked,
    aiNote: String(r.ai_note || ''),
    historyDone: !!r.history_done,
    aiHoi: !!r.ai_hoi,
    anhQuyet: String(r.anh_quyet || ''),
    tomTat: String(r.tom_tat || ''),
  };
}

/**
 * Ghi nhận có tin ở một cuộc: tạo cuộc nếu mới, cộng số tin, cập nhật tên + giờ. Trả về có LƯU NỘI DUNG
 * không (anh Tâm 10/10/2026: "AI tự đọc sau đó tự học"): lưu mọi cuộc, trừ cuộc đã bị loại (AI thấy
 * là chuyện cá nhân, hoặc anh tự tắt) — tức `ai_checked` mà không `enabled`.
 */
export const SQL_GHI_CUOC = `INSERT INTO zalo_threads (thread_id, name, is_group, enabled, msg_count, last_msg_at, created_at)
  VALUES ($1, $2, $3, false, $4, $5, $6)
  ON CONFLICT (thread_id) DO UPDATE SET
    name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE zalo_threads.name END,
    is_group = zalo_threads.is_group OR EXCLUDED.is_group,
    msg_count = zalo_threads.msg_count + EXCLUDED.msg_count,
    last_msg_at = GREATEST(zalo_threads.last_msg_at, EXCLUDED.last_msg_at)
  RETURNING (enabled OR NOT COALESCE(ai_checked, false)) AS luu`;

/** Lưu nội dung tin (chỉ gọi cho cuộc đang bật). Gửi trùng (worker gửi lại khi mạng chập) thì bỏ qua. */
export const SQL_GHI_TIN = `INSERT INTO zalo_messages (msg_id, thread_id, from_self, sender, content, ts, digested)
  VALUES ($1, $2, $3, $4, $5, $6, false) ON CONFLICT (msg_id) DO NOTHING`;

export async function ghiCuoc(c: { threadId: string; name: string; isGroup: boolean; soTin: number; lastMsgAt: string; now: string }): Promise<boolean> {
  const r = await q(SQL_GHI_CUOC, [c.threadId, c.name, c.isGroup, c.soTin, c.lastMsgAt, c.now]);
  return !!r[0]?.luu;
}

export async function ghiTin(t: TinZalo): Promise<void> {
  await q(SQL_GHI_TIN, [t.msgId, t.threadId, t.fromSelf, t.sender, t.content, t.ts]);
}

export const SQL_DS_CUOC = `SELECT t.*, (SELECT COUNT(*) FROM zalo_messages m WHERE m.thread_id = t.thread_id AND NOT m.digested)::int AS chua_rut
  FROM zalo_threads t ORDER BY t.enabled DESC, t.last_msg_at DESC LIMIT $1`;

export async function dsCuoc(limit = 200): Promise<ZaloThread[]> {
  return (await q(SQL_DS_CUOC, [limit])).map(rowToThread);
}

export type LocCuoc = 'hoi' | 'hoc' | 'bo' | 'nhom' | 'rieng' | 'tat_ca';

const DK_LOC: Record<LocCuoc, string> = {
  hoi: 'COALESCE(t.ai_hoi, false)',
  hoc: 't.enabled',
  bo: 'COALESCE(t.ai_checked, false) AND NOT t.enabled',
  nhom: 't.is_group',
  rieng: 'NOT t.is_group',
  tat_ca: 'true',
};

/**
 * Một trang cuộc trò chuyện cho tab Zalo (anh Tâm 10/10/2026: "phân trang trang này, hiện dài quá" —
 * gần 800 nhóm). Đếm theo từng bộ lọc để hiện trên nút lọc; tìm theo tên cuộc / tên khách.
 */
export async function trangCuoc(o: { loc: LocCuoc; tim: string; trang: number; co: number }): Promise<{
  threads: ZaloThread[];
  dem: Record<LocCuoc, number>;
}> {
  const params: unknown[] = [];
  let dkTim = 'true';
  const tim = o.tim.trim();
  if (tim) {
    params.push(`%${tim.replace(/[\\%_]/g, (c) => `\\${c}`)}%`);
    dkTim = `(t.name ILIKE $${params.length} OR t.customer ILIKE $${params.length})`;
  }
  const demR = await q(
    `SELECT COUNT(*) FILTER (WHERE ${DK_LOC.hoi})::int AS hoi, COUNT(*) FILTER (WHERE ${DK_LOC.bo})::int AS bo,
            COUNT(*) FILTER (WHERE t.enabled)::int AS hoc, COUNT(*) FILTER (WHERE t.is_group)::int AS nhom,
            COUNT(*) FILTER (WHERE NOT t.is_group)::int AS rieng, COUNT(*)::int AS tat_ca
     FROM zalo_threads t WHERE ${dkTim}`,
    params,
  );
  const d = demR[0] || {};
  const dem: Record<LocCuoc, number> = {
    hoi: Number(d.hoi) || 0,
    bo: Number(d.bo) || 0,
    hoc: Number(d.hoc) || 0,
    nhom: Number(d.nhom) || 0,
    rieng: Number(d.rieng) || 0,
    tat_ca: Number(d.tat_ca) || 0,
  };
  const p2 = [...params, o.co, Math.max(0, o.trang - 1) * o.co];
  const rows = await q(
    `SELECT t.*, (SELECT COUNT(*) FROM zalo_messages m WHERE m.thread_id = t.thread_id AND NOT m.digested)::int AS chua_rut
     FROM zalo_threads t WHERE ${DK_LOC[o.loc]} AND ${dkTim}
     ORDER BY t.enabled DESC, t.last_msg_at DESC, t.name, t.thread_id
     LIMIT $${p2.length - 1} OFFSET $${p2.length}`,
    p2,
  );
  return { threads: rows.map(rowToThread), dem };
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
    // Anh đã tự quyết → AI không xét lại cuộc này, và lấy làm ví dụ để lần sau tự quyết giống anh.
    // Tắt thì tin bị xoá, bật lại sẽ kéo lịch sử lại.
    sets.push('ai_checked = true', 'ai_hoi = false', `anh_quyet = '${patch.enabled ? 'hoc' : 'bo'}'`);
    if (!patch.enabled) sets.push('history_done = false');
    // Cuộc AI đang hỏi mà anh chọn học → cho AI đọc lại các tin đã lưu (lúc phân vân AI chưa học gì).
    if (patch.enabled) {
      await q(
        `UPDATE zalo_messages SET digested = false
         WHERE thread_id = $1 AND EXISTS (SELECT 1 FROM zalo_threads WHERE thread_id = $1 AND ai_hoi)`,
        [threadId],
      );
    }
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
  return docTin(`SELECT * FROM zalo_messages WHERE thread_id = $1 AND NOT digested ORDER BY ts DESC LIMIT $2`, threadId, limit);
}

/** Tin gần đây, kể cả tin đã đọc — làm ngữ cảnh khi AI chưa rõ cuộc này là gì. */
export async function tinGanDay(threadId: string, limit = 200): Promise<TinZalo[]> {
  return docTin(`SELECT * FROM zalo_messages WHERE thread_id = $1 ORDER BY ts DESC LIMIT $2`, threadId, limit);
}

async function docTin(sql: string, threadId: string, limit: number): Promise<TinZalo[]> {
  const rows = await q(sql, [threadId, limit]);
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

// ── Nhóm khách (anh Tâm 8/10/2026) ──

/**
 * Ghi danh sách nhóm (kể cả nhóm im lâu) — chỉ tạo/đổi tên, không đụng số tin hay trạng thái học.
 * Nhóm CHƯA xét: `moTa` (số thành viên + mô tả nhóm) tạm để ở ai_note cho AI đọc lúc xét.
 */
export async function ghiDanhSachNhom(ds: Array<{ threadId: string; name: string; moTa?: string }>, now: string): Promise<void> {
  for (const n of ds) {
    await q(
      `INSERT INTO zalo_threads (thread_id, name, is_group, enabled, msg_count, last_msg_at, created_at, ai_note)
       VALUES ($1, $2, true, false, 0, '', $3, $4)
       ON CONFLICT (thread_id) DO UPDATE SET is_group = true,
         name = CASE WHEN EXCLUDED.name <> '' THEN EXCLUDED.name ELSE zalo_threads.name END,
         ai_note = CASE WHEN COALESCE(zalo_threads.ai_checked, false) THEN zalo_threads.ai_note ELSE EXCLUDED.ai_note END`,
      [n.threadId, n.name, now, n.moTa || ''],
    );
  }
}

/** Mã các nhóm đã biết tên — khỏi hỏi lại Zalo thông tin nhóm mỗi đêm. */
export async function nhomDaBiet(): Promise<Set<string>> {
  const r = await q(`SELECT thread_id FROM zalo_threads WHERE is_group AND name <> ''`);
  return new Set(r.map((x) => String(x.thread_id)));
}

/** Ghi chú cho nhóm mà tên không đủ để AI xếp loại — không xét lại theo tên, để AI đọc tin rồi xếp. */
export const CHUA_RO_THEO_TEN = 'Chưa rõ theo tên nhóm';
const DK_CHUA_XET = `NOT COALESCE(ai_checked, false) AND COALESCE(ai_note, '') NOT LIKE '${CHUA_RO_THEO_TEN}%'`;

export const SQL_NHOM_CHUA_XET = `SELECT t.*, 0 AS chua_rut FROM zalo_threads t
  WHERE t.is_group AND ${DK_CHUA_XET} ORDER BY t.last_msg_at DESC LIMIT $1`;

export async function nhomChuaXet(limit: number): Promise<ZaloThread[]> {
  return (await q(SQL_NHOM_CHUA_XET, [limit])).map(rowToThread);
}

/** Ghi kết luận của AI cho một nhóm. Nhóm khách thì bật học + gắn khách; không phải thì để nguyên. */
export async function ghiKetQuaXet(
  threadId: string,
  kq: { aiNote: string; laNhomKhach: boolean; customerId: string; customer: string },
): Promise<void> {
  if (kq.laNhomKhach) {
    await q(
      `UPDATE zalo_threads SET ai_checked = true, ai_note = $2, enabled = true, customer_id = $3, customer = $4
       WHERE thread_id = $1`,
      [threadId, kq.aiNote, kq.customerId, kq.customer],
    );
  } else {
    await q('UPDATE zalo_threads SET ai_checked = true, ai_note = $2 WHERE thread_id = $1', [threadId, kq.aiNote]);
  }
}

/**
 * Nhóm cần kéo lịch sử: nhóm đang học, và nhóm mà tên không đủ để xếp loại (kéo tin về cho AI đọc rồi
 * xếp — anh Tâm 10/10/2026: "chủ động đọc và phân loại").
 */
const DK_CAN_KEO = `(enabled OR COALESCE(ai_note, '') LIKE '${CHUA_RO_THEO_TEN}%') AND NOT COALESCE(history_done, false)`;

export const SQL_NHOM_CAN_KEO = `SELECT t.*, 0 AS chua_rut FROM zalo_threads t
  WHERE t.is_group AND ${DK_CAN_KEO} ORDER BY t.last_msg_at DESC LIMIT $1`;

export async function nhomCanKeoLichSu(limit: number): Promise<ZaloThread[]> {
  return (await q(SQL_NHOM_CAN_KEO, [limit])).map(rowToThread);
}

export async function daKeoLichSu(threadId: string): Promise<void> {
  await q('UPDATE zalo_threads SET history_done = true WHERE thread_id = $1', [threadId]);
}

/** Còn bao nhiêu nhóm chưa xét / chưa kéo lịch sử — để biết lượt đêm còn việc nhóm không. */
export async function demViecNhom(): Promise<{ chuaXet: number; chuaKeo: number }> {
  const r = await q(
    `SELECT COUNT(*) FILTER (WHERE ${DK_CHUA_XET})::int AS chua_xet,
            COUNT(*) FILTER (WHERE ${DK_CAN_KEO})::int AS chua_keo
     FROM zalo_threads WHERE is_group`,
  );
  return { chuaXet: Number(r[0]?.chua_xet) || 0, chuaKeo: Number(r[0]?.chua_keo) || 0 };
}

// ── AI tự đọc mọi cuộc (anh Tâm 10/10/2026: "AI tự đọc sau đó tự học những thứ liên quan đến công
// việc luôn, không cần anh phải duyệt, cái nào phân vân mới tới lượt anh") ──

/** Cuộc có tin chưa rút và chưa bị loại — AI đọc lần lượt, cuộc nhắn gần nhất trước. */
export const SQL_CUOC_CAN_RUT = `SELECT t.*, x.chua_rut FROM zalo_threads t
  JOIN (SELECT thread_id, COUNT(*)::int AS chua_rut FROM zalo_messages WHERE NOT digested GROUP BY thread_id) x
    ON x.thread_id = t.thread_id
  WHERE (t.enabled OR NOT COALESCE(t.ai_checked, false))
  ORDER BY t.last_msg_at DESC LIMIT $1`;

export async function cuocCanRut(limit: number): Promise<ZaloThread[]> {
  return (await q(SQL_CUOC_CAN_RUT, [limit])).map(rowToThread);
}

/** AI thấy là chuyện cá nhân → thôi đọc cuộc này, xoá nội dung đã lưu. Anh bật tay lại được. */
export async function danhDauCaNhan(threadId: string, aiNote: string, tomTat = ''): Promise<void> {
  await q('UPDATE zalo_threads SET enabled = false, ai_checked = true, ai_hoi = false, ai_note = $2, tom_tat = $3 WHERE thread_id = $1', [
    threadId,
    aiNote,
    tomTat,
  ]);
  await q('DELETE FROM zalo_messages WHERE thread_id = $1', [threadId]);
}

/** AI thấy là chuyện công việc → học tiếp; gắn khách nếu cuộc chưa gắn khách nào. */
export async function danhDauCongViec(
  threadId: string,
  o: { aiNote: string; customerId: string; customer: string; tomTat?: string },
): Promise<void> {
  await q(
    `UPDATE zalo_threads SET enabled = true, ai_checked = true, ai_hoi = false, ai_note = $2,
       tom_tat = CASE WHEN $5 <> '' THEN $5 ELSE tom_tat END,
       customer_id = CASE WHEN COALESCE(customer_id, '') = '' THEN $3 ELSE customer_id END,
       customer = CASE WHEN COALESCE(customer_id, '') = '' AND $3 <> '' THEN $4 ELSE customer END
     WHERE thread_id = $1`,
    [threadId, o.aiNote, o.customerId, o.customer, o.tomTat || ''],
  );
}

/**
 * AI phân vân (50:50) → hỏi anh (anh Tâm 10/10/2026). Không học gì, vẫn lưu tin mới; anh chọn Học thì
 * AI đọc lại các tin đã lưu.
 */
export async function hoiAnh(threadId: string, o: { lyDo: string; tomTat: string }): Promise<void> {
  await q('UPDATE zalo_threads SET ai_hoi = true, ai_note = $2, tom_tat = $3 WHERE thread_id = $1', [
    threadId,
    `Hỏi anh: ${o.lyDo || 'AI phân vân có liên quan công việc không'}`,
    o.tomTat,
  ]);
}

/** Những cuộc anh đã tự quyết — đưa cho AI làm ví dụ để lần sau tự quyết giống anh. */
export async function viDuAnhQuyet(limit = 40): Promise<Array<{ ten: string; nhom: boolean; tomTat: string; quyet: 'hoc' | 'bo' }>> {
  const rows = await q(
    `SELECT name, is_group, tom_tat, anh_quyet FROM zalo_threads WHERE anh_quyet IN ('hoc', 'bo')
     ORDER BY last_msg_at DESC LIMIT $1`,
    [limit],
  );
  return rows.map((x) => ({
    ten: String(x.name || ''),
    nhom: !!x.is_group,
    tomTat: String(x.tom_tat || ''),
    quyet: x.anh_quyet === 'hoc' ? 'hoc' : 'bo',
  }));
}

/** Chỉ ghi lời AI về cuộc (vd "chưa rõ — đọc thêm lần sau"), không đổi trạng thái. */
export async function ghiGhiChuAi(threadId: string, aiNote: string): Promise<void> {
  await q('UPDATE zalo_threads SET ai_note = $2 WHERE thread_id = $1', [threadId, aiNote]);
}

/** Số cuộc còn tin AI chưa đọc (chưa bị loại) — cho nút "Đọc & phân loại ngay" biết còn bao nhiêu. */
export async function demCuocCanRut(): Promise<number> {
  const r = await q(
    `SELECT COUNT(DISTINCT m.thread_id)::int AS n FROM zalo_messages m JOIN zalo_threads t ON t.thread_id = m.thread_id
     WHERE NOT m.digested AND (t.enabled OR NOT COALESCE(t.ai_checked, false))`,
  );
  return Number(r[0]?.n) || 0;
}
