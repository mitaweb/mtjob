import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { Skeleton } from './ui';

// Dung lượng hệ thống — anh Tâm 1/8/2026: "chỉ cần con số để theo dõi server thôi,
// không cần chính xác gì cả".
//
// Nên chỉ hai con số: database và kho ảnh. Thanh phần trăm để nhìn phát biết còn bao
// nhiêu chỗ — Neon gói miễn phí cho 512MB, chạm trần thì database chuyển sang chỉ đọc
// và cả app dừng ghi mà không báo trước.

interface Storage {
  dbBytes: number;
  dbLimitBytes: number;
  blob: { bytes: number; files: number; available: boolean };
}

/** 1536 → "1,5 KB". Bội số 1024 như hệ điều hành. */
function dungLuong(bytes: number): string {
  if (!bytes) return '0';
  const don = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let n = bytes;
  while (n >= 1024 && i < don.length - 1) {
    n /= 1024;
    i += 1;
  }
  return `${n.toFixed(n < 10 && i > 0 ? 1 : 0).replace('.', ',')} ${don[i]}`;
}

export default function StorageCard() {
  const [data, setData] = useState<Storage | null>(null);
  const [err, setErr] = useState('');

  useEffect(() => {
    api<Storage>('/admin/storage')
      .then(setData)
      .catch((e) => setErr((e as Error).message));
  }, []);

  if (err) return null; // hỏng thì im lặng, không chắn các mục khác của trang Quản trị

  const pct = data ? Math.min(100, Math.round((data.dbBytes / data.dbLimitBytes) * 100)) : 0;
  const mau = pct >= 85 ? 'bg-rose-500' : pct >= 60 ? 'bg-amber-400' : 'bg-emerald-500';

  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Dung lượng hệ thống</h2>
      {!data ? (
        <Skeleton className="h-12 w-full" />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-slate-600">Cơ sở dữ liệu</span>
            <span className="text-sm">
              <b className="text-slate-800">{dungLuong(data.dbBytes)}</b>
              <span className="text-slate-400">
                {' '}
                / {dungLuong(data.dbLimitBytes)} ({pct}%)
              </span>
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${mau}`} style={{ width: `${Math.max(1, pct)}%` }} />
          </div>
          {pct >= 85 && (
            <p className="mt-1.5 text-xs text-rose-600">
              ⚠️ Sắp đầy. Chạm trần thì hệ thống chỉ còn đọc được, không ghi được việc mới.
            </p>
          )}

          {data.blob.available && (
            <div className="mt-3 flex flex-wrap items-baseline justify-between gap-2 border-t border-slate-100 pt-3">
              <span className="text-sm text-slate-600">Ảnh &amp; tài liệu đính kèm</span>
              <span className="text-sm">
                <b className="text-slate-800">{dungLuong(data.blob.bytes)}</b>
                <span className="text-slate-400"> · {data.blob.files} tệp</span>
              </span>
            </div>
          )}
        </>
      )}
    </div>
  );
}
