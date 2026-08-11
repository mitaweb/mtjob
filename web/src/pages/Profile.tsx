import { useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../lib/auth';
import { enablePush } from '../lib/push';

export default function Profile() {
  const { user, logout } = useAuth();
  const [msg, setMsg] = useState('');
  const [curPwd, setCurPwd] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [newPwd2, setNewPwd2] = useState('');
  const [busy, setBusy] = useState(false);

  async function changePassword() {
    if (newPwd.length < 6) {
      setMsg('Mật khẩu mới tối thiểu 6 ký tự.');
      return;
    }
    if (newPwd !== newPwd2) {
      setMsg('Nhập lại mật khẩu mới chưa khớp.');
      return;
    }
    setBusy(true);
    try {
      await api('/auth/change-password', { body: { currentPassword: curPwd, newPassword: newPwd } });
      setMsg('Đã đổi mật khẩu thành công ✅');
      setCurPwd('');
      setNewPwd('');
      setNewPwd2('');
    } catch (e) {
      setMsg((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="space-y-4 max-w-md">
      <div className="card">
        <h1 className="text-lg font-bold mb-2">Hồ sơ</h1>
        <dl className="text-sm space-y-1">
          <Row k="Họ tên" v={user?.fullName} />
          <Row k="Tên đăng nhập" v={user?.username} />
          <Row k="Chức vụ" v={user?.position} />
          <Row k="Team" v={user?.teamId} />
          <Row k="Vai trò" v={user?.role} />
        </dl>
      </div>

      <div className="card space-y-2">
        <h2 className="font-semibold">Đổi mật khẩu</h2>
        <div>
          <label className="label">Mật khẩu hiện tại</label>
          <input
            className="input"
            type="password"
            autoComplete="current-password"
            value={curPwd}
            onChange={(e) => setCurPwd(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Mật khẩu mới (tối thiểu 6 ký tự)</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={newPwd}
            onChange={(e) => setNewPwd(e.target.value)}
          />
        </div>
        <div>
          <label className="label">Nhập lại mật khẩu mới</label>
          <input
            className="input"
            type="password"
            autoComplete="new-password"
            value={newPwd2}
            onChange={(e) => setNewPwd2(e.target.value)}
          />
        </div>
        <button className="btn-primary w-full" onClick={changePassword} disabled={busy}>
          {busy ? 'Đang đổi…' : 'Đổi mật khẩu'}
        </button>
      </div>

      <div className="card space-y-2">
        <button className="btn-ghost w-full" onClick={() => enablePush().then((r) => setMsg(r.message))}>
          🔔 Bật thông báo đẩy
        </button>
        <button className="btn-ghost w-full" onClick={logout}>
          Đăng xuất
        </button>
      </div>

      {msg && <div className="text-sm text-ink-soft bg-brand-50 rounded-lg px-3 py-2">{msg}</div>}
    </div>
  );
}

function Row({ k, v }: { k: string; v?: string | null }) {
  return (
    <div className="flex justify-between">
      <dt className="text-ink-muted">{k}</dt>
      <dd className="font-medium">{v || '—'}</dd>
    </div>
  );
}
