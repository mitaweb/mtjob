import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { vnd, fmtMin } from '../lib/format';
import type { CatalogItem, MemberScore } from '../lib/types';

interface Task {
  id: string;
  taskName: string;
  points: number;
  completedAt: string;
}

export default function Scores() {
  const [score, setScore] = useState<MemberScore | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [catalog, setCatalog] = useState<CatalogItem[]>([]);
  const [sheetUrl, setSheetUrl] = useState('');
  const [code, setCode] = useState('');
  const [msg, setMsg] = useState('');

  async function load() {
    setScore(await api<MemberScore>('/scores/me'));
    const t = await api<{ tasks: Task[] }>('/tasks/me?range=month');
    setTasks(t.tasks);
  }
  useEffect(() => {
    load().catch((e) => setMsg((e as Error).message));
    api<{ catalog: CatalogItem[]; sheetUrl?: string }>('/tasks/catalog')
      .then((r) => {
        setCatalog(r.catalog);
        setSheetUrl(r.sheetUrl || '');
      })
      .catch(() => {});
  }, []);

  async function logTask() {
    if (!code) return;
    try {
      await api('/tasks', { body: { taskCode: code } });
      setCode('');
      setMsg('Đã ghi nhận task ✅');
      await load();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
        <div className="card text-center">
          <div className="text-2xl font-bold">{score?.todayPoints ?? 0}</div>
          <div className="text-xs text-slate-500">Điểm hôm nay</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold">{score?.monthPoints ?? 0}</div>
          <div className="text-xs text-slate-500">Lũy kế tháng</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-emerald-600">{vnd(score?.bonus ?? 0)}</div>
          <div className="text-xs text-slate-500">Thưởng hiện tại</div>
        </div>
        <div className="card text-center">
          <div className="text-2xl font-bold text-brand-600">{fmtMin(score?.workMinutesToday ?? 0)}</div>
          <div className="text-xs text-slate-500">⏱ Giờ làm hôm nay</div>
        </div>
      </div>

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Ghi nhận task nhanh</h2>
          {sheetUrl && (
            <a
              href={sheetUrl}
              target="_blank"
              rel="noreferrer"
              className="text-sm text-brand-600 underline whitespace-nowrap"
            >
              📄 Bảng điểm gốc ↗
            </a>
          )}
        </div>
        <div className="flex gap-2">
          <select className="input" value={code} onChange={(e) => setCode(e.target.value)}>
            <option value="">— Chọn loại task —</option>
            {catalog.map((c) => (
              <option key={c.code} value={c.code}>
                {c.name} (+{c.points}đ)
              </option>
            ))}
          </select>
          <button className="btn-primary" onClick={logTask}>
            Ghi nhận
          </button>
        </div>
        {msg && <div className="mt-2 text-sm text-slate-600">{msg}</div>}
      </div>

      <div className="card">
        <h2 className="font-semibold mb-2">Task tháng này ({tasks.length})</h2>
        <ul className="divide-y">
          {tasks.map((t) => (
            <li key={t.id} className="py-2 flex justify-between text-sm">
              <span>{t.taskName}</span>
              <span className="font-medium text-brand-600">+{t.points}đ</span>
            </li>
          ))}
          {tasks.length === 0 && <li className="py-2 text-sm text-slate-500">Chưa có task nào.</li>}
        </ul>
      </div>
    </div>
  );
}
