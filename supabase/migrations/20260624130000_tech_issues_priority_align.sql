-- Приводим CHECK приоритета поломок к словарю приложения (PRIORITY_LBL: urgent/normal/low).
-- Старый constraint допускал только low/medium/high, из-за чего вставка поломки
-- (priority='normal'|'urgent') молча падала — кнопка «Добавить» не срабатывала.
alter table tech_issues drop constraint if exists tech_issues_priority_check;
alter table tech_issues add constraint tech_issues_priority_check
  check (priority = any (array['urgent'::text,'normal'::text,'low'::text]));
