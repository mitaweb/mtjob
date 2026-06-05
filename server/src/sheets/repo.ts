// Generic repository over the Google Sheet "database":
//  - reads are cached in RAM (short TTL) to dodge Sheets rate limits
//  - writes are serialized through a promise queue to avoid row races
import { sheetsClient, dbId } from './client.js';
import type { TabName } from './schema.js';

export type Row = Record<string, string>;

const CACHE_TTL_MS = 15_000;
interface Cached {
  at: number;
  rows: Row[];
}
const cache = new Map<string, Cached>();

// Serialize all mutations so concurrent updates don't clobber each other.
let writeChain: Promise<unknown> = Promise.resolve();
function enqueue<T>(fn: () => Promise<T>): Promise<T> {
  const run = writeChain.then(fn, fn);
  writeChain = run.catch(() => undefined);
  return run as Promise<T>;
}

export function invalidate(tab?: string): void {
  if (tab) cache.delete(tab);
  else cache.clear();
}

function toObjects(values: unknown[][]): Row[] {
  const header = (values[0] ?? []).map((h) => String(h));
  return values.slice(1).map((row) => {
    const o: Row = {};
    header.forEach((h, i) => {
      o[h] = row[i] != null ? String(row[i]) : '';
    });
    return o;
  });
}

/** Read all rows of a tab as objects keyed by header. Cached. */
export async function readObjects(tab: TabName | string, opts: { fresh?: boolean } = {}): Promise<Row[]> {
  const key = String(tab);
  const c = cache.get(key);
  if (!opts.fresh && c && Date.now() - c.at < CACHE_TTL_MS) return c.rows;
  const res = await sheetsClient().spreadsheets.values.get({ spreadsheetId: dbId(), range: key });
  const rows = toObjects((res.data.values as unknown[][]) ?? []);
  cache.set(key, { at: Date.now(), rows });
  return rows;
}

async function readHeader(tab: string): Promise<string[]> {
  const res = await sheetsClient().spreadsheets.values.get({
    spreadsheetId: dbId(),
    range: `${tab}!1:1`,
  });
  return ((res.data.values?.[0] as unknown[]) ?? []).map((h) => String(h));
}

function serialize(v: unknown): string {
  if (v === null || v === undefined) return '';
  if (v instanceof Date) return v.toISOString();
  if (typeof v === 'boolean') return v ? 'TRUE' : 'FALSE';
  return String(v);
}

/** Append one record (mapped to the tab's header order). */
export async function appendObject(tab: TabName | string, obj: Record<string, unknown>): Promise<void> {
  await enqueue(async () => {
    const header = await readHeader(String(tab));
    const row = header.map((col) => serialize(obj[col]));
    await sheetsClient().spreadsheets.values.append({
      spreadsheetId: dbId(),
      range: String(tab),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values: [row] },
    });
    invalidate(String(tab));
  });
}

/** Append many records in a single call. */
export async function appendObjects(tab: TabName | string, objs: Record<string, unknown>[]): Promise<void> {
  if (objs.length === 0) return;
  await enqueue(async () => {
    const header = await readHeader(String(tab));
    const values = objs.map((obj) => header.map((col) => serialize(obj[col])));
    await sheetsClient().spreadsheets.values.append({
      spreadsheetId: dbId(),
      range: String(tab),
      valueInputOption: 'RAW',
      insertDataOption: 'INSERT_ROWS',
      requestBody: { values },
    });
    invalidate(String(tab));
  });
}

/** Update the first row where matchCol === matchVal with the given patch. Returns true if found. */
export async function updateWhere(
  tab: TabName | string,
  matchCol: string,
  matchVal: string,
  patch: Record<string, unknown>,
): Promise<boolean> {
  return enqueue(async () => {
    const res = await sheetsClient().spreadsheets.values.get({ spreadsheetId: dbId(), range: String(tab) });
    const values = ((res.data.values as unknown[][]) ?? []).map((r) => r.map((c) => (c != null ? String(c) : '')));
    const header = values[0] ?? [];
    const ci = header.indexOf(matchCol);
    if (ci < 0) return false;
    for (let r = 1; r < values.length; r++) {
      const row = values[r] ?? [];
      if (String(row[ci] ?? '') === matchVal) {
        for (const [k, v] of Object.entries(patch)) {
          const j = header.indexOf(k);
          if (j >= 0) row[j] = serialize(v);
        }
        while (row.length < header.length) row.push('');
        await sheetsClient().spreadsheets.values.update({
          spreadsheetId: dbId(),
          range: `${tab}!A${r + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [row] },
        });
        invalidate(String(tab));
        return true;
      }
    }
    return false;
  });
}

/** Upsert by key column: update if present, else append. */
export async function upsertByKey(
  tab: TabName | string,
  keyCol: string,
  obj: Record<string, unknown>,
): Promise<void> {
  const keyVal = serialize(obj[keyCol]);
  const updated = await updateWhere(tab, keyCol, keyVal, obj);
  if (!updated) await appendObject(tab, obj);
}

/** Update the first row matching ALL of `match` (composite key). Returns true if found. */
export async function updateWhereAll(
  tab: TabName | string,
  match: Record<string, string>,
  patch: Record<string, unknown>,
): Promise<boolean> {
  return enqueue(async () => {
    const res = await sheetsClient().spreadsheets.values.get({ spreadsheetId: dbId(), range: String(tab) });
    const values = ((res.data.values as unknown[][]) ?? []).map((r) => r.map((c) => (c != null ? String(c) : '')));
    const header = values[0] ?? [];
    const matchIdx = Object.entries(match).map(([k, v]) => [header.indexOf(k), v] as const);
    if (matchIdx.some(([i]) => i < 0)) return false;
    for (let r = 1; r < values.length; r++) {
      const row = values[r] ?? [];
      if (matchIdx.every(([i, v]) => String(row[i] ?? '') === v)) {
        for (const [k, v] of Object.entries(patch)) {
          const j = header.indexOf(k);
          if (j >= 0) row[j] = serialize(v);
        }
        while (row.length < header.length) row.push('');
        await sheetsClient().spreadsheets.values.update({
          spreadsheetId: dbId(),
          range: `${tab}!A${r + 1}`,
          valueInputOption: 'RAW',
          requestBody: { values: [row] },
        });
        invalidate(String(tab));
        return true;
      }
    }
    return false;
  });
}

/** Upsert by a composite key (multiple match columns). */
export async function upsertByKeys(
  tab: TabName | string,
  match: Record<string, string>,
  obj: Record<string, unknown>,
): Promise<void> {
  const updated = await updateWhereAll(tab, match, obj);
  if (!updated) await appendObject(tab, obj);
}
