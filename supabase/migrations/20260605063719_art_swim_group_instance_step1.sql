
-- 1. trainer_groups: instance + расписание
ALTER TABLE trainer_groups
  ADD COLUMN IF NOT EXISTS group_instance_id uuid,
  ADD COLUMN IF NOT EXISTS days_of_week text[],
  ADD COLUMN IF NOT EXISTS session_time text;

-- 2. group_clients: привязка к instance
ALTER TABLE group_clients
  ADD COLUMN IF NOT EXISTS group_instance_id uuid;

-- 3. group_payments: привязка к instance
ALTER TABLE group_payments
  ADD COLUMN IF NOT EXISTS group_instance_id uuid;

-- 4. group_attendance: привязка к instance
ALTER TABLE group_attendance
  ADD COLUMN IF NOT EXISTS group_instance_id uuid;

-- 5. group_sessions: тип занятия (суша/вода)
ALTER TABLE group_sessions
  ADD COLUMN IF NOT EXISTS session_type text;

-- 6. таблица потенциальных дублей имён
CREATE TABLE IF NOT EXISTS group_client_duplicate_flags (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_instance_id uuid NOT NULL,
  client_id_1 uuid NOT NULL,
  client_id_2 uuid NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  created_at timestamptz DEFAULT now()
);


