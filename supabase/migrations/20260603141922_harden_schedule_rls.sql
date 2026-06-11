
-- Расписание: anon может только читать (публичная страница)
DROP POLICY IF EXISTS "anon_all_slots" ON schedule_slots;
CREATE POLICY "anon_read_slots" ON schedule_slots
  FOR SELECT TO anon USING (true);

-- Дежурства: anon только читает (для публичного расписания)
DROP POLICY IF EXISTS "anon_all_duties" ON duties;
CREATE POLICY "anon_read_duties" ON duties
  FOR SELECT TO anon USING (true);

-- Профили: anon только читает (нужно для отображения имён в расписании и входа)
DROP POLICY IF EXISTS "anon_all_profiles" ON profiles;
CREATE POLICY "anon_read_profiles" ON profiles
  FOR SELECT TO anon USING (true);
CREATE POLICY "anon_update_profiles" ON profiles
  FOR UPDATE TO anon USING (true);

-- Клиенты: anon полный доступ (приложение работает через anon)
-- Оставляем как есть — это фундаментальное ограничение текущей архитектуры


