// Ô cài đặt gập được (anh Tâm 10/11/2026: "các ô này em cho có nút bấm sổ cửa sổ ra cho gọn, chiếm nhiều màn hình nhưng
// ít khi dùng tới"). Mặc định GẬP — chỉ hiện một dòng tiêu đề; bấm để sổ ra. Nhớ trạng thái trên máy này.
import { useState, type ReactNode } from 'react';

function doc(khoa: string): boolean {
  try {
    return localStorage.getItem(`o_gap:${khoa}`) === '1';
  } catch {
    return false;
  }
}

export default function OGap({ khoa, tieuDe, moTa, children }: { khoa: string; tieuDe: ReactNode; moTa?: ReactNode; children: ReactNode }) {
  const [mo, setMo] = useState(() => doc(khoa));
  const doi = () => {
    const x = !mo;
    setMo(x);
    try {
      localStorage.setItem(`o_gap:${khoa}`, x ? '1' : '0');
    } catch {
      /* trình duyệt chặn lưu — bỏ qua */
    }
  };
  if (!mo)
    return (
      <button type="button" className="card flex w-full items-center justify-between gap-3 py-3 text-left hover:bg-brand-50" onClick={doi} aria-expanded={false}>
        <span className="min-w-0">
          <span className="font-semibold">{tieuDe}</span>
          {moTa && <span className="ml-2 text-sm text-ink-muted">{moTa}</span>}
        </span>
        <span className="shrink-0 text-sm text-ocean-700">▼ Mở</span>
      </button>
    );
  return (
    <div className="space-y-1">
      <button type="button" className="flex w-full items-center justify-end px-2 text-sm text-ocean-700 hover:underline" onClick={doi} aria-expanded>
        ▲ Thu gọn
      </button>
      {children}
    </div>
  );
}
