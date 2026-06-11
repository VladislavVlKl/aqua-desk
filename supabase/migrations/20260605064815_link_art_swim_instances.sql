
-- Пара 1: Агзамова Самира (id=31, суша) + Джураева Сафина (id=32, вода)
-- Берём instance от id=31, присваиваем id=32
UPDATE trainer_groups
SET group_instance_id = (SELECT group_instance_id FROM trainer_groups WHERE id = 31)
WHERE id = 32;

-- Пара 2: Руднев Вячеслав (id=34, вода) + Виолетта (id=36, суша+вода)
-- Берём instance от id=34, присваиваем id=36
UPDATE trainer_groups
SET group_instance_id = (SELECT group_instance_id FROM trainer_groups WHERE id = 34)
WHERE id = 36;


