// remind.js — Автоматические правила уведомлений (Supabase JS SDK)
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
    if (!d.ok) console.error('TG error for', chatId, ':', d.description);
    return !!d.ok;
  } catch(e) { console.error('TG error:', e.message); return false; }
}

async function isActive(key) {
  const { data } = await sb.from('notification_rules').select('active').eq('rule_key', key).single();
  return data?.active === true;
}

// Правило 1: Незакрытые занятия в 22:00
async function ruleOpenSessions(dow, today) {
  if (!(await isActive('open_sessions_2200'))) return console.log('[open_sessions] disabled');

  const { data: trainers } = await sb.from('profiles')
    .select('id,fio,tg_id')
    .in('role', ['trainer','senior_trainer'])
    .not('tg_id', 'is', null);

  console.log('[open_sessions] trainers:', trainers?.length || 0);
  let sent = 0;

  for (const tr of trainers || []) {
    const { data: slots } = await sb.from('schedule_slots')
      .select('id,slot_type,start_time')
      .eq('trainer_id', tr.id)
      .eq('day_of_week', dow)
      .eq('active', true)
      .in('slot_type', ['pt','group']);

    if (!slots?.length) continue;

    const slotIds = slots.map(s => s.id);
    const { data: confs } = await sb.from('schedule_confirmations')
      .select('slot_id')
      .in('slot_id', slotIds)
      .eq('session_date', today);

    const done  = new Set((confs||[]).map(c => c.slot_id));
    const pend  = slots.filter(s => !done.has(s.id));
    if (!pend.length) continue;

    const lines = pend.map(s =>
      '• ' + s.start_time.slice(0,5) + ' — ' + (s.slot_type==='pt'?'Персональная':'Групповое')
    ).join('\n');

    const msg = '⚠️ <b>Незакрытые занятия</b>\n\n' + lines + '\n\nПодтвердите или отмените в AquaDesk.';
    if (await tg(tr.tg_id, msg)) { console.log('[open_sessions] sent to:', tr.fio); sent++; }
  }
  console.log('[open_sessions] done. Sent:', sent);
}

// Правило 2: Истекающие абонементы
async function ruleSubExpiring() {
  if (!(await isActive('sub_expiring_7d'))) return console.log('[sub_expiring] disabled');

  const today = new Date().toISOString().slice(0,10);
  const in7   = new Date(); in7.setDate(in7.getDate()+7);
  const in7str = in7.toISOString().slice(0,10);

  // Только клиенты с остатком ПТ и не в архиве: если ПТ уже 0 — продлевать нечего,
  // напоминание «истекает абонемент» лишь шумит (клиент давно отходил пакет, а дата
  // членства подошла только сейчас). См. жалобу тренеров на ложные пуши.
  const { data: clients } = await sb.from('clients')
    .select('fio,subscription_end,balance,profiles!trainer_id(fio,tg_id)')
    .gt('balance', 0)
    .eq('is_archived', false)
    .gte('subscription_end', today)
    .lte('subscription_end', in7str);

  console.log('[sub_expiring] expiring clients:', clients?.length || 0);
  for (const c of clients||[]) {
    const tgId = c.profiles?.tg_id; if (!tgId) continue;
    const days = Math.ceil((new Date(c.subscription_end)-new Date())/86400000);
    const msg  = '⏰ <b>Истекает абонемент</b>\n\nКлиент: <b>' + c.fio + '</b>\nОсталось: ' + days + ' дн.\n\nНапомните о продлении.';
    if (await tg(tgId, msg)) console.log('[sub_expiring] sent for:', c.fio);
  }
}

// Правило 3: Долг > 3 дней
async function ruleDebtOverdue() {
  if (!(await isActive('debt_overdue_3d'))) return console.log('[debt_overdue] disabled');

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-3);
  const { data: workouts } = await sb.from('workouts')
    .select('workout_date,clients(fio),profiles!trainer_id(fio,tg_id)')
    .eq('is_debt', true)
    .is('debt_confirmed_at', null)
    .lt('created_at', cutoff.toISOString());

  console.log('[debt_overdue] count:', workouts?.length || 0);
  const byTrainer = {};
  for (const w of workouts||[]) {
    const tgId = w.profiles?.tg_id; if (!tgId) continue;
    if (!byTrainer[tgId]) byTrainer[tgId] = { name: w.profiles?.fio, items: [] };
    byTrainer[tgId].items.push(w.clients?.fio + ' (' + new Date(w.workout_date).toLocaleDateString('ru-RU') + ')');
  }
  for (const [tgId, data] of Object.entries(byTrainer)) {
    const msg = '❌ <b>Долг не подтверждён (3+ дня)</b>\n\n' + data.items.map(i=>'• '+i).join('\n') + '\n\nПодтвердите оплату в разделе Отчёт.';
    if (await tg(parseInt(tgId), msg)) console.log('[debt_overdue] sent to:', data.name);
  }
}

// Правило 4: Нет активности 5 дней
async function ruleInactive() {
  if (!(await isActive('trainer_inactive_5d'))) return console.log('[inactive] disabled');

  const { data: admins } = await sb.from('profiles').select('tg_id,fio').eq('role','admin').not('tg_id','is',null);
  if (!admins?.length) return;

  const cutoff = new Date(); cutoff.setDate(cutoff.getDate()-5);
  const { data: trainers } = await sb.from('profiles').select('id,fio').in('role',['trainer','senior_trainer']);

  const inactive = [];
  for (const tr of trainers||[]) {
    const { data: ws } = await sb.from('workouts').select('id').eq('trainer_id',tr.id).gte('workout_date',cutoff.toISOString()).limit(1);
    if (!ws?.length) inactive.push(tr.fio);
  }
  if (!inactive.length) return;

  const msg = '💤 <b>Нет активности 5+ дней</b>\n\n' + inactive.map(f=>'• '+f).join('\n');
  for (const a of admins) { if (await tg(a.tg_id, msg)) console.log('[inactive] sent to admin:', a.fio); }
}

async function main() {
  const hourTashkent = (new Date().getUTCHours() + 5) % 24;
  const now = new Date();
  const dow = (now.getDay() + 6) % 7;
  const today = now.toISOString().slice(0, 10);

  console.log('=== AquaDesk Reminder ===', now.toISOString(), '| Tashkent hour:', hourTashkent);

  if (hourTashkent === 22) await ruleOpenSessions(dow, today);
  if (hourTashkent === 9)  { await ruleSubExpiring(); await ruleDebtOverdue(); await ruleInactive(); }

  console.log('=== Done ===');
}

main().catch(e => { console.error('Fatal:', e.message); process.exit(1); });
