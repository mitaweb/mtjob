import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { enablePush } from '../lib/push';
import type { NotificationItem } from '../lib/types';

export default function Inbox() {
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [msg, setMsg] = useState('');

  async function load() {
    const r = await api<{ notifications: NotificationItem[] }>('/notifications');
    setItems(r.notifications);
  }
  useEffect(() => {
    load().catch((e) => setMsg((e as Error).message));
  }, []);

  async function markRead(id: string) {
    await api(`/notifications/${id}/read`, { method: 'POST' }).catch(() => {});
    setItems((list) => list.map((n) => (n.id === id ? { ...n, readAt: new Date().toISOString() } : n)));
  }

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-bold">Thông báo</h1>
        <button className="btn-ghost text-sm" onClick={() => enablePush().then((r) => setMsg(r.message))}>
          🔔 Bật đẩy
        </button>
      </div>
      {msg && <div className="text-sm text-slate-600">{msg}</div>}
      {items.length === 0 && <div className="card text-sm text-slate-500">Chưa có thông báo.</div>}
      {items.map((n) => (
        <div
          key={n.id}
          className={`card ${n.readAt ? 'opacity-70' : ''}`}
          onClick={() => !n.readAt && markRead(n.id)}
        >
          <div className="flex justify-between">
            <span className="font-semibold">{n.title}</span>
            <span className="text-xs text-slate-400">{new Date(n.createdAt).toLocaleString('vi-VN')}</span>
          </div>
          <div className="text-sm whitespace-pre-wrap mt-1">{n.body}</div>
        </div>
      ))}
    </div>
  );
}
