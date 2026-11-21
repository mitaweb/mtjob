// TẠM THỜI — /api/chuyen-may-chu (anh Tâm 21/11/2026: chuyển MTJOB sang Coolify). Chỉ giám đốc; chỉ chạy khi Vercel có
// CHUYEN_COOLIFY_TOKEN + CHUYEN_COOLIFY_APP. Gửi giá trị biến môi trường thẳng sang Coolify, KHÔNG trả giá trị về trình
// duyệt (chỉ trả tên biến). Gỡ route + biến khi chuyển xong.
import { Router } from 'express';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { bienCanChuyen } from '../lib/chuyenMayChu.js';

export const chuyenMayChuRouter = Router();
chuyenMayChuRouter.use(requireAuth, requireRole('director'));

chuyenMayChuRouter.post(
  '/gui-bien',
  asyncHandler(async (_req, res) => {
    const token = process.env.CHUYEN_COOLIFY_TOKEN;
    const app = process.env.CHUYEN_COOLIFY_APP;
    const goc = (process.env.CHUYEN_COOLIFY_URL || 'https://app.mtdigital.vn').replace(/\/+$/, '');
    if (!token || !app) throw new ApiError(404, 'Chưa bật chuyển máy chủ');
    const ds = bienCanChuyen(process.env);
    const r = await fetch(`${goc}/api/v1/applications/${encodeURIComponent(app)}/envs/bulk`, {
      method: 'PATCH',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ data: ds.map((x) => ({ key: x.key, value: x.value, is_preview: false, is_literal: true })) }),
    });
    if (!r.ok) throw new ApiError(502, `Coolify trả ${r.status}: ${(await r.text()).slice(0, 200)}`);
    res.json({ daChuyen: ds.map((x) => x.key) });
  }),
);
