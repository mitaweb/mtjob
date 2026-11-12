// /api/ads — điều chỉnh quảng cáo + nghiên cứu từ khoá (anh Tâm 11/11/2026). Ai được giao tài khoản (theo phòng) thì làm được;
// giám đốc mọi tài khoản. Kiểm quyền trong service (taiSanCo).
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth } from '../auth/middleware.js';
import { findById } from './members.repo.js';
import { dsDoiTuong, thaoTac, nhatKy, duyetDeXuat, boDeXuat, tuKhoa, goiYTuKhoa, docGhiChu, luuGhiChu, docMucTieu, luuMucTieu, aiDeXuat, type Nguoi } from './adsDieuChinh.service.js';

export const adsRouter = Router();
adsRouter.use(requireAuth);

async function nguoiCua(req: Request): Promise<Nguoi> {
  const me = await findById(req.user!.sub);
  return { sub: req.user!.sub, role: req.user!.role, teamId: String(me?.teamId || ''), ten: me?.fullName || 'Nhân sự' };
}
const ts = (req: Request) => decodeURIComponent(String(req.params.ts));

adsRouter.get(
  '/nhat-ky',
  asyncHandler(async (req, res) => {
    const n = await nguoiCua(req);
    const taiSanId = String(req.query.taiSan || '') || undefined;
    try {
      const [deXuat, lichSu] = await Promise.all([nhatKy(n, { taiSanId, deXuat: true }), nhatKy(n, { taiSanId })]);
      res.json({ deXuat, lichSu, canCapNhatDb: false });
    } catch {
      res.json({ deXuat: [], lichSu: [], canCapNhatDb: true });
    }
  }),
);

adsRouter.post(
  '/thao-tac',
  asyncHandler(async (req, res) => {
    const b = z
      .object({
        taiSanId: z.string().min(3),
        cap: z.enum(['campaign', 'adgroup', 'ad', 'keyword']),
        doiTuongId: z.string().min(1).max(80),
        ten: z.string().max(300).default(''),
        hanhDong: z.enum(['bat', 'tat', 'ngan_sach', 'tu_khoa_am', 'them_tu_khoa']),
        nganSach: z.number().positive().optional(),
        giaTriCu: z.string().max(80).optional(),
        budgetResource: z.string().max(200).optional(),
        tuKhoa: z.string().max(80).optional(),
        kieuKhop: z.enum(['EXACT', 'PHRASE', 'BROAD']).optional(),
        lyDo: z.string().max(500).optional(),
      })
      .parse(req.body);
    res.json(await thaoTac(await nguoiCua(req), b));
  }),
);

adsRouter.post(
  '/de-xuat/:id/duyet',
  asyncHandler(async (req, res) => {
    res.json(await duyetDeXuat(await nguoiCua(req), String(req.params.id)));
  }),
);

adsRouter.post(
  '/de-xuat/:id/bo',
  asyncHandler(async (req, res) => {
    await boDeXuat(await nguoiCua(req), String(req.params.id));
    res.json({ ok: true });
  }),
);

adsRouter.get(
  '/:ts/doi-tuong',
  asyncHandler(async (req, res) => {
    res.json(await dsDoiTuong(await nguoiCua(req), ts(req)));
  }),
);

adsRouter.get(
  '/:ts/tu-khoa',
  asyncHandler(async (req, res) => {
    res.json(await tuKhoa(await nguoiCua(req), ts(req)));
  }),
);

adsRouter.post(
  '/:ts/goi-y',
  asyncHandler(async (req, res) => {
    const b = z.object({ tuKhoa: z.array(z.string().max(80)).max(10).default([]), url: z.string().max(300).optional() }).parse(req.body);
    res.json(await goiYTuKhoa(await nguoiCua(req), ts(req), b));
  }),
);

adsRouter.get(
  '/:ts/ghi-chu',
  asyncHandler(async (req, res) => {
    res.json({ noiDung: await docGhiChu(await nguoiCua(req), ts(req)) });
  }),
);

adsRouter.post(
  '/:ts/ghi-chu',
  asyncHandler(async (req, res) => {
    const b = z.object({ noiDung: z.string().max(6000) }).parse(req.body);
    res.json({ noiDung: await luuGhiChu(await nguoiCua(req), ts(req), b.noiDung) });
  }),
);

/** CPA mục tiêu của tài khoản (luật thắng / thua cho AI đề xuất). 0 = tự lấy CPA trung bình 30 ngày. */
adsRouter.get(
  '/:ts/muc-tieu',
  asyncHandler(async (req, res) => {
    res.json(await docMucTieu(await nguoiCua(req), ts(req)));
  }),
);

adsRouter.post(
  '/:ts/muc-tieu',
  asyncHandler(async (req, res) => {
    const b = z.object({ cpa: z.number().min(0).max(1e12) }).parse(req.body);
    res.json(await luuMucTieu(await nguoiCua(req), ts(req), b.cpa));
  }),
);

/** AI đề xuất ngay cho một tài khoản (đọc kho tri thức + số liệu) — có thể mất 30–90 giây. */
adsRouter.post(
  '/:ts/ai-de-xuat',
  asyncHandler(async (req, res) => {
    res.json({ so: await aiDeXuat(ts(req), await nguoiCua(req)) });
  }),
);

/** Chỉ số chi tiết theo cấp (campaign | adgroup | ad) và khoảng 7 / 14 / 30 ngày. */
adsRouter.get(
  '/:ts/chi-tiet',
  asyncHandler(async (req, res) => {
    const cap = z.enum(['campaign', 'adgroup', 'ad']).parse(req.query.cap || 'campaign');
    const kh = await khoangCua(req);
    const { chiTiet } = await import('./adsDieuChinh.service.js');
    res.json({ cap, ...kh, chiSo: await chiTiet(await nguoiCua(req), ts(req), cap, kh) });
  }),
);

/** Cả tài khoản chia theo ngày / tuần / tháng trong khoảng đã chọn (anh Tâm 11/11/2026: "như fb"). */
adsRouter.get(
  '/:ts/theo-thoi-gian',
  asyncHandler(async (req, res) => {
    const nhom = z.enum(['ngay', 'tuan', 'thang']).parse(req.query.nhom || 'ngay');
    const kh = await khoangCua(req);
    const { theoThoiGian } = await import('./adsDieuChinh.service.js');
    res.json({ nhom, ...kh, dong: await theoThoiGian(await nguoiCua(req), ts(req), kh, nhom) });
  }),
);

/** ?mau=7|hom_qua|tuan_truoc|thang_nay|tuy_chon&tu=&den= — như bộ chọn ngày của Trình quản lý quảng cáo. */
async function khoangCua(req: Request) {
  const { khoangNgay } = await import('../lib/khoangNgay.js');
  const { todayIso } = await import('../lib/datetime.js');
  const mau = String(req.query.mau || req.query.ky || '7');
  return khoangNgay(mau, todayIso(), String(req.query.tu || ''), String(req.query.den || ''));
}
