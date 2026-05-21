import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import WebSocket from 'ws';

import { config } from './config.js';
import type {
  AggregatedHolder,
  DashboardMetrics,
  DistributionBucket,
  HistoryRow,
  SnapshotHolderRow,
  SnapshotMetricsRow,
  SnapshotRow,
  WalletClassification,
} from './types.js';

const PAGE_SIZE = 1000;
const READ_IN_CHUNK_SIZE = 100;
const WRITE_CHUNK_SIZE = 500;

let supabase: SupabaseClient | null = null;

function getSupabase() {
  if (!config.supabaseUrl || !config.supabaseServiceRoleKey) {
    throw new Error(
      'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY.',
    );
  }

  supabase ||= createClient(config.supabaseUrl, config.supabaseServiceRoleKey, {
    auth: {
      persistSession: false,
      autoRefreshToken: false,
    },
    realtime: {
      transport: WebSocket as unknown as typeof globalThis.WebSocket,
    },
  });

  return supabase;
}

export function initDb(): void {
  // Supabase schema is managed by supabase/migrations/001_hodlscan_schema.sql.
}

interface SaveSnapshotInput {
  mint: string;
  slot: number | null;
  status: 'complete' | 'partial' | 'failed';
  totalSupply: string;
  decimals: number;
  source: string;
  holders: AggregatedHolder[];
  walletClassifications?: WalletClassification[];
  error?: string | null;
}

interface ExistingHolderState {
  owner: string;
  first_seen_at: string;
  last_seen_at: string;
  current_streak_started_at: string;
  is_current_holder: boolean;
  peak_balance: string;
  historical_holding_since_at: string | null;
  historical_holding_source: string | null;
}

type SnapshotHolderRecord = Omit<
  SnapshotHolderRow,
  | 'first_seen_at'
  | 'last_seen_at'
  | 'current_streak_started_at'
  | 'wallet_type'
  | 'classification_source'
  | 'classification_confidence'
  | 'exclude_from_holder_stats'
> & {
  first_seen_at?: never;
  last_seen_at?: never;
  current_streak_started_at?: never;
  wallet_type?: never;
  classification_source?: never;
  classification_confidence?: never;
  exclude_from_holder_stats?: never;
};

const DEFAULT_WALLET_CLASSIFICATION = {
  wallet_type: 'unknown',
  classification_source: null,
  classification_confidence: 0,
  exclude_from_holder_stats: false,
} as const;

const KNOWN_POOL_CLASSIFICATION_SOURCES = new Map<string, string>([
  ['rpc_owner:CAMMCzo5YL8w4VFF8KVHrK22GGUsp5VTaW7grrKgrWqK', 'rpc_owner:raydium_clmm'],
  ['rpc_owner:whirLbMiicVdio4qvUfM5KAg6Ct8VwpYzGff3uctyCc', 'rpc_owner:orca_whirlpool'],
]);

function isMissingWalletClassificationsTable(error: { message: string }) {
  return (
    error.message.includes('wallet_classifications') &&
    (error.message.includes('schema cache') ||
      error.message.includes('does not exist'))
  );
}

function normalizeWalletClassification(
  classification: WalletClassification | undefined,
) {
  if (!classification) {
    return DEFAULT_WALLET_CLASSIFICATION;
  }

  const normalizedSource = KNOWN_POOL_CLASSIFICATION_SOURCES.get(
    classification.classification_source,
  );
  if (normalizedSource) {
    return {
      ...classification,
      wallet_type: 'liquidity_pool' as const,
      classification_source: normalizedSource,
      classification_confidence: Math.max(
        classification.classification_confidence,
        0.92,
      ),
      exclude_from_holder_stats: true,
    };
  }

  return classification;
}

function chunk<T>(values: T[], size: number) {
  const chunks: T[][] = [];
  for (let index = 0; index < values.length; index += size) {
    chunks.push(values.slice(index, index + size));
  }
  return chunks;
}

async function fetchAll<T>(
  buildQuery: (from: number, to: number) => PromiseLike<{
    data: T[] | null;
    error: { message: string } | null;
  }>,
) {
  const rows: T[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const to = from + PAGE_SIZE - 1;
    const { data, error } = await buildQuery(from, to);
    if (error) {
      throw new Error(error.message);
    }

    const page = data || [];
    rows.push(...page);
    if (page.length < PAGE_SIZE) {
      return rows;
    }
  }
}

async function getWalletStates(
  owners: string[],
): Promise<Map<string, ExistingHolderState>> {
  if (owners.length === 0) {
    return new Map();
  }

  const rows: ExistingHolderState[] = [];
  for (const ownerChunk of chunk([...new Set(owners)], READ_IN_CHUNK_SIZE)) {
    const { data, error } = await getSupabase()
      .from('wallet_holder_state')
      .select(
        'owner, first_seen_at, last_seen_at, current_streak_started_at, is_current_holder, peak_balance, historical_holding_since_at, historical_holding_source',
      )
      .in('owner', ownerChunk);

    if (error) {
      throw new Error(error.message);
    }

    rows.push(...((data || []) as ExistingHolderState[]));
  }

  return new Map(rows.map((row) => [row.owner, row]));
}

async function getWalletClassifications(
  owners: string[],
): Promise<Map<string, WalletClassification>> {
  if (owners.length === 0) {
    return new Map();
  }

  const rows: WalletClassification[] = [];
  for (const ownerChunk of chunk([...new Set(owners)], READ_IN_CHUNK_SIZE)) {
    const { data, error } = await getSupabase()
      .from('wallet_classifications')
      .select(
        'owner, wallet_type, classification_source, classification_confidence, exclude_from_holder_stats, updated_at',
      )
      .in('owner', ownerChunk);

    if (error) {
      if (isMissingWalletClassificationsTable(error)) {
        return new Map();
      }
      throw new Error(error.message);
    }

    rows.push(...((data || []) as WalletClassification[]));
  }

  return new Map(rows.map((row) => [row.owner, row]));
}

async function hydrateSnapshotHolders(
  holders: SnapshotHolderRecord[],
): Promise<SnapshotHolderRow[]> {
  const states = await getWalletStates(holders.map((holder) => holder.owner));
  const classifications = await getWalletClassifications(
    holders.map((holder) => holder.owner),
  );

  return holders.map((holder) => {
    const state = states.get(holder.owner);
    const classification = normalizeWalletClassification(
      classifications.get(holder.owner),
    );
    return {
      ...holder,
      first_seen_at: state?.first_seen_at || null,
      last_seen_at: state?.last_seen_at || null,
      current_streak_started_at: state?.current_streak_started_at || null,
      historical_holding_since_at:
        holder.historical_holding_since_at ||
        state?.historical_holding_since_at ||
        null,
      historical_holding_source:
        holder.historical_holding_source ||
        state?.historical_holding_source ||
        null,
      wallet_type:
        classification.wallet_type || DEFAULT_WALLET_CLASSIFICATION.wallet_type,
      classification_source:
        classification.classification_source ||
        DEFAULT_WALLET_CLASSIFICATION.classification_source,
      classification_confidence:
        classification.classification_confidence ||
        DEFAULT_WALLET_CLASSIFICATION.classification_confidence,
      exclude_from_holder_stats:
        classification.exclude_from_holder_stats ||
        DEFAULT_WALLET_CLASSIFICATION.exclude_from_holder_stats,
    };
  });
}

export async function saveSnapshot(input: SaveSnapshotInput): Promise<SnapshotRow> {
  const now = new Date().toISOString();
  const previousRows = await fetchAll<{ owner: string }>((from, to) =>
    getSupabase()
      .from('wallet_holder_state')
      .select('owner')
      .eq('is_current_holder', true)
      .range(from, to),
  );
  const previousOwners = new Set(previousRows.map((row) => row.owner));
  const currentOwners = new Set(input.holders.map((holder) => holder.owner));
  const newHolderCount = [...currentOwners].filter(
    (owner) => !previousOwners.has(owner),
  ).length;
  const droppedOwners = [...previousOwners].filter(
    (owner) => !currentOwners.has(owner),
  );

  const { data: insertedSnapshot, error: snapshotError } = await getSupabase()
    .from('snapshots')
    .insert({
      mint: input.mint,
      slot: input.slot,
      status: input.status,
      holder_count: input.holders.length,
      new_holder_count: newHolderCount,
      dropped_holder_count: droppedOwners.length,
      total_supply: input.totalSupply,
      decimals: input.decimals,
      scanned_at: now,
      source: input.source,
      error: input.error || null,
    })
    .select('*')
    .single();

  if (snapshotError) {
    throw new Error(snapshotError.message);
  }

  const snapshot = insertedSnapshot as SnapshotRow;
  const snapshotId = snapshot.id;

  if (input.walletClassifications?.length) {
    for (const classificationChunk of chunk(
      input.walletClassifications,
      WRITE_CHUNK_SIZE,
    )) {
      const { error } = await getSupabase()
        .from('wallet_classifications')
        .upsert(classificationChunk, { onConflict: 'owner' });

      if (error) {
        if (isMissingWalletClassificationsTable(error)) {
          break;
        }
        throw new Error(error.message);
      }
    }
  }

  const snapshotHolders = input.holders.map((holder) => ({
    snapshot_id: snapshotId,
    owner: holder.owner,
    token_account: holder.tokenAccount,
    raw_amount: holder.rawAmount.toString(),
    ui_amount: holder.uiAmount,
    rank: holder.rank,
    pct_supply: holder.pctSupply,
    historical_holding_since_at: holder.historicalHoldingSinceAt || null,
    historical_holding_source: holder.historicalHoldingSource || null,
  }));

  for (const holderChunk of chunk(snapshotHolders, WRITE_CHUNK_SIZE)) {
    const { error } = await getSupabase()
      .from('snapshot_holders')
      .insert(holderChunk);

    if (error) {
      throw new Error(error.message);
    }
  }

  for (const ownerChunk of chunk(droppedOwners, WRITE_CHUNK_SIZE)) {
    const { error } = await getSupabase()
      .from('wallet_holder_state')
      .update({
        is_current_holder: false,
        last_snapshot_id: snapshotId,
      })
      .in('owner', ownerChunk);

    if (error) {
      throw new Error(error.message);
    }
  }

  const existingStates = await getWalletStates(
    input.holders.map((holder) => holder.owner),
  );
  const stateRows = input.holders.map((holder) => {
    const existing = existingStates.get(holder.owner);
    const existingPeak = existing ? BigInt(existing.peak_balance) : 0n;
    const peakBalance =
      holder.rawAmount > existingPeak ? holder.rawAmount : existingPeak;
    const currentStreakStartedAt =
      existing && existing.is_current_holder
        ? existing.current_streak_started_at
        : now;

    return {
      owner: holder.owner,
      first_seen_at: existing?.first_seen_at || now,
      last_seen_at: now,
      current_streak_started_at: currentStreakStartedAt,
      last_snapshot_id: snapshotId,
      is_current_holder: true,
      peak_balance: peakBalance.toString(),
      latest_balance: holder.rawAmount.toString(),
      historical_holding_since_at:
        existing?.historical_holding_since_at ||
        holder.historicalHoldingSinceAt ||
        null,
      historical_holding_source:
        existing?.historical_holding_source ||
        holder.historicalHoldingSource ||
        null,
    };
  });

  for (const stateChunk of chunk(stateRows, WRITE_CHUNK_SIZE)) {
    const { error } = await getSupabase()
      .from('wallet_holder_state')
      .upsert(stateChunk, { onConflict: 'owner' });

    if (error) {
      throw new Error(error.message);
    }
  }

  return snapshot;
}

export async function getSnapshotById(id: number): Promise<SnapshotRow> {
  const { data, error } = await getSupabase()
    .from('snapshots')
    .select('*')
    .eq('id', id)
    .single();

  if (error) {
    throw new Error(error.message);
  }

  return data as SnapshotRow;
}

export async function getLatestSnapshot(): Promise<SnapshotRow | null> {
  const { data, error } = await getSupabase()
    .from('snapshots')
    .select('*')
    .gt('holder_count', 0)
    .order('id', { ascending: false })
    .limit(25);

  if (error) {
    throw new Error(error.message);
  }

  const snapshots = (data || []) as SnapshotRow[];
  for (const snapshot of snapshots) {
    const { data: holderRows, error: holderError } = await getSupabase()
      .from('snapshot_holders')
      .select('snapshot_id')
      .eq('snapshot_id', snapshot.id)
      .limit(1);

    if (holderError) {
      throw new Error(holderError.message);
    }

    if ((holderRows || []).length > 0) {
      return snapshot;
    }
  }

  return null;
}

export async function getSnapshotHolders(
  snapshotId: number,
): Promise<SnapshotHolderRow[]> {
  const { data, error } = await getSupabase()
    .from('snapshot_holders')
    .select('*')
    .eq('snapshot_id', snapshotId)
    .order('rank', { ascending: true })
    .limit(config.maxDisplayHolders);

  if (error) {
    throw new Error(error.message);
  }

  return hydrateSnapshotHolders((data || []) as SnapshotHolderRecord[]);
}

export async function getAllSnapshotHolders(
  snapshotId: number,
): Promise<SnapshotHolderRow[]> {
  const holders = await fetchAll<SnapshotHolderRecord>((from, to) =>
    getSupabase()
      .from('snapshot_holders')
      .select('*')
      .eq('snapshot_id', snapshotId)
      .order('rank', { ascending: true })
      .range(from, to),
  );

  return hydrateSnapshotHolders(holders);
}

export async function saveSnapshotMetrics({
  snapshotId,
  metrics,
  distribution,
}: {
  snapshotId: number;
  metrics: DashboardMetrics;
  distribution: DistributionBucket[];
}) {
  const { error } = await getSupabase()
    .from('snapshot_metrics')
    .upsert(
      {
        snapshot_id: snapshotId,
        metrics,
        distribution,
      },
      { onConflict: 'snapshot_id' },
    );

  if (error) {
    throw new Error(error.message);
  }
}

export async function getSnapshotMetrics(
  snapshotId: number,
): Promise<SnapshotMetricsRow | null> {
  const { data, error } = await getSupabase()
    .from('snapshot_metrics')
    .select('*')
    .eq('snapshot_id', snapshotId)
    .maybeSingle();

  if (error) {
    throw new Error(error.message);
  }

  return (data as SnapshotMetricsRow | null) || null;
}

export async function getHistoricalHoldingCache(
  owners: string[],
): Promise<Map<string, { sinceAt: string | null; source: string | null }>> {
  if (owners.length === 0) {
    return new Map();
  }

  const rows = [...(await getWalletStates(owners)).values()];

  return new Map(
    rows.map((row) => [
      row.owner,
      {
        sinceAt: row.historical_holding_since_at,
        source: row.historical_holding_source,
      },
    ]),
  );
}

export async function getHistory(): Promise<HistoryRow[]> {
  const snapshots = await fetchAll<SnapshotRow>((from, to) =>
    getSupabase()
      .from('snapshots')
      .select('*')
      .gt('holder_count', 0)
      .order('id', { ascending: true })
      .range(from, to),
  );
  if (snapshots.length === 0) {
    return [];
  }

  const snapshotIds = snapshots.map((snapshot) => snapshot.id);
  const metricRows: SnapshotMetricsRow[] = [];
  for (const idChunk of chunk(snapshotIds, READ_IN_CHUNK_SIZE)) {
    const { data, error } = await getSupabase()
      .from('snapshot_metrics')
      .select('*')
      .in('snapshot_id', idChunk);

    if (error) {
      throw new Error(error.message);
    }

    metricRows.push(...((data || []) as SnapshotMetricsRow[]));
  }
  const metricsBySnapshot = new Map(
    metricRows.map((row) => [row.snapshot_id, row.metrics]),
  );

  return snapshots.map((snapshot) => {
    const metrics = metricsBySnapshot.get(snapshot.id);
    return {
      id: snapshot.id,
      scanned_at: snapshot.scanned_at,
      holder_count: metrics?.holderCount || snapshot.holder_count,
      new_holder_count: snapshot.new_holder_count,
      dropped_holder_count: snapshot.dropped_holder_count,
      top_10_pct: metrics?.top10Pct || 0,
      top_20_pct: metrics?.top20Pct || 0,
      status: snapshot.status,
      source: snapshot.source,
    };
  });
}
