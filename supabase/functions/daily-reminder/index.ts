// daily-reminder — автоматические правила уведомлений, порт backend/jobs/remind.js.
// Запускается pg_cron'ом каждый час в :00 UTC (job daily-reminder-hourly), а не
// ненадёжным GitHub Actions кроном (тот пропускал часы блоками по 5+ ч, из-за чего
// часовые гейты 9:00/22:00 и окна опросника промахивались). Логика 1:1 с remind.js;
// тот оставлен ручным аварийным каналом (workflow_dispatch).
import { createClient } from "jsr:@supabase/supabase-js@2";

const BOT = Deno.env.get("BOT_TOKEN");
const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);

async function tg(chatId: number, text: string): Promise<boolean> {
  try {
    const r = await fetch(`https://api.telegram.org/bot${BOT}/sendMessage`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: "HTML" }),
    });
    const d = await r.json();
    if (!d.ok) console.error("TG error for", chatId, ":", d.description);
    return !!d.ok;
  } catch (e) {
    console.error("TG error:", (e as Error).message);
    return false;
  }
}

async function isActive(key: string): Promise<boolean> {
  const { data } = await sb.from("notification_rules").select("active").eq("rule_key", key).single();
  return data?.active === true;
}

// Правило 1: Незакрытые занятия в 22:00
async function ruleOpenSessions(dow: number, today: string) {
  if (!(await isActive("open_sessions_2200"))) return console.log("[open_sessions] disabled");

  const { data: trainers } = await sb.from("profiles")
    .select("id,fio,tg_id")
    .in("role", ["trainer", "senior_trainer"])
    .not("tg_id", "is", null);

  console.log("[open_sessions] trainers:", trainers?.length || 0);
  let sent = 0;

  for (const tr of trainers || []) {
    const { data: slots } = await sb.from("schedule_slots")
      .select("id,slot_type,start_time")
      .eq("trainer_id", tr.id)
      .eq("day_of_week", dow)
      .eq("active", true)
      .in("slot_type", ["pt", "group"]);

    if (!slots?.length) continue;

    const slotIds = slots.map((s) => s.id);
    const { data: confs } = await sb.from("schedule_confirmations")
      .select("slot_id")
      .in("slot_id", slotIds)
      .eq("session_date", today);

    const done = new Set((confs || []).map((c) => c.slot_id));
    const pend = slots.filter((s) => !done.has(s.id));
    if (!pend.length) continue;

    const lines = pend.map((s) =>
      "• " + s.start_time.slice(0, 5) + " — " + (s.slot_type === "pt" ? "Персональная" : "Групповое")
    ).join("\n");

    const msg = "⚠️ <b>Незакрытые занятия</b>\n\n" + lines + "\n\nПодтвердите или отмените в AquaDesk.";
    if (await tg(tr.tg_id, msg)) { console.log("[open_sessions] sent to:", tr.fio); sent++; }
  }
  console.log("[open_sessions] done. Sent:", sent);
}

// Правило 2: Истекающие абонементы
async function ruleSubExpiring() {
  if (!(await isActive("sub_expiring_7d"))) return console.log("[sub_expiring] disabled");

  const today = new Date().toISOString().slice(0, 10);
  const in7 = new Date(); in7.setDate(in7.getDate() + 7);
  const in7str = in7.toISOString().slice(0, 10);

  const { data: clients } = await sb.from("clients")
    .select("fio,subscription_end,balance,profiles!trainer_id(fio,tg_id)")
    .gt("balance", 0)
    .eq("is_archived", false)
    .gte("subscription_end", today)
    .lte("subscription_end", in7str);

  console.log("[sub_expiring] expiring clients:", clients?.length || 0);
  for (const c of clients || []) {
    const tgId = (c.profiles as { tg_id?: number } | null)?.tg_id; if (!tgId) continue;
    const days = Math.ceil((+new Date(c.subscription_end) - Date.now()) / 86400000);
    const msg = "⏰ <b>Истекает абонемент</b>\n\nКлиент: <b>" + c.fio + "</b>\nОсталось: " + days + " дн.\n\nНапомните о продлении.";
    if (await tg(tgId, msg)) console.log("[sub_expiring] sent for:", c.fio);
  }
}

// Правило 3: Долг > 3 дней
async function ruleDebtOverdue() {
  if (!(await isActive("debt_overdue_3d"))) return console.log("[debt_overdue] disabled");

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 3);
  const { data: workouts } = await sb.from("workouts")
    .select("workout_date,clients(fio),profiles!trainer_id(fio,tg_id)")
    .eq("is_debt", true)
    .is("debt_confirmed_at", null)
    .lt("created_at", cutoff.toISOString());

  console.log("[debt_overdue] count:", workouts?.length || 0);
  const byTrainer: Record<string, { name?: string; items: string[] }> = {};
  for (const w of workouts || []) {
    const p = w.profiles as { fio?: string; tg_id?: number } | null;
    const tgId = p?.tg_id; if (!tgId) continue;
    if (!byTrainer[tgId]) byTrainer[tgId] = { name: p?.fio, items: [] };
    byTrainer[tgId].items.push((w.clients as { fio?: string } | null)?.fio + " (" + new Date(w.workout_date).toLocaleDateString("ru-RU") + ")");
  }
  for (const [tgId, data] of Object.entries(byTrainer)) {
    const msg = "❌ <b>Долг не подтверждён (3+ дня)</b>\n\n" + data.items.map((i) => "• " + i).join("\n") + "\n\nПодтвердите оплату в разделе Отчёт.";
    if (await tg(parseInt(tgId), msg)) console.log("[debt_overdue] sent to:", data.name);
  }
}

// Правило 4: Нет активности 5 дней
async function ruleInactive() {
  if (!(await isActive("trainer_inactive_5d"))) return console.log("[inactive] disabled");

  const { data: admins } = await sb.from("profiles").select("tg_id,fio").eq("role", "admin").not("tg_id", "is", null);
  if (!admins?.length) return;

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate() - 5);
  const { data: trainers } = await sb.from("profiles").select("id,fio").in("role", ["trainer", "senior_trainer"]);

  const inactive: string[] = [];
  for (const tr of trainers || []) {
    const { data: ws } = await sb.from("workouts").select("id").eq("trainer_id", tr.id).gte("workout_date", cutoff.toISOString()).limit(1);
    if (!ws?.length) inactive.push(tr.fio);
  }
  if (!inactive.length) return;

  const msg = "💤 <b>Нет активности 5+ дней</b>\n\n" + inactive.map((f) => "• " + f).join("\n");
  for (const a of admins) { if (await tg(a.tg_id, msg)) console.log("[inactive] sent to admin:", a.fio); }
}

// Правило 5: Опросник сверки списаний (филиал Chekhov Moms).
// Окна по Ташкенту [начало, конец), одно срабатывание за окно. Дедуп на
// тренера+день+окно — атомарная резервация rule_key в notif_dedup (PK).
// Прошедшим (answered>=total) не шлём. Держать синхронно с backend/jobs/remind.js.
const SEQ_SURVEY_JOB = {
  branch: "Chekhov Moms",
  round: "2026-09-verify",
  windows: {
    "2026-09-10": [[8, 12], [12, 20]],
    "2026-09-11": [[8, 12]],
    "2026-09-12": [[8, 12]],
  } as Record<string, number[][]>,
};
async function ruleSeqSurvey(today: string, hourTashkent: number) {
  const wins = SEQ_SURVEY_JOB.windows[today];
  if (!wins) return;
  const win = wins.find(([a, b]) => hourTashkent >= a && hourTashkent < b);
  if (!win) return;
  const winTag = win[0] + "-" + win[1];

  const { data: trainers } = await sb.from("profiles")
    .select("id,fio,tg_id,branches")
    .in("role", ["trainer", "senior_trainer"])
    .not("tg_id", "is", null);
  const moms = (trainers || []).filter((t) => Array.isArray(t.branches) && t.branches.includes(SEQ_SURVEY_JOB.branch));
  console.log("[seq_survey] window", today, winTag, "| Moms trainers:", moms.length);
  let sent = 0, dedup = 0;

  for (const tr of moms) {
    // Сначала считаем прогресс — прошедшим (answered>=total) не шлём вовсе.
    const { data: clients } = await sb.from("clients").select("id")
      .eq("trainer_id", tr.id).eq("is_archived", false);
    const ids = (clients || []).map((c) => c.id);
    if (!ids.length) continue;
    const { data: subs } = await sb.from("subscriptions").select("client_id")
      .eq("is_active", true).gt("initial_balance", 0).in("client_id", ids);
    const total = new Set((subs || []).map((s) => s.client_id)).size;
    if (!total) continue;
    const { count: answered } = await sb.from("pt_sequence_survey")
      .select("id", { count: "exact", head: true })
      .eq("trainer_id", tr.id).eq("round", SEQ_SURVEY_JOB.round);
    if ((answered || 0) >= total) continue;

    // Атомарная резервация окна: успешный INSERT = «шлю»; unique_violation (или сбой) = «уже слали» → пропуск.
    // Надёжнее select-потом-insert (тот двоил пуши при транзиентной ошибке чтения между часовыми прогонами).
    const ruleKey = "seqsurvey:" + SEQ_SURVEY_JOB.round + ":" + today + ":" + winTag + ":" + tr.id;
    const { error: resErr } = await sb.from("notif_dedup").insert({ rule_key: ruleKey });
    if (resErr) { dedup++; continue; }

    const msg = "📋 <b>Повторная сверка списаний</b>\n\nМы поправили остатки по прошлой сверке — проверьте в приложении, что теперь всё совпадает. "
      + (answered ? ("Осталось " + (total - answered) + " из " + total) : (total + " клиентов"))
      + ". Займёт ~5 минут. Срок — до конца 12 сентября.";
    if (await tg(tr.tg_id, msg)) {
      await sb.from("notifications_queue").insert({
        recipient_tg_id: tr.tg_id, recipient_name: tr.fio, message: msg,
        scheduled_for: new Date().toISOString(), sent_at: new Date().toISOString(),
        status: "sent", rule_key: ruleKey,
      });
      sent++; console.log("[seq_survey] sent to:", tr.fio);
    }
  }
  console.log("[seq_survey] window done. sent:", sent, "| dedup-skip:", dedup);
}

Deno.serve(async () => {
  if (!BOT) {
    return new Response(JSON.stringify({ error: "BOT_TOKEN not set" }), {
      status: 500, headers: { "Content-Type": "application/json" },
    });
  }
  const now = new Date();
  const hourTashkent = (now.getUTCHours() + 5) % 24;
  const dow = (now.getUTCDay() + 6) % 7;
  const today = now.toISOString().slice(0, 10);

  console.log("=== AquaDesk Reminder ===", now.toISOString(), "| Tashkent hour:", hourTashkent);

  if (hourTashkent === 22) await ruleOpenSessions(dow, today);
  if (hourTashkent === 9) { await ruleSubExpiring(); await ruleDebtOverdue(); await ruleInactive(); }
  await ruleSeqSurvey(today, hourTashkent);

  console.log("=== Done ===");
  return new Response(JSON.stringify({ ok: true, hourTashkent, today }), {
    headers: { "Content-Type": "application/json" },
  });
});
