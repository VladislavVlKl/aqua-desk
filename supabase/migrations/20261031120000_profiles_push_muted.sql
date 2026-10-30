-- Глушилка Telegram-пушей по профилю: profiles.push_muted=true →
-- новые строки notifications_queue для его tg_id сразу уходят в 'skipped'
-- (в Telegram не отправляются, колокольчик в приложении их показывает).
-- Ловит все источники очереди (фронт, Edge Functions, FastAPI) в одном месте.
alter table profiles add column if not exists push_muted boolean not null default false;

create or replace function notif_queue_mute() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if new.status = 'pending' and exists (
    select 1 from profiles p
    where p.push_muted and p.tg_id is not null
      and p.tg_id::text = new.recipient_tg_id::text
  ) then
    new.status := 'skipped';
    new.error_text := 'muted (profiles.push_muted)';
  end if;
  return new;
end $$;

drop trigger if exists trg_notif_queue_mute on notifications_queue;
create trigger trg_notif_queue_mute before insert on notifications_queue
  for each row execute function notif_queue_mute();

-- Координаторский акк «Администратор» (id 1) — по просьбе владельца, пуши не читает
update profiles set push_muted = true where id = 1;
