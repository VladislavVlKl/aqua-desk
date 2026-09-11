-- Фича «Расхождение остатка ПТ с 1С» (постоянная).
-- Тренер отмечает расхождение на карточке клиента → координатор/старший филиала
-- сверяет с 1С и делает перерасчёт (остаток + корректировка ФОТ). Разовая заявка.
create table pt_mismatch_flags (
  id                     bigserial primary key,
  client_id              uuid    not null references clients(id)  on delete cascade,
  trainer_id             integer not null references profiles(id) on delete cascade,  -- кто отметил
  branch                 text,
  system_balance_at_flag integer,          -- снимок остатка на момент флага
  trainer_note           text,             -- комментарий тренера
  trainer_suggested      integer,          -- сколько, по мнению тренера, реально (необязательно)
  status                 text not null default 'open' check (status in ('open','resolved','rejected')),
  corrected_balance      integer,          -- выставленный остаток (по 1С) при перерасчёте
  fot_delta              integer,          -- изменение ФОТ (сум), + доначислено / − снято; null если ФОТ не трогали
  resolved_by            integer references profiles(id),
  resolved_at            timestamptz,
  reject_reason          text,
  created_at             timestamptz not null default now()
);
-- один открытый флаг на клиента (защита от дублей)
create unique index pt_mismatch_one_open on pt_mismatch_flags (client_id) where status = 'open';
create index idx_pt_mismatch_branch_status on pt_mismatch_flags (branch, status);

alter table pt_mismatch_flags enable row level security;
grant all on pt_mismatch_flags to anon, authenticated;
grant usage, select on sequence pt_mismatch_flags_id_seq to anon, authenticated;
create policy pt_mismatch_all        on pt_mismatch_flags as permissive for all to anon          using (true) with check (true);
create policy pt_mismatch_all_authed on pt_mismatch_flags as permissive for all to authenticated using (true) with check (true);

-- Туториал «Что нового» — переиспользуем существующий APP_UPDATE (config.js) +
-- маркер aq_update_seen в Telegram CloudStorage (кросс-устройство). Отдельная колонка не нужна.
