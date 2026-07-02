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
| `workout_delete_requests.workout_id` | workouts | ⚠️ удаление ПТ сносит все запросы на её удаление — поэтому в `approveWorkoutDeleteRequest` сперва закрываем все pending по `workout_id`, потом удаляем ПТ. `deleteWorkout` (этот путь + быстрое/админ-удаление) **возвращает баланс +1**, если ПТ его списывала (обычная ПТ / подтверждённый долг / подтверждённая замена; разовое, неподтв. долг, замена в ожидании, уже отклонённое ресепшеном — не трогает) |
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
| `trial_delete_requests.trial_id` | trial_sessions (CASCADE) |
| `schedule_slots.client_id` | clients |
| `audit_log.actor_id` | profiles |
| `notifications_queue.created_by` | profiles |
| `tech_issues.equipment_id` | tech_equipment |

### NO ACTION (удаление родителя упадёт с ошибкой, если есть дочерние)

`workouts.client_id→clients`, `session_notes.client_id→clients`, `training_goals.client_id→clients`,
`duties.trainer_id→profiles`, `workouts.trainer_id→profiles`, `subscriptions.trainer_id→profiles`,
`branch_access.trainer_id→profiles`, `group_trainer_payouts.*`, `group_sessions.*`,
`trainer_group_rate_history.trainer_group_id→trainer_groups`,
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
id int PK · fio · pincode (хеш) · role (trainer|senior_trainer|admin|ceo|reception)
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
is_weekend bool — пакет «Викенд» (только сб/вс), денормализ. с активного абонемента; читается при списании ПТ
```

**subscriptions** — история абонементов
```
id int PK · client_id · trainer_id · start_date · end_date · initial_balance
is_active · closing_note · freeze_start/end
is_weekend bool — пакет «Викенд» (детский: 5 ПТ на 1 месяц, занятия только сб/вс)
```

**workouts** — тренировки
```
id uuid PK · trainer_id · client_id · category_at_moment · branch · workout_date
is_debt + debt_confirmed_at · is_drop_in + drop_in_category · substitute_for (id тренера) + substitute_rate
pending_confirmation · notes
reception_status (pending|confirmed|rejected) · reception_reason · reception_by (profiles.id) · reception_at
```
> `pending_confirmation` — подтверждение ЗАМЕНЫ тренером-заменяемым (тренер→тренер, см. `logSubstituteWorkout`/`resolveSubstitute`). Не путать с ресепшеном.
> `reception_status` — подтверждение списания РЕСЕПШЕНОМ (Шаг 1 интеграции с 1С). Новые ПТ создаются `pending`, ресепшн подтверждает (`confirmed`) или отклоняет (`rejected` + откат баланса). В ЗП тренера идёт только `confirmed`; `rejected` исключается. Замена попадает в очередь ресепшена только после подтверждения тренером Б (`pending_confirmation=false`). Индекс `idx_workouts_reception (branch, reception_status, workout_date)`.
> ⚠️ **Гейт фичи — флаг `RECEPTION_SUBMIT_ENABLED` (config.js), не DB DEFAULT.** Колонка имеет `DEFAULT 'confirmed'`; статус `'pending'` ставит `db.js` (`logWorkouts`, `logSubstituteWorkout`, `approveLateRequest`, `addTrialSession`) **только при `RECEPTION_SUBMIT_ENABLED=true`**. Сейчас флаг `false`: панель ресепшена задеплоена, но новые ПТ остаются `confirmed` — у тренеров нет «ожидающего баланса». Активация = `RECEPTION_SUBMIT_ENABLED=true` + пуш, ручных операций с БД не требуется.

**session_notes** — конспекты (дедлайн 48ч): `workout_id, client_id, trainer_id, subscription_id, accomplishments, next_task, session_number, deadline`

**training_goals** — цели: `subscription_id, client_id, goal_text`

**client_transfers** — переводы между тренерами: `client_id, from_trainer_id, to_trainer_id, initiated_by, status, note, resolved_at`

**trial_sessions** — пробные: `trainer_id, branch, session_date, first_name, last_name, phone, age, category, reception_status (pending|confirmed|rejected), reception_reason, reception_by, reception_at`
> Пробные подтверждаются ресепшеном так же, как ПТ: проведена, но не оплачена → ресепшн отклоняет → в ЗП не идёт (только `confirmed` начисляется). Индекс `idx_trials_reception (branch, reception_status, session_date)`.

### Запросы (флоу одобрения)

**delete_requests** — на удаление клиента: `client_id, client_name, requested_by, branch, status (pending|approved|rejected)`
> Дубли по `client_id` в статусе pending блокируются на уровне `DB.createDeleteRequest`.

**workout_delete_requests** — на удаление ПТ: `workout_id, trainer_id, client_name, workout_date, branch, status`
> Дубли по `workout_id` блокируются в `DB.requestWorkoutDelete`. При одобрении сперва закрываются все pending.

**trial_delete_requests** — на удаление пробной (паритет с ПТ): `trial_id, trainer_id, client_name, session_date, branch, status (pending|approved|rejected)`
> Тренер удаляет пробную сам в окне 30 мин (`EDIT_WINDOW_MIN`, `DB.deleteTrialSession`); позже — `DB.requestTrialDelete` → координатор одобряет в «Контроле» (`approveTrialDeleteRequest` → удаляет `trial_sessions`). Дубль pending по `trial_id` блокируется. `trial_id` FK → `trial_sessions ON DELETE CASCADE` (при одобрении сперва закрываются pending). Индекс `idx_trial_del_branch_status (branch, status)`.

**late_workout_requests** — позднее внесение ПТ (>72ч): `trainer_id, client_id, branch, workout_date, category, reason, status, reviewed_by, reject_note`

**category_recalc_requests** — пересчёт категории уже проведённых ПТ (ошибочная категория): `trainer_id, client_id, client_fio, branch, new_category, scope (month|all), from_date, status, reviewed_by, reject_note, applied_count`
> Тренер запрашивает → координатор/старший одобряет (`approveCategoryRecalcRequest` → `recalcWorkoutsCategory` обновляет `workouts.category_at_moment` → ЗП пересчитывается). admin/senior_trainer применяют сразу без запроса. Дубль pending на клиента блокируется в `DB.addCategoryRecalcRequest`. Индекс `idx_cat_recalc_branch_status (branch, status)`.

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

**group_clients** — дети: `group_id, group_instance_id, name, age, start_date, monthly_price, level, is_active, subgroup`
> `subgroup text NOT NULL DEFAULT ''` — подгруппа внутри группы (`''` = основная, иначе название, напр. `'16:00'`). Одна группа = N подгрупп с раздельными списками детей, общий вал/оплаты.

**adult_group_clients** — взрослые: `group_id, name, is_active`

**group_sessions** — проведённые занятия групп: `trainer_id, group_type_id, branch, session_date, headcount, client_ids uuid[], session_type, conducted_role, group_instance_id, subgroup`
> Взрослые группы: запись создаёт `logGroupSession`, `conducted_role IS NULL`. Детские (арт-свим): запись = отметка «кто проводил» на станции `'суша'|'вода'` (CHECK ещё допускает `'процент'` для старых записей, но UI его больше не создаёт — процентникам ЗП идёт от пула независимо от присутствия), `group_instance_id` и `subgroup` (`''` = основная). Станции — мультивыбор: один тренер может быть и на суше, и на воде. Unique index `uq_group_sessions_conducted (trainer_id, session_date, group_type_id, branch, conducted_role, subgroup)` — upsert детских отметок по этим 6 колонкам (PostgREST onConflict); взрослые записи с `conducted_role IS NULL` не ограничиваются (NULLS DISTINCT), их дубли (две тренировки в день) легитимны.

**group_subgroups** — персистентные подгруппы: `id, group_instance_id (uuid, null для одиночной группы), group_id (int, заполнен если нет instance), name, is_main, created_by, created_at`
> Подгруппа существует независимо от наличия детей (раньше пустая подгруппа жила только в памяти `_gd.extraSubgroups` и исчезала после перезахода). Список подгрупп = `group_subgroups.name (is_main=false)` ∪ `group_clients.subgroup`. `is_main=true` — отображаемая метка ГЛАВНОЙ (`''`) подгруппы (напр. `'15:00'`): дети остаются с `subgroup=''`, но в UI вместо «Основная» показывается метка. Переименование обычной подгруппы обновляет `group_clients.subgroup` и `group_sessions.subgroup`. Unique: `(group_instance_id,name)` или `(group_id,name)` при NULL instance.

**group_attendance** — посещаемость детей: `group_id, group_client_id, group_instance_id, session_date, attended`

**group_payments** — оплата детей за месяц: `group_id, group_client_id, group_instance_id, month, amount, paid, paid_at, sub_start, sub_end`

**group_trainer_payouts** — выплаты: `group_id, trainer_id, month, payout_type, payout_value, bonus, penalty, approved_by, approved_at`
> ЗП детских групп считается **полностью авто** (`calcChildGroupPayroll` в db.js: вал, проценты, ставки, пул-лимит). Эта таблица хранит только ручные `bonus`/`penalty`; `payout_value` пишется для аудита, но в расчётах **не читается**.

**trainer_group_rate_history** — история ставок: `id, trainer_group_id→trainer_groups (CASCADE), rate_type ('percent'|'flat'), rate_value, effective_from, created_by, created_at`
> Действующая ставка тренера на дату `D` = последняя запись с `effective_from <= D`; нет записей — legacy `trainer_groups.rate_type/rate_value`. Пересмотр ставки: «за весь текущий месяц» (1-е тек.), «прошлый» (1-е прош.), «с этого дня» (сегодня). Ставочник — занятие по ставке на `session_date`; процентник — вал делится по `paid_at` оплат до/после `effective_from`.

**group_substitutions** — замены: `group_id, original_trainer_id, substitute_trainer_id, session_date, rate, status, headcount` (headcount — кол-во человек на занятии для взрослых/headcount-групп, заполняет тренер при создании замены → подсказка ставки `getAdultGroupRate`)

**group_progress_notes**: `group_id, group_client_id, trainer_id, month, note`

**group_client_duplicate_flags** — флаги дублей детей: `group_instance_id, client_id_1, client_id_2, status`

### Зарплата

**month_adjustments** — корректировки координатора: `trainer_id, year, month, bonus, penalty, notes, branch`
> Премия/штраф — ПО ФИЛИАЛАМ: unique `(trainer_id, year, month, branch)`, строка на филиал. `branch=''` — легаси «без филиала» (учитывается во всех филиалах). Свод по тренеру — `aggAdjustments()` (db.salary.js); `DB.getAdjustment` возвращает агрегат, строки по филиалам — `getTrainerDetail().adjustments`.

### Операционка

**tech_issues** — поломки: `branch, equipment_id, description, priority, status, resolved_at`
**tech_bills** — счета: `branch, category, description, amount, bill_date, paid, paid_at, is_general`
  (`is_general=true` — «общие» счета без филиала, видны только владельцу `isDev`; исключены из выборок остальных ролей через `getTechBills(branch,{general})`)
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
- Подтверждение ресепшеном (`workouts`/`trial_sessions.reception_status`): `pending` → `confirmed` | `rejected`. В ЗП тренера только `confirmed`. Старые записи бэкфилнуты в `confirmed`.
