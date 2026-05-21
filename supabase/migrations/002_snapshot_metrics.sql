CREATE TABLE IF NOT EXISTS snapshot_metrics (
  snapshot_id BIGINT PRIMARY KEY REFERENCES snapshots(id) ON DELETE CASCADE,
  metrics JSONB NOT NULL,
  distribution JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
