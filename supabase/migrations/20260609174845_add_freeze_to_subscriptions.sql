ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS freeze_start date, ADD COLUMN IF NOT EXISTS freeze_end date;

