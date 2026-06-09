# Настройка Google Sheets интеграции

## Что нужно сделать один раз

### 1. Google Cloud — создать Service Account

1. Зайти на https://console.cloud.google.com
2. Создать проект (или выбрать существующий)
3. Включить **Google Sheets API**: APIs & Services → Library → Google Sheets API → Enable
4. Создать Service Account: APIs & Services → Credentials → Create Credentials → Service Account
   - Имя: `aquadesk-sheets`
   - Роль: не нужна (просто создать)
5. Открыть созданный Service Account → вкладка **Keys** → Add Key → JSON
6. Скачается файл `aquadesk-sheets-xxxx.json` — это и есть `GOOGLE_SERVICE_ACCOUNT_JSON`

### 2. Google Sheets — создать таблицу

1. Создать новую Google Таблицу
2. Создать 31 лист с именами `1`, `2`, ..., `31` (по числу месяца)
3. **Поделиться** таблицей с email из файла Service Account (`client_email`)
   - Права: **Редактор**
4. Скопировать ID таблицы из URL: `https://docs.google.com/spreadsheets/d/<SPREADSHEET_ID>/edit`

### 3. Supabase Secrets — добавить ключи

В Supabase Dashboard → Settings → Edge Functions → Secrets:

| Имя | Значение |
|-----|---------|
| `GOOGLE_SERVICE_ACCOUNT_JSON` | содержимое JSON файла (всё целиком) |
| `GOOGLE_SPREADSHEET_ID` | ID таблицы из URL |

### 4. Задеплоить Edge Function

```bash
# Через Supabase MCP или CLI:
supabase functions deploy sync-to-sheets
```

### 5. Supabase Database Webhook — автозапуск при записи тренировки

В Supabase Dashboard → Database → Webhooks → Create Webhook:
- **Name**: `workouts_to_sheets`
- **Table**: `workouts`
- **Events**: `INSERT`, `UPDATE`
- **URL**: `https://nkwfvuhtpaoxsaczwsrg.supabase.co/functions/v1/sync-to-sheets`
- **Headers**: `Authorization: Bearer <SUPABASE_ANON_KEY>`

---

## Как это работает после настройки

```
Тренер нажимает "Списать"
        ↓
workouts таблица: INSERT
        ↓
Database Webhook автоматически вызывает sync-to-sheets
        ↓
Edge Function читает все тренировки за этот день
        ↓
Обновляет лист "9" (или "15" и т.д.) в Google Таблице
        ↓
Ресепшн видит обновление в реальном времени
```

## Ручной вызов (для тестирования)

```
GET https://nkwfvuhtpaoxsaczwsrg.supabase.co/functions/v1/sync-to-sheets?date=2026-06-09
```

## Структура каждого листа

| Время | Клиент | Тренер | Кат. | Тип | Филиал |
|-------|--------|--------|------|-----|--------|
| 09:00 | Иванова Анна | Руднев | Кат.2 | ПТ | Chekhov Light |
| 10:30 | Петров Иван | Кротов | Кат.1 | ПТ | Chekhov Light |
