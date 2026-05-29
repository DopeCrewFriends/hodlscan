ALTER TABLE snapshots
  ADD COLUMN IF NOT EXISTS tracking TEXT NOT NULL DEFAULT 'full'
  CHECK (tracking IN ('full', 'lite'));

CREATE INDEX IF NOT EXISTS idx_snapshots_mint_tracking_scanned_at
  ON snapshots(mint, tracking, scanned_at DESC);

CREATE TABLE IF NOT EXISTS api_access_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  key_hash TEXT NOT NULL UNIQUE,
  tier TEXT NOT NULL DEFAULT 'pro' CHECK (tier IN ('pro')),
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  revoked_at TIMESTAMPTZ
);

CREATE TABLE IF NOT EXISTS api_rate_limit_buckets (
  bucket_key TEXT PRIMARY KEY,
  window_start TIMESTAMPTZ NOT NULL,
  count INTEGER NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS lite_scan_locks (
  mint TEXT PRIMARY KEY,
  locked_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
