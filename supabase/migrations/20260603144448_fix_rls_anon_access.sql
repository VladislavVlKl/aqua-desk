
-- trial_sessions: добавляем anon ALL (приложение использует anon ключ)
CREATE POLICY "anon_all_trials" ON trial_sessions
  FOR ALL TO anon USING (true);

-- late_workout_requests: добавляем anon ALL
CREATE POLICY "anon_all_late_requests" ON late_workout_requests
  FOR ALL TO anon USING (true);


