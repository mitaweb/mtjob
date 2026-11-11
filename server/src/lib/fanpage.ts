// Fanpage (học Javis — anh Tâm 11/11/2026 chọn mục 8): AI soạn bài / trả lời bình luận, ANH DUYỆT mới đăng.

export interface BinhLuan {
  id: string;
  noiDung: string;
  nguoi: string;
  luc: string;
  baiId: string;
  bai: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type Json = any;

/**
 * Từ feed Graph API (`/{page}/feed?fields=id,message,comments{id,message,from,created_time,comments{from}}`) → bình
 * luận cần AI xét: không phải của chính Trang, Trang chưa trả lời, chưa xét lần nào, có chữ, mới hơn `sauMs`.
 */
export function binhLuanCanXet(feed: Json, pageId: string, daXet: Set<string>, sauMs: number): BinhLuan[] {
  const ra: BinhLuan[] = [];
  for (const bai of Array.isArray(feed?.data) ? feed.data : []) {
    for (const c of Array.isArray(bai?.comments?.data) ? bai.comments.data : []) {
      const id = String(c?.id || '');
      const noiDung = String(c?.message || '').trim();
      if (!id || !noiDung || daXet.has(id)) continue;
      if (String(c?.from?.id || '') === pageId) continue;
      const tl = Array.isArray(c?.comments?.data) ? c.comments.data : [];
      if (tl.some((r: Json) => String(r?.from?.id || '') === pageId)) continue;
      const luc = String(c?.created_time || '');
      if (!(Date.parse(luc) > sauMs)) continue;
      ra.push({ id, noiDung: noiDung.slice(0, 1000), nguoi: String(c?.from?.name || ''), luc, baiId: String(bai?.id || ''), bai: String(bai?.message || '').slice(0, 500) });
    }
  }
  return ra;
}
