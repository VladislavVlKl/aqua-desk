
-- RLS для новой таблицы
ALTER TABLE group_client_duplicate_flags ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_all_duplicate_flags ON group_client_duplicate_flags FOR ALL TO anon USING (true) WITH CHECK (true);

-- Индексы для быстрых запросов по instance
CREATE INDEX IF NOT EXISTS idx_trainer_groups_instance ON trainer_groups(group_instance_id);
CREATE INDEX IF NOT EXISTS idx_group_clients_instance ON group_clients(group_instance_id);
CREATE INDEX IF NOT EXISTS idx_group_payments_instance ON group_payments(group_instance_id);
CREATE INDEX IF NOT EXISTS idx_group_attendance_instance ON group_attendance(group_instance_id);
CREATE INDEX IF NOT EXISTS idx_duplicate_flags_instance ON group_client_duplicate_flags(group_instance_id);


