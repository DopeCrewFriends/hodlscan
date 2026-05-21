import type {
  AggregatedHolder,
  DashboardMetrics,
  DistributionBucket,
  SnapshotHolderRow,
  SnapshotMetricsRow,
  SnapshotRow,
} from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DIAMOND_HANDS_DAYS = 90;

function getStatHolders(holders: SnapshotHolderRow[]) {
  return holders.filter((holder) => !holder.exclude_from_holder_stats);
}

export function aggregateHolders(
  holders: Array<{ owner: string; tokenAccount: string; rawAmount: bigint }>,
  supply: bigint,
  decimals: number,
): AggregatedHolder[] {
  const byOwner = new Map<string, { tokenAccount: string; rawAmount: bigint }>();

  for (const holder of holders) {
    if (holder.rawAmount <= 0n) {
      continue;
    }

    const current = byOwner.get(holder.owner);
    if (!current) {
      byOwner.set(holder.owner, {
        tokenAccount: holder.tokenAccount,
        rawAmount: holder.rawAmount,
      });
      continue;
    }

    if (holder.rawAmount > current.rawAmount) {
      current.tokenAccount = holder.tokenAccount;
    }
    current.rawAmount += holder.rawAmount;
  }

  const scale = 10 ** decimals;
  return [...byOwner.entries()]
    .map(([owner, holder]) => ({
      owner,
      tokenAccount: holder.tokenAccount,
      rawAmount: holder.rawAmount,
      uiAmount: Number(holder.rawAmount) / scale,
      rank: 0,
      pctSupply: supply > 0n ? (Number(holder.rawAmount) / Number(supply)) * 100 : 0,
    }))
    .sort((a, b) => {
      if (a.rawAmount === b.rawAmount) {
        return a.owner.localeCompare(b.owner);
      }
      return a.rawAmount > b.rawAmount ? -1 : 1;
    })
    .map((holder, index) => ({ ...holder, rank: index + 1 }));
}

export function buildDistribution(holders: SnapshotHolderRow[]): DistributionBucket[] {
  const buckets = [
    { label: 'Top 10', to: 10 },
    { label: 'Top 50', to: 50 },
    { label: 'Top 100', to: 100 },
    { label: 'Top 250', to: 250 },
  ];
  const now = Date.now();
  const statHolders = getStatHolders(holders);

  return buckets.map((bucket) => {
    const bucketHolders = statHolders.slice(0, bucket.to);
    const holderAges = bucketHolders
      .map((holder) => {
        const since =
          holder.historical_holding_since_at || holder.current_streak_started_at;
        return since ? now - new Date(since).getTime() : 0;
      })
      .filter((age) => age > 0);
    const averageAgeDays =
      holderAges.length > 0
        ? holderAges.reduce((sum, age) => sum + age, 0) /
          holderAges.length /
          DAY_MS
        : 0;

    return {
      label: bucket.label,
      holderCount: bucketHolders.length,
      pctSupply: bucketHolders.reduce(
        (sum, holder) => sum + holder.pct_supply,
        0,
      ),
      averageAgeDays,
    };
  });
}

function getHolderAgeDays(holder: SnapshotHolderRow, now: number) {
  const since =
    holder.historical_holding_since_at || holder.current_streak_started_at;
  return since ? (now - new Date(since).getTime()) / DAY_MS : 0;
}

export function buildDashboardMetrics(
  snapshot: SnapshotRow,
  holders: SnapshotHolderRow[],
): DashboardMetrics {
  const now = Date.now();
  const statHolders = getStatHolders(holders);
  const excludedHolders = holders.filter(
    (holder) => holder.exclude_from_holder_stats,
  );
  const knownHistoricalAges = statHolders
    .map((holder) => {
      const since = holder.historical_holding_since_at;
      return since ? now - new Date(since).getTime() : 0;
    })
    .filter((age) => age > 0);
  const allHolderAges = statHolders
    .map((holder) => getHolderAgeDays(holder, now))
    .filter((age) => age > 0);
  const averageHolderAgeDays =
    knownHistoricalAges.length > 0
      ? knownHistoricalAges.reduce((sum, age) => sum + age, 0) /
        knownHistoricalAges.length /
        DAY_MS
      : 0;
  const oldestHolderAgeDays =
    allHolderAges.length > 0 ? Math.max(...allHolderAges) / DAY_MS : 0;
  const diamondHandsPct = statHolders
    .filter((holder) => getHolderAgeDays(holder, now) >= DIAMOND_HANDS_DAYS)
    .reduce((sum, holder) => sum + holder.pct_supply, 0);

  return {
    top10Pct: statHolders
      .slice(0, 10)
      .reduce((sum, holder) => sum + holder.pct_supply, 0),
    top20Pct: statHolders
      .slice(0, 20)
      .reduce((sum, holder) => sum + holder.pct_supply, 0),
    averageHolderAgeDays,
    oldestHolderAgeDays,
    diamondHandsPct,
    holderCount: statHolders.length,
    newHolderCount: snapshot.new_holder_count,
    droppedHolderCount: snapshot.dropped_holder_count,
    excludedLiquidityPoolCount: excludedHolders.length,
    excludedLiquidityPoolPct: excludedHolders.reduce(
      (sum, holder) => sum + holder.pct_supply,
      0,
    ),
  };
}

export function buildSnapshotResponse(
  snapshot: SnapshotRow | null,
  holders: SnapshotHolderRow[],
  snapshotMetrics?: SnapshotMetricsRow | null,
) {
  if (!snapshot) {
    return {
      snapshot: null,
      holders: [],
      metrics: null,
      distribution: [],
    };
  }

  const now = Date.now();
  const metrics = snapshotMetrics?.metrics || buildDashboardMetrics(snapshot, holders);
  const distribution = snapshotMetrics?.distribution || buildDistribution(holders);

  return {
    snapshot,
    holders: holders.map((holder) => ({
      ...holder,
      current_holder_age_days: getHolderAgeDays(holder, now),
      holding_time_source: holder.historical_holding_since_at
        ? holder.historical_holding_source || 'historical'
        : 'hodlscan_snapshot',
    })),
    metrics,
    distribution,
  };
}
