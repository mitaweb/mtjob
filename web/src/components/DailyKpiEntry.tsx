import { Fragment, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toaster';
import AsyncButton from './AsyncButton';

// Ô nhập chỉ số hằng ngày — thứ nhân sự mở app ra để làm mỗi sáng.
//
// Bố cục GOM THEO DỰ ÁN, không xếp phẳng: một bạn Ads chạy 4 khách thì thấy một dãy
// "Lượt hiển thị / Chi phí / Lượt hiển thị / Chi phí…" gần như y hệt nhau, điền số của
// khách này vào ô của khách kia là chuyện sẽ xảy ra — mà đã lưu thì tiến độ dự án sai theo.
// Nên tên dự án phải là thứ mắt chạm vào trước tiên, và mỗi dự án đứng thành một khối riêng.

export interface TodayKpi {
  id: string;
  projectId: string;
  name: string;
  unit: string;
}

export interface TodayRow {
  kpi: TodayKpi;
  projectName: string;
  /** Số đã nhập theo từng ngày đang mở: { '2026-07-31': 86, … } */
  values: Record<string, number | null>;
}

export interface TodayData {
  teamId: string;
  dates: string[];
  rows: TodayRow[];
}

const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** '2026-08-03' → 'T2 03/08'. Có thứ thì nhìn phát biết ngày nào là cuối tuần. */
function nhanNgay(iso: string, today: string): string {
  if (iso === today) return 'Hôm nay';
  const d = new Date(`${iso}T00:00:00`);
  return `${THU[d.getDay()]} ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
}

const O_NHAP_REM = 5.5; // ô chỉ đựng một con số, không cần rộng bằng ô nhập tên

export default function DailyKpiEntry({
  today,
  onSaved,
}: {
  today: TodayData;
  onSaved: () => Promise<unknown>;
}) {
  const toast = useToast();
  const [draft, setDraft] = useState<Record<string, string>>({});
  const homNay = today.dates[today.dates.length - 1] ?? '';

  // Gom chỉ số theo dự án. Sắp xếp theo TÊN (không theo thứ tự máy chủ trả) để mỗi lần
  // tải lại các khối vẫn nằm nguyên chỗ cũ — đang nhập mà thứ tự nhảy là dễ nhầm nhất.
  const blocks = useMemo(() => {
    const m = new Map<string, { name: string; rows: TodayRow[] }>();
    for (const r of today.rows) {
      const b = m.get(r.kpi.projectId) || { name: r.projectName, rows: [] };
      b.rows.push(r);
      m.set(r.kpi.projectId, b);
    }
    return [...m.entries()]
      .map(([id, b]) => ({
        id,
        name: b.name,
        rows: [...b.rows].sort((a, c) => a.kpi.name.localeCompare(c.kpi.name, 'vi')),
      }))
      .sort((a, c) => a.name.localeCompare(c.name, 'vi'));
  }, [today.rows]);

  // Điện thoại: lưới rộng hơn màn hình nên cột "Hôm nay" (ngoài cùng phải) nằm khuất — mà
  // đó đúng là cột phải điền mỗi ngày. Cuộn sẵn tới đó MỘT lần lúc mở, không lặp lại ở các
  // lần vẽ sau để không giật chỗ đang gõ dở. Dùng useLayoutEffect để cuộn xong rồi mới vẽ —
  // useEffect thường sẽ thấy lưới nhảy một cái ngay khi mở.
  const boCuon = useRef<Array<HTMLDivElement | null>>([]);
  const daCuon = useRef(false);
  useLayoutEffect(() => {
    if (daCuon.current || today.rows.length === 0) return;
    daCuon.current = true;
    for (const el of boCuon.current) if (el) el.scrollLeft = el.scrollWidth;
  }, [today.rows.length]);

  const dangGo = (key: string) => (draft[key] ?? '').trim() !== '';
  const oChuaLuu = (rows: TodayRow[]) =>
    rows.flatMap((r) => today.dates.map((d) => `${r.kpi.id}|${d}`)).filter(dangGo);

  /**
   * Ghi số cho một loạt ô. Kiểm HẾT trước khi gửi ô nào — sai một ô mà đã lưu nửa vời
   * thì người nhập không biết số nào đã vào, số nào chưa.
   */
  async function saveKeys(keys: string[]) {
    const items: Array<{ key: string; kpiId: string; date: string; value: number }> = [];
    for (const key of keys) {
      const raw = (draft[key] ?? '').trim();
      if (!raw) continue;
      const value = Number(raw);
      if (!Number.isFinite(value) || value < 0) return toast.error('Có ô chưa phải số không âm — kiểm lại rồi lưu.');
      const [kpiId, date] = key.split('|');
      items.push({ key, kpiId: kpiId!, date: date!, value: Math.round(value) });
    }
    if (items.length === 0) return toast.error('Chưa nhập số nào.');

    // Gửi tuần tự để hỏng ở số nào biết số đó; mỗi lần cùng lắm vài ô nên không chậm.
    const daLuu: string[] = [];
    try {
      for (const it of items) {
        await api(`/projects/kpis/${it.kpiId}/entries`, { body: { date: it.date, value: it.value } });
        daLuu.push(it.key);
      }
      toast.success(items.length === 1 ? 'Đã lưu số.' : `Đã lưu ${items.length} số.`);
    } catch (e) {
      toast.error((e as Error).message);
    } finally {
      // Chỉ xoá nháp của ô ĐÃ vào được máy chủ — ô hỏng giữ nguyên màu vàng để nhập lại.
      if (daLuu.length > 0) {
        setDraft((d) => {
          const next = { ...d };
          for (const k of daLuu) delete next[k];
          return next;
        });
      }
      // Tải lại MỘT lần cho cả lô, thay vì mỗi con số một lần như trước.
      await onSaved();
    }
  }

  // Cột tên rộng vừa đúng nội dung (chặn trên/dưới bằng min-w/max-w ở chính ô đó), rồi tới
  // các ô nhập cỡ cố định. KHÔNG dùng 1fr: màn rộng thì cột tên giãn ra, đẩy ô nhập sang tận
  // mép phải — mắt lại phải dò ngang một quãng trống, đúng cái bệnh đang chữa.
  const cols = `max-content repeat(${today.dates.length}, ${O_NHAP_REM}rem)`;

  return (
    <div className="card">
      <h2 className="mb-1 font-semibold">Chỉ số cần nhập {today.teamId && `— phòng ${today.teamId}`}</h2>

      {!today.teamId ? (
        <p className="text-sm text-slate-500">
          Bạn không thuộc phòng ban nào nên không có chỉ số để nhập. Vẫn xem được tiến độ các dự án bên dưới.
        </p>
      ) : today.rows.length === 0 ? (
        <p className="text-sm text-slate-500">Phòng bạn chưa có chỉ số nào trong các dự án đang chạy.</p>
      ) : (
        <>
          <p className="mb-3 text-xs text-slate-500">
            {today.dates.length > 2
              ? 'Cuối tuần không ai đi làm nên số thứ Sáu, thứ Bảy và Chủ nhật nhập bù được tới hết hôm nay.'
              : 'Số của hôm qua còn sửa được tới hết hôm nay. Sau đó phải nhờ giám đốc nhập bù.'}
          </p>

          <div className="space-y-3">
            {blocks.map((b, i) => {
              const chuaLuu = oChuaLuu(b.rows);
              return (
                <div
                  key={b.id}
                  className="rounded-xl border border-l-4 border-slate-200 border-l-brand-500 p-3"
                >
                  {/* Tên dự án: bên TRÁI, đậm, có vạch màu — nhìn xuống là biết đang nhập cho ai.
                      Nút lưu nằm cùng hàng với tên: thao tác lưu gắn hẳn vào MỘT dự án cụ thể. */}
                  <div className="mb-2 flex flex-wrap items-center justify-between gap-2">
                    <span className="font-semibold text-slate-800">{b.name}</span>
                    <AsyncButton
                      className="btn-ghost px-3 py-1 text-sm"
                      busyLabel="Đang lưu…"
                      disabled={chuaLuu.length === 0}
                      onClick={() => saveKeys(chuaLuu)}
                    >
                      {chuaLuu.length === 0 ? 'Lưu' : `Lưu ${chuaLuu.length} số`}
                    </AsyncButton>
                  </div>

                  <div
                    className="overflow-x-auto"
                    ref={(el) => {
                      boCuon.current[i] = el;
                    }}
                  >
                    <div
                      className="grid w-max items-center gap-x-3 gap-y-1.5"
                      style={{ gridTemplateColumns: cols }}
                    >
                      {/* Nhãn ngày là tiêu đề cột — hiện một lần, không lặp ở từng ô. */}
                      <div className="sticky left-0 z-10 self-stretch bg-white" />
                      {today.dates.map((date) => (
                        <div
                          key={date}
                          className={`text-center text-xs ${
                            date === homNay ? 'font-semibold text-slate-700' : 'text-slate-500'
                          }`}
                        >
                          {nhanNgay(date, homNay)}
                        </div>
                      ))}

                      {b.rows.map((r) => (
                        <Fragment key={r.kpi.id}>
                          {/* Dính bên trái: thứ Hai mở 4 ngày, cuộn ngang trên điện thoại vẫn
                              thấy mình đang nhập cho chỉ số nào.
                              Chặn 11rem trên điện thoại — tên chỉ số dài mà để tự do thì nó
                              chiếm hết bề ngang, đẩy sạch ô nhập ra ngoài màn hình. */}
                          <div className="sticky left-0 z-10 flex min-w-[9rem] max-w-[11rem] items-center self-stretch bg-white pr-2 sm:max-w-[18rem]">
                            <span className="min-w-0 truncate text-sm text-slate-700" title={r.kpi.name}>
                              {r.kpi.name}
                              {r.kpi.unit && <span className="text-slate-400"> ({r.kpi.unit})</span>}
                            </span>
                          </div>
                          {today.dates.map((date) => {
                            const key = `${r.kpi.id}|${date}`;
                            const saved = r.values?.[date] ?? null;
                            // Ba trạng thái nhìn ra ngay: đang gõ (vàng) · đã lưu (xanh) · trống (xám).
                            const mau = dangGo(key)
                              ? 'border-amber-400 bg-amber-50'
                              : saved !== null
                                ? 'border-emerald-200 bg-emerald-50/60'
                                : 'border-slate-200 bg-white';
                            return (
                              <input
                                key={date}
                                className={`w-full rounded-lg border px-2 py-1.5 text-center text-sm text-slate-700 outline-none transition placeholder:text-slate-400 focus:border-brand-500 focus:ring-2 focus:ring-brand-500/15 ${mau}`}
                                type="number"
                                min={0}
                                inputMode="numeric"
                                aria-label={`${b.name} — ${r.kpi.name} — ${nhanNgay(date, homNay)}`}
                                placeholder={saved === null ? '—' : String(saved)}
                                value={draft[key] ?? ''}
                                onChange={(e) => setDraft((d) => ({ ...d, [key]: e.target.value }))}
                                onKeyDown={(e) => e.key === 'Enter' && saveKeys([key])}
                              />
                            );
                          })}
                        </Fragment>
                      ))}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        </>
      )}
    </div>
  );
}
