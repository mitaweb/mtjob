export const vnd = (n: number): string => Math.round(n || 0).toLocaleString('vi-VN') + 'đ';

export function currentYm(): { year: number; month: number } {
  const d = new Date();
  return { year: d.getFullYear(), month: d.getMonth() + 1 };
}
