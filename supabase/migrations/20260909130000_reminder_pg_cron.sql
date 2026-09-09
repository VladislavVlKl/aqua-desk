-- Напоминания (remind.js) переведены с ненадёжного GitHub Actions крона на pg_cron.
-- Каждый час в :00 UTC → pg_net → Edge Function daily-reminder (порт remind.js).
-- Часовые гейты (9:00/22:00 Ташкент) и окна опросника теперь срабатывают точно.
-- GH Actions daily-reminder.yml отключён (ручной аварийный канал).

select cron.unschedule('daily-reminder-hourly')
where exists (select 1 from cron.job where jobname = 'daily-reminder-hourly');

select cron.schedule(
  'daily-reminder-hourly',
  '0 * * * *',
  $$
  select net.http_post(
    url     := 'https://nkwfvuhtpaoxsaczwsrg.supabase.co/functions/v1/daily-reminder',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'Authorization', 'Bearer eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rd2Z2dWh0cGFveHNhY3p3c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUwMzIsImV4cCI6MjA5MzcxMTAzMn0.a2rKoLNBB4OGpuENu1XUhsfbc-8JmPbxEkvLrXqUM3A'
    ),
    body    := '{}'::jsonb,
    timeout_milliseconds := 30000
  );
  $$
);
