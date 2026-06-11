
CREATE TABLE audit_log (
  id bigserial PRIMARY KEY,
  action text NOT NULL,
  actor_id int REFERENCES profiles(id) ON DELETE SET NULL,
  actor_fio text,
  target_id text,
  target_type text,
  details jsonb DEFAULT '{}',
  branch text,
  created_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE audit_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "anon_insert_audit" ON audit_log FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY "anon_read_audit"   ON audit_log FOR SELECT TO anon USING (true);
CREATE INDEX idx_audit_log_created_at ON audit_log (created_at DESC);
CREATE INDEX idx_audit_log_actor_id   ON audit_log (actor_id);
CREATE INDEX idx_audit_log_action     ON audit_log (action);
CREATE INDEX idx_audit_log_branch     ON audit_log (branch);


