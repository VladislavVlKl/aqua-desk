-- История ставок тренера по группе. Действующая ставка на дату D =
-- последняя запись с effective_from <= D; нет записей — legacy trainer_groups.rate_type/rate_value.
CREATE TABLE public.trainer_group_rate_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  trainer_group_id integer NOT NULL REFERENCES public.trainer_groups(id) ON DELETE CASCADE,
  rate_type text NOT NULL CHECK (rate_type IN ('percent','flat')),
  rate_value numeric NOT NULL,
  effective_from date NOT NULL,
  created_by integer,
  created_at timestamptz DEFAULT now()
);

-- RLS по модели проекта (вход через Telegram, единая anon-политика, разграничение в коде)
ALTER TABLE public.trainer_group_rate_history ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_trainer_group_rate_history ON public.trainer_group_rate_history
  FOR ALL TO anon USING (true) WITH CHECK (true);

CREATE INDEX idx_tg_rate_history_group_from
  ON public.trainer_group_rate_history (trainer_group_id, effective_from);

-- ROLLBACK (⚠️ потеря записей истории ставок):
-- DROP TABLE IF EXISTS public.trainer_group_rate_history;
