import type { AggregatedHolder, SnapshotHolderRow, SnapshotRow } from './types.js';

const DAY_MS = 24 * 60 * 60 * 1000;
const DIAMOND_HANDS_DAYS = 90;

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

export function buildDistribution(holders: SnapshotHolderRow[]) {
  const buckets = [
    { label: 'Top 10', to: 10 },
    { label: 'Top 50', to: 50 },
    { label: 'Top 100', to: 100 },
    { label: 'Top 250', to: 250 },
  ];
  const now = Date.now();

  return buckets.map((bucket) => {
    const bucketHolders = holders.filter(
      (holder) => holder.rank <= bucket.to,
    );
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

export function buildSnapshotResponse(
  snapshot: SnapshotRow | null,
  holders: SnapshotHolderRow[],
  metricHolders = holders,
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
  const holderAges = metricHolders
    .map((holder) => {
      const since =
        holder.historical_holding_since_at || holder.current_streak_started_at;
      return since ? now - new Date(since).getTime() : 0;
    })
    .filter((age) => age > 0);
  const averageHolderAgeDays =
    holderAges.length > 0
      ? holderAges.reduce((sum, age) => sum + age, 0) / holderAges.length / DAY_MS
      : 0;
  const oldestHolderAgeDays =
    holderAges.length > 0 ? Math.max(...holderAges) / DAY_MS : 0;
  const getHolderAgeDays = (holder: SnapshotHolderRow) => {
    const since =
      holder.historical_holding_since_at || holder.current_streak_started_at;
    return since ? (now - new Date(since).getTime()) / DAY_MS : 0;
  };
  const diamondHandsPct = metricHolders
    .filter((holder) => getHolderAgeDays(holder) >= DIAMOND_HANDS_DAYS)
    .reduce((sum, holder) => sum + holder.pct_supply, 0);

  return {
    snapshot,
    holders: holders.map((holder) => ({
      ...holder,
      current_holder_age_days: getHolderAgeDays(holder),
      holding_time_source: holder.historical_holding_since_at
        ? holder.historical_holding_source || 'historical'
        : 'hodlscan_snapshot',
    })),
    metrics: {
      top10Pct: holders
        .filter((holder) => holder.rank <= 10)
        .reduce((sum, holder) => sum + holder.pct_supply, 0),
      top20Pct: holders
        .filter((holder) => holder.rank <= 20)
        .reduce((sum, holder) => sum + holder.pct_supply, 0),
      averageHolderAgeDays,
      oldestHolderAgeDays,
      diamondHandsPct,
      holderCount: snapshot.holder_count,
      newHolderCount: snapshot.new_holder_count,
      droppedHolderCount: snapshot.dropped_holder_count,
    },
    distribution: buildDistribution(holders),
  };
}
