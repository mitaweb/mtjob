import { useState, type FormEvent } from 'react';
import { Navigate, useNavigate } from 'react-router-dom';
import { useAuth } from '../lib/auth';
import Brand from '../components/Brand';

export default function Login() {
  const { login, user } = useAuth();
  const navigate = useNavigate();
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [err, setErr] = useState('');
  const [busy, setBusy] = useState(false);

  if (user) return <Navigate to="/chat" replace />;

  async function submit(e: FormEvent) {
    e.preventDefault();
    setBusy(true);
    setErr('');
    try {
      await login(username.trim(), password);
      navigate('/');
    } catch (e) {
      setErr((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="relative min-h-screen overflow-hidden flex items-center justify-center p-4 bg-brand-500">
      {/* Họa tiết góc theo bộ nhận diện: tam giác xanh Ocean + vàng, vòng tròn nét mảnh. */}
      <div aria-hidden className="pointer-events-none absolute -left-10 -top-10 h-56 w-56 bg-ocean-600 [clip-path:polygon(0_0,100%_0,0_100%)]" />
      <div aria-hidden className="pointer-events-none absolute -bottom-12 -right-12 h-64 w-64 bg-ink [clip-path:polygon(100%_0,100%_100%,0_100%)]" />
      <div aria-hidden className="pointer-events-none absolute right-10 top-16 h-24 w-24 rounded-full border-2 border-ink/40" />
      <form onSubmit={submit} className="card relative w-full max-w-sm space-y-4 shadow-pop-lg">
        <div className="text-center">
          <Brand />
          <p className="text-ink-faint text-xs mt-2">MTJOB — Quản lý công việc & chấm công</p>
        </div>
        <div>
          <label className="label">Tên đăng nhập</label>
          <input
            className="input"
            type="text"
            autoComplete="username"
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            required
          />
        </div>
        <div>
          <label className="label">Mật khẩu</label>
          <input
            className="input"
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
          />
        </div>
        {err && <div className="text-sm text-rose-600 bg-rose-50 rounded-lg px-3 py-2">{err}</div>}
        <button className="btn-primary w-full" disabled={busy}>
          {busy ? 'Đang đăng nhập…' : 'Đăng nhập'}
        </button>
      </form>
    </div>
  );
}
