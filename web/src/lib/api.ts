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

/** Sự kiện máy chủ đẩy về trong lúc trợ lý làm việc. */
export interface StreamEvent {
  type: 'tool' | 'text' | 'done' | 'error';
  name?: string; // type=tool: tên hàm đang chạy
  delta?: string; // type=text: mẩu chữ mới
  message?: string; // type=error
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  payload?: any; // type=done: kết quả cuối cùng
}

/**
 * Gọi API dạng SSE, gọi onEvent cho từng sự kiện. Ném lỗi nếu không mở được stream
 * để caller rơi về đường thường.
 */
export async function apiStream(
  path: string,
  body: unknown,
  onEvent: (ev: StreamEvent) => void,
): Promise<void> {
  const headers: Record<string, string> = { 'Content-Type': 'application/json' };
  if (token) headers['Authorization'] = `Bearer ${token}`;

  const res = await fetch(`${BASE}/api${path}`, { method: 'POST', headers, body: JSON.stringify(body) });
  if (!res.ok || !res.body) {
    if (res.status === 401) setToken(null);
    throw new Error(`Không mở được kết nối (${res.status})`);
  }

  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let buf = '';
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    buf += decoder.decode(value, { stream: true });
    const lines = buf.split('\n');
    buf = lines.pop() ?? ''; // giữ lại phần chưa trọn dòng
    for (const line of lines) {
      const t = line.trim();
      if (!t.startsWith('data:')) continue;
      try {
        onEvent(JSON.parse(t.slice(5).trim()) as StreamEvent);
      } catch {
        // Mẩu JSON hỏng — bỏ qua, không làm chết cả luồng.
      }
    }
  }
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
