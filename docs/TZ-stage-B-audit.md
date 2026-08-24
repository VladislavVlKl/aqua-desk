# Этап B — карта методов (audit, без правок кода)

> Результат аудита всех **51** прямых `sb()` в app-файлах против существующего слоя `DB.*`
> (228 методов, 8 файлов) и бэкенда FastAPI (`aqua-desk-v2`). На каждый call-site — вердикт:
> **swap** (метод есть) / **reuse+** (метод есть, нужен фильтр/проверка колонок) /
> **new-fe** (новый метод фронта, бэкенд-эндпоинт уже есть) / **new-both** (новый метод + новый эндпоинт).
>
> Ключевой вывод: **бэкенд богаче, чем предполагало ТЗ**. Уже есть `GET /ops/chlorine`,
> generic `POST /ops/{slug}` + `/ops/{slug}/{id}/update|delete`, `GET /notifications` (очередь),
> `GET /group-instances/active`, `GET /group-instance-members`, `POST /group-sessions`,
> `GET /group-duplicate-flags` + resolve. Поэтому «требуют нового эндпоинта» из ТЗ (хлор,
> tech_bills delete) на деле — только новые обёртки `DB.*` над готовыми ручками.

---

## Сводка

| Бакет | Что | Sites | Бэкенд |
|---|---|---:|---|
| **A. swap** | вызвать существующий `DB.*`, замена 1:1 | 6 | не трогаем |
| **B. reuse+** | существующий `DB.*` + клиентский фильтр / проверка колонок | 7 | максимум расширить SELECT в готовой ручке |
| **C. new-fe** | новый метод `DB.*` над **готовым** эндпоинтом | 5 | не трогаем |
| **D. new-both** | новый метод `DB.*` + **новый** эндпоинт | 33 | 16 новых ручек (одна `getTrainerGroupById` схлопывает 16 sites) |

Итог: **6 + 7 + 5 + 33 = 51** ✓

---

## Бакет A — swap (метод есть, замена вызова) — 6

| Site | Замена |
|---|---|
| `app.trainer.schedule.js:784` — `duties.delete` | `DB.deleteDuty(id)` |
| `notifications-ui.js:9` — `notification_rules select` | `DB.getNotificationRules()` |
| `notifications-ui.js:13` — `notification_rules update` | `DB.toggleRule(id, active)` |
| `notifications-ui.js:36` — `notifications_queue insert(rows)` | `DB.queueBroadcast(profiles, msg, scheduledFor, createdBy)` |
| `notifications-ui.js:17` — `notifications_queue insert(single)` | `DB.queueBroadcast([{tg_id, fio}], msg, scheduledFor, createdBy)` — обернуть один получатель в массив |
| `app.admin-ops.groups.js:915` — `trainer_groups update leader` | `DB.updateTrainerGroupLeader(id, name, pct)` |

---

## Бакет B — reuse+ (метод есть, нужен фильтр / проверка колонок) — 7

| Site | Замена | Нюанс |
|---|---|---|
| `app.admin-ops.groups.js:65` — `schedule_slots` | `DB.getAllActiveSlots()` | отфильтровать на клиенте `slot_type==='group' && !specific_date` (метод отдаёт pt+group) |
| `app.senior.groups.js:42` — `trainer_groups by branch` | `DB.getActiveGroupsByBranch(branch)` | сайту нужен `*`; проверить, что ручка `/group-instances/active` отдаёт все нужные поля |
| `app.client.js:531` — `trainer_groups by branch` | `DB.getActiveGroupsByBranch(branch)` | **проверить доступ клиентской роли** к `/group-instances/active` |
| `app.exec.js:899` — `trainer_groups by branch` (+`days_of_week, session_time`) | `DB.getActiveGroupsByBranch(branch)` | ⚠️ проверить, что эндпоинт возвращает `days_of_week`, `session_time`, `group_type_id`, `role`; если нет — расширить SELECT в ручке |
| `app.shared.js:396` — `trainer_groups` кандидаты (same group_type+branch, exclude self) | `DB.getActiveGroupsByBranch(branch)` | отфильтровать по `group_type_id` и исключить текущий `groupId` на клиенте |
| `app.admin-ops.control.js:191` — `workouts trainer_id by date-range` | `DB.getAnWorkouts(y, mo, branch)` | ⚠️ `getAnWorkouts` фильтрует `pending_confirmation=false` и `substitute_for is null`; сверить, приемлемо ли для «активности» control. Иначе → new-both узкий getter |
| `app.admin.clients.js:222` — `profiles.branches by id` | `DB.getAllProfiles()` → `.find(p=>p.id===trainerId).branches` | одна строка; альтернатива — крошечный `getProfileBranches(id)` |

---

## Бакет C — new-fe (новый метод `DB.*`, бэкенд уже готов) — 5

| Site | Новый метод | Готовый эндпоинт |
|---|---|---|
| `app.admin-ops.tech.js:198` — `tech_bills delete` | `DB.deleteTechBill(id)` | `POST /ops/tech-bills/{id}/delete` |
| `app.admin-ops.tech.js:265` — `chlorine_orders select` | `DB.getChlorineOrders(branch)` | `GET /ops/chlorine` |
| `app.admin-ops.tech.js:323` — `chlorine_orders insert` | `DB.addChlorineOrder({branch, date, qty, sum, supplier, note})` | `POST /ops/chlorine` (generic `/ops/{slug}`) |
| `app.admin-ops.tech.js:330` — `chlorine_orders delete` | `DB.deleteChlorineOrder(id)` | `POST /ops/chlorine/{id}/delete` |
| `notifications-ui.js:41` — `notifications_queue select` | `DB.getQueue(limit)` | `GET /notifications` (проверить формат/лимит) |

> Проверить сигнатуру generic `POST /ops/{slug}` (какие поля ждёт для chlorine) — колонки
> `branch, order_date, quantity_kg, price_total, supplier, note`.

---

## Бакет D — new-both (новый метод + новый эндпоинт) — 33 sites → 16 ручек

### D0. `getTrainerGroupById(id)` + `GET /trainer-groups/{id}` — схлопывает 16 sites
Одна строка `trainer_groups` по id, SELECT `*, group_types(*)` (покрывает все варианты колонок ниже).

| Site | Нужные колонки |
|---|---|
| `app.shared.js:391` | group_type_id, branch, group_instance_id, group_types(name) |
| `app.shared.js:481` | group_types(billing_model) |
| `app.shared.js:599 / 668 / 718` | branch, group_type_id, group_types(name) |
| `app.shared.js:815 / 843` | group_instance_id |
| `app.shared.js:926` | branch, group_type_id, trainer_id |
| `app.shared.js:1068` | branch, group_type_id |
| `app.admin.staff.js:161 / 213 / 226 / 353` | group_instance_id |
| `app.admin-ops.groups.js:403` | group_instance_id |
| `app.senior.groups.js:357` | `*, group_types(name,type)` |
| `app.client.js:586` | branch, group_types(name), profiles(fio) — **клиентская роль** |

> `staff:213` — внутри `.then()`-цепочки; переписать на `await DB.getTrainerGroupById(...)`.
> Кэшировать getter (по аналогии с `getGroupInstanceMembers`) — эти лукапы частые.

### D1–D15. Остальные новые ручки (по одной на позицию/пару)

| # | Метод `DB.*` | Эндпоинт | Sites |
|---|---|---|---|
| D1 | `addDuty(trainerId, branch, start, end)` | `POST /duties/manual` (insert с явными временами; `start/stop` не подходят) | schedule:576, tabs:231 |
| D2 | `updateDuty(id, start, end)` | `POST /duties/{id}/update` | schedule:772 |
| D3 | `updateWorkout(id, updates)` | `POST /workouts/{id}/update` | report:471 |
| D4 | `getMyGroupSubstitutions(trainerId, y, mo)` | новый GET (by `substitute_trainer_id`, embed `trainer_groups(*, group_types(name))`) — ⚠️ существующие `getGroupSubstitutionsForMonth`(by branch)/`...History`(by group) НЕ подходят | report:36 |
| D5 | `deleteQueueItem(id)` | `DELETE /notifications/{id}` | notif-ui:227 |
| D6 | `getSessionNotesReport(from, to)` | новый GET (все конспекты за период + embeds clients/profiles/workouts) — `getNoteByWorkout` только по одному ПТ | shell:244 |
| D7 | `getGoalsReport(from, to)` | новый GET (все цели за период + embeds) | shell:252 |
| D8 | `updateGroupSession(id, date, headcount)` | `POST /group-sessions/{id}/update` | shared:956 |
| D9 | `deleteGroupSession(id)` | `POST /group-sessions/{id}/delete` | shared:965 |
| D10 | `getAdultGroupSessions(groupTypeId, branch, from, to)` | новый GET (`*, profiles(fio)` для истории взрослой группы; `getGroupSessions` — by trainer_id) | shared:578 |
| D11 | `addDuplicateFlag(instanceId, id1, id2)` | `POST /group-duplicate-flags` | staff:178 |
| D12 | `getClientPtCount(clientId)` | новый GET (count / has-records) | shared:17, shared:91 |
| D13 | `getClientSubscriptionsBulk(clientIds, monthEnd)` | новый GET — **клиентская панель** | client:462 |
| D14 | `getClientWorkoutsBulk(clientIds, from, to)` | новый GET — **клиентская панель** | client:471 |
| D15 | `getAllActiveGroups()` (все филиалы) | новый GET (или цикл по филиалам поверх `/group-instances/active`) | groups:62 |

---

## Порядок реализации (когда дашь добро)

1. **A + B** (13 sites) — чистые замены/фильтры, 0 бэкенда. Быстрая победа, коммит per file.
2. **C** (5 sites) — обёртки над готовыми ручками (хлор, tech_bills delete, queue GET).
3. **D0** — `getTrainerGroupById` + ручка → сразу минус 16 sites (крупнейший рычаг).
4. **D1–D15** — по одной ручке, коммит по домену (duties → notes/goals → group_sessions → client-panel → misc).

Каждый экран после правки — открыть в браузер-превью (бэкенд поднят, api :8000), проверить
рендер + round-trip мутации с откатом тест-данных. `?v=` бампать в `index.html`.

## Открытые вопросы к тебе
1. **control:191** — ок ли переиспользовать `getAnWorkouts` (с его фильтрами pending/substitute), или нужен «сырой» узкий getter?
2. **Клиентская панель** (client:462/471/531/586) — под каким токеном/ролью ходит клиент? Нужен доступ клиентской роли к соответствующим ручкам (проверить RLS-аналог/guard на бэкенде).
3. **D1 addDuty** — «ручное» дежурство с явными временами это отдельный сценарий от start/stop? Подтверждаю дизайн `POST /duties/manual`.
