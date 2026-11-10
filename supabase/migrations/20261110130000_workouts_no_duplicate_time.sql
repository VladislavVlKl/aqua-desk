-- Запрет дублей ПТ: у одного клиента не может быть двух тренировок с одинаковым
-- workout_date (дата+время). Повод: тренер вносил 3–5 ПТ одному клиенту на одно
-- и то же время (обход 72ч-лимита / двойной ввод), 2026-10-13 … 2026-11-10.
-- Отклонённые ресепшеном (reception_status='rejected') не считаются — после
-- отклонения ПТ можно внести заново на то же время.
-- Ловит все пути вставки: форма списания, подтверждение слота, замена,
-- одобрение поздней ПТ. Старые дубли не трогает (только новые INSERT/UPDATE).
-- Фронт ловит текст DUPLICATE_WORKOUT_TIME и показывает человеку.

create or replace function public.workouts_block_duplicate_time()
returns trigger
language plpgsql
security definer                 -- видеть ПТ всех тренеров даже после ужесточения RLS
set search_path = public
as $$
begin
  if coalesce(new.reception_status, '') = 'rejected' then
    return new;
  end if;
  if exists (
    select 1 from public.workouts w
    where w.client_id = new.client_id
      and w.workout_date = new.workout_date
      and w.id is distinct from new.id
      and coalesce(w.reception_status, '') <> 'rejected'
  ) then
    raise exception 'DUPLICATE_WORKOUT_TIME: у клиента уже есть ПТ на это время'
      using errcode = 'P0001';
  end if;
  return new;
end
$$;

-- Триггерной функции EXECUTE не нужен (права проверяются при CREATE TRIGGER);
-- убираем из REST /rpc, чтобы не плодить SECURITY DEFINER-эндпоинты.
revoke execute on function public.workouts_block_duplicate_time() from public, anon, authenticated;

drop trigger if exists trg_workouts_no_duplicate_time on public.workouts;
create trigger trg_workouts_no_duplicate_time
  before insert or update of client_id, workout_date on public.workouts
  for each row execute function public.workouts_block_duplicate_time();
