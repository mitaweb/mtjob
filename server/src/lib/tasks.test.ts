import { describe, it, expect } from 'vitest';
import {
  taskTitle,
  cleanNote,
  isStartReport,
  taskCustomerKey,
  pickDoingToComplete,
  findOpenDuplicate,
  taskDeleteBlock,
  type DoingLike,
} from './tasks.js';

describe('taskCustomerKey', () => {
  it('mọi cách viết của cùng một khách ra cùng khoá', () => {
    // Anh Tâm: "quảng cáo x salon hay x-salon đều là 1, anh không quan tâm cách viết".
    for (const v of ['X Salon', 'x salon', 'X-Salon', 'X  Salon', 'X_Salon', ' x salon. ']) {
      expect(taskCustomerKey(v)).toBe('x salon');
    }
    expect(taskCustomerKey('Quốc Phong')).toBe(taskCustomerKey('quoc phong'));
    expect(taskCustomerKey('Đức Anh')).toBe('duc anh');
  });

  it('chuỗi không có chữ/số nào ra khoá rỗng', () => {
    expect(taskCustomerKey('')).toBe('');
    expect(taskCustomerKey('   ')).toBe('');
    expect(taskCustomerKey('—')).toBe('');
    expect(taskCustomerKey('✅')).toBe('');
  });

  it('KHÔNG gộp nhầm hai khách khác nhau', () => {
    expect(taskCustomerKey('X Salon')).not.toBe(taskCustomerKey('Y Salon'));
    expect(taskCustomerKey('Salon 5')).not.toBe(taskCustomerKey('Salon 6'));
  });

  it('ghi chú hệ thống không phải tên khách', () => {
    // Việc leader giao có note "Giao bởi X"; nếu coi đó là khách thì lúc nhân viên báo
    // xong sẽ không khớp được và việc treo mãi ở trạng thái đang làm.
    expect(taskCustomerKey('Giao bởi Minh Tâm')).toBe('');
    expect(taskCustomerKey('Backfill 20/7')).toBe('');
  });
});

// Dựng danh sách việc đang làm dở, cũ nhất trước — đúng thứ tự getDoingTasks trả về.
const doing = (...rows: Array<[string, string, string]>): DoingLike[] =>
  rows.map(([id, taskCode, note]) => ({ id, taskCode, note }));

describe('pickDoingToComplete', () => {
  it('KHÔNG đụng việc của khách khác — ca lỗi từng làm mất một việc thật', () => {
    // Bắt đầu "Tối ưu QC — X Salon" rồi báo xong "Tối ưu QC — Quốc Phong":
    // code cũ đóng dòng X Salon và ghi đè tên khách thành Quốc Phong.
    const list = doing(['T1', 'ADS13', 'X Salon']);
    expect(pickDoingToComplete(list, 'ADS13', 'Quốc Phong')).toBeNull();
  });

  it('khớp đúng khách dù viết khác cách', () => {
    const list = doing(['T1', 'ADS13', 'X Salon']);
    expect(pickDoingToComplete(list, 'ADS13', 'x-salon')?.id).toBe('T1');
  });

  it('nhiều khách đang mở thì chọn đúng khách được nhắc', () => {
    const list = doing(['T1', 'ADS13', 'X Salon'], ['T2', 'ADS13', 'Quốc Phong']);
    expect(pickDoingToComplete(list, 'ADS13', 'Quốc Phong')?.id).toBe('T2');
    expect(pickDoingToComplete(list, 'ADS13', 'X Salon')?.id).toBe('T1');
  });

  it('khai bổ sung tên khách cho dòng chưa ghi', () => {
    const list = doing(['T1', 'ADS13', '']);
    expect(pickDoingToComplete(list, 'ADS13', 'X Salon')?.id).toBe('T1');
  });

  it('báo xong không nhắc khách thì vẫn đóng được việc dở', () => {
    // Rỗng là ký tự đại diện ở chiều ĐÓNG — nếu không, dòng doing treo vĩnh viễn.
    expect(pickDoingToComplete(doing(['T1', 'ADS13', 'X Salon']), 'ADS13', '')?.id).toBe('T1');
    // Ưu tiên dòng cũng chưa ghi khách.
    const mixed = doing(['T1', 'ADS13', 'X Salon'], ['T2', 'ADS13', '']);
    expect(pickDoingToComplete(mixed, 'ADS13', '')?.id).toBe('T2');
    // Không có dòng trống thì lấy dòng cũ nhất, đừng sinh dòng mồ côi.
    const both = doing(['T1', 'ADS13', 'X Salon'], ['T2', 'ADS13', 'Quốc Phong']);
    expect(pickDoingToComplete(both, 'ADS13', '')?.id).toBe('T1');
  });

  it('khác loại việc thì không khớp', () => {
    expect(pickDoingToComplete(doing(['T1', 'ADS01', 'X Salon']), 'ADS13', 'X Salon')).toBeNull();
    expect(pickDoingToComplete([], 'ADS13', 'X Salon')).toBeNull();
  });
});

describe('findOpenDuplicate', () => {
  it('bắt đầu hai lần cùng khách là trùng', () => {
    expect(findOpenDuplicate(doing(['T1', 'ADS13', 'X Salon']), 'ADS13', 'X-Salon')?.id).toBe('T1');
    // Bấm hai lần không khai khách — nguồn của các cụm mở hàng loạt tháng 7.
    expect(findOpenDuplicate(doing(['T1', 'ADS13', '']), 'ADS13', '')?.id).toBe('T1');
  });

  it('cùng loại việc KHÁC khách thì cho phép — quyết định của anh Tâm', () => {
    expect(findOpenDuplicate(doing(['T1', 'ADS13', 'X Salon']), 'ADS13', 'Quốc Phong')).toBeNull();
    // Khớp cứng: đang mở "X Salon", bắt đầu việc chưa khai khách → cho qua.
    // Thà cho mở thừa còn hơn chặn oan một việc cho khách khác.
    expect(findOpenDuplicate(doing(['T1', 'ADS13', 'X Salon']), 'ADS13', '')).toBeNull();
  });
});

describe('isStartReport', () => {
  it('nhận ra câu báo BẮT ĐẦU (không được tính điểm)', () => {
    // Đúng những dòng đang làm bảng điểm phồng gấp đôi trong dữ liệu tháng 7.
    expect(isStartReport('bắt đầu tối ưu quảng cáo')).toBe(true);
    expect(isStartReport('bắt đầu lên ads')).toBe(true);
    expect(isStartReport('bắt đầu chuẩn bị nội dung quảng cáo')).toBe(true);
    expect(isStartReport('đang làm video')).toBe(true);
    expect(isStartReport('BẮT ĐẦU LÊN ADS')).toBe(true);
  });

  it('không nhầm câu báo ĐÃ XONG là báo bắt đầu', () => {
    expect(isStartReport('Tối ưu Quảng Cáo')).toBe(false);
    expect(isStartReport('đã đăng bài page cho X Salon')).toBe(false);
    expect(isStartReport('xong video quảng cáo')).toBe(false);
    expect(isStartReport('')).toBe(false);
    // "bắt đầu" nằm giữa câu là mô tả, không phải báo bắt đầu.
    expect(isStartReport('báo cáo ads từ lúc bắt đầu chiến dịch')).toBe(false);
  });

  it('KHÔNG coi "chuẩn bị…" là báo bắt đầu — đó là tên loại việc thật (ca thật trong DB)', () => {
    // "Chuẩn bị nội dung quảng cáo" và "Chuẩn bị chứng từ" là loại việc; câu báo xong
    // chúng mở đầu bằng "chuẩn bị" nhưng KHÔNG phải báo bắt đầu, không được bỏ điểm.
    expect(isStartReport('chuẩn bị nội dung quảng cáo content tiến minh')).toBe(false);
    expect(isStartReport('chuẩn bị chứng từ')).toBe(false);
    // Nhưng có "bắt đầu" đứng trước thì vẫn là báo bắt đầu.
    expect(isStartReport('bắt đầu chuẩn bị nội dung quảng cáo')).toBe(true);
  });
});

describe('cleanNote', () => {
  it('bỏ cụm hành động mở đầu, còn lại đúng bằng tên việc thì không giữ gì', () => {
    // Đây là ca thật: bảng điểm hiện "bắt đầu tối ưu quảng cáo" thay vì "Tối ưu Quảng Cáo".
    expect(cleanNote('bắt đầu tối ưu quảng cáo', 'Tối ưu Quảng Cáo')).toBe('');
    expect(cleanNote('đã đăng bài page', 'Đăng bài page')).toBe('');
    expect(cleanNote('bắt đầu lên ads', 'Lên Ads')).toBe('');
  });

  it('bóc cụm "ghi nhận task" — chữ thừa, phía sau luôn là việc + tên khách', () => {
    // Ca thật của anh Tú ngày 21/07. Việc CÓ THẬT, chỉ ghi chú thừa chữ → giữ điểm, sửa chữ.
    expect(cleanNote('ghi nhận task : chuẩn bị nội dung quảng cáo', 'Chuẩn bị nội dung quảng cáo')).toBe('');
    expect(cleanNote('ghi nhận task : chuẩn bị nội dung quảng cáo 2', 'Chuẩn bị nội dung quảng cáo')).toBe('2');
    expect(cleanNote('ghi nhận tối ưu quảng cáo Topaz', 'Tối ưu Quảng Cáo')).toBe('Topaz');
  });

  it('hiểu viết tắt trong danh mục — "KH" và "khách hàng" là một (ca thật ADS04)', () => {
    // Danh mục ghi "Xây dựng chân dung KH", nhân sự gõ đầy đủ "…chân dung khách hàng".
    expect(cleanNote('Xây dựng chân dung khách hàng : add page , hướng dẫn', 'Xây dựng chân dung KH'))
      .toBe('add page , hướng dẫn');
    expect(cleanNote('Xây dựng chân dung KH : add page', 'Xây dựng chân dung KH')).toBe('add page');
    expect(cleanNote('xây dựng chân dung khách hàng', 'Xây dựng chân dung KH')).toBe('');
  });

  it('KHÔNG xén mất chữ khi tên việc là tiền tố của một từ dài hơn', () => {
    // "Seeding" vs ghi chú "Seedinger Corp" — cắt theo độ dài sẽ để lại "er Corp".
    expect(cleanNote('Seedinger Corp', 'Seeding')).toBe('Seedinger Corp');
  });

  it('KHÔNG bóc quá tay khi tên loại việc bắt đầu bằng một từ hành động', () => {
    // "Chuẩn bị nội dung quảng cáo" là TÊN VIỆC — bóc tiếp sẽ ra "nội dung quảng cáo" cụt.
    expect(cleanNote('chuẩn bị nội dung quảng cáo', 'Chuẩn bị nội dung quảng cáo')).toBe('');
    expect(cleanNote('chuẩn bị nội dung quảng cáo cho Kienzo', 'Chuẩn bị nội dung quảng cáo')).toBe('Kienzo');
    expect(cleanNote('bắt đầu chuẩn bị nội dung quảng cáo', 'Chuẩn bị nội dung quảng cáo')).toBe('');
  });

  it('làm sạch khi nhân viên dán lại bong bóng chat của app', () => {
    // Ca thật trong DB: ghi chú bị nhét nguyên câu hiển thị "▶️ Bắt đầu: ...".
    expect(cleanNote('▶️ Bắt đầu: Tối ưu Quảng Cáo — Quốc Phong', 'Tối ưu Quảng Cáo')).toBe('Quốc Phong');
    expect(cleanNote('▶️ Bắt đầu: Lên Ads — Kienzo', 'Lên Ads')).toBe('Kienzo');
    expect(cleanNote('✅ Đã hoàn thành Tối ưu Quảng Cáo', 'Tối ưu Quảng Cáo')).toBe('');
    expect(cleanNote('▶️ Bắt đầu: Tối ưu Quảng Cáo', 'Tối ưu Quảng Cáo')).toBe('');
  });

  it('giữ lại mô tả thật (tên khách) sau khi bỏ hành động và tên việc', () => {
    expect(cleanNote('đã đăng bài page cho X Salon', 'Đăng bài page')).toBe('X Salon');
    expect(cleanNote('bắt đầu lên ads Quốc Phong', 'Lên Ads')).toBe('Quốc Phong');
    expect(cleanNote('vừa xong báo cáo ads - Ba Spa', 'Báo cáo Ads')).toBe('Ba Spa');
  });

  it('ghi chú vốn đã sạch thì giữ nguyên', () => {
    expect(cleanNote('X Salon', 'Đăng bài page')).toBe('X Salon');
    expect(cleanNote('Quốc Phong tháng 8', 'Lên Ads')).toBe('Quốc Phong tháng 8');
  });

  it('chịu được đầu vào rỗng', () => {
    expect(cleanNote('', 'Lên Ads')).toBe('');
    expect(cleanNote('   ', 'Lên Ads')).toBe('');
    expect(cleanNote('X Salon')).toBe('X Salon');
  });

  it('không cắt nhầm khi mô tả chỉ TÌNH CỜ bắt đầu bằng chữ giống tên việc', () => {
    // "Lên Ads Studio" là tên khách, không phải lặp tên việc → giữ nguyên phần còn lại.
    expect(cleanNote('lên ads cho Ads Studio', 'Lên Ads')).toBe('Ads Studio');
  });
});

describe('taskTitle', () => {
  it('ghép loại việc + mô tả cụ thể', () => {
    expect(taskTitle({ taskName: 'Đăng post', note: 'X Salon' })).toBe('Đăng post — X Salon');
  });
  it('note rỗng → chỉ loại việc', () => {
    expect(taskTitle({ taskName: 'Đăng post', note: '' })).toBe('Đăng post');
    expect(taskTitle({ taskName: 'Đăng post' })).toBe('Đăng post');
  });
  it('note đã chứa loại việc → dùng note (tránh lặp)', () => {
    expect(taskTitle({ taskName: 'Đăng post', note: 'đăng post X Salon' })).toBe('đăng post X Salon');
  });
  it('việc được giao: taskName đã đầy đủ, bỏ note "Giao bởi"', () => {
    expect(taskTitle({ taskName: 'Đăng post X Salon', note: 'Giao bởi Nam', source: 'assign' })).toBe('Đăng post X Salon');
    expect(taskTitle({ taskName: 'Viết bài', note: 'Giao bởi Lan' })).toBe('Viết bài');
  });
});

describe('taskDeleteBlock', () => {
  it('việc đang làm xoá được bất cứ lúc nào — chưa có điểm', () => {
    expect(taskDeleteBlock('doing', '', '2026-07-29')).toBe('');
  });

  it('việc xong TRONG NGÀY xoá được', () => {
    expect(taskDeleteBlock('done', '2026-07-29', '2026-07-29')).toBe('');
  });

  it('việc xong hôm trước thì khoá, chỉ còn đường nhờ giám đốc trừ bù', () => {
    expect(taskDeleteBlock('done', '2026-07-28', '2026-07-29')).toMatch(/giám đốc/);
  });

  it('việc cấp trên giao thì người nhận không tự xoá', () => {
    expect(taskDeleteBlock('todo', '', '2026-07-29')).toMatch(/cấp trên giao/);
  });

  it('dòng đã đánh dấu trùng không xoá qua đường này', () => {
    expect(taskDeleteBlock('duplicate', '2026-07-29', '2026-07-29')).toMatch(/không xoá được/);
  });

  it('việc done mà thiếu ngày hoàn thành thì khoá, không đoán bừa là hôm nay', () => {
    expect(taskDeleteBlock('done', '', '2026-07-29')).toMatch(/giám đốc/);
  });
});
