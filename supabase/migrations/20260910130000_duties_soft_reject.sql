-- «Мягкое» подтверждение дежурств: координатор не апрувит заранее (дежурство идёт
-- в ЗП сразу), но может ОТКЛОНИТЬ спорную смену постфактум — тогда она перестаёт
-- считаться в зарплате. Отклонение обратимо (restoreDuty сбрасывает поля).
--   rejected_at IS NOT NULL  → смена отклонена, в calcSalary не входит.
-- До этого у дежурств не было никакого статуса — начисление было бесконтрольным.
ALTER TABLE duties
  ADD COLUMN IF NOT EXISTS rejected_at   timestamptz,
  ADD COLUMN IF NOT EXISTS rejected_by   integer,   -- profiles.id координатора (без FK: профили не удаляются, только архив)
  ADD COLUMN IF NOT EXISTS reject_reason text;
