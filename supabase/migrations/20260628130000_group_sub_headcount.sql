-- Кол-во человек на занятии для замены на взрослой (headcount) группе.
-- Заполняет тренер при создании замены → координатор сразу видит подсказку ставки
-- getAdultGroupRate(headcount). Для детских групп не используется (ставка не по явке).
ALTER TABLE group_substitutions ADD COLUMN IF NOT EXISTS headcount integer;
