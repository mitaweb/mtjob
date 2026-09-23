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

const { runToolLoop, laViecCu } = await import('./assistant.service.js');

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

// Anh Tâm 17/9/2026: trợ lý báo "đã đặt" mà không gọi hàm nào — chốt chặn ở máy chủ.
const { runToolLoopChan, nhanLaDaGhi, laHamGhi } = await import('./assistant.service.js');

const GHI = {
  declaration: { name: 'create_reminder', description: 'đặt nhắc' },
  run: async () => 'Đã đặt nhắc hẹn "Gặp anh Bằng" — một lần ngày 2026-09-18 lúc 14:00.',
};

describe('nhanLaDaGhi', () => {
  it('bắt được các câu nhận đã làm, kể cả chữ có dấu đứng đầu', () => {
    expect(nhanLaDaGhi('✅ Đã đặt: "Gọi chị Hồng Thanh" — 18/09 09:00.')).toBe(true);
    expect(nhanLaDaGhi('Em đã tắt hai lịch anh Tú, chị Thảo.')).toBe(true);
    expect(nhanLaDaGhi('Em đặt ngay.')).toBe(true);
  });
  it('không bắt nhầm câu nói thật hoặc câu thuật dữ liệu', () => {
    expect(nhanLaDaGhi('Em chưa đặt được vì hàm chỉ nhận một mốc giờ.')).toBe(false);
    expect(nhanLaDaGhi('Khách đã thanh toán 20.000.000đ ngày 12/9.')).toBe(false);
    expect(nhanLaDaGhi('Tháng 8 anh có 21 ngày công.')).toBe(false);
  });
});

describe('laHamGhi', () => {
  it('phân biệt hàm ghi và hàm đọc', () => {
    expect(laHamGhi('create_reminder')).toBe(true);
    expect(laHamGhi('collect_receivable')).toBe(true);
    expect(laHamGhi('cancel_reminder')).toBe(true);
    expect(laHamGhi('list_reminders')).toBe(false);
    expect(laHamGhi('get_member_tasks')).toBe(false);
  });
});

describe('runToolLoopChan', () => {
  it('nói "đã đặt" mà không gọi hàm → bắt làm lại, lần hai gọi hàm thật thì nhận', async () => {
    generateContentStream
      .mockImplementationOnce(luot('✅ Đã đặt nhắc "Gặp anh Bằng" 18/09 14:00.')) // bịa
      .mockImplementationOnce(luot('', 'create_reminder')) // làm lại: gọi hàm thật
      .mockImplementationOnce(luot('✅ Đã đặt nhắc "Gặp anh Bằng" — 18/09 lúc 14:00.'));

    const evs: string[] = [];
    const answer = await runToolLoopChan({
      system: 's',
      question: 'Ngày mai 14h gặp anh Bằng',
      history: [],
      tools: [GHI],
      onEvent: (e) => evs.push(e.type),
    });

    expect(answer).toContain('Đã đặt nhắc');
    expect(evs).toContain('reset'); // chữ bịa đã stream ra phải bị xoá
    expect(generateContentStream).toHaveBeenCalledTimes(3);
    // Lời nhắc làm lại phải nằm trong câu hỏi gửi đi lần hai.
    const req2 = generateContentStream.mock.calls[1][0];
    expect(JSON.stringify(req2.contents)).toContain('KHÔNG gọi hàm nào');
  });

  it('bịa hai lần liền → thay bằng câu cảnh báo, không để câu bịa tới người dùng', async () => {
    generateContentStream
      .mockImplementationOnce(luot('Đã đặt rồi anh.'))
      .mockImplementationOnce(luot('Em đã đặt lại rồi ạ.'));

    const answer = await runToolLoopChan({ system: 's', question: 'q', history: [], tools: [GHI], onEvent: () => undefined });
    expect(answer).toContain('CHƯA ghi được gì');
    expect(answer).not.toContain('Đã đặt rồi');
  });

  it('gọi hàm ghi thật ngay lần đầu thì không làm lại', async () => {
    generateContentStream
      .mockImplementationOnce(luot('', 'create_reminder'))
      .mockImplementationOnce(luot('Đã đặt nhắc xong.'));

    const answer = await runToolLoopChan({ system: 's', question: 'q', history: [], tools: [GHI], onEvent: () => undefined });
    expect(answer).toBe('Đã đặt nhắc xong.');
    expect(generateContentStream).toHaveBeenCalledTimes(2);
  });

  it('câu trả lời thường (không nhận đã làm) đi thẳng, không tốn lượt gọi thêm', async () => {
    generateContentStream.mockImplementationOnce(luot('Tháng 8 anh có 21 ngày công.'));
    const answer = await runToolLoopChan({ system: 's', question: 'q', history: [], tools: [GHI], onEvent: () => undefined });
    expect(answer).toBe('Tháng 8 anh có 21 ngày công.');
    expect(generateContentStream).toHaveBeenCalledTimes(1);
  });
});

// Anh Tâm 22/9/2026: đặt lịch mới mà trợ lý còn đặt LẠI lịch của lượt trước.
describe('laViecCu', () => {
  const cu = ['sáng mai 10h gọi chốt với chị Huyền Viettiles', 'Chị Hiền Viettiles e nhé, sửa k phải Huyền Viettiles'];
  const hoi = 'T6 lúc 15:30 gặp anh Nguyên Gateway ở highland 15 song hành';

  it('tham số trùng câu vừa nhắn → việc mới', () => {
    expect(laViecCu({ title: 'Gặp anh Nguyên Gateway tại Highland 15 Song Hành', atTime: '15:30' }, hoi, cu)).toBe(false);
  });

  it('không trùng câu mới mà trùng câu nhắn cũ → việc cũ', () => {
    expect(laViecCu({ title: 'Gọi chốt với chị Hiền Viettiles', atTime: '10:00', onDate: '2026-09-22' }, hoi, cu)).toBe(true);
    expect(laViecCu({ title: 'Huyền Viettiles' }, hoi, cu)).toBe(true);
  });

  it('không trùng gì cả thì không kết luận; số/ngày giờ không tính là từ khoá', () => {
    expect(laViecCu({ title: 'Nộp thuế', atTime: '10:00', onDate: '2026-09-22' }, hoi, cu)).toBe(false);
    expect(laViecCu({}, hoi, cu)).toBe(false);
    expect(laViecCu({ title: 'Gọi chốt' }, hoi, cu)).toBe(false); // toàn từ thường
  });

  it('câu xác nhận ngắn ("ừ") không có từ khoá → vẫn coi là việc cũ (chặn hay không do có lệnh ghi mới)', () => {
    expect(laViecCu({ title: 'Gọi chốt với chị Hiền Viettiles' }, 'ừ đặt đi', cu)).toBe(true);
  });
});

describe('runToolLoop — chặn làm lại việc của lượt trước', () => {
  const ghi: string[] = [];
  const TAO = {
    declaration: { name: 'create_reminder', description: 'đặt nhắc' },
    run: async (a: Record<string, unknown>) => {
      ghi.push(String(a.title));
      return `Đã đặt nhắc hẹn "${a.title}".`;
    },
  };
  const history = [
    { role: 'user' as const, text: 'sáng mai 10h gọi chốt với chị Hiền Viettiles' },
    { role: 'model' as const, text: '✅ Gọi chốt với chị Hiền Viettiles — 22/09 10:00.' },
  ];
  const goiHai = (a: string, b: string) => async () => [
    { functionCall: { name: 'create_reminder', args: { title: a, atTime: '15:30' } } },
    { functionCall: { name: 'create_reminder', args: { title: b, atTime: '10:00' } } },
  ];

  beforeEach(() => {
    ghi.length = 0;
  });

  it('đặt việc mới + đặt lại việc cũ trong cùng lượt → việc cũ KHÔNG chạy, hàm nhận câu từ chối', async () => {
    let ketQua: unknown[] = [];
    generateContent
      .mockImplementationOnce(goiHai('Gặp anh Nguyên Gateway tại Highland', 'Gọi chốt với chị Hiền Viettiles'))
      .mockImplementationOnce(async (req: { contents: Array<{ parts: Array<{ functionResponse?: { response: { result: unknown } } }> }> }) => {
        ketQua = req.contents.at(-1)!.parts.map((p) => p.functionResponse!.response.result);
        return [{ text: 'Đã đặt Gateway.' }];
      });
    await runToolLoop({ system: '', question: 'T6 15:30 gặp anh Nguyên Gateway ở highland', history, tools: [TAO] });
    expect(ghi).toEqual(['Gặp anh Nguyên Gateway tại Highland']);
    expect(String(ketQua[1])).toMatch(/^KHÔNG CHẠY/);
  });

  it('thứ tự ngược (việc cũ gọi trước trong cùng lượt) vẫn chặn', async () => {
    generateContent
      .mockImplementationOnce(goiHai('Gọi chốt với chị Hiền Viettiles', 'Gặp anh Nguyên Gateway'))
      .mockImplementationOnce(async () => [{ text: 'ok' }]);
    await runToolLoop({ system: '', question: 'T6 15:30 gặp anh Nguyên Gateway', history, tools: [TAO] });
    expect(ghi).toEqual(['Gặp anh Nguyên Gateway']);
  });

  it('anh chỉ nhắn "ừ" để xác nhận việc cũ → không có lệnh ghi việc mới → vẫn chạy', async () => {
    generateContent
      .mockImplementationOnce(async () => [{ functionCall: { name: 'create_reminder', args: { title: 'Gọi chốt với chị Hiền Viettiles', boQuaTrung: true } } }])
      .mockImplementationOnce(async () => [{ text: 'ok' }]);
    await runToolLoop({ system: '', question: 'ừ, đặt chồng giờ đi', history, tools: [TAO] });
    expect(ghi).toEqual(['Gọi chốt với chị Hiền Viettiles']);
  });

  it('câu nhắn cũ gửi lên được đánh dấu là đã xử lý xong', async () => {
    let contents: Array<{ role: string; parts: Array<{ text?: string }> }> = [];
    generateContent.mockImplementationOnce(async (req: { contents: typeof contents }) => {
      contents = req.contents;
      return [{ text: 'ok' }];
    });
    await runToolLoop({ system: '', question: 'câu mới', history, tools: [TAO] });
    expect(String(contents[0].parts[0].text).startsWith('[Lượt trước — đã xử lý xong')).toBe(true);
    expect(contents[1].parts[0].text).toBe(history[1].text); // câu của model giữ nguyên
    expect(contents[2].parts[0].text).toBe('câu mới');
  });
});
