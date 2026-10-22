// Chấm công: nhắc chấm giờ ra + gợi ý toạ độ công ty (anh Tâm 22/10/2026: "có bạn chấm công báo 1 công rồi nhưng nay
// vô lại mất, còn 0.5, có bạn ở cty nhưng gps nhận 2000m").
//
// Đã kiểm log máy chủ 20–21/10: bạn bị nửa công KHÔNG có lượt "giờ ra" nào tới máy chủ (lấy vị trí lỗi trên máy / quên
// bấm) — máy chủ không xoá gì. Nên: nhắc người đã chấm vào mà chưa chấm ra, sau giờ tan ca.
import { q } from '../db/client.js';
import { getConfig } from '../config.js';
import { shiftConfigFrom } from '../lib/attendance.js';
import { todayIso, minuteOfDayTz } from '../lib/datetime.js';
import { notify } from './notifications.service.js';

/** Nhắc trong khoảng [tan ca + 10 phút, tan ca + 2 giờ]; mỗi người mỗi ngày MỘT lần (ref_id). */
export async function nhacChamGioRa(): Promise<number> {
  const cfg = await getConfig();
  const ca = shiftConfigFrom(cfg);
  const phut = minuteOfDayTz();
  if (phut < ca.afternoonEnd + 10 || phut > ca.afternoonEnd + 120) return 0;
  const ngay = todayIso();
  // Có giờ vào THẬT (mốc giờ, không phải cờ đơn online / quên chấm) mà chưa có giờ ra nào.
  const rows = await q(
    `SELECT member_id, morning_in_at, afternoon_in_at FROM attendance
      WHERE date = $1 AND mode = 'office' AND COALESCE(afternoon_out_at, '') = '' AND COALESCE(morning_out_at, '') = ''
        AND (morning_in_at LIKE '20%' OR afternoon_in_at LIKE '20%')`,
    [ngay],
  );
  if (!rows.length) return 0;
  const ref = (id: string) => `chamra-${ngay}-${id}`;
  const daNhac = new Set(
    (await q('SELECT ref_id FROM notifications WHERE ref_id = ANY($1)', [rows.map((r) => ref(String(r.member_id)))])).map((r) =>
      String(r.ref_id),
    ),
  );
  let n = 0;
  for (const r of rows) {
    const id = String(r.member_id);
    if (daNhac.has(ref(id))) continue;
    await notify(id, {
      type: 'attendance',
      title: '⏰ Bạn chưa chấm giờ ra',
      body: 'Hôm nay bạn đã chấm giờ vào nhưng chưa chấm giờ ra — chấm ngay để đủ 1 công. Không chấm được (vị trí báo xa) thì làm đơn Quên chấm công.',
      url: '/attendance',
      refId: ref(id),
    });
    n++;
  }
  return n;
}

/**
 * Vị trí văn phòng theo các lần chấm công THẬT ở văn phòng (30 ngày, trung vị — một vài lần GPS lệch không kéo lệch).
 * Toạ độ cài trong app lệch thì mọi người đều "cách công ty" cùng một khoảng (22/10/2026: ai cũng ~280m).
 */
export async function goiYViTriCongTy(): Promise<{ lat: number; lng: number; soLan: number; khoangCachTrungVi: number } | null> {
  const r = await q(
    `SELECT COUNT(*)::int AS n,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY lat) AS lat,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY lng) AS lng,
            percentile_cont(0.5) WITHIN GROUP (ORDER BY dist_m) AS dist
       FROM attendance
      WHERE mode = 'office' AND lat IS NOT NULL AND lng IS NOT NULL AND dist_m IS NOT NULL AND dist_m < 1000
        AND date >= to_char(now() - interval '30 days', 'YYYY-MM-DD')`,
  );
  const x = r[0];
  if (!x || Number(x.n) < 10) return null;
  return { lat: Number(x.lat), lng: Number(x.lng), soLan: Number(x.n), khoangCachTrungVi: Math.round(Number(x.dist)) };
}
