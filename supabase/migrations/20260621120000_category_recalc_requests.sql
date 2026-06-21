-- Запросы тренера на пересчёт категории уже проведённых ПТ (ошибочно выставленная
-- категория). Одобряет координатор/старший тренер → category_at_moment обновляется,
-- ЗП за эти тренировки пересчитывается. scope: 'month' (с from_date) | 'all'.

CREATE TABLE category_recalc_requests (
  id           BIGSERIAL PRIMARY KEY,
  trainer_id   INTEGER NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  client_id    UUID NOT NULL REFERENCES clients(id) ON DELETE CASCADE,
  client_fio   TEXT,
  branch       TEXT,
  new_category INTEGER NOT NULL CHECK (new_category IN (1,2,3)),
  scope        TEXT NOT NULL CHECK (scope IN ('month','all')),
  from_date    DATE,
  status       TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by  INTEGER REFERENCES profiles(id),
  reviewed_at  TIMESTAMPTZ,
  reject_note  TEXT,
  applied_count INTEGER,
  created_at   TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

CREATE INDEX idx_cat_recalc_branch_status ON category_recalc_requests (branch, status);

ALTER TABLE category_recalc_requests ENABLE ROW LEVEL SECURITY;

-- Приложение работает под anon-ключом (см. 20260603144448_fix_rls_anon_access)
CREATE POLICY "anon_all_cat_recalc" ON category_recalc_requests
  FOR ALL TO anon USING (true);
