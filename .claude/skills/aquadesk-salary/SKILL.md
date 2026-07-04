---
name: aquadesk-salary
description: >
  Проверка и расчёт зарплаты тренеров в AquaDesk. Используй когда нужно
  проверить формулы расчёта, посчитать ЗП за период, сверить тарифы,
  изменить ставки, или разобраться почему зарплата посчиталась неправильно.
  Триггеры: "посчитай зарплату", "проверь расчёт зп", "сколько должен получить тренер",
  "тарифы", "ставки", "salary", "зп за месяц", "расчёт дежурств".
---

# AquaDesk Salary Check

Источник истины по формулам — `frontend/js/db.salary.js` (`calcSalary`, `calcChildGroupPayroll`).
Тарифы — `frontend/js/config.js` (объект `RATES`). При изменении тарифов — запусти
`/aquadesk-deploy`, чтобы изменения попали на GitHub Pages.

## Тарифы (RATES в config.js)

```
ПТ:  Кат.1 = 85 000 | Кат.2 = 110 000 | Кат.3 = 130 000 сум/тренировка
Дежурство: 14 000 сум/час
Взрослые группы (по явке): ≤3 чел = 110 000 | ≤6 = 120 000 | 7+ = 130 000 за занятие
Детские группы: авто-расчёт от оплат (пул = вал/2, арт-свим — своя модель), fallback ставки 75 000/занятие
Разовые (drop-in) и пробные (trial): по ставке категории 1/2/3
```

## Слагаемые ЗП тренера за месяц (calcSalary)

```
итого = ПТ + разовые + пробные + ПТ-замены + дежурства
      + детские группы (авто) + взрослые группы (по явке) + групповые замены
      + премия − штраф   (month_adjustments, строк может быть несколько — по филиалам)
```

Правила включения workout в ПТ:
- `pending_confirmation = false` (неподтверждённые замены не считаются)
- долг (`is_debt = true`) считается ТОЛЬКО после подтверждения (`debt_confirmed_at IS NOT NULL`)
- замены с `substitute_for IS NOT NULL AND substitute_rate IS NOT NULL` идут отдельной строкой
  (сумма `substitute_rate`), в категории не попадают
- разовые: `is_drop_in = true`, ставка по `drop_in_category` (fallback 1)
- иначе ставка по `category_at_moment`

## Границы месяца — ВАЖНО (часовой пояс Ташкент, UTC+5)

- timestamp-поля (`workouts.workout_date`, `duties.start_time`, `trial_sessions.session_date`):
  месяц M = `[ (M-1)-последний-день 19:00Z , M-последний-день 19:00Z )`.
  Июнь 2026: `>= '2026-05-31T19:00:00Z' AND < '2026-06-30T19:00:00Z'`.
- date-поля (`group_sessions.session_date`, `group_substitutions.session_date`, `group_payments.month`):
  `>= 'YYYY-MM-01' AND < '1-е число СЛЕДУЮЩЕГО месяца'`. НЕ используй
  `new Date(y,m,1).toISOString().slice(0,10)` — из-за UTC-сдвига теряется последний день
  месяца (баг, исправленный в июле 2026; во фронте используй `monthFirstDayStr()` из config.js).

## Проверка через базу (MCP `execute_sql`, project_id `nkwfvuhtpaoxsaczwsrg`)

**ПТ + разовые за месяц (пример: июнь 2026):**
```sql
SELECT w.trainer_id,
  SUM(CASE WHEN NOT w.is_drop_in AND NOT (w.is_debt AND w.debt_confirmed_at IS NULL)
    THEN CASE w.category_at_moment WHEN 1 THEN 85000 WHEN 2 THEN 110000 WHEN 3 THEN 130000 END
    ELSE 0 END) AS pt_sum,
  SUM(CASE WHEN w.is_drop_in
    THEN CASE COALESCE(w.drop_in_category,1) WHEN 1 THEN 85000 WHEN 2 THEN 110000 WHEN 3 THEN 130000 END
    ELSE 0 END) AS dropin_sum
FROM workouts w
WHERE w.workout_date >= '2026-05-31T19:00:00Z' AND w.workout_date < '2026-06-30T19:00:00Z'
  AND w.pending_confirmation = false AND w.substitute_for IS NULL
GROUP BY 1;
```

**ПТ-замены (отдельно):** те же даты, `substitute_for IS NOT NULL AND substitute_rate IS NOT NULL`,
`SUM(substitute_rate)`.

**Дежурства:**
```sql
SELECT trainer_id,
  ROUND(SUM(EXTRACT(EPOCH FROM (end_time-start_time))/3600)::numeric,2) AS hours,
  ROUND(SUM(EXTRACT(EPOCH FROM (end_time-start_time))/3600)*14000) AS duty_sum
FROM duties
WHERE start_time >= '2026-05-31T19:00:00Z' AND start_time < '2026-06-30T19:00:00Z'
  AND end_time IS NOT NULL
GROUP BY 1;
```

**Взрослые группы (по явке):**
```sql
SELECT gs.trainer_id,
  SUM(CASE WHEN COALESCE(gs.headcount,0)<=3 THEN 110000
           WHEN gs.headcount<=6 THEN 120000 ELSE 130000 END) AS adult_sum
FROM group_sessions gs JOIN group_types gt ON gt.id = gs.group_type_id
WHERE gt.billing_model = 'headcount'
  AND gs.session_date >= '2026-06-01' AND gs.session_date < '2026-07-01'
GROUP BY 1;
```

**Пробные:** `trial_sessions` (`trainer_id`, `category`), timestamp-границы, ставки как у ПТ.
**Премии/штрафы:** `month_adjustments` (`year`, `month`, `bonus`, `penalty`, `branch`) — суммировать по тренеру.
**Групповые замены:** `group_substitutions` (`status='approved'`, `substitute_trainer_id`, `rate`),
date-границы. Нюанс: если заменяющий сам отметил взрослое занятие той же группы в тот же день —
замена не платится (фильтр в calcSalary).

## Детские группы (авто-расчёт)

Формула — `calcChildGroupPayroll` в db.salary.js, руками в SQL не воспроизводить, только сверять:
- вал = оплаченные `group_payments` месяца (`paid = true`), пул = вал/2 — лимит выплат
- ставочники (`rate_type='flat'`): занятия × ставка (история ставок — `trainer_group_rate_history`)
- процентники: арт-свим — доля остатка пула; не-арт — % от вала (по датам оплат)
- руководитель: `leader_fee_percent` от пула (арт) или от вала (не-арт)
- премии/штрафы групп — `group_trainer_payouts`
- «суша+вода» = ДВЕ записи в `group_sessions` на одну дату — это нормально и оплачивается дважды

## Что проверить при расхождении

1. Категорию на момент тренировки: `workouts.category_at_moment` (не текущую `clients.category`)
2. Замены: `substitute_for` / `substitute_rate` / `pending_confirmation`
3. Долги: `is_debt` без `debt_confirmed_at` — не оплачиваются
4. Дубли членства: две строки `trainer_groups` одного тренера в одном `group_instance_id`
   → занятия посчитаются дважды (известная проблема, см. отчёт июля 2026)
5. Последний день месяца: занятия групп 30/31 числа должны попадать в месяц
6. Неоплаченные `group_payments` (`paid=false`) — не входят в вал, процентники получают меньше
