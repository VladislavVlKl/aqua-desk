
CREATE TABLE trial_sessions (
  id           BIGSERIAL PRIMARY KEY,
  trainer_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  branch       TEXT NOT NULL,
  session_date TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  first_name   TEXT NOT NULL,
  last_name    TEXT,
  phone        TEXT,
  age          INTEGER,
  category     INTEGER NOT NULL CHECK (category IN (1,2,3)),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE trial_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainer_own_trials" ON trial_sessions
  FOR ALL USING (
    trainer_id = (
      SELECT id FROM profiles
      WHERE tg_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint
    )
  );

CREATE POLICY "admin_all_trials" ON trial_sessions
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE tg_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint
      AND role IN ('admin', 'senior_trainer', 'ceo')
    )
  );


