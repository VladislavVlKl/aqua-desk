
-- Мурудова Элина (id=22) + Ващенко Анна (id=21)
UPDATE trainer_groups
SET group_instance_id = (SELECT group_instance_id FROM trainer_groups WHERE id = 22)
WHERE id = 21;


