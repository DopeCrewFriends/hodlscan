CREATE TABLE IF NOT EXISTS wallet_portfolio_cache (
  owner TEXT PRIMARY KEY,
  data JSONB NOT NULL,
  fetched_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_wallet_portfolio_cache_fetched_at
  ON wallet_portfolio_cache(fetched_at DESC);

NOTIFY pgrst, 'reload schema';
