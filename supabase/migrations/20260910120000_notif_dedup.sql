-- Атомарная защита от повторной отправки уведомлений в рамках окна.
-- Отправитель делает INSERT rule_key: успех = «зарезервировал, шлю»;
-- unique_violation = «уже слали в этом окне, пропуск». Надёжнее select-потом-insert
-- (тот двоил пуши при транзиентной ошибке чтения между часовыми прогонами pg_cron).
create table if not exists notif_dedup (
  rule_key   text primary key,
  created_at timestamptz not null default now()
);
alter table notif_dedup enable row level security;
grant all on notif_dedup to anon, authenticated;
drop policy if exists notif_dedup_all       on notif_dedup;
drop policy if exists notif_dedup_all_authed on notif_dedup;
create policy notif_dedup_all        on notif_dedup as permissive for all to anon          using (true) with check (true);
create policy notif_dedup_all_authed on notif_dedup as permissive for all to authenticated using (true) with check (true);
