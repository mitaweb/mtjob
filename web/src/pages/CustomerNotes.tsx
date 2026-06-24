import { useEffect, useRef, useState, type ReactNode } from 'react';
import { upload } from '@vercel/blob/client';
import DOMPurify from 'dompurify';
import { api, getToken } from '../lib/api';

interface Note {
  id: string;
  customer: string;
  content: string; // HTML soạn inline (chữ + ảnh + link)
  color: string;
  createdBy: string;
  createdName: string;
  createdAt: string;
  updatedAt: string;
}

const COLORS: { key: string; label: string; card: string; dot: string }[] = [
  { key: 'yellow', label: 'Vàng', card: 'bg-amber-50 border-amber-200', dot: 'bg-amber-300' },
  { key: 'pink', label: 'Hồng', card: 'bg-rose-50 border-rose-200', dot: 'bg-rose-300' },
  { key: 'green', label: 'Lá', card: 'bg-emerald-50 border-emerald-200', dot: 'bg-emerald-300' },
  { key: 'blue', label: 'Xanh', card: 'bg-sky-50 border-sky-200', dot: 'bg-sky-300' },
  { key: 'purple', label: 'Tím', card: 'bg-violet-50 border-violet-200', dot: 'bg-violet-300' },
];
const cardCls = (key: string) => (COLORS.find((c) => c.key === key) || COLORS[0]).card;

function emptyNote(): Note {
  return { id: '', customer: '', content: '', color: 'yellow', createdBy: '', createdName: '', createdAt: '', updatedAt: '' };
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

// Cho phép render chữ + ảnh + link + định dạng (đậm/màu/căn lề qua style); loại script nguy hiểm.
function clean(html: string): string {
  return DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 'ul', 'ol', 'li', 'img', 'a', 'font'],
    ALLOWED_ATTR: ['href', 'target', 'rel', 'src', 'alt', 'style', 'color'],
  });
}

// Màu chữ nhanh trên thanh công cụ (đen / đỏ / cam / lá / xanh / tím).
const TEXT_COLORS = ['#0f172a', '#dc2626', '#ea580c', '#16a34a', '#2563eb', '#7c3aed'];

// Nút công cụ — onMouseDown preventDefault để không mất vùng chọn trong ô soạn.
function ToolBtn({ title, onClick, children }: { title: string; onClick: () => void; children: ReactNode }) {
  return (
    <button
      type="button"
      title={title}
      onMouseDown={(e) => e.preventDefault()}
      onClick={onClick}
      className="flex h-7 min-w-[28px] items-center justify-center rounded-lg px-1.5 text-sm leading-none text-slate-600 hover:bg-slate-200"
    >
      {children}
    </button>
  );
}

function Sep() {
  return <span className="mx-0.5 h-5 w-px bg-slate-200" />;
}

export default function CustomerNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [edit, setEdit] = useState<Note | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);

  async function load() {
    const r = await api<{ notes: Note[] }>('/customer-notes');
    setNotes(r.notes);
  }
  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, []);

  // Nạp nội dung HTML vào vùng soạn khi mở 1 note.
  useEffect(() => {
    if (edit && editorRef.current) editorRef.current.innerHTML = edit.content || '';
  }, [edit?.id, edit !== null]);

  function openEditor(n: Note) {
    setErr('');
    savedRange.current = null;
    setEdit(n);
  }

  function saveSelection() {
    const sel = window.getSelection();
    if (sel && sel.rangeCount > 0 && editorRef.current?.contains(sel.anchorNode)) {
      savedRange.current = sel.getRangeAt(0).cloneRange();
    }
  }

  function insertHtml(html: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    const sel = window.getSelection();
    if (savedRange.current && sel) {
      sel.removeAllRanges();
      sel.addRange(savedRange.current);
    }
    // execCommand vẫn được mọi trình duyệt hỗ trợ cho contentEditable.
    document.execCommand('insertHTML', false, html);
    savedRange.current = null;
  }

  // Lệnh định dạng (đậm/nghiêng/căn lề/màu chữ…) cho vùng đang chọn trong ô soạn.
  function exec(cmd: string, value?: string) {
    const el = editorRef.current;
    if (!el) return;
    el.focus();
    try {
      // styleWithCSS: dùng style inline (text-align / color) thay vì thẻ <font> cũ.
      document.execCommand('styleWithCSS', false, 'true');
    } catch {
      /* vài trình duyệt không hỗ trợ — bỏ qua */
    }
    document.execCommand(cmd, false, value);
    saveSelection();
  }

  async function onFiles(files: FileList | null) {
    if (!files || !files.length) return;
    setBusy(true);
    setErr('');
    try {
      for (const f of Array.from(files)) {
        const blob = await upload(f.name, f, {
          access: 'public',
          handleUploadUrl: '/api/customer-notes/upload',
          clientPayload: getToken() || '',
        });
        if (f.type === 'application/pdf') {
          insertHtml(`<a href="${escapeHtml(blob.url)}" target="_blank" rel="noreferrer">📄 ${escapeHtml(f.name)}</a>&nbsp;`);
        } else {
          insertHtml(`<img src="${escapeHtml(blob.url)}" alt="${escapeHtml(f.name)}" />`);
        }
      }
    } catch (e) {
      setErr('Tải tệp thất bại: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addVideo() {
    const url = (window.prompt('Dán link video (YouTube / Drive / Facebook):') || '').trim();
    if (!url) return;
    insertHtml(`<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">🎬 ${escapeHtml(url)}</a>&nbsp;`);
  }

  async function save() {
    if (!edit) return;
    if (!edit.customer.trim()) {
      setErr('Vui lòng nhập tên khách hàng');
      return;
    }
    const content = clean(editorRef.current?.innerHTML || '');
    setBusy(true);
    setErr('');
    try {
      await api('/customer-notes', {
        body: { id: edit.id || undefined, customer: edit.customer.trim(), content, color: edit.color },
      });
      setEdit(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!edit?.id) {
      setEdit(null);
      return;
    }
    if (!confirm('Xóa lưu ý của khách hàng này?')) return;
    setBusy(true);
    setErr('');
    try {
      await api(`/customer-notes/${edit.id}`, { method: 'DELETE' });
      setEdit(null);
      await load();
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">📌 Lưu ý khách hàng</h1>
          <p className="text-sm text-slate-500">Mỗi note là một khách hàng — soạn chữ, chèn ảnh/PDF/link video ngay trong nội dung.</p>
        </div>
        <button
          onClick={() => openEditor(emptyNote())}
          className="shrink-0 rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white shadow-sm shadow-brand-600/30 hover:bg-brand-700"
        >
          + Thêm khách hàng
        </button>
      </div>

      {err && !edit && <div className="mb-4 rounded-xl bg-rose-50 px-4 py-3 text-sm text-rose-600">{err}</div>}

      {notes.length === 0 ? (
        <div className="rounded-2xl border border-dashed border-slate-200 bg-white p-10 text-center text-slate-400">
          Chưa có lưu ý nào. Bấm “+ Thêm khách hàng” để tạo note đầu tiên.
        </div>
      ) : (
        <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {notes.map((n) => (
            <button
              key={n.id}
              onClick={() => openEditor({ ...n })}
              className={`flex flex-col rounded-2xl border p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lg ${cardCls(n.color)}`}
            >
              <div className="mb-1.5 font-bold text-slate-800">{n.customer || '(Chưa đặt tên)'}</div>
              <div
                className="note-rich max-h-48 overflow-hidden"
                dangerouslySetInnerHTML={{ __html: clean(n.content) || '<span class="text-slate-400">(trống)</span>' }}
              />
              <div className="mt-3 text-xs text-slate-400">— {n.createdName || 'Ẩn danh'}</div>
            </button>
          ))}
        </div>
      )}

      {edit && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4"
          onClick={() => !busy && setEdit(null)}
        >
          <div
            className="max-h-[92vh] w-full max-w-lg overflow-y-auto rounded-t-2xl bg-white p-5 shadow-xl sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-slate-800">{edit.id ? 'Sửa lưu ý' : 'Lưu ý mới'}</h2>
              <button onClick={() => setEdit(null)} className="text-slate-400 hover:text-slate-600" aria-label="Đóng">
                ✕
              </button>
            </div>

            {err && <div className="mb-3 rounded-xl bg-rose-50 px-3 py-2 text-sm text-rose-600">{err}</div>}

            <label className="mb-1 block text-sm font-medium text-slate-600">Tên khách hàng</label>
            <input
              value={edit.customer}
              onChange={(e) => setEdit({ ...edit, customer: e.target.value })}
              placeholder="VD: Công ty ABC / Chị Lan"
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            />

            <label className="mb-1 block text-sm font-medium text-slate-600">Nội dung lưu ý</label>
            {/* Thanh công cụ soạn thảo — định dạng chữ + chèn ảnh/PDF/video tại vị trí con trỏ */}
            <div className="mb-2 flex flex-wrap items-center gap-1 rounded-xl border border-slate-200 bg-slate-50 p-1.5">
              <ToolBtn title="Đậm" onClick={() => exec('bold')}>
                <span className="font-bold">B</span>
              </ToolBtn>
              <ToolBtn title="Nghiêng" onClick={() => exec('italic')}>
                <span className="font-serif italic">I</span>
              </ToolBtn>
              <ToolBtn title="Gạch chân" onClick={() => exec('underline')}>
                <span className="underline">U</span>
              </ToolBtn>
              <Sep />
              <ToolBtn title="Căn trái" onClick={() => exec('justifyLeft')}>
                ⬅
              </ToolBtn>
              <ToolBtn title="Căn giữa" onClick={() => exec('justifyCenter')}>
                ↔
              </ToolBtn>
              <ToolBtn title="Căn phải" onClick={() => exec('justifyRight')}>
                ➡
              </ToolBtn>
              <Sep />
              {TEXT_COLORS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title="Màu chữ"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => exec('foreColor', c)}
                  className="h-6 w-6 rounded-full ring-1 ring-slate-200"
                  style={{ background: c }}
                  aria-label={`Màu ${c}`}
                />
              ))}
              <Sep />
              <label
                title="Chèn ảnh / PDF"
                className="flex h-7 cursor-pointer items-center justify-center rounded-lg px-2 text-sm leading-none text-slate-600 hover:bg-slate-200"
              >
                🖼️
                <input
                  type="file"
                  accept="image/*,application/pdf"
                  multiple
                  className="hidden"
                  disabled={busy}
                  onChange={(e) => {
                    onFiles(e.target.files);
                    e.target.value = '';
                  }}
                />
              </label>
              <ToolBtn title="Chèn link video" onClick={addVideo}>
                🎬
              </ToolBtn>
            </div>
            <div
              ref={editorRef}
              contentEditable
              suppressContentEditableWarning
              onKeyUp={saveSelection}
              onMouseUp={saveSelection}
              onBlur={saveSelection}
              data-placeholder="Gõ nội dung, chèn ảnh/PDF/link video vào đây…"
              className="note-rich note-editor mb-4 min-h-[160px] w-full rounded-xl border border-slate-200 px-3 py-2.5 focus:border-brand-500 focus:outline-none"
            />

            <label className="mb-1 block text-sm font-medium text-slate-600">Màu note</label>
            <div className="mb-4 flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  type="button"
                  onClick={() => setEdit({ ...edit, color: c.key })}
                  className={`h-7 w-7 rounded-full ${c.dot} ${edit.color === c.key ? 'ring-2 ring-slate-700 ring-offset-2' : ''}`}
                  aria-label={c.label}
                />
              ))}
            </div>

            <div className="flex items-center justify-between gap-2">
              {edit.id ? (
                <button
                  onClick={remove}
                  disabled={busy}
                  className="rounded-xl px-3 py-2.5 text-sm font-medium text-rose-600 hover:bg-rose-50 disabled:opacity-50"
                >
                  Xóa
                </button>
              ) : (
                <span />
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => setEdit(null)}
                  disabled={busy}
                  className="rounded-xl px-4 py-2.5 text-sm font-medium text-slate-500 hover:bg-slate-100 disabled:opacity-50"
                >
                  Hủy
                </button>
                <button
                  onClick={save}
                  disabled={busy}
                  className="rounded-xl bg-brand-600 px-5 py-2.5 text-sm font-semibold text-white hover:bg-brand-700 disabled:opacity-50"
                >
                  {busy ? 'Đang lưu…' : 'Lưu'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
