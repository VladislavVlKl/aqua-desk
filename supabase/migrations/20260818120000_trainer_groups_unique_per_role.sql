-- Один тренер может вести суша+вода (две станции/часа) в одном инстансе группы.
-- Раньше уникальный индекс был (trainer_id, group_instance_id) WHERE subscription_end IS NULL
-- — запрещал вторую активную строку тренера в инстансе. Теперь уникальность по
-- (trainer_id, group_instance_id, coalesce(role,'')): разные роли (суша/вода) сосуществуют,
-- для строк без роли прежнее правило «одна активная на инстанс» сохраняется (coalesce → '').
--
-- Двойной оплаты НЕТ: calcChildGroupPayroll (frontend/js/db.salary.js) через
-- _collapseTrainerRows считает строки-станции одного тренера (одно окно действия) как
-- одну ЗП-строку. Перезаведение в середине месяца (разные окна) остаётся раздельным.
drop index if exists trainer_groups_one_active_per_instance;
create unique index trainer_groups_one_active_per_instance
  on public.trainer_groups (trainer_id, group_instance_id, (coalesce(role,'')))
  where (subscription_end is null and group_instance_id is not null);
