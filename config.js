// =============================================
// Конфигурация — v3
// =============================================

const CONFIG = {
  SUPABASE_URL:      'https://nkwfvuhtpaoxsaczwsrg.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rd2Z2dWh0cGFveHNhY3p3c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUwMzIsImV4cCI6MjA5MzcxMTAzMn0.a2rKoLNBB4OGpuENu1XUhsfbc-8JmPbxEkvLrXqUM3A',
};

const RATES = {
  pt: { 1: 85000, 2: 110000, 3: 135000 },
  duty_per_hour:            14000,
  drop_in_trainer:          85000,   // тренеру за разовое
  drop_in_price:           200000,   // цена для клиента
  group_children_pct:        0.40,
  group_adult: [
    { max: 3, rate: 110000 },
    { max: 6, rate: 120000 },
    { max: Infinity, rate: 130000 },
  ],
};

const CHILD_MAX_AGE       = 17;    // включительно
const EDIT_WINDOW_MIN     = 30;
const MAX_BACKDATE_HOURS  = 24;
const SUBSCRIPTION_WARN_DAYS = 7;  // за сколько дней предупреждать об окончании

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

function getAdultGroupRate(headcount) {
  for (const tier of RATES.group_adult)
    if (headcount <= tier.max) return tier.rate;
  return RATES.group_adult.at(-1).rate;
}

function isChild(age) {
  return typeof age === 'number' && age <= CHILD_MAX_AGE;
}

/** Локальная дата YYYY-MM-DD (не UTC) */
function todayStr() {
  const d = new Date();
  return [d.getFullYear(), String(d.getMonth()+1).padStart(2,'0'), String(d.getDate()).padStart(2,'0')].join('-');
}

/** Дней до даты */
function daysUntil(dateStr) {
  if (!dateStr) return null;
  return Math.ceil((new Date(dateStr) - new Date(todayStr())) / 86400000);
}

// ─── Добавить в config.js ───────────────────
// (вставить в конец файла)

const NOTE_DEADLINE_HOURS = 48;
const SCHEDULE_URL = 'https://vladislavvlkl.github.io/Aqua-optimization/schedule.html';

const EVENT_TYPES = {
  competition:   '🏆 Соревнование',
  qualification: '📚 Квалификация',
  repair:        '🔧 Ремонт',
  other:         '📌 Другое',
};
