// schedule-reminder — точечные напоминания тренерам по их расписанию (schedule_slots).
// Отдельно от daily-reminder: шлём только тренерам из notification_rules.recipients
// (rule_key = 'schedule_reminder'), список ведёт координатор.
// pg_cron (job schedule-reminder-15m) дёргает функцию каждые 15 минут.
//   1) Вечером (schedule.evening_hour по Ташкенту) — расписание на завтра.
//   2) За schedule.before_min минут до начала — напоминание о каждом занятии.
// Какие типы слать — schedule.types {"<id тренера>": ["duty","group","pt"]}; нет записи → все три.
// Сообщения кладём в notifications_queue (family schedule_reminder) — доставляет process-queue,
// с кнопкой мини-аппа «Открыть расписание». Повторы гасит notif_dedup (PK rule_key).
import { createClient } from "jsr:@supabase/supabase-js@2";

const sb = createClient(
  Deno.env.get("SUPABASE_URL")!,
  Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
);
const TZ_OFFSET_MIN = 5 * 60; // Ташкент, UTC+5, без перехода на летнее время
const DOW = ["Пн", "Вт", "Ср", "Чт", "Пт", "Сб", "Вс"];
const MONTHS = ["янв", "фев", "мар", "апр", "мая", "июн", "июл", "авг", "сен", "окт", "ноя", "дек"];

type Rule = {
  active: boolean;
  recipients: number[] | null;
  schedule: { evening_hour?: number; before_min?: number; types?: Record<string, string[]>; app_url?: string } | null;
};
type Slot = {
  id: string; trainer_id: number; branch: string | null; slot_type: "pt" | "group" | "duty";
  start_time: string; end_time: string | null;
  clients: { fio: string; balance: number | null; is_archived: boolean | null } | null;
  group_types: { name: string } | null;
};

const esc = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const hm = (t: string | null) => (t || "").slice(0, 5);
// Понедельник = 0 — как schedule_slots.day_of_week
const dowOf = (date: string) => (new Date(date + "T00:00:00Z").getUTCDay() + 6) % 7;
const fmtDate = (date: string) => {
  const d = new Date(date + "T00:00:00Z");
  return `${DOW[dowOf(date)]}, ${d.getUTCDate()} ${MONTHS[d.getUTCMonth()]}`;
};

// Слоты тренеров на дату: регулярные по дню недели + разовые на дату, минус отмены.
// ПТ — как в экране расписания: только клиенты с остатком и не в архиве.
async function slotsFor(trainerIds: number[], date: string): Promise<Slot[]> {
  const { data, error } = await sb.from("schedule_slots")
    .select("id,trainer_id,branch,slot_type,start_time,end_time,clients(fio,balance,is_archived),group_types(name)")
    .eq("active", true).in("trainer_id", trainerIds)
    .or(`specific_date.eq.${date},and(specific_date.is.null,day_of_week.eq.${dowOf(date)})`)
    .order("start_time");
  if (error) throw error;
  const slots = (data || []) as unknown as Slot[];
  if (!slots.length) return [];
  const { data: canc } = await sb.from("schedule_cancellations")
    .select("slot_id").eq("cancel_date", date).in("slot_id", slots.map((s) => s.id));
  const cancelled = new Set((canc || []).map((c) => c.slot_id));
  return slots.filter((s) => {
    if (cancelled.has(s.id)) return false;
    if (s.slot_type === "pt") return !!s.clients && !s.clients.is_archived && (s.clients.balance || 0) > 0;
    return true;
  });
}

function line(s: Slot): string {
  const br = s.branch ? ` · ${esc(s.branch)}` : "";
  if (s.slot_type === "duty") return `🛎 ${hm(s.start_time)}–${hm(s.end_time)} Дежурство${br}`;
  if (s.slot_type === "group") return `👥 ${hm(s.start_time)} ${esc(s.group_types?.name || "Группа")}${br}`;
  return `🏊 ${hm(s.start_time)} ПТ — ${esc(s.clients?.fio || "клиент")}${br}`;
}

// Атомарная резервация ключа: true = ещё не слали, можно слать.
async function reserve(key: string): Promise<boolean> {
  const { error } = await sb.from("notif_dedup").insert({ rule_key: key });
  return !error;
}

async function enqueue(tr: { fio: string; tg_id: number }, msg: string, ruleKey: string, appUrl: string) {
  const { error } = await sb.from("notifications_queue").insert({
    recipient_tg_id: tr.tg_id, recipient_name: tr.fio, message: msg,
    scheduled_for: new Date().toISOString(), status: "pending", rule_key: ruleKey,
    reply_markup: appUrl ? { inline_keyboard: [[{ text: "📅 Открыть расписание", web_app: { url: appUrl } }]] } : null,
  });
  if (error) console.error("[schedule_reminder] enqueue", tr.fio, error.message);
  else console.log("[schedule_reminder] queued", ruleKey, "→", tr.fio);
}

Deno.serve(async () => {
  const { data: rule } = await sb.from("notification_rules")
    .select("active,recipients,schedule").eq("rule_key", "schedule_reminder").maybeSingle<Rule>();
  const ids = rule?.recipients || [];
  if (!rule?.active || !ids.length) {
    return Response.json({ ok: true, skipped: "inactive or no recipients" });
  }
  const cfg = rule.schedule || {};
  const eveningHour = cfg.evening_hour ?? 20;
  const beforeMin = cfg.before_min ?? 120;
  const types = cfg.types || {};
  const wants = (tid: number, t: string) => !types[tid] || types[tid].includes(t);
  const appUrl = cfg.app_url || "";

  const { data: trs } = await sb.from("profiles").select("id,fio,tg_id")
    .in("id", ids).not("tg_id", "is", null).not("is_archived", "is", true);
  const trainers = new Map((trs || []).map((t) => [t.id as number, t as { id: number; fio: string; tg_id: number }]));
  if (!trainers.size) return Response.json({ ok: true, skipped: "no tg_id" });
  const tIds = [...trainers.keys()];

  // «Стенное» время Ташкента: UTC-поля сдвинутой даты = местные дата/время
  const local = new Date(Date.now() + TZ_OFFSET_MIN * 60000);
  const today = local.toISOString().slice(0, 10);
  const nowMin = local.getUTCHours() * 60 + local.getUTCMinutes();
  const tomorrow = new Date(local.getTime() + 86400000).toISOString().slice(0, 10);
  let queued = 0;

  // 1) Вечерняя сводка на завтра
  if (local.getUTCHours() === eveningHour) {
    const slots = await slotsFor(tIds, tomorrow);
    for (const tr of trainers.values()) {
      const mine = slots.filter((s) => s.trainer_id === tr.id && wants(tr.id, s.slot_type));
      if (!mine.length) continue;
      if (!(await reserve(`schedule_reminder:eve:${tr.id}:${tomorrow}`))) continue;
      const msg = `🔔 <b>Завтра, ${fmtDate(tomorrow)}</b> — ваше расписание:\n\n` +
        mine.map(line).join("\n") +
        `\n\nПриходите вовремя 🙏 Если в расписании ошибка — исправьте его в приложении.`;
      await enqueue(tr, msg, `schedule_reminder:eve:${tomorrow}`, appUrl);
      queued++;
    }
  }

  // 2) Напоминание незадолго до начала (окно (0, beforeMin] минут; что попало в окно — шлём один раз)
  const slots = await slotsFor(tIds, today);
  for (const tr of trainers.values()) {
    const due: Slot[] = [];
    for (const s of slots) {
      if (s.trainer_id !== tr.id) continue;
      if (!wants(tr.id, s.slot_type)) continue;
      const [h, m] = s.start_time.split(":").map(Number);
      const left = h * 60 + m - nowMin;
      if (left <= 0 || left > beforeMin) continue;
      if (await reserve(`schedule_reminder:pre:${s.id}:${today}`)) due.push(s);
    }
    if (!due.length) continue;
    const msg = `⏰ <b>Скоро начало</b> — не опаздывайте:\n\n` + due.map(line).join("\n");
    await enqueue(tr, msg, `schedule_reminder:pre:${today}`, appUrl);
    queued++;
  }

  return Response.json({ ok: true, today, nowMin, queued });
});
