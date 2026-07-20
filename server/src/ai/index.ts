// Chọn nhà cung cấp AI theo cấu hình trong Quản trị.
import { getConfig } from '../config.js';
import { geminiProvider, geminiAvailable } from './gemini.js';
import { claudeProvider, claudeAvailable } from './claude.js';
import type { AiProvider, AiProviderName } from './types.js';

export type { AiProvider, AiProviderName } from './types.js';
export { geminiProvider, claudeProvider };

async function configuredName(): Promise<AiProviderName> {
  try {
    const c = await getConfig();
    return c.aiProvider === 'claude' ? 'claude' : 'gemini';
  } catch {
    return 'gemini';
  }
}

/** Nhà cung cấp đang chọn, hoặc null nếu chưa cấu hình (caller degrade êm, không crash). */
export async function getProvider(): Promise<AiProvider | null> {
  const name = await configuredName();
  if (name === 'claude') return (await claudeAvailable()) ? claudeProvider : null;
  return (await geminiAvailable()) ? geminiProvider : null;
}

/** Có trợ lý AI dùng được không (bất kể nhà cung cấp nào). */
export async function aiAvailable(): Promise<boolean> {
  return (await getProvider()) !== null;
}

/** Tên nhà cung cấp đang chọn — cho UI Quản trị hiển thị. */
export async function currentProviderName(): Promise<AiProviderName> {
  return configuredName();
}
