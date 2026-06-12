export const vnd = (n: number): string => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';

/** 195 → "3g15p", 45 → "45p" */
export function fmtMin(min: number): string {
  const m = Math.max(0, Math.round(min || 0));
  const h = Math.floor(m / 60);
  const r = m % 60;
  if (h === 0) return `${r}p`;
  return r === 0 ? `${h}g` : `${h}g${String(r).padStart(2, '0')}p`;
}

export function currentYm(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
