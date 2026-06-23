---
name: aquadesk-deploy
description: >
  Безопасный деплой AquaDesk в GitHub Pages. Используй этот скилл когда нужно
  задеплоить изменения, запушить в main, сделать коммит, или проверить что код
  не сломан перед пушем. Триггеры: "задеплой", "запушь", "пушь в main",
  "сделай коммит и задеплой", "деплой", "deploy", "push".
---

# AquaDesk Deploy

Ты деплоишь Telegram Web App на GitHub Pages через пуш в ветку `main`.
Рабочая директория: `/Users/vladislavklimov/aqua-desk`

## Шаги (всегда в таком порядке)

### 1. Проверка синтаксиса JS

Прогони `node --check` по всем JS-файлам:

```bash
# Браузерные JS в frontend/js/ + node-джобы в backend/jobs/
for f in frontend/js/app.js frontend/js/app.trainer.js frontend/js/app.admin.js frontend/js/app.admin-ops.js frontend/js/app.exec.js frontend/js/app.shared.js frontend/js/db.core.js frontend/js/db.clients.js frontend/js/db.groups.js frontend/js/db.schedule.js frontend/js/db.analytics.js frontend/js/db.ops.js frontend/js/db.salary.js frontend/js/db.misc.js frontend/js/config.js frontend/js/export.js frontend/js/tutorial.js frontend/js/notifications-ui.js backend/jobs/remind.js backend/jobs/process-queue.js; do
  node --check /Users/vladislavklimov/aqua-desk/$f && echo "✅ $f OK" || echo "❌ $f ОШИБКА"
done
```

Если хоть один файл упал — **стоп**, покажи ошибку, не продолжай.

### 2. Показ изменений

```bash
git -C /Users/vladislavklimov/aqua-desk diff --stat HEAD
```

Выведи краткую сводку: что изменилось, сколько строк. Дай пользователю понять что именно идёт в коммит.

### 3. Коммит и пуш

Спроси у пользователя сообщение коммита — или предложи своё на русском, описывающее суть изменений.

```bash
cd /Users/vladislavklimov/aqua-desk && git add -A && git commit -m "<сообщение>" && git push origin main
```

### 4. Подтверждение

После успешного пуша скажи: "Задеплоено ✅ — GitHub Pages обновится через ~1 минуту."
Если пуш упал — покажи ошибку и предложи что делать.

## Важно

- Никогда не пушь если синтаксис сломан
- Не используй `--force` если пользователь явно не попросил
- Коммит-сообщения пиши по-русски, кратко и по делу
