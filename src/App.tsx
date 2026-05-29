import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_BASE_URL || '';
const API_KEY_STORAGE = 'hodlscan_api_key';
const PRO_COMING_SOON = true;
const AUTO_REFRESH_SECONDS = 60;
const DIAMOND_HANDS_IMAGE = '/assets/dhands.webp';
const DIAMOND_HANDS_DAYS = 90;
const MAX_HISTOGRAM_BARS = 56;
const HOLDERS_PAGE_SIZE = 100;
const holderTimeFilters = [
  { id: 'all', label: 'all' },
  { id: 'under-1d', label: '< 1d', min: 0, max: 1 },
  { id: '1-7d', label: '1-7d', min: 1, max: 7 },
  { id: '7-30d', label: '7-30d', min: 7, max: 30 },
  { id: '30-90d', label: '30-90d', min: 30, max: 90 },
  { id: '90d-plus', label: '90d+', min: 90 },
] as const;
const chartTimeFilters = [
  { id: '1d', label: '1d', days: 1, maxBars: 96, bucketMinutes: 15 },
  { id: '7d', label: '7d', days: 7, maxBars: 96, bucketMinutes: 120 },
  { id: '30d', label: '30d', days: 30, maxBars: 160, bucketMinutes: 1440 },
  { id: '60d', label: '60d', days: 60, maxBars: 200, bucketMinutes: 1440 },
  { id: '90d', label: '90d', days: 90, maxBars: 220, bucketMinutes: 1440 },
  {
    id: 'all',
    label: 'all',
    days: Number.POSITIVE_INFINITY,
    maxBars: 400,
    bucketMinutes: 1440,
  },
] as const;
const percentFormatter = new Intl.NumberFormat('en-US', {
  maximumFractionDigits: 2,
  minimumFractionDigits: 2,
});
const compactFormatter = new Intl.NumberFormat('en-US', {
  notation: 'compact',
  maximumFractionDigits: 2,
});
const wholeNumberFormatter = new Intl.NumberFormat('en-US');
const usdFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  maximumFractionDigits: 2,
});
const usdCompactFormatter = new Intl.NumberFormat('en-US', {
  style: 'currency',
  currency: 'USD',
  notation: 'compact',
  maximumFractionDigits: 2,
});
function formatPriceUsd(value: number) {
  if (!Number.isFinite(value) || value <= 0) {
    return '$0';
  }
  if (value >= 1) {
    return usdCompactFormatter.format(value);
  }
  const digits = Math.min(8, Math.max(2, Math.ceil(-Math.log10(value)) + 2));
  return `$${value.toFixed(digits)}`;
}

const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface HomePreviewMetrics {
  holderCount: number | null;
  diamondHandsPct: number | null;
  averageHolderAgeDays: number | null;
}

interface TrackedCoinPreview {
  mint: string;
  metadata: TokenInfo['metadata'];
  scannedAt: string | null;
  metrics: HomePreviewMetrics | null;
}

interface ApiAccessMeta {
  tier: 'free' | 'pro';
  limits: {
    coldScanLimit: number;
    warmReadLimit: number;
  };
  rateLimit?: {
    coldScansRemaining: number;
    warmReadsRemaining: number;
    resetsAt: string;
  };
  cache?: {
    fresh: boolean;
    scannedAt: string;
    refreshAfter: string;
  };
  features: {
    holderCountHistory: boolean;
  };
}

interface TokenInfo {
  mint: string;
  trackedMint: string;
  trackedMints?: string[];
  tracking: 'lite' | 'full';
  endpoints: string[];
  maxDisplayHolders: number;
  access?: ApiAccessMeta;
  metadata: {
    name: string | null;
    symbol: string | null;
    uri: string | null;
    image: string | null;
    description: string | null;
    source: string;
    error?: string;
  };
}

interface WalletPortfolioToken {
  mint: string;
  name: string | null;
  symbol: string | null;
  image: string | null;
  decimals: number;
  uiAmount: number;
  priceUsd: number | null;
  valueUsd: number | null;
  isTracked: boolean;
}

interface WalletPortfolio {
  owner: string;
  solBalance: number;
  solValueUsd: number | null;
  totalValueUsd: number;
  tokenCount: number;
  tokens: WalletPortfolioToken[];
  fetchedAt: string;
  cached: boolean;
}

interface Snapshot {
  id: number;
  mint: string;
  slot: number | null;
  status: 'complete' | 'partial' | 'failed';
  holder_count: number;
  new_holder_count: number;
  dropped_holder_count: number;
  total_supply: string;
  decimals: number;
  scanned_at: string;
  source: string;
  error: string | null;
}

interface Holder {
  owner: string;
  token_account: string;
  raw_amount: string;
  ui_amount: number;
  rank: number;
  pct_supply: number;
  first_seen_at: string | null;
  current_streak_started_at: string | null;
  historical_holding_since_at: string | null;
  historical_holding_source: string | null;
  wallet_type: 'wallet' | 'liquidity_pool' | 'program' | 'unknown';
  classification_source: string | null;
  classification_confidence: number;
  exclude_from_holder_stats: boolean;
  current_holder_age_days: number;
  holding_time_source: string;
  previous_rank: number | null;
}

interface HolderResponse {
  tracking?: 'lite' | 'full';
  access?: ApiAccessMeta;
  snapshot: Snapshot | null;
  holders: Holder[];
  metrics: {
    top10Pct: number;
    top20Pct: number;
    averageHolderAgeDays: number;
    oldestHolderAgeDays: number;
    diamondHandsPct: number;
    holderCount: number;
    newHolderCount: number;
    droppedHolderCount: number;
    excludedLiquidityPoolCount: number;
    excludedLiquidityPoolPct: number;
  } | null;
  distribution: Array<{
    label: string;
    holderCount: number;
    pctSupply: number;
    averageAgeDays: number;
  }>;
}

interface PricePoint {
  t: string;
  close: number;
}

interface HistoryPoint {
  id: number;
  scanned_at: string;
  holder_count: number;
  new_holder_count: number;
  dropped_holder_count: number;
  top_10_pct: number;
  top_20_pct: number;
  status: string;
  source: string;
}

type HolderTimeFilterId = (typeof holderTimeFilters)[number]['id'];
type ChartTimeFilterId = (typeof chartTimeFilters)[number]['id'];
type HolderSortKey = 'rank' | 'balance' | 'supply' | 'holding';
type SortDirection = 'asc' | 'desc';

const SOLSCAN_TOKEN_URL = 'https://solscan.io/token/';
const SOLSCAN_ACCOUNT_URL = 'https://solscan.io/account/';
const PADRE_TERMINAL_URL = 'https://trade.padre.gg/rk/zil';
const TRACKED_ROUTE = '__tracked__';

function getRouteMint() {
  if (/^\/tracked\/?$/.test(window.location.pathname)) {
    return TRACKED_ROUTE;
  }
  const match = window.location.pathname.match(/^\/coin\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getRoutePro() {
  return /^\/pro\/?$/.test(window.location.pathname);
}

function getRouteWallet() {
  const match = window.location.pathname.match(/^\/wallet\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function readStoredApiKey() {
  try {
    return localStorage.getItem(API_KEY_STORAGE)?.trim() || '';
  } catch {
    return '';
  }
}

function mintQuery(mint?: string | null) {
  return mint ? `?mint=${encodeURIComponent(mint)}` : '';
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const apiKey = readStoredApiKey();
  const headers = new Headers(init?.headers);
  if (apiKey) {
    headers.set('x-hodlscan-api-key', apiKey);
  }

  const response = await fetch(`${apiBase}${path}`, {
    ...init,
    headers,
  });
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
}

function formatRelativeScanTime(value: string, nowMs: number) {
  const ageMs = Math.max(0, nowMs - new Date(value).getTime());
  const minutes = Math.floor(ageMs / 60_000);
  if (minutes < 1) {
    return 'just now';
  }
  if (minutes < 60) {
    return `${minutes}m ago`;
  }
  const hours = Math.floor(minutes / 60);
  return `${hours}h ago`;
}

function formatNumber(value: number, digits = 2) {
  if (digits === 2) {
    return percentFormatter.format(value);
  }

  return new Intl.NumberFormat('en-US', {
    maximumFractionDigits: digits,
    minimumFractionDigits: digits,
  }).format(value);
}

function formatCompact(value: number) {
  return compactFormatter.format(value);
}

function formatAge(days: number | null | undefined) {
  const safeDays = Number.isFinite(days) ? Number(days) : 0;
  if (safeDays < 1) {
    return `${Math.max(0, safeDays * 24).toFixed(1)}h`;
  }
  return `${safeDays.toFixed(1)}d`;
}

function ageGradientStyle(
  days: number | null | undefined,
  minAge: number,
  maxAge: number,
) {
  const safeDays = Number.isFinite(days) ? Number(days) : 0;
  const range = Math.max(maxAge - minAge, 1);
  const intensity = Math.min(1, Math.max(0, (safeDays - minAge) / range));
  const hue = intensity < 0.5
    ? 350 + intensity * 80
    : 30 + (intensity - 0.5) * 240;
  const saturation = 92 + intensity * 6;
  const lightness = 60 + intensity * 8;

  return {
    color: `hsl(${hue} ${saturation}% ${lightness}%)`,
  };
}

function shortAddress(address: string) {
  return `${address.slice(0, 5)}…${address.slice(-5)}`;
}

function isDiamondHands(days: number | null | undefined) {
  return Number.isFinite(days) && Number(days) >= DIAMOND_HANDS_DAYS;
}

function isExcludedHolder(holder: Holder) {
  return holder.exclude_from_holder_stats;
}

function formatWalletType(type: Holder['wallet_type']) {
  if (type === 'liquidity_pool') {
    return 'LP';
  }
  return type;
}

function formatRankChange(
  holder: Holder,
  hasRankBaseline: boolean,
): { label: string; tone: 'good' | 'bad' | 'neutral' } | null {
  if (!hasRankBaseline) {
    return null;
  }

  if (holder.previous_rank == null) {
    return { label: 'new', tone: 'neutral' };
  }

  if (holder.previous_rank === holder.rank) {
    return null;
  }

  const delta = holder.previous_rank - holder.rank;
  if (delta > 0) {
    return { label: `↑${delta}`, tone: 'good' };
  }

  return { label: `↓${Math.abs(delta)}`, tone: 'bad' };
}

function sortIndicator(
  activeKey: HolderSortKey,
  sortKey: HolderSortKey,
  direction: SortDirection,
) {
  if (activeKey !== sortKey) {
    return '';
  }

  return direction === 'asc' ? ' ↑' : ' ↓';
}

async function copyText(value: string) {
  if (navigator.clipboard?.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }

  const textarea = document.createElement('textarea');
  textarea.value = value;
  textarea.style.position = 'fixed';
  textarea.style.opacity = '0';
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand('copy');
  document.body.removeChild(textarea);
}

function formatDistributionLabel(label: string) {
  return label.replace(/^top\b/i, 'Top');
}

function formatDateTime(value: string | null | undefined) {
  return value ? dateTimeFormatter.format(new Date(value)) : 'n/a';
}

function formatRelativeTime(value: string | null | undefined, nowMs: number) {
  if (!value) {
    return 'no scan yet';
  }

  const elapsedSeconds = Math.max(
    0,
    Math.floor((nowMs - new Date(value).getTime()) / 1000),
  );
  if (elapsedSeconds < 60) {
    return `${elapsedSeconds}s ago`;
  }

  const elapsedMinutes = Math.floor(elapsedSeconds / 60);
  if (elapsedMinutes < 60) {
    return `${elapsedMinutes}m ago`;
  }

  const elapsedHours = Math.floor(elapsedMinutes / 60);
  if (elapsedHours < 24) {
    return `${elapsedHours}h ago`;
  }

  const elapsedDays = Math.floor(elapsedHours / 24);
  return `${elapsedDays}d ago`;
}

function matchesHolderTimeFilter(holder: Holder, filterId: HolderTimeFilterId) {
  const filter = holderTimeFilters.find((item) => item.id === filterId);
  if (!filter || filter.id === 'all') {
    return true;
  }

  const days = holder.current_holder_age_days;
  if ('min' in filter && filter.min !== undefined && days < filter.min) {
    return false;
  }
  if ('max' in filter && filter.max !== undefined && days >= filter.max) {
    return false;
  }

  return true;
}

function bucketByMinutes(
  points: HistoryPoint[],
  minutes: number,
): HistoryPoint[] {
  if (minutes <= 0) {
    return points;
  }
  const slotMs = minutes * 60 * 1000;
  const bySlot = new Map<number, HistoryPoint>();
  for (const point of points) {
    const slot = Math.floor(new Date(point.scanned_at).getTime() / slotMs);
    const existing = bySlot.get(slot);
    // Keep the latest snapshot within each time slot.
    if (!existing || point.scanned_at > existing.scanned_at) {
      bySlot.set(slot, point);
    }
  }
  return [...bySlot.values()].sort((left, right) =>
    left.scanned_at.localeCompare(right.scanned_at),
  );
}

function sampleHistoryPoints(points: HistoryPoint[], maxPoints: number) {
  if (points.length <= maxPoints) {
    return points;
  }

  const sampled: HistoryPoint[] = [];
  const bucketSize = points.length / maxPoints;
  for (let index = 0; index < maxPoints; index += 1) {
    const pointIndex = Math.min(
      points.length - 1,
      Math.floor((index + 1) * bucketSize) - 1,
    );
    sampled.push(points[pointIndex]);
  }

  return sampled;
}

function StatCard({
  label,
  value,
  tone,
  compact,
  valueStyle,
  valueIcon,
  skeleton,
}: {
  label: ReactNode;
  value: string;
  tone?: 'good' | 'bad';
  compact?: boolean;
  valueStyle?: CSSProperties;
  valueIcon?: ReactNode;
  skeleton?: boolean;
}) {
  return (
    <section className={`panel stat-card${compact ? ' stat-card-compact' : ''}`}>
      <span className="label stat-label">{label}</span>
      {skeleton ? (
        <span className="skeleton skeleton-stat" aria-hidden="true" />
      ) : (
        <strong
          className={`stat-value${tone ? ` tone-${tone}` : ''}`}
          style={valueStyle}
        >
          {value}
          {valueIcon}
        </strong>
      )}
    </section>
  );
}

function buildPlaceholderToken(mint: string, trackedMint?: string): TokenInfo {
  return {
    mint,
    trackedMint: trackedMint || mint,
    tracking: 'lite',
    endpoints: [],
    maxDisplayHolders: 500,
    metadata: {
      name: null,
      symbol: null,
      uri: null,
      image: null,
      description: null,
      source: 'placeholder',
    },
  };
}

function DashboardSkeletonRows({ count }: { count: number }) {
  return (
    <>
      {Array.from({ length: count }, (_, index) => (
        <div className="table-row skeleton-table-row" key={index} aria-hidden="true">
          <span className="skeleton skeleton-cell skeleton-cell-rank" />
          <span className="skeleton skeleton-cell skeleton-cell-wallet" />
          <span className="skeleton skeleton-cell skeleton-cell-balance" />
          <span className="skeleton skeleton-cell skeleton-cell-supply" />
          <span className="skeleton skeleton-cell skeleton-cell-holding" />
        </div>
      ))}
    </>
  );
}

function DistributionSkeleton() {
  return (
    <>
      <div className="distribution-row distribution-head">
        <span>Bracket</span>
        <span>Supply</span>
        <span>Avg age</span>
      </div>
      {['Top 10', 'Top 50', 'Top 100', 'Top 250', 'Top 500'].map((label) => (
        <div className="distribution-row" key={label} aria-hidden="true">
          <span>{label}</span>
          <span className="skeleton skeleton-distribution-value" />
          <span className="skeleton skeleton-distribution-value" />
        </div>
      ))}
    </>
  );
}

function ChartSkeleton() {
  return (
    <div className="histogram-skeleton" aria-hidden="true">
      {Array.from({ length: 24 }, (_, index) => (
        <span
          className="skeleton histogram-skeleton-bar"
          key={index}
          style={{ height: `${28 + ((index * 17) % 55)}%` }}
        />
      ))}
    </div>
  );
}

function FakeHistogramChart({ seed = 1 }: { seed?: number }) {
  const bars = useMemo(
    () =>
      Array.from({ length: 36 }, (_, index) => {
        const t = Math.sin((index + seed) * 12.9898) * 43758.5453;
        const noise = t - Math.floor(t);
        const wave = (Math.sin((index + seed) / 4.5) + 1) / 2;
        return 14 + noise * 38 + wave * 34;
      }),
    [seed],
  );
  const scaleMax = 1200 + (seed % 7) * 180;
  const scaleMin = scaleMax - 420 - (seed % 5) * 40;

  return (
    <div className="histogram-chart histogram-chart-preview" aria-hidden="true">
      <div className="histogram-scale">
        <span>{wholeNumberFormatter.format(scaleMax)}</span>
        <span>{wholeNumberFormatter.format(scaleMin)}</span>
      </div>
      <div className="histogram-plot">
        <div className="histogram-bars">
          {bars.map((height, index) => (
            <div className="histogram-bar histogram-bar-preview" key={index}>
              <div
                className={
                  index === bars.length - 1
                    ? 'histogram-fill histogram-fill-preview histogram-fill-preview-latest'
                    : 'histogram-fill histogram-fill-preview'
                }
                style={{ height: `${height}%` }}
              />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function LockedLiteChart({
  seed,
  onNavigateToPro,
}: {
  seed: number;
  onNavigateToPro: () => void;
}) {
  return (
    <div className="histogram-locked">
      <div className="histogram-locked-preview">
        <FakeHistogramChart seed={seed} />
      </div>
      <div className="histogram-locked-overlay">
        <span className="kicker">Pro</span>
        <p>Upgrade to Pro to view hodler count history on searched coins.</p>
        <button type="button" className="histogram-locked-cta" onClick={onNavigateToPro}>
          Pro access
        </button>
      </div>
    </div>
  );
}

function TrackedCoinCardSkeleton() {
  return (
    <div className="home-tracked-coin home-tracked-coin-skeleton" aria-hidden="true">
      <div className="home-tracked-coin-layout">
        <span className="skeleton skeleton-tracked-image" />
        <div className="home-tracked-coin-main">
          <div className="home-tracked-coin-title-row">
            <div className="home-tracked-coin-title">
              <span className="skeleton skeleton-tracked-name" />
              <span className="skeleton skeleton-tracked-symbol" />
            </div>
            <span className="skeleton skeleton-tracked-open" />
          </div>
          <span className="skeleton skeleton-tracked-copy" />
        </div>
      </div>
      <div className="home-stat-row">
        <span className="skeleton skeleton-stat-block" />
        <span className="skeleton skeleton-stat-block" />
        <span className="skeleton skeleton-stat-block" />
      </div>
    </div>
  );
}

function TrackedCoinCard({
  coin,
  loading,
  onOpen,
}: {
  coin: TrackedCoinPreview;
  loading: boolean;
  onOpen: (mint: string) => void;
}) {
  const symbol = coin.metadata.symbol || coin.mint.slice(0, 4);
  const name = coin.metadata.name || symbol;

  return (
    <button
      type="button"
      className="home-tracked-coin"
      aria-label={`Open ${name} dashboard`}
      onClick={() => onOpen(coin.mint)}
    >
      <div className="home-tracked-coin-layout">
        <div className="token-image-frame home-tracked-image">
          {coin.metadata.image ? (
            <img src={coin.metadata.image} alt={name} />
          ) : (
            <span>{symbol.slice(0, 3)}</span>
          )}
        </div>
        <div className="home-tracked-coin-main">
          <div className="home-tracked-coin-title-row">
            <div className="home-tracked-coin-title">
              <strong>{name}</strong>
              <span className="home-tracked-symbol">${symbol}</span>
            </div>
            <span className="home-tracked-open" aria-hidden="true">
              <span className="home-tracked-open-label">Open</span>
              <span className="home-tracked-open-arrow">→</span>
            </span>
          </div>
          <p className="home-tracked-coin-copy">
            Full hodler history, rank changes, price overlay, and auto-refresh.
          </p>
        </div>
      </div>
      <div className="home-stat-row">
        <div className="home-stat">
          <small>total hodlers</small>
          {loading ? (
            <span className="skeleton skeleton-stat" aria-hidden="true" />
          ) : (
            <strong>
              {coin.metrics?.holderCount != null
                ? wholeNumberFormatter.format(coin.metrics.holderCount)
                : '—'}
            </strong>
          )}
        </div>
        <div className="home-stat">
          <small>diamond hands</small>
          {loading ? (
            <span className="skeleton skeleton-stat" aria-hidden="true" />
          ) : (
            <strong>
              {coin.metrics?.diamondHandsPct != null
                ? `${formatNumber(coin.metrics.diamondHandsPct)}%`
                : '—'}
            </strong>
          )}
        </div>
        <div className="home-stat">
          <small>avg hodl</small>
          {loading ? (
            <span className="skeleton skeleton-stat" aria-hidden="true" />
          ) : (
            <strong>
              {coin.metrics?.averageHolderAgeDays != null
                ? formatAge(coin.metrics.averageHolderAgeDays)
                : '—'}
            </strong>
          )}
        </div>
      </div>
      {coin.scannedAt ? (
        <span className="home-tracked-coin-meta">
          Last scan {formatRelativeScanTime(coin.scannedAt, Date.now())}
        </span>
      ) : null}
    </button>
  );
}

function HomePage({
  trackedCoins,
  trackedLoading,
  onOpenTracked,
  onFocusSearch,
}: {
  trackedCoins: TrackedCoinPreview[];
  trackedLoading: boolean;
  onOpenTracked: (mint: string) => void;
  onFocusSearch: () => void;
}) {
  const showSkeletons = trackedLoading && trackedCoins.length === 0;

  return (
    <section className="home-page">
      <section className="home-hero panel">
        <div className="home-hero-grid">
          <div className="home-hero-copyblock">
            <span className="kicker">Solana holder analytics</span>
            <h1>
              See who is
              <span className="home-hero-accent"> really hodling.</span>
            </h1>
            <p className="home-hero-copy">
              Live holder scans for any mint. Deep history and rank tracking for
              coins we monitor full-time.
            </p>
            <div className="home-hero-pills">
              <span className="home-pill">on-chain hold times</span>
              <span className="home-pill">supply distribution</span>
              <span className="home-pill">hourly refresh</span>
            </div>
          </div>
          <div className="home-hero-visual" aria-hidden="true">
            <div className="home-hero-chart-wrap">
              <FakeHistogramChart seed={42} />
            </div>
            <div className="home-hero-visual-glow" />
          </div>
        </div>
      </section>

      <section className="home-steps panel">
        <div className="home-step">
          <span className="home-step-index">01</span>
          <strong>Search a mint</strong>
          <p>Paste any Solana token address in the bar above.</p>
        </div>
        <div className="home-step">
          <span className="home-step-index">02</span>
          <strong>Scan hodlers</strong>
          <p>Top wallets, supply brackets, and diamond hands stats.</p>
        </div>
        <div className="home-step">
          <span className="home-step-index">03</span>
          <strong>Track over time</strong>
          <p>Click a tracked coin below for full history and rank movement.</p>
        </div>
      </section>

      <section className="home-grid">
        <section className="panel home-tracked-section">
          <div className="panel-title home-tracked-section-head">
            <div className="home-tracked-section-head-inner">
              <div className="home-tracked-section-title-row">
                <span>Tracked coins</span>
                <small className="home-card-tag">live · full data</small>
              </div>
              <p className="home-tracked-section-lead">
                Click any coin to open its full dashboard — history, ranks, and
                live refresh.
              </p>
            </div>
          </div>
          <div className="home-tracked-list">
            {showSkeletons ? (
              <TrackedCoinCardSkeleton />
            ) : trackedCoins.length > 0 ? (
              trackedCoins.map((coin) => (
                <TrackedCoinCard
                  key={coin.mint}
                  coin={coin}
                  loading={trackedLoading}
                  onOpen={onOpenTracked}
                />
              ))
            ) : (
              <p className="home-tracked-empty">No tracked coins configured yet.</p>
            )}
          </div>
        </section>

        <section className="panel home-search-card">
          <div className="panel-title">
            <span>Search any coin</span>
            <small className="home-card-tag home-card-tag-muted">lite scan</small>
          </div>
          <div className="home-search-body">
            <p className="home-search-copy">
              Look up any Solana token mint for a live holder snapshot — top
              wallets, distribution, and on-chain hold times.
            </p>
            <button
              type="button"
              className="home-search-demo"
              onClick={onFocusSearch}
            >
              <span className="home-search-demo-label">Search tokens</span>
              <span className="home-search-demo-placeholder">Paste mint address…</span>
            </button>
            <ul className="home-feature-list">
              <li>Top 500 hodlers with pool labels</li>
              <li>Supply brackets and average ages</li>
              <li>Cached results refresh about hourly</li>
            </ul>
          </div>
        </section>
      </section>
    </section>
  );
}

function ProAccessPage({
  apiAccess,
  apiKeyValue,
  onApiKeyChange,
  onSave,
  onClear,
  saved,
}: {
  apiAccess: ApiAccessMeta | null;
  apiKeyValue: string;
  onApiKeyChange: (value: string) => void;
  onSave: (event: FormEvent<HTMLFormElement>) => void;
  onClear: () => void;
  saved: boolean;
}) {
  const tier = apiAccess?.tier || 'free';
  const limits = apiAccess?.limits || {
    coldScanLimit: 8,
    warmReadLimit: 120,
  };

  return (
    <section className="pro-page-shell">
      <div
        className={
          PRO_COMING_SOON
            ? 'pro-page-content pro-page-content-locked'
            : 'pro-page-content'
        }
        aria-hidden={PRO_COMING_SOON}
      >
        <section className="pro-page">
      <section className="pro-hero panel">
        <span className="kicker">Hodlscan Pro</span>
        <h1>Search more coins. See full history.</h1>
        <p className="pro-hero-copy">
          Free access covers live holder scans with hourly refresh. Pro unlocks
          hodler count history on searched coins and higher scan limits.
        </p>
        <div
          className={
            tier === 'pro'
              ? 'pro-tier-badge pro-tier-badge-active'
              : 'pro-tier-badge'
          }
        >
          {tier === 'pro' ? 'Pro active on this browser' : 'Free tier active'}
        </div>
      </section>

      <section className="pro-grid">
        <section className="panel pro-plan-card">
          <div className="panel-title">
            <span>Free</span>
          </div>
          <ul className="pro-feature-list">
            <li>Search any Solana token mint</li>
            <li>Top hodlers, supply distribution, hold times</li>
            <li>Coin data cached and refreshed about hourly</li>
            <li>Hodler count history on the tracked coin only</li>
          </ul>
          <div className="pro-limit-grid">
            <div>
              <small>new coin scans / hour</small>
              <strong>8</strong>
            </div>
            <div>
              <small>cached reads / hour</small>
              <strong>120</strong>
            </div>
          </div>
        </section>

        <section className="panel pro-plan-card pro-plan-card-featured">
          <div className="panel-title">
            <span>Pro</span>
            <small className="pro-plan-tag">recommended</small>
          </div>
          <ul className="pro-feature-list">
            <li>Everything in Free</li>
            <li>Hodler count history on searched coins</li>
            <li>Higher scan and read limits</li>
            <li>API key works across devices once saved</li>
          </ul>
          <div className="pro-limit-grid">
            <div>
              <small>new coin scans / hour</small>
              <strong>60</strong>
            </div>
            <div>
              <small>cached reads / hour</small>
              <strong>2,000</strong>
            </div>
          </div>
        </section>
      </section>

      <section className="panel pro-key-panel">
        <div className="panel-title">
          <span>Activate Pro</span>
          {saved ? <small className="pro-save-note">saved</small> : null}
        </div>
        <p className="pro-key-copy">
          Paste your Pro API key below. It stays in this browser and is sent with
          API requests as <code>x-hodlscan-api-key</code>.
        </p>
        <form className="pro-key-form" onSubmit={onSave}>
          <label htmlFor="pro-api-key" className="sr-only">
            Pro API key
          </label>
          <input
            id="pro-api-key"
            type="password"
            placeholder="hs_pro_..."
            autoComplete="off"
            value={apiKeyValue}
            onChange={(event) => onApiKeyChange(event.target.value)}
          />
          <button type="submit">Save key</button>
          <button type="button" className="pro-key-clear" onClick={onClear}>
            Clear
          </button>
        </form>
        {tier === 'pro' && apiAccess?.rateLimit ? (
          <div className="pro-current-limits">
            <div>
              <small>cold scans left this hour</small>
              <strong>{apiAccess.rateLimit.coldScansRemaining}</strong>
            </div>
            <div>
              <small>cached reads left this hour</small>
              <strong>{apiAccess.rateLimit.warmReadsRemaining}</strong>
            </div>
          </div>
        ) : (
          <p className="pro-key-footnote">
            Current limits: {limits.coldScanLimit} new coin scans and{' '}
            {limits.warmReadLimit} cached reads per hour.
          </p>
        )}
      </section>
        </section>
      </div>
      {PRO_COMING_SOON ? (
        <div className="pro-page-overlay panel">
          <span className="kicker">Hodlscan Pro</span>
          <h2>Coming soon</h2>
          <p className="pro-overlay-copy">
            Hodler count history on searched coins, higher scan limits, and Pro
            API access are on the way.
          </p>
        </div>
      ) : null}
    </section>
  );
}

const DISTRIBUTION_BRACKETS = [
  'Top 10',
  'Top 50',
  'Top 100',
  'Top 250',
  'Top 500',
] as const;

function CoinShareActions({
  symbol,
  holders,
  diamondPct,
  avgHoldDays,
  oldestDays,
  price,
  distribution,
}: {
  symbol: string;
  holders: number | null;
  diamondPct: number | null;
  avgHoldDays: number | null;
  oldestDays: number | null;
  price: number | null;
  distribution:
    | { label: string; pctSupply: number; averageAgeDays: number }[]
    | null;
}) {
  const [downloading, setDownloading] = useState(false);

  function buildFlexUrl() {
    const params = new URLSearchParams();
    params.set('symbol', symbol);
    if (holders != null) {
      params.set('holders', wholeNumberFormatter.format(holders));
    }
    if (diamondPct != null) {
      params.set('diamondPct', formatNumber(diamondPct));
    }
    if (avgHoldDays != null) {
      params.set('avgHoldDays', avgHoldDays.toFixed(2));
    }
    if (oldestDays != null) {
      params.set('oldestDays', oldestDays.toFixed(2));
    }
    if (price != null) {
      params.set('price', String(price));
    }
    if (distribution && distribution.length) {
      const brackets = DISTRIBUTION_BRACKETS.map((label) =>
        distribution.find((entry) => entry.label === label),
      );
      const values = brackets.map((bracket) =>
        bracket ? formatNumber(bracket.pctSupply) : '',
      );
      if (values.some((value) => value !== '')) {
        params.set('dist', values.join(','));
        params.set(
          'age',
          brackets
            .map((bracket) =>
              bracket ? bracket.averageAgeDays.toFixed(1) : '',
            )
            .join(','),
        );
      }
    }
    return `${apiBase}/api/flex?${params.toString()}`;
  }

  async function handleDownload() {
    setDownloading(true);
    try {
      const response = await fetch(buildFlexUrl());
      const blob = await response.blob();
      const objectUrl = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = objectUrl;
      link.download = `hodlscan-${symbol.toLowerCase()}.png`;
      document.body.appendChild(link);
      link.click();
      document.body.removeChild(link);
      URL.revokeObjectURL(objectUrl);
    } finally {
      setDownloading(false);
    }
  }

  function handleShare() {
    const parts = [`$${symbol} on HODLSCAN`];
    if (holders != null) {
      parts.push(`${wholeNumberFormatter.format(holders)} hodlers`);
    }
    if (diamondPct != null) {
      parts.push(`${formatNumber(diamondPct)}% 💎 diamond hands`);
    }
    if (avgHoldDays != null) {
      parts.push(`${formatAge(avgHoldDays)} avg hodl`);
    }
    const shareUrl = window.location.origin;
    const intent = `https://twitter.com/intent/tweet?text=${encodeURIComponent(
      parts.join(' · '),
    )}&url=${encodeURIComponent(shareUrl)}`;
    window.open(intent, '_blank', 'noopener,noreferrer');
  }

  return (
    <div className="flex-card-actions">
      <button
        type="button"
        className="flex-card-button"
        disabled={downloading}
        onClick={() => void handleDownload()}
      >
        {downloading ? 'rendering…' : 'Download card'}
      </button>
      <button
        type="button"
        className="flex-card-button flex-card-button-ghost"
        onClick={handleShare}
      >
        Share
      </button>
    </div>
  );
}

function HolderTimeline({
  history,
  priceHistory,
  nowMs,
  chartTimeFilter,
  onChartTimeFilterChange,
  isLiteMode,
  dataLoading,
  historyLocked,
  chartPreviewSeed,
  onNavigateToPro,
}: {
  history: HistoryPoint[];
  priceHistory: PricePoint[];
  nowMs: number;
  chartTimeFilter: ChartTimeFilterId;
  onChartTimeFilterChange: (filter: ChartTimeFilterId) => void;
  isLiteMode: boolean;
  dataLoading: boolean;
  historyLocked: boolean;
  chartPreviewSeed: number;
  onNavigateToPro: () => void;
}) {
  const plottedHistory = history.filter((point) => point.holder_count > 0);
  const activeChartFilter =
    chartTimeFilters.find((filter) => filter.id === chartTimeFilter) ||
    chartTimeFilters[0];
  const filteredHistory = Number.isFinite(activeChartFilter.days)
    ? plottedHistory.filter(
        (point) =>
          new Date(point.scanned_at).getTime() >=
          nowMs - activeChartFilter.days * 24 * 60 * 60 * 1000,
      )
    : plottedHistory;
  const bucketedHistory = bucketByMinutes(
    filteredHistory,
    activeChartFilter.bucketMinutes,
  );
  const recentHistory = sampleHistoryPoints(
    bucketedHistory,
    activeChartFilter.maxBars ?? MAX_HISTOGRAM_BARS,
  );
  const counts = recentHistory.map((point) => point.holder_count);
  const rawMin = counts.length ? Math.min(...counts) : 0;
  const rawMax = counts.length ? Math.max(...counts) : 1;
  // Reactive linear scale: fit exactly to the min/max of the selected timeframe.
  const scaleMin = rawMin;
  const scaleMax = rawMax;
  const scaleRange = Math.max(scaleMax - scaleMin, 1);
  const latestPoint = recentHistory.at(-1);
  const periodStart = recentHistory[0];
  const periodDelta =
    latestPoint && periodStart
      ? latestPoint.holder_count - periodStart.holder_count
      : 0;

  const priceSeries = useMemo(
    () =>
      priceHistory
        .map((point) => ({ ms: new Date(point.t).getTime(), close: point.close }))
        .filter((point) => Number.isFinite(point.ms) && point.close > 0)
        .sort((left, right) => left.ms - right.ms),
    [priceHistory],
  );
  const priceOverlay = useMemo(() => {
    if (priceSeries.length === 0 || recentHistory.length === 0) {
      return null;
    }

    const PAD = 6;
    let cursor = 0;
    const matched: { index: number; close: number }[] = [];
    recentHistory.forEach((point, index) => {
      const barMs = new Date(point.scanned_at).getTime();
      while (
        cursor + 1 < priceSeries.length &&
        priceSeries[cursor + 1].ms <= barMs
      ) {
        cursor += 1;
      }
      if (priceSeries[cursor].ms <= barMs) {
        matched.push({ index, close: priceSeries[cursor].close });
      }
    });

    if (matched.length < 2) {
      return null;
    }

    const closes = matched.map((entry) => entry.close);
    const priceMin = Math.min(...closes);
    const priceMax = Math.max(...closes);
    const priceRange = Math.max(priceMax - priceMin, Number.EPSILON);
    const n = recentHistory.length;
    const points = matched.map((entry) => {
      const x = ((entry.index + 0.5) / n) * 100;
      const y = PAD + (1 - (entry.close - priceMin) / priceRange) * (100 - PAD * 2);
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    });

    return {
      polyline: points.join(' '),
      areaPath: `M ${points[0]} L ${points
        .slice(1)
        .join(' L ')} L ${((matched.at(-1)!.index + 0.5) / n) * 100},100 L ${
        ((matched[0].index + 0.5) / n) * 100
      },100 Z`,
      priceMin,
      priceMax,
    };
  }, [priceSeries, recentHistory]);

  return (
    <section className="panel timeline-panel">
      <div className="panel-title">
        <div className="panel-title-main">
          <span>Hodler count</span>
          {latestPoint ? (
            <span className="histogram-summary">
              <strong>{wholeNumberFormatter.format(latestPoint.holder_count)}</strong>
              {recentHistory.length > 1 ? (
                <span
                  className={
                    periodDelta > 0
                      ? 'histogram-summary-delta histogram-summary-delta-up'
                      : periodDelta < 0
                        ? 'histogram-summary-delta histogram-summary-delta-down'
                        : 'histogram-summary-delta'
                  }
                >
                  {periodDelta >= 0 ? '+' : ''}
                  {periodDelta}
                </span>
              ) : null}
            </span>
          ) : null}
        </div>
        <div className="panel-title-actions">
          <div className="chart-filters" aria-label="Hodler count time filters">
            {chartTimeFilters.map((filter) => (
              <button
                className={
                  filter.id === chartTimeFilter
                    ? 'chart-filter chart-filter-active'
                    : 'chart-filter'
                }
                key={filter.id}
                type="button"
                onClick={() => onChartTimeFilterChange(filter.id)}
              >
                {filter.label}
              </button>
            ))}
          </div>
        </div>
      </div>
      <div className="histogram">
        {dataLoading ? (
          <ChartSkeleton />
        ) : isLiteMode && historyLocked && plottedHistory.length === 0 ? (
          <LockedLiteChart
            seed={chartPreviewSeed}
            onNavigateToPro={onNavigateToPro}
          />
        ) : plottedHistory.length === 0 ? (
          <div className="empty-state">
            {isLiteMode
              ? 'no hodler count history for this coin yet'
              : 'waiting for hodler count data'}
          </div>
        ) : (
          <div
            className={
              priceOverlay
                ? 'histogram-chart histogram-chart-priced'
                : 'histogram-chart'
            }
          >
            <div className="histogram-scale" aria-hidden="true">
              <span>{wholeNumberFormatter.format(Math.round(scaleMax))}</span>
              <span>{wholeNumberFormatter.format(Math.round(scaleMin))}</span>
            </div>
            <div className="histogram-plot">
            <div className="histogram-bars">
            {recentHistory.map((point, index) => {
                const previous = recentHistory[index - 1];
                const delta = previous
                  ? point.holder_count - previous.holder_count
                  : 0;
                const scaledHeight =
                  8 + ((point.holder_count - scaleMin) / scaleRange) * 92;
                const isLatest = index === recentHistory.length - 1;

                return (
                  <div
                    className={
                      isLatest
                        ? 'histogram-bar histogram-bar-latest'
                        : 'histogram-bar'
                    }
                    key={point.id}
                  >
                    <div
                      className={`histogram-fill ${
                        delta < 0
                          ? 'histogram-fill-down'
                          : delta > 0
                            ? 'histogram-fill-up'
                            : ''
                      }`}
                      style={{ height: `${scaledHeight}%` }}
                    />
                    <span className="histogram-value">
                      <span>
                        <strong>{wholeNumberFormatter.format(point.holder_count)}</strong>
                        {' · '}
                        {formatDateTime(point.scanned_at)}
                      </span>
                      <span
                        className={
                          delta > 0
                            ? 'histogram-value-delta-up'
                            : delta < 0
                              ? 'histogram-value-delta-down'
                              : undefined
                        }
                      >
                        {delta >= 0 ? '+' : ''}
                        {delta} · {formatRelativeTime(point.scanned_at, nowMs)}
                      </span>
                    </span>
                  </div>
                );
            })}
            </div>
              {priceOverlay ? (
                <svg
                  className="price-overlay"
                  viewBox="0 0 100 100"
                  preserveAspectRatio="none"
                  aria-hidden="true"
                >
                  <defs>
                    <linearGradient
                      id="price-overlay-fill"
                      x1="0"
                      y1="0"
                      x2="0"
                      y2="1"
                    >
                      <stop offset="0%" stopColor="var(--amber)" stopOpacity="0.22" />
                      <stop offset="100%" stopColor="var(--amber)" stopOpacity="0" />
                    </linearGradient>
                  </defs>
                  <path
                    className="price-overlay-area"
                    d={priceOverlay.areaPath}
                    fill="url(#price-overlay-fill)"
                  />
                  <polyline
                    className="price-overlay-line"
                    points={priceOverlay.polyline}
                  />
                </svg>
              ) : null}
            </div>
            {priceOverlay ? (
              <div className="price-scale" aria-hidden="true">
                <span>{formatPriceUsd(priceOverlay.priceMax)}</span>
                <span className="price-scale-legend">
                  <span className="price-scale-dot" />
                  price
                </span>
                <span>{formatPriceUsd(priceOverlay.priceMin)}</span>
              </div>
            ) : null}
          </div>
        )}
      </div>
    </section>
  );
}

function App() {
  const [token, setToken] = useState<TokenInfo | null>(null);
  const [holderData, setHolderData] = useState<HolderResponse | null>(null);
  const [history, setHistory] = useState<HistoryPoint[]>([]);
  const [priceHistory, setPriceHistory] = useState<PricePoint[]>([]);
  const [dataLoading, setDataLoading] = useState(true);
  const [lastSyncAtMs, setLastSyncAtMs] = useState(Date.now());
  const [nowMs, setNowMs] = useState(Date.now());
  const [holderTimeFilter, setHolderTimeFilter] =
    useState<HolderTimeFilterId>('all');
  const [holderPage, setHolderPage] = useState(1);
  const [holderSort, setHolderSort] = useState<{
    key: HolderSortKey;
    direction: SortDirection;
  }>({ key: 'rank', direction: 'asc' });
  const [chartTimeFilter, setChartTimeFilter] =
    useState<ChartTimeFilterId>('1d');
  const [copiedMint, setCopiedMint] = useState(false);
  const [copiedWallet, setCopiedWallet] = useState(false);
  const [routeMint, setRouteMint] = useState(() => getRouteMint());
  const [routeWallet, setRouteWallet] = useState(() => getRouteWallet());
  const [routePro, setRoutePro] = useState(() => getRoutePro());
  const [walletPortfolio, setWalletPortfolio] =
    useState<WalletPortfolio | null>(null);
  const [walletPortfolioLoading, setWalletPortfolioLoading] = useState(false);
  const [walletPortfolioError, setWalletPortfolioError] = useState<string | null>(
    null,
  );
  const [searchValue, setSearchValue] = useState(() => getRouteMint() || '');
  const [error, setError] = useState<string | null>(null);
  const [apiAccess, setApiAccess] = useState<ApiAccessMeta | null>(null);
  const [historyLocked, setHistoryLocked] = useState(false);
  const [apiKeyValue, setApiKeyValue] = useState(() => readStoredApiKey());
  const [apiKeySaved, setApiKeySaved] = useState(false);
  const [accessReloadNonce, setAccessReloadNonce] = useState(0);
  const [siteToken, setSiteToken] = useState<TokenInfo | null>(null);
  const [trackedCoins, setTrackedCoins] = useState<TrackedCoinPreview[]>([]);
  const [trackedLoading, setTrackedLoading] = useState(false);
  const refreshingRef = useRef(false);
  const dataLoadingRef = useRef(true);

  useEffect(() => {
    if (routeWallet || routePro || !routeMint) {
      return;
    }

    let cancelled = false;
    const routeTarget = routeMint;

    async function loadDashboard() {
      setError(null);
      setDataLoading(true);
      setHolderData(null);
      setHistory([]);
      setPriceHistory([]);
      setHolderPage(1);

      try {
        if (routeTarget !== TRACKED_ROUTE) {
          setToken((current) =>
            current?.mint === routeTarget
              ? current
              : buildPlaceholderToken(routeTarget, current?.trackedMint),
          );
        }

        const tokenResponse =
          routeTarget === TRACKED_ROUTE
            ? await fetchJson<TokenInfo>('/api/token')
            : await fetchJson<TokenInfo>(`/api/token${mintQuery(routeTarget)}`);
        if (cancelled) {
          return;
        }

        const resolvedMint = tokenResponse.mint;
        setToken(tokenResponse);
        setApiAccess(tokenResponse.access || null);

        const query = mintQuery(resolvedMint);
        const [holdersResponse, historyResponse, priceResponse] =
          await Promise.all([
            fetchJson<HolderResponse>(`/api/holders${query}`),
            fetchJson<{ history: HistoryPoint[]; historyLocked?: boolean; access?: ApiAccessMeta }>(
              `/api/history${query}`,
            ),
            fetchJson<{ points: PricePoint[] }>(`/api/price-history${query}`).catch(
              () => ({ points: [] }),
            ),
          ]);
        if (cancelled) {
          return;
        }
        setHolderData(holdersResponse);
        setHistory(historyResponse.history);
        setHistoryLocked(Boolean(historyResponse.historyLocked));
        setApiAccess(
          holdersResponse.access ||
            historyResponse.access ||
            tokenResponse.access ||
            null,
        );
        setPriceHistory(priceResponse.points);
        setLastSyncAtMs(Date.now());
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error ? loadError.message : String(loadError),
          );
        }
      } finally {
        if (!cancelled) {
          setDataLoading(false);
        }
      }
    }

    void loadDashboard();
    return () => {
      cancelled = true;
    };
  }, [routeMint, routeWallet, routePro, accessReloadNonce]);

  useEffect(() => {
    if (!routePro) {
      return;
    }

    let cancelled = false;
    fetchJson<TokenInfo>('/api/token')
      .then((response) => {
        if (!cancelled) {
          setApiAccess(response.access || null);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setApiAccess(null);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [routePro, accessReloadNonce]);

  useEffect(() => {
    fetchJson<TokenInfo>('/api/token')
      .then((response) => setSiteToken(response))
      .catch(() => setSiteToken(null));
  }, []);

  useEffect(() => {
    const onHome = !routeMint && !routeWallet && !routePro;
    if (!onHome) {
      return;
    }

    let cancelled = false;
    setTrackedLoading(true);
    fetchJson<{ coins: TrackedCoinPreview[] }>('/api/tracked')
      .then((response) => {
        if (!cancelled) {
          setTrackedCoins(response.coins);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setTrackedCoins([]);
        }
      })
      .finally(() => {
        if (!cancelled) {
          setTrackedLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [routeMint, routeWallet, routePro]);

  useEffect(() => {
    dataLoadingRef.current = dataLoading;
  }, [dataLoading]);

  useEffect(() => {
    function handlePopState() {
      setRouteMint(getRouteMint());
      setRouteWallet(getRouteWallet());
      setRoutePro(getRoutePro());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  async function syncCachedData({ silent = false }: { silent?: boolean } = {}) {
    if (refreshingRef.current || dataLoadingRef.current || routeWallet || !routeMint) {
      return;
    }

    refreshingRef.current = true;
    const activeMint =
      routeMint === TRACKED_ROUTE
        ? token?.mint || siteToken?.trackedMint || null
        : routeMint || token?.mint || null;

    if (!activeMint) {
      refreshingRef.current = false;
      return;
    }

    try {
      const query = mintQuery(activeMint);
      const [holdersResponse, historyResponse, priceResponse] =
        await Promise.all([
          fetchJson<HolderResponse>(`/api/holders${query}`),
          fetchJson<{ history: HistoryPoint[]; historyLocked?: boolean; access?: ApiAccessMeta }>(
            `/api/history${query}`,
          ),
          fetchJson<{ points: PricePoint[] }>(`/api/price-history${query}`).catch(
            () => ({ points: [] }),
          ),
        ]);
      setHolderData(holdersResponse);
      setHistory(historyResponse.history);
      setHistoryLocked(Boolean(historyResponse.historyLocked));
      setApiAccess(
        holdersResponse.access ||
          historyResponse.access ||
          null,
      );
      setPriceHistory(priceResponse.points);
      setLastSyncAtMs(Date.now());
    } catch (syncError) {
      const message =
        syncError instanceof Error ? syncError.message : String(syncError);
      if (silent) {
        console.warn(`Auto sync failed: ${message}`);
      } else {
        setError(message);
      }
    } finally {
      refreshingRef.current = false;
    }
  }

  const isLiteMode =
    holderData?.tracking === 'lite' || token?.tracking === 'lite';
  const showingHomePage = !routeMint && !routeWallet && !routePro;
  const showingWalletProfile = Boolean(routeWallet);
  const showingProPage = routePro;
  const chartPreviewSeed = useMemo(() => {
    const mint =
      routeMint === TRACKED_ROUTE
        ? token?.mint || siteToken?.trackedMint || 'preview'
        : routeMint || token?.mint || 'preview';
    let hash = 0;
    for (let index = 0; index < mint.length; index += 1) {
      hash = (hash * 31 + mint.charCodeAt(index)) | 0;
    }
    return Math.abs(hash) || 1;
  }, [routeMint, token?.mint, siteToken?.trackedMint]);

  useEffect(() => {
    if (!routeWallet) {
      setWalletPortfolio(null);
      setWalletPortfolioError(null);
      return;
    }

    let cancelled = false;
    setWalletPortfolio(null);
    setWalletPortfolioError(null);
    setWalletPortfolioLoading(true);
    fetchJson<WalletPortfolio>(
      `/api/wallet?address=${encodeURIComponent(routeWallet)}`,
    )
      .then((portfolio) => {
        if (!cancelled) {
          setWalletPortfolio(portfolio);
        }
      })
      .catch((portfolioError) => {
        if (!cancelled) {
          setWalletPortfolioError(
            portfolioError instanceof Error
              ? portfolioError.message
              : String(portfolioError),
          );
        }
      })
      .finally(() => {
        if (!cancelled) {
          setWalletPortfolioLoading(false);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [routeWallet]);

  useEffect(() => {
    if (showingWalletProfile || isLiteMode) {
      return undefined;
    }

    const clock = window.setInterval(() => {
      setNowMs(Date.now());
    }, 1000);

    const syncTimer = window.setInterval(() => {
      void syncCachedData({ silent: true });
    }, AUTO_REFRESH_SECONDS * 1000);

    return () => {
      window.clearInterval(clock);
      window.clearInterval(syncTimer);
    };
  }, [lastSyncAtMs, isLiteMode, showingWalletProfile]);

  const snapshot = holderData?.snapshot;
  const metrics = holderData?.metrics;
  const supply = useMemo(() => {
    if (!snapshot) {
      return 0;
    }
    return Number(snapshot.total_supply) / 10 ** snapshot.decimals;
  }, [snapshot]);
  const visibleAges = useMemo(() => {
    const holderAges =
      holderData?.holders
        .filter((holder) => !isExcludedHolder(holder))
        .map((holder) => holder.current_holder_age_days) || [];
    const distributionAges =
      holderData?.distribution.map((bucket) => bucket.averageAgeDays) || [];
    const allAges = [...holderAges, ...distributionAges].filter((age) =>
      Number.isFinite(age),
    );

    return {
      min: Math.min(...allAges, 0),
      max: Math.max(...allAges, 1),
    };
  }, [holderData]);
  const diamondHandsPct = useMemo(() => {
    const metricPct = metrics?.diamondHandsPct || 0;
    const visiblePct =
      holderData?.holders
        .filter((holder) => !isExcludedHolder(holder))
        .filter((holder) => isDiamondHands(holder.current_holder_age_days))
        .reduce((sum, holder) => sum + holder.pct_supply, 0) || 0;

    return Math.max(metricPct, visiblePct);
  }, [holderData, metrics]);
  const oldestCurrentAgeDays = useMemo(() => {
    const visibleOldest =
      holderData?.holders.reduce(
        (oldest, holder) =>
          isExcludedHolder(holder)
            ? oldest
            : Math.max(oldest, holder.current_holder_age_days || 0),
        0,
      ) || 0;

    return Math.max(metrics?.oldestHolderAgeDays || 0, visibleOldest);
  }, [holderData, metrics]);
  const filteredHolders = useMemo(
    () =>
      holderData?.holders.filter((holder) =>
        matchesHolderTimeFilter(holder, holderTimeFilter),
      ) || [],
    [holderData, holderTimeFilter],
  );
  const sortedHolders = useMemo(() => {
    const sorted = [...filteredHolders];
    sorted.sort((left, right) => {
      let comparison = 0;

      switch (holderSort.key) {
        case 'rank':
          comparison = left.rank - right.rank;
          break;
        case 'balance':
          comparison = left.ui_amount - right.ui_amount;
          break;
        case 'supply':
          comparison = left.pct_supply - right.pct_supply;
          break;
        case 'holding':
          comparison =
            left.current_holder_age_days - right.current_holder_age_days;
          break;
        default:
          comparison = 0;
      }

      if (comparison === 0) {
        comparison = left.rank - right.rank;
      }

      return holderSort.direction === 'asc' ? comparison : -comparison;
    });

    return sorted;
  }, [filteredHolders, holderSort]);
  const hasRankBaseline = useMemo(
    () =>
      holderData?.holders.some(
        (holder) => holder.previous_rank != null,
      ) || false,
    [holderData],
  );
  const holderPageCount = Math.max(
    1,
    Math.ceil(sortedHolders.length / HOLDERS_PAGE_SIZE),
  );
  const paginatedHolders = useMemo(() => {
    const start = (holderPage - 1) * HOLDERS_PAGE_SIZE;
    return sortedHolders.slice(start, start + HOLDERS_PAGE_SIZE);
  }, [sortedHolders, holderPage]);

  useEffect(() => {
    setHolderPage(1);
  }, [holderTimeFilter, holderSort]);

  useEffect(() => {
    if (holderPage > holderPageCount) {
      setHolderPage(holderPageCount);
    }
  }, [holderPage, holderPageCount]);
  const holderFilterCounts = useMemo(() => {
    const holders = holderData?.holders || [];
    return new Map(
      holderTimeFilters.map((filter) => [
        filter.id,
        holders.filter((holder) => matchesHolderTimeFilter(holder, filter.id))
          .length,
      ]),
    );
  }, [holderData]);
  const walletProfileHolder = useMemo(
    () =>
      routeWallet
        ? holderData?.holders.find((holder) => holder.owner === routeWallet) || null
        : null,
    [holderData, routeWallet],
  );
  const latestPriceUsd = priceHistory.at(-1)?.close ?? null;

  function beginMintNavigation(mint: string) {
    setToken(buildPlaceholderToken(mint, token?.trackedMint));
    setDataLoading(true);
    setHolderData(null);
    setHistory([]);
    setPriceHistory([]);
    setHolderPage(1);
    setError(null);
  }

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchValue.trim();
    if (!nextSearch) {
      return;
    }

    beginMintNavigation(nextSearch);
    setRoutePro(false);
    window.history.pushState(null, '', `/coin/${encodeURIComponent(nextSearch)}`);
    setRouteMint(nextSearch);
  }

  function navigateHome() {
    window.history.pushState(null, '', '/');
    setRouteMint(null);
    setRouteWallet(null);
    setRoutePro(false);
    setSearchValue('');
    setError(null);
  }

  function navigateToTracked() {
    window.history.pushState(null, '', '/tracked');
    setRouteMint(TRACKED_ROUTE);
    setRouteWallet(null);
    setRoutePro(false);
    setSearchValue('');
    setError(null);
  }

  function navigateToMint(mint: string) {
    beginMintNavigation(mint);
    setRoutePro(false);
    window.history.pushState(null, '', `/coin/${encodeURIComponent(mint)}`);
    setRouteMint(mint);
    setRouteWallet(null);
    setSearchValue('');
  }

  function navigateToWallet(address: string) {
    window.history.pushState(null, '', `/wallet/${encodeURIComponent(address)}`);
    setRouteWallet(address);
    setRouteMint(null);
    setRoutePro(false);
    setSearchValue('');
  }

  function navigateToPro() {
    window.history.pushState(null, '', '/pro');
    setRoutePro(true);
    setRouteWallet(null);
    setRouteMint(null);
    setSearchValue('');
    setError(null);
  }

  function handleSaveApiKey(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = apiKeyValue.trim();
    try {
      if (trimmed) {
        localStorage.setItem(API_KEY_STORAGE, trimmed);
      } else {
        localStorage.removeItem(API_KEY_STORAGE);
      }
    } catch {
      // Ignore storage failures.
    }

    setApiKeySaved(true);
    window.setTimeout(() => setApiKeySaved(false), 1800);
    setAccessReloadNonce((value) => value + 1);
  }

  function handleClearApiKey() {
    setApiKeyValue('');
    try {
      localStorage.removeItem(API_KEY_STORAGE);
    } catch {
      // Ignore storage failures.
    }
    setApiKeySaved(true);
    window.setTimeout(() => setApiKeySaved(false), 1800);
    setAccessReloadNonce((value) => value + 1);
  }

  function focusSearchBar() {
    const input = document.getElementById('token-search');
    input?.focus();
    input?.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
  }

  function handleBrandClick() {
    navigateHome();
  }

  function toggleHolderSort(key: HolderSortKey) {
    setHolderSort((current) =>
      current.key === key
        ? {
            key,
            direction: current.direction === 'asc' ? 'desc' : 'asc',
          }
        : { key, direction: key === 'rank' ? 'asc' : 'desc' },
    );
  }

  async function handleCopyMint() {
    if (!token?.mint) {
      return;
    }

    await copyText(token.mint);
    setCopiedMint(true);
    window.setTimeout(() => setCopiedMint(false), 1600);
  }

  async function handleCopyWallet() {
    if (!routeWallet) {
      return;
    }

    await copyText(routeWallet);
    setCopiedWallet(true);
    window.setTimeout(() => setCopiedWallet(false), 1600);
  }

  return (
    <main className="terminal-shell">
      <nav className="app-nav panel" aria-label="Hodlscan">
        <div className="app-nav-inner">
          <button
            className="app-brand app-brand-button"
            type="button"
            onClick={handleBrandClick}
          >
            <span className="app-brand-word">HODL</span>
            <span className="app-brand-word app-brand-word-accent">SCAN</span>
          </button>
          <div className="app-nav-links">
            <button
              type="button"
              className={
                showingHomePage
                  ? 'app-nav-link app-nav-link-active'
                  : 'app-nav-link'
              }
              onClick={navigateHome}
            >
              Home
            </button>
            <button
              type="button"
              className={
                showingProPage
                  ? 'app-nav-link app-nav-link-active'
                  : 'app-nav-link'
              }
              onClick={navigateToPro}
            >
              Pro access
            </button>
          </div>
          <form className="token-search" role="search" onSubmit={handleSearchSubmit}>
            <label htmlFor="token-search" className="sr-only">
              Search tokens
            </label>
            <div className="token-search-field">
              <span className="token-search-icon" aria-hidden="true">
                <svg viewBox="0 0 20 20" fill="none">
                  <circle cx="8.75" cy="8.75" r="5.5" stroke="currentColor" strokeWidth="1.6" />
                  <path
                    d="M13 13L17 17"
                    stroke="currentColor"
                    strokeWidth="1.6"
                    strokeLinecap="round"
                  />
                </svg>
              </span>
              <input
                id="token-search"
                type="search"
                placeholder="Paste a Solana mint address"
                autoComplete="off"
                value={searchValue}
                onChange={(event) => setSearchValue(event.target.value)}
              />
              <kbd className="token-search-hint" aria-hidden="true">
                enter
              </kbd>
            </div>
          </form>
        </div>
      </nav>
      {showingProPage ? (
        <ProAccessPage
          apiAccess={apiAccess}
          apiKeyValue={apiKeyValue}
          onApiKeyChange={setApiKeyValue}
          onSave={handleSaveApiKey}
          onClear={handleClearApiKey}
          saved={apiKeySaved}
        />
      ) : showingWalletProfile ? (
        <section className="wallet-profile-page">
          <section className="wallet-profile-card panel">
            <div className="wallet-profile-identity">
              <span className="kicker">
                ${token?.metadata.symbol || 'HODL'} hodler
              </span>
              <h1>{routeWallet ? shortAddress(routeWallet) : 'wallet'}</h1>
              <div className="wallet-profile-address">
                <button
                  type="button"
                  className="wallet-profile-address-pill"
                  title={copiedWallet ? 'Copied' : 'Copy address'}
                  onClick={() => void handleCopyWallet()}
                >
                  {copiedWallet ? 'copied' : routeWallet}
                </button>
                {routeWallet ? (
                  <a
                    className="wallet-solscan-link"
                    href={`${SOLSCAN_ACCOUNT_URL}${routeWallet}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View wallet on Solscan"
                    aria-label="View wallet on Solscan"
                  >
                    <img src="/assets/solscan-icon.png" alt="" aria-hidden="true" />
                  </a>
                ) : null}
                {walletProfileHolder &&
                walletProfileHolder.wallet_type !== 'wallet' ? (
                  <span className="wallet-profile-type-badge">
                    {formatWalletType(walletProfileHolder.wallet_type)}
                  </span>
                ) : null}
              </div>
            </div>
            <div className="wallet-profile-position">
              <span className="wallet-profile-position-label">
                ${token?.metadata.symbol || 'HODL'} position
              </span>
              <div className="wallet-profile-position-stats">
                <div className="wallet-profile-position-stat">
                  <small>rank</small>
                  <strong>
                    {walletProfileHolder ? `#${walletProfileHolder.rank}` : 'n/a'}
                  </strong>
                </div>
                <div className="wallet-profile-position-stat">
                  <small>balance</small>
                  <strong>
                    {walletProfileHolder
                      ? formatCompact(walletProfileHolder.ui_amount)
                      : 'n/a'}
                  </strong>
                </div>
                <div className="wallet-profile-position-stat">
                  <small>supply</small>
                  <strong>
                    {walletProfileHolder
                      ? `${formatNumber(walletProfileHolder.pct_supply)}%`
                      : 'n/a'}
                  </strong>
                </div>
                <div className="wallet-profile-position-stat">
                  <small>hodl time</small>
                  <strong>
                    {walletProfileHolder
                      ? formatAge(walletProfileHolder.current_holder_age_days)
                      : 'n/a'}
                  </strong>
                </div>
              </div>
            </div>
          </section>
          <section className="wallet-portfolio panel">
            <div className="panel-title wallet-portfolio-title">
              <span>portfolio</span>
              {walletPortfolio ? (
                <small className="wallet-portfolio-total">
                  {usdFormatter.format(walletPortfolio.totalValueUsd)}
                </small>
              ) : null}
            </div>
            {walletPortfolioLoading ? (
              <p className="wallet-portfolio-status">loading portfolio…</p>
            ) : walletPortfolioError ? (
              <p className="wallet-portfolio-status">
                couldn't load portfolio: {walletPortfolioError}
              </p>
            ) : walletPortfolio ? (
              <>
                <div className="wallet-portfolio-summary">
                  <div className="wallet-portfolio-stat">
                    <small>total value</small>
                    <strong>
                      {usdFormatter.format(walletPortfolio.totalValueUsd)}
                    </strong>
                  </div>
                  <div className="wallet-portfolio-stat">
                    <small>tokens</small>
                    <strong>
                      {wholeNumberFormatter.format(walletPortfolio.tokenCount)}
                    </strong>
                  </div>
                  <div className="wallet-portfolio-stat">
                    <small>SOL</small>
                    <strong>{formatNumber(walletPortfolio.solBalance, 3)}</strong>
                  </div>
                </div>
                {walletPortfolio.tokens.length ? (
                  <div className="wallet-portfolio-table">
                    <div className="wallet-portfolio-head">
                      <span>token</span>
                      <span>balance</span>
                      <span>price</span>
                      <span>value</span>
                    </div>
                    {walletPortfolio.tokens.map((portfolioToken) => (
                      <div
                        className={
                          portfolioToken.isTracked
                            ? 'wallet-portfolio-row wallet-portfolio-row-tracked'
                            : 'wallet-portfolio-row'
                        }
                        key={portfolioToken.mint}
                      >
                        <span className="wallet-portfolio-token">
                          <span className="wallet-portfolio-image">
                            {portfolioToken.image ? (
                              <img
                                src={portfolioToken.image}
                                alt=""
                                loading="lazy"
                                onError={(event) => {
                                  event.currentTarget.style.display = 'none';
                                }}
                              />
                            ) : (
                              <span className="wallet-portfolio-image-fallback">
                                {(portfolioToken.symbol || '?').slice(0, 2)}
                              </span>
                            )}
                          </span>
                          <span className="wallet-portfolio-token-meta">
                            <a
                              className="wallet-portfolio-symbol"
                              href={`${SOLSCAN_TOKEN_URL}${portfolioToken.mint}`}
                              target="_blank"
                              rel="noreferrer"
                              title={portfolioToken.name || portfolioToken.mint}
                            >
                              {portfolioToken.symbol ||
                                shortAddress(portfolioToken.mint)}
                            </a>
                            {portfolioToken.name ? (
                              <small>{portfolioToken.name}</small>
                            ) : null}
                          </span>
                        </span>
                        <span>{formatCompact(portfolioToken.uiAmount)}</span>
                        <span>
                          {portfolioToken.priceUsd != null
                            ? usdCompactFormatter.format(portfolioToken.priceUsd)
                            : '—'}
                        </span>
                        <span className="wallet-portfolio-value">
                          {portfolioToken.valueUsd != null
                            ? usdFormatter.format(portfolioToken.valueUsd)
                            : '—'}
                        </span>
                      </div>
                    ))}
                  </div>
                ) : (
                  <p className="wallet-portfolio-status">
                    no fungible tokens found for this wallet.
                  </p>
                )}
              </>
            ) : (
              <p className="wallet-portfolio-status">portfolio unavailable.</p>
            )}
          </section>
        </section>
      ) : showingHomePage ? (
        <HomePage
          trackedCoins={trackedCoins}
          trackedLoading={trackedLoading}
          onOpenTracked={navigateToMint}
          onFocusSearch={focusSearchBar}
        />
      ) : (
        <>
      {isLiteMode ? (
        <div className="lite-mode-banner panel">
          <span>
            live scan with on-chain hold times — coin data refreshes about hourly
            {apiAccess?.cache
              ? ` · scanned ${formatRelativeScanTime(apiAccess.cache.scannedAt, nowMs)}`
              : holderData?.access?.cache
              ? ` · scanned ${formatRelativeScanTime(holderData.access.cache.scannedAt, nowMs)}`
              : null}
          </span>
          {apiAccess?.tier !== 'pro' ? (
            PRO_COMING_SOON ? (
              <span className="lite-mode-banner-note">
                Pro coming soon — hodler count history on searched coins.
              </span>
            ) : (
              <button
                type="button"
                className="lite-mode-banner-link"
                onClick={navigateToPro}
              >
                Pro unlocks hodler count history on searched coins.
              </button>
            )
          ) : null}
        </div>
      ) : null}
      <header className="command-bar panel">
        <div className="token-identity">
          <div className="token-image-frame">
            {token?.metadata.image ? (
              <img
                src={token.metadata.image}
                alt={token.metadata.name || token.metadata.symbol || token.mint}
              />
            ) : (
              <span>{token?.metadata.symbol?.slice(0, 3) || shortAddress(token?.mint || '').slice(0, 3)}</span>
            )}
          </div>
          <div>
            <h1>
              {token?.metadata.name ||
                token?.metadata.symbol ||
                (token?.mint ? shortAddress(token.mint) : 'Loading mint')}
              {token?.metadata.symbol ? (
                <span className="token-title-ticker">
                  {' '}
                  -{' '}
                  <span className="token-title-symbol">
                    ${token.metadata.symbol}
                  </span>
                </span>
              ) : null}
            </h1>
            <div className="token-subtitle">
              {token?.mint ? (
                <button
                  className="token-mint-pill"
                  type="button"
                  title={copiedMint ? 'Copied' : token.mint}
                  onClick={() => void handleCopyMint()}
                >
                  {copiedMint ? 'Copied' : shortAddress(token.mint)}
                </button>
              ) : (
                <span className="token-mint-pill token-mint-pill-static">loading</span>
              )}
              {token?.mint ? (
                <>
                  <a
                    className="token-explorer-link"
                    href={`${SOLSCAN_TOKEN_URL}${token.mint}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View on Solscan"
                    aria-label="View on Solscan"
                  >
                    <img src="/assets/solscan-icon.png" alt="" aria-hidden="true" />
                  </a>
                  <a
                    className="token-explorer-link token-explorer-link-terminal"
                    href={PADRE_TERMINAL_URL}
                    target="_blank"
                    rel="noreferrer"
                    title="Trade on Terminal"
                    aria-label="Trade on Terminal"
                  >
                    <img src="/assets/terminal.png" alt="" aria-hidden="true" />
                  </a>
                </>
              ) : null}
            </div>
          </div>
        </div>
        <div className="command-bar-side">
          {token && !dataLoading ? (
            <CoinShareActions
              symbol={token.metadata.symbol || 'HODL'}
              holders={metrics?.holderCount ?? null}
              diamondPct={diamondHandsPct}
              avgHoldDays={metrics?.averageHolderAgeDays ?? null}
              oldestDays={oldestCurrentAgeDays}
              price={latestPriceUsd}
              distribution={holderData?.distribution ?? null}
            />
          ) : null}
          <section className="top-stats-grid">
          <StatCard
            label="Total hodlers"
            skeleton={dataLoading}
            value={metrics ? wholeNumberFormatter.format(metrics.holderCount) : '0'}
          />
          <StatCard
            label="Diamond hands"
            skeleton={dataLoading}
            value={`${formatNumber(diamondHandsPct)}%`}
            valueIcon={
              <img
                className="stat-value-icon"
                src={DIAMOND_HANDS_IMAGE}
                alt=""
                aria-hidden="true"
              />
            }
            compact
            valueStyle={ageGradientStyle(
              DIAMOND_HANDS_DAYS,
              visibleAges.min,
              visibleAges.max,
            )}
          />
          <StatCard
            label="Avg hodler time"
            skeleton={dataLoading}
            value={formatAge(metrics?.averageHolderAgeDays || 0)}
            valueStyle={ageGradientStyle(
              metrics?.averageHolderAgeDays,
              visibleAges.min,
              visibleAges.max,
            )}
            compact
          />
          <StatCard
            label="Oldest hodler"
            skeleton={dataLoading}
            value={formatAge(oldestCurrentAgeDays)}
            valueStyle={ageGradientStyle(
              oldestCurrentAgeDays,
              visibleAges.min,
              visibleAges.max,
            )}
            compact
          />
          </section>
        </div>
      </header>

      {error ? <div className="error-panel panel">{error}</div> : null}
      <section className="content-grid">
        <HolderTimeline
          history={history}
          priceHistory={priceHistory}
          nowMs={nowMs}
          chartTimeFilter={chartTimeFilter}
          onChartTimeFilterChange={setChartTimeFilter}
          isLiteMode={isLiteMode}
          dataLoading={dataLoading}
          historyLocked={historyLocked}
          chartPreviewSeed={chartPreviewSeed}
          onNavigateToPro={navigateToPro}
        />
        <section className="panel distribution-panel">
          <div className="panel-title">
            <span>Distribution</span>
          </div>
          <div className="distribution-list">
            {dataLoading ? (
              <DistributionSkeleton />
            ) : holderData?.distribution.length ? (
              <>
                <div className="distribution-row distribution-head">
                  <span>Bracket</span>
                  <span>Supply</span>
                  <span>Avg age</span>
                </div>
                {holderData.distribution.map((bucket) => (
                  <div className="distribution-row" key={bucket.label}>
                    <span>{formatDistributionLabel(bucket.label)}</span>
                    <strong>{formatNumber(bucket.pctSupply)}%</strong>
                    <span
                      className="age-value"
                      style={ageGradientStyle(
                        bucket.averageAgeDays,
                        visibleAges.min,
                        visibleAges.max,
                      )}
                    >
                      {formatAge(bucket.averageAgeDays)}
                    </span>
                  </div>
                ))}
              </>
            ) : (
              <div className="empty-state">no distribution yet</div>
            )}
          </div>
        </section>
      </section>

      <section className="panel table-panel">
        <div className="panel-title">
          <span>Hodlers</span>
          <div className="panel-title-actions">
            <div className="holder-filters" aria-label="Hodler time filters">
              {holderTimeFilters.map((filter) => (
                <button
                  className={
                    filter.id === holderTimeFilter
                      ? 'holder-filter holder-filter-active'
                      : 'holder-filter'
                  }
                  key={filter.id}
                  type="button"
                  onClick={() => {
                    setHolderTimeFilter(filter.id);
                    setHolderPage(1);
                  }}
                >
                  <span>{filter.label}</span>
                  <small>{holderFilterCounts.get(filter.id) || 0}</small>
                </button>
              ))}
            </div>
          </div>
        </div>
        <div className="holder-table">
          <div className="table-row table-head">
            <span aria-hidden="true" />
            <span>Wallet</span>
            <button
              className="table-sort-button"
              type="button"
              onClick={() => toggleHolderSort('balance')}
            >
              Balance
              {sortIndicator(holderSort.key, 'balance', holderSort.direction)}
            </button>
            <button
              className="table-sort-button"
              type="button"
              onClick={() => toggleHolderSort('supply')}
            >
              Supply
              {sortIndicator(holderSort.key, 'supply', holderSort.direction)}
            </button>
            <button
              className="table-sort-button"
              type="button"
              onClick={() => toggleHolderSort('holding')}
            >
              Holding
              {sortIndicator(holderSort.key, 'holding', holderSort.direction)}
            </button>
          </div>
          {dataLoading ? (
            <DashboardSkeletonRows count={10} />
          ) : paginatedHolders.length ? (
            paginatedHolders.map((holder) => {
              const rankChange = formatRankChange(holder, hasRankBaseline);

              return (
              <div
                className={
                  isExcludedHolder(holder)
                    ? 'table-row holder-row holder-row-excluded'
                    : 'table-row holder-row'
                }
                key={holder.owner}
              >
                <span className="rank-cell">
                  <span>#{holder.rank}</span>
                  {rankChange ? (
                    <span
                      className={`rank-change rank-change-${rankChange.tone}`}
                      title={
                        rankChange.tone === 'neutral'
                          ? 'New in top hodlers'
                          : 'Rank change since last scan'
                      }
                    >
                      {rankChange.label}
                    </span>
                  ) : null}
                </span>
                <span className="wallet-cell">
                  <button
                    className="wallet-link"
                    type="button"
                    title={holder.owner}
                    onClick={() => navigateToWallet(holder.owner)}
                  >
                    {shortAddress(holder.owner)}
                  </button>
                  <a
                    className="wallet-solscan-link"
                    href={`${SOLSCAN_ACCOUNT_URL}${holder.owner}`}
                    target="_blank"
                    rel="noreferrer"
                    title="View wallet on Solscan"
                    aria-label="View wallet on Solscan"
                    onClick={(event) => event.stopPropagation()}
                  >
                    <img src="/assets/solscan-icon.png" alt="" aria-hidden="true" />
                  </a>
                  {holder.wallet_type !== 'wallet' ? (
                    <span
                      className={
                        isExcludedHolder(holder)
                          ? 'wallet-type-badge wallet-type-badge-excluded'
                          : 'wallet-type-badge'
                      }
                      title={holder.classification_source || undefined}
                    >
                      {formatWalletType(holder.wallet_type)}
                    </span>
                  ) : null}
                </span>
                <span>{formatCompact(holder.ui_amount)}</span>
                <span>{formatNumber(holder.pct_supply)}%</span>
                <span
                  className={isExcludedHolder(holder) ? 'muted-value' : 'age-value'}
                  style={
                    isExcludedHolder(holder)
                      ? undefined
                      : ageGradientStyle(
                          holder.current_holder_age_days,
                          visibleAges.min,
                          visibleAges.max,
                        )
                  }
                >
                  {isExcludedHolder(holder)
                    ? 'pool'
                    : formatAge(holder.current_holder_age_days)}
                  {!isExcludedHolder(holder) &&
                  isDiamondHands(holder.current_holder_age_days) ? (
                    <img
                      className="diamond-hands-badge"
                      src={DIAMOND_HANDS_IMAGE}
                      alt="diamond hands"
                      title={`${DIAMOND_HANDS_DAYS}+ day hodler`}
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : null}
                </span>
              </div>
            );
            })
          ) : (
            <div className="empty-state table-empty">
              {holderData?.holders.length
                ? 'no hodlers match this time filter.'
                : 'no hodlers found for this mint.'}
            </div>
          )}
        </div>
        {sortedHolders.length > HOLDERS_PAGE_SIZE ? (
          <div className="holder-pagination" aria-label="Hodler table pagination">
            <button
              className="pagination-button"
              type="button"
              disabled={holderPage <= 1}
              onClick={() => setHolderPage((page) => Math.max(1, page - 1))}
            >
              previous
            </button>
            <div className="pagination-pages">
              {Array.from({ length: holderPageCount }, (_, index) => {
                const pageNumber = index + 1;
                return (
                  <button
                    className={
                      pageNumber === holderPage
                        ? 'pagination-page pagination-page-active'
                        : 'pagination-page'
                    }
                    key={pageNumber}
                    type="button"
                    onClick={() => setHolderPage(pageNumber)}
                  >
                    {pageNumber}
                  </button>
                );
              })}
            </div>
            <button
              className="pagination-button"
              type="button"
              disabled={holderPage >= holderPageCount}
              onClick={() =>
                setHolderPage((page) => Math.min(holderPageCount, page + 1))
              }
            >
              next
            </button>
            <small className="pagination-meta">
              {sortedHolders.length.toLocaleString()} hodlers · page {holderPage}{' '}
              of {holderPageCount}
            </small>
          </div>
        ) : null}
      </section>
        </>
      )}
    </main>
  );
}

export default App;
