// Nghiệp vụ tài chính dùng chung cho route (bấm tay ở trang Tài chính) và cho
// trợ lý AI (nhắn "đã thu tiền khách A"). Để chung một bản vì hai đường mà hiểu
// khác nhau thì số tiền ghi ở đường này không khớp với đường kia.
import { getParties, addEntry, getPartyRates, paidByPartyMonth } from './finance.repo.js';
import { todayIso } from '../lib/datetime.js';
import { phanBoKhoanThu, DEBT_TRACK_FROM, type PhanBo } from '../lib/finance.js';
import { newId } from '../util/id.js';

export interface CollectResult {
  ok: boolean;
  collected: boolean;
  amount: number;
  /** Tiền đã chia vào những tháng nào (cũ nhất trước). */
  phanBo: PhanBo[];
  /** Lý do khi ok=false — để route ném lỗi còn AI thì đọc ra cho người dùng. */
  message?: string;
}

const thangVi = (ym: string) => `${Number(ym.slice(5, 7))}/${ym.slice(0, 4)}`;

/** "3.000.000đ vào tháng 9/2026, 3.000.000đ vào tháng 10/2026" — để báo lại người bấm. */
export function moTaPhanBo(ds: PhanBo[], vnd: (n: number) => string): string {
  return ds.map((x) => `${vnd(x.amount)} vào tháng ${thangVi(x.month)}`).join(', ');
}

/**
 * Ghi nhận MỘT lần khách trả tiền.
 *
 * Anh Tâm 21/8/2026 hỏi "khách trả trước 2-3 lần thì sao": mỗi lần trả là dòng riêng, có ngày
 * của nó, không ghi đè lần trước. Ghi nhầm thì xoá đúng dòng đó qua DELETE /finance/entries/:id.
 *
 * Anh Tâm 5/10/2026: "tiền anh thu tháng 10 mà tháng 9 còn nợ thì vào tháng 9, có nghĩa công nợ
 * trừ dần dần các tháng". Khoản tiền được CHIA vào các tháng còn nợ, cũ nhất trước
 * (lib/finance.phanBoKhoanThu), mỗi tháng một dòng — doanh thu từng tháng đúng tháng được trả.
 * Dư thì nằm ở tháng đang ghi. Khoản một lần trả nhiều đợt thì không chia, ghi đúng tháng.
 */
export async function addPayment(input: {
  partyId: string;
  month: string;
  amount: number;
  note?: string;
}): Promise<CollectResult> {
  const party = (await getParties()).find((p) => p.id === input.partyId);
  if (!party) return { ok: false, collected: false, amount: 0, phanBo: [], message: 'Không tìm thấy bên' };

  const amount = Math.round(input.amount) || 0;
  if (amount <= 0) {
    return { ok: false, collected: false, amount: 0, phanBo: [], message: 'Số tiền thu phải lớn hơn 0' };
  }

  let phanBo: PhanBo[];
  if (party.kind === 'once') {
    phanBo = [{ month: input.month, amount }];
  } else {
    const [rates, paid] = await Promise.all([getPartyRates(), paidByPartyMonth(DEBT_TRACK_FROM)]);
    // Bên đã ngưng: chỉ còn nợ tới tháng cuối, tiền trả sau đó trừ vào các tháng ấy.
    const toi = party.endMonth && input.month > party.endMonth ? party.endMonth : input.month;
    phanBo = phanBoKhoanThu(
      {
        receivable: party.receivable,
        rates: rates.get(party.id) || [],
        startMonth: (party.startDate || '').slice(0, 7),
        month: toi,
        paid: paid[party.id] || {},
      },
      amount,
    );
  }

  const note = (input.note || '').trim();
  // Ngày = NGÀY THU THẬT khi đang ghi ở tháng hiện tại (kể cả phần chia về tháng trước — tiền nhận
  // hôm nay). Đang xem một tháng cũ để ghi bù thì gán mùng 1 của tháng đang xem.
  const ngay = input.month >= todayIso().slice(0, 7) ? todayIso() : `${input.month}-01`;
  for (const x of phanBo) {
    await addEntry({
      id: newId('RECV-'),
      month: x.month,
      kind: 'thu',
      name:
        `${party.name} (thu công nợ${x.month !== input.month ? ` kỳ ${thangVi(x.month)}` : ''})` +
        (note ? ` — ${note}` : ''),
      amount: x.amount,
      date: ngay,
      recurring: false,
      partyId: input.partyId,
      // Thừa hưởng nguồn của bên: thu định kỳ mà bắt chọn nguồn lại mỗi tháng thì sớm muộn
      // cũng có tháng quên, và bảng doanh thu theo nguồn thủng một lỗ.
      source: party.source || '',
      customerId: '',
    });
  }
  return { ok: true, collected: true, amount, phanBo };
}
