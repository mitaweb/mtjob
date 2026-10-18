// /api/ke-toan — Kế toán thuế (anh Tâm 18/10/2026). CHỈ giám đốc (chi phí / thuế / công nợ là việc của giám đốc).
import { Router } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { nhapBang, nhapXml, tongQuan, caiDat, luuCaiDat, nhanBaoCaoKeToan } from './keToan.service.js';
import { trangHoaDon, lichSuTaiLen, trangGiaoDich, dsViec, datXongViec, datThanhToanHoaDon } from './keToan.repo.js';
import { nowTz } from '../lib/datetime.js';

export const keToanRouter = Router();
keToanRouter.use(requireAuth, requireRole('director'));

const MAX_DONG = 10000;
const MAX_COT = 40;

const bangSchema = z.object({
  ten: z.string().max(300),
  sheets: z
    .array(z.object({ ten: z.string().max(100), rows: z.array(z.array(z.string().max(2000)).max(MAX_COT)).max(MAX_DONG) }))
    .min(1)
    .max(20),
});

const xmlSchema = z.object({
  files: z.array(z.object({ ten: z.string().max(300), noiDung: z.string().max(400_000) })).min(1).max(40),
});

/** Một file Excel/CSV — trình duyệt đã đọc thành các dòng chữ. */
keToanRouter.post(
  '/tai-len/bang',
  asyncHandler(async (req, res) => {
    const b = bangSchema.parse(req.body);
    res.json(await nhapBang(b.ten, b.sheets, req.user!.name));
  }),
);

/** Nhiều file XML một lượt (hoá đơn, tờ khai GTGT). */
keToanRouter.post(
  '/tai-len/xml',
  asyncHandler(async (req, res) => {
    const b = xmlSchema.parse(req.body);
    res.json({ ketQua: await nhapXml(b.files, req.user!.name) });
  }),
);

keToanRouter.get(
  '/tong-quan',
  asyncHandler(async (req, res) => {
    const nam = Number(req.query.nam) || Number(nowTz().format('YYYY'));
    res.json(await tongQuan(nam));
  }),
);

keToanRouter.get(
  '/hoa-don',
  asyncHandler(async (req, res) => {
    const huong = req.query.huong === 'ra' || req.query.huong === 'vao' ? req.query.huong : undefined;
    const ky = /^\d{4}-Q\d$/.test(String(req.query.ky || '')) ? String(req.query.ky) : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Math.max(5, Number(req.query.size) || 20));
    res.json(await trangHoaDon({ huong, ky, tim: String(req.query.q || ''), page, size }));
  }),
);

/** Anh đánh dấu hoá đơn đầu vào đã trả tiền mặt / qua ngân hàng ('' = để app tự xét). */
keToanRouter.post(
  '/hoa-don/thanh-toan',
  asyncHandler(async (req, res) => {
    const b = z.object({ khoa: z.array(z.string().min(1).max(300)).min(1).max(200), cach: z.enum(['', 'tien_mat', 'ngan_hang']) }).parse(req.body);
    let n = 0;
    for (const k of b.khoa) if (await datThanhToanHoaDon(k, b.cach)) n++;
    res.json({ ok: true, n });
  }),
);

/** Giao dịch ngân hàng (sao kê đã tải). */
keToanRouter.get(
  '/giao-dich',
  asyncHandler(async (req, res) => {
    const loai = req.query.loai === 'vao' || req.query.loai === 'ra' ? req.query.loai : undefined;
    const page = Math.max(1, Number(req.query.page) || 1);
    const size = Math.min(100, Math.max(5, Number(req.query.size) || 20));
    res.json(await trangGiaoDich({ loai, tim: String(req.query.q || ''), page, size }));
  }),
);

keToanRouter.get(
  '/tai-len',
  asyncHandler(async (_req, res) => {
    res.json({ ds: await lichSuTaiLen(30) });
  }),
);

// ── Cổng hoá đơn điện tử Tổng cục Thuế: anh tự gõ captcha; mật khẩu chuyển tiếp một lần, KHÔNG lưu, KHÔNG ghi log ──

keToanRouter.get(
  '/cong-thue/captcha',
  asyncHandler(async (_req, res) => {
    const { layCaptcha } = await import('./congThue.js');
    res.json(await layCaptcha());
  }),
);

keToanRouter.post(
  '/cong-thue/dang-nhap',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ username: z.string().min(5).max(20), password: z.string().min(1).max(100), cvalue: z.string().min(1).max(20), ckey: z.string().min(1).max(100) })
      .parse(req.body);
    const { dangNhap } = await import('./congThue.js');
    res.json(await dangNhap({ username: b.username.trim(), password: b.password, cvalue: b.cvalue.trim(), ckey: b.ckey }));
  }),
);

keToanRouter.post(
  '/cong-thue/lay',
  asyncHandler(async (req, res) => {
    const b = z
      .object({ token: z.string().min(10).max(4000), thang: z.string().regex(/^\d{4}-\d{2}$/), huong: z.enum(['ra', 'vao']) })
      .parse(req.body);
    const { layTuCongThue } = await import('./keToan.service.js');
    res.json(await layTuCongThue(b.token, b.thang, b.huong, req.user!.name));
  }),
);

keToanRouter.get(
  '/cai-dat',
  asyncHandler(async (_req, res) => {
    res.json(await caiDat());
  }),
);

keToanRouter.post(
  '/cai-dat',
  asyncHandler(async (req, res) => {
    const b = z.object({ mst: z.string().max(20).optional(), mienTndn: z.string().max(100).optional() }).parse(req.body);
    res.json(await luuCaiDat(b));
  }),
);

// ── Báo cáo kế toán gửi qua thư / ảnh: AI tách kết quả kinh doanh + việc cần xác nhận (anh Tâm 18/10/2026) ──

keToanRouter.post(
  '/bao-cao-ke-toan',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        noiDung: z.string().max(20000).optional(),
        anh: z.object({ mimeType: z.enum(['image/png', 'image/jpeg', 'image/webp']), data: z.string().max(4_500_000) }).optional(),
      })
      .refine((x) => (x.noiDung && x.noiDung.trim().length > 10) || x.anh, { message: 'Dán nội dung thư hoặc ảnh chụp' })
      .parse(req.body);
    res.json(await nhanBaoCaoKeToan(b, req.user!.name));
  }),
);

keToanRouter.get(
  '/viec',
  asyncHandler(async (_req, res) => {
    res.json({ ds: await dsViec() });
  }),
);

keToanRouter.post(
  '/viec/:id',
  asyncHandler(async (req, res) => {
    const b = z.object({ xong: z.boolean() }).parse(req.body);
    await datXongViec(String(req.params.id), b.xong);
    res.json({ ok: true });
  }),
);
