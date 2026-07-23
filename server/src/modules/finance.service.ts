// Nghiệp vụ tài chính dùng chung cho route (bấm tay ở trang Tài chính) và cho
// trợ lý AI (nhắn "đã thu tiền khách A"). Để chung một bản vì quy ước mã khoản
// RECV-<bên>-<tháng> mà lệch nhau thì tick ở trang này không gỡ được khoản kia.
import { getParties, upsertEntry, deleteEntry } from './finance.repo.js';
import { todayIso } from '../lib/datetime.js';

/** Mã cố định cho khoản thu công nợ — tick/bỏ tick không nhân bản dòng. */
export function receivableEntryId(partyId: string, month: string): string {
  return `RECV-${partyId}-${month}`;
}

export interface CollectResult {
  ok: boolean;
  collected: boolean;
  amount: number;
  /** Lý do khi ok=false — để route ném lỗi còn AI thì đọc ra cho người dùng. */
  message?: string;
}

/**
 * Đánh dấu ĐÃ THU công nợ của một bên trong tháng → tạo/cập nhật một khoản Thu.
 * `collected=false` hoặc `amount=0` thì gỡ khoản thu của tháng đó.
 * `amount` bỏ trống khi collected=true nghĩa là thu TOÀN BỘ số phải thu.
 */
export async function collectReceivable(input: {
  partyId: string;
  month: string;
  collected: boolean;
  amount?: number;
}): Promise<CollectResult> {
  const entryId = receivableEntryId(input.partyId, input.month);
  if (!input.collected || input.amount === 0) {
    await deleteEntry(entryId);
    return { ok: true, collected: false, amount: 0 };
  }

  const party = (await getParties()).find((p) => p.id === input.partyId);
  if (!party) return { ok: false, collected: false, amount: 0, message: 'Không tìm thấy bên' };

  const value = input.amount ?? party.receivable;
  const partial = value < party.receivable;
  await upsertEntry({
    id: entryId,
    month: input.month,
    kind: 'thu',
    // Ghi rõ thu một phần để nhìn bảng Thu/Chi là biết còn nợ.
    name: partial ? `${party.name} (thu công nợ một phần)` : `${party.name} (thu công nợ)`,
    amount: value,
    date: todayIso(),
    recurring: false,
    partyId: input.partyId,
  });
  return { ok: true, collected: true, amount: value };
}
