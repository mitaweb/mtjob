import { generateJson, geminiAvailable } from './client.js';
import { removeAccents } from '../lib/people.js';
import type { TaskCatalogItem } from '../types.js';

export type ChatIntent = 'log_task' | 'query_stats' | 'help';

export interface ChatExtraction {
  intent: ChatIntent;
  taskCode?: string;
  note?: string;
  reply?: string;
}

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    intent: { type: 'STRING', enum: ['log_task', 'query_stats', 'help'] },
    taskCode: { type: 'STRING' },
    note: { type: 'STRING' },
    reply: { type: 'STRING' },
  },
  required: ['intent'],
};

/** Keyword fallback when Gemini isn't configured/available. */
export function heuristic(message: string, catalog: TaskCatalogItem[]): ChatExtraction {
  const m = removeAccents(message).toLowerCase();
  if (/(diem|xep hang|thu hang|luong|bonus|thuong)/.test(m)) return { intent: 'query_stats' };
  for (const c of catalog) {
    const code = c.code.toLowerCase();
    const nameNoAccent = removeAccents(c.name).toLowerCase();
    if (m.includes(code) || (nameNoAccent.length > 3 && m.includes(nameNoAccent))) {
      return { intent: 'log_task', taskCode: c.code, note: message };
    }
  }
  return { intent: 'help' };
}

export async function interpret(message: string, catalog: TaskCatalogItem[]): Promise<ChatExtraction> {
  if (!geminiAvailable()) return heuristic(message, catalog);
  const codes = catalog.map((c) => `- ${c.code}: ${c.name} (${c.points}đ)`).join('\n');
  const prompt = [
    'Bạn là trợ lý ghi nhận công việc cho một agency marketing. Trả lời JSON đúng schema.',
    '',
    'Danh mục loại task (taskCode: tên):',
    codes,
    '',
    `Tin nhắn của nhân sự: "${message}"`,
    '',
    'Phân loại intent:',
    '- log_task: báo đã hoàn thành 1 task → chọn taskCode khớp nhất trong danh mục; note = mô tả ngắn.',
    '- query_stats: hỏi điểm/thứ hạng/thưởng/lương của bản thân.',
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
