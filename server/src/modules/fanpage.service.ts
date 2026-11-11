// Fanpage (học Javis — anh Tâm 11/11/2026 chọn mục 8). AI ĐỀ XUẤT, ANH DUYỆT mới đăng — không có đường nào tự đăng.
//  - Bài đăng: anh viết / nhờ AI viết (trong Quản trị hoặc qua trợ lý) → nháp chờ duyệt → anh sửa + bấm Đăng.
//  - Bình luận: chuỗi cron 15 phút / lượt đọc bình luận mới trên các Trang; AI "giám khảo" xét có cần trả lời không và
//    soạn câu trả lời CHỈ dựa trên tri thức công khai trong kho (không lộ giá / chi phí nội bộ) → chờ anh duyệt.
// Token Trang lấy qua đăng nhập Facebook (app Meta chế độ phát triển), lưu BẢN MÃ.
import { q } from '../db/client.js';
import { newId } from '../util/id.js';
import { nowTz } from '../lib/datetime.js';
import { ApiError } from '../util/errors.js';
import { maHoa, giaiMa } from '../lib/maHoa.js';
import { binhLuanCanXet, type BinhLuan } from '../lib/fanpage.js';
import { khoa, metaCauHinh, tokenMeta } from './ketNoi.service.js';
import { notify } from './notifications.service.js';
import { getDirectors } from './members.repo.js';
import type { ToolDef } from './assistant.service.js';

async function fb(method: 'GET' | 'POST', duongDan: string, tham: Record<string, string>): Promise<Record<string, unknown>> {
  const { version } = await metaCauHinh();
  const u = new URL(`https://graph.facebook.com/${version}/${duongDan}`);
  let body: URLSearchParams | undefined;
  if (method === 'GET') for (const [k, v] of Object.entries(tham)) u.searchParams.set(k, v);
  else body = new URLSearchParams(tham);
  const r = await fetch(u, { method, body, signal: AbortSignal.timeout(20_000) });
  const j = (await r.json().catch(() => ({}))) as Record<string, unknown>;
  if (!r.ok) {
    const loi = (j.error as { message?: string } | undefined)?.message || `HTTP ${r.status}`;
    throw new ApiError(400, `Facebook báo: ${loi}`);
  }
  return j;
}

// ── Trang ──

export interface Trang {
  pageId: string;
  ten: string;
  capNhat: string;
}

/** Lấy các Trang anh quản trị (me/accounts) + token Trang (không hết hạn khi lấy từ token dài hạn) → lưu bản mã. */
export async function luuTrang(tokenNguoiDung?: string): Promise<number> {
  const token = tokenNguoiDung || (await tokenMeta());
  if (!token) throw new ApiError(400, 'Chưa kết nối Facebook — bấm Kết nối Facebook ở trang Kết nối MCP → tab Kết nối');
  const j = await fb('GET', 'me/accounts', { fields: 'id,name,access_token', limit: '100', access_token: token });
  const ds = (j.data as Array<Record<string, unknown>>) || [];
  const luc = nowTz().toISOString();
  for (const p of ds) {
    if (!p.id || !p.access_token) continue;
    await q(
      `INSERT INTO fanpage (page_id, ten, token_ma, cap_nhat) VALUES ($1, $2, $3, $4)
       ON CONFLICT (page_id) DO UPDATE SET ten = EXCLUDED.ten, token_ma = EXCLUDED.token_ma, cap_nhat = EXCLUDED.cap_nhat`,
      [String(p.id), String(p.name || ''), maHoa(String(p.access_token), khoa()), luc],
    );
  }
  return ds.length;
}

export async function dsTrang(): Promise<Trang[]> {
  return (await q('SELECT page_id, ten, cap_nhat FROM fanpage ORDER BY ten')).map((r) => ({ pageId: String(r.page_id), ten: String(r.ten || ''), capNhat: String(r.cap_nhat || '') }));
}

async function tokenTrang(pageId: string): Promise<string> {
  const r = (await q('SELECT token_ma FROM fanpage WHERE page_id = $1', [pageId]))[0];
  if (!r?.token_ma) throw new ApiError(400, 'Chưa có quyền Trang này — bấm "Lấy lại danh sách Trang"');
  return giaiMa(String(r.token_ma), khoa());
}

// ── Đề xuất ──

export interface DeXuat {
  id: string;
  pageId: string;
  ten: string;
  loai: 'bai' | 'tra_loi';
  noiDung: string;
  binhLuanId: string;
  binhLuan: string;
  nguoiBl: string;
  baiId: string;
  bai: string;
  lyDo: string;
  trangThai: string;
  ketQua: string;
  nguoiTao: string;
  taoLuc: string;
  duyetLuc: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowTo(r: any): DeXuat {
  return {
    id: String(r.id),
    pageId: String(r.page_id),
    ten: String(r.ten || ''),
    loai: r.loai === 'bai' ? 'bai' : 'tra_loi',
    noiDung: String(r.noi_dung || ''),
    binhLuanId: String(r.binh_luan_id || ''),
    binhLuan: String(r.binh_luan || ''),
    nguoiBl: String(r.nguoi_bl || ''),
    baiId: String(r.bai_id || ''),
    bai: String(r.bai || ''),
    lyDo: String(r.ly_do || ''),
    trangThai: String(r.trang_thai || ''),
    ketQua: String(r.ket_qua || ''),
    nguoiTao: String(r.nguoi_tao || ''),
    taoLuc: String(r.tao_luc || ''),
    duyetLuc: String(r.duyet_luc || ''),
  };
}

const CHON = 'SELECT d.*, f.ten FROM fanpage_de_xuat d LEFT JOIN fanpage f ON f.page_id = d.page_id';

export async function dsDeXuat(): Promise<{ cho: DeXuat[]; lichSu: DeXuat[] }> {
  const [cho, lichSu] = await Promise.all([
    q(`${CHON} WHERE d.trang_thai IN ('cho', 'loi') ORDER BY d.tao_luc DESC LIMIT 100`),
    q(`${CHON} WHERE d.trang_thai IN ('da_dang', 'tu_choi') ORDER BY COALESCE(NULLIF(d.duyet_luc, ''), d.tao_luc) DESC LIMIT 20`),
  ]);
  return { cho: cho.map(rowTo), lichSu: lichSu.map(rowTo) };
}

export async function taoBai(pageId: string, noiDung: string, nguoiTao: 'ai' | 'anh'): Promise<DeXuat> {
  const nd = noiDung.trim();
  if (nd.length < 5) throw new ApiError(400, 'Nội dung bài quá ngắn');
  if (!(await q('SELECT 1 FROM fanpage WHERE page_id = $1', [pageId])).length) throw new ApiError(400, 'Không thấy Trang này');
  const id = newId('FB-');
  await q(`INSERT INTO fanpage_de_xuat (id, page_id, loai, noi_dung, nguoi_tao, tao_luc) VALUES ($1, $2, 'bai', $3, $4, $5)`, [id, pageId, nd.slice(0, 5000), nguoiTao, nowTz().toISOString()]);
  return rowTo((await q(`${CHON} WHERE d.id = $1`, [id]))[0]);
}

/** ANH DUYỆT → đăng thật lên Facebook. Đăng hỏng thì ghi 'loi', duyệt lại được. */
export async function duyet(id: string, noiDungSua?: string): Promise<DeXuat> {
  const r = (await q(`${CHON} WHERE d.id = $1`, [id]))[0];
  if (!r) throw new ApiError(404, 'Không thấy đề xuất');
  const d = rowTo(r);
  if (!['cho', 'loi'].includes(d.trangThai)) throw new ApiError(400, 'Đề xuất này đã xử lý rồi');
  const noiDung = (noiDungSua ?? d.noiDung).trim();
  if (noiDung.length < 2) throw new ApiError(400, 'Nội dung trống');
  const luc = nowTz().toISOString();
  try {
    const token = await tokenTrang(d.pageId);
    const kq = d.loai === 'bai' ? await fb('POST', `${d.pageId}/feed`, { message: noiDung, access_token: token }) : await fb('POST', `${d.binhLuanId}/comments`, { message: noiDung, access_token: token });
    await q(`UPDATE fanpage_de_xuat SET trang_thai = 'da_dang', noi_dung = $2, ket_qua = $3, duyet_luc = $4 WHERE id = $1`, [id, noiDung, String(kq.id || ''), luc]);
  } catch (e) {
    await q(`UPDATE fanpage_de_xuat SET trang_thai = 'loi', noi_dung = $2, ket_qua = $3, duyet_luc = $4 WHERE id = $1`, [id, noiDung, (e as Error).message.slice(0, 300), luc]);
    throw e;
  }
  return rowTo((await q(`${CHON} WHERE d.id = $1`, [id]))[0]);
}

export async function tuChoi(id: string): Promise<void> {
  await q(`UPDATE fanpage_de_xuat SET trang_thai = 'tu_choi', duyet_luc = $2 WHERE id = $1 AND trang_thai IN ('cho', 'loi')`, [id, nowTz().toISOString()]);
}

// ── AI ──

/** Tri thức CÔNG KHAI (phạm vi "mọi nhân sự", đã ẩn giá / chi phí) — thứ được phép nói ra ngoài. */
async function triThucCongKhai(cau: string): Promise<string> {
  const { timTriThuc } = await import('./brainItems.service.js');
  return (await timTriThuc(cau, { directorScope: false, memberId: '', teamId: '' }).catch(() => '')).slice(0, 5000);
}

const LUAT_CHUNG = [
  'Bạn viết cho Fanpage của agency marketing MT Digital (Trang đăng công khai — ai cũng đọc được).',
  '- CHỈ dùng thông tin có trong TRI THỨC bên dưới. Không bịa giá, ưu đãi, cam kết, số liệu, thời hạn.',
  '- Không nêu giá / chi phí cụ thể, không nói chuyện nội bộ, không nêu tên nhân sự, không số điện thoại cá nhân.',
  '- Giọng thân thiện, ngắn gọn, tiếng Việt có dấu, xưng "MT Digital" hoặc "em", gọi khách "anh/chị".',
];

export async function vietBaiAi(pageId: string, yeuCau: string): Promise<string> {
  const ten = (await dsTrang()).find((t) => t.pageId === pageId)?.ten || 'Fanpage';
  const { aiKhoJson } = await import('../ai/brainAi.js');
  const r = (await aiKhoJson(
    [
      ...LUAT_CHUNG,
      `Viết MỘT bài đăng cho Trang «${ten}» theo yêu cầu dưới. 80–200 chữ, có lời kêu gọi hành động cuối bài, tối đa 3 hashtag.`,
      '',
      `YÊU CẦU:\n${yeuCau.slice(0, 1500)}`,
      '',
      `TRI THỨC:\n${(await triThucCongKhai(yeuCau)) || '(không có)'}`,
    ].join('\n'),
    { type: 'OBJECT', properties: { noiDung: { type: 'STRING' } }, required: ['noiDung'] },
  )) as { noiDung?: string };
  const nd = String(r?.noiDung || '').trim();
  if (!nd) throw new ApiError(502, 'AI chưa viết được — thử lại');
  return nd;
}

const SCHEMA_TRA_LOI = {
  type: 'OBJECT',
  properties: { nenTraLoi: { type: 'BOOLEAN' }, traLoi: { type: 'STRING' }, lyDo: { type: 'STRING' } },
  required: ['nenTraLoi', 'traLoi', 'lyDo'],
};

/** "Giám khảo" + soạn trả lời một bình luận. */
async function soanTraLoi(ten: string, b: BinhLuan): Promise<{ nenTraLoi: boolean; traLoi: string; lyDo: string }> {
  const { aiKhoJson } = await import('../ai/brainAi.js');
  const r = (await aiKhoJson(
    [
      ...LUAT_CHUNG,
      `Có bình luận mới trên Trang «${ten}». Xét CÓ NÊN trả lời không, nếu có thì soạn câu trả lời (≤ 60 chữ).`,
      '- KHÔNG trả lời (nenTraLoi=false): spam, quảng cáo của người khác, chỉ tag bạn bè, chỉ emoji / sticker, chửi bới, chuyện',
      '  không liên quan dịch vụ. Lời khen / cảm ơn: trả lời một câu cảm ơn ngắn.',
      '- Hỏi giá / hỏi chi tiết mà TRI THỨC không có: trả lời lịch sự, mời anh/chị nhắn tin cho Trang để được tư vấn cụ thể.',
      '- Phàn nàn: xin lỗi, mời nhắn tin cho Trang để xử lý — không cãi, không hứa đền bù.',
      'lyDo: một câu ngắn giải thích (anh duyệt sẽ đọc).',
      '',
      `BÀI ĐĂNG: ${b.bai || '(không có chữ)'}`,
      `BÌNH LUẬN của ${b.nguoi || 'khách'}: ${b.noiDung}`,
      '',
      `TRI THỨC:\n${(await triThucCongKhai(`${b.noiDung}\n${b.bai}`)) || '(không có)'}`,
    ].join('\n'),
    SCHEMA_TRA_LOI,
  )) as { nenTraLoi?: boolean; traLoi?: string; lyDo?: string };
  return { nenTraLoi: r?.nenTraLoi !== false && !!String(r?.traLoi || '').trim(), traLoi: String(r?.traLoi || '').trim().slice(0, 1500), lyDo: String(r?.lyDo || '').slice(0, 300) };
}

const MOC_QUET = 'fanpage_quet';
const CACH_QUET_MS = 15 * 60_000;
/** Mỗi lượt AI xét tối đa ngần này bình luận (còn thì lượt sau). */
const TOI_DA_MOT_LUOT = 8;
/** Chỉ xét bình luận trong chừng này ngày. */
const NGAY_XET = 7;

/**
 * Đọc bình luận mới trên mọi Trang → AI xét + soạn trả lời → chờ anh duyệt. `ep` = anh bấm "Quét ngay" (bỏ qua giãn
 * 15 phút). Trả số đề xuất mới.
 */
export async function quetBinhLuan(o: { ep?: boolean } = {}): Promise<{ moi: number; boQua: number; loi: string[]; baiDoc: number; binhLuanDoc: number }> {
  const { docMoc, ghiMoc } = await import('./hieuAnh.repo.js');
  const kq = { moi: 0, boQua: 0, loi: [] as string[], baiDoc: 0, binhLuanDoc: 0 };
  if (!o.ep && Date.now() < (await docMoc(MOC_QUET).catch(() => Number.MAX_SAFE_INTEGER))) return kq;
  const trang = await dsTrang().catch(() => []);
  if (!trang.length) return kq;
  await ghiMoc(MOC_QUET, Date.now() + CACH_QUET_MS);
  const { aiAvailable } = await import('../ai/index.js');
  if (!(await aiAvailable())) return { ...kq, loi: ['chưa bật AI'] };
  const sau = Date.now() - NGAY_XET * 86_400_000;
  let daXet = 0;
  for (const t of trang) {
    if (daXet >= TOI_DA_MOT_LUOT) break;
    try {
      const token = await tokenTrang(t.pageId);
      const feed = await fb('GET', `${t.pageId}/feed`, {
        fields: 'id,message,created_time,comments.limit(25).order(reverse_chronological){id,message,from,created_time,comments.limit(10){from}}',
        limit: '10',
        access_token: token,
      });
      const ids = ((feed.data as Array<{ comments?: { data?: Array<{ id?: string }> } }>) || []).flatMap((p) => (p.comments?.data || []).map((c) => String(c.id || '')));
      kq.baiDoc += ((feed.data as unknown[]) || []).length;
      kq.binhLuanDoc += ids.length;
      const da = new Set((await q('SELECT binh_luan_id FROM fanpage_de_xuat WHERE binh_luan_id = ANY($1::text[])', [ids])).map((r) => String(r.binh_luan_id)));
      for (const b of binhLuanCanXet(feed, t.pageId, da, sau)) {
        if (daXet >= TOI_DA_MOT_LUOT) break;
        daXet++;
        const x = await soanTraLoi(t.ten, b);
        await q(
          `INSERT INTO fanpage_de_xuat (id, page_id, loai, noi_dung, binh_luan_id, binh_luan, nguoi_bl, bai_id, bai, ly_do, trang_thai, nguoi_tao, tao_luc)
           VALUES ($1, $2, 'tra_loi', $3, $4, $5, $6, $7, $8, $9, $10, 'ai', $11) ON CONFLICT DO NOTHING`,
          [newId('FB-'), t.pageId, x.traLoi, b.id, b.noiDung, b.nguoi, b.baiId, b.bai, x.lyDo, x.nenTraLoi ? 'cho' : 'bo_qua', nowTz().toISOString()],
        );
        if (x.nenTraLoi) kq.moi++;
        else kq.boQua++;
      }
    } catch (e) {
      kq.loi.push(`${t.ten}: ${(e as Error).message.slice(0, 200)}`);
    }
  }
  // Còn bình luận chưa xét → lượt sau sớm.
  if (daXet >= TOI_DA_MOT_LUOT) await ghiMoc(MOC_QUET, Date.now() + 60_000);
  if (kq.moi) {
    const gd = (await getDirectors().catch(() => []))[0];
    if (gd?.id) await notify(gd.id, { type: 'fanpage', title: `💬 ${kq.moi} trả lời bình luận Fanpage chờ anh duyệt`, body: 'AI đã soạn sẵn — anh xem, sửa rồi bấm Đăng.', url: '/ket-noi-mcp?tab=fanpage' });
  }
  return kq;
}

// ── Công cụ cho trợ lý của giám đốc: CHỈ soạn nháp, không đăng ──


export async function fanpageTools(): Promise<ToolDef[]> {
  const trang = await dsTrang().catch(() => []);
  if (!trang.length) return [];
  return [
    {
      declaration: {
        name: 'create_bai_fanpage',
        description:
          `Soạn BÀI NHÁP cho Fanpage (${trang.map((t) => t.ten).join(', ')}) — KHÔNG đăng; anh duyệt ở trang Kết nối MCP → tab Fanpage mới đăng. ` +
          'Truyền noiDung (anh đọc sẵn nội dung) HOẶC yeuCau (để AI viết từ tri thức công khai trong kho).',
        parameters: {
          type: 'OBJECT',
          properties: {
            trang: { type: 'STRING', description: 'Tên (một phần tên) Trang; bỏ trống khi chỉ có một Trang.' },
            noiDung: { type: 'STRING', description: 'Nội dung bài anh đọc sẵn.' },
            yeuCau: { type: 'STRING', description: 'Yêu cầu để AI viết bài (chủ đề, ưu đãi, đối tượng…).' },
          },
        },
      },
      run: async (a) => {
        const ten = String(a.trang || '').trim().toLowerCase();
        const khop = ten ? trang.filter((t) => t.ten.toLowerCase().includes(ten)) : trang;
        if (khop.length !== 1) return `CHƯA SOẠN: ${khop.length ? 'có nhiều Trang khớp' : 'không thấy Trang'} — các Trang: ${trang.map((t) => t.ten).join(', ')}.`;
        const t = khop[0]!;
        let nd = String(a.noiDung || '').trim();
        if (!nd && String(a.yeuCau || '').trim()) nd = await vietBaiAi(t.pageId, String(a.yeuCau));
        if (!nd) return 'CHƯA SOẠN: thiếu nội dung hoặc yêu cầu.';
        await taoBai(t.pageId, nd, 'ai');
        return `ĐÃ SOẠN bản nháp cho «${t.ten}» — CHƯA đăng. Anh vào trang Kết nối MCP → tab 📣 Fanpage sửa rồi bấm Đăng.\n\n${nd}`;
      },
    },
  ];
}
