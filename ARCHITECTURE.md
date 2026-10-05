# AquaDesk — Архитектура

Vanilla JS (ES2020) без фреймворков и сборки. Один глобальный неймспейс,
HTML рендерится строками через `innerHTML`, обработчики — inline `onclick`.

---

## Структура репозитория

```
frontend/          ← публикуется на GitHub Pages (корень сайта)
├── index.html       точка входа, Supabase SDK, lazy-load XLSX
├── schedule.html    отдельный экран расписания
├── js/              браузерные скрипты (подключаются в index.html)
└── css/             стили
backend/
└── jobs/            node-джобы — РУЧНОЙ аварийный канал (workflow_dispatch)
    ├── remind.js        напоминания (копия логики Edge Function daily-reminder)
    └── process-queue.js доставка очереди уведомлений (копия Edge Function process-queue)
supabase/          ← БД-слой: миграции (источник правды) + Edge Functions.
                     Остаётся в корне — стандартный путь Supabase CLI / branching.
                     Регулярные запуски ведёт pg_cron → pg_net → Edge Functions
                     (daily-reminder ежечасно, process-queue раз в минуту).
.github/workflows/ ← CI/CD: deploy (автоматически), daily-reminder / process-queue (только вручную)
docs/              ← паспорта, отчёты, выгрузки
```

> Деплой публикует **только `frontend/`**: CI собирает бандл `scripts/build.js`
> (31 js + 4 css → `dist/app-<hash>.js|css`, index.html в _site переписывается на них).
> В репозитории index.html остаётся пофайловым — локальная разработка без сборки.
> Минификация БЕЗ переименования идентификаторов (inline `onclick="…"` зависит от имён).
>
> Воркфлоу `daily-reminder` / `process-queue` запускают `node backend/jobs/*.js`
> (npm-зависимости ставятся в корень, node резолвит их вверх по дереву).
> Расписания в них отключены — это ручной канал на случай сбоя pg_cron.
> Правишь логику Edge Function — синхронно правь копию в `backend/jobs/`.

### frontend/js

UI/бизнес-логика (бывший монолит `app.js` ~10 600 строк) разбита на 19 модулей
`app*.js` по ролям/доменам. Все — классические `<script>` в общем global scope;
**порядок подключения в `index.html` критичен** (top-level код и bootstrap зависят от него):

```
config → db.core → db.clients → db.groups → db.schedule → db.analytics → db.ops
→ db.salary → db.misc → export → app.core → app.auth → app.client → app.senior*
→ app.trainer.* → app.admin.* → app.admin-ops.* → app.exec → app.shared
→ tutorial → notifications-ui
```

> Глобальный скоуп общий: функция, объявленная в двух файлах, молча перекрывается
> той, что подключена позже. Перед добавлением функции проверь, что имя свободно:
> `grep -rn "function <имя>" frontend/js/`.

| Файл | Назначение |
|---|---|
| `app.core.js` | Ядро: STATE, кеш (`cached`/`once`/`invalidateCache*`), утилиты (`$`/`$$`/`toast`), UI, dev-переключатель, INIT. **Грузится первым** среди app-файлов |
| `app.auth.js` | AUTH: регистрация, PIN-вход, привязка профиля |
| `app.client.js` | CLIENT:PROFILE + EXPORT: профиль клиента, абонементы, заморозка, цели, Excel-экспорт |
| `app.senior.js` | SENIOR: шелл старшего, аналитика, `seniorTab` |
| `app.senior.groups.js` | SENIOR:GROUPS: группы старшего (`renderSeniorGroups`/`renderGroupDetail`/назначения) |
| `app.senior.report.js` | SENIOR:REPORT: `renderBranchReport`, `loadBranchSummary` |
| `app.trainer.tabs.js` | Тренер: shell + home + clients + конспекты (overdue) |
| `app.trainer.workouts.js` | Тренер: таб «Списание» + добавление клиента (`let _wkClientTimer`) |
| `app.trainer.schedule.js` | Тренер: schedule + today + duties + events (`let _schedWeekOffset`) |
| `app.trainer.report.js` | Тренер: отчёт + модалки действий с клиентом (edit/transfer/пакет/пересчёт) |
| `app.admin.shell.js` | Координатор: SHELL (`renderAdminApp`/`adminTab`/`renderAdminMore`) |
| `app.admin.analytics.js` | Координатор: ANALYTICS (Overview + хабы Деньги/Клиенты/Загрузка/Контроль) |
| `app.admin.clients.js` | Координатор: CLIENTS + SALARY (клиенты, сводка ЗП, `adminDetail`) |
| `app.admin.staff.js` | Координатор: STAFF + BRANCHES (персонал, филиалы, `ROLE_LBL`) |
| `app.admin-ops.groups.js` | Координатор — операционка: GROUPS (top-level `window._glInstances`) |
| `app.admin-ops.control.js` | Координатор — операционка: CONTROL (audit log, сессии, конспекты, поздние запросы) |
| `app.admin-ops.tech.js` | Техчасть (3 раздела: счета/техничка-поломки/хлор, `TECH_*`). Общие рендеры (`renderAdminTech`/`renderCeoTech`/`renderManagerTech` + `techRender*`/`techLoadSection`) для координатора (редакт.), CEO и управляющего (read-only) |
| `app.exec.js` | CEO / RECEPTION / MANAGER |
| `app.shared.js` | SHARED:* (модалки удаления/профиля/уведомлений/групп) + bootstrap `DOMContentLoaded→init` |
| `db.*.js` | Обёртки над Supabase (`DB.*`) — единственная точка интеграции. Разбито по доменам, грузить строго в порядке: `db.core.js` (хелперы `sb`/JWT/`_brFilter` + `const DB = {}` + auth/профили/филиалы) → `db.clients.js` (клиенты/ПТ/разовые/дежурства) → `db.groups.js` (группы/посещения/замены/ставки) → `db.schedule.js` (слоты/события/абонементы/конспекты) → `db.analytics.js` (аналитика/сводки/`An*`) → `db.ops.js` (уведомления/переводы/ресепшн) → `db.salary.js` (глобальные `calcSalary`/`calcChildGroupPayroll`) → `db.misc.js` (техчасть/удаления/аудит/взрослые группы). Каждый файл после core делает `Object.assign(DB, {...})` |
| `config.js` | Константы: тарифы `RATES`, пакеты `SUB_PACKAGES`, лимиты, `calcSubEnd` |
| `export.js` | Экспорт Excel (xlsx-js-style) |
| `tutorial.js` | Туториал + `enterApp` |
| `notifications-ui.js` | Уведомления (UI) |

> **Поиск по коду:** функции по-прежнему ищутся по `// SECTION:` — маркеры сохранены
> внутри модулей. Чтобы найти секцию: `grep -rn "// SECTION: <ИМЯ>" frontend/js/`.

### frontend/css

`style.css` (основные), `analytics.css`, `tutorial.css`, `notifications.css`.

Схема БД, FK-каскады и RPC — в [DATABASE.md](DATABASE.md).

---

## Точка входа

```
index.html → Telegram.WebApp.ready() → init()
  ├── getProfileByTgId(tg_id) → null → renderRegister()
  │     └── claim_profile (привязка существующего) или создание нового
  ├── has_pin → renderPinEntry() → verify_pin
  └── enterApp()
      ├── role=admin          → renderAdminApp()
      ├── role=senior_trainer → renderSeniorApp()
      ├── role=ceo            → renderCeoApp()
      ├── role=reception      → renderReceptionApp()
      ├── role=manager        → renderManagerApp()
      └── else                → renderTrainerApp()
```

Одна роль = одна панель, мультипанель убрана.

---

## Навигация

- **Bottom tabs** в каждой панели: `switchTab(tab)` / `adminTab(tab)` / `seniorTab(tab)` → рендер в `#tab-content`
- **setScreen(html)** — полная замена экрана
- **navPush(backFn) / goBack()** — внутренний стек возврата (`STATE._backFn`)
- **setupBack(cb)** — нативная кнопка «назад» Telegram (BackButton)
- При открытии карточки группы/клиента ставить **оба**: `navPush` и `setupBack`,
  возврат — на вкладку-источник (например `renderTrainerShell('groups')`), не на главную

---

## Карта секций

Поиск по `// SECTION:` в `frontend/js/` (оглавление — в шапке `app.core.js`).

```
CORE:STATE / CORE:UTILS / CORE:UI / CORE:INIT — состояние, утилиты, навигация, init
DEV                 — дев-переключатель ролей (isDev/DEV_TG_ID, devSwitchRole, _devWrapDB);
                      только координатор-владелец, флаг STATE._devRole, БД не трогается
AUTH                — регистрация, PIN, claim_profile
TRAINER:SHELL       — renderTrainerApp, renderTrainerShell, switchTab
TRAINER:HOME        — главная: дежурство, счётчики, значок конспектов
TRAINER:CLIENTS     — список клиентов, дубли (_findDuplicates), renderOverdueNotesModal
TRAINER:CLIENTS:ADD — добавление клиента
TRAINER:WORKOUTS    — лог ПТ (doLogWorkout/doConfirmLogWorkout), запросы на удаление
TRAINER:SCHEDULE    — недельное расписание, слоты
TRAINER:TODAY       — слоты на сегодня, подтверждение
TRAINER:DUTIES      — дежурства старт/стоп, поздние запросы
TRAINER:EVENTS / TRAINER:REPORT — мероприятия, отчёт+ЗП
TRAINER:SEQ_SURVEY  — опросник «Сверка порядковых списаний»
CLIENT:PROFILE      — карточка клиента: абонементы, заморозка, цели, конспекты
CLIENT:EXPORT       — Excel-экспорты
SENIOR / SENIOR:GROUPS / SENIOR:REPORT — панель старшего тренера
ADMIN:SHELL/CONTROL/ANALYTICS/CLIENTS/SALARY/STAFF/BRANCHES/GROUPS/TECH/SCHEDULE — координатор
                      (SCHEDULE — вкладка «📅 Расписание»: план слотов по филиалу/тренеру, app.admin.staff.js)
CEO                 — дашборд, ЗП-сводка, группы, операционка, планы
RECEPTION           — панель ресепшена: подтверждение списаний (Шаг 1 → 1С)
MANAGER             — renderManagerApp, read-only панель управляющего (один филиал)
SHARED:DELETE       — запросы на удаление клиентов (тренер → координатор)
SHARED:PROFILE / SHARED:NOTIFICATIONS / SHARED:GROUP_MODALS
```

---

## Ключевые паттерны

### Защита от двойных нажатий
```js
if (_pending.has(key)) return;
_pending.add(key);
try { ... } finally { _pending.delete(key); }
```
Плюс `once(key, fn)` и `rateLimit(key, ms)`.

### Экранирование (XSS) — обязательно
HTML собирается строками, поэтому **любой текст, введённый людьми** (ФИО, названия групп/филиалов,
конспекты, причины, комментарии) вставляется только через хелперы из `app.core.js`:

| Где в шаблоне | Хелпер | Пример |
|---|---|---|
| текст / значение атрибута | `esc(x)` | `<b>${esc(c.fio)}</b>`, `value="${esc(c.fio)}"` |
| строка в `on*`-обработчике, приходит как есть | `jsq(x)` | `onclick="fn('${jsq(c.fio)}')"` |
| то же, закодированно (на той стороне `decodeURIComponent`) | `encArg(x)` | `onclick="fn('${encArg(c.fio)}')"` |

`encodeURIComponent` для аргументов обработчиков не использовать: он не кодирует апостроф,
и имя «G'ulomov» рвёт JS-строку. `toast()` выводит только текст (`textContent`).
Тексты уведомлений (`notifications_queue.message`) — HTML (Telegram `parse_mode=HTML`,
колокольчик рендерит как есть): пользовательские вставки при сборке — тоже через `esc()`,
на сервере (Edge Function `daily-reminder`) — через `escHtml()`.

### Кеш
`cached(key, fn, ttl=300000)` — 5 минут в памяти.
Сбрасывать после записи: `invalidateCache('profiles')`, `invalidateCache('branches')`.

### Окна времени (config.js)
- `MAX_BACKDATE_HOURS = 72` — ПТ можно внести задним числом максимум на 72ч, дальше — поздний запрос
- `NOTE_DEADLINE_HOURS = 48` — дедлайн конспекта
- `EDIT_WINDOW_MIN = 30` — окно редактирования/удаления своей записи (`canEdit(createdAt)`)

### Значок конспектов 📝
`#note-badge` в шапке тренера. `checkNoteBadge()` грузит просроченные из БД;
`window._overdueMap` (client_id → count), `window._freshNoteWorkouts` (свежие ПТ без конспекта,
ещё не «просроченные» в БД), `window._clientsList` — кеш списка клиентов.
`renderOverdueNotesModal` показывает инлайн-формы конспектов.

### Флоу запросов на одобрение
Тренер создаёт `pending`-запрос → координатор/старший одобряет или отклоняет.
Три вида: удаление клиента, удаление ПТ, позднее внесение ПТ.
Дубли pending-запросов блокируются в db.*.js (`already_pending`).

---

## Панели по ролям (реализованный функционал)

### Тренер (renderTrainerApp)
| Вкладка | Функции |
|---|---|
| Главная | активное дежурство, быстрый старт, счётчики ПТ/конспектов, значок 📝 |
| Клиенты | свои клиенты (поиск Levenshtein, ⚠️ дубли), карточка, архив |
| Тренировки | лог ПТ (тип/дата/замена), список за неделю, запросы на удаление и позднее внесение |
| Расписание | недельный вид, слоты ПТ/дежурство/группа, пропуск даты |
| Сегодня | слоты на сегодня, подтверждение/отмена |
| Дежурство | старт/стоп (круглые часы), история |
| Мероприятия | запись/отмена |
| Отчёт | ПТ+дежурства за месяц, ЗП, Excel |

### Карточка клиента
Баланс, абонементы (пакеты/dropin, история), заморозка (`calcFreezeResult`), цели,
отчёт по абонементу, перевод к другому тренеру, архив, конспекты,
«⚠ Не совпадает с 1С» (флаг расхождения остатка).
(Досрочное закрытие абонемента убрано из UI 2026-06-09 в пользу заморозки; код удалён.)

### Старший тренер (renderSeniorApp)
Аналитика филиала, отчёты, группы (назначение/снятие тренера, карточки),
утверждение замен, выплаты по группам. Доп. филиалы — через `branch_access` (кнопка 🔑 у координатора).

### Координатор (renderAdminApp)
Навбар: Сводка · Аналитика · 📅 Расписание · Персонал · Группы · Контроль · Ещё (Клиенты — в «Ещё»).
📅 Расписание (`renderAdminSchedule`): план из `schedule_slots` на неделю — филиал → все тренеры или один,
фильтр дежурства/группы/ПТ, отмены и «нет остатка» помечены; карточка тренера (слоты в неделю, последняя
внесённая ПТ/дежурство) + блок 🔔 пушей по расписанию (`schedule_reminder`) — только `isDev()`. Сверки план/факт нет.
Персонал (CRUD, архив, доступы), все клиенты, аналитика,
ЗП-сводка с корректировками, филиалы, полное управление группами,
Контроль (audit log, сессии, конспекты, поздние запросы, запросы на удаление),
Техчасть (счета + сводка к оплате, техничка-поломки с датой «висит с…», хлор).

### Ресепшн (renderReceptionApp)
Подтверждение списаний ПТ (Шаг 1 интеграции с 1С). Видит только свой филиал (`branches[0]`).
| Вкладка | Функции |
|---|---|
| Подтвердить | очередь pending за день (ПТ + пробные), ✓/✗ по каждой, «Подтвердить всё», бейдж-счётчик |
| Отклонённые | отклонённые за месяц с причинами (🔴 «вопросы по списанию») |
| Группы | детские группы филиала, отметка оплаты за месяц (`group_payments.paid`) |
| История | подтверждённые за месяц |

Списание тренера создаётся `reception_status='pending'` (DEFAULT в БД). Ресепшн `confirm` → в ЗП;
`reject` → откат баланса (`increment_balance +1` для обычных ПТ; сброс `drop_in_used` для разовых детей)
+ уведомление тренеру. Замена попадает в очередь только после подтверждения тренером Б
(`pending_confirmation=false`). Напоминания: бейдж в панели / вечерний пуш «конец дня» ставит
pg_cron (правило `reception_eod` в Edge Function daily-reminder) / эскалация >24ч
(`RECEPTION_ESCALATE_HRS`) в «Контроле» координатора.
ЗП тренера (TRAINER:REPORT) делит ПТ на «Подтверждено» (confirmed) и «В ожидании» (pending, серым);
rejected исключён. ⚠️ по группам «ходит, но не платит» (`getGroupUnpaidAttendees`).

### CEO (renderCeoApp)
Дашборд (выручка/ПТ/дежурства/группы по филиалам), Аналитика (выручка по типам и тренерам,
ФОТ/выручка, средний чек, активная база/новые/отток, ср. остаток ПТ, тепловая карта загруженности
по слотам; выручка ПТ — расчётная по `PT_PRICES` из config.js), ЗП-сводка, группы (просмотр),
Техчасть (read-only, все филиалы — счета/техничка/хлор через общие `techRender*`).

### Управляющий (renderManagerApp)
Директор филиала. **Один филиал (`branches[0]`) + строго read-only** — никаких действий записи.
Вкладки: Аналитика (отдельная read-only копия оболочки с залоченным филиалом — переиспользует
загрузчики `_fill*Card` и хабы координатора), Персонал (тренеры филиала + показатели за месяц,
карточка тренера), Группы (активные группы + карточка с составом/оплатами/должниками),
Техчасть (read-only, свой филиал: счета/техничка-поломки/хлор — общие `techRender*` с координатором), ЗП (сводка поимённо через
`renderSummaryTable(.,.,.,false)` + ФОТ/выручка + экспорт). Все запросы — те же `DB.*` чтения, что
у координатора; дублируется только слой отображения. В шапке — пометка «👁 Просмотр».

### Группы
- Детские: дети, посещаемость, оплата за месяц, должники, заметки прогресса, экспорт ЗП
- Взрослые: клиенты, занятия (лог/правка), явка по дате, выплаты
- Общее: расписание группы, замены, `group_instance_id`, второй тренер, ставки percent/flat, надбавка руководителю

---

## Деплой

GitHub Pages, автодеплой при пуше в `main` (workflow `deploy.yml`: сборка бандла
`node scripts/build.js _site` → publish). Использовать скилл **aquadesk-deploy**:
проверка `node --check` всех JS → локальная проверка сборки → diff → коммит (по-русски)
→ push → контроль `gh run` деплоя. `?v=` в index.html больше не критичен для прода
(хэш в имени бандла), но порядок `<script>` — по-прежнему критичен.
Git-credentials настроены в `~/.git-credentials`.
