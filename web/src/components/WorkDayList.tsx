import { EmptyState } from './ui';
import { fmtMin } from '../lib/format';

// Danh sách công việc THEO NGÀY, kèm khung giờ và cảnh báo.
// Dùng chung cho hai màn hình: giám đốc soi nhân sự (MemberWorkDetail) và
// nhân viên tự xem mình (trang Điểm) — để hai bên luôn nhìn thấy y hệt nhau.

export interface DetailTask {
  id: string;
  title: string;
  points: number;
  completedAt: string;
  startHm: string; // '' = không bấm nút Bắt đầu, báo thẳng qua chat
  endHm: string;
  minutes: number | null; // null = không đo được thời gian làm
  overlap: boolean; // chồng giờ với việc khác trong ngày
  crossDay: boolean; // bắt đầu từ hôm trước
  adjusted?: boolean; // điểm giám đốc nhập bù, không phải việc làm thật
}

/** Điểm có dấu — dòng bù có thể âm, viết "+-300đ" thì đọc không ra. */
const signed = (n: number) => `${n >= 0 ? '+' : ''}${n}đ`;

export interface DayBlock {
  date: string;
  points: number;
  minutes: number;
  noTimeCount: number;
  tasks: DetailTask[];
}

const fmtDay = (iso: string) => {
  const d = new Date(iso);
  const weekday = ['CN', 'T2', 'T3', 'T4', 'T5', 'T6', 'T7'][d.getDay()];
  return `${weekday}, ${iso.slice(8, 10)}/${iso.slice(5, 7)}`;
};

export default function WorkDayList({ days, emptyText }: { days: DayBlock[]; emptyText: string }) {
  if (days.length === 0) return <EmptyState icon="📭" text={emptyText} />;

  return (
    <>
      {days.map((d) => (
        <div key={d.date} className="mt-3 rounded-xl border border-brand-100 p-3">
          <div className="flex items-center justify-between gap-2 text-sm">
            <span className="font-medium text-ink">📅 {fmtDay(d.date)}</span>
            <span className="text-xs text-ink-muted">
              {d.tasks.length} việc · <b className="text-brand-600">{signed(d.points)}</b>
              {d.minutes > 0 && ` · ⏱ ${fmtMin(d.minutes)}`}
              {d.noTimeCount > 0 && (
                <span className="text-amber-700"> · ⚠️ {d.noTimeCount} việc không có giờ</span>
              )}
            </span>
          </div>

          <ul className="mt-1.5 space-y-1.5">
            {d.tasks.map((t) => (
              <li key={t.id} className={t.overlap ? 'border-l-2 border-amber-400 pl-2' : 'pl-2'}>
                <div className="flex items-start justify-between gap-2 text-sm">
                  <span className="text-ink-soft">{t.title}</span>
                  <span className="whitespace-nowrap text-xs text-ink-faint">{signed(t.points)}</span>
                </div>
                {/* Giờ làm là dữ liệu gốc để đối chiếu điểm — hiện rõ từng việc. */}
                <div className="text-xs text-ink-faint">
                  {t.adjusted ? (
                    // Dòng nhập tay: không có giờ là ĐÚNG, đừng gắn cảnh báo làm anh tưởng lỗi.
                    <span className="text-brand-600">✎ điểm nhập bù</span>
                  ) : t.minutes === null ? (
                    <span className="text-amber-700">⚠️ không có giờ làm (báo thẳng)</span>
                  ) : (
                    <>
                      ⏱ {t.crossDay && <span className="text-ink-faint">(hôm trước) </span>}
                      {t.startHm} → {t.endHm} · {fmtMin(t.minutes)}
                      {t.minutes < 1 && <span className="text-amber-700"> · ⚠️ dưới 1 phút</span>}
                    </>
                  )}
                  {t.overlap && <span className="text-amber-700"> · ⚠️ chồng giờ</span>}
                </div>
              </li>
            ))}
          </ul>

          {d.tasks.some((t) => t.overlap) && (
            <p className="mt-1.5 text-xs text-ink-faint">
              ⏱ ở trên là giờ làm đã gộp khoảng chồng lấn, nên tổng thời lượng từng việc có thể lớn
              hơn — không phải lỗi.
            </p>
          )}
        </div>
      ))}
    </>
  );
}
