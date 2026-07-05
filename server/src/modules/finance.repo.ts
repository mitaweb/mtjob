import { q } from '../db/client.js';

export interface Party {
  id: string;
  name: string;
  startDate: string;
  dueDay: number;
  receivable: number;
  notifyMemberIds: string[];
  note: string;
  active: boolean;
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
  };
}

export async function getParties(): Promise<Party[]> {
  return (await q('SELECT * FROM parties ORDER BY name')).map(rowToParty);
}

export async function upsertParty(p: Party): Promise<void> {
  await q(
    `INSERT INTO parties (party_id, name, start_date, due_day, receivable, notify_member_ids, note, active, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (party_id) DO UPDATE SET
       name = EXCLUDED.name, start_date = EXCLUDED.start_date, due_day = EXCLUDED.due_day,
       receivable = EXCLUDED.receivable, notify_member_ids = EXCLUDED.notify_member_ids,
       note = EXCLUDED.note, active = EXCLUDED.active`,
    [
      p.id, p.name, p.startDate || '', p.dueDay, p.receivable,
      p.notifyMemberIds.join(','), p.note || '', p.active, new Date().toISOString(),
    ],
  );
}

export async function deleteParty(id: string): Promise<void> {
  await q('DELETE FROM parties WHERE party_id = $1', [id]);
}

export async function getEntries(month: string): Promise<FinanceEntry[]> {
  return (await q('SELECT * FROM finance_entries WHERE month = $1 ORDER BY date, created_at', [month])).map(rowToEntry);
}

export async function addEntry(e: FinanceEntry): Promise<void> {
  await q(
    `INSERT INTO finance_entries (entry_id, month, kind, name, amount, date, recurring, party_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
    [e.id, e.month, e.kind, e.name, e.amount, e.date || '', e.recurring, e.partyId || '', new Date().toISOString()],
  );
}

/** Thêm hoặc cập nhật 1 khoản thu/chi theo entry_id (dùng cho khoản tự sinh như lương). */
export async function upsertEntry(e: FinanceEntry): Promise<void> {
  await q(
    `INSERT INTO finance_entries (entry_id, month, kind, name, amount, date, recurring, party_id, created_at)
     VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)
     ON CONFLICT (entry_id) DO UPDATE SET
       month = EXCLUDED.month, kind = EXCLUDED.kind, name = EXCLUDED.name, amount = EXCLUDED.amount,
       date = EXCLUDED.date, recurring = EXCLUDED.recurring, party_id = EXCLUDED.party_id`,
    [e.id, e.month, e.kind, e.name, e.amount, e.date || '', e.recurring, e.partyId || '', new Date().toISOString()],
  );
}

export async function deleteEntry(id: string): Promise<void> {
  await q('DELETE FROM finance_entries WHERE entry_id = $1', [id]);
}
