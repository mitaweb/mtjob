import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { User } from '../lib/types';

export default function Admin() {
  const [members, setMembers] = useState<User[]>([]);
  const [msg, setMsg] = useState('');
  const [pwd, setPwd] = useState<Record<string, string>>({});
  const [aiOn, setAiOn] = useState<boolean | null>(null);

  async function loadMembers() {
    const r = await api<{ members: User[] }>('/admin/members');
    setMembers(r.members);
  }
  useEffect(() => {
    loadMembers().catch((e) => setMsg((e as Error).message));
    api<{ env: { gemini: boolean } }>('/health')
      .then((r) => setAiOn(!!r.env.gemini))
      .catch(() => setAiOn(null));
  }, []);

  async function sync() {
    setMsg('Đang đồng bộ…');
    try {
      const r = await api<{ imported: number; teams: string[] }>('/admin/sync-members', { method: 'POST' });
      setMsg(`Đã đồng bộ ${r.imported} thành viên. Teams: ${r.teams.join(', ')}`);
      await loadMembers();
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function syncCatalog() {
    setMsg('Đang đồng bộ bảng điểm…');
    try {
      const r = await api<{ updated: number; tabs: string[] }>('/admin/sync-catalog', { method: 'POST' });
      setMsg(`Đã cập nhật ${r.updated} đầu việc từ: ${r.tabs.join(', ')}`);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function geminiLogin() {
    try {
      const r = await api<{ url: string }>('/admin/google/auth-url');
      window.open(r.url, '_blank');
      setMsg(
        'Đã mở trang đăng nhập Google ở tab mới. Sau khi đồng ý, trang callback sẽ hiển thị GEMINI_OAUTH_REFRESH_TOKEN — copy giá trị đó vào biến môi trường (Vercel/server) rồi redeploy.',
      );
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function setPassword(id: string) {
    const password = pwd[id];
    if (!password || password.length < 6) {
      setMsg('Mật khẩu tối thiểu 6 ký tự.');
      return;
    }
    try {
      await api(`/admin/members/${id}/password`, { body: { password } });
      setMsg('Đã đặt mật khẩu ✅');
      setPwd((p) => ({ ...p, [id]: '' }));
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">Quản trị</h1>
          <p className="text-sm text-slate-500">
            Đồng bộ từ Google Sheet (cần share công khai): nhân sự (Họ tên · Chức vụ · Lương · BHXH…) và bảng điểm task (điểm = cột EXPERT).
          </p>
        </div>
        <div className="flex gap-2">
          <button className="btn-primary" onClick={sync}>
            Đồng bộ nhân sự
          </button>
          <button className="btn-ghost" onClick={syncCatalog}>
            Đồng bộ bảng điểm
          </button>
        </div>
      </div>
      {msg && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{msg}</div>}

      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">
              Trợ lý AI (Gemini){' '}
              {aiOn === null ? null : aiOn ? (
                <span className="text-xs rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700">Đang BẬT</span>
              ) : (
                <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">Chưa bật — chat chạy chế độ cơ bản</span>
              )}
            </h2>
            <p className="text-sm text-slate-500 mt-1">
              Cách nhanh nhất: lấy API key tại{' '}
              <a className="text-brand-600 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey
              </a>{' '}
              → thêm biến <code className="bg-slate-100 px-1 rounded">GEMINI_API_KEY</code> trên Vercel → Redeploy.
              Hoặc đăng nhập Google (OAuth) nếu đã cấu hình OAuth Client:
            </p>
          </div>
          <button className="btn-ghost" onClick={geminiLogin}>
            🔑 Đăng nhập Google
          </button>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Thành viên ({members.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Họ tên</th>
              <th>Email</th>
              <th>Team</th>
              <th>Vai trò</th>
              <th>Đặt mật khẩu</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="py-1">{m.fullName}</td>
                <td className="text-xs">{m.email}</td>
                <td>{m.teamId}</td>
                <td>{m.role}</td>
                <td>
                  <div className="flex gap-1">
                    <input
                      className="input py-1 text-xs w-28"
                      placeholder="mật khẩu mới"
                      value={pwd[m.id] || ''}
                      onChange={(e) => setPwd((p) => ({ ...p, [m.id]: e.target.value }))}
                    />
                    <button className="btn-ghost text-xs px-2 py-1" onClick={() => setPassword(m.id)}>
                      Lưu
                    </button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
