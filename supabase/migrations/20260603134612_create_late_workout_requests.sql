
CREATE TABLE late_workout_requests (
  id           BIGSERIAL PRIMARY KEY,
  trainer_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  branch       TEXT NOT NULL,
  workout_date TIMESTAMPTZ NOT NULL,
  category     INTEGER NOT NULL CHECK (category IN (1,2,3)),
  reason       TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  INTEGER REFERENCES profiles(id),
  reviewed_at  TIMESTAMPTZ,
  reject_note  TEXT,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

ALTER TABLE late_workout_requests ENABLE ROW LEVEL SECURITY;

CREATE POLICY "trainer_own_late_requests" ON late_workout_requests
  FOR ALL USING (
    trainer_id = (
      SELECT id FROM profiles
      WHERE tg_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint
    )
  );

CREATE POLICY "senior_admin_late_requests" ON late_workout_requests
  FOR ALL USING (
    EXISTS (
      SELECT 1 FROM profiles
      WHERE tg_id = (current_setting('request.jwt.claims', true)::json->>'sub')::bigint
      AND role IN ('admin', 'senior_trainer', 'ceo')
    )
  );


