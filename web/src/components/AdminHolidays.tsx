// Ngày lễ theo năm (anh Tâm 5/10/2026: "chỗ để cập nhật ngày lễ nghỉ để giảm công, mỗi năm mỗi
// khác"). Ngày lễ trừ thẳng vào công chuẩn của tháng; tháng đã chốt lương thì không đổi nữa.
import { useEffect, useState } from 'react';
import { api } from '../lib/api';
import AsyncButton from './AsyncButton';
import { useToast } from './Toaster';

interface Le {
  date: string;
  name: string;
}
interface GoiY extends Le {
  daCo: boolean;
}
interface DuLieu {
  year: number;
  holidays: Le[];
  goiY: GoiY[];
  congChuan: Array<{ month: number; days: number }>;
}

const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];
const thuCua = (iso: string) => THU[new Date(`${iso}T00:00:00Z`).getUTCDay()]!;
const cuoiTuan = (iso: string) => [0, 6].includes(new Date(`${iso}T00:00:00Z`).getUTCDay());
const dmy = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;

export default function AdminHolidays() {
  const toast = useToast();
  const [nam, setNam] = useState(new Date().getFullYear());
  const [d, setD] = useState<DuLieu | null>(null);
  const [moi, setMoi] = useState({ date: '', name: '' });
  const [chonGoiY, setChonGoiY] = useState<Record<string, boolean>>({});

  async function tai(y = nam) {
    const r = await api<DuLieu>(`/admin/holidays?year=${y}`);
    setD(r);
    setChonGoiY(Object.fromEntries(r.goiY.filter((g) => !g.daCo).map((g) => [g.date, true])));
  }
  useEffect(() => {
    tai(nam).catch((e) => toast.error((e as Error).message));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [nam]);

  async function them() {
    if (!moi.date || !moi.name.trim()) return toast.error('Chọn ngày và nhập tên ngày lễ.');
    try {
      await api('/admin/holidays', { body: { date: moi.date, name: moi.name.trim() } });
      toast.success(`Đã thêm ${dmy(moi.date)}`);
      setMoi({ date: '', name: '' });
      if (Number(moi.date.slice(0, 4)) !== nam) setNam(Number(moi.date.slice(0, 4)));
      else await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function xoa(le: Le) {
    if (!window.confirm(`Bỏ ngày lễ ${dmy(le.date)} — ${le.name}? Công chuẩn tháng đó sẽ tăng lại.`)) return;
    try {
      await api(`/admin/holidays/${le.date}`, { method: 'DELETE' });
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  async function themGoiY() {
    const items = (d?.goiY || []).filter((g) => !g.daCo && chonGoiY[g.date]).map(({ date, name }) => ({ date, name }));
    if (!items.length) return toast.error('Chưa chọn ngày nào.');
    try {
      await api('/admin/holidays/bulk', { body: { items } });
      toast.success(`Đã thêm ${items.length} ngày lễ năm ${nam}`);
      await tai();
    } catch (e) {
      toast.error((e as Error).message);
    }
  }

  const conGoiY = (d?.goiY || []).filter((g) => !g.daCo);

  return (
    <div className="card space-y-3">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="font-semibold">📅 Ngày lễ nghỉ</h2>
          <p className="text-xs text-ink-muted">
            Ngày lễ được trừ khỏi công chuẩn của tháng. Tháng đã chốt lương thì không đổi nữa.
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button className="btn-ghost px-2 py-1" onClick={() => setNam(nam - 1)} aria-label="Năm trước">
            ‹
          </button>
          <span className="w-14 text-center font-semibold">{nam}</span>
          <button className="btn-ghost px-2 py-1" onClick={() => setNam(nam + 1)} aria-label="Năm sau">
            ›
          </button>
        </div>
      </div>

      {conGoiY.length > 0 && (
        <div className="rounded-xl border border-brand-100 bg-brand-50 p-3 text-sm">
          <div className="mb-1 font-medium">Các lễ lớn năm {nam} chưa có trong lịch</div>
          <p className="mb-2 text-xs text-ink-muted">
            Theo Bộ luật Lao động. Tết Âm lịch là đề xuất (29/30 Tết + mùng 1–4) — ngày chính thức do Chính phủ công bố mỗi năm,
            anh bỏ chọn / sửa cho khớp. Lễ trùng thứ 7, Chủ nhật thì thêm ngày nghỉ bù bằng tay.
          </p>
          <ul className="space-y-1">
            {conGoiY.map((g) => (
              <li key={g.date}>
                <label className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={!!chonGoiY[g.date]}
                    onChange={(e) => setChonGoiY({ ...chonGoiY, [g.date]: e.target.checked })}
                  />
                  <span className="w-24 shrink-0 tabular-nums">
                    {thuCua(g.date)} {dmy(g.date).slice(0, 5)}
                  </span>
                  <span className="min-w-0">
                    {g.name}
                    {cuoiTuan(g.date) && <span className="text-amber-700"> · cuối tuần, cần nghỉ bù</span>}
                  </span>
                </label>
              </li>
            ))}
          </ul>
          <AsyncButton className="btn-primary mt-2 px-3 py-1 text-sm" onClick={themGoiY} busyLabel="Đang thêm…">
            Thêm các ngày đã chọn
          </AsyncButton>
        </div>
      )}

      <div>
        <div className="mb-1 text-sm font-medium">Lịch nghỉ lễ năm {nam} ({d?.holidays.length ?? 0} ngày)</div>
        {d && d.holidays.length === 0 ? (
          <p className="text-sm text-ink-muted">Chưa có ngày lễ nào.</p>
        ) : (
          <ul className="divide-y">
            {(d?.holidays || []).map((le) => (
              <li key={le.date} className="flex items-center justify-between gap-2 py-1.5 text-sm">
                <span className="min-w-0">
                  <span className="inline-block w-24 tabular-nums">
                    {thuCua(le.date)} {dmy(le.date)}
                  </span>
                  {le.name}
                  {cuoiTuan(le.date) && <span className="text-xs text-ink-faint"> (cuối tuần — không trừ công)</span>}
                </span>
                <button className="shrink-0 text-xs text-rose-600 underline" onClick={() => xoa(le)}>
                  bỏ
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-2">
        <label className="text-xs text-ink-muted">
          Ngày
          <input type="date" className="input py-1" value={moi.date} onChange={(e) => setMoi({ ...moi, date: e.target.value })} />
        </label>
        <label className="min-w-[10rem] flex-1 text-xs text-ink-muted">
          Tên
          <input
            className="input py-1"
            placeholder="vd: Nghỉ bù Quốc khánh"
            value={moi.name}
            onChange={(e) => setMoi({ ...moi, name: e.target.value })}
            onKeyDown={(e) => e.key === 'Enter' && them()}
          />
        </label>
        <AsyncButton className="btn-primary px-3 py-1.5 text-sm" onClick={them} busyLabel="…">
          ＋ Thêm ngày nghỉ
        </AsyncButton>
      </div>

      {d && (
        <div>
          <div className="mb-1 text-xs font-medium text-ink-muted">Công chuẩn từng tháng (T2–T6, trừ ngày lễ)</div>
          <div className="grid grid-cols-4 gap-1 text-center text-xs sm:grid-cols-12">
            {d.congChuan.map((c) => (
              <div key={c.month} className="rounded-lg bg-brand-50 px-1 py-1">
                <div className="text-ink-muted">T{c.month}</div>
                <div className="font-semibold">{c.days}</div>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
