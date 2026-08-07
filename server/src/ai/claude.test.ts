import { describe, it, expect } from 'vitest';
import { toClaudeTools, toClaudeMessages, toGeminiParts } from './claude.js';
import type { GeminiContent } from '../gemini/client.js';

describe('toClaudeTools', () => {
  it('chuyển functionDeclarations sang input_schema và hạ chữ thường kiểu dữ liệu', () => {
    const out = toClaudeTools([
      {
        functionDeclarations: [
          {
            name: 'get_ranking',
            description: 'Bảng điểm',
            parameters: {
              type: 'OBJECT',
              properties: { year: { type: 'NUMBER' }, teamId: { type: 'STRING' } },
              required: ['year'],
            },
          },
        ],
      },
    ]);
    expect(out).toEqual([
      {
        name: 'get_ranking',
        description: 'Bảng điểm',
        input_schema: {
          type: 'object',
          properties: { year: { type: 'number' }, teamId: { type: 'string' } },
          required: ['year'],
        },
      },
    ]);
  });

  it('hàm không tham số vẫn có input_schema object rỗng', () => {
    const out = toClaudeTools([{ functionDeclarations: [{ name: 'get_roster', description: 'Nhân sự' }] }]);
    expect(out?.[0].input_schema).toEqual({ type: 'object', properties: {} });
  });

  it('trả undefined khi không có tool', () => {
    expect(toClaudeTools(undefined)).toBeUndefined();
    expect(toClaudeTools([])).toBeUndefined();
  });
});

describe('toClaudeMessages', () => {
  it('bỏ lượt model mở đầu (lời chào bot) vì Claude phải bắt đầu bằng user', () => {
    const contents: GeminiContent[] = [
      { role: 'model', parts: [{ text: 'Chào sếp!' }] },
      { role: 'user', parts: [{ text: 'hôm nay ai vắng?' }] },
    ];
    const msgs = toClaudeMessages(contents);
    expect(msgs).toHaveLength(1);
    expect(msgs[0].role).toBe('user');
  });

  it('ghép functionCall với functionResponse bằng cùng một tool_use_id', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'hôm nay ai vắng?' }] },
      { role: 'model', parts: [{ functionCall: { name: 'get_attendance', args: { date: '2026-07-20' } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'get_attendance', response: { result: 'Nam: vắng' } } }] },
    ];
    const msgs = toClaudeMessages(contents);
    expect(msgs).toHaveLength(3);

    const use = msgs[1].content[0];
    const result = msgs[2].content[0];
    expect(msgs[1].role).toBe('assistant');
    expect(use.type).toBe('tool_use');
    expect(use.name).toBe('get_attendance');
    expect(use.input).toEqual({ date: '2026-07-20' });

    expect(result.type).toBe('tool_result');
    expect(result.tool_use_id).toBe(use.id); // id phải khớp, nếu không Claude trả 400
    expect(result.content).toBe('Nam: vắng');
  });

  it('ghép đúng cặp khi gọi song song nhiều hàm', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'tổng hợp giúp anh' }] },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'get_roster' } },
          { functionCall: { name: 'get_ranking', args: { year: 2026 } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'get_roster', response: { result: 'A, B' } } },
          { functionResponse: { name: 'get_ranking', response: { result: '#1 A' } } },
        ],
      },
    ];
    const msgs = toClaudeMessages(contents);
    const uses = msgs[1].content;
    const results = msgs[2].content;
    expect(uses[0].id).not.toBe(uses[1].id);
    expect(results[0].tool_use_id).toBe(uses[0].id);
    expect(results[1].tool_use_id).toBe(uses[1].id);
  });

  it('bỏ functionResponse mồ côi (không có lệnh gọi tương ứng)', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'hỏi' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'khong_ton_tai', response: { result: 'x' } } }] },
    ];
    const msgs = toClaudeMessages(contents);
    expect(msgs).toHaveLength(1); // lượt thứ hai rỗng sau khi bỏ → không gửi
  });

  // Lỗi thật anh Tâm gặp 4/8/2026: "each tool_use must have a single result.
  // Found multiple `tool_result` blocks with id: call_11_2" → trợ lý đứng hình.
  it('gọi CÙNG một hàm hai lần trong một lượt vẫn ra hai id khác nhau', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'đặt 2 lịch hẹn giúp anh' }] },
      {
        role: 'model',
        parts: [
          { functionCall: { name: 'tao_nhac_hen', args: { at: '2026-08-10T14:00' } } },
          { functionCall: { name: 'tao_nhac_hen', args: { at: '2026-08-11T09:00' } } },
        ],
      },
      {
        role: 'user',
        parts: [
          { functionResponse: { name: 'tao_nhac_hen', response: { result: 'Đã đặt 10/8' } } },
          { functionResponse: { name: 'tao_nhac_hen', response: { result: 'Đã đặt 11/8' } } },
        ],
      },
    ];
    const msgs = toClaudeMessages(contents);
    const uses = msgs[1].content;
    const results = msgs[2].content;

    expect(uses).toHaveLength(2);
    expect(results).toHaveLength(2);
    expect(uses[0].id).not.toBe(uses[1].id);
    // Mỗi id đúng MỘT kết quả — đây là điều kiện Claude bắt buộc.
    expect(new Set(results.map((r: { tool_use_id: string }) => r.tool_use_id)).size).toBe(2);
    // Ghép theo thứ tự: kết quả đầu thuộc lệnh gọi đầu.
    expect(results[0].tool_use_id).toBe(uses[0].id);
    expect(results[0].content).toBe('Đã đặt 10/8');
    expect(results[1].tool_use_id).toBe(uses[1].id);
  });

  it('gọi cùng một hàm ở hai lượt khác nhau thì mỗi lượt tự ghép với kết quả của mình', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'hỏi' }] },
      { role: 'model', parts: [{ functionCall: { name: 'f', args: { n: 1 } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'f', response: { result: 'lần 1' } } }] },
      { role: 'model', parts: [{ functionCall: { name: 'f', args: { n: 2 } } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'f', response: { result: 'lần 2' } } }] },
    ];
    const msgs = toClaudeMessages(contents);
    expect(msgs[2].content[0].tool_use_id).toBe(msgs[1].content[0].id);
    expect(msgs[2].content[0].content).toBe('lần 1');
    expect(msgs[4].content[0].tool_use_id).toBe(msgs[3].content[0].id);
    expect(msgs[4].content[0].content).toBe('lần 2');
  });

  it('lệnh gọi chưa có kết quả (lịch sử đứt gánh) bị bỏ, không để Claude trả 400', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'hỏi' }] },
      { role: 'model', parts: [{ text: 'Để em tra.' }, { functionCall: { name: 'f' } }] },
    ];
    const msgs = toClaudeMessages(contents);
    // Giữ lại phần chữ, bỏ lệnh gọi mồ côi.
    expect(msgs).toHaveLength(2);
    expect(msgs[1].content).toEqual([{ type: 'text', text: 'Để em tra.' }]);
  });

  it('kết quả không bao giờ vơ lấy một lệnh gọi ở lượt sau', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'hỏi' }] },
      { role: 'user', parts: [{ functionResponse: { name: 'f', response: { result: 'mồ côi' } } }] },
      { role: 'model', parts: [{ functionCall: { name: 'f' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'f', response: { result: 'thật' } } }] },
    ];
    const msgs = toClaudeMessages(contents);
    const uses = msgs.flatMap((m) => m.content.filter((b: { type: string }) => b.type === 'tool_use'));
    const results = msgs.flatMap((m) => m.content.filter((b: { type: string }) => b.type === 'tool_result'));
    expect(uses).toHaveLength(1);
    expect(results).toHaveLength(1);
    expect(results[0].content).toBe('thật');
    expect(results[0].tool_use_id).toBe(uses[0].id);
  });

  it('gói response không có trường result thì JSON hoá', () => {
    const contents: GeminiContent[] = [
      { role: 'user', parts: [{ text: 'hỏi' }] },
      { role: 'model', parts: [{ functionCall: { name: 'f' } }] },
      { role: 'user', parts: [{ functionResponse: { name: 'f', response: { a: 1 } } }] },
    ];
    const msgs = toClaudeMessages(contents);
    expect(msgs[2].content[0].content).toBe('{"a":1}');
  });
});

describe('toGeminiParts', () => {
  it('chuyển text và tool_use, bỏ thinking', () => {
    const parts = toGeminiParts([
      { type: 'thinking', thinking: 'suy nghĩ nội bộ' },
      { type: 'text', text: 'Để em tra.' },
      { type: 'tool_use', id: 'toolu_1', name: 'get_roster', input: { teamId: 'ADS' } },
    ]);
    expect(parts).toEqual([
      { text: 'Để em tra.' },
      { functionCall: { name: 'get_roster', args: { teamId: 'ADS' } } },
    ]);
  });

  it('chịu được content rỗng', () => {
    expect(toGeminiParts([])).toEqual([]);
  });
});
