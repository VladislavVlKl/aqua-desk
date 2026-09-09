-- Пуш-уведомления: надёжная доставка через pg_cron + pg_net вместо
-- GitHub Actions крона (тот исполнялся раз в 6–21 ч вместо 5 мин).
--
-- pg_cron раз в минуту дёргает Edge Function process-queue (pg_net → HTTP),
-- та шлёт «замены» в Telegram-чат, хранит реальную ошибку и делает ретраи.
-- Колокольчик в приложении читает notifications_queue напрямую и не зависит от этого.

-- 1) Счётчик попыток для ретраев
alter table public.notifications_queue
  add column if not exists attempts integer not null default 0;

-- 2) Расширения
create extension if not exists pg_cron;
create extension if not exists pg_net;

-- 3) Пересоздать job идемпотентно
select cron.unschedule('process-notif-queue')
where exists (select 1 from cron.job where jobname = 'process-notif-queue');

-- 4) Раз в минуту вызывать Edge Function.
--    Bearer — публичный anon-ключ (нужен только чтобы пройти verify_jwt);
--    сервис-роль воркер берёт из встроенного окружения Edge Function.
select cron.schedule(
  'process-notif-queue',
  '* * * * *',
  $$
  select net.http_post(
    url     := 'https://nkwfvuhtpaoxsaczwsrg.supabase.co/functions/v1/process-queue',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rd2Z2dWh0cGFveHNhY3p3c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUwMzIsImV4cCI6MjA5MzcxMTAzMn0.a2rKoLNBB4OGpuENu1XUhsfbc-8JmPbxEkvLrXqUM3A'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 20000
  );
  $$
);
