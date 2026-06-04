# AquaDesk — Технический паспорт

> Последнее обновление: июнь 2026  
> Автор: разработка совместно с Claude (Anthropic)

---

## 1. Архитектура

```
┌─────────────────────────────────────────────┐
│            Telegram Mini App                │
│                                             │
│  index.html                                 │
│    ├── config.js     (константы, тарифы)    │
│    ├── db.js         (DB.* + calcSalary)    │
│    ├── app.js        (UI + бизнес-логика)   │
│    ├── export.js     (Excel-выгрузки)       │
│    ├── tutorial.js   (онбординг + enterApp) │
│    └── notifications-ui.js                  │
│                                             │
│  schedule.html  (отдельная публичная стр.)  │
└───────────────────────┬─────────────────────┘
                        │ HTTPS / PostgREST
                        ▼
┌─────────────────────────────────────────────┐
│              Supabase (eu-central-1)        │
│                                             │
│  PostgreSQL + Row Level Security (RLS)      │
│  Auth: через tg_id (не Supabase Auth)       │
│  Storage: не используется                   │
│  Edge Functions: не используются            │
│  RPC: verify_pin, change_pin,               │
│       claim_profile, get_profile_by_tg_id   │
└─────────────────────────────────────────────┘
```

**Деплой:** GitHub Pages (автодеплой при push в `main`)  
**Вход:** `window.Telegram.WebApp.initDataUnsafe.user.id`  
**Нет:** сервера, backend-кода, авторизации через Supabase Auth

---

## 2. Алгоритм запуска приложения

```
Telegram.WebApp.ready()
    │
    ▼
init()
    ├── tgId = Telegram.WebApp.initDataUnsafe.user.id
    ├── если нет tgId → renderRegister() (ввод ФИО)
    │
    ▼
DB.getProfileByTgId(tgId)   [RPC: get_profile_by_tg_id]
    ├── null → renderRegister()
    ├── profile.has_pin = true → renderPinEntry()
    │       ├── 5 неверных попыток → блок 30 сек
    │       └── верный PIN → enterApp()
    └── has_pin = false → enterApp()
            │
            ▼
        role = profile.role
            ├── 'admin'          → renderAdminApp()
            ├── 'senior_trainer' → renderSeniorApp()
            ├── 'ceo'            → renderCeoApp()
            └── else             → renderTrainerApp()
```

**Защита PIN:**
- Хранится хешированным в БД (bcrypt через Postgres)
- Проверка только через RPC `verify_pin(tg_id, pin)` → boolean
- Открытый PIN в JS никогда не хранится

---

## 3. Роли и панели

| Роль | Панель | Ключевые возможности |
|------|--------|---------------------|
| `trainer` | 🏋️ AquaDesk | Клиенты, списание ПТ, дежурства, расписание, отчёт, группы |
| `senior_trainer` | ⭐ AquaDesk | + замены, одобрение ПТ и группповых замен, отчёт филиала |
| `admin` | 👑 Координатор | Всё + персонал, ЗП утверждение, операционка |
| `ceo` | 🏆 Топ | Дашборд, сводная ЗП, группы, операционка, планы |

---

## 4. База данных — таблицы и связи

### Ключевые FK-связи
```
profiles (id)
    ├──< workouts.trainer_id
    ├──< duties.trainer_id
    ├──< trainer_groups.trainer_id
    ├──< schedule_slots.trainer_id
    └──< month_adjustments.trainer_id

clients (id)
    ├──< workouts.client_id
    ├──< subscriptions.client_id
    └──< session_notes.client_id

trainer_groups (id)  ← одна запись = один тренер в одной группе
    ├──< group_clients.group_id        (дети)
    ├──< adult_group_clients.group_id  (взрослые)
    ├──< group_payments.group_id
    ├──< group_trainer_payouts.group_id
    └── group_types.id (тип группы)

group_types (id)
    ├──< trainer_groups.group_type_id
    └──< schedule_slots.group_type_id
```

### Таблицы по категориям

**Персонал:**
- `profiles` — fio, role, branches[], tg_id, has_pin
- `branch_access` — доп. доступ тренера к чужому филиалу

**ПТ (персональные тренировки):**
- `clients` — fio, category(1-3), balance, sub_start, sub_end, drop_in_used
- `workouts` — тип, дата, category_at_moment, substitute_for, substitute_rate
- `subscriptions` — история абонементов
- `trial_sessions` — пробные тренировки
- `session_notes` — конспекты (дедлайн 48ч)
- `training_goals` — цели клиентов
- `delete_requests` — запросы на удаление клиентов (нужно одобрение senior)

**Дежурства:**
- `duties` — start_time, end_time, branch

**Расписание:**
- `schedule_slots` — повторяющиеся и разовые слоты (pt/group/duty)
- `schedule_cancellations` — отмены конкретных дат

**Группы:**
- `group_types` — Акваджим, Аквафитнес, Art-swim, Детская
- `trainer_groups` — назначение тренера: group_type_id, branch, rate_value, role, leader_name, leader_fee_percent
- `group_clients` — дети (is_active, name, age, monthly_price, level)
- `adult_group_clients` — взрослые (name)
- `group_sessions` — занятия взрослых (headcount, session_date)
- `group_attendance` — посещаемость детей (attended bool)
- `group_payments` — оплата детей за месяц (paid bool, amount)
- `group_trainer_payouts` — утверждённая ЗП тренера за группу за месяц
- `group_substitutions` — замены в группах (статус: pending/approved)
- `group_progress_notes` — заметки по прогрессу
- `group_trainer_payouts` — UNIQUE(group_id, trainer_id, month) — нет дублей

**Операционка:**
- `tech_issues`, `tech_bills`, `tech_shopping`, `tech_equipment`
- `chlorine_orders`, `ops_plans`, `events`
- `notifications_queue`

---

## 5. Алгоритм расчёта ЗП (`calcSalary`)

Функция в `db.js`, вызывается из: отчёт тренера, сводка координатора, CEO-панель.

```
calcSalary({ workouts, duties, trainerGroups, groupSessions,
             groupPayouts, groupSubstitutions, trialSessions,
             adjustment, trainerId })
    │
    ├── ПТ-доходы
    │   ├── Обычные ПТ: workouts по категориям × RATES.pt[cat]
    │   │   ИСКЛЮЧЕНИЕ: замены с кастомной ставкой (substitute_for != null)
    │   ├── Разовые (drop-in): по категории × ставка
    │   ├── Пробные: по категории клиента × ставка
    │   └── ПТ-замены: workouts где substitute_for != null и substitute_rate != null
    │       → суммируются отдельно (ptSubSum)
    │
    ├── Дежурства
    │   hours = Σ(end_time - start_time) в часах
    │   dutySum = hours × RATES.duty_per_hour (14 000 сум/ч)
    │
    ├── Детские группы
    │   childSum = Σ group_trainer_payouts.payout_value
    │   где group_trainer_payouts.group_id = trainer_groups.id
    │   (только утверждённые координатором за этот месяц)
    │
    ├── Взрослые группы
    │   adultSum = Σ getAdultGroupRate(session.headcount)
    │   где billing_model = 'headcount'
    │   getAdultGroupRate: 1-3 чел=110к, 4-6=120к, 7+=130к
    │
    ├── Групповые замены
    │   groupSubSum = Σ groupSubstitutions.rate
    │   где status='approved' AND substitute_trainer_id = trainerId
    │
    └── Итого
        total = ptSum + dropInSum + trialSum + ptSubSum
              + dutySum + childSum + adultSum + groupSubSum
              + adjustment.bonus - adjustment.penalty
```

**Известные ограничения:**
- `childSum` берёт `payout_value` как есть (тип fixed/percent — оба добавляются напрямую). При типе `percent` сохраняется процент (40), а не сумма → баг при использовании percent-типа
- Взрослые группы: требуется `billing_model='headcount'` в group_types (стоит у всех взрослых групп в продакшне)

---

## 6. Алгоритм списания ПТ

```
doLogWorkout()  →  _doLogWorkoutInner()
    │
    ├── Проверки
    │   ├── clientId выбран?
    │   ├── branch выбран?
    │   ├── если не drop-in: есть незакрытые конспекты? → блок
    │   ├── если batch (count>1): есть примечание?
    │   └── если drop-in + ребёнок: уже использовал разовое?
    │
    ├── Даты
    │   ├── каждая дата: MAX_BACKDATE_HOURS = 48 часов назад
    │   └── если дата старше → type = 'late_request' (запрос на одобрение)
    │
    ├── Тип тренировки
    │   ├── regular    → workouts.insert, баланс -= 1
    │   ├── dropin1/2/3 → workouts.insert с is_drop_in=true, баланс -= 0
    │   ├── trial      → trial_sessions.insert
    │   ├── debt       → workouts.insert с is_debt=true, баланс -= 0
    │   ├── late_request → late_training_requests.insert (ждёт одобрения)
    │   └── замена     → workouts с substitute_for = другой тренер
    │
    └── Защита: once('logWorkout') → не сработает дважды
```

---

## 7. Расписание — архитектура слотов

```
schedule_slots
    ├── slot_type: 'pt' | 'group' | 'duty'
    ├── Повторяющиеся: specific_date = NULL, day_of_week = 0-6
    └── Разовые:       specific_date = 'YYYY-MM-DD'

Рендер недели:
    1. Загрузить recurring + oneTime + events + trainerGroups (для цветов)
    2. Загрузить cancellations (отменённые даты)
    3. Построить grid[day_of_week][hour] = [slots]
    4. Пропустить recurring если есть cancellation для этой даты
    5. Наложить события (events) — могут блокировать бассейн

Цвета слотов:
    pt           → фиолетовый
    group суша   → жёлтый  (role='суша' в trainer_groups)
    group вода/остальные → синий
    duty         → серый
```

---

## 8. Кеш и защита от двойных нажатий

### Кеш (in-memory, 5 минут)
```js
cached(key, fn, ttl=300000)
// Инвалидация: invalidateCache('profiles', 'branches')
// Используется для: profiles, branches, groupTypes
```

### Защита от двойного нажатия
```js
const _pending = new Set();
once('logWorkout', fn)  // обёртка — пока выполняется, повторный вызов игнорируется

// Явное использование:
if (_pending.has('payout_123_456')) return;
_pending.add('payout_123_456');
try { ... } finally { _pending.delete('payout_123_456'); }
```

### Rate Limiting (PIN)
- 5 неверных попыток → блок 30 сек
- `_pinFailCount`, `_pinBlockedUntil` — в памяти

---

## 9. Как добавить новую функцию

### Новый экран/страница

```js
// 1. Функция рендера
async function renderMyFeature() {
  setupBack(()=>{ renderAdminApp(); adminTab('...'); setupBack(null); });
  $('#tab-content').innerHTML = `<div class="tab-pad">...</div>`;
  // загрузка данных...
}

// 2. Кнопка в нужной панели
// В renderAdminApp → adminTab → renderAdminMore или другой таб

// 3. Если нужна DB-функция → добавить в Object.assign(DB, {...}) в db.js
```

### Новая таблица в Supabase

```
1. Создать через MCP: apply_migration(name, sql)
2. Настроить RLS (Row Level Security)
3. Добавить DB-методы в db.js
4. Инвалидировать кеш если нужно
```

### Новый тип ЗП

```
1. Добавить поле в calcSalary параметры
2. Загрузить данные в loadTrainerReport и getSummary (db.js)
3. Добавить в итоговую сумму (total = ... + newSum)
4. Показать в summary-cards
```

---

## 10. Паттерны кода

| Паттерн | Где | Описание |
|---------|-----|----------|
| `once(key, fn)` | критичные операции | блок параллельных вызовов |
| `cached(key, fn)` | profiles, branches | 5-мин кеш |
| `setupBack(fn)` | каждый экран | кнопка ← в шапке |
| `setScreen(html)` | переходы | полная замена DOM |
| `toast(msg, type)` | уведомления | success/error |
| `loading(msg)` | тяжёлые запросы | показать спиннер |
| `todayStr()` | даты | 'YYYY-MM-DD' |
| `fmtDate(d)` | отображение | '04.06.2026' |
| `fmt(n)` | деньги | '1 234 567' |

---

## 11. Технический долг

| | Проблема | Приоритет |
|--|---------|-----------|
| 🔴 | `calcSalary`: payout_type='percent' добавляет % как сумму | До утверждения первых выплат |
| 🟡 | `group_trainer_payouts.group_id` = `trainer_groups.id` — при Art Swim каждый тренер имеет свой набор клиентов, totalPaid может быть 0 у второго тренера | Обсудить модель данных |
| 🟡 | Нет напоминания координатору об утверждении ЗП | При росте команды |
| 🟡 | CLAUDE.md устаревает — обновлять при крупных изменениях | Регулярно |
| 🟢 | app.js ~5500 строк — монолит | При рефакторинге |

---

## 12. Доступы

| Сервис | Данные |
|--------|--------|
| GitHub | https://github.com/VladislavVlKl/aqua-desk |
| Supabase | Project ID: `nkwfvuhtpaoxsaczwsrg`, eu-central-1 |
| Деплой | GitHub Pages → https://vladislavvlkl.github.io/aqua-desk/ |
| Telegram бот | @chekhov_aqua_department |
