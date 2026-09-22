-- ФИКС: process-queue помечает app-only/не-вайтлист строки status='skipped',
-- но CHECK-констрейнт разрешал только pending/sent/failed → UPDATE падал,
-- строки навсегда оставались pending и забивали голову очереди → доставка встала
-- (последняя отправка 2026-09-17). Разрешаем 'skipped'.
alter table public.notifications_queue drop constraint if exists notifications_queue_status_check;
alter table public.notifications_queue add constraint notifications_queue_status_check
  check (status = any (array['pending','sent','failed','skipped']));
