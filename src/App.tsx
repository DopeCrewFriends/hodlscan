import type { CSSProperties, ReactNode } from 'react';
import { useEffect, useMemo, useRef, useState } from 'react';

const apiBase = import.meta.env.VITE_API_BASE_URL || '';
const AUTO_REFRESH_SECONDS = 60;
const DIAMOND_HANDS_IMAGE = '/assets/dhands.webp';
const DIAMOND_HANDS_DAYS = 90;
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

function formatDistributionLabel(label: string) {
  return label.replace(/^top\b/i, 'Top');
}

function formatDate(value: string | null | undefined) {
  return value ? dateFormatter.format(new Date(value)) : 'n/a';
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
}: {
  history: HistoryPoint[];
  nextRefreshSeconds: number;
  refreshing: boolean;
}) {
  const plottedHistory = history.filter((point) => point.holder_count > 0);
  const recentHistory = plottedHistory.slice(-24);
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
        <small>
          {refreshing
            ? 'syncing now'
            : `updates in ${nextRefreshSeconds}s`}
        </small>
      </div>
      <div className="histogram">
        {plottedHistory.length === 0 ? (
          <div className="empty-state">waiting for holder count data</div>
        ) : (
          <>
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
                    title={`#${point.id}: ${point.holder_count} holders (${delta >= 0 ? '+' : ''}${delta})`}
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
                      {wholeNumberFormatter.format(point.holder_count)}
                    </span>
                  </div>
                );
              })}
            </div>
            <div className="histogram-axis">
              <span>
                latest {recentHistory[recentHistory.length - 1]?.holder_count} holders
              </span>
            </div>
          </>
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

  useEffect(() => {
    const countdown = window.setInterval(() => {
      setNextRefreshSeconds((value) =>
        value <= 1 ? AUTO_REFRESH_SECONDS : value - 1,
      );
    }, 1000);

    const syncTimer = window.setInterval(() => {
      void syncCachedData({ silent: true });
    }, AUTO_REFRESH_SECONDS * 1000);

    return () => {
      window.clearInterval(countdown);
      window.clearInterval(syncTimer);
    };
  }, []);

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
      holderData?.holders.map((holder) => holder.current_holder_age_days) || [];
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
        .filter((holder) => isDiamondHands(holder.current_holder_age_days))
        .reduce((sum, holder) => sum + holder.pct_supply, 0) || 0;

    return Math.max(metricPct, visiblePct);
  }, [holderData, metrics]);

  return (
    <main className="terminal-shell">
      <nav className="app-nav panel" aria-label="Hodlscan">
        <div className="app-nav-inner">
          <span className="app-brand">hodlscan</span>
          <form className="token-search" role="search">
            <label htmlFor="token-search" className="sr-only">
              Search tokens
            </label>
            <input
              id="token-search"
              type="search"
              placeholder="Search tokens"
              autoComplete="off"
            />
          </form>
          <span className="nav-spacer" aria-hidden="true" />
        </div>
      </nav>
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
            value={formatAge(metrics?.oldestHolderAgeDays || 0)}
            valueStyle={ageGradientStyle(
              metrics?.oldestHolderAgeDays,
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
          <small>
            {snapshot?.scanned_at
              ? `last scan ${new Date(snapshot.scanned_at).toLocaleString()}`
              : 'no scan yet'}
          </small>
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
          {holderData?.holders.length ? (
            holderData.holders.map((holder) => (
              <div className="table-row" key={holder.owner}>
                <span>#{holder.rank}</span>
                <span title={holder.owner}>{shortAddress(holder.owner)}</span>
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
                  className="age-value"
                  style={ageGradientStyle(
                    holder.current_holder_age_days,
                    visibleAges.min,
                    visibleAges.max,
                  )}
                >
                  {formatAge(holder.current_holder_age_days)}
                  {isDiamondHands(holder.current_holder_age_days) ? (
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
              no holders cached yet. run refresh to scan the configured mint.
            </div>
          )}
        </div>
      </section>
    </main>
  );
}

export default App;
