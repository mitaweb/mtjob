import { q } from '../db/client.js';

export interface ChatMessageRow {
  id: string;
  memberId: string;
  role: 'user' | 'model';
  text: string;
  action: string;
  createdAt: string;
}

export async function addChatMessages(rows: ChatMessageRow[]): Promise<void> {
  if (rows.length === 0) return;
  const params: unknown[] = [];
  const values = rows.map((r) => {
    const i = params.length;
    params.push(r.id, r.memberId, r.role, r.text, r.action, r.createdAt);
    return `($${i + 1},$${i + 2},$${i + 3},$${i + 4},$${i + 5},$${i + 6})`;
  });
  await q(
    `INSERT INTO chat_messages (msg_id, member_id, role, text, action, created_at) VALUES ${values.join(',')}`,
    params,
  );
}

/**
 * Lịch sử chat của một thành viên (mới nhất trước).
 *
 * `before`: chỉ lấy tin CŨ HƠN mốc này — con trỏ để cuộn lên tải thêm. Trả về `limit`
 * tin gần nhất thay vì cả cuộc trò chuyện: câu trả lời của trợ lý thường dài, tải sáu
 * mươi tin mỗi lần mở trang là cả trăm KB trong khi chỉ cần vài tin cuối.
 *
 * Index `chat_messages_member_idx (member_id, created_at DESC)` phục vụ đúng kiểu này.
 */
export async function getChatMessages(
  memberId: string,
  limit = 50,
  before?: string,
): Promise<ChatMessageRow[]> {
  const rows = before
    ? await q(
        `SELECT * FROM chat_messages WHERE member_id = $1 AND created_at < $2
         ORDER BY created_at DESC LIMIT $3`,
        [memberId, before, limit],
      )
    : await q('SELECT * FROM chat_messages WHERE member_id = $1 ORDER BY created_at DESC LIMIT $2', [
        memberId,
        limit,
      ]);
  return rows.map((r) => ({
    id: r.msg_id || '',
    memberId: r.member_id || '',
    role: (r.role === 'model' ? 'model' : 'user') as 'user' | 'model',
    text: r.text || '',
    action: r.action || '',
    createdAt: r.created_at || '',
  }));
}
