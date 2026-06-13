-- Подгруппы детских групп: '' = основная (без подгруппы), иначе название ('16:00').
-- NOT NULL DEFAULT '' — чтобы колонка участвовала в unique-ключе без ловушки NULLS DISTINCT.
ALTER TABLE public.group_clients ADD COLUMN subgroup text NOT NULL DEFAULT '';
ALTER TABLE public.group_sessions ADD COLUMN subgroup text NOT NULL DEFAULT '';

-- Пересоздание уникального индекса отметок «кто проводил» с учётом подгруппы.
-- Полный (не partial) индекс — PostgREST upsert не работает с partial (42P10, урок 20260612063445).
DROP INDEX public.uq_group_sessions_conducted;
CREATE UNIQUE INDEX uq_group_sessions_conducted
  ON public.group_sessions (trainer_id, session_date, group_type_id, branch, conducted_role, subgroup);

-- ROLLBACK (безопасен сразу после применения; после данных подгрупп — лоссовый):
-- DROP INDEX IF EXISTS public.uq_group_sessions_conducted;
-- CREATE UNIQUE INDEX uq_group_sessions_conducted
--   ON public.group_sessions (trainer_id, session_date, group_type_id, branch, conducted_role);
-- ALTER TABLE public.group_sessions DROP COLUMN IF EXISTS subgroup;
-- ALTER TABLE public.group_clients DROP COLUMN IF EXISTS subgroup;
