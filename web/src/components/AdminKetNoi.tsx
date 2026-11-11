// Quản trị → 🔌 Kết nối nền tảng (MCP) — anh Tâm 10/11/2026: "Phần MCP ads anh chưa thấy ở đâu". Meta Ads: MCP chính thức
// của Meta, đăng nhập Facebook. MCP khác (máy Mac / máy chủ riêng): địa chỉ https + mã bí mật. Trợ lý của giám đốc đọc
// số qua các kết nối này (chỉ đọc). CHỈ giám đốc.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge } from './ui';

interface KetNoi {
  id: string;
  nenTang: 'meta' | 'mcp';
  ten: string;
  url: string;
  taiKhoan: string;
  hetHan: number;
  trangThai: string;
  ghiChu: string;
  kiemTra: string;
  soCongCu: number;
  congCu: Array<{ name: string; description: string }>;
}

interface DuLieu {
  ds: KetNoi[];
  meta: { daCauHinh: boolean; duongVe: string };
  coKhoa: boolean;
  canCapNhatDb: boolean;
}

interface KetQuaKiemTra {
  congCu: Array<{ name: string }>;
  taiKhoanQc?: Array<{ id: string; ten: string; trangThai: number; tienTe: string }>;
  loiMcp?: string;
}

const ngay = (ms: number) => (ms ? new Date(ms).toLocaleDateString('vi-VN') : '');

function DongKetNoi({ k, onDoi }: { k: KetNoi; onDoi: () => Promise<void> }) {
  const toast = useToast();
  const [kq, setKq] = useState<KetQuaKiemTra | null>(null);
  const sapHet = k.hetHan && k.hetHan - Date.now() < 7 * 86_400_000;
  async function kiemTra() {
    try {
      const r = await api<KetQuaKiemTra>(`/ket-noi/${k.id}/kiem-tra`, { body: {} });
      setKq(r);
      if (r.loiMcp) toast.error(`MCP chưa trả lời: ${r.loiMcp}`);
      else toast.success(`Kết nối tốt — ${r.congCu.length} công cụ`);
      await onDoi();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  async function xoa() {
    if (!confirm(`Ngắt kết nối "${k.ten}"? Trợ lý sẽ không đọc được số từ đây nữa.`)) return;
    try {
      await api(`/ket-noi/${k.id}`, { method: 'DELETE' });
      await onDoi();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }
  return (
    <div className="rounded-2xl border border-brand-100 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{k.ten}</span>
        {k.trangThai === 'ok' ? <Badge variant="success">đang kết nối</Badge> : <Badge variant="danger">lỗi</Badge>}
        {k.taiKhoan && <span className="text-ink-muted">· {k.taiKhoan}</span>}
        {k.soCongCu > 0 && <span className="text-ink-muted">· {k.soCongCu} công cụ</span>}
        {k.hetHan > 0 && <span className={sapHet ? 'text-rose-600' : 'text-ink-faint'}>· hết hạn {ngay(k.hetHan)}{sapHet ? ' — kết nối lại' : ''}</span>}
        <span className="ml-auto flex gap-2">
          <AsyncButton className="btn-ghost px-3 py-1 text-sm" busyLabel="Đang kiểm tra…" onClick={kiemTra}>
            Kiểm tra
          </AsyncButton>
          <button className="text-sm text-rose-600 underline" onClick={xoa}>
            ngắt
          </button>
        </span>
      </div>
      {k.trangThai !== 'ok' && k.ghiChu && <div className="mt-1 text-xs text-rose-600">{k.ghiChu}</div>}
      {kq?.taiKhoanQc && (
        <div className="mt-2">
          <div className="text-xs font-semibold text-ink-muted">Tài khoản quảng cáo thấy được ({kq.taiKhoanQc.length})</div>
          <ul className="mt-1 max-h-48 overflow-y-auto text-xs text-ink-soft">
            {kq.taiKhoanQc.map((t) => (
              <li key={t.id}>
                {t.ten} · {t.id} · {t.tienTe}
                {t.trangThai !== 1 && <span className="text-rose-600"> · không hoạt động ({t.trangThai})</span>}
              </li>
            ))}
          </ul>
        </div>
      )}
      {k.congCu.length > 0 && (
        <details className="mt-2 text-xs text-ink-muted">
          <summary className="cursor-pointer select-none">Công cụ trợ lý dùng được ({k.congCu.length})</summary>
          <ul className="mt-1 space-y-0.5 pl-3">
            {k.congCu.map((c) => (
              <li key={c.name}>
                <b>{c.name}</b>
                {c.description ? ` — ${c.description}` : ''}
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export default function AdminKetNoi() {
  const toast = useToast();
  const [dl, setDl] = useState<DuLieu | null>(null);
  const [moi, setMoi] = useState({ ten: '', url: '', token: '' });

  async function tai() {
    setDl(await api<DuLieu>('/ket-noi'));
  }
  useEffect(() => {
    // Facebook đăng nhập xong chuyển về /admin?ket_noi=…
    const p = new URLSearchParams(window.location.search);
    const kn = p.get('ket_noi');
    if (kn === 'meta_ok') toast.success(`Đã kết nối Meta Ads${p.get('ten') ? ` — ${p.get('ten')}` : ''}. Bấm "Kiểm tra" để xem tài khoản quảng cáo.`);
    else if (kn === 'loi') toast.error(`Kết nối chưa được: ${p.get('thong_bao') || 'lỗi không rõ'}`);
    if (kn) window.history.replaceState({}, '', window.location.pathname);
    tai().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function ketNoiFacebook() {
    try {
      const r = await api<{ url: string }>('/ket-noi/meta/bat-dau');
      window.location.href = r.url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function themMcp() {
    try {
      const r = await api<{ ok: boolean; congCu: unknown[]; loiMcp?: string }>('/ket-noi/mcp', { body: moi });
      if (r.loiMcp) toast.error(`Đã lưu, nhưng MCP chưa trả lời: ${r.loiMcp}`);
      else toast.success(`Đã kết nối — ${r.congCu.length} công cụ`);
      setMoi({ ten: '', url: '', token: '' });
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!dl) return <div className="card text-sm text-ink-muted">Đang tải…</div>;
  const meta = dl.ds.find((k) => k.nenTang === 'meta');
  const khac = dl.ds.filter((k) => k.nenTang === 'mcp');

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">🔌 Kết nối nền tảng (MCP)</h2>
        <p className="text-sm text-ink-muted">
          Nối tài khoản quảng cáo / website vào MTJOB qua <b>MCP miễn phí</b>. Trợ lý của anh đọc số thật từ đây (chi tiêu, kết quả,
          chiến dịch…). <b>Chỉ đọc</b> — mọi thay đổi chiến dịch phải do anh làm / duyệt. Chỉ giám đốc thấy mục này.
        </p>
      </div>
      {dl.canCapNhatDb && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Cần bấm <b>🛠 Cập nhật cấu trúc DB</b> ở đầu trang trước.
        </div>
      )}
      {!dl.coKhoa && (
        <div className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Máy chủ chưa có khoá mã hoá — thêm biến <code>KET_NOI_KEY</code> (chuỗi ngẫu nhiên ≥ 32 ký tự) trên Vercel rồi Redeploy.
        </div>
      )}

      {/* Meta Ads */}
      <div className="space-y-2">
        <div className="font-semibold">📘 Meta Ads (Facebook / Instagram) — MCP chính thức của Meta</div>
        {meta ? (
          <DongKetNoi k={meta} onDoi={tai} />
        ) : (
          <p className="text-sm text-ink-muted">
            Chưa kết nối. Bấm nút dưới, đăng nhập Facebook bằng nick quản trị Business Manager MT Digital, chọn BM / các tài khoản quảng cáo cho
            phép.{' '}
            {!dl.meta.daCauHinh && (
              <b>Không cần tạo app Meta, không cần xác minh BM</b>
            )}
            {!dl.meta.daCauHinh && ' (MTJOB tự đăng ký với máy chủ MCP của Meta, giống Claude / ChatGPT).'}
          </p>
        )}
        <AsyncButton className={meta ? 'btn-ghost' : 'btn-primary'} busyLabel="Đang mở Facebook…" onClick={ketNoiFacebook}>
          {meta ? '↻ Kết nối lại Facebook' : 'Kết nối Facebook'}
        </AsyncButton>
        {!dl.meta.daCauHinh && (
          <details className="rounded-xl bg-brand-50 p-3 text-sm text-ink-soft">
            <summary className="cursor-pointer select-none font-semibold">
              Dự phòng — chỉ khi nút trên báo Meta không cho tự đăng ký: tạo app Meta (~10 phút, chế độ phát triển, không cần xác minh BM)
            </summary>
            <ol className="list-decimal space-y-1 pl-5">
              <li>
                Vào <b>developers.facebook.com</b> → My Apps → <b>Create App</b> → loại <b>Business</b>, gắn Business Manager MT Digital.
              </li>
              <li>
                Thêm sản phẩm <b>Facebook Login for Business</b>. Ở Settings, ô <b>Valid OAuth Redirect URIs</b> dán:
                <div className="mt-1 flex items-center gap-2">
                  <code className="break-all rounded bg-white px-2 py-0.5 text-xs">{dl.meta.duongVe}</code>
                  <button
                    className="text-xs text-ocean-700 underline"
                    onClick={() => navigator.clipboard?.writeText(dl.meta.duongVe).then(() => toast.success('Đã chép'))}
                  >
                    chép
                  </button>
                </div>
              </li>
              <li>
                Xin quyền: <b>ads_read</b>, <b>ads_mcp_management</b>, <b>business_management</b> (app ở chế độ phát triển vẫn dùng được cho
                tài khoản quản trị app).
              </li>
              <li>
                Vào Vercel → Project mtjob → Settings → Environment Variables: thêm <code>META_APP_ID</code>, <code>META_APP_SECRET</code>{' '}
                (App settings → Basic), rồi <b>Redeploy</b>. Nút <b>Kết nối Facebook</b> sẽ tự dùng app này.
              </li>
            </ol>
          </details>
        )}
      </div>

      {/* Google */}
      <div className="space-y-1">
        <div className="font-semibold">🔍 Google Ads · GA4 · Search Console</div>
        <p className="text-sm text-ink-muted">
          Chạy các MCP miễn phí chính chủ của Google trên máy Mac (đợt sau em gửi script cài). Cài xong thêm ở ô <b>MCP khác</b> bên dưới.
        </p>
      </div>

      {/* n8n (anh Tâm 11/11/2026: "kết hợp n8n đi, anh đã có sẵn kinh nghiệm n8n") */}
      <div className="space-y-1">
        <div className="font-semibold">⚙️ n8n — nối mọi thứ còn lại (Sheets, Drive, Zalo OA, Lark…)</div>
        <p className="text-sm text-ink-muted">
          n8n tự cài là "Composio miễn phí": workflow nào anh cho phép thì trợ lý gọi được. Dán địa chỉ + mã vào ô <b>MCP khác</b> bên dưới.
        </p>
        <details className="rounded-xl bg-brand-50 p-3 text-sm text-ink-soft">
          <summary className="cursor-pointer select-none font-semibold">Cách nối n8n (chọn 1 trong 2)</summary>
          <div className="mt-2 space-y-2">
            <div>
              <b>Cách 1 — cả n8n (n8n ≥ 2.2, khuyên dùng):</b>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>n8n → Settings → <b>Instance-level MCP</b> → bật <b>Enable MCP access</b>.</li>
                <li>
                  Bấm <b>Connect a client</b> → tab <b>API key</b> → chép <b>Server URL</b> (đuôi <code>/mcp-server/http</code>) và mã token (chỉ chép được lúc đang mở
                  tab đó).
                </li>
                <li>
                  Workflow nào muốn trợ lý dùng: Settings của workflow → bật <b>Available in MCP</b>, rồi <b>Publish</b>.
                </li>
              </ol>
            </div>
            <div>
              <b>Cách 2 — từng workflow:</b> tạo workflow bắt đầu bằng nút <b>MCP Server Trigger</b>, Authentication = <b>Bearer Auth</b>, gắn các
              tool (Google Sheets, HTTP Request…), Publish → chép <b>Production URL</b> + mã Bearer.
            </div>
            <div className="text-xs text-ink-muted">
              n8n trên máy Mac / máy nhà: mở ra Internet bằng Cloudflare Tunnel (https). Có Nginx thì tắt proxy buffering cho đường <code>/mcp</code>. Workflow
              anh cho phép là trợ lý được chạy — chỉ bật những workflow an toàn (đọc số, gửi báo cáo cho anh…).
            </div>
          </div>
        </details>
      </div>

      {/* MCP khác */}
      <div className="space-y-2">
        <div className="font-semibold">🧩 MCP khác (n8n / máy Mac / máy chủ riêng)</div>
        {khac.map((k) => (
          <DongKetNoi key={k.id} k={k} onDoi={tai} />
        ))}
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_1.5fr_auto]">
          <input className="input" placeholder="Tên (vd n8n công ty)" value={moi.ten} onChange={(e) => setMoi({ ...moi, ten: e.target.value })} />
          <input className="input" placeholder="https://n8n…/mcp-server/http" value={moi.url} onChange={(e) => setMoi({ ...moi, url: e.target.value })} autoCapitalize="off" spellCheck={false} />
          <input className="input" type="password" placeholder="Mã bí mật (nếu có)" value={moi.token} onChange={(e) => setMoi({ ...moi, token: e.target.value })} autoComplete="off" />
          <AsyncButton busyLabel="Đang nối…" disabled={!/^https:\/\/.+/.test(moi.url.trim())} onClick={themMcp}>
            Thêm
          </AsyncButton>
        </div>
      </div>
    </div>
  );
}
