// Link trong tin Zalo (anh Tâm 16/10/2026: "nếu có link thì sao, anh muốn AI truy cập link xem nó là gì").
// Hàm thuần: tìm link trong tin, đổi link Google Docs/Sheets sang bản xuất chữ, rút chữ từ trang HTML,
// nhận địa chỉ IP nội bộ (để KHÔNG bao giờ mở — link do người khác gửi).

import { laHostTepZalo } from './zalo.js';

/** Dấu đã xem link — tin có dấu này thì không mở lại. */
export const DAU_DA_XEM_LINK = '[Link';

/** Các link http(s) trong một tin (bỏ link tệp Zalo — phần đó đọc theo kiểu tệp; bỏ tin đã xem link). */
export function linkTrongTin(content: string): string[] {
  const s = String(content || '');
  if (s.includes(DAU_DA_XEM_LINK)) return [];
  const ra: string[] = [];
  for (const m of s.matchAll(/https?:\/\/[^\s\]<>"'`]+/gi)) {
    const u = m[0].replace(/[),.;!?]+$/, '');
    try {
      const x = new URL(u);
      if (x.username || x.password) continue;
      if (laHostTepZalo(u)) continue;
      if (!ra.includes(u)) ra.push(u);
    } catch {
      // không phải URL hợp lệ
    }
  }
  return ra;
}

/** IP thuộc mạng nội bộ / máy chủ / dải đặc biệt — không bao giờ mở. */
export function laIpNoiBo(ip: string): boolean {
  const s = ip.trim().toLowerCase().replace(/^\[|\]$/g, '');
  const v4 = /^(\d{1,3})\.(\d{1,3})\.(\d{1,3})\.(\d{1,3})$/.exec(s.replace(/^::ffff:/, ''));
  if (v4) {
    const [a, b] = [Number(v4[1]), Number(v4[2])];
    return (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      (a === 100 && b >= 64 && b <= 127) ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 192 && b === 0) ||
      (a === 198 && (b === 18 || b === 19)) ||
      a >= 224
    );
  }
  if (s.includes(':')) {
    return s === '::' || s === '::1' || /^f[cd]/.test(s) || /^fe[89ab]/.test(s) || /^ff/.test(s) || s.startsWith('::ffff:');
  }
  return true; // không nhận ra → coi như không an toàn
}

/** Google Docs / Sheets / Slides chia sẻ công khai → link xuất bản chữ (đọc được nội dung, không phải trang đăng nhập). */
export function doiLinkGoogle(url: string): string {
  const m = /^https:\/\/docs\.google\.com\/(document|spreadsheets|presentation)\/d\/([\w-]+)/.exec(url);
  if (!m) return url;
  const [, loai, id] = m;
  if (loai === 'document') return `https://docs.google.com/document/d/${id}/export?format=txt`;
  if (loai === 'spreadsheets') return `https://docs.google.com/spreadsheets/d/${id}/export?format=csv`;
  return `https://docs.google.com/presentation/d/${id}/export/txt`;
}

const THUC_THE: Record<string, string> = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

function giaiThucThe(s: string): string {
  return s
    .replace(/&#x([0-9a-f]+);/gi, (_, h) => String.fromCodePoint(parseInt(h, 16)))
    .replace(/&#(\d+);/g, (_, d) => String.fromCodePoint(Number(d)))
    .replace(/&([a-z]+);/gi, (m, t) => THUC_THE[t.toLowerCase()] ?? m);
}

function theMeta(html: string, ten: string): string {
  const re = new RegExp(`<meta[^>]+(?:name|property)=["']${ten}["'][^>]*>`, 'i');
  const the = re.exec(html)?.[0] || '';
  return giaiThucThe(/content=["']([^"']*)["']/i.exec(the)?.[1] || '').trim();
}

/** Rút tiêu đề, mô tả và chữ chính của một trang HTML (bỏ script, style, menu…), cắt `max` ký tự. */
export function chuTuHtml(html: string, max = 3000): { tieuDe: string; moTa: string; noiDung: string } {
  const h = String(html || '');
  const tieuDe = theMeta(h, 'og:title') || giaiThucThe(/<title[^>]*>([\s\S]*?)<\/title>/i.exec(h)?.[1] || '').trim();
  const moTa = theMeta(h, 'og:description') || theMeta(h, 'description');
  const than = /<body[^>]*>([\s\S]*)<\/body>/i.exec(h)?.[1] ?? h;
  const noiDung = giaiThucThe(
    than
      .replace(/<(script|style|noscript|svg|nav|header|footer|form|iframe|template)\b[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(br|\/p|\/div|\/li|\/h\d|\/tr)[^>]*>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v\r]+/g, ' ')
    .replace(/\n\s*/g, '\n')
    .replace(/\n{2,}/g, '\n')
    .trim()
    .slice(0, max);
  return { tieuDe: tieuDe.slice(0, 300), moTa: moTa.slice(0, 500), noiDung };
}

/** Ghi mô tả link AI đã xem vào tin (thay link tệp, hoặc nối sau tin chữ) — lần sau không mở lại. */
export function ganMoTaLink(content: string, url: string, moTa: string): string {
  const sach = String(moTa || '')
    .replace(/\d{10,}/g, '[đã ẩn số]')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 500);
  const s = String(content || '');
  if (s.trim().startsWith('[Tệp/link:')) return `${DAU_DA_XEM_LINK} ${url}: ${sach}]`;
  return `${s} ${DAU_DA_XEM_LINK}: ${sach}]`;
}
