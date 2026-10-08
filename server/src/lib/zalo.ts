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

/**
 * Lịch chạy Zalo: CHỈ BAN ĐÊM (anh Tâm 8/10/2026: "không cần tin nhắn phải liên tục ... chạy vào
 * ban đêm là được"). Từ 22h tới trước 5h sáng giờ VN, cron ~5 phút gọi một lần:
 *   - đêm nay chưa đồng bộ (lần cuối cách đây > 12 giờ) → 'dong_bo' (lấy tin một lượt);
 *   - đã đồng bộ rồi → 'rut' (AI rút tri thức, mỗi lượt vài cuộc, tới khi hết);
 *   - ngoài giờ đêm → 'nghi'.
 */
export function viecBanDem(o: { gioVN: number; lastSync: string; now: number }): 'dong_bo' | 'rut' | 'nghi' {
  const dem = o.gioVN >= 22 || o.gioVN < 5;
  if (!dem) return 'nghi';
  const last = Date.parse(o.lastSync);
  if (!Number.isFinite(last) || o.now - last > 12 * 3600_000) return 'dong_bo';
  return 'rut';
}
