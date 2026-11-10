-- Защита от дублей (2026-11-10).
-- Кейсы: Смаилова (3 тапа «Оформить» → пакет 10 ПТ оформился 3 раза, +20 лишних),
--        Кучаров (2×), Камбаров (2× + 5 одинаковых ПТ из формы).
--
-- 1) package_purchases — журнал каждой покупки пакета (у взрослых абонемент
--    суммируется в одну строку subscriptions, отдельной истории покупок не было).
-- 2) buy_package(...) — покупка ОДНОЙ транзакцией (вместо 3–4 запросов с фронта)
--    + advisory-lock на клиента + окно 3 минуты: повторная покупка тому же клиенту
--    отклоняется ошибкой DUPLICATE_PURCHASE:<сек>. Фронт переспрашивает
--    «это действительно второй пакет?» и при «да» вызывает с p_force=true.
-- 3) Сигнал координатору в Telegram (правило notification_rules 'coordinator_duplicates',
--    получатели — recipients): подтверждённая повторная покупка за 3 минуты и
--    2+ ПТ одному клиенту за один день (одинаковое время уже запрещено триггером
--    trg_workouts_no_duplicate_time, миграция 20261110130000).
--
-- Откат:
--   drop trigger if exists trg_workouts_signal_same_day on public.workouts;
--   drop function if exists public.workouts_signal_same_day();
--   drop function if exists public.buy_package(uuid,integer,boolean,integer,date,date,boolean,boolean);
--   drop function if exists public.notify_duplicate(text,text);
--   delete from public.notification_rules where rule_key='coordinator_duplicates';
--   drop table if exists public.package_purchases;   -- (история покупок пропадёт)
--   + фронт db.schedule.js buyNewPackage вернуть на прямые запросы.

-- ── 1. Журнал покупок ────────────────────────────────────────────────
create table if not exists public.package_purchases (
  id              bigserial primary key,
  client_id       uuid    not null references public.clients(id)  on delete cascade,
  trainer_id      integer          references public.profiles(id) on delete set null,
  quantity        integer not null check (quantity > 0),
  is_child        boolean not null,
  is_weekend      boolean not null default false,
  start_date      date    not null,
  end_date        date,
  subscription_id integer,
  balance_before  integer,
  balance_after   integer,
  forced          boolean not null default false,   -- оформлен как «второй пакет» в окне 3 мин
  created_at      timestamptz not null default now()
);
create index if not exists package_purchases_client_created_idx
  on public.package_purchases (client_id, created_at desc);
-- RLS включён без политик: пишет/читает только buy_package (security definer).
alter table public.package_purchases enable row level security;

-- ── 2. Правило сигнала ───────────────────────────────────────────────
insert into public.notification_rules (name, active, rule_key, recipients, description)
select 'Координатор: возможные дубли', true, 'coordinator_duplicates', array[1],
       'Сразу: 2+ ПТ одному клиенту за день; повторная покупка пакета за 3 мин (подтверждённая). Получатели — recipients'
where not exists (select 1 from public.notification_rules where rule_key = 'coordinator_duplicates');

-- ── 3. Постановка сигнала в очередь (дедуп по ключу через notif_dedup) ─
create or replace function public.notify_duplicate(p_key text, p_message text)
returns void language plpgsql security definer set search_path = public as $$
declare v_rule record; r record;
begin
  select active, recipients into v_rule from notification_rules where rule_key = 'coordinator_duplicates';
  if not found or not coalesce(v_rule.active, false) then return; end if;
  insert into notif_dedup (rule_key) values (p_key) on conflict do nothing;
  if not found then return; end if;                       -- уже сигналили по этому ключу
  for r in select id, fio, tg_id from profiles
           where id = any (coalesce(v_rule.recipients, '{}'::int[])) and tg_id is not null loop
    insert into notifications_queue (recipient_tg_id, recipient_name, message, rule_key, scheduled_for, status)
    values (r.tg_id, r.fio, p_message, p_key, now(), 'pending');
  end loop;
end $$;
revoke execute on function public.notify_duplicate(text, text) from public, anon, authenticated;

create or replace function public._html(t text) returns text
language sql immutable set search_path = public as $$
  select replace(replace(replace(coalesce(t, ''), '&', '&amp;'), '<', '&lt;'), '>', '&gt;')
$$;

-- ── 4. Покупка пакета одной транзакцией ──────────────────────────────
create or replace function public.buy_package(
  p_client_id  uuid,
  p_trainer_id integer,
  p_is_child   boolean,
  p_quantity   integer,
  p_start      date,
  p_end        date    default null,
  p_is_weekend boolean default false,
  p_force      boolean default false
) returns jsonb language plpgsql security definer set search_path = public as $$
declare
  v_before int; v_after int; v_fio text; v_tr text;
  v_sub subscriptions%rowtype;
  v_prev_at timestamptz; v_prev_qty int; v_dup boolean := false;
begin
  if p_quantity is null or p_quantity <= 0 or p_quantity > 200 then
    raise exception 'BAD_QUANTITY: %', p_quantity using errcode = 'P0001';
  end if;
  if p_start is null then raise exception 'BAD_START' using errcode = 'P0001'; end if;

  -- Сериализуем покупки одного клиента: 2–3 тапа / два устройства идут по очереди.
  perform pg_advisory_xact_lock(hashtextextended('buy_package:' || p_client_id::text, 0));

  select balance, fio into v_before, v_fio from clients where id = p_client_id for update;
  if not found then raise exception 'CLIENT_NOT_FOUND' using errcode = 'P0001'; end if;

  select created_at, quantity into v_prev_at, v_prev_qty
    from package_purchases
   where client_id = p_client_id and created_at > now() - interval '3 minutes'
   order by created_at desc limit 1;
  v_dup := found;
  if v_dup and not coalesce(p_force, false) then
    raise exception 'DUPLICATE_PURCHASE:%', greatest(1, extract(epoch from now() - v_prev_at)::int)
      using errcode = 'P0001';
  end if;

  if p_is_child then
    -- Детский: старый абонемент закрывается (остаток сгорает), новый — с датами.
    update subscriptions set is_active = false, end_date = p_start, closing_note = 'Истёк. Остаток сгорел.'
     where client_id = p_client_id and is_active;
    update clients set balance = p_quantity, freeze_start = null, freeze_end = null,
           is_weekend = coalesce(p_is_weekend, false),
           subscription_start = p_start, subscription_end = p_end
     where id = p_client_id;
    insert into subscriptions (client_id, trainer_id, start_date, end_date, initial_balance, is_active, is_weekend)
    values (p_client_id, p_trainer_id, p_start, p_end, p_quantity, true, coalesce(p_is_weekend, false))
    returning * into v_sub;
    v_after := p_quantity;
  else
    -- Взрослый: ПТ суммируются, срок не ставится (бессрочный пакет).
    update clients set balance = coalesce(balance, 0) + p_quantity, freeze_start = null, freeze_end = null
     where id = p_client_id returning balance into v_after;
    select * into v_sub from subscriptions
     where client_id = p_client_id and is_active order by id desc limit 1 for update;
    if not found then
      insert into subscriptions (client_id, trainer_id, start_date, initial_balance, is_active)
      values (p_client_id, p_trainer_id, p_start, p_quantity, true)
      returning * into v_sub;
    else
      update subscriptions set initial_balance = coalesce(initial_balance, 0) + p_quantity
       where id = v_sub.id returning * into v_sub;
    end if;
  end if;

  insert into package_purchases (client_id, trainer_id, quantity, is_child, is_weekend, start_date, end_date,
                                 subscription_id, balance_before, balance_after, forced)
  values (p_client_id, p_trainer_id, p_quantity, p_is_child, coalesce(p_is_weekend, false), p_start,
          case when p_is_child then p_end end, v_sub.id, v_before, v_after, v_dup);

  if v_dup then
    select fio into v_tr from profiles where id = p_trainer_id;
    begin
      perform notify_duplicate(
        'coordinator_duplicates:buy:' || p_client_id || ':' || to_char(now(), 'YYYYMMDDHH24MI'),
        '⚠️ <b>Повторная покупка пакета</b>' || chr(10) ||
        'Клиент: ' || _html(v_fio) || chr(10) ||
        'Оформил: ' || _html(coalesce(v_tr, '—')) || chr(10) ||
        'Два пакета за 3 минуты: ' || v_prev_qty || ' ПТ и ' || p_quantity || ' ПТ (подтвердил «второй пакет»).' || chr(10) ||
        'Остаток сейчас: ' || v_after || ' ПТ. Если это двойное нажатие — поправьте остаток коррекцией.');
    exception when others then null;   -- сигнал не должен ломать покупку
    end;
  end if;

  return jsonb_build_object('subscription', to_jsonb(v_sub), 'balance', v_after, 'balance_before', v_before);
end $$;
revoke execute on function public.buy_package(uuid,integer,boolean,integer,date,date,boolean,boolean) from public;
grant  execute on function public.buy_package(uuid,integer,boolean,integer,date,date,boolean,boolean) to anon, authenticated;

-- ── 5. Сигнал: 2+ ПТ одному клиенту за один день ─────────────────────
create or replace function public.workouts_signal_same_day()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_day date; v_n int; v_list text; v_fio text; v_tr text;
begin
  if coalesce(new.reception_status, '') = 'rejected' then return null; end if;
  v_day := (new.workout_date at time zone 'Asia/Tashkent')::date;
  select count(*), string_agg(to_char(w.workout_date at time zone 'Asia/Tashkent', 'HH24:MI'), ', ' order by w.workout_date)
    into v_n, v_list
    from workouts w
   where w.client_id = new.client_id
     and coalesce(w.reception_status, '') <> 'rejected'
     and w.workout_date >= (v_day::timestamp at time zone 'Asia/Tashkent')
     and w.workout_date <  ((v_day + 1)::timestamp at time zone 'Asia/Tashkent');
  if v_n < 2 then return null; end if;
  select fio into v_fio from clients  where id = new.client_id;
  select fio into v_tr  from profiles where id = new.trainer_id;
  perform notify_duplicate(
    'coordinator_duplicates:pt:' || new.client_id || ':' || v_day,
    '⚠️ <b>Возможный дубль ПТ</b>' || chr(10) ||
    'Клиент: ' || _html(v_fio) || chr(10) ||
    'Тренер: ' || _html(coalesce(v_tr, '—')) || coalesce(' (' || _html(new.branch) || ')', '') || chr(10) ||
    to_char(v_day, 'DD.MM') || ': ' || v_n || ' ПТ — ' || v_list || chr(10) ||
    'Если лишняя — попросите ресепшн отклонить её или удалите запись.');
  return null;
exception when others then
  return null;   -- сигнал никогда не ломает списание
end $$;
revoke execute on function public.workouts_signal_same_day() from public, anon, authenticated;

drop trigger if exists trg_workouts_signal_same_day on public.workouts;
create trigger trg_workouts_signal_same_day after insert on public.workouts
  for each row execute function public.workouts_signal_same_day();
