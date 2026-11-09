// Bộ não HIỂU ANH TÂM (anh Tâm 9/11/2026: "bộ não hiện tại phải hiểu được anh thông qua các đoạn chat của anh với nhân
// viên và khách hàng — hiện tại chưa hiểu"). AI đọc dần tin ANH gửi trên Zalo (cuộc công việc) + câu anh nói với trợ
// lý → rút điều về CHÍNH ANH (cách nói, nguyên tắc, ưu tiên, cách quyết, với từng người…) vào bảng hieu_anh. Trợ lý của
// anh đọc hồ sơ này trước khi trả lời. Quyết định của anh (sửa / bỏ / dạy) luôn thắng AI. CHỈ giám đốc xem.
import { nowTz } from '../lib/datetime.js';
import { tinGanDay } from './zalo.repo.js';
import { getDirectors } from './members.repo.js';
import {
  dsHieuAnh,
  themHieuAnh,
  suaHieuAnhAi,
  cuocCoTinAnhChuaHoc,
  idTinAnhChuaHoc,
  danhDauHocZalo,
  chatAnhChuaHoc,
  danhDauHocChat,
  layKhoa,
  thaKhoa,
  docMoc,
  ghiMoc,
  demTinAnhChuaHoc,
  demChatAnhChuaHoc,
} from './hieuAnh.repo.js';
import {
  chonDoanHoc,
  gopHieuAnh,
  chonDieuChoLoiNhac,
  laTinVoNghia,
  KHIA_CANH,
  KHIA_CANH_KEYS,
  type KetQuaAiHieuAnh,
  type KhiaCanh,
  type MucHieuAnh,
} from '../lib/hieuAnh.js';
import { cheSoDai } from '../lib/docAi.js';
import { xoaLienHe } from '../lib/brainGate.js';

/** Học bù câu anh nói với trợ lý trong chừng này ngày (lần đầu). Tin Zalo: những gì còn lưu (~30 ngày). */
const NGAY_CHAT = 90;
/** Học mỗi lượt cách nhau ít nhất — đỡ tốn lượt AI (cron gọi mỗi phút). */
const CACH_LUOT_MS = 30 * 60_000;
const DOAN_TOI_DA = 14_000;

const KHOA = 'hoc';
const MOC = 'lan_hoc_cuoi';

async function giamDoc() {
  const gd = (await getDirectors())[0];
  const ten = gd?.fullName || 'Giám đốc';
  return { id: gd?.id || '', ten, goi: `anh ${ten.trim().split(/\s+/).pop() || ''}`.trim() };
}

const tuLucChat = () => nowTz().subtract(NGAY_CHAT, 'day').toISOString();
const sach = (s: string, n: number) => xoaLienHe(cheSoDai(String(s || '').replace(/\s+/g, ' ').trim())).text.slice(0, n);

const SCHEMA = {
  type: 'OBJECT',
  properties: {
    moi: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: {
          khiaCanh: { type: 'STRING', enum: KHIA_CANH_KEYS },
          noiDung: { type: 'STRING' },
          doiTuong: { type: 'STRING' },
          bangChung: { type: 'STRING' },
        },
        required: ['khiaCanh', 'noiDung'],
      },
    },
    xacNhan: {
      type: 'ARRAY',
      items: {
        type: 'OBJECT',
        properties: { id: { type: 'STRING' }, bangChung: { type: 'STRING' }, noiDungMoi: { type: 'STRING' } },
        required: ['id'],
      },
    },
  },
  required: ['moi', 'xacNhan'],
};

export function loiNhacHoc(o: { goi: string; hoSo: MucHieuAnh[]; zalo: string; chat: string }): string {
  const Goi = o.goi.charAt(0).toUpperCase() + o.goi.slice(1);
  return [
    `Bạn đang xây HỒ SƠ HIỂU ${o.goi.toUpperCase()} — giám đốc agency marketing MT Digital — để trợ lý AI làm việc đúng ý,`,
    `đúng giọng ${o.goi}. Dưới đây là các đoạn chat công việc: dòng "ANH:" là ${o.goi} nói, các dòng khác chỉ là NGỮ CẢNH.`,
    '',
    `Rút ra những điều BỀN VỮNG về CHÍNH ${o.goi.toUpperCase()} (không phải về khách, không phải việc lặt vặt một lần):`,
    ...KHIA_CANH_KEYS.map((k) => `- ${k}: ${KHIA_CANH[k]}`),
    '',
    'QUY TẮC:',
    `- Chỉ ghi điều thấy RÕ từ lời ${o.goi} (dòng ANH). Đoán mò, chuyện một lần (hẹn gặp, gửi file, nhắc việc) thì BỎ.`,
    `- noiDung: MỘT câu tiếng Việt bắt đầu bằng "${Goi}", ≤ 30 chữ, áp dụng được cho lần sau (vd "${Goi} không nhận`,
    '  gói SEO dưới 6 tháng", "' + Goi + ' xưng anh – em với khách, trả lời ngắn, chốt việc ngay").',
    '- khiaCanh "nguoi": cách anh làm việc với MỘT người / khách cụ thể → ghi doiTuong = tên người / khách đó.',
    '- bangChung: trích NGẮN (≤ 20 chữ) đúng lời anh trong đoạn chat. KHÔNG chép số điện thoại / số tài khoản.',
    '- Điều đã có trong HỒ SƠ HIỆN CÓ (dưới) mà đoạn chat lại cho thấy → đưa vào xacNhan với id (+ bangChung mới;',
    '  noiDungMoi chỉ khi cần viết lại cho đúng hơn). KHÔNG thêm "moi" trùng ý điều đã có.',
    '- Tối đa 8 điều mới mỗi lượt; không có gì đáng ghi thì trả hai danh sách rỗng.',
    '',
    'HỒ SƠ HIỆN CÓ:',
    o.hoSo.length
      ? o.hoSo
          .filter((m) => m.trangThai !== 'anh_bo')
          .slice(0, 120)
          .map((m) => `[${m.id}] (${m.khiaCanh}${m.doiTuong ? ` · ${m.doiTuong}` : ''}) ${m.noiDung}`)
          .join('\n')
      : '(chưa có)',
    o.zalo ? `\nĐOẠN CHAT ZALO:\n${o.zalo}` : '',
    o.chat ? `\nANH NÓI VỚI TRỢ LÝ AI (dòng "Trợ lý:" là câu trả lời trước đó của trợ lý — anh có thể đang sửa nó):\n${o.chat}` : '',
  ].join('\n');
}

export interface KetQuaHoc {
  chay: boolean;
  tinZalo: number;
  cauChat: number;
  moi: number;
  xacNhan: number;
  ghiChu: string;
}

/**
 * Một lượt học (gọi từ chuỗi cron mỗi phút, tự giãn ≥ 30 phút / lượt; `epNgay` = anh bấm "Học ngay"). Gom tin Zalo
 * của anh + câu anh nói với trợ lý thành MỘT lần gọi AI. AI lỗi → không đánh dấu, lượt sau học lại.
 */
export async function hocVeAnh(han: number, o: { epNgay?: boolean } = {}): Promise<KetQuaHoc> {
  const kq: KetQuaHoc = { chay: false, tinZalo: 0, cauChat: 0, moi: 0, xacNhan: 0, ghiChu: '' };
  if (!o.epNgay && Date.now() - (await docMoc(MOC).catch(() => Date.now())) < CACH_LUOT_MS) return { ...kq, ghiChu: 'chưa tới lượt' };
  const { aiAvailable } = await import('../ai/index.js');
  if (!(await aiAvailable())) return { ...kq, ghiChu: 'chưa bật AI' };
  if (!(await layKhoa(KHOA, 5 * 60_000))) return { ...kq, ghiChu: 'lượt khác đang học' };
  try {
    const gd = await giamDoc();
    // Zalo: gom đoạn từ các cuộc có tin anh chưa học (tin cũ nhất trước).
    const phanZalo: string[] = [];
    const idZalo: string[] = [];
    let dai = 0;
    for (const c of await cuocCoTinAnhChuaHoc(15)) {
      if (Date.now() > han - 60_000 || dai > DOAN_TOI_DA) break;
      const chuaHoc = await idTinAnhChuaHoc(c.threadId);
      const r = chonDoanHoc(await tinGanDay(c.threadId, 300), chuaHoc);
      // Tin quá cũ đã trôi khỏi 300 tin gần nhất: vẫn đánh dấu để không kẹt.
      for (const id of chuaHoc) if (!r.msgIds.includes(id)) r.msgIds.push(id);
      idZalo.push(...r.msgIds);
      if (!r.doan) continue;
      const doan = r.doan.slice(-(DOAN_TOI_DA - dai));
      phanZalo.push(`### ${c.isGroup ? 'Nhóm' : 'Chat'} «${c.name || c.customer || 'không tên'}»${c.customer ? ` (khách ${c.customer})` : ''}\n${doan}`);
      dai += doan.length;
    }
    // Chat trợ lý: câu anh nói (bỏ câu vô nghĩa), kèm câu trả lời ngay trước của trợ lý.
    const cau = gd.id ? await chatAnhChuaHoc(gd.id, tuLucChat(), 40) : [];
    const phanChat = cau
      .filter((c) => !laTinVoNghia(c.text))
      .map((c) => `${c.truoc ? `Trợ lý: ${sach(c.truoc, 300)}\n` : ''}ANH: ${sach(c.text, 600)}`)
      .join('\n…\n')
      .slice(0, 8000);
    kq.tinZalo = idZalo.length;
    kq.cauChat = cau.length;
    if (!phanZalo.length && !phanChat) {
      await danhDauHocZalo(idZalo);
      await danhDauHocChat(cau.map((c) => c.id));
      await ghiMoc(MOC, Date.now());
      return { ...kq, ghiChu: idZalo.length || cau.length ? 'chỉ toàn tin ngắn, không có gì để học' : 'không có tin mới' };
    }
    const hoSo = await dsHieuAnh();
    const { aiKhoJson } = await import('../ai/brainAi.js');
    const ai = (await aiKhoJson(loiNhacHoc({ goi: gd.goi, hoSo, zalo: phanZalo.join('\n\n'), chat: phanChat }), SCHEMA)) as KetQuaAiHieuAnh;
    const gop = gopHieuAnh(hoSo, { moi: Array.isArray(ai?.moi) ? ai.moi : [], xacNhan: Array.isArray(ai?.xacNhan) ? ai.xacNhan : [] });
    const luc = nowTz().toISOString();
    if (gop.them.length) await themHieuAnh(gop.them, phanZalo.length ? 'zalo' : 'chat', luc);
    if (gop.sua.length) await suaHieuAnhAi(gop.sua, luc);
    await danhDauHocZalo(idZalo);
    await danhDauHocChat(cau.map((c) => c.id));
    await ghiMoc(MOC, Date.now());
    return { ...kq, chay: true, moi: gop.them.length, xacNhan: gop.sua.length, ghiChu: `học ${idZalo.length} tin Zalo + ${cau.length} câu chat` };
  } finally {
    await thaKhoa(KHOA).catch(() => undefined);
  }
}

/** Đoạn "những điều em hiểu về anh" chèn vào lời dặn trợ lý của giám đốc. '' nếu chưa có / bảng chưa tạo. */
export async function loiNhacHieuAnh(cauHoi: string): Promise<string> {
  try {
    return chonDieuChoLoiNhac(await dsHieuAnh(), { toiDa: 30, cauHoi });
  } catch {
    return '';
  }
}

/** Anh dạy trực tiếp (trên trang hoặc nói với trợ lý "nhớ là anh…"). Trùng ý điều đã có thì chỉ xác nhận. */
export async function anhDay(o: { noiDung: string; khiaCanh?: string; doiTuong?: string }): Promise<{ ok: boolean; message: string }> {
  const noiDung = String(o.noiDung || '').trim().slice(0, 300);
  if (noiDung.length < 8) return { ok: false, message: 'CHƯA GHI: nội dung quá ngắn.' };
  const khiaCanh = ((KHIA_CANH_KEYS as string[]).includes(String(o.khiaCanh)) ? o.khiaCanh : 'nguyen_tac') as KhiaCanh;
  const hoSo = await dsHieuAnh();
  const gop = gopHieuAnh(hoSo, { moi: [{ khiaCanh, noiDung, doiTuong: o.doiTuong }], xacNhan: [] });
  const luc = nowTz().toISOString();
  if (gop.sua.length) {
    await suaHieuAnhAi(gop.sua, luc);
    return { ok: true, message: `ĐÃ GHI NHỚ (trùng ý điều em đã biết — đã đánh dấu thêm một lần): "${noiDung}"` };
  }
  if (!gop.them.length) return { ok: false, message: 'CHƯA GHI: điều này anh đã bỏ trước đây (vào Kho tri thức → Hiểu anh để khôi phục).' };
  await themHieuAnh(gop.them, 'anh_day', luc, 'anh_sua');
  return { ok: true, message: `ĐÃ GHI NHỚ về anh [${KHIA_CANH[khiaCanh]}]: "${noiDung}"` };
}

/** Số liệu cho tab "Hiểu anh". */
export async function tinhTrangHoc(): Promise<{ tinZaloCho: number; cauChatCho: number; lanHocCuoi: number }> {
  const gd = await giamDoc();
  const [tinZaloCho, cauChatCho, lanHocCuoi] = await Promise.all([
    demTinAnhChuaHoc().catch(() => 0),
    gd.id ? demChatAnhChuaHoc(gd.id, tuLucChat()).catch(() => 0) : 0,
    docMoc(MOC).catch(() => 0),
  ]);
  return { tinZaloCho, cauChatCho, lanHocCuoi };
}
