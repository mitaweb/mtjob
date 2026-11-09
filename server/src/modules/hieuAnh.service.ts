// Bộ não HIỂU ANH TÂM (anh Tâm 9/11/2026: "bộ não hiện tại phải hiểu được anh thông qua các đoạn chat của anh với nhân
// viên và khách hàng"; "tự căn cứ vào các dữ liệu hiện tại đã có, xác định nhân viên, khách hàng để tìm kết luận, cách
// làm việc, anh cần nhân sự hiểu được anh cần gì, làm gì ở 1 job, 1 khách hàng nào đó thông qua tất cả thông tin trong
// zalo của anh"; "không tách tab, không bấm nút, kho tri thức oke rồi").
//
// TỰ CHẠY trong chuỗi cron: AI đọc tin ANH gửi trên Zalo (cuộc công việc, kèm ngữ cảnh), câu anh nói với trợ lý, và tri
// thức đã rút từ Zalo trước đây trong kho → kết luận anh cần gì với từng KHÁCH, ở từng loại VIỆC, cách anh làm việc
// chung → ghi vào bảng hieu_anh rồi tự gom thành mục KHO TRI THỨC (nhân sự tra qua trợ lý). Anh sửa / lưu trữ mục kho
// thì phần này không ghi đè.
import { createHash } from 'node:crypto';
import { nowTz } from '../lib/datetime.js';
import { tinGanDay } from './zalo.repo.js';
import { getDirectors, getActiveMembers } from './members.repo.js';
import {
  dsHieuAnh,
  themHieuAnh,
  suaHieuAnhAi,
  cuocCoTinAnhChuaHoc,
  idTinAnhChuaHoc,
  danhDauHocZalo,
  chatAnhChuaHoc,
  danhDauHocChat,
  khoChuaHoc,
  layKhoa,
  thaKhoa,
  docMoc,
  ghiMoc,
  demTinAnhChuaHoc,
} from './hieuAnh.repo.js';
import {
  chonDoanHoc,
  gopHieuAnh,
  chonDieuChoLoiNhac,
  baiKhoHieuAnh,
  laTinVoNghia,
  KHIA_CANH,
  KHIA_CANH_KEYS,
  PHAM_VI_KEYS,
  type KetQuaAiHieuAnh,
  type KhiaCanh,
  type MucHieuAnh,
  type NguonHieuAnh,
} from '../lib/hieuAnh.js';
import { cheSoDai } from '../lib/docAi.js';
import { xoaLienHe, khopKhach } from '../lib/brainGate.js';

/** Học bù câu anh nói với trợ lý trong chừng này ngày. Tin Zalo: những gì còn lưu (~30 ngày); cũ hơn: đọc từ kho. */
const NGAY_CHAT = 90;
/** Hết việc tồn thì giãn 30 phút / lượt; còn tồn (lần đầu học bù) thì 2 phút / lượt cho mau kịp. */
const CACH_LUOT_MS = 30 * 60_000;
const CACH_LUOT_BU_MS = 2 * 60_000;
const DOAN_TOI_DA = 14_000;

const KHOA = 'hoc';
/** Mốc: lần học kế tiếp sớm nhất (ms) */
const MOC = 'lan_hoc_sau';
/** Mốc: đã đọc mục kho cập nhật tới lúc nào (ms) */
const MOC_KHO = 'kho_toi';

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
          phamVi: { type: 'STRING', enum: PHAM_VI_KEYS },
          doiTuong: { type: 'STRING' },
          khiaCanh: { type: 'STRING', enum: KHIA_CANH_KEYS },
          noiDung: { type: 'STRING' },
          bangChung: { type: 'STRING' },
        },
        required: ['phamVi', 'khiaCanh', 'noiDung'],
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

export function loiNhacHoc(o: { goi: string; nhanSu: string[]; viec: string[]; hoSo: MucHieuAnh[]; zalo: string; chat: string; kho: string }): string {
  const Goi = o.goi.charAt(0).toUpperCase() + o.goi.slice(1);
  return [
    `Bạn giúp NHÂN SỰ agency marketing MT Digital hiểu giám đốc (${o.goi}) CẦN GÌ: với từng khách hàng, ở từng loại việc,`,
    `và cách ${o.goi} làm việc. Đọc dữ liệu dưới đây (chat Zalo công việc: dòng "ANH:" là ${o.goi}, dòng khác là ngữ cảnh;`,
    `câu ${o.goi} nói với trợ lý AI; tri thức đã rút từ Zalo trước đây) rồi KẾT LUẬN.`,
    '',
    `NHÂN SỰ MT DIGITAL (người trong công ty — KHÔNG phải khách): ${o.nhanSu.slice(0, 80).join(', ') || '(không có)'}.`,
    'Người không có trong danh sách mà xưng "em" báo cáo / nhận việc / gửi bài cho anh duyệt cũng là nhân sự. Còn lại',
    'là khách hàng (tên doanh nghiệp / thương hiệu, không phải tên người nhắn), đối tác, nhà cung cấp.',
    o.viec.length ? `CÁC LOẠI VIỆC CỦA CÔNG TY (dùng đúng tên khi điều nói về một loại việc): ${o.viec.slice(0, 120).join('; ')}.` : '',
    '',
    'MỖI ĐIỀU có phamVi:',
    `- "khach": ${o.goi} cần gì / dặn gì khi làm cho MỘT khách — doiTuong = TÊN KHÁCH (doanh nghiệp). Vd yêu cầu, tiêu`,
    '  chuẩn, người duyệt, giờ duyệt, điều khách không thích, cách xử lý khách, phạm vi đã chốt.',
    `- "viec": ${o.goi} cần gì ở MỘT loại việc (lên Ads, báo cáo Ads, thiết kế, viết bài, quay dựng, SEO, báo giá…) —`,
    '  doiTuong = tên việc (theo danh sách trên nếu có). Vd báo cáo phải có gì, quy trình, hạn, tiêu chuẩn chất lượng.',
    `- "chung": cách ${o.goi} làm việc nói chung (doiTuong = "").`,
    `- "nguoi": cách ${o.goi} làm việc với MỘT nhân viên cụ thể — doiTuong = tên nhân viên.`,
    'khiaCanh: ' + KHIA_CANH_KEYS.map((k) => `${k} = ${KHIA_CANH[k]}`).join('; ') + '.',
    '',
    'QUY TẮC:',
    `- Chỉ ghi điều thấy RÕ từ lời ${o.goi} / tri thức đã có; không đoán mò. Bỏ việc lặt vặt một lần (hẹn gặp, gửi file,`,
    '  nhắc việc có hạn) — chỉ giữ điều DÙNG LẠI ĐƯỢC cho lần sau.',
    `- noiDung: MỘT câu tiếng Việt ≤ 35 chữ, viết như LỜI DẶN cho nhân sự (vd khach: "Bài đăng phải gửi chị Hồng duyệt`,
    `  trước 10h, ${o.goi} không cho đăng khi chưa duyệt"; viec: "Báo cáo Ads phải so sánh tuần trước và có đề xuất";`,
    `  chung: "${Goi} muốn báo xong việc ngay trong ngày").`,
    '- bangChung: trích NGẮN (≤ 20 chữ) đúng lời trong dữ liệu. KHÔNG chép số điện thoại / số tài khoản / mật khẩu.',
    '- Điều đã có trong HỒ SƠ HIỆN CÓ mà dữ liệu lại cho thấy → xacNhan với id (+ bangChung mới; noiDungMoi chỉ khi cần',
    '  viết lại cho đúng / đủ hơn). KHÔNG thêm "moi" trùng ý điều đã có cho cùng khách / việc.',
    '- Tối đa 15 điều mới mỗi lượt; không có gì đáng ghi thì trả hai danh sách rỗng.',
    '',
    'HỒ SƠ HIỆN CÓ:',
    o.hoSo.length
      ? o.hoSo
          .filter((m) => m.trangThai !== 'anh_bo')
          .slice(0, 150)
          .map((m) => `[${m.id}] (${m.phamVi}${m.doiTuong ? `: ${m.doiTuong}` : ''} · ${m.khiaCanh}) ${m.noiDung}`)
          .join('\n')
      : '(chưa có)',
    o.zalo ? `\nCHAT ZALO:\n${o.zalo}` : '',
    o.chat ? `\n${o.goi.toUpperCase()} NÓI VỚI TRỢ LÝ AI (dòng "Trợ lý:" là câu trả lời trước đó — anh có thể đang sửa nó):\n${o.chat}` : '',
    o.kho ? `\nTRI THỨC ĐÃ RÚT TỪ ZALO TRƯỚC ĐÂY (trong kho):\n${o.kho}` : '',
  ]
    .filter((d) => d !== '')
    .join('\n');
}

export interface KetQuaHoc {
  chay: boolean;
  tinZalo: number;
  cauChat: number;
  mucKho: number;
  moi: number;
  xacNhan: number;
  ghiChu: string;
}

/**
 * Một lượt học (chuỗi cron mỗi phút; tự giãn). Gom tin Zalo của anh + câu anh nói với trợ lý + mục kho cũ thành MỘT
 * lần gọi AI. AI lỗi → không đánh dấu, lượt sau học lại. Học xong → cập nhật mục kho tri thức.
 */
export async function hocVeAnh(han: number): Promise<KetQuaHoc> {
  const kq: KetQuaHoc = { chay: false, tinZalo: 0, cauChat: 0, mucKho: 0, moi: 0, xacNhan: 0, ghiChu: '' };
  if (Date.now() < (await docMoc(MOC).catch(() => Number.MAX_SAFE_INTEGER))) return { ...kq, ghiChu: 'chưa tới lượt' };
  const { aiAvailable } = await import('../ai/index.js');
  if (!(await aiAvailable())) return { ...kq, ghiChu: 'chưa bật AI' };
  if (!(await layKhoa(KHOA, 5 * 60_000))) return { ...kq, ghiChu: 'lượt khác đang học' };
  try {
    const gd = await giamDoc();
    // 1) Zalo: các cuộc có tin anh chưa học (tin cũ nhất trước).
    const phanZalo: string[] = [];
    const idZalo: string[] = [];
    let dai = 0;
    for (const c of await cuocCoTinAnhChuaHoc(15)) {
      if (Date.now() > han - 60_000 || dai > DOAN_TOI_DA) break;
      const chuaHoc = await idTinAnhChuaHoc(c.threadId);
      const r = chonDoanHoc(await tinGanDay(c.threadId, 300), chuaHoc);
      for (const id of chuaHoc) if (!r.msgIds.includes(id)) r.msgIds.push(id);
      idZalo.push(...r.msgIds);
      if (!r.doan) continue;
      const doan = r.doan.slice(-(DOAN_TOI_DA - dai));
      phanZalo.push(`### ${c.isGroup ? 'Nhóm' : 'Chat 1-1'} «${c.name || c.customer || 'không tên'}»${c.customer ? ` (đã gắn khách ${c.customer})` : ''}\n${doan}`);
      dai += doan.length;
    }
    // 2) Câu anh nói với trợ lý, kèm câu trả lời ngay trước.
    const cau = gd.id ? await chatAnhChuaHoc(gd.id, tuLucChat(), 40) : [];
    const phanChat = cau
      .filter((c) => !laTinVoNghia(c.text))
      .map((c) => `${c.truoc ? `Trợ lý: ${sach(c.truoc, 300)}\n` : ''}ANH: ${sach(c.text, 600)}`)
      .join('\n…\n')
      .slice(0, 8000);
    // 3) Tri thức Zalo cũ trong kho (học bù dần theo mốc cập nhật).
    const mocKho = await docMoc(MOC_KHO);
    const kho = gd.id ? await khoChuaHoc(gd.id, mocKho || 0, 40) : [];
    const phanKho = kho
      .map((m) => `- ${m.customer ? `[khách ${m.customer}] ` : ''}${sach(m.title, 150)}: ${sach(m.body, 600)}`)
      .join('\n')
      .slice(0, 12_000);
    kq.tinZalo = idZalo.length;
    kq.cauChat = cau.length;
    kq.mucKho = kho.length;
    const xong = async () => {
      await danhDauHocZalo(idZalo);
      await danhDauHocChat(cau.map((c) => c.id));
      const cuoi = kho.length ? Date.parse(kho[kho.length - 1]!.updatedAt) : 0;
      if (cuoi > mocKho) await ghiMoc(MOC_KHO, cuoi);
      // Còn tồn (lần đầu học bù) → lượt sau sớm; hết → giãn 30 phút.
      const conTon = idZalo.length >= 1 && (await demTinAnhChuaHoc().catch(() => 0)) > 0;
      await ghiMoc(MOC, Date.now() + (conTon || kho.length >= 40 || cau.length >= 40 ? CACH_LUOT_BU_MS : CACH_LUOT_MS));
    };
    if (!phanZalo.length && !phanChat && !phanKho) {
      await xong();
      return { ...kq, ghiChu: idZalo.length || cau.length ? 'chỉ toàn tin ngắn, không có gì để học' : 'không có gì mới' };
    }
    const [hoSo, nhanSu, viec] = await Promise.all([
      dsHieuAnh(),
      getActiveMembers().then((ds) => ds.map((m) => `${m.fullName}${m.teamId ? ` (${m.teamId})` : ''}`)).catch(() => [] as string[]),
      import('./catalog.repo.js').then((m) => m.getActiveCatalog()).then((ds) => [...new Set(ds.map((x) => x.name))]).catch(() => [] as string[]),
    ]);
    const { aiKhoJson } = await import('../ai/brainAi.js');
    const ai = (await aiKhoJson(loiNhacHoc({ goi: gd.goi, nhanSu, viec, hoSo, zalo: phanZalo.join('\n\n'), chat: phanChat, kho: phanKho }), SCHEMA)) as KetQuaAiHieuAnh;
    const gop = gopHieuAnh(hoSo, { moi: Array.isArray(ai?.moi) ? ai.moi : [], xacNhan: Array.isArray(ai?.xacNhan) ? ai.xacNhan : [] });
    const luc = nowTz().toISOString();
    const nguon: NguonHieuAnh = phanZalo.length ? 'zalo' : phanChat ? 'chat' : 'kho';
    if (gop.them.length) await themHieuAnh(gop.them, nguon, luc);
    if (gop.sua.length) await suaHieuAnhAi(gop.sua, luc);
    await xong();
    if (gop.them.length || gop.sua.length) await dongBoKho(gd.goi).catch((e) => console.warn('[hieu-anh] ghi kho:', (e as Error).message));
    return {
      ...kq,
      chay: true,
      moi: gop.them.length,
      xacNhan: gop.sua.length,
      ghiChu: `học ${idZalo.length} tin Zalo + ${cau.length} câu chat + ${kho.length} mục kho`,
    };
  } finally {
    await thaKhoa(KHOA).catch(() => undefined);
  }
}

const dauVet = (body: string) => `hieu_anh:${createHash('sha1').update(body).digest('hex').slice(0, 16)}`;

/**
 * Gom hồ sơ thành mục kho tri thức (mỗi khách / mỗi loại việc / mỗi khía cạnh chung một mục, mã cố định). Anh đã lưu
 * trữ / từ chối mục → bỏ qua; anh đã SỬA nội dung mục (khác bản phần này ghi lần trước) → không ghi đè.
 */
export async function dongBoKho(goi?: string): Promise<number> {
  const [{ findItem, upsertItem }, { dongBoDoan }, { getCustomers }] = await Promise.all([
    import('./brainItems.repo.js'),
    import('./brainItems.service.js'),
    import('./crm.repo.js'),
  ]);
  const ds = await dsHieuAnh();
  const khach = await getCustomers().catch(() => []);
  const luc = nowTz().toISOString();
  let n = 0;
  for (const b of baiKhoHieuAnh(ds, goi || (await giamDoc()).goi)) {
    const id = `HA-${createHash('sha1').update(b.khoa).digest('hex').slice(0, 16)}`;
    const cu = await findItem(id);
    if (cu && (cu.status === 'archived' || cu.status === 'rejected')) continue;
    if (cu && cu.aiReason !== dauVet(cu.body)) continue; // anh đã tự sửa mục này
    if (cu && cu.body === b.body && cu.title === b.title) continue;
    const kh = b.customer ? khopKhach(b.customer, khach) : null;
    const item = {
      id,
      title: b.title,
      body: b.body,
      summary: b.summary,
      category: b.category,
      customerId: kh?.id || '',
      customer: kh?.name || b.customer,
      teamId: '',
      tags: ['hiểu anh', b.category === 'khach_hang' ? 'yêu cầu khách' : 'cách làm việc'],
      scope: b.scope,
      status: 'published' as const,
      source: 'hieu_anh',
      submittedBy: '',
      submittedName: 'AI tự học từ Zalo của anh',
      approvedBy: '',
      aiReason: dauVet(b.body),
      createdAt: cu?.createdAt || luc,
      updatedAt: luc,
    };
    await upsertItem(item);
    await dongBoDoan(item).catch(() => undefined);
    n++;
  }
  return n;
}

/** Đoạn "những điều em hiểu về anh" chèn vào lời dặn trợ lý của giám đốc. '' nếu chưa có / bảng chưa tạo. */
export async function loiNhacHieuAnh(cauHoi: string): Promise<string> {
  try {
    return chonDieuChoLoiNhac(await dsHieuAnh(), { toiDa: 30, cauHoi });
  } catch {
    return '';
  }
}

/** Anh dạy trực tiếp qua trợ lý ("nhớ là anh…"). Trùng ý điều đã có thì chỉ xác nhận. */
export async function anhDay(o: { noiDung: string; khiaCanh?: string; phamVi?: string; doiTuong?: string }): Promise<{ ok: boolean; message: string }> {
  const noiDung = String(o.noiDung || '').trim().slice(0, 300);
  if (noiDung.length < 8) return { ok: false, message: 'CHƯA GHI: nội dung quá ngắn.' };
  const khiaCanh = ((KHIA_CANH_KEYS as string[]).includes(String(o.khiaCanh)) ? o.khiaCanh : 'nguyen_tac') as KhiaCanh;
  const hoSo = await dsHieuAnh();
  const gop = gopHieuAnh(hoSo, { moi: [{ phamVi: o.phamVi, khiaCanh, noiDung, doiTuong: o.doiTuong }], xacNhan: [] });
  const luc = nowTz().toISOString();
  if (gop.sua.length) {
    await suaHieuAnhAi(gop.sua, luc);
    return { ok: true, message: `ĐÃ GHI NHỚ (trùng ý điều em đã biết — đánh dấu thêm một lần): "${noiDung}"` };
  }
  if (!gop.them.length) return { ok: false, message: 'CHƯA GHI: điều này anh đã bỏ trước đây.' };
  await themHieuAnh(gop.them, 'anh_day', luc, 'anh_sua');
  await dongBoKho().catch(() => 0);
  const t = gop.them[0]!;
  return { ok: true, message: `ĐÃ GHI NHỚ${t.phamVi !== 'chung' ? ` (${t.phamVi === 'khach' ? 'khách' : t.phamVi === 'viec' ? 'việc' : 'nhân viên'} ${t.doiTuong})` : ''}: "${noiDung}" — nhân sự tra được trong kho tri thức.` };
}
