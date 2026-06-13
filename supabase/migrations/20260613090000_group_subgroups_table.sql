-- Персистентность подгрупп: раньше новая подгруппа жила только в памяти (window._gd.extraSubgroups)
-- и исчезала после перезахода, пока в неё не переведён хотя бы один ребёнок (group_clients.subgroup).
-- Теперь подгруппа — первоклассная запись, привязанная к физгруппе (instance) или к строке группы.
CREATE TABLE public.group_subgroups (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  group_instance_id uuid,
  group_id integer,
  name text NOT NULL,
  created_by integer,
  created_at timestamptz DEFAULT now(),
  CONSTRAINT group_subgroups_key CHECK (group_instance_id IS NOT NULL OR group_id IS NOT NULL)
);

-- Уникальность имени в пределах инстанса / одиночной группы
CREATE UNIQUE INDEX uq_group_subgroups_instance
  ON public.group_subgroups (group_instance_id, name) WHERE group_instance_id IS NOT NULL;
CREATE UNIQUE INDEX uq_group_subgroups_group
  ON public.group_subgroups (group_id, name) WHERE group_instance_id IS NULL;

ALTER TABLE public.group_subgroups ENABLE ROW LEVEL SECURITY;
CREATE POLICY anon_group_subgroups ON public.group_subgroups
  FOR ALL TO anon USING (true) WITH CHECK (true);

-- ROLLBACK:
-- DROP TABLE IF EXISTS public.group_subgroups;
