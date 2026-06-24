-- «Общие» счета техчасти: видны только владельцу (isDev, tg_id 118803972),
-- не привязаны к филиалу, исключены из выборок всех остальных ролей.
alter table tech_bills add column if not exists is_general boolean not null default false;

-- Помечаем 4 счёта без филиала как общие (разовая чистка существующих данных).
update tech_bills set is_general = true
where id in (
  '1812d05e-10af-4428-9ae4-e30d2e12b909', -- Коагулянт и порошковый хлор
  'c5a524b2-c0c6-44c0-9520-c163de7a0118', -- Пополнение счета
  '789a46b6-2e44-49a3-9665-cad23e1f4d8f', -- анализы
  '76737068-ac20-491c-abab-657f24c401b1'  -- Поставщик вентиляции
);
