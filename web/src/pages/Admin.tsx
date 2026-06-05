import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import type { User } from '../lib/types';

export default function Admin() {
  const [members, setMembers] = useState<User[]>([]);
  const [msg, setMsg] = useState('');
  const [pwd, setPwd] = useState<Record<string, string>>({});

  async function loadMembers() {
    const r = await api<{ members: User[] }>('/admin/members');
    setMembers(r.members);
  }
  useEffect(() => {
    loadMembers().catch((e) => setMsg((e as Error).message));
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
      <div className="card flex items-center justify-between">
        <div>
          <h1 className="text-lg font-bold">Quản trị</h1>
          <p className="text-sm text-slate-500">Đồng bộ nhân sự từ Google Sheet nguồn (Họ tên · Chức vụ · Lương · BHXH · Ngày vào · Năm sinh).</p>
        </div>
        <button className="btn-primary" onClick={sync}>
          Đồng bộ nhân sự
        </button>
      </div>
      {msg && <div className="text-sm text-slate-700 bg-slate-50 rounded-lg px-3 py-2">{msg}</div>}

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
