import { readObjects } from '../sheets/repo.js';
import type { TaskCatalogItem } from '../types.js';

function isInactive(s: string): boolean {
  return /^(false|0|no|khong|không|inactive)$/i.test((s || '').trim());
}

export async function getCatalog(): Promise<TaskCatalogItem[]> {
  const rows = await readObjects('TaskCatalog');
  return rows
    .filter((r) => (r['TaskCode'] || '').trim())
    .map((r) => ({
      code: (r['TaskCode'] || '').trim(),
      name: r['TaskName'] || '',
      points: Number(r['Points'] || 0) || 0,
      active: !isInactive(r['Active'] || ''),
      note: r['Note'] || '',
    }));
}

export async function getActiveCatalog(): Promise<TaskCatalogItem[]> {
  return (await getCatalog()).filter((c) => c.active);
}

export async function findCatalogItem(code: string): Promise<TaskCatalogItem | undefined> {
  const c = code.trim().toUpperCase();
  return (await getCatalog()).find((x) => x.code.toUpperCase() === c);
}
