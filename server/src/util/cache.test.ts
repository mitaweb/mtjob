import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { nhoTam, xoaNhoTam, nhoTrongRequest, _batCacheTrongTest } from './cache.js';
import { voiSoDo } from './doThoiGian.js';

// Anh Tâm 12/10/2026: tăng tốc — dữ liệu ít đổi không hỏi DB mỗi lần.
beforeEach(() => _batCacheTrongTest(true));
afterAll(() => _batCacheTrongTest(false));

const dem = () => {
  let n = 0;
  return { lay: async () => ({ lan: ++n, ds: [3, 1, 2] }), soLan: () => n };
};

describe('nhoTam', () => {
  it('trong hạn thì không hỏi lại; hết hạn thì hỏi lại', async () => {
    const d = dem();
    expect((await nhoTam('a', 50, d.lay)).lan).toBe(1);
    expect((await nhoTam('a', 50, d.lay)).lan).toBe(1);
    await new Promise((r) => setTimeout(r, 60));
    expect((await nhoTam('a', 50, d.lay)).lan).toBe(2);
  });

  it('gọi song song → chỉ MỘT lượt xuống DB', async () => {
    const d = dem();
    const kq = await Promise.all([1, 2, 3, 4, 5].map(() => nhoTam('b', 1000, d.lay)));
    expect(d.soLan()).toBe(1);
    expect(kq.every((x) => x.lan === 1)).toBe(true);
  });

  it('có ghi (xoá theo tiền tố) → lần sau đọc bản mới', async () => {
    const d = dem();
    await nhoTam('tv:active', 1000, d.lay);
    await nhoTam('tv:id:1', 1000, d.lay);
    xoaNhoTam('tv:');
    expect((await nhoTam('tv:active', 1000, d.lay)).lan).toBe(3);
  });

  it('xoá trong lúc đang lấy → không lưu bản cũ', async () => {
    let n = 0;
    const cham = () => new Promise<number>((r) => setTimeout(() => r(++n), 20));
    const p = nhoTam('c', 1000, cham);
    xoaNhoTam('c');
    expect(await p).toBe(1);
    expect(await nhoTam('c', 1000, cham)).toBe(2);
  });

  it('trả BẢN SAO — người gọi sort/sửa không làm bẩn cache', async () => {
    const d = dem();
    const a = await nhoTam('d', 1000, d.lay);
    a.ds.sort();
    a.lan = 99;
    expect(await nhoTam('d', 1000, d.lay)).toEqual({ lan: 1, ds: [3, 1, 2] });
  });

  it('lỗi thì không nhớ, lần sau thử lại', async () => {
    let n = 0;
    const loi = async () => {
      n++;
      if (n === 1) throw new Error('db lỗi');
      return n;
    };
    await expect(nhoTam('e', 1000, loi)).rejects.toThrow('db lỗi');
    expect(await nhoTam('e', 1000, loi)).toBe(2);
  });
});

describe('nhoTrongRequest', () => {
  it('trong một request chỉ tính một lần; request khác tính lại; ngoài request gọi thẳng', async () => {
    const d = dem();
    await voiSoDo({ soTruyVan: 0, msDb: 0 }, async () => {
      const [x, y] = await Promise.all([nhoTrongRequest('k', d.lay), nhoTrongRequest('k', d.lay)]);
      expect([x.lan, y.lan]).toEqual([1, 1]);
    });
    await voiSoDo({ soTruyVan: 0, msDb: 0 }, async () => {
      expect((await nhoTrongRequest('k', d.lay)).lan).toBe(2);
    });
    expect((await nhoTrongRequest('k', d.lay)).lan).toBe(3);
  });
});
