import 'dotenv/config';
import { DEFAULT_CONFIG, type AppConfig } from './types.js';
import { readObjects } from './sheets/repo.js';

const NUM_KEYS = new Set([
  'companyLat', 'companyLng', 'checkinRadiusM', 'monthlyReportDay',
  'bonusThreshold', 'bonusStep', 'bonusAmount',
]);

let cached: AppConfig | null = null;
let cachedAt = 0;
const TTL = 60_000;

/** App config: defaults overlaid with the Config tab (falls back to defaults if the sheet is unavailable). */
export async function getConfig(opts: { fresh?: boolean } = {}): Promise<AppConfig> {
  if (!opts.fresh && cached && Date.now() - cachedAt < TTL) return cached;
  const cfg: AppConfig = { ...DEFAULT_CONFIG };
  try {
    const rows = await readObjects('Config', { fresh: opts.fresh });
    for (const r of rows) {
      const key = r['Key'];
      const value = r['Value'];
      if (!key || value === undefined || value === '') continue;
      if (NUM_KEYS.has(key)) {
        (cfg as unknown as Record<string, unknown>)[key] = Number(value);
      } else if (key in cfg) {
        (cfg as unknown as Record<string, unknown>)[key] = value;
      }
    }
  } catch (e) {
    // Sheet not ready yet — defaults are fine for boot.
    console.warn('[config] dùng cấu hình mặc định:', (e as Error).message);
  }
  cached = cfg;
  cachedAt = Date.now();
  return cfg;
}

export function clearConfigCache(): void {
  cached = null;
}
