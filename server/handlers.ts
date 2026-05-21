import {
  aggregateHolders,
  buildDashboardMetrics,
  buildDistribution,
  buildSnapshotResponse,
} from './analytics.js';
import { config } from './config.js';
import {
  getAllSnapshotHolders,
  getHistory,
  getHistoricalHoldingCache,
  getLatestSnapshot,
  getSnapshotMetrics,
  getSnapshotHolders,
  saveSnapshotMetrics,
  saveSnapshot,
} from './db.js';
import { attachHistoricalHoldingTimes } from './holder-history.js';
import { scanTokenHolders } from './holders.js';
import { getTokenMetadata } from './metadata.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

export async function getTokenResponse() {
  const metadata = await getTokenMetadata();
  return {
    mint: config.tokenMint,
    endpoints: config.rpcEndpoints.map((endpoint) => endpoint.name),
    maxDisplayHolders: config.maxDisplayHolders,
    metadata,
  };
}

export async function getHoldersResponse() {
  const snapshot = await getLatestSnapshot();
  const holders = snapshot ? await getSnapshotHolders(snapshot.id) : [];
  const snapshotMetrics = snapshot ? await getSnapshotMetrics(snapshot.id) : null;
  return buildSnapshotResponse(snapshot, holders, snapshotMetrics);
}

export async function getHistoryResponse() {
  return { history: await getHistory() };
}

export function isAuthorizedRefresh({
  authorization,
  refreshSecret,
}: {
  authorization?: string;
  refreshSecret?: string;
}) {
  if (!config.refreshSecret) {
    return false;
  }

  const bearerToken = authorization?.replace(/^Bearer\s+/i, '');
  return (
    bearerToken === config.refreshSecret ||
    refreshSecret === config.refreshSecret
  );
}

export async function refreshSnapshotResponse({
  authorization,
  refreshSecret,
}: {
  authorization?: string;
  refreshSecret?: string;
}) {
  if (!isAuthorizedRefresh({ authorization, refreshSecret })) {
    throw new HttpError(404, 'Not found');
  }

  const scan = await scanTokenHolders();
  const holders = aggregateHolders(
    scan.holders,
    scan.totalSupply,
    scan.decimals,
  );
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
  const snapshotHolders = await getSnapshotHolders(snapshot.id);
  const metricHolders = await getAllSnapshotHolders(snapshot.id);
  const metrics = buildDashboardMetrics(snapshot, metricHolders);
  const distribution = buildDistribution(metricHolders);
  await saveSnapshotMetrics({
    snapshotId: snapshot.id,
    metrics,
    distribution,
  });

  return buildSnapshotResponse(snapshot, snapshotHolders, {
    snapshot_id: snapshot.id,
    metrics,
    distribution,
    created_at: new Date().toISOString(),
  });
}

export function serializeError(error: unknown) {
  if (error instanceof HttpError) {
    return { status: error.status, body: { error: error.message } };
  }

  return {
    status: 500,
    body: { error: error instanceof Error ? error.message : String(error) },
  };
}
