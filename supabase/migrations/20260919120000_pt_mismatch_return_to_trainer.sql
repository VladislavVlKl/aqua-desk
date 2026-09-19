-- Расхождение остатка ПТ с 1С — доработка:
--  1) координатор может вернуть заявку тренеру на уточнение (со своим текстом);
--  2) храним остаток на момент ПЕРЕрасчёта (для честного отчёта ЗП),
--     т.к. ФОТ-разница теперь считается от ТЕКУЩЕГО остатка, а не от снимка при флаге.

-- Новые статусы: returned = вернули тренеру, ждём повторной/уточнённой заявки.
alter table pt_mismatch_flags drop constraint if exists pt_mismatch_flags_status_check;
alter table pt_mismatch_flags
  add constraint pt_mismatch_flags_status_check
  check (status in ('open','resolved','rejected','returned'));

alter table pt_mismatch_flags
  add column if not exists coordinator_note      text,                              -- текст координатора при возврате
  add column if not exists returned_by           integer references profiles(id),   -- кто вернул
  add column if not exists returned_at           timestamptz,
  add column if not exists balance_before_resolve integer;                          -- остаток в системе в момент перерасчёта

-- Один активный запрос на клиента: open ИЛИ returned (возвращённый — тоже активный).
drop index if exists pt_mismatch_one_open;
create unique index pt_mismatch_one_open
  on pt_mismatch_flags (client_id) where status in ('open','returned');
