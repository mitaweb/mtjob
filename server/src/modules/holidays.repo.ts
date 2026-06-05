import { readObjects } from '../sheets/repo.js';
import type { HolidaySet } from '../lib/workdays.js';

/** Set of holiday dates ('YYYY-MM-DD') from the Holidays tab. */
export async function getHolidaySet(): Promise<HolidaySet> {
  const rows = await readObjects('Holidays');
  return new Set(rows.map((r) => (r['Date'] || '').trim()).filter(Boolean));
}
