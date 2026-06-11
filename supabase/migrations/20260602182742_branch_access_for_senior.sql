
CREATE TABLE IF NOT EXISTS branch_access (
  id         serial PRIMARY KEY,
  trainer_id integer NOT NULL REFERENCES profiles(id),
  branch     text    NOT NULL,
  created_at timestamptz DEFAULT now(),
  UNIQUE(trainer_id, branch)
);
ALTER TABLE branch_access ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_branch_access ON branch_access FOR ALL USING (true) WITH CHECK (true);


