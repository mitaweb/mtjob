import { q } from '../db/client.js';
import type { PartyRate, PartyKind } from '../lib/finance.js';

export interface Party {
  id: string;
  name: string;
  startDate: string;
  dueDay: number;
  receivable: number;
  notifyMemberIds: string[];
  note: string;
  active: boolean;
  /** Nguồn khách của bên này — mọi khoản thu sinh ra từ đây đều mang nguồn này. */
  source: string;
  /** 'monthly' = thu hàng tháng; 'once' = khoản một lần, `receivable` là tổng hợp đồng. */
  kind: PartyKind;
}

export interface FinanceEntry {
  id: string;
  month: string; // YYYY-MM
  kind: 'thu' | 'chi';
  name: string;
  amount: number;
  date: string;
  recurring: boolean;
  partyId: string;
  /** Nguồn khách của khoản thu — để thống kê doanh thu theo nguồn. */
  source: string;
  /** Khách hàng CRM gắn với khoản này (nếu có). */
  customerId: string;
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToParty(r: any): Party {
  return {
    id: r.party_id || '',
    name: r.name || '',
    startDate: r.start_date || '',
    dueDay: Number(r.due_day || 1) || 1,
    receivable: Number(r.receivable || 0) || 0,
    notifyMemberIds: String(r.notify_member_ids || '').split(',').map((s: string) => s.trim()).filter(Boolean),
    note: r.note || '',
    active: !!r.active,
    source: r.source || '',
    kind: r.kind === 'once' ? 'once' : 'monthly',
  };
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function rowToEntry(r: any): FinanceEntry {
  return {
    id: r.entry_id || '',
    month: r.month || '',
    kind: (r.kind === 'chi' ? 'chi' : 'thu') as 'thu' | 'chi',
    name: r.name || '',
    amount: Number(r.amount || 0) || 0,
    date: r.date || '',
    recurring: !!r.recurring,
    partyId: r.party_id || '',
    source: r.source || '',
    customerId: r.customer_id || '',
  };
}

export async function getParties(): Promise<Party[]> {
  return (await q('SELECT * FROM parties ORDER BY name')).map(rowToParty);
}

export async function upsertParty(p: Party): Promise<void> {
  await q(
    `INSERT INTO parties (party_id, name, start_date, due_day, receivable, notify_member_ids, note, active, source, kind, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (party_id) DO UPDATE SET
       name = EXCLUDED.name, start_date = EXCLUDED.start_date, due_day = EXCLUDED.due_day,
       receivable = EXCLUDED.receivable, notify_member_ids = EXCLUDED.notify_member_ids,
       note = EXCLUDED.note, active = EXCLUDED.active, source = EXCLUDED.source, kind = EXCLUDED.kind`,
    [
      p.id, p.name, p.startDate || '', p.dueDay, p.receivable,
      p.notifyMemberIds.join(','), p.note || '', p.active, p.source || '', p.kind || 'monthly', new Date().toISOString(),
    ],
  );
}

export async function deleteParty(id: string): Promise<void> {
  // Không có khoá ngoại — dọn lịch sử mức bằng tay, không thì bên mới trùng mã thừa kế mức cũ.
  await q('DELETE FROM party_rates WHERE party_id = $1', [id]);
  await q('DELETE FROM parties WHERE party_id = $1', [id]);
}

// ---- Lịch sử mức phải thu (party_rates) ----

export const SQL_DOC_MUC = 'SELECT party_id, from_month, receivable FROM party_rates ORDER BY party_id, from_month';
export const SQL_GHI_MUC = `INSERT INTO party_rates (party_id, from_month, receivable) VALUES ($1,$2,$3)
  ON CONFLICT (party_id, from_month) DO UPDATE SET receivable = EXCLUDED.receivable`;
export const SQL_XOA_MUC = 'DELETE FROM party_rates WHERE party_id = $1';

/** Lịch sử mức của MỌI bên, mỗi bên một mảng xếp theo tháng tăng dần. */
export async function getPartyRates(): Promise<Map<string, PartyRate[]>> {
  const out = new Map<string, PartyRate[]>();
  for (const r of await q(SQL_DOC_MUC)) {
    const id = String(r.party_id || '');
    const arr = out.get(id) || [];
    arr.push({ fromMonth: String(r.from_month || ''), receivable: Number(r.receivable) || 0 });
    out.set(id, arr);
  }
  return out;
}

export async function upsertPartyRate(partyId: string, fromMonth: string, receivable: number): Promise<void> {
  await q(SQL_GHI_MUC, [partyId, fromMonth, Math.max(0, Math.round(receivable) || 0)]);
}

/** Xoá hết lịch sử — dùng khi người sửa chọn "sửa cả các tháng trước". */
export async function deletePartyRates(partyId: string): Promise<void> {
  await q(SQL_XOA_MUC, [partyId]);
}

export async function getEntries(month: string): Promise<FinanceEntry[]> {
  return (await q('SELECT * FROM finance_entries WHERE month = $1 ORDER BY date, created_at', [month])).map(rowToEntry);
}

export async function addEntry(e: FinanceEntry): Promise<void> {
  await q(
    `INSERT INTO finance_entries (entry_id, month, kind, name, amount, date, recurring, party_id, source, customer_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`,
    [
      e.id, e.month, e.kind, e.name, e.amount, e.date || '', e.recurring, e.partyId || '',
      e.source || '', e.customerId || '', new Date().toISOString(),
    ],
  );
}

/** Thêm hoặc cập nhật 1 khoản thu/chi theo entry_id (dùng cho khoản tự sinh như lương). */
export async function upsertEntry(e: FinanceEntry): Promise<void> {
  await q(
    `INSERT INTO finance_entries (entry_id, month, kind, name, amount, date, recurring, party_id, source, customer_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
     ON CONFLICT (entry_id) DO UPDATE SET
       month = EXCLUDED.month, kind = EXCLUDED.kind, name = EXCLUDED.name, amount = EXCLUDED.amount,
       date = EXCLUDED.date, recurring = EXCLUDED.recurring, party_id = EXCLUDED.party_id,
       source = EXCLUDED.source, customer_id = EXCLUDED.customer_id`,
    [
      e.id, e.month, e.kind, e.name, e.amount, e.date || '', e.recurring, e.partyId || '',
      e.source || '', e.customerId || '', new Date().toISOString(),
    ],
  );
}

export async function deleteEntry(id: string): Promise<void> {
  await q('DELETE FROM finance_entries WHERE entry_id = $1', [id]);
}

/**
 * Tổng đã thu công nợ của MỌI bên, gom theo (bên, kỳ).
 *
 * Một lượt truy vấn cho cả bảng thay vì hỏi từng bên — với 16 bên là 16 lượt HTTP tới
 * Neon, đủ làm trang Tài chính ì hẳn.
 */
export async function paidByPartyMonth(fromMonth: string): Promise<Record<string, Record<string, number>>> {
  const rows = await q(
    `SELECT party_id, month, SUM(amount)::int AS total
     FROM finance_entries
     WHERE kind = 'thu' AND party_id <> '' AND month >= $1
     GROUP BY party_id, month`,
    [fromMonth],
  );
  const out: Record<string, Record<string, number>> = {};
  for (const r of rows) {
    const pid = String(r.party_id || '');
    if (!pid) continue;
    (out[pid] ||= {})[String(r.month || '')] = Number(r.total || 0) || 0;
  }
  return out;
}
