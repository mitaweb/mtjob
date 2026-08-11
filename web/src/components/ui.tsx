import type { ReactNode } from 'react';

// Component nhỏ dùng chung — nguồn duy nhất cho màu trạng thái & khung trang,
// để các trang không tự chế màu (red/rose, green/emerald lẫn lộn).

export type BadgeVariant = 'success' | 'warn' | 'danger' | 'info' | 'neutral';

const BADGE_CLS: Record<BadgeVariant, string> = {
  success: 'bg-emerald-100 text-emerald-700',
  warn: 'bg-amber-100 text-amber-700',
  danger: 'bg-rose-100 text-rose-600',
  info: 'bg-brand-100 text-brand-700',
  neutral: 'bg-brand-200 text-ink-soft',
};

export function Badge({ variant = 'neutral', children }: { variant?: BadgeVariant; children: ReactNode }) {
  return <span className={`inline-block rounded-full px-2 py-0.5 text-xs ${BADGE_CLS[variant]}`}>{children}</span>;
}

/** Đầu trang chuẩn: tiêu đề + mô tả + slot hành động bên phải. */
export function PageHeader({
  title,
  desc,
  action,
}: {
  title: ReactNode;
  desc?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="card flex items-center justify-between gap-3">
      <div>
        <h1 className="text-lg font-bold">{title}</h1>
        {desc ? <p className="text-sm text-ink-muted">{desc}</p> : null}
      </div>
      {action}
    </div>
  );
}

/** Trạng thái rỗng nhất quán cho danh sách/bảng. */
export function EmptyState({ icon = '📭', text }: { icon?: string; text: ReactNode }) {
  return (
    <div className="py-6 text-center text-sm text-ink-muted">
      <div aria-hidden className="mb-1 text-2xl">{icon}</div>
      {text}
    </div>
  );
}

/** Khối skeleton khi đang tải (dùng kèm class .skeleton trong index.css). */
export function Skeleton({ className = '' }: { className?: string }) {
  return <div className={`skeleton ${className}`} />;
}

/** Bộ skeleton dạng danh sách/bảng: n dòng. */
export function SkeletonRows({ rows = 4 }: { rows?: number }) {
  return (
    <div className="space-y-2">
      {Array.from({ length: rows }, (_, i) => (
        <div key={i} className="skeleton h-9 w-full" />
      ))}
    </div>
  );
}
