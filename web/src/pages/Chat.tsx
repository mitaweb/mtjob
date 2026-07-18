import { useEffect, useMemo, useRef, useState } from 'react';
import { api, cachedGet } from '../lib/api';
import { useAuth } from '../lib/auth';
import { fmtMin } from '../lib/format';
import type { Assignee, CatalogItem, DoingTask, TodoTask } from '../lib/types';

interface Suggestion {
  taskCode?: string;
  taskName: string;
  points?: number;
  note?: string; // mô tả cụ thể (vd "X Salon")
}
interface ChatResponse {
  reply: string;
  action: string;
  suggestion?: Suggestion;
  assignee?: { id: string; fullName: string };
  catalog?: CatalogItem[];
}
interface Msg {
  role: 'user' | 'bot';
  text: string;
  res?: ChatResponse;
}

const ASSIGN_ROLES = ['leader', 'director', 'admin'];
const DATA_ROLES = ['director', 'admin'];

function greeting(role?: string): string {
  if (role && DATA_ROLES.includes(role))
    return 'Chào sếp! 📌 Giao việc: gõ @tên người + mô tả việc (vd "@nam lên ads cho SP A"). 📊 Hỏi dữ liệu: "hôm nay ai chưa chấm công", "ai điểm cao nhất tháng này", "đơn nào đang chờ duyệt", "tổng phải thu bao nhiêu".';
  if (role === 'leader')
    return 'Chào bạn! 📌 Giao việc: gõ @tên người + mô tả việc. ▶️ Hoặc bắt đầu/ghi nhận task. 📊 Hỏi dữ liệu của bạn: "tháng này tôi làm mấy công", "điểm tháng trước của tôi".';
  return 'Chào bạn! Mình có thể: ▶️ bắt đầu task ("bắt đầu lên ads"), ✅ ghi nhận task đã xong ("đã đăng bài page"), 📊 trả lời về dữ liệu của bạn ("tháng trước tôi được bao nhiêu điểm", "đơn nghỉ của tôi duyệt chưa"). Bạn cần gì?';
}

export default function Chat() {
  const { user } = useAuth();
  const canAssign = !!user && ASSIGN_ROLES.includes(user.role);

  const [msgs, setMsgs] = useState<Msg[]>([{ role: 'bot', text: greeting(user?.role) }]);
  const [input, setInput] = useState('');
  const [busy, setBusy] = useState(false);
  const [doing, setDoing] = useState<DoingTask[]>([]);
  const [todo, setTodo] = useState<TodoTask[]>([]);
  const [showDoing, setShowDoing] = useState(false);
  const [assignees, setAssignees] = useState<Assignee[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [startingTodo, setStartingTodo] = useState<TodoTask | null>(null);
  const [pickQuery, setPickQuery] = useState('');
  const endRef = useRef<HTMLDivElement>(null);

  async function loadDoing() {
    try {
      const r = await api<{ tasks: DoingTask[] }>('/tasks/doing');
      setDoing(r.tasks);
    } catch {
      /* ignore */
    }
  }
  async function loadTodo() {
    try {
      const r = await api<{ tasks: TodoTask[] }>('/tasks/todo');
      setTodo(r.tasks);
    } catch {
      /* ignore */
    }
  }
  useEffect(() => {
    loadDoing();
    loadTodo();
    cachedGet<{ catalog: CatalogItem[] }>('/tasks/catalog')
      .then((r) => setCatalog(r.catalog))
      .catch(() => setCatalog([]));
  }, []);
  useEffect(() => {
    if (canAssign) {
      api<{ assignees: Assignee[] }>('/tasks/assignees')
        .then((r) => setAssignees(r.assignees))
        .catch(() => setAssignees([]));
    }
  }, [canAssign]);
  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [msgs, busy]);

  // Gợi ý @tên khi đang gõ một tag ở cuối ô nhập (chỉ leader/giám đốc).
  const mentionQuery = useMemo(() => {
    if (!canAssign) return null;
    const m = input.match(/@([a-zA-Z0-9_.]*)$/);
    return m ? m[1].toLowerCase() : null;
  }, [input, canAssign]);
  const mentionMatches = useMemo(() => {
    if (mentionQuery === null) return [];
    const qy = mentionQuery;
    return assignees
      .filter((a) => a.username.toLowerCase().includes(qy) || a.fullName.toLowerCase().includes(qy))
      .slice(0, 6);
  }, [mentionQuery, assignees]);

  const pickMatches = useMemo(() => {
    const qy = pickQuery.trim().toLowerCase();
    if (!qy) return catalog.slice(0, 40);
    return catalog.filter((c) => c.name.toLowerCase().includes(qy) || c.code.toLowerCase().includes(qy)).slice(0, 40);
  }, [pickQuery, catalog]);

  function pickMention(a: Assignee) {
    setInput((cur) => cur.replace(/@([a-zA-Z0-9_.]*)$/, `@${a.username} `));
  }

  async function send(message: string, extra: Record<string, unknown> = {}) {
    setBusy(true);
    try {
      // Gửi kèm 10 lượt gần nhất để AI hiểu câu hỏi nối tiếp ("còn tháng 5 thì sao?").
      const history = msgs
        .slice(-10)
        .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text.slice(0, 2000) }));
      const res = await api<ChatResponse>('/chat', { body: { message, history, ...extra } });
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
    await send('', { confirmTaskCode: s.taskCode, note: s.note });
  }

  async function confirmStart(s: Suggestion) {
    setMsgs((m) => [...m, { role: 'user', text: `▶️ Bắt đầu: ${s.taskName}` }]);
    await send('', { confirmStartTaskCode: s.taskCode, note: s.note });
  }

  async function confirmAssign(s: Suggestion, assignee: { id: string; fullName: string }) {
    setMsgs((m) => [...m, { role: 'user', text: `📌 Giao "${s.taskName}" cho ${assignee.fullName}` }]);
    await send('', { confirmAssign: true, assigneeId: assignee.id, assignTaskName: s.taskName });
  }

  // Người nhận chọn loại task (Ads/Content/SEO) → todo chuyển sang đang làm.
  async function beginTodo(t: TodoTask, item: CatalogItem) {
    try {
      await api(`/tasks/${t.id}/start`, { method: 'POST', body: { taskCode: item.code } });
      setMsgs((m) => [
        ...m,
        { role: 'bot', text: `▶️ Đã bắt đầu "${t.taskName}" — loại: ${item.name} (+${item.points}đ khi xong). Xong việc bấm "⏳ Đang làm".` },
      ]);
      setStartingTodo(null);
      setPickQuery('');
      await Promise.all([loadTodo(), loadDoing()]);
    } catch (e) {
      setMsgs((m) => [...m, { role: 'bot', text: `⚠️ ${(e as Error).message}` }]);
    }
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
    <div className="flex flex-col h-[calc(100vh-7rem)]">
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
              {m.res?.action === 'confirm_assign' && m.res.suggestion && m.res.assignee && (
                <button
                  className="btn-primary mt-2 w-full"
                  onClick={() => confirmAssign(m.res!.suggestion!, m.res!.assignee!)}
                >
                  📌 Giao cho {m.res.assignee.fullName}
                </button>
              )}
            </div>
          </div>
        ))}
        {busy && (
          <div className="flex justify-start">
            <div className="max-w-[85%] rounded-2xl border border-slate-200 bg-white px-4 py-2 text-slate-500">
              Đang xem dữ liệu
              <span className="inline-flex w-6 justify-start">
                <span className="animate-pulse">…</span>
              </span>
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      {/* Việc được giao — Cần làm */}
      {todo.length > 0 && (
        <div className="mt-3 rounded-2xl border border-sky-200 bg-sky-50 p-3">
          <div className="mb-1.5 text-sm font-semibold text-sky-800">📌 Cần làm ({todo.length})</div>
          <ul className="space-y-2">
            {todo.map((t) => (
              <li key={t.id} className="flex items-center justify-between gap-2 rounded-xl bg-white px-3 py-2">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-slate-800">{t.taskName}</div>
                  <div className="text-xs text-slate-500">
                    {t.assignedBy ? `${t.assignedBy} · ` : ''}chọn loại việc khi bắt đầu
                  </div>
                </div>
                <button className="btn-primary shrink-0 text-sm" onClick={() => setStartingTodo(t)}>
                  ▶️ Bắt đầu
                </button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="mt-3 space-y-2">
        <div className="relative flex gap-2">
          {/* Gợi ý @tên người nhận việc */}
          {mentionMatches.length > 0 && (
            <div className="absolute bottom-full left-0 z-10 mb-1 w-72 max-w-[90%] overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
              {mentionMatches.map((a) => (
                <button
                  key={a.id}
                  type="button"
                  className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-slate-50"
                  onClick={() => pickMention(a)}
                >
                  <span className="font-medium text-slate-800">{a.fullName}</span>
                  <span className="text-xs text-slate-400">@{a.username}</span>
                </button>
              ))}
            </div>
          )}
          <input
            className="input"
            placeholder={
              canAssign
                ? 'Giao việc: "@nam lên ads cho SP A" · hoặc "bắt đầu lên ads", "điểm của tôi"'
                : 'Vd: "bắt đầu lên ads" · "đã đăng bài page" · "điểm của tôi"'
            }
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

      {/* Chọn loại task khi bắt đầu việc được giao */}
      {startingTodo && (
        <div
          className="fixed inset-0 z-50 bg-black/40 flex items-end sm:items-center justify-center p-4"
          onClick={() => {
            setStartingTodo(null);
            setPickQuery('');
          }}
        >
          <div className="card w-full max-w-md max-h-[80vh] flex flex-col" onClick={(e) => e.stopPropagation()}>
            <div className="flex items-center justify-between mb-1">
              <h2 className="font-semibold text-sm">Chọn loại việc — {startingTodo.taskName}</h2>
              <button
                className="btn-ghost px-2 py-1 text-sm"
                onClick={() => {
                  setStartingTodo(null);
                  setPickQuery('');
                }}
              >
                ✕
              </button>
            </div>
            <p className="text-xs text-slate-500 mb-2">Điểm tính theo loại việc bạn chọn (hệ thống Ads/Content/SEO).</p>
            <input
              className="input mb-2"
              placeholder="Tìm loại việc…"
              value={pickQuery}
              onChange={(e) => setPickQuery(e.target.value)}
              autoFocus
            />
            <ul className="divide-y overflow-y-auto">
              {pickMatches.map((c) => (
                <li key={c.code}>
                  <button
                    className="flex w-full items-center justify-between gap-2 py-2 text-left hover:bg-slate-50"
                    onClick={() => beginTodo(startingTodo, c)}
                  >
                    <span className="text-sm text-slate-800">{c.name}</span>
                    <span className="text-xs text-slate-400 shrink-0">+{c.points}đ</span>
                  </button>
                </li>
              ))}
              {pickMatches.length === 0 && (
                <li className="py-3 text-sm text-slate-500">Không tìm thấy loại việc phù hợp.</li>
              )}
            </ul>
          </div>
        </div>
      )}

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
                Chưa có task nào đang làm. Nhắn bot "bắt đầu + tên việc" hoặc bấm "Bắt đầu" ở mục Cần làm nhé.
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
