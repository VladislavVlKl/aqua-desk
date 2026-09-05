-- Защита дежурств от дублей на уровне БД (кейс авг-2026: Халитов Руслан —
-- смена 10.08 продублирована 9 раз повторными нажатиями/лагами, 27.07 — дважды).
-- Клиентский _pending/кулдаун не спасает от двух вкладок и сетевых ретраев, поэтому
-- дубль запрещаем физически.

-- 1) Завершённая смена уникальна по (тренер, филиал, начало, конец).
--    Повторный INSERT той же смены отвергается на уровне Postgres.
CREATE UNIQUE INDEX IF NOT EXISTS duties_no_dup_completed
  ON duties (trainer_id, branch, start_time, end_time)
  WHERE end_time IS NOT NULL;

-- 2) У тренера не может быть двух открытых (активных) дежурств одновременно.
--    getActiveDuty() и так читает через maybeSingle() — индекс закрепляет инвариант,
--    чтобы дубль startDuty при лаге не создал вторую открытую строку.
CREATE UNIQUE INDEX IF NOT EXISTS duties_one_active_per_trainer
  ON duties (trainer_id)
  WHERE end_time IS NULL;
