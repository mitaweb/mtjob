// Đo thời gian từng request (anh Tâm 12/10/2026: app chậm — đo trước rồi mới tăng tốc).
// Mỗi request mang một "sổ đo" qua AsyncLocalStorage; q() ghi số truy vấn + ms vào đó. Kết quả gắn vào header
// `Server-Timing` (xem trong tab Network của trình duyệt) và log request chậm ra Vercel logs.
import { AsyncLocalStorage } from 'node:async_hooks';

export interface SoDo {
  soTruyVan: number;
  msDb: number;
}

const kho = new AsyncLocalStorage<SoDo>();

/** Chạy `fn` với một sổ đo mới — mọi truy vấn bên trong (kể cả qua await) được ghi vào sổ này. */
export function voiSoDo<T>(so: SoDo, fn: () => T): T {
  return kho.run(so, fn);
}

/** q() gọi sau mỗi truy vấn. Ngoài request (script, test) thì không làm gì. */
export function ghiTruyVan(ms: number): void {
  const so = kho.getStore();
  if (!so) return;
  so.soTruyVan++;
  so.msDb += ms;
}

/** Header Server-Timing: thời gian DB (kèm số truy vấn) và tổng. */
export function headerServerTiming(so: SoDo, tongMs: number): string {
  return `db;dur=${so.msDb.toFixed(0)};desc="${so.soTruyVan} truy van", total;dur=${tongMs.toFixed(0)}`;
}
