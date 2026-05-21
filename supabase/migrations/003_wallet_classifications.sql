CREATE TABLE IF NOT EXISTS wallet_classifications (
  owner TEXT PRIMARY KEY,
  wallet_type TEXT NOT NULL CHECK (
    wallet_type IN ('wallet', 'liquidity_pool', 'program', 'unknown')
  ),
  classification_source TEXT NOT NULL,
  classification_confidence DOUBLE PRECISION NOT NULL DEFAULT 0,
  exclude_from_holder_stats BOOLEAN NOT NULL DEFAULT false,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_classifications_excluded
  ON wallet_classifications(exclude_from_holder_stats);
