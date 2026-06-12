import { useEffect, useRef, useState } from 'react';
import { api } from '../lib/api';
import { fmtMin } from '../lib/format';
import type { CatalogItem, DoingTask } from '../lib/types';

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
    {
      role: 'bot',
      text: 'Chào bạn! Mình có thể: ▶️ bắt đầu task ("bắt đầu lên ads"), ✅ ghi nhận task đã xong ("đã đăng bài page"), hoặc xem điểm/giờ làm. Bạn cần gì?',
    },
  ]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState<DoingTask[]>([]);
  const [showDoing, setShowDoing] = useState(false);
  const endRef = useRef<HTMLDivElement>(null);

  async function loadDoing() {
    try {
      const r = await api<{ tasks: DoingTask[] }>('/tasks/doing');
      setDoing(r.tasks);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    loadDoing();
  }, []);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs]);

  async function send(message: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      const res = await api<ChatResponse>('/chat', { body: { message, ...extra } });
      setMsgs((m) => [...m, { role: 'bot', text: res.reply, res }]);
      if (res.action === 'task_started' || res.action === 'task_logged') await loadDoing();
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
    setMsgs((m) => [...m, { role: 'user', text: `✔️ Xác nhận hoàn thành: ${s.taskName}` }]);
    await send('', { confirmTaskCode: s.taskCode });
  }

  async function confirmStart(s: Suggestion) {
    setMsgs((m) => [...m, { role: 'user', text: `▶️ Bắt đầu: ${s.taskName}` }]);
    await send('', { confirmStartTaskCode: s.taskCode });
  }

  async function completeDoing(t: DoingTask) {
    try {
      const r = await api<{ points: number }>(`/tasks/${t.id}/complete`, { method: 'POST' });
      setMsgs((m) => [
        ...m,
        { role: 'bot', text: `✅ Đã hoàn thành "${t.taskName}" sau ${fmtMin(t.elapsedMinutes)} (+${r.points}đ). 💪` },
      ]);
      await loadDoing();
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: `⚠️ ${(e as Error).message}` }]);
    }
  }

  const hm = (iso: string) =>
    new Date(iso).toLocaleTimeString('vi-VN', { hour: '2-digit', minute: '2-digit' });

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
                  ✅ Xác nhận hoàn thành (+{m.res.suggestion.points}đ)
                </button>
              )}
              {m.res?.action === 'confirm_start' && m.res.suggestion && (
                <button className="btn-primary mt-2 w-full" onClick={() => confirmStart(m.res!.suggestion!)}>
                  ▶️ Bắt đầu làm (+{m.res.suggestion.points}đ khi xong)
                </button>
              )}
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <div className="mt-3 space-y-2">
        <div className="flex gap-2">
          <input
            className="input"
            placeholder='Vd: "bắt đầu lên ads" · "đã đăng bài page" · "điểm của tôi"'
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => e.key === 'Enter' && onSubmit()}
          />
          <button className="btn-primary" onClick={onSubmit} disabled={busy}>
            Gửi
          </button>
        </div>
        <button
          className={`btn w-full ${doing.length ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-slate-100 text-slate-500'}`}
          onClick={() => {
            loadDoing();
            setShowDoing(true);
          }}
        >
          ⏳ Đang làm ({doing.length}) — bấm để hoàn thành
        </button>
      </div>

      {showDoing && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => setShowDoing(false)}
        >
          <div className="card w-full max-w-md max-h-[70vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-2">
              <h2 className="font-semibold">⏳ Task đang làm ({doing.length})</h2>
              <button className="btn-ghost px-2 py-1 text-sm" onClick={() => setShowDoing(false)}>
                ✕ Đóng
              </button>
            </div>
            {doing.length === 0 && (
              <p className="text-sm text-slate-500">
                Chưa có task nào đang làm. Nhắn bot "bắt đầu + tên việc" để bắt đầu nhé.
              </p>
            )}
            <ul className="divide-y">
              {doing.map((t) => (
                <li key={t.id} className="py-2 flex items-center justify-between gap-2">
                  <div>
                    <div className="font-medium text-sm">{t.taskName}</div>
                    <div className="text-xs text-slate-500">
                      Bắt đầu {hm(t.startedAt)} · đã {fmtMin(t.elapsedMinutes)} · +{t.points}đ khi xong
                    </div>
                  </div>
                  <button className="btn-primary whitespace-nowrap text-sm" onClick={() => completeDoing(t)}>
                    ✅ Hoàn thành
                  </button>
                </li>
              ))}
            </ul>
          </div>
        </div>
      )}
    </div>
  );
}
