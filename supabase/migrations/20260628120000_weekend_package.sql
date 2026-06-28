-- Пакет «Викенд» (детский): 5 ПТ на 1 месяц, занятия только по сб/вс.
-- Флаг хранится на clients (читается при списании ПТ — жёсткий запрет будней)
-- и на subscriptions (история пакетов).
ALTER TABLE clients       ADD COLUMN IF NOT EXISTS is_weekend boolean NOT NULL DEFAULT false;
ALTER TABLE subscriptions ADD COLUMN IF NOT EXISTS is_weekend boolean NOT NULL DEFAULT false;
