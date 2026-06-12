const BASE = import.meta.env.VITE_API_BASE ?? '';

let token: string | null = localStorage.getItem('mtjob_token');

export function setToken(t: string | null): void {
  token = t;
  if (t) localStorage.setItem('mtjob_token', t);
  else localStorage.removeItem('mtjob_token');
}

export function getToken(): string | null {
  return token;
}

export interface ApiOptions {
  method?: string;
  body?: unknown;
  form?: FormData;
}

export async function api<T = unknown>(path: string, opts: ApiOptions = {}): Promise<T> {
  const headers: Record<string, string> = {};
  if (token) headers['Authorization'] = `Bearer ${token}`;

  let body: BodyInit | undefined;
  if (opts.form) {
    body = opts.form;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  const res = await fetch(`${BASE}/api${path}`, {
    method: opts.method || (body ? 'POST' : 'GET'),
    headers,
    body,
  });

  const text = await res.text();
  let data: { error?: string } = {};
  if (text) {
    try {
      data = JSON.parse(text);
    } catch {
      // Server trả về trang lỗi dạng text/HTML (vd Vercel "A server error has occurred")
      throw new Error(`Máy chủ gặp lỗi (${res.status}). Chi tiết: ${text.slice(0, 140)}`);
    }
  }
  if (!res.ok) {
    if (res.status === 401) setToken(null);
    throw new Error(data.error || `Lỗi ${res.status}`);
  }
  return data as T;
}
