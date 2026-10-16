// Mở link trong tin Zalo cho AI xem (anh Tâm 16/10/2026: "nếu có link thì sao, anh muốn AI truy cập link xem
// nó là gì"). Link do NGƯỜI KHÁC gửi → chỉ mở trang công khai trên Internet: chặn IP nội bộ ở MỌI bước chuyển
// hướng, chỉ cổng 80/443, giới hạn thời gian và dung lượng. Không lưu gì — đọc xong chỉ giữ chữ mô tả.
import { lookup } from 'node:dns/promises';
import { isIP } from 'node:net';
import { laIpNoiBo, doiLinkGoogle, chuTuHtml } from '../lib/trangWeb.js';

const TOI_DA_TRANG = 1_500_000;
const TOI_DA_TEP = 8 * 1024 * 1024;

export type KetQuaLink =
  | { loai: 'trang'; tieuDe: string; moTa: string; noiDung: string }
  | { loai: 'tep'; mimeType: string; data: string };

/** Địa chỉ được phép mở: http(s), cổng mặc định, tên miền không trỏ vào IP nội bộ. */
export async function diaChiAnToan(url: string): Promise<boolean> {
  let u: URL;
  try {
    u = new URL(url);
  } catch {
    return false;
  }
  if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
  if (u.username || u.password) return false;
  if (u.port && u.port !== '80' && u.port !== '443') return false;
  const host = u.hostname.replace(/^\[|\]$/g, '');
  if (isIP(host)) return !laIpNoiBo(host);
  if (!host.includes('.') || /\.(local|internal|localhost)$/i.test(host)) return false;
  const ds = await lookup(host, { all: true }).catch(() => []);
  return ds.length > 0 && ds.every((d) => !laIpNoiBo(d.address));
}

/** Đọc thân trả về tới `toiDa` byte (quá thì cắt — trang HTML) hoặc null (tệp quá cỡ). */
async function docThan(r: Response, toiDa: number, catBot: boolean): Promise<Buffer | null> {
  const reader = r.body?.getReader();
  if (!reader) return Buffer.alloc(0);
  const phan: Uint8Array[] = [];
  let tong = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    tong += value.length;
    if (tong > toiDa) {
      await reader.cancel().catch(() => undefined);
      if (!catBot) return null;
      phan.push(value.subarray(0, value.length - (tong - toiDa)));
      break;
    }
    phan.push(value);
  }
  return Buffer.concat(phan);
}

/** Mở một link → chữ của trang, hoặc tệp (PDF / ảnh) để AI xem. Lỗi / bị chặn → null. */
export async function xemLink(url: string): Promise<KetQuaLink | null> {
  let u = doiLinkGoogle(url);
  for (let buoc = 0; buoc < 5; buoc++) {
    if (!(await diaChiAnToan(u))) return null;
    const host = new URL(u).hostname;
    const r = await fetch(u, {
      redirect: 'manual',
      signal: AbortSignal.timeout(8_000),
      headers: {
        // Facebook chỉ trả tiêu đề / mô tả cho trình xem trước link.
        'user-agent': /(^|\.)(facebook\.com|fb\.watch|fb\.com)$/i.test(host)
          ? 'facebookexternalhit/1.1'
          : 'Mozilla/5.0 (compatible; MTJOB-link-preview/1.0)',
        'accept-language': 'vi,en;q=0.8',
      },
    });
    if (r.status >= 300 && r.status < 400) {
      const toi = r.headers.get('location');
      if (!toi) return null;
      u = new URL(toi, u).toString();
      continue;
    }
    if (!r.ok) return null;
    const mime = (r.headers.get('content-type') || '').split(';')[0]!.trim().toLowerCase();
    if (mime === 'application/pdf' || /^image\/(jpe?g|png|webp)$/.test(mime)) {
      if (Number(r.headers.get('content-length')) > TOI_DA_TEP) return null;
      const buf = await docThan(r, TOI_DA_TEP, false);
      if (!buf?.length) return null;
      return { loai: 'tep', mimeType: mime, data: buf.toString('base64') };
    }
    if (mime === 'text/html' || mime === 'application/xhtml+xml' || mime.startsWith('text/')) {
      const buf = await docThan(r, TOI_DA_TRANG, true);
      const chu = buf ? buf.toString('utf8') : '';
      if (mime === 'text/html' || mime === 'application/xhtml+xml') {
        const trang = chuTuHtml(chu);
        // Google Maps: tên địa điểm nằm trong đường dẫn (/maps/place/<tên>/…), trang chỉ ghi "Google Maps".
        const diaDiem = /\/maps\/place\/([^/]+)/.exec(new URL(u).pathname)?.[1];
        if (diaDiem) trang.tieuDe = `Địa điểm trên Google Maps: ${decodeURIComponent(diaDiem.replace(/\+/g, ' '))}`;
        return { loai: 'trang', ...trang };
      }
      return { loai: 'trang', tieuDe: '', moTa: '', noiDung: chu.slice(0, 3000) };
    }
    return null;
  }
  return null;
}
