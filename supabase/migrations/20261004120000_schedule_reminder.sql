-- Напоминания тренерам по расписанию (schedule_slots) — отдельная функция schedule-reminder,
-- точечно для выбранных тренеров (не daily-reminder).
--   recipients          — id тренеров, которым шлём (пусто = никому)
--   schedule.evening_hour — час по Ташкенту для сводки «на завтра»
--   schedule.before_min — за сколько минут до начала напоминание о занятии
--   schedule.types      — {"<id тренера>": ["duty","group","pt"]} какие типы слать; нет записи → все
--   schedule.app_url    — URL мини-аппа для кнопки «Открыть расписание»
-- Доставка — через notifications_queue → process-queue (family schedule_reminder в вайтлисте).

-- Inline-кнопки к сообщению (Telegram reply_markup) — process-queue передаёт как есть.
alter table public.notifications_queue
  add column if not exists reply_markup jsonb;

insert into public.notification_rules (name, rule_key, description, active, branches, schedule, recipients)
values ('Тренерам: напоминание по расписанию', 'schedule_reminder',
        'Вечером — расписание на завтра; за 2 ч — о каждом занятии. Типы по тренеру — schedule.types. Точечно, по списку recipients',
        true, null,
        '{"evening_hour":20,"before_min":120,"types":{},"app_url":"https://vladislavvlkl.github.io/aqua-desk/"}'::jsonb,
        array[]::integer[])
on conflict (rule_key) do update set
  name=excluded.name, description=excluded.description, schedule=excluded.schedule;

-- Запуск каждые 15 минут (окно «за 2 часа» ловится с точностью до 15 мин).
-- Bearer-токен берём из существующего job daily-reminder-hourly — не храним ключ в репозитории.
do $$
declare auth text;
begin
  select substring(command from 'Bearer [A-Za-z0-9._-]+') into auth
    from cron.job where jobname = 'daily-reminder-hourly';
  if auth is null then raise exception 'нет daily-reminder-hourly — не из чего взять токен'; end if;
  perform cron.unschedule(jobid) from cron.job where jobname = 'schedule-reminder-15m';
  perform cron.schedule('schedule-reminder-15m', '*/15 * * * *', format($f$
    select net.http_post(
      url     := 'https://nkwfvuhtpaoxsaczwsrg.supabase.co/functions/v1/schedule-reminder',
      headers := jsonb_build_object('Content-Type','application/json','Authorization',%L),
      body    := '{}'::jsonb,
      timeout_milliseconds := 30000
    );
  $f$, auth));
end $$;
