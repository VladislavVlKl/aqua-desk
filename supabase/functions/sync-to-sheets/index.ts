// Edge Function: sync-to-sheets
// Обновляет лист Google Sheets для конкретного дня при записи тренировки.
// Вызывается через Supabase Database Webhook (INSERT/UPDATE на таблице workouts).
//
// Secrets (Supabase Dashboard → Settings → Edge Functions → Secrets):
//   GOOGLE_SERVICE_ACCOUNT_JSON  — содержимое JSON-файла Service Account
//   GOOGLE_SPREADSHEET_ID        — ID таблицы из URL: .../spreadsheets/d/<ID>/edit

import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_SERVICE_KEY = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
const SPREADSHEET_ID = Deno.env.get("GOOGLE_SPREADSHEET_ID")!;
const SA_JSON = Deno.env.get("GOOGLE_SERVICE_ACCOUNT_JSON")!;

const DAYS_RU = ["Вс", "Пн", "Вт", "Ср", "Чт", "Пт", "Сб"];
const MONTHS_RU = ["янв","фев","мар","апр","май","июн","июл","авг","сен","окт","ноя","дек"];

// ── Google Auth (Service Account → access_token) ─────────────────────────────
async function getGoogleToken(): Promise<string> {
  const sa = JSON.parse(SA_JSON);
  const now = Math.floor(Date.now() / 1000);
  const header = btoa(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = btoa(JSON.stringify({
    iss: sa.client_email,
    scope: "https://www.googleapis.com/auth/spreadsheets",
    aud: "https://oauth2.googleapis.com/token",
    iat: now,
    exp: now + 3600,
  }));

  // Подпись через Web Crypto API
  const pemKey = sa.private_key.replace(/-----[^-]+-----/g, "").replace(/\n/g, "");
  const keyBuf = Uint8Array.from(atob(pemKey), c => c.charCodeAt(0));
  const cryptoKey = await crypto.subtle.importKey(
    "pkcs8", keyBuf,
    { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" },
    false, ["sign"]
  );
  const sigBuf = await crypto.subtle.sign(
    "RSASSA-PKCS1-v1_5", cryptoKey,
    new TextEncoder().encode(`${header}.${payload}`)
  );
  const sig = btoa(String.fromCharCode(...new Uint8Array(sigBuf)));
  const jwt = `${header}.${payload}.${sig}`;

  const res = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer&assertion=${jwt}`,
  });
  const data = await res.json();
  return data.access_token;
}

// ── Получить тренировки за день из Supabase ──────────────────────────────────
async function getWorkoutsForDay(date: string) {
  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_KEY);
  const from = `${date}T00:00:00+05:00`;
  const to   = `${date}T23:59:59+05:00`;
  const { data } = await sb.from("workouts")
    .select("workout_date, clients(fio, age), profiles!trainer_id(fio), category_at_moment, is_drop_in, is_debt, branch")
    .gte("workout_date", from).lte("workout_date", to)
    .eq("pending_confirmation", false)
    .order("workout_date");
  return data || [];
}

// ── Обновить лист в Google Sheets ────────────────────────────────────────────
async function updateSheet(token: string, sheetName: string, rows: string[][]) {
  const range = `${sheetName}!A1`;
  const values = [
    ["Время", "Клиент", "Тренер", "Кат.", "Тип", "Филиал"],
    ...rows,
  ];
  await fetch(
    `https://sheets.googleapis.com/v4/spreadsheets/${SPREADSHEET_ID}/values/${encodeURIComponent(range)}?valueInputOption=RAW`,
    {
      method: "PUT",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({ range, majorDimension: "ROWS", values }),
    }
  );
}

// ── Главный обработчик ───────────────────────────────────────────────────────
Deno.serve(async (req) => {
  try {
    // Supabase Database Webhook шлёт POST с телом { type, table, record, ... }
    const body = await req.json().catch(() => ({}));
    const record = body?.record;

    // Определяем дату: из записи или query-param ?date=2026-06-09
    const url = new URL(req.url);
    let dateStr = url.searchParams.get("date");
    if (!dateStr && record?.workout_date) {
      dateStr = record.workout_date.slice(0, 10);
    }
    if (!dateStr) {
      // Fallback — сегодня по UTC+5
      const d = new Date(Date.now() + 5 * 3600000);
      dateStr = d.toISOString().slice(0, 10);
    }

    const workouts = await getWorkoutsForDay(dateStr);
    const token = await getGoogleToken();

    // Имя листа = число месяца (1..31) или дата "09.06"
    const d = new Date(dateStr + "T00:00:00");
    const sheetName = String(d.getDate()); // "9", "10", ...

    const rows = workouts.map(w => {
      const time = new Date(w.workout_date).toLocaleTimeString("ru-RU", {
        hour: "2-digit", minute: "2-digit", timeZone: "Asia/Tashkent"
      });
      const type = w.is_drop_in ? "разовое" : w.is_debt ? "долг" : "ПТ";
      return [
        time,
        (w.clients as any)?.fio || "?",
        (w.profiles as any)?.fio || "?",
        `Кат.${w.category_at_moment}`,
        type,
        w.branch || "",
      ];
    });

    await updateSheet(token, sheetName, rows);

    return new Response(JSON.stringify({ ok: true, date: dateStr, count: rows.length }), {
      headers: { "Content-Type": "application/json" },
    });
  } catch (e) {
    console.error(e);
    return new Response(JSON.stringify({ error: String(e) }), { status: 500 });
  }
});
