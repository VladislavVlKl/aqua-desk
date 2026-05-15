// process-queue.js — использует Supabase JS SDK (как браузерный код)
const { createClient } = require('@supabase/supabase-js');

const sb  = createClient(process.env.SUPABASE_URL, process.env.SUPABASE_ANON_KEY);
const BOT = process.env.BOT_TOKEN;

async function tg(chatId, text) {
  try {
    const r = await fetch('https://api.telegram.org/bot' + BOT + '/sendMessage', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text, parse_mode: 'HTML' }),
    });
    const d = await r.json();
    if (!d.ok) console.error('TG error:', d.description);
    return !!d.ok;
  } catch(e) { console.error('TG fetch error:', e.message); return false; }
}

async function main() {
  const now = new Date();
  console.log('=== Process Queue ===', now.toISOString());

  // Получаем все pending уведомления
  const { data: allPending, error } = await sb
    .from('notifications_queue')
    .select('*')
    .eq('status', 'pending')
    .order('scheduled_for', { ascending: true })
    .limit(100);

  if (error) {
    console.error('Supabase error:', error.message, error.code);
    process.exit(1);
  }

  console.log('Total pending in queue:', allPending?.length || 0);

  // Фильтруем по времени в JS
  const toSend = (allPending || []).filter(n =>
    new Date(n.scheduled_for).getTime() <= now.getTime()
  );
  console.log('Ready to send:', toSend.length);

  let sent = 0, failed = 0;

  for (const n of toSend) {
    console.log('Sending to:', n.recipient_name, '| tg_id:', n.recipient_tg_id);
    const ok = await tg(n.recipient_tg_id, n.message);

    const { error: updateError } = await sb
      .from('notifications_queue')
      .update(ok
        ? { status: 'sent', sent_at: new Date().toISOString() }
        : { status: 'failed', error_text: 'Telegram delivery failed' }
      )
      .eq('id', n.id);

    if (updateError) console.error('Update error:', updateError.message);

    if (ok) { sent++; console.log('  ✓ Sent'); }
    else    { failed++; console.log('  ✗ Failed'); }
  }

  console.log('=== Done. Sent:', sent, '| Failed:', failed, '===');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
