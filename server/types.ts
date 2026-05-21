export type RpcEndpointName = 'quicknode' | 'helius';

export interface RpcEndpoint {
  name: RpcEndpointName;
  url: string;
}

export interface RpcCallResult<T> {
  endpoint: RpcEndpointName;
  slot?: number;
  data: T;
}

export interface TokenAccountHolder {
  owner: string;
  tokenAccount: string;
  rawAmount: bigint;
}

export interface AggregatedHolder {
  owner: string;
  tokenAccount: string;
  rawAmount: bigint;
  uiAmount: number;
  rank: number;
  pctSupply: number;
  historicalHoldingSinceAt?: string | null;
  historicalHoldingSource?: string | null;
}

export type WalletType = 'wallet' | 'liquidity_pool' | 'program' | 'unknown';

export interface WalletClassification {
  owner: string;
  wallet_type: WalletType;
  classification_source: string;
  classification_confidence: number;
  exclude_from_holder_stats: boolean;
  updated_at: string;
}

export interface SnapshotRow {
  id: number;
  mint: string;
  slot: number | null;
  status: 'complete' | 'partial' | 'failed';
  holder_count: number;
  new_holder_count: number;
  dropped_holder_count: number;
  total_supply: string;
  decimals: number;
  scanned_at: string;
  source: string;
  error: string | null;
}

export interface SnapshotHolderRow {
  snapshot_id: number;
  owner: string;
  token_account: string;
  raw_amount: string;
  ui_amount: number;
  rank: number;
  pct_supply: number;
  first_seen_at: string | null;
  last_seen_at: string | null;
  current_streak_started_at: string | null;
  historical_holding_since_at: string | null;
  historical_holding_source: string | null;
  wallet_type: WalletType;
  classification_source: string | null;
  classification_confidence: number;
  exclude_from_holder_stats: boolean;
}

export interface HistoryRow {
  id: number;
  scanned_at: string;
  holder_count: number;
  new_holder_count: number;
  dropped_holder_count: number;
  top_10_pct: number;
  top_20_pct: number;
  status: string;
  source: string;
}

export interface SnapshotMetricsRow {
  snapshot_id: number;
  metrics: DashboardMetrics;
  distribution: DistributionBucket[];
  created_at: string;
}

export interface DashboardMetrics {
  top10Pct: number;
  top20Pct: number;
  averageHolderAgeDays: number;
  oldestHolderAgeDays: number;
  diamondHandsPct: number;
  holderCount: number;
  newHolderCount: number;
  droppedHolderCount: number;
  excludedLiquidityPoolCount: number;
  excludedLiquidityPoolPct: number;
}

export interface DistributionBucket {
  label: string;
  holderCount: number;
  pctSupply: number;
  averageAgeDays: number;
}

export interface TokenMetadata {
  mint: string;
  name: string | null;
  symbol: string | null;
  uri: string | null;
  image: string | null;
  description: string | null;
  source: string;
  error?: string;
}
