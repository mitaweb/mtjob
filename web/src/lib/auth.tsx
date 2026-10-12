import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError, getToken, setToken } from './api';
import type { User } from './types';

interface AuthCtx {
  user: User | null;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => void;
}

const Ctx = createContext<AuthCtx>({
  user: null,
  loading: true,
  login: async () => {},
  logout: () => {},
});

// Nhớ người dùng của lần trước để vẽ trang NGAY khi mở app, không phải chờ /auth/me (anh Tâm 12/10/2026: tăng
// tốc). /auth/me vẫn chạy ở nền: phiên hết hạn / đổi quyền thì cập nhật hoặc đăng xuất như cũ.
const KHOA_NGUOI_DUNG = 'mtjob_user';
function nguoiDungDaNho(): User | null {
  try {
    if (!getToken()) return null;
    const s = localStorage.getItem(KHOA_NGUOI_DUNG);
    return s ? (JSON.parse(s) as User) : null;
  } catch {
    return null;
  }
}
function nhoNguoiDung(u: User | null): void {
  try {
    if (u) localStorage.setItem(KHOA_NGUOI_DUNG, JSON.stringify(u));
    else localStorage.removeItem(KHOA_NGUOI_DUNG);
  } catch {
    /* trình duyệt chặn lưu — bỏ qua, chỉ chậm hơn chút */
  }
}

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUserState] = useState<User | null>(nguoiDungDaNho);
  const [loading, setLoading] = useState(() => !nguoiDungDaNho());
  const setUser = (u: User | null) => {
    nhoNguoiDung(u);
    setUserState(u);
  };

  useEffect(() => {
    api<{ user: User }>('/auth/me')
      .then((r) => setUser(r.user))
      .catch((e) => {
        // Đang hiện người dùng đã nhớ: chỉ đăng xuất khi phiên thật sự hết hạn (401) hoặc không còn token —
        // mạng chập chờn thì giữ nguyên, đừng đá người ta ra màn hình đăng nhập.
        const hetPhien = e instanceof ApiError && e.status === 401;
        if (hetPhien || !getToken() || !nguoiDungDaNho()) setUser(null);
      })
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function login(username: string, password: string) {
    const r = await api<{ token: string; user: User }>('/auth/login', {
      body: { username, password },
    });
    setToken(r.token);
    setUser(r.user);
  }

  function logout() {
    setToken(null);
    setUser(null);
  }

  return <Ctx.Provider value={{ user, loading, login, logout }}>{children}</Ctx.Provider>;
}

export function useAuth(): AuthCtx {
  return useContext(Ctx);
}
