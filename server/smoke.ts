import { initDb } from './db.js';
import { runSnapshotRefresh } from './handlers.js';

initDb();

const refreshed = await runSnapshotRefresh();
const historicalCount = refreshed.holders.filter(
  (holder) => holder.historical_holding_since_at,
).length;

console.log(
  JSON.stringify(
    {
      snapshotId: refreshed.snapshot?.id,
      status: refreshed.snapshot?.status,
      holders: refreshed.metrics?.holderCount,
      excludedLiquidityPools: refreshed.metrics?.excludedLiquidityPoolCount,
      excludedLiquidityPoolPct: refreshed.metrics?.excludedLiquidityPoolPct,
      newHolders: refreshed.snapshot?.new_holder_count,
      droppedHolders: refreshed.snapshot?.dropped_holder_count,
      historicalHoldingTimes: historicalCount,
      source: refreshed.snapshot?.source,
      error: refreshed.snapshot?.error,
    },
    null,
    2,
  ),
);
