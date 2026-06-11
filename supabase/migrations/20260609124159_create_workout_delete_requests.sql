
CREATE TABLE workout_delete_requests (
  id bigserial PRIMARY KEY,
  workout_id uuid NOT NULL REFERENCES workouts(id) ON DELETE CASCADE,
  trainer_id int NOT NULL REFERENCES profiles(id),
  client_name text,
  workout_date timestamptz,
  branch text,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE workout_delete_requests ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_all_workout_delete_requests"
  ON workout_delete_requests FOR ALL TO anon
  USING (true) WITH CHECK (true);


