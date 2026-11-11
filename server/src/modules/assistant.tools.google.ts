// Trợ lý giám đốc đọc Google Ads / GA4 / Search Console qua kết nối Google của công ty (anh Tâm 11/11/2026: "làm nút
// kết nối google"). CHỈ ĐỌC: Google Ads chỉ nhận GAQL SELECT; GA4 / Search Console là quyền readonly.
import type { ToolDef } from './assistant.service.js';
import { tomTatGa4, tomTatGsc, tomTatGaql } from '../lib/ketNoi.js';
import { dsKetNoi, gadsTaiKhoan, gadsTruyVan, ga4TaiSan, ga4BaoCao, gscTaiSan, gscTruyVan } from './ketNoi.service.js';
import { nowTz } from '../lib/datetime.js';

const loiChu = async (f: () => Promise<string>) => {
  try {
    return await f();
  } catch (e) {
    return `Lỗi: ${(e as Error).message.slice(0, 400)}`;
  }
};
const ngay = (s: unknown, macDinh: string) => (/^\d{4}-\d{2}-\d{2}$/.test(String(s || '')) ? String(s) : macDinh);
const ds = (x: unknown) => (Array.isArray(x) ? x.map(String).filter(Boolean) : []);

export async function googleTools(): Promise<ToolDef[]> {
  const k = (await dsKetNoi().catch(() => [])).find((x) => x.nenTang === 'google');
  if (!k) return [];
  const homNay = nowTz().format('YYYY-MM-DD');
  const truoc28 = nowTz().subtract(28, 'day').format('YYYY-MM-DD');
  return [
    {
      declaration: {
        name: 'google_tai_san',
        description: 'Danh sách tài khoản Google Ads (mã 10 số, tên), property GA4 (mã số, tên) và site Search Console mà kết nối Google của công ty thấy được. Gọi trước để biết mã của khách.',
      },
      run: () =>
        loiChu(async () => {
          const phan: string[] = [];
          for (const [ten, f] of [
            ['GOOGLE ADS', gadsTaiKhoan],
            ['GA4', ga4TaiSan],
            ['SEARCH CONSOLE', gscTaiSan],
          ] as const) {
            try {
              const x = await f();
              phan.push(`${ten} (${x.length}):\n${x.map((t) => `- ${t.ten || '(không tên)'} · ${t.id}${t.ghiChu ? ` · ${t.ghiChu}` : ''}`).join('\n') || '(không có)'}`);
            } catch (e) {
              phan.push(`${ten}: lỗi — ${(e as Error).message.slice(0, 200)}`);
            }
          }
          return phan.join('\n\n');
        }),
    },
    {
      declaration: {
        name: 'google_ads_truy_van',
        description:
          'Đọc số liệu Google Ads bằng GAQL (CHỈ SELECT). Vd: SELECT campaign.name, campaign.status, metrics.cost_micros, metrics.clicks, metrics.conversions ' +
          'FROM campaign WHERE segments.date DURING LAST_7_DAYS. Tiền (*_micros) tự đổi ra đồng. Tài khoản dưới MCC thì truyền mã MCC nếu cần.',
        parameters: {
          type: 'OBJECT',
          properties: {
            customerId: { type: 'STRING', description: 'Mã tài khoản Google Ads 10 số (lấy từ google_tai_san).' },
            gaql: { type: 'STRING', description: 'Câu GAQL SELECT.' },
            loginCustomerId: { type: 'STRING', description: 'Mã MCC (bỏ trống = dùng MCC đã cài).' },
          },
          required: ['customerId', 'gaql'],
        },
      },
      run: (a) =>
        loiChu(async () => tomTatGaql((await gadsTruyVan(String(a.customerId || ''), String(a.gaql || ''), String(a.loginCustomerId || '') || undefined)) as Parameters<typeof tomTatGaql>[0])),
    },
    {
      declaration: {
        name: 'ga4_bao_cao',
        description:
          'Báo cáo Google Analytics 4 (Data API runReport). Chỉ số hay dùng: sessions, activeUsers, newUsers, screenPageViews, conversions, totalRevenue, ' +
          'engagementRate. Chiều: date, sessionSource, sessionMedium, sessionDefaultChannelGroup, pagePath, deviceCategory, city.',
        parameters: {
          type: 'OBJECT',
          properties: {
            propertyId: { type: 'STRING', description: 'Mã property GA4 (số, lấy từ google_tai_san).' },
            tuNgay: { type: 'STRING', description: 'YYYY-MM-DD (mặc định 28 ngày trước).' },
            denNgay: { type: 'STRING', description: 'YYYY-MM-DD (mặc định hôm nay).' },
            chiSo: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Tên chỉ số GA4.' },
            chieu: { type: 'ARRAY', items: { type: 'STRING' }, description: 'Tên chiều GA4 (có thể trống).' },
            gioiHan: { type: 'INTEGER', description: 'Số dòng tối đa (mặc định 50).' },
          },
          required: ['propertyId', 'chiSo'],
        },
      },
      run: (a) =>
        loiChu(async () =>
          tomTatGa4(
            (await ga4BaoCao(String(a.propertyId || ''), {
              dateRanges: [{ startDate: ngay(a.tuNgay, truoc28), endDate: ngay(a.denNgay, homNay) }],
              metrics: ds(a.chiSo).map((name) => ({ name })),
              dimensions: ds(a.chieu).map((name) => ({ name })),
              limit: String(Math.min(500, Number(a.gioiHan) || 50)),
            })) as Parameters<typeof tomTatGa4>[0],
          ),
        ),
    },
    {
      declaration: {
        name: 'gsc_truy_van',
        description:
          'Search Console: click, hiển thị, CTR, vị trí trung bình theo truy vấn / trang / ngày / thiết bị / quốc gia. Số liệu Search Console thường trễ 2–3 ngày.',
        parameters: {
          type: 'OBJECT',
          properties: {
            site: { type: 'STRING', description: 'Site đúng như Search Console (vd https://mtdigital.vn/ hoặc sc-domain:mtdigital.vn).' },
            tuNgay: { type: 'STRING', description: 'YYYY-MM-DD (mặc định 28 ngày trước).' },
            denNgay: { type: 'STRING', description: 'YYYY-MM-DD (mặc định hôm nay).' },
            chieu: { type: 'ARRAY', items: { type: 'STRING', enum: ['query', 'page', 'date', 'device', 'country'] }, description: 'Mặc định ["query"].' },
            gioiHan: { type: 'INTEGER', description: 'Số dòng tối đa (mặc định 50).' },
          },
          required: ['site'],
        },
      },
      run: (a) =>
        loiChu(async () => {
          const chieu = ds(a.chieu).length ? ds(a.chieu) : ['query'];
          return tomTatGsc(
            (await gscTruyVan(String(a.site || ''), {
              startDate: ngay(a.tuNgay, truoc28),
              endDate: ngay(a.denNgay, homNay),
              dimensions: chieu,
              rowLimit: Math.min(1000, Number(a.gioiHan) || 50),
            })) as Parameters<typeof tomTatGsc>[0],
            chieu,
          );
        }),
    },
  ];
}
