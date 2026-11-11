// Việc tự động (học Javis — anh Tâm 11/11/2026 chọn mục 5). Anh nói với trợ lý "mỗi sáng 8h kéo số Google Ads khách X
// so tuần trước" → một việc lặp. Tới giờ, chuỗi cron gọi trợ lý của anh ở chế độ CHỈ ĐỌC (không ghi gì vào hệ thống),
// kết quả qua BƯỚC KIỂM LẠI (lỗi thấy ngay + AI kiểm có trả lời đúng yêu cầu bằng số liệu thật không). Đạt → thông báo +
// nằm trong khung chat của anh. Sai → thử lại sau 10 phút; sai 3 lần liền → tự dừng, báo khẩn.
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { nowTz, todayIso } from '../lib/datetime.js';
import { isDue, describeRule, hhmmToMinutes, type RepeatKind } from '../lib/reminder.js';
import { loiRoRang, sauLuot, THU_LAI_SAU_MS, SAI_TOI_DA, type TrangThaiViec } from '../lib/viecTuDong.js';
import { notify } from './notifications.service.js';
import type { ToolDef } from './assistant.service.js';

export interface ViecTuDong {
  id: string;
  memberId: string;
  ten: string;
  yeuCau: string;
  atTime: string;
  repeatKind: RepeatKind;
  onDate: string;
  weekday: number;
  dayOfMonth: number;
  trangThai: TrangThaiViec;
  soLanLoi: number;
  lastFired: string;
  thuLaiLuc: number;
  ketQua: string;
  lyDo: string;
  lanChay: string;
  taoLuc: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(r: any): ViecTuDong {
  return {
    id: String(r.id),
    memberId: String(r.member_id || ''),
    ten: String(r.ten || ''),
    yeuCau: String(r.yeu_cau || ''),
    atTime: String(r.at_time || '08:00'),
    repeatKind: (r.repeat_kind || 'daily') as RepeatKind,
    onDate: String(r.on_date || ''),
    weekday: Number(r.weekday ?? 1),
    dayOfMonth: Number(r.day_of_month ?? 1),
    trangThai: (['chay', 'dung', 'tu_dung'].includes(r.trang_thai) ? r.trang_thai : 'chay') as TrangThaiViec,
    soLanLoi: Number(r.so_lan_loi) || 0,
    lastFired: String(r.last_fired || ''),
    thuLaiLuc: Number(r.thu_lai_luc) || 0,
    ketQua: String(r.ket_qua || ''),
    lyDo: String(r.ly_do || ''),
    lanChay: String(r.lan_chay || ''),
    taoLuc: String(r.tao_luc || ''),
  };
}

export const moTaLich = (v: ViecTuDong) => describeRule({ atTime: v.atTime, repeatKind: v.repeatKind, onDate: v.onDate, weekday: v.weekday, dayOfMonth: v.dayOfMonth });

export async function dsViec(memberId: string): Promise<ViecTuDong[]> {
  return (await q('SELECT * FROM viec_tu_dong WHERE member_id = $1 ORDER BY tao_luc', [memberId])).map(rowTo);
}

export async function timViec(id: string, memberId: string): Promise<ViecTuDong | null> {
  const r = await q('SELECT * FROM viec_tu_dong WHERE id = $1 AND member_id = $2', [id, memberId]);
  return r[0] ? rowTo(r[0]) : null;
}

export interface TaoViec {
  ten: string;
  yeuCau: string;
  atTime: string;
  repeatKind: RepeatKind;
  onDate?: string;
  weekday?: number;
  dayOfMonth?: number;
}

/** Kiểm đầu vào; trả câu lỗi (bắt đầu "CHƯA TẠO") hoặc null. */
export function loiTaoViec(x: TaoViec): string | null {
  if (x.ten.trim().length < 3) return 'CHƯA TẠO: thiếu tên việc.';
  if (x.yeuCau.trim().length < 10) return 'CHƯA TẠO: yêu cầu quá ngắn — cần nói rõ kéo số gì, của ai, so với gì.';
  if (!Number.isFinite(hhmmToMinutes(x.atTime))) return 'CHƯA TẠO: giờ chạy phải dạng HH:mm.';
  if (!['once', 'daily', 'weekly', 'monthly'].includes(x.repeatKind)) return 'CHƯA TẠO: kiểu lặp không hợp lệ.';
  if (x.repeatKind === 'once' && !/^\d{4}-\d{2}-\d{2}$/.test(x.onDate || '')) return 'CHƯA TẠO: chạy một lần thì cần ngày YYYY-MM-DD.';
  return null;
}

export async function taoViec(memberId: string, x: TaoViec): Promise<ViecTuDong> {
  const id = newId('VT-');
  await q(
    `INSERT INTO viec_tu_dong (id, member_id, ten, yeu_cau, at_time, repeat_kind, on_date, weekday, day_of_month, tao_luc)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
    [id, memberId, x.ten.trim().slice(0, 120), x.yeuCau.trim().slice(0, 2000), x.atTime, x.repeatKind, x.onDate || '', Number(x.weekday ?? 1), Number(x.dayOfMonth ?? 1), nowTz().toISOString()],
  );
  return (await timViec(id, memberId))!;
}

/** Anh tắt ('dung') / bật lại ('chay' — xoá đếm sai; việc tự dừng hôm nay thì chạy lại luôn nếu còn trong khung giờ). */
export async function datTrangThai(id: string, memberId: string, tt: 'chay' | 'dung'): Promise<boolean> {
  const r = await q(
    `UPDATE viec_tu_dong SET trang_thai = $3, so_lan_loi = CASE WHEN $3 = 'chay' THEN 0 ELSE so_lan_loi END,
       last_fired = CASE WHEN $3 = 'chay' AND trang_thai = 'tu_dung' THEN '' ELSE last_fired END, thu_lai_luc = 0
     WHERE id = $1 AND member_id = $2 RETURNING id`,
    [id, memberId, tt],
  );
  return r.length > 0;
}

export async function xoaViec(id: string, memberId: string): Promise<void> {
  await q('DELETE FROM viec_tu_dong WHERE id = $1 AND member_id = $2', [id, memberId]);
}

const SCHEMA_KIEM = {
  type: 'OBJECT',
  properties: { dat: { type: 'BOOLEAN' }, lyDo: { type: 'STRING' } },
  required: ['dat', 'lyDo'],
};

/** Bước kiểm lại: lỗi thấy ngay → trượt; còn lại AI (model kho) xét. AI kiểm hỏng thì cho qua (không phạt oan). */
async function kiemLai(yeuCau: string, ketQua: string): Promise<{ dat: boolean; lyDo: string }> {
  const ro = loiRoRang(ketQua);
  if (ro) return { dat: false, lyDo: ro };
  try {
    const { aiKhoJson } = await import('../ai/brainAi.js');
    const r = (await aiKhoJson(
      [
        'Bạn là người KIỂM LẠI kết quả một việc tự động của trợ lý AI trong phần mềm quản lý agency.',
        'Đạt khi: trả lời ĐÚNG yêu cầu, có số liệu / thông tin cụ thể lấy từ dữ liệu (không chung chung), không tự nhận là',
        'thiếu quyền / thiếu kết nối / không tra được. Trượt khi: lạc đề, chỉ hỏi lại, báo không lấy được dữ liệu, hoặc bịa.',
        'lyDo: một câu ngắn tiếng Việt.',
        '',
        `YÊU CẦU:\n${yeuCau.slice(0, 2000)}`,
        '',
        `KẾT QUẢ:\n${ketQua.slice(0, 6000)}`,
      ].join('\n'),
      SCHEMA_KIEM,
    )) as { dat?: boolean; lyDo?: string };
    return { dat: r?.dat !== false, lyDo: String(r?.lyDo || '').slice(0, 300) };
  } catch (e) {
    console.warn('[viec-tu-dong] AI kiểm lại lỗi — cho qua:', (e as Error).message.slice(0, 160));
    return { dat: true, lyDo: 'không kiểm được (AI kiểm lỗi)' };
  }
}

/**
 * Chạy MỘT việc (cron tới giờ, hoặc anh bấm "Chạy thử"). Chạy thử không đếm sai, không đổi lịch.
 * Trả kết quả + kết luận kiểm lại.
 */
export async function chayMot(v: ViecTuDong, o: { thu?: boolean } = {}): Promise<{ ketQua: string; dat: boolean; lyDo: string }> {
  const { answerDataQuestion } = await import('./assistant.service.js');
  const cau =
    `[VIỆC TỰ ĐỘNG «${v.ten}» — chạy ${o.thu ? 'thử' : `định kỳ (${moTaLich(v)})`}, không có ai đang chat. CHỈ ĐỌC số liệu ` +
    'bằng các hàm tra cứu, KHÔNG hỏi lại, KHÔNG hứa làm thêm. Trả lời thành một báo cáo ngắn, có số cụ thể, gửi anh.]\n\n' +
    v.yeuCau;
  let ketQua = '';
  try {
    ketQua = await answerDataQuestion(v.memberId, cau, [], undefined, { chiDoc: true });
  } catch (e) {
    ketQua = `Lỗi: ${(e as Error).message}`;
  }
  const kiem = await kiemLai(v.yeuCau, ketQua);
  const luc = nowTz().toISOString();
  if (o.thu) {
    await q('UPDATE viec_tu_dong SET ket_qua = $2, ly_do = $3, lan_chay = $4 WHERE id = $1', [v.id, ketQua.slice(0, 8000), kiem.dat ? '' : kiem.lyDo, luc]);
    return { ketQua, ...kiem };
  }
  const sau = sauLuot(v.soLanLoi, kiem.dat);
  await q(
    `UPDATE viec_tu_dong SET ket_qua = $2, ly_do = $3, lan_chay = $4, so_lan_loi = $5, trang_thai = $6,
       last_fired = CASE WHEN $7 THEN last_fired ELSE '' END, thu_lai_luc = $8
     WHERE id = $1`,
    [v.id, ketQua.slice(0, 8000), kiem.dat ? '' : kiem.lyDo, luc, sau.soLanLoi, sau.trangThai, kiem.dat || sau.trangThai === 'tu_dung', kiem.dat ? 0 : Date.now() + THU_LAI_SAU_MS],
  );
  if (kiem.dat) {
    // Kết quả nằm luôn trong khung chat của anh — hỏi tiếp được ("so với tháng trước thì sao?").
    const { addChatMessages } = await import('./chat.repo.js');
    await addChatMessages([{ id: newId('M-'), memberId: v.memberId, role: 'model', text: `🔁 **${v.ten}** (việc tự động)\n\n${ketQua}`, action: '', createdAt: luc }]).catch(() => undefined);
    await notify(v.memberId, { type: 'viec_tu_dong', title: `🔁 ${v.ten}`, body: ketQua.replace(/[*_#`]/g, '').slice(0, 300), url: '/chat', refId: v.id });
  } else if (sau.trangThai === 'tu_dung') {
    await notify(v.memberId, {
      type: 'viec_tu_dong_dung',
      title: `⛔ Việc tự động «${v.ten}» đã tự dừng`,
      body: `Sai ${SAI_TOI_DA} lần liền — lần cuối: ${kiem.lyDo}. Anh xem ở Quản trị → Việc tự động rồi bật lại.`,
      url: '/admin',
      refId: v.id,
      mucDo: 'khan',
    });
  }
  return { ketQua, ...kiem };
}

/** Chuỗi cron mỗi phút: chạy TỐI ĐA một việc tới hạn (giành lượt trong SQL — hai tiến trình không chạy trùng). */
export async function chayViecTuDong(): Promise<number> {
  const today = todayIso();
  const now = new Date(nowTz().format('YYYY-MM-DDTHH:mm:ss'));
  const ds = (await q(`SELECT * FROM viec_tu_dong WHERE trang_thai = 'chay'`)).map(rowTo);
  for (const v of ds) {
    if (v.thuLaiLuc > Date.now()) continue;
    if (!isDue({ atTime: v.atTime, repeatKind: v.repeatKind, onDate: v.onDate, weekday: v.weekday, dayOfMonth: v.dayOfMonth, lastFired: v.lastFired }, now, today)) continue;
    const gianh = await q(
      `UPDATE viec_tu_dong SET last_fired = $2 WHERE id = $1 AND last_fired <> $2 AND trang_thai = 'chay' RETURNING id`,
      [v.id, today],
    );
    if (!gianh.length) continue;
    await chayMot(v);
    // Chạy một lần xong thì tắt.
    if (v.repeatKind === 'once') await q(`UPDATE viec_tu_dong SET trang_thai = 'dung' WHERE id = $1 AND trang_thai = 'chay' AND last_fired <> ''`, [v.id]);
    return 1;
  }
  return 0;
}

// ── Công cụ cho trợ lý của giám đốc ──

const LICH = {
  atTime: { type: 'STRING', description: 'Giờ chạy HH:mm (24h).' },
  repeatKind: { type: 'STRING', enum: ['once', 'daily', 'weekly', 'monthly'], description: 'once / daily / weekly / monthly.' },
  onDate: { type: 'STRING', description: 'Chỉ khi once: YYYY-MM-DD.' },
  weekday: { type: 'NUMBER', description: 'Chỉ khi weekly: 0=CN, 1=T2 … 6=T7.' },
  dayOfMonth: { type: 'NUMBER', description: 'Chỉ khi monthly: 1-31.' },
};

const timTheoTen = (ds: ViecTuDong[], ten: string) => {
  const t = ten.trim().toLowerCase();
  return ds.filter((v) => v.id === ten.trim() || v.ten.toLowerCase().includes(t));
};

export function viecTuDongTools(memberId: string): ToolDef[] {
  const doi = (tt: 'chay' | 'dung') => async (a: Record<string, unknown>) => {
    const khop = timTheoTen(await dsViec(memberId), String(a.ten || ''));
    if (khop.length !== 1) return `CHƯA ĐỔI: ${khop.length ? `có ${khop.length} việc khớp (${khop.map((v) => v.ten).join('; ')}) — nói rõ hơn` : 'không thấy việc tự động nào tên như vậy'}.`;
    await datTrangThai(khop[0]!.id, memberId, tt);
    return `${tt === 'chay' ? 'ĐÃ BẬT LẠI' : 'ĐÃ TẮT'} việc tự động «${khop[0]!.ten}».`;
  };
  return [
    {
      declaration: {
        name: 'create_viec_tu_dong',
        description:
          'Tạo VIỆC TỰ ĐỘNG lặp theo lịch: tới giờ trợ lý tự tra số liệu (chỉ đọc) và gửi báo cáo cho anh, vd "mỗi sáng 8h ' +
          'báo chi tiêu Google Ads 7 ngày của khách X so với tuần trước", "thứ 2 hằng tuần tổng hợp top từ khoá Search ' +
          'Console". Khác create_reminder (chỉ nhắc một câu). Kết quả được kiểm lại; sai 3 lần liền thì tự dừng.',
        parameters: {
          type: 'OBJECT',
          properties: {
            ten: { type: 'STRING', description: 'Tên ngắn, vd "Báo Ads khách X mỗi sáng".' },
            yeuCau: { type: 'STRING', description: 'Yêu cầu đầy đủ như anh sẽ hỏi trợ lý: số gì, của khách / tài khoản nào, so với gì.' },
            ...LICH,
          },
          required: ['ten', 'yeuCau', 'atTime', 'repeatKind'],
        },
      },
      run: async (a) => {
        const x: TaoViec = {
          ten: String(a.ten || ''),
          yeuCau: String(a.yeuCau || ''),
          atTime: String(a.atTime || ''),
          repeatKind: String(a.repeatKind || 'daily') as RepeatKind,
          onDate: String(a.onDate || ''),
          weekday: a.weekday === undefined ? 1 : Number(a.weekday),
          dayOfMonth: a.dayOfMonth === undefined ? 1 : Number(a.dayOfMonth),
        };
        const loi = loiTaoViec(x);
        if (loi) return loi;
        const v = await taoViec(memberId, x);
        return `ĐÃ TẠO việc tự động «${v.ten}» — chạy ${moTaLich(v)}. Kết quả gửi vào chat + thông báo. Anh xem / chạy thử / tắt ở Quản trị → Việc tự động.`;
      },
    },
    {
      declaration: { name: 'list_viec_tu_dong', description: 'Danh sách việc tự động của anh: lịch, trạng thái, lần chạy gần nhất.' },
      run: async () => {
        const ds = await dsViec(memberId);
        if (!ds.length) return 'Chưa có việc tự động nào.';
        const tt = { chay: 'đang chạy', dung: 'đã tắt', tu_dung: `TỰ DỪNG (sai ${SAI_TOI_DA} lần)` };
        return ds
          .map((v) => `- «${v.ten}» · ${moTaLich(v)} · ${tt[v.trangThai]}${v.lanChay ? ` · lần chạy ${v.lanChay.slice(0, 16).replace('T', ' ')}` : ''}${v.lyDo ? ` · trượt: ${v.lyDo}` : ''}\n  Yêu cầu: ${v.yeuCau.slice(0, 200)}`)
          .join('\n');
      },
    },
    {
      declaration: {
        name: 'cancel_viec_tu_dong',
        description: 'TẮT một việc tự động (không xoá).',
        parameters: { type: 'OBJECT', properties: { ten: { type: 'STRING', description: 'Tên (hoặc một phần tên) việc.' } }, required: ['ten'] },
      },
      run: doi('dung'),
    },
    {
      declaration: {
        name: 'restore_viec_tu_dong',
        description: 'BẬT LẠI một việc tự động đã tắt / tự dừng (xoá đếm lần sai).',
        parameters: { type: 'OBJECT', properties: { ten: { type: 'STRING', description: 'Tên (hoặc một phần tên) việc.' } }, required: ['ten'] },
      },
      run: doi('chay'),
    },
  ];
}
