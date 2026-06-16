-- ── Шаг 1 интеграции с 1С: панель «Ресепшн» ──────────────────────────────
-- Роль reception + статус подтверждения списаний ресепшеном.

-- 1. Роль reception в CHECK profiles.role
ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin','senior_trainer','trainer','ceo','reception']));

-- 2. Колонки подтверждения на workouts
-- DEFAULT='confirmed' специально: фича гейтится по КОДУ (db.js явно ставит 'pending'
-- на новых списаниях), а не по DB DEFAULT. Пока фронт не задеплоен, старый код
-- статус не пишет → новые записи остаются confirmed → прод не меняется.
ALTER TABLE workouts
  ADD COLUMN IF NOT EXISTS reception_status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS reception_reason text,
  ADD COLUMN IF NOT EXISTS reception_by     int,
  ADD COLUMN IF NOT EXISTS reception_at     timestamptz;

ALTER TABLE workouts DROP CONSTRAINT IF EXISTS workouts_reception_status_check;
ALTER TABLE workouts ADD CONSTRAINT workouts_reception_status_check
  CHECK (reception_status = ANY (ARRAY['pending','confirmed','rejected']));

-- 3. Те же колонки на trial_sessions (пробные подтверждаются так же)
ALTER TABLE trial_sessions
  ADD COLUMN IF NOT EXISTS reception_status text NOT NULL DEFAULT 'confirmed',
  ADD COLUMN IF NOT EXISTS reception_reason text,
  ADD COLUMN IF NOT EXISTS reception_by     int,
  ADD COLUMN IF NOT EXISTS reception_at     timestamptz;

ALTER TABLE trial_sessions DROP CONSTRAINT IF EXISTS trial_sessions_reception_status_check;
ALTER TABLE trial_sessions ADD CONSTRAINT trial_sessions_reception_status_check
  CHECK (reception_status = ANY (ARRAY['pending','confirmed','rejected']));

-- 4. Индекс для быстрой выборки очереди ресепшена по филиалу/дате
CREATE INDEX IF NOT EXISTS idx_workouts_reception
  ON workouts (branch, reception_status, workout_date);
CREATE INDEX IF NOT EXISTS idx_trials_reception
  ON trial_sessions (branch, reception_status, session_date);

-- 5. БЭКФИЛЛ: всё существующее = подтверждено, иначе текущая ЗП уедет в pending.
--    DEFAULT 'pending' оставляем для НОВЫХ записей; старые принудительно confirmed.
UPDATE workouts        SET reception_status = 'confirmed' WHERE reception_status = 'pending';
UPDATE trial_sessions  SET reception_status = 'confirmed' WHERE reception_status = 'pending';
