
-- Каждой существующей строке trainer_groups присваиваем уникальный group_instance_id
UPDATE trainer_groups
SET group_instance_id = gen_random_uuid()
WHERE group_instance_id IS NULL;

-- group_clients: берём group_instance_id из trainer_groups по group_id
UPDATE group_clients gc
SET group_instance_id = tg.group_instance_id
FROM trainer_groups tg
WHERE gc.group_id = tg.id
  AND gc.group_instance_id IS NULL;

-- group_payments: аналогично
UPDATE group_payments gp
SET group_instance_id = tg.group_instance_id
FROM trainer_groups tg
WHERE gp.group_id = tg.id
  AND gp.group_instance_id IS NULL;

-- group_attendance: аналогично
UPDATE group_attendance ga
SET group_instance_id = tg.group_instance_id
FROM trainer_groups tg
WHERE ga.group_id = tg.id
  AND ga.group_instance_id IS NULL;


