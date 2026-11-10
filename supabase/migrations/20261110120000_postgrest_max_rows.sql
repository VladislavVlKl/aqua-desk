-- PostgREST по умолчанию на Supabase отдаёт максимум 1000 строк на запрос и молча
-- обрезает остальное (Content-Range 0-999/N). В июне–августе 2026 ПТ за месяц
-- было 1150–1396 → сводка ЗП «все филиалы» и аналитика считались по неполным данным.
-- Поднимаем потолок до 10000 через in-database config PostgREST (перекрывает
-- настройку «Max rows» из дашборда). Применено 2026-11-10, проверено:
-- /rest/v1/workouts?select=id → Content-Range 0-5771/5772.
-- Откат: alter role authenticator reset pgrst.db_max_rows; notify pgrst, 'reload config';

alter role authenticator set pgrst.db_max_rows = '10000';
notify pgrst, 'reload config';
