// =============================================
// Конфигурация — v5 (AquaDesk)
// =============================================

const CONFIG = {
  SUPABASE_URL:      'https://nkwfvuhtpaoxsaczwsrg.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rd2Z2dWh0cGFveHNhY3p3c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUwMzIsImV4cCI6MjA5MzcxMTAzMn0.a2rKoLNBB4OGpuENu1XUhsfbc-8JmPbxEkvLrXqUM3A',
};

// Динамический URL — не ломается при переименовании репозитория
const BASE_URL     = new URL('./', window.location.href).href;
const SCHEDULE_URL = BASE_URL + 'schedule.html';
const APP_URL      = BASE_URL;

// ─── СТАВКИ ОПЛАТЫ ───────────────────────────
const RATES = {
  pt: { 1: 85000, 2: 110000, 3: 135000 },
  duty_per_hour:        14000,
  drop_in_trainer:      85000,
  drop_in_price:       200000,
  group_children_pct:    0.40,
  group_adult: [
    { max: 3, rate: 110000 },
    { max: 6, rate: 120000 },
    { max: Infinity, rate: 130000 },
  ],
};

// ─── КОНСТАНТЫ ───────────────────────────────
const CHILD_MAX_AGE          = 17;
const EDIT_WINDOW_MIN        = 30;
const MAX_BACKDATE_HOURS     = 24;
const SUBSCRIPTION_WARN_DAYS = 7;
const NOTE_DEADLINE_HOURS    = 48;

// ─── СПРАВОЧНИКИ ─────────────────────────────
const DAYS_SHORT = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
const DAYS_FULL  = ['Понедельник','Вторник','Среда','Четверг','Пятница','Суббота','Воскресенье'];

const SCHEDULE_HOURS = Array.from({length:17}, (_,i) =>
  `${String(i+7).padStart(2,'0')}:00`
);

const SLOT_COLORS = {
  duty:  { bg:'rgba(90,90,90,0.3)',   color:'#999',    label:'Дежурство' },
  pt:    { bg:'rgba(124,58,237,0.2)', color:'#a78bfa', label:'ПТ'        },
  group: { bg:'rgba(16,185,129,0.2)', color:'#10b981', label:'Группа'    },
};

const EVENT_TYPES = {
  competition:   '🏆 Соревнование',
  qualification: '📚 Квалификация',
  repair:        '🔧 Ремонт',
  other:         '📌 Другое',
};

// ─── ФУНКЦИИ-ХЕЛПЕРЫ ─────────────────────────
function getAdultGroupRate(headcount) {
  for (const tier of RATES.group_adult)
    if (headcount <= tier.max) return tier.rate;
  return RATES.group_adult.at(-1).rate;
}

function isChild(age) {
  return typeof age === 'number' && age <= CHILD_MAX_AGE;
}

function todayStr() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'),
          String(d.getDate()).padStart(2,'0')].join('-');
}

function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date(todayStr())) / 86400000);
}

/** Рассчитать дату окончания абонемента по количеству ПТ */
function calcSubEnd(startDate, qty) {
  const d = new Date(startDate);
  if (qty <= 5)       d.setDate(d.getDate() + 14);
  else if (qty <= 10) d.setMonth(d.getMonth() + 1);
  else                d.setMonth(d.getMonth() + 3);
  return d.toISOString().slice(0,10);
}

function pct(curr, prev) {
  if (!prev) return curr > 0 ? '+100%' : '0%';
  const p = Math.round((curr - prev) / prev * 100);
  return (p >= 0 ? '+' : '') + p + '%';
}

function pctClass(curr, prev, higherIsBetter = true) {
  if (curr === prev) return 'neutral';
  const better = higherIsBetter ? curr > prev : curr < prev;
  return better ? 'up' : 'down';
}
