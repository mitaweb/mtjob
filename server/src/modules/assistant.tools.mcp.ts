// Trợ lý giám đốc gọi công cụ của các MCP đã kết nối (Meta Ads chính thức, MCP trên máy Mac…) — CHỈ ĐỌC (anh Tâm
// 10/11/2026). Danh sách công cụ lấy từ lần "Kiểm tra" gần nhất (lưu trong DB) nên không tốn mạng mỗi câu hỏi.
import type { ToolDef } from './assistant.service.js';
import { tomTatCongCu } from '../lib/ketNoi.js';
import { dsKetNoi, goiCongCu } from './ketNoi.service.js';

export async function mcpTools(): Promise<ToolDef[]> {
  const ds = (await dsKetNoi().catch(() => [])).filter((k) => k.congCu.length);
  if (!ds.length) return [];
  const moTa = ds.map((k) => `[${k.id}] ${k.ten}${k.taiKhoan ? ` (${k.taiKhoan})` : ''}:\n${tomTatCongCu(k.congCu.slice(0, 40))}`).join('\n\n');
  const ids = ds.map((k) => k.id);
  return [
    {
      declaration: {
        name: 'xem_cong_cu_mcp',
        description: 'Xem MÔ TẢ ĐẦY ĐỦ + THAM SỐ của một công cụ MCP trước khi gọi goi_mcp (khi chưa chắc cần truyền gì).',
        parameters: {
          type: 'OBJECT',
          properties: { ketNoi: { type: 'STRING', enum: ids }, congCu: { type: 'STRING' } },
          required: ['ketNoi', 'congCu'],
        },
      },
      run: async (a) => {
        const k = ds.find((x) => x.id === a.ketNoi);
        const c = k?.congCu.find((x) => x.name === a.congCu);
        if (!c) return 'Không có công cụ này.';
        return `${c.name}: ${c.description || ''}\nTHAM SỐ (JSON Schema): ${JSON.stringify(c.inputSchema || {}).slice(0, 4000)}`;
      },
    },
    {
      declaration: {
        name: 'goi_mcp',
        description:
          'Gọi công cụ của MCP đã kết nối để lấy SỐ LIỆU THẬT (quảng cáo Meta: tài khoản, chiến dịch, chi tiêu, kết quả…). ' +
          'CHỈ ĐỌC — công cụ làm thay đổi tài khoản (tạo / sửa / tạm dừng / đổi ngân sách) sẽ bị chặn. Các kết nối và công cụ:\n' +
          moTa,
        parameters: {
          type: 'OBJECT',
          properties: {
            ketNoi: { type: 'STRING', enum: ids, description: 'Mã kết nối trong ngoặc vuông.' },
            congCu: { type: 'STRING', description: 'Tên công cụ.' },
            thamSo: { type: 'STRING', description: 'Tham số dạng JSON, vd {"account_id":"act_123","date_preset":"last_7d"}. Không có thì "{}".' },
          },
          required: ['ketNoi', 'congCu'],
        },
      },
      run: async (a) => {
        let thamSo: Record<string, unknown> = {};
        try {
          const x = JSON.parse(String(a.thamSo || '{}'));
          if (x && typeof x === 'object' && !Array.isArray(x)) thamSo = x;
        } catch {
          return 'Tham số không phải JSON hợp lệ — gọi lại với thamSo dạng {"khoá": "giá trị"}.';
        }
        try {
          return await goiCongCu(String(a.ketNoi || ''), String(a.congCu || ''), thamSo);
        } catch (e) {
          return `Gọi MCP lỗi: ${(e as Error).message.slice(0, 300)}`;
        }
      },
    },
  ];
}
