import { aggregateHolders } from './analytics.js';
import { config } from './config.js';
import { getHistoricalHoldingCache, initDb, saveSnapshot } from './db.js';
import { attachHistoricalHoldingTimes } from './holder-history.js';
import { scanTokenHolders } from './holders.js';

initDb();

const scan = await scanTokenHolders();
const holders = aggregateHolders(scan.holders, scan.totalSupply, scan.decimals);
const holdersForHistory = holders.slice(0, config.maxDisplayHolders);
const historicalCache = await getHistoricalHoldingCache(
  holdersForHistory.map((holder) => holder.owner),
);
const enrichedTopHolders = await attachHistoricalHoldingTimes(
  holdersForHistory,
  historicalCache,
);
const enrichedByOwner = new Map(
  enrichedTopHolders.map((holder) => [holder.owner, holder]),
);
const enrichedHolders = holders.map(
  (holder) => enrichedByOwner.get(holder.owner) || holder,
);
const snapshot = await saveSnapshot({
  mint: config.tokenMint,
  slot: scan.slot,
  status: scan.status,
  totalSupply: scan.totalSupply.toString(),
  decimals: scan.decimals,
  source: scan.source,
  holders: enrichedHolders,
  error: scan.error,
});
const historicalCount = enrichedHolders.filter(
  (holder) => holder.historicalHoldingSinceAt,
).length;

console.log(
  JSON.stringify(
    {
      snapshotId: snapshot.id,
      status: snapshot.status,
      holders: snapshot.holder_count,
      newHolders: snapshot.new_holder_count,
      droppedHolders: snapshot.dropped_holder_count,
      historicalHoldingTimes: historicalCount,
      source: snapshot.source,
      error: snapshot.error,
    },
    null,
    2,
  ),
);
