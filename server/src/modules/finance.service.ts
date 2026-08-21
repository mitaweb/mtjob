// Nghiệp vụ tài chính dùng chung cho route (bấm tay ở trang Tài chính) và cho
// trợ lý AI (nhắn "đã thu tiền khách A"). Để chung một bản vì hai đường mà hiểu
// khác nhau thì số tiền ghi ở đường này không khớp với đường kia.
import { getParties, addEntry } from './finance.repo.js';
import { todayIso } from '../lib/datetime.js';
import { newId } from '../util/id.js';

export interface CollectResult {
  ok: boolean;
  collected: boolean;
  amount: number;
  /** Lý do khi ok=false — để route ném lỗi còn AI thì đọc ra cho người dùng. */
  message?: string;
}

/**
 * Ghi nhận MỘT lần khách trả tiền → thêm một khoản Thu.
 *
 * Anh Tâm 21/8/2026 hỏi "khách trả trước 2-3 lần thì sao". Trước đây mỗi bên mỗi kỳ chỉ
 * có ĐÚNG MỘT dòng, mã cố định RECV-<bên>-<kỳ>, và mỗi lần ghi là GHI ĐÈ dòng đó:
 *   - Người nhập phải tự cộng tay rồi gõ tổng luỹ kế; gõ số của riêng lần này là mất
 *     sạch những lần trước, mà không có gì báo.
 *   - Trợ lý nghe "khách vừa trả thêm 4tr" rồi ghi 4tr là xoá mất 3tr thu hôm trước.
 *   - Không còn dấu vết trả mấy lần, ngày nào — thứ mà công nợ cần nhất.
 *
 * Giờ mỗi lần trả là một dòng riêng, có ngày của nó. `paidByPartyMonth` vốn đã SUM theo
 * (bên, kỳ) nên mọi báo cáo tự cộng đúng — kể cả các dòng cũ mã RECV-<bên>-<kỳ> còn lại,
 * không cần chuyển đổi dữ liệu.
 *
 * Ghi nhầm một lần thì xoá đúng dòng đó qua DELETE /finance/entries/:id.
 */
export async function addPayment(input: {
  partyId: string;
  month: string;
  amount: number;
  note?: string;
}): Promise<CollectResult> {
  const party = (await getParties()).find((p) => p.id === input.partyId);
  if (!party) return { ok: false, collected: false, amount: 0, message: 'Không tìm thấy bên' };

  const amount = Math.round(input.amount) || 0;
  if (amount <= 0) {
    return { ok: false, collected: false, amount: 0, message: 'Số tiền thu phải lớn hơn 0' };
  }

  const note = (input.note || '').trim();
  await addEntry({
    id: newId('RECV-'),
    month: input.month,
    kind: 'thu',
    name: `${party.name} (thu công nợ)${note ? ` — ${note}` : ''}`,
    amount,
    // Đang xem kỳ cũ thì gán mùng 1 của kỳ đó — lấy hôm nay sẽ ra ngày nằm ngoài tháng
    // của chính khoản thu.
    date: input.month === todayIso().slice(0, 7) ? todayIso() : `${input.month}-01`,
    recurring: false,
    partyId: input.partyId,
  });
  return { ok: true, collected: true, amount };
}
