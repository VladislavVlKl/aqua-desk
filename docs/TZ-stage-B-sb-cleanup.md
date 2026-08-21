# ТЗ — Этап B, финальная чистка прямых `sb()` в app-файлах

> **Контекст:** слой `db.*.js` (~228 методов `DB.*`, 8 файлов) **полностью мигрирован** на FastAPI
> (инкременты 1–23, см. память `project_backend_migration.md`). Прод не тронут — всё за флагом
> `CONFIG.API_MODE[domain]`. **Это ТЗ — про последний кусок до полного флипа: 51 прямой вызов
> `sb()` в app-файлах, минующий слой `DB.*`.**

---

## 0. Правила окружения (ОБЯЗАТЕЛЬНО прочесть)

- **Редактировать ТОЛЬКО в worktree** `/Users/vladislavklimov/aqua-desk-fe/` — НЕ в `/Users/vladislavklimov/aqua-desk/`
  (в main-репе параллельные сессии; см. память `feedback_deploy_scope`).
- **Бэкенд:** `/Users/vladislavklimov/aqua-desk-v2/` (не под git). Модульный монолит FastAPI,
  запуск `docker compose up`; после правок Python-модулей, если `--reload` не подхватил —
  `docker compose restart api`.
- **Локальный логин без Telegram-подписи:** dev-login эндпоинт (env-guarded) — уже используется в браузер-проверках.
- **Проверка:** браузер-превью фронта → `read_console_messages` / `read_network_requests`; каждый
  переведённый экран открыть и убедиться, что рендерится и мутации проходят round-trip.
- **После правок db/app файла** — бампнуть `?v=` в `frontend/index.html` (кэш-бастинг).
- **asyncpg-гайки** (из прошлых багов): даты передавать объектами `date.fromisoformat()` /
  `datetime.fromisoformat()` (не строками), тип задавать `CAST(... AS date)`. INSERT ... RETURNING —
  через прямой execute (CTE + `row_to_json`), не через `q_one`.

---

## 1. Задача

51 прямой `sb().from(...)` / `sb().rpc(...)` в app-файлах втянуть в слой `DB.*`:
- **если метод уже есть** в `db.*.js` → заменить вызов `sb()` на `DB.xxx()`;
- **если нет** → добавить метод в `db.*.js` (+ мелкий эндпоинт в бэкенд, если требуется) и позвать его.

Цель — чтобы **ни один app-файл не обращался к Supabase напрямую**. После этого возможен
финальный флип `API_MODE.all = 'api'` и удаление supabase-js CDN.

---

## 2. Инвентарь по файлам (51 место)

### app.shared.js — 15 (самый нагруженный)
| Строка | Что |
|---|---|
| 17 | `workouts` |
| 91 | `workouts` select id by client (проверка «есть ли тренировки») |
| 391, 396, 599, 668, 718, 815, 843, 926, 1068 | `trainer_groups` (ad-hoc лукапы групп) |
| 481 | `trainer_groups` → `group_types(billing_model)` by id |
| 578 | `group_sessions` select `*, profiles(fio)` |
| 956 | `group_sessions` **update** (session_date, headcount) |
| 965 | `group_sessions` **delete** |

### notifications-ui.js — 6
| Строка | Что | Уже есть в DB? |
|---|---|---|
| 9 | `notification_rules` select | → `DB.getNotificationRules` (проверить наличие) |
| 13 | `notification_rules` update active | → `DB.toggleRule` **уже мигрирован** |
| 17 | `notifications_queue` insert (single) | → `DB.queueBroadcast`/`enqueueTrainerNotification` |
| 36 | `notifications_queue` insert (rows[]) | → `DB.queueBroadcast` |
| 41 | `notifications_queue` select | нужен `DB.getQueue`/фильтр |
| 227 | `notifications_queue` **delete** by id | нужен `DB.deleteQueueItem` |

### app.admin.staff.js — 5
| 161, 226, 353 | `trainer_groups` | |
| 178 | `group_client_duplicate_flags` **insert** | нужен метод (дубль-флаги детей) |
| 213 | `trainer_groups` select group_instance_id by id | → возможно `DB.getGroupInstanceId` |

### app.client.js — 4 (клиентская панель)
| 462 | `subscriptions` | → `DB.getClientSubscriptions`? |
| 471 | `workouts` | → `DB.getClientWorkouts`? |
| 531, 586 | `trainer_groups` | |

### app.admin-ops.tech.js — 4 (техчасть/хлор)
| 198 | `tech_bills` **delete** | → `DB.deleteTechBill` (проверить) |
| 265 | `chlorine_orders` select order_date desc | нужен `DB.getChlorineOrders` (бэкенд: есть GET /ops/chlorine — проверить) |
| 323 | `chlorine_orders` **insert** | нужен `DB.addChlorineOrder` |
| 330 | `chlorine_orders` **delete** | нужен `DB.deleteChlorineOrder` |

### app.admin-ops.groups.js — 4
| 62 | `trainer_groups` | |
| 65 | `schedule_slots` | → `DB.getSlots`/`getAllActiveSlots` уже есть |
| 403 | `trainer_groups` select group_instance_id | как staff:213 |
| 915 | `trainer_groups` | |

### app.senior.groups.js — 2
| 42, 357 | `trainer_groups` | |

### app.trainer.schedule.js — 3 (дежурства)
| 576 | `duties` **insert** | → `DB.addDuty` (проверить наличие) |
| 772 | `duties` **update** | → `DB.updateDuty` |
| 784 | `duties` **delete** | → `DB.deleteDuty` |

### app.trainer.report.js — 2
| 36 | `group_substitutions` select `*, trainer_groups(*, group_types(name))` | → `DB.getGroupSubstitutions` (уже мигрирован — проверить эмбеды) |
| 471 | `workouts` **update** by id | → `DB.updateWorkout` |

### app.admin.shell.js — 2
| 244 | `session_notes` | → `DB.getNoteByWorkout`/notes-методы уже есть |
| 252 | `training_goals` | → `DB.getGoals`/`addGoal` уже есть |

### Одиночные — 6
| Файл:стр | Что |
|---|---|
| app.admin-ops.control.js:191 | `workouts` select trainer_id by date-range |
| app.admin.clients.js:222 | `profiles` select branches by id → `DB.getProfile`/staff |
| app.exec.js:899 | `trainer_groups` |
| app.trainer.tabs.js:231 | `duties` **insert** → `DB.addDuty` (как schedule:576) |
| app.trainer.schedule.js (см. выше) | |
| app.admin.shell.js (см. выше) | |

---

## 3. Порядок работы (рекомендованный)

Идти **по файлам**, от простого к сложному, проверяя каждый экран:

1. **Быстрые (метод уже есть)** — заменить `sb()` на существующий `DB.*`:
   `duties` (schedule:576/772/784, tabs:231 → addDuty/updateDuty/deleteDuty),
   `notification_rules` (notif-ui:9/13), `session_notes`/`training_goals` (shell:244/252),
   `workouts update` (report:471), `schedule_slots` (groups:65), `tech_bills delete` (tech:198),
   `group_substitutions` (report:36). ⚠️ Сверить, что метод реально существует и эмбеды совпадают.
2. **`trainer_groups` (22 места)** — самый частый. Разобрать какие именно колонки/эмбеды нужны
   каждому call-site; свести к нескольким методам (`getTrainerGroups`/`getGroupInstanceMembers`/
   `getGroupInstanceId`/новый узкий getter). Не плодить по методу на строку.
3. **Требуют нового эндпоинта:** `chlorine_orders` (get/add/delete — бэкенд-модуль ops),
   `group_client_duplicate_flags insert`, `notifications_queue` get/delete,
   `group_sessions` update/delete (shared:956/965), `workouts` date-range (control:191).
4. **Клиентская панель** (app.client.js) — 4 места, проверить что клиентский токен/роль имеет доступ.

**Инкрементальные коммиты по файлу или группе таблиц** (в worktree). Не «разом все 51 без проверки» —
в отличие от слоя `DB.*`, тут запросы вшиты в рендер-логику, риск сломать конкретный экран.

---

## 4. Definition of Done

- [ ] `grep -rE '\bsb\(\)' frontend/js/app*.js frontend/js/notifications-ui.js` → **0 совпадений**.
- [ ] Каждый затронутый экран открыт в браузере, рендерится, мутации проходят round-trip (с откатом тест-данных).
- [ ] Затем **финал флипа** (отдельный шаг): `CONFIG.API_MODE` all → `'api'`; убрать supabase-js CDN
      из `index.html` + `JWT_MODE`; сквозной e2e-прогон по ролям.
- [ ] Обновить память `project_backend_migration.md`.

## 5. После этого — ИНФРА (отдельно, требует пользователя)
Сервер (пользователь перекинет на тариф дороже), сабдомен `api.aqua-desk.uz`, свежий `pg_dump`
из Supabase → свой Postgres, cutover Telegram-бота на новый фронт. Данные и деплой отложены на конец.
