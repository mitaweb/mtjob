// Quản trị → 🔌 Kết nối nền tảng (anh Tâm 10–11/11/2026). CHỈ giám đốc.
//  - Meta Ads: MCP chính thức của Meta, đăng nhập Facebook qua app Meta của công ty (chế độ phát triển — không cần xác
//    minh BM; Meta không cho MTJOB tự đăng ký).
//  - Google Ads · GA4 · Search Console: học cách Javis OS — dán Client ID / Secret ngay đây, bấm Kết nối Google.
//  - n8n / MCP khác: địa chỉ https + mã bí mật.
// Mọi khoá / mã bí mật lưu BẢN MÃ trên máy chủ; trang chỉ biết "đã có".
import { useEffect, useState, type ReactNode } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';
import { Badge } from './ui';

interface KetNoi {
  id: string;
  nenTang: 'meta' | 'google' | 'mcp';
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

interface CauHinh {
  meta_app_id?: string;
  meta_app_secret?: boolean;
  google_client_id?: string;
  google_client_secret?: boolean;
  google_dev_token?: boolean;
  google_mcc?: string;
}

interface DuLieu {
  ds: KetNoi[];
  cauHinh: CauHinh;
  duongVe: { meta: string; google: string };
  coKhoa: boolean;
  canCapNhatDb: boolean;
}

interface KetQuaKiemTra {
  congCu: Array<{ name: string }>;
  taiSan: Array<{ loai: string; id: string; ten: string; ghiChu?: string }>;
  loi: string[];
}

const ngay = (ms: number) => (ms ? new Date(ms).toLocaleDateString('vi-VN') : '');

function DongKetNoi({ k, onDoi, hetHanTuLamMoi }: { k: KetNoi; onDoi: () => Promise<void>; hetHanTuLamMoi?: boolean }) {
  const toast = useToast();
  const [kq, setKq] = useState<KetQuaKiemTra | null>(null);
  const sapHet = !hetHanTuLamMoi && k.hetHan && k.hetHan - Date.now() < 7 * 86_400_000;
  async function kiemTra() {
    try {
      const r = await api<KetQuaKiemTra>(`/ket-noi/${k.id}/kiem-tra`, { body: {} });
      setKq(r);
      if (r.loi.length) toast.error(r.loi[0]!);
      else toast.success(`Kết nối tốt — ${r.taiSan.length ? `${r.taiSan.length} tài sản` : `${r.congCu.length} công cụ`}`);
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
  const nhom = kq ? [...new Set(kq.taiSan.map((t) => t.loai))] : [];
  return (
    <div className="rounded-2xl border border-brand-100 p-3 text-sm">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">{k.ten}</span>
        {k.trangThai === 'ok' ? <Badge variant="success">đang kết nối</Badge> : <Badge variant="danger">lỗi</Badge>}
        {k.taiKhoan && <span className="text-ink-muted">· {k.taiKhoan}</span>}
        {k.soCongCu > 0 && <span className="text-ink-muted">· {k.soCongCu} công cụ</span>}
        {!hetHanTuLamMoi && k.hetHan > 0 && (
          <span className={sapHet ? 'text-rose-600' : 'text-ink-faint'}>
            · hết hạn {ngay(k.hetHan)}
            {sapHet ? ' — kết nối lại' : ''}
          </span>
        )}
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
      {kq?.loi.map((l) => (
        <div key={l} className="mt-1 text-xs text-rose-600">
          {l}
        </div>
      ))}
      {nhom.map((n) => {
        const ds = kq!.taiSan.filter((t) => t.loai === n);
        return (
          <div key={n} className="mt-2">
            <div className="text-xs font-semibold text-ink-muted">
              {n} ({ds.length})
            </div>
            <ul className="mt-1 max-h-40 overflow-y-auto text-xs text-ink-soft">
              {ds.map((t) => (
                <li key={t.id}>
                  {t.ten || '(không tên)'} · {t.id}
                  {t.ghiChu ? ` · ${t.ghiChu}` : ''}
                </li>
              ))}
            </ul>
          </div>
        );
      })}
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

function ChepDuongVe({ url }: { url: string }) {
  const toast = useToast();
  return (
    <span className="mt-1 flex items-center gap-2">
      <code className="break-all rounded bg-white px-2 py-0.5 text-xs">{url}</code>
      <button type="button" className="text-xs text-ocean-700 underline" onClick={() => navigator.clipboard?.writeText(url).then(() => toast.success('Đã chép'))}>
        chép
      </button>
    </span>
  );
}

/** Ô dán khoá app: id hiện rõ; bí mật bỏ trống = giữ cái đã lưu. */
function OCauHinh({
  truong,
  cauHinh,
  onLuu,
}: {
  truong: Array<{ khoa: keyof CauHinh; nhan: string; biMat?: boolean; goiY?: string }>;
  cauHinh: CauHinh;
  onLuu: (patch: Record<string, string>) => Promise<void>;
}) {
  const [gt, setGt] = useState<Record<string, string>>({});
  useEffect(() => {
    setGt(Object.fromEntries(truong.filter((t) => !t.biMat).map((t) => [t.khoa, String(cauHinh[t.khoa] || '')])));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cauHinh]);
  return (
    <div className="grid gap-2 sm:grid-cols-2">
      {truong.map((t) => (
        <label key={t.khoa} className="text-sm">
          <span className="label">{t.nhan}</span>
          <input
            className="input"
            type={t.biMat ? 'password' : 'text'}
            value={gt[t.khoa] || ''}
            placeholder={t.biMat && cauHinh[t.khoa] ? 'đã lưu — để trống là giữ nguyên' : t.goiY || ''}
            onChange={(e) => setGt({ ...gt, [t.khoa]: e.target.value })}
            autoComplete="off"
            autoCapitalize="off"
            spellCheck={false}
          />
        </label>
      ))}
      <div className="sm:col-span-2">
        <AsyncButton className="btn-ghost" busyLabel="Đang lưu…" onClick={() => onLuu(gt)}>
          Lưu
        </AsyncButton>
      </div>
    </div>
  );
}

function KhungNenTang({ tieuDe, moTa, children }: { tieuDe: ReactNode; moTa?: ReactNode; children: ReactNode }) {
  return (
    <div className="space-y-2 border-t border-brand-100 pt-3">
      <div className="font-semibold">{tieuDe}</div>
      {moTa && <p className="text-sm text-ink-muted">{moTa}</p>}
      {children}
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
    // Facebook / Google đăng nhập xong chuyển về /admin?ket_noi=…
    const p = new URLSearchParams(window.location.search);
    const kn = p.get('ket_noi');
    if (kn === 'meta_ok' || kn === 'google_ok')
      toast.success(`Đã kết nối ${kn === 'meta_ok' ? 'Meta Ads' : 'Google'}${p.get('ten') ? ` — ${p.get('ten')}` : ''}. Bấm "Kiểm tra" để xem tài khoản thấy được.`);
    else if (kn === 'loi') toast.error(`Kết nối chưa được: ${p.get('thong_bao') || 'lỗi không rõ'}`);
    if (kn) window.history.replaceState({}, '', window.location.pathname);
    tai().catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function dangNhap(nen: 'meta' | 'google') {
    try {
      const r = await api<{ url: string }>(`/ket-noi/${nen}/bat-dau`);
      window.location.href = r.url;
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function luu(patch: Record<string, string>) {
    try {
      await api('/ket-noi/cau-hinh', { body: patch });
      toast.success('Đã lưu (mã hoá)');
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function themMcp() {
    try {
      const r = await api<KetQuaKiemTra & { ok: boolean }>('/ket-noi/mcp', { body: moi });
      if (r.loi.length) toast.error(`Đã lưu, nhưng MCP chưa trả lời: ${r.loi[0]}`);
      else toast.success(`Đã kết nối — ${r.congCu.length} công cụ`);
      setMoi({ ten: '', url: '', token: '' });
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  if (!dl) return <div className="card text-sm text-ink-muted">Đang tải…</div>;
  const meta = dl.ds.find((k) => k.nenTang === 'meta');
  const google = dl.ds.find((k) => k.nenTang === 'google');
  const khac = dl.ds.filter((k) => k.nenTang === 'mcp');
  const c = dl.cauHinh;
  const coMeta = !!(c.meta_app_id && c.meta_app_secret);
  const coGoogle = !!(c.google_client_id && c.google_client_secret);

  return (
    <div className="card space-y-4">
      <div>
        <h2 className="font-semibold">🔌 Kết nối nền tảng</h2>
        <p className="text-sm text-ink-muted">
          Nối tài khoản quảng cáo / website vào MTJOB — <b>miễn phí</b>. Trợ lý của anh đọc số thật từ đây (chi tiêu, kết quả, chiến dịch, truy cập,
          từ khoá…). <b>Chỉ đọc</b> — thay đổi chiến dịch do anh làm. Khoá / mật khẩu app lưu dạng mã hoá. Chỉ giám đốc thấy mục này.
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

      {/* ── Meta Ads ── */}
      <KhungNenTang
        tieuDe="📘 Meta Ads (Facebook / Instagram) — MCP chính thức của Meta"
        moTa={
          <>
            Một lần đăng nhập thấy mọi tài khoản quảng cáo nick anh có quyền (của BM + tài khoản khách chia sẻ vào BM). Dùng app Meta của công ty ở{' '}
            <b>chế độ phát triển</b> — <b>không cần xác minh BM</b>, không cần Meta duyệt app.
          </>
        }
      >
        {meta && <DongKetNoi k={meta} onDoi={tai} />}
        {coMeta && (
          <AsyncButton className={meta ? 'btn-ghost' : 'btn-primary'} busyLabel="Đang mở Facebook…" onClick={() => dangNhap('meta')}>
            {meta ? '↻ Kết nối lại Facebook' : 'Kết nối Facebook'}
          </AsyncButton>
        )}
        <details className="rounded-xl bg-brand-50 p-3 text-sm text-ink-soft" open={!coMeta}>
          <summary className="cursor-pointer select-none font-semibold">{coMeta ? 'Sửa App ID / Secret' : 'Bước 1 — tạo app Meta (một lần, ~10 phút)'}</summary>
          <ol className="mb-3 mt-2 list-decimal space-y-1 pl-5">
            <li>
              Vào <b>developers.facebook.com</b> → My Apps → <b>Create App</b> → loại <b>Business</b> (gắn BM MT Digital nếu được hỏi). Để nguyên chế độ{' '}
              <b>Development</b> — KHÔNG cần chuyển Live, KHÔNG cần xác minh doanh nghiệp.
            </li>
            <li>
              Thêm sản phẩm <b>Facebook Login for Business</b> → Settings → ô <b>Valid OAuth Redirect URIs</b> dán:
              <ChepDuongVe url={dl.duongVe.meta} />
            </li>
            <li>
              Nick Facebook anh dùng để đăng nhập phải là <b>Admin / Developer của app</b> (người tạo app là admin sẵn).
            </li>
            <li>
              App settings → <b>Basic</b>: chép <b>App ID</b> và <b>App Secret</b> dán vào ô dưới → Lưu → bấm <b>Kết nối Facebook</b>.
            </li>
          </ol>
          <OCauHinh
            cauHinh={c}
            onLuu={luu}
            truong={[
              { khoa: 'meta_app_id', nhan: 'App ID', goiY: 'Ví dụ: 1234567890123456' },
              { khoa: 'meta_app_secret', nhan: 'App Secret', biMat: true },
            ]}
          />
        </details>
      </KhungNenTang>

      {/* ── Google ── */}
      <KhungNenTang
        tieuDe="🔍 Google Ads · GA4 · Search Console"
        moTa={
          <>
            Một lần đăng nhập Gmail công ty (có quyền MCC / GA4 / Search Console) — MTJOB gọi thẳng API Google, <b>không cần máy Mac</b>, miễn phí.
          </>
        }
      >
        {google && <DongKetNoi k={google} onDoi={tai} hetHanTuLamMoi />}
        {coGoogle && (
          <AsyncButton className={google ? 'btn-ghost' : 'btn-primary'} busyLabel="Đang mở Google…" onClick={() => dangNhap('google')}>
            {google ? '↻ Kết nối lại Google' : 'Kết nối Google'}
          </AsyncButton>
        )}
        <details className="rounded-xl bg-brand-50 p-3 text-sm text-ink-soft" open={!coGoogle}>
          <summary className="cursor-pointer select-none font-semibold">{coGoogle ? 'Sửa Client ID / Secret / MCC' : 'Bước 1 — tạo OAuth client Google (một lần, ~10 phút)'}</summary>
          <ol className="mb-3 mt-2 list-decimal space-y-1 pl-5">
            <li>
              Vào <b>console.cloud.google.com</b> → tạo project (vd "MTJOB") → APIs &amp; Services → Library, bật 4 API: <b>Google Ads API</b>,{' '}
              <b>Google Analytics Data API</b>, <b>Google Analytics Admin API</b>, <b>Google Search Console API</b>.
            </li>
            <li>
              Mở trang Google Ads API của project → <b>Apply for access</b> mức <b>Explorer</b> (đọc được tài khoản thật, thường duyệt vài phút).
            </li>
            <li>
              <b>Google Auth Platform → Audience</b>: chọn External, bấm <b>Publish app</b> (để Testing thì Google tự huỷ đăng nhập sau 7 ngày).
            </li>
            <li>
              <b>Clients → Create client</b>, loại <b>Web application</b>, ô <b>Authorized redirect URIs</b> dán:
              <ChepDuongVe url={dl.duongVe.google} />
            </li>
            <li>
              Dán <b>Client ID</b> + <b>Client Secret</b> vào ô dưới, điền mã <b>MCC</b> (10 số) để thấy hết tài khoản khách → Lưu → <b>Kết nối Google</b>. Gặp
              "ứng dụng chưa được xác minh" thì bấm Nâng cao → Tiếp tục (app của chính công ty).
            </li>
          </ol>
          <OCauHinh
            cauHinh={c}
            onLuu={luu}
            truong={[
              { khoa: 'google_client_id', nhan: 'OAuth Client ID', goiY: 'xxxx.apps.googleusercontent.com' },
              { khoa: 'google_client_secret', nhan: 'OAuth Client Secret', biMat: true, goiY: 'GOCSPX-…' },
              { khoa: 'google_mcc', nhan: 'Mã MCC Google Ads (tuỳ chọn)', goiY: '123-456-7890' },
              { khoa: 'google_dev_token', nhan: 'Developer token (tuỳ chọn — chỉ khi Google Ads báo cần)', biMat: true },
            ]}
          />
        </details>
      </KhungNenTang>

      {/* ── n8n (anh Tâm 11/11/2026: "kết hợp n8n đi, anh đã có sẵn kinh nghiệm n8n") ── */}
      <KhungNenTang
        tieuDe="⚙️ n8n — nối mọi thứ còn lại (Sheets, Drive, Zalo OA, Lark…)"
        moTa={
          <>
            n8n tự cài là "Composio miễn phí": workflow nào anh cho phép thì trợ lý gọi được. Dán địa chỉ + mã vào ô <b>MCP khác</b> bên dưới.
          </>
        }
      >
        <details className="rounded-xl bg-brand-50 p-3 text-sm text-ink-soft">
          <summary className="cursor-pointer select-none font-semibold">Cách nối n8n (chọn 1 trong 2)</summary>
          <div className="mt-2 space-y-2">
            <div>
              <b>Cách 1 — cả n8n (n8n ≥ 2.2, khuyên dùng):</b>
              <ol className="list-decimal space-y-0.5 pl-5">
                <li>
                  n8n → Settings → <b>Instance-level MCP</b> → bật <b>Enable MCP access</b>.
                </li>
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
              <b>Cách 2 — từng workflow:</b> tạo workflow bắt đầu bằng nút <b>MCP Server Trigger</b>, Authentication = <b>Bearer Auth</b>, gắn các tool (Google
              Sheets, HTTP Request…), Publish → chép <b>Production URL</b> + mã Bearer.
            </div>
            <div className="text-xs text-ink-muted">
              n8n trên máy Mac / máy nhà: mở ra Internet bằng Cloudflare Tunnel (https). Có Nginx thì tắt proxy buffering cho đường <code>/mcp</code>. Workflow anh
              cho phép là trợ lý được chạy — chỉ bật những workflow an toàn (đọc số, gửi báo cáo cho anh…).
            </div>
          </div>
        </details>
      </KhungNenTang>

      {/* ── MCP khác ── */}
      <KhungNenTang tieuDe="🧩 MCP khác (n8n / máy Mac / máy chủ riêng)">
        {khac.map((k) => (
          <DongKetNoi key={k.id} k={k} onDoi={tai} />
        ))}
        <div className="grid gap-2 sm:grid-cols-[1fr_2fr_1.5fr_auto]">
          <input className="input" placeholder="Tên (vd n8n công ty)" value={moi.ten} onChange={(e) => setMoi({ ...moi, ten: e.target.value })} />
          <input
            className="input"
            placeholder="https://n8n…/mcp-server/http"
            value={moi.url}
            onChange={(e) => setMoi({ ...moi, url: e.target.value })}
            autoCapitalize="off"
            spellCheck={false}
          />
          <input className="input" type="password" placeholder="Mã bí mật (nếu có)" value={moi.token} onChange={(e) => setMoi({ ...moi, token: e.target.value })} autoComplete="off" />
          <AsyncButton busyLabel="Đang nối…" disabled={!/^https:\/\/.+/.test(moi.url.trim())} onClick={themMcp}>
            Thêm
          </AsyncButton>
        </div>
      </KhungNenTang>
    </div>
  );
}
