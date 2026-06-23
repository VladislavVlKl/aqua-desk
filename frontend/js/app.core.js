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
    // JWT-аутентификация. В режиме CONFIG.JWT_MODE='off' (прод) — мгновенный no-op.
    // Никогда не бросает: при любой ошибке приложение продолжает работать под anon.
    if (typeof ensureJwtSession === 'function') { try { await ensureJwtSession(); } catch(e){} }
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
