import { useEffect, useRef, useState } from 'react';
import { locModel, type ModelOption } from '../lib/model';
import AsyncButton from './AsyncButton';

/**
 * Chọn model: danh sách lấy từ API của nhà cung cấp, nhưng vẫn gõ tay được
 * (endpoint tuỳ biến có thể không hỗ trợ liệt kê model).
 *
 * Tự dựng danh sách chứ KHÔNG dùng <input list> + <datalist>. Anh Tâm 21/8/2026: "bấm dấu
 * mũi tên thì không hiện ra model". Datalist LỌC theo nội dung đang có trong ô — ô đang
 * chứa sẵn tên model hiện tại nên chỉ đúng một dòng đó khớp, phải xoá trắng ô mới thấy
 * danh sách. Không ai đoán ra được điều đó.
 */
export default function ModelPicker({
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
  const [open, setOpen] = useState(false);
  // Đã gõ để tìm chưa? Chưa gõ thì hiện ĐỦ danh sách — đó chính là chỗ datalist làm hỏng.
  const [daGo, setDaGo] = useState(false);
  const boxRef = useRef<HTMLDivElement>(null);

  useEffect(() => setDraft(value), [value]);

  // Bấm ra ngoài thì đóng. Không có cái này thì danh sách dính lại khi bấm chỗ khác.
  useEffect(() => {
    if (!open) return;
    const ngoai = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('mousedown', ngoai);
    return () => document.removeEventListener('mousedown', ngoai);
  }, [open]);

  const hien = locModel(models, draft, daGo);

  function chon(mId: string) {
    setDraft(mId);
    setDaGo(false);
    setOpen(false);
  }

  return (
    <div className="mt-3">
      <label className="label" htmlFor={id}>
        Model {loading ? '(đang lấy danh sách…)' : `(${models.length} model khả dụng)`}
      </label>
      <div className="flex flex-wrap gap-2">
        {/* Máy hẹp: ô chiếm trọn dòng, hai nút xuống dòng dưới. Để chung một dòng thì ô
            còn ~190px, tên model dài đọc không ra. */}
        <div className="relative w-full max-w-[24rem] sm:w-auto sm:flex-1" ref={boxRef}>
          <input
            id={id}
            className="input pr-9"
            placeholder={placeholder}
            value={draft}
            autoComplete="off"
            onFocus={() => setOpen(true)}
            onChange={(e) => {
              setDraft(e.target.value);
              setDaGo(true);
              setOpen(true);
            }}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                setOpen(false);
                onSave(draft.trim());
              }
              if (e.key === 'Escape') setOpen(false);
            }}
          />
          <button
            type="button"
            className="absolute inset-y-0 right-0 flex w-9 items-center justify-center rounded-r-xl text-ink-muted hover:text-ink"
            aria-label={open ? 'Đóng danh sách model' : 'Mở danh sách model'}
            aria-expanded={open}
            onClick={() => {
              // Mở lại là bỏ bộ lọc: bấm mũi tên nghĩa là muốn xem TẤT CẢ.
              setDaGo(false);
              setOpen((v) => !v);
            }}
          >
            ▾
          </button>

          {open && (
            <ul className="absolute z-20 mt-1 max-h-64 w-full overflow-y-auto rounded-xl border bg-white shadow-lift">
              {hien.map((m) => (
                <li key={m.id}>
                  <button
                    type="button"
                    className={`block w-full px-3 py-1.5 text-left text-sm hover:bg-brand-50 ${
                      m.id === draft ? 'bg-brand-50 font-medium text-brand-700' : 'text-ink-soft'
                    }`}
                    onClick={() => chon(m.id)}
                  >
                    {m.label}
                    {m.label !== m.id && <span className="block text-xs text-ink-faint">{m.id}</span>}
                  </button>
                </li>
              ))}
              {hien.length === 0 && (
                <li className="px-3 py-2 text-sm text-ink-muted">
                  {models.length === 0 ? 'Chưa lấy được danh sách model.' : 'Không có model nào khớp.'}
                </li>
              )}
            </ul>
          )}
        </div>
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
        <p className="mt-1 text-xs text-ink-muted">
          Bấm ▾ để xem cả {models.length} model, hoặc gõ để lọc — gõ tên model bất kỳ cũng được.
        </p>
      )}
    </div>
  );
}
