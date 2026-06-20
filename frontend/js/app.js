// =============================================
// TWA «Лист тренера» v4 — Полный файл
// =============================================
//
// SECTIONS:
//   CORE:STATE          — глобальное состояние (STATE)
//   CORE:UTILS          — утилиты (fmt, levenshtein, cached, once, ...)
//   CORE:UI             — setScreen, toast, setupBack, navPush
//   CORE:INIT           — init(), enterApp()
//   AUTH                — регистрация, PIN-вход, привязка профиля
//   TRAINER:SHELL       — renderTrainerApp, renderTrainerShell, switchTab
//   TRAINER:HOME        — renderHomeTab, checkNoteBadge, doLogDutyHome
//   TRAINER:CLIENTS     — _findDuplicates, renderClientsTab, renderOverdueNotesModal
//   TRAINER:CLIENTS:ADD — renderAddClientModal, doAddClient
//   TRAINER:WORKOUTS    — renderWorkoutsTab, doLogWorkout
//   TRAINER:SCHEDULE    — renderScheduleTab, loadScheduleWeek, renderAddSlotModal
//   TRAINER:TODAY       — renderTodayTab, doConfirm
//   TRAINER:DUTIES      — renderDutyTab, doLogDuty, renderLateRequestModal
//   TRAINER:EVENTS      — renderEventsTab
//   TRAINER:REPORT      — loadTrainerReport
//   CLIENT:PROFILE      — renderClientProfile, подписки, заморозка, цели
//   CLIENT:EXPORT       — doExportTrainer, doExportBranchChildGroups
//   SENIOR              — renderSeniorApp, renderSeniorAnalytics
//   SENIOR:GROUPS       — renderSeniorGroups, renderGroupDetail
//   SENIOR:REPORT       — renderBranchReport
//   ADMIN:SHELL         — renderAdminApp, adminTab
//   ADMIN:CONTROL       — renderAdminControl, audit log, сессии, конспекты
//   ADMIN:ANALYTICS     — renderAdminAnalytics
//   ADMIN:CLIENTS       — renderAdminClients, renderClientList, filterAdminClients
//   ADMIN:SALARY        — renderAdminSummary, adminDetail
//   ADMIN:STAFF         — renderAdminStaff, добавление/редактирование тренеров
//   ADMIN:BRANCHES      — renderAdminBranches
//   ADMIN:GROUPS        — renderAdminGroups, renderGroupsStructure, renderGroupMonthReport
//   ADMIN:TECH          — renderAdminTech, оборудование, счета, закупки, хлор, планы
//   CEO                 — renderCeoApp, renderCeoDashboard, renderCeoAnalytics, renderCeoSalary
//   SHARED:DELETE       — doDeleteClientCheck, doApproveDelete, doApproveWorkoutDelete
//   SHARED:PROFILE      — renderTrainerEditProfile
//   SHARED:NOTIFICATIONS — checkInAppNotifications, renderAdminNotifications
//   SHARED:GROUP_MODALS — расписание группы, замены, взрослые группы
//
// =============================================

const STATE = {
  tgId: null, profile: null,
  activeDuty: null, dutyTimer: null, currentTab: null,
};

// ── ЗАЩИТА ОТ ДВОЙНЫХ НАЖАТИЙ ────────────────
const _pending = new Set();
let _pendingLogData = null; // данные текущего списания (для модала конспектов)

// ── RATE LIMITING ─────────────────────────────
// Ограничивает вызовы: не чаще 1 раза в ms миллисекунд
const _rateLimits = {};
// ============================================================
// SECTION: CORE:UTILS — утилиты (rateLimit, cached, fmt, levenshtein, ...)
// ============================================================
function rateLimit(key, ms=2000) {
  const now = Date.now();
  if (_rateLimits[key] && now - _rateLimits[key] < ms) return false;
  _rateLimits[key] = now;
  return true;
}
// Для PIN-входа: блокируем после 5 неверных попыток на 30 сек
let _pinFailCount = 0;
let _pinBlockedUntil = 0;

// ── КЕШ (5 минут) ────────────────────────────
const _cache = {};
const _cacheInflight = {};   // key → Promise: дедуп параллельных запросов с одним ключом
async function cached(key, fn, ttl=300000) {
  const now = Date.now();
  if (_cache[key] && now - _cache[key].ts < ttl) return _cache[key].val;
  // Запрос с этим ключом уже летит — ждём его, не запускаем дубль.
  // (без этого 4 карточки Overview трижды дёргали один getAnWorkouts)
  if (_cacheInflight[key]) return _cacheInflight[key];
  const p = (async () => {
    const val = await fn();
    _cache[key] = {val, ts: Date.now()};
    return val;
  })();
  _cacheInflight[key] = p;
  try { return await p; }
  finally { delete _cacheInflight[key]; }   // при reject ключ освобождается → следующий вызов повторит
}
function invalidateCache(...keys) {
  keys.forEach(k => delete _cache[k]);
}
// Сбросить все кеши по префиксу. Группы используют префикс 'grp:' —
// любой write-метод групп в db.js вызывает invalidateCachePrefix('grp:'),
// поэтому отчёты/списки/ставки гарантированно свежие после оплаты,
// отметки «кто проводил», перевода в подгруппу, смены ставок.
function invalidateCachePrefix(prefix) {
  Object.keys(_cache).forEach(k => { if (k.startsWith(prefix)) delete _cache[k]; });
}

// ── LAZY LOAD XLSX ────────────────────────────
let _xlsxLoaded = false;
async function ensureXlsx() {
  if (_xlsxLoaded || typeof XLSX !== 'undefined') { _xlsxLoaded=true; return; }
  await new Promise((res,rej)=>{
    const s=document.createElement('script');
    s.src='https://cdn.jsdelivr.net/npm/xlsx-js-style@1.2.0/dist/xlsx.bundle.js';
    s.onload=()=>{_xlsxLoaded=true;res();}; s.onerror=rej;
    document.head.appendChild(s);
  });
}
function once(key, fn) {
  return async function(...args) {
    if (_pending.has(key)) return;
    _pending.add(key);
    try { await fn(...args); }
    finally { _pending.delete(key); }
  };
}

// ── УТИЛИТЫ ──────────────────────────────────
function isToday(dateStr) {
  return new Date(dateStr).toDateString() === new Date().toDateString();
}
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function el(tag,cls,html) {
  const e=document.createElement(tag);
  if (cls)      e.className=cls;
  if (html!=null) e.innerHTML=html;
  return e;
}
function fmt(n)     { return Number(n).toLocaleString('ru-RU'); }
function levenshtein(a, b) {
  const m=a.length, n=b.length;
  const dp=Array.from({length:m+1},(_,i)=>Array.from({length:n+1},(_,j)=>i===0?j:j===0?i:0));
  for(let i=1;i<=m;i++) for(let j=1;j<=n;j++)
    dp[i][j]=a[i-1]===b[j-1]?dp[i-1][j-1]:1+Math.min(dp[i-1][j],dp[i][j-1],dp[i-1][j-1]);
  return dp[m][n];
}
function fmtDate(d) { return new Date(d).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit',year:'2-digit'}); }
function fmtTime(d) { return new Date(d).toLocaleTimeString('ru-RU',{hour:'2-digit',minute:'2-digit'}); }
function fmtDT(d)   { return `${fmtDate(d)} ${fmtTime(d)}`; }
function fmtMY(y,m) { return new Date(y,m-1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'}); }
function localDT(daysOffset=0) {
  const d=new Date(); d.setDate(d.getDate()+daysOffset);
  return d.toISOString().slice(0,16);
}
function hoursFromDuty(s,e) { return (new Date(e)-new Date(s))/3600000; }
function canEdit(createdAt)  { return (Date.now()-new Date(createdAt)) < EDIT_WINDOW_MIN*60000; }
function isValidWorkoutDate(v) {
  const workoutDate = new Date(v);
  const now = new Date();
  // Разрешаем сегодняшний день целиком (даже если время ещё не наступило)
  const todayEnd = new Date(now.getFullYear(), now.getMonth(), now.getDate(), 23, 59, 59, 999);
  const limitStart = new Date(Date.now() - MAX_BACKDATE_HOURS * 3600000);
  return workoutDate <= todayEnd && workoutDate >= limitStart;
}
function getBranch(id='sel-branch') {
  return document.getElementById(id)?.value || STATE.profile?.branches?.[0] || '';
}
function branchSelect(id, branches) {
  if (!branches||branches.length<=1)
    return `<input type="hidden" id="${id}" value="${branches?.[0]||''}">`;
  return `<div class="form-group"><label>Филиал</label>
    <select id="${id}">${branches.map(b=>`<option>${b}</option>`).join('')}</select></div>`;
}

// ─── СМЕНЫ ДЕЖУРСТВ ──────────────────────────
// Селект «Смена» автозаполняет duty-start/duty-end по DUTY_SHIFTS.
// branchId — id поля филиала ('duty-branch' на Главной, 'sel-branch' в табе Дежурства).
function dutyShiftSelect(branchId) {
  return `<div class="form-group"><label>Смена</label>
    <select id="duty-shift" onchange="applyDutyShift('${branchId}')">
      <option value="">Ручной ввод</option>
    </select></div>`;
}
function _dutyShiftCfg(branchId) {
  const branch = document.getElementById(branchId)?.value || STATE.profile?.branches?.[0] || '';
  const v = document.getElementById('duty-start')?.value;
  const d = v ? new Date(v) : new Date();
  const isWeekend = d.getDay()===0 || d.getDay()===6;
  return (typeof DUTY_SHIFTS!=='undefined' && DUTY_SHIFTS[branch])
    ? DUTY_SHIFTS[branch][isWeekend?'weekend':'weekday'] : null;
}
function refreshDutyShiftOptions(branchId) {
  const sel = document.getElementById('duty-shift'); if (!sel) return;
  const cfg = _dutyShiftCfg(branchId), prev = sel.value;
  let html = '<option value="">Ручной ввод</option>';
  if (cfg) for (const k of SHIFT_ORDER) if (cfg[k])
    html += `<option value="${k}">${SHIFT_LABELS[k]} · ${cfg[k][0]}–${cfg[k][1]}</option>`;
  sel.innerHTML = html;
  if ([...sel.options].some(o=>o.value===prev)) sel.value = prev;
}
function applyDutyShift(branchId) {
  const sel = document.getElementById('duty-shift'); if (!sel||!sel.value) return;
  const t = _dutyShiftCfg(branchId)?.[sel.value]; if (!t) return;
  const startEl = document.getElementById('duty-start');
  const endEl   = document.getElementById('duty-end');
  const date = (startEl?.value || new Date().toISOString().slice(0,16)).slice(0,10);
  if (startEl) startEl.value = `${date}T${t[0]}`;
  if (endEl)   endEl.value   = `${date}T${t[1]}`;
}
function wireDutyShift(branchId) {
  refreshDutyShiftOptions(branchId);
  const sel = document.getElementById('duty-shift');
  // Смена филиала: если выбранная смена осталась доступной — пересчитать время под филиал.
  document.getElementById(branchId)?.addEventListener('change', () => {
    const cur = sel?.value;
    refreshDutyShiftOptions(branchId);
    if (cur && sel.value === cur) applyDutyShift(branchId);
  });
  // Ручная правка времени → честно переключаем селект на «Ручной ввод».
  // (applyDutyShift меняет .value программно — событие change не летит, селект не сбрасывается.)
  ['duty-start','duty-end'].forEach(id => {
    document.getElementById(id)?.addEventListener('change', () => {
      if (sel) sel.value = '';
      refreshDutyShiftOptions(branchId);
    });
  });
}
// ============================================================
// SECTION: CORE:UI — setScreen, toast, setupBack, navPush, goBack
// ============================================================
function setScreen(html) { $('#app').innerHTML=html; }
function openInBrowser(url) {
  try {
    if (window.Telegram?.WebApp?.openLink) {
      Telegram.WebApp.openLink(url, {try_instant_view:false});
    } else {
      window.open(url, '_blank');
    }
  } catch(e) { window.open(url, '_blank'); }
}
function loading(txt='Загрузка...') {
  setScreen(`<div class="center-screen"><div class="spinner"></div><p>${txt}</p></div>`);
}
// Открыть это же приложение в обычном браузере (больше экран для работы координатора).
// Браузерный режим штатный: init() читает tgid из ?tgid=. Вход всё равно за PIN.
function openSelfInBrowser() {
  if (!STATE.tgId) { toast('Не удалось определить ID','error'); return; }
  const url = location.origin + location.pathname + '?tgid=' + encodeURIComponent(STATE.tgId);
  openInBrowser(url);
}
function toast(msg, type='info') {
  const t=el('div',`toast toast-${type}`,msg);
  document.body.appendChild(t);
  setTimeout(()=>t.classList.add('show'),10);
  setTimeout(()=>{t.classList.remove('show');setTimeout(()=>t.remove(),300);},3200);
}
function setupBack(cb) {
  if (!window.Telegram?.WebApp?.BackButton) return;
  const bb = Telegram.WebApp.BackButton;
  // onClick НАКАПЛИВАЕТ обработчики — без offClick нажатие «назад» вызывало
  // все старые колбэки разом и выкидывало на главную вкладку вместо «Группы»
  if (window._tgBackCb) { try { bb.offClick(window._tgBackCb); } catch(e){} window._tgBackCb = null; }
  if (cb) { window._tgBackCb = cb; bb.onClick(cb); bb.show(); }
  else bb.hide();
}
// Универсальная кнопка назад — запоминает откуда пришли
function navPush(fn) { STATE._backFn = fn; }
// Эффективная роль: учитывает дев-переключатель (STATE._devRole), иначе реальная роль.
// Навигация должна возвращать в ту панель, которую сейчас видит пользователь,
// иначе дев-режим (admin «как старший тренер») выкидывает на панель координатора.
function curRole() { return STATE._devRole || STATE.profile?.role; }
function goBack() {
  if (STATE._backFn) { const f=STATE._backFn; STATE._backFn=null; f(); return; }
  const role = curRole();
  if (role==='admin'||role==='ceo') { renderAdminApp('groups'); }
  else if (role==='senior_trainer') { renderSeniorApp('groups'); }
  else { renderTrainerApp(); switchTab('groups'); }
}
// Кнопка назад с правильным цветом темы
function backBtn(label='←') {
  return `<button class="btn-icon back-btn" onclick="goBack()">${label}</button>`;
}
function openSchedule() {
  window.Telegram?.WebApp?.openLink
    ? Telegram.WebApp.openLink(SCHEDULE_URL, {try_instant_view:false})
    : window.open(SCHEDULE_URL,'_blank');
}

// ── ДЕВ-ПЕРЕКЛЮЧАТЕЛЬ РОЛЕЙ ──────────────────
// ============================================================
// SECTION: DEV — переключатель ролей ТОЛЬКО для координатора-владельца.
// Позволяет открыть любую из 6 панелей с одного аккаунта без смены роли в БД.
// Это флаг STATE._devRole, реальный профиль и БД не трогаются.
// Чтобы ПОЛНОСТЬЮ отключить: удалить эту секцию + строку «🛠 Дев» в renderAdminApp
// + ветку tab==='dev' в adminTab + вызов _devWrapDB() в init().
// ============================================================
const DEV_TG_ID = 118803972;
function isDev() {
  return STATE.profile?.role === 'admin'
      && Number(STATE.profile?.tg_id) === DEV_TG_ID;
}
// Реальные панели (все 6 существуют). Имя роли → её render-функция.
const _DEV_ROLES = [
  { key:'trainer',        lbl:'🏋️ Тренер',         fn:()=>renderTrainerApp()   },
  { key:'senior_trainer', lbl:'🎖 Старший тренер',  fn:()=>renderSeniorApp()    },
  { key:'admin',          lbl:'👑 Координатор',     fn:()=>renderAdminApp()     },
  { key:'reception',      lbl:'🛎 Ресепшн',         fn:()=>renderReceptionApp() },
  { key:'manager',        lbl:'📊 Управляющий',     fn:()=>renderManagerApp()   },
  { key:'ceo',            lbl:'📈 CEO',             fn:()=>renderCeoApp()       },
];
const _devLbl = (k) => _DEV_ROLES.find(r=>r.key===k)?.lbl || k;

// Селектор ролей (вкладка «Дев» в панели координатора). _devRole здесь сброшен —
// мы «вне роли», в нормальной панели координатора.
function renderDevPanel() {
  STATE._devRole = null;
  _devChrome(false);
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <h3 style="margin-bottom:6px">🛠 Дев-режим</h3>
    <p class="hint" style="margin-bottom:16px">Открыть любую панель «как будто» в этой роли. Реальная роль (${ROLE_LBL[STATE.profile.role]||STATE.profile.role}) и БД не меняются.</p>
    <label style="display:flex;align-items:center;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px 14px;margin-bottom:16px;cursor:pointer">
      <input type="checkbox" ${STATE._devAllowWrite?'checked':''}
        onchange="STATE._devAllowWrite=this.checked; toast(this.checked?'⚠️ Запись в БД ВКЛЮЧЕНА':'Запись в БД отключена', this.checked?'error':'info')">
      <span>Разрешить запись в БД под чужой ролью <span class="hint">(по умолчанию выкл — безопасно)</span></span>
    </label>
    <div style="display:flex;flex-direction:column;gap:10px">
      ${_DEV_ROLES.map(r=>`<button class="btn btn-full"
        style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="devSwitchRole('${r.key}')">${r.lbl}</button>`).join('')}
    </div>
  </div>`;
}

// Переключение в дев-роль: сброс навигации + рендер нужной оболочки + плашка.
async function devSwitchRole(role) {
  const r = _DEV_ROLES.find(x=>x.key===role);
  if (!r) return;
  STATE._backFn = null; setupBack(null);   // сброс стека возврата и Telegram BackButton
  STATE._devRole = role;
  await r.fn();                            // пере-рендер оболочки (setScreen пересоздаёт DOM → бейджи прошлой роли исчезают)
  _devChrome(true);                        // плашка поверх
}

// Клик по плашке «Сменить роль» → назад к селектору в панели координатора.
function devOpenSelector() {
  STATE._devRole = null; STATE._backFn = null; setupBack(null);
  _devChrome(false);
  renderAdminApp('dev');
}

// Плашка дев-режима + сдвиг шапки. Баннер — прямой ребёнок body (вне #app),
// поэтому setScreen внутри ролей его не стирает. Снимается при выходе.
function _devChrome(active) {
  if (!document.getElementById('dev-style')) {
    const st = document.createElement('style'); st.id = 'dev-style';
    st.textContent = `
      body.dev-mode .app-header{top:34px}
      body.dev-mode .tab-content{padding-top:calc(var(--hdr-h) + 34px)}
      #dev-banner{position:fixed;top:0;left:0;right:0;height:34px;z-index:200;
        display:flex;align-items:center;justify-content:center;gap:6px;
        max-width:600px;margin:0 auto;background:#7c3aed;color:#fff;
        font-size:12px;font-weight:600;cursor:pointer}
      #dev-banner u{text-underline-offset:2px}`;
    document.head.appendChild(st);
  }
  document.body.classList.toggle('dev-mode', !!active);
  let b = document.getElementById('dev-banner');
  if (active) {
    if (!b) { b = document.createElement('div'); b.id = 'dev-banner'; b.onclick = devOpenSelector; document.body.appendChild(b); }
    b.innerHTML = `🛠 Дев-режим: ${_devLbl(STATE._devRole)} · <u>Сменить роль</u>`;
  } else if (b) { b.remove(); }
}

// Блокировка записи в БД, пока активен _devRole и _devAllowWrite===false.
// Оборачиваем мутирующие методы DB.* (всё, кроме read-префиксов) один раз.
function _devWrapDB() {
  if (typeof DB === 'undefined' || DB.__devWrapped) return;
  const READ = /^(get|list|fetch|load|check|find|search|count|has|is|calc|resolve|export)/;
  for (const k of Object.keys(DB)) {
    if (typeof DB[k] !== 'function' || READ.test(k)) continue;
    const orig = DB[k].bind(DB);
    DB[k] = function(...args) {
      if (STATE._devRole && !STATE._devAllowWrite) {
        toast('🛠 Дев-режим: запись отключена','info');
        return Promise.resolve(null);
      }
      return orig(...args);
    };
  }
  DB.__devWrapped = true;
}

// ── ИНИЦИАЛИЗАЦИЯ ─────────────────────────────
// ============================================================
// SECTION: CORE:INIT — init(), enterApp()
// ============================================================
async function init() {
  if (window.Telegram?.WebApp) { Telegram.WebApp.ready(); Telegram.WebApp.expand(); }
  _devWrapDB(); // SECTION: DEV — обернуть мутации DB для блокировки записи в дев-режиме
  const tgIdFromTelegram = window.Telegram?.WebApp?.initDataUnsafe?.user?.id;
  const tgIdFromUrl = new URLSearchParams(location.search).get('tgid');
  // Сохраняем tgId в localStorage чтобы браузерный режим работал без переввода
  if (tgIdFromTelegram) {
    try { localStorage.setItem('aq_tgid', String(tgIdFromTelegram)); } catch(e){}
  }
  const tgIdFromStorage = (() => { try { return localStorage.getItem('aq_tgid'); } catch(e){ return null; } })();
  STATE.tgId = tgIdFromTelegram || tgIdFromUrl || tgIdFromStorage || null;
  if (!STATE.tgId) {
    setScreen(`<div style="display:flex;flex-direction:column;align-items:center;justify-content:center;height:100vh;gap:16px;padding:32px;text-align:center">
      <div style="font-size:48px">🏊</div>
      <div style="font-size:18px;font-weight:700">AquaDesk</div>
      <div style="font-size:14px;color:var(--hint)">Откройте приложение через Telegram</div>
    </div>`);
    return;
  }
  loading('Загружаем...');
  try {
    // Очищаем старую auth сессию из localStorage (после rollback telegram-auth)
    try { localStorage.removeItem('sb-nkwfvuhtpaoxsaczwsrg-auth-token'); } catch(e){}
    const p=await DB.getProfileByTgId(STATE.tgId);
    if (!p) { renderRegister(); return; }
    STATE.profile=p;
    if (p.has_pin) renderPinEntry();
    else if (!p.has_pin && p.tg_id) renderForcePinSetup(); // профиль привязан, но PIN не создан
    else enterApp();
  } catch(e) { toast('Ошибка подключения','error'); console.error(e); }
}
async function enterApp() {
  // Логируем вход (fire-and-forget, не блокируем UI)
  const jsVer = document.querySelector('script[src*="app.js"]')?.src?.match(/v=([^&]+)/)?.[1] || '?';
  DB.logSession(STATE.tgId, STATE.profile.fio, STATE.profile.role, jsVer).catch(()=>{});
  checkShowTutorial(() => {
    if      (STATE.profile.role==='admin')          renderAdminApp();
    else if (STATE.profile.role==='senior_trainer') renderSeniorApp();
    else if (STATE.profile.role==='ceo')            renderCeoApp();
    else if (STATE.profile.role==='reception')      renderReceptionApp();
    else if (STATE.profile.role==='manager')        renderManagerApp();
    else                                            renderTrainerApp();
  });
}

// ── РЕГИСТРАЦИЯ ───────────────────────────────
// ============================================================
// SECTION: AUTH — регистрация, PIN-вход, привязка профиля
// ============================================================
function renderRegister() {
  setupBack(null);
  setScreen(`<div class="screen-pad">
    <div class="logo">🏋️</div><h1>Первый вход</h1>
    <p class="hint" style="color:#ef4444;font-weight:600">⚠️ Только Фамилия и Имя — без отчества!</p><p class="hint">Пример: Иванов Иван</p>
    <div class="form-group"><label>ФИО</label>
      <input id="reg-fio" type="text" autocomplete="name" placeholder="Иванов Иван Иванович"></div>
    <div class="form-group"><label>PIN-код (4 цифры)</label>
      <input id="reg-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <div class="form-group"><label>Повторите PIN</label>
      <input id="reg-pin2" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <button class="btn btn-primary btn-full" onclick="doRegister()">Войти</button>
  </div>`);
}
async function doRegister() {
  const fio=$('#reg-fio')?.value.trim(), pin=$('#reg-pin')?.value.trim(), pin2=$('#reg-pin2')?.value.trim();
  if (!fio)              return toast('Введите ФИО','error');
  if (!/^\d{4}$/.test(pin)) return toast('PIN: ровно 4 цифры','error');
  if (pin!==pin2)        return toast('PIN не совпадает','error');
  loading('Ищем профиль...');
  try {
    const p=await DB.getUnclaimedProfileByFio(fio);
    if (!p) { renderRegister(); return toast('ФИО не найдено или уже занято','error'); }
    STATE.profile=await DB.claimProfile(p.id,STATE.tgId,pin);
    toast('Аккаунт привязан! ✅','success'); enterApp();
  } catch(e) { renderRegister(); toast('Ошибка: '+(e?.message||String(e)),'error'); console.error('[doRegister]',e); }
}

// ── PIN — принудительная установка ───────────
function renderForcePinSetup() {
  setupBack(null); window._newPin=''; window._newPin2=''; window._pinStep=1;
  setScreen(`<div class="screen-pad center-screen">
    <div style="font-size:40px;margin-bottom:12px">🔐</div>
    <h2 style="margin-bottom:8px">Создайте PIN-код</h2>
    <p class="hint" style="margin-bottom:24px;text-align:center">Для защиты вашего аккаунта необходимо установить 4-значный PIN. Без него вход в приложение будет закрыт.</p>
    <div id="pin-step-label" style="font-size:14px;font-weight:600;margin-bottom:16px">Введите новый PIN</div>
    <div id="pin-dots" style="display:flex;gap:12px;margin-bottom:24px">
      ${[0,1,2,3].map(()=>'<span style="width:16px;height:16px;border-radius:50%;border:2px solid var(--accent);display:inline-block"></span>').join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:220px;margin:0 auto">
      ${[1,2,3,4,5,6,7,8,9,'',0,'←'].map(k=>`<button
        style="height:56px;border-radius:12px;background:var(--card);border:1px solid var(--border);
               color:var(--text);font-size:20px;font-weight:600;cursor:pointer;${k===''?'visibility:hidden':''}"
        onclick="forcePinKey('${k}')">
        ${k}
      </button>`).join('')}
    </div>
  </div>`);
}
function forcePinKey(k) {
  if (k==='←') { if(window._pinStep===1)window._newPin=window._newPin.slice(0,-1); else window._newPin2=window._newPin2.slice(0,-1); }
  else if (k!==''&&(window._pinStep===1?window._newPin:window._newPin2).length<4) {
    if(window._pinStep===1)window._newPin+=k; else window._newPin2+=k;
  }
  const cur = window._pinStep===1?window._newPin:window._newPin2;
  $$('#pin-dots span').forEach((d,i)=>d.style.background=i<cur.length?'var(--accent)':'transparent');

  if (cur.length===4) {
    if (window._pinStep===1) {
      // Переходим к подтверждению
      window._pinStep=2; window._newPin2='';
      document.getElementById('pin-step-label').textContent='Повторите PIN';
      $$('#pin-dots span').forEach(d=>d.style.background='transparent');
    } else {
      // Проверяем совпадение
      if (window._newPin!==window._newPin2) {
        toast('PIN не совпадает, попробуйте снова','error');
        window._pinStep=1; window._newPin=''; window._newPin2='';
        document.getElementById('pin-step-label').textContent='Введите новый PIN';
        $$('#pin-dots span').forEach(d=>d.style.background='transparent');
        return;
      }
      DB.changePin(STATE.profile.id, window._newPin).then(()=>{
        STATE.profile.has_pin = true;
        toast('✅ PIN установлен!','success');
        enterApp();
      }).catch(()=>toast('Ошибка создания PIN','error'));
    }
  }
}

// ── PIN ───────────────────────────────────────
function renderPinEntry() {
  setupBack(null); window._pin='';
  setScreen(`<div class="screen-pad center-screen">
    <div class="logo">🔐</div>
    <h2>Привет, ${STATE.profile.fio.split(' ')[1]||STATE.profile.fio}!</h2>
    <div class="pin-dots" id="pin-dots">
      <span></span><span></span><span></span><span></span>
    </div>
    <div class="pin-pad">
      ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k=>
        `<button class="pin-key ${k===''?'pin-key-empty':''}" onclick="pinKey('${k}')">${k}</button>`
      ).join('')}
    </div>
  </div>`);
}
function pinKey(k) {
  if (k==='⌫')                            window._pin=window._pin.slice(0,-1);
  else if (k!==''&&window._pin.length<4)  window._pin+=k;
  $$('#pin-dots span').forEach((d,i)=>d.className=i<window._pin.length?'filled':'');
  if (window._pin.length===4) {
    const attempt=window._pin; window._pin='';
    $$('#pin-dots span').forEach(d=>d.className='');
    // Rate limiting: блокировка после 5 неверных попыток
    if (Date.now() < _pinBlockedUntil) {
      const sec = Math.ceil((_pinBlockedUntil-Date.now())/1000);
      toast(`Слишком много попыток. Подождите ${sec} сек.`,'error'); return;
    }
    DB.verifyPin(STATE.tgId,attempt).then(ok=>{
      if (ok) { _pinFailCount=0; toast('Добро пожаловать! 👋','success'); enterApp(); }
      else {
        _pinFailCount++;
        if (_pinFailCount>=5) { _pinBlockedUntil=Date.now()+30000; _pinFailCount=0; toast('5 неверных попыток. Блокировка на 30 сек.','error'); }
        else toast(`Неверный PIN (${_pinFailCount}/5)`,'error');
      }
    }).catch(()=>toast('Ошибка проверки PIN','error'));
  }
}

// ── ПРОФИЛЬ КЛИЕНТА ───────────────────────────
// ============================================================
// SECTION: CLIENT:PROFILE — renderClientProfile, подписки, заморозка, цели, удаление
// ============================================================
async function renderClientProfile(clientId, backTab='home') {
  const isAdmin = STATE.profile.role === 'admin';
  setupBack(()=>{
    if (backTab === 'admin-clients') { renderAdminApp('clients'); }
    else switchTab(backTab);
    setupBack(null);
  });
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const {client,subscriptions,workouts}=await DB.getClientProfile(
      clientId,STATE.profile.role,STATE.profile.branches);
    const activeSub=subscriptions.find(s=>s.is_active);
    const pastSubs=subscriptions.filter(s=>!s.is_active);

    const isOwnClient = client.trainer_id === STATE.profile.id;
    const canEdit     = isOwnClient && ['trainer','senior_trainer'].includes(STATE.profile.role);
    const canEditInfo = canEdit || isAdmin;
    const isChildClient = isChild(client.age);
    const subExpired  = activeSub?.end_date && daysUntil(activeSub.end_date) < 0;
    const balanceZero = (client.balance||0) <= 0;

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="client-header">
        <div class="client-avatar">${client.fio.charAt(0)}</div>
        <div style="flex:1">
          <div class="client-name">${client.is_archived?'<span style="font-size:12px;color:var(--hint);font-weight:400;margin-right:6px">[Архив]</span>':''}${client.fio}</div>
          <div class="client-meta">${client.age?client.age+' лет · ':''}Кат.${client.category} · Баланс: <span${client.balance<=0?' style="color:var(--danger);font-weight:600"':''}>${client.balance}</span></div>
          ${client.is_archived&&client.archive_reason?`<div class="client-meta" style="color:var(--hint)">Причина архивации: ${client.archive_reason}</div>`:''}
          <div class="client-meta">Тренер: ${client.profiles?.fio||'—'}</div>
          ${!canEdit&&!isAdmin?'<div class="hint" style="margin-top:4px;font-size:11px">👁 Только просмотр</div>':''}
          <div style="display:flex;gap:6px;flex-wrap:wrap;margin-top:8px">
            ${canEditInfo?`<button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
              onclick="renderEditClientModal('${clientId}','${encodeURIComponent(client.fio)}',${client.category},'${client.age||''}','${activeSub?.start_date||''}','${client.subscription_end||''}',${client.balance||0})">
              ✏️ Редактировать</button>`:''}
            ${canEdit&&!client.is_archived&&(balanceZero||subExpired)?`<button class="btn btn-sm btn-primary"
              onclick="renderBuyPackageModal('${clientId}',${isChildClient},${client.balance||0})">
              🛒 Новый пакет</button>`:''}
            ${canEdit&&!client.is_archived&&!isChildClient&&(client.balance||0)>0?`<button class="btn btn-sm" style="background:rgba(245,158,11,.15);color:#f59e0b;border:1px solid rgba(245,158,11,.3)"
              onclick="renderGymDeductModal('${clientId}','${encodeURIComponent(client.fio)}',${client.balance||0})">
              ➖ Списать в ТЗ</button>`:''}
            <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
              onclick="renderClientReportModal('${clientId}')">
              📊 Отчёт</button>
            ${canEdit?`<button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
              onclick="renderTransferClientModal('${clientId}','${client.fio}',${STATE.profile.id})">
              🔄 Передать</button>`:''}
            ${isAdmin?`<button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
              onclick="renderAdminTransferModal('${clientId}','${client.fio}')">
              🔄 Передать (адм.)</button>`:''}
            ${canEdit&&!client.is_archived&&activeSub&&!activeSub.freeze_start?`<button class="btn btn-sm" style="background:rgba(96,165,250,.15);color:#3b82f6;border:1px solid rgba(96,165,250,.3)" onclick="renderFreezeModal(${activeSub.id},'${clientId}','${client.subscription_end||''}')">🧊 Заморозка</button>`:''}
            ${canEdit&&!client.is_archived?`<button class="btn btn-sm" style="background:rgba(239,68,68,.15);color:#ef4444;border:1px solid rgba(239,68,68,.3)"
              onclick="renderArchiveClientModal('${clientId}','${encodeURIComponent(client.fio)}')">
              📦 Архив</button>`:''}
            ${canEditInfo&&client.is_archived?`<button class="btn btn-sm" style="background:rgba(34,197,94,.15);color:#22c55e;border:1px solid rgba(34,197,94,.3)"
              onclick="renderRestoreClientModal('${clientId}','${encodeURIComponent(client.fio)}','${backTab}')">
              ♻️ Восстановить</button>`:''}
            ${canEdit?`<button class="btn btn-sm btn-danger"
              onclick="doDeleteClientCheck('${clientId}','${encodeURIComponent(client.fio)}','${client.created_at||''}')">
              🗑 Удалить</button>`:''}
          </div>
        </div>
      </div>

      ${subExpired&&isChildClient?`<div class="warn-banner" style="background:rgba(239,68,68,.1);border-color:rgba(239,68,68,.3)">
        ❌ Абонемент истёк ${activeSub.end_date}. Остаток ПТ сгорел. Оформите новый пакет.
      </div>`:''}
      ${subExpired&&!isChildClient&&(client.balance||0)>0?`<div class="warn-banner" style="background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.3)">
        ⏰ Дата членства истекла. Осталось ${client.balance} ПТ — можно продолжить после продления.
      </div>`:''}
      ${!activeSub&&(client.balance||0)>0?`<div class="warn-banner" style="background:rgba(124,58,237,.1);border-color:rgba(124,58,237,.3)">
        ℹ️ Нет активного абонемента, но есть ${client.balance} ПТ.
      </div>`:''}
      ${activeSub?`
        <div class="sub-card active-sub">
          <div class="sub-card-header">
            <span>📅 Абонемент с ${activeSub.start_date}</span>
          </div>
          ${activeSub.freeze_start?`<div style="background:rgba(96,165,250,.12);border:1px solid rgba(96,165,250,.3);border-radius:8px;padding:8px 12px;margin-bottom:8px;font-size:13px;color:#3b82f6">
            <div style="font-weight:500;margin-bottom:6px">🧊 Заморожен: ${activeSub.freeze_start} — ${activeSub.freeze_end}</div>
            ${canEdit?`<button class="btn btn-sm" style="font-size:11px;background:rgba(96,165,250,.2);color:#3b82f6;border:1px solid rgba(96,165,250,.4)"
              onclick="renderUnfreezeEarlyModal(${activeSub.id},'${clientId}','${activeSub.freeze_end}','${client.subscription_end||''}')">Закончить досрочно</button>`:''}
          </div>`:''}
          <div class="goals-section">
          <div class="goals-section">
            <div class="goals-header">
              <span class="goals-title">🎯 Цели</span>
              ${canEdit?`<button class="btn btn-sm" onclick="renderAddGoalModal(${activeSub.id},'${clientId}')">+ Цель</button>`:''}
            </div>
            ${activeSub.training_goals?.length
              ?activeSub.training_goals.map(g=>`<div class="goal-item">
                  <span>${g.goal_text}</span>
                  ${canEdit?`<button class="btn-icon" style="font-size:12px;color:var(--danger)" onclick="doDeleteGoal('${g.id}','${clientId}')">✕</button>`:''}
                </div>`).join('')
              :'<p class="hint">Цели не установлены</p>'}
          </div>
        </div>
        <h4>Занятия абонемента</h4>
        ${renderSessionsList(workouts,activeSub.id,clientId,canEdit)}`
      :`<div class="sub-card new-sub-card">
          <p class="hint">Нет активного абонемента</p>
          ${canEdit?`<button class="btn btn-primary btn-full" style="margin-top:10px"
            onclick="renderNewSubModal('${clientId}')">+ Начать абонемент</button>`:''}
        </div>`}
      ${pastSubs.length?`
        <h4 style="margin-top:20px">История абонементов</h4>
        ${pastSubs.map((s,i)=>`
          <div class="sub-card past-sub" onclick="togglePastSub('past-${i}')">
            <div class="sub-card-header">
              <span>📦 ${s.start_date} → ${s.end_date||'?'}</span>
              <span class="cr-arrow" id="arrow-past-${i}">›</span>
            </div>
            ${s.closing_note?`<div class="hint" style="margin-top:4px">${s.closing_note}</div>`:''}
            <div id="past-${i}" style="display:none;margin-top:10px">
              ${s.training_goals?.map(g=>`<div class="goal-item">${g.goal_text}</div>`).join('')||'<p class="hint">Нет целей</p>'}
            </div>
          </div>`).join('')}`:''}
    </div>`;
  } catch(e) { toast(e.message==='Нет доступа'?'Нет доступа':'Ошибка','error'); console.error(e); }
}

function togglePastSub(id) {
  const div=document.getElementById(id); if (!div) return;
  const arrow=document.getElementById('arrow-'+id);
  const open=div.style.display==='none';
  div.style.display=open?'':'none';
  if (arrow) arrow.textContent=open?'∨':'›';
}

// ── ОТЧЁТ ПО АБОНЕМЕНТУ ──────────────────────
async function renderClientReportModal(clientId) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal"><div class="modal-header"><h3>Отчёт по абонементу</h3>
    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="center-screen"><div class="spinner"></div></div></div>`;
  document.body.appendChild(m);
  try {
    // Отдельный запрос без лимита — все тренировки клиента
    const {subscriptions,workouts}=await DB.getClientDataForReport(clientId);
    const validSubs=subscriptions.filter(s=>s.start_date);
    const modal=m.querySelector('.modal');
    if (!validSubs.length) {
      modal.innerHTML=`<div class="modal-header"><h3>Отчёт по абонементу</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
        <p class="hint" style="margin-top:12px">Нет абонементов</p>`;
      return;
    }
    // Только обычные ПТ (без разовых)
    window._reportWorkouts=workouts.filter(w=>!w.is_drop_in&&(!w.is_debt||w.debt_confirmed_at));
    window._reportSubs=validSubs;
    modal.innerHTML=`
      <div class="modal-header"><h3>Отчёт по абонементу</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group" style="margin-bottom:12px">
        <select id="report-sub-select" onchange="renderSubReport()" style="width:100%">
          ${validSubs.map((s,i)=>`<option value="${i}">${s.is_active?'Абонемент с '+s.start_date:s.start_date+' — '+(s.end_date||'?')}</option>`).join('')}
        </select>
      </div>
      <div id="report-body"></div>`;
    renderSubReport();
  } catch(e) { console.error(e); toast('Ошибка','error'); }
}

function renderSubReport() {
  const sel=document.getElementById('report-sub-select');
  const idx=parseInt(sel?.value||0);
  const sub=window._reportSubs?.[idx];
  const body=document.getElementById('report-body');
  if (!sub||!body) return;

  // Сравниваем только даты (YYYY-MM-DD) — без timezone-проблем
  const fromStr=sub.start_date; // 'YYYY-MM-DD'
  const toStr=sub.end_date||todayStr();

  const subWorkouts=(window._reportWorkouts||[])
    .filter(w=>{ const d=w.workout_date.slice(0,10); return d>=fromStr&&d<=toStr; })
    .sort((a,b)=>a.workout_date.localeCompare(b.workout_date));

  if (!subWorkouts.length) {
    body.innerHTML='<p class="hint">Нет тренировок в этом периоде</p>'; return;
  }

  const MONTHS=['Январь','Февраль','Март','Апрель','Май','Июнь','Июль','Август','Сентябрь','Октябрь','Ноябрь','Декабрь'];
  const DAYS=['ВС','ПН','ВТ','СР','ЧТ','ПТ','СБ'];
  const byMonth={};
  for (const w of subWorkouts) {
    // Берём дату из строки напрямую чтобы избежать UTC-сдвига
    const [yr,mo,dy]=w.workout_date.slice(0,10).split('-').map(Number);
    const d=new Date(yr,mo-1,dy); // локальная дата
    const key=`${yr}-${mo}`;
    if (!byMonth[key]) byMonth[key]={label:MONTHS[mo-1],dates:[]};
    byMonth[key].dates.push(d);
  }

  body.innerHTML=Object.values(byMonth).map(mo=>`
    <div style="margin-bottom:16px">
      <div style="font-weight:600;margin-bottom:8px">${mo.label} (${mo.dates.length})</div>
      <div style="display:flex;flex-wrap:wrap;gap:6px">
        ${mo.dates.map(d=>`
          <div style="display:flex;flex-direction:column;align-items:center;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:6px 10px;min-width:36px">
            <span style="font-size:10px;color:var(--hint);font-weight:600;letter-spacing:.5px">${DAYS[d.getDay()]}</span>
            <span style="font-size:20px;font-weight:700;line-height:1.2">${d.getDate()}</span>
          </div>`).join('')}
      </div>
    </div>`).join('');
}

function renderSessionsList(workouts, activeSubId, clientId, canEdit=true) {
  // Фильтруем: конспекты нужны только для обычных ПТ (не разовые, не долг без подтверждения)
  const ptWorkouts = workouts.filter(w => !w.is_drop_in && (!w.is_debt || w.debt_confirmed_at));
  if (!ptWorkouts.length) return '<p class="hint">Нет тренировок по абонементу</p>';
  return ptWorkouts.map((w,i)=>{
    const note = w.session_notes;
    const hasNote = note?.accomplishments;
    const ageMs = Date.now() - new Date(w.workout_date).getTime();
    const isOverdue = !hasNote && ageMs > 48*3600000;
    const canWriteNote = canEdit && ageMs < 30*24*3600000; // можно писать в течение 30 дней
    return `<div class="session-item ${isOverdue?'overdue-session':''}">
      <div class="si-header">
        <span class="si-num">№${ptWorkouts.length-i}</span>
        <span class="si-date">${fmtDate(w.workout_date)}</span>
        <span class="si-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
        ${w.reception_status==='pending'?'<span style="font-size:11px;background:rgba(245,158,11,.15);color:#f59e0b;padding:2px 8px;border-radius:8px">⏳ ожидает</span>':''}
        ${isOverdue&&canEdit?'<span class="overdue-badge">⛔ Нет конспекта</span>':''}
      </div>
      ${hasNote?`<div class="note-block">
          <div class="note-label">✅ ${note.accomplishments}</div>
          ${note.next_task?`<div class="note-next">→ ${note.next_task}</div>`:''}
          ${canWriteNote?`<button class="btn btn-sm" style="font-size:11px;margin-top:4px"
            onclick="renderSessionNoteModal('${w.id}','${clientId}')">✏️ Изменить</button>`:''}
        </div>`
      : canWriteNote ? `<button class="btn btn-sm" style="margin-top:6px"
          onclick="renderSessionNoteModal('${w.id}','${clientId}')">
          ${isOverdue?'⛔ Написать (просрочено)':'📝 Написать конспект'}</button>`
      : '<p class="hint" style="font-size:12px;margin-top:4px">Конспект не написан</p>'}
    </div>`;
  }).join('');
}

// Модал: новая цель
function renderAddGoalModal(subId,clientId) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить цель</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Цель абонемента</label>
      <textarea id="goal-text" rows="3" placeholder="Научиться плыть кролем к 10-й тренировке"></textarea></div>
    <button class="btn btn-primary btn-full" onclick="doAddGoal(${subId},'${clientId}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddGoal(subId,clientId) {
  const text=document.getElementById('goal-text')?.value.trim();
  if (!text) return toast('Введите цель','error');
  try {
    await DB.addGoal(subId,clientId,text);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Цель добавлена','success'); renderClientProfile(clientId);
  } catch(e) { console.error(e); toast('Ошибка','error'); }
}
async function doDeleteGoal(goalId,clientId) {
  if (!confirm('Удалить цель?')) return;
  try { await DB.deleteGoal(goalId); toast('Удалено','success'); renderClientProfile(clientId); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}

// Модал: начать абонемент
function renderNewSubModal(clientId) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новый абонемент</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дата начала</label>
      <input type="date" id="sub-start" value="${todayStr()}"></div>
    <div class="form-group"><label>Кол-во ПТ</label>
      <input type="number" id="sub-balance" min="1" value="10"></div>
    <button class="btn btn-primary btn-full" onclick="doCreateSub('${clientId}')">Начать</button>
  </div>`;
  document.body.appendChild(m);
}
async function doCreateSub(clientId) {
  const start=document.getElementById('sub-start')?.value;
  const balance=parseInt(document.getElementById('sub-balance')?.value||0);
  if (!start)       return toast('Введите дату','error');
  if (balance<=0)   return toast('Введите кол-во ПТ','error');
  try {
    await DB.createSubscription(clientId,STATE.profile.id,start,balance);
    await DB.addBalance(clientId,balance);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Абонемент начат','success'); renderClientProfile(clientId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Модал: закрыть абонемент
function renderFreezeModal(subId, clientId, currentSubEnd) {
  const today = todayStr();
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🧊 Заморозка абонемента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:16px">Укажите период заморозки. Конец абонемента сдвинется на количество замороженных дней.</p>
    <div style="display:flex;gap:10px;margin-bottom:12px">
      <div style="flex:1"><label style="font-size:12px;color:var(--hint)">Начало заморозки</label>
        <input type="date" id="frz-start" value="${today}" min="${today}"
          style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px;box-sizing:border-box"></div>
      <div style="flex:1"><label style="font-size:12px;color:var(--hint)">Конец заморозки</label>
        <input type="date" id="frz-end" value="${today}" min="${today}"
          oninput="calcFreezeResult('${currentSubEnd}')"
          style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px;box-sizing:border-box"></div>
    </div>
    <div id="frz-result" style="background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.3);border-radius:8px;padding:10px;font-size:13px;margin-bottom:16px;display:none"></div>
    <button class="btn btn-primary btn-full" onclick="doFreezeSubscription(${subId},'${clientId}','${currentSubEnd}')">Заморозить</button>
  </div>`;
  document.body.appendChild(m);
  document.getElementById('frz-start').addEventListener('input', () => calcFreezeResult(currentSubEnd));
}
function calcFreezeResult(currentSubEnd) {
  const start = document.getElementById('frz-start')?.value;
  const end   = document.getElementById('frz-end')?.value;
  const res   = document.getElementById('frz-result');
  if (!start || !end || !res) return;
  const days = Math.round((new Date(end) - new Date(start)) / 86400000);
  if (days < 1) { res.style.display='none'; return; }
  const newEnd = new Date(currentSubEnd);
  newEnd.setDate(newEnd.getDate() + days);
  res.style.display='';
  res.innerHTML=`Дней заморозки: <b>${days}</b> · Новый конец абонемента: <b>${newEnd.toISOString().slice(0,10)}</b>`;
}
async function doFreezeSubscription(subId, clientId, currentSubEnd) {
  const start = document.getElementById('frz-start')?.value;
  const end   = document.getElementById('frz-end')?.value;
  if (!start || !end) return toast('Укажите даты заморозки','error');
  if (!currentSubEnd) return toast('У клиента не указана дата окончания абонемента','error');
  const days = Math.round((new Date(end) - new Date(start)) / 86400000);
  if (days < 1) return toast('Конец заморозки должен быть позже начала','error');
  const newEnd = new Date(currentSubEnd);
  newEnd.setDate(newEnd.getDate() + days);
  const newEndStr = newEnd.toISOString().slice(0,10);
  try {
    await DB.freezeSubscription(subId, clientId, start, end, newEndStr);
    document.querySelector('.modal-overlay')?.remove();
    toast('Абонемент заморожен 🧊','success');
    renderClientProfile(clientId, STATE.currentTab||'clients');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderUnfreezeEarlyModal(subId, clientId, freezeEnd, subEnd) {
  const today = todayStr();
  const remaining = Math.max(0, Math.round((new Date(freezeEnd) - new Date(today)) / 86400000));
  if (remaining < 1) return toast('Заморозка уже заканчивается сегодня','info');
  if (!subEnd) return toast('У клиента не указана дата окончания абонемента','error');
  const newEnd = new Date(subEnd);
  newEnd.setDate(newEnd.getDate() - remaining);
  const newEndStr = newEnd.toISOString().slice(0,10);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🧊 Завершить заморозку досрочно</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div style="background:rgba(96,165,250,.1);border:1px solid rgba(96,165,250,.3);border-radius:8px;padding:12px;margin-bottom:16px;font-size:13px">
      <div>Заморозка до: <b>${freezeEnd}</b></div>
      <div>Неиспользованных дней: <b>${remaining}</b></div>
      <div style="margin-top:6px">Дата конца абонемента изменится:<br><b>${subEnd}</b> → <b>${newEndStr}</b></div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doUnfreezeEarly(${subId},'${clientId}','${freezeEnd}','${subEnd}')">Завершить заморозку</button>
  </div>`;
  document.body.appendChild(m);
}
async function doUnfreezeEarly(subId, clientId, freezeEnd, subEnd) {
  const today = todayStr();
  const remaining = Math.max(0, Math.round((new Date(freezeEnd) - new Date(today)) / 86400000));
  const newEnd = new Date(subEnd);
  newEnd.setDate(newEnd.getDate() - remaining);
  const newEndStr = newEnd.toISOString().slice(0,10);
  try {
    await DB.unfreezeEarly(subId, clientId, newEndStr);
    document.querySelector('.modal-overlay')?.remove();
    toast('Заморозка завершена досрочно ✅','success');
    renderClientProfile(clientId, STATE.currentTab||'clients');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderCloseSubEarlyModal(subId, clientId, isChild) {
  const m=el('div','modal-overlay');
  const balanceInfo = isChild
    ? `<div class="warn-banner" style="background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.3);margin-bottom:12px">
        ⚠️ Ребёнок: остаток тренировок <strong>сгорит</strong> при досрочном закрытии.
       </div>`
    : `<div class="warn-banner" style="background:rgba(16,185,129,.08);border-color:rgba(16,185,129,.3);margin-bottom:12px">
        ✅ Взрослый: остаток тренировок <strong>сохранится</strong>. При покупке нового пакета восстановится автоматически.
       </div>`;
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Закрыть абонемент досрочно</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${balanceInfo}
    <div class="form-group"><label>Причина (необязательно)</label>
      <textarea id="sub-closing" rows="2" placeholder="Клиент уехал, перешёл в другую группу..."></textarea></div>
    <button class="btn btn-danger btn-full" onclick="doCloseSubEarly(${subId},'${clientId}',${isChild})">❄️ Закрыть досрочно</button>
  </div>`;
  document.body.appendChild(m);
}
async function doCloseSubEarly(subId, clientId, isChild) {
  const note=document.getElementById('sub-closing')?.value.trim()||'';
  const btn=document.querySelector('.modal .btn-danger');
  if (btn) { btn.disabled=true; btn.textContent='Закрываем...'; }
  try {
    await DB.closeSubEarly(subId, clientId, isChild, note, todayStr());
    DB.auditLog('sub_close_early', STATE.profile.id, STATE.profile.fio, subId, 'subscription',
      { client_id: clientId, is_child: isChild, note }, STATE.profile.branches?.[0]);
    document.querySelector('.modal-overlay')?.remove();
    toast(isChild?'✅ Абонемент закрыт, остаток сгорел':'✅ Абонемент закрыт, остаток сохранён','success');
    renderClientProfile(clientId, STATE.currentTab||'clients');
  } catch(e) { toast('Ошибка','error'); console.error(e);
    if (btn) { btn.disabled=false; btn.textContent='❄️ Закрыть досрочно'; }
  }
}

// Модал: конспект занятия
async function renderSessionNoteModal(workoutId,clientId) {
  const existing=await DB.getNoteByWorkout(workoutId);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Конспект занятия</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Что сделали на занятии</label>
      <textarea id="note-acc" rows="3" placeholder="Освоили дыхание во время кроля...">${existing?.accomplishments||''}</textarea></div>
    <div class="form-group"><label>Задача на следующее занятие</label>
      <textarea id="note-next" rows="2" placeholder="Откорректировать работу рук...">${existing?.next_task||''}</textarea></div>
    <button class="btn btn-primary btn-full" onclick="doSaveNote('${workoutId}','${clientId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveNote(workoutId,clientId) {
  const acc=document.getElementById('note-acc')?.value.trim();
  const next=document.getElementById('note-next')?.value.trim();
  if (!acc) return toast('Напишите что сделали','error');
  try {
    const sub=await DB.getActiveSubscription(clientId);
    await DB.upsertNote(workoutId,clientId,STATE.profile.id,sub?.id||null,acc,next||null,null);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Конспект сохранён','success'); renderClientProfile(clientId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── EXCEL EXPORT ──────────────────────────────
// ============================================================
// SECTION: CLIENT:EXPORT — doExportTrainer, doExportBranchChildGroups, doExportSummary
// ============================================================
async function doExportTrainer(trainerId,fioEnc,year,month) {
  const fio=decodeURIComponent(fioEnc);
  if (!window.Telegram?.WebApp?.initData) {
    await ensureXlsx();
    const d=await DB.getTrainerDetail(trainerId,year,month);
    exportTrainerExcel(fio,year,month,d.workouts,d.duties,d.groupSessions,d.adjustment);
    return;
  }
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Скачать Excel</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;line-height:1.6">Для скачивания откройте приложение в браузере (Safari/Chrome), войдите с тем же PIN и нажмите «Скачать Excel».</p>
    <button class="btn btn-primary btn-full"
      onclick="openInBrowser(APP_URL+'?tgid='+STATE.tgId);this.closest('.modal-overlay').remove()">
      Открыть в браузере</button>
  </div>`;
  document.body.appendChild(m);
}
// Для координатора: выбрать филиал → скачать все детские группы
function renderPickBranchForChildGP(monthStr, branches) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Детские ГП — выбор филиала</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">${new Date(monthStr).toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${branches.map(b=>`<button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;text-align:left"
        onclick="this.closest('.modal-overlay').remove();doExportBranchChildGroups('${monthStr}',['${b}'])">
        🏢 ${b}
      </button>`).join('')}
    </div>
  </div>`;
  document.body.appendChild(m);
}

// Скачать Excel всех детских групп по филиалу
async function doExportBranchChildGroups(monthStr, branches) {
  if (window.Telegram?.WebApp?.initData) {
    const m=el('div','modal-overlay');
    m.innerHTML=`<div class="modal"><div class="modal-header"><h3>Скачать Excel</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <p style="line-height:1.6">Откройте приложение в браузере для скачивания файла.</p>
      <button class="btn btn-primary btn-full" onclick="openInBrowser(APP_URL+'?tgid='+STATE.tgId);this.closest('.modal-overlay').remove()">Открыть в браузере</button>
    </div>`;
    document.body.appendChild(m); return;
  }
  toast('Формируем файл...','success');
  await ensureXlsx();
  try {
    const branch = branches[0];
    // Все детские группы по филиалу — уникальные инстансы (убираем дубли по group_instance_id)
    const {data:tgs, error:tgsErr} = await sb().from('trainer_groups')
      .select('id, group_instance_id, group_types(name,type), profiles(fio)')
      .eq('branch', branch).is('subscription_end', null);
    if (tgsErr) throw tgsErr;

    const childGroups = (tgs||[]).filter(tg=>tg.group_types?.type==='children');
    if (!childGroups.length) { toast('Нет детских групп в этом филиале','error'); return; }

    // Дедупликация по group_instance_id — берём по одному представителю каждого инстанса
    const seen = new Set();
    const unique = childGroups.filter(tg => {
      const key = tg.group_instance_id || tg.id;
      if (seen.has(key)) return false;
      seen.add(key); return true;
    });

    // Загружаем отчёты последовательно чтобы не перегружать Supabase
    const reports = [];
    for (const tg of unique) {
      const report = await DB.getGroupMonthReport(tg.id, monthStr);
      reports.push({tg, report});
    }

    exportBranchChildGroupsExcel(branch, monthStr, reports);
  } catch(e) { toast('Ошибка экспорта: '+(e?.message||String(e)),'error'); console.error('[exportBranch]',e); }
}

async function doExportChildGroupExcel(groupId, monthStr) {
  if (window.Telegram?.WebApp?.initData) {
    const m=el('div','modal-overlay');
    m.innerHTML=`<div class="modal"><div class="modal-header"><h3>Скачать Excel</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <p style="line-height:1.6">Откройте приложение в браузере для скачивания файла.</p>
      <button class="btn btn-primary btn-full" onclick="openInBrowser(APP_URL+'?tgid='+STATE.tgId);this.closest('.modal-overlay').remove()">Открыть в браузере</button>
    </div>`;
    document.body.appendChild(m); return;
  }
  await ensureXlsx();
  try {
    const report = await DB.getGroupMonthReport(groupId, monthStr);
    // Дополнительно: информация о группе
    const {data:groupInfo} = await sb().from('trainer_groups')
      .select('branch, group_types(name), profiles(fio)').eq('id',groupId).single();
    exportChildGroupExcel(groupId, monthStr, report, groupInfo);
  } catch(e) { toast('Ошибка экспорта','error'); console.error(e); }
}

async function doExportSummary(year,month,branch) {
  if (!window.Telegram?.WebApp?.initData) {
    await ensureXlsx();
    const data=await DB.getSummary(year,month,branch||null);
    exportSummaryExcel(year,month,data,branch||''); return;
  }
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Скачать Excel</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;line-height:1.6">Откройте в браузере для скачивания.</p>
    <button class="btn btn-primary btn-full"
      onclick="openInBrowser(APP_URL+'?tgid='+STATE.tgId);this.closest('.modal-overlay').remove()">
      Открыть в браузере</button>
  </div>`;
  document.body.appendChild(m);
}

// ── СТАРШИЙ ТРЕНЕР ────────────────────────────
// ============================================================
// SECTION: SENIOR — renderSeniorApp, renderSeniorAnalytics, seniorTab
// ============================================================
async function renderSeniorApp(initialTab='home') {
  setupBack(null);
  setScreen(`<div class="app-header">
    <div><div class="app-title">⭐ AquaDesk</div>
      <div class="app-sub">${STATE.profile.fio}</div></div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="btn-icon" onclick="openSchedule()">📅</button>
      <button class="btn-icon" onclick="renderHelpModal()">?</button>
      <button class="btn-icon" id="notif-bell" onclick="renderInAppNotifications()" style="position:relative">🔔<span id="notif-count" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center"></span></button>
    </div>
  </div>
  <div id="tab-content" class="tab-content"></div>
  <nav class="bottom-nav">
    <button class="nav-btn" onclick="seniorTab('home')"><span>🏠</span>Главная</button>
    <button class="nav-btn" onclick="seniorTab('clients')"><span>👥</span>Клиенты</button>
    <button class="nav-btn" onclick="seniorTab('today')"><span>✅</span>Сегодня</button>
    <button class="nav-btn" onclick="seniorTab('report')"><span>📊</span>Отчёт</button>
    <button class="nav-btn" onclick="seniorTab('groups')"><span>🏊</span>Группы</button>
    <button class="nav-btn" onclick="seniorTab('more')"><span>⋯</span>Ещё</button>
  </nav>`);
  seniorTab(initialTab);
  setTimeout(checkInAppNotifications, 2000);
}
async function renderSeniorAnalytics() {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header">
      <h3>⏰ Поздние тренировки</h3>
      <button class="btn btn-sm" onclick="seniorTab('more')">← Назад</button>
    </div>
    <div id="late-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const branches = STATE.profile.branches||[];
    // Показываем запросы по своим филиалам
    const allReqs = await Promise.all(branches.map(b=>DB.getPendingLateRequests(b)));
    const reqs = allReqs.flat().filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i); // дедупликация
    const body = document.getElementById('late-body');
    if (!reqs.length) {
      body.innerHTML='<div class="empty-state">✅<p>Нет запросов на одобрение</p></div>'; return;
    }
    body.innerHTML = reqs.map(r=>`<div class="staff-card" style="flex-direction:column;gap:8px">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div>
          <div class="staff-fio">${r.clients?.fio||'?'} · кат.${r.category}</div>
          <div class="staff-meta">${r.profiles?.fio||'?'} · ${r.branch}</div>
          <div class="staff-meta">📅 ${fmtDT(r.workout_date)}</div>
        </div>
      </div>
      <div style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;font-size:13px">
        💬 ${r.reason}
      </div>
      <div style="display:flex;gap:8px">
        <button class="btn btn-sm btn-primary" style="flex:1" onclick="doApproveLateRequestSenior(${r.id})">✓ Одобрить</button>
        <button class="btn btn-sm btn-danger" style="flex:1" onclick="doRejectLateRequestSenior(${r.id})">✗ Отклонить</button>
      </div>
    </div>`).join('');
  } catch(e) { document.getElementById('late-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

function seniorTab(tab) {
  // Порядок строго совпадает с кнопками .nav-btn в renderSeniorApp (6 шт),
  // иначе подсветка active съезжает. Под-экраны из «Ещё» (branch/schedule/…) не в навбаре.
  const tabs=['home','clients','today','report','groups','more'];
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',tabs[i]===tab));
  if (tab==='home')     renderHomeTab();
  if (tab==='clients')  renderClientsTab();
  if (tab==='today')    renderTodayTab();
  if (tab==='schedule') renderScheduleTab();
  if (tab==='report')   renderReportTab();
  if (tab==='events')   renderEventsTab();
  if (tab==='branch')   renderBranchReport();
  if (tab==='groups')       renderSeniorGroups();
  if (tab==='late_requests') renderSeniorAnalytics();
  if (tab==='more')         renderSeniorMore();
}

function renderSeniorMore() {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <h3 style="margin-bottom:16px">Ещё</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="seniorTab('schedule')">📅 Расписание</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="seniorTab('branch')">🏢 Отчёт филиала</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="seniorTab('events')">🏆 События</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="renderSubstitutionsApproval()">🔄 Замены</button>
      <button class="btn btn-full" style="background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="seniorTab('late_requests')" id="late-req-btn">⏰ Поздние тренировки</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="renderAdminSessionNotes()">📝 Конспекты и цели</button>
    </div>
  </div>`;
}
// ============================================================
// SECTION: SENIOR:GROUPS — renderSeniorGroups, renderGroupDetail, renderSeniorAssignForm
// ============================================================
async function renderSeniorGroups() {
  const isSenior = STATE.profile.role === 'senior_trainer';
  const branches = STATE.profile.branches||[];
  const monthStr = new Date().toISOString().slice(0,7)+'-01';
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Группы</h3>
      <div style="display:flex;gap:6px">
        ${isSenior?`<button class="btn btn-sm" onclick="renderSubstitutionsApproval()">🔄 Замены</button>`:''}
        ${isSenior?`<button class="btn btn-sm" style="background:rgba(16,185,129,.15);color:#059669" onclick="doExportBranchChildGroups('${monthStr}',${JSON.stringify(branches)})">⬇️ Дет.ГП</button>`:''}
      </div>
    </div>
    ${isSenior?'<div id="pending-subs"></div>':''}
    <h4 style="margin-bottom:8px">Мои группы</h4>
    <div id="groups-list"><div class="center-screen"><div class="spinner"></div></div></div>
    ${isSenior?`<h4 style="margin-top:20px;margin-bottom:8px">Назначить тренера в своём филиале</h4>
    <div id="senior-assign-form"></div>`:''}
  </div>`;
  await loadSeniorGroupsList();
  if (isSenior) {
    await renderPendingSubstitutions();
    await renderSeniorAssignForm();
    // Загружаем доп.доступ и показываем группы других филиалов
    await loadExtraBranchGroups();
  }
}

async function loadExtraBranchGroups() {
  try {
    const extraBranches = await DB.getBranchAccess(STATE.profile.id);
    if (!extraBranches.length) return;
    const body = document.getElementById('tab-content');
    const existingExtra = document.getElementById('extra-branch-groups');
    if (existingExtra) existingExtra.remove();
    const div = el('div','');
    div.id = 'extra-branch-groups';
    div.style.cssText = 'padding:0 16px 16px';
    div.innerHTML = `<h4 style="margin-bottom:8px">Дополнительные филиалы</h4>`;
    for (const branch of extraBranches) {
      const {data:tgs} = await sb().from('trainer_groups')
        .select('*, group_types(name,type), profiles(fio)')
        .eq('branch',branch).is('subscription_end',null);
      const monthStr = new Date().toISOString().slice(0,7)+'-01';
      div.innerHTML += `<div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:13px;color:var(--hint);margin-bottom:6px">${branch}</div>
        ${(tgs||[]).map(tg=>`<div class="staff-card" style="flex-direction:column;align-items:flex-start;gap:6px">
          <div style="display:flex;justify-content:space-between;width:100%">
            <div>
              <div class="staff-fio">${tg.group_types?.name||'Группа'}</div>
              <div class="staff-meta">${tg.profiles?.fio||'—'}</div>
            </div>
            <div style="display:flex;gap:6px">
              ${tg.group_types?.type==='children'?`<button class="btn btn-sm btn-primary"
                onclick="openGroupReport('${tg.id}','${monthStr}','list')">📊 Отчёт</button>`:''}
            </div>
          </div>
        </div>`).join('')||'<p class="hint">Нет групп</p>'}
      </div>`;
    }
    body.querySelector('.tab-pad')?.appendChild(div);
  } catch(e) { console.error(e); }
}

// Защита от назначения группы на «мёртвый» профиль (дубль / не привязан к Telegram).
// Нормализация ФИО без учёта порядка слов: «Сафина Джураева» == «Джураева Сафина».
function _normFio(s) { return (s||'').trim().toLowerCase().replace(/\s+/g,' ').split(' ').sort().join(' '); }
// Строит <option>'ы тренеров с пометками: «⚠️ не в Telegram» и «дубль?».
function _trainerOptionsWithFlags(trainers) {
  const counts = {};
  trainers.forEach(t => { const k=_normFio(t.fio); counts[k]=(counts[k]||0)+1; });
  return trainers.map(t => {
    const flags = [];
    if (!t.tg_id) flags.push('⚠️ не в Telegram');
    if (counts[_normFio(t.fio)] > 1) flags.push('дубль?');
    const suffix = flags.length ? ` — ${flags.join(', ')}` : '';
    return `<option value="${t.id}" data-unclaimed="${t.tg_id?'':'1'}">${t.fio}${suffix}</option>`;
  }).join('');
}
// Подтверждение, если выбран непривязанный профиль (тренер не увидит группу).
function _confirmUnclaimedTrainer(selectId) {
  const opt = document.querySelector(`#${selectId} option:checked`);
  if (opt?.dataset.unclaimed === '1')
    return confirm('⚠️ Этот профиль не привязан к Telegram — тренер не увидит группу (возможно, это дубль профиля).\n\nВсё равно назначить?');
  return true;
}

async function renderSeniorAssignForm() {
  const form = document.getElementById('senior-assign-form'); if (!form) return;
  try {
    const branches = STATE.profile.branches||[];
    const [allTrainers, allSeniors, gts, activeGroupsArr] = await Promise.all([
      DB.getProfilesByRole('trainer'),
      DB.getProfilesByRole('senior_trainer'),
      DB.getGroupTypes(),
      Promise.all(branches.map(b=>DB.getActiveGroupsByBranch(b))),
    ]);
    const myTrainers = [...allTrainers, ...allSeniors].filter(t=>
      !t.is_archived && (t.branches||[]).some(b=>branches.includes(b))
    );
    // Конкретные активные группы филиалов старшего (строки trainer_groups)
    const activeGroups = activeGroupsArr.flat();
    window._saGroups = Object.fromEntries(activeGroups.map(g=>[String(g.id), g]));
    const groupOpts = activeGroups.map(g=>{
      const label = `${g.group_types?.name||'Группа'} · ${g.branch}${g.profiles?.fio?' — '+g.profiles.fio:''}${g.role?' ('+g.role+')':''}`;
      return `<option value="${g.id}" data-type="${g.group_types?.type||''}">${label}</option>`;
    }).join('');
    const trainerOpts = `<option value="">— выберите —</option>${_trainerOptionsWithFlags(myTrainers)}`;
    const gtOpts = gts.map(g=>`<option value="${g.id}" data-type="${g.type}" data-name="${g.name}">${g.name}</option>`).join('');
    const branchOpts = branches.map(b=>`<option>${b}</option>`).join('');

    form.innerHTML=`
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px">
        <div style="font-weight:600;font-size:13px;margin-bottom:12px">Новое назначение</div>
        <div class="form-group"><label>Тренер</label>
          <select id="sa-trainer">${trainerOpts}</select></div>
        <div class="form-group"><label>Тип группы</label>
          <select id="sa-type" onchange="onSaTypeChange(this)">${gtOpts}</select></div>
        <div class="form-group"><label>Филиал</label>
          <select id="sa-branch">${branchOpts}</select></div>
        <div id="sa-rate-section">
          <div class="form-group"><label>Процент тренеру (%)</label>
            <input id="sa-rate" type="number" value="40" min="0" max="100"></div>
        </div>
        <div id="sa-adult-note" style="display:none;background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint);margin-bottom:12px">
          ✅ Ставка по явке: 1-3 чел = 110к · 4-6 = 120к · 7+ = 130к
        </div>
        <button class="btn btn-primary btn-full" onclick="doSeniorAssignGroup()">Назначить</button>
      </div>

      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-weight:600;font-size:13px;margin-bottom:12px">Добавить второго тренера</div>
        <div class="form-group"><label>Группа (в вашем филиале)</label>
          <select id="sa2-group" onchange="onSa2GroupChange(this)">
            <option value="">— выберите —</option>
            ${groupOpts}
          </select></div>
        <div class="form-group"><label>Второй тренер</label>
          <select id="sa2-trainer">${trainerOpts}</select></div>
        <div id="sa2-rate-section">
          <div class="form-group"><label id="sa2-rate-label">Ставка за занятие (сум)</label>
            <input id="sa2-rate" type="number" value="75000" min="0"></div>
        </div>
        <div id="sa2-adult-note" style="display:none;background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint);margin-bottom:12px">
          ✅ Взрослая группа: ставка по явке (1-3=110к · 4-6=120к · 7+=130к)
        </div>
        <button class="btn btn-primary btn-full" onclick="doSeniorAssignSecond()">Добавить второго тренера</button>
      </div>`;

    // Init type change
    const sel = document.getElementById('sa-type');
    if (sel) onSaTypeChange(sel);
  } catch(e) { form.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

function onSaTypeChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const isAdult = opt?.dataset.type === 'adult';
  const rateSection = document.getElementById('sa-rate-section');
  const adultNote   = document.getElementById('sa-adult-note');
  if (rateSection) rateSection.style.display = isAdult ? 'none' : '';
  if (adultNote)   adultNote.style.display   = isAdult ? '' : 'none';
}

async function doSeniorAssignGroup() {
  const trainerId   = parseInt(document.getElementById('sa-trainer')?.value);
  const groupTypeId = parseInt(document.getElementById('sa-type')?.value);
  const branch      = document.getElementById('sa-branch')?.value;
  const opt         = document.querySelector('#sa-type option:checked');
  const groupName   = opt?.textContent||'';
  const isAdult     = opt?.dataset.type === 'adult';
  const rateType    = isAdult ? 'headcount' : 'percent';
  const rateValue   = isAdult ? 0 : (parseFloat(document.getElementById('sa-rate')?.value)||40);
  if (!trainerId||!groupTypeId||!branch) return toast('Заполните все поля','error');
  if (!_confirmUnclaimedTrainer('sa-trainer')) return;
  try {
    await DB.addTrainerGroup(trainerId, groupTypeId, branch, todayStr(), rateType, rateValue, null);
    DB.auditLog('group_assign', STATE.profile.id, STATE.profile.fio, trainerId, 'trainer_group',
      { group: groupName, trainer_id: trainerId }, branch);
    toast('✅ Назначено','success');
    await loadSeniorGroupsList();
    await renderSeniorAssignForm();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function onSa2GroupChange(sel) {
  const isAdult = sel.options[sel.selectedIndex]?.dataset.type === 'adult';
  const rateSection = document.getElementById('sa2-rate-section');
  const adultNote   = document.getElementById('sa2-adult-note');
  if (rateSection) rateSection.style.display = isAdult ? 'none' : '';
  if (adultNote)   adultNote.style.display   = isAdult ? '' : 'none';
}
async function doSeniorAssignSecond() {
  const groupId   = document.getElementById('sa2-group')?.value;
  const trainerId = parseInt(document.getElementById('sa2-trainer')?.value);
  if (!groupId||!trainerId) return toast('Выберите группу и тренера','error');
  if (!_confirmUnclaimedTrainer('sa2-trainer')) return;
  // Берём параметры у выбранной КОНКРЕТНОЙ группы — как в админском doAddSecondTrainer
  const g = window._saGroups?.[String(groupId)];
  if (!g) return toast('Группа не найдена, обновите страницу','error');
  const groupTypeId = g.group_type_id;
  const branch      = g.branch;
  const instanceId  = g.group_instance_id || null;
  const isAdult     = g.group_types?.type === 'adult';
  const rateType    = isAdult ? 'headcount' : 'flat';
  const rateValue   = isAdult ? 0 : (parseFloat(document.getElementById('sa2-rate')?.value)||75000);
  if (_pending.has(`sa2_${groupId}_${trainerId}`)) return;
  _pending.add(`sa2_${groupId}_${trainerId}`);
  try {
    // instanceId передаём в addTrainerGroup → второй тренер встаёт в ту же физическую группу
    await DB.addTrainerGroup(trainerId, groupTypeId, branch, todayStr(), rateType, rateValue, null, instanceId);
    DB.auditLog('group_assign_second', STATE.profile.id, STATE.profile.fio, trainerId, 'trainer_group',
      { group_id: groupId, instance: instanceId }, branch);
    toast('✅ Второй тренер добавлен','success');
    await loadSeniorGroupsList();
    await renderSeniorAssignForm();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(`sa2_${groupId}_${trainerId}`); }
}

// Цветная точка роли (суша=жёлтый, вода=синий, суша+вода=градиент)
function _groupRoleDot(role) {
  if (role==='суша')      return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#eab308;margin-right:4px;vertical-align:middle"></span>';
  if (role==='вода')      return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#3b82f6;margin-right:4px;vertical-align:middle"></span>';
  if (role==='суша+вода') return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:linear-gradient(90deg,#eab308 50%,#3b82f6 50%);margin-right:4px;vertical-align:middle"></span>';
  return '';
}

async function loadSeniorGroupsList() {
  const body=document.getElementById('groups-list'); if (!body) return;
  try {
    const groups = await DB.getTrainerGroups(STATE.profile.id);
    if (!groups.length) { body.innerHTML='<p class="hint">Нет назначенных групп</p>'; return; }
    const canEdit = ['admin','senior_trainer'].includes(STATE.profile.role);

    // Детские группы схлопываем по group_instance_id — одна карточка на физгруппу.
    // Роли (вода/суша) и расписание живут внутри хаба. Взрослые остаются как были.
    const children = groups.filter(g=>g.group_types?.type==='children');
    const adults   = groups.filter(g=>g.group_types?.type!=='children');

    const byInstance = {};
    children.forEach(g=>{ const k = g.group_instance_id || `solo_${g.id}`; (byInstance[k] ||= []).push(g); });

    const childCards = Object.values(byInstance).map(rows=>{
      const rep = rows[0];
      // Все роли тренера в этой физгруппе (вода + суша → две строки)
      const roles = [...new Set(rows.map(r=>r.role).filter(Boolean))];
      const dots  = roles.map(_groupRoleDot).join('');
      const roleLabel = roles.length ? ` (${roles.join(' + ')})` : '';
      // Расписание: показываем строки, у которых оно задано; иначе предупреждение
      const sched = rows.filter(r=>r.days_of_week?.length)
        .map(r=>`${r.days_of_week.join('/')}${r.session_time?' '+r.session_time:''}`);
      const schedLabel = sched.length
        ? `<span style="font-size:11px;background:rgba(124,58,237,.15);color:#a78bfa;padding:2px 8px;border-radius:6px;margin-top:4px;display:inline-block">${[...new Set(sched)].join(' · ')}</span>`
        : `<span style="font-size:11px;color:var(--hint);margin-top:4px;display:inline-block">⚠️ Расписание не задано — задайте внутри</span>`;
      return `<div class="staff-card" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div style="display:flex;justify-content:space-between;width:100%">
          <div>
            <div class="staff-fio">${dots}${rep.group_types?.name||'Группа'}${roleLabel}</div>
            <div class="staff-meta">${rep.branch} · с ${rep.subscription_start||'—'}</div>
            ${schedLabel}
          </div>
          <button class="btn btn-sm btn-primary" style="align-self:flex-start"
            onclick="renderGroupDetail('${rep.id}')">Открыть</button>
        </div>
      </div>`;
    });

    const adultCards = adults.map(g=>{
      const schedLabel = g.days_of_week?.length
        ? `<span style="font-size:11px;background:rgba(124,58,237,.15);color:#a78bfa;padding:2px 8px;border-radius:6px;margin-top:4px;display:inline-block">
            ${g.days_of_week.join('/')}${g.session_time?' '+g.session_time:''}</span>`
        : `<span style="font-size:11px;color:var(--hint);margin-top:4px;display:inline-block">⚠️ Расписание не задано</span>`;
      return `<div class="staff-card" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div style="display:flex;justify-content:space-between;width:100%">
          <div>
            <div class="staff-fio">${g.group_types?.name||'Группа'}</div>
            <div class="staff-meta">${g.branch} · с ${g.subscription_start||'—'}</div>
            ${schedLabel}
          </div>
          <button class="btn btn-sm btn-primary" style="align-self:flex-start"
            onclick="renderAdultGroupDetail('${g.id}')">Открыть</button>
        </div>
      </div>`;
    });

    body.innerHTML = [...childCards, ...adultCards].join('');
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// «Персонал» из списка групп старшего (Блок H): собираем instance-объект из его данных
// и кладём в window._glInstances в формате, совместимом с openGroupPersonnel координатора
async function openSeniorGroupPersonnel(tgId) {
  try {
    const groups = await DB.getTrainerGroups(STATE.profile.id);
    const g = groups.find(x=>String(x.id)===String(tgId));
    if (!g) return toast('Группа не найдена','error');
    const members = g.group_instance_id
      ? await DB.getGroupInstanceMembers(g.group_instance_id)
      : [{...g, profiles:{fio: STATE.profile.fio}}];
    const key = g.group_instance_id || `solo_${g.id}`;
    window._glInstances = window._glInstances || {};
    window._glInstances[key] = {
      gt: { id: g.group_type_id, name: g.group_types?.name||'Группа', type: g.group_types?.type||'children' },
      branch: g.branch, trainers: members, key,
    };
    openGroupPersonnel(key, new Date().toISOString().slice(0,7)+'-01');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Уровни детей в группе (справочник UI)
const GROUP_LEVELS = ['Подготовительный','Обучающий','Совершенствование','Спортивный'];
// Станции занятия (кто где был). «процент» убран из UI — процентникам ЗП идёт
// от пула независимо от присутствия (calcChildGroupPayroll). Старые 'процент'-записи
// в истории отображаются как есть, но новые не создаём.
const CONDUCTED_ROLES = ['суша','вода'];
const STATION_META = { 'суша': {icon:'☀️', dot:'#eab308'}, 'вода': {icon:'🌊', dot:'#3b82f6'} };

// ═══ ОБЩИЕ ВИЗУАЛЬНЫЕ ХЕЛПЕРЫ ХАБА ГРУППЫ (детские + взрослые — единый стиль) ═══
const groupHubInfoRow = (label, val) => `<div style="display:flex;justify-content:space-between;align-items:center">
  <span style="color:var(--hint);font-size:13px">${label}</span>${val}</div>`;
const groupHubSection = t => `<div style="font-size:12px;font-weight:600;color:var(--hint);text-transform:uppercase;letter-spacing:.4px;margin:6px 2px 2px">${t}</div>`;
const groupHubBigBtn = (icon, title, sub, onclick) => `
  <button class="staff-card" style="width:100%;cursor:pointer;text-align:left;display:flex;align-items:center;gap:12px;border:1px solid var(--border);background:var(--card)"
    onclick="${onclick}">
    <span style="font-size:22px">${icon}</span>
    <span style="flex:1;min-width:0">
      <span style="display:block;font-size:15px;font-weight:600;color:var(--text)">${title}</span>
      ${sub?`<span style="display:block;font-size:12px;color:var(--hint);margin-top:2px">${sub}</span>`:''}
    </span>
    <span style="color:var(--hint)">›</span>
  </button>`;
// Отображаемое имя подгруппы: '' = главная (метка mainLabel, напр. '15:00', иначе «Основная»)
function subLabel(s) { return s ? s : (window._gd?.mainLabel || 'Основная'); }

// ═══ ЭКРАН ГРУППЫ — ХАБ ═══
// Главный экран = шапка (филиал/дети/тренеры/должники) + крупные кнопки-входы.
// Каждое окно (занятие/дети/история) — отдельный экран через setScreen, назад — к хабу.
// Хаб ВСЕГДА переустанавливает точку возврата на вкладку «Группы» своей роли,
// поэтому внутренние экраны не затирают навигацию.
async function renderGroupDetail(groupId) {
  const role = curRole();
  const canPayroll = ['admin','senior_trainer'].includes(role);
  const _backToGroups = role==='admin'||role==='ceo'
    ? ()=>{ renderAdminApp('groups'); }
    : role==='senior_trainer'
    ? ()=>{ renderSeniorApp('groups'); }
    : ()=>{ renderTrainerShell('groups'); };
  navPush(_backToGroups);
  setupBack(_backToGroups);
  const month = new Date().toISOString().slice(0,7)+'-01';
  const today = todayStr();
  loading('Загрузка группы...');
  try {
    // Тип группы — взрослые уводим в отдельный обработчик
    const {data:groupInfo} = await sb().from('trainer_groups')
      .select('*, group_types(name,type)').eq('id',groupId).single();
    if (groupInfo?.group_types?.type !== 'children') {
      renderAdultGroupDetail(groupId); return;
    }
    const instanceId = groupInfo.group_instance_id;
    const branch = groupInfo.branch;
    const groupTypeId = groupInfo.group_type_id;
    const [clients, payments, members, subgData] = await Promise.all([
      instanceId ? DB.getGroupClientsByInstance(instanceId) : DB.getGroupClients(groupId),
      instanceId ? DB.getGroupPaymentsByInstance(instanceId, month) : DB.getGroupPayments(groupId, month),
      instanceId ? DB.getGroupInstanceMembers(instanceId) : Promise.resolve([groupInfo]),
      DB.getGroupSubgroups(instanceId, groupId),
    ]);
    const dbSubgroups = subgData.names||[];
    const paidMap = Object.fromEntries(payments.map(p=>[p.group_client_id, p]));
    const debtors = clients.filter(c=>!paidMap[c.id]?.paid);

    // Подгруппы: персистентные (group_subgroups) ∪ те, в которые уже переведены дети
    const subgroups = [...new Set([...dbSubgroups, ...clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
    const prevSub = (window._gd && String(window._gd.groupId)===String(groupId)) ? (window._gd.currentSubgroup||'') : '';

    // Кешируем контекст для onclick-обработчиков (без JSON в атрибутах)
    window._gd = { groupId, instanceId, branch, groupTypeId, month, today,
                   members, clients, paidMap, noteMap:{}, canPayroll, role,
                   groupName: groupInfo.group_types?.name||'Группа',
                   subgroups, dbSubgroups, mainLabel: subgData.mainLabel||null,
                   currentSubgroup: subgroups.includes(prevSub) ? prevSub : '',
                   conductedMap: {}, attMap: {}, _screen: 'hub' };

    const infoRow = groupHubInfoRow;
    const bigBtn = groupHubBigBtn;

    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">${window._gd.groupName}</div>
      <span style="font-size:12px;color:var(--hint)">${branch}</span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="staff-card" style="flex-direction:column;align-items:stretch;gap:8px;margin-bottom:14px">
        ${infoRow('Филиал', `<span style="font-weight:600;font-size:13px">${branch}</span>`)}
        ${infoRow('Детей', `<span style="font-weight:600;font-size:13px">${clients.length}${subgroups.length?` · подгрупп: ${subgroups.length+1}`:''}</span>`)}
        ${infoRow('Тренеров', `<span style="font-weight:600;font-size:13px">${new Set(members.map(t=>t.trainer_id)).size}</span>`)}
        ${infoRow('Должники', debtors.length
          ? `<button class="btn btn-sm" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#ef4444;font-size:12px"
              onclick="renderGroupDebtorsModal(${JSON.stringify(debtors.map(c=>c.name)).replace(/"/g,'&quot;')})">⚠️ ${debtors.length}</button>`
          : `<span style="font-weight:600;font-size:13px;color:#10b981">нет</span>`)}
      </div>
      ${(()=>{
        const grpHdr = t => `<div style="font-size:12px;font-weight:600;color:var(--hint);text-transform:uppercase;letter-spacing:.4px;margin:6px 2px 2px">${t}</div>`;
        return `
        ${grpHdr('Управление')}
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
          ${canPayroll?bigBtn('👥','Персонал','тренеры · ставки · расписание',`openSeniorGroupPersonnel('${groupId}')`):''}
          ${bigBtn('👶',`Список детей (${clients.length})`, subgroups.length?'по подгруппам · оплаты · заметки':'добавление · оплаты · заметки',`renderGroupChildrenScreen('${groupId}')`)}
        </div>

        ${grpHdr('Занятия')}
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
          ${bigBtn('✅','Занятие сегодня',`${fmtDate(today)} · кто на станции`,`renderGroupSessionScreen('${groupId}')`)}
          ${bigBtn('📅','История занятий','по датам · явка · кто проводил',`renderGroupHistoryScreen('${groupId}')`)}
          ${bigBtn('🔄','История замен','прошедшие и текущие замены',`renderGroupSubstitutionsHistory('${groupId}')`)}
        </div>

        ${grpHdr('Финансы и отчёты')}
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
          ${bigBtn('📊','Отчёт по детям','посещаемость · оплаты · Excel',`openGroupReport('${groupId}','${month}','detail')`)}
          ${canPayroll?bigBtn('💰','ЗП за месяц','авто-расчёт · премии/штрафы',`openGroupReport('${groupId}','${month}','detail','payroll')`):''}
        </div>

        ${grpHdr('Прочее')}
        <div style="display:flex;flex-direction:column;gap:8px">
          ${bigBtn('📦','Архив детей','вернуть ребёнка в группу',`renderGroupArchiveModal('${groupId}','${instanceId||''}')`)}
        </div>`;
      })()}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Перерисовать ТЕКУЩИЙ экран группы (хаб или внутреннее окно) после записи —
// чтобы действия из меню ребёнка/оплат не выкидывали со «Списка детей» на хаб
function refreshGroupScreen(groupId) {
  const g = window._gd;
  if (!g || String(g.groupId)!==String(groupId)) return renderGroupDetail(groupId);
  if (g._screen==='children') return renderGroupChildrenScreen(groupId);
  if (g._screen==='session')  return renderGroupSessionScreen(groupId);
  if (g._screen==='history')  return renderGroupHistoryScreen(groupId, g.historyMonth);
  if (g._screen==='subgroups') return openSubgroupManager(groupId, g._subgroupFrom);
  return renderGroupDetail(groupId);
}

// Контекст _gd обязателен для внутренних экранов; при прямом входе строим его через хаб
async function ensureGd(groupId) {
  if (window._gd && String(window._gd.groupId)===String(groupId)) return window._gd;
  await renderGroupDetail(groupId);
  return (window._gd && String(window._gd.groupId)===String(groupId)) ? window._gd : null;
}

// ═══ ЭКРАН «ЗАНЯТИЕ СЕГОДНЯ» (отметка детей + кто проводил, в разрезе подгрупп) ═══
async function renderGroupSessionScreen(groupId) {
  const g = await ensureGd(groupId); if (!g) return;
  g._screen = 'session';
  navPush(()=>renderGroupDetail(groupId));
  setupBack(()=>renderGroupDetail(groupId));
  loading('Загрузка занятия...');
  try {
    const [conducted, todayAtt, clients, subgData] = await Promise.all([
      g.instanceId ? DB.getGroupConductedByDate(g.instanceId, g.today) : Promise.resolve([]),
      g.instanceId ? DB.getGroupAttendanceByInstance(g.instanceId, g.today) : DB.getGroupAttendance(g.groupId, g.today),
      g.instanceId ? DB.getGroupClientsByInstance(g.instanceId) : DB.getGroupClients(g.groupId),
      DB.getGroupSubgroups(g.instanceId, g.groupId),
    ]);
    g.clients = clients;
    g.dbSubgroups = subgData.names||[];
    g.mainLabel = subgData.mainLabel||null;
    g.subgroups = [...new Set([...g.dbSubgroups, ...clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
    if (g.currentSubgroup && !g.subgroups.includes(g.currentSubgroup)) g.currentSubgroup = '';
    // Карта «кто проводил»: подгруппа → trainer_id → [роли]
    const cm = {};
    conducted.forEach(s=>{ const sg = s.subgroup||''; ((cm[sg] ||= {})[s.trainer_id] ||= []).push(s.conducted_role); });
    g.conductedMap = cm;
    g.attMap = Object.fromEntries(todayAtt.map(a=>[a.group_client_id, a.attended]));
    renderGroupSessionScreenHtml();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Пилюля тренера на станции (мультивыбор). Активная красится в ЦВЕТ СТАНЦИИ
// (суша=жёлтый, вода=синий) — цвет несёт смысл «отмечен на этой станции».
function _cndPillStyle(active, role) {
  const c = STATION_META[role]?.dot || 'var(--accent)';
  return active
    ? `font-size:13px;padding:7px 14px;border-radius:16px;background:${c};color:#fff;border:1px solid ${c};cursor:pointer;font-weight:600`
    : 'font-size:13px;padding:7px 14px;border-radius:16px;background:var(--card);color:var(--text);border:1px solid var(--border);cursor:pointer';
}
function _cndPill(trainerId, role, fio, active) {
  return `<button class="cnd-chip" id="cnd-${trainerId}-${role}" style="${_cndPillStyle(active, role)}"
    onclick="toggleConducted('${trainerId}','${role}')">${fio}${active?' ✓':''}</button>`;
}
// Уникальные тренеры (один человек может быть в двух строках инстанса: вода + суша)
function _uniqMembers(members) {
  const seen = new Set();
  return (members||[]).filter(t=>{ if (seen.has(t.trainer_id)) return false; seen.add(t.trainer_id); return true; });
}
// Сводка «кто где сегодня» по текущей подгруппе
function _cndSummaryInner(g, sub) {
  const cm = g.conductedMap[sub]||{};
  const uniq = _uniqMembers(g.members);
  const parts = CONDUCTED_ROLES.map(role=>{
    const names = uniq.filter(t=>(cm[t.trainer_id]||[]).includes(role)).map(t=>t.profiles?.fio||'—');
    if (!names.length) return '';
    return `<span style="white-space:nowrap">${STATION_META[role]?.icon||''} ${role[0].toUpperCase()+role.slice(1)} — ${names.join(', ')}</span>`;
  }).filter(Boolean);
  return parts.length ? parts.join(' &nbsp;·&nbsp; ') : '<span style="color:var(--hint)">пока никто не отмечен</span>';
}

function renderGroupSessionScreenHtml() {
  const g = window._gd; if (!g) return;
  const sub = g.currentSubgroup||'';
  const subClients = g.clients.filter(c=>(c.subgroup||'')===sub);
  const headcount = subClients.filter(c=>g.attMap[c.id]).length;
  const cm = g.conductedMap[sub]||{};
  const hasSubs = g.subgroups.length > 0;
  const segHtml = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      ${hasSubs ? ['', ...g.subgroups].map(s=>`<button class="btn btn-sm"
        style="font-size:12px;${s===sub?'background:var(--accent);color:#fff':'background:var(--card);border:1px solid var(--border)'}"
        onclick="switchSessionSubgroup('${encodeURIComponent(s)}')">${subLabel(s)}</button>`).join('') : ''}
      <button class="btn btn-sm" style="font-size:12px;background:var(--card);border:1px solid var(--border)${hasSubs?';margin-left:auto':''}"
        onclick="openSubgroupManager('${g.groupId}','session')">${hasSubs?'👥 Подгруппы':'➕ Подгруппа'}</button>
    </div>`;

  const uniqMembers = _uniqMembers(g.members);
  const stationCards = uniqMembers.length ? CONDUCTED_ROLES.map(role=>{
    const m = STATION_META[role]||{};
    const pills = uniqMembers.map(t=>_cndPill(t.trainer_id, role, t.profiles?.fio||'—', (cm[t.trainer_id]||[]).includes(role))).join('');
    return `<div class="staff-card" style="flex-direction:column;align-items:stretch;gap:10px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${m.dot}"></span>
        ${m.icon||''} ${role[0].toUpperCase()+role.slice(1)}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${pills}</div>
    </div>`;
  }).join('') : '<p class="hint">Тренеры не назначены</p>';

  setScreen(`<div class="app-header">
    ${backBtn()}
    <div class="app-title">Занятие сегодня</div>
    <span style="font-size:12px;color:var(--hint)">${fmtDate(g.today)}</span>
  </div>
  <div class="tab-content"><div class="tab-pad">
    ${segHtml}
    <div class="staff-card" style="flex-direction:column;align-items:stretch;gap:10px;margin-bottom:12px">
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1" onclick="renderGroupAttendance('${g.groupId}')">✅ Отметить детей</button>
        <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
          onclick="renderGroupSubstitutionModal('${g.groupId}')">🔄 Замена</button>
      </div>
      <div style="font-size:12px;color:var(--hint)">Отмечено сегодня${hasSubs?` (${subLabel(sub)})`:''}: <b>${headcount}</b> из ${subClients.length} дет.</div>
    </div>

    <div class="staff-card" style="background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.25);flex-direction:column;align-items:stretch;gap:6px;margin-bottom:10px">
      <div style="font-size:12px;color:var(--hint)">Кто где сегодня${hasSubs?` — ${subLabel(sub)}`:''}</div>
      <div id="cnd-summary" style="font-size:13px;line-height:1.6">${_cndSummaryInner(g, sub)}</div>
    </div>

    <button class="btn btn-sm btn-full" style="background:var(--card);border:1px solid var(--border);margin-bottom:12px"
      onclick="repeatLastConducted('${g.groupId}')">🔁 Повторить прошлое занятие</button>

    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Кто на какой станции${hasSubs?` — ${subLabel(sub)}`:''}</div>
    ${stationCards}
    <div style="font-size:11px;color:var(--hint);margin:2px 0 12px">Тап по имени — отметить на станции, повторный тап — снять. Можно отметить тренера на обеих станциях. Кого не было — не отмечайте. Процентникам ЗП идёт независимо от присутствия.</div>

    <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
      onclick="renderGroupAttendanceByDate('${g.groupId}')">📅 Посещаемость за другую дату</button>
  </div></div>`);
}

// «Повторить прошлое занятие» — переносит отметки последнего занятия на сегодня (текущая подгруппа)
async function repeatLastConducted(groupId) {
  const g = window._gd; if (!g || !g.instanceId) return toast('Недоступно для этой группы','error');
  if (_pending.has('repeatcnd')) return;
  _pending.add('repeatcnd');
  try {
    const {date, rows} = await DB.getLastConductedBefore(g.instanceId, g.today);
    if (!date || !rows.length) { toast('Нет прошлых занятий для копирования','info'); return; }
    const sub = g.currentSubgroup||'';
    const mine = rows.filter(r=>(r.subgroup||'')===sub && CONDUCTED_ROLES.includes(r.conducted_role));
    if (!mine.length) { toast('В прошлом занятии нет отметок для этой подгруппы','info'); return; }
    const headcount = g.clients.filter(c=>(c.subgroup||'')===sub && g.attMap[c.id]).length;
    for (const r of mine) {
      await DB.setGroupConducted(r.trainer_id, g.groupTypeId, g.branch, g.today, headcount, r.conducted_role, g.instanceId, sub);
    }
    toast(`Перенесено с ${fmtDate(date)} ✅`,'success');
    renderGroupSessionScreen(groupId); // перезагрузка с обновлёнными отметками
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('repeatcnd'); }
}

function switchSessionSubgroup(subEnc) {
  const g = window._gd; if (!g) return;
  g.currentSubgroup = decodeURIComponent(subEnc);
  renderGroupSessionScreenHtml();
}

// Переключатель «кто проводил» — UPSERT/DELETE в group_sessions с conducted_role + subgroup.
// БЕЗ полной перерисовки экрана: обновляем только нажатый чип (экран не прыгает, Блок F)
async function toggleConducted(trainerId, conductedRole) {
  const g = window._gd; if (!g) return;
  trainerId = parseInt(trainerId);
  const sub = g.currentSubgroup||'';
  const key = `conducted_${trainerId}_${g.today}_${conductedRole}_${sub}`;
  if (_pending.has(key)) return;
  _pending.add(key);
  try {
    // Роли независимы: тренер может вести и сушу, и воду в один день (две оплаты).
    // Подгруппы независимы: суша 16:00 + суша 17:00 = 2 занятия (instanceSessions считает строки)
    const subMap = (g.conductedMap[sub] ||= {});
    const roles = subMap[trainerId] || [];
    const already = roles.includes(conductedRole);
    // headcount = отмеченные дети ИМЕННО ЭТОЙ подгруппы за сегодня
    const headcount = g.clients.filter(c=>(c.subgroup||'')===sub && g.attMap[c.id]).length;
    if (already) {
      await DB.removeGroupConducted(trainerId, g.groupTypeId, g.branch, g.today, conductedRole, sub);
      subMap[trainerId] = roles.filter(r=>r!==conductedRole);
      if (!subMap[trainerId].length) delete subMap[trainerId];
      toast('Отметка снята','success');
    } else {
      await DB.setGroupConducted(trainerId, g.groupTypeId, g.branch, g.today, headcount, conductedRole, g.instanceId, sub);
      subMap[trainerId] = [...roles, conductedRole];
      toast('Отмечено ✅','success');
    }
    DB.auditLog('group_conducted', STATE.profile.id, STATE.profile.fio, trainerId, 'group_session',
      { date:g.today, role:conductedRole, removed:already, subgroup:sub }, g.branch);
    // Обновляем только нажатую пилюлю и сводку — без перерисовки экрана (не прыгает)
    const btn = document.getElementById(`cnd-${trainerId}-${conductedRole}`);
    if (btn) { const fio = g.members.find(t=>t.trainer_id===trainerId)?.profiles?.fio||'—';
               btn.outerHTML = _cndPill(trainerId, conductedRole, fio, !already); }
    const sumEl = document.getElementById('cnd-summary');
    if (sumEl) sumEl.innerHTML = _cndSummaryInner(g, sub);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(key); }
}

// ═══ ЭКРАН «СПИСОК ДЕТЕЙ» (плоский список или аккордеоны подгрупп) ═══
async function renderGroupChildrenScreen(groupId) {
  const g = await ensureGd(groupId); if (!g) return;
  g._screen = 'children';
  navPush(()=>renderGroupDetail(groupId));
  setupBack(()=>renderGroupDetail(groupId));
  loading('Загрузка списка...');
  try {
    const [clients, payments, notes, subgData] = await Promise.all([
      g.instanceId ? DB.getGroupClientsByInstance(g.instanceId) : DB.getGroupClients(g.groupId),
      g.instanceId ? DB.getGroupPaymentsByInstance(g.instanceId, g.month) : DB.getGroupPayments(g.groupId, g.month),
      DB.getGroupProgressNotes(g.groupId, g.month),
      DB.getGroupSubgroups(g.instanceId, g.groupId),
    ]);
    g.clients = clients;
    g.paidMap = Object.fromEntries(payments.map(p=>[p.group_client_id, p]));
    g.noteMap = Object.fromEntries(notes.map(n=>[n.group_client_id, n]));
    g.dbSubgroups = subgData.names||[];
    g.mainLabel = subgData.mainLabel||null;
    g.subgroups = [...new Set([...g.dbSubgroups, ...clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
    renderGroupChildrenScreenHtml();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function _childCardHtml(c) {
  const g = window._gd;
  const pay = g.paidMap?.[c.id]; const paid = pay?.paid; const note = g.noteMap?.[c.id];
  return `<div class="staff-card" onclick="openChildMenu('${c.id}')" style="cursor:pointer">
    <div style="flex:1;min-width:0">
      <div class="staff-fio">${c.name}</div>
      <div class="staff-meta">${c.level} · ${fmt(c.monthly_price)} сум/мес${note?.note?' · 📝':''}</div>
    </div>
    <span style="font-size:11px;padding:3px 8px;border-radius:12px;
      background:${paid?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)'};color:${paid?'#10b981':'#ef4444'}">
      ${paid?'Оплачен':'Не оплачен'}</span>
    <span style="font-size:14px;color:var(--hint);margin-left:8px">⋯</span>
  </div>`;
}

function renderGroupChildrenScreenHtml() {
  const g = window._gd; if (!g) return;
  // ОДИН общий список без деления по подгруппам (подгруппа правится в меню ребёнка / менеджере подгрупп)
  const listHtml = g.clients.length ? g.clients.map(_childCardHtml).join('') : '<p class="hint">Детей пока нет</p>';
  setScreen(`<div class="app-header">
    ${backBtn()}
    <div class="app-title">Список детей</div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-sm" style="font-size:12px;background:var(--card);border:1px solid var(--border)"
        onclick="openSubgroupManager('${g.groupId}','children')">👥 Подгруппы</button>
      <button class="btn btn-sm btn-primary" style="font-size:12px"
        onclick="renderAddGroupClientModal('${g.groupId}')">+ Ребёнок</button>
    </div>
  </div>
  <div class="tab-content"><div class="tab-pad">
    ${listHtml}
  </div></div>`);
}

// ═══ МЕНЕДЖЕР ПОДГРУПП — общий для «Список детей» и «Занятие сегодня» ═══
// Создать подгруппу + раскидать детей. Данные персистентны (group_subgroups + group_clients.subgroup),
// поэтому правки видны на обоих экранах и не конфликтуют.
async function openSubgroupManager(groupId, from='children') {
  const g = await ensureGd(groupId); if (!g) return;
  g._subgroupFrom = from;
  g._screen = 'subgroups';
  // Свежие дети + подгруппы
  loading('Загрузка подгрупп...');
  try {
    const [clients, subgData] = await Promise.all([
      g.instanceId ? DB.getGroupClientsByInstance(g.instanceId) : DB.getGroupClients(g.groupId),
      DB.getGroupSubgroups(g.instanceId, g.groupId),
    ]);
    g.clients = clients;
    g.dbSubgroups = subgData.names||[];
    g.mainLabel = subgData.mainLabel||null;
    g.subgroups = [...new Set([...g.dbSubgroups, ...clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
    renderSubgroupManagerHtml();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function _subgroupBack(g) {
  return g._subgroupFrom==='session'
    ? ()=>renderGroupSessionScreen(g.groupId)
    : ()=>renderGroupChildrenScreen(g.groupId);
}
function renderSubgroupManagerHtml() {
  const g = window._gd; if (!g) return;
  setupBack(_subgroupBack(g));
  navPush(_subgroupBack(g));
  const subOptions = (cur) => ['', ...g.subgroups]
    .map(s=>`<option value="${encodeURIComponent(s)}" ${s===(cur||'')?'selected':''}>${subLabel(s)}</option>`).join('');
  const childRows = g.clients.length ? g.clients.map(c=>`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name||'Без имени'}</div>
        ${c.level?`<div style="font-size:11px;color:var(--hint)">${c.level}</div>`:''}
      </div>
      <select onchange="quickAssignSubgroup('${c.id}',this.value)"
        style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 8px;color:var(--text);font-size:13px;flex-shrink:0;max-width:140px">
        ${subOptions(c.subgroup)}
      </select>
    </div>`).join('') : '<p class="hint">Детей пока нет</p>';
  const counts = {};
  g.clients.forEach(c=>{ const s=c.subgroup||''; counts[s]=(counts[s]||0)+1; });
  // Список подгрупп с переименованием (включая главную '' — её метку храним отдельно)
  const subEditRows = ['', ...g.subgroups].map(s=>`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:9px 12px">
      <span style="font-size:14px">${subLabel(s)}${s===''?' <span style="font-size:11px;color:var(--hint)">(главная)</span>':''} · <span style="color:var(--hint)">${counts[s]||0} дет.</span></span>
      <button class="btn btn-sm" style="background:var(--bg);border:1px solid var(--border);font-size:12px"
        onclick="promptRenameSubgroup('${encodeURIComponent(s)}')">✏️ Переименовать</button>
    </div>`).join('');
  setScreen(`<div class="app-header">
    ${backBtn()}
    <div class="app-title">Подгруппы</div>
    <button class="btn btn-sm btn-primary" style="font-size:12px" onclick="promptAddSubgroup()">+ подгруппа</button>
  </div>
  <div class="tab-content"><div class="tab-pad">
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Подгруппы</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">${subEditRows}</div>
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Кто в какой подгруппе</div>
    <div style="display:flex;flex-direction:column;gap:8px">${childRows}</div>
    <p class="hint" style="margin-top:12px">Можно переименовать любую подгруппу, включая главную (удобно ставить время, напр. «15:00»). Изменения сразу видны в «Сегодня» и «Список детей».</p>
  </div></div>`);
}
function _subgroupCountsChips(g) {
  const counts = {};
  g.clients.forEach(c=>{ const s=c.subgroup||''; counts[s]=(counts[s]||0)+1; });
  return ['', ...g.subgroups].map(s=>`<span style="font-size:12px;padding:5px 10px;border-radius:14px;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.25);color:var(--text)">
    ${subLabel(s)} <b style="color:var(--accent)">${counts[s]||0}</b></span>`).join('');
}
async function quickAssignSubgroup(childId, encSub) {
  const g = window._gd; if (!g) return;
  const sub = decodeURIComponent(encSub);
  if (_pending.has(`qsub_${childId}`)) return;
  _pending.add(`qsub_${childId}`);
  try {
    await DB.updateGroupClient(childId, {subgroup: sub});
    const c = g.clients.find(x=>String(x.id)===String(childId)); if (c) c.subgroup = sub;
    // Обновляем только строку-сводку счётчиков — без перерисовки (не сбрасывает скролл)
    const el = document.getElementById('subg-counts');
    if (el) el.innerHTML = _subgroupCountsChips(g);
  } catch(e) { toast('Ошибка сохранения','error'); console.error(e); }
  finally { _pending.delete(`qsub_${childId}`); }
}

// Создание подгруппы = появление опции в списках (дети добавляются/переводятся с этим subgroup)
// prompt() в Telegram WebApp заблокирован — используем модалку с input.
function promptAddSubgroup() {
  const g = window._gd; if (!g) return;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новая подгруппа</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название (например, 16:00)</label>
      <input id="new-subgroup-name" type="text" placeholder="16:00" autocomplete="off"
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)"
        onkeydown="if(event.key==='Enter')doAddSubgroup()"></div>
    <button class="btn btn-primary btn-full" onclick="doAddSubgroup()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
  setTimeout(()=>document.getElementById('new-subgroup-name')?.focus(), 50);
}
async function doAddSubgroup() {
  const g = window._gd; if (!g) return;
  const name = (document.getElementById('new-subgroup-name')?.value||'').trim();
  if (!name) return toast('Введите название','error');
  if (g.subgroups.includes(name)) return toast('Такая подгруппа уже есть','error');
  if (_pending.has('addsubg')) return;
  _pending.add('addsubg');
  try {
    await DB.addGroupSubgroup(g.instanceId, g.groupId, name, STATE.profile?.id);
    (g.dbSubgroups ||= []).push(name);
    g.subgroups = [...new Set([...g.subgroups, name])].sort();
    document.querySelector('.modal-overlay')?.remove();
    toast(`Подгруппа «${name}» добавлена — переведите в неё детей`,'success');
    if (g._screen==='subgroups') renderSubgroupManagerHtml();
    else if (g._screen==='children') renderGroupChildrenScreenHtml();
    else if (g._screen==='session') renderGroupSessionScreenHtml();
  } catch(e) { toast('Ошибка сохранения подгруппы','error'); console.error(e); }
  finally { _pending.delete('addsubg'); }
}

// Переименование подгруппы (включая главную '' → её отображаемая метка)
function promptRenameSubgroup(encS) {
  const g = window._gd; if (!g) return;
  const s = decodeURIComponent(encS);
  const isMain = s==='';
  const cur = isMain ? (g.mainLabel||'') : s;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${isMain?'Название главной подгруппы':'Переименовать подгруппу'}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>${isMain?'Напр. 15:00 (пусто = «Основная»)':'Новое название'}</label>
      <input id="ren-subgroup-name" type="text" value="${cur}" placeholder="15:00" autocomplete="off"
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)"
        onkeydown="if(event.key==='Enter')doRenameSubgroup('${encS}')"></div>
    <button class="btn btn-primary btn-full" onclick="doRenameSubgroup('${encS}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
  setTimeout(()=>document.getElementById('ren-subgroup-name')?.focus(), 50);
}
async function doRenameSubgroup(encS) {
  const g = window._gd; if (!g) return;
  const s = decodeURIComponent(encS);
  const isMain = s==='';
  const val = (document.getElementById('ren-subgroup-name')?.value||'').trim();
  if (!isMain && !val) return toast('Введите название','error');
  if (val && val!==s && (g.subgroups.includes(val) || val===(g.mainLabel||'')))
    return toast('Такое название уже есть','error');
  if (_pending.has('rensubg')) return;
  _pending.add('rensubg');
  try {
    if (isMain) {
      await DB.setMainSubgroupLabel(g.instanceId, g.groupId, val);
      g.mainLabel = val||null;
    } else {
      await DB.renameGroupSubgroup(g.instanceId, g.groupId, s, val);
      g.dbSubgroups = (g.dbSubgroups||[]).map(x=>x===s?val:x);
      g.clients.forEach(c=>{ if ((c.subgroup||'')===s) c.subgroup=val; });
      g.subgroups = [...new Set([...g.dbSubgroups, ...g.clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
      if (g.currentSubgroup===s) g.currentSubgroup=val;
    }
    document.querySelector('.modal-overlay')?.remove();
    toast('Переименовано ✅','success');
    renderSubgroupManagerHtml();
  } catch(e) { toast('Ошибка переименования','error'); console.error(e); }
  finally { _pending.delete('rensubg'); }
}

// Модал «Перевести в подгруппу…» из меню ребёнка
function renderMoveSubgroupModal(clientId) {
  const g = window._gd; if (!g) return;
  const c = g.clients.find(x=>String(x.id)===String(clientId)); if (!c) return;
  const cur = c.subgroup||'';
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Подгруппа — ${c.name}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Перевести в</label>
      <select id="msg-sub">
        <option value="" ${cur===''?'selected':''}>${subLabel('')}</option>
        ${g.subgroups.map(s=>`<option value="${encodeURIComponent(s)}" ${s===cur?'selected':''}>${s}</option>`).join('')}
      </select></div>
    <button class="btn btn-primary btn-full" onclick="doMoveSubgroup('${clientId}')">Перевести</button>
  </div>`;
  document.body.appendChild(m);
}
async function doMoveSubgroup(clientId) {
  const g = window._gd; if (!g) return;
  const sub = decodeURIComponent(document.getElementById('msg-sub')?.value||'');
  if (_pending.has(`movesub_${clientId}`)) return;
  _pending.add(`movesub_${clientId}`);
  try {
    await DB.updateGroupClient(clientId, {subgroup: sub});
    document.querySelector('.modal-overlay')?.remove();
    toast('Переведён ✅','success');
    refreshGroupScreen(g.groupId);
  } catch(e) { toast('Ошибка (подгруппы заработают после обновления базы)','error'); console.error(e); }
  finally { _pending.delete(`movesub_${clientId}`); }
}

// ═══ ЭКРАН «ИСТОРИЯ ЗАНЯТИЙ» (Блок I): даты ↓, месячная навигация, явка/кто проводил/замены ═══
async function renderGroupHistoryScreen(groupId, monthStr) {
  const g = await ensureGd(groupId); if (!g) return;
  g._screen = 'history';
  if (!monthStr) monthStr = g.month;
  g.historyMonth = monthStr;
  navPush(()=>renderGroupDetail(groupId));
  setupBack(()=>renderGroupDetail(groupId));
  loading('Загрузка истории...');
  try {
    // Один запрос за месяц: явка + group_sessions (кто проводил) + замены + клиенты (подгруппы)
    const report = await DB.getGroupMonthReport(groupId, monthStr);
    const {clients, attendance, instanceSessions, substitutions, trainers} = report;
    const fioByTrainer = Object.fromEntries(trainers.map(t=>[t.trainer_id, t.profiles?.fio||'—']));
    const subByClient = Object.fromEntries(clients.map(c=>[c.id, c.subgroup||'']));
    const hasSubs = clients.some(c=>(c.subgroup||'')!=='');
    const days = {}; // date → {att:{sub:n}, total:{sub:n}, conducted:[], subs:[]}
    const day = d => (days[d] ||= {att:{}, total:{}, conducted:[], subs:[]});
    attendance.forEach(a=>{
      const d = day(a.session_date); const sg = subByClient[a.group_client_id]||'';
      d.total[sg] = (d.total[sg]||0)+1;
      if (a.attended) d.att[sg] = (d.att[sg]||0)+1;
    });
    instanceSessions.filter(s=>s.conducted_role).forEach(s=>day(s.session_date).conducted.push(s));
    (substitutions||[]).forEach(s=>day(s.session_date).subs.push(s));
    const dates = Object.keys(days).sort().reverse();
    const monthLabel = new Date(monthStr).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
    const isCurrentMonth = monthStr === new Date().toISOString().slice(0,7)+'-01';
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">История занятий</div>
      <span style="font-size:12px;color:var(--hint)">${g.groupName||''}</span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="section-header"><h3>${monthLabel}</h3>
        <div class="month-nav">
          <button onclick="renderGroupHistoryScreen('${groupId}','${prevMonthStr(monthStr)}')">‹</button>
          <button ${isCurrentMonth?'disabled':''} onclick="renderGroupHistoryScreen('${groupId}','${nextMonthStr(monthStr)}')">›</button>
        </div>
      </div>
      ${!dates.length?'<p class="hint">Занятий за этот месяц нет</p>':dates.map(date=>{
        const d = days[date];
        const attTotal = Object.values(d.att).reduce((s,v)=>s+v,0);
        const totTotal = Object.values(d.total).reduce((s,v)=>s+v,0);
        const attLine = hasSubs && totTotal
          ? Object.keys(d.total).sort().map(sg=>`${sg||'осн.'}: ${d.att[sg]||0}/${d.total[sg]||0}`).join(' · ')
          : '';
        const condLine = d.conducted.length
          ? d.conducted.map(s=>`${fioByTrainer[s.trainer_id]||'—'} <span style="color:var(--hint)">(${s.conducted_role}${(s.subgroup||'')?` · ${s.subgroup}`:''})</span>`).join(', ')
          : '<span style="color:var(--hint)">не отмечено</span>';
        const subsLine = d.subs.length
          ? d.subs.map(s=>`${s.substitute?.fio||'?'} вместо ${s.original?.fio||'?'}${s.status!=='approved'?' ⏳':''}`).join(', ')
          : '';
        return `<div class="history-item">
          <div class="hi-main" style="justify-content:space-between">
            <span class="hi-client">${fmtDate(date)}</span>
            <span style="font-size:13px;font-weight:600;color:${attTotal===totTotal&&totTotal>0?'#10b981':'#f59e0b'}">${attTotal} / ${totTotal} дет.</span>
          </div>
          ${attLine?`<div style="font-size:12px;color:var(--hint);margin-top:4px">${attLine}</div>`:''}
          <div style="font-size:12px;margin-top:4px">Проводил: ${condLine}</div>
          ${subsLine?`<div style="font-size:12px;margin-top:4px;color:#a78bfa">🔄 ${subsLine}</div>`:''}
          ${totTotal?`<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
            <button class="btn btn-sm" style="font-size:11px;background:var(--card);border:1px solid var(--border)"
              onclick="renderGroupAttendanceEdit('${groupId}','${date}')">✏️ Изменить</button>
            <button class="btn btn-sm btn-danger" style="font-size:11px"
              onclick="doDeleteAttendanceDay('${groupId}','${date}')">🗑</button>
          </div>`:''}
        </div>`;
      }).join('')}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Меню функций по ребёнку (тап в списке детей)
function openChildMenu(clientId) {
  const g = window._gd; if (!g) return;
  const c = g.clients.find(x=>String(x.id)===String(clientId)); if (!c) return;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${c.name}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div style="font-size:12px;color:var(--hint);margin-bottom:12px">${c.level} · ${fmt(c.monthly_price)} сум/мес${c.age?` · ${c.age}л`:''}</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-full btn-primary"
        onclick="this.closest('.modal-overlay').remove();toggleGroupPayment('${g.groupId}','${c.id}',true,${c.monthly_price||0},'${g.month}')">💳 Оплата абонемента</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();doToggleUnpay('${c.id}')">✕ Снять оплату</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderGroupNoteModal('${g.groupId}','${c.id}','${encodeURIComponent(c.name)}','${g.month}','')">📝 Заметка</button>
      <div class="form-group" style="margin:0"><label style="font-size:12px">Уровень</label>
        <select onchange="updateGroupClientLevel('${c.id}',this.value)">
          ${GROUP_LEVELS.map(l=>`<option ${l===c.level?'selected':''}>${l}</option>`).join('')}
        </select></div>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderEditGroupClientModal('${c.id}','${encodeURIComponent(c.name)}',${c.age||0},${c.monthly_price||0},'${g.groupId}')">✏️ Редактировать</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderChildAttendanceHistory('${c.id}','${encodeURIComponent(c.name)}')">📅 История посещений</button>
      ${g.subgroups?.length?`<button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderMoveSubgroupModal('${c.id}')">👥 Перевести в подгруппу…${(c.subgroup||'')?` <span style="font-size:11px;color:var(--hint)">(сейчас: ${c.subgroup})</span>`:''}</button>`:''}
      <button class="btn btn-full btn-danger"
        onclick="this.closest('.modal-overlay').remove();archiveGroupClientConfirm('${c.id}','${encodeURIComponent(c.name)}','${g.groupId}')">📦 Архив / Удалить</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}

// Снять оплату за текущий месяц без модала суммы
async function doToggleUnpay(clientId) {
  const g = window._gd; if (!g) return;
  try {
    await DB.setGroupPayment(g.groupId, clientId, g.month, 0, false, null, null, g.instanceId||null);
    toast('Оплата снята','success');
    refreshGroupScreen(g.groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// История посещений конкретного ребёнка
async function renderChildAttendanceHistory(clientId, nameEnc) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal"><div class="modal-header"><h3>Посещения — ${name}</h3>
    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div id="cah-body"><div class="center-screen"><div class="spinner"></div></div></div></div>`;
  document.body.appendChild(m);
  try {
    const hist = await DB.getGroupClientAttendanceHistory(clientId);
    const body = document.getElementById('cah-body');
    if (!hist.length) { body.innerHTML='<p class="hint">Записей нет</p>'; return; }
    const present = hist.filter(h=>h.attended).length;
    body.innerHTML=`<div style="font-size:12px;color:var(--hint);margin-bottom:10px">Был: <b>${present}</b> из ${hist.length}</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${hist.map(h=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px">${fmtDate(h.session_date)}</span>
          <span style="font-size:13px;color:${h.attended?'#10b981':'#ef4444'}">${h.attended?'✓ был':'✕ не был'}</span>
        </div>`).join('')}
      </div>`;
  } catch(e) { document.getElementById('cah-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// Меню функций по тренеру (только admin/senior_trainer)
function openTrainerMenu(tgId) {
  const g = window._gd; if (!g || !g.canPayroll) return;
  const t = g.members.find(x=>String(x.id)===String(tgId)); if (!t) return;
  const fio = t.profiles?.fio||'—';
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${fio}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div style="font-size:12px;color:var(--hint);margin-bottom:4px">${t.role||'тренер'} · текущая ставка: ${t.rate_type==='percent'?(t.rate_value||0)+'%':t.rate_type==='flat'?fmt(t.rate_value||75000)+' сум/зан':'по явке'}</div>
    <div id="rate-hist-${t.id}" style="font-size:11px;color:var(--hint);margin-bottom:12px"></div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${t.rate_type!=='headcount'?`<button class="btn btn-full btn-primary"
        onclick="this.closest('.modal-overlay').remove();renderTrainerRateModal('${t.id}','${t.rate_type||'percent'}',${t.rate_value||0})">💰 Ставка / процент</button>`:''}
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderLeaderFeeModal('${g.groupId}','${encodeURIComponent(t.leader_name||'')}',${t.leader_fee_percent||0})">👑 Руководитель группы</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderGroupSubstitutionModal('${g.groupId}')">🔄 Замена</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderTrainerGroupSessions('${t.trainer_id}','${encodeURIComponent(fio)}')">📅 Его занятия за месяц</button>
      <button class="btn btn-full btn-danger"
        onclick="this.closest('.modal-overlay').remove();doUnassignGroup(${t.id})">Убрать из группы</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  // История ставок (2-3 последние записи); до миграции вернёт [] — блок просто не покажется
  if (t.rate_type!=='headcount') DB.getRateHistoryByTg(t.id, 3).then(hist=>{
    const box = document.getElementById(`rate-hist-${t.id}`);
    if (!box || !hist.length) return;
    box.innerHTML = `<div style="font-weight:600;margin-bottom:2px">История ставки:</div>`+
      hist.map(h=>`<div>с ${fmtDate(h.effective_from)} — ${h.rate_type==='percent'?(h.rate_value||0)+'%':fmt(h.rate_value||0)+' сум/зан'}</div>`).join('');
  }).catch(()=>{});
}

// Модал пересмотра ставки/процента тренера в группе (+ период применения → rate_history)
function renderTrainerRateModal(tgId, rateType, rateValue) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Ставка тренера</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Тип</label>
      <select id="tr-type" onchange="document.getElementById('tr-label').textContent=this.value==='percent'?'Процент (%)':'Сумма за занятие (сум)'">
        <option value="percent" ${rateType==='percent'?'selected':''}>Процент (%)</option>
        <option value="flat" ${rateType==='flat'?'selected':''}>Ставка за занятие</option>
      </select></div>
    <div class="form-group"><label id="tr-label">${rateType==='percent'?'Процент (%)':'Сумма за занятие (сум)'}</label>
      <input id="tr-val" type="number" min="0" value="${rateValue||0}"></div>
    <div class="form-group"><label>Применить</label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">
        <input type="radio" name="tr-eff" value="cur_month" checked> За весь текущий месяц</label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">
        <input type="radio" name="tr-eff" value="prev_month"> За прошлый месяц</label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">
        <input type="radio" name="tr-eff" value="today"> С этого дня</label>
    </div>
    <p class="hint" style="margin-bottom:12px">ЗП пересчитается автоматически: занятия — по ставке на дату занятия, оплаты — по проценту на дату оплаты.</p>
    <button class="btn btn-primary btn-full" onclick="doSaveTrainerRateMenu('${tgId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveTrainerRateMenu(tgId) {
  const type = document.getElementById('tr-type')?.value||'percent';
  const val  = parseFloat(document.getElementById('tr-val')?.value)||0;
  const eff  = document.querySelector('input[name="tr-eff"]:checked')?.value||'cur_month';
  // Даты строим локально (НЕ toISOString — UTC сдвигает день назад)
  const now = new Date();
  const dstr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const effectiveFrom =
    eff==='today'      ? dstr(now) :
    eff==='prev_month' ? dstr(new Date(now.getFullYear(), now.getMonth()-1, 1)) :
                         dstr(new Date(now.getFullYear(), now.getMonth(), 1));
  if (_pending.has(`rate_${tgId}`)) return;
  _pending.add(`rate_${tgId}`);
  try {
    // История ставок — основа ретро-пересчёта; до миграции таблицы нет: пишем только текущую ставку
    try { await DB.addRateHistory(tgId, type, val, effectiveFrom, STATE.profile.id); }
    catch(e) { console.warn('[addRateHistory] не записана (миграция ещё не применена?)', e?.message||e); }
    await DB.updateTrainerGroupRate(tgId, type, val);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Ставка сохранена','success');
    invalidateCache('groupTypes');
    if (window._gd) refreshGroupScreen(window._gd.groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(`rate_${tgId}`); }
}
// Занятия тренера за текущий месяц (из меню тренера)
async function renderTrainerGroupSessions(trainerId, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const now = new Date();
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal"><div class="modal-header"><h3>Занятия — ${fio}</h3>
    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div id="tgs-body"><div class="center-screen"><div class="spinner"></div></div></div></div>`;
  document.body.appendChild(m);
  try {
    const sessions = await DB.getGroupSessions(parseInt(trainerId), now.getFullYear(), now.getMonth()+1);
    const body = document.getElementById('tgs-body');
    if (!sessions.length) { body.innerHTML='<p class="hint">Занятий за месяц нет</p>'; return; }
    body.innerHTML=`<div style="font-size:12px;color:var(--hint);margin-bottom:8px">Всего: <b>${sessions.length}</b></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${sessions.map(s=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px">${fmtDate(s.session_date)}</span>
          <span style="font-size:12px;color:var(--hint)">${s.conducted_role||(s.group_types?.name||'')} · ${s.headcount||0} дет.</span>
        </div>`).join('')}
      </div>`;
  } catch(e) { document.getElementById('tgs-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// ============================================================
// SECTION: SENIOR:REPORT — renderBranchReport, loadBranchSummary
// ============================================================
async function renderBranchReport() {
  const branches=STATE.profile.branches||[];
  const now=new Date(); let year=now.getFullYear(),month=now.getMonth()+1;
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Отчёт по филиалу</h3>
      <div class="month-nav">
        <button id="prev-br">‹</button><span id="br-month">${fmtMY(year,month)}</span><button id="next-br">›</button>
      </div>
    </div>
    ${branches.length>1?`<div class="form-group"><label>Филиал</label>
      <select id="branch-filter">${branches.map(b=>`<option>${b}</option>`).join('')}</select></div>`:''}
    <div id="branch-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  const getBr=()=>document.getElementById('branch-filter')?.value||branches[0]||'';
  const load=()=>loadBranchSummary(year,month,getBr());
  document.getElementById('prev-br')?.addEventListener('click',()=>{if(month===1){year--;month=12;}else month--;document.getElementById('br-month').textContent=fmtMY(year,month);load();});
  document.getElementById('next-br')?.addEventListener('click',()=>{if(month===12){year++;month=1;}else month++;document.getElementById('br-month').textContent=fmtMY(year,month);load();});
  document.getElementById('branch-filter')?.addEventListener('change',load);
  await load();
}
async function loadBranchSummary(year,month,branch) {
  const body=document.getElementById('branch-body'); if (!body) return;
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const data=await DB.getSummary(year,month,branch);
    body.innerHTML=renderSummaryTable(data,year,month,false);
    body.innerHTML+=`<button class="btn btn-sm" style="margin-top:12px;width:100%"
      onclick="doExportSummary(${year},${month},'${branch}')">⬇️ Скачать Excel</button>`;
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// → продолжение: app.trainer.js → app.admin.js → app.exec.js → app.shared.js (порядок в index.html)
