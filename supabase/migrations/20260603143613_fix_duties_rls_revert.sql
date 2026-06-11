
-- Дежурства: возвращаем ALL для anon — приложение пишет/удаляет через тот же ключ
DROP POLICY IF EXISTS "anon_read_duties" ON duties;
CREATE POLICY "anon_all_duties" ON duties
  FOR ALL TO anon USING (true);

-- schedule_slots тоже нужен ALL — координатор редактирует через тот же ключ
DROP POLICY IF EXISTS "anon_read_slots" ON schedule_slots;
CREATE POLICY "anon_all_slots" ON schedule_slots
  FOR ALL TO anon USING (true);


