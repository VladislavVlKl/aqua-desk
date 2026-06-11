
ALTER TABLE group_trainer_payouts
  ADD COLUMN IF NOT EXISTS bonus numeric DEFAULT 0,
  ADD COLUMN IF NOT EXISTS penalty numeric DEFAULT 0;


