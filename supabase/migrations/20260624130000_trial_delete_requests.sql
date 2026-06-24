-- Запросы тренера на удаление пробной тренировки после окна правки (30 мин).
-- Паритет с workout_delete_requests: в пределах окна тренер удаляет сам, позже —
-- запрос → координатор/старший одобряет (trial_sessions удаляется) или отклоняет.

CREATE TABLE trial_delete_requests (
  id           BIGSERIAL PRIMARY KEY,
  trial_id     BIGINT NOT NULL REFERENCES trial_sessions(id) ON DELETE CASCADE,
  trainer_id   INTEGER REFERENCES profiles(id) ON DELETE CASCADE,
  client_name  TEXT,
  session_date TIMESTAMPTZ,
  branch       TEXT,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_trial_del_branch_status ON trial_delete_requests (branch, status);

ALTER TABLE trial_delete_requests ENABLE ROW LEVEL SECURITY;

-- Приложение работает под anon-ключом (см. 20260603144448_fix_rls_anon_access)
CREATE POLICY "anon_all_trial_delete_requests" ON trial_delete_requests
  FOR ALL TO anon USING (true) WITH CHECK (true);
