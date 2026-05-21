import type { CSSProperties, FormEvent, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_BASE_URL || '';
const AUTO_REFRESH_SECONDS = 60;
const DIAMOND_HANDS_IMAGE = '/assets/dhands.webp';
const DIAMOND_HANDS_DAYS = 90;
const MAX_HISTOGRAM_BARS = 56;
const holderTimeFilters = [
  { id: 'all', label: 'all holders' },
  { id: 'under-1d', label: '< 1d', min: 0, max: 1 },
  { id: '1-7d', label: '1-7d', min: 1, max: 7 },
  { id: '7-30d', label: '7-30d', min: 7, max: 30 },
  { id: '30-90d', label: '30-90d', min: 30, max: 90 },
  { id: '90d-plus', label: '90d+', min: 90 },
] as const;
const chartTimeFilters = [
  { id: '1d', label: '1d', days: 1 },
  { id: '7d', label: '7d', days: 7 },
  { id: '30d', label: '30d', days: 30 },
  { id: 'all', label: 'all', days: Number.POSITIVE_INFINITY },
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
const dateFormatter = new Intl.DateTimeFormat(undefined);
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, {
  dateStyle: 'medium',
  timeStyle: 'short',
});

interface TokenInfo {
  mint: string;
  endpoints: string[];
  maxDisplayHolders: number;
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
}

interface HolderResponse {
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

function getRouteMint() {
  const match = window.location.pathname.match(/^\/coin\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

function getRouteWallet() {
  const match = window.location.pathname.match(/^\/wallet\/([^/]+)\/?$/);
  return match ? decodeURIComponent(match[1]) : null;
}

async function fetchJson<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${apiBase}${path}`, init);
  if (!response.ok) {
    const body = await response.json().catch(() => ({}));
    throw new Error(body.error || `Request failed with ${response.status}`);
  }
  return response.json() as Promise<T>;
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

function formatDistributionLabel(label: string) {
  return label.replace(/^top\b/i, 'Top');
}

function formatDate(value: string | null | undefined) {
  return value ? dateFormatter.format(new Date(value)) : 'n/a';
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
}: {
  label: ReactNode;
  value: string;
  tone?: 'good' | 'bad';
  compact?: boolean;
  valueStyle?: CSSProperties;
}) {
  return (
    <section className={`panel stat-card${compact ? ' stat-card-compact' : ''}`}>
      <span className="label stat-label">{label}</span>
      <strong className={tone ? `tone-${tone}` : undefined} style={valueStyle}>
        {value}
      </strong>
    </section>
  );
}

function HolderTimeline({
  history,
  nextRefreshSeconds,
  refreshing,
  nowMs,
  chartTimeFilter,
  onChartTimeFilterChange,
}: {
  history: HistoryPoint[];
  nextRefreshSeconds: number;
  refreshing: boolean;
  nowMs: number;
  chartTimeFilter: ChartTimeFilterId;
  onChartTimeFilterChange: (filter: ChartTimeFilterId) => void;
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
  const recentHistory = sampleHistoryPoints(filteredHistory, MAX_HISTOGRAM_BARS);
  const counts = recentHistory.map((point) => point.holder_count);
  const rawMin = counts.length ? Math.min(...counts) : 0;
  const rawMax = counts.length ? Math.max(...counts) : 1;
  const rawRange = Math.max(rawMax - rawMin, 1);
  const padding = Math.max(1, Math.ceil(rawRange * 0.12));
  const scaleMin = Math.max(0, rawMin - padding);
  const scaleMax = rawMax + padding;
  const scaleRange = Math.max(scaleMax - scaleMin, 1);

  return (
    <section className="panel timeline-panel">
      <div className="panel-title">
        <span>holder count</span>
        <div className="panel-title-actions">
          <div className="chart-filters" aria-label="Holder count time filters">
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
          <small>
            {refreshing
              ? 'syncing now'
              : `updates in ${nextRefreshSeconds}s`}
          </small>
        </div>
      </div>
      <div className="histogram">
        {plottedHistory.length === 0 ? (
          <div className="empty-state">waiting for holder count data</div>
        ) : (
          <div className="histogram-bars">
            {recentHistory.map((point, index) => {
                const previous = recentHistory[index - 1];
                const delta = previous
                  ? point.holder_count - previous.holder_count
                  : 0;
                const scaledHeight =
                  10 + ((point.holder_count - scaleMin) / scaleRange) * 90;

                return (
                  <div
                    className="histogram-bar"
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
                      <span>
                        {delta >= 0 ? '+' : ''}
                        {delta} · {formatRelativeTime(point.scanned_at, nowMs)}
                      </span>
                    </span>
                  </div>
                );
            })}
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
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [nextRefreshSeconds, setNextRefreshSeconds] =
    useState(AUTO_REFRESH_SECONDS);
  const [lastSyncAtMs, setLastSyncAtMs] = useState(Date.now());
  const [nowMs, setNowMs] = useState(Date.now());
  const [holderTimeFilter, setHolderTimeFilter] =
    useState<HolderTimeFilterId>('all');
  const [chartTimeFilter, setChartTimeFilter] =
    useState<ChartTimeFilterId>('1d');
  const [routeMint, setRouteMint] = useState(() => getRouteMint());
  const [routeWallet, setRouteWallet] = useState(() => getRouteWallet());
  const [searchValue, setSearchValue] = useState(() => getRouteMint() || '');
  const [error, setError] = useState<string | null>(null);
  const refreshingRef = useRef(false);
  const loadingRef = useRef(true);

  async function load() {
    const [tokenResponse, holdersResponse, historyResponse] = await Promise.all([
      fetchJson<TokenInfo>('/api/token'),
      fetchJson<HolderResponse>('/api/holders'),
      fetchJson<{ history: HistoryPoint[] }>('/api/history'),
    ]);
    setToken(tokenResponse);
    setHolderData(holdersResponse);
    setHistory(historyResponse.history);
    setLastSyncAtMs(Date.now());
  }

  useEffect(() => {
    load()
      .catch((loadError) =>
        setError(loadError instanceof Error ? loadError.message : String(loadError)),
      )
      .finally(() => setLoading(false));
  }, []);

  useEffect(() => {
    loadingRef.current = loading;
  }, [loading]);

  useEffect(() => {
    refreshingRef.current = refreshing;
  }, [refreshing]);

  useEffect(() => {
    function handlePopState() {
      setRouteMint(getRouteMint());
      setRouteWallet(getRouteWallet());
    }

    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    if (!token || routeMint || routeWallet) {
      return;
    }

    window.history.replaceState(null, '', `/coin/${encodeURIComponent(token.mint)}`);
    setRouteMint(token.mint);
  }, [routeMint, routeWallet, token]);

  async function syncCachedData({ silent = false }: { silent?: boolean } = {}) {
    if (refreshingRef.current || loadingRef.current) {
      return;
    }

    refreshingRef.current = true;
    setRefreshing(true);
    if (!silent) {
      setError(null);
    }

    try {
      const [holdersResponse, historyResponse] = await Promise.all([
        fetchJson<HolderResponse>('/api/holders'),
        fetchJson<{ history: HistoryPoint[] }>('/api/history'),
      ]);
      setHolderData(holdersResponse);
      setHistory(historyResponse.history);
      const syncedAt = Date.now();
      setLastSyncAtMs(syncedAt);
      setNextRefreshSeconds(AUTO_REFRESH_SECONDS);
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
      setRefreshing(false);
    }
  }

  const showingMissingToken = Boolean(routeMint && token && routeMint !== token.mint);
  const showingWalletProfile = Boolean(routeWallet);

  useEffect(() => {
    if (showingMissingToken || showingWalletProfile) {
      return undefined;
    }

    const countdown = window.setInterval(() => {
      const currentNowMs = Date.now();
      setNowMs(currentNowMs);
      const elapsedSeconds = Math.floor((currentNowMs - lastSyncAtMs) / 1000);
      setNextRefreshSeconds(
        AUTO_REFRESH_SECONDS - (elapsedSeconds % AUTO_REFRESH_SECONDS),
      );
    }, 1000);

    const syncTimer = window.setInterval(() => {
      void syncCachedData({ silent: true });
    }, AUTO_REFRESH_SECONDS * 1000);

    return () => {
      window.clearInterval(countdown);
      window.clearInterval(syncTimer);
    };
  }, [lastSyncAtMs, showingMissingToken, showingWalletProfile]);

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

  function handleSearchSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const nextSearch = searchValue.trim();
    if (!nextSearch) {
      return;
    }

    window.history.pushState(null, '', `/coin/${encodeURIComponent(nextSearch)}`);
    setRouteMint(nextSearch);
  }

  function navigateToMint(mint: string) {
    window.history.pushState(null, '', `/coin/${encodeURIComponent(mint)}`);
    setRouteMint(mint);
    setRouteWallet(null);
    setSearchValue('');
  }

  function navigateToWallet(address: string) {
    window.history.pushState(null, '', `/wallet/${encodeURIComponent(address)}`);
    setRouteWallet(address);
    setRouteMint(null);
    setSearchValue('');
  }

  function handleBrandClick() {
    if (token) {
      navigateToMint(token.mint);
    }
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
            hodlscan
          </button>
          <form className="token-search" role="search" onSubmit={handleSearchSubmit}>
            <label htmlFor="token-search" className="sr-only">
              Search tokens
            </label>
            <input
              id="token-search"
              type="search"
              placeholder="Search tokens"
              autoComplete="off"
              value={searchValue}
              onChange={(event) => setSearchValue(event.target.value)}
            />
          </form>
          <span className="nav-spacer" aria-hidden="true" />
        </div>
      </nav>
      {showingWalletProfile ? (
        <section className="wallet-profile-page">
          <section className="wallet-profile-card panel">
            <div>
              <span className="kicker">wallet profile</span>
              <h1>{routeWallet ? shortAddress(routeWallet) : 'wallet'}</h1>
              <div className="token-subtitle">
                <span>{routeWallet}</span>
              </div>
            </div>
            <div className="wallet-profile-grid">
              <StatCard
                label="rank"
                value={walletProfileHolder ? `#${walletProfileHolder.rank}` : 'n/a'}
                compact
              />
              <StatCard
                label="balance"
                value={walletProfileHolder ? formatCompact(walletProfileHolder.ui_amount) : 'n/a'}
                compact
              />
              <StatCard
                label="supply"
                value={
                  walletProfileHolder
                    ? `${formatNumber(walletProfileHolder.pct_supply)}%`
                    : 'n/a'
                }
                compact
              />
              <StatCard
                label="holding"
                value={
                  walletProfileHolder
                    ? formatAge(walletProfileHolder.current_holder_age_days)
                    : 'n/a'
                }
                compact
              />
              <StatCard
                label="type"
                value={
                  walletProfileHolder
                    ? formatWalletType(walletProfileHolder.wallet_type)
                    : 'unknown'
                }
                compact
              />
            </div>
          </section>
          <section className="wallet-profile-placeholder panel">
            <div className="panel-title">
              <span>profile foundation</span>
            </div>
            <p>
              Basic wallet route is ready. More wallet intelligence will plug in here.
            </p>
          </section>
        </section>
      ) : showingMissingToken ? (
        <section className="missing-token-page">
          <div className="missing-token-stack">
            <div className="missing-token-card panel">
              We dont have data for this coin yet.
            </div>
            <section className="available-coins panel" aria-label="Coins with data">
              <div className="available-coins-title">coins we have data for</div>
              <button
                className="available-coin"
                type="button"
                onClick={() => {
                  if (token) {
                    navigateToMint(token.mint);
                  }
                }}
              >
                <span className="available-coin-main">
                  <span className="available-coin-image">
                    {token?.metadata.image ? (
                      <img
                        src={token.metadata.image}
                        alt={token.metadata.name || token.metadata.symbol || token.mint}
                      />
                    ) : (
                      <span>{token?.metadata.symbol?.slice(0, 3) || 'HODL'}</span>
                    )}
                  </span>
                  <span>
                    <span className="available-coin-symbol">
                      {token?.metadata.symbol || 'HODL'}
                    </span>
                    <span className="available-coin-name">
                      {token?.metadata.name || 'HODL'}
                    </span>
                    <span className="available-coin-mint">
                      {token ? shortAddress(token.mint) : 'loading'}
                    </span>
                  </span>
                </span>
                <span className="available-coin-stats">
                  <span>
                    <small>holders</small>
                    <strong>{metrics ? wholeNumberFormatter.format(metrics.holderCount) : '0'}</strong>
                  </span>
                  <span>
                    <small>supply</small>
                    <strong>{formatCompact(supply)}</strong>
                  </span>
                  <span>
                    <small>diamond</small>
                    <strong>{formatNumber(diamondHandsPct)}%</strong>
                  </span>
                  <span>
                    <small>avg age</small>
                    <strong>{formatAge(metrics?.averageHolderAgeDays || 0)}</strong>
                  </span>
                </span>
              </button>
            </section>
          </div>
        </section>
      ) : (
        <>
      <header className="command-bar panel">
        <div className="token-identity">
          <div className="token-image-frame">
            {token?.metadata.image ? (
              <img
                src={token.metadata.image}
                alt={token.metadata.name || token.metadata.symbol || token.mint}
              />
            ) : (
              <span>{token?.metadata.symbol?.slice(0, 3) || 'HODL'}</span>
            )}
          </div>
          <div>
            <h1>
              {token?.metadata.name || token?.metadata.symbol || 'loading mint'}
            </h1>
            <div className="token-subtitle">
              <span>{token ? shortAddress(token.mint) : 'loading'}</span>
              {token?.metadata.symbol ? <span>${token.metadata.symbol}</span> : null}
            </div>
          </div>
        </div>
        <section className="top-stats-grid">
          <StatCard
            label="total holders"
            value={metrics ? String(metrics.holderCount) : '0'}
          />
          <StatCard
            label="total supply"
            value={formatCompact(supply)}
          />
          <StatCard
            label={
              <>
                <img
                  className="stat-label-icon"
                  src={DIAMOND_HANDS_IMAGE}
                  alt=""
                  aria-hidden="true"
                />
                <span>diamond hands</span>
              </>
            }
            value={`${formatNumber(diamondHandsPct)}%`}
            compact
            valueStyle={ageGradientStyle(
              DIAMOND_HANDS_DAYS,
              visibleAges.min,
              visibleAges.max,
            )}
          />
          <StatCard
            label="avg holder time"
            value={formatAge(metrics?.averageHolderAgeDays || 0)}
            valueStyle={ageGradientStyle(
              metrics?.averageHolderAgeDays,
              visibleAges.min,
              visibleAges.max,
            )}
            compact
          />
          <StatCard
            label="oldest current"
            value={formatAge(oldestCurrentAgeDays)}
            valueStyle={ageGradientStyle(
              oldestCurrentAgeDays,
              visibleAges.min,
              visibleAges.max,
            )}
            compact
          />
        </section>
      </header>

      {error ? <div className="error-panel panel">{error}</div> : null}
      <section className="content-grid">
        <HolderTimeline
          history={history}
          nextRefreshSeconds={nextRefreshSeconds}
          refreshing={refreshing}
          nowMs={nowMs}
          chartTimeFilter={chartTimeFilter}
          onChartTimeFilterChange={setChartTimeFilter}
        />
        <section className="panel distribution-panel">
          <div className="panel-title">
            <span>distribution</span>
          </div>
          <div className="distribution-list">
            {holderData?.distribution.length ? (
              <>
                <div className="distribution-row distribution-head">
                  <span>bracket</span>
                  <span>supply</span>
                  <span>avg age</span>
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
          <span>holders</span>
          <div className="panel-title-actions">
            <div className="holder-filters" aria-label="Holder time filters">
              {holderTimeFilters.map((filter) => (
                <button
                  className={
                    filter.id === holderTimeFilter
                      ? 'holder-filter holder-filter-active'
                      : 'holder-filter'
                  }
                  key={filter.id}
                  type="button"
                  onClick={() => setHolderTimeFilter(filter.id)}
                >
                  <span>{filter.label}</span>
                  <small>{holderFilterCounts.get(filter.id) || 0}</small>
                </button>
              ))}
            </div>
            <small>
              {snapshot?.scanned_at
                ? `updated ${formatRelativeTime(snapshot.scanned_at, nowMs)}`
                : 'no scan yet'}
            </small>
          </div>
        </div>
        <div className="holder-table">
          <div className="table-row table-head">
            <span>rank</span>
            <span>wallet</span>
            <span>balance</span>
            <span>supply</span>
            <span>first seen</span>
            <span>holding</span>
          </div>
          {filteredHolders.length ? (
            filteredHolders.map((holder) => (
              <div
                className={
                  isExcludedHolder(holder)
                    ? 'table-row holder-row-excluded'
                    : 'table-row'
                }
                key={holder.owner}
              >
                <span>#{holder.rank}</span>
                <span className="wallet-cell">
                  <button
                    className="wallet-link"
                    type="button"
                    title={holder.owner}
                    onClick={() => navigateToWallet(holder.owner)}
                  >
                    {shortAddress(holder.owner)}
                  </button>
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
                <span>
                  {holder.historical_holding_since_at || holder.first_seen_at
                    ? formatDate(
                        holder.historical_holding_since_at || holder.first_seen_at,
                      )
                    : 'n/a'}
                </span>
                <span
                  className={isExcludedHolder(holder) ? 'muted-value' : 'age-value'}
                  style={ageGradientStyle(
                    holder.current_holder_age_days,
                    visibleAges.min,
                    visibleAges.max,
                  )}
                >
                  {isExcludedHolder(holder) ? 'pool' : formatAge(holder.current_holder_age_days)}
                  {!isExcludedHolder(holder) && isDiamondHands(holder.current_holder_age_days) ? (
                    <img
                      className="diamond-hands-badge"
                      src={DIAMOND_HANDS_IMAGE}
                      alt="diamond hands"
                      title={`${DIAMOND_HANDS_DAYS}+ day holder`}
                      onError={(event) => {
                        event.currentTarget.style.display = 'none';
                      }}
                    />
                  ) : null}
                </span>
              </div>
            ))
          ) : (
            <div className="empty-state table-empty">
              {holderData?.holders.length
                ? 'no holders match this time filter.'
                : 'no holders cached yet. run refresh to scan the configured mint.'}
            </div>
          )}
        </div>
      </section>
        </>
      )}
    </main>
  );
}

export default App;
