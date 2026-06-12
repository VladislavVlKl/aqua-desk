# AquaDesk — База данных

> Снимок живой схемы Supabase от **2026-06-11** (Project ID: `nkwfvuhtpaoxsaczwsrg`, eu-central-1).
> При сомнениях сверяйся с живой схемой через Supabase MCP (`list_tables`, `execute_sql`).

---

## Правила удаления (FK) — читать перед любым DELETE

Самое важное в этом файле. Каскады уже дважды приводили к багам
(удаление тренировки сносило все запросы на её удаление; см. коммиты `b47748f`, `17e6fd3`).

### ⚠️ CASCADE — удаление родителя сносит дочерние записи

| Дочерняя таблица.колонка | Родитель | Послед­ствия |
|---|---|---|
| `clients.trainer_id` | profiles | ⚠️ удаление профиля тренера сносит ВСЕХ его клиентов — поэтому тренеров только архивируем |
| `schedule_slots.trainer_id` | profiles | слоты расписания тренера |
| `trainer_groups.trainer_id` | profiles | назначения групп тренера |
| `trial_sessions.trainer_id` | profiles | пробные тренировки |
| `month_adjustments.trainer_id` | profiles | корректировки ЗП |
| `late_workout_requests.trainer_id` | profiles | поздние запросы |
| `subscriptions.client_id` | clients | история абонементов клиента |
| `client_transfers.client_id` | clients | переводы клиента |
| `late_workout_requests.client_id` | clients | поздние запросы по клиенту |
| `session_notes.workout_id` | workouts | конспекты тренировки |
| `workout_delete_requests.workout_id` | workouts | ⚠️ удаление ПТ сносит все запросы на её удаление — поэтому в `approveWorkoutDeleteRequest` сперва закрываем все pending по `workout_id`, потом удаляем ПТ |
| `training_goals.subscription_id` | subscriptions | цели абонемента |
| `group_clients.group_id` | trainer_groups | дети группы |
| `adult_group_clients.group_id` | trainer_groups | взрослые группы |
| `group_attendance.group_id` / `.group_client_id` | trainer_groups / group_clients | посещаемость |
| `group_payments.group_id` / `.group_client_id` | trainer_groups / group_clients | оплаты |
| `group_progress_notes.group_id` / `.group_client_id` | trainer_groups / group_clients | заметки прогресса |
| `group_substitutions.group_id` | trainer_groups | замены |
| `event_participants.event_id` | events | участники мероприятия |
| `schedule_cancellations.slot_id` | schedule_slots | пропуски дат |
| `schedule_confirmations.slot_id` | schedule_slots | подтверждения |

### SET NULL

| Дочерняя | Родитель |
|---|---|
| `delete_requests.client_id` | clients |
| `schedule_slots.client_id` | clients |
| `audit_log.actor_id` | profiles |
| `notifications_queue.created_by` | profiles |
| `tech_issues.equipment_id` | tech_equipment |

### NO ACTION (удаление родителя упадёт с ошибкой, если есть дочерние)

`workouts.client_id→clients`, `session_notes.client_id→clients`, `training_goals.client_id→clients`,
`duties.trainer_id→profiles`, `workouts.trainer_id→profiles`, `subscriptions.trainer_id→profiles`,
`branch_access.trainer_id→profiles`, `group_trainer_payouts.*`, `group_sessions.*`,
`workout_delete_requests.trainer_id→profiles` и пр.

Поэтому `DB.forceDeleteClient` удаляет вручную в правильном порядке:
schedule_slots → session_notes → workouts → client_transfers → training_goals → subscriptions → delete_requests → clients.

---

## RPC-функции

| Функция | Аргументы | Возврат | Назначение |
|---|---|---|---|
| `get_profile_by_tg_id` | `p_tg_id bigint` | json | профиль по Telegram ID (вход) |
| `verify_pin` | `p_tg_id bigint, p_pin text` | boolean | проверка PIN |
| `change_pin` | `p_profile_id int, p_pin text` | void | смена PIN (хеширует) |
| `claim_profile` | `p_profile_id int, p_tg_id bigint, p_pin text` | json | привязка существующего профиля к tg_id |
| `increment_balance` | `client_id uuid, delta int` | void | атомарное изменение баланса |
| `rename_branch` | `old_name text, new_name text` | void | переименование филиала во всех таблицах |

RLS включается автоматически на новых таблицах (event trigger `rls_auto_enable`).

---

## Таблицы

### Персонал и доступы

**profiles** — сотрудники
```
id int PK · fio · pincode (хеш) · role (trainer|senior_trainer|admin|ceo)
branches text[] · tg_id bigint · is_archived · phone · extra_roles text[]
group_type_access int[] (зарезервировано, в коде не используется после отката)
```

**branches** — филиалы: `id, name`

**branch_access** — доп. доступ старшего тренера к чужим филиалам: `trainer_id, branch`

**user_sessions** — мониторинг входов: `tg_id, fio, role, device, js_version, opened_at`

**audit_log** — реестр действий: `action, actor_id, actor_fio, target_id, target_type, details jsonb, branch, created_at`

### Клиенты ПТ

**clients**
```
id uuid PK · fio · category 1-3 · trainer_id · balance int · age
subscription_start/end date · drop_in_used bool · is_archived · archive_reason
freeze_start/end date · color · last_used
```

**subscriptions** — история абонементов
```
id int PK · client_id · trainer_id · start_date · end_date · initial_balance
is_active · closing_note · freeze_start/end
```

**workouts** — тренировки
```
id uuid PK · trainer_id · client_id · category_at_moment · branch · workout_date
is_debt + debt_confirmed_at · is_drop_in + drop_in_category · substitute_for (id тренера) + substitute_rate
pending_confirmation · notes
```

**session_notes** — конспекты (дедлайн 48ч): `workout_id, client_id, trainer_id, subscription_id, accomplishments, next_task, session_number, deadline`

**training_goals** — цели: `subscription_id, client_id, goal_text`

**client_transfers** — переводы между тренерами: `client_id, from_trainer_id, to_trainer_id, initiated_by, status, note, resolved_at`

**trial_sessions** — пробные: `trainer_id, branch, session_date, first_name, last_name, phone, age, category`

### Запросы (флоу одобрения)

**delete_requests** — на удаление клиента: `client_id, client_name, requested_by, branch, status (pending|approved|rejected)`
> Дубли по `client_id` в статусе pending блокируются на уровне `DB.createDeleteRequest`.

**workout_delete_requests** — на удаление ПТ: `workout_id, trainer_id, client_name, workout_date, branch, status`
> Дубли по `workout_id` блокируются в `DB.requestWorkoutDelete`. При одобрении сперва закрываются все pending.

**late_workout_requests** — позднее внесение ПТ (>48ч): `trainer_id, client_id, branch, workout_date, category, reason, status, reviewed_by, reject_note`

### Расписание и дежурства

**schedule_slots**: `trainer_id, branch, day_of_week, start_time, end_time, slot_type (pt|duty|group), client_id, group_type_id, avg_headcount, active, specific_date`

**schedule_cancellations** — пропуск даты: `slot_id, cancel_date, reason`

**schedule_confirmations** — подтверждение слота на дату: `slot_id, session_date, status, actual_headcount, workout_id, cancel_reason`

**duties** — дежурства: `trainer_id, branch, start_time, end_time (NULL = активное)`

### Группы

**group_types** — типы: `name, type (children|adult), billing_model, price_per_month, trainer_percentage`
> Сейчас: Детская группа (1), Акваджим (2), Аквафитнес (3), Art-swim (4), Акваджим 2 (6)

**trainer_groups** — назначение тренера на группу
```
trainer_id · group_type_id · branch · subscription_start · subscription_end (NULL = активно)
rate_type (percent|flat|headcount) + rate_value · role (суша|вода|суша+вода)
leader_name + leader_fee_percent · group_instance_id uuid · days_of_week text[] · session_time
```
> `group_instance_id` связывает несколько trainer_groups в одну «физическую» группу (второй тренер).

**group_clients** — дети: `group_id, group_instance_id, name, age, start_date, monthly_price, level, is_active`

**adult_group_clients** — взрослые: `group_id, name, is_active`

**group_sessions** — проведённые занятия групп: `trainer_id, group_type_id, branch, session_date, headcount, client_ids uuid[], session_type, conducted_role, group_instance_id`
> Взрослые группы: запись создаёт `logGroupSession`, `conducted_role IS NULL`. Детские (арт-свим): запись = отметка «кто проводил» с ролью `'суша'|'вода'|'процент'` (CHECK) и `group_instance_id`. Unique index `uq_group_sessions_conducted (trainer_id, session_date, group_type_id, branch, conducted_role)` — upsert детских отметок по этим 5 колонкам (PostgREST onConflict); взрослые записи с `conducted_role IS NULL` не ограничиваются (NULLS DISTINCT), их дубли (две тренировки в день) легитимны.

**group_attendance** — посещаемость детей: `group_id, group_client_id, group_instance_id, session_date, attended`

**group_payments** — оплата детей за месяц: `group_id, group_client_id, group_instance_id, month, amount, paid, paid_at, sub_start, sub_end`

**group_trainer_payouts** — выплаты: `group_id, trainer_id, month, payout_type, payout_value, bonus, penalty, approved_by, approved_at`

**group_substitutions** — замены: `group_id, original_trainer_id, substitute_trainer_id, session_date, rate, status`

**group_progress_notes**: `group_id, group_client_id, trainer_id, month, note`

**group_client_duplicate_flags** — флаги дублей детей: `group_instance_id, client_id_1, client_id_2, status`

### Зарплата

**month_adjustments** — корректировки координатора: `trainer_id, year, month, bonus, penalty, notes`

### Операционка

**tech_issues** — поломки: `branch, equipment_id, description, priority, status, resolved_at`
**tech_bills** — счета: `branch, category, description, amount, bill_date, paid, paid_at`
**tech_shopping** — закупки: `branch, name, quantity, price, priority, status`
**tech_equipment** — инвентарь: `branch, name, category, status, last_service, next_service, notes`
**chlorine_orders** — хлор: `branch, order_date, quantity_kg, price_total, supplier, note`
**ops_plans** — планы: `branch, plan_type, title, description, due_date, status (active|done|cancelled), created_by`
**events** — мероприятия: `title, event_type, description, location, branch, start_time, end_time, blocks_pool, created_by`
**event_participants**: `event_id, trainer_id`

### Уведомления

**notifications_queue**: `recipient_tg_id, recipient_name, message, scheduled_for, sent_at, error_text, status, created_by, rule_key, read_at`
**notification_rules**: `name, rule_key, description, active`

---

## Конвенции

- Статусы запросов везде: `pending` / `approved` / `rejected`
- Активное назначение группы: `subscription_end IS NULL`
- Активное дежурство: `end_time IS NULL`
- `group_instance_id` — uuid, объединяющий trainer_groups, group_clients, group_attendance, group_payments одной физической группы
- Долг: `workouts.is_debt = true`, подтверждение оплаты пишет `debt_confirmed_at`
- Профили сотрудников не удаляем — только `is_archived = true` (иначе CASCADE снесёт клиентов)
