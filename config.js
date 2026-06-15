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
  drop_in_trainer:      85000, // fallback для старых записей (= 1кт)
  drop_in_price:       200000, // устарело, оставлено для совместимости
  group_children_pct:    0.40,
  group_adult: [
    { max: 3, rate: 110000 },
    { max: 6, rate: 120000 },
    { max: Infinity, rate: 130000 },
  ],
};

// Клиентская цена за 1 ПТ — для расчётной выручки в аналитике.
// Применяется: ко ВЗРОСЛЫМ ПТ (платят за тренировку) и к РАЗОВЫМ/ПРОБНЫМ у всех.
// Источник: взрослый прайс, цена за 1 разовое ПТ. Категории прайса 2/3/4 = наши 1/2/3
// (ограничения по кол-ву у нас прежние: кат.1 до 3, кат.2 до 2, кат.3 индивидуально).
const PT_PRICES = { 1: 200000, 2: 250000, 3: 300000 };

// Цены детских абонементов (обычные ПТ детей) — выручка с продажи пакета, не за занятие.
// [кол-во ПТ в пакете][категория 1/2/3] → цена пакета. Источник: детский прайс.
const CHILD_SUB_PRICES = {
  10: { 1: 2500000,  2: 3000000,  3: 3500000  },
  25: { 1: 6500000,  2: 7750000,  3: 9000000  },
  50: { 1: 13000000, 2: 15500000, 3: 18000000 },
};

// Клиентская цена детской групповой программы за месяц (для аналитики выручки).
// Взрослые группы в выручку не входят — услуга включена во взрослый абонемент.
const GROUP_CHILD_PRICE = 1000000;

// ─── КОНСТАНТЫ ───────────────────────────────
const CHILD_MAX_AGE          = 17;
const EDIT_WINDOW_MIN        = 30;
const MAX_BACKDATE_HOURS     = 48;
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

// ─── СМЕНЫ ДЕЖУРСТВ ──────────────────────────
// Пресеты времени по филиалу: будни / выходные, утро/день/вечер.
// Ключи филиалов = name из таблицы branches. Филиалы без пресета
// (напр. Chekhov Bukhara) → только ручной ввод.
const DUTY_SHIFTS = {
  'Chekhov Light': {
    weekday: { morning:['07:00','13:00'], lunch:['13:00','18:00'], evening:['18:00','23:00'] },
    weekend: { morning:['09:00','15:30'],                          evening:['15:30','22:00'] },
  },
  'Chekhov Sport': {
    weekday: { morning:['07:00','12:00'], day:['12:00','17:00'], evening:['17:00','23:00'] },
    weekend: { morning:['09:00','15:30'],                        evening:['15:30','22:00'] },
  },
  'Chekhov Moms': {
    weekday: { morning:['07:00','12:00'], day:['12:00','17:00'], evening:['17:00','21:00'] },
    weekend: { morning:['09:00','12:00'], day:['12:00','17:00'], evening:['17:00','21:00'] },
  },
};
const SHIFT_ORDER  = ['morning','day','lunch','evening'];
const SHIFT_LABELS = { morning:'Утренняя', day:'Дневная', lunch:'Обеденная', evening:'Вечерняя' };

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
  else if (qty <= 25) d.setMonth(d.getMonth() + 3);
  else                d.setMonth(d.getMonth() + 6); // 50 ПТ = 6 месяцев
  return d.toISOString().slice(0,10);
}

// Пакеты абонементов
const SUB_PACKAGES = {
  child: [
    {qty:5,  label:'5 ПТ',  period:'2 недели'},
    {qty:10, label:'10 ПТ', period:'1 месяц'},
    {qty:25, label:'25 ПТ', period:'3 месяца'},
    {qty:50, label:'50 ПТ', period:'6 месяцев'},
  ],
  adult: [
    {qty:5,  label:'5 ПТ',  period:'2 недели'},
    {qty:10, label:'10 ПТ', period:'1 месяц'},
    {qty:25, label:'25 ПТ', period:'3 месяца'},
  ],
};

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
