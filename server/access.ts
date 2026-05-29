import { createHash, timingSafeEqual } from 'node:crypto';

import { config } from './config.js';
import { lookupApiAccessKey } from './db.js';

export type AccessTier = 'free' | 'pro';

export interface RequestAccess {
  tier: AccessTier;
  clientId: string;
  keyId?: string;
  keyLabel?: string | null;
}

export interface AccessLimits {
  coldScanLimit: number;
  warmReadLimit: number;
}

export interface AccessMeta {
  tier: AccessTier;
  limits: AccessLimits;
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

function hashApiKey(apiKey: string) {
  return createHash('sha256').update(apiKey).digest('hex');
}

function safeEqual(left: string, right: string) {
  const leftBuffer = Buffer.from(left);
  const rightBuffer = Buffer.from(right);
  if (leftBuffer.length !== rightBuffer.length) {
    return false;
  }
  return timingSafeEqual(leftBuffer, rightBuffer);
}

function headerValue(
  value: string | string[] | undefined,
): string | undefined {
  if (Array.isArray(value)) {
    return value[0];
  }
  return value;
}

function extractClientIp(headers: Record<string, string | string[] | undefined>) {
  const forwarded = headerValue(headers['x-forwarded-for']);
  if (forwarded) {
    return forwarded.split(',')[0]?.trim() || 'unknown';
  }

  return (
    headerValue(headers['x-real-ip']) ||
    headerValue(headers['x-vercel-forwarded-for']) ||
    'unknown'
  );
}

function extractApiKey(headers: Record<string, string | string[] | undefined>) {
  const explicit = headerValue(headers['x-hodlscan-api-key']);
  if (explicit) {
    return explicit.trim();
  }

  const authorization = headerValue(headers.authorization);
  if (authorization?.match(/^Bearer\s+/i)) {
    return authorization.replace(/^Bearer\s+/i, '').trim();
  }

  return '';
}

async function resolveTierFromApiKey(apiKey: string): Promise<RequestAccess | null> {
  if (!apiKey) {
    return null;
  }

  for (const configuredKey of config.proApiKeys) {
    if (safeEqual(apiKey, configuredKey)) {
      return {
        tier: 'pro',
        clientId: `key:${hashApiKey(apiKey).slice(0, 16)}`,
        keyLabel: 'env',
      };
    }
  }

  const dbKey = await lookupApiAccessKey(hashApiKey(apiKey));
  if (dbKey) {
    return {
      tier: dbKey.tier,
      clientId: `key:${dbKey.id}`,
      keyId: dbKey.id,
      keyLabel: dbKey.label,
    };
  }

  return null;
}

export async function resolveRequestAccess(
  headers: Record<string, string | string[] | undefined>,
): Promise<RequestAccess> {
  const apiKey = extractApiKey(headers);
  const keyedAccess = await resolveTierFromApiKey(apiKey);
  if (keyedAccess) {
    return keyedAccess;
  }

  const ip = extractClientIp(headers);
  return {
    tier: 'free',
    clientId: `ip:${ip}`,
  };
}

export function getAccessLimits(tier: AccessTier): AccessLimits {
  return tier === 'pro' ? config.proAccessLimits : config.freeAccessLimits;
}

export function buildAccessMeta(
  access: RequestAccess,
  options: {
    cache?: AccessMeta['cache'];
    rateLimit?: AccessMeta['rateLimit'];
  } = {},
): AccessMeta {
  return {
    tier: access.tier,
    limits: getAccessLimits(access.tier),
    rateLimit: options.rateLimit,
    cache: options.cache,
    features: {
      holderCountHistory: access.tier === 'pro',
    },
  };
}

export function getLiteMintRefreshAfter(scannedAt: string) {
  return new Date(
    new Date(scannedAt).getTime() + config.liteMintTtlMs,
  ).toISOString();
}

export function isLiteSnapshotFresh(scannedAt: string) {
  return Date.now() - new Date(scannedAt).getTime() < config.liteMintTtlMs;
}
