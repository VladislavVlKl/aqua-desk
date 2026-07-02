-- Премия/штраф координатора — по филиалам.
-- Было: одна строка на (trainer_id, year, month) — у мультифилиального тренера
-- премия попадала в ведомость каждого филиала целиком.
-- Стало: строка на (trainer_id, year, month, branch); branch='' — легаси/«без филиала».

alter table month_adjustments
  add column if not exists branch text not null default '';

-- Пересоздаём уникальность: (trainer_id, year, month) → (trainer_id, year, month, branch)
do $$
declare c record;
begin
  for c in
    select conname from pg_constraint
    where conrelid = 'month_adjustments'::regclass
      and contype  = 'u'
  loop
    execute format('alter table month_adjustments drop constraint %I', c.conname);
  end loop;
end $$;

alter table month_adjustments
  add constraint month_adjustments_trainer_year_month_branch_key
  unique (trainer_id, year, month, branch);
