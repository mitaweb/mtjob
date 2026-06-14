import { useState, type ReactNode } from 'react';

interface Props {
  onClick: () => Promise<unknown> | unknown;
  children: ReactNode;
  busyLabel?: string;
  className?: string;
  disabled?: boolean;
}

/** Nút tự hiện spinner + "Đang gửi…" trong lúc xử lý (chống double-click). */
export default function AsyncButton({ onClick, children, busyLabel = 'Đang gửi…', className = 'btn-primary', disabled }: Props) {
  const [busy, setBusy] = useState(false);
  async function handle() {
    if (busy) return;
    setBusy(true);
    try {
      await onClick();
    } finally {
      setBusy(false);
    }
  }
  return (
    <button type="button" className={className} disabled={busy || disabled} onClick={handle}>
      {busy ? (
        <>
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/40 border-t-white" />
          {busyLabel}
        </>
      ) : (
        children
      )}
    </button>
  );
}
