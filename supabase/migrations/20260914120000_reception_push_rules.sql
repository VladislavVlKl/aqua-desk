-- Вариант B: data-driven гейты для ресепшн-пушей.
-- Настройки правил (вкл/выкл, филиалы, окна времени) живут в notification_rules —
-- меняются UPDATE'ом в БД без деплоя. Логика подсчёта — в Edge Function daily-reminder.

alter table public.notification_rules
  add column if not exists branches text[],
  add column if not exists schedule jsonb;

-- rule_key уникален (используется как ключ гейта)
create unique index if not exists notification_rules_rule_key_key
  on public.notification_rules(rule_key);

-- Вечер (окно 21–23 Ташкент): неотмеченные списания за сегодня (+ за прошлые дни, если есть)
insert into public.notification_rules (name, rule_key, description, active, branches, schedule)
values ('Ресепшн: конец дня', 'reception_eod',
        'Вечер 21–23: неотмеченные списания за сегодня (+ старые, если есть)',
        true, array['Chekhov Sport','Chekhov Light'], '{"windows":[[21,23]]}'::jsonb)
on conflict (rule_key) do update
  set name = excluded.name, description = excluded.description,
      branches = excluded.branches, schedule = excluded.schedule;

-- Утро (окно 9–11 Ташкент): неотмеченные списания за прошлые дни
insert into public.notification_rules (name, rule_key, description, active, branches, schedule)
values ('Ресепшн: старые несписанные (утро)', 'reception_backlog',
        'Утро 9–11: неотмеченные списания за прошлые дни',
        true, array['Chekhov Sport','Chekhov Light'], '{"windows":[[9,11]]}'::jsonb)
on conflict (rule_key) do update
  set name = excluded.name, description = excluded.description,
      branches = excluded.branches, schedule = excluded.schedule;
