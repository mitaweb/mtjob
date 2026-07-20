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
