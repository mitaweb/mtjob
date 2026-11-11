// Trợ lý giám đốc đọc số Meta Ads trực tiếp (anh Tâm 11/11/2026). MCP chính thức của Meta có ~100 công cụ — trợ lý
// hay hết lượt khi còn dò tên / tham số. Hai công cụ gọn dưới đây gọi thẳng Graph API, CHỈ ĐỌC.
import type { ToolDef } from './assistant.service.js';
import { dsKetNoi, metaTaiSan, metaChienDich } from './ketNoi.service.js';
import { tomTatMetaChienDich } from '../lib/nenTang.js';
import { nowTz } from '../lib/datetime.js';

const ngay = (s: unknown, macDinh: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : macDinh);
const loiChu = async (f: () => Promise<string>) => {
  try {
    return await f();
  } catch (e) {
    return `Lỗi: ${(e as Error).message.slice(0, 400)}`;
  }
};

export async function metaTools(): Promise<ToolDef[]> {
  if (!(await dsKetNoi().catch(() => [])).some((k) => k.nenTang === 'meta')) return [];
  const homNay = nowTz().format('YYYY-MM-DD');
  const truoc7 = nowTz().subtract(7, 'day').format('YYYY-MM-DD');
  return [
    {
      declaration: {
        name: 'meta_tai_khoan_qc',
        description: 'Danh sách tài khoản quảng cáo Meta (tên, mã số, tiền tệ) mà kết nối Facebook của công ty thấy. Gọi trước khi đọc số một khách.',
      },
      run: () => loiChu(async () => (await metaTaiSan()).map((t) => `- ${t.ten} · ${t.id} · ${t.ghiChu || ''}`).join('\n') || '(không có)'),
    },
    {
      declaration: {
        name: 'meta_so_chien_dich',
        description:
          'Số Meta Ads theo CHIẾN DỊCH của một tài khoản: mục tiêu, chi tiêu, hiển thị, click và MỌI loại hành động (tin nhắn, lead, mua, ' +
          'click link…). Dùng thay cho MCP Meta khi cần số nhanh. Mặc định 7 ngày gần nhất.',
        parameters: {
          type: 'OBJECT',
          properties: {
            taiKhoan: { type: 'STRING', description: 'Mã tài khoản quảng cáo (số, lấy từ meta_tai_khoan_qc).' },
            tuNgay: { type: 'STRING', description: 'YYYY-MM-DD (mặc định 7 ngày trước).' },
            denNgay: { type: 'STRING', description: 'YYYY-MM-DD (mặc định hôm nay).' },
          },
          required: ['taiKhoan'],
        },
      },
      run: (a) => loiChu(async () => tomTatMetaChienDich(await metaChienDich(String(a.taiKhoan || ''), ngay(a.tuNgay, truoc7), ngay(a.denNgay, homNay)))),
    },
  ];
}
