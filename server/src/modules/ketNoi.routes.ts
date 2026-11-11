// /api/ket-noi — Kết nối nền tảng qua MCP (anh Tâm 10/11/2026). CHỈ giám đốc.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { signState, verifyState } from '../auth/jwt.js';
import { urlDangNhapMeta } from '../lib/ketNoi.js';
import { dsKetNoi, metaCauHinh, metaNhanCode, metaBatDauKhongApp, metaNhanCodeKhongApp, laStateKhongApp, themMcp, kiemTra, xoaKetNoi } from './ketNoi.service.js';

export const ketNoiRouter = Router();

function goc(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0]!;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  return `${proto}://${host}`;
}
const duongVeMeta = (req: Request) => `${goc(req)}/api/ket-noi/meta/callback`;

/** Facebook chuyển về đây sau khi anh đăng nhập (trình duyệt tự mở — không có mã đăng nhập MTJOB, kiểm bằng `state`). */
ketNoiRouter.get(
  '/meta/callback',
  asyncHandler(async (req, res) => {
    const ve = (o: Record<string, string>) => res.redirect(`/admin?${new URLSearchParams(o).toString()}`);
    try {
      if (req.query.error) return ve({ ket_noi: 'loi', thong_bao: String(req.query.error_description || req.query.error).slice(0, 200) });
      const state = String(req.query.state || '');
      let ten: string;
      if (laStateKhongApp(state)) {
        // Không cần app Meta: MCP OAuth (tự đăng ký + PKCE).
        ten = await metaNhanCodeKhongApp(String(req.query.code || ''), state, duongVeMeta(req));
      } else {
        verifyState(state, 'ket-noi-meta');
        ten = await metaNhanCode(String(req.query.code || ''), duongVeMeta(req));
      }
      return ve({ ket_noi: 'meta_ok', ten });
    } catch (e) {
      return ve({ ket_noi: 'loi', thong_bao: (e as Error).message.slice(0, 200) });
    }
  }),
);

ketNoiRouter.use(requireAuth, requireRole('director'));

ketNoiRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    const c = metaCauHinh();
    let ds: Awaited<ReturnType<typeof dsKetNoi>> = [];
    let canCapNhatDb = false;
    try {
      ds = await dsKetNoi();
    } catch {
      canCapNhatDb = true;
    }
    res.json({
      ds: ds.map(({ congCu, ...x }) => ({ ...x, soCongCu: congCu.length, congCu: congCu.map((t) => ({ name: t.name, description: (t.description || '').split('\n')[0]!.slice(0, 160) })) })),
      // daCauHinh = có app Meta riêng; không có thì vẫn kết nối được bằng cách không cần app.
      meta: { daCauHinh: !!(c.appId && c.secret), duongVe: duongVeMeta(req) },
      coKhoa: (process.env.KET_NOI_KEY || process.env.ZALO_SESSION_KEY || '').length >= 32,
      canCapNhatDb,
    });
  }),
);

ketNoiRouter.get(
  '/meta/bat-dau',
  asyncHandler(async (req, res) => {
    const c = metaCauHinh();
    // Chưa có app Meta riêng → cách KHÔNG cần app (anh Tâm 11/11/2026: xác minh BM bị lỗi).
    if (!c.appId || !c.secret) return res.json({ url: await metaBatDauKhongApp(duongVeMeta(req), req.user!.sub) });
    res.json({ url: urlDangNhapMeta({ appId: c.appId, configId: c.configId, version: c.version, redirectUri: duongVeMeta(req), state: signState({ sub: req.user!.sub, muc: 'ket-noi-meta' }) }) });
  }),
);

ketNoiRouter.post(
  '/mcp',
  asyncHandler(async (req, res) => {
    const b = z.object({ ten: z.string().max(80).default(''), url: z.string().min(8).max(500), token: z.string().max(4000).default('') }).parse(req.body);
    const id = await themMcp(b);
    res.json({ ok: true, id, ...(await kiemTra(id).catch((e) => ({ congCu: [], loiMcp: (e as Error).message }))) });
  }),
);

ketNoiRouter.post(
  '/:id/kiem-tra',
  asyncHandler(async (req, res) => {
    res.json(await kiemTra(String(req.params.id)));
  }),
);

ketNoiRouter.delete(
  '/:id',
  asyncHandler(async (req, res) => {
    await xoaKetNoi(String(req.params.id));
    res.json({ ok: true });
  }),
);
