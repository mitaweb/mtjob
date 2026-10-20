// Gửi tin Zalo hàng loạt — đọc/ghi DB (anh Tâm 20/10/2026). Chỉ giám đốc dùng (router /api/zalo đã chặn).
import { q } from '../db/client.js';

export interface NguoiNhan {
  id: string;
  ten: string;
  laNhom: boolean;
  /** Bạn bè Zalo (có trong danh bạ) */
  laBan: boolean;
  /** 0 nam, 1 nữ, -1 không rõ */
  gioiTinh: number;
  /** Mã thẻ phân loại Zalo */
  nhan: string[];
  khach: null | { id: string; ten: string; trangThai: string; nguon: string };
  /** ISO — tin gần nhất trong cuộc (theo đồng bộ) */
  tinCuoi: string;
  /** AI / anh đã loại cuộc này (nhóm không liên quan, chat cá nhân…) */
  daLoai: boolean;
  /** ISO — lần gần nhất app gửi hàng loạt tới người này */
  guiCuoi: string;
}

export interface NhanZalo {
  id: string;
  ten: string;
  mau: string;
  emoji: string;
  soCuoc: number;
}

/** Mọi người / nhóm có thể nhận: các cuộc đã có trong app + bạn bè trong danh bạ Zalo. */
export async function dsNguoiNhan(): Promise<{ ds: NguoiNhan[]; nhan: NhanZalo[]; danhBaLuc: string }> {
  const [cuoc, ban, nhanRows, gui] = await Promise.all([
    q(`SELECT t.thread_id, t.name, t.is_group, t.enabled, t.ai_checked, t.customer_id, t.customer, t.last_msg_at,
              c.name AS c_name, c.status AS c_status, c.source AS c_source
         FROM zalo_threads t LEFT JOIN customers c ON c.customer_id = t.customer_id AND t.customer_id <> ''`),
    q('SELECT thread_id, ten, gioi_tinh, cap_nhat FROM zalo_danh_ba').catch(() => [] as Record<string, unknown>[]),
    q('SELECT * FROM zalo_nhan ORDER BY ten').catch(() => [] as Record<string, unknown>[]),
    q(`SELECT thread_id, MAX(gui_luc) AS luc FROM zalo_gui WHERE trang_thai = 'da_gui' GROUP BY thread_id`).catch(
      () => [] as Record<string, unknown>[],
    ),
  ]);
  const nhan: NhanZalo[] = [];
  const nhanCua = new Map<string, string[]>();
  for (const r of nhanRows) {
    let ds: string[] = [];
    try {
      ds = JSON.parse(String(r.cuoc || '[]'));
    } catch {
      /* bỏ qua */
    }
    const id = String(r.label_id);
    nhan.push({ id, ten: String(r.ten || ''), mau: String(r.mau || ''), emoji: String(r.emoji || ''), soCuoc: ds.length });
    for (const c of ds) {
      // Zalo ghi nhóm trong thẻ dạng "g<mã nhóm>".
      const ma = /^g\d+$/.test(c) ? c.slice(1) : c;
      nhanCua.set(ma, [...(nhanCua.get(ma) || []), id]);
    }
  }
  const guiCuoi = new Map(gui.map((r) => [String(r.thread_id), String(r.luc || '')]));
  const theoId = new Map<string, NguoiNhan>();
  for (const r of cuoc) {
    const id = String(r.thread_id);
    theoId.set(id, {
      id,
      ten: String(r.name || r.customer || ''),
      laNhom: !!r.is_group,
      laBan: false,
      gioiTinh: -1,
      nhan: nhanCua.get(id) || [],
      khach: r.customer_id
        ? { id: String(r.customer_id), ten: String(r.c_name || r.customer || ''), trangThai: String(r.c_status || ''), nguon: String(r.c_source || '') }
        : null,
      tinCuoi: String(r.last_msg_at || ''),
      daLoai: !!r.ai_checked && !r.enabled,
      guiCuoi: guiCuoi.get(id) || '',
    });
  }
  let danhBaLuc = '';
  for (const r of ban) {
    const id = String(r.thread_id);
    if (String(r.cap_nhat || '') > danhBaLuc) danhBaLuc = String(r.cap_nhat);
    const x = theoId.get(id);
    if (x) {
      x.laBan = true;
      x.gioiTinh = Number(r.gioi_tinh ?? -1);
      if (!x.ten) x.ten = String(r.ten || '');
    } else {
      theoId.set(id, {
        id,
        ten: String(r.ten || ''),
        laNhom: false,
        laBan: true,
        gioiTinh: Number(r.gioi_tinh ?? -1),
        nhan: nhanCua.get(id) || [],
        khach: null,
        tinCuoi: '',
        daLoai: false,
        guiCuoi: guiCuoi.get(id) || '',
      });
    }
  }
  const ds = [...theoId.values()].filter((x) => x.ten.trim());
  ds.sort((a, b) => (b.tinCuoi || '').localeCompare(a.tinCuoi || '') || a.ten.localeCompare(b.ten, 'vi'));
  return { ds, nhan, danhBaLuc };
}

/** Ghi danh bạ bạn bè + thẻ phân loại vừa lấy từ Zalo (ghi đè từng dòng, không xoá ai). */
export async function ghiDanhBa(
  ban: Array<{ id: string; ten: string; gioiTinh: number }>,
  nhan: Array<{ id: string; ten: string; mau: string; emoji: string; cuoc: string[] }>,
  luc: string,
): Promise<void> {
  const khongTrung = [...new Map(ban.map((b) => [b.id, b])).values()];
  for (let i = 0; i < khongTrung.length; i += 300) {
    const lo = khongTrung.slice(i, i + 300);
    const p: unknown[] = [];
    const vals = lo.map((b) => {
      p.push(b.id, b.ten.slice(0, 200), b.gioiTinh, luc);
      const n = p.length;
      return `($${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
    });
    await q(
      `INSERT INTO zalo_danh_ba (thread_id, ten, gioi_tinh, cap_nhat) VALUES ${vals.join(', ')}
       ON CONFLICT (thread_id) DO UPDATE SET ten = COALESCE(NULLIF(EXCLUDED.ten, ''), zalo_danh_ba.ten),
         gioi_tinh = EXCLUDED.gioi_tinh, cap_nhat = EXCLUDED.cap_nhat`,
      p,
    );
  }
  for (const n of nhan) {
    await q(
      `INSERT INTO zalo_nhan (label_id, ten, mau, emoji, cuoc, cap_nhat) VALUES ($1, $2, $3, $4, $5, $6)
       ON CONFLICT (label_id) DO UPDATE SET ten = EXCLUDED.ten, mau = EXCLUDED.mau, emoji = EXCLUDED.emoji,
         cuoc = EXCLUDED.cuoc, cap_nhat = EXCLUDED.cap_nhat`,
      [n.id, n.ten.slice(0, 100), n.mau.slice(0, 20), n.emoji.slice(0, 20), JSON.stringify(n.cuoc.slice(0, 5000)), luc],
    );
  }
}

export interface ChienDich {
  id: string;
  noiDung: string;
  nguoi: string;
  taoLuc: string;
  trangThai: string;
  tong: number;
  ghiChu: string;
  daGui: number;
  loi: number;
  bo: number;
  cho: number;
}

export async function taoChienDich(
  cd: { id: string; noiDung: string; nguoi: string; taoLuc: string },
  ds: Array<{ id: string; ten: string; laNhom: boolean }>,
): Promise<void> {
  await q(`INSERT INTO zalo_chien_dich (id, noi_dung, nguoi, tao_luc, trang_thai, tong) VALUES ($1, $2, $3, $4, 'dang_gui', $5)`, [
    cd.id,
    cd.noiDung,
    cd.nguoi,
    cd.taoLuc,
    ds.length,
  ]);
  for (let i = 0; i < ds.length; i += 200) {
    const lo = ds.slice(i, i + 200);
    const p: unknown[] = [];
    const vals = lo.map((x, k) => {
      p.push(cd.id, x.id, x.ten.slice(0, 200), x.laNhom, i + k);
      const n = p.length;
      return `($${n - 4}, $${n - 3}, $${n - 2}, $${n - 1}, $${n})`;
    });
    await q(`INSERT INTO zalo_gui (chien_dich_id, thread_id, ten, is_group, thu_tu) VALUES ${vals.join(', ')} ON CONFLICT DO NOTHING`, p);
  }
}

export async function dsChienDich(limit = 20): Promise<ChienDich[]> {
  const rows = await q(
    `SELECT c.*,
            COUNT(*) FILTER (WHERE g.trang_thai = 'da_gui')::int AS da_gui,
            COUNT(*) FILTER (WHERE g.trang_thai = 'loi')::int AS loi,
            COUNT(*) FILTER (WHERE g.trang_thai = 'bo')::int AS bo,
            COUNT(*) FILTER (WHERE g.trang_thai = 'cho')::int AS cho
       FROM zalo_chien_dich c LEFT JOIN zalo_gui g ON g.chien_dich_id = c.id
      GROUP BY c.id ORDER BY c.tao_luc DESC LIMIT $1`,
    [limit],
  );
  return rows.map((r) => ({
    id: String(r.id),
    noiDung: String(r.noi_dung || ''),
    nguoi: String(r.nguoi || ''),
    taoLuc: String(r.tao_luc || ''),
    trangThai: String(r.trang_thai || ''),
    tong: Number(r.tong) || 0,
    ghiChu: String(r.ghi_chu || ''),
    daGui: Number(r.da_gui) || 0,
    loi: Number(r.loi) || 0,
    bo: Number(r.bo) || 0,
    cho: Number(r.cho) || 0,
  }));
}

export async function chiTietChienDich(id: string): Promise<Array<{ id: string; ten: string; laNhom: boolean; trangThai: string; loi: string; guiLuc: string }>> {
  const rows = await q('SELECT * FROM zalo_gui WHERE chien_dich_id = $1 ORDER BY thu_tu', [id]);
  return rows.map((r) => ({
    id: String(r.thread_id),
    ten: String(r.ten || ''),
    laNhom: !!r.is_group,
    trangThai: String(r.trang_thai || ''),
    loi: String(r.loi || ''),
    guiLuc: String(r.gui_luc || ''),
  }));
}

/** Dừng hẳn (người chưa gửi → bỏ) hoặc tạm dừng / chạy tiếp. */
export async function doiTrangThaiChienDich(id: string, trangThai: 'dung' | 'tam_dung' | 'dang_gui', ghiChu = ''): Promise<boolean> {
  const r = await q('UPDATE zalo_chien_dich SET trang_thai = $2, ghi_chu = $3 WHERE id = $1 RETURNING id', [id, trangThai, ghiChu]);
  if (trangThai === 'dung') await q(`UPDATE zalo_gui SET trang_thai = 'bo', loi = 'anh dừng chiến dịch' WHERE chien_dich_id = $1 AND trang_thai = 'cho'`, [id]);
  return r.length > 0;
}

/** Vài người kế tiếp chờ gửi (chiến dịch cũ trước, theo thứ tự anh chọn). */
export async function tinChoGui(n: number): Promise<Array<{ chienDichId: string; noiDung: string; id: string; ten: string; laNhom: boolean }>> {
  const rows = await q(
    `SELECT g.chien_dich_id, c.noi_dung, g.thread_id, g.ten, g.is_group
       FROM zalo_gui g JOIN zalo_chien_dich c ON c.id = g.chien_dich_id
      WHERE c.trang_thai = 'dang_gui' AND g.trang_thai = 'cho'
      ORDER BY c.tao_luc, g.thu_tu LIMIT $1`,
    [n],
  );
  return rows.map((r) => ({
    chienDichId: String(r.chien_dich_id),
    noiDung: String(r.noi_dung || ''),
    id: String(r.thread_id),
    ten: String(r.ten || ''),
    laNhom: !!r.is_group,
  }));
}

export async function demDaGuiTu(luc: string): Promise<number> {
  const r = await q(`SELECT COUNT(*)::int AS n FROM zalo_gui WHERE trang_thai = 'da_gui' AND gui_luc >= $1`, [luc]);
  return Number(r[0]?.n) || 0;
}

/** Lần gửi gần nhất tới một cuộc (mọi chiến dịch) — '' nếu chưa. */
export async function guiCuoiToi(threadId: string): Promise<string> {
  const r = await q(`SELECT MAX(gui_luc) AS luc FROM zalo_gui WHERE thread_id = $1 AND trang_thai = 'da_gui'`, [threadId]);
  return String(r[0]?.luc || '');
}

export async function ghiKetQuaGui(
  chienDichId: string,
  threadId: string,
  kq: { trangThai: 'da_gui' | 'loi' | 'bo'; loi?: string; msgId?: string; luc: string },
): Promise<void> {
  await q('UPDATE zalo_gui SET trang_thai = $3, loi = $4, msg_id = $5, gui_luc = $6 WHERE chien_dich_id = $1 AND thread_id = $2', [
    chienDichId,
    threadId,
    kq.trangThai,
    (kq.loi || '').slice(0, 300),
    kq.msgId || '',
    kq.luc,
  ]);
}

/** Chiến dịch hết người chờ → xong. */
export async function chotChienDichXong(): Promise<void> {
  await q(
    `UPDATE zalo_chien_dich c SET trang_thai = 'xong'
      WHERE c.trang_thai = 'dang_gui' AND NOT EXISTS (SELECT 1 FROM zalo_gui g WHERE g.chien_dich_id = c.id AND g.trang_thai = 'cho')`,
  );
}

/** Các mã tin do app gửi hàng loạt — đồng bộ tin về thì bỏ qua, AI không đọc tin quảng cáo của chính mình. */
export async function laTinHangLoat(msgIds: string[]): Promise<Set<string>> {
  if (!msgIds.length) return new Set();
  const r = await q('SELECT msg_id FROM zalo_gui WHERE msg_id = ANY($1)', [msgIds]).catch(() => [] as Record<string, unknown>[]);
  return new Set(r.map((x) => String(x.msg_id)));
}
