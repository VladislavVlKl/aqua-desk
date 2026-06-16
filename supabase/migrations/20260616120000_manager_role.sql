-- ── Панель «Управляющий» (директор филиала) ──────────────────────────────
-- Роль manager: один филиал, строго только чтение (контроль и анализ).
-- Констрейнт-надмножество: включает reception (см. 20260616093000) + manager,
-- чтобы при пересборке с нуля порядок миграций не затирал ни одну роль.

ALTER TABLE profiles DROP CONSTRAINT IF EXISTS profiles_role_check;
ALTER TABLE profiles ADD CONSTRAINT profiles_role_check
  CHECK (role = ANY (ARRAY['admin'::text, 'senior_trainer'::text, 'trainer'::text, 'ceo'::text, 'reception'::text, 'manager'::text]));
