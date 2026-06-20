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

## Тарифы (из config.js)

```
Персональные тренировки:
  Категория 1 = 85 000 сум / тренировка
  Категория 2 = 110 000 сум / тренировка
  Категория 3 = 130 000 сум / тренировка

Дежурства:
  14 000 сум / час
```

## Формулы расчёта

**ЗП за ПТ:**
```
сумма = количество_тренировок_кат1 × 85000
      + количество_тренировок_кат2 × 110000
      + количество_тренировок_кат3 × 130000
```

**ЗП за дежурства:**
```
сумма = Σ (end_time - start_time в часах) × 14000
```

**Итого:**
```
итого = зп_пт + зп_дежурства
```

## Как проверить расчёт через базу

Используй MCP `execute_sql` с project_id `nkwfvuhtpaoxsaczwsrg`.

**ПТ тренера за период:**
```sql
SELECT
  w.type,
  COUNT(*) as count,
  CASE w.type
    WHEN 'pt' THEN COUNT(*) * 85000
    WHEN 'pt2' THEN COUNT(*) * 110000
    WHEN 'pt3' THEN COUNT(*) * 130000
    ELSE 0
  END as sum
FROM workouts w
WHERE w.trainer_id = '<id тренера>'
  AND w.date >= '<дата начала>'
  AND w.date <= '<дата конца>'
GROUP BY w.type;
```

**Дежурства тренера за период:**
```sql
SELECT
  id,
  start_time,
  end_time,
  branch,
  EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 as hours,
  ROUND(EXTRACT(EPOCH FROM (end_time - start_time)) / 3600 * 14000) as sum
FROM duties
WHERE trainer_id = '<id тренера>'
  AND start_time >= '<дата начала>'
  AND start_time <= '<дата конца>';
```

## Что делать при расхождении

1. Сверь категории клиентов (таблица `clients`, поле `category`)
2. Проверь не учтены ли замены (поле `substitute_trainer_id` в `workouts`)
3. Убедись что тип тренировки (`type`) правильно маппится на категорию
4. Для групп — отдельная логика в `group_trainer_payouts`

## Изменение тарифов

Тарифы хранятся в `/Users/vladislavklimov/aqua-desk/config.js`.
При изменении тарифов — обязательно запусти `/aquadesk-deploy` чтобы изменения
вступили в силу на GitHub Pages.
