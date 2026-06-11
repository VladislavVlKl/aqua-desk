
CREATE TABLE user_sessions (
  id          bigserial PRIMARY KEY,
  tg_id       bigint NOT NULL,
  fio         text,
  role        text,
  device      text,
  js_version  text,
  opened_at   timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE user_sessions ENABLE ROW LEVEL SECURITY;

CREATE POLICY anon_insert_sessions ON user_sessions FOR INSERT TO anon WITH CHECK (true);
CREATE POLICY anon_read_sessions   ON user_sessions FOR SELECT TO anon USING (true);

CREATE INDEX idx_user_sessions_opened_at ON user_sessions(opened_at DESC);
CREATE INDEX idx_user_sessions_tg_id     ON user_sessions(tg_id);


