
CREATE TABLE IF NOT EXISTS group_trainer_payouts (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_id      integer NOT NULL REFERENCES trainer_groups(id),
  trainer_id    integer NOT NULL REFERENCES profiles(id),
  month         date    NOT NULL,
  payout_type   text    NOT NULL DEFAULT 'percent', -- 'percent' | 'fixed'
  payout_value  numeric NOT NULL DEFAULT 0,
  note          text,
  approved_by   integer REFERENCES profiles(id),
  approved_at   timestamptz DEFAULT now(),
  created_at    timestamptz DEFAULT now(),
  UNIQUE(group_id, trainer_id, month)
);
ALTER TABLE group_trainer_payouts ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_group_payouts ON group_trainer_payouts FOR ALL USING (true) WITH CHECK (true);


