// Công cụ trợ lý đọc mục KẾ TOÁN THUẾ (sao kê ngân hàng, hoá đơn, lãi lỗ, VAT, TNDN, công nợ theo sao kê). Anh Tâm
// 10/11/2026: "Anh cần bộ não nắm, hiểu toàn bộ phần mềm, những thông tin nhạy cảm về tài chính thì chỉ có anh, giám đốc
// hỏi được thôi". CHỈ gắn cho trợ lý của role 'director' (assistant.service.ts) — nhân viên / admin không có các hàm này.
import type { ToolDef } from './assistant.service.js';
import { locGiaoDich, vanBanGiaoDich, locHoaDon, vanBanHoaDon } from '../lib/keToanTraCuu.js';
import { nowTz } from '../lib/datetime.js';

const vnd = (n: number) => `${Math.round(n).toLocaleString('vi-VN')}đ`;
const ngay = (s: unknown) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : '');

export function keToanTools(): ToolDef[] {
  return [
    {
      declaration: {
        name: 'tra_sao_ke',
        description:
          'Tra SAO KÊ NGÂN HÀNG đã tải lên ở mục Kế toán thuế: khách / công ty nào đã chuyển tiền chưa, chuyển bao nhiêu, ' +
          'ngày nào; công ty đã chi cho ai. Tìm theo tên công ty / người chuyển / nội dung chuyển khoản (không cần dấu) ' +
          'hoặc số tiền. Tên khách có thể khác tên trên sao kê (tên pháp nhân) — tìm thêm theo tên công ty trên hoá đơn ' +
          '(tra_hoa_don) nếu tìm theo tên thương hiệu không ra.',
        parameters: {
          type: 'OBJECT',
          properties: {
            tim: { type: 'STRING', description: 'Tên / từ khoá / số tiền (vd "Sagotool", "giai phap moi", "5.500.000"). Bỏ trống = mọi giao dịch.' },
            loai: { type: 'STRING', enum: ['', 'vao', 'ra'], description: 'vao = tiền vào, ra = tiền ra.' },
            tuNgay: { type: 'STRING', description: 'YYYY-MM-DD' },
            denNgay: { type: 'STRING', description: 'YYYY-MM-DD' },
          },
        },
      },
      run: async (a) => {
        const { tatCaGiaoDich } = await import('./keToan.repo.js');
        const ds = await tatCaGiaoDich().catch(() => []);
        if (!ds.length) return 'Chưa có sao kê nào được tải lên ở mục Kế toán thuế.';
        const loai = a.loai === 'vao' || a.loai === 'ra' ? a.loai : '';
        const kq = locGiaoDich(ds, { tim: String(a.tim || ''), loai, tuNgay: ngay(a.tuNgay), denNgay: ngay(a.denNgay) });
        const cuoi = ds.map((g) => g.ngay).sort().pop();
        return `${vanBanGiaoDich(kq, 40)}\n(Sao kê đã tải tới ngày ${cuoi}.)`;
      },
    },
    {
      declaration: {
        name: 'tra_hoa_don',
        description:
          'Tra HOÁ ĐƠN điện tử (bán ra / mua vào) ở mục Kế toán thuế theo tên công ty, MST, số hoá đơn hoặc số tiền. ' +
          'Dùng để biết tên pháp nhân của khách (rồi tra_sao_ke theo tên đó), đã xuất hoá đơn gì, bao nhiêu.',
        parameters: {
          type: 'OBJECT',
          properties: {
            tim: { type: 'STRING', description: 'Tên công ty / MST / số hoá đơn / số tiền.' },
            huong: { type: 'STRING', enum: ['', 'ra', 'vao'], description: 'ra = bán ra, vao = mua vào.' },
            tuNgay: { type: 'STRING', description: 'YYYY-MM-DD' },
            denNgay: { type: 'STRING', description: 'YYYY-MM-DD' },
          },
        },
      },
      run: async (a) => {
        const { tatCaHoaDon } = await import('./keToan.repo.js');
        const ds = await tatCaHoaDon().catch(() => []);
        if (!ds.length) return 'Chưa có hoá đơn nào ở mục Kế toán thuế.';
        const huong = a.huong === 'ra' || a.huong === 'vao' ? a.huong : '';
        return vanBanHoaDon(locHoaDon(ds, { tim: String(a.tim || ''), huong, tuNgay: ngay(a.tuNgay), denNgay: ngay(a.denNgay) }), 40);
      },
    },
    {
      declaration: {
        name: 'get_ke_toan_thue',
        description:
          'TỔNG QUAN KẾ TOÁN THUẾ một năm: lãi lỗ theo tháng (hoá đơn ra − vào − lương BHXH − nhà thầu nước ngoài − thuê ' +
          'nhà), VAT từng quý (phải nộp, hạn), thuế TNDN, công nợ phải thu / phải trả theo sao kê (ai còn nợ bao nhiêu).',
        parameters: {
          type: 'OBJECT',
          properties: { nam: { type: 'INTEGER', description: 'Năm. Bỏ trống = năm nay.' } },
        },
      },
      run: async (a) => {
        const { tongQuan } = await import('./keToan.service.js');
        const nam = Number(a.nam) || Number(nowTz().format('YYYY'));
        const t = await tongQuan(nam);
        if (!t.coDuLieu) return `Chưa có dữ liệu kế toán thuế năm ${nam}.`;
        const ll = t.laiLo.filter((x) => x.doanhThu || x.hdVao || x.luongBhxh || x.nhaThauNN || x.thueNha);
        const cong = (k: 'doanhThu' | 'hdVao' | 'luongBhxh' | 'nhaThauNN' | 'thueNha' | 'laiLo') => ll.reduce((s, x) => s + x[k], 0);
        const no = (loai: 'thu' | 'tra') =>
          t.congNoSaoKe[loai].ds
            .filter((d) => d.con > 1000)
            .sort((x, y) => y.con - x.con)
            .slice(0, 15)
            .map((d) => `  - ${d.ten}: còn ${vnd(d.con)} (hoá đơn ${vnd(d.hoaDon)}, đã ${loai === 'thu' ? 'thu' : 'trả'} ${vnd(d.daTra)})`);
        return [
          `KẾ TOÁN THUẾ NĂM ${nam} (hôm nay ${t.homNay})`,
          'LÃI LỖ THEO THÁNG (hoá đơn ra − vào − lương+BHXH − nhà thầu NN − thuê nhà):',
          ...ll.map(
            (x) =>
              `  ${x.thang}: ra ${vnd(x.doanhThu)}, vào ${vnd(x.hdVao)}, lương ${vnd(x.luongBhxh)}, NTNN ${vnd(x.nhaThauNN)}, thuê nhà ${vnd(x.thueNha)} → ${x.laiLo >= 0 ? 'LÃI' : 'LỖ'} ${vnd(Math.abs(x.laiLo))}`,
          ),
          `  Cộng: ra ${vnd(cong('doanhThu'))}, vào ${vnd(cong('hdVao'))}, lương ${vnd(cong('luongBhxh'))} → ${cong('laiLo') >= 0 ? 'LÃI' : 'LỖ'} ${vnd(Math.abs(cong('laiLo')))}`,
          'VAT THEO QUÝ:',
          ...t.vat.map((v) => `  ${v.ky}: đầu ra ${vnd(v.dauRa)}, đầu vào ${vnd(v.dauVao)} → phải nộp ${vnd(v.phaiNop)} (hạn ${v.hanNop}, ${v.nguon === 'to_khai' ? 'theo tờ khai' : 'ước tính'})`),
          'TNDN:',
          ...t.tndn.map((x) => `  ${x.nam}: lợi nhuận tính thuế ${vnd(x.loiNhuan)} → ${x.mien ? 'được miễn' : `thuế ${vnd(x.thueNeuKhongMien)}`}`),
          `CÔNG NỢ PHẢI THU theo sao kê (từ ${t.congNoSaoKe.thu.tuNgay || '—'}):`,
          ...(no('thu').length ? no('thu') : ['  (không ai còn nợ)']),
          `  ${t.congNoSaoKe.thu.soChuaKhop} khoản tiền vào chưa khớp được khách.`,
          'CÔNG NỢ PHẢI TRẢ theo sao kê:',
          ...(no('tra').length ? no('tra') : ['  (không còn nợ ai)']),
        ].join('\n');
      },
    },
  ];
}
