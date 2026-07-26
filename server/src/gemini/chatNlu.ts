import { generateJson, geminiAvailable } from './client.js';
import { removeAccents } from '../lib/people.js';
import type { TaskCatalogItem } from '../types.js';

// `log_task` giữ lại trong kiểu để chịu được dữ liệu cũ, nhưng KHÔNG còn trong schema —
// mọi việc nhắc trong chat đều là BẮT ĐẦU, hoàn thành thì bấm nút ở mục "Đang làm".
export type ChatIntent = 'log_task' | 'start_task' | 'query_stats' | 'help';

export interface ChatExtraction {
  intent: ChatIntent;
  taskCode?: string;
  note?: string;
  reply?: string;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['start_task', 'query_stats', 'help'] },
    taskCode: { type: 'STRING' },
    note: { type: 'STRING' },
    reply: { type: 'STRING' },
  },
  required: ['intent'],
};

/**
 * Keyword fallback when Gemini isn't configured/available.
 *
 * Nhắc tới một loại việc là BẮT ĐẦU việc đó — không còn phân biệt bắt đầu/đã xong.
 * Anh Tâm chốt 26/7/2026: mọi việc đi qua Bắt đầu → Hoàn thành để có giờ làm thật.
 */
export function heuristic(message: string, catalog: TaskCatalogItem[]): ChatExtraction {
  const m = removeAccents(message).toLowerCase();
  if (/(diem|xep hang|thu hang|luong|bonus|thuong|gio lam)/.test(m)) return { intent: 'query_stats' };
  for (const c of catalog) {
    const code = c.code.toLowerCase();
    const nameNoAccent = removeAccents(c.name).toLowerCase();
    if (m.includes(code) || (nameNoAccent.length > 3 && m.includes(nameNoAccent))) {
      return { intent: 'start_task', taskCode: c.code, note: message };
    }
  }
  return { intent: 'help' };
}

export async function interpret(
  message: string,
  catalog: TaskCatalogItem[],
  teamId = '',
): Promise<ChatExtraction> {
  // Catalog đã được caller sắp task của team lên đầu → heuristic tự ưu tiên team.
  if (!(await geminiAvailable())) return heuristic(message, catalog);
  const codes = catalog.map((c) => `- ${c.code}: ${c.name} (${c.points}đ)`).join('\n');
  const teamLine = teamId
    ? `Nhân sự thuộc team ${teamId} — khi câu nói khớp nhiều task, ƯU TIÊN task của team đó (các task được liệt kê ĐẦU danh sách).`
    : '';
  const prompt = [
    'Bạn là trợ lý ghi nhận công việc cho một agency marketing. Trả lời JSON đúng schema.',
    teamLine,
    '',
    'Danh mục loại task (taskCode: tên):',
    codes,
    '',
    `Tin nhắn của nhân sự: "${message}"`,
    '',
    'Phân loại intent:',
    '- start_task: nhắc tới MỘT loại việc trong danh mục — dù nói là sắp làm, đang làm hay đã xong.',
    '  Nhân sự bấm hoàn thành ở nơi khác nên ở đây chỉ cần nhận ra ĐANG NÓI VỀ VIỆC NÀO.',
    '  → chọn taskCode khớp nhất.',
    '  note = phần MÔ TẢ CỤ THỂ kèm theo (tên khách hàng / dự án / nội dung), KHÔNG lặp lại loại việc.',
    '  Vd "đăng post X Salon" → taskCode = (đăng post), note = "X Salon". Không có mô tả riêng thì để note rỗng.',
    '- query_stats: hỏi điểm/thứ hạng/thưởng/lương/giờ làm của bản thân.',
    '- help: còn lại. reply = câu trả lời ngắn gọn, thân thiện (tiếng Việt).',
    '',
    'Ví dụ (tên việc → chọn taskCode tương ứng trong danh mục ở trên):',
    '- "bắt đầu lên ads cho X Spa" → start_task, taskCode của "Lên Ads", note="X Spa".',
    '- "đăng bài page cho Y Coffee" → start_task, taskCode của "Đăng bài page", note="Y Coffee".',
    '- "dg bai page cho Y Coffee" (viết tắt/sai chính tả) → vẫn hiểu: start_task, taskCode của "Đăng bài page", note="Y Coffee".',
    '- "post 1 ảnh với cả content cho Z Shop" (nhiều việc 1 câu) → chọn việc CHÍNH nhắc ĐẦU TIÊN: start_task, taskCode của "Thiết kế post 1 ảnh", note="Z Shop".',
    '- "cách lên ads thế nào?" → help (hỏi CÁCH làm, không phải báo việc — đừng nhầm với start_task).',
    '- "đã đăng bài page cho X chưa?" → help (CÂU HỎI, không phải báo việc).',
    '- "viết giúp em caption cho bài spa" → help (nhờ hỗ trợ chuyên môn).',
    'QUAN TRỌNG: câu có dấu ? hoặc từ để hỏi (ai/gì/sao/bao nhiêu/khi nào/chưa/không) LUÔN là help,',
    'kể cả khi trong câu có nhắc tên một loại việc.',
    '- "em sắp làm video quảng cáo" → start_task, taskCode của "Video quảng cáo".',
  ].join('\n');

  try {
    // NLU ghi việc luôn dùng flash (nhanh/rẻ) kể cả khi admin chọn model khác cho Q&A.
    const parsed = (await generateJson(prompt, SCHEMA, 'gemini-2.5-flash')) as ChatExtraction;
    if (!parsed.intent) return heuristic(message, catalog);
    return parsed;
  } catch (e) {
    console.warn('[chatNlu] Gemini lỗi, dùng heuristic:', (e as Error).message);
    return heuristic(message, catalog);
  }
}
