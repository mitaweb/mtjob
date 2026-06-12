import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import { vnd, fmtMin } from '../lib/format';
import type { MemberScore } from '../lib/types';

interface Task {
  id: string;
  taskName: string;
  points: number;
  completedAt: string;
}

export default function Scores() {
  const [score, setScore] = useState<MemberScore | null>(null);
  const [tasks, setTasks] = useState<Task[]>([]);
  const [sheetUrl, setSheetUrl] = useState('');
  const [msg, setMsg] = useState('');

  useEffect(() => {
    api<MemberScore>('/scores/me')
      .then(setScore)
      .catch((e) => setMsg((e as Error).message));
    api<{ tasks: Task[] }>('/tasks/me?range=month')
      .then((r) => setTasks(r.tasks))
      .catch(() => {});
    api<{ sheetUrl?: string }>('/tasks/catalog')
      .then((r) => setSheetUrl(r.sheetUrl || ''))
      .catch(() => {});
  }, []);

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

      {msg && <div className="text-sm text-slate-600">{msg}</div>}

      <div className="card">
        <div className="flex items-center justify-between mb-2">
          <h2 className="font-semibold">Task tháng này ({tasks.length})</h2>
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
        <ul className="divide-y">
          {tasks.map((t) => (
            <li key={t.id} className="py-2 flex justify-between text-sm">
              <span>{t.taskName}</span>
              <span className="font-medium text-brand-600">+{t.points}đ</span>
            </li>
          ))}
          {tasks.length === 0 && (
            <li className="py-2 text-sm text-slate-500">
              Chưa có task nào — qua tab Trợ lý nhắn bot để bắt đầu/ghi nhận task nhé.
            </li>
          )}
        </ul>
      </div>
    </div>
  );
}
