// process-queue — обработчик очереди Telegram-пушей.
// Запускается pg_cron'ом (каждую минуту) через pg_net; см. миграцию
// 20260907_push_pg_cron_delivery.sql. Заменяет ненадёжный GitHub Actions крон.
//
// Что делает:
//  1) Отправляет в Telegram-чат ТОЛЬКО «замены» (вайтлист rule_key ниже).
//     Прочие события пока приостановлены — их ставим в 'skipped', чтобы не
//     копились и при подключении позже не выстрелили задним числом.
//  2) Хранит реальный текст ошибки Telegram и делает ретраи (до MAX_ATTEMPTS).
//
// Колокольчик в приложении читает notifications_queue напрямую и от этого
// воркера не зависит — он показывает все события независимо от статуса.
import { createClient } from "jsr:@supabase/supabase-js@2";

// Событийные rule_key, разрешённые к отправке в чат. Расширять по мере надобности.
const WHITELIST = ["substitution", "substitution_approve"];
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

  // 1) Приостановленные события — увести из pending, чтобы не копились и не
  //    отправились задним числом при будущем расширении вайтлиста.
  await sb.from("notifications_queue")
    .update({ status: "skipped", error_text: "paused: rule not enabled" })
    .eq("status", "pending")
    .not("rule_key", "in", `(${WHITELIST.join(",")})`);

  // 2) К отправке: разрешённые, наступившие, не исчерпавшие попытки.
  const { data: rows, error } = await sb.from("notifications_queue")
    .select("id,recipient_tg_id,recipient_name,message,attempts")
    .eq("status", "pending")
    .in("rule_key", WHITELIST)
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

  let sent = 0, failed = 0, retry = 0;
  for (const n of rows ?? []) {
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
    JSON.stringify({ processed: rows?.length ?? 0, sent, failed, retry, at: nowIso }),
    { headers: { "Content-Type": "application/json" } },
  );
});
