// Provider Gemini — bọc client REST sẵn có, không đổi hành vi.
import { generateContent, generateContentStream, geminiAvailable } from '../gemini/client.js';
import type { AiProvider } from './types.js';

export const geminiProvider: AiProvider = {
  name: 'gemini',
  generateContent,
  generateContentStream,
};

export { geminiAvailable };
