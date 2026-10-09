// AI riêng cho Kho tri thức (anh Tâm 10/10/2026: "gemini báo đã đầy, em thiết kế thêm 1 chỗ cài đặt
// model ở trong phần quản trị dành riêng cho kho tri thức, anh sẽ lựa chọn model").
// Dùng cho: phân loại mục, tự ghi từ chat, hồ sơ khách, đọc tệp, Zalo (rút ý, xét nhóm khách).
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import ModelPicker from './ModelPicker';
import { useToast } from './Toaster';
import type { ModelOption } from '../lib/model';

type NhaCungCap = 'gemini' | 'claude';

interface AiInfo {
  hasClaudeKey: boolean;
  claudeBaseUrl: string;
  brainAiProvider: NhaCungCap;
  brainAiModel: string;
  brainAiFallback: string;
}

export default function AdminBrainAi() {
  const toast = useToast();
  const [info, setInfo] = useState<AiInfo | null>(null);
  const [models, setModels] = useState<ModelOption[]>([]);
  const [loi, setLoi] = useState('');
  const [dangTai, setDangTai] = useState(false);
  const [thu, setThu] = useState<{ ok: boolean; message: string } | null>(null);

  async function taiModel(ncc: NhaCungCap) {
    setDangTai(true);
    setLoi('');
    try {
      const r = await api<{ models: ModelOption[]; error?: string }>(`/admin/ai-models?provider=${ncc}`);
      setModels(r.models);
      if (r.error) setLoi(r.error);
    } catch (e) {
      setModels([]);
      setLoi((e as Error).message);
    } finally {
      setDangTai(false);
    }
  }

  useEffect(() => {
    api<AiInfo>('/admin/ai-info')
      .then((r) => {
        const ncc: NhaCungCap = r.brainAiProvider === 'claude' ? 'claude' : 'gemini';
        setInfo({ ...r, brainAiProvider: ncc, brainAiModel: r.brainAiModel || '', brainAiFallback: r.brainAiFallback || '' });
        taiModel(ncc);
      })
      .catch(() => undefined);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function luu(key: 'brainAiProvider' | 'brainAiModel' | 'brainAiFallback', value: string, bao: string) {
    if (!info) return;
    const cu = info;
    setInfo({ ...info, [key]: value });
    setThu(null);
    try {
      await api('/admin/config', { body: { key, value } });
      toast.success(bao);
    } catch (e) {
      setInfo(cu);
      toast.error((e as Error).message);
    }
  }

  async function doiNhaCungCap(ncc: NhaCungCap) {
    if (!info) return;
    // Model của nhà cung cấp cũ không dùng được cho nhà cung cấp mới → xoá về mặc định.
    const cu = info;
    setInfo({ ...info, brainAiProvider: ncc, brainAiModel: '', brainAiFallback: '' });
    setThu(null);
    try {
      await api('/admin/config', { body: { key: 'brainAiProvider', value: ncc } });
      await api('/admin/config', { body: { key: 'brainAiModel', value: '' } });
      await api('/admin/config', { body: { key: 'brainAiFallback', value: '' } });
      toast.success(`Kho tri thức dùng ${ncc === 'claude' ? 'Claude' : 'Gemini'}.`);
      await taiModel(ncc);
    } catch (e) {
      setInfo(cu);
      toast.error((e as Error).message);
    }
  }

  async function thuNgay() {
    try {
      setThu(await api<{ ok: boolean; message: string }>('/admin/brain-ai-test', { body: {} }));
    } catch (e) {
      setThu({ ok: false, message: (e as Error).message });
    }
  }

  if (!info) return null;
  const claude = info.brainAiProvider === 'claude';

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <h2 className="font-semibold">🧠 AI cho Kho tri thức</h2>
          <p className="mt-1 text-sm text-ink-muted">
            Riêng cho việc <b>phân loại tri thức, đọc tệp, hồ sơ khách, Zalo</b> (rút lưu ý, xét nhóm khách). Trợ lý hỏi-đáp ở trên không đổi
            theo. Phần tìm kiếm trong kho vẫn dùng Gemini (Claude không có chức năng này).
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <label className="label mb-0 whitespace-nowrap" htmlFor="brain-ai-provider">
            Nhà cung cấp:
          </label>
          <select
            id="brain-ai-provider"
            className="input max-w-[10rem]"
            value={info.brainAiProvider}
            onChange={(e) => doiNhaCungCap(e.target.value as NhaCungCap)}
          >
            <option value="gemini">Gemini</option>
            <option value="claude">Claude</option>
          </select>
        </div>
      </div>

      <p className="rounded-xl bg-brand-50 p-3 text-sm text-ink-soft">
        🔑 Dùng <b>chung API key</b> đã lưu ở phần <b>Trợ lý AI</b> phía trên —{' '}
        {claude ? (
          <>
            key Claude{' '}
            {info.claudeBaseUrl ? (
              <>
                và endpoint riêng <b>{info.claudeBaseUrl}</b>
              </>
            ) : (
              <>với endpoint mặc định của Anthropic</>
            )}
            .
          </>
        ) : (
          <>key Gemini (AIza…).</>
        )}{' '}
        Chỉ <b>model</b> là chọn riêng ở đây.
      </p>

      {claude && !info.hasClaudeKey && (
        <p className="rounded-xl bg-amber-50 p-3 text-sm text-amber-800">
          Chưa có API key Claude — chọn Claude ở phần <b>Trợ lý AI</b> phía trên để dán key trước.
        </p>
      )}

      <div>
        <div className="label">Model chính</div>
        <ModelPicker
          id="brain-ai-model"
          value={info.brainAiModel}
          placeholder={claude ? 'Để trống = model Claude của trợ lý' : 'Để trống = mặc định (gemini-2.5-flash)'}
          models={models}
          loading={dangTai}
          error={loi}
          onRefresh={() => taiModel(info.brainAiProvider)}
          onSave={(v) => luu('brainAiModel', v, v ? `Kho tri thức dùng ${v}.` : 'Kho tri thức dùng model mặc định.')}
        />
      </div>

      <div>
        <div className="label">Model dự phòng — tự chuyển sang khi model chính hết lượt / quá tải</div>
        <ModelPicker
          id="brain-ai-fallback"
          value={info.brainAiFallback}
          placeholder={claude ? 'Để trống = không dùng dự phòng' : 'Để trống = không dùng dự phòng (vd gemini-2.5-flash-lite)'}
          models={models}
          loading={dangTai}
          error={loi}
          onRefresh={() => taiModel(info.brainAiProvider)}
          onSave={(v) => luu('brainAiFallback', v, v ? `Dự phòng: ${v}.` : 'Đã bỏ model dự phòng.')}
        />
      </div>

      <div className="flex flex-wrap items-center gap-2 border-t border-brand-100 pt-3">
        <AsyncButton className="btn-ghost" onClick={thuNgay} busyLabel="Đang thử…">
          ⚡ Thử AI kho tri thức
        </AsyncButton>
        {thu && <span className={`text-sm ${thu.ok ? 'text-emerald-700' : 'text-rose-700'}`}>{thu.ok ? '✓ ' : '✗ '}{thu.message}</span>}
      </div>
      <p className="text-xs text-ink-muted">
        Gợi ý khi Gemini báo hết lượt (429): mỗi model Gemini có hạn mức riêng — chọn model khác (vd <b>gemini-2.5-flash-lite</b>,{' '}
        <b>gemini-2.0-flash</b>) hoặc đặt làm dự phòng. Muốn hết hẳn giới hạn thì bật thanh toán cho API key ở Google AI Studio, hoặc chuyển sang
        Claude.
      </p>
    </div>
  );
}
