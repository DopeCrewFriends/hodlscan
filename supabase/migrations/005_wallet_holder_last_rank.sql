ALTER TABLE wallet_holder_state
  ADD COLUMN IF NOT EXISTS last_rank INTEGER;
