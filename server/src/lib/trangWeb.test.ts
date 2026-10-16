import { describe, it, expect } from 'vitest';
import { linkTrongTin, laIpNoiBo, doiLinkGoogle, chuTuHtml, ganMoTaLink } from './trangWeb.js';

// Anh Tâm 16/10/2026: "nếu có link thì sao, anh muốn AI truy cập link xem nó là gì".

describe('linkTrongTin', () => {
  it('lấy link trong tin chữ và tin "Tệp/link", bỏ dấu câu cuối, không trùng', () => {
    expect(linkTrongTin('Anh xem giúp em https://mtdigital.vn/bang-gia, và https://mtdigital.vn/bang-gia.')).toEqual(['https://mtdigital.vn/bang-gia']);
    expect(linkTrongTin('[Tệp/link: Bài viết — https://www.facebook.com/abc/posts/1]')).toEqual(['https://www.facebook.com/abc/posts/1']);
  });
  it('bỏ link tệp Zalo (đọc kiểu tệp), link có mật khẩu, tin đã xem link', () => {
    expect(linkTrongTin('[Tệp/link: https://photo-stal-24.zdn.vn/gr/jpg/a.jpg]')).toEqual([]);
    expect(linkTrongTin('https://user:pass@example.com/x')).toEqual([]);
    expect(linkTrongTin('Xem https://a.vn [Link: Trang bảng giá]')).toEqual([]);
  });
});

describe('laIpNoiBo — không bao giờ mở địa chỉ nội bộ', () => {
  it('chặn mạng nội bộ, máy chủ, metadata đám mây', () => {
    for (const ip of ['127.0.0.1', '10.1.2.3', '172.16.0.1', '192.168.1.1', '169.254.169.254', '100.64.0.1', '0.0.0.0', '::1', 'fd00::1', 'fe80::1', '::ffff:127.0.0.1']) {
      expect(laIpNoiBo(ip), ip).toBe(true);
    }
  });
  it('cho qua IP công khai', () => {
    expect(laIpNoiBo('142.250.66.78')).toBe(false);
    expect(laIpNoiBo('2404:6800:4005:80a::200e')).toBe(false);
  });
});

describe('doiLinkGoogle', () => {
  it('Docs / Sheets / Slides → link xuất chữ', () => {
    expect(doiLinkGoogle('https://docs.google.com/document/d/AbC_1-x/edit?usp=sharing')).toBe('https://docs.google.com/document/d/AbC_1-x/export?format=txt');
    expect(doiLinkGoogle('https://docs.google.com/spreadsheets/d/XyZ/edit#gid=0')).toBe('https://docs.google.com/spreadsheets/d/XyZ/export?format=csv');
    expect(doiLinkGoogle('https://docs.google.com/presentation/d/P1/edit')).toBe('https://docs.google.com/presentation/d/P1/export/txt');
    expect(doiLinkGoogle('https://mtdigital.vn/x')).toBe('https://mtdigital.vn/x');
  });
});

describe('chuTuHtml', () => {
  it('lấy tiêu đề og, mô tả, chữ chính; bỏ script/style/menu', () => {
    const html = `<html><head><title>Cũ</title><meta property="og:title" content="Bảng giá &amp; gói dịch vụ">
      <meta name="description" content="Gói 9 triệu/tháng"></head>
      <body><nav>Trang chủ | Liên hệ</nav><script>var x=1</script><style>p{}</style>
      <h1>Gói Social</h1><p>Xây kênh &#8211; 12 bài/tháng</p></body></html>`;
    const r = chuTuHtml(html);
    expect(r.tieuDe).toBe('Bảng giá & gói dịch vụ');
    expect(r.moTa).toBe('Gói 9 triệu/tháng');
    expect(r.noiDung).toBe('Gói Social\nXây kênh – 12 bài/tháng');
  });
});

describe('ganMoTaLink', () => {
  it('tin "Tệp/link" → thay bằng mô tả; tin chữ → nối mô tả, che số dài', () => {
    expect(ganMoTaLink('[Tệp/link: https://fb.com/p/1]', 'https://fb.com/p/1', 'Bài đăng tuyển dụng')).toBe('[Link https://fb.com/p/1: Bài đăng tuyển dụng]');
    expect(ganMoTaLink('Anh xem https://a.vn', 'https://a.vn', 'Trang thanh toán STK 0071001234567')).toBe('Anh xem https://a.vn [Link: Trang thanh toán STK [đã ẩn số]]');
  });
});
