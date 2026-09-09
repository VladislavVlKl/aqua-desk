// process-queue.js — АВАРИЙНЫЙ ручной канал доставки Telegram-пушей.
// Регулярную доставку ведёт pg_cron внутри Supabase (job process-notif-queue,
// раз в минуту → Edge Function supabase/functions/process-queue). Этот скрипт
// запускается только вручную (workflow_dispatch) и повторяет ту же логику:
// вайтлист «замен», реальный текст ошибки Telegram, ретраи.
const { createClient } = require('@supabase/supabase-js');

const sb  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const BOT = process.env.BOT_TOKEN;

// Разрешённые к отправке в чат события (должно совпадать с Edge Function).
const WHITELIST = ['substitution', 'substitution_approve'];
const MAX_ATTEMPTS = 5;

async function tg(chatId, text) {
  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const d = await r.json();
    return { ok: !!d.ok, desc: d.description };
  } catch(e) { return { ok: false, desc: 'fetch error: ' + e.message }; }
}

async function main() {
  const now = new Date();
  console.log('=== Process Queue (manual fallback) ===', now.toISOString());

  // Приостановленные события — увести из pending, чтобы не копились.
  await sb.from('notifications_queue')
    .update({ status: 'skipped', error_text: 'paused: rule not enabled' })
    .eq('status', 'pending')
    .not('rule_key', 'in', `(${WHITELIST.join(',')})`);

  const { data: rows, error } = await sb
    .from('notifications_queue')
    .select('id,recipient_tg_id,recipient_name,message,attempts,scheduled_for')
    .eq('status', 'pending')
    .in('rule_key', WHITELIST)
    .lt('attempts', MAX_ATTEMPTS)
    .order('scheduled_for', { ascending: true })
    .limit(100);

  if (error) { console.error('Supabase error:', error.message, error.code); process.exit(1); }

  const toSend = (rows || []).filter(n => new Date(n.scheduled_for).getTime() <= now.getTime());
  console.log('Ready to send:', toSend.length);

  let sent = 0, failed = 0, retry = 0;
  for (const n of toSend) {
    const res = await tg(n.recipient_tg_id, n.message);
    if (res.ok) {
      await sb.from('notifications_queue')
        .update({ status: 'sent', sent_at: new Date().toISOString(), error_text: null })
        .eq('id', n.id);
      sent++; console.log('  ✓ Sent to', n.recipient_name);
    } else {
      const attempts = (n.attempts || 0) + 1;
      const exhausted = attempts >= MAX_ATTEMPTS;
      await sb.from('notifications_queue')
        .update({ status: exhausted ? 'failed' : 'pending', attempts,
                  error_text: res.desc || 'Telegram delivery failed' })
        .eq('id', n.id);
      if (exhausted) { failed++; console.log('  ✗ Failed (give up):', n.recipient_name, '—', res.desc); }
      else           { retry++;  console.log('  ↻ Retry later:', n.recipient_name, '—', res.desc); }
    }
  }

  console.log('=== Done. Sent:', sent, '| Retry:', retry, '| Failed:', failed, '===');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
