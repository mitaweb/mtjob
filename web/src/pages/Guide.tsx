import { useState } from 'react';
import { useAuth } from '../lib/auth';
import type { Role } from '../lib/types';

// Hướng dẫn sử dụng — hiện ĐÚNG phần việc của vai đang đăng nhập.
//
// Anh Tâm 3/8/2026: "vị trí nào thì hướng dẫn cho vị trí đó". Nhân viên mở ra không phải
// lướt qua mục bảng lương hay quản trị; leader không phải đọc lại phần nhập số hằng ngày
// rồi mới tới phần của mình.
//
// Nội dung bám sát app THẬT: mọi con số (300m, 08:30, 1 phút, hạn nhập chỉ số) đều là
// quy tắc đang chạy trong code, không phải mô tả chung chung.

interface Muc {
  hoi: string;
  dap: string[];
}

interface Phan {
  icon: string;
  ten: string;
  /** Vai nào thấy phần này. Bỏ trống = mọi vai. */
  roles?: Role[];
  tom: string;
  mucs: Muc[];
}

const NHAN_SU: Role[] = ['member', 'leader'];
const QUAN_LY: Role[] = ['leader', 'director', 'admin'];

const PHANS: Phan[] = [
  {
    icon: '📍',
    ten: 'Chấm công',
    roles: ['member', 'leader', 'admin'],
    tom: 'Bấm giờ vào đầu ca, giờ ra cuối ca. Máy kiểm vị trí nên phải ở gần văn phòng.',
    mucs: [
      {
        hoi: 'Chấm công thế nào?',
        dap: [
          'Vào mục Chấm công, bấm ⬇️ Giờ vào khi tới và ⬆️ Giờ ra khi về.',
          'Ca sáng 08:30–12:00, ca chiều 13:30–17:00. Vào sau giờ bắt đầu ca thì tính là đi trễ.',
          'Chấm giờ ra buổi chiều trước 17:00 thì tính là về sớm.',
        ],
      },
      {
        hoi: 'Đi trễ, về sớm nhiều lần thì sao?',
        dap: [
          'Cuối tháng, lúc chốt lương, bạn nhận một thông báo ghi rõ tháng đó đi trễ mấy lần, về sớm mấy lần và những ngày nào.',
          'Xem lại chi tiết ở mục Lương & Công. Nếu giờ trong đó sai, báo quản trị sửa lại chấm công.',
          'Đi trễ hay về sớm vẫn phải nộp đơn giải trình trong 24h — có đơn là có xin phép, không đơn thì bị ghi nhận là vi phạm không báo.',
        ],
      },
      {
        hoi: 'Báo "đang cách công ty 6000m" mà mình đang ở văn phòng?',
        dap: [
          'Máy tính không có GPS thật nên định vị bằng WiFi, ra vị trí của nhà mạng chứ không phải chỗ bạn ngồi.',
          'Dùng điện thoại để chấm công, và bật Vị trí chính xác trong cài đặt máy.',
        ],
      },
      {
        hoi: 'Quên chấm công thì sao?',
        dap: [
          'Mở Chấm công, khối vàng ở đầu trang liệt kê những ngày làm việc chưa có công.',
          'Chọn tháng ở ô bên phải để soi lại các tháng trước.',
          'Ngày thiếu thì nộp đơn ở mục Đơn từ, hoặc báo quản lý sửa giúp.',
        ],
      },
    ],
  },
  {
    icon: '💬',
    ten: 'Ghi việc và tính điểm',
    roles: NHAN_SU,
    tom: 'Nhắn tên việc cho trợ lý là việc bắt đầu chạy. Bấm Hoàn thành mới được điểm.',
    mucs: [
      {
        hoi: 'Ghi một việc như thế nào?',
        dap: [
          'Vào Trợ lý, nhắn theo mẫu: <tên loại việc> + <tên khách>. Ví dụ "thiết kế post 1 ảnh Maple".',
          'BẮT BUỘC có tên khách — không có thì trợ lý sẽ hỏi lại, vì không phân biệt được hai việc thật với một việc bấm hai lần.',
          'Việc nhảy vào mục ⏳ Đang làm và bắt đầu tính giờ từ lúc bạn nhắn.',
        ],
      },
      {
        hoi: 'Khi nào được điểm?',
        dap: [
          'Chỉ khi bấm ✅ Hoàn thành ở mục ⏳ Đang làm. Nhắn tên việc thôi thì chưa có điểm nào.',
          'Mỗi việc chỉ được tính điểm ĐÚNG MỘT LẦN.',
          'Bấm Bắt đầu rồi bấm Hoàn thành trong vòng 1 phút thì không được tính — không có việc gì xong nổi trong vài giây.',
        ],
      },
      {
        hoi: 'Trợ lý chọn sai loại việc?',
        dap: [
          'Mở ⏳ Đang làm, bấm dấu ✕ bên phải việc đó để bỏ, rồi nhắn lại cho đúng.',
          'Chọn sai loại việc là sai điểm, nên cứ bỏ rồi ghi lại, đừng để vậy mà hoàn thành.',
          'Việc ĐÃ hoàn thành thì không tự xoá được nữa — nhờ giám đốc trừ bù giúp.',
        ],
      },
      {
        hoi: 'Xem điểm của mình ở đâu?',
        dap: [
          'Mục Điểm — có điểm tháng, thưởng, và chi tiết từng ngày kèm giờ làm của từng việc.',
          'Hoặc hỏi thẳng trợ lý: "điểm của tôi tháng này".',
        ],
      },
    ],
  },
  {
    icon: '🎯',
    ten: 'Nhập chỉ số KPI',
    roles: ['member'],
    tom: 'Mỗi ngày vào Dự án nhập số của phòng mình. Mất khoảng một phút.',
    mucs: [
      {
        hoi: 'Nhập ở đâu?',
        dap: [
          'Vào Dự án — khối "Chỉ số cần nhập" nằm ngay đầu trang, gom mọi chỉ số của phòng bạn.',
          'Gõ số vào ô rồi bấm Lưu. Nhập lại là ghi đè, không cộng dồn.',
        ],
      },
      {
        hoi: 'Hạn nhập tới khi nào?',
        dap: [
          'Số của một ngày nhập được trong chính ngày đó và ngày làm việc kế tiếp.',
          'Cuối tuần được cộng dồn: thứ Hai vẫn nhập bù được cho thứ Sáu, thứ Bảy và Chủ nhật.',
          'Quá hạn thì chỉ giám đốc nhập bù được — báo sớm để khỏi mất số.',
        ],
      },
      {
        hoi: 'Không thấy chỉ số nào?',
        dap: [
          'Phòng bạn chưa có chỉ số trong dự án đang chạy — báo leader đặt thêm.',
          'Bạn chỉ thấy và nhập được chỉ số của phòng mình, không thấy của phòng khác.',
        ],
      },
    ],
  },
  {
    icon: '📁',
    ten: 'Quản lý dự án và KPI',
    roles: QUAN_LY,
    tom: 'Bạn đặt tên chỉ số và mục tiêu. Nhân sự nhập số.',
    mucs: [
      {
        hoi: 'Tạo dự án mới',
        dap: [
          'Vào Dự án, bấm + Dự án mới. Điền tên, chọn khách hàng nếu có, đặt ngày bắt đầu và kết thúc.',
          'Đặt luôn các chỉ số ngay trong form — bấm chip gợi ý là điền sẵn tên, đơn vị và kỳ tính.',
          'Nhớ điền MỤC TIÊU cho từng chỉ số. Bỏ trống thì hệ thống không đo được tiến độ.',
        ],
      },
      {
        hoi: 'Ngày bắt đầu và kết thúc để làm gì?',
        dap: [
          'Để hệ thống so tiến độ thời gian với tiến độ KPI.',
          'Quá nửa thời gian mà KPI chưa nổi 50% thì thẻ dự án chuyển vàng; quá 75% hoặc quá hạn thì chuyển đỏ.',
          'Không khai ngày thì không có cảnh báo nào — hệ thống không đoán bừa.',
        ],
      },
      {
        hoi: 'Vì sao tôi không sửa được số?',
        dap: [
          'Cố ý. Bạn đặt mục tiêu, người trực tiếp chạy nhập số thật.',
          'Nếu người đặt mục tiêu cũng sửa được số thì con số mất ý nghĩa đối chiếu.',
          'Số nhập nhầm đã quá hạn thì báo giám đốc nhập bù.',
        ],
      },
      {
        hoi: 'Tìm nhanh dự án đang có vấn đề',
        dap: [
          'Bấm nút ⚠️ Cần chú ý ở đầu danh sách để lọc ra những dự án đang chậm.',
          'Lọc thêm theo phòng ban hoặc theo mức tiến độ ở hai ô bên cạnh.',
        ],
      },
    ],
  },
  {
    icon: '📝',
    ten: 'Đơn từ',
    roles: ['member', 'leader', 'sale', 'accountant', 'admin'],
    tom: 'Xin nghỉ hoặc làm online. Leader duyệt trước, giám đốc duyệt sau.',
    mucs: [
      {
        hoi: 'Nộp đơn',
        dap: [
          'Vào Đơn từ, chọn loại (nghỉ phép hoặc làm online), chọn ngày rồi gửi.',
          'Đơn được duyệt thì công của ngày đó tự vào bảng chấm công, không cần chấm GPS.',
        ],
      },
      {
        hoi: 'Bao giờ đơn được duyệt?',
        dap: [
          'Leader duyệt trước, rồi tới giám đốc. Mỗi bước bạn đều nhận thông báo.',
          'Xem trạng thái ngay trong mục Đơn từ.',
        ],
      },
    ],
  },
  {
    icon: '✅',
    ten: 'Duyệt đơn và giao việc',
    roles: QUAN_LY,
    tom: 'Duyệt đơn nghỉ của team, và giao việc thẳng trong chat.',
    mucs: [
      {
        hoi: 'Duyệt đơn',
        dap: [
          'Vào Duyệt đơn, xem danh sách chờ rồi bấm duyệt hoặc từ chối.',
          'Duyệt xong thì thông báo nhắc duyệt đơn đó tự chuyển thành đã đọc.',
        ],
      },
      {
        hoi: 'Giao việc cho thành viên',
        dap: [
          'Trong Trợ lý, gõ @ rồi chọn tên, kèm mô tả việc. Ví dụ "@tranthuy viết bài SEO sản phẩm A".',
          'Người nhận thấy việc ở mục Cần làm, tự chọn loại việc rồi bấm Bắt đầu.',
        ],
      },
      {
        hoi: 'Xem team làm được gì',
        dap: [
          'Mục Tổng quan có bảng xếp hạng điểm. Bấm vào tên một người để xem chi tiết từng ngày họ làm gì, mấy giờ.',
        ],
      },
    ],
  },
  {
    icon: '🔔',
    ten: 'Thông báo',
    tom: 'Bật một lần để nhận nhắc hẹn, đơn cần duyệt, báo cáo ngày ngay trên điện thoại.',
    mucs: [
      {
        hoi: 'Bật thông báo đẩy',
        dap: [
          'Vào Thông báo, bấm 🔔 Bật đẩy rồi cho phép khi trình duyệt hỏi.',
          'iPhone: phải thêm app vào Màn hình chính trước (nút chia sẻ → Thêm vào MH chính), rồi mở từ biểu tượng đó mới bật được.',
        ],
      },
      {
        hoi: 'Bật rồi mà không thấy gì?',
        dap: [
          'Vào Thông báo, bấm dòng "Không nhận được thông báo? Kiểm tra tại đây" rồi làm theo hai nút thử.',
          'Hay gặp nhất: máy tính đang bật chế độ Không làm phiền nên thông báo vào Trung tâm thông báo mà không hiện lên.',
        ],
      },
    ],
  },
];

const ROLE_LABEL: Record<string, string> = {
  member: 'Nhân viên',
  leader: 'Leader',
  director: 'Giám đốc',
  admin: 'Quản trị',
  accountant: 'Kế toán',
  sale: 'Account',
};

export default function Guide() {
  const { user } = useAuth();
  const role = (user?.role || 'member') as Role;
  const phans = PHANS.filter((p) => !p.roles || p.roles.includes(role));
  const [moMuc, setMoMuc] = useState<string | null>(null);

  return (
    <div className="space-y-4">
      <div className="card">
        <h1 className="text-lg font-bold">Hướng dẫn sử dụng</h1>
        <p className="mt-1 text-sm text-ink-muted">
          Nội dung dành riêng cho vai <b className="text-ink-soft">{ROLE_LABEL[role] || role}</b> của bạn — chỉ
          những việc bạn thật sự dùng.
        </p>
      </div>

      {phans.map((p) => (
        <div key={p.ten} className="card">
          <div className="flex items-baseline gap-2">
            <span className="text-lg">{p.icon}</span>
            <div>
              <h2 className="font-semibold">{p.ten}</h2>
              <p className="text-sm text-ink-muted">{p.tom}</p>
            </div>
          </div>

          <div className="mt-3 divide-y divide-brand-100">
            {p.mucs.map((m) => {
              const key = `${p.ten}|${m.hoi}`;
              const mo = moMuc === key;
              return (
                <div key={key}>
                  {/* Gấp lại từng câu: mở trang ra thấy danh sách câu hỏi, cần cái nào mở cái đó. */}
                  <button
                    className="flex w-full items-center justify-between gap-2 py-2.5 text-left"
                    onClick={() => setMoMuc(mo ? null : key)}
                  >
                    <span className="text-sm font-medium text-ink">{m.hoi}</span>
                    <span className="shrink-0 text-xs text-ink-faint">{mo ? '−' : '+'}</span>
                  </button>
                  {mo && (
                    <ul className="mb-3 space-y-1.5 pl-1">
                      {m.dap.map((d, i) => (
                        <li key={i} className="flex gap-2 text-sm text-ink-soft">
                          <span className="mt-1.5 h-1 w-1 shrink-0 rounded-full bg-brand-400" />
                          <span>{d}</span>
                        </li>
                      ))}
                    </ul>
                  )}
                </div>
              );
            })}
          </div>
        </div>
      ))}

      <div className="card bg-brand-50">
        <p className="text-sm text-ink-soft">
          Không thấy điều mình cần? Nhắn thẳng cho <b>Trợ lý</b> — hỏi được cả cách dùng lẫn dữ liệu của bạn.
          Còn vướng nữa thì báo quản lý.
        </p>
      </div>
    </div>
  );
}
