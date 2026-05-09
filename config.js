// =============================================
// Конфигурация — v2
// =============================================

const CONFIG = {
  SUPABASE_URL:      'https://nkwfvuhtpaoxsaczwsrg.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rd2Z2dWh0cGFveHNhY3p3c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUwMzIsImV4cCI6MjA5MzcxMTAzMn0.a2rKoLNBB4OGpuENu1XUhsfbc-8JmPbxEkvLrXqUM3A',
  // Токен бота — хранится в Supabase Secrets, здесь не нужен
};

// Ставки оплаты
const RATES = {
  pt: { 1: 85000, 2: 110000, 3: 135000 },
  duty_per_hour: 14000,

  // Детские группы: 40% от абонемента 1 000 000
  group_children_percentage: 0.40,

  // Взрослые группы: по явке за занятие
  // «до 4» → 1-3 чел; «4-6» → 4-6 чел; «7+» → 7 и более
  group_adult: [
    { maxHeadcount: 3, rate: 110000 },
    { maxHeadcount: 6, rate: 120000 },
    { maxHeadcount: Infinity, rate: 130000 },
  ],
};

/** Ставка за занятие взрослой группы по явке */
function getAdultGroupRate(headcount) {
  for (const tier of RATES.group_adult) {
    if (headcount <= tier.maxHeadcount) return tier.rate;
  }
  return RATES.group_adult.at(-1).rate;
}

// Ограничения
const EDIT_WINDOW_MIN    = 30;   // минуты — окно удаления записи
const MAX_BACKDATE_HOURS = 24;   // часы — максимальное «задним числом»

// Дни недели (0 = Пн)
const DAYS_SHORT = ['Пн', 'Вт', 'Ср', 'Чт', 'Пт', 'Сб', 'Вс'];
const DAYS_FULL  = ['Понедельник', 'Вторник', 'Среда', 'Четверг', 'Пятница', 'Суббота', 'Воскресенье'];

// Часы расписания (07:00 — 23:00)
const SCHEDULE_HOURS = Array.from({ length: 17 }, (_, i) =>
  `${String(i + 7).padStart(2, '0')}:00`
);

// Цвета типов слотов
const SLOT_COLORS = {
  duty:  { bg: 'rgba(100,100,100,0.25)', color: '#aaa',     label: 'Дежурство' },
  pt:    { bg: 'rgba(124,58,237,0.2)',   color: '#a78bfa',  label: 'ПТ'        },
  group: { bg: 'rgba(16,185,129,0.2)',   color: '#10b981',  label: 'Группа'    },
};
