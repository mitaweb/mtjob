// Giao diện chung cho các nhà cung cấp AI (Gemini / Claude).
// Dùng lại đúng shape của Gemini để assistant.service.ts (runToolLoop) không phải sửa:
// mọi provider nhận/trả cùng kiểu part, tự lo việc chuyển đổi sang định dạng riêng.
export type { GeminiPart as AiPart, GeminiContent as AiContent, GenerateRequest as AiRequest } from '../gemini/client.js';

import type { GenerateRequest, GeminiPart } from '../gemini/client.js';

export type AiProviderName = 'gemini' | 'claude';

export interface AiProvider {
  name: AiProviderName;
  /** Hội thoại nhiều lượt + function calling. Trả về parts của candidate đầu. */
  generateContent(req: GenerateRequest): Promise<GeminiPart[]>;
}

/** Khai báo 1 hàm cho AI gọi (định dạng Gemini — provider tự chuyển đổi). */
export interface FunctionDeclaration {
  name: string;
  description: string;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parameters?: any;
}
