import { useEffect, useMemo, useState } from 'react';
import { api } from '../lib/api';
import { useToast } from './Toaster';

// Lịch của tôi: 30 ngày tới, mỗi ngày có gì thì chấm màu; bấm vào ngày xem chi tiết.
// Anh Tâm 18/8/2026: "xem được ngày nào có lịch gì trong tháng".

type LoaiMuc = 'reminder' | 'appointment' | 'birthday' | 'holiday' | 'request';

interface MucLich {
  loai: LoaiMuc;
  gio: string;
  ten: string;
  ghiChu?: string;
}

interface NgayLich {
  ngay: string;
  mucs: MucLich[];
}

const LOAI: Record<LoaiMuc, { nhan: string; icon: string; cham: string; nen: string }> = {
  reminder: { nhan: 'Nhắc hẹn', icon: '⏰', cham: 'bg-brand-600', nen: 'bg-brand-50 text-brand-700' },
  appointment: { nhan: 'Hẹn khách', icon: '📅', cham: 'bg-emerald-500', nen: 'bg-emerald-50 text-emerald-700' },
  birthday: { nhan: 'Sinh nhật', icon: '🎂', cham: 'bg-amber-500', nen: 'bg-amber-50 text-amber-800' },
  holiday: { nhan: 'Ngày lễ', icon: '🎌', cham: 'bg-rose-500', nen: 'bg-rose-50 text-rose-700' },
  request: { nhan: 'Đơn của tôi', icon: '🗒', cham: 'bg-violet-500', nen: 'bg-violet-50 text-violet-700' },
};
const THU = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'];

/** 'YYYY-MM-DD' → Date lúc 12h trưa: tránh lệch ngày do đổi múi giờ/giờ mùa hè. */
const toDate = (iso: string) => new Date(`${iso}T12:00:00`);
const ngayVn = (iso: string) => toDate(iso).toLocaleDateString('vi-VN', { day: '2-digit', month: '2-digit' });

export default function MyCalendar({ onClose }: { onClose: () => void }) {
  const toast = useToast();
  const [days, setDays] = useState<NgayLich[]>([]);
  const [loading, setLoading] = useState(true);
  const [chon, setChon] = useState('');

  useEffect(() => {
    api<{ days: NgayLich[] }>('/calendar?days=30')
      .then((r) => {
        setDays(r.days);
        setChon(r.days[0]?.ngay || '');
      })
      .catch((e) => toast.error((e as Error).message))
      .finally(() => setLoading(false));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Chèn ô trống đầu tuần để ngày rơi đúng cột thứ — nhìn lịch mà lệch cột thì vô dụng.
  const oTrong = days.length ? toDate(days[0].ngay).getDay() : 0;

  const homNay = days[0]?.ngay || '';
  const ngayDangChon = useMemo(() => days.find((d) => d.ngay === chon), [days, chon]);
  const tongMuc = useMemo(() => days.reduce((s, d) => s + d.mucs.length, 0), [days]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center overflow-y-auto bg-ink/40 p-4"
      onClick={onClose}
    >
      <div className="card hien-len my-8 w-full max-w-lg" onClick={(e) => e.stopPropagation()}>
        <div className="mb-1 flex items-center justify-between">
          <h2 className="font-semibold">📆 Lịch của tôi</h2>
          <button className="btn-ghost px-2 py-1 text-sm" onClick={onClose}>
            ✕ Đóng
          </button>
        </div>
        <p className="mb-3 text-sm text-ink-muted">
          {days.length
            ? `${ngayVn(days[0].ngay)} → ${ngayVn(days[days.length - 1].ngay)}. Bấm vào một ngày để xem ngày đó có gì.`
            : '30 ngày tới. Bấm vào một ngày để xem ngày đó có gì.'}
        </p>

        {loading && <div className="py-6 text-center text-sm text-ink-muted">Đang tải…</div>}

        {!loading && (
          <>
            <div className="grid grid-cols-7 gap-1 text-center text-xs text-ink-muted">
              {THU.map((t) => (
                <div key={t} className="py-1">
                  {t}
                </div>
              ))}
            </div>
            <div className="grid grid-cols-7 gap-1">
              {Array.from({ length: oTrong }, (_, i) => (
                <div key={`trong-${i}`} />
              ))}
              {days.map((d) => {
                const laHomNay = d.ngay === homNay;
                const dangChon = d.ngay === chon;
                // Nhiều loại trong một ngày thì mỗi loại một chấm, không lặp chấm cùng màu.
                const loais = Array.from(new Set(d.mucs.map((m) => m.loai)));
                return (
                  <button
                    key={d.ngay}
                    onClick={() => setChon(d.ngay)}
                    className={`flex min-h-[3rem] flex-col items-center justify-start rounded-xl border p-1 text-xs transition ${
                      dangChon
                        ? 'border-brand-600 bg-brand-50 font-semibold text-brand-700'
                        : 'border-brand-100 hover:bg-brand-50'
                    }`}
                  >
                    <span className={laHomNay && !dangChon ? 'font-bold text-brand-700' : ''}>
                      {/* Ngày 1 ghi kèm tháng: 30 ngày vắt qua hai tháng, không có mốc này
                          thì nhìn số 1 không biết đang là tháng nào. */}
                      {toDate(d.ngay).getDate() === 1
                        ? `1/${toDate(d.ngay).getMonth() + 1}`
                        : toDate(d.ngay).getDate()}
                    </span>
                    <span className="mt-1 flex flex-wrap justify-center gap-0.5">
                      {loais.map((l) => (
                        <span key={l} className={`h-1.5 w-1.5 rounded-full ${LOAI[l].cham}`} />
                      ))}
                    </span>
                  </button>
                );
              })}
            </div>

            {/* Chú thích màu — không có thì mấy cái chấm chỉ là chấm. */}
            <div className="mt-3 flex flex-wrap gap-x-3 gap-y-1 text-xs text-ink-muted">
              {(Object.keys(LOAI) as LoaiMuc[]).map((l) => (
                <span key={l} className="flex items-center gap-1">
                  <span className={`h-1.5 w-1.5 rounded-full ${LOAI[l].cham}`} />
                  {LOAI[l].nhan}
                </span>
              ))}
            </div>

            {/* Chi tiết ngày đang chọn */}
            <div className="mt-3 border-t border-brand-100 pt-3">
              <h3 className="mb-2 text-sm font-semibold">
                {chon ? `Ngày ${ngayVn(chon)}${chon === homNay ? ' (hôm nay)' : ''}` : 'Chọn một ngày'}
              </h3>
              {ngayDangChon && ngayDangChon.mucs.length === 0 && (
                <p className="text-sm text-ink-muted">Ngày này trống.</p>
              )}
              <ul className="space-y-1.5">
                {ngayDangChon?.mucs.map((m, i) => (
                  <li key={`${m.loai}-${i}`} className={`rounded-xl px-3 py-2 text-sm ${LOAI[m.loai].nen}`}>
                    <div className="flex items-baseline gap-2">
                      <span>{LOAI[m.loai].icon}</span>
                      {m.gio && <span className="shrink-0 font-semibold">{m.gio}</span>}
                      <span className="min-w-0 break-words font-medium">{m.ten}</span>
                    </div>
                    {m.ghiChu && <div className="mt-0.5 pl-6 text-xs opacity-80">{m.ghiChu}</div>}
                  </li>
                ))}
              </ul>
            </div>

            {tongMuc === 0 && (
              <p className="mt-3 text-sm text-ink-muted">
                30 ngày tới chưa có gì. Đặt nhắc hẹn ở mục ⏰ Nhắc hẹn, hoặc nhắn cho trợ lý.
              </p>
            )}
          </>
        )}
      </div>
    </div>
  );
}
