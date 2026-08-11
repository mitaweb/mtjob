import { createContext, useCallback, useContext, useMemo, useRef, useState, type ReactNode } from 'react';

// Toast toàn cục: thông báo thành công/lỗi nhất quán, tự tắt, bấm để đóng.
// Dùng: const toast = useToast(); toast.success('Đã lưu ✅'); toast.error('Lỗi…');

type Kind = 'success' | 'error' | 'info';

interface ToastItem {
  id: number;
  kind: Kind;
  text: string;
}

export interface ToastApi {
  success: (text: string) => void;
  error: (text: string) => void;
  info: (text: string) => void;
}

const noop = () => undefined;
const ToastCtx = createContext<ToastApi>({ success: noop, error: noop, info: noop });

export function useToast(): ToastApi {
  return useContext(ToastCtx);
}

const KIND_CLS: Record<Kind, string> = {
  success: 'bg-emerald-600 text-white',
  error: 'bg-rose-600 text-white',
  info: 'bg-ink/95 text-white',
};

const KIND_ICON: Record<Kind, string> = { success: '✓', error: '✕', info: 'ℹ' };

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<ToastItem[]>([]);
  const nextId = useRef(1);

  const dismiss = useCallback((id: number) => {
    setToasts((l) => l.filter((t) => t.id !== id));
  }, []);

  const push = useCallback(
    (kind: Kind, text: string) => {
      if (!text) return;
      const id = nextId.current++;
      setToasts((l) => [...l.slice(-3), { id, kind, text }]); // tối đa 4 toast cùng lúc
      window.setTimeout(() => dismiss(id), kind === 'error' ? 6000 : 3500);
    },
    [dismiss],
  );

  const apiValue = useMemo<ToastApi>(
    () => ({
      success: (t) => push('success', t),
      error: (t) => push('error', t),
      info: (t) => push('info', t),
    }),
    [push],
  );

  return (
    <ToastCtx.Provider value={apiValue}>
      {children}
      <div className="fixed bottom-16 left-1/2 z-[110] flex w-[calc(100%-2rem)] max-w-md -translate-x-1/2 flex-col items-center gap-2">
        {toasts.map((t) => (
          <button
            key={t.id}
            type="button"
            onClick={() => dismiss(t.id)}
            className={`flex w-fit max-w-full items-start gap-2 rounded-xl px-4 py-2.5 text-left text-sm shadow-card ${KIND_CLS[t.kind]}`}
          >
            <span aria-hidden className="mt-0.5 text-xs opacity-90">{KIND_ICON[t.kind]}</span>
            <span className="break-words">{t.text}</span>
          </button>
        ))}
      </div>
    </ToastCtx.Provider>
  );
}
