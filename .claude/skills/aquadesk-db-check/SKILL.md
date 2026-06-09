---
name: aquadesk-db-check
description: >
  Быстрая диагностика базы данных AquaDesk в Supabase. Используй когда
  что-то сломалось в базе, клиенты не грузятся, RPC не работает, нужно
  посмотреть логи или получить советы по оптимизации. Триггеры: "проверь базу",
  "посмотри логи", "что с базой", "supabase упал", "db check", "диагностика базы",
  "ошибка в базе", "база не отвечает".
---

# AquaDesk DB Check

Supabase Project ID: `nkwfvuhtpaoxsaczwsrg`

Цель — быстро понять что происходит с базой и дать конкретные рекомендации.

## Шаги диагностики

### 1. Advisors (анализ проблем)

Используй MCP-инструмент `get_advisors` для project_id `nkwfvuhtpaoxsaczwsrg`.
Выведи найденные проблемы по категориям: performance, security, reliability.

### 2. Логи (последние ошибки)

Используй `get_logs` для project_id `nkwfvuhtpaoxsaczwsrg`.
Покажи только ERROR и WARNING уровня, последние 20 записей.

### 3. Интерпретация

После получения данных:
- Выдели **критичные** проблемы (влияют на работу прямо сейчас)
- Выдели **некритичные** (можно исправить потом)
- Предложи конкретные SQL или настройки для исправления

## Таблицы AquaDesk (для контекста)

Основные: `profiles`, `clients`, `workouts`, `subscriptions`, `duties`, `session_notes`
Группы: `trainer_groups`, `group_clients`, `adult_group_clients`, `group_sessions`, `group_attendance`
Операционка: `tech_issues`, `ops_plans`, `delete_requests`

## Частые проблемы в этом проекте

- RLS-политики блокируют запросы — проверь через `execute_sql` с `SELECT * FROM pg_policies WHERE tablename = 'имя_таблицы'`
- Медленные запросы без индексов на `trainer_id`, `client_id`, `date`
- RPC-функции: `verify_pin`, `change_pin`, `claim_profile`, `get_profile_by_tg_id`
