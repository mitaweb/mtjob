import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { api, apiStream, cachedGet } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import Reminders from '../components/Reminders';
import { useToast } from '../components/Toaster';
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
  customers?: string[]; // khi action = ask_customer
  starting?: boolean; // true = đang bắt đầu việc, false = báo đã xong
}
interface Msg {
  role: 'user' | 'bot';
  text: string;
  res?: ChatResponse;
  question?: string; // câu hỏi dẫn tới câu trả lời này — dùng khi lưu vào kho
  saved?: boolean; // đã chốt vào kho tri thức chưa
  streaming?: boolean; // đang viết dở, sẽ thay bằng bản hoàn chỉnh khi xong
}

/** Tên hàm trợ lý đang chạy → câu tiếng Việt hiện lúc chờ. */
const TOOL_VI: Record<string, string> = {
  get_customer_profile: 'Đang xem hồ sơ khách hàng',
  search_knowledge: 'Đang tra kho tri thức',
  get_roster: 'Đang xem danh sách nhân sự',
  get_attendance: 'Đang xem chấm công',
  get_ranking: 'Đang xem bảng điểm',
  get_pending_requests: 'Đang xem đơn chờ duyệt',
  get_finance_summary: 'Đang xem thu chi',
  get_member_tasks: 'Đang xem công việc',
  get_customer_contact: 'Đang tra liên hệ khách',
  get_my_score: 'Đang xem điểm của bạn',
  get_my_attendance: 'Đang xem chấm công của bạn',
  get_my_tasks: 'Đang xem việc của bạn',
  get_my_requests: 'Đang xem đơn từ của bạn',
  get_task_catalog: 'Đang xem danh mục việc',
  create_reminder: 'Đang đặt nhắc hẹn',
};

const ASSIGN_ROLES = ['leader', 'director', 'admin'];
const DATA_ROLES = ['director', 'admin'];

function greeting(role?: string): string {
  if (role && DATA_ROLES.includes(role))
    return 'Chào sếp! Em giúp được:\n📊 Hỏi dữ liệu — "hôm nay ai chưa chấm công?", "ai điểm cao nhất tháng này?", "tổng phải thu bao nhiêu?"\n🧠 Thông tin khách — "khách X Salon tình hình sao rồi?"\n✍️ Tư vấn chuyên môn — "X Salon ngày mai nên đăng bài gì?", "kế hoạch content tháng 8"\n📌 Giao việc — gõ @tên người + mô tả việc';
  if (role === 'leader')
    return 'Chào bạn! 📌 Giao việc: gõ @tên người + mô tả việc. ▶️ Ghi nhận task. 💬 Hỏi mình bất cứ điều gì: dữ liệu của bạn, thông tin khách hàng, hay nhờ viết content/ý tưởng quảng cáo.';
  return 'Chào bạn! Mình giúp được:\n▶️ Ghi nhận việc — "bắt đầu lên ads", "đã đăng bài page"\n📊 Dữ liệu của bạn — "tháng trước tôi được bao nhiêu điểm?", "đơn nghỉ duyệt chưa?"\n🧠 Thông tin khách — "khách Ba Spa cần gì?"\n✍️ Hỗ trợ chuyên môn — "viết giúp caption cho bài spa", "ý tưởng content tháng 8"\nBạn cần gì?';
}

/** Chữ in đậm **…** và nghiêng *…* trong một dòng. */
function inlineFmt(text: string, keyBase: string): ReactNode[] {
  return text.split(/(\*\*[^*\n]+\*\*|\*[^*\n]+\*)/g).map((p, i) => {
    const k = `${keyBase}-${i}`;
    if (p.startsWith('**') && p.endsWith('**') && p.length > 4) {
      return <strong key={k}>{p.slice(2, -2)}</strong>;
    }
    if (p.startsWith('*') && p.endsWith('*') && p.length > 2) {
      return <em key={k}>{p.slice(1, -1)}</em>;
    }
    return <span key={k}>{p}</span>;
  });
}

/**
 * Hiển thị câu trả lời của AI cho dễ đọc: AI viết theo kiểu markdown
 * (**đậm**, gạch đầu dòng) — nếu in thô sẽ thấy đầy dấu sao.
 * Tự dựng phần tử React nên không có rủi ro chèn HTML.
 */
function RichText({ text }: { text: string }) {
  const lines = text.split('\n');
  const blocks: ReactNode[] = [];
  let bullets: string[] = [];

  const flushBullets = (key: string) => {
    if (bullets.length === 0) return;
    blocks.push(
      <ul key={key} className="my-1 list-disc space-y-0.5 pl-5">
        {bullets.map((b, i) => (
          <li key={i}>{inlineFmt(b, `${key}-${i}`)}</li>
        ))}
      </ul>,
    );
    bullets = [];
  };

  lines.forEach((raw, i) => {
    const line = raw.trimEnd();
    const bullet = line.match(/^\s*[-•*]\s+(.*)$/);
    if (bullet) {
      bullets.push(bullet[1]!);
      return;
    }
    flushBullets(`ul-${i}`);
    if (!line.trim()) {
      blocks.push(<div key={`sp-${i}`} className="h-2" />);
      return;
    }
    blocks.push(
      <p key={`p-${i}`} className="my-0.5">
        {inlineFmt(line, `p-${i}`)}
      </p>,
    );
  });
  flushBullets('ul-end');
  return <>{blocks}</>;
}

/**
 * Trạng thái chờ. Ưu tiên `stage` — việc trợ lý ĐANG làm thật (máy chủ đẩy về qua stream);
 * chưa có thì đoán theo thời gian.
 */
function ThinkingBubble({ stage }: { stage?: string }) {
  const [phase, setPhase] = useState(0);
  useEffect(() => {
    const t1 = setTimeout(() => setPhase(1), 2500);
    const t2 = setTimeout(() => setPhase(2), 7000);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, []);
  const guessed = phase === 0 ? 'Đang đọc câu hỏi' : phase === 1 ? 'Đang tra dữ liệu' : 'Đang tổng hợp câu trả lời';
  const label = stage || guessed;
  return (
    <div className="flex justify-start">
      <div className="flex max-w-[85%] items-center gap-2 rounded-2xl border border-slate-200 bg-white px-4 py-2 text-slate-500">
        <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-brand-200 border-t-brand-600" />
        {label}
        <span className="animate-pulse">…</span>
      </div>
    </div>
  );
}

/** Chọn khách hàng cho việc đang ghi: bấm nút, lọc theo từ gõ, hoặc gõ tên tự do. */
function CustomerPicker({ res, onPick }: { res: ChatResponse; onPick: (customer: string) => void }) {
  const [q, setQ] = useState('');
  const all = res.customers || [];
  const shown = useMemo(() => {
    const needle = q.trim().toLowerCase();
    const list = needle ? all.filter((c) => c.toLowerCase().includes(needle)) : all;
    return list.slice(0, 8);
  }, [q, all]);

  return (
    <div className="mt-2 space-y-2">
      {all.length > 6 && (
        <input
          className="input py-1 text-sm"
          placeholder="Gõ để lọc hoặc nhập tên khách mới…"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && q.trim() && onPick(q.trim())}
        />
      )}
      <div className="flex flex-wrap gap-1.5">
        {shown.map((c) => (
          <button
            key={c}
            className="rounded-lg border border-brand-200 bg-brand-50 px-2.5 py-1 text-sm text-brand-700 hover:bg-brand-100"
            onClick={() => onPick(c)}
          >
            {c}
          </button>
        ))}
        {q.trim() && !all.some((c) => c.toLowerCase() === q.trim().toLowerCase()) && (
          <button
            className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-600 hover:bg-slate-50"
            onClick={() => onPick(q.trim())}
          >
            + {q.trim()}
          </button>
        )}
        <button
          className="rounded-lg border border-slate-300 px-2.5 py-1 text-sm text-slate-500 hover:bg-slate-50"
          onClick={() => onPick('')}
        >
          Không thuộc khách nào
        </button>
      </div>
    </div>
  );
}

export default function Chat() {
  const { user } = useAuth();
  const toast = useToast();
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
  const [stage, setStage] = useState(''); // việc trợ lý đang làm, hiện lúc chờ
  const [showReminders, setShowReminders] = useState(false);
  const [savingIdx, setSavingIdx] = useState<number | null>(null); // đang mở ô lưu vào kho
  const [saveTitle, setSaveTitle] = useState('');
  const [saveCustomer, setSaveCustomer] = useState('');
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
  /** Tải lại hội thoại cũ để F5 không mất — lịch sử được lưu ở máy chủ. */
  async function loadHistory() {
    const r = await api<{ messages: Array<{ role: 'user' | 'model'; text: string; action: string }> }>(
      '/chat/history?limit=60',
    );
    if (r.messages.length === 0) return;
    const restored: Msg[] = r.messages.map((m, i) => ({
      role: m.role === 'user' ? 'user' : 'bot',
      text: m.text,
      // Chỉ giữ `action` để nút 📌 lưu vào kho còn dùng được; KHÔNG dựng lại thẻ xác nhận
      // (suggestion không được lưu, mà bấm xác nhận cũ cũng không còn đúng nữa).
      res: m.role === 'model' && m.action ? { reply: '', action: m.action } : undefined,
      question: m.role === 'model' ? r.messages[i - 1]?.text : undefined,
    }));
    setMsgs((cur) => [...cur, ...restored]);
  }

  useEffect(() => {
    loadDoing();
    loadTodo();
    loadHistory().catch(() => undefined); // mất lịch sử không được chặn dùng chat
    cachedGet<{ catalog: CatalogItem[] }>('/tasks/catalog')
      .then((r) => setCatalog(r.catalog))
      .catch(() => setCatalog([]));
    // eslint-disable-next-line react-hooks/exhaustive-deps
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
    setStage('');
    // Gửi kèm 10 lượt gần nhất để AI hiểu câu hỏi nối tiếp ("còn tháng 5 thì sao?").
    const history = msgs
      .slice(-10)
      .map((m) => ({ role: m.role === 'user' ? 'user' : 'model', text: m.text.slice(0, 2000) }));
    const body = { message, history, ...extra };

    const finish = (res: ChatResponse, text?: string) => {
      setMsgs((m) => {
        // Nếu đã dựng bong bóng lúc stream thì thay tại chỗ, không thêm bong bóng mới.
        const last = m[m.length - 1];
        const bubble: Msg = { role: 'bot', text: text ?? res.reply, res, question: message };
        return last?.streaming ? [...m.slice(0, -1), bubble] : [...m, bubble];
      });
    };

    try {
      let streamed = '';
      let gotEvent = false;
      await apiStream('/chat/stream', body, (ev) => {
        gotEvent = true;
        if (ev.type === 'tool') {
          setStage(TOOL_VI[ev.name || ''] || 'Đang tra dữ liệu');
        } else if (ev.type === 'text' && ev.delta) {
          streamed += ev.delta;
          setStage('');
          // Cập nhật dần bong bóng đang viết.
          setMsgs((m) => {
            const last = m[m.length - 1];
            if (last?.streaming) return [...m.slice(0, -1), { ...last, text: streamed }];
            return [...m, { role: 'bot', text: streamed, streaming: true }];
          });
        } else if (ev.type === 'done') {
          const res = ev.payload as ChatResponse;
          finish(res, streamed || res.reply);
          if (res.action === 'task_started' || res.action === 'task_logged') void loadDoing();
        } else if (ev.type === 'error') {
          throw new Error(ev.message || 'Lỗi không rõ');
        }
      });
      if (!gotEvent) throw new Error('Không nhận được dữ liệu');
    } catch {
      // Stream hỏng (endpoint không hỗ trợ, mạng đứt…) → gọi lại đường thường để không mất câu trả lời.
      try {
        setMsgs((m) => (m[m.length - 1]?.streaming ? m.slice(0, -1) : m));
        const res = await api<ChatResponse>('/chat', { body });
        setMsgs((m) => [...m, { role: 'bot', text: res.reply, res, question: message }]);
        if (res.action === 'task_started' || res.action === 'task_logged') await loadDoing();
      } catch (e2) {
        setMsgs((m) => [...m, { role: 'bot', text: `⚠️ ${(e2 as Error).message}` }]);
      }
    } finally {
      setBusy(false);
      setStage('');
    }
  }

  async function onSubmit() {
    const text = input.trim();
    if (!text || busy) return;
    setMsgs((m) => [...m, { role: 'user', text }]);
    setInput('');
    await send(text);
  }

  /** Chốt câu trả lời này vào kho tri thức để lần sau khỏi hỏi lại. */
  async function saveToBrain(idx: number, title: string, customer: string) {
    const m = msgs[idx];
    if (!m) return;
    try {
      await api('/brain/notes', {
        body: {
          title: title.trim() || (m.question || 'Ghi chú từ hội thoại').slice(0, 120),
          // Lưu cả câu hỏi để sau này tra ra vẫn hiểu ngữ cảnh.
          content: m.question ? `Hỏi: ${m.question}\n\n${m.text}` : m.text,
          customer: customer.trim(),
        },
      });
      setMsgs((list) => list.map((x, i) => (i === idx ? { ...x, saved: true } : x)));
      setSavingIdx(null);
      toast.success('Đã lưu vào kho tri thức');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function confirmTask(s: Suggestion) {
    setMsgs((m) => [...m, { role: 'user', text: `✔️ Xác nhận hoàn thành: ${s.taskName}` }]);
    await send('', { confirmTaskCode: s.taskCode, note: s.note });
  }

  async function confirmStart(s: Suggestion) {
    setMsgs((m) => [...m, { role: 'user', text: `▶️ Bắt đầu: ${s.taskName}` }]);
    await send('', { confirmStartTaskCode: s.taskCode, note: s.note });
  }

  /**
   * Chọn khách cho việc đang ghi. Đã biết đủ loại việc + bắt đầu hay đã xong nên
   * dựng thẳng thẻ xác nhận tại đây, khỏi tốn thêm một vòng gọi máy chủ.
   */
  function pickCustomer(res: ChatResponse, customer: string) {
    const s = res.suggestion;
    if (!s) return;
    const note = [s.note, customer].filter(Boolean).join(' — ');
    const next: Suggestion = { ...s, note };
    setMsgs((m) => [
      ...m,
      { role: 'user', text: customer || 'Không thuộc khách nào' },
      {
        role: 'bot',
        text: res.starting
          ? `Bắt đầu làm "${s.taskName}"${customer ? ` cho ${customer}` : ''} từ bây giờ? (+${s.points}đ khi hoàn thành)`
          : `Bạn vừa hoàn thành "${s.taskName}"${customer ? ` cho ${customer}` : ''} (+${s.points}đ)? Bấm xác nhận để ghi nhận nhé.`,
        res: {
          reply: '',
          action: res.starting ? 'confirm_start' : 'confirm_task',
          suggestion: next,
        },
      },
    ]);
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
        {
          role: 'bot',
          text: `✅ Đã hoàn thành "${t.title || t.taskName}" sau ${fmtMin(t.elapsedMinutes)} (+${r.points}đ). 💪`,
        },
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
              className={`max-w-[85%] rounded-2xl px-4 py-2 ${
                m.role === 'user'
                  ? 'whitespace-pre-wrap bg-brand-600 text-white'
                  : 'border border-slate-200 bg-white'
              }`}
            >
              {/* Người dùng: giữ nguyên chữ thô. Bot: AI trả lời kiểu markdown nên phải dựng lại. */}
              {m.role === 'user' ? m.text : <RichText text={m.text} />}
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

              {/* Việc này cho khách nào? */}
              {m.res?.action === 'ask_customer' && m.res.suggestion && (
                <CustomerPicker res={m.res} onPick={(c) => pickCustomer(m.res!, c)} />
              )}

              {/* Chốt câu trả lời vào kho tri thức — lần sau khỏi hỏi lại */}
              {m.role === 'bot' && m.res?.action === 'data_answer' && (
                m.saved ? (
                  <div className="mt-2 text-xs text-emerald-600">✓ Đã lưu vào kho tri thức</div>
                ) : savingIdx === i ? (
                  <div className="mt-2 space-y-2 rounded-xl bg-slate-50 p-2">
                    <input
                      className="input py-1 text-sm"
                      placeholder="Tiêu đề (để trống sẽ lấy theo câu hỏi)"
                      value={saveTitle}
                      onChange={(e) => setSaveTitle(e.target.value)}
                    />
                    <input
                      className="input py-1 text-sm"
                      placeholder="Gắn với khách hàng (tuỳ chọn)"
                      value={saveCustomer}
                      onChange={(e) => setSaveCustomer(e.target.value)}
                    />
                    <div className="flex gap-2">
                      <AsyncButton
                        className="btn-primary py-1 text-sm"
                        onClick={() => saveToBrain(i, saveTitle, saveCustomer)}
                        busyLabel="Đang lưu…"
                      >
                        Lưu
                      </AsyncButton>
                      <button className="btn-ghost py-1 text-sm" onClick={() => setSavingIdx(null)}>
                        Huỷ
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="mt-2 text-xs text-brand-600 underline"
                    onClick={() => {
                      setSavingIdx(i);
                      setSaveTitle((m.question || '').slice(0, 120));
                      setSaveCustomer('');
                    }}
                  >
                    📌 Lưu vào kho tri thức
                  </button>
                )
              )}
            </div>
          </div>
        ))}
        {/* Đang stream chữ rồi thì thôi hiện ô chờ — bong bóng đang tự lớn dần. */}
        {busy && !msgs[msgs.length - 1]?.streaming && <ThinkingBubble stage={stage} />}
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
        <div className="flex gap-2">
          <button
            className={`btn flex-1 ${doing.length ? 'bg-amber-100 text-amber-800 hover:bg-amber-200' : 'bg-slate-100 text-slate-500'}`}
            onClick={() => {
              loadDoing();
              setShowDoing(true);
            }}
          >
            ⏳ Đang làm ({doing.length})
          </button>
          <button className="btn bg-slate-100 text-slate-600 hover:bg-slate-200" onClick={() => setShowReminders(true)}>
            ⏰ Nhắc hẹn
          </button>
        </div>
      </div>

      {showReminders && <Reminders onClose={() => setShowReminders(false)} />}

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
                    <div className="font-medium text-sm">{t.title || t.taskName}</div>
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
