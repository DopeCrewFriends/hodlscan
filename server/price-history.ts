import type { PricePoint } from './types.js';

const GECKO_BASE = 'https://api.geckoterminal.com/api/v2/networks/solana';
const CACHE_TTL_MS = 1_800_000;

interface GeckoPoolsResponse {
  data?: { attributes?: { address?: string } }[];
}

interface GeckoOhlcvResponse {
  data?: { attributes?: { ohlcv_list?: number[][] } };
}

interface CacheEntry {
  fetchedAt: number;
  points: PricePoint[];
}

const cache = new Map<string, CacheEntry>();

async function fetchJson<T>(url: string): Promise<T> {
  const response = await fetch(url, {
    headers: { accept: 'application/json' },
  });
  if (!response.ok) {
    throw new Error(`GeckoTerminal request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

async function resolveTopPool(mint: string): Promise<string | null> {
  const { data } = await fetchJson<GeckoPoolsResponse>(
    `${GECKO_BASE}/tokens/${mint}/pools?page=1`,
  );
  return data?.[0]?.attributes?.address ?? null;
}

async function fetchOhlcv(
  pool: string,
  timeframe: 'day' | 'hour',
): Promise<PricePoint[]> {
  const { data } = await fetchJson<GeckoOhlcvResponse>(
    `${GECKO_BASE}/pools/${pool}/ohlcv/${timeframe}?limit=1000&currency=usd`,
  );
  const list = data?.attributes?.ohlcv_list ?? [];
  const points: PricePoint[] = [];
  for (const candle of list) {
    const [unixSeconds, , , , close] = candle;
    if (typeof unixSeconds === 'number' && typeof close === 'number') {
      points.push({ t: new Date(unixSeconds * 1000).toISOString(), close });
    }
  }
  return points;
}

function mergeSeries(...series: PricePoint[][]): PricePoint[] {
  const byTime = new Map<string, PricePoint>();
  for (const points of series) {
    for (const point of points) {
      byTime.set(point.t, point);
    }
  }
  return [...byTime.values()].sort((left, right) =>
    left.t.localeCompare(right.t),
  );
}

export async function fetchPriceHistory(mint: string): Promise<PricePoint[]> {
  const cached = cache.get(mint);
  if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
    return cached.points;
  }

  try {
    const pool = await resolveTopPool(mint);
    if (!pool) {
      return cached?.points ?? [];
    }

    const [daily, hourly] = await Promise.all([
      fetchOhlcv(pool, 'day'),
      fetchOhlcv(pool, 'hour'),
    ]);
    const points = mergeSeries(daily, hourly);
    cache.set(mint, { fetchedAt: Date.now(), points });
    return points;
  } catch {
    return cached?.points ?? [];
  }
}
