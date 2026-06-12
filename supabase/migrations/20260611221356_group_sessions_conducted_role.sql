-- Роль проведённого занятия в детском флоу: 'суша' | 'вода' | 'процент'.
-- NULL = взрослая запись (logGroupSession), роль не применяется.
ALTER TABLE public.group_sessions
  ADD COLUMN conducted_role text
    CHECK (conducted_role IN ('суша','вода','процент')),
  ADD COLUMN group_instance_id uuid;

COMMENT ON COLUMN public.group_sessions.conducted_role IS
  'Роль проведённого занятия (детский арт-свим): суша | вода | процент. NULL = взрослая запись.';
COMMENT ON COLUMN public.group_sessions.group_instance_id IS
  'Физическая группа (trainer_groups.group_instance_id). Заполняется в детском флоу для точного учёта по instance.';

-- Защита от дублей ТОЛЬКО для детских записей (с ролью).
-- Один тренер не может дважды отметить «провёл» в одной группе/дне/роли.
-- Взрослые (conducted_role IS NULL) не затронуты — их легитимные дубли сохраняются.
CREATE UNIQUE INDEX uq_group_sessions_conducted
  ON public.group_sessions (trainer_id, session_date, group_type_id, branch, conducted_role)
  WHERE conducted_role IS NOT NULL;

-- Индекс под фильтр отчёта по instance.
CREATE INDEX idx_group_sessions_instance
  ON public.group_sessions (group_instance_id)
  WHERE group_instance_id IS NOT NULL;

-- ROLLBACK:
-- DROP INDEX IF EXISTS public.idx_group_sessions_instance;
-- DROP INDEX IF EXISTS public.uq_group_sessions_conducted;
-- ALTER TABLE public.group_sessions
--   DROP COLUMN IF EXISTS group_instance_id,
--   DROP COLUMN IF EXISTS conducted_role;
