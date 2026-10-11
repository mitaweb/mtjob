// Tin nhắn Zalo → đoạn chat đọc được cho AI. Hàm thuần, có test.

export interface TinZalo {
  msgId: string;
  threadId: string;
  fromSelf: boolean;
  sender: string;
  content: string;
  /** ms epoch dạng chuỗi (Zalo trả ts là chuỗi số). */
  ts: string;
}

/**
 * Nội dung một tin từ dữ liệu worker gửi lên: chữ thì giữ; link/tệp thì ghi gọn tiêu đề;
 * sticker, cuộc gọi, thu hồi… thì bỏ ('' = không lưu).
 */
export function noiDungTin(content: unknown): string {
  if (typeof content === 'string') return content.trim().slice(0, 4000);
  if (!content || typeof content !== 'object') return '';
  const c = content as Record<string, unknown>;
  const title = typeof c.title === 'string' ? c.title.trim() : '';
  const href = typeof c.href === 'string' ? c.href.trim() : '';
  const desc = typeof c.description === 'string' ? c.description.trim() : '';
  if (!title && !href && !desc) return '';
  return `[Tệp/link: ${[title, desc, href].filter(Boolean).join(' — ')}]`.slice(0, 1000);
}

/** Giờ VN "dd/mm HH:MM" từ ts ms. */
export function gioTin(ts: string): string {
  const n = Number(ts);
  if (!Number.isFinite(n) || n <= 0) return '';
  const d = new Date(n + 7 * 3600 * 1000);
  const p = (x: number) => String(x).padStart(2, '0');
  return `${p(d.getUTCDate())}/${p(d.getUTCMonth() + 1)} ${p(d.getUTCHours())}:${p(d.getUTCMinutes())}`;
}

/**
 * Dựng đoạn chat cho AI đọc: cũ → mới, mỗi dòng "[giờ] Tên: nội dung". Tin của chủ tài khoản
 * ghi là `tenChu`. Quá dài thì GIỮ PHẦN MỚI NHẤT (cái đang bàn mới quan trọng).
 */
export function dungDoanChat(tin: TinZalo[], tenChu: string, tenKhach: string, maxChars = 15000): string {
  const dong = [...tin]
    .sort((a, b) => Number(a.ts) - Number(b.ts))
    .filter((t) => t.content.trim())
    .map((t) => `[${gioTin(t.ts)}] ${t.fromSelf ? tenChu : t.sender || tenKhach}: ${t.content.replace(/\s+/g, ' ').trim()}`);
  const ra: string[] = [];
  let tong = 0;
  for (let i = dong.length - 1; i >= 0; i--) {
    const d = dong[i]!;
    if (tong + d.length + 1 > maxChars) break;
    ra.unshift(d);
    tong += d.length + 1;
  }
  return ra.join('\n');
}

/**
 * Đã tới lúc rút tri thức cho một cuộc chưa: có tin chưa xử lý, và cuộc đã LẮNG (tin cuối cách
 * đây ≥ `lang` phút) — đang nói dở mà rút thì được nửa câu chuyện. `epNgay` = anh bấm tay.
 */
export function denLucRut(o: { chuaRut: number; lastMsgAt: string; now: number; langPhut?: number; epNgay?: boolean }): boolean {
  if (o.chuaRut <= 0) return false;
  if (o.epNgay) return true;
  const last = Date.parse(o.lastMsgAt);
  if (!Number.isFinite(last)) return true;
  return o.now - last >= (o.langPhut ?? 30) * 60_000;
}

/** Mã tin lớn nhất (mã Zalo là số rất dài, so bằng BigInt — so chuỗi thì "9" > "10"). '' nếu không có. */
export function maTinLonNhat(ids: string[], hienTai = ''): string {
  let max = /^\d+$/.test(hienTai) ? BigInt(hienTai) : -1n;
  for (const id of ids) {
    if (!/^\d+$/.test(id)) continue;
    const n = BigInt(id);
    if (n > max) max = n;
  }
  return max < 0n ? '' : max.toString();
}

/** Tự đồng bộ cách nhau bao lâu (cả ngày lẫn đêm). */
export const KHOANG_DONG_BO_MS = 3 * 3600_000;

/**
 * Lịch chạy Zalo, cron ~5 phút gọi một lần:
 *   - lần đồng bộ trước đã quá 3 tiếng → 'dong_bo' (lấy tin một lượt) — GIỜ NÀO CŨNG VẬY. Trước đây
 *     chỉ đồng bộ ban đêm khi lần trước cách > 12 tiếng, nên anh bấm tay buổi chiều là cả đêm đó
 *     không tự đồng bộ (anh Tâm 8/10/2026: "không thấy tự động đồng bộ"). Zalo mỗi lượt chỉ trả
 *     một lô tin gần đây, đồng bộ dày hơn thì ít sót tin hơn;
 *   - ban đêm (22h–5h) còn nhóm chưa xét / nhóm khách chưa kéo lịch sử → 'nhom';
 *   - ban đêm, xong hết → 'rut' (AI rút tri thức, mỗi lượt vài cuộc, tới khi hết);
 *   - còn lại → 'nghi'. Việc tốn AI (xét nhóm, rút tri thức) vẫn CHỈ ban đêm.
 */
export function viecBanDem(o: { gioVN: number; lastSync: string; now: number; viecNhom?: number }): 'dong_bo' | 'nhom' | 'rut' | 'nghi' {
  const last = Date.parse(o.lastSync);
  if (!Number.isFinite(last) || o.now - last > KHOANG_DONG_BO_MS) return 'dong_bo';
  const dem = o.gioVN >= 22 || o.gioVN < 5;
  if (!dem) return 'nghi';
  if ((o.viecNhom ?? 0) > 0) return 'nhom';
  return 'rut';
}

/**
 * Gợi ý tên khách từ tên nhóm theo quy ước "TÊN KH - MT DIGITAL" (anh Tâm 8/10/2026). Chỉ là GỢI Ý
 * cho AI — "một số sẽ khác", AI vẫn tự quyết. Không theo quy ước thì `theoMau = false`.
 */
export function goiYTenKhachTuNhom(tenNhom: string): { theoMau: boolean; ten: string } {
  const s = String(tenNhom || '').trim();
  // Dấu nối: "-", "–", "|", ":", "&", "+" hoặc chữ "x" đứng riêng ("Kingpen x MTDigital").
  const noi = String.raw`(?:\s*[-–—|:&+]+\s*|\s+[x×]\s+)`;
  const mt = String.raw`m\.?\s*t\.?\s*digital`;
  const mau = new RegExp(`^(.*?)${noi}${mt}\\s*$`, 'i').exec(s) || new RegExp(`^${mt}${noi}(.*)$`, 'i').exec(s);
  if (mau && mau[1]!.trim()) return { theoMau: true, ten: mau[1]!.trim() };
  return { theoMau: false, ten: s };
}

/** Cộng `n` ngày vào ngày dạng YYYY-MM-DD. */
function congNgayIso(d: string, n: number): string {
  const t = new Date(`${d}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

/**
 * Giờ đặt nhắc việc AI đề xuất từ tin Zalo (anh Tâm 10/10/2026: "lên lịch nhắc cho anh nếu cần, ví
 * dụ khách hỏi báo giá chưa trả lời"). `han` dạng "YYYY-MM-DD HH:mm" hoặc "YYYY-MM-DD" (giờ VN).
 * Thiếu / sai / đã qua → 8h30 sáng gần nhất. Không bao giờ nhắc giữa đêm (22h–7h) → dời 8h30.
 */
export function gioNhac(han: string, bayGio: { ngay: string; gio: string }): { onDate: string; atTime: string } {
  const sang = (): { onDate: string; atTime: string } =>
    bayGio.gio < '08:30' ? { onDate: bayGio.ngay, atTime: '08:30' } : { onDate: congNgayIso(bayGio.ngay, 1), atTime: '08:30' };
  const m = /^(\d{4}-\d{2}-\d{2})(?:[ T](\d{1,2}):(\d{2}))?/.exec(String(han || '').trim());
  if (!m || Number.isNaN(Date.parse(`${m[1]}T00:00:00Z`))) return sang();
  const ngay = m[1]!;
  let gio = m[2] !== undefined ? `${m[2]!.padStart(2, '0')}:${m[3]}` : '08:30';
  if (gio >= '24:00') return sang();
  if (gio < '07:00' || gio >= '22:00') gio = '08:30';
  if (`${ngay} ${gio}` <= `${bayGio.ngay} ${bayGio.gio}`) return sang();
  return { onDate: ngay, atTime: gio };
}

/**
 * Bổ sung "Thông tin khách" trong CRM bằng điều AI mới biết từ Zalo — CHỈ THÊM dòng, không sửa
 * điều anh đã ghi. Dài quá thì thôi không thêm (đã có kho tri thức giữ chi tiết).
 */
export function noiThongTinKhach(cu: string, moi: string, ngay: string): string {
  const them = String(moi || '').replace(/\s+/g, ' ').trim();
  const goc = String(cu || '').trim();
  if (!them || goc.includes(them) || goc.length > 3000) return goc;
  const dong = `• ${ngay.slice(8, 10)}/${ngay.slice(5, 7)} (Zalo): ${them.slice(0, 400)}`;
  return goc ? `${goc}\n${dong}` : dong;
}

/**
 * MỘT nhắc gộp cho một khách (anh Tâm 11/10/2026: "1 khách hàng 1 thông báo sau khi tổng hợp thông tin,
 * gửi thông tin tổng hợp mới nhất thôi"). Giờ nhắc = sớm nhất trong các việc. Không có việc → null.
 */
export function nhacGop(
  ten: string,
  viecs: Array<{ viec: string; han: string }>,
  bayGio: { ngay: string; gio: string },
): { title: string; onDate: string; atTime: string } | null {
  const ds = viecs.map((v) => ({ ...v, viec: v.viec.replace(/\s+/g, ' ').trim() })).filter((v) => v.viec);
  if (!ds.length) return null;
  const gio = ds.map((v) => gioNhac(v.han, bayGio)).sort((a, b) => `${a.onDate} ${a.atTime}`.localeCompare(`${b.onDate} ${b.atTime}`))[0]!;
  const noi = ds.length === 1 ? ds[0]!.viec : ds.map((v, i) => `${i + 1}) ${v.viec}`).join('; ');
  return { title: `${ten}: ${noi}`.slice(0, 600), ...gio };
}

export const DONG_VIEC_AI = '📌 Việc cần theo dõi (AI';

/**
 * Dòng "việc cần theo dõi" do AI quản lý trong Ghi chú của khách: thay dòng cũ bằng dòng mới (hoặc xoá
 * khi hết việc). Mọi dòng khác anh ghi giữ nguyên.
 */
export function ghiChuViecAi(note: string, viecs: string[], ngay: string): string {
  const giu = String(note || '')
    .split('\n')
    .filter((d) => !d.startsWith(DONG_VIEC_AI));
  if (viecs.length) giu.push(`${DONG_VIEC_AI} ${ngay.slice(8, 10)}/${ngay.slice(5, 7)}): ${viecs.join('; ')}`.slice(0, 800));
  return giu.join('\n').trim();
}

/** Đọc lại danh sách việc từ tiêu đề nhắc gộp "Tên: 1) a; 2) b" (hoặc "Tên: a"). */
export function tachViec(title: string): string[] {
  const t = String(title || '');
  const i = t.indexOf(': ');
  const than = (i >= 0 ? t.slice(i + 2) : t).trim();
  if (!than) return [];
  if (!/^1\)\s/.test(than)) return [than];
  return than
    .replace(/^1\)\s*/, '')
    .split(/;\s*\d+\)\s*/)
    .map((x) => x.trim())
    .filter(Boolean);
}

/**
 * Thêm việc mới vào nhắc gộp của một khách KHÁC (vd nhân viên nhắc tới Tín Đạt trong chat nội bộ) —
 * giữ các việc đang theo dõi, bỏ trùng, tối đa 8 việc (giữ việc mới nhất).
 */
export function gopThemViec(
  titleCu: string,
  ten: string,
  moi: Array<{ viec: string; han: string }>,
  bayGio: { ngay: string; gio: string },
): { title: string; onDate: string; atTime: string } | null {
  const chuan = (s: string) => s.toLowerCase().replace(/\s+/g, ' ').trim();
  const cu = tachViec(titleCu).map((viec) => ({ viec, han: '' }));
  const da = new Set(cu.map((v) => chuan(v.viec)));
  const ds = [...cu, ...moi.filter((v) => v.viec.trim() && !da.has(chuan(v.viec)))].slice(-8);
  return nhacGop(ten, ds, bayGio);
}
