// Cache trong bộ nhớ máy chủ (anh Tâm 12/10/2026: app chậm — mỗi trang hỏi lại DB những thứ ít đổi).
//
// Hai loại, dùng đúng chỗ:
//   - nhoTam(khoá, ttl, lấy): dữ liệu ÍT ĐỔI (thành viên, danh mục việc, ngày lễ, team) — giữ vài phút, hàm GHI
//     tương ứng gọi xoaNhoTam(...) để instance này đọc bản mới ngay. Instance khác tự hết hạn sau ttl. Gộp lời gọi
//     đang chạy dở: 5 truy vấn song song cùng hỏi danh sách thành viên → chỉ 1 lượt xuống DB.
//   - nhoTrongRequest(khoá, lấy): chỉ trong MỘT request — dùng cho thứ phải luôn mới (khoá thưởng / khoá lương,
//     chỉ số KPI tháng) nhưng bị tính lặp nhiều lần trong cùng request. Không bao giờ trả số cũ của request trước.
// Giá trị trả ra là BẢN SAO — người gọi có sort/sửa cũng không làm bẩn cache.
import { soHienTai } from './doThoiGian.js';

interface Muc {
  het: number;
  giaTri?: unknown;
  dangChay?: Promise<unknown>;
}

const kho = new Map<string, Muc>();

/** Test chạy với DB giả đổi theo từng ca — mặc định TẮT cache khi chạy vitest (bật riêng trong test của cache). */
let batTrongTest = false;
export function _batCacheTrongTest(bat: boolean): void {
  batTrongTest = bat;
  kho.clear();
}
const tatCache = () => !!process.env.VITEST && !batTrongTest;

const banSao = <T>(v: T): T => (v === undefined || v === null || typeof v !== 'object' ? v : structuredClone(v));

export async function nhoTam<T>(khoa: string, ttlMs: number, lay: () => Promise<T>): Promise<T> {
  if (tatCache()) return lay();
  const m = kho.get(khoa);
  if (m && m.dangChay === undefined && m.het > Date.now()) return banSao(m.giaTri as T);
  if (m?.dangChay) return banSao((await m.dangChay) as T);
  const muc: Muc = { het: 0 };
  const p = lay().then(
    (v) => {
      // Bị xoá (có ghi) trong lúc đang lấy → không lưu bản có thể đã cũ.
      if (kho.get(khoa) === muc) {
        muc.giaTri = v;
        muc.het = Date.now() + ttlMs;
        muc.dangChay = undefined;
      }
      return v;
    },
    (e) => {
      if (kho.get(khoa) === muc) kho.delete(khoa);
      throw e;
    },
  );
  muc.dangChay = p;
  kho.set(khoa, muc);
  return banSao(await p);
}

/** Xoá mọi khoá bắt đầu bằng `tienTo` — gọi trong hàm GHI dữ liệu tương ứng. */
export function xoaNhoTam(tienTo: string): void {
  for (const k of [...kho.keys()]) if (k.startsWith(tienTo)) kho.delete(k);
}

/** Xoá bản đã nhớ trong request đang chạy (gọi ngay sau khi chính request này ghi, vd chốt / mở khoá tháng). */
export function xoaTrongRequest(tienTo: string): void {
  const nho = soHienTai()?.nho;
  if (!nho) return;
  for (const k of [...nho.keys()]) if (k.startsWith(tienTo)) nho.delete(k);
}

/** Nhớ kết quả trong request đang chạy; ngoài request thì gọi thẳng. */
export async function nhoTrongRequest<T>(khoa: string, lay: () => Promise<T>): Promise<T> {
  const so = soHienTai();
  if (!so) return lay();
  if (!so.nho) so.nho = new Map();
  let p = so.nho.get(khoa) as Promise<T> | undefined;
  if (!p) {
    p = lay();
    so.nho.set(khoa, p);
    p.catch(() => so.nho!.delete(khoa));
  }
  return banSao(await p);
}
