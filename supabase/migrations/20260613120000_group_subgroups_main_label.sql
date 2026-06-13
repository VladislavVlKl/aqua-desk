-- Переименование подгрупп, включая «Основную» (главную, subgroup='').
-- Главная подгруппа технически остаётся '' в group_clients, но получает отображаемую
-- метку через строку с is_main=true (напр. '15:00'). Обычные подгруппы — is_main=false.
ALTER TABLE public.group_subgroups ADD COLUMN is_main boolean NOT NULL DEFAULT false;

-- ROLLBACK:
-- ALTER TABLE public.group_subgroups DROP COLUMN IF EXISTS is_main;
