// =============================================
// Конфигурация проекта
// =============================================

const CONFIG = {
  SUPABASE_URL: 'https://nkwfvuhtpaoxsaczwsrg.supabase.co',
  SUPABASE_ANON_KEY: 'eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJpc3MiOiJzdXBhYmFzZSIsInJlZiI6Im5rd2Z2dWh0cGFveHNhY3p3c3JnIiwicm9sZSI6ImFub24iLCJpYXQiOjE3NzgxMzUwMzIsImV4cCI6MjA5MzcxMTAzMn0.a2rKoLNBB4OGpuENu1XUhsfbc-8JmPbxEkvLrXqUM3A',
};

// Ставки оплаты (в сумах)
const RATES = {
  pt: { 1: 85000, 2: 110000, 3: 135000 },
  duty_per_hour: 14000,
};

// Окно редактирования записи (минуты)
const EDIT_WINDOW_MINUTES = 30;
