// Vòng lặp gọi hàm của trợ lý: cái gì được coi là CÂU TRẢ LỜI, cái gì chỉ là lời dẫn.
//
// Anh Tâm 7/9/2026: "trợ lý đã trả lời câu cũ nhưng chat câu mới thì bị lại ghi nhận cả
// nội dung câu cũ". Nguyên nhân: mỗi lượt gọi hàm, AI hay nói vài câu dẫn ("để em kiểm tra
// CRM…") trước khi gọi hàm. Chữ đó được stream thẳng ra màn hình rồi cộng dồn vào câu trả
// lời cuối — và lượt sau lại bị gửi ngược lên làm lịch sử.
import { describe, it, expect, vi, beforeEach } from 'vitest';

const generateContentStream = vi.fn();
const generateContent = vi.fn();

vi.mock('../ai/index.js', () => ({
  getProvider: async () => ({ name: 'claude', generateContent, generateContentStream }),
  aiAvailable: async () => true,
}));

const { runToolLoop } = await import('./assistant.service.js');

/** Một lượt trả lời của AI: nói `text` rồi (tuỳ chọn) gọi hàm `goiHam`. */
function luot(text: string, goiHam?: string) {
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return async (_req: unknown, onDelta: (d: string) => void): Promise<any[]> => {
    if (text) onDelta(text);
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const parts: any[] = [];
    if (text) parts.push({ text });
    if (goiHam) parts.push({ functionCall: { name: goiHam, args: {} } });
    return parts;
  };
}

const TOOL = {
  declaration: { name: 'tim_khach', description: 'tra CRM' },
  run: async () => 'Không tìm thấy khách này trong CRM.',
};

beforeEach(() => {
  generateContentStream.mockReset();
  generateContent.mockReset();
});

describe('runToolLoop', () => {
  it('chỉ trả về chữ của lượt CUỐI, không dính lời dẫn giữa chừng', async () => {
    generateContentStream
      .mockImplementationOnce(luot('Để em kiểm tra trong CRM đã…', 'tim_khach'))
      .mockImplementationOnce(luot('Đã đặt nhắc: "Gọi chị Thảo" — 08/09/2026 lúc 09:00.'));

    const answer = await runToolLoop({
      system: 's',
      question: 'tạo nhắc hẹn ngày mai gọi c Thảo',
      history: [],
      tools: [TOOL],
      onEvent: () => undefined,
    });

    expect(answer).toBe('Đã đặt nhắc: "Gọi chị Thảo" — 08/09/2026 lúc 09:00.');
    expect(answer).not.toContain('kiểm tra trong CRM');
  });

  it('bắn sự kiện reset để màn hình xoá lời dẫn đã stream', async () => {
    generateContentStream
      .mockImplementationOnce(luot('Để em kiểm tra trong CRM đã…', 'tim_khach'))
      .mockImplementationOnce(luot('Đã đặt nhắc xong.'));

    const evs: string[] = [];
    await runToolLoop({
      system: 's',
      question: 'q',
      history: [],
      tools: [TOOL],
      onEvent: (e) => evs.push(e.type),
    });

    // Lời dẫn được stream ra (text) → phải có reset trước khi câu trả lời thật tới.
    expect(evs).toContain('reset');
    expect(evs.indexOf('reset')).toBeLessThan(evs.lastIndexOf('text'));
  });

  it('lượt gọi hàm mà AI KHÔNG nói gì thì không cần reset', async () => {
    generateContentStream
      .mockImplementationOnce(luot('', 'tim_khach'))
      .mockImplementationOnce(luot('Xong rồi anh.'));

    const evs: string[] = [];
    const answer = await runToolLoop({
      system: 's',
      question: 'q',
      history: [],
      tools: [TOOL],
      onEvent: (e) => evs.push(e.type),
    });

    expect(answer).toBe('Xong rồi anh.');
    expect(evs).not.toContain('reset');
  });

  it('trả lời thẳng không gọi hàm thì giữ nguyên chữ, không reset', async () => {
    generateContentStream.mockImplementationOnce(luot('Tháng 8 anh có 21 ngày công.'));

    const evs: string[] = [];
    const answer = await runToolLoop({
      system: 's',
      question: 'q',
      history: [],
      tools: [TOOL],
      onEvent: (e) => evs.push(e.type),
    });

    expect(answer).toBe('Tháng 8 anh có 21 ngày công.');
    expect(evs).not.toContain('reset');
  });

  it('nhiều lượt gọi hàm liên tiếp thì reset từng lượt', async () => {
    generateContentStream
      .mockImplementationOnce(luot('Để em tra khách…', 'tim_khach'))
      .mockImplementationOnce(luot('Chưa thấy, em tra tiếp…', 'tim_khach'))
      .mockImplementationOnce(luot('Câu trả lời cuối.'));

    const evs: string[] = [];
    const answer = await runToolLoop({
      system: 's',
      question: 'q',
      history: [],
      tools: [TOOL],
      onEvent: (e) => evs.push(e.type),
    });

    expect(answer).toBe('Câu trả lời cuối.');
    expect(evs.filter((e) => e === 'reset')).toHaveLength(2);
  });
});
