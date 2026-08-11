import { useEffect, useState } from 'react';
import { onLoading } from '../lib/api';

/** Phản hồi toàn cục khi đang gọi API: thanh chạy trên đỉnh + chữ "Vui lòng chờ…". */
export default function GlobalLoading() {
  const [active, setActive] = useState(false);
  const [show, setShow] = useState(false); // overlay hiện sau 300ms để request nhanh không nhấp nháy

  useEffect(() => onLoading((n) => setActive(n > 0)), []);
  useEffect(() => {
    if (!active) {
      setShow(false);
      return;
    }
    const t = setTimeout(() => setShow(true), 300);
    return () => clearTimeout(t);
  }, [active]);

  return (
    <>
      {active && (
        <div className="fixed inset-x-0 top-0 z-[100] h-0.5 overflow-hidden bg-brand-100">
          <div className="loadingbar h-full w-1/3 bg-brand-600" />
        </div>
      )}
      {show && (
        <div className="fixed bottom-5 left-1/2 z-[100] -translate-x-1/2 flex items-center gap-2 rounded-full bg-ink/90 px-4 py-2 text-sm text-white shadow-card">
          <span className="h-4 w-4 animate-spin rounded-full border-2 border-white/30 border-t-white" />
          Vui lòng chờ…
        </div>
      )}
    </>
  );
}
