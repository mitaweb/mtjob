import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import type { CatalogItem } from '../lib/types';

interface Suggestion {
  taskCode: string;
  taskName: string;
  points: number;
}
interface ChatResponse {
  reply: string;
  action: string;
  suggestion?: Suggestion;
  catalog?: CatalogItem[];
}
interface Msg {
  role: 'user' | 'bot';
  text: string;
  res?: ChatResponse;
}

export default function Chat() {
  const [msgs, setMsgs] = useState<Msg[]>([
    { role: 'bot', text: 'Chào bạn! Mình giúp ghi nhận task (vd "đã đăng 1 bài post") hoặc xem điểm/thưởng. Bạn cần gì?' },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function send(message: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const res = await api<ChatResponse>('/chat', { body: { message, ...extra } });
      setMsgs((m) => [...m, { role: 'bot', text: res.reply, res }]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: `⚠️ ${(e as Error).message}` }]);
    } finally {
      setBusy(false);
    }
  }

  async function onSubmit() {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: 'user', text }]);
    setInput('');
    await send(text);
  }

  async function confirmTask(s: Suggestion) {
    setMsgs((m) => [...m, { role: 'user', text: `✔️ Xác nhận: ${s.taskName}` }]);
    await send('', { confirmTaskCode: s.taskCode });
  }

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)]">
      <div className="flex-1 overflow-y-auto space-y-3 pr-1">
        {msgs.map((m, i) => (
          <div key={i} className={`flex ${m.role === 'user' ? 'justify-end' : 'justify-start'}`}>
            <div
              className={`max-w-[85%] rounded-2xl px-4 py-2 whitespace-pre-wrap ${
                m.role === 'user' ? 'bg-brand-600 text-white' : 'bg-white border border-slate-200'
              }`}
            >
              {m.text}
              {m.res?.action === 'confirm_task' && m.res.suggestion && (
                <button className="btn-primary mt-2 w-full" onClick={() => confirmTask(m.res!.suggestion!)}>
                  Xác nhận ghi nhận (+{m.res.suggestion.points}đ)
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-3 flex gap-2">
        <input
          className="input"
          placeholder='Vd: "đã đăng 1 bài post" hoặc "điểm của tôi tháng này"'
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
        />
        <button className="btn-primary" onClick={onSubmit} disabled={busy}>
          Gửi
        </button>
      </div>
    </div>
  );
}
