// process-queue — обработчик очереди Telegram-пушей.
// Запускается pg_cron'ом (каждую минуту) через pg_net; см. миграцию
// 20260907_push_pg_cron_delivery.sql. Заменяет ненадёжный GitHub Actions крон.
//
// Что делает:
//  1) Отправляет в Telegram-чат события из вайтлиста (по «семье» rule_key —
//     части до первого ':', чтобы ловить и динамические ключи вида
//     reception_eod:<филиал>:<дата>). Не входящие в вайтлист (напр. sub_expiring,
//     system) уводит в 'skipped' → они остаются только в колокольчике приложения.
//  2) Хранит реальный текст ошибки Telegram и делает ретраи (до MAX_ATTEMPTS).
//
// Колокольчик в приложении читает notifications_queue напрямую и от этого
// воркера не зависит — он показывает все события независимо от статуса.
import { createClient } from "jsr:@supabase/supabase-js@2";

// «Семьи» rule_key, разрешённые к отправке в чат (часть до первого ':').
const WHITELIST = new Set([
  "substitution",         // ПТ-замена → тренеру Б
  "substitution_approve", // замена в группе → апруверам
  "client_transfer",      // передача клиента → принимающему
  "cat_recalc_approved",  // пересчёт категории одобрен → тренеру
  "cat_recalc_rejected",  // пересчёт категории отклонён → тренеру
  "reception_reject",     // ресепшн отклонил списание → тренеру
  "reception_eod",        // «конец дня» ресепшену (ключ reception_eod:<филиал>:<дата>)
  "pt_mismatch",          // расхождение остатка ПТ с 1С → тренеру
]);
const family = (rk: string | null) => (rk || "").split(":")[0];
const MAX_ATTEMPTS = 5;
const BATCH = 100;

const BOT = Deno.env.get("BOT_TOKEN");
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function tg(chatId: number, text: string): Promise<{ ok: boolean; desc?: string }> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const d = await r.json();
    return { ok: !!d.ok, desc: d.description };
  } catch (e) {
    return { ok: false, desc: `fetch error: ${(e as Error).message}` };
  }
}

Deno.serve(async () => {
  if (!BOT) {
    return new Response(JSON.stringify({ error: "BOT_TOKEN not set" }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }
  const nowIso = new Date().toISOString();

  // Наступившие pending-строки, ещё не исчерпавшие попытки.
  const { data: rows, error } = await sb.from("notifications_queue")
    .select("id,recipient_tg_id,message,attempts,rule_key")
    .eq("status", "pending")
    .lte("scheduled_for", nowIso)
    .lt("attempts", MAX_ATTEMPTS)
    .order("scheduled_for", { ascending: true })
    .limit(BATCH);

  if (error) {
    return new Response(JSON.stringify({ error: error.message }), {
      status: 500,
      headers: { "Content-Type": "application/json" },
    });
  }

  // Разделяем по «семье»: в чат — вайтлист, остальное — skipped (только колокольчик).
  const toSend = (rows ?? []).filter((n) => WHITELIST.has(family(n.rule_key)));
  const skipIds = (rows ?? []).filter((n) => !WHITELIST.has(family(n.rule_key))).map((n) => n.id);
  if (skipIds.length) {
    await sb.from("notifications_queue")
      .update({ status: "skipped", error_text: "app-only (не в чат-вайтлисте)" })
      .in("id", skipIds);
  }

  let sent = 0, failed = 0, retry = 0;
  for (const n of toSend) {
    const res = await tg(n.recipient_tg_id, n.message);
    if (res.ok) {
      await sb.from("notifications_queue")
        .update({ status: "sent", sent_at: new Date().toISOString(), error_text: null })
        .eq("id", n.id);
      sent++;
    } else {
      const attempts = (n.attempts ?? 0) + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await sb.from("notifications_queue")
        .update({
          status: exhausted ? "failed" : "pending",
          attempts,
          error_text: res.desc ?? "Telegram delivery failed",
        })
        .eq("id", n.id);
      exhausted ? failed++ : retry++;
    }
  }

  return new Response(
    JSON.stringify({ processed: toSend.length, skipped: skipIds.length, sent, failed, retry, at: nowIso }),
    { headers: { "Content-Type": "application/json" } },
  );
});
