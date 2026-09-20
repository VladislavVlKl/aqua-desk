-- Пуш-уведомления координатору (Владислав id3). Data-driven (Вариант B):
-- всё крутится из notification_rules без деплоя.
-- schedule.windows — окна часов по Ташкенту; schedule.dow — дни недели по JS getUTCDay
--   (0=Вс..6=Сб; для окон 9–11 Ташкент = UTC 4–6 день по UTC совпадает с ташкентским).
-- recipients — id профилей-получателей (пуш летит на их tg_id).

alter table public.notification_rules
  add column if not exists recipients integer[];

-- 1) Принять решение (+ «если не решаю»): вечер 18–20, каждый день, если есть нерешённое.
insert into public.notification_rules (name, rule_key, description, active, branches, schedule, recipients)
values ('Координатор: на решение', 'coordinator_decisions',
        'Вечер 18–20: сводка нерешённых заявок (удаления, поздняя ПТ, пересчёт, 1С, замены), акцент >24ч',
        true, array['Chekhov Sport','Chekhov Light','Chekhov Moms'],
        '{"windows":[[18,20]]}'::jsonb, array[3])
on conflict (rule_key) do update set
  name=excluded.name, description=excluded.description, branches=excluded.branches,
  schedule=excluded.schedule, recipients=excluded.recipients;

-- 2) Аналитика: вторник, окно 9–11, недельная сводка.
insert into public.notification_rules (name, rule_key, description, active, branches, schedule, recipients)
values ('Координатор: аналитика (нед.)', 'coordinator_analytics',
        'Вторник 9–11: недельная сводка (ПТ, новые клиенты, зона риска, долги, неактивные тренеры)',
        true, array['Chekhov Sport','Chekhov Light','Chekhov Moms'],
        '{"windows":[[9,11]],"dow":[2]}'::jsonb, array[3])
on conflict (rule_key) do update set
  name=excluded.name, description=excluded.description, branches=excluded.branches,
  schedule=excluded.schedule, recipients=excluded.recipients;

-- 3) Отчёты агентов (путь A): пн/ср/пт, окно 9–11 — дублируем ссылку на Claude Routine.
insert into public.notification_rules (name, rule_key, description, active, branches, schedule, recipients)
values ('Координатор: отчёты агентов', 'coordinator_agents',
        'Пн/Ср/Пт 9–11: ссылка на Claude Routine (обновить link при смене роутины)',
        true, null,
        '{"windows":[[9,11]],"dow":[1,3,5],"link":"https://claude.ai/code/routines/trig_01PUW6uThzUPqWYmJRxiEdM7"}'::jsonb,
        array[3])
on conflict (rule_key) do update set
  name=excluded.name, description=excluded.description, branches=excluded.branches,
  schedule=excluded.schedule, recipients=excluded.recipients;
