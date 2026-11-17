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
  // Anh Tâm 17/11/2026: cổng AI riêng của công ty — mọi vai đều dùng được. Nội dung hướng dẫn đặt thẳng ở đây (anh Tâm: "đưa
  // thẳng nội dung hướng dẫn vào trong MTJOB luôn thay vì qua link claude"). Dòng bắt đầu "§ " hiện dạng mã để chép.
  {
    icon: '🤖',
    ten: 'Dùng Claude cho công việc — MT Digital AI Gateway',
    tom: 'Nhân sự dùng Claude Desktop (Cowork) — app chính thức của Anthropic — qua cổng AI riêng của công ty. Không cần tài khoản Claude cá nhân, không mất phí.',
    mucs: [
      {
        hoi: 'Dùng để làm gì?',
        dap: [
          'Viết và sửa nội dung: bài đăng, kịch bản video, email, báo giá.',
          'Tóm tắt, phân tích tài liệu, file PDF, Excel.',
          'Lên ý tưởng, brief, checklist công việc.',
          'Hỏi đáp chuyên môn khi cần.',
          'Cách hoạt động: Claude Desktop có tính năng Third-Party Inference — mọi yêu cầu đi qua cổng MT Digital AI Gateway (https://api.mtdigital.vn) của công ty thay vì tài khoản Claude cá nhân. Toàn bộ nhân sự dùng chung một API key do quản trị cấp.',
        ],
      },
      {
        hoi: 'Bước 0 — Nhận API key',
        dap: [
          'Quản trị gửi API key (dạng sk-…) qua kênh nội bộ. Chưa nhận được thì báo quản trị trước khi làm các bước sau.',
          'Lưu key ở nơi riêng tư (trình quản lý mật khẩu), không để trong ghi chú hay tài liệu dùng chung.',
          'Key chỉ dùng trong nội bộ MT Digital: không gửi ra ngoài công ty, không đăng lên nhóm chat có người ngoài.',
        ],
      },
      {
        hoi: 'Tải Claude Desktop',
        dap: [
          'Tải bản cho macOS hoặc Windows tại https://claude.com/download rồi cài như một ứng dụng bình thường.',
          'Không cần đăng nhập tài khoản Claude cá nhân.',
          'Các bước dưới mô tả trên macOS; Windows thao tác tương tự. Lỗi riêng của Windows xem câu "Windows: Claude Desktop không mở được" ở cuối.',
        ],
      },
      {
        hoi: 'Bước 1 — Bật Developer Mode',
        dap: [
          'Developer Mode mở ra menu cấu hình gateway; bật một lần là đủ.',
          'Mở Claude Desktop, trên thanh menu chọn Help → Troubleshooting → Enable Developer Mode.',
          'App tự tải lại; chờ khởi động xong rồi sang bước 2.',
        ],
      },
      {
        hoi: 'Bước 2 — Mở cấu hình Third-Party Inference',
        dap: ['Sau khi app tải lại, thanh menu có thêm mục Developer.', 'Chọn Developer → Configure Third-Party Inference…'],
      },
      {
        hoi: 'Bước 3 — Điền cấu hình Gateway',
        dap: [
          'Tại mục Connection chọn Gateway, điền đúng 3 trường dưới đây rồi bấm Apply locally:',
          '§ Gateway base URL: https://api.mtdigital.vn',
          '§ Gateway API key: API key của bạn (Bước 0)',
          '§ Gateway auth schema: x-api-key',
          'Base URL KHÔNG có /v1 ở cuối — app tự thêm. App sẽ tải lại để áp dụng cấu hình mới.',
        ],
      },
      {
        hoi: 'Bước 4 — Chọn Continue with Gateway',
        dap: ['Sau khi app tải lại, màn hình đăng nhập có nút Continue with Gateway — bấm vào để Claude Desktop dùng MT Digital AI Gateway.'],
      },
      {
        hoi: 'Bước 5 — Chọn model và bắt đầu dùng',
        dap: [
          'Chọn model ở ô chọn model trong khung chat rồi dùng như bình thường. Gateway hiện mở các model:',
          'claude-sonnet-5-5 — việc hằng ngày: viết nội dung, phân tích, làm việc với file.',
          'claude-opus-5-5, claude-opus-5 — việc khó, cần suy luận sâu, tài liệu dài.',
          'claude-haiku-4-5 — câu hỏi nhanh, việc đơn giản.',
          'claude-sonnet-5, claude-fable-5-1, claude-fable-5 — phiên bản trước, khi cần so sánh.',
          'Key có thể được giới hạn chỉ dùng một số model. Chọn model ngoài danh sách được cấp sẽ báo lỗi 403.',
        ],
      },
      {
        hoi: 'Tóm tắt nhanh',
        dap: [
          'Help → Troubleshooting → Enable Developer Mode → Developer → Configure Third-Party Inference → Connection: Gateway → điền base URL https://api.mtdigital.vn, auth schema x-api-key, API key quản trị cấp → Apply locally → Continue with Gateway → chọn model.',
        ],
      },
      {
        hoi: 'Lưu ý khi dùng',
        dap: [
          'Chỉ dùng cho công việc của MT Digital.',
          'Không gửi API key ra ngoài công ty.',
          'Gateway ghi lại các lượt sử dụng để công ty theo dõi chi phí và chất lượng: quản trị xem được số lượt, token, chi phí và nội dung chat gửi qua gateway.',
        ],
      },
      {
        hoi: 'Xử lý lỗi thường gặp',
        dap: [
          'Phần lớn lỗi là do key hoặc model — xem mã lỗi Claude Desktop báo rồi đối chiếu:',
          '401 (API key required / invalid): key sai, bị khoá hoặc đã thu hồi → kiểm tra lại key đã nhập; vẫn lỗi thì báo quản trị.',
          '403 (not allowed to use model): model nằm ngoài phạm vi key → chọn model được cấp, hoặc xin quản trị mở thêm.',
          '404 (model not found / No active credentials): model không có trên gateway → chọn model trong danh sách ở Bước 5.',
          '502 / 503: tài khoản AI phía gateway tạm lỗi hoặc hết hạn mức → thử lại sau vài phút; kéo dài thì báo quản trị.',
        ],
      },
      {
        hoi: 'Windows: Claude Desktop không mở được hoặc báo lỗi máy ảo',
        dap: [
          'Nguyên nhân: máy chưa bật tính năng Virtual Machine Platform.',
          'Bấm phím Win, gõ cmd, chọn Run as administrator, rồi chạy lệnh:',
          '§ dism.exe /online /enable-feature /featurename:VirtualMachinePlatform /all /norestart',
          'Báo thành công thì khởi động lại máy, rồi mở Claude Desktop dùng bình thường.',
        ],
      },
      {
        hoi: 'Gặp lỗi khác hoặc cần hỗ trợ?',
        dap: ['Nhắn quản trị để được hỗ trợ.'],
      },
    ],
  },
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
    icon: '🧠',
    ten: 'Kho tri thức',
    tom: 'Bộ não thứ hai của công ty: hỏi trợ lý về quy trình, tiêu chuẩn, khách hàng — trợ lý trả lời từ kho thay vì phải hỏi giám đốc.',
    mucs: [
      {
        hoi: 'Hỏi thế nào?',
        dap: [
          'Nhắn thẳng cho Trợ lý, vd "màu thương hiệu dùng mã gì", "khách Savax cần lưu ý gì", "khách đòi giảm giá thì làm sao".',
          'Trợ lý ghi rõ câu trả lời lấy từ mục nào, cập nhật ngày nào.',
          'Kho chưa có thì trợ lý nói thật và chuyển câu hỏi cho giám đốc. Giám đốc trả lời xong, bạn nhận thông báo.',
        ],
      },
      {
        hoi: 'Cái gì nên đưa vào kho?',
        dap: [
          'Nên: lưu ý về khách, quy trình làm việc, tiêu chuẩn thiết kế & nội dung (màu, font, giọng văn), dịch vụ & bảng giá, chính sách nhân sự, cách xử lý tình huống, mẫu tin nhắn/báo giá, hướng dẫn công cụ, quyết định đã chốt.',
          'Không: số liệu thay đổi hằng ngày (điểm, chấm công, công nợ), lương thưởng của ai đó, mật khẩu/API key/số tài khoản (bị chặn hẳn), SĐT khách (tự ẩn), chuyện phiếm.',
        ],
      },
      {
        hoi: 'Đóng góp vào kho',
        dap: [
          'Vào Kho tri thức → tab ✍️ Đóng góp, viết tiêu đề và nội dung, bấm Gửi. Hoặc bấm 📌 Lưu vào kho tri thức dưới một câu trả lời của trợ lý.',
          'AI tự xếp nhóm, gắn đúng khách và quyết định ai xem được. Điều chưa chắc thì chờ giám đốc duyệt — xem trạng thái ở "Đóng góp của tôi".',
          'Lưu ý khách hàng giờ nằm ở tab 👤 Khách hàng của Kho tri thức (mục Lưu ý KH cũ đã gộp vào đây).',
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

/** Địa chỉ https trong câu trả lời → link bấm được (mở tab mới); dòng bắt đầu "§ " (cấu hình, lệnh) hiện dạng mã để chép. */
function coLink(s: string) {
  if (s.startsWith('§ ')) {
    // "§ Nhãn: giá trị" → nhãn thường + giá trị dạng mã (bấm một lần chọn hết để chép); "§ lệnh" → cả dòng dạng mã.
    const m = /^§ ([^:]{2,40}): (.+)$/.exec(s);
    const ma = (x: string) => <code className="select-all break-all rounded-lg bg-brand-50 px-2 py-0.5 font-mono text-[13px] text-ink">{x}</code>;
    return m ? (
      <>
        <b className="font-medium text-ink">{m[1]}:</b> {/^API key/.test(m[2]!) ? m[2] : ma(m[2]!)}
      </>
    ) : (
      <span className="block">{ma(s.slice(2))}</span>
    );
  }
  return s.split(/(https:\/\/[^\s,)]+)/g).map((p, i) =>
    // Địa chỉ API (base URL) không phải trang web để mở — hiện dạng mã.
    /^https:\/\/api\./.test(p) ? (
      <code key={i} className="rounded bg-brand-50 px-1 font-mono text-[13px]">
        {p}
      </code>
    ) : /^https:\/\//.test(p) ? (
      <a key={i} href={p} target="_blank" rel="noopener noreferrer" className="font-medium text-ocean-700 underline">
        {p}
      </a>
    ) : (
      p
    ),
  );
}

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
                          <span className="min-w-0 break-words">{coLink(d)}</span>
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
