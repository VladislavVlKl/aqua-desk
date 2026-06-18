# telegram-auth (Edge Function)

Проверяет `initData` Telegram Web App и выдаёт сессию Supabase Auth.

## Логика
1. Валидирует подпись `initData` через HMAC-SHA256 с ключом `WebAppData` + `BOT_TOKEN`
   (стандартная схема Telegram). Невалидно → `401`.
2. По `tg_id` формирует синтетический аккаунт `tg_<id>@aquadesk.internal`
   с детерминированным паролем `SHA-256(tgId:botToken)`.
3. Логинит; если пользователя нет — создаёт через service-role и логинит повторно.
4. Возвращает `{ session, tg_id }`.

## Конфигурация
- **verify_jwt: `false`** — публичный эндпоинт (вызывается до наличия сессии).
- Секреты (Supabase → Edge Functions → Secrets), **в коде их нет**:
  - `BOT_TOKEN` — токен Telegram-бота
  - `SUPABASE_URL`
  - `SUPABASE_SERVICE_ROLE_KEY`
  - `SUPABASE_ANON_KEY`

## Деплой
```bash
supabase functions deploy telegram-auth --no-verify-jwt
```

## Снимок версии
`index.ts` — точная копия задеплоенной **version 4** (ACTIVE), снято из Supabase 2026-06-18.
При расхождении источник правды — задеплоенная версия в Supabase.
