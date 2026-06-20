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
└── jobs/            node-джобы для GitHub Actions
    ├── remind.js        напоминания тренерам (ежечасно)
    └── process-queue.js разбор очереди уведомлений (каждые 5 мин)
supabase/          ← БД-слой: миграции (источник правды) + Edge Functions.
                     Остаётся в корне — стандартный путь Supabase CLI / branching.
.github/workflows/ ← CI/CD (deploy, daily-reminder, process-queue)
docs/              ← паспорта, отчёты, выгрузки
```

> Деплой публикует **только `frontend/`** (`rsync frontend/ _site/`). Браузерные файлы
> грузятся относительными путями `js/…` и `css/…` от корня сайта.
>
> Воркфлоу `daily-reminder` / `process-queue` запускают `node backend/jobs/*.js`
> (npm-зависимости ставятся в корень, node резолвит их вверх по дереву).

### frontend/js

UI/бизнес-логика (бывший монолит `app.js` ~10 600 строк) разбита на 6 модулей
по ролям. Все — классические `<script>` в общем global scope; **порядок подключения
в `index.html` критичен** (top-level код и bootstrap зависят от него):

```
app.js → app.trainer.js → app.admin.js → app.admin-ops.js → app.exec.js → app.shared.js
```

| Файл | Назначение |
|---|---|
| `app.js` | Ядро: STATE, утилиты, UI, INIT, AUTH + панели КЛИЕНТ и СТАРШИЙ (~2400 стр.) |
| `app.trainer.js` | Панель тренера: TRAINER:* (home/clients/workouts/schedule/today/duties/events/report) |
| `app.admin.js` | Координатор — управление: SHELL/ANALYTICS/CLIENTS/SALARY/STAFF/BRANCHES |
| `app.admin-ops.js` | Координатор — операционка: GROUPS/CONTROL/TECH (top-level `window._glInstances`) |
| `app.exec.js` | CEO / RECEPTION / MANAGER |
| `app.shared.js` | SHARED:* (модалки удаления/профиля/уведомлений/групп) + bootstrap `DOMContentLoaded→init` |
| `db.js` | Обёртки над Supabase (`DB.*`), ~2800 строк — единственная точка интеграции с Supabase |
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

## Карта секций app.js

Поиск по `// SECTION:` в файле.

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
CLIENT:PROFILE      — карточка клиента: абонементы, заморозка, цели, конспекты
CLIENT:EXPORT       — Excel-экспорты
SENIOR / SENIOR:GROUPS / SENIOR:REPORT — панель старшего тренера
ADMIN:SHELL/CONTROL/ANALYTICS/CLIENTS/SALARY/STAFF/BRANCHES/GROUPS/TECH — координатор
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
Дубли pending-запросов блокируются в db.js (`already_pending`).

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
Баланс, абонементы (пакеты/dropin, история), заморозка (`calcFreezeResult`),
досрочное закрытие (дети — сгорает, взрослые — сохраняется), цели,
отчёт по абонементу, перевод к другому тренеру, архив, конспекты.

### Старший тренер (renderSeniorApp)
Аналитика филиала, отчёты, группы (назначение/снятие тренера, карточки),
утверждение замен, выплаты по группам. Доп. филиалы — через `branch_access` (кнопка 🔑 у координатора).

### Координатор (renderAdminApp)
Персонал (CRUD, архив, доступы), все клиенты, расписание филиала, аналитика,
ЗП-сводка с корректировками, филиалы, полное управление группами,
Контроль (audit log, сессии, конспекты, поздние запросы, запросы на удаление),
Тех. часть (оборудование, поломки, закупки, счета, хлор, планы).

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
(`pending_confirmation=false`). Напоминания: бейдж / конец дня 21:00 (`RECEPTION_EOD_HOUR`) →
`notifications_queue` / эскалация >24ч (`RECEPTION_ESCALATE_HRS`) в «Контроле» координатора.
ЗП тренера (TRAINER:REPORT) делит ПТ на «Подтверждено» (confirmed) и «В ожидании» (pending, серым);
rejected исключён. ⚠️ по группам «ходит, но не платит» (`getGroupUnpaidAttendees`).

### CEO (renderCeoApp)
Дашборд (выручка/ПТ/дежурства/группы по филиалам), Аналитика (выручка по типам и тренерам,
ФОТ/выручка, средний чек, активная база/новые/отток, ср. остаток ПТ, тепловая карта загруженности
по слотам; выручка ПТ — расчётная по `PT_PRICES` из config.js), ЗП-сводка, группы (просмотр), операционка, планы.

### Управляющий (renderManagerApp)
Директор филиала. **Один филиал (`branches[0]`) + строго read-only** — никаких действий записи.
Вкладки: Аналитика (отдельная read-only копия оболочки с залоченным филиалом — переиспользует
загрузчики `_fill*Card` и хабы координатора), Персонал (тренеры филиала + показатели за месяц,
карточка тренера), Группы (активные группы + карточка с составом/оплатами/должниками),
Техчасть (оборудование/поломки/закупки/счета/хлор/планы — списками), ЗП (сводка поимённо через
`renderSummaryTable(.,.,.,false)` + ФОТ/выручка + экспорт). Все запросы — те же `DB.*` чтения, что
у координатора; дублируется только слой отображения. В шапке — пометка «👁 Просмотр».

### Группы
- Детские: дети, посещаемость, оплата за месяц, должники, заметки прогресса, экспорт ЗП
- Взрослые: клиенты, занятия (лог/правка), явка по дате, выплаты
- Общее: расписание группы, замены, `group_instance_id`, второй тренер, ставки percent/flat, надбавка руководителю

---

## Деплой

GitHub Pages, автодеплой при пуше в `main`. Использовать скилл **aquadesk-deploy**:
проверка `node --check` всех JS → diff → коммит (по-русски) → push.
Git-credentials настроены в `~/.git-credentials`.
