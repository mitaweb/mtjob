// Lấy hoá đơn từ cổng hoá đơn điện tử Tổng cục Thuế (anh Tâm 18/10/2026: "các hóa đơn đầu vào sẽ tìm cách lấy từ cổng
// thuế"). Cổng không có API công khai — đây là các lời gọi mà chính trang hoadondientu.gdt.gov.vn dùng (đối chiếu mã
// nguồn công cụ cộng đồng TaiHoaDonDienTu). Đăng nhập cần captcha: ANH TỰ GÕ (app không tự giải captcha). Mật khẩu chỉ
// chuyển tiếp một lần lúc đăng nhập, KHÔNG lưu; mã phiên (token) chỉ giữ ở trình duyệt của anh.
import { ApiError } from '../util/errors.js';
import { quyCuaNgay, type HoaDon } from '../lib/keToan.js';

const GOC = 'https://hoadondientu.gdt.gov.vn/api';
const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36';

function dauGoi(token?: string): Record<string, string> {
  return {
    'user-agent': UA,
    accept: 'application/json, text/plain, */*',
    'accept-language': 'vi',
    'request-id': crypto.randomUUID(),
    ...(token ? { authorization: `Bearer ${token}` } : {}),
  };
}

/** Đọc JSON trả về; trang HTML (tường lửa / bảo trì) hoặc lỗi → thông báo dễ hiểu. */
async function docJson(r: Response, viec: string): Promise<Record<string, unknown>> {
  const chu = await r.text();
  if (r.status === 401 || r.status === 403) {
    if (/hành vi không hợp lệ|invalid behavior/i.test(chu)) throw new ApiError(502, `Cổng thuế chặn lượt ${viec} ("hành vi không hợp lệ") — thử lại sau ít phút`);
    // 409 chứ KHÔNG 401: trang MTJOB coi 401 là phiên MTJOB hết hạn và đăng xuất anh.
    throw new ApiError(409, 'Phiên cổng thuế đã hết hạn — đăng nhập cổng thuế lại');
  }
  if (r.status === 429) throw new ApiError(429, 'Cổng thuế báo gọi quá nhanh — đợi một chút rồi lấy tiếp');
  let j: Record<string, unknown>;
  try {
    j = JSON.parse(chu);
  } catch {
    throw new ApiError(502, `Cổng thuế không trả dữ liệu khi ${viec} (HTTP ${r.status}) — có thể đang bảo trì hoặc chặn truy cập từ máy chủ`);
  }
  if (!r.ok) throw new ApiError(r.status >= 500 ? 502 : 400, `Cổng thuế: ${String(j.message || j.error || `HTTP ${r.status}`)}`);
  return j;
}

export async function layCaptcha(): Promise<{ key: string; svg: string }> {
  const r = await fetch(`${GOC}/captcha`, { headers: dauGoi(), signal: AbortSignal.timeout(10_000) });
  const j = await docJson(r, 'lấy captcha');
  if (!j.key || !j.content) throw new ApiError(502, 'Cổng thuế không trả captcha');
  return { key: String(j.key), svg: String(j.content) };
}

export async function dangNhap(o: { username: string; password: string; cvalue: string; ckey: string }): Promise<{ token: string }> {
  const r = await fetch(`${GOC}/security-taxpayer/authenticate`, {
    method: 'POST',
    headers: { ...dauGoi(), 'content-type': 'application/json' },
    body: JSON.stringify({ username: o.username, password: o.password, cvalue: o.cvalue, ckey: o.ckey }),
    signal: AbortSignal.timeout(15_000),
  });
  const chu = await r.text();
  let j: Record<string, unknown> = {};
  try {
    j = JSON.parse(chu);
  } catch {
    /* không phải JSON */
  }
  if (!r.ok || !j.token) {
    // Nguyên văn câu cổng thuế báo (anh Tâm 18/10/2026: "bấm đăng nhập cổng thuế không được" — trước đây app tự
    // dịch thành câu chung nên không biết sai ở đâu). Ghi log mã + câu báo để xem trên Vercel — KHÔNG ghi mật khẩu.
    const m = String(j.message || j.error || j.detail || '').replace(/\s+/g, ' ').trim().slice(0, 200);
    console.warn('[cong-thue] dang nhap bi tu choi', r.status, m || chu.replace(/\s+/g, ' ').slice(0, 200));
    const goiY = /captcha|xác thực|ma xac thuc/i.test(`${m} ${chu}`)
      ? ' — lấy mã captcha mới, gõ đúng chữ hoa / chữ thường như trong ảnh'
      : /mật khẩu|password|tài khoản|đăng nhập/i.test(m)
        ? ' — kiểm tra MST / mật khẩu (đúng tài khoản đăng nhập hoadondientu.gdt.gov.vn)'
        : '';
    throw new ApiError(r.status >= 500 ? 502 : 400, `Cổng thuế báo: "${m || `HTTP ${r.status}`}"${goiY}`);
  }
  return { token: String(j.token) };
}

const TRANG_THAI: Record<string, string> = {
  '1': 'Hóa đơn mới',
  '2': 'Hóa đơn thay thế',
  '3': 'Hóa đơn điều chỉnh',
  '4': 'Hóa đơn đã bị thay thế',
  '5': 'Hóa đơn đã bị điều chỉnh',
  '6': 'Hóa đơn đã bị hủy',
};

const so = (v: unknown) => (typeof v === 'number' ? Math.round(v) : Math.round(Number(String(v ?? '').replace(/,/g, '')) || 0));

/** Một dòng trong danh sách hoá đơn của cổng → HoaDon. */
export function tuDongCongThue(d: Record<string, unknown>, huong: 'ra' | 'vao'): HoaDon | null {
  const tdlap = String(d.tdlap || '');
  // tdlap là giờ UTC (vd "2026-04-01T17:00:00Z" = 00:00 ngày 02/04 giờ VN) → đổi sang ngày VN.
  const t = Date.parse(tdlap);
  const ngay = Number.isFinite(t) ? new Date(t + 7 * 3600_000).toISOString().slice(0, 10) : tdlap.slice(0, 10);
  const kyHieu = String(d.khhdon || '').trim();
  const soHd = String(d.shdon ?? '').trim();
  if (!kyHieu || !soHd || !/^\d{4}-\d{2}-\d{2}$/.test(ngay)) return null;
  const tienThue = so(d.tgtthue);
  const tongTien = so(d.tgtttbso);
  const tienHang = d.tgtcthue !== undefined && d.tgtcthue !== null ? so(d.tgtcthue) : tongTien - tienThue;
  return {
    huong,
    mauSo: String(d.khmshdon ?? '1'),
    kyHieu,
    soHd: String(Number(soHd) || soHd),
    ngay,
    mstDoiTac: String((huong === 'vao' ? d.nbmst : d.nmmst) || '').trim(),
    tenDoiTac: String((huong === 'vao' ? d.nbten : d.nmten || d.nmtnmua) || '').trim(),
    dienGiai: '',
    tienHang,
    tienThue,
    tongTien: tongTien || tienHang + tienThue,
    thueSuat: '',
    trangThai: TRANG_THAI[String(d.tthai)] || 'Hóa đơn mới',
    kyKeKhai: quyCuaNgay(ngay),
  };
}

/**
 * Hoá đơn của MỘT tháng (`thang` "YYYY-MM"), một hướng: hoá đơn thường (query) + hoá đơn máy tính tiền (sco-query),
 * phân trang theo `state` (50 hoá đơn / trang). Dừng sớm khi gần hết giờ (`han`, ms).
 */
export async function layHoaDonThang(token: string, thang: string, huong: 'ra' | 'vao', han: number): Promise<{ hoaDon: HoaDon[]; xong: boolean }> {
  const m = /^(\d{4})-(\d{2})$/.exec(thang);
  if (!m) throw new ApiError(400, 'Tháng không hợp lệ');
  const cuoi = new Date(Date.UTC(Number(m[1]), Number(m[2]), 0)).getUTCDate();
  const tu = `01/${m[2]}/${m[1]}T00:00:00`;
  const den = `${String(cuoi).padStart(2, '0')}/${m[2]}/${m[1]}T23:59:59`;
  const loai = huong === 'vao' ? 'purchase' : 'sold';
  const ra: HoaDon[] = [];
  for (const nguon of ['query', 'sco-query']) {
    let state = '';
    for (let trang = 0; trang < 60; trang++) {
      if (Date.now() > han) return { hoaDon: ra, xong: false };
      const qs = `sort=tdlap:desc,khmshdon:asc,shdon:desc&size=50${state ? `&state=${encodeURIComponent(state)}` : ''}&search=tdlap=ge=${tu};tdlap=le=${den}`;
      let r: Response | null = null;
      for (let lan = 0; lan < 3; lan++) {
        r = await fetch(`${GOC}/${nguon}/invoices/${loai}?${qs}`, { headers: dauGoi(token), signal: AbortSignal.timeout(15_000) });
        if (r.status !== 429 && r.status < 500) break;
        await new Promise((x) => setTimeout(x, 1200 * (lan + 1)));
      }
      const j = await docJson(r!, 'lấy hoá đơn');
      const datas = Array.isArray(j.datas) ? (j.datas as Array<Record<string, unknown>>) : [];
      for (const d of datas) {
        const h = tuDongCongThue(d, huong);
        if (h) ra.push(h);
      }
      const tiep = j.state === null || j.state === undefined ? '' : String(j.state);
      if (!datas.length || !tiep || tiep === state) break;
      state = tiep;
    }
  }
  return { hoaDon: ra, xong: true };
}
