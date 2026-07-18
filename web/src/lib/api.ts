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

// ── Theo dõi số request đang chạy để hiện loading toàn cục ──
let pending = 0;
type LoadingListener = (n: number) => void;
const loadingListeners = new Set<LoadingListener>();
function setPending(n: number) {
  pending = Math.max(0, n);
  loadingListeners.forEach((l) => l(pending));
}
export function onLoading(l: LoadingListener): () => void {
  loadingListeners.add(l);
  l(pending);
  return () => loadingListeners.delete(l);
}

// ── Cache trong phiên cho dữ liệu gần như tĩnh (vd /tasks/catalog) ──
const getCache = new Map<string, { at: number; data: unknown }>();
export async function cachedGet<T = unknown>(path: string, ttlMs = 5 * 60_000): Promise<T> {
  const hit = getCache.get(path);
  if (hit && Date.now() - hit.at < ttlMs) return hit.data as T;
  const data = await api<T>(path);
  getCache.set(path, { at: Date.now(), data });
  return data;
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

  setPending(pending + 1);
  let res: Response;
  try {
    res = await fetch(`${BASE}/api${path}`, {
      method: opts.method || (body ? 'POST' : 'GET'),
      headers,
      body,
    });
  } finally {
    setPending(pending - 1);
  }

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
