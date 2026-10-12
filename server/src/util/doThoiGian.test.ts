import { describe, it, expect } from 'vitest';
import { voiSoDo, ghiTruyVan, headerServerTiming, type SoDo } from './doThoiGian.js';

// Anh Tâm 12/10/2026: app chậm — đo số truy vấn + thời gian DB cho từng request.
describe('sổ đo thời gian', () => {
  it('ghi đúng vào sổ của request, kể cả qua await; ngoài request thì bỏ qua', async () => {
    const a: SoDo = { soTruyVan: 0, msDb: 0 };
    const b: SoDo = { soTruyVan: 0, msDb: 0 };
    await Promise.all([
      voiSoDo(a, async () => {
        ghiTruyVan(5);
        await new Promise((r) => setTimeout(r, 5));
        ghiTruyVan(7);
      }),
      voiSoDo(b, async () => {
        await new Promise((r) => setTimeout(r, 1));
        ghiTruyVan(3);
      }),
    ]);
    ghiTruyVan(100); // không thuộc request nào
    expect(a).toEqual({ soTruyVan: 2, msDb: 12 });
    expect(b).toEqual({ soTruyVan: 1, msDb: 3 });
  });

  it('header Server-Timing', () => {
    expect(headerServerTiming({ soTruyVan: 12, msDb: 84.4 }, 230.6)).toBe('db;dur=84;desc="12 truy van", total;dur=231');
  });
});
