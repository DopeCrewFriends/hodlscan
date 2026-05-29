import {
  buildAccessMeta,
  getLiteMintRefreshAfter,
  isLiteSnapshotFresh,
  resolveRequestAccess,
  type AccessMeta,
  type RequestAccess,
} from './access.js';
import {
  aggregateHolders,
  buildDashboardMetrics,
  buildDistribution,
  buildSnapshotResponse,
} from './analytics.js';
import { config, isSupabaseConfigured } from './config.js';
import {
  appendHolderCountHistory,
  buildMetricHolders,
  getHistory,
  getHistoricalHoldingCache,
  getLatestSnapshotForMint,
  getLiteSnapshotBundle,
  hasHolderHistory,
  getSnapshotMetrics,
  getSnapshotHolders,
  getWalletPortfolioCache,
  isCurrentHolder,
  releaseLiteScanLock,
  saveLiteSnapshot,
  saveSnapshotMetrics,
  saveSnapshot,
  saveWalletPortfolioCache,
  tryAcquireLiteScanLock,
} from './db.js';
import { attachHistoricalHoldingTimes } from './holder-history.js';
import { scanTokenHolders } from './holders.js';
import { getTokenMetadata } from './metadata.js';
import { fetchPriceHistory } from './price-history.js';
import {
  buildRateLimitMeta,
  enforceRateLimit,
} from './rate-limit.js';
import { fetchWalletPortfolio } from './wallet-portfolio.js';
import { classifyWalletOwners } from './wallet-classifier.js';
import type {
  SnapshotHolderRow,
  SnapshotMetricsRow,
  SnapshotRow,
  WalletClassification,
} from './types.js';

export class HttpError extends Error {
  constructor(
    public status: number,
    message: string,
  ) {
    super(message);
  }
}

const SOLANA_MINT_PATTERN = /^[1-9A-HJ-NP-Za-km-z]{32,44}$/;
const LITE_HISTORY_MAX_HOLDERS = Number(
  process.env.LITE_HISTORY_MAX_HOLDERS || config.maxDisplayHolders,
);
const memoryLiteScanCache = new Map<
  string,
  {
    fetchedAt: number;
    response: LiteHoldersPayload;
  }
>();

type LiteHoldersPayload = Awaited<ReturnType<typeof buildLiteHoldersPayload>>;

function buildCacheMeta(scannedAt: string): NonNullable<AccessMeta['cache']> {
  return {
    fresh: isLiteSnapshotFresh(scannedAt),
    scannedAt,
    refreshAfter: getLiteMintRefreshAfter(scannedAt),
  };
}

function attachAccess<T extends Record<string, unknown>>(
  payload: T,
  access: RequestAccess,
  options: {
    cache?: AccessMeta['cache'];
    rateLimit?: AccessMeta['rateLimit'];
  } = {},
) {
  return {
    ...payload,
    access: buildAccessMeta(access, options),
  };
}

function resolveMint(mint?: string) {
  const resolved = (mint || '').trim() || config.tokenMint;
  if (!SOLANA_MINT_PATTERN.test(resolved)) {
    throw new HttpError(400, 'Invalid mint address');
  }
  return resolved;
}

function isTrackedMint(mint: string) {
  return config.trackedMints.includes(mint);
}

export async function getTrackedCoinsResponse() {
  const coins = await Promise.all(
    config.trackedMints.map(async (mint) => {
      const metadata = await getTokenMetadata(mint);
      const snapshot = await getLatestSnapshotForMint(mint);
      const snapshotMetrics = snapshot
        ? await getSnapshotMetrics(snapshot.id)
        : null;

      return {
        mint,
        metadata,
        scannedAt: snapshot?.scanned_at ?? null,
        metrics: snapshotMetrics?.metrics
          ? {
              holderCount: snapshotMetrics.metrics.holderCount,
              diamondHandsPct: snapshotMetrics.metrics.diamondHandsPct,
              averageHolderAgeDays: snapshotMetrics.metrics.averageHolderAgeDays,
            }
          : null,
      };
    }),
  );

  return { coins };
}

function normalizeWalletClassification(
  classification: WalletClassification | undefined,
) {
  return (
    classification || {
      owner: '',
      wallet_type: 'wallet' as const,
      classification_source: null,
      classification_confidence: 0,
      exclude_from_holder_stats: false,
      updated_at: new Date().toISOString(),
    }
  );
}

async function buildLiteHoldersPayload(mint: string) {
  const scan = await scanTokenHolders(mint);
  const aggregated = aggregateHolders(
    scan.holders,
    scan.totalSupply,
    scan.decimals,
  );
  const topHolders = aggregated.slice(
    0,
    Math.min(LITE_HISTORY_MAX_HOLDERS, config.maxDisplayHolders),
  );
  const [enrichedHolders, classifications] = await Promise.all([
    attachHistoricalHoldingTimes(topHolders, new Map()),
    classifyWalletOwners(topHolders.map((holder) => holder.owner)),
  ]);
  const classByOwner = new Map(
    classifications.map((classification) => [
      classification.owner,
      classification,
    ]),
  );

  const holders: SnapshotHolderRow[] = enrichedHolders.map((holder) => {
    const classification = normalizeWalletClassification(
      classByOwner.get(holder.owner),
    );

    return {
      snapshot_id: 0,
      owner: holder.owner,
      token_account: holder.tokenAccount,
      raw_amount: holder.rawAmount.toString(),
      ui_amount: holder.uiAmount,
      rank: holder.rank,
      pct_supply: holder.pctSupply,
      first_seen_at: null,
      last_seen_at: null,
      current_streak_started_at: null,
      historical_holding_since_at: holder.historicalHoldingSinceAt || null,
      historical_holding_source: holder.historicalHoldingSource || null,
      wallet_type: classification.wallet_type,
      classification_source: classification.classification_source,
      classification_confidence: classification.classification_confidence,
      exclude_from_holder_stats: classification.exclude_from_holder_stats,
      previous_rank: null,
    };
  });

  const statCount = aggregated.length;
  const snapshot: SnapshotRow = {
    id: 0,
    mint,
    slot: scan.slot,
    status: scan.status,
    holder_count: statCount,
    new_holder_count: 0,
    dropped_holder_count: 0,
    total_supply: scan.totalSupply.toString(),
    decimals: scan.decimals,
    scanned_at: new Date().toISOString(),
    source: scan.source,
    error: scan.error || null,
  };
  const metrics = buildDashboardMetrics(snapshot, holders);
  metrics.holderCount = statCount;
  const distribution = buildDistribution(holders);
  const snapshotMetrics: SnapshotMetricsRow = {
    snapshot_id: 0,
    metrics,
    distribution,
    created_at: new Date().toISOString(),
  };

  return {
    ...buildSnapshotResponse(snapshot, holders, snapshotMetrics),
    tracking: 'lite' as const,
    classifications,
    snapshotHolders: holders,
  };
}

async function persistLiteScan(
  mint: string,
  payload: LiteHoldersPayload,
) {
  const snapshot = await saveLiteSnapshot({
    mint,
    slot: payload.snapshot?.slot ?? null,
    status: payload.snapshot?.status || 'partial',
    holderCount: payload.metrics?.holderCount || payload.snapshotHolders.length,
    totalSupply: payload.snapshot?.total_supply || '0',
    decimals: payload.snapshot?.decimals || 0,
    source: payload.snapshot?.source || 'scan',
    holders: payload.snapshotHolders,
    metrics: payload.metrics!,
    distribution: payload.distribution,
    walletClassifications: payload.classifications,
    error: payload.snapshot?.error || null,
  });

  await appendHolderCountHistory({
    mint,
    holderCount: payload.metrics?.holderCount || payload.holders.length,
    scannedAt: snapshot.scanned_at,
  });

  return snapshot;
}

async function scanAndPersistLiteMint(mint: string) {
  const payload = await buildLiteHoldersPayload(mint);

  if (isSupabaseConfigured()) {
    try {
      const snapshot = await persistLiteScan(mint, payload);
      payload.snapshot = snapshot;
    } catch (error) {
      console.warn(
        `lite snapshot persist failed for ${mint}: ${
          error instanceof Error ? error.message : String(error)
        }`,
      );
      memoryLiteScanCache.set(mint, {
        fetchedAt: Date.now(),
        response: payload,
      });
    }
  } else {
    memoryLiteScanCache.set(mint, {
      fetchedAt: Date.now(),
      response: payload,
    });
  }

  return payload;
}

function responseFromLitePayload(payload: LiteHoldersPayload) {
  const {
    classifications: _classifications,
    snapshotHolders: _snapshotHolders,
    ...response
  } = payload;
  return response;
}

async function getLiteHoldersResponse(
  mint: string,
  access: RequestAccess,
) {
  let warmReadLimit = await enforceRateLimit(access, 'warm_read');
  const cachedBundle = await getLiteSnapshotBundle(mint);

  if (cachedBundle) {
    const cacheMeta = buildCacheMeta(cachedBundle.snapshot.scanned_at);
    const response = {
      ...buildSnapshotResponse(
        cachedBundle.snapshot,
        cachedBundle.holders,
        cachedBundle.snapshotMetrics,
      ),
      tracking: 'lite' as const,
    };

    if (cacheMeta.fresh) {
      return attachAccess(response, access, {
        cache: cacheMeta,
        rateLimit: buildRateLimitMeta(access, undefined, warmReadLimit),
      });
    }

    const lockAcquired = await tryAcquireLiteScanLock(
      mint,
      config.liteScanLockMs,
    );
    if (!lockAcquired) {
      return attachAccess(response, access, {
        cache: { ...cacheMeta, fresh: false },
        rateLimit: buildRateLimitMeta(access, undefined, warmReadLimit),
      });
    }

    try {
      const refreshed = await scanAndPersistLiteMint(mint);
      return attachAccess(responseFromLitePayload(refreshed), access, {
        cache: buildCacheMeta(refreshed.snapshot!.scanned_at),
        rateLimit: buildRateLimitMeta(access, undefined, warmReadLimit),
      });
    } finally {
      await releaseLiteScanLock(mint);
    }
  }

  const memoryCached = memoryLiteScanCache.get(mint);
  if (memoryCached && isLiteSnapshotFresh(new Date(memoryCached.fetchedAt).toISOString())) {
    return attachAccess(responseFromLitePayload(memoryCached.response), access, {
      cache: buildCacheMeta(new Date(memoryCached.fetchedAt).toISOString()),
      rateLimit: buildRateLimitMeta(access, undefined, warmReadLimit),
    });
  }

  const coldScanLimit = await enforceRateLimit(access, 'cold_scan');
  const payload = await scanAndPersistLiteMint(mint);
  return attachAccess(responseFromLitePayload(payload), access, {
    cache: buildCacheMeta(
      payload.snapshot?.scanned_at || new Date().toISOString(),
    ),
    rateLimit: buildRateLimitMeta(access, coldScanLimit, warmReadLimit),
  });
}

export async function getTokenResponse(
  mint?: string,
  headers: Record<string, string | string[] | undefined> = {},
) {
  const access = await resolveRequestAccess(headers);
  const resolvedMint = resolveMint(mint);
  const metadata = await getTokenMetadata(resolvedMint);
  return attachAccess(
    {
      mint: resolvedMint,
      trackedMint: config.tokenMint,
      trackedMints: config.trackedMints,
      tracking: isTrackedMint(resolvedMint) ? ('full' as const) : ('lite' as const),
      endpoints: config.rpcEndpoints.map((endpoint) => endpoint.name),
      maxDisplayHolders: config.maxDisplayHolders,
      metadata,
    },
    access,
  );
}

export async function getHoldersResponse(
  mint?: string,
  headers: Record<string, string | string[] | undefined> = {},
) {
  const access = await resolveRequestAccess(headers);
  const resolvedMint = resolveMint(mint);

  if (isTrackedMint(resolvedMint)) {
    const snapshot = await getLatestSnapshotForMint(resolvedMint);
    const holders = snapshot ? await getSnapshotHolders(snapshot.id) : [];
    const snapshotMetrics = snapshot
      ? await getSnapshotMetrics(snapshot.id)
      : null;

    return attachAccess(
      {
        ...buildSnapshotResponse(snapshot, holders, snapshotMetrics),
        tracking: 'full' as const,
      },
      access,
    );
  }

  return getLiteHoldersResponse(resolvedMint, access);
}

export async function getHistoryResponse(
  mint?: string,
  headers: Record<string, string | string[] | undefined> = {},
) {
  const access = await resolveRequestAccess(headers);
  const resolvedMint = resolveMint(mint);

  if (isTrackedMint(resolvedMint)) {
    if (!(await hasHolderHistory(resolvedMint))) {
      return attachAccess({ history: [] }, access);
    }

    return attachAccess(
      { history: await getHistory(resolvedMint), historyLocked: false },
      access,
    );
  }

  if (access.tier !== 'pro') {
    return attachAccess({ history: [], historyLocked: true }, access);
  }

  if (!(await hasHolderHistory(resolvedMint))) {
    return attachAccess({ history: [], historyLocked: false }, access);
  }

  return attachAccess(
    { history: await getHistory(resolvedMint), historyLocked: false },
    access,
  );
}

export async function getWalletPortfolioResponse(address?: string) {
  const owner = (address || '').trim();
  if (!owner || !SOLANA_MINT_PATTERN.test(owner)) {
    throw new HttpError(400, 'Invalid wallet address');
  }

  if (!(await isCurrentHolder(owner))) {
    throw new HttpError(404, 'Wallet is not a tracked hodler');
  }

  const cached = await getWalletPortfolioCache(owner);
  if (cached) {
    const ageMs = Date.now() - new Date(cached.fetchedAt).getTime();
    if (ageMs < config.walletPortfolioCacheTtlMs) {
      return cached;
    }
  }

  try {
    const portfolio = await fetchWalletPortfolio(owner);
    await saveWalletPortfolioCache(portfolio);
    return portfolio;
  } catch (error) {
    if (cached) {
      return cached;
    }
    throw error;
  }
}

export async function getPriceHistoryResponse(mint?: string) {
  const resolvedMint = resolveMint(mint);
  const points = await fetchPriceHistory(resolvedMint);
  return { mint: resolvedMint, points };
}

export function isAuthorizedRefresh({
  authorization,
  refreshSecret,
  vercelCron,
}: {
  authorization?: string;
  refreshSecret?: string;
  vercelCron?: string;
}) {
  const allowedSecrets = [config.refreshSecret, config.cronSecret].filter(Boolean);
  if (allowedSecrets.length === 0 && process.env.NODE_ENV !== 'production') {
    return true;
  }

  if (allowedSecrets.length === 0) {
    return false;
  }

  const bearerToken = authorization?.replace(/^Bearer\s+/i, '');
  return (
    vercelCron === '1' ||
    allowedSecrets.includes(bearerToken || '') ||
    allowedSecrets.includes(refreshSecret || '')
  );
}

export async function runSnapshotRefresh() {
  const scan = await scanTokenHolders(config.tokenMint);
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
  const walletClassifications = await classifyWalletOwners(
    enrichedHolders.map((holder) => holder.owner),
  );
  const snapshot = await saveSnapshot({
    mint: config.tokenMint,
    slot: scan.slot,
    status: scan.status,
    totalSupply: scan.totalSupply.toString(),
    decimals: scan.decimals,
    source: scan.source,
    holders: enrichedHolders,
    walletClassifications,
    error: scan.error,
  });
  const metricHolders = await buildMetricHolders(
    enrichedHolders,
    walletClassifications,
  );
  const metrics = buildDashboardMetrics(snapshot, metricHolders);
  const distribution = buildDistribution(metricHolders);
  await saveSnapshotMetrics({
    snapshotId: snapshot.id,
    metrics,
    distribution,
  });
  await appendHolderCountHistory({
    mint: config.tokenMint,
    holderCount: metrics.holderCount,
    scannedAt: snapshot.scanned_at,
  });
  const snapshotHolders = await getSnapshotHolders(snapshot.id);

  return buildSnapshotResponse(snapshot, snapshotHolders, {
    snapshot_id: snapshot.id,
    metrics,
    distribution,
    created_at: new Date().toISOString(),
  });
}

export async function refreshSnapshotResponse({
  authorization,
  refreshSecret,
  vercelCron,
}: {
  authorization?: string;
  refreshSecret?: string;
  vercelCron?: string;
}) {
  if (!isAuthorizedRefresh({ authorization, refreshSecret, vercelCron })) {
    throw new HttpError(404, 'Not found');
  }

  return runSnapshotRefresh();
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
