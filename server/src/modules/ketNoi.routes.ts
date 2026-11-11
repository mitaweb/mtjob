// /api/ket-noi — Kết nối nền tảng (anh Tâm 10–11/11/2026). CHỈ giám đốc.
import { Router, type Request } from 'express';
import { z } from 'zod';
import { asyncHandler, ApiError } from '../util/errors.js';
import { requireAuth, requireRole } from '../auth/middleware.js';
import { signState, verifyState } from '../auth/jwt.js';
import { urlDangNhapMeta, urlDangNhapGoogle } from '../lib/ketNoi.js';
import {
  dsKetNoi,
  metaCauHinh,
  googleCauHinh,
  metaNhanCode,
  googleNhanCode,
  cauHinhChoTrang,
  luuCauHinh,
  themMcp,
  kiemTra,
  xoaKetNoi,
} from './ketNoi.service.js';

export const ketNoiRouter = Router();

function goc(req: Request): string {
  if (process.env.PUBLIC_URL) return process.env.PUBLIC_URL.replace(/\/$/, '');
  const proto = String(req.headers['x-forwarded-proto'] || req.protocol || 'https').split(',')[0]!;
  const host = String(req.headers['x-forwarded-host'] || req.headers.host || '');
  return `${proto}://${host}`;
}
const duongVe = (req: Request, nen: 'meta' | 'google') => `${goc(req)}/api/ket-noi/${nen}/callback`;

/**
 * Facebook / Google chuyển về đây sau khi anh đăng nhập (trình duyệt tự mở — không có mã đăng nhập MTJOB, kiểm bằng
 * `state` ký sống 10 phút).
 */
for (const nen of ['meta', 'google'] as const) {
  ketNoiRouter.get(
    `/${nen}/callback`,
    asyncHandler(async (req, res) => {
      const ve = (o: Record<string, string>) => res.redirect(`/ket-noi-mcp?${new URLSearchParams({ tab: 'ket_noi', ...o }).toString()}`);
      try {
        if (req.query.error) return ve({ ket_noi: 'loi', thong_bao: String(req.query.error_description || req.query.error).slice(0, 200) });
        verifyState(String(req.query.state || ''), `ket-noi-${nen}`);
        const code = String(req.query.code || '');
        const ten = nen === 'meta' ? await metaNhanCode(code, duongVe(req, 'meta')) : await googleNhanCode(code, duongVe(req, 'google'));
        return ve({ ket_noi: `${nen}_ok`, ten });
      } catch (e) {
        return ve({ ket_noi: 'loi', thong_bao: (e as Error).message.slice(0, 200) });
      }
    }),
  );
}

ketNoiRouter.use(requireAuth, requireRole('director'));

ketNoiRouter.get(
  '/',
  asyncHandler(async (req, res) => {
    let ds: Awaited<ReturnType<typeof dsKetNoi>> = [];
    let canCapNhatDb = false;
    try {
      ds = await dsKetNoi();
    } catch {
      canCapNhatDb = true;
    }
    const coKhoa = (process.env.KET_NOI_KEY || process.env.ZALO_SESSION_KEY || '').length >= 32;
    res.json({
      ds: ds.map(({ congCu, ...x }) => ({ ...x, soCongCu: congCu.length, congCu: congCu.map((t) => ({ name: t.name, description: (t.description || '').split('\n')[0]!.slice(0, 160) })) })),
      cauHinh: coKhoa && !canCapNhatDb ? await cauHinhChoTrang().catch(() => ({})) : {},
      duongVe: { meta: duongVe(req, 'meta'), google: duongVe(req, 'google') },
      coKhoa,
      canCapNhatDb,
    });
  }),
);

/** Anh dán App ID / Secret (Meta), Client ID / Secret (Google), MCC… — lưu bản mã. */
ketNoiRouter.post(
  '/cau-hinh',
  asyncHandler(async (req, res) => {
    const s = z.string().max(500).optional();
    const b = z
      .object({ meta_app_id: s, meta_app_secret: s, google_client_id: s, google_client_secret: s, google_dev_token: s, google_mcc: s })
      .parse(req.body);
    await luuCauHinh(b);
    res.json({ ok: true, cauHinh: await cauHinhChoTrang() });
  }),
);

ketNoiRouter.get(
  '/meta/bat-dau',
  asyncHandler(async (req, res) => {
    const c = await metaCauHinh();
    if (!c.appId || !c.secret) throw new ApiError(400, 'Chưa có App ID / App Secret của app Meta — dán ở trang Kết nối MCP → tab Kết nối');
    res.json({
      url: urlDangNhapMeta({
        appId: c.appId,
        configId: c.configId,
        version: c.version,
        redirectUri: duongVe(req, 'meta'),
        state: signState({ sub: req.user!.sub, muc: 'ket-noi-meta' }),
        // ?fanpage=1: nút Kết nối Fanpage (tab Fanpage) — xin thêm quyền Trang.
        fanpage: req.query.fanpage === '1',
      }),
    });
  }),
);

ketNoiRouter.get(
  '/google/bat-dau',
  asyncHandler(async (req, res) => {
    const c = await googleCauHinh();
    if (!c.clientId || !c.secret) throw new ApiError(400, 'Chưa có Client ID / Client Secret Google — dán ở trang Kết nối MCP → tab Kết nối');
    res.json({ url: urlDangNhapGoogle({ clientId: c.clientId, redirectUri: duongVe(req, 'google'), state: signState({ sub: req.user!.sub, muc: 'ket-noi-google' }) }) });
  }),
);

ketNoiRouter.post(
  '/mcp',
  asyncHandler(async (req, res) => {
    const b = z.object({ ten: z.string().max(80).default(''), url: z.string().min(8).max(500), token: z.string().max(4000).default('') }).parse(req.body);
    const id = await themMcp(b);
    res.json({ ok: true, id, ...(await kiemTra(id).catch((e) => ({ congCu: [], taiSan: [], loi: [(e as Error).message] }))) });
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
