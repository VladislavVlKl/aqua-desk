// process-queue.js — Обработка очереди уведомлений
const BASE = process.env.SUPABASE_URL + '/rest/v1';
const KEY  = process.env.SUPABASE_ANON_KEY;
const BOT  = process.env.BOT_TOKEN;
const H    = { 'apikey': KEY, 'Authorization': 'Bearer ' + KEY, 'Content-Type': 'application/json' };

async function get(path) {
  try {
    const r = await fetch(BASE + path, { headers: H });
    const t = await r.text();
    let d; try { d = JSON.parse(t); } catch { console.error('Not JSON:', t.slice(0,200)); return []; }
    if (!r.ok) { console.error('API error:', JSON.stringify(d)); return []; }
    return Array.isArray(d) ? d : [];
  } catch(e) { console.error('Fetch:', e.message); return []; }
}

async function patch(path, body) {
  try {
    const r = await fetch(BASE + path, { method: 'PATCH', headers: H, body: JSON.stringify(body) });
    if (!r.ok) { const t = await r.text(); console.error('PATCH error:', t.slice(0,200)); }
  } catch(e) { console.error('PATCH:', e.message); }
}

async function tg(chatId, text) {
  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT + '/sendMessage', {
      method: 'POST', headers: {'Content-Type':'application/json'},
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const d = await r.json();
    return d.ok ? true : (console.error('TG error:', d.description), false);
  } catch(e) { return false; }
}

async function main() {
  const now = Date.now();
  console.log('=== Process Queue ===', new Date(now).toISOString());

  // Получаем ВСЕ pending — фильтрацию по дате делаем в JS
  // чтобы избежать проблем с форматом даты в PostgREST
  const allPending = await get(
    '/notifications_queue?select=*&status=eq.pending&order=scheduled_for.asc&limit=100'
  );

  console.log('Total pending in queue:', allPending.length);

  // Фильтруем: только те что уже должны были уйти
  const toSend = allPending.filter(n => new Date(n.scheduled_for).getTime() <= now);
  console.log('Ready to send:', toSend.length);

  let sent = 0, failed = 0;
  for (const n of toSend) {
    console.log('Sending to:', n.recipient_name, '| tg_id:', n.recipient_tg_id);
    const ok = await tg(n.recipient_tg_id, n.message);
    await patch(
      '/notifications_queue?id=eq.' + n.id,
      ok
        ? { status: 'sent',   sent_at: new Date().toISOString() }
        : { status: 'failed', error_text: 'Telegram delivery failed' }
    );
    if (ok) { sent++; console.log('  ✓ Sent'); }
    else   { failed++; console.log('  ✗ Failed'); }
  }

  console.log('Done. Sent:', sent, '| Failed:', failed);
}

main().catch(e => { console.error('Fatal:', e); process.exit(1); });
