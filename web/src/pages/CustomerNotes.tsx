import { useEffect, useState } from 'react';
import { upload } from '@vercel/blob/client';
import { api, getToken } from '../lib/api';

type AttachmentKind = 'image' | 'pdf' | 'video';
interface Attachment {
  kind: AttachmentKind;
  url: string;
  name: string;
}
interface Note {
  id: string;
  customer: string;
  content: string;
  color: string;
  attachments: Attachment[];
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
  return {
    id: '',
    customer: '',
    content: '',
    color: 'yellow',
    attachments: [],
    createdBy: '',
    createdName: '',
    createdAt: '',
    updatedAt: '',
  };
}

export default function CustomerNotes() {
  const [notes, setNotes] = useState<Note[]>([]);
  const [edit, setEdit] = useState<Note | null>(null);
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);
  const [video, setVideo] = useState('');

  async function load() {
    const r = await api<{ notes: Note[] }>('/customer-notes');
    setNotes(r.notes);
  }
  useEffect(() => {
    load().catch((e) => setErr((e as Error).message));
  }, []);

  async function save() {
    if (!edit) return;
    if (!edit.customer.trim()) {
      setErr('Vui lòng nhập tên khách hàng');
      return;
    }
    setBusy(true);
    setErr('');
    try {
      await api('/customer-notes', {
        body: {
          id: edit.id || undefined,
          customer: edit.customer.trim(),
          content: edit.content,
          color: edit.color,
          attachments: edit.attachments,
        },
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

  async function onFiles(files: FileList | null) {
    if (!files || !files.length || !edit) return;
    setBusy(true);
    setErr('');
    try {
      const added: Attachment[] = [];
      for (const f of Array.from(files)) {
        const blob = await upload(f.name, f, {
          access: 'public',
          handleUploadUrl: '/api/customer-notes/upload',
          clientPayload: getToken() || '',
        });
        const kind: AttachmentKind = f.type === 'application/pdf' ? 'pdf' : 'image';
        added.push({ kind, url: blob.url, name: f.name });
      }
      setEdit({ ...edit, attachments: [...edit.attachments, ...added] });
    } catch (e) {
      setErr('Tải tệp thất bại: ' + (e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  function addVideo() {
    const url = video.trim();
    if (!url || !edit) return;
    setEdit({ ...edit, attachments: [...edit.attachments, { kind: 'video', url, name: url }] });
    setVideo('');
  }

  function removeAtt(i: number) {
    if (!edit) return;
    setEdit({ ...edit, attachments: edit.attachments.filter((_, idx) => idx !== i) });
  }

  return (
    <div>
      <div className="mb-5 flex items-center justify-between gap-3">
        <div>
          <h1 className="text-xl font-bold text-slate-800">📌 Lưu ý khách hàng</h1>
          <p className="text-sm text-slate-500">Mỗi note là một khách hàng — ghi chú, ảnh, PDF, link video.</p>
        </div>
        <button
          onClick={() => {
            setErr('');
            setVideo('');
            setEdit(emptyNote());
          }}
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
          {notes.map((n) => {
            const imgs = n.attachments.filter((a) => a.kind === 'image');
            const pdfs = n.attachments.filter((a) => a.kind === 'pdf');
            const vids = n.attachments.filter((a) => a.kind === 'video');
            return (
              <button
                key={n.id}
                onClick={() => {
                  setErr('');
                  setVideo('');
                  setEdit({ ...n });
                }}
                className={`flex flex-col rounded-2xl border p-4 text-left shadow-card transition hover:-translate-y-0.5 hover:shadow-lg ${cardCls(n.color)}`}
              >
                <div className="mb-1 font-bold text-slate-800">{n.customer || '(Chưa đặt tên)'}</div>
                {n.content && <div className="whitespace-pre-wrap text-sm text-slate-600 line-clamp-5">{n.content}</div>}
                {imgs.length > 0 && (
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {imgs.slice(0, 3).map((a, i) => (
                      <img key={i} src={a.url} alt={a.name} className="h-14 w-14 rounded-lg object-cover" />
                    ))}
                    {imgs.length > 3 && (
                      <span className="grid h-14 w-14 place-items-center rounded-lg bg-white/60 text-xs text-slate-500">
                        +{imgs.length - 3}
                      </span>
                    )}
                  </div>
                )}
                {(pdfs.length > 0 || vids.length > 0) && (
                  <div className="mt-2 flex flex-wrap gap-2 text-xs text-slate-500">
                    {pdfs.length > 0 && <span>📄 {pdfs.length} PDF</span>}
                    {vids.length > 0 && <span>🎬 {vids.length} video</span>}
                  </div>
                )}
                <div className="mt-3 text-xs text-slate-400">— {n.createdName || 'Ẩn danh'}</div>
              </button>
            );
          })}
        </div>
      )}

      {edit && (
        <div className="fixed inset-0 z-50 flex items-end justify-center bg-slate-900/40 p-0 sm:items-center sm:p-4" onClick={() => !busy && setEdit(null)}>
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
            <textarea
              value={edit.content}
              onChange={(e) => setEdit({ ...edit, content: e.target.value })}
              rows={4}
              placeholder="Khách hàng lưu ý điều gì…"
              className="mb-3 w-full rounded-xl border border-slate-200 px-3 py-2.5 text-sm focus:border-brand-500 focus:outline-none"
            />

            <label className="mb-1 block text-sm font-medium text-slate-600">Màu note</label>
            <div className="mb-4 flex gap-2">
              {COLORS.map((c) => (
                <button
                  key={c.key}
                  onClick={() => setEdit({ ...edit, color: c.key })}
                  className={`h-7 w-7 rounded-full ${c.dot} ${edit.color === c.key ? 'ring-2 ring-slate-700 ring-offset-2' : ''}`}
                  aria-label={c.label}
                />
              ))}
            </div>

            <label className="mb-1 block text-sm font-medium text-slate-600">Đính kèm</label>
            {edit.attachments.length > 0 && (
              <div className="mb-3 space-y-1.5">
                {edit.attachments.map((a, i) => (
                  <div key={i} className="flex items-center gap-2 rounded-lg bg-slate-50 px-2.5 py-1.5 text-sm">
                    <span>{a.kind === 'image' ? '🖼️' : a.kind === 'pdf' ? '📄' : '🎬'}</span>
                    <a href={a.url} target="_blank" rel="noreferrer" className="flex-1 truncate text-brand-700 hover:underline">
                      {a.name || a.url}
                    </a>
                    <button onClick={() => removeAtt(i)} className="text-slate-400 hover:text-rose-600" aria-label="Bỏ">
                      ✕
                    </button>
                  </div>
                ))}
              </div>
            )}

            <div className="mb-2 flex flex-wrap gap-2">
              <label className="cursor-pointer rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50">
                + Ảnh / PDF
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
            </div>
            <div className="mb-4 flex gap-2">
              <input
                value={video}
                onChange={(e) => setVideo(e.target.value)}
                placeholder="Dán link video (YouTube/Drive…)"
                className="flex-1 rounded-xl border border-slate-200 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
              />
              <button
                onClick={addVideo}
                className="rounded-xl border border-slate-200 px-3 py-2 text-sm font-medium text-slate-600 hover:bg-slate-50"
              >
                + Link
              </button>
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
