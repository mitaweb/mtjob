import { generateJson, geminiAvailable } from './client.js';
import { removeAccents } from '../lib/people.js';
import type { TaskCatalogItem } from '../types.js';

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
    intent: { type: 'STRING', enum: ['log_task', 'start_task', 'query_stats', 'help'] },
    taskCode: { type: 'STRING' },
    note: { type: 'STRING' },
    reply: { type: 'STRING' },
  },
  required: ['intent'],
};

const START_WORDS = /(bat dau|dang lam|bat tay|chuan bi lam|se lam|vao viec)/;
const DONE_WORDS = /(xong|hoan thanh|da lam|da dang|da viet|da thiet ke|vua lam|vua xong|da len)/;

/** Keyword fallback when Gemini isn't configured/available. */
export function heuristic(message: string, catalog: TaskCatalogItem[]): ChatExtraction {
  const m = removeAccents(message).toLowerCase();
  if (/(diem|xep hang|thu hang|luong|bonus|thuong|gio lam)/.test(m)) return { intent: 'query_stats' };
  for (const c of catalog) {
    const code = c.code.toLowerCase();
    const nameNoAccent = removeAccents(c.name).toLowerCase();
    if (m.includes(code) || (nameNoAccent.length > 3 && m.includes(nameNoAccent))) {
      const intent: ChatIntent = START_WORDS.test(m) && !DONE_WORDS.test(m) ? 'start_task' : 'log_task';
      return { intent, taskCode: c.code, note: message };
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
    '- start_task: báo BẮT ĐẦU/đang bắt tay vào làm 1 task (vd "bắt đầu lên ads", "giờ em làm video") → chọn taskCode khớp nhất; note = mô tả ngắn.',
    '- log_task: báo ĐÃ HOÀN THÀNH 1 task (vd "đã đăng bài page", "xong video quảng cáo") → chọn taskCode khớp nhất; note = mô tả ngắn.',
    '- query_stats: hỏi điểm/thứ hạng/thưởng/lương/giờ làm của bản thân.',
    '- help: còn lại. reply = câu trả lời ngắn gọn, thân thiện (tiếng Việt).',
  ].join('\n');

  try {
    const parsed = (await generateJson(prompt, SCHEMA)) as ChatExtraction;
    if (!parsed.intent) return heuristic(message, catalog);
    return parsed;
  } catch {
    return heuristic(message, catalog);
  }
}
