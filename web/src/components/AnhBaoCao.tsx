// Ảnh báo cáo quảng cáo gửi khách — bố cục theo mẫu anh Tâm gửi 11/11/2026 (Báo cáo Google Ads tháng Mịn Skinlab): đầu
// ảnh logo + tên khách, 5 thẻ số, bảng theo tài khoản + cơ cấu chuyển đổi, Đánh giá / Đề xuất, chân ảnh MT Digital.
// Vẽ bằng HTML cố định 1500px rồi chụp thành PNG (html-to-image). Màu lấy từ màu chủ đạo của khách.
import { forwardRef } from 'react';

export interface TongBc {
  hienThi: number;
  click: number;
  chuyenDoi: number;
  chiSauThue: number;
  cpa: number;
  ctr: number;
}
export interface DuLieuAnh {
  tenKhach: string;
  logo: string;
  mau: string;
  ky: string;
  nenTang: 'gads' | 'meta';
  tu: string;
  den: string;
  soLieu: {
    tk: Array<{ ten: string; hienThi: number; click: number; chuyenDoi: number; chiSauThue: number; cpa: number; thue: number }>;
    tong: TongBc;
    coCau: Array<{ nhan: string; so: number; tyLe: number }>;
  };
  truoc: TongBc | null;
  danhGia: string[];
  deXuat: string[];
}

export const RONG_ANH = 1500;
const MAU_MAC_DINH = '#5f6f52';
const so = (n: number) => Math.round(n || 0).toLocaleString('vi-VN');
const dong = (n: number) => `${so(n)}đ`;
const ngay = (iso: string) => `${iso.slice(8, 10)}/${iso.slice(5, 7)}/${iso.slice(0, 4)}`;
const phanTram = (x: number) => `${(Math.round(x * 1000) / 10).toLocaleString('vi-VN')}%`;

/** Trộn màu chủ đạo với trắng (t = 0 → màu gốc, 1 → trắng). */
function nhat(hex: string, t: number): string {
  const m = /^#([0-9a-f]{6})$/i.exec(hex) ? hex : MAU_MAC_DINH;
  const [r, g, b] = [1, 3, 5].map((i) => parseInt(m.slice(i, i + 2), 16));
  const tron = (c: number) => Math.round(c + (255 - c) * t);
  return `rgb(${tron(r!)}, ${tron(g!)}, ${tron(b!)})`;
}

/** So với kỳ trước: ▲ / ▼ x%. tot = tăng là tốt (chi phí / chuyển đổi thì giảm mới tốt). */
function SoSanh({ nay, truoc, tot = true }: { nay: number; truoc?: number; tot?: boolean }) {
  if (!truoc || !nay) return null;
  const d = (nay - truoc) / truoc;
  if (Math.abs(d) < 0.005) return <div style={{ fontSize: 17, color: '#7a7a72', marginTop: 4 }}>= kỳ trước</div>;
  const len = d > 0;
  const xanh = len === tot;
  return (
    <div style={{ fontSize: 17, marginTop: 4, color: xanh ? '#3d7a4a' : '#b4513f', fontWeight: 600 }}>
      {len ? '▲' : '▼'} {phanTram(Math.abs(d))} so với kỳ trước
    </div>
  );
}

function Donut({ coCau, mau }: { coCau: DuLieuAnh['soLieu']['coCau']; mau: string }) {
  const tong = coCau.reduce((s, c) => s + c.so, 0);
  const R = 120;
  const C = 2 * Math.PI * R;
  const mauLat = [mau, nhat(mau, 0.6), nhat(mau, 0.3), nhat(mau, 0.8), nhat(mau, 0.45)];
  let da = 0;
  return (
    <svg width={300} height={300} viewBox="0 0 300 300" role="img" aria-label="Cơ cấu chuyển đổi">
      <circle cx={150} cy={150} r={R} fill="none" stroke={nhat(mau, 0.88)} strokeWidth={56} />
      {coCau.map((c, i) => {
        const dai = (c.so / (tong || 1)) * C;
        const el = (
          <circle
            key={c.nhan}
            cx={150}
            cy={150}
            r={R}
            fill="none"
            stroke={mauLat[i % mauLat.length]}
            strokeWidth={56}
            strokeDasharray={`${dai} ${C - dai}`}
            strokeDashoffset={-da}
            transform="rotate(-90 150 150)"
          />
        );
        da += dai;
        return el;
      })}
      <text x={150} y={150} textAnchor="middle" fontSize={50} fontWeight={700} fill="#222" fontFamily="Lora, serif">
        {so(tong)}
      </text>
      <text x={150} y={184} textAnchor="middle" fontSize={20} fill="#555">
        chuyển đổi
      </text>
    </svg>
  );
}

const AnhBaoCao = forwardRef<HTMLDivElement, { d: DuLieuAnh }>(function AnhBaoCao({ d }, ref) {
  const mau = /^#[0-9a-f]{6}$/i.test(d.mau) ? d.mau : MAU_MAC_DINH;
  const gg = d.nenTang === 'gads';
  const nhanCd = gg ? 'Chuyển đổi' : 'Kết quả';
  const t = d.soLieu.tong;
  const tr = d.truoc && d.truoc.chiSauThue > 0 ? d.truoc : null;
  const thue = [...new Set(d.soLieu.tk.map((x) => x.thue))];
  const the: Array<{ icon: string; nhan: string; gia: string; nay: number; truoc?: number; tot?: boolean }> = [
    { icon: '👁', nhan: 'Hiển thị', gia: so(t.hienThi), nay: t.hienThi, truoc: tr?.hienThi },
    { icon: '🖱', nhan: 'Lượt nhấp', gia: so(t.click), nay: t.click, truoc: tr?.click },
    { icon: '🎯', nhan: nhanCd, gia: so(t.chuyenDoi), nay: t.chuyenDoi, truoc: tr?.chuyenDoi },
    { icon: '💰', nhan: `Chi phí / ${nhanCd.toLowerCase()}`, gia: t.cpa ? dong(t.cpa) : '—', nay: t.cpa, truoc: tr?.cpa, tot: false },
    { icon: '👛', nhan: 'Chi phí sau thuế', gia: dong(t.chiSauThue), nay: t.chiSauThue, truoc: tr?.chiSauThue },
  ];
  const nen = nhat(mau, 0.93);
  const the1: React.CSSProperties = { background: '#fff', borderRadius: 22, boxShadow: `0 6px 0 ${nhat(mau, 0.8)}, 0 2px 14px rgba(0,0,0,0.05)` };
  const tieuDe: React.CSSProperties = { fontFamily: 'Lora, serif', fontWeight: 700, color: '#2a2a26' };

  return (
    <div
      ref={ref}
      style={{ width: RONG_ANH, background: nen, padding: '44px 34px 26px', fontFamily: '"Be Vietnam Pro", Arial, sans-serif', color: '#2a2a26', boxSizing: 'border-box' }}
    >
      {/* Đầu ảnh */}
      <div style={{ display: 'flex', alignItems: 'center', gap: 34, padding: '0 40px' }}>
        <div style={{ width: 210, display: 'flex', justifyContent: 'center' }}>
          {d.logo ? (
            <img src={d.logo} alt="" style={{ maxWidth: 210, maxHeight: 110, objectFit: 'contain' }} />
          ) : (
            <div style={{ ...tieuDe, fontSize: 34, color: mau, textAlign: 'center', lineHeight: 1.15 }}>{d.tenKhach}</div>
          )}
        </div>
        <div style={{ width: 2, alignSelf: 'stretch', background: nhat(mau, 0.55) }} />
        <div>
          <div style={{ ...tieuDe, fontSize: 46, letterSpacing: 0.5 }}>
            BÁO CÁO {gg ? 'GOOGLE ADS' : 'FACEBOOK ADS'} {d.ky === 'tuan' ? 'TUẦN' : d.ky === 'thang' ? 'THÁNG' : ''}
          </div>
          <div style={{ ...tieuDe, fontSize: 32, fontWeight: 600, marginTop: 4 }}>{d.tenKhach}</div>
          <div
            style={{ display: 'inline-flex', alignItems: 'center', gap: 12, marginTop: 14, background: nhat(mau, 0.8), borderRadius: 999, padding: '9px 26px', fontSize: 24 }}
          >
            📅 {ngay(d.tu)} – {ngay(d.den)}
          </div>
        </div>
      </div>

      {/* 5 thẻ số */}
      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(5, 1fr)', gap: 18, marginTop: 34 }}>
        {the.map((x) => (
          <div key={x.nhan} style={{ ...the1, padding: '22px 22px 20px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
              <div style={{ width: 52, height: 52, borderRadius: 14, background: nhat(mau, 0.85), display: 'grid', placeItems: 'center', fontSize: 26 }}>{x.icon}</div>
              <div style={{ fontSize: 22, color: '#3a3a35' }}>{x.nhan}</div>
            </div>
            <div style={{ fontSize: x.gia.length > 11 ? 38 : 46, fontWeight: 700, textAlign: 'right', marginTop: 14, letterSpacing: -0.5 }}>{x.gia}</div>
            <div style={{ textAlign: 'right' }}>
              <SoSanh nay={x.nay} truoc={x.truoc} tot={x.tot} />
            </div>
          </div>
        ))}
      </div>

      {/* Bảng theo tài khoản + cơ cấu */}
      <div style={{ display: 'grid', gridTemplateColumns: d.soLieu.coCau.length ? '1.75fr 1fr' : '1fr', gap: 20, marginTop: 30 }}>
        <div style={{ ...the1, padding: '26px 24px 22px' }}>
          <div style={{ ...tieuDe, fontSize: 30, marginBottom: 18 }}>📊 Hiệu quả theo tài khoản</div>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 20, whiteSpace: 'nowrap' }}>
            <thead>
              <tr style={{ background: mau, color: '#fff' }}>
                {['Tài khoản', 'Hiển thị', 'Lượt nhấp', nhanCd, 'Chi phí', `Chi phí/${nhanCd.toLowerCase()}`].map((h, i) => (
                  <th key={h} style={{ padding: '15px 10px', textAlign: i ? 'right' : 'left', fontWeight: 500, borderRadius: i === 0 ? '10px 0 0 10px' : i === 5 ? '0 10px 10px 0' : 0 }}>
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {d.soLieu.tk.map((x) => (
                <tr key={x.ten} style={{ borderBottom: `1px solid ${nhat(mau, 0.85)}` }}>
                  <td style={{ padding: '15px 12px' }}>{x.ten}</td>
                  <td style={{ padding: '15px 12px', textAlign: 'right' }}>{so(x.hienThi)}</td>
                  <td style={{ padding: '15px 12px', textAlign: 'right' }}>{so(x.click)}</td>
                  <td style={{ padding: '15px 12px', textAlign: 'right' }}>{so(x.chuyenDoi)}</td>
                  <td style={{ padding: '15px 12px', textAlign: 'right' }}>{dong(x.chiSauThue)}</td>
                  <td style={{ padding: '15px 12px', textAlign: 'right' }}>{x.cpa ? dong(x.cpa) : '—'}</td>
                </tr>
              ))}
              {d.soLieu.tk.length > 1 && (
                <tr style={{ background: nhat(mau, 0.88), fontWeight: 700 }}>
                  <td style={{ padding: '16px 12px', borderRadius: '10px 0 0 10px' }}>TỔNG</td>
                  <td style={{ padding: '16px 12px', textAlign: 'right' }}>{so(t.hienThi)}</td>
                  <td style={{ padding: '16px 12px', textAlign: 'right' }}>{so(t.click)}</td>
                  <td style={{ padding: '16px 12px', textAlign: 'right' }}>{so(t.chuyenDoi)}</td>
                  <td style={{ padding: '16px 12px', textAlign: 'right' }}>{dong(t.chiSauThue)}</td>
                  <td style={{ padding: '16px 12px', textAlign: 'right', borderRadius: '0 10px 10px 0' }}>{t.cpa ? dong(t.cpa) : '—'}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        {d.soLieu.coCau.length > 0 && (
          <div style={{ ...the1, padding: '26px 24px' }}>
            <div style={{ ...tieuDe, fontSize: 30 }}>◔ Cơ cấu {nhanCd.toLowerCase()}</div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 22, marginTop: 10 }}>
              <Donut coCau={d.soLieu.coCau} mau={mau} />
              <div style={{ display: 'grid', gap: 16 }}>
                {d.soLieu.coCau.slice(0, 5).map((c, i) => (
                  <div key={c.nhan} style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                    <div style={{ width: 24, height: 24, borderRadius: 6, marginTop: 3, background: [mau, nhat(mau, 0.6), nhat(mau, 0.3), nhat(mau, 0.8), nhat(mau, 0.45)][i] }} />
                    <div style={{ fontSize: 21 }}>
                      <b>
                        {c.nhan}: {so(c.so)}
                      </b>
                      <div style={{ color: '#555' }}>({phanTram(c.tyLe)})</div>
                    </div>
                  </div>
                ))}
              </div>
            </div>
          </div>
        )}
      </div>

      {/* Đánh giá + đề xuất */}
      {(d.danhGia.length > 0 || d.deXuat.length > 0) && (
        <div style={{ ...the1, marginTop: 30, padding: '28px 40px', display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 40 }}>
          {[
            ['📋', 'Đánh giá', d.danhGia],
            ['🎯', 'Đề xuất', d.deXuat],
          ].map(([icon, nhan, ds], i) => (
            <div key={nhan as string} style={{ borderLeft: i ? `2px solid ${nhat(mau, 0.8)}` : 'none', paddingLeft: i ? 40 : 0 }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                <div style={{ width: 58, height: 58, borderRadius: 999, background: mau, display: 'grid', placeItems: 'center', fontSize: 28 }}>{icon as string}</div>
                <div style={{ ...tieuDe, fontSize: 30 }}>{nhan as string}</div>
              </div>
              <ul style={{ margin: '14px 0 0', paddingLeft: 30, fontSize: 23, lineHeight: 1.55, listStyle: 'disc' }}>
                {(ds as string[]).map((x, j) => (
                  <li key={j} style={{ marginBottom: 6 }}>{x}</li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      )}

      <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 22, padding: '0 8px', fontSize: 17, color: '#6b6b63' }}>
        <span>Chi phí đã gồm thuế{thue.length === 1 ? ` ${thue[0]}%` : ''}.</span>
        <span>
          Báo cáo bởi <b style={{ color: mau }}>MT Digital</b> · mtdigital.vn
        </span>
      </div>
    </div>
  );
});

export default AnhBaoCao;
