import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from '../components/AsyncButton';
import MemberTable from '../components/MemberTable';
import StorageCard from '../components/StorageCard';
import { useToast } from '../components/Toaster';

/**
 * Chọn model: danh sách lấy từ API của nhà cung cấp, nhưng vẫn gõ tay được
 * (endpoint tuỳ biến có thể không hỗ trợ liệt kê model).
 */
function ModelPicker({
  id,
  value,
  placeholder,
  models,
  loading,
  error,
  onRefresh,
  onSave,
}: {
  id: string;
  value: string;
  placeholder: string;
  models: Array<{ id: string; label: string }>;
  loading: boolean;
  error: string;
  onRefresh: () => void;
  onSave: (v: string) => void;
}) {
  const [draft, setDraft] = useState(value);
  useEffect(() => setDraft(value), [value]);

  return (
    <div className="mt-3">
      <label className="label" htmlFor={id}>
        Model {loading ? '(đang lấy danh sách…)' : `(${models.length} model khả dụng)`}
      </label>
      <div className="flex flex-wrap gap-2">
        <input
          id={id}
          className="input max-w-[24rem]"
          list={`${id}-list`}
          placeholder={placeholder}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && onSave(draft.trim())}
        />
        <datalist id={`${id}-list`}>
          {models.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </datalist>
        <AsyncButton className="btn-primary whitespace-nowrap" onClick={() => onSave(draft.trim())} busyLabel="Đang lưu…">
          Lưu model
        </AsyncButton>
        <button className="btn-ghost whitespace-nowrap" onClick={onRefresh} disabled={loading}>
          ↻ Tải lại danh sách
        </button>
      </div>
      {error ? (
        <p className="mt-1 text-xs text-amber-700">Không lấy được danh sách ({error}) — bạn gõ tên model trực tiếp nhé.</p>
      ) : (
        <p className="mt-1 text-xs text-ink-muted">Bấm vào ô để chọn từ danh sách, hoặc gõ tên model bất kỳ.</p>
      )}
    </div>
  );
}

export default function Admin() {
  const toast = useToast();
  const [aiOn, setAiOn] = useState<boolean | null>(null);
  const [authUrl, setAuthUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [aiModel, setAiModel] = useState('');
  const [provider, setProvider] = useState<'gemini' | 'claude'>('gemini');
  const [hasClaudeKey, setHasClaudeKey] = useState(false);
  const [claudeKey, setClaudeKey] = useState('');
  const [claudeModel, setClaudeModel] = useState('');
  const [claudeBaseUrl, setClaudeBaseUrl] = useState('');
  const [autoCapture, setAutoCapture] = useState(true);
  const [checks, setChecks] = useState<Check[] | null>(null);
  const [pointSync, setPointSync] = useState<PointSync | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [modelsError, setModelsError] = useState('');
  const [loadingModels, setLoadingModels] = useState(false);
  const [syncInfo, setSyncInfo] = useState<{ taskSheetUrl: string }>({ taskSheetUrl: '' });

  interface Check {
    name: string;
    ok: boolean;
    detail: string;
  }

  interface ModelOption {
    id: string;
    label: string;
  }

  /** Kết quả áp bảng điểm mới lên việc đã ghi (trả kèm khi đồng bộ bảng điểm). */
  interface PointSync {
    updated: number;
    byMember: Array<{ memberName: string; tasks: number; delta: number }>;
    byTask: Array<{ taskName: string; cu: number; moi: number; tasks: number }>;
    lockedMonths: string[];
    skipped?: string;
  }

  interface CatalogSync {
    updated: number;
    tabs: string[];
    points: PointSync;
  }

  interface AiInfo {
    model: string;
    provider: 'gemini' | 'claude';
    hasClaudeKey: boolean;
    claudeModel: string;
    claudeBaseUrl: string;
    autoCapture: boolean;
  }

  useEffect(() => {
    api<{ env: { gemini: boolean } }>('/health')
      .then((r) => setAiOn(!!r.env.gemini))
      .catch(() => setAiOn(null));
    api<{ taskSheetUrl: string }>('/admin/sync-info')
      .then(setSyncInfo)
      .catch(() => undefined);
    api<AiInfo>('/admin/ai-info')
      .then((r) => {
        setAiModel(r.model || '');
        setProvider(r.provider || 'gemini');
        setHasClaudeKey(!!r.hasClaudeKey);
        setClaudeModel(r.claudeModel || '');
        setClaudeBaseUrl(r.claudeBaseUrl || '');
        setAutoCapture(r.autoCapture !== false);
        loadModels(r.provider || 'gemini');
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function refreshAiStatus() {
    const h = await api<{ env: { gemini: boolean } }>('/health');
    setAiOn(!!h.env.gemini);
  }

  /** Lấy danh sách model từ API của nhà cung cấp đang chọn. */
  async function loadModels(which: 'gemini' | 'claude') {
    setLoadingModels(true);
    setModelsError('');
    try {
      const r = await api<{ models: ModelOption[]; error?: string }>(`/admin/ai-models?provider=${which}`);
      setModels(r.models);
      if (r.error) setModelsError(r.error);
      else if (r.models.length === 0) setModelsError('Không có model nào được trả về.');
    } catch (e) {
      setModels([]);
      setModelsError((e as Error).message);
    } finally {
      setLoadingModels(false);
    }
  }

  async function saveAiModel(value: string) {
    const prev = aiModel;
    setAiModel(value);
    try {
      await api('/admin/config', { body: { key: 'geminiModel', value } });
      toast.success(value ? `Đã chuyển sang ${value}.` : 'Dùng model mặc định (flash).');
    } catch (e) {
      setAiModel(prev);
      toast.error((e as Error).message);
    }
  }

  async function saveAutoCapture(on: boolean) {
    const prev = autoCapture;
    setAutoCapture(on);
    try {
      await api('/admin/config', { body: { key: 'brainAutoCapture', value: on ? '' : 'off' } });
      toast.success(on ? 'AI sẽ tự ghi tri thức đáng nhớ từ hội thoại.' : 'Đã tắt — chỉ lưu khi bấm nút.');
    } catch (e) {
      setAutoCapture(prev);
      toast.error((e as Error).message);
    }
  }

  async function saveProvider(value: 'gemini' | 'claude') {
    const prev = provider;
    setProvider(value);
    try {
      await api('/admin/config', { body: { key: 'aiProvider', value } });
      toast.success(value === 'claude' ? 'Trợ lý đang dùng Claude.' : 'Trợ lý đang dùng Gemini.');
      await refreshAiStatus();
      await loadModels(value); // model của mỗi nhà cung cấp khác nhau
    } catch (e) {
      setProvider(prev);
      toast.error((e as Error).message);
    }
  }

  async function saveClaudeKey() {
    const value = claudeKey.trim();
    if (!value) return toast.error('Chưa nhập API key.');
    try {
      await api('/admin/config', { body: { key: 'claudeApiKey', value } });
      setClaudeKey('');
      setHasClaudeKey(true);
      toast.success('Đã lưu API key Claude.');
      await refreshAiStatus();
      await loadModels('claude'); // có key rồi mới liệt kê model được
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveClaudeModel(value: string) {
    const prev = claudeModel;
    setClaudeModel(value);
    try {
      await api('/admin/config', { body: { key: 'claudeModel', value } });
      toast.success(value ? `Claude đang dùng ${value}.` : 'Claude dùng model mặc định.');
    } catch (e) {
      setClaudeModel(prev);
      toast.error((e as Error).message);
    }
  }

  async function saveClaudeBaseUrl() {
    try {
      await api('/admin/config', { body: { key: 'claudeBaseUrl', value: claudeBaseUrl.trim() } });
      toast.success(claudeBaseUrl.trim() ? 'Đã lưu địa chỉ endpoint.' : 'Đã trả về endpoint mặc định.');
      await refreshAiStatus();
      await loadModels('claude'); // endpoint mới có thể phục vụ danh sách model khác
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function syncCatalog() {
    try {
      const r = await api<CatalogSync>('/admin/sync-catalog', { method: 'POST' });
      toast.success(`Đã cập nhật ${r.updated} đầu việc từ: ${r.tabs.join(', ')}`);
      // Điểm ăn thẳng vào thưởng — kết quả phải nằm lại trên màn hình, không trôi theo toast.
      setPointSync(r.points);
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function saveApiKey() {
    const value = apiKey.trim();
    if (!value.startsWith('AIza') || value.length < 30) {
      toast.error('Key không hợp lệ — API key Gemini bắt đầu bằng "AIza...".');
      return;
    }
    try {
      await api('/admin/config', { body: { key: 'geminiApiKey', value } });
      setApiKey('');
      toast.success('Đã lưu API key — trợ lý AI bật ngay, không cần redeploy.');
      const h = await api<{ env: { gemini: boolean } }>('/health');
      setAiOn(!!h.env.gemini);
    } catch (e) {
      toast.error((e as Error).message);
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
        toast.info(
          'Đã mở trang đăng nhập Google ở tab mới. Sau khi đồng ý, trang callback sẽ hiển thị GEMINI_OAUTH_REFRESH_TOKEN — copy giá trị đó vào biến môi trường (Vercel/server) rồi redeploy.',
        );
      } else {
        toast.info('Trình duyệt chặn tab mới — bấm vào nút "Mở trang đăng nhập Google" bên dưới nhé.');
      }
    } catch (e) {
      if (w && !w.closed) w.close();
      toast.error((e as Error).message);
    }
  }

  async function testConnection() {
    setChecks(null);
    try {
      const r = await api<{ checks: Check[]; allOk: boolean }>('/admin/test-connection', { method: 'POST' });
      setChecks(r.checks);
      if (r.allOk) toast.success('Tất cả đều kết nối tốt ✓');
      else toast.error('Có mục chưa kết nối được — xem chi tiết bên dưới.');
      await refreshAiStatus();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  /** Gửi ngay báo cáo công việc cho chính mình — kiểm tra đường thông báo, khỏi chờ 17:15. */
  async function testReport() {
    try {
      await api('/admin/test-report', { method: 'POST' });
      toast.success('Đã gửi — mở Thông báo → tab 📊 Báo cáo để xem.');
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function migrateDb() {
    try {
      const r = await api<{ core: string; brain: string }>('/admin/migrate-db', { method: 'POST' });
      if (r.brain === 'ok') {
        toast.success('Đã cập nhật cấu trúc DB — bảng, index và kho tri thức đều sẵn sàng.');
      } else {
        // Phần chính đã xong; chỉ kho tri thức lỗi (thường do pgvector).
        toast.success('Đã cập nhật cấu trúc DB (phần chính).');
        toast.error(`Kho tri thức chưa tạo được: ${r.brain}`);
      }
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  return (
    <div className="space-y-4">
      <div className="card flex items-center justify-between gap-3 flex-wrap">
        <div>
          <h1 className="text-lg font-bold">Quản trị</h1>
          <p className="text-sm text-ink-muted">
            Nhân sự và lương nhập thẳng ở bảng bên dưới. Bảng điểm task vẫn đồng bộ từ Google Sheet (điểm = cột EXPERT).
          </p>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1 text-sm">
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
        <div className="flex gap-2 flex-wrap">
          <AsyncButton className="btn-primary" onClick={syncCatalog} busyLabel="Đang đồng bộ…">
            Đồng bộ bảng điểm
          </AsyncButton>
          <AsyncButton className="btn-ghost" onClick={migrateDb} busyLabel="Đang cập nhật…">
            🛠 Cập nhật cấu trúc DB
          </AsyncButton>
          <AsyncButton className="btn-ghost" onClick={testConnection} busyLabel="Đang kiểm tra…">
            🔌 Kiểm tra kết nối
          </AsyncButton>
          <AsyncButton className="btn-ghost" onClick={testReport} busyLabel="Đang gửi…">
            📊 Gửi thử báo cáo
          </AsyncButton>
        </div>
      </div>

      {/* Kết quả áp bảng điểm mới lên việc cũ */}
      {pointSync && (
        <div className="card">
          <div className="mb-2 flex items-center justify-between gap-2">
            <h2 className="font-semibold">Điểm việc cũ theo bảng điểm mới</h2>
            <button className="text-xs text-ink-faint underline" onClick={() => setPointSync(null)}>
              đóng
            </button>
          </div>

          {pointSync.skipped ? (
            <p className="text-sm text-rose-600">⚠️ {pointSync.skipped}</p>
          ) : pointSync.updated === 0 ? (
            <p className="text-sm text-emerald-700">Điểm việc cũ đã khớp bảng điểm ✓</p>
          ) : (
            <>
              <p className="text-sm text-ink-soft">
                Đã đổi điểm <b>{pointSync.updated}</b> việc cũ theo bảng điểm mới.
              </p>

              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-ink-muted">
                  <tr>
                    <th className="py-1">Loại việc</th>
                    <th className="text-right">Điểm</th>
                    <th className="text-right">Số việc</th>
                  </tr>
                </thead>
                <tbody>
                  {pointSync.byTask.map((t) => (
                    <tr key={`${t.taskName}-${t.cu}-${t.moi}`} className="border-t">
                      <td className="py-1">{t.taskName}</td>
                      <td className="text-right whitespace-nowrap">
                        {t.cu}đ → <b className={t.moi < t.cu ? 'text-rose-600' : 'text-emerald-700'}>{t.moi}đ</b>
                      </td>
                      <td className="text-right">{t.tasks}</td>
                    </tr>
                  ))}
                </tbody>
              </table>

              <table className="mt-3 w-full text-sm">
                <thead className="text-left text-ink-muted">
                  <tr>
                    <th className="py-1">Nhân sự</th>
                    <th className="text-right">Việc đổi</th>
                    <th className="text-right">Điểm thay đổi</th>
                  </tr>
                </thead>
                <tbody>
                  {pointSync.byMember.map((m) => (
                    <tr key={m.memberName} className="border-t">
                      <td className="py-1">{m.memberName}</td>
                      <td className="text-right">{m.tasks}</td>
                      <td className={`text-right ${m.delta < 0 ? 'text-rose-600' : 'text-emerald-700'}`}>
                        {m.delta > 0 ? '+' : ''}
                        {m.delta}đ
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </>
          )}

          {pointSync.lockedMonths.length > 0 && (
            <p className="mt-2 text-xs text-ink-muted">
              Tháng đã khoá lương ({pointSync.lockedMonths.join(', ')}) giữ nguyên, không bị đụng tới.
            </p>
          )}
        </div>
      )}

      {/* Kết quả kiểm tra kết nối */}
      {checks && (
        <div className="card">
          <div className="mb-2 flex items-center justify-between">
            <h2 className="font-semibold">Kết quả kiểm tra</h2>
            <button className="text-xs text-ink-faint underline" onClick={() => setChecks(null)}>
              đóng
            </button>
          </div>
          <ul className="divide-y">
            {checks.map((c) => (
              <li key={c.name} className="flex items-start gap-2 py-2 text-sm">
                <span className={c.ok ? 'text-emerald-700' : 'text-rose-600'}>{c.ok ? '✓' : '✕'}</span>
                <div className="min-w-0">
                  <div className="font-medium text-ink">{c.name}</div>
                  <div className={`break-words ${c.ok ? 'text-ink-muted' : 'text-rose-600'}`}>{c.detail}</div>
                </div>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="card">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div>
            <h2 className="font-semibold">
              Trợ lý AI{' '}
              {aiOn === null ? null : aiOn ? (
                <span className="text-xs rounded-full px-2 py-0.5 bg-emerald-100 text-emerald-700">Đang BẬT</span>
              ) : (
                <span className="text-xs rounded-full px-2 py-0.5 bg-amber-100 text-amber-700">Chưa bật — chat chạy chế độ cơ bản</span>
              )}
            </h2>
            <p className="text-sm text-ink-muted mt-1">
              Chọn nhà cung cấp cho phần <b>hỏi-đáp dữ liệu</b>. Phần nhận diện tin nhắn ghi việc của nhân viên luôn dùng
              Gemini Flash cho nhanh và rẻ.
            </p>
          </div>
          <div className="flex items-center gap-2">
            <label className="label mb-0" htmlFor="ai-provider">Nhà cung cấp:</label>
            <select
              id="ai-provider"
              className="input max-w-[10rem]"
              value={provider}
              onChange={(e) => saveProvider(e.target.value as 'gemini' | 'claude')}
            >
              <option value="gemini">Gemini</option>
              <option value="claude">Claude</option>
            </select>
          </div>
        </div>

        <label className="mt-3 flex cursor-pointer items-start gap-2 rounded-xl bg-brand-50 p-3 text-sm">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={autoCapture}
            onChange={(e) => saveAutoCapture(e.target.checked)}
          />
          <span>
            <b>Tự ghi tri thức từ hội thoại</b>
            <span className="block text-xs text-ink-muted">
              Sau mỗi câu trả lời dài, AI tự xét xem có đáng nhớ lâu dài không (quy trình, quyết định,
              thông tin khách) rồi lưu vào kho. Tra cứu số liệu tạm thời thì bỏ qua. Xem lại ở Kho tri thức,
              nhóm “AI tự ghi nhận”.
            </span>
          </span>
        </label>

        {provider === 'gemini' ? (
          <div className="mt-4 border-t border-brand-100 pt-3">
            <p className="text-sm text-ink-muted mb-2">
              Lấy API key tại{' '}
              <a className="text-brand-600 underline" href="https://aistudio.google.com/apikey" target="_blank" rel="noreferrer">
                aistudio.google.com/apikey
              </a>{' '}
              rồi dán vào ô dưới — <b>hiệu lực ngay, không cần redeploy</b>.
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                className="input"
                type="password"
                placeholder="Dán API key Gemini (AIza...)"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
              />
              <AsyncButton className="btn-primary whitespace-nowrap" onClick={saveApiKey} busyLabel="Đang lưu…">
                Lưu key
              </AsyncButton>
              <button className="btn-ghost whitespace-nowrap" onClick={geminiLogin}>
                🔑 Đăng nhập Google
              </button>
              {authUrl && (
                <a className="btn-primary whitespace-nowrap" href={authUrl} target="_blank" rel="noreferrer">
                  👉 Mở trang đăng nhập Google
                </a>
              )}
            </div>
            <ModelPicker
              id="ai-model"
              value={aiModel}
              placeholder="Để trống = mặc định (gemini-2.5-flash)"
              models={models}
              loading={loadingModels}
              error={modelsError}
              onRefresh={() => loadModels('gemini')}
              onSave={saveAiModel}
            />
          </div>
        ) : (
          <div className="mt-4 border-t border-brand-100 pt-3">
            <p className="text-sm text-ink-muted mb-2">
              Lấy API key tại{' '}
              <a className="text-brand-600 underline" href="https://console.anthropic.com/settings/keys" target="_blank" rel="noreferrer">
                console.anthropic.com
              </a>{' '}
              — trả theo mức dùng, không phải thuê bao.{' '}
              {hasClaudeKey && <span className="text-emerald-700">Đã có key được lưu.</span>}
            </p>
            <div className="flex gap-2 flex-wrap">
              <input
                className="input"
                type="password"
                placeholder={hasClaudeKey ? 'Dán key mới để thay thế' : 'Dán API key Claude'}
                value={claudeKey}
                onChange={(e) => setClaudeKey(e.target.value)}
              />
              <AsyncButton className="btn-primary whitespace-nowrap" onClick={saveClaudeKey} busyLabel="Đang lưu…">
                Lưu key
              </AsyncButton>
            </div>
            <ModelPicker
              id="claude-model"
              value={claudeModel}
              placeholder="Để trống = mặc định (claude-sonnet-5)"
              models={models}
              loading={loadingModels}
              error={modelsError}
              onRefresh={() => loadModels('claude')}
              onSave={saveClaudeModel}
            />
            <div className="mt-3">
              <label className="label" htmlFor="claude-base">
                Địa chỉ endpoint (tuỳ chọn — để trống dùng mặc định của Anthropic)
              </label>
              <div className="flex gap-2 flex-wrap">
                <input
                  id="claude-base"
                  className="input"
                  placeholder="https://api.anthropic.com"
                  value={claudeBaseUrl}
                  onChange={(e) => setClaudeBaseUrl(e.target.value)}
                />
                <AsyncButton className="btn-ghost whitespace-nowrap" onClick={saveClaudeBaseUrl} busyLabel="Đang lưu…">
                  Lưu endpoint
                </AsyncButton>
              </div>
            </div>
          </div>
        )}
      </div>

      <StorageCard />

      <MemberTable />
    </div>
  );
}
