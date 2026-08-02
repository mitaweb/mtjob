import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { SkeletonRows } from './ui';

// Dung lượng hệ thống — anh Tâm 1/8/2026 muốn nhìn được trong màn Quản trị.
//
// Không chỉ để biết cho vui: Neon gói miễn phí cho 512MB, chạm trần thì database chuyển
// sang chỉ đọc và cả app dừng ghi mà không báo trước. Bảng nào phình cũng hiện ra để dọn
// đúng chỗ thay vì đoán.

interface Storage {
  dbBytes: number;
  dbLimitBytes: number;
  tables: Array<{ name: string; bytes: number; rows: number }>;
  blob: { bytes: number; files: number; available: boolean };
}

/** 1536 → "1,5 KB". Dùng bội số 1024 như hệ điều hành. */
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

/** Tên bảng trong DB → tên tiếng Việt cho dễ đọc. */
const TEN_VI: Record<string, string> = {
  tasks: 'Công việc',
  chat_messages: 'Lịch sử chat',
  brain_chunks: 'Kho tri thức',
  brain_documents: 'Tài liệu',
  brain_profiles: 'Hồ sơ khách 360°',
  notifications: 'Thông báo',
  attendance: 'Chấm công',
  customer_notes: 'Lưu ý khách hàng',
  customer_note_history: 'Lịch sử lưu ý KH',
  finance_entries: 'Thu chi',
  payroll: 'Bảng lương',
  requests: 'Đơn từ',
  customers: 'Khách hàng',
  members: 'Nhân sự',
  kpi_entries: 'Số liệu KPI',
  appointments: 'Lịch hẹn',
};

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
  const lonNhat = data?.tables[0]?.bytes || 1;

  return (
    <div className="card">
      <h2 className="mb-2 font-semibold">Dung lượng hệ thống</h2>
      {!data ? (
        <SkeletonRows rows={3} />
      ) : (
        <>
          <div className="flex flex-wrap items-baseline justify-between gap-2">
            <span className="text-sm text-slate-600">Cơ sở dữ liệu</span>
            <span className="text-sm">
              <b className="text-slate-800">{dungLuong(data.dbBytes)}</b>
              <span className="text-slate-400"> / {dungLuong(data.dbLimitBytes)} ({pct}%)</span>
            </span>
          </div>
          <div className="mt-1.5 h-2 w-full overflow-hidden rounded-full bg-slate-100">
            <div className={`h-full rounded-full ${mau}`} style={{ width: `${Math.max(1, pct)}%` }} />
          </div>
          {pct >= 85 && (
            <p className="mt-1.5 text-xs text-rose-600">
              ⚠️ Sắp đầy. Chạm trần thì hệ thống chỉ còn đọc được, không ghi được việc mới — cần nâng gói
              hoặc dọn bớt dữ liệu cũ.
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

          <details className="mt-3">
            <summary className="cursor-pointer text-sm text-slate-500">Xem chi tiết từng phần</summary>
            <div className="mt-2 space-y-1.5">
              {data.tables.map((t) => (
                <div key={t.name} className="text-sm">
                  <div className="flex items-baseline justify-between gap-2">
                    <span className="text-slate-700">
                      {TEN_VI[t.name] || t.name}
                      {TEN_VI[t.name] && <span className="ml-1 text-xs text-slate-400">{t.name}</span>}
                    </span>
                    <span className="whitespace-nowrap text-slate-500">
                      {dungLuong(t.bytes)}
                      {t.rows > 0 && <span className="text-slate-400"> · {t.rows.toLocaleString('vi-VN')} dòng</span>}
                    </span>
                  </div>
                  {/* So tương đối với bảng lớn nhất — nhìn phát biết cái nào đang phình. */}
                  <div className="mt-0.5 h-1 w-full overflow-hidden rounded-full bg-slate-100">
                    <div className="h-full rounded-full bg-brand-400" style={{ width: `${(t.bytes / lonNhat) * 100}%` }} />
                  </div>
                </div>
              ))}
              <p className="pt-1 text-xs text-slate-400">
                Số dòng là ước lượng do Postgres thống kê nền, có thể lệch chút so với thực tế.
              </p>
            </div>
          </details>
        </>
      )}
    </div>
  );
}
