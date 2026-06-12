import { q } from '../db/client.js';
import type { HolidaySet } from '../lib/workdays.js';

/** Set of holiday dates ('YYYY-MM-DD') from the holidays table. */
export async function getHolidaySet(): Promise<HolidaySet> {
  const rows = await q('SELECT date FROM holidays');
  return new Set(rows.map((r) => String(r.date || '').trim()).filter(Boolean));
}

export async function upsertHoliday(date: string, name: string): Promise<void> {
  await q(
    `INSERT INTO holidays (date, name, year) VALUES ($1,$2,$3)
     ON CONFLICT (date) DO UPDATE SET name = EXCLUDED.name, year = EXCLUDED.year`,
    [date, name, Number(date.slice(0, 4)) || null],
  );
}
