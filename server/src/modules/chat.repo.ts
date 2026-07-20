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

/** Lịch sử chat của một thành viên (mới nhất trước). */
export async function getChatMessages(memberId: string, limit = 50): Promise<ChatMessageRow[]> {
  const rows = await q(
    'SELECT * FROM chat_messages WHERE member_id = $1 ORDER BY created_at DESC LIMIT $2',
    [memberId, limit],
  );
  return rows.map((r) => ({
    id: r.msg_id || '',
    memberId: r.member_id || '',
    role: (r.role === 'model' ? 'model' : 'user') as 'user' | 'model',
    text: r.text || '',
    action: r.action || '',
    createdAt: r.created_at || '',
  }));
}
