-- Partial unique index не поддерживается PostgREST upsert (onConflict не передаёт WHERE-предикат → 42P10).
-- Полный unique index на те же 5 колонок: NULLS DISTINCT (по умолчанию) — взрослые записи
-- (conducted_role IS NULL) не ограничиваются, их легитимные дубли сохраняются.
DROP INDEX IF EXISTS public.uq_group_sessions_conducted;
CREATE UNIQUE INDEX uq_group_sessions_conducted
  ON public.group_sessions (trainer_id, session_date, group_type_id, branch, conducted_role);

-- ROLLBACK (возврат к partial-индексу из 20260611221356):
-- DROP INDEX IF EXISTS public.uq_group_sessions_conducted;
-- CREATE UNIQUE INDEX uq_group_sessions_conducted
--   ON public.group_sessions (trainer_id, session_date, group_type_id, branch, conducted_role)
--   WHERE conducted_role IS NOT NULL;
