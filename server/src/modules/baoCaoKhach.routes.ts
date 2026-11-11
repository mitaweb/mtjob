// /api/bao-cao-khach — báo cáo quảng cáo gửi khách (anh Tâm 11/11/2026). Ai quản lý tài khoản quảng cáo (theo phòng) thì
// cấu hình / duyệt / gửi được; giám đốc mọi khách. Kiểm quyền trong service.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { findById } from './members.repo.js';
import type { Nguoi } from './adsDieuChinh.service.js';

export const baoCaoKhachRouter = Router();
baoCaoKhachRouter.use(requireAuth);

async function nguoiCua(req: Request): Promise<Nguoi> {
  const me = await findById(req.user!.sub);
  return { sub: req.user!.sub, role: req.user!.role, teamId: String(me?.teamId || ''), ten: me?.fullName || 'Nhân sự' };
}
const sv = () => import('./baoCaoKhach.service.js');

baoCaoKhachRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const n = await nguoiCua(req);
    const s = await sv();
    try {
      // Khách lấy từ tài khoản đang chạy — mở trang là thấy đủ (tối đa 10 phút quét lại một lần).
      await s.capNhatKhachDangChay().catch(() => 0);
      const [cauHinh, baoCao] = await Promise.all([s.dsCauHinh(n), s.dsBaoCao(n)]);
      res.json({ cauHinh, baoCao, canCapNhatDb: false });
    } catch {
      res.json({ cauHinh: [], baoCao: [], canCapNhatDb: true });
    }
  }),
);

const cauHinhSchema = z.object({
  id: z.string().max(40).optional(),
  ten: z.string().trim().min(1).max(120),
  logo: z.string().max(400_000).default(''),
  mau: z.string().regex(/^(#[0-9a-fA-F]{6})?$/).default(''),
  taiKhoan: z.array(z.object({ id: z.string().min(3).max(80), thue: z.number().min(0).max(100), ten: z.string().max(80).optional() })).min(1).max(20),
  ngayChuKy: z.number().int().min(0).max(28).default(0),
  tuan: z.boolean().default(true),
  thang: z.boolean().default(true),
  zaloThread: z.string().max(80).default(''),
  zaloNhom: z.boolean().default(false),
  zaloTen: z.string().max(200).default(''),
  bat: z.boolean().default(true),
});

baoCaoKhachRouter.post(
  '/cau-hinh',
  asyncHandler(async (req, res) => {
    const b = cauHinhSchema.parse(req.body);
    if (b.logo && !/^data:image\/(png|jpeg|webp);base64,/.test(b.logo)) throw new ApiError(400, 'Logo phải là ảnh PNG / JPEG / WEBP');
    res.json(await (await sv()).luuCauHinh(await nguoiCua(req), b));
  }),
);

/** Tạo ngay: kỳ tuần / tháng vừa rồi, hoặc khoảng tự chọn — lấy số + AI nhận xét (có thể mất 20–60 giây). */
baoCaoKhachRouter.post(
  '/cau-hinh/:id/tao',
  asyncHandler(async (req, res) => {
    const b = z.object({ ky: z.enum(['tuan', 'thang', 'tuy_chon']), tu: z.string().max(10).optional(), den: z.string().max(10).optional() }).parse(req.body);
    res.json({ ids: await (await sv()).taoNgay(await nguoiCua(req), String(req.params.id), b.ky, b.tu, b.den) });
  }),
);

baoCaoKhachRouter.post(
  '/:id/nhan-xet',
  asyncHandler(async (req, res) => {
    const b = z.object({ danhGia: z.array(z.string().max(300)).max(6), deXuat: z.array(z.string().max(300)).max(6) }).parse(req.body);
    await (await sv()).suaNhanXet(await nguoiCua(req), String(req.params.id), b.danhGia, b.deXuat);
    res.json({ ok: true });
  }),
);

baoCaoKhachRouter.post(
  '/:id/trang-thai',
  asyncHandler(async (req, res) => {
    const b = z.object({ trangThai: z.enum(['bo', 'da_gui', 'cho']) }).parse(req.body);
    await (await sv()).doiTrangThai(await nguoiCua(req), String(req.params.id), b.trangThai);
    res.json({ ok: true });
  }),
);

/** Gửi ảnh báo cáo (trình duyệt dựng) vào Zalo của khách. */
baoCaoKhachRouter.post(
  '/:id/gui',
  asyncHandler(async (req, res) => {
    const b = z.object({ anh: z.string().max(5_500_000), rong: z.number().int().max(5000), cao: z.number().int().max(8000), loiNhan: z.string().max(1000).default('') }).parse(req.body);
    await (await sv()).guiZalo(await nguoiCua(req), String(req.params.id), { data: b.anh, rong: b.rong, cao: b.cao }, b.loiNhan);
    res.json({ ok: true });
  }),
);

baoCaoKhachRouter.get(
  '/zalo',
  asyncHandler(async (req, res) => {
    res.json({ ds: await (await sv()).timZalo(String(req.query.q || '')) });
  }),
);

baoCaoKhachRouter.get(
  '/tai-khoan',
  asyncHandler(async (req, res) => {
    res.json({ ds: await (await sv()).dsTaiKhoanQc(await nguoiCua(req)) });
  }),
);
