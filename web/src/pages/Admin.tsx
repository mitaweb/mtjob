import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import type { User } from '../lib/types';

export default function Admin() {
  const [members, setMembers] = useState<User[]>([]);
  const [msg, setMsg] = useState('');
  const [pwd, setPwd] = useState<Record<string, string>>({});
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [authUrl, setAuthUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [syncInfo, setSyncInfo] = useState<{ hrSheetUrl: string; taskSheetUrl: string }>({ hrSheetUrl: '', taskSheetUrl: '' });

  async function loadMembers() {
    const r = await api<{ members: User[] }>('/admin/members');
    setMembers(r.members);
  }
  useEffect(() => {
    loadMembers().catch((e) => setMsg((e as Error).message));
    api<{ env: { gemini: boolean } }>('/health')
      .then((r) => setAiOn(!!r.env.gemini))
      .catch(() => setAiOn(null));
    api<{ hrSheetUrl: string; taskSheetUrl: string }>('/admin/sync-info')
      .then(setSyncInfo)
      .catch(() => undefined);
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

  async function saveApiKey() {
    const value = apiKey.trim();
    if (!value.startsWith('AIza') || value.length < 30) {
      setMsg('Key không hợp lệ — API key Gemini bắt đầu bằng "AIza...".');
      return;
    }
    try {
      await api('/admin/config', { body: { key: 'geminiApiKey', value } });
      setApiKey('');
      setMsg('Đã lưu API key ✅ — trợ lý AI bật ngay, không cần redeploy.');
      const h = await api<{ env: { gemini: boolean } }>('/health');
      setAiOn(!!h.env.gemini);
    } catch (e) {
      setMsg((e as Error).message);
    }
  }

  async function geminiLogin() {
    // Mở tab trống NGAY trong cú click (tránh popup-blocker), điền URL sau khi API trả về.
    const w = window.open('about:blank', '_blank');
    try {
      const r = await api<{ url: string }>('/admin/google/auth-url');
      setAuthUrl(r.url);
      if (w && !w.closed) {
        w.location.href = r.url;
        setMsg(
          'Đã mở trang đăng nhập Google ở tab mới. Sau khi đồng ý, trang callback sẽ hiển thị GEMINI_OAUTH_REFRESH_TOKEN — copy giá trị đó vào biến môi trường (Vercel/server) rồi redeploy.',
        );
      } else {
        setMsg('Trình duyệt chặn tab mới — bấm vào nút "Mở trang đăng nhập Google" bên dưới nhé.');
      }
    } catch (e) {
      if (w && !w.closed) w.close();
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
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
            {syncInfo.hrSheetUrl && (
              <a
                href={syncInfo.hrSheetUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-700 underline hover:text-brand-800"
              >
                📝 Mở Sheet nhân sự để chỉnh sửa
              </a>
            )}
            {syncInfo.taskSheetUrl && (
              <a
                href={syncInfo.taskSheetUrl}
                target="_blank"
                rel="noreferrer"
                className="font-medium text-brand-700 underline hover:text-brand-800"
              >
                📊 Mở Sheet bảng điểm
              </a>
            )}
          </div>
        </div>
        <div className="flex gap-2">
          <AsyncButton className="btn-primary" onClick={sync} busyLabel="Đang đồng bộ…">
            Đồng bộ nhân sự
          </AsyncButton>
          <AsyncButton className="btn-ghost" onClick={syncCatalog} busyLabel="Đang đồng bộ…">
            Đồng bộ bảng điểm
          </AsyncButton>
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
              Lấy API key tại{' '}
              <a className="text-brand-600 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey
              </a>{' '}
              rồi dán vào ô dưới — <b>hiệu lực ngay, không cần redeploy</b>. (Hoặc đăng nhập Google nếu đã cấu hình OAuth Client.)
            </p>
          </div>
          <div className="flex flex-col gap-2">
            <button className="btn-ghost" onClick={geminiLogin}>
              🔑 Đăng nhập Google
            </button>
            {authUrl && (
              <a className="btn-primary" href={authUrl} target="_blank" rel="noreferrer">
                👉 Mở trang đăng nhập Google
              </a>
            )}
          </div>
        </div>
        <div className="mt-3 flex gap-2">
          <input
            className="input"
            type="password"
            placeholder="Dán API key (AIza...)"
            value={apiKey}
            onChange={(e) => setApiKey(e.target.value)}
          />
          <AsyncButton className="btn-primary whitespace-nowrap" onClick={saveApiKey} busyLabel="Đang lưu…">
            Lưu key
          </AsyncButton>
        </div>
      </div>

      <div className="card overflow-x-auto">
        <h2 className="font-semibold mb-2">Thành viên ({members.length})</h2>
        <table className="w-full text-sm">
          <thead className="text-left text-slate-500">
            <tr>
              <th className="py-1">Họ tên</th>
              <th>Tài khoản</th>
              <th>Team</th>
              <th>Vai trò</th>
              <th>Đặt mật khẩu</th>
            </tr>
          </thead>
          <tbody>
            {members.map((m) => (
              <tr key={m.id} className="border-t">
                <td className="py-1">{m.fullName}</td>
                <td className="font-mono text-xs font-semibold text-brand-700">{m.username}</td>
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
                    <AsyncButton className="btn-ghost text-xs px-2 py-1" onClick={() => setPassword(m.id)} busyLabel="…">
                      Lưu
                    </AsyncButton>
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
