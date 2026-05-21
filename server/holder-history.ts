import { callRpc } from './rpc.js';
import type { AggregatedHolder } from './types.js';

interface SignatureInfo {
  signature: string;
  blockTime: number | null;
}

interface HistoricalAge {
  sinceAt: string | null;
  source: string | null;
}

const SIGNATURE_PAGE_LIMIT = 1000;
const MAX_SIGNATURE_PAGES = Number(process.env.HOLDER_HISTORY_MAX_PAGES || 8);
const HISTORY_CONCURRENCY = Number(process.env.HOLDER_HISTORY_CONCURRENCY || 6);

async function getOldestTokenAccountSignature(
  tokenAccount: string,
): Promise<HistoricalAge> {
  let before: string | undefined;
  let oldestBlockTime: number | null = null;
  let source: string | null = null;

  for (let page = 0; page < MAX_SIGNATURE_PAGES; page += 1) {
    const response = await callRpc<SignatureInfo[]>('getSignaturesForAddress', [
      tokenAccount,
      {
        limit: SIGNATURE_PAGE_LIMIT,
        ...(before ? { before } : {}),
      },
    ]);
    source = `${response.endpoint}:getSignaturesForAddress`;

    if (response.data.length === 0) {
      break;
    }

    const oldestInPage = [...response.data]
      .reverse()
      .find((signature) => signature.blockTime !== null);
    if (oldestInPage?.blockTime) {
      oldestBlockTime = oldestInPage.blockTime;
    }

    const lastSignature = response.data[response.data.length - 1]?.signature;
    if (response.data.length < SIGNATURE_PAGE_LIMIT || !lastSignature) {
      break;
    }
    before = lastSignature;
  }

  return {
    sinceAt: oldestBlockTime
      ? new Date(oldestBlockTime * 1000).toISOString()
      : null,
    source,
  };
}

export async function attachHistoricalHoldingTimes(
  holders: AggregatedHolder[],
  knownByOwner: Map<string, HistoricalAge>,
): Promise<AggregatedHolder[]> {
  const enriched = holders.map((holder) => ({ ...holder }));
  let cursor = 0;

  async function worker() {
    while (cursor < enriched.length) {
      const index = cursor;
      cursor += 1;
      const holder = enriched[index];
      const known = knownByOwner.get(holder.owner);

      if (known?.sinceAt) {
        holder.historicalHoldingSinceAt = known.sinceAt;
        holder.historicalHoldingSource = known.source;
        continue;
      }

      try {
        const age = await getOldestTokenAccountSignature(holder.tokenAccount);
        holder.historicalHoldingSinceAt = age.sinceAt;
        holder.historicalHoldingSource = age.source;
      } catch (error) {
        holder.historicalHoldingSinceAt = null;
        holder.historicalHoldingSource =
          error instanceof Error ? error.message : String(error);
      }
    }
  }

  await Promise.all(
    Array.from(
      { length: Math.min(HISTORY_CONCURRENCY, enriched.length) },
      () => worker(),
    ),
  );

  return enriched;
}
