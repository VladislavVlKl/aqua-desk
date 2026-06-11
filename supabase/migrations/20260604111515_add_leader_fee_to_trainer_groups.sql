
ALTER TABLE trainer_groups
  ADD COLUMN IF NOT EXISTS leader_name text,
  ADD COLUMN IF NOT EXISTS leader_fee_percent integer DEFAULT 0;


