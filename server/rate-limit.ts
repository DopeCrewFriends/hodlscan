import { getAccessLimits, type RequestAccess } from './access.js';
import { consumeRateLimitBucket } from './db.js';

export class RateLimitError extends Error {
  constructor(
    message: string,
    public retryAfterSeconds: number,
  ) {
    super(message);
    this.name = 'RateLimitError';
  }
}

export type RateLimitKind = 'cold_scan' | 'warm_read';

function bucketKey(access: RequestAccess, kind: RateLimitKind) {
  return `${access.tier}:${kind}:${access.clientId}`;
}

function limitForKind(access: RequestAccess, kind: RateLimitKind) {
  const limits = getAccessLimits(access.tier);
  return kind === 'cold_scan' ? limits.coldScanLimit : limits.warmReadLimit;
}

export async function enforceRateLimit(
  access: RequestAccess,
  kind: RateLimitKind,
) {
  const limit = limitForKind(access, kind);
  const result = await consumeRateLimitBucket({
    bucketKey: bucketKey(access, kind),
    limit,
    windowMs: 60 * 60_000,
  });

  if (!result.allowed) {
    throw new RateLimitError(
      kind === 'cold_scan'
        ? 'Too many new coin scans. Try again later or upgrade to Pro.'
        : 'Too many requests. Try again later or upgrade to Pro.',
      result.retryAfterSeconds,
    );
  }

  return result;
}

export function buildRateLimitMeta(
  access: RequestAccess,
  coldScan?: Awaited<ReturnType<typeof enforceRateLimit>>,
  warmRead?: Awaited<ReturnType<typeof enforceRateLimit>>,
) {
  const limits = getAccessLimits(access.tier);
  return {
    coldScansRemaining: coldScan?.remaining ?? limits.coldScanLimit,
    warmReadsRemaining: warmRead?.remaining ?? limits.warmReadLimit,
    resetsAt: (coldScan?.resetsAt || warmRead?.resetsAt || new Date()).toISOString(),
  };
}
