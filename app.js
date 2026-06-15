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
async function cached(key, fn, ttl=300000) {
  const now = Date.now();
  if (_cache[key] && now - _cache[key].ts < ttl) return _cache[key].val;
  const val = await fn();
  _cache[key] = {val, ts: now};
  return val;
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
function goBack() {
  if (STATE._backFn) { const f=STATE._backFn; STATE._backFn=null; f(); return; }
  const role = STATE.profile?.role;
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

// ── ИНИЦИАЛИЗАЦИЯ ─────────────────────────────
// ============================================================
// SECTION: CORE:INIT — init(), enterApp()
// ============================================================
async function init() {
  if (window.Telegram?.WebApp) { Telegram.WebApp.ready(); Telegram.WebApp.expand(); }
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

// ── ТРЕНЕР: ОБОЛОЧКА ──────────────────────────
// ============================================================
// SECTION: TRAINER:SHELL — renderTrainerApp, renderTrainerShell, switchTab
// ============================================================
async function renderTrainerApp() {
  setupBack(null);
  renderTrainerShell('home');
  setTimeout(checkNoteBadge, 1500);
  setTimeout(checkInAppNotifications, 2000);
}

function renderTrainerShell(tab) {
  setupBack(null);
  STATE.currentTab=tab;
  setScreen(`
    <div class="app-header">
      <div><div class="app-title">🏋️ AquaDesk</div>
        <div class="app-sub">${STATE.profile.fio}</div></div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="btn-icon" id="note-badge" onclick="renderOverdueNotesModal(window._overdueMap, window._clientsList)" style="position:relative">📝</button>
      <button class="btn-icon" onclick="openSchedule()">📅</button>
      <button class="btn-icon" onclick="renderHelpModal()">?</button>
      <button class="btn-icon" onclick="renderTrainerEditProfile()">👤</button>
      <button class="btn-icon" id="notif-bell" onclick="renderInAppNotifications()" style="position:relative">🔔<span id="notif-count" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center"></span></button>
    </div>
  </div>
  <div id="tab-content" class="tab-content"></div>
  <nav class="bottom-nav">
    <button class="nav-btn" onclick="switchTab('home')"><span>🏠</span>Главная</button>
      <button class="nav-btn" onclick="switchTab('clients')"><span>👥</span>Клиенты</button>
      <button class="nav-btn" onclick="switchTab('today')"><span>✅</span>Сегодня</button>
      <button class="nav-btn" onclick="switchTab('schedule')"><span>📅</span>Расписание</button>
      <button class="nav-btn" onclick="switchTab('report')"><span>📊</span>Отчёт</button>
<button class="nav-btn" onclick="switchTab('events')"><span>🏆</span>События</button>
      <button class="nav-btn" onclick="switchTab('groups')"><span>🏊</span>Группы</button>
    </nav>`);
  switchTab(tab);
}

function switchTab(tab) {
  STATE.currentTab=tab;
  const tabs=['home','clients','today','schedule','report','events','groups'];
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',tabs[i]===tab));
  if (tab==='home')     renderHomeTab();
  if (tab==='clients')  renderClientsTab();
  if (tab==='today')    renderTodayTab();
  if (tab==='schedule') renderScheduleTab();
  if (tab==='report')   renderReportTab();
  if (tab==='events')   renderEventsTab();
  if (tab==='groups')   renderSeniorGroups();
}

// Проверяем наличие незакрытых конспектов — батч запрос
// ============================================================
// SECTION: TRAINER:HOME — renderHomeTab, checkNoteBadge, doLogDutyHome
// ============================================================
async function checkNoteBadge() {
  try {
    const overdueMap = await DB.getOverdueNotesBatch(STATE.profile.id);
    const pending = Object.values(overdueMap).reduce((s,n)=>s+n, 0);
    window._overdueMap = overdueMap;
    const badge = document.getElementById('note-badge');
    if (badge) {
      badge.innerHTML = pending > 0
        ? `📝<span style="position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center;display:inline-block">${pending}</span>`
        : '📝';
      badge.onclick = () => renderOverdueNotesModal(window._overdueMap, window._clientsList);
      badge.style.cssText = 'display:inline-flex;position:relative';
    }
  } catch(e) { /* тихо */ }
}

// ── ТАБ: ГЛАВНАЯ (Списание + Дежурство) ──────
async function renderHomeTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const clients  = await DB.getClients(STATE.profile.id);
  const branches = STATE.profile.branches||[];
  const now      = new Date();
  const expiring = clients.filter(c=>{
    if (c.is_archived) return false;
    const d=daysUntil(c.subscription_end);
    return d!==null&&d<=SUBSCRIPTION_WARN_DAYS&&d>=0;
  });
  const duties   = await DB.getDuties(STATE.profile.id,now.getFullYear(),now.getMonth()+1);
  const _p2 = n => String(n).padStart(2,'0');
  const _ymd = `${now.getFullYear()}-${_p2(now.getMonth()+1)}-${_p2(now.getDate())}`;
  const defStart = `${_ymd}T07:00`;
  const defEnd   = `${_ymd}T${_p2(now.getHours())}:00`;

  $('#tab-content').innerHTML=`<div class="tab-pad">

    ${expiring.length?`<div class="warn-banner">
      ⚠️ Абонемент истекает: ${expiring.map(c=>`<b>${c.fio.split(' ')[0]}</b> (${daysUntil(c.subscription_end)} дн.)`).join(', ')}
    </div>`:''}

    <!-- БЛОК: Списание ПТ -->
    <div class="home-block">
      <div class="home-block-title">📋 Списание ПТ</div>
      ${branchSelect('sel-branch',branches)}
      <div class="form-group" style="position:relative">
        <label>Клиент</label>
        <select id="wk-client" style="display:none">
          <option value="">— выберите —</option>
          ${clients.map(c=>{
            const days=daysUntil(c.subscription_end);
            const warn=days!==null&&days<=SUBSCRIPTION_WARN_DAYS&&days>=0?' ⚠️':'';
            const isFrozen = c.freeze_start && c.freeze_end && todayStr() >= c.freeze_start && todayStr() <= c.freeze_end;
            return `<option value="${c.id}" data-cat="${c.category}" data-bal="${c.balance}"
              data-age="${c.age||''}" data-di="${c.drop_in_used}" data-archived="${c.is_archived?'1':''}" data-frozen="${isFrozen?'1':''}">
              ${c.is_archived?'[Архив] ':isFrozen?'[Заморожен] ':''}${c.fio}${warn}</option>`;
          }).join('')}
        </select>
        <div id="wk-client-chip" style="display:none;padding:10px 12px;background:var(--card);border:1px solid var(--accent);border-radius:8px;justify-content:space-between;align-items:center;cursor:pointer;margin-bottom:0">
          <span id="wk-client-chip-name" style="font-size:14px;font-weight:500"></span>
          <span style="font-size:16px;color:var(--hint);padding:0 4px" onclick="wkClientClear()">✕</span>
        </div>
        <input type="text" id="wk-client-search" autocomplete="off" placeholder="🔍 Введите имя клиента..."
          style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px 12px;color:var(--text);font-size:14px;box-sizing:border-box"
          oninput="wkClientInput(this)">
        <div id="wk-client-drop" style="display:none;position:absolute;z-index:100;left:0;right:0;border-radius:0 0 12px 12px;max-height:220px;overflow-y:auto;
          background:#1e1e2e;border:1.5px solid rgba(124,58,237,.5);border-top:none;
          box-shadow:0 12px 40px rgba(0,0,0,.7);"></div>
        <div id="wk-client-backdrop" style="display:none;position:fixed;inset:0;z-index:99;background:rgba(0,0,0,.35)" ontouchstart="wkClientClear()" onclick="wkClientClear()"></div>
      </div>
      <div class="form-group"><label>Тип тренировки</label>
        <select id="wk-type" onchange="onWkTypeChange(this)">
          <option value="regular">Обычная ПТ</option>
          <option value="dropin1">Разовое 1кт (${fmt(RATES.pt[1])} сум)</option>
          <option value="dropin2">Разовое 2кт (${fmt(RATES.pt[2])} сум)</option>
          <option value="dropin3">Разовое 3кт (${fmt(RATES.pt[3])} сум)</option>
          <option value="trial">🆕 Пробная тренировка</option>
          <option value="late_request">⏰ Старше 48ч — запросить одобрение</option>
          <option value="debt">В долг</option>
        </select>
      </div>
      <div id="wk-regular-opts">
        <div class="form-group"><label>Количество ПТ</label>
          <select id="wk-count" onchange="renderDateFields()">
            ${[1,2,3,4,5].map(n=>`<option>${n}</option>`).join('')}
          </select>
        </div>
      </div>
      <div id="wk-dates"></div>
      <div id="wk-notes-wrap" style="display:none" class="form-group">
        <label>Примечание <span class="required">*</span></label>
        <textarea id="wk-notes" rows="2" placeholder="Причина пакетного списания"></textarea>
      </div>
      <!-- Замена: запись на другого тренера -->
      <div class="debt-toggle" style="margin-bottom:0">
        <label class="toggle-row">
          <input type="checkbox" id="wk-substitute" onchange="toggleSubstitute(this)">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span>Записать на другого тренера (замена)</span>
        </label>
      </div>
      <div id="wk-substitute-wrap" style="display:none;margin-top:10px">
        <div class="form-group"><label>ФИО тренера Б <span class="required">*</span></label>
          <input id="wk-sub-fio" type="text" placeholder="Иванов Иван Иванович"
            list="trainers-datalist" autocomplete="off">
          <datalist id="trainers-datalist">
            ${(await cached('profiles',()=>DB.getAllProfiles())).filter(p=>p.role!=='admin'&&p.id!==STATE.profile.id)
              .map(p=>`<option value="${p.fio}">`).join('')}
          </datalist>
        </div>
        <p class="hint">Тренер получит уведомление для подтверждения. ЗП пойдёт ему.</p>
      </div>

      <button class="btn btn-primary btn-full" onclick="doLogWorkout()">Списать</button>
    </div>

    <!-- БЛОК: Дежурство -->
    <div class="home-block" style="margin-top:16px">
      <div class="home-block-title">⏱ Запись дежурства</div>
      ${branchSelect('duty-branch',branches)}
      ${dutyShiftSelect('duty-branch')}
      <div class="form-group" style="display:flex;gap:10px">
        <div style="flex:1"><label>Начало</label>
          <input type="datetime-local" id="duty-start" value="${defStart}" step="3600"
            onchange="this.value=this.value.slice(0,13)+':00'"></div>
        <div style="flex:1"><label>Конец</label>
          <input type="datetime-local" id="duty-end" value="${defEnd.slice(0,13)+':00'}" step="3600"
            onchange="this.value=this.value.slice(0,13)+':00'"></div>
      </div>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="doLogDutyHome()">Записать дежурство</button>
      ${duties.length?`<div style="margin-top:10px">
        <div class="hint" style="margin-bottom:6px">За этот месяц: ${duties.length} дежурств ·
        ${fmt(Math.round(duties.reduce((s,d)=>s+hoursFromDuty(d.start_time,d.end_time),0)*RATES.duty_per_hour))} сум</div>
        ${duties.map(d=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:6px 0;border-bottom:1px solid var(--border);font-size:12px">
          <span>${new Date(d.start_time).toLocaleDateString('ru-RU',{day:'2-digit',month:'2-digit'})} · ${hoursFromDuty(d.start_time,d.end_time).toFixed(1)}ч</span>
          <button class="btn btn-sm btn-danger" style="padding:2px 8px;font-size:11px"
            onclick="doDeleteDuty('${d.id}')">✕</button>
        </div>`).join('')}
      </div>`:''}
        
    </div>

  </div>`;
  renderDateFields();
  wireDutyShift('duty-branch');
  // Закрывать дропдаун при касании/клике вне поля поиска
  const _closeWkDrop = (e) => {
    const drop = document.getElementById('wk-client-drop');
    if (!drop) { document.removeEventListener('touchstart',_closeWkDrop); document.removeEventListener('mousedown',_closeWkDrop); return; }
    if (!e.target.closest('#wk-client-search') && !e.target.closest('#wk-client-drop') && !e.target.closest('#wk-client-backdrop')) {
      drop.style.display='none';
      const bd = document.getElementById('wk-client-backdrop');
      if (bd) bd.style.display='none';
    }
  };
  document.addEventListener('touchstart', _closeWkDrop, {passive:true});
  document.addEventListener('mousedown',  _closeWkDrop);
}

async function doLogDutyHome() {
  const start  = document.getElementById('duty-start')?.value;
  const end    = document.getElementById('duty-end')?.value;
  const branch = document.getElementById('duty-branch')?.value||STATE.profile.branches?.[0]||'';
  if (!start||!end) return toast('Введите время','error');
  if (start>=end)   return toast('Конец позже начала','error');
  if (!branch)      return toast('Выберите филиал','error');
  const h = hoursFromDuty(new Date(start),new Date(end));
  if (h>16) return toast('Не более 16 часов','error');
  try {
    await sb().from('duties').insert({
      trainer_id:STATE.profile.id,branch,
      start_time: new Date(start).toISOString(),
end_time:   new Date(end).toISOString(),
    });
    toast(`✅ ${h.toFixed(1)}ч = ${fmt(Math.round(h*RATES.duty_per_hour))} сум`,'success');
    renderHomeTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: КЛИЕНТЫ ──────────────────────────────
// Определяет дубли клиентов по fio и выбирает "главного"
// История = есть реальные тренировки (workouts_count > 0)
// ============================================================
// SECTION: TRAINER:CLIENTS — _findDuplicates, renderClientsTab, renderOverdueNotesModal
// ============================================================
// Главный: больше тренировок → позже дата абонемента → больше баланс → если ничья — оба ⚠️
function _findDuplicates(clients) {
  const nameCount = {};
  clients.forEach(c => { const k = c.fio.trim().toLowerCase(); nameCount[k] = (nameCount[k]||0)+1; });
  const _dupNames = new Set(Object.keys(nameCount).filter(k => nameCount[k] > 1));
  const _primaryIds = new Set();
  if (_dupNames.size) {
    const groups = {};
    clients.forEach(c => { const k = c.fio.trim().toLowerCase(); if(_dupNames.has(k)){if(!groups[k])groups[k]=[];groups[k].push(c);} });
    Object.values(groups).forEach(g => {
      const wCount = c => c.workouts?.[0]?.count || 0;
      const sorted = [...g].sort((a,b) => {
        const wDiff = wCount(b) - wCount(a);
        if (wDiff !== 0) return wDiff;
        const ae = a.subscription_end||'', be = b.subscription_end||'';
        if (be > ae) return 1; if (ae > be) return -1;
        return (b.balance||0) - (a.balance||0);
      });
      const top = sorted[0], second = sorted[1];
      // Главный только если явно лучше второго по тренировкам или дате/балансу
      if (wCount(top) !== wCount(second)) { _primaryIds.add(top.id); return; }
      const isTie = (top.subscription_end||'') === (second.subscription_end||'')
                 && (top.balance||0) === (second.balance||0);
      if (!isTie) _primaryIds.add(top.id);
      // иначе — оба ⚠️
    });
  }
  return { _dupNames, _primaryIds };
}

async function renderClientsTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  // Параллельно: клиенты + батч конспектов
  const [clients, overdueMap] = await Promise.all([
    DB.getClients(STATE.profile.id),
    DB.getOverdueNotesBatch(STATE.profile.id).catch(()=>({})),
  ]);
  const pendingNotes = Object.values(overdueMap).reduce((s,n)=>s+n, 0);
  window._overdueMap = overdueMap;
  window._clientsList = clients;

  // Дубли считаем один раз по всему списку активных — чтобы не терялись при фильтрации
  const {_dupNames: _trainerDupNames} = _findDuplicates(clients.filter(c => !c.is_archived));

  const renderList = (filter='') => {
    const body = document.getElementById('cl-list');
    if (!body) return;
    let arr = filter ? clients.filter(c=>c.fio.toLowerCase().includes(filter.toLowerCase())) : clients;
    if (!arr.length) { body.innerHTML='<p class="hint" style="text-align:center;padding:20px">Не найдено</p>'; return; }
    // Сортировка: просроченные → истекающие/нулевой баланс → остальные → архивные в конец
    arr = [...arr].sort((a,b)=>{
      const score = c=>{
        if (c.is_archived) return 10;           // архивные — в самый конец
        const d=daysUntil(c.subscription_end);
        if (d!==null&&d<0) return 0;           // просрочен
        if (c.balance<=0) return 1;             // нулевой баланс
        if (d!==null&&d<=SUBSCRIPTION_WARN_DAYS) return 1; // истекает
        return 2;
      };
      return score(a)-score(b);
    });
    const _dupNames = _trainerDupNames;

    body.innerHTML = arr.map(c=>{
      const days = daysUntil(c.subscription_end);
      const warn = days!==null&&days<=SUBSCRIPTION_WARN_DAYS&&days>=0;
      const exp  = days!==null&&days<0;
      const noBalance = c.balance<=0;
      const today0 = todayStr();
      const isFrozen = c.freeze_start && c.freeze_end && today0 >= c.freeze_start && today0 <= c.freeze_end;
      const dot  = c.color?`<span style="display:inline-block;width:9px;height:9px;border-radius:50%;background:${c.color};margin-right:4px;vertical-align:middle"></span>`:'';
      const isDup = _dupNames.has(c.fio.trim().toLowerCase());
      const hasHistory = (c.workouts?.[0]?.count || 0) > 0;
      const dupBadge = isDup ? (hasHistory ? '✅⚠️ ' : '⚠️ ') : '';
      let rowBg = '';
      if (c.is_archived)     rowBg = 'background:rgba(100,116,139,.07);border-left:3px solid rgba(100,116,139,.3);opacity:.75';
      else if (isFrozen)     rowBg = 'background:rgba(96,165,250,.08);border-left:3px solid rgba(96,165,250,.4)';
      else if (exp)          rowBg = 'background:rgba(239,68,68,.08);border-left:3px solid rgba(239,68,68,.5)';
      else if (warn||noBalance) rowBg = 'background:rgba(245,158,11,.08);border-left:3px solid rgba(245,158,11,.5)';
      return `<div class="client-row" style="${rowBg}" onclick="renderClientProfile('${c.id}','clients')">
        <div style="flex:1;min-width:0">
          <div class="cr-name" style="font-size:16px;font-weight:600">${dot}${c.is_archived?'<span style="font-size:11px;color:var(--hint);font-weight:400;margin-right:4px">[Архив]</span>':''}${dupBadge}${c.fio}</div>
          <div class="cr-meta" style="margin-top:2px;display:flex;flex-wrap:wrap;gap:4px;align-items:center">
            <span class="hi-cat cat-${c.category}" style="font-size:11px;padding:1px 7px;border-radius:8px;font-weight:600">Кат.${c.category}</span>
            <span style="font-size:12px;color:var(--hint)">${c.balance} ПТ</span>
            ${c.age?`<span style="font-size:12px;color:var(--hint)">${c.age} лет</span>`:''}
            ${isFrozen?`<span style="font-size:12px;color:#3b82f6">🧊 до ${c.freeze_end}</span>`:''}
            ${!isFrozen&&c.subscription_end?`<span style="font-size:12px;color:${exp?'#ef4444':warn?'#f59e0b':'var(--hint)'}">до ${c.subscription_end}</span>`:''}
          </div>
        </div>
        <span class="cr-arrow">›</span>
      </div>`;
    }).join('');
  };
  // Считаем активных (баланс > 0 и абонемент не истёк)
  const now = new Date(); now.setHours(0,0,0,0);
  const activeClients = clients.filter(c => {
    if (c.is_archived) return false;
    if ((c.balance||0) <= 0) return false;
    if (c.subscription_end && new Date(c.subscription_end) < now) return false;
    const t = todayStr();
    if (c.freeze_start && c.freeze_end && t >= c.freeze_start && t <= c.freeze_end) return false;
    return true;
  });

  // Обновляем значок конспектов в хедере
  const noteBadge = document.getElementById('note-badge');
  if (noteBadge) {
    if (pendingNotes > 0) {
      noteBadge.innerHTML = `📝<span style="position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center;display:inline-block">${pendingNotes}</span>`;
      noteBadge.onclick = () => renderOverdueNotesModal(overdueMap, clients);
    } else {
      noteBadge.innerHTML = '📝';
      noteBadge.onclick = () => switchTab('clients');
    }
    noteBadge.style.cssText = 'display:inline-flex;position:relative';
  }

  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header">
      <h3>Мои клиенты</h3>
      <button class="btn btn-sm" onclick="renderAddClientModal()">+ Клиент</button>
    </div>
    <div style="font-size:12px;color:var(--hint);margin-bottom:8px">
      Всего: <b>${clients.length}</b> · Активных: <b style="color:#10b981">${activeClients.length}</b>
    </div>
    <input type="text" id="cl-search" placeholder="🔍 Поиск..." oninput="(()=>{const f=this.value;const b=document.getElementById('cl-list');if(b){const arr=${JSON.stringify('clients')};}})()"
      style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px;margin-bottom:8px;box-sizing:border-box">
    ${pendingNotes>0?`<div class="warn-banner" style="cursor:pointer" onclick="renderOverdueNotesModal(window._overdueMap, window._clientsList)">
      📝 ${pendingNotes} незакрытых конспектов — нажмите чтобы посмотреть
    </div>`:''}
    ${!clients.length?'<div class="empty-state">👥<p>Клиентов нет.<br>Нажмите + Клиент чтобы добавить.</p></div>':'<div id="cl-list"></div>'}
  </div>`;
  if (clients.length) {
    document.getElementById('cl-search').addEventListener('input', e => renderList(e.target.value));
    renderList();
  }
}

async function renderOverdueNotesModal(overdueMap, clients) {
  overdueMap = overdueMap || window._overdueMap || {};
  if (!clients?.length)
    clients = window._clientsList?.length ? window._clientsList : await DB.getClients(STATE.profile.id);
  window._clientsList = clients;
  const clientMap = Object.fromEntries((clients||[]).map(c=>[c.id, c]));
  const entries = Object.entries(overdueMap).filter(([,n])=>n>0);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>📝 Конспекты</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${!entries.length
      ? `<div class="empty-state" style="padding:24px 8px;text-align:center">✅<p>Все конспекты закрыты.<br>Незакрытых нет.</p></div>`
      : `<p class="hint" style="margin-bottom:12px">Нажмите на клиента чтобы написать конспект:</p>
    <div id="overdue-notes-list" style="display:flex;flex-direction:column;gap:8px">
      ${entries.map(([clientId, count])=>{
        const c = clientMap[clientId];
        if (!c) return '';
        return `<div id="odn-${clientId}" style="border:1px solid rgba(239,68,68,.2);border-radius:10px;overflow:hidden">
          <div style="display:flex;justify-content:space-between;align-items:center;padding:12px;background:rgba(239,68,68,.07);cursor:pointer"
            onclick="toggleOverdueNoteForm('${clientId}')">
            <div>
              <div style="font-weight:600">${c.fio}</div>
              <div style="font-size:12px;color:var(--hint)">Кат.${c.category} · ${c.balance} ПТ</div>
            </div>
            <span style="background:rgba(239,68,68,.15);color:#ef4444;padding:3px 10px;border-radius:12px;font-weight:700;font-size:13px">${count} конспект${count>1?'а':''}</span>
          </div>
          <div id="odn-form-${clientId}" style="display:none;padding:12px;border-top:1px solid rgba(239,68,68,.15);background:var(--card)">
            <div class="form-group" style="margin-bottom:8px"><label style="font-size:12px">Что сделали</label>
              <textarea id="odn-acc-${clientId}" rows="2" placeholder="Освоили дыхание во время кроля..."></textarea></div>
            <div class="form-group" style="margin-bottom:8px"><label style="font-size:12px">Задача на следующее занятие</label>
              <textarea id="odn-next-${clientId}" rows="2" placeholder="Откорректировать работу рук..."></textarea></div>
            <button class="btn btn-primary btn-full" style="font-size:13px"
              onclick="saveInlineOverdueNote('${clientId}',this)">Сохранить конспект</button>
          </div>
        </div>`;
      }).join('')}
    </div>`}
  </div>`;
  document.body.appendChild(m);
}
function toggleOverdueNoteForm(clientId) {
  const form = document.getElementById(`odn-form-${clientId}`);
  if (!form) return;
  const open = form.style.display === 'none';
  form.style.display = open ? 'block' : 'none';
  if (open) form.querySelector('textarea')?.focus();
}
async function saveInlineOverdueNote(clientId, btn) {
  const acc  = document.getElementById(`odn-acc-${clientId}`)?.value.trim();
  const next = document.getElementById(`odn-next-${clientId}`)?.value.trim();
  if (!acc) return toast('Напишите что сделали','error');
  btn.disabled = true; btn.textContent = 'Сохраняем...';
  try {
    const [overdueWorkouts, sub] = await Promise.all([
      DB.getOverdueNotes(clientId, STATE.profile.id),
      DB.getActiveSubscription(clientId),
    ]);
    // Добавляем свежие тренировки (ещё не старше 48ч, не видны в БД-запросе)
    const freshIds = window._freshNoteWorkouts?.[clientId] || [];
    const allIds = [...new Set([...overdueWorkouts.map(w=>w.id), ...freshIds])];
    for (const wId of allIds) {
      await DB.upsertNote(wId, clientId, STATE.profile.id, sub?.id||null, acc, next||null, null);
    }
    if (freshIds.length && window._freshNoteWorkouts) delete window._freshNoteWorkouts[clientId];
    // Убираем строку клиента из модала
    document.getElementById(`odn-${clientId}`)?.remove();
    // Если больше нет — закрываем модал
    const list = document.getElementById('overdue-notes-list');
    if (list && !list.children.length) document.querySelector('.modal-overlay')?.remove();
    toast('✅ Конспект сохранён','success');
    // Обновляем счётчик на главной
    const badge = document.getElementById('note-badge');
    if (badge) {
      const map = window._overdueMap||{};
      delete map[clientId];
      window._overdueMap = map;
      const total = Object.values(map).reduce((s,n)=>s+n,0);
      badge.innerHTML = total > 0
        ? `📝<span style="position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center;display:inline-block">${total}</span>`
        : '📝';
    }
  } catch(e) { toast('Ошибка','error'); console.error(e); btn.disabled=false; btn.textContent='Сохранить конспект'; }
}

// ── ТАБ: СПИСАНИЕ ─────────────────────────────
// ============================================================
// SECTION: TRAINER:WORKOUTS — renderWorkoutsTab, doLogWorkout
// ============================================================
async function renderWorkoutsTab() {
  // Алиас — открывает главную
  renderHomeTab();
}

function onWkTypeChange(sel) {
  const reg=document.getElementById('wk-regular-opts');
  const isDropIn=sel.value.startsWith('dropin');
  const isTrial=sel.value==='trial';
  if (reg) reg.style.display=(isDropIn||isTrial)?'none':'';
  // При выборе "Пробная" — сразу открываем модал ввода данных
  if (isTrial) {
    sel.value='regular';
    renderTrialSessionModal();
  }
  const isLate = sel.value==='late_request';
  if (isLate) {
    sel.value='regular';
    renderLateRequestModal();
  }
}
let _wkClientTimer = null;
function wkClientInput(inp) {
  clearTimeout(_wkClientTimer);
  _wkClientTimer = setTimeout(()=>_wkClientFilter(inp.value), 300);
}
function _wkClientFilter(q) {
  const drop     = document.getElementById('wk-client-drop');
  const backdrop = document.getElementById('wk-client-backdrop');
  const sel      = document.getElementById('wk-client');
  if (!drop||!sel) return;
  const opts = [...sel.options].filter(o=>o.value);
  const matches = q.length<1 ? opts : opts.filter(o=>o.text.toLowerCase().includes(q.toLowerCase()));
  if (!matches.length) {
    drop.style.display='none';
    if (backdrop) backdrop.style.display='none';
    return;
  }
  const catColors = {'1':'#10b981','2':'#a78bfa','3':'#f59e0b'};
  drop.innerHTML = matches.slice(0,30).map((o,i)=>{
    const cat = o.dataset.cat||'';
    const bal = o.dataset.bal||'';
    const catColor = catColors[cat]||'#9ca3af';
    const isLow = parseInt(bal)<=0;
    return `<div style="
        padding:12px 16px;
        border-bottom:1px solid rgba(255,255,255,.07);
        cursor:pointer;
        display:flex;
        justify-content:space-between;
        align-items:center;
        gap:10px;
        transition:background .1s;
        ${i===matches.length-1?'border-bottom:none;':''}"
      onmouseenter="this.style.background='rgba(124,58,237,.25)'"
      onmouseleave="this.style.background=''"
      ontouchstart="this.style.background='rgba(124,58,237,.25)';wkClientPick('${o.value}','${encodeURIComponent(o.text)}')"
      onmousedown="wkClientPick('${o.value}','${encodeURIComponent(o.text)}')">
      <span style="font-size:15px;font-weight:500;color:#f1f5f9;flex:1;min-width:0;
        overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${o.text}</span>
      <span style="display:flex;gap:6px;align-items:center;flex-shrink:0">
        ${cat?`<span style="font-size:11px;font-weight:600;padding:2px 8px;border-radius:8px;
          background:${catColor}22;color:${catColor}">кат.${cat}</span>`:''}
        ${bal!==''?`<span style="font-size:12px;font-weight:600;
          color:${isLow?'#ef4444':'#94a3b8'}">${bal} ПТ</span>`:''}
      </span>
    </div>`;
  }).join('');
  drop.style.display = 'block';
  if (backdrop) backdrop.style.display='block';
}
function wkClientPick(id, nameEnc) {
  const sel      = document.getElementById('wk-client');
  const inp      = document.getElementById('wk-client-search');
  const drop     = document.getElementById('wk-client-drop');
  const backdrop = document.getElementById('wk-client-backdrop');
  const chip     = document.getElementById('wk-client-chip');
  const cname    = document.getElementById('wk-client-chip-name');
  if (!sel) return;
  sel.value = id;
  drop.style.display = 'none';
  if (backdrop) backdrop.style.display='none';
  if (inp)  { inp.style.display='none'; inp.value=''; }
  if (chip) { chip.style.display='flex'; }
  if (cname) cname.textContent = decodeURIComponent(nameEnc);
  onClientChange(sel);
}
function wkClientClear() {
  const sel      = document.getElementById('wk-client');
  const inp      = document.getElementById('wk-client-search');
  const drop     = document.getElementById('wk-client-drop');
  const backdrop = document.getElementById('wk-client-backdrop');
  const chip     = document.getElementById('wk-client-chip');
  if (sel)  sel.value = '';
  if (chip) chip.style.display='none';
  if (drop) drop.style.display='none';
  if (backdrop) backdrop.style.display='none';
  if (inp)  { inp.style.display=''; inp.value=''; inp.focus(); }
}
function onClientChange(sel) {
  const opt=sel.options[sel.selectedIndex];
  const bal=parseInt(opt?.dataset.bal||'1');
  const age=parseInt(opt?.dataset.age||'99');
  const diUsed=opt?.dataset.di==='true';
  if (sel.value&&bal<=0) toast('⚠️ Нулевой баланс!','error');
  // Блокируем разовые для детей, уже использовавших разовое
  const diOpts=[...document.getElementById('wk-type')?.options||[]].filter(o=>o.value.startsWith('dropin'));
  diOpts.forEach(o=>{
    if (isChild(age)&&diUsed) { o.disabled=true; }
    else { o.disabled=false; }
  });
}
function renderDateFields() {
  const count=parseInt($('#wk-count')?.value||1);
  const notesW=$('#wk-notes-wrap');
  if (notesW) notesW.style.display=count>1?'':'none';
  const div=$('#wk-dates'); if (!div) return;
  const now=new Date();
  const maxDate=now.toISOString().slice(0,10);
  const minDate=new Date(Date.now()-MAX_BACKDATE_HOURS*3600000).toISOString().slice(0,10);
  const times=[];
  for(let h=7;h<=22;h++){
    times.push(`<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}:00</option>`);
    times.push(`<option value="${String(h).padStart(2,'0')}:30">${String(h).padStart(2,'0')}:30</option>`);
  }
  const curH=String(now.getHours()).padStart(2,'0');
  const curM=now.getMinutes()<30?'00':'30';
  const curTime=`${curH}:${curM}`;
  div.innerHTML=Array.from({length:count},(_,i)=>`
    <div class="form-group">
      <label>${count>1?`ПТ №${i+1} — `:''}Дата и время</label>
      <div style="display:flex;gap:8px">
        <input type="date" id="wk-date-${i}" value="${maxDate}"
          min="${minDate}" max="${maxDate}" style="flex:1">
        <select id="wk-time-${i}" style="flex:1">
          ${times.map(t=>t.replace(`value="${curTime}"`,`value="${curTime}" selected`)).join('')}
        </select>
      </div>
    </div>`).join('');
}
function toggleSubstitute(cb) {
  const wrap = document.getElementById('wk-substitute-wrap');
  if (wrap) wrap.style.display = cb.checked ? '' : 'none';
}

async function doLogWorkout() {
  if (_pending.has('logWorkout')) return;
  _pending.add('logWorkout');
  const btn = document.querySelector('button[onclick="doLogWorkout()"]');
  if (btn) { btn.disabled=true; btn.textContent='Списываем...'; }
  try { await _doLogWorkoutInner(); }
  finally {
    _pending.delete('logWorkout');
    if (btn) { btn.disabled=false; btn.textContent='Списать'; }
  }
}
async function _doLogWorkoutInner() {
  const clientSel=$('#wk-client');
  const clientId=clientSel?.value;
  if (!clientId) return toast('Выберите клиента','error');
  const opt=clientSel.options[clientSel.selectedIndex];
  if (opt?.dataset.archived==='1') return toast('Клиент в архиве — списание недоступно','error');
  if (opt?.dataset.frozen==='1') return toast('Абонемент заморожен — списание недоступно','error');
  const category=parseInt(opt.dataset.cat);
  const type=$('#wk-type')?.value||'regular';
  const isDropIn=type.startsWith('dropin'), isDebt=type==='debt';
  const dropInCat=isDropIn?parseInt(type.replace('dropin',''))||1:null;
  const count=isDropIn?1:parseInt($('#wk-count')?.value||1);
  const branch=getBranch();
  if (!branch) return toast('Выберите филиал','error');

  // Долговые конспекты соберём ниже — не блокируем здесь
  const notes=$('#wk-notes')?.value.trim()||'';
  if (count>1&&!notes) return toast('Введите примечание','error');
  if (isDropIn) {
    const age=parseInt(opt.dataset.age||'99');
    if (isChild(age)&&opt.dataset.di==='true') return toast('Ребёнок уже использовал разовое','error');
  }
  const dates=[];
  for (let i=0;i<count;i++) {
    const d=document.getElementById(`wk-date-${i}`)?.value;
    const t=document.getElementById(`wk-time-${i}`)?.value||'09:00';
    const v = d ? `${d}T${t}:00+05:00` : null;
    if (!v) return toast(`Введите дату для ПТ №${i+1}`,'error');
    if (!isValidWorkoutDate(v)) return toast(`ПТ №${i+1}: можно вносить тренировки за последние 48 часов. Если тренировка была раньше — обратитесь к координатору.`,'error');
    dates.push(v);
  }
  // Блокирующие события
  for (const d of dates) {
    const dt=new Date(d);
    const blocking=await DB.getBlockingEvents(branch,dt.toISOString(),new Date(dt.getTime()+3600000).toISOString());
    if (blocking.length>0&&!confirm(`⚠️ В это время: «${blocking[0].title}»\nВсё равно записать?`)) return;
  }

  // Замена на другого тренера
  const isSubstitute = document.getElementById('wk-substitute')?.checked||false;
  let subTrainerId = null;
  if (isSubstitute) {
    const subFio = document.getElementById('wk-sub-fio')?.value.trim();
    if (!subFio) return toast('Введите ФИО тренера для замены','error');
    const allP = await cached('profiles',()=>DB.getAllProfiles());
    const found = allP.find(p=>p.fio.toLowerCase()===subFio.toLowerCase());
    if (!found) return toast(`Тренер «${subFio}» не найден`,'error');
    subTrainerId = found.id;
  }

  const rows=dates.map(d=>({
    trainer_id: isSubstitute ? subTrainerId : STATE.profile.id,
    client_id:clientId,
    category_at_moment:category,branch,
    workout_date:new Date(d).toISOString(),
    notes:notes||null,is_debt:isDebt,is_drop_in:isDropIn,
    drop_in_category:dropInCat,
  }));
  // Замена и долг/разовое — прямое списание без конспектов
  if (isSubstitute) {
    try {
      await DB.logSubstituteWorkout(rows, STATE.profile.id, subTrainerId);
      toast('✅ Замена записана — тренер получит уведомление для подтверждения','success');
      renderHomeTab();
    } catch(e) { toast('Ошибка','error'); console.error(e); }
    return;
  }
  if (isDebt||isDropIn) {
    try {
      await DB.logWorkouts(rows);
      toast(isDebt?'✅ В долг':'✅ Разовое','success');
      renderWorkoutsTab();
    } catch(e) { toast('Ошибка','error'); console.error(e); }
    return;
  }

  // Обычные ПТ: собираем долговые конспекты и показываем один экран
  const overdueNotes = await DB.getOverdueNotes(clientId, STATE.profile.id);
  _pendingLogData = { rows, clientId, count, overdueNotes };
  showLogWithNotesModal(overdueNotes, clientId, dates);
}

function showLogWithNotesModal(overdueNotes, clientId, dates) {
  const overdueHtml = overdueNotes.map(w=>`
    <div style="border:1px solid var(--danger);border-radius:10px;padding:12px;margin-bottom:12px">
      <div style="color:var(--danger);font-weight:600;font-size:13px;margin-bottom:8px">⛔ Конспект за ${fmtDate(w.workout_date)}</div>
      <div class="form-group" style="margin-bottom:8px"><label>Что сделали</label>
        <textarea id="note-acc-${w.id}" rows="2" placeholder="Освоили..."></textarea></div>
      <div class="form-group" style="margin-bottom:0"><label>Задача на следующее</label>
        <textarea id="note-next-${w.id}" rows="2" placeholder="Откорректировать..."></textarea></div>
    </div>`).join('');

  const newDate = dates[0];
  const extraDatesHint = dates.length > 1
    ? `<p class="hint" style="margin-top:10px;margin-bottom:0">💡 Конспекты за ${dates.slice(1).map(fmtDate).join(', ')} — напишите в течение 48 часов</p>`
    : '';
  const newNoteHtml = `
    <div style="border:1px solid var(--border);border-radius:10px;padding:12px;margin-bottom:16px">
      <div style="font-weight:600;font-size:13px;margin-bottom:8px">📝 Конспект за ${fmtDate(newDate)} <span class="hint" style="font-weight:400">(можно позже)</span></div>
      <div class="form-group" style="margin-bottom:8px"><label>Что сделали</label>
        <textarea id="note-acc-new" rows="2" placeholder="Освоили..."></textarea></div>
      <div class="form-group" style="margin-bottom:0"><label>Задача на следующее</label>
        <textarea id="note-next-new" rows="2" placeholder="Откорректировать..."></textarea></div>
    </div>`;

  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal" style="max-height:90vh;overflow-y:auto">
    <div class="modal-header">
      <h3>${overdueNotes.length>0?'Конспекты + Списать':'Конспект + Списать'}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove();_pendingLogData=null">✕</button>
    </div>
    ${overdueNotes.length>0?'<p class="hint" style="margin-bottom:12px">Заполните все конспекты — они обязательны.</p>':''}
    ${overdueHtml}
    ${newNoteHtml}
    ${extraDatesHint}
    <button class="btn btn-primary btn-full" id="btn-confirm-log"
      onclick="doConfirmLogWorkout()">✅ Списать</button>
  </div>`;
  document.body.appendChild(m);
}

async function doConfirmLogWorkout() {
  if (!_pendingLogData) return toast('Ошибка: нет данных','error');
  const { rows, clientId, count, overdueNotes } = _pendingLogData;

  // Валидация долговых конспектов
  for (const w of overdueNotes) {
    const acc = document.getElementById(`note-acc-${w.id}`)?.value.trim();
    if (!acc) return toast('Заполните все долговые конспекты','error');
  }

  const btn = document.getElementById('btn-confirm-log');
  if (btn) { btn.disabled=true; btn.textContent='Сохраняем...'; }

  try {
    // Одна подписка на весь блок сохранений
    const sub = overdueNotes.length>0 ? await DB.getActiveSubscription(clientId) : null;

    // Сохраняем долговые конспекты
    for (const w of overdueNotes) {
      const acc  = document.getElementById(`note-acc-${w.id}`)?.value.trim();
      const next = document.getElementById(`note-next-${w.id}`)?.value.trim()||null;
      await DB.upsertNote(w.id, clientId, STATE.profile.id, sub?.id||null, acc, next, null);
    }

    // Списываем тренировки
    const result = await DB.logWorkouts(rows);

    // Сохраняем конспект за новую тренировку если заполнен
    const newAcc = document.getElementById('note-acc-new')?.value.trim();
    if (newAcc && result?.[0]) {
      const newSub = sub || await DB.getActiveSubscription(clientId);
      const newNext = document.getElementById('note-next-new')?.value.trim()||null;
      await DB.upsertNote(result[0].id, clientId, STATE.profile.id, newSub?.id||null, newAcc, newNext, null);
    }

    document.querySelector('.modal-overlay')?.remove();
    _pendingLogData = null;
    toast(`✅ ПТ`,'success');
    // Если конспект не написан — сразу обновляем значок 📝 в шапке
    if (!newAcc && result?.[0] && !rows[0]?.is_drop_in) {
      const freshIds = result.map(r=>r.id);
      if (!window._freshNoteWorkouts) window._freshNoteWorkouts = {};
      window._freshNoteWorkouts[clientId] = (window._freshNoteWorkouts[clientId]||[]).concat(freshIds);
      if (!window._overdueMap) window._overdueMap = {};
      window._overdueMap[clientId] = (window._overdueMap[clientId]||0) + freshIds.length;
      // Подгружаем список клиентов если ещё не загружен (для модала)
      if (!window._clientsList?.length) {
        DB.getClients(STATE.profile.id).then(cl => { window._clientsList = cl; });
      }
      // Обновляем значок после рендера главной
      setTimeout(() => {
        const total = Object.values(window._overdueMap||{}).reduce((s,n)=>s+n,0);
        const badge = document.getElementById('note-badge');
        if (badge && total > 0) {
          badge.innerHTML = `📝<span style="position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center;display:inline-block">${total}</span>`;
          badge.style.cssText = 'display:inline-flex;position:relative';
          badge.onclick = () => renderOverdueNotesModal(window._overdueMap, window._clientsList);
        }
      }, 600);
    }
    renderWorkoutsTab();
    // Реестр: одна запись на весь батч (вне try — fire-and-forget)
    const firstRow = rows[0];
    DB.auditLog('workout_add', STATE.profile.id, STATE.profile.fio, clientId, 'workout', {
      count, dates: rows.map(r=>r.workout_date?.slice(0,10)),
      category: firstRow?.category_at_moment, is_drop_in: firstRow?.is_drop_in||false,
    }, firstRow?.branch);
  } catch(e) {
    toast('Ошибка','error'); console.error(e);
    if (btn) { btn.disabled=false; btn.textContent='✅ Списать'; }
  }
}

// Модал: добавить клиента
// ============================================================
// SECTION: TRAINER:CLIENTS:ADD — renderAddClientModal, doAddClient
// ============================================================
function renderAddClientModal() {
  const m=el('div','modal-overlay');
  const pkgsChild = SUB_PACKAGES.child;
  const pkgsAdult = SUB_PACKAGES.adult;
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>

    <!-- Тип клиента -->
    <div class="form-group">
      <div class="cat-picker" style="grid-template-columns:1fr 1fr">
        <button class="cat-btn active" id="mode-new" onclick="setClientMode('new')">
          Новый клиент<br><small>первый абонемент</small></button>
        <button class="cat-btn" id="mode-existing" onclick="setClientMode('existing')">
          Действующий<br><small>уже занимается</small></button>
      </div>
    </div>

    <div class="form-group"><label>ФИО</label>
      <input id="nc-fio" type="text" placeholder="Петрова Анна"></div>
    <div class="form-group"><label>Возраст (лет)</label>
      <input id="nc-age" type="number" min="3" max="99" placeholder="35"
        onchange="onNcAgeChange(this.value)"></div>
    <div class="form-group"><label>Категория</label>
      <div class="cat-picker">
        ${[1,2,3].map(n=>`<button class="cat-btn ${n===1?'active':''}" data-cat="${n}"
          onclick="selectCat(this)">Кат.${n}<br><small>${fmt(RATES.pt[n])} сум</small></button>`).join('')}
      </div></div>

    <!-- Новый клиент: пакеты -->
    <div id="nc-new-fields">
      <div class="form-group"><label>Пакет абонемента</label>
        <div id="nc-pkg-list" style="display:flex;flex-direction:column;gap:8px">
          ${pkgsChild.map((p,i)=>`<button class="btn pkg-btn ${i===1?'btn-primary':''}" data-qty="${p.qty}"
            onclick="selectNcPkg(this)"
            style="${i!==1?'background:var(--card);border:1px solid var(--border)':''}">
            <b>${p.label}</b> · ${p.period}</button>`).join('')}
        </div>
        <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px;color:var(--hint)">
          <input type="checkbox" id="nc-custom-toggle" onchange="toggleNcCustom(this.checked)" style="width:16px;height:16px;flex-shrink:0">
          Другое количество
        </label>
        <input id="nc-custom-qty" type="number" min="1" placeholder="Введите кол-во ПТ"
          style="display:none;margin-top:8px;width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px" oninput="updateNcEndDate()">
      </div>
      <div class="form-group"><label>Дата начала</label>
        <input id="nc-start" type="date" value="${todayStr()}" oninput="updateNcEndDate()"></div>
      <div id="nc-end-preview" class="hint" style="margin-bottom:12px"></div>
    </div>

    <!-- Действующий клиент: история -->
    <div id="nc-existing-fields" style="display:none">
      <div class="form-group"><label>Дата начала текущего абонемента</label>
        <input id="nc-start-ex" type="date" value="${todayStr()}"></div>
      <div class="form-group"><label>Изначально ПТ в пакете</label>
        <input id="nc-initial" type="number" min="1" value="10"
          placeholder="сколько купил изначально"></div>
      <div class="form-group"><label>Осталось ПТ сейчас</label>
        <input id="nc-remaining" type="number" min="0" value="10"
          placeholder="текущий остаток"></div>
      <p class="hint">Использованные ПТ в зарплату не идут — они были в прошлом.</p>
    </div>

    <button class="btn btn-primary btn-full" onclick="doAddClient()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
  // Инициализируем превью даты
  selectNcPkg(m.querySelector('.pkg-btn.btn-primary'));
}

function onNcAgeChange(age) {
  const isChild = parseInt(age) <= CHILD_MAX_AGE;
  const pkgs = isChild ? SUB_PACKAGES.child : SUB_PACKAGES.adult;
  const list = document.getElementById('nc-pkg-list');
  if (!list) return;
  list.innerHTML = pkgs.map((p,i)=>`<button class="btn pkg-btn ${i===1?'btn-primary':''}" data-qty="${p.qty}"
    onclick="selectNcPkg(this)"
    style="${i!==1?'background:var(--card);border:1px solid var(--border)':''}">
    <b>${p.label}</b> · ${p.period}</button>`).join('');
  selectNcPkg(list.querySelector('.pkg-btn.btn-primary'));
}
function selectNcPkg(btn) {
  if (!btn) return;
  document.querySelectorAll('.pkg-btn').forEach(b=>{
    b.classList.remove('btn-primary');
    b.style.background='var(--card)'; b.style.border='1px solid var(--border)';
  });
  btn.classList.add('btn-primary');
  btn.style.background=''; btn.style.border='';
  updateNcEndDate();
}
function toggleNcCustom(on) {
  document.getElementById('nc-custom-qty').style.display = on ? '' : 'none';
  document.querySelectorAll('.pkg-btn').forEach(b=>{ b.disabled = on; b.style.opacity = on ? '0.4' : '1'; });
  updateNcEndDate();
}
function updateNcEndDate() {
  const customOn = document.getElementById('nc-custom-toggle')?.checked;
  const qty = customOn
    ? parseInt(document.getElementById('nc-custom-qty')?.value||'0')
    : parseInt(document.querySelector('.pkg-btn.btn-primary')?.dataset.qty||'0');
  const start = document.getElementById('nc-start')?.value || todayStr();
  const preview = document.getElementById('nc-end-preview');
  if (!preview) return;
  if (!qty) { preview.textContent=''; return; }
  preview.textContent = `📅 Действует до: ${calcSubEnd(start, qty)}`;
}

function setClientMode(mode) {
  document.getElementById('mode-new').classList.toggle('active', mode==='new');
  document.getElementById('mode-existing').classList.toggle('active', mode==='existing');
  document.getElementById('nc-new-fields').style.display     = mode==='new' ? '' : 'none';
  document.getElementById('nc-existing-fields').style.display = mode==='existing' ? '' : 'none';
  document.getElementById('mode-new').dataset.mode = mode;
}

function selectCat(btn) { $$('.cat-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }

  let _addingClient = false;
async function doAddClient() {
  if (_addingClient) return;
  _addingClient = true;
  const btn = document.querySelector('.modal .btn-primary');
  if (btn) { btn.disabled=true; btn.textContent='Добавляем...'; }

  const fio       = $('#nc-fio')?.value.trim();
  const age       = parseInt($('#nc-age')?.value)||null;
  const cat       = parseInt(document.querySelector('.cat-btn.active[data-cat]')?.dataset.cat||'1');
  const isExisting = document.getElementById('mode-existing')?.classList.contains('active');

  if (!fio) {
    _addingClient=false;
    if (btn) { btn.disabled=false; btn.textContent='Добавить'; }
    return toast('Введите ФИО','error');
  }

  // Проверка дубля
  try {
    const existing = await DB.getClients(STATE.profile.id);
    if (existing.find(c=>!c.is_archived&&c.fio.toLowerCase()===fio.toLowerCase())) {
      _addingClient=false;
      if (btn) { btn.disabled=false; btn.textContent='Добавить'; }
      return toast(`«${fio}» уже есть в вашем списке`,'error');
    }
  } catch(e) { console.error(e); }

  try {
    if (!isExisting) {
      const customOn = document.getElementById('nc-custom-toggle')?.checked;
      const bal = customOn
        ? parseInt(document.getElementById('nc-custom-qty')?.value||'0')
        : parseInt(document.querySelector('.pkg-btn.btn-primary')?.dataset.qty||'0');
      const startDate = document.getElementById('nc-start')?.value || todayStr();
      const endDate   = bal > 0 ? calcSubEnd(startDate, bal) : null;
      const client = await DB.addClient(fio, cat, STATE.profile.id, age, startDate, endDate);
      if (bal > 0) {
        await DB.addBalance(client.id, bal);
        await DB.createSubscription(client.id, STATE.profile.id, startDate, bal);
      }
    } else {
      const startDate = $('#nc-start-ex')?.value || todayStr();
      const remaining = parseInt($('#nc-remaining')?.value||'0');
      const initOrig  = parseInt($('#nc-initial')?.value||remaining);
      const endDate   = remaining > 0 ? calcSubEnd(startDate, initOrig) : null;
      const client = await DB.addClient(fio, cat, STATE.profile.id, age, startDate, endDate);
      if (remaining > 0) await DB.addBalance(client.id, remaining);
      await DB.createSubscriptionWithInitial(client.id, STATE.profile.id, startDate, initOrig, remaining);
    }
    _addingClient=false;
    document.querySelector('.modal-overlay')?.remove();
    DB.auditLog('client_add', STATE.profile.id, STATE.profile.fio, null, 'client',
      { fio, category: cat, age }, STATE.profile.branches?.[0]);
    toast('Клиент добавлен ✅','success');
    renderClientsTab();
  } catch(e) {
    _addingClient=false;
    if (btn) { btn.disabled=false; btn.textContent='Добавить'; }
    console.error(e); toast('Ошибка при добавлении','error');
  }
}

// ── ТАБ: РАСПИСАНИЕ ───────────────────────────
// ── ТАБ: РАСПИСАНИЕ (КАЛЕНДАРНОЕ) ────────────

// Глобальное состояние недели
let _schedWeekOffset = 0;

// ============================================================
// SECTION: TRAINER:SCHEDULE — renderScheduleTab, loadScheduleWeek, renderAddSlotModal
// ============================================================
function getWeekBounds(offset=0) {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (now.getDay()+6)%7 + offset*7);
  mon.setHours(0,0,0,0);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  const fmt = d => d.toISOString().slice(0,10);
  return { mon, sun, monStr: fmt(mon), sunStr: fmt(sun) };
}

function weekLabel(offset) {
  const {mon,sun} = getWeekBounds(offset);
  if (offset===0) return 'Эта неделя';
  if (offset===1) return 'Следующая неделя';
  if (offset===-1) return 'Прошлая неделя';
  return `${mon.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})} – ${sun.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})}`;
}

async function renderScheduleTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  await loadScheduleWeek(_schedWeekOffset);
}

async function loadScheduleWeek(offset) {
  _schedWeekOffset = offset;
  const {mon, monStr, sunStr} = getWeekBounds(offset);
  const branch = STATE.profile.branches?.[0]||'';

  try {
    const [recurring, oneTime, events, trainerGroups] = await Promise.all([
      DB.getRecurringSlots(STATE.profile.id),
      DB.getOneTimeSlots(STATE.profile.id, monStr, sunStr),
      DB.getEventsForWeek(monStr, sunStr, branch),
      DB.getTrainerGroups(STATE.profile.id),
    ]);
    // Карта group_type_id → role для этого тренера
    window._myGroupRoleMap = {};
    trainerGroups.forEach(g => {
      if (g.role) window._myGroupRoleMap[g.group_type_id] = g.role;
    });

    const recurringIds = recurring.map(s=>s.id);
    const cancellations = await DB.getCancellations(recurringIds, monStr, sunStr);
    const cancelledSet = new Set(cancellations.map(c=>`${c.slot_id}__${c.cancel_date}`));

    // Строим сетку по датам недели
    const grid = {}; // grid[dow][hKey] = []
    for (let d=0;d<7;d++) { grid[d]={}; SCHEDULE_HOURS.forEach(h=>{grid[d][h]=[];}); }

    // Повторяющиеся (фильтруем отменённые)
    recurring.forEach(s=>{
      const dateForDow = new Date(mon); dateForDow.setDate(mon.getDate()+s.day_of_week);
      const dateStr = dateForDow.toISOString().slice(0,10);
      if (cancelledSet.has(`${s.id}__${dateStr}`)) return; // отменён
      const startH = parseInt(s.start_time.slice(0,2));
      const endH   = parseInt(s.end_time.slice(0,2));
      if (s.slot_type==='duty') {
        for (let h=startH;h<endH;h++) {
          const hKey=`${String(h).padStart(2,'0')}:00`;
          if (grid[s.day_of_week]?.[hKey])
            grid[s.day_of_week][hKey].push({...s,_dutyFirst:h===startH,_dutyLast:h===endH-1,_date:dateStr});
        }
      } else {
        const hKey=`${String(startH).padStart(2,'0')}:00`;
        if (grid[s.day_of_week]?.[hKey]) grid[s.day_of_week][hKey].push({...s,_date:dateStr});
      }
    });

    // Разовые слоты
    oneTime.forEach(s=>{
      const date = new Date(s.specific_date+'T12:00:00');
      const dow  = (date.getDay()+6)%7;
      const startH = parseInt(s.start_time.slice(0,2));
      const hKey=`${String(startH).padStart(2,'0')}:00`;
      if (grid[dow]?.[hKey]) grid[dow][hKey].push({...s,_date:s.specific_date,_oneTime:true});
    });

    // События
    events.forEach(ev=>{
      const startDate = new Date(ev.start_time);
      const dow = (startDate.getDay()+6)%7;
      // Используем локальное время (Supabase хранит в UTC, +5 Ташкент)
      const h   = startDate.getUTCHours() + 5;
      const adjH = h % 24;
      const hKey = `${String(adjH).padStart(2,'0')}:00`;
      const fallback = adjH < 7 ? '07:00' : adjH > 23 ? '22:00' : hKey;
      if (grid[dow]) {
        const key = grid[dow][hKey] !== undefined ? hKey : fallback;
        if (grid[dow][key]) grid[dow][key].push({...ev,_isEvent:true,_date:ev.start_time.slice(0,10)});
      }
    });

    // Заголовки дней с датами
    const dayHeaders = DAYS_SHORT.map((d,i)=>{
      const date = new Date(mon); date.setDate(mon.getDate()+i);
      const isToday = date.toISOString().slice(0,10) === todayStr();
      return `<th class="${isToday?'sched-today':''}">
        ${d}<br><span class="sched-date-num">${date.getDate()}</span>
      </th>`;
    }).join('');

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header">
        <h3>Расписание</h3>
        <button class="btn btn-sm" onclick="renderAddSlotModal()">+ Слот</button>
      </div>

      <!-- Навигация по неделям -->
      <div class="week-nav">
        <button class="btn btn-sm" onclick="loadScheduleWeek(${offset-1})">‹</button>
        <span class="week-label">${weekLabel(offset)}</span>
        <button class="btn btn-sm" onclick="loadScheduleWeek(${offset+1})">›</button>
      </div>
      ${offset!==0?`<button class="btn btn-sm" style="width:100%;margin-bottom:10px;background:var(--card)"
        onclick="loadScheduleWeek(0)">Сегодня</button>`:''}

      <div class="schedule-scroll">
        <table class="sched-table">
          <thead><tr>
            <th class="sched-time-col"></th>${dayHeaders}
          </tr></thead>
          <tbody>
            ${SCHEDULE_HOURS.map(h=>`<tr>
              <td class="sched-time">${h}</td>
              ${[0,1,2,3,4,5,6].map(dow=>`<td class="sched-cell">
                ${(grid[dow]?.[h]||[]).map(s=>renderSlotPill(s)).join('')}
              </td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="legend">
        ${Object.entries(SLOT_COLORS).map(([k,v])=>
          `<span class="legend-item" style="background:${v.bg};color:${v.color}">${v.label}</span>`
        ).join('')}
        <span class="legend-item" style="background:rgba(245,158,11,.15);color:var(--warn)">📌 Событие</span>
        <span class="legend-item" style="background:rgba(99,102,241,.15);color:#818cf8">★ Разовый</span>
      </div>
    </div>`;
  } catch(e) { toast('Ошибка загрузки расписания','error'); console.error(e); }
}

function renderSlotPill(s) {
  // Событие
  if (s._isEvent) {
    const bg = s.blocks_pool ? 'rgba(239,68,68,.15)' : 'rgba(245,158,11,.15)';
    const color = s.blocks_pool ? 'var(--danger)' : 'var(--warn)';
    return `<div class="slot-pill" style="background:${bg};color:${color}" title="${s.title}">
      📌 ${s.title.slice(0,8)}</div>`;
  }
  // Для групп — определяем цвет по роли тренера
  let c = SLOT_COLORS[s.slot_type];
  if (s.slot_type==='group') {
    const role = (window._myGroupRoleMap||{})[s.group_type_id]||'';
    if (role==='суша') c = {bg:'rgba(234,179,8,.18)',  color:'#ca8a04'};
    else               c = {bg:'rgba(59,130,246,.18)', color:'#3b82f6'};
  }
  const oneTimeMark = s._oneTime ? '★ ' : '';
  const oneBorder   = s._oneTime ? `border:1px dashed ${c.color};` : '';

  if (s.slot_type==='duty') {
    const bTop=s._dutyFirst?`border-top:2px solid ${c.color};border-radius:4px 4px 0 0;`:'';
    const bBot=s._dutyLast?`border-bottom:2px solid ${c.color};border-radius:0 0 4px 4px;margin-bottom:0;`:'';
    const label=s._dutyFirst?`${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`:'│';
    return `<div class="slot-pill slot-duty-block" style="background:${c.bg};color:${c.color};${bTop}${bBot}"
      onclick="showSlotMenu('${s.id}','${s.slot_type}','${s._date||''}',${!!s._oneTime})">${label}</div>`;
  }
  const label = s.slot_type==='pt'
    ? (s.clients?.fio?.split(' ')[0]||'ПТ')
    : (s.group_types?.name?.slice(0,6)||'Гр');
  return `<div class="slot-pill" style="background:${c.bg};color:${c.color};${oneBorder}"
    onclick="showSlotMenu('${s.id}','${s.slot_type}','${s._date||''}',${!!s._oneTime})">
    ${oneTimeMark}${label}</div>`;
}

function showSlotMenu(slotId, type, date, isOneTime) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Действие со слотом</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${date&&!isOneTime?`
      <button class="btn btn-full" style="margin-bottom:8px;background:var(--card);border:1px solid var(--warn);color:var(--warn)"
        onclick="this.closest('.modal-overlay').remove();doSkipSlotDate('${slotId}','${date}')">
        Пропустить ${date} (только этот день)</button>`:''}
    <button class="btn btn-danger btn-full"
      onclick="this.closest('.modal-overlay').remove();doDeleteSlot('${slotId}','${type}',${isOneTime})">
      ${isOneTime?'Удалить разовый слот':'Удалить из расписания навсегда'}</button>
  </div>`;
  document.body.appendChild(m);
}

async function doSkipSlotDate(slotId, date) {
  try {
    await DB.cancelSlotDate(slotId, date);
    toast(`Слот ${date} пропущен`,'success');
    loadScheduleWeek(_schedWeekOffset);
  } catch(e) { console.error(e); toast('Ошибка','error'); }
}

async function doDeleteSlot(slotId, type, isOneTime) {
  const msg = isOneTime ? 'Удалить разовый слот?' : `Удалить слот (${SLOT_COLORS[type]?.label||type}) навсегда?`;
  if (!confirm(msg)) return;
  try { await DB.deactivateSlot(slotId); toast('Удалено','success'); loadScheduleWeek(_schedWeekOffset); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}

async function confirmDeleteSlot(id,type) {
  await doDeleteSlot(id,type,false);
}

async function renderAddSlotModal() {
  const branches=STATE.profile.branches||[];
  const clients=await DB.getClients(STATE.profile.id);
  const groupList=await DB.getTrainerGroups(STATE.profile.id);
  window._slotClients=clients.filter(c=>!c.is_archived); window._slotGroupList=groupList;

  // Даты текущей недели для разового слота
  const {mon} = getWeekBounds(_schedWeekOffset);
  const weekDates = DAYS_FULL.map((d,i)=>{
    const date=new Date(mon); date.setDate(mon.getDate()+i);
    const ds=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    return `<option value="${ds}">${d} (${date.getDate()})</option>`;
  }).join('');

  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить слот</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${branchSelect('slot-branch',branches)}

    <div class="form-group"><label>Тип добавления</label>
      <select id="slot-recur" onchange="onSlotRecurChange(this)">
        <option value="recurring">Постоянный (каждую неделю)</option>
        <option value="onetime">Разовый (конкретная дата)</option>
      </select>
    </div>

    <div id="slot-recurring-dow" class="form-group"><label>Дни недели (можно выбрать несколько)</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="slot-dow-checkboxes">
        ${DAYS_FULL.map((d,i)=>`<label style="display:flex;align-items:center;gap:4px;font-size:13px;padding:6px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;cursor:pointer">
          <input type="checkbox" name="slot-dow" value="${i}" ${i===0?'checked':''}> ${d}</label>`).join('')}
      </div></div>
    <div id="slot-onetime-date" class="form-group" style="display:none"><label>Дата</label>
      <select id="slot-date">${weekDates}</select></div>

    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label><input type="time" id="slot-start" value="09:00" oninput="(()=>{const[h,m]=this.value.split(':').map(Number);const e=new Date(0,0,0,h+1,m);document.getElementById('slot-end').value=String(e.getHours()).padStart(2,'0')+':'+String(e.getMinutes()).padStart(2,'0')})()"></div>
      <div style="flex:1"><label>Конец</label><input type="time" id="slot-end" value="10:00"></div>
    </div>
    <div class="form-group"><label>Тип</label>
      <select id="slot-type" onchange="onSlotTypeChange(this)">
        <option value="duty">Дежурство</option>
        <option value="pt">ПТ</option>
        <option value="group">Группа</option>
      </select>
    </div>
    <div id="slot-extra"></div>
    <button class="btn btn-primary btn-full" onclick="doAddSlot()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
  onSlotTypeChange(document.getElementById('slot-type'));
}

function onSlotRecurChange(sel) {
  document.getElementById('slot-recurring-dow').style.display = sel.value==='onetime' ? 'none' : '';
  document.getElementById('slot-onetime-date').style.display  = sel.value==='onetime' ? '' : 'none';
}

function onSlotTypeChange(sel) {
  const extra=document.getElementById('slot-extra'); if (!extra) return;
  const clients=window._slotClients||[], groups=window._slotGroupList||[];
  if (sel.value==='pt') {
    extra.innerHTML=`<div class="form-group"><label>Клиент</label>
      <select id="slot-client"><option value="">— выберите —</option>
        ${clients.map(c=>`<option value="${c.id}">${c.fio}</option>`).join('')}
      </select></div>`;
  } else if (sel.value==='group') {
    extra.innerHTML=`
      <div class="form-group"><label>Тип группы</label>
        <select id="slot-group"><option value="">— выберите —</option>
          ${groups.map(g=>`<option value="${g.group_type_id}">${g.group_types?.name||'?'}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Средняя явка (чел.)</label>
        <input type="number" id="slot-headcount" min="1" value="5"></div>`;
  } else { extra.innerHTML=''; }
}

async function doAddSlot() {
  const branch    = document.getElementById('slot-branch')?.value||STATE.profile.branches?.[0]||'';
  const recur     = document.getElementById('slot-recur')?.value||'recurring';
  const checkedDows = recur==='onetime' ? [] :
    [...document.querySelectorAll('input[name="slot-dow"]:checked')].map(el=>parseInt(el.value));
  const dow       = checkedDows.length ? checkedDows[0] : 0;
  const date      = document.getElementById('slot-date')?.value||null;
  const start     = document.getElementById('slot-start')?.value;
  const end       = document.getElementById('slot-end')?.value;
  const type      = document.getElementById('slot-type')?.value;
  const clientId  = document.getElementById('slot-client')?.value||null;
  const groupId   = document.getElementById('slot-group')?.value||null;
  const headcount = parseInt(document.getElementById('slot-headcount')?.value||'0');
  if (!start||!end)            return toast('Укажите время','error');
  if (start>=end)              return toast('Конец позже начала','error');
  if (type==='pt'&&!clientId)  return toast('Выберите клиента','error');
  if (type==='group'&&!groupId)return toast('Выберите группу','error');

  const baseFields = {
    trainer_id:    STATE.profile.id,
    branch,
    start_time:    start,
    end_time:      end,
    slot_type:     type,
    client_id:     type==='pt'    ? clientId          : null,
    group_type_id: type==='group' ? parseInt(groupId) : null,
    avg_headcount: type==='group' ? headcount         : null,
    specific_date: recur==='onetime' ? date : null,
  };

  try {
    if (recur==='onetime') {
      await DB.addSlot({...baseFields,
        day_of_week: date ? (new Date(date+'T12:00:00').getDay()+6)%7 : dow});
    } else {
      const days = checkedDows && checkedDows.length ? checkedDows : [dow];
      for (const d of days) {
        await DB.addSlot({...baseFields, day_of_week: d});
      }
    }
    document.querySelector('.modal-overlay')?.remove();
    toast('Слот добавлен ✅','success');
    loadScheduleWeek(_schedWeekOffset);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: СЕГОДНЯ ──────────────────────────────
// ============================================================
// SECTION: TRAINER:TODAY — renderTodayTab, doConfirm
// ============================================================
async function renderTodayTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const date=todayStr();
  const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
  const yesterdayStr=yesterday.toISOString().slice(0,10);
  const dayName=DAYS_FULL[(new Date().getDay()+6)%7];
  try {
    const [slots, yesterdaySlots, events, todayWorkouts] = await Promise.all([
      DB.getTodaySlots(STATE.profile.id, date),
      DB.getTodaySlots(STATE.profile.id, yesterdayStr),
      DB.getUpcomingEvents(STATE.profile.branches?.[0]||null),
      DB.getTodayWorkouts(STATE.profile.id, date),
    ]);

    // Вчерашние незакрытые (только PT и группы, без дежурств)
    const missedSlots = yesterdaySlots.filter(s=>
      s.slot_type!=='duty' && !s.confirmation
    );

    const ptSlots=slots.filter(s=>s.slot_type==='pt');
    const grpSlots=slots.filter(s=>s.slot_type==='group');
    const dutySlots=slots.filter(s=>s.slot_type==='duty');
    const pending=slots.filter(s=>!s.confirmation&&s.slot_type!=='duty').length;
    const todayEvents=events.filter(e=>fmtDate(e.start_time)===fmtDate(new Date()));

    // Сохраняем пропущенные в глобальной переменной для панели
    window._missedSlots = missedSlots;
    window._missedDate  = yesterdayStr;

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header">
        <div><h3>Сегодня</h3><p class="hint">${dayName}, ${date}</p></div>
        <div style="display:flex;align-items:center;gap:8px">
          ${pending>0?`<div class="pending-badge">${pending}</div>`:''}
          <button onclick="renderMissedSlotsPanel()" style="background:${missedSlots.length?'rgba(239,68,68,.15)':'rgba(255,255,255,.07)'};color:${missedSlots.length?'#ef4444':'var(--hint)'};border:1px solid ${missedSlots.length?'rgba(239,68,68,.3)':'var(--border)'};border-radius:10px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer">
            ⚠️ Пропущенные${missedSlots.length?` (${missedSlots.length})`:''}
          </button>
        </div>
      </div>
      ${todayEvents.map(ev=>`<div class="today-card event-card-mini ${ev.blocks_pool?'event-blocking':''}">
        <span>${EVENT_TYPES[ev.event_type]||'📌'} <b>${ev.title}</b></span>
        <span class="hint">${fmtTime(ev.start_time)}–${fmtTime(ev.end_time)}</span>
        ${ev.blocks_pool?'<span class="overdue-badge">Бассейн закрыт</span>':''}
      </div>`).join('')}
      ${dutySlots.length?`<h4>Дежурство</h4>
        ${dutySlots.map(s=>`<div class="today-card duty-card">
          <div class="today-card-row">
            <span class="today-time">⏱ ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</span>
            <span class="today-label">Дежурство · ${s.branch}</span>
          </div></div>`).join('')}`:''}
      ${ptSlots.length?`<h4>Персональные тренировки</h4>${ptSlots.map(s=>renderTodaySlot(s,date)).join('')}`:''}
      ${grpSlots.length?`<h4>Групповые занятия</h4>${grpSlots.map(s=>renderTodaySlot(s,date)).join('')}`:''}
      ${!slots.length&&!todayEvents.length&&!missedSlots.length?'<div class="empty-state">📭<p>На сегодня ничего нет</p></div>':''}
      ${todayWorkouts.length?`
      <h4 style="margin-top:20px">✅ Списано сегодня (${todayWorkouts.length})</h4>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${todayWorkouts.map(w=>{
          const type = w.is_drop_in?'Разовое':w.is_debt?'В долг':'ПТ';
          const color = w.is_debt?'#f59e0b':w.is_drop_in?'#7c3aed':'#10b981';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px">
            <div>
              <div style="font-weight:500">${w.clients?.fio||'—'}</div>
              <div style="font-size:12px;color:var(--hint)">Кат.${w.clients?.category||w.category||'?'}</div>
            </div>
            <span style="font-size:12px;padding:2px 8px;border-radius:8px;background:rgba(16,185,129,.1);color:${color};font-weight:600">${type}</span>
          </div>`;
        }).join('')}
      </div>`:''}
    </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function renderTodaySlot(s,date) {
  const conf=s.confirmation, status=conf?.status||'pending';
  const isAdult=s.group_types?.billing_model==='headcount';
  const label=s.slot_type==='pt'?(s.clients?.fio||'Клиент'):(s.group_types?.name||'Группа');
  const timeStr=`${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`;
  const cat=s.clients?.category||1;
  const clientId=s.client_id||'';
  const slotBranch=encodeURIComponent(s.branch||'');

  if (status==='confirmed') return `<div class="today-card confirmed-card">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span><span class="today-label">${label}</span>
      <span class="status-badge confirmed">✓ Подтверждено</span>
    </div>
    ${conf?.actual_headcount?`<div class="today-sub">Явка: ${conf.actual_headcount} чел.</div>`:''}
  </div>`;

  if (status==='cancelled') return `<div class="today-card cancelled-card">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span><span class="today-label">${label}</span>
      <span class="status-badge cancelled">✗ Отменено</span>
    </div>
    ${conf?.cancel_reason?`<div class="today-sub">${conf.cancel_reason}</div>`:''}
  </div>`;

  const isPt=s.slot_type==='pt';
  return `<div class="today-card pending-card">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span><span class="today-label">${label}</span>
      <span class="status-badge pending">Ожидает</span>
    </div>
    ${s.clients?.balance===0?'<div class="today-sub warn-text">⚠️ Нулевой баланс</div>':''}
    ${isAdult?`<div class="form-group" style="margin:8px 0 0">
      <label>Явка (чел.)</label>
      <input type="number" id="hc-${s.id}" min="1" max="50" value="5" style="width:80px;display:inline-block">
    </div>`:''}
    <div class="today-actions">
      <button class="btn btn-sm btn-primary"
        onclick="doConfirm('${s.id}','${date}',${isPt},${isAdult},'${clientId}',${cat},'${slotBranch}','${s.group_type_id||''}')">
        Подтвердить</button>
      <button class="btn btn-sm btn-danger" onclick="doCancelSlot('${s.id}','${date}')">Отменить</button>
    </div>
  </div>`;
}

async function doConfirm(slotId,date,isPt,isAdult,clientId,category,branchEnc,groupTypeId) {
  const branch=decodeURIComponent(branchEnc);
  const headcount=isAdult?parseInt(document.getElementById(`hc-${slotId}`)?.value||5):null;
  try {
    let workoutId=null;
    if (isPt&&clientId) {
      const rows=[{trainer_id:STATE.profile.id,client_id:clientId,category_at_moment:category,
        branch,workout_date:new Date().toISOString(),is_debt:false,is_drop_in:false}];
      const w=await DB.logWorkouts(rows); workoutId=w?.[0]?.id;
    }
    if (isAdult&&groupTypeId) {
      await DB.logGroupSession(STATE.profile.id,parseInt(groupTypeId),branch,date,headcount);
    }
    await DB.upsertConfirmation(slotId,date,{status:'confirmed',actual_headcount:headcount,workout_id:workoutId});
    toast('✅ Подтверждено','success'); renderTodayTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function doCancelSlot(slotId,date) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Причина отмены</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Причина</label>
      <textarea id="cancel-reason" rows="3" placeholder="Клиент отменил, болезнь..."></textarea></div>
    <button class="btn btn-danger btn-full" onclick="doConfirmCancel('${slotId}','${date}')">Отменить занятие</button>
  </div>`;
  document.body.appendChild(m);
}
async function doConfirmCancel(slotId,date) {
  const reason=document.getElementById('cancel-reason')?.value.trim()||'';
  try {
    await DB.upsertConfirmation(slotId,date,{status:'cancelled',cancel_reason:reason||null});
    document.querySelector('.modal-overlay')?.remove();
    toast('Отменено','success'); renderTodayTab();
  } catch(e) { console.error(e); toast('Ошибка','error'); }
}

// ── ТАБ: ДЕЖУРСТВО (РУЧНОЙ ВВОД) ────────────
// ============================================================
// SECTION: TRAINER:DUTIES — renderDutyTab, doLogDuty, renderLateRequestModal
// ============================================================
async function renderDutyTab() {
  const branches=STATE.profile.branches||[];
  const now=new Date();
  const _p2=n=>String(n).padStart(2,'0');
  const _ymd=`${now.getFullYear()}-${_p2(now.getMonth()+1)}-${_p2(now.getDate())}`;
  const defStart=`${_ymd}T07:00`;
  const defEnd=`${_ymd}T${_p2(now.getHours())}:00`;
  const duties=await DB.getDuties(STATE.profile.id,now.getFullYear(),now.getMonth()+1);

  $('#tab-content').innerHTML=`<div class="tab-pad">
    <h3>Записать дежурство</h3>
    <p class="hint" style="margin-bottom:16px">Выберите смену или введите время вручную.</p>
    ${branchSelect('sel-branch',branches)}
    ${dutyShiftSelect('sel-branch')}
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label>
        <input type="datetime-local" id="duty-start" value="${defStart}" step="3600"
          onchange="this.value=this.value.slice(0,13)+':00'"></div>
      <div style="flex:1"><label>Конец</label>
        <input type="datetime-local" id="duty-end" value="${defEnd.slice(0,13)+':00'}" step="3600"
          onchange="this.value=this.value.slice(0,13)+':00'"></div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doLogDuty()">Записать</button>
    <h4 style="margin-top:20px">Дежурства в этом месяце</h4>
    ${!duties.length?'<p class="hint">Нет записей</p>':duties.map(d=>{
      const h=hoursFromDuty(d.start_time,d.end_time);
      const startLocal=new Date(d.start_time).toISOString().slice(0,16);
      const endLocal  =new Date(d.end_time).toISOString().slice(0,16);
      return `<div class="history-item">
        <div class="hi-main" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span class="hi-client">${d.branch}</span>
            <span class="hi-cat">${h.toFixed(2)}ч = ${fmt(Math.round(h*RATES.duty_per_hour))} сум</span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
              onclick="renderEditDutyModal('${d.id}','${startLocal}','${endLocal}','${d.branch}')">✏️</button>
            <button class="btn btn-sm btn-danger"
              onclick="doDeleteDuty('${d.id}')">🗑</button>
          </div>
        </div>
        <div class="hi-sub">${fmtDT(d.start_time)} → ${fmtDT(d.end_time)}</div>
      </div>`;
    }).join('')}
  </div>`;
  wireDutyShift('sel-branch');
}
async function doLogDuty() {
  const start=document.getElementById('duty-start')?.value;
  const end=document.getElementById('duty-end')?.value;
  const branch=getBranch();
  if (!start||!end) return toast('Введите время','error');
  if (start>=end) return toast('Конец позже начала','error');
  if (!branch) return toast('Выберите филиал','error');
  const h=hoursFromDuty(new Date(start),new Date(end));
  if (h>16) return toast('Не более 16 часов','error');
  try {
    await sb().from('duties').insert({
      trainer_id:STATE.profile.id,branch,
      start_time:new Date(start).toISOString(),
      end_time:new Date(end).toISOString(),
    });
    toast(`✅ ${h.toFixed(1)}ч = ${fmt(Math.round(h*RATES.duty_per_hour))} сум`,'success');
    renderDutyTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ПОЗДНИЕ ТРЕНИРОВКИ (>48ч) ─────────────────
async function renderLateRequestModal() {
  const clients = (await DB.getClients(STATE.profile.id)).filter(c=>!c.is_archived);
  if (!clients.length) return toast('Нет клиентов','error');
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header">
      <h3>⏰ Запрос на позднюю тренировку</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
    </div>
    <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px;color:var(--text)">
      Тренировка будет внесена только после одобрения координатора или старшего тренера
    </div>
    <div class="form-group"><label>Клиент</label>
      <select id="lr-client">
        <option value="">— выберите —</option>
        ${clients.map(c=>`<option value="${c.id}" data-cat="${c.category}">${c.fio} (кат.${c.category}, баланс:${c.balance})</option>`).join('')}
      </select></div>
    <div class="form-group"><label>Дата и время тренировки</label>
      <input type="datetime-local" id="lr-date"></div>
    <div class="form-group"><label>Причина <span style="color:var(--danger)">*</span></label>
      <textarea id="lr-reason" rows="3" placeholder="Объясните почему тренировка не была внесена вовремя..." style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px;resize:none"></textarea></div>
    <button class="btn btn-primary btn-full" onclick="doSendLateRequest()">Отправить запрос</button>
  </div>`;
  document.body.appendChild(m);
}

async function doSendLateRequest() {
  const clientId = document.getElementById('lr-client')?.value;
  const dateVal  = document.getElementById('lr-date')?.value;
  const reason   = document.getElementById('lr-reason')?.value.trim();
  const clientOpt= document.getElementById('lr-client');
  const cat      = parseInt(clientOpt?.options[clientOpt.selectedIndex]?.dataset.cat||'1');
  const branch   = getBranch();
  if (!clientId) return toast('Выберите клиента','error');
  if (!dateVal)  return toast('Укажите дату тренировки','error');
  if (!reason)   return toast('Напишите причину','error');
  if (!branch)   return toast('Выберите филиал','error');
  // Проверяем что дата действительно старше 48ч
  if (Date.now() - new Date(dateVal).getTime() < 48*3600000)
    return toast('Дата должна быть старше 48 часов. Обычные тренировки вносите стандартным способом.','error');
  try {
    await DB.addLateRequest(STATE.profile.id, clientId, branch, new Date(dateVal).toISOString(), cat, reason);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Запрос отправлен координатору','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Одобрение / отклонение (для координатора и старшего тренера)
async function doApproveLateRequest(id) {
  if (!confirm('Одобрить тренировку и списать с баланса клиента?')) return;
  try {
    await DB.approveLateRequest(id, STATE.profile.id);
    toast('✅ Тренировка добавлена','success');
    renderAdminControl();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doRejectLateRequest(id) {
  const note = prompt('Причина отказа (опционально):');
  if (note === null) return; // отмена
  try {
    await DB.rejectLateRequest(id, STATE.profile.id, note);
    toast('Запрос отклонён','success');
    renderAdminControl();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doApproveLateRequestSenior(id) {
  if (!confirm('Одобрить тренировку и списать с баланса клиента?')) return;
  try {
    await DB.approveLateRequest(id, STATE.profile.id);
    toast('✅ Тренировка добавлена','success');
    renderSeniorAnalytics();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doRejectLateRequestSenior(id) {
  const note = prompt('Причина отказа (опционально):');
  if (note === null) return;
  try {
    await DB.rejectLateRequest(id, STATE.profile.id, note);
    toast('Запрос отклонён','success');
    renderSeniorAnalytics();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ПРОБНЫЕ ТРЕНИРОВКИ ────────────────────────
function renderTrialSessionModal() {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header">
      <h3>🆕 Пробная тренировка</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
    </div>
    <p class="hint" style="margin-bottom:12px">ЗП начисляется как за разовое посещение</p>
    <div class="form-group"><label>Имя <span style="color:var(--danger)">*</span></label>
      <input id="tr-fname" type="text" placeholder="Анна"></div>
    <div class="form-group"><label>Фамилия</label>
      <input id="tr-lname" type="text" placeholder="Иванова"></div>
    <div class="form-group"><label>Телефон</label>
      <input id="tr-phone" type="tel" placeholder="+998 90 000 00 00"></div>
    <div class="form-group"><label>Возраст</label>
      <input id="tr-age" type="number" min="3" max="99" placeholder="—"></div>
    <div class="form-group"><label>Категория <span style="color:var(--danger)">*</span></label>
      <div class="cat-picker">
        ${[1,2,3].map(n=>`<button class="cat-btn ${n===1?'active':''}" data-cat="${n}"
          onclick="selectCat(this)">Кат.${n}<br><small>${fmt(RATES.pt[n])} сум</small></button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doAddTrialSession()">Записать</button>
  </div>`;
  document.body.appendChild(m);
}

async function doAddTrialSession() {
  const fname = document.getElementById('tr-fname')?.value.trim();
  const lname = document.getElementById('tr-lname')?.value.trim();
  const phone = document.getElementById('tr-phone')?.value.trim();
  const age   = parseInt(document.getElementById('tr-age')?.value)||null;
  const cat   = parseInt(document.querySelector('.cat-btn.active')?.dataset.cat||'1');
  const branch = getBranch();
  if (!fname) return toast('Введите имя','error');
  if (!branch) return toast('Выберите филиал','error');
  try {
    await DB.addTrialSession(STATE.profile.id, branch, fname, lname, phone, age, cat);
    document.querySelector('.modal-overlay')?.remove();
    toast(`✅ Пробная записана — ${fname}${lname?' '+lname:''}  · ${fmt(RATES.pt[cat])} сум`,'success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function renderEditDutyModal(dutyId, start, end, branch) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать дежурство</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label>
        <input type="datetime-local" id="ed-start" value="${start}"></div>
      <div style="flex:1"><label>Конец</label>
        <input type="datetime-local" id="ed-end" value="${end}"></div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doEditDuty('${dutyId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditDuty(dutyId) {
  const start = document.getElementById('ed-start')?.value;
  const end   = document.getElementById('ed-end')?.value;
  if (!start||!end||start>=end) return toast('Проверьте время','error');
  const h = hoursFromDuty(new Date(start),new Date(end));
  if (h>16) return toast('Не более 16 часов','error');
  try {
    await sb().from('duties').update({
      start_time:new Date(start).toISOString(),
      end_time:new Date(end).toISOString(),
    }).eq('id',dutyId);
    document.querySelector('.modal-overlay')?.remove();
    toast(`✅ ${h.toFixed(1)}ч сохранено`,'success');
    renderDutyTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteDuty(dutyId) {
  if (!confirm('Удалить дежурство?')) return;
  try {
    await sb().from('duties').delete().eq('id',dutyId);
    toast('Удалено','success'); renderDutyTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: СОБЫТИЯ ──────────────────────────────
// ============================================================
// SECTION: TRAINER:EVENTS — renderEventsTab
// ============================================================
async function renderEventsTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const branch=STATE.profile.branches?.[0]||null;
    const events=await DB.getUpcomingEvents(branch);
    const canCreate=['admin','senior_trainer'].includes(STATE.profile.role);
    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header"><h3>События</h3>
        ${canCreate?`<button class="btn btn-sm" onclick="renderCreateEventModal()">+ Событие</button>`:''}
      </div>
      ${!events.length?'<div class="empty-state">📭<p>Предстоящих событий нет</p></div>':
        events.map(ev=>renderEventCard(ev)).join('')}
    </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderEventCard(ev) {
  const isParticipant=ev.event_participants?.some(p=>p.trainer_id===STATE.profile.id);
  const count=ev.event_participants?.length||0;
  const canCreate=['admin','senior_trainer'].includes(STATE.profile.role);
  return `<div class="event-card ${ev.blocks_pool?'event-blocking':''}">
    <div class="event-type-badge">${EVENT_TYPES[ev.event_type]||'📌 Другое'}</div>
    <div class="event-title">${ev.title}</div>
    <div class="event-meta">📍 ${ev.location||'—'} · ${ev.branch||'Все филиалы'}</div>
    <div class="event-meta">🕐 ${fmtDT(ev.start_time)} → ${fmtDT(ev.end_time)}</div>
    ${ev.description?`<div class="event-desc">${ev.description}</div>`:''}
    ${ev.blocks_pool?'<div class="event-block-warn">🚫 Бассейн закрыт в это время</div>':''}
    <div class="event-footer">
      <span class="hint">👥 ${count} · ${ev.profiles?.fio?.split(' ')[0]||'?'}</span>
      <div style="display:flex;gap:6px">
        ${isParticipant
          ?`<button class="btn btn-sm btn-danger" onclick="doLeaveEvent('${ev.id}')">Не иду</button>`
          :`<button class="btn btn-sm btn-primary" onclick="doJoinEvent('${ev.id}')">Иду ✓</button>`}
        ${canCreate?`<button class="btn btn-sm btn-danger" onclick="doDeleteEvent('${ev.id}')">🗑</button>`:''}
      </div>
    </div>
  </div>`;
}
async function doJoinEvent(id)  { try { await DB.joinEvent(id,STATE.profile.id);  toast('✅ Записаны','success'); renderEventsTab(); } catch(e){console.error(e);toast('Ошибка','error');} }
async function doLeaveEvent(id) { try { await DB.leaveEvent(id,STATE.profile.id); toast('Отменено','success'); renderEventsTab(); } catch(e){console.error(e);toast('Ошибка','error');} }
async function doDeleteEvent(id){ if(!confirm('Удалить событие?'))return; try{await DB.deleteEvent(id);toast('Удалено','success');renderEventsTab();}catch(e){console.error(e);toast('Ошибка','error');} }

function renderCreateEventModal() {
  const branches=STATE.profile.branches||[];
  const now=new Date().toISOString().slice(0,16);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новое событие</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label><input id="ev-title" placeholder="Соревнования"></div>
    <div class="form-group"><label>Тип</label>
      <select id="ev-type">
        <option value="competition">🏆 Соревнование</option>
        <option value="qualification">📚 Квалификация</option>
        <option value="repair">🔧 Ремонт</option>
        <option value="other">📌 Другое</option>
      </select></div>
    <div class="form-group"><label>Описание</label><textarea id="ev-desc" rows="2"></textarea></div>
    <div class="form-group"><label>Место</label><input id="ev-location"></div>
    <div class="form-group"><label>Филиал</label>
      <select id="ev-branch"><option value="">Все филиалы</option>
        ${branches.map(b=>`<option>${b}</option>`).join('')}
      </select></div>
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label><input type="datetime-local" id="ev-start" value="${now}"></div>
      <div style="flex:1"><label>Конец</label><input type="datetime-local" id="ev-end" value="${now}"></div>
    </div>
    <label class="toggle-row" style="margin-bottom:16px">
      <input type="checkbox" id="ev-blocks">
      <span class="toggle-track"><span class="toggle-thumb"></span></span>
      <span>Бассейн закрыт (блокирует)</span>
    </label>
    <button class="btn btn-primary btn-full" onclick="doCreateEvent()">Создать</button>
  </div>`;
  document.body.appendChild(m);
}
async function doCreateEvent() {
  const title=document.getElementById('ev-title')?.value.trim();
  const type=document.getElementById('ev-type')?.value;
  const desc=document.getElementById('ev-desc')?.value.trim();
  const location=document.getElementById('ev-location')?.value.trim();
  const branch=document.getElementById('ev-branch')?.value||null;
  const start=document.getElementById('ev-start')?.value;
  const end=document.getElementById('ev-end')?.value;
  const blocks=document.getElementById('ev-blocks')?.checked||false;
  if (!title) return toast('Введите название','error');
  if (!start||!end||start>=end) return toast('Проверьте время','error');
  try {
    await DB.createEvent({title,event_type:type,description:desc||null,
      location:location||null,branch,blocks_pool:blocks,
      start_time:new Date(start).toISOString(),end_time:new Date(end).toISOString(),
      created_by:STATE.profile.id});
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Событие создано','success'); renderEventsTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: ОТЧЁТ ТРЕНЕРА ───────────────────────
async function renderReportTab() {
  const now=new Date(); let year=now.getFullYear(), month=now.getMonth()+1;
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Мой отчёт</h3>
      <div style="display:flex;align-items:center;gap:6px">
        <div class="month-nav">
          <button id="prev-m">‹</button><span id="rep-month">${fmtMY(year,month)}</span><button id="next-m">›</button>
        </div>
        <button id="rep-excel" class="btn btn-sm" style="background:rgba(16,185,129,.15);color:#059669">⬇️ Excel</button>
      </div>
    </div>
    <div id="rep-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  const load=()=>loadTrainerReport(year,month);
  document.getElementById('prev-m')?.addEventListener('click',()=>{if(month===1){year--;month=12;}else month--;document.getElementById('rep-month').textContent=fmtMY(year,month);load();});
  document.getElementById('next-m')?.addEventListener('click',()=>{if(month===12){year++;month=1;}else month++;document.getElementById('rep-month').textContent=fmtMY(year,month);load();});
  document.getElementById('rep-excel')?.addEventListener('click',()=>doExportTrainer(STATE.profile.id,encodeURIComponent(STATE.profile.fio),year,month));
  await load();
}
// ============================================================
// SECTION: TRAINER:REPORT — loadTrainerReport (отчёт тренера, ЗП)
// ============================================================
async function loadTrainerReport(year,month) {
  const body=document.getElementById('rep-body'); if (!body) return;
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const [workouts,duties,trainerGroups,groupSessions,childAuto,groupSubstitutions,trialSessions]=await Promise.all([
      DB.getWorkouts(STATE.profile.id,year,month),
      DB.getDuties(STATE.profile.id,year,month),
      DB.getTrainerGroups(STATE.profile.id),
      DB.getGroupSessions(STATE.profile.id,year,month),
      DB.getChildGroupsAutoSalary(STATE.profile.id, fromDay),
      sb().from('group_substitutions').select('*, trainer_groups(*, group_types(name))').eq('substitute_trainer_id',STATE.profile.id).gte('session_date',fromDay).lt('session_date',new Date(year,month,1).toISOString().slice(0,10)).then(r=>r.data||[]),
      DB.getTrialSessions(STATE.profile.id,year,month),
    ]);
    const adjustment=await DB.getAdjustment(STATE.profile.id,year,month);
    const sal=calcSalary({workouts,duties,trainerGroups,groupSessions,adjustment,groupSubstitutions,trialSessions,trainerId:STATE.profile.id,childAutoSum:childAuto.total});

    // Ожидающие подтверждения (замены)
    const pending = await DB.getPendingConfirmations(STATE.profile.id);
    // Входящие запросы на передачу
    const transfers = await DB.getIncomingTransfers(STATE.profile.id);

    body.innerHTML=`
      ${pending.length?`<div class="warn-banner" style="background:rgba(124,58,237,.1);border-color:rgba(124,58,237,.3);color:var(--text)">
        <b>⚡ ${pending.length} замен(а) ждут подтверждения</b>
        ${pending.map(w=>`
          <div class="sub-confirm-row">
            <div>
              <span class="hi-client">${w.clients?.fio||'?'}</span>
              <span class="hint"> · от ${w.profiles?.fio||'?'} · ${fmtDate(w.workout_date)}</span>
            </div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-sm btn-primary" onclick="doResolveSubstitute('${w.id}','${w.client_id}',true)">✓ Принять</button>
              <button class="btn btn-sm btn-danger"  onclick="doResolveSubstitute('${w.id}','${w.client_id}',false)">✗ Отклонить</button>
            </div>
          </div>`).join('')}
      </div>`:''}

      ${transfers.length?`<div class="warn-banner" style="background:rgba(16,185,129,.08);border-color:rgba(16,185,129,.3);color:var(--text)">
        <b>👤 ${transfers.length} запрос(а) на передачу клиента</b>
        ${transfers.map(t=>`
          <div class="sub-confirm-row">
            <div>
              <span class="hi-client">${t.clients?.fio||'?'}</span>
              <span class="hint"> · от ${t.profiles?.fio||'?'}</span>
              ${t.note?`<div class="hint">${t.note}</div>`:''}
            </div>
            <div style="display:flex;gap:6px;margin-top:6px">
              <button class="btn btn-sm btn-primary" onclick="doResolveTransfer('${t.id}','${t.client_id}',${t.to_trainer_id},true)">✓ Принять</button>
              <button class="btn btn-sm btn-danger"  onclick="doResolveTransfer('${t.id}','${t.client_id}',${t.to_trainer_id},false)">✗ Отклонить</button>
            </div>
          </div>`).join('')}
      </div>`:''}

      <div class="summary-cards">
        <div class="summary-card"><div class="s-val">${sal.cat[1]+sal.cat[2]+sal.cat[3]}</div><div class="s-lbl">ПТ</div></div>
        <div class="summary-card"><div class="s-val">${(sal.cat.dropIn1||0)+(sal.cat.dropIn2||0)+(sal.cat.dropIn3||0)}</div><div class="s-lbl">Разовые</div></div>
        ${trialSessions.length?`<div class="summary-card"><div class="s-val">${trialSessions.length}</div><div class="s-lbl">Пробные</div></div>`:''}
        <div class="summary-card"><div class="s-val">${sal.hours.toFixed(1)}ч</div><div class="s-lbl">Деж.</div></div>
        <div class="summary-card">
          <div class="s-val" style="font-size:13px">${sal.adultSum+sal.childSum>0?fmt(sal.adultSum+sal.childSum):'—'}</div>
          <div class="s-lbl">Группы${sal.adultSum+sal.childSum>0?'<div style="font-size:10px;opacity:.6">авто</div>':''}</div>
        </div>
        <div class="summary-card accent">
          <div class="s-val">${fmt(sal.total)}</div>
          <div class="s-lbl">К выплате (сум)</div>
        </div>
      </div>

      <!-- Детализация расчёта ЗП -->
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px">
        <div style="font-weight:700;font-size:14px;margin-bottom:10px">Детализация ЗП</div>

        ${(sal.cat[1]||sal.cat[2]||sal.cat[3]||sal.cat.dropIn1||sal.cat.dropIn2||sal.cat.dropIn3||trialSessions.length||sal.ptSubSum)?`
        <div style="font-size:12px;color:var(--hint);font-weight:600;margin-bottom:4px">ПЕРСОНАЛЬНЫЕ ТРЕНИРОВКИ</div>
        ${sal.cat[1]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>К1 × ${sal.cat[1]} шт</span><span style="font-weight:600">${fmt(sal.cat[1]*RATES.pt[1])} сум</span></div>`:''}
        ${sal.cat[2]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>К2 × ${sal.cat[2]} шт</span><span style="font-weight:600">${fmt(sal.cat[2]*RATES.pt[2])} сум</span></div>`:''}
        ${sal.cat[3]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>К3 × ${sal.cat[3]} шт</span><span style="font-weight:600">${fmt(sal.cat[3]*RATES.pt[3])} сум</span></div>`:''}
        ${sal.cat.dropIn1||sal.cat.dropIn2||sal.cat.dropIn3?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Разовые (${(sal.cat.dropIn1||0)+(sal.cat.dropIn2||0)+(sal.cat.dropIn3||0)} шт)</span><span style="font-weight:600">${fmt(sal.dropInSum)} сум</span></div>`:''}
        ${trialSessions.length?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Пробные (${trialSessions.length} шт)</span><span style="font-weight:600">${fmt(sal.trialSum)} сум</span></div>`:''}
        ${sal.ptSubSum?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Замены ПТ</span><span style="font-weight:600">${fmt(sal.ptSubSum)} сум</span></div>`:''}
        `:''}

        ${sal.hours>0?`
        <div style="font-size:12px;color:var(--hint);font-weight:600;margin-top:8px;margin-bottom:4px">ДЕЖУРСТВА</div>
        <div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px">
          <span>${sal.hours.toFixed(2)} ч × ${fmt(RATES.duty_per_hour)} сум/ч</span>
          <span style="font-weight:600">${fmt(sal.dutySum)} сум</span>
        </div>
        `:''}

        ${(()=>{
          const childRows = childAuto.rows||[];
          const adultRows = groupSessions.filter(gs=>gs.group_types?.billing_model==='headcount');
          const subRows = groupSubstitutions.filter(s=>s.status==='approved');
          if (!childRows.length&&!adultRows.length&&!subRows.length) return '';
          return `
          <div style="font-size:12px;color:var(--hint);font-weight:600;margin-top:8px;margin-bottom:4px">ГРУППЫ</div>
          ${childRows.map(r=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>${r.groupName} <span style="font-size:11px;color:#10b981">авто</span>${r.bonus?` <span style="font-size:11px;color:#10b981">+${fmt(r.bonus)}</span>`:''}${r.penalty?` <span style="font-size:11px;color:#ef4444">−${fmt(r.penalty)}</span>`:''}</span>
            <span style="font-weight:600">${fmt(r.final)} сум</span>
          </div>`).join('')}
          ${adultRows.map(gs=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>${gs.group_types?.name||'Взрослая'} · ${fmtDate(gs.session_date)} (${gs.headcount} чел)</span>
            <span style="font-weight:600">${fmt(getAdultGroupRate(gs.headcount))} сум</span>
          </div>`).join('')}
          ${subRows.map(s=>`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px">
            <span>Замена ${s.trainer_groups?.group_types?.name||'группа'} · ${fmtDate(s.session_date)}</span>
            <span style="font-weight:600">${fmt(Number(s.rate||0))} сум</span>
          </div>`).join('')}
          `;
        })()}

        ${sal.bonus||sal.penalty?`
        <div style="font-size:12px;color:var(--hint);font-weight:600;margin-top:8px;margin-bottom:4px">КОРРЕКТИРОВКИ</div>
        ${sal.bonus?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Премия</span><span style="font-weight:600;color:#10b981">+${fmt(sal.bonus)} сум</span></div>`:''}
        ${sal.penalty?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Штраф</span><span style="font-weight:600;color:#ef4444">−${fmt(sal.penalty)} сум</span></div>`:''}
        `:''}

        <div style="display:flex;justify-content:space-between;padding:8px 0 0;margin-top:4px;font-size:14px;font-weight:700;border-top:1px solid var(--border)">
          <span>Итого к выплате</span>
          <span style="color:#a78bfa">${fmt(sal.total)} сум</span>
        </div>
      </div>

      <h4>Тренировки за месяц</h4>
      ${!workouts.length?'<p class="hint">Нет записей за этот период</p>':workouts.map(w=>`
        <div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${w.clients?.fio||'—'}</span>
            <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
            ${w.is_drop_in?`<span class="drop-badge">Разовая ${w.drop_in_category||1}кт</span>`:''}
            ${w.is_debt&&!w.debt_confirmed_at?'<span class="debt-badge">В долг</span>':''}
            ${w.is_debt&&w.debt_confirmed_at?'<span class="paid-badge">Оплачено</span>':''}
          </div>
          <div class="hi-sub">${fmtDT(w.workout_date)} · ${w.branch}</div>
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            ${w.is_debt&&!w.debt_confirmed_at?`
              <button class="btn btn-sm btn-primary" onclick="doConfirmDebt('${w.id}','${w.client_id}')">Подтвердить оплату</button>`:''}
            ${STATE.profile.role==='admin'?`
              <button class="btn btn-sm btn-danger" onclick="doAdminDeleteWorkout('${w.id}')">Удалить</button>`:
              (!w.is_debt?(canEdit(w.created_at)?`
              <button class="btn btn-sm btn-danger" onclick="doDeleteWorkout('${w.id}')">Удалить</button>`:
              `<button class="btn btn-sm" style="background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.25)"
                onclick="doRequestWorkoutDelete('${w.id}','${w.workout_date}','${encodeURIComponent(w.clients?.fio||'')}','${w.branch||''}')">Запрос на удаление</button>`
              ):'')}
            ${isToday(w.workout_date)&&!w.is_debt?`
              <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
                onclick="renderEditWorkoutModal('${w.id}','${w.client_id}','${w.workout_date}',${w.category_at_moment})">✏️</button>`:''}
            <button class="btn btn-sm" onclick="renderClientProfile('${w.client_id}','report')" style="background:var(--card);border:1px solid var(--border)">
              👤 Профиль</button>
          </div>
        </div>`).join('')}
      ${await DB.getMyLateRequests(STATE.profile.id).then(reqs=>reqs.length?`
        <h4 style="margin-top:16px">⏰ Мои запросы на поздние тренировки</h4>
        ${reqs.map(r=>{
          const statusBadge = r.status==='pending'
            ? '<span style="background:rgba(245,158,11,.2);color:#b45309;padding:2px 8px;border-radius:6px;font-size:11px">⏳ Ожидает</span>'
            : r.status==='approved'
            ? '<span style="background:rgba(16,185,129,.2);color:#065f46;padding:2px 8px;border-radius:6px;font-size:11px">✅ Одобрено</span>'
            : '<span style="background:rgba(239,68,68,.2);color:#991b1b;padding:2px 8px;border-radius:6px;font-size:11px">❌ Отклонено</span>';
          return `<div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${r.clients?.fio||'?'}</span>
              <span class="hi-cat cat-${r.category}">Кат.${r.category}</span>
              ${statusBadge}
            </div>
            <div class="hi-sub">${fmtDT(r.workout_date)}${r.reject_note?` · ❌ ${r.reject_note}`:''}</div>
          </div>`;
        }).join('')}`:'').catch(()=>'')}
      ${trialSessions.length?`
        <h4 style="margin-top:16px">🆕 Пробные тренировки</h4>
        ${trialSessions.map(t=>`<div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${t.first_name}${t.last_name?' '+t.last_name:''}</span>
            <span class="hi-cat cat-${t.category}">Кат.${t.category}</span>
            <span style="font-size:11px;background:rgba(139,92,246,.15);color:#7c3aed;padding:2px 6px;border-radius:6px">Пробная</span>
          </div>
          <div class="hi-sub">${fmtDT(t.session_date)} · ${t.branch}${t.phone?' · '+t.phone:''}${t.age?' · '+t.age+' лет':''}</div>
        </div>`).join('')}`:''}
      ${groupSessions.length?`
        <h4 style="margin-top:16px">Групповые занятия</h4>
        ${groupSessions.map(gs=>{
          const rate = gs.group_types?.billing_model==='headcount' ? getAdultGroupRate(gs.headcount) : 0;
          return `<div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${gs.group_types?.name||'Группа'}</span>
              ${rate>0?`<span class="hi-cat" style="background:rgba(16,185,129,.15);color:#10b981">${fmt(rate)} сум</span>`:''}
              ${gs.headcount?`<span class="hint">${gs.headcount} чел.</span>`:''}
            </div>
            <div class="hi-sub">${fmtDate(gs.session_date)} · ${gs.branch||''}</div>
          </div>`;
        }).join('')}`:''}
      `;
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}
async function doConfirmDebt(wid,cid) {
  if(!confirm('Подтвердить оплату?'))return;
  try{await DB.confirmDebt(wid,cid);toast('✅ Долг закрыт','success');renderReportTab();}
  catch(e){console.error(e);toast('Ошибка','error');}
}
async function doDeleteWorkout(id) {
  if(!confirm('Удалить запись?'))return;
  try{
    await DB.deleteWorkout(id);
    DB.auditLog('workout_delete', STATE.profile.id, STATE.profile.fio, id, 'workout', {}, STATE.profile.branches?.[0]);
    toast('Удалено','success');renderReportTab();
  } catch(e){console.error(e);toast('Ошибка','error');}
}
async function doAdminDeleteWorkout(id) {
  if(!confirm('Удалить запись? (Без ограничений по времени)'))return;
  try{
    await DB.deleteWorkout(id);
    DB.auditLog('workout_delete_admin', STATE.profile.id, STATE.profile.fio, id, 'workout', {force:true}, STATE.profile.branches?.[0]);
    toast('Удалено','success');renderReportTab();
  } catch(e){console.error(e);toast('Ошибка','error');}
}
async function doRequestWorkoutDelete(workoutId, workoutDate, clientNameEnc, branch) {
  const clientName = decodeURIComponent(clientNameEnc);
  const dateStr = fmtDate(workoutDate);
  if (!confirm(`Запросить удаление ПТ?\n${clientName} · ${dateStr}\n\nЗапрос уйдёт координатору на подтверждение.`)) return;
  if (_pending.has('wdr_'+workoutId)) return;
  _pending.add('wdr_'+workoutId);
  try {
    await DB.requestWorkoutDelete(workoutId, STATE.profile.id, clientName, workoutDate, branch);
    DB.auditLog('workout_delete_request', STATE.profile.id, STATE.profile.fio, workoutId, 'workout',
      { client: clientName, date: workoutDate?.slice(0,10) }, branch);
    toast('Запрос отправлен координатору','success');
  } catch(e) {
    if (e.message==='already_pending') toast('Запрос уже отправлен ранее','info');
    else { console.error(e); toast('Ошибка','error'); }
  }
  finally { _pending.delete('wdr_'+workoutId); }
}

async function renderEditWorkoutModal(workoutId, clientId, workoutDate, category) {
  const clients = (await DB.getClients(STATE.profile.id)).filter(c=>!c.is_archived);
  const dateLocal = new Date(workoutDate).toISOString().slice(0,16);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>✏️ Редактировать тренировку</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Клиент</label>
      <select id="ew-client">
        ${clients.map(c=>`<option value="${c.id}" ${c.id===clientId?'selected':''}>${c.fio} (кат.${c.category}, баланс:${c.balance})</option>`).join('')}
      </select></div>
    <div class="form-group"><label>Дата и время</label>
      <input type="datetime-local" id="ew-date" value="${dateLocal}"></div>
    <div class="form-group"><label>Категория</label>
      <select id="ew-cat">
        ${[1,2,3].map(n=>`<option value="${n}" ${n==category?'selected':''}>Кат.${n} — ${fmt(RATES.pt[n])} сум</option>`).join('')}
      </select></div>
    <p class="hint" style="margin-bottom:12px">Редактировать можно только тренировки текущего дня</p>
    <button class="btn btn-primary btn-full" onclick="doEditWorkout('${workoutId}','${clientId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditWorkout(workoutId, oldClientId) {
  const newClientId = document.getElementById('ew-client')?.value;
  const newDate     = document.getElementById('ew-date')?.value;
  const newCat      = parseInt(document.getElementById('ew-cat')?.value||1);
  if (!newDate) return toast('Укажите дату','error');
  if (!isToday(newDate)) return toast('Можно редактировать только тренировки сегодняшнего дня','error');
  if (_pending.has('editWorkout_'+workoutId)) return;
  _pending.add('editWorkout_'+workoutId);
  try {
    const updates = {
      workout_date: new Date(newDate).toISOString(),
      category_at_moment: newCat,
    };
    // Если клиент изменился — нужно вернуть баланс старому и списать новому
    if (newClientId !== oldClientId) {
      updates.client_id = newClientId;
      // Возвращаем баланс старому клиенту
      await DB.addBalance(oldClientId, 1);
      // Списываем у нового
      await DB.addBalance(newClientId, -1);
    }
    await sb().from('workouts').update(updates).eq('id',workoutId);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Тренировка обновлена','success');
    renderReportTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('editWorkout_'+workoutId); }
}

async function doResolveSubstitute(workoutId, clientId, confirmed) {
  try {
    await DB.resolveSubstitute(workoutId, clientId, confirmed);
    toast(confirmed ? '✅ Замена принята — ПТ в вашей ведомости' : 'Замена отклонена', confirmed?'success':'info');
    renderReportTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doResolveTransfer(transferId, clientId, toTrainerId, confirmed) {
  try {
    await DB.resolveTransfer(transferId, clientId, toTrainerId, confirmed);
    toast(confirmed ? '✅ Клиент принят' : 'Передача отклонена', confirmed?'success':'info');
    renderReportTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Модал: передать клиента (для тренера)
function renderTransferClientModal(clientId, clientFio, fromTrainerId) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Передать клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Клиент: <b>${clientFio}</b></p>
    <div class="form-group"><label>ФИО тренера <span class="required">*</span></label>
      <input id="transfer-fio" type="text" placeholder="Иванов Иван Иванович"
        list="trainers-datalist-t" autocomplete="off">
    </div>
    <div class="form-group"><label>Примечание (необязательно)</label>
      <textarea id="transfer-note" rows="2" placeholder="Причина передачи"></textarea>
    </div>
    <button class="btn btn-primary btn-full" onclick="doInitiateTransfer('${clientId}',${fromTrainerId})">
      Запросить передачу</button>
  </div>`;
  document.body.appendChild(m);
}

async function doInitiateTransfer(clientId, fromTrainerId) {
  const fio  = document.getElementById('transfer-fio')?.value.trim();
  const note = document.getElementById('transfer-note')?.value.trim()||'';
  if (!fio) return toast('Введите ФИО тренера','error');
  const profiles = await cached('profiles',()=>DB.getAllProfiles());
  const found = profiles.find(p=>p.fio.toLowerCase()===fio.toLowerCase());
  if (!found) return toast(`Тренер «${fio}» не найден`,'error');
  try {
    await DB.initiateTransfer(clientId, fromTrainerId, found.id, STATE.profile.id, note);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Запрос отправлен — тренер увидит его в Отчёте','success');
    switchTab('clients');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Купить новый пакет ПТ
function renderBuyPackageModal(clientId, isChildClient, currentBalance) {
  const packages = isChildClient ? SUB_PACKAGES.child : SUB_PACKAGES.adult;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🛒 Новый пакет ПТ</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${isChildClient&&currentBalance>0?`<div class="warn-banner" style="margin-bottom:12px">
      ⚠️ Остаток ${currentBalance} ПТ сгорит — ребёнок получает новый пакет с нуля.</div>`:''}
    ${!isChildClient&&currentBalance>0?`<p class="hint" style="margin-bottom:12px">
      Текущий остаток ${currentBalance} ПТ сохранится, новые добавятся сверху.</p>`:''}
    <div class="form-group"><label>Выберите пакет</label>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${packages.map((p,i)=>`<button class="btn pkg-btn ${i===1?'btn-primary':''}" data-qty="${p.qty}"
          onclick="selectPkg(this)" style="${i!==1?'background:var(--card);border:1px solid var(--border)':''}">
          <b>${p.label}</b> · ${p.period}</button>`).join('')}
      </div>
      <label style="display:flex;align-items:center;gap:8px;margin-top:10px;cursor:pointer;font-size:13px;color:var(--hint)">
        <input type="checkbox" id="pkg-custom-toggle" onchange="togglePkgCustom(this.checked)" style="width:16px;height:16px;flex-shrink:0">
        Другое количество
      </label>
      <input id="pkg-custom-qty" type="number" min="1" placeholder="Введите кол-во ПТ"
        style="display:none;margin-top:8px;width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px" oninput="updatePkgEndDate()">
    </div>
    <div class="form-group"><label>Дата начала</label>
      <input id="pkg-start" type="date" value="${todayStr()}" oninput="updatePkgEndDate()"></div>
    <div id="pkg-end-preview" class="hint" style="margin-bottom:12px"></div>
    <button class="btn btn-primary btn-full"
      onclick="doBuyPackage('${clientId}',${isChildClient})">Оформить</button>
  </div>`;
  document.body.appendChild(m);
  selectPkg(m.querySelector('.pkg-btn.btn-primary'));
}
function togglePkgCustom(on) {
  document.getElementById('pkg-custom-qty').style.display = on ? '' : 'none';
  document.querySelectorAll('.pkg-btn').forEach(b=>{ b.disabled = on; b.style.opacity = on ? '0.4' : '1'; });
  updatePkgEndDate();
}
function updatePkgEndDate() {
  const customOn = document.getElementById('pkg-custom-toggle')?.checked;
  const qty = customOn
    ? parseInt(document.getElementById('pkg-custom-qty')?.value||'0')
    : parseInt(document.querySelector('.pkg-btn.btn-primary')?.dataset.qty||'0');
  const start = document.getElementById('pkg-start')?.value || todayStr();
  const preview = document.getElementById('pkg-end-preview');
  if (!preview) return;
  if (!qty) { preview.textContent=''; return; }
  preview.textContent = `📅 Действует до: ${calcSubEnd(start, qty)}`;
}
function selectPkg(btn) {
  if (!btn) return;
  document.querySelectorAll('.pkg-btn').forEach(b=>{
    b.classList.remove('btn-primary');
    b.style.background='var(--card)'; b.style.border='1px solid var(--border)';
  });
  btn.classList.add('btn-primary');
  btn.style.background=''; btn.style.border='';
  updatePkgEndDate();
}
async function doBuyPackage(clientId, isChildClient) {
  const customOn = document.getElementById('pkg-custom-toggle')?.checked;
  const qty = customOn
    ? parseInt(document.getElementById('pkg-custom-qty')?.value||'0')
    : parseInt(document.querySelector('.pkg-btn.btn-primary')?.dataset.qty||'10');
  if (!qty) return toast('Выберите пакет или введите количество','error');
  const start = document.getElementById('pkg-start')?.value||todayStr();
  try {
    await DB.buyNewPackage(clientId, STATE.profile.id, isChildClient, qty, start);
    DB.auditLog('sub_buy', STATE.profile.id, STATE.profile.fio, clientId, 'subscription',
      { qty, start, is_child: isChildClient }, STATE.profile.branches?.[0]);
    document.querySelector('.modal-overlay')?.remove();
    toast(`✅ Пакет ${qty} ПТ оформлен`,'success');
    renderClientProfile(clientId, STATE.currentTab||'clients');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Редактирование данных клиента
function renderEditClientModal(clientId, fioEnc, cat, age, subStart, subEnd, balance) {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>ФИО</label>
      <input id="ec-fio" value="${fio}"></div>
    <div class="form-group"><label>Категория</label>
      <select id="ec-cat">
        <option value="1" ${cat==1?'selected':''}>Кат.1 — ${fmt(RATES.pt[1])} сум</option>
        <option value="2" ${cat==2?'selected':''}>Кат.2 — ${fmt(RATES.pt[2])} сум</option>
        <option value="3" ${cat==3?'selected':''}>Кат.3 — ${fmt(RATES.pt[3])} сум</option>
      </select></div>
    <div class="form-group"><label>Возраст (лет)</label>
      <input id="ec-age" type="number" min="1" max="99" value="${age||''}"></div>
    <div class="form-group"><label>Баланс ПТ (текущий: ${balance||0})</label>
      <input id="ec-balance" type="number" min="0" value="${balance||0}">
      <p class="hint" style="margin-top:4px">Изменение баланса не влияет на ЗП за прошлые ПТ</p></div>
    <div class="form-group"><label>Начало абонемента</label>
      <input id="ec-sub-start" type="date" value="${subStart||''}"></div>
    <div class="form-group"><label>Конец абонемента</label>
      <input id="ec-sub-end" type="date" value="${subEnd||''}"></div>
    <button class="btn btn-primary btn-full" onclick="doEditClient('${clientId}',${balance||0})">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditClient(clientId, oldBalance) {
  const fio       = document.getElementById('ec-fio')?.value.trim();
  const category  = parseInt(document.getElementById('ec-cat')?.value)||1;
  const age       = parseInt(document.getElementById('ec-age')?.value)||null;
  const newBalance= parseInt(document.getElementById('ec-balance')?.value||'0');
  const subStart  = document.getElementById('ec-sub-start')?.value||null;
  const subEnd    = document.getElementById('ec-sub-end')?.value||null;
  if (!fio) return toast('Введите ФИО','error');
  try {
    const fields = {fio, category, age, subscription_start:subStart, subscription_end:subEnd};
    // Если баланс изменился — обновляем напрямую
    if (newBalance !== oldBalance) fields.balance = newBalance;
    await DB.updateClient(clientId, fields);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Данные сохранены','success');
    renderClientProfile(clientId, STATE.currentTab||'clients');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Административная передача (координатор)
async function renderAdminTransferModal(clientId, clientFio) {
  const profiles = await cached('profiles',()=>DB.getAllProfiles());
  const trainers = profiles.filter(p=>['trainer','senior_trainer'].includes(p.role));
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Передать клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:12px">Клиент: <b>${clientFio}</b><br>
      <span class="hint">Передача без подтверждения тренера.</span></p>
    <div class="form-group"><label>Новый тренер</label>
      <select id="admin-transfer-trainer">
        ${trainers.map(t=>`<option value="${t.id}">${t.fio}</option>`).join('')}
      </select>
    </div>
    <div class="form-group"><label>Примечание</label>
      <textarea id="admin-transfer-note" rows="2" placeholder="Причина"></textarea>
    </div>
    <button class="btn btn-primary btn-full" onclick="doAdminTransfer('${clientId}')">
      Передать клиента</button>
  </div>`;
  document.body.appendChild(m);
}

async function doAdminTransfer(clientId) {
  const toId = parseInt(document.getElementById('admin-transfer-trainer')?.value);
  const note = document.getElementById('admin-transfer-note')?.value.trim()||'';
  if (!toId) return toast('Выберите тренера','error');
  try {
    await DB.adminTransfer(clientId, toId, STATE.profile.id, note);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Клиент передан','success');
    renderAdminClients();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
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
  const tabs=['home','clients','today','report','branch','groups','more'];
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
  const role = STATE.profile?.role;
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

// ── АДМИНИСТРАТОР ─────────────────────────────
// ============================================================
// SECTION: ADMIN:SHELL — renderAdminApp, adminTab, renderAdminMore
// ============================================================
function renderAdminApp(initialTab='summary') {
  setupBack(null);
  setScreen(`<div class="app-header">
    <div><div class="app-title">👑 Координатор</div>
      <div class="app-sub">${STATE.profile.fio}</div></div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="btn-icon" onclick="openSchedule()">📅</button>
      <button class="btn-icon" onclick="renderHelpModal()">?</button>
      <button class="btn-icon" id="notif-bell" onclick="renderInAppNotifications()" style="position:relative">🔔<span id="notif-count" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center"></span></button>
    </div>
  </div>
  <div id="tab-content" class="tab-content"></div>
  <nav class="bottom-nav">
    <button class="nav-btn" onclick="adminTab('summary')"><span>📊</span>Сводка</button>
    <button class="nav-btn" onclick="adminTab('analytics')"><span>📈</span>Аналитика</button>
    <button class="nav-btn" onclick="adminTab('clients')"><span>👥</span>Клиенты</button>
    <button class="nav-btn" onclick="adminTab('staff')"><span>🧑‍💼</span>Персонал</button>
    <button class="nav-btn" onclick="adminTab('groups')"><span>🏊</span>Группы</button>
    <button class="nav-btn" onclick="adminTab('control')"><span>🔍</span>Контроль</button>
    <button class="nav-btn" onclick="adminTab('more')"><span>⋯</span>Ещё</button>
  </nav>`);
  adminTab(initialTab);
  setTimeout(checkInAppNotifications, 2000);
}
function adminTab(tab) {
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',
    ['summary','analytics','clients','staff','groups','control','more'][i]===tab));
  if (tab==='summary')       renderAdminSummary();
  if (tab==='analytics')     renderAdminAnalytics();
  if (tab==='clients')       renderAdminClients();
  if (tab==='staff')         renderAdminStaff();
  if (tab==='branches')      renderAdminBranches();
  if (tab==='groups')        renderAdminGroups();
  if (tab==='notifications') renderAdminNotifications();
  if (tab==='events')        renderEventsTab();
  if (tab==='control')       renderAdminControl();
  if (tab==='tech')          renderAdminTech();
  if (tab==='schedule')      renderCoordinatorSchedule();
  if (tab==='more')          renderAdminMore();
}

async function renderAdminMore() {
  const branches = await cached('branches',()=>DB.getBranches()).then(r=>r.map(b=>b.name)).catch(()=>[]);
  const baseUrl = (location.origin + location.pathname).replace(/\/[^/]*$/, '/') + 'schedule.html';

  $('#tab-content').innerHTML=`<div class="tab-pad">
    <h3 style="margin-bottom:16px">Ещё</h3>
    <div style="display:flex;flex-direction:column;gap:10px">
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="adminTab('branches')">🏢 Филиалы</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="adminTab('notifications')">🔔 Уведомления</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="adminTab('events')">🏆 События</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="adminTab('tech')">⚙️ Операционка</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="renderCoordinatorSchedule()">📅 Расписание</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="renderAdminSessionNotes()">📝 Конспекты и цели</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="renderAuditLog()">🗂 Реестр действий</button>
    </div>

    <!-- Ссылки расписания для ОП -->
    <div style="margin-top:20px">
      <h4 style="margin-bottom:10px">🔗 Ссылки расписания для ОП</h4>
      <p class="hint" style="margin-bottom:10px">Отправьте ОП ссылку на расписание только его филиала. Только просмотр — редактировать нельзя.</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px">📋 Все филиалы</span>
          <button class="btn btn-sm" onclick="copyScheduleLink('${baseUrl}')">📋 Копировать</button>
        </div>
        ${branches.map(b=>`
        <div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:13px">📍 ${b}</span>
          <button class="btn btn-sm btn-primary" onclick="copyScheduleLink('${baseUrl}?branch=${encodeURIComponent(b)}')">📋 Копировать</button>
        </div>`).join('')}
      </div>
    </div>
  </div>`;
}

function copyScheduleLink(url) {
  navigator.clipboard?.writeText(url).then(()=>{
    toast('✅ Ссылка скопирована','success');
  }).catch(()=>{
    // Fallback для Telegram WebApp
    const inp = document.createElement('input');
    inp.value = url; document.body.appendChild(inp);
    inp.select(); document.execCommand('copy');
    document.body.removeChild(inp);
    toast('✅ Ссылка скопирована','success');
  });
}

// ══════════════════════════════════════════════════════════════
// РЕЕСТР ДЕЙСТВИЙ (AUDIT LOG)
// ══════════════════════════════════════════════════════════════
const AUDIT_LABELS = {
  workout_add:               { icon:'💪', label:'ПТ списана' },
  workout_delete:            { icon:'🗑', label:'ПТ удалена' },
  workout_delete_admin:      { icon:'🗑', label:'ПТ удалена (координатор)' },
  workout_delete_request:    { icon:'📋', label:'Запрос на удаление ПТ' },
  client_add:                { icon:'👤', label:'Клиент добавлен' },
  client_delete:             { icon:'❌', label:'Клиент удалён' },
  sub_buy:                   { icon:'💳', label:'Абонемент куплен' },
  sub_close_early:           { icon:'❄️', label:'Абонемент закрыт досрочно' },
  group_assign:              { icon:'📌', label:'Назначение в группу' },
  group_unassign:            { icon:'📌', label:'Открепление от группы' },
  group_client_add:          { icon:'🧒', label:'Ребёнок добавлен в группу' },
  group_client_remove:       { icon:'🧒', label:'Ребёнок удалён из группы' },
  group_session:             { icon:'🏊', label:'Занятие проведено' },
  group_payment:             { icon:'💰', label:'Оплата выставлена' },
  group_payout:              { icon:'💸', label:'Выплата утверждена' },
  group_substitution_create: { icon:'🔄', label:'Замена создана' },
  group_substitution_approve:{ icon:'✅', label:'Замена одобрена' },
  group_progress_note:       { icon:'📝', label:'Заметка о прогрессе' },
};
async function renderAuditLog() {
  setupBack(()=>{renderAdminApp('more');setupBack(null);});
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>🗂 Реестр действий</h3></div>
    <div style="display:flex;gap:8px;margin-bottom:12px;flex-wrap:wrap">
      <select id="al-action" style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);font-size:13px">
        <option value="">Все события</option>
        ${Object.entries(AUDIT_LABELS).map(([k,v])=>`<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
      </select>
      <select id="al-period" style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);font-size:13px">
        <option value="7">7 дней</option>
        <option value="30" selected>30 дней</option>
        <option value="90">3 месяца</option>
        <option value="0">Всё время</option>
      </select>
    </div>
    <div id="audit-list"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  document.getElementById('al-action').addEventListener('change', loadAuditLog);
  document.getElementById('al-period').addEventListener('change', loadAuditLog);
  await loadAuditLog();
}
async function loadAuditLog() {
  const body = document.getElementById('audit-list'); if (!body) return;
  body.innerHTML = '<div class="center-screen"><div class="spinner"></div></div>';
  try {
    const action = document.getElementById('al-action')?.value || '';
    const days   = parseInt(document.getElementById('al-period')?.value || '30') || 30;
    const logs   = await DB.getAuditLog({ action: action||undefined, limit: 300 });
    // Фильтр по периоду на клиенте
    const cutoff = days > 0 ? new Date(Date.now() - days*86400000) : null;
    const filtered = cutoff ? logs.filter(l=>new Date(l.created_at)>=cutoff) : logs;
    if (!filtered.length) { body.innerHTML='<p class="hint" style="padding:16px">Нет записей</p>'; return; }
    body.innerHTML = filtered.map(l=>{
      const meta = AUDIT_LABELS[l.action] || { icon:'📋', label: l.action };
      const dt = new Date(l.created_at);
      const dtStr = dt.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
      const d = l.details || {};
      let detail = '';
      if (d.count)   detail += ` · ${d.count} ПТ`;
      if (d.dates?.length) detail += ` · ${d.dates.map(fmtDate).join(', ')}`;
      if (d.fio)     detail += ` · ${d.fio}`;
      if (d.name)    detail += ` · ${d.name}`;
      if (d.qty)     detail += ` · ${d.qty} ПТ`;
      if (d.amount)  detail += ` · ${fmt(d.amount)} сум`;
      if (d.month)   detail += ` · ${d.month?.slice(0,7)}`;
      if (d.date)    detail += ` · ${fmtDate(d.date)}`;
      if (d.headcount) detail += ` · ${d.headcount} чел.`;
      if (d.group)   detail += ` · ${d.group}`;
      if (d.note)    detail += ` · "${d.note}"`;
      if (d.force)   detail += ' · принудительно';
      return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
        <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
          <div style="flex:1">
            <span style="font-size:15px">${meta.icon}</span>
            <span style="font-size:13px;font-weight:500;margin-left:4px">${meta.label}</span>
            <div style="font-size:12px;color:var(--hint);margin-top:2px">
              ${l.actor_fio||'—'}${l.branch?' · '+l.branch:''}${detail}
            </div>
          </div>
          <div style="font-size:11px;color:var(--hint);white-space:nowrap">${dtStr}</div>
        </div>
      </div>`;
    }).join('');
  } catch(e) { body.innerHTML='<p class="hint">Ошибка загрузки</p>'; console.error(e); }
}

async function renderAdminSessionNotes() {
  setupBack(()=>{renderAdminApp('more');setupBack(null);});
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>📝 Конспекты и цели</h3></div>
    <div class="form-group" style="display:flex;gap:8px">
      <select id="sn-trainer" onchange="loadAdminSessionNotes()" style="flex:2">
        <option value="">Все тренеры</option>
      </select>
      <input type="month" id="sn-month" value="${new Date().toISOString().slice(0,7)}"
        onchange="loadAdminSessionNotes()" style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)">
    </div>
    <div id="sn-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;

  // Загружаем тренеров
  const profiles = await cached('profiles',()=>DB.getAllProfiles());
  const trainers = profiles.filter(p=>['trainer','senior_trainer'].includes(p.role));
  const sel = document.getElementById('sn-trainer');
  if (sel) sel.innerHTML += trainers.map(t=>`<option value="${t.id}">${t.fio}</option>`).join('');

  await loadAdminSessionNotes();
}

async function loadAdminSessionNotes() {
  const body = document.getElementById('sn-body'); if (!body) return;
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const trainerId = document.getElementById('sn-trainer')?.value||null;
  const monthVal  = document.getElementById('sn-month')?.value||new Date().toISOString().slice(0,7);
  const from = new Date(monthVal+'-01').toISOString();
  const to   = new Date(new Date(monthVal+'-01').getFullYear(), new Date(monthVal+'-01').getMonth()+1, 1).toISOString();
  try {
    let q = sb().from('session_notes')
      .select('*, clients(fio), profiles!trainer_id(fio), workouts(workout_date,category_at_moment)')
      .gte('created_at',from).lt('created_at',to)
      .order('created_at',{ascending:false});
    if (trainerId) q = q.eq('trainer_id', parseInt(trainerId));
    const {data:notes} = await q;

    // Цели за месяц
    let gq = sb().from('training_goals')
      .select('*, clients(fio,profiles!trainer_id(fio))')
      .gte('created_at',from).lt('created_at',to)
      .order('created_at',{ascending:false});
    const {data:goals} = await gq;

    body.innerHTML=`
      <h4>Конспекты (${(notes||[]).length})</h4>
      ${!(notes||[]).length?'<p class="hint">Нет</p>':(notes||[]).map(n=>`
        <div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${n.clients?.fio||'—'}</span>
            <span class="hint" style="font-size:12px">← ${n.profiles?.fio||'—'}</span>
            ${n.workouts?.category_at_moment?`<span class="hi-cat cat-${n.workouts.category_at_moment}">Кат.${n.workouts.category_at_moment}</span>`:''}
          </div>
          ${n.workouts?.workout_date?`<div class="hi-sub">${fmtDate(n.workouts.workout_date)}</div>`:''}
          ${n.accomplishments?`<div style="font-size:13px;margin-top:4px"><b>Что делали:</b> ${n.accomplishments}</div>`:''}
          ${n.next_task?`<div style="font-size:13px;color:var(--hint)"><b>Задача:</b> ${n.next_task}</div>`:''}
        </div>`).join('')}

      <h4 style="margin-top:20px">Цели (${(goals||[]).length})</h4>
      ${!(goals||[]).length?'<p class="hint">Нет</p>':(goals||[]).map(g=>`
        <div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${g.clients?.fio||'—'}</span>
            <span class="hint" style="font-size:12px">← ${g.clients?.profiles?.fio||'—'}</span>
          </div>
          <div style="font-size:13px;margin-top:4px">${g.text||'—'}</div>
          <div class="hi-sub">${fmtDate(g.created_at)}</div>
        </div>`).join('')}
    `;
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// ─ ADMIN: АНАЛИТИКА ──────────────────────────
// ============================================================
// SECTION: ADMIN:ANALYTICS — Overview + 4 хаба (Деньги, Клиенты, Загрузка, Контроль)
// ============================================================
// Главный экран: 4 карточки → хабы. Месяц/филиал общие, данные грузятся
// независимо (падение одной карточки не ломает остальные), кеш 5 мин.

// Диапазон месяца + предыдущий месяц
function _anRange(year, month) {
  const from    = new Date(year, month-1, 1).toISOString();
  const to      = new Date(year, month,   1).toISOString();
  const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
  const toDay   = new Date(year, month, 1).toISOString().slice(0,10);
  const py = month===1 ? year-1 : year;
  const pm = month===1 ? 12 : month-1;
  const pFromDay = `${py}-${String(pm).padStart(2,'0')}-01`;
  const pToDay   = new Date(py, pm, 1).toISOString().slice(0,10);
  return { from, to, fromDay, toDay, pFromDay, pToDay };
}

// ФОТ по тренерам за месяц — общая функция поверх существующих
// DB.getSummary + calcSalary (логику ЗП НЕ дублируем).
async function calcMonthPayroll(branch, year, month) {
  const data = await DB.getSummary(year, month, branch||null);
  const { groupSubstitutions=[], ptSubstitutions=[], childAutoByTrainer={} } = data;
  const adjMap = {}; (data.adjustments||[]).forEach(a=>{ adjMap[a.trainer_id]=a; });
  const rows = (data.profiles||[]).map(p=>{
    const sal = calcSalary({
      workouts:[...(data.workouts||[]).filter(w=>w.trainer_id===p.id),
                ...(ptSubstitutions||[]).filter(w=>w.trainer_id===p.id)],
      duties:(data.duties||[]).filter(d=>d.trainer_id===p.id),
      trainerGroups:(data.trainerGroups||[]).filter(tg=>tg.trainer_id===p.id),
      groupSessions:(data.groupSessions||[]).filter(gs=>gs.trainer_id===p.id),
      trialSessions:(data.trialSessions||[]).filter(t=>t.trainer_id===p.id),
      adjustment:adjMap[p.id]||null,
      childAutoSum:childAutoByTrainer[p.id]||0,
      groupSubstitutions, trainerId:p.id,
    });
    return {
      id:p.id, fio:p.fio,
      pt:    sal.ptSum+sal.dropInSum+sal.trialSum+sal.ptSubSum,
      duty:  sal.dutySum,
      group: sal.childSum+sal.adultSum+sal.groupSubSum,
      total: sal.total,
    };
  }).filter(r=>r.total>0).sort((a,b)=>b.total-a.total);
  const totalFot = rows.reduce((s,r)=>s+r.total,0);
  return { rows, totalFot, raw:data };
}

// ── Загрузчики данных (кешируются, переиспользуются Overview-карточками и хабами) ──
function _anMoney(year, month, branch) {
  return cached(`an_money_${branch||'all'}_${year}_${month}`, async () => {
    const pr   = await calcMonthPayroll(branch, year, month);
    const data = pr.raw;
    const childRev = await DB.getAnGroupRevenue(year, month, branch).catch(()=>[]);
    const fioMap = {}; (data.profiles||[]).forEach(p=>{ fioMap[p.id]=p.fio; });
    const rev = {1:0,2:0,3:0,drop:0,child:0};
    const revByTrainer = {};
    (data.workouts||[]).forEach(w=>{
      const paid = !w.is_debt || w.debt_confirmed_at;
      if (!paid) return;
      const v = w.is_drop_in ? PT_PRICES[w.drop_in_category||1] : PT_PRICES[w.category_at_moment];
      if (w.is_drop_in) rev.drop += v; else rev[w.category_at_moment] += v;
      revByTrainer[w.trainer_id] = (revByTrainer[w.trainer_id]||0) + v;
    });
    // Взрослые группы в выручку НЕ входят: услуга включена во взрослый абонемент,
    // ФОТ платится по посещениям (учтён в calcMonthPayroll), отдельной выручки нет.
    // Детские группы: каждый оплаченный клиент-месяц = GROUP_CHILD_PRICE.
    rev.child = childRev.filter(r=>r.paid).length * GROUP_CHILD_PRICE;
    const ptCount   = (data.workouts||[]).filter(w=>!w.is_drop_in && (!w.is_debt||w.debt_confirmed_at)).length;
    const ptRevenue = rev[1]+rev[2]+rev[3];
    const totalRev  = ptRevenue+rev.drop+rev.child;
    const topTrainers = Object.entries(revByTrainer)
      .map(([id,v])=>({fio:fioMap[id]||'—', sum:v}))
      .sort((a,b)=>b.sum-a.sum).slice(0,3);
    return {
      rev, totalRev, ptRevenue, ptCount,
      avgCheck: ptCount ? Math.round(ptRevenue/ptCount) : 0,
      ratio:    totalRev ? Math.round(pr.totalFot/totalRev*100) : 0,
      fot: pr.totalFot, fotRows: pr.rows, topTrainers,
    };
  }, 300000);
}

function _anClients(year, month, branch) {
  return cached(`an_clients_${branch||'all'}_${year}_${month}`, async () => {
    const { clients, subscriptions } = await DB.getAnClients();
    const { fromDay, toDay } = _anRange(year, month);
    const today = todayStr();
    const inBranch = c => !branch || (c.profiles?.branches||[]).includes(branch);
    const cl = clients.filter(inBranch);
    const subsByClient = {};
    subscriptions.forEach(s=>{ (subsByClient[s.client_id]=subsByClient[s.client_id]||[]).push(s); });

    const active = cl.filter(c=>!c.is_archived && c.balance>0);
    const newClients = cl.filter(c=>{
      const ss = (subsByClient[c.id]||[]).filter(s=>s.start_date)
        .sort((a,b)=>a.start_date.localeCompare(b.start_date));
      if (!ss.length) return false;
      const first = ss[0].start_date;
      return first>=fromDay && first<toDay;
    });
    const churn = cl.filter(c=>{
      const all = subsByClient[c.id]||[];
      if (all.some(s=>s.is_active)) return false;
      const ended = all.filter(s=>s.end_date).sort((a,b)=>a.end_date.localeCompare(b.end_date));
      if (!ended.length) return false;
      const last = ended[ended.length-1];
      return last.end_date>=fromDay && last.end_date<toDay;
    });
    const risk = cl.filter(c=>!c.is_archived && c.balance>0 && c.balance<=3)
      .sort((a,b)=>a.balance-b.balance);
    const frozen = cl.filter(c=>!c.is_archived && c.freeze_end && c.freeze_end>=today)
      .sort((a,b)=>(a.freeze_end||'').localeCompare(b.freeze_end||''));

    const pkg = c => {
      const ss=(subsByClient[c.id]||[]).filter(s=>s.start_date)
        .sort((a,b)=>b.start_date.localeCompare(a.start_date));
      return ss[0]?.initial_balance ? `${ss[0].initial_balance} ПТ` : '—';
    };
    const closeNote = c => {
      const ss=(subsByClient[c.id]||[]).filter(s=>s.end_date)
        .sort((a,b)=>b.end_date.localeCompare(a.end_date));
      return ss[0]?.closing_note || '';
    };
    const tr = c => c.profiles?.fio || '—';
    return {
      activeCount:active.length, newCount:newClients.length,
      churnCount:churn.length, riskCount:risk.length, frozenCount:frozen.length,
      newClients: newClients.map(c=>({fio:c.fio, trainer:tr(c), date:c.subscription_start, pkg:pkg(c)})),
      churn:      churn.map(c=>({fio:c.fio, trainer:tr(c), date:c.subscription_end, note:closeNote(c)})),
      risk:       risk.map(c=>({fio:c.fio, trainer:tr(c), balance:c.balance, end:c.subscription_end})),
      frozen:     frozen.map(c=>({fio:c.fio, trainer:tr(c), start:c.freeze_start, end:c.freeze_end})),
    };
  }, 300000);
}

function _anLoad(year, month, branch) {
  return cached(`an_load_${branch||'all'}_${year}_${month}`, async () => {
    const ws = await DB.getAnWorkouts(year, month, branch);
    const grid = {};                       // 'dow-hour' → count (dow 0=Пн)
    const byDay = [0,0,0,0,0,0,0];
    const byHour = {};
    const byTrainer = {};
    let total = 0;
    ws.forEach(w=>{
      const d = new Date(w.workout_date);
      const dow = (d.getDay()+6)%7;        // Пн=0 … Вс=6
      const h = d.getHours();
      byDay[dow]++; total++;
      byHour[h] = (byHour[h]||0)+1;
      grid[`${dow}-${h}`] = (grid[`${dow}-${h}`]||0)+1;
      const t = byTrainer[w.trainer_id] = byTrainer[w.trainer_id] || {fio:w.profiles?.fio||'—', count:0};
      t.count++;
    });
    let max = 0, peakKey = null;
    Object.entries(grid).forEach(([k,v])=>{ if (v>max){ max=v; peakKey=k; } });
    const peak = peakKey ? (()=>{ const [d,h]=peakKey.split('-'); return {day:DAYS_SHORT[+d], hour:`${String(h).padStart(2,'0')}:00`, count:max}; })() : null;
    const trainers = Object.values(byTrainer).sort((a,b)=>b.count-a.count);
    return { grid, byDay, byHour, max, total, peak, trainers };
  }, 300000);
}

function _anControl(year, month, branch) {
  return cached(`an_control_${branch||'all'}_${year}_${month}`, async () => {
    const [ctl, ws] = await Promise.all([
      DB.getAnControl(year, month, branch),
      DB.getAnWorkouts(year, month, branch),
    ]);
    const byTrainer = {};
    const get = (id,fio) => (byTrainer[id] = byTrainer[id] || {fio:fio||'—', pt:0, notes:0, overdue:0});
    ws.filter(w=>!w.is_drop_in).forEach(w=>{ get(w.trainer_id, w.profiles?.fio).pt++; });
    let totalNotes=0, totalInTime=0, totalPt=0;
    Object.values(byTrainer).forEach(t=>{ totalPt+=t.pt; });
    ctl.notes.forEach(n=>{
      const t = get(n.trainer_id);
      t.notes++;
      const late = n.created_at && n.deadline && n.created_at > n.deadline;
      if (late) t.overdue++; else totalInTime++;
      totalNotes++;
    });
    const lateApproved = ctl.late.filter(r=>r.status==='approved').length;
    const activity = {};
    ctl.audit.forEach(a=>{ const d=String(a.created_at).slice(0,10); activity[d]=(activity[d]||0)+1; });
    return {
      byTrainer: Object.values(byTrainer).sort((a,b)=>b.pt-a.pt),
      notesPct: totalPt ? Math.round(totalInTime/totalPt*100) : 0,
      late: ctl.late, lateCount: ctl.late.length, lateApproved,
      dels: ctl.dels, delsCount: ctl.dels.length,
      activity,
    };
  }, 300000);
}

// ── Цвета и хелперы ──
function _ratioClass(r) { return r<=42 ? 'r-green' : r<=50 ? 'r-yellow' : 'r-red'; }
function _heatStyle(v, max) {
  if (!v) return 'background:var(--card)';
  const op = 0.18 + 0.72*(v/(max||1));
  return `background:rgba(124,58,237,${op.toFixed(2)});color:#fff`;
}
function _anSkel(n=3) {
  return Array.from({length:n}).map(()=>`<div class="an-skel-line"></div>`).join('');
}
function _statusBadge(s) {
  const m = {approved:['✅ Одобрено','var(--success)'], rejected:['❌ Отклонено','var(--danger)'], pending:['⏳ Ожидает','var(--hint)']};
  const [txt,col] = m[s] || [s||'—','var(--hint)'];
  return `<span style="font-size:11px;color:${col}">${txt}</span>`;
}
function _d(s) { return s ? fmtDate(s) : '—'; }

// ── OVERVIEW ──
async function renderAdminAnalytics(year, month, branch) {
  const now = new Date();
  if (year==null)  year  = now.getFullYear();
  if (month==null) month = now.getMonth()+1;
  if (branch===undefined) branch = null;
  setupBack(null); STATE._backFn = null;
  window._anCtx = { year, month, branch };

  const branches = await cached('branches',()=>DB.getBranches());
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="section-header"><h3>Аналитика</h3>
      <div class="month-nav">
        <button id="prev-an">‹</button>
        <span id="an-month">${fmtMY(year,month)}</span>
        <button id="next-an">›</button>
      </div>
    </div>
    <select id="an-branch" style="margin-bottom:14px">
      <option value="">Все филиалы</option>
      ${branches.map(b=>`<option ${b.name===branch?'selected':''}>${b.name}</option>`).join('')}
    </select>
    <div class="aov-grid">
      <div class="aov-card" id="aov-money"   onclick="openAnHub('money')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-clients" onclick="openAnHub('clients')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-load"    onclick="openAnHub('load')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-control" onclick="openAnHub('control')">${_anSkel(4)}</div>
    </div>
  </div>`;

  const goMonth = (dy,dm)=>renderAdminAnalytics(dm>12?year+1:(dm<1?year-1:year), dm>12?1:(dm<1?12:dm), branch);
  document.getElementById('prev-an')?.addEventListener('click',()=>goMonth(0,month-1));
  document.getElementById('next-an')?.addEventListener('click',()=>goMonth(0,month+1));
  document.getElementById('an-branch')?.addEventListener('change',e=>renderAdminAnalytics(year,month,e.target.value||null));

  _fillMoneyCard(year,month,branch);
  _fillClientsCard(year,month,branch);
  _fillLoadCard(year,month,branch);
  _fillControlCard(year,month,branch);
}

function openAnHub(which) {
  const {year,month,branch} = window._anCtx||{};
  if (which==='money')   renderAnalyticsMoneyHub(year,month,branch);
  if (which==='clients') renderAnalyticsClientsHub(year,month,branch);
  if (which==='load')    renderAnalyticsLoadHub(year,month,branch);
  if (which==='control') renderAnalyticsControlHub(year,month,branch);
}

async function _fillMoneyCard(y,m,b) {
  const el=document.getElementById('aov-money'); if(!el) return;
  try {
    const d=await _anMoney(y,m,b);
    el.innerHTML=`<h5>💰 Деньги и ФОТ</h5>
      <div class="aov-row"><span>Выручка</span><b>${fmt(d.totalRev)}</b></div>
      <div class="aov-row"><span>ФОТ</span><b>${fmt(d.fot)}</b></div>
      <div class="aov-row"><span>ФОТ/выручка</span><b class="${_ratioClass(d.ratio)}">${d.ratio}%</b></div>
      <div class="aov-row"><span>Ср. чек ПТ</span><b>${fmt(d.avgCheck)}</b></div>
      <span class="aov-arrow">›</span>`;
  } catch(e){ console.error(e); el.innerHTML=`<h5>💰 Деньги и ФОТ</h5><p class="hint">⚠️ Ошибка загрузки</p>`; }
}
async function _fillClientsCard(y,m,b) {
  const el=document.getElementById('aov-clients'); if(!el) return;
  try {
    const d=await _anClients(y,m,b);
    el.innerHTML=`<h5>👥 Клиентская база</h5>
      <div class="aov-row"><span>Активных</span><b>${d.activeCount}</b></div>
      <div class="aov-row"><span>Новых за месяц</span><b class="r-green">${d.newCount}</b></div>
      <div class="aov-row"><span>Отток</span><b class="r-red">${d.churnCount}</b></div>
      <div class="aov-row"><span>Зона риска (≤3)</span><b class="r-yellow">${d.riskCount}</b></div>
      <span class="aov-arrow">›</span>`;
  } catch(e){ console.error(e); el.innerHTML=`<h5>👥 Клиентская база</h5><p class="hint">⚠️ Ошибка загрузки</p>`; }
}
async function _fillLoadCard(y,m,b) {
  const el=document.getElementById('aov-load'); if(!el) return;
  try {
    const d=await _anLoad(y,m,b);
    // мини-карта 7×4: дни × блоки (утро 7-12, день 12-17, вечер 17-22, ночь иначе)
    const block=h=> h<7?3 : h<12?0 : h<17?1 : h<22?2 : 3;
    const mini={}; let mmax=0;
    Object.entries(d.grid).forEach(([k,v])=>{ const [dow,h]=k.split('-'); const key=`${dow}-${block(+h)}`; mini[key]=(mini[key]||0)+v; if(mini[key]>mmax)mmax=mini[key]; });
    const cells=[];
    for(let dd=0;dd<7;dd++) for(let bl=0;bl<4;bl++){ const v=mini[`${dd}-${bl}`]||0; cells.push(`<div class="aov-heat-cell" style="${_heatStyle(v,mmax)}"></div>`); }
    el.innerHTML=`<h5>🗓 Загрузка</h5>
      <div class="aov-mini-heat">${cells.join('')}</div>
      <div class="aov-row"><span>Пик</span><b>${d.peak?`${d.peak.day} ${d.peak.hour}`:'—'}</b></div>
      <div class="aov-row"><span>Всего ПТ</span><b>${d.total}</b></div>
      <span class="aov-arrow">›</span>`;
  } catch(e){ console.error(e); el.innerHTML=`<h5>🗓 Загрузка</h5><p class="hint">⚠️ Ошибка загрузки</p>`; }
}
async function _fillControlCard(y,m,b) {
  const el=document.getElementById('aov-control'); if(!el) return;
  try {
    const d=await _anControl(y,m,b);
    el.innerHTML=`<h5>🔍 Контроль</h5>
      <div class="aov-row"><span>Конспекты в срок</span><b class="${d.notesPct>=80?'r-green':d.notesPct>=50?'r-yellow':'r-red'}">${d.notesPct}%</b></div>
      <div class="aov-row"><span>Поздних внесений</span><b>${d.lateApproved}</b></div>
      <div class="aov-row"><span>Запросов на удаление</span><b>${d.delsCount}</b></div>
      <span class="aov-arrow">›</span>`;
  } catch(e){ console.error(e); el.innerHTML=`<h5>🔍 Контроль</h5><p class="hint">⚠️ Ошибка загрузки</p>`; }
}

// ── ХАБ 1: ДЕНЬГИ И ФОТ ──
async function renderAnalyticsMoneyHub(year, month, branch) {
  window._anCtx={year,month,branch};
  navPush(()=>renderAdminAnalytics(year,month,branch));
  setupBack(()=>renderAdminAnalytics(year,month,branch));
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>💰 Деньги и ФОТ</h3></div>
    <p class="hint">${fmtMY(year,month)}${branch?' · '+branch:' · все филиалы'}</p>
    <div id="ah-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const d=await _anMoney(year,month,branch);
    const types=[
      {l:'ПТ кат.1', v:d.rev[1]}, {l:'ПТ кат.2', v:d.rev[2]}, {l:'ПТ кат.3', v:d.rev[3]},
      {l:'Группы детские', v:d.rev.child},
      {l:'Разовые', v:d.rev.drop},
    ];
    const maxT=Math.max(1,...types.map(t=>t.v));
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-section"><div class="ah-h">Выручка по типам</div>
        ${types.map(t=>`<div class="ah-bar-row">
          <span class="ah-bar-lbl">${t.l}</span>
          <div class="ah-bar-track"><div class="ah-bar-fill" style="width:${Math.round(t.v/maxT*100)}%"></div></div>
          <span class="ah-bar-val">${fmt(t.v)}</span>
        </div>`).join('')}
        <div class="ah-bar-row" style="border-top:1px solid var(--border);margin-top:6px;padding-top:8px">
          <span class="ah-bar-lbl"><b>Итого</b></span><div class="ah-bar-track"></div>
          <span class="ah-bar-val"><b>${fmt(d.totalRev)}</b></span>
        </div>
      </div>

      <div class="ah-section"><div class="ah-h">ФОТ по тренерам</div>
        ${d.fotRows.length?`<div class="ah-table-wrap"><table class="ah-table">
          <thead><tr><th>Тренер</th><th>ПТ</th><th>Деж.</th><th>Группы</th><th>Итого</th></tr></thead>
          <tbody>${d.fotRows.map(r=>`<tr>
            <td>${r.fio}</td><td>${fmt(r.pt)}</td><td>${fmt(r.duty)}</td>
            <td>${r.group?fmt(r.group):'—'}</td><td class="ah-total">${fmt(r.total)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="4"><b>Итого ФОТ</b></td><td class="ah-total"><b>${fmt(d.fot)}</b></td></tr></tfoot>
        </table></div>`:'<p class="hint">Нет данных за этот период</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">ФОТ / Выручка</div>
        <div class="ah-ratio ${_ratioClass(d.ratio)}">${d.ratio}%</div>
        <p class="hint" style="text-align:center">Норма: 37–42%. Текущее значение: ${d.ratio}%</p>
      </div>

      ${d.topTrainers.length?`<div class="ah-section"><div class="ah-h">Топ-3 тренера по выручке</div>
        <div class="ah-top3">${d.topTrainers.map((t,i)=>`<div class="ah-top-card">
          <div class="ah-top-rank">${['🥇','🥈','🥉'][i]}</div>
          <div class="ah-top-fio">${t.fio}</div>
          <div class="ah-top-sum">${fmt(t.sum)}</div></div>`).join('')}</div>
      </div>`:''}`;
  } catch(e){ console.error(e); document.getElementById('ah-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

// ── ХАБ 2: КЛИЕНТСКАЯ БАЗА ──
async function renderAnalyticsClientsHub(year, month, branch) {
  window._anCtx={year,month,branch};
  navPush(()=>renderAdminAnalytics(year,month,branch));
  setupBack(()=>renderAdminAnalytics(year,month,branch));
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>👥 Клиентская база</h3></div>
    <p class="hint">${fmtMY(year,month)}${branch?' · '+branch:' · все филиалы'}</p>
    <div id="ah-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const d=await _anClients(year,month,branch);
    const list=(items,render,empty)=> items.length
      ? items.slice(0,10).map(render).join('') +
        (items.length>10?`<div class="an-more" style="display:none">${items.slice(10).map(render).join('')}</div>
          <button class="btn btn-sm" style="width:100%;margin-top:8px" onclick="this.previousElementSibling.style.display='block';this.remove()">Показать всех (${items.length})</button>`:'')
      : `<p class="hint">${empty}</p>`;
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-tiles">
        <div class="ah-tile"><div class="ah-tile-v">${d.activeCount}</div><div class="ah-tile-l">Активных</div></div>
        <div class="ah-tile"><div class="ah-tile-v r-green">${d.newCount}</div><div class="ah-tile-l">Новых за месяц</div></div>
        <div class="ah-tile"><div class="ah-tile-v r-red">${d.churnCount}</div><div class="ah-tile-l">Отток</div></div>
        <div class="ah-tile"><div class="ah-tile-v r-yellow">${d.riskCount}</div><div class="ah-tile-l">Зона риска ≤3</div></div>
      </div>

      <div class="ah-section"><div class="ah-h">Новые клиенты</div>
        ${list(d.newClients, c=>`<div class="ah-li"><div><b>${c.fio}</b><div class="hint">${c.trainer} · ${c.pkg}</div></div><span class="hint">${_d(c.date)}</span></div>`, 'Нет новых')}
      </div>
      <div class="ah-section"><div class="ah-h">Отток</div>
        ${list(d.churn, c=>`<div class="ah-li"><div><b>${c.fio}</b><div class="hint">${c.trainer}${c.note?' · '+c.note:''}</div></div><span class="hint">${_d(c.date)}</span></div>`, 'Нет оттока')}
      </div>
      <div class="ah-section"><div class="ah-h">Зона риска (≤3 занятий)</div>
        ${list(d.risk, c=>`<div class="ah-li"><div><b>${c.fio}</b><div class="hint">${c.trainer}${c.end?' · до '+_d(c.end):''}</div></div><span class="ah-badge r-yellow">${c.balance} ПТ</span></div>`, 'Никого в зоне риска')}
      </div>
      <div class="ah-section"><div class="ah-h">На заморозке</div>
        ${list(d.frozen, c=>`<div class="ah-li"><div><b>${c.fio}</b><div class="hint">${c.trainer}</div></div><span class="hint">${_d(c.start)} → ${_d(c.end)}</span></div>`, 'Нет на заморозке')}
      </div>`;
  } catch(e){ console.error(e); document.getElementById('ah-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

// ── ХАБ 3: ЗАГРУЗКА ──
async function renderAnalyticsLoadHub(year, month, branch) {
  window._anCtx={year,month,branch};
  navPush(()=>renderAdminAnalytics(year,month,branch));
  setupBack(()=>renderAdminAnalytics(year,month,branch));
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>🗓 Загрузка</h3></div>
    <p class="hint">${fmtMY(year,month)}${branch?' · '+branch:' · все филиалы'}</p>
    <div id="ah-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const d=await _anLoad(year,month,branch);
    const hours=Array.from({length:16},(_,i)=>i+7); // 07..22
    let head=`<div class="heat-cell heat-corner"></div>`+hours.map(h=>`<div class="heat-cell heat-hdr">${String(h).padStart(2,'0')}</div>`).join('');
    let rows='';
    for(let dd=0;dd<7;dd++){
      rows+=`<div class="heat-cell heat-day">${DAYS_SHORT[dd]}</div>`;
      rows+=hours.map(h=>{ const v=d.grid[`${dd}-${h}`]||0; return `<div class="heat-cell" style="${_heatStyle(v,d.max)}" title="${DAYS_SHORT[dd]} ${String(h).padStart(2,'0')}:00 — ${v} ПТ">${v||''}</div>`; }).join('');
    }
    const maxDay=Math.max(1,...d.byDay);
    const peakHours=Object.entries(d.byHour).sort((a,b)=>b[1]-a[1]).slice(0,3);
    const quietHours=Object.entries(d.byHour).sort((a,b)=>a[1]-b[1]).slice(0,3);
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-section"><div class="ah-h">Тепловая карта (ПТ по часам)</div>
        <div class="heat-scroll"><div class="heat-grid" style="grid-template-columns:32px repeat(16,26px)">${head}${rows}</div></div>
        <div class="heat-legend"><span>меньше</span><div class="heat-legend-bar"></div><span>больше</span></div>
      </div>

      <div class="ah-section"><div class="ah-h">Распределение по дням</div>
        ${DAYS_SHORT.map((dn,i)=>`<div class="ah-bar-row">
          <span class="ah-bar-lbl" style="width:30px">${dn}</span>
          <div class="ah-bar-track"><div class="ah-bar-fill" style="width:${Math.round(d.byDay[i]/maxDay*100)}%"></div></div>
          <span class="ah-bar-val">${d.byDay[i]}</span></div>`).join('')}
      </div>

      <div class="ah-section"><div class="ah-h">По тренерам</div>
        ${d.trainers.length?`<div class="ah-table-wrap"><table class="ah-table">
          <thead><tr><th>Тренер</th><th>ПТ</th><th>Доля</th></tr></thead>
          <tbody>${d.trainers.map(t=>`<tr><td>${t.fio}</td><td>${t.count}</td>
            <td>${d.total?Math.round(t.count/d.total*100):0}%</td></tr>`).join('')}</tbody>
        </table></div>`:'<p class="hint">Нет данных</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">Пиковые и свободные часы</div>
        <div class="ah-twocol">
          <div><div class="hint" style="margin-bottom:4px">🔥 Пиковые</div>
            ${peakHours.map(([h,c])=>`<div class="ah-li"><b>${String(h).padStart(2,'0')}:00</b><span class="hint">${c} ПТ</span></div>`).join('')||'<p class="hint">—</p>'}</div>
          <div><div class="hint" style="margin-bottom:4px">💤 Свободные</div>
            ${quietHours.map(([h,c])=>`<div class="ah-li"><b>${String(h).padStart(2,'0')}:00</b><span class="hint">${c} ПТ</span></div>`).join('')||'<p class="hint">—</p>'}</div>
        </div>
      </div>`;
  } catch(e){ console.error(e); document.getElementById('ah-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

// ── ХАБ 4: КОНТРОЛЬ ──
async function renderAnalyticsControlHub(year, month, branch) {
  window._anCtx={year,month,branch};
  navPush(()=>renderAdminAnalytics(year,month,branch));
  setupBack(()=>renderAdminAnalytics(year,month,branch));
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>🔍 Контроль</h3></div>
    <p class="hint">${fmtMY(year,month)}${branch?' · '+branch:' · все филиалы'}</p>
    <div id="ah-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const d=await _anControl(year,month,branch);
    const rowCls=t=> t.pt? (t.notes/t.pt*100<50?'ah-row-red':t.notes/t.pt*100<80?'ah-row-yellow':'') : '';
    const maxAct=Math.max(1,...Object.values(d.activity));
    const days=Object.keys(d.activity).sort();
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-section"><div class="ah-h">Конспекты по тренерам</div>
        ${d.byTrainer.length?`<div class="ah-table-wrap"><table class="ah-table">
          <thead><tr><th>Тренер</th><th>ПТ</th><th>Консп.</th><th>%</th><th>Проср.</th></tr></thead>
          <tbody>${d.byTrainer.map(t=>{const p=t.pt?Math.round(t.notes/t.pt*100):0;return `<tr class="${rowCls(t)}">
            <td>${t.fio}</td><td>${t.pt}</td><td>${t.notes}</td><td>${p}%</td>
            <td>${t.overdue?`<span class="r-red">${t.overdue}</span>`:'—'}</td></tr>`;}).join('')}</tbody>
        </table></div>`:'<p class="hint">Нет данных</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">Поздние внесения ПТ (${d.lateCount})</div>
        ${d.late.length?d.late.map(r=>`<div class="ah-li">
          <div><b>${r.profiles?.fio||'—'}</b><div class="hint">${r.clients?.fio||'—'} · ПТ ${_d(r.workout_date)}</div></div>
          <div style="text-align:right"><div class="hint">${_d(r.created_at)}</div>${_statusBadge(r.status)}</div></div>`).join(''):'<p class="hint">Нет</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">Запросы на удаление ПТ (${d.delsCount})</div>
        ${d.dels.length?d.dels.map(r=>`<div class="ah-li">
          <div><b>${r.profiles?.fio||'—'}</b><div class="hint">${r.client_name||'—'} · ПТ ${_d(r.workout_date)}</div></div>
          <div style="text-align:right"><div class="hint">${_d(r.created_at)}</div>${_statusBadge(r.status)}</div></div>`).join(''):'<p class="hint">Нет</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">Активность по дням</div>
        ${days.length?`<div class="ah-actchart">${days.map(dt=>`<div class="ah-actbar" title="${fmtDate(dt)} — ${d.activity[dt]}" style="height:${Math.round(d.activity[dt]/maxAct*100)}%"></div>`).join('')}</div>
          <div class="hint" style="text-align:center;margin-top:4px">${days.length} дн. · всего ${Object.values(d.activity).reduce((s,v)=>s+v,0)} действий</div>`:'<p class="hint">Нет действий за период</p>'}
      </div>`;
  } catch(e){ console.error(e); document.getElementById('ah-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

// ─ ADMIN: КЛИЕНТЫ (все) ──────────────────────
// ============================================================
// SECTION: ADMIN:CLIENTS — renderAdminClients, renderClientList, filterAdminClients
// ============================================================
async function renderAdminClients() {
  $('#tab-content').innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  const [branches, allProfiles, allClients] = await Promise.all([
    cached('branches', ()=>DB.getBranches()),
    cached('profiles', ()=>DB.getAllProfiles()),
    DB.getAllClients(),
  ]);
  const trainers = allProfiles.filter(p=>['trainer','senior_trainer'].includes(p.role));
  allClients.forEach(cl=>{
    cl._trainerFio      = cl.profiles?.fio||'—';
    cl._trainerBranches = cl.profiles?.branches||[];
  });

  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="section-header"><h3>Все клиенты</h3>
      <span class="hint">${allClients.length} чел.</span>
    </div>
    <div class="form-group" style="display:flex;gap:8px">
      <select id="cl-branch" onchange="filterAdminClients()" style="flex:1">
        <option value="">Все филиалы</option>
        ${branches.map(b=>`<option>${b.name}</option>`).join('')}
      </select>
      <select id="cl-trainer" onchange="filterAdminClients()" style="flex:1">
        <option value="">Все тренеры</option>
        ${trainers.map(t=>`<option value="${t.id}">${t.fio}</option>`).join('')}
      </select>
    </div>
    <input id="cl-search" type="text" placeholder="🔍 Поиск по имени..."
      oninput="filterAdminClients()" style="margin-bottom:12px">
    <div id="cl-list">
      ${renderClientList(allClients)}
    </div>
  </div>`;

  window._allAdminClients = allClients;
  // Вычисляем дубли по ВСЕМУ списку один раз — чтобы при фильтрации они не терялись
  window._adminDupNames = _findDuplicates(allClients)._dupNames;
}

function renderClientList(clients, dupNamesOverride) {
  if (!clients.length) return '<p class="hint" style="text-align:center;padding:20px">Не найдено</p>';
  const today = todayStr();

  // Используем глобальные дубли (по всем клиентам), если переданы
  const dupNames = dupNamesOverride || _findDuplicates(clients)._dupNames;

  return clients.map(c => {
    const expired   = c.subscription_end && c.subscription_end < today;
    const noBalance = c.balance <= 0;
    const warn      = expired || noBalance;
    const key       = c.fio.trim().toLowerCase();
    const isDup      = dupNames.has(key);
    const hasHistory = (c.workouts?.[0]?.count || 0) > 0;
    const dupBadge   = isDup
      ? hasHistory
        ? `<span title="Дубль — есть история тренировок" style="font-size:13px">✅⚠️</span>`
        : `<span title="Дубль — нет истории, можно удалить" style="font-size:13px">⚠️</span>`
      : '';

    return `
    <div class="client-row" onclick="renderClientProfile('${c.id}','admin-clients')">
      <div style="flex:1;min-width:0">
        <div class="cr-name" style="display:flex;align-items:center;gap:6px;flex-wrap:wrap">
          ${dupBadge}${c.fio}${c.age?` <span class="hint" style="font-weight:400">${c.age}л</span>`:''}
          ${expired?'<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(239,68,68,.15);color:#ef4444">истёк</span>':''}
          ${!expired&&noBalance?'<span style="font-size:10px;padding:1px 6px;border-radius:8px;background:rgba(245,158,11,.15);color:#f59e0b">баланс 0</span>':''}
        </div>
        <div class="cr-meta">${c._trainerFio} · кат.${c.category} · ${c.balance} ПТ${c.subscription_end?' · до '+fmtDate(c.subscription_end):''}</div>
      </div>
      <span class="cr-arrow" style="color:${warn?'#ef4444':'var(--hint)'}">›</span>
    </div>`;
  }).join('');
}

function filterAdminClients() {
  const branch  = document.getElementById('cl-branch')?.value||'';
  const trainer = document.getElementById('cl-trainer')?.value||'';
  const search  = document.getElementById('cl-search')?.value.toLowerCase()||'';
  let filtered  = window._allAdminClients||[];
  if (branch)  filtered = filtered.filter(c => (c._trainerBranches||[]).includes(branch));
  if (trainer) filtered = filtered.filter(c => String(c.trainer_id) === trainer);
  if (search)  filtered = filtered.filter(c => c.fio.toLowerCase().includes(search));
  const list = document.getElementById('cl-list');
  if (list) list.innerHTML = renderClientList(filtered, window._adminDupNames);
}

// ─ ADMIN: СВОДКА
// ============================================================
// SECTION: ADMIN:SALARY — renderAdminSummary, loadAdminSummary, adminDetail
// ============================================================
async function renderAdminSummary() {
  let year=new Date().getFullYear(),month=new Date().getMonth()+1;
  // Загружаем филиалы из таблицы branches
  const branches=await cached('branches',()=>DB.getBranches());
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Сводка</h3>
      <div class="month-nav">
        <button id="prev-s">‹</button><span id="sum-m">${fmtMY(year,month)}</span><button id="next-s">›</button>
      </div>
    </div>
    <div class="form-group"><select id="sum-branch">
      <option value="">Все филиалы</option>
      ${branches.map(b=>`<option>${b.name}</option>`).join('')}
    </select></div>
    <div id="sum-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  const getBr=()=>document.getElementById('sum-branch')?.value||null;
  const load=()=>loadAdminSummary(year,month,getBr());
  document.getElementById('prev-s')?.addEventListener('click',()=>{if(month===1){year--;month=12;}else month--;document.getElementById('sum-m').textContent=fmtMY(year,month);load();});
  document.getElementById('next-s')?.addEventListener('click',()=>{if(month===12){year++;month=1;}else month++;document.getElementById('sum-m').textContent=fmtMY(year,month);load();});
  document.getElementById('sum-branch')?.addEventListener('change',load);
  await load();
}
async function loadAdminSummary(year,month,branch) {
  const body=document.getElementById('sum-body'); if (!body) return;
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const [data, allClients] = await Promise.all([
      DB.getSummary(year,month,branch||null),
      DB.getAllClients().catch(()=>[]),
    ]);
    const filteredClients = branch
      ? allClients.filter(c=>(c.profiles?.branches||[]).includes(branch))
      : allClients;
    const activeClients  = filteredClients.filter(c=>c.balance>0).length;
    const expiredClients = filteredClients.filter(c=>c.subscription_end && new Date(c.subscription_end)<new Date()).length;
    const totalSalary    = data.profiles?.length
      ? (() => {
          const {groupSubstitutions=[],ptSubstitutions=[],childAutoByTrainer={}} = data;
          const adjMap = {}; (data.adjustments||[]).forEach(a=>{adjMap[a.trainer_id]=a;});
          return (data.profiles||[]).reduce((s,p)=>{
            const sal = calcSalary({
              workouts:[...(data.workouts||[]).filter(w=>w.trainer_id===p.id),
                        ...(ptSubstitutions||[]).filter(w=>w.trainer_id===p.id)],
              duties:(data.duties||[]).filter(d=>d.trainer_id===p.id),
              trainerGroups:(data.trainerGroups||[]).filter(tg=>tg.trainer_id===p.id),
              groupSessions:(data.groupSessions||[]).filter(gs=>gs.trainer_id===p.id),
              trialSessions:(data.trialSessions||[]).filter(t=>t.trainer_id===p.id),
              adjustment:adjMap[p.id]||null,
              childAutoSum:childAutoByTrainer[p.id]||0,
              groupSubstitutions, trainerId:p.id,
            });
            return s+sal.total;
          },0);
        })()
      : 0;

    body.innerHTML=`
      <div class="summary-cards" style="margin-bottom:16px">
        <div class="summary-card"><div class="s-val">${filteredClients.length}</div><div class="s-lbl">Всего клиентов</div></div>
        <div class="summary-card"><div class="s-val" style="color:var(--success)">${activeClients}</div><div class="s-lbl">Активных</div></div>
        <div class="summary-card"><div class="s-val" style="color:var(--danger)">${expiredClients}</div><div class="s-lbl">Истёк абон.</div></div>
        <div class="summary-card accent"><div class="s-val">${fmt(totalSalary)}</div><div class="s-lbl">ФОТ (сум)</div></div>
      </div>
      ${renderSummaryTable(data,year,month,true)}
      <button class="btn btn-sm" style="margin-top:12px;width:100%"
        onclick="doExportSummary(${year},${month},'${branch||''}')">⬇️ Скачать Excel (сводный)</button>`;
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

function renderSummaryTable(data,year,month,isAdmin) {
  const {workouts,duties,trainerGroups,groupSessions,profiles,adjustments=[]}=data;
  if (!profiles.length) return '<p class="hint">Нет тренеров</p>';
  const adjMap={}; (adjustments||[]).forEach(a=>{adjMap[a.trainer_id]=a;});
  const {groupSubstitutions=[],ptSubstitutions=[],childAutoByTrainer={}}=data;
  const rows=profiles.map(p=>{
    const sal=calcSalary({
      workouts:[...workouts.filter(w=>w.trainer_id===p.id),
                ...ptSubstitutions.filter(w=>w.trainer_id===p.id)],
      duties:duties.filter(d=>d.trainer_id===p.id),
      trainerGroups:trainerGroups.filter(tg=>tg.trainer_id===p.id),
      groupSessions:groupSessions.filter(gs=>gs.trainer_id===p.id),
      trialSessions:(data.trialSessions||[]).filter(t=>t.trainer_id===p.id),
      adjustment:adjMap[p.id]||null,
      childAutoSum:childAutoByTrainer[p.id]||0,
      groupSubstitutions:groupSubstitutions,
      trainerId:p.id,
    });
    return {p,sal};
  }).filter(r=>r.sal.total>0);
  if (!rows.length) return '<p class="hint">Нет данных за период</p>';
  const grand=rows.reduce((s,r)=>s+r.sal.total,0);
  return `<div class="admin-table-wrap"><table class="admin-table">
    <thead><tr>
      <th>Тренер</th><th>К1</th><th>К2</th><th>К3</th><th>Раз.</th><th>Долг</th><th>Деж.</th><th>Гр.</th>
      ${isAdmin?'<th>Пр/Шт</th>':''}
      <th>Итого</th>
    </tr></thead>
    <tbody>
      ${rows.map(({p,sal})=>`<tr class="clickable"
        onclick="${isAdmin?`adminDetail(${p.id},'${encodeURIComponent(p.fio)}',${year},${month})`:'void(0)'}">
        <td>${p.fio}</td>
        <td>${sal.cat[1]}</td><td>${sal.cat[2]}</td><td>${sal.cat[3]}</td>
        <td>${(sal.cat.dropIn1||0)+(sal.cat.dropIn2||0)+(sal.cat.dropIn3||0)}</td><td>${sal.cat.debt}</td>
        <td>${sal.hours.toFixed(1)}ч</td>
        <td>${sal.childSum+sal.adultSum>0?fmt(sal.childSum+sal.adultSum):'—'}</td>
        ${isAdmin?`<td>${sal.bonus?'+'+fmt(sal.bonus):''}${sal.penalty?'−'+fmt(sal.penalty):''}</td>`:''}
        <td class="total-cell">${fmt(sal.total)}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr>
      <td colspan="${isAdmin?9:8}"><b>Итого</b></td>
      <td class="total-cell"><b>${fmt(grand)}</b></td>
    </tr></tfoot>
  </table></div>
  ${isAdmin?'<p class="hint" style="text-align:center;margin-top:8px">Нажмите строку для деталей</p>':''}`;
}

async function adminDetail(trainerId,fioEnc,year,month) {
  const fio=decodeURIComponent(fioEnc);
  setupBack(()=>{renderAdminApp('summary');setupBack(null);});
  $('#tab-content').innerHTML=`<div class="tab-pad"><h3>${fio}</h3><div class="center-screen"><div class="spinner"></div></div></div>`;
  try {
    const d=await DB.getTrainerDetail(trainerId,year,month);
    const sal=calcSalary({...d,trainerId});
    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header">
        <div><h3>${fio}</h3><p class="hint">${fmtMY(year,month)}</p></div>
        <button class="btn btn-sm" onclick="doExportTrainer(${trainerId},'${encodeURIComponent(fio)}',${year},${month})">⬇️ Excel</button>
      </div>
      <div class="summary-cards">
        <div class="summary-card"><div class="s-val">${sal.cat[1]+sal.cat[2]+sal.cat[3]}</div><div class="s-lbl">ПТ</div></div>
        <div class="summary-card"><div class="s-val">${(sal.cat.dropIn1||0)+(sal.cat.dropIn2||0)+(sal.cat.dropIn3||0)}</div><div class="s-lbl">Разовые</div></div>
        <div class="summary-card"><div class="s-val">${sal.hours.toFixed(1)}ч</div><div class="s-lbl">Деж.</div></div>
        <div class="summary-card">
          <div class="s-val" style="font-size:13px">${sal.adultSum+sal.childSum>0?fmt(sal.adultSum+sal.childSum):'—'}</div>
          <div class="s-lbl">Группы${sal.adultSum+sal.childSum>0?'<div style="font-size:10px;opacity:.6">авто</div>':''}</div>
        </div>
        <div class="summary-card accent">
          <div class="s-val">${fmt(sal.total)}</div><div class="s-lbl">К выплате</div>
        </div>
      </div>
      <div class="adj-form">
        <h4>Премия / Штраф</h4>
        <div style="display:flex;gap:10px;margin-bottom:8px">
          <div class="form-group" style="flex:1;margin:0"><label>Премия</label>
            <input type="number" id="adj-bonus" value="${d.adjustment?.bonus||0}" min="0"></div>
          <div class="form-group" style="flex:1;margin:0"><label>Штраф</label>
            <input type="number" id="adj-penalty" value="${d.adjustment?.penalty||0}" min="0"></div>
        </div>
        <input id="adj-notes" type="text" placeholder="Комментарий" value="${d.adjustment?.notes||''}">
        <button class="btn btn-sm btn-primary" style="margin-top:8px;width:100%"
          onclick="doSaveAdj(${trainerId},${year},${month})">Сохранить</button>
      </div>

      <h4 style="margin-top:16px">Тренировки (${d.workouts.length})</h4>
      ${!d.workouts.length?'<p class="hint">Нет</p>':d.workouts.map(w=>`
        <div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${w.clients?.fio||'—'}</span>
            <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
            ${w.is_drop_in?`<span class="drop-badge">Разовая ${w.drop_in_category||1}кт</span>`:''}
            ${w.is_debt&&!w.debt_confirmed_at?'<span class="debt-badge">В долг</span>':''}
          </div>
          <div class="hi-sub">${fmtDT(w.workout_date)} · ${w.branch}</div>
        </div>`).join('')}

      ${d.groupSessions.length?`
        <h4 style="margin-top:16px">Групповые занятия (${d.groupSessions.length})</h4>
        ${d.groupSessions.map(gs=>{
          const rate = gs.group_types?.billing_model==='headcount' ? getAdultGroupRate(gs.headcount) : 0;
          return `<div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${gs.group_types?.name||'Группа'}</span>
              ${rate>0?`<span class="hi-cat" style="background:rgba(16,185,129,.15);color:#10b981">${fmt(rate)} сум</span>`:''}
              ${gs.headcount?`<span class="hint">${gs.headcount} чел.</span>`:''}
            </div>
            <div class="hi-sub">${fmtDate(gs.session_date)}</div>
          </div>`;
        }).join('')}`:''}

      <h4 style="margin-top:16px">Дежурства (${d.duties.length})</h4>
      ${!d.duties.length?'<p class="hint">Нет</p>':d.duties.map(duty=>{
        const h=hoursFromDuty(duty.start_time,duty.end_time);
        return `<div class="history-item">
          <div class="hi-main"><span class="hi-client">${duty.branch}</span>
            <span class="hi-cat">${h.toFixed(2)}ч</span></div>
          <div class="hi-sub">${fmtDT(duty.start_time)} → ${fmtDT(duty.end_time)}</div>
          <div class="hi-sub">${fmt(Math.round(h*RATES.duty_per_hour))} сум</div>
        </div>`;
      }).join('')}

      ${(d.trialSessions||[]).length?`
        <h4 style="margin-top:16px">🆕 Пробные тренировки (${d.trialSessions.length})</h4>
        ${d.trialSessions.map(t=>`<div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${t.first_name}${t.last_name?' '+t.last_name:''}</span>
            <span class="hi-cat cat-${t.category}">Кат.${t.category}</span>
            <span style="font-size:11px;background:rgba(139,92,246,.15);color:#7c3aed;padding:2px 6px;border-radius:6px">${fmt(RATES.pt[t.category])} сум</span>
          </div>
          <div class="hi-sub">${fmtDate(t.session_date)} · ${t.branch}${t.phone?' · '+t.phone:''}${t.age?' · '+t.age+' лет':''}</div>
        </div>`).join('')}`:''}

      <h4 style="margin-top:16px">Конспекты (${(d.sessionNotes||[]).length})</h4>
      ${!(d.sessionNotes||[]).length?'<p class="hint">Нет конспектов за этот период</p>':
        (d.sessionNotes||[]).map(n=>`
          <div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${n.clients?.fio||'—'}</span>
              ${n.workouts?.category_at_moment?`<span class="hi-cat cat-${n.workouts.category_at_moment}">Кат.${n.workouts.category_at_moment}</span>`:''}
            </div>
            ${n.workouts?.workout_date?`<div class="hi-sub">Тренировка: ${fmtDate(n.workouts.workout_date)}</div>`:''}
            ${n.accomplishments?`<div style="margin-top:6px;font-size:13px"><b>Что делали:</b> ${n.accomplishments}</div>`:''}
            ${n.next_task?`<div style="font-size:13px;color:var(--hint)"><b>Задача:</b> ${n.next_task}</div>`:''}
          </div>`).join('')}
    </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doSaveAdj(trainerId,year,month) {
  const bonus=parseInt(document.getElementById('adj-bonus')?.value||0);
  const penalty=parseInt(document.getElementById('adj-penalty')?.value||0);
  const notes=document.getElementById('adj-notes')?.value.trim()||'';
  try { await DB.upsertAdjustment(trainerId,year,month,bonus,penalty,notes); toast('Сохранено ✅','success'); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}

// ─ ADMIN: ПЕРСОНАЛ
// ============================================================
// SECTION: ADMIN:STAFF — renderAdminStaff, renderAddTrainerModal, doAddTrainer
// ============================================================
async function renderAdminStaff() {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Персонал</h3>
      <button class="btn btn-sm" onclick="renderAddTrainerModal()">+ Добавить</button></div>
    <div class="form-group"><select id="role-filter" onchange="loadStaffList()">
      <option value="">Все</option>
      <option value="trainer">Тренеры</option>
      <option value="senior_trainer">Старшие тренеры</option>
      <option value="admin">Администраторы</option>
    </select></div>
    <div id="staff-list"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  await loadStaffList();
}
const ROLE_LBL={trainer:'Тренер',senior_trainer:'Ст.тренер',admin:'Администратор',ceo:'Топ-менеджмент'};
async function loadStaffList() {
  const body=document.getElementById('staff-list'); if (!body) return;
  const role=document.getElementById('role-filter')?.value||'';
  try {
    let profiles=await cached('profiles',()=>DB.getAllProfiles());
    if (role) profiles=profiles.filter(p=>p.role===role);
    body.innerHTML=!profiles.length?'<p class="hint">Нет</p>':
      profiles.map(t=>`<div class="staff-card">
        <div class="staff-info">
          <div class="staff-fio">${t.fio}</div>
          <div class="staff-meta">${ROLE_LBL[t.role]||t.role} · ${t.tg_id?'✅ В системе':'⏳ Не входил'} · ${(t.branches||[]).join(', ')||'—'}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="renderEditTrainerModal(${t.id},'${encodeURIComponent(t.fio)}','${(t.branches||[]).join(',')}','${t.role}')">✏️</button>
          ${t.role==='senior_trainer'?`<button class="btn btn-sm" style="background:rgba(124,58,237,.15);color:#a78bfa"
            onclick="renderBranchAccessModal(${t.id},'${encodeURIComponent(t.fio)}')">🔑</button>`:''}
          <button class="btn btn-sm" style="background:rgba(245,158,11,.15);color:#f59e0b"
            onclick="doArchiveTrainer(${t.id},'${encodeURIComponent(t.fio)}')">📦</button>
          <button class="btn btn-sm btn-danger"
            onclick="doDeleteTrainer(${t.id},'${encodeURIComponent(t.fio)}')">🗑</button>
        </div>
      </div>`).join('');
  } catch(e) { console.error(e); body.innerHTML='<p class="hint">Ошибка</p>'; }
}
async function renderAddTrainerModal() {
  const branches = await cached('branches',()=>DB.getBranches());
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить сотрудника</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>ФИО</label><input id="nt-fio" type="text" placeholder="Иванов Иван Иванович"></div>
    <div class="form-group"><label>Роль</label>
      <select id="nt-role">
        <option value="trainer">Тренер</option>
        <option value="senior_trainer">Старший тренер</option>
        <option value="admin">Администратор</option>
        <option value="ceo">Топ-менеджмент</option>
      </select></div>
    <div class="form-group"><label>Филиалы</label>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${branches.map(b=>`<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
          <input type="checkbox" class="nt-branch-cb" value="${b.name}" style="width:18px;height:18px">
          ${b.name}
        </label>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doAddTrainer()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddTrainer() {
  const fio=document.getElementById('nt-fio')?.value.trim();
  const role=document.getElementById('nt-role')?.value;
  const brs=[...document.querySelectorAll('.nt-branch-cb:checked')].map(cb=>cb.value);
  if (!fio)        return toast('Введите ФИО','error');
  if (!brs.length) return toast('Выберите хотя бы один филиал','error');
  // Защита от дубля профиля (как было с Сафиной Джураевой): ищем по ФИО без учёта порядка слов
  try {
    const existing = await cached('profiles',()=>DB.getAllProfiles());
    const dup = (existing||[]).find(p=>!p.is_archived && _normFio(p.fio)===_normFio(fio));
    if (dup && !confirm(`⚠️ Сотрудник «${dup.fio}» уже есть. Создавать дубликат?\n\nЕсли это тот же человек — не создавайте, а отредактируйте существующий профиль.`)) return;
  } catch(_) { /* проверка дубля не критична */ }
  try { await DB.addTrainer(fio,brs,role); invalidateCache('profiles'); document.querySelector('.modal-overlay')?.remove(); toast('✅','success'); loadStaffList(); }
  catch(e) { toast('Ошибка: '+(e?.message||String(e)),'error'); console.error(e); }
}
async function renderEditTrainerModal(id,fioEnc,branchesStr,role) {
  const fio=decodeURIComponent(fioEnc);
  const currentBranches=(branchesStr||'').split(',').filter(Boolean);
  const allBranches = await cached('branches',()=>DB.getBranches());
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>ФИО</label><input id="et-fio" value="${fio}"></div>
    <div class="form-group"><label>Роль</label>
      <select id="et-role">
        <option value="trainer" ${role==='trainer'?'selected':''}>Тренер</option>
        <option value="senior_trainer" ${role==='senior_trainer'?'selected':''}>Старший тренер</option>
        <option value="admin" ${role==='admin'?'selected':''}>Координатор</option>
        <option value="ceo" ${role==='ceo'?'selected':''}>Топ-менеджмент</option>
      </select></div>
    <div class="form-group"><label>Филиалы</label>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${allBranches.map(b=>`<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
          <input type="checkbox" class="et-branch-cb" value="${b.name}" ${currentBranches.includes(b.name)?'checked':''} style="width:18px;height:18px">
          ${b.name}
        </label>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doEditTrainer(${id})">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditTrainer(id) {
  const fio=(document.getElementById('et-fio')?.value||'').trim();
  const role=document.getElementById('et-role')?.value;
  const brs=[...document.querySelectorAll('.et-branch-cb:checked')].map(cb=>cb.value);
  if (!fio) return toast('Введите ФИО','error');
  if (!brs.length) return toast('Выберите хотя бы один филиал','error');
  try {
    await DB.updateProfile(id,{fio,role,branches:brs});
    invalidateCache('profiles');
    document.querySelector('.modal-overlay')?.remove();
    toast('✅','success'); loadStaffList();
  } catch(e) { toast('Ошибка: '+(e?.message||String(e)),'error'); console.error('[doEditTrainer]',e); }
}
function renderAddGroupClientModal(groupId) {
  // Селект подгруппы — если в группе есть подгруппы (контекст _gd текущей группы)
  const g = window._gd;
  const subs = (g && String(g.groupId)===String(groupId)) ? (g.subgroups||[]) : [];
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить ребёнка</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Имя</label>
      <input id="gc-name" type="text" placeholder="Иванова Маша"></div>
    <div class="form-group"><label>Возраст</label>
      <input id="gc-age" type="number" min="3" max="18" placeholder="8"></div>
    <div class="form-group"><label>Сумма оплаты в месяц (сум)</label>
      <input id="gc-price" type="number" placeholder="800000"></div>
    ${subs.length?`<div class="form-group"><label>Подгруппа</label>
      <select id="gc-subgroup">
        <option value="" ${(g?.currentSubgroup||'')===''?'selected':''}>${subLabel('')}</option>
        ${subs.map(s=>`<option value="${encodeURIComponent(s)}" ${s===g?.currentSubgroup?'selected':''}>${s}</option>`).join('')}
      </select></div>`:''}
    <button class="btn btn-primary btn-full" onclick="doAddGroupClient('${groupId}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddGroupClient(groupId) {
  const name  = document.getElementById('gc-name')?.value.trim();
  const age   = parseInt(document.getElementById('gc-age')?.value)||null;
  const price = parseInt(document.getElementById('gc-price')?.value)||0;
  const subgroup = decodeURIComponent(document.getElementById('gc-subgroup')?.value||'');
  if (!name) return toast('Введите имя','error');
  try {
    // Получаем group_instance_id для этой группы
    const {data:tg} = await sb().from('trainer_groups')
      .select('group_instance_id').eq('id',groupId).single();
    const instanceId = tg?.group_instance_id||null;

    const newClient = await DB.addGroupClient(groupId, name, age, price, todayStr(), instanceId, subgroup);
    DB.auditLog('group_client_add', STATE.profile.id, STATE.profile.fio, groupId, 'group_client',
      { name, age, price }, STATE.profile.branches?.[0]);

    // Проверка дублей по instance
    if (instanceId && newClient) {
      const existing = await DB.getGroupClientsByInstance(instanceId);
      const others = existing.filter(c=>c.id!==newClient.id);
      const nameLower = name.toLowerCase();
      for (const other of others) {
        const dist = levenshtein(nameLower, other.name.toLowerCase());
        if (dist > 0 && dist <= 2) {
          // Создаём флаг потенциального дубля
          await sb().from('group_client_duplicate_flags').insert({
            group_instance_id: instanceId,
            client_id_1: newClient.id,
            client_id_2: other.id,
            status: 'pending'
          });
        }
      }
    }

    document.querySelector('.modal-overlay')?.remove();
    toast('Ребёнок добавлен ✅','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function toggleGroupPayment(groupId, clientId, paid, amount, month) {
  const isPaid = paid==='true'||paid===true;
  if (isPaid) {
    // Открываем модал для ввода суммы и дат абонемента
    const m=el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>Оплата абонемента</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group"><label>Сумма (сум)</label>
        <input id="gp-amount" type="number" value="${amount||0}"></div>
      <div class="form-group"><label>Начало абонемента</label>
        <input id="gp-sub-start" type="date" value="${month.slice(0,10)}" onchange="syncGroupSubEnd()"></div>
      <div class="form-group"><label>Конец абонемента <span style="font-size:11px;color:var(--hint)">(авто: 30 дней)</span></label>
        <input id="gp-sub-end" type="date" value="${calcGroupSubEnd(month.slice(0,10))}"></div>
      <button class="btn btn-primary btn-full"
        onclick="doSetGroupPayment('${groupId}','${clientId}','${month}',true)">✓ Оплачен</button>
    </div>`;
    document.body.appendChild(m);
  } else {
    // Снять оплату — без модала
    sb().from('trainer_groups').select('group_instance_id').eq('id',groupId).single()
      .then(({data:tg})=>DB.setGroupPayment(groupId, clientId, month, amount, false, null, null, tg?.group_instance_id||null))
      .then(()=>refreshGroupScreen(groupId))
      .catch(()=>toast('Ошибка','error'));
  }
}
async function doSetGroupPayment(groupId, clientId, month, paid) {
  const amount   = parseInt(document.getElementById('gp-amount')?.value)||0;
  const subStart = document.getElementById('gp-sub-start')?.value||null;
  const subEnd   = document.getElementById('gp-sub-end')?.value||null;
  document.querySelector('.modal-overlay')?.remove();
  try {
    // Берём instance_id для этой группы
    const {data:tg} = await sb().from('trainer_groups')
      .select('group_instance_id').eq('id',groupId).single();
    const instanceId = tg?.group_instance_id||null;
    await DB.setGroupPayment(groupId, clientId, month, amount, paid, subStart, subEnd, instanceId);
    DB.auditLog('group_payment', STATE.profile.id, STATE.profile.fio, groupId, 'group_payment',
      { client_id: clientId, amount, month, paid }, STATE.profile.branches?.[0]);
    toast('Оплата отмечена ✅','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function updateGroupClientLevel(clientId, level) {
  try {
    await DB.updateGroupClient(clientId, {level});
    toast('Уровень обновлён','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderGroupNoteModal(groupId, clientId, nameEnc, month, noteEnc) {
  const name = decodeURIComponent(nameEnc);
  const note = decodeURIComponent(noteEnc);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Заметка — ${name}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Прогресс за месяц</label>
      <textarea id="gn-note" rows="4" placeholder="Освоил технику кроля, работаем над дыханием..."
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px">${note}</textarea></div>
    <button class="btn btn-primary btn-full"
      onclick="doSaveGroupNote('${groupId}','${clientId}','${month}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveGroupNote(groupId, clientId, month) {
  const note = document.getElementById('gn-note')?.value.trim();
  try {
    await DB.saveGroupProgressNote(groupId, clientId, STATE.profile.id, month, note);
    DB.auditLog('group_progress_note', STATE.profile.id, STATE.profile.fio, groupId, 'group_progress',
      { client_id: clientId, month }, STATE.profile.branches?.[0]);
    document.querySelector('.modal-overlay')?.remove();
    toast('Заметка сохранена ✅','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderGroupDebtorsModal(names) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>⚠️ Должники (${names.length})</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Абонемент не оплачен за текущий месяц:</p>
    <div style="display:flex;flex-direction:column;gap:6px">
      ${names.map(n=>`<div style="padding:10px 12px;background:rgba(239,68,68,.08);border:1px solid rgba(239,68,68,.2);border-radius:10px;font-weight:500">${n}</div>`).join('')}
    </div>
  </div>`;
  document.body.appendChild(m);
}

async function renderGroupArchiveModal(groupId, instanceId) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal"><div class="modal-header"><h3>📦 Архив группы</h3>
    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div id="archive-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  document.body.appendChild(m);
  try {
    const archived = instanceId
      ? await DB.getArchivedGroupClientsByInstance(instanceId)
      : await DB.getArchivedGroupClients(groupId);
    const body = document.getElementById('archive-body');
    if (!archived.length) { body.innerHTML='<p class="hint">Архив пуст</p>'; return; }
    body.innerHTML=`<p class="hint" style="margin-bottom:12px">Нажмите «Вернуть», чтобы восстановить ребёнка в группу:</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${archived.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px">
          <div>
            <div style="font-weight:500">${c.name}</div>
            <div style="font-size:12px;color:var(--hint)">${fmt(c.monthly_price||0)} сум/мес</div>
          </div>
          <button class="btn btn-sm btn-primary" style="font-size:12px" onclick="doRestoreGroupClient('${c.id}','${groupId}','${instanceId||''}')">Вернуть</button>
        </div>`).join('')}
      </div>`;
  } catch(e) { document.getElementById('archive-body').innerHTML='<p class="hint">Ошибка загрузки</p>'; console.error(e); }
}

async function doRestoreGroupClient(clientId, groupId, instanceId) {
  try {
    await DB.restoreGroupClient(clientId);
    toast('Ребёнок восстановлен','success');
    document.querySelector('.modal-overlay')?.remove();
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function archiveGroupClientConfirm(clientId, nameEnc, groupId) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${name}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:16px">Архив — скрыть из группы (можно вернуть). Удалить — навсегда.</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="doArchiveGroupClient('${clientId}','${groupId}')">📦 Архивировать</button>
      <button class="btn btn-full btn-danger"
        onclick="doDeleteGroupClient('${clientId}','${groupId}')">🗑 Удалить навсегда</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
async function doArchiveGroupClient(clientId, groupId) {
  document.querySelector('.modal-overlay')?.remove();
  try {
    await DB.archiveGroupClient(clientId);
    toast('Архивирован','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteGroupClient(clientId, groupId) {
  document.querySelector('.modal-overlay')?.remove();
  if (!confirm('Удалить безвозвратно?')) return;
  try {
    await DB.deleteGroupClient(clientId);
    DB.auditLog('group_client_remove', STATE.profile.id, STATE.profile.fio, clientId, 'group_client',
      { group_id: groupId }, STATE.profile.branches?.[0]);
    toast('Удалён','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function renderGroupAttendance(groupId) {
  // Берём instance_id группы
  const {data:tg} = await sb().from('trainer_groups')
    .select('group_instance_id').eq('id',groupId).single();
  const instanceId = tg?.group_instance_id||null;
  let clients = instanceId
    ? await DB.getGroupClientsByInstance(instanceId)
    : await DB.getGroupClients(groupId);
  // Если у группы есть подгруппы — отмечаем детей ВЫБРАННОЙ подгруппы (экран занятия)
  const g = (window._gd && String(window._gd.groupId)===String(groupId)) ? window._gd : null;
  const sub = g?.currentSubgroup||'';
  const hasSubs = !!(g && g.subgroups?.length);
  if (hasSubs) clients = clients.filter(c=>(c.subgroup||'')===sub);
  const today = todayStr();
  const existing = instanceId
    ? await DB.getGroupAttendanceByInstance(instanceId, today)
    : await DB.getGroupAttendance(groupId, today);
  const attMap = Object.fromEntries(existing.map(a=>[a.group_client_id, a.attended]));
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Посещаемость — ${today}${hasSubs?` · ${subLabel(sub)}`:''}</h3>
      <button class="btn-close" onclick="closeAttendanceModal(this)">✕</button></div>
    ${clients.map(c=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <span>${c.name}</span>
        <input type="checkbox" ${attMap[c.id]?'checked':''} style="width:20px;height:20px"
          onchange="saveAttendance('${groupId}','${c.id}','${today}',this.checked,'${instanceId||''}')">
      </div>`).join('')||'<p class="hint">В этой подгруппе детей нет</p>'}
    <button class="btn btn-primary btn-full" style="margin-top:12px"
      onclick="closeAttendanceModal(this)">Готово</button>
  </div>`;
  document.body.appendChild(m);
}
// Закрыть модал отметки и обновить счётчик «Отмечено сегодня» на экране занятия
function closeAttendanceModal(btn) {
  btn.closest('.modal-overlay')?.remove();
  if (window._gd?._screen==='session') renderGroupSessionScreenHtml();
}
async function saveAttendance(groupId, clientId, date, attended, instanceId='') {
  try {
    await DB.saveGroupAttendance(groupId, clientId, date, attended, instanceId||null);
    // Поддерживаем _gd.attMap актуальным — от него считается headcount «кто проводил»
    const g = window._gd;
    if (g && String(g.groupId)===String(groupId) && date===g.today) g.attMap[clientId] = attended;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderArchiveClientModal(clientId, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>📦 Архивировать клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;font-weight:500">${fio}</p>
    <p class="hint" style="margin-bottom:12px">Причина архивации:</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
      <label style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:10px;cursor:pointer">
        <input type="radio" name="arch-reason" value="stopped" style="width:18px;height:18px"> Перестали ходить</label>
      <label style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:10px;cursor:pointer">
        <input type="radio" name="arch-reason" value="refund" style="width:18px;height:18px"> Потребовали возврат</label>
    </div>
    <div id="arch-confirm-wrap" style="display:none;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:14px;margin-bottom:16px">
      <p style="margin:0 0 12px;font-weight:600;color:#ef4444">Вы уверены?</p>
      <p class="hint" style="margin:0 0 12px">Клиент уйдёт в архив. История тренировок сохранится. Новые списания будут недоступны.</p>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1" onclick="doArchiveClientConfirmed('${clientId}')">Да, архивировать</button>
        <button class="btn" style="flex:1;background:var(--card);border:1px solid var(--border)" onclick="this.closest('.modal-overlay').remove()">Нет</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(m);
  m.querySelectorAll('input[name="arch-reason"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('arch-confirm-wrap').style.display = '';
    });
  });
}
async function doArchiveClientConfirmed(clientId) {
  const reasonVal = document.querySelector('input[name="arch-reason"]:checked')?.value;
  const reasonMap = { stopped: 'Перестали ходить', refund: 'Потребовали возврат' };
  const reason = reasonMap[reasonVal] || '';
  try {
    await DB.archiveClient(clientId, reason);
    document.querySelector('.modal-overlay')?.remove();
    toast('Клиент архивирован','success');
    invalidateCache('clients');
    switchTab(STATE.currentTab||'clients');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doArchiveClient(id, fioEnc) {
  // Устаревший алиас — на случай если где-то осталась ссылка
  renderArchiveClientModal(id, fioEnc);
}
function renderRestoreClientModal(clientId, fioEnc, backTab='home') {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>♻️ Восстановить клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;font-weight:500">${fio}</p>
    <p class="hint" style="margin-bottom:16px">Клиент вернётся в активные. Баланс и история тренировок сохранены. Списания снова будут доступны.</p>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1" onclick="doRestoreClientConfirmed('${clientId}','${backTab}')">Да, восстановить</button>
      <button class="btn" style="flex:1;background:var(--card);border:1px solid var(--border)" onclick="this.closest('.modal-overlay').remove()">Нет</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
async function doRestoreClientConfirmed(clientId, backTab='home') {
  try {
    await DB.restoreClient(clientId);
    document.querySelector('.modal-overlay')?.remove();
    toast('Клиент восстановлен','success');
    invalidateCache('clients');
    renderClientProfile(clientId, backTab);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function renderBranchAccessModal(trainerId, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const [allBranches, currentAccess] = await Promise.all([
    cached('branches',()=>DB.getBranches()),
    DB.getBranchAccess(trainerId),
  ]);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🔑 Субпанель — ${fio}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Выберите филиалы к которым тренер получит доступ к группам и отчётам (дополнительно к своим)</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${allBranches.map(b=>`<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
        <input type="checkbox" class="ba-cb" value="${b.name}" ${currentAccess.includes(b.name)?'checked':''} style="width:18px;height:18px">
        ${b.name}
      </label>`).join('')}
    </div>
    <button class="btn btn-primary btn-full" onclick="doSaveBranchAccess(${trainerId})">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveBranchAccess(trainerId) {
  const selected = [...document.querySelectorAll('.ba-cb:checked')].map(cb=>cb.value);
  try {
    await DB.setBranchAccess(trainerId, selected);
    document.querySelector('.modal-overlay')?.remove();
    toast(selected.length?`✅ Доступ к ${selected.length} филиал(ам) выдан`:'Доп. доступ убран','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doArchiveTrainer(id, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>📦 Архивировать</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;line-height:1.6">
      <b>${fio}</b> потеряет доступ к приложению.<br>
      История тренировок сохранится и будет видна координатору.<br>
      Тренер не сможет войти снова под этим именем.
    </p>
    <button class="btn btn-full" style="background:rgba(245,158,11,.15);color:#f59e0b;margin-bottom:8px"
      onclick="doArchiveConfirm(${id})">📦 Архивировать</button>
    <button class="btn btn-full" style="background:var(--card)"
      onclick="this.closest('.modal-overlay').remove()">Отмена</button>
  </div>`;
  document.body.appendChild(m);
}
async function doArchiveConfirm(id) {
  try {
    await DB.archiveTrainer(id);
    document.querySelector('.modal-overlay')?.remove();
    toast('Тренер архивирован','success');
    loadStaffList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doDeleteTrainer(id, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🗑 Удалить профиль</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;line-height:1.6">
      <b>${fio}</b><br><br>
      <b>Если у тренера нет истории</b> — профиль удалится полностью. Тренер сможет создать новый аккаунт.<br><br>
      <b>Если история есть</b> — нельзя удалить, только архивировать.
    </p>
    <button class="btn btn-danger btn-full" style="margin-bottom:8px"
      onclick="doDeleteConfirm(${id})">🗑 Удалить</button>
    <button class="btn btn-full" style="background:var(--card)"
      onclick="this.closest('.modal-overlay').remove()">Отмена</button>
  </div>`;
  document.body.appendChild(m);
}
async function doDeleteConfirm(id) {
  try {
    await DB.deleteTrainer(id);
    document.querySelector('.modal-overlay')?.remove();
    toast('Профиль удалён','success');
    loadStaffList();
  } catch(e) {
    document.querySelector('.modal-overlay')?.remove();
    if (e.message === 'has_history') {
      toast('Есть история тренировок — используйте архивирование','error');
    } else {
      toast('Ошибка удаления','error');
    }
  }
}

// ─ ADMIN: ФИЛИАЛЫ
// ============================================================
// SECTION: ADMIN:BRANCHES — renderAdminBranches, CRUD филиалов
// ============================================================
async function renderAdminBranches() {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Филиалы</h3>
      <button class="btn btn-sm" onclick="renderAddBranchModal()">+ Добавить</button></div>
    <div id="branches-list"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  await loadBranchesList();
}
async function loadBranchesList() {
  const body=document.getElementById('branches-list'); if (!body) return;
  try {
    const branches=await cached('branches',()=>DB.getBranches());
    body.innerHTML=!branches.length?'<p class="hint">Нет филиалов</p>':
      branches.map(b=>`<div class="staff-card">
        <div class="staff-info"><div class="staff-fio">🏢 ${b.name}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="renderRenameBranchModal('${encodeURIComponent(b.name)}')">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="doDeleteBranch(${b.id},'${b.name}')">🗑</button>
        </div>
      </div>`).join('');
  } catch(e) { console.error(e); body.innerHTML='<p class="hint">Ошибка</p>'; }
}
function renderAddBranchModal() {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новый филиал</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label><input id="br-name"></div>
    <button class="btn btn-primary btn-full" onclick="doAddBranch()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddBranch() {
  const name=document.getElementById('br-name')?.value.trim();
  if (!name) return toast('Введите название','error');
  try { await DB.addBranch(name); invalidateCache('branches'); document.querySelector('.modal-overlay')?.remove(); toast('✅','success'); loadBranchesList(); }
  catch(e) { console.error(e); toast('Такой уже есть','error'); }
}
function renderRenameBranchModal(nameEnc) {
  const name=decodeURIComponent(nameEnc);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Переименовать</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Обновит название во всех записях.</p>
    <div class="form-group"><label>Новое название</label>
      <input id="br-new-name" value="${name}"></div>
    <button class="btn btn-primary btn-full" onclick="doRenameBranch('${nameEnc}')">Переименовать</button>
  </div>`;
  document.body.appendChild(m);
}
async function doRenameBranch(oldEnc) {
  const oldName=decodeURIComponent(oldEnc);
  const newName=document.getElementById('br-new-name')?.value.trim();
  if (!newName||newName===oldName) return toast('Введите новое название','error');
  try { await DB.renameBranch(oldName,newName); document.querySelector('.modal-overlay')?.remove(); toast('✅ Переименовано везде','success'); loadBranchesList(); }
  catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteBranch(id,name) {
  if (!confirm(`Удалить «${name}»?`)) return;
  try { await DB.deleteBranch(id); toast('Удалено','success'); loadBranchesList(); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}

// ─ ADMIN: ГРУППЫ
// ============================================================
// SECTION: ADMIN:GROUPS — renderAdminGroups, renderGroupsStructure, renderGroupMonthReport
// ============================================================
async function renderAdminGroups() {
  let gMonth = new Date().toISOString().slice(0,7)+'-01';
  const allBranches = (await cached('branches',()=>DB.getBranches())).map(b=>b.name);

  const render = () => {
    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header"><h3>Группы</h3>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="renderSubstitutionsApproval()">🔄 Замены</button>
          <button class="btn btn-sm" style="background:rgba(16,185,129,.15);color:#059669" id="admin-childgp-btn">⬇️ Дет.ГП</button>
          <button class="btn btn-sm" onclick="renderGroupsStructure()">📋 Структура</button>
          <button class="btn btn-sm" onclick="renderAddGroupTypeModal()">+ Тип</button>
        </div>
      </div>
      <div style="display:flex;align-items:center;gap:10px;margin-bottom:12px">
        <button class="btn btn-sm" id="gm-prev">‹</button>
        <span style="font-weight:600;font-size:14px" id="gm-label">${new Date(gMonth).toLocaleDateString('ru-RU',{month:'long',year:'numeric'})}</span>
        <button class="btn btn-sm" id="gm-next">›</button>
      </div>
      <div id="groups-list"><div class="center-screen"><div class="spinner"></div></div></div>
      <h4 style="margin-top:20px">Назначить группу тренеру</h4>
      <div id="assign-form"></div>
    </div>`;

    document.getElementById('admin-childgp-btn')?.addEventListener('click',()=>
      renderPickBranchForChildGP(gMonth, allBranches));
    document.getElementById('gm-prev')?.addEventListener('click',()=>{
      gMonth=prevMonthStr(gMonth);
      document.getElementById('gm-label').textContent=new Date(gMonth).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
      loadGroupsList(gMonth);
    });
    document.getElementById('gm-next')?.addEventListener('click',()=>{
      gMonth=nextMonthStr(gMonth);
      document.getElementById('gm-label').textContent=new Date(gMonth).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
      loadGroupsList(gMonth);
    });
    loadGroupsList(gMonth);
    renderAssignGroupForm();
  };
  render();
}
async function renderGroupsStructure() {
  setupBack(()=>{ renderAdminApp('groups'); setupBack(null); });
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>📋 Структура групп</h3></div>
    <div id="gs-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const DOW = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
    const [branches, tgsRes, slotsRes] = await Promise.all([
      cached('branches', ()=>DB.getBranches()),
      sb().from('trainer_groups')
        .select('trainer_id, group_type_id, branch, role, group_types(name,type), profiles(fio)')
        .is('subscription_end', null).order('branch'),
      sb().from('schedule_slots')
        .select('trainer_id, group_type_id, branch, day_of_week, start_time')
        .eq('active', true).eq('slot_type','group').is('specific_date',null)
        .order('day_of_week').order('start_time'),
    ]);
    const tgs   = tgsRes.data  || [];
    const slots = slotsRes.data || [];

    // slotMap: "group_type_id|branch|trainer_id" → ["Пн 09:00", ...]
    // Но тренеры у одной группы в одном филиале могут иметь разное время (суша/вода)
    // Ключ: group_type_id|branch → уникальные расписания
    const slotMap = {};
    slots.forEach(s => {
      const key = `${s.group_type_id}|${s.branch}`;
      if (!slotMap[key]) slotMap[key] = new Set();
      slotMap[key].add(`${DOW[s.day_of_week]} ${s.start_time.slice(0,5)}`);
    });

    // Группируем: branch → group_type_id → {name, type, trainers[]}
    const byBranch = {};
    tgs.forEach(tg => {
      const b  = tg.branch;
      const gk = `${tg.group_type_id}|${b}`;
      if (!byBranch[b]) byBranch[b] = {};
      if (!byBranch[b][gk]) byBranch[b][gk] = {
        name: tg.group_types?.name||'?',
        type: tg.group_types?.type,
        trainers: [],
      };
      byBranch[b][gk].trainers.push({fio: tg.profiles?.fio||'—', role: tg.role||''});
    });

    const branchNames = (branches||[]).map(b=>b.name);
    const html = branchNames.map(branchName => {
      const groups = byBranch[branchName];
      if (!groups || !Object.keys(groups).length) return '';
      const groupsHtml = Object.entries(groups)
        .sort((a,b)=>a[1].name.localeCompare(b[1].name, 'ru'))
        .map(([gk, g])=>{
          const times = [...(slotMap[gk]||[])].sort();
          const timesHtml = times.length
            ? `<div style="font-size:12px;color:var(--accent);font-weight:500;margin:3px 0 6px">${times.join(' · ')}</div>`
            : `<div style="font-size:12px;color:var(--hint);margin:3px 0 6px">расписание не задано</div>`;
          const trainersHtml = g.trainers.map(t=>{
            const roleColor = t.role==='суша'?'#ca8a04':t.role==='вода'?'#3b82f6':'var(--hint)';
            const roleBadge = t.role
              ? `<span style="font-size:10px;background:${roleColor}22;color:${roleColor};padding:1px 6px;border-radius:6px;font-weight:600;margin-left:4px">${t.role}</span>`
              : '';
            return `<div style="font-size:13px;padding:2px 0;display:flex;align-items:center">👤 ${t.fio}${roleBadge}</div>`;
          }).join('');
          return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
            <div style="font-weight:600;font-size:14px">${g.name}</div>
            ${timesHtml}
            <div>${trainersHtml}</div>
          </div>`;
        }).join('');
      return `<div style="margin-bottom:24px">
        <div style="font-weight:700;font-size:15px;padding:8px 12px;background:rgba(124,58,237,.1);border-radius:10px;margin-bottom:4px">
          📍 ${branchName}
        </div>
        ${groupsHtml}
      </div>`;
    }).filter(Boolean).join('');

    document.getElementById('gs-body').innerHTML = html || '<p class="hint">Групп нет</p>';
  } catch(e) { document.getElementById('gs-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// Глобальный кеш инстансов групп (чтобы не передавать JSON в onclick)
window._glInstances = {};

async function loadGroupsList(monthStr) {
  const body=document.getElementById('groups-list'); if (!body) return;
  const ms = monthStr || new Date().toISOString().slice(0,7)+'-01';
  try {
    const types=await cached('groupTypes',()=>DB.getGroupTypes());
    const allAssigned = await Promise.all(types.map(gt=>
      DB.getAssignedTrainers(gt.id).then(data=>({data}))
    ));

    // Строим инстансы: группируем по group_instance_id
    // Если у нескольких тренеров одинаковый instance_id → один инстанс (Art-swim связка)
    // У каждого обычного тренера свой уникальный instance_id → своя строка
    const instanceMap = {}; // instanceId → {gt, branch, trainers[]}
    const instanceOrder = []; // порядок появления

    types.forEach((gt,i)=>{
      const assigned = allAssigned[i]?.data||[];
      assigned.forEach(a=>{
        const key = a.group_instance_id || `solo_${a.id}`;
        if (!instanceMap[key]) {
          instanceMap[key] = {gt, branch: a.branch, trainers: [], key};
          instanceOrder.push(key);
        }
        instanceMap[key].trainers.push(a);
      });
    });

    // Группируем инстансы по филиалу
    const byBranch = {};
    instanceOrder.forEach(key=>{
      const inst = instanceMap[key];
      if (!byBranch[inst.branch]) byBranch[inst.branch]=[];
      byBranch[inst.branch].push(inst);
    });

    // Сохраняем в глобальный кеш (для доступа из onclick без JSON в атрибуте)
    window._glInstances = instanceMap;

    // Порядок филиалов
    const branchOrder = (await cached('branches',()=>DB.getBranches())).map(b=>b.name);
    const branches = [...new Set([...branchOrder, ...Object.keys(byBranch)])];

    const html = branches.filter(b=>byBranch[b]?.length).map(branch=>{
      const rowsHtml = byBranch[branch].map(inst=>{
        const {gt, trainers, key} = inst;
        const first = trainers[0];

        // Расписание: берём уникальные слоты всех тренеров инстанса
        const schedSet = new Set();
        trainers.forEach(t=>{
          if (t.days_of_week?.length) {
            schedSet.add(`${t.days_of_week.join(' ')}${t.session_time?' '+t.session_time:''}`);
          }
        });
        const schedStr = [...schedSet].join(' · ');
        const schedLabel = schedStr
          ? `<span style="font-size:12px;color:var(--accent);font-weight:500">${schedStr}</span>`
          : `<span style="font-size:12px;color:var(--hint)">расписание не задано</span>`;

        const reportId = first.id;
        const safeKey = CSS.escape ? key.replace(/['"]/g,'') : key;

        return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-top:1px solid var(--border)">
          <div style="flex:1;min-width:0">
            <div style="font-size:14px;font-weight:600">${gt.name}</div>
            <div style="margin-top:2px">${schedLabel}</div>
          </div>
          <div style="display:flex;gap:6px;margin-left:8px">
            ${gt.type==='children'?`<button class="btn btn-sm btn-primary" style="font-size:12px"
              onclick="openGroupReport('${reportId}','${ms}','list')">📊 Отчёт</button>`:''}
            <button class="btn btn-sm" style="font-size:12px;background:rgba(124,58,237,.15);color:#a78bfa"
              onclick="openGroupPersonnel('${key}','${ms}')">👥 Персонал</button>
          </div>
        </div>`;
      }).join('');

      return `<div class="staff-card" style="flex-direction:column;align-items:flex-start;gap:0;padding-bottom:4px">
        <div style="font-weight:700;font-size:15px;margin-bottom:4px">📍 ${branch}</div>
        ${rowsHtml}
      </div>`;
    }).join('');

    body.innerHTML = html || '<p class="hint">Нет групп</p>';
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

function openGroupPersonnel(instanceKey, ms) {
  const inst = window._glInstances?.[instanceKey];
  if (!inst) return toast('Данные не загружены, обновите страницу','error');
  renderGroupPersonnelModal(inst.gt.id, inst.gt.name, inst.branch, inst.gt.type, ms, inst.trainers);
}

function renderGroupPersonnelModal(groupTypeId, groupNameRaw, branch, groupType, ms, trainersRaw) {
  const groupName = typeof groupNameRaw === 'string' ? groupNameRaw : String(groupNameRaw);
  // trainersRaw может быть массивом (прямой вызов) или строкой (старый путь)
  const trainers = Array.isArray(trainersRaw)
    ? trainersRaw.map(t=>({
        id: t.id, trainerId: t.trainer_id, fio: t.profiles?.fio||'—', role: t.role||'',
        days: t.days_of_week||[], time: t.session_time||'',
        rateType: t.rate_type||'percent', rateValue: t.rate_value||0,
        leaderName: t.leader_name||'', leaderPct: t.leader_fee_percent||0
      }))
    : JSON.parse(decodeURIComponent(trainersRaw));
  const isArtSwim = groupName.toLowerCase().includes('art');
  const isAdult   = groupType === 'adult';

  // Ищем данные руководителя из любого тренера где есть leader_name
  const withLeader = trainers.find(t=>t.leaderName)||trainers[0];

  const m = el('div','modal-overlay');

  const trainersHtml = trainers.map((t,idx)=>{
    const roleColor = t.role==='суша'?'#ca8a04':t.role==='вода'?'#3b82f6':'var(--hint)';
    const roleBadge = t.role
      ? `<span style="font-size:10px;background:${roleColor}22;color:${roleColor};padding:1px 6px;border-radius:6px;font-weight:600;margin-left:6px">${t.role}</span>`
      : '';
    const schedLabel = t.days?.length
      ? `<span style="font-size:11px;color:var(--hint)">${t.days.join(' ')}${t.time?' '+t.time:''}</span>`
      : '';

    // Поле ставки/процента
    let rateHtml = '';
    if (isAdult) {
      rateHtml = `<div style="font-size:12px;color:var(--hint);margin-top:6px">Взрослая — ставка по явке</div>`;
    } else if (t.rateType==='flat') {
      rateHtml = `<div style="display:flex;align-items:center;gap:6px;margin-top:6px">
        <span style="font-size:12px;color:var(--hint)">Ставка/занятие:</span>
        <input id="rate-val-${t.id}" type="number" value="${t.rateValue}" min="0"
          style="width:90px;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:4px 6px;color:var(--text);font-size:12px">
        <span style="font-size:12px;color:var(--hint)">сум</span>
        <button class="btn btn-sm" style="font-size:11px;padding:2px 8px"
          onclick="doSaveTrainerRate('${t.id}','flat',document.getElementById('rate-val-${t.id}').value)">💾</button>
      </div>`;
    } else {
      rateHtml = `<div style="display:flex;align-items:center;gap:6px;margin-top:6px">
        <span style="font-size:12px;color:var(--hint)">Процент:</span>
        <input id="rate-val-${t.id}" type="number" value="${t.rateValue}" min="0" max="100"
          style="width:60px;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:4px 6px;color:var(--text);font-size:12px">
        <span style="font-size:12px;color:var(--hint)">%</span>
        <button class="btn btn-sm" style="font-size:11px;padding:2px 8px"
          onclick="doSaveTrainerRate('${t.id}','percent',document.getElementById('rate-val-${t.id}').value)">💾</button>
      </div>`;
    }

    return `<div style="padding:10px 0;border-bottom:1px solid var(--border)">
      <div style="display:flex;justify-content:space-between;align-items:flex-start">
        <div style="flex:1">
          <div style="font-size:14px;font-weight:500">${t.fio}${roleBadge}</div>
          ${schedLabel?`<div style="margin-top:2px">${schedLabel}</div>`:''}
          ${rateHtml}
        </div>
        <div style="display:flex;gap:5px;margin-left:8px;flex-shrink:0">
          <button class="btn btn-sm" style="font-size:11px;background:var(--card);border:1px solid var(--border)"
            onclick="document.querySelector('.modal-overlay').remove();renderGroupScheduleModal('${t.id}','${encodeURIComponent(JSON.stringify(t.days))}','${t.time}')">🗓️</button>
          <button class="btn btn-sm" style="background:rgba(239,68,68,.15);color:#ef4444;font-size:11px"
            onclick="document.querySelector('.modal-overlay').remove();doUnassignGroup(${t.id})">Откр.</button>
        </div>
      </div>
    </div>`;
  }).join('');

  // Блок руководителя (только детская)
  const leaderHtml = !isAdult ? `
    <div style="margin-top:14px;background:rgba(245,158,11,.08);border:1px solid rgba(245,158,11,.3);border-radius:10px;padding:12px">
      <div style="font-size:13px;font-weight:600;margin-bottom:8px;color:#f59e0b">👑 Руководитель группы</div>
      <div style="font-size:12px;color:var(--hint);margin-bottom:8px">% от суммы оплат за месяц. Видно координатору и старшим тренерам.</div>
      <div class="form-group" style="margin-bottom:8px"><label style="font-size:12px">Имя</label>
        <input id="leader-name-inp" type="text" placeholder="Иванов Иван" value="${withLeader?.leaderName||''}"
          style="font-size:13px"></div>
      <div class="form-group" style="margin-bottom:8px"><label style="font-size:12px">Процент (%)</label>
        <input id="leader-pct-inp" type="number" min="0" max="100" value="${withLeader?.leaderPct||0}"
          style="font-size:13px"></div>
      <button class="btn btn-sm btn-primary btn-full"
        onclick="doSaveLeaderFeePersonnel('${withLeader?.id}')">Сохранить руководителя</button>
    </div>` : '';

  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Персонал — ${groupName}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:8px">${branch}</p>
    ${trainersHtml}
    ${leaderHtml}
    <button class="btn btn-primary btn-full" style="margin-top:14px"
      onclick="this.closest('.modal-overlay').remove();renderAddSecondTrainerModal(${groupTypeId},'${encodeURIComponent(groupName)}','${branch}','${groupType}','${trainers[0]?.id||''}')">+ 2й тренер</button>
  </div>`;
  document.body.appendChild(m);
}

async function doSaveTrainerRate(tgId, rateType, rateValueStr) {
  const rateValue = parseFloat(rateValueStr)||0;
  try {
    // Быстрая правка из модалки персонала = «за весь текущий месяц» (1-е число) в историю ставок
    const now = new Date();
    const effectiveFrom = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    try { await DB.addRateHistory(tgId, rateType, rateValue, effectiveFrom, STATE.profile.id); }
    catch(e) { console.warn('[addRateHistory] не записана (миграция ещё не применена?)', e?.message||e); }
    await DB.updateTrainerGroupRate(tgId, rateType, rateValue);
    toast('✅ Ставка сохранена','success');
    invalidateCache('groupTypes');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doSaveLeaderFeePersonnel(tgId) {
  const name = document.getElementById('leader-name-inp')?.value.trim()||null;
  const pct  = parseFloat(document.getElementById('leader-pct-inp')?.value)||0;
  try {
    await DB.updateTrainerGroupLeader(tgId, name, pct);
    toast('✅ Руководитель сохранён','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderAddGroupTypeModal() {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новый тип группы</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label>
      <input id="gt-name" placeholder="Акваджим / Детская группа / Art-swim"></div>
    <div class="form-group"><label>Тип</label>
      <select id="gt-type" onchange="onGtTypeChange(this.value)">
        <option value="children">👶 Детская</option>
        <option value="adult">🏊 Взрослая</option>
      </select></div>
    <div id="gt-children-opts">
      <div style="background:rgba(124,58,237,.1);border-radius:8px;padding:10px;margin-bottom:12px;font-size:12px;color:var(--hint)">
        Детская группа: тренер получает % от стоимости абонемента каждого ребёнка
      </div>
      <div class="form-group"><label>Стоимость абонемента (сум/мес)</label>
        <input id="gt-price" type="number" value="1000000"></div>
      <div class="form-group"><label>% тренеру (стандартный)</label>
        <input id="gt-pct" type="number" value="40"></div>
    </div>
    <div id="gt-adult-opts" style="display:none">
      <div style="background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint)">
        Взрослая группа: ставка тренера зависит от явки<br>
        <b>1-3 чел = 110 000 · 4-6 чел = 120 000 · 7+ чел = 130 000 сум</b><br>
        Ставки настраиваются в Config
      </div>
    </div>
    <button class="btn btn-primary btn-full" style="margin-top:16px" onclick="doAddGroupType()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
function onGtTypeChange(val) {
  document.getElementById('gt-children-opts').style.display = val==='children' ? '' : 'none';
  document.getElementById('gt-adult-opts').style.display    = val==='adult'    ? '' : 'none';
}
async function doAddGroupType() {
  const name=document.getElementById('gt-name')?.value.trim();
  const type=document.getElementById('gt-type')?.value;
  const price=parseInt(document.getElementById('gt-price')?.value||0);
  const pct=parseInt(document.getElementById('gt-pct')?.value||40);
  if (!name) return toast('Введите название','error');
  try {
    await DB.addGroupType({name,type,billing_model:type==='children'?'percentage':'headcount',
      price_per_month:type==='children'?price:0,trainer_percentage:type==='children'?pct:0});
    invalidateCache('groupTypes');
    document.querySelector('.modal-overlay')?.remove(); toast('✅','success'); loadGroupsList();
  } catch(e) { console.error(e); toast('Ошибка','error'); }
}
async function renderAddSecondTrainerModal(groupTypeId, groupNameEnc, branch, groupType, existingTgId) {
  const groupName = decodeURIComponent(groupNameEnc);
  const isAdult   = groupType === 'adult';
  const isArtSwim = groupName.toLowerCase().includes('art');
  // Получаем group_instance_id существующего тренера для автоматической связки
  let existingInstanceId = null;
  if (existingTgId) {
    try {
      const {data} = await sb().from('trainer_groups').select('group_instance_id').eq('id', existingTgId).single();
      existingInstanceId = data?.group_instance_id || null;
    } catch(e) {}
  }
  try {
    const [trainers, seniors] = await Promise.all([
      DB.getProfilesByRole('trainer'),
      DB.getProfilesByRole('senior_trainer'),
    ]);
    const allT = [...trainers, ...seniors].filter(t=>!t.is_archived);
    const m = el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>Второй тренер — ${groupName}</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <p class="hint" style="margin-bottom:12px">${branch}</p>
      <div class="form-group"><label>Тренер</label>
        <select id="st2-trainer">
          <option value="">— выберите —</option>
          ${_trainerOptionsWithFlags(allT)}
        </select></div>
      ${isArtSwim?`<div class="form-group"><label>Роль</label>
        <select id="st2-role">
          <option value="суша">Суша</option>
          <option value="вода">Вода</option>
          <option value="суша+вода">Суша + Вода</option>
        </select></div>`:'<input type="hidden" id="st2-role" value="">'}
      ${isAdult?`<div style="background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint);margin-bottom:12px">
        ✅ Взрослая группа: ставка по явке</div>`:`
      <div class="form-group"><label>Ставка за занятие (сум)</label>
        <input id="st2-rate" type="number" value="75000" min="0" placeholder="75000"></div>`}
      <input type="hidden" id="st2-instance-id" value="${existingInstanceId||''}">
      <button class="btn btn-primary btn-full" onclick="doAddSecondTrainer(${groupTypeId},'${branch}','${groupType}')">Добавить</button>
    </div>`;
    document.body.appendChild(m);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function onSt2RateTypeChange(sel) {
  const label = document.getElementById('st2-rate-label');
  const inp   = document.getElementById('st2-rate');
  if (sel.value==='flat') {
    if (label) label.textContent='Сумма (сум)';
    if (inp)   { inp.value=500000; inp.placeholder='500000'; }
  } else {
    if (label) label.textContent='Процент (%)';
    if (inp)   { inp.value=20; inp.placeholder='20'; }
  }
}
async function doAddSecondTrainer(groupTypeId, branch, groupType) {
  const trainerId  = parseInt(document.getElementById('st2-trainer')?.value);
  const role       = document.getElementById('st2-role')?.value||null;
  const isAdult    = groupType === 'adult';
  const rateType   = isAdult ? 'headcount' : 'flat';
  const rateValue  = isAdult ? 0 : (parseFloat(document.getElementById('st2-rate')?.value)||75000);
  const instanceId = document.getElementById('st2-instance-id')?.value||null;
  if (!trainerId) return toast('Выберите тренера','error');
  if (!_confirmUnclaimedTrainer('st2-trainer')) return;
  try {
    await DB.addTrainerGroup(trainerId, groupTypeId, branch, todayStr(), rateType, rateValue, role||null, instanceId||null);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Второй тренер добавлен','success');
    invalidateCache('groupTypes');
    loadGroupsList(new Date().toISOString().slice(0,7)+'-01');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function renderAssignGroupForm() {
  const form=document.getElementById('assign-form'); if (!form) return;
  try {
    const [trainers,seniors,gts,branches]=await Promise.all([
      DB.getProfilesByRole('trainer'),DB.getProfilesByRole('senior_trainer'),
      DB.getGroupTypes(),DB.getBranches(),
    ]);
    const allT=[...trainers,...seniors].filter(t=>!t.is_archived);
    window._agGts = gts;
    form.innerHTML=`
      <div class="form-group"><label>Тренер</label>
        <select id="ag-trainer">
          <option value="">— выберите —</option>
          ${_trainerOptionsWithFlags(allT)}
        </select></div>
      <div class="form-group"><label>Тип группы</label>
        <select id="ag-type" onchange="onAgTypeChange(this)">
          ${gts.map(g=>`<option value="${g.id}" data-type="${g.type}" data-name="${g.name}">${g.name}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Филиал</label>
        <select id="ag-branch">
          ${branches.map(b=>`<option>${b.name}</option>`).join('')}
        </select></div>
      <div id="ag-date-wrap" class="form-group"><label>Начало</label>
        <input type="date" id="ag-start" value="${todayStr()}"></div>
      <div id="ag-artswim-role" class="form-group" style="display:none">
        <label>Роль (Art-swim)</label>
        <select id="ag-role">
          <option value="суша">Суша</option>
          <option value="вода">Вода</option>
          <option value="суша+вода">Суша + Вода</option>
        </select></div>
      <div id="ag-rate-section">
        <div class="form-group"><label>Тип ставки</label>
          <select id="ag-rate-type" onchange="onRateTypeChange(this)">
            <option value="percent">Процент (%)</option>
            <option value="flat">Фиксированная сумма</option>
          </select></div>
        <div class="form-group"><label id="ag-rate-label">Процент (%)</label>
          <input id="ag-rate-value" type="number" value="40" min="0"></div>
      </div>
      <div id="ag-adult-note" style="display:none;background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint);margin-bottom:12px">
        ✅ Взрослая группа: ставка считается автоматически по явке<br>
        <b>1-3 чел = 110 000 · 4-6 = 120 000 · 7+ = 130 000 сум</b>
      </div>
      <button class="btn btn-primary btn-full" onclick="doAssignGroup()">Назначить</button>`;
    const sel = document.getElementById('ag-type');
if (sel) onAgTypeChange(sel);
  } catch(e) { console.error(e); form.innerHTML='<p class="hint">Ошибка</p>'; }
}
function onAgTypeChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const isChildren = opt?.dataset.type === 'children';
  const isArtSwim  = opt?.dataset.name?.toLowerCase().includes('art');
  const dateWrap   = document.getElementById('ag-date-wrap');
  const roleWrap   = document.getElementById('ag-artswim-role');
  const rateSection = document.getElementById('ag-rate-section');
  const adultNote   = document.getElementById('ag-adult-note');
  if (dateWrap)   dateWrap.style.display   = isChildren ? '' : 'none';
  if (roleWrap)   roleWrap.style.display   = isArtSwim  ? '' : 'none';
  if (rateSection) rateSection.style.display = isChildren ? '' : 'none';
  if (adultNote)   adultNote.style.display   = isChildren ? 'none' : '';
}
async function doAssignGroup() {
  const trainerId   = parseInt(document.getElementById('ag-trainer')?.value);
  const groupTypeId = parseInt(document.getElementById('ag-type')?.value);
  const branch      = document.getElementById('ag-branch')?.value;
  const start       = document.getElementById('ag-start')?.value||todayStr();
  const rateType    = document.getElementById('ag-rate-type')?.value||'percent';
  const rateValue   = parseFloat(document.getElementById('ag-rate-value')?.value)||40;
  const role        = document.getElementById('ag-role')?.value||null;
  if (!trainerId||!groupTypeId||!branch) return toast('Заполните все поля','error');
  if (!trainerId || trainerId===0) return toast('Выберите тренера','error');
  if (!_confirmUnclaimedTrainer('ag-trainer')) return;
  try {
    await DB.addTrainerGroup(trainerId,groupTypeId,branch,start,rateType,rateValue,role);
    toast('✅ Назначено','success');
    await loadGroupsList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doUnassignGroup(id) {
  if (!confirm('Открепить тренера от группы?\n\nГруппа исчезнет из его списка. Это действие нельзя отменить автоматически.')) return;
  if (!confirm('Подтвердите ещё раз: открепить тренера?')) return;
  try {
    await DB.unassignTrainerGroup(id);
    DB.auditLog('group_unassign', STATE.profile.id, STATE.profile.fio, id, 'trainer_group', {}, STATE.profile.branches?.[0]);
    toast('Откреплено','success');
    await loadGroupsList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
// ══════════════════════════════════════════════════════════════
// ОТЧЁТ ПО ДЕТСКОЙ ГРУППЕ + УТВЕРЖДЕНИЕ ЗП + ЗАМЕНЫ
// ══════════════════════════════════════════════════════════════

// Открыть отчёт, запомнив точку возврата по роли/источнику.
// kind: 'detail' — назад в карточку группы (открывали из неё);
//       'list'   — назад в список групп вкладки по роли (координатор/старший/доп.филиалы).
function openGroupReport(groupId, monthStr, kind='list', anchor='') {
  const role = STATE.profile?.role;
  let backFn;
  if (kind==='detail') {
    backFn = ()=>renderGroupDetail(groupId);
  } else if (role==='admin'||role==='ceo') {
    backFn = ()=>{ renderAdminApp('groups'); };
  } else if (role==='senior_trainer') {
    backFn = ()=>{ renderSeniorApp('groups'); };
  } else {
    backFn = ()=>renderTrainerShell('groups');
  }
  navPush(backFn);
  // anchor 'payroll' → отдельный экран ЗП; из хаба 'detail' без anchor → только дети; список (админ) → всё
  const view = anchor==='payroll' ? 'payroll' : (kind==='detail' ? 'children' : 'full');
  renderGroupMonthReport(groupId, monthStr, view);
}

// view: 'children' = отчёт по детям (явка/оплаты), 'payroll' = ЗП персоналу, 'full' = всё (список из админки)
async function renderGroupMonthReport(groupId, monthStr, view='full') {
  // monthStr = 'YYYY-MM-01'
  const isAdmin = ['admin','ceo'].includes(STATE.profile.role);
  loading('Загрузка...');
  try {
    const report = await DB.getGroupMonthReport(groupId, monthStr);
    const {clients, payments, notes, attendance, payouts, trainers, instanceSessions, substitutions, groupTypeInfo} = report;

    const payMap  = Object.fromEntries(payments.map(p=>[p.group_client_id, p]));
    const noteMap = Object.fromEntries(notes.map(n=>[n.group_client_id, n]));

    // Уникальные даты занятий в месяце
    const sessionDates = [...new Set(attendance.map(a=>a.session_date))].sort();
    const totalSessions = sessionDates.length;

    // Посещаемость по ребёнку
    const attByClient = {};
    attendance.forEach(a=>{
      if (!attByClient[a.group_client_id]) attByClient[a.group_client_id]=0;
      if (a.attended) attByClient[a.group_client_id]++;
    });

    // Итого оплат
    const totalPaid = payments.filter(p=>p.paid).reduce((s,p)=>s+Number(p.amount||0),0);

    // Флаги потенциальных дублей (только для координатора/старшего)
    const instanceId = trainers[0]?.group_instance_id||null;
    const canSeePayrollData = isAdmin||STATE.profile.role==='senior_trainer';
    // Оба запроса независимы и от отчёта, и друг от друга — грузим параллельно,
    // а не двумя последовательными await (экономит один сетевой round-trip).
    // dupFlags — флаги дублей имён; rateHistory — история ставок для авто-ЗП
    // (до применения миграции вернёт []).
    const [dupFlags, rateHistory] = await Promise.all([
      (canSeePayrollData && instanceId) ? DB.getDuplicateFlags(instanceId) : Promise.resolve([]),
      canSeePayrollData ? DB.getRateHistory(trainers.map(t=>t.id), monthStr) : Promise.resolve([]),
    ]);

    const isArtSwimGroup = groupTypeInfo?.name?.toLowerCase().includes('art');
    const canSeePayroll  = (isAdmin || STATE.profile.role==='senior_trainer') && isArtSwimGroup;

    const monthLabel = new Date(monthStr).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
    // Кнопка «назад» — на точку входа, которую выставил вызывающий (navPush).
    // Fallback goBack по роли. НЕ хардкодим renderGroupDetail — иначе координатора/старшего
    // из списка групп выкидывало в тренерский экран детали, который он не открывал.
    setupBack(goBack);
    const showChildren = view!=='payroll';
    const showPayroll  = view!=='children';
    const screenTitle = view==='payroll' ? 'ЗП за месяц' : (view==='children' ? 'Отчёт по детям' : 'Отчёт группы');
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">${screenTitle}</div>
      <div style="display:flex;gap:6px">
        ${showChildren?`<button class="btn btn-sm btn-primary" onclick="doExportChildGroupExcel('${groupId}','${monthStr}')">⬇️ Excel</button>`:''}
        ${showPayroll&&canSeePayroll?`<button class="btn btn-sm" style="background:rgba(16,185,129,.2);color:#10b981" onclick="doExportGroupPayroll('${groupId}','${monthStr}')">⬇️ ЗП</button>`:''}
      </div>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="section-header">
        <h3>${monthLabel}</h3>
        <div class="month-nav">
          <button onclick="renderGroupMonthReport('${groupId}','${prevMonthStr(monthStr)}','${view}')">‹</button>
          <button onclick="renderGroupMonthReport('${groupId}','${nextMonthStr(monthStr)}','${view}')">›</button>
        </div>
      </div>

      ${showChildren?`
      <!-- Сводка -->
      <div class="summary-cards" style="margin-bottom:16px">
        <div class="summary-card"><div class="s-val">${clients.filter(c=>c.is_active).length}</div><div class="s-lbl">Детей</div></div>
        <div class="summary-card"><div class="s-val">${payments.filter(p=>p.paid).length}</div><div class="s-lbl">Оплатили</div></div>
        <div class="summary-card"><div class="s-val">${totalSessions}</div><div class="s-lbl">Занятий</div></div>
        <div class="summary-card accent"><div class="s-val">${fmt(totalPaid)}</div><div class="s-lbl">Сумма оплат</div></div>
      </div>

      <!-- Потенциальные дубли имён -->
      ${dupFlags.length?`<div class="warn-banner" style="background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.4);margin-bottom:16px">
        <div style="font-weight:600;margin-bottom:8px">⚠️ Возможные дубли имён (${dupFlags.length})</div>
        ${dupFlags.map(f=>`<div style="padding:8px 0;border-top:1px solid rgba(245,158,11,.2)">
          <div style="font-size:13px;margin-bottom:6px">
            <b>${f.c1?.name||'?'}</b> и <b>${f.c2?.name||'?'}</b> — один ребёнок?
          </div>
          <div style="display:flex;gap:8px">
            <button class="btn btn-sm" style="background:rgba(239,68,68,.15);color:#ef4444"
              onclick="resolveGroupDuplicate('${f.id}','merged','${groupId}','${monthStr}')">
              Да — объединить</button>
            <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
              onclick="resolveGroupDuplicate('${f.id}','confirmed_different','${groupId}','${monthStr}')">
              Нет — разные дети</button>
          </div>
        </div>`).join('')}
      </div>`:''}

      <!-- Сигнал: ходят без оплаты -->
      ${(()=>{
        const debtKids = clients.filter(c=>c.is_active && !(payMap[c.id]?.paid) && (attByClient[c.id]||0)>2);
        if (!debtKids.length || !(isAdmin||STATE.profile.role==='senior_trainer')) return '';
        return `<div class="warn-banner" style="background:rgba(239,68,68,.08);border-color:rgba(239,68,68,.35);margin-bottom:16px">
          <div style="font-weight:600;margin-bottom:6px">⚠️ Без оплаты, но ходят больше 2 занятий (${debtKids.length})</div>
          ${debtKids.map(c=>`<div style="font-size:13px;padding:4px 0;border-top:1px solid rgba(239,68,68,.15)">
            ${c.name}${c.age?`, ${c.age}л`:''} — <b>${attByClient[c.id]||0} занятий</b>
          </div>`).join('')}
        </div>`;
      })()}

      <!-- Таблица детей -->
      <h4 style="margin-bottom:8px">Посещаемость и оплаты</h4>
      <div style="overflow-x:auto">
        <table class="admin-table" style="font-size:12px;min-width:320px">
          <thead><tr>
            <th style="text-align:left">Ребёнок</th>
            <th>Оплата</th>
            <th>Абонемент</th>
            <th>Явка</th>
            <th>Заметка</th>
          </tr></thead>
          <tbody>
            ${(()=>{
              const active = clients.filter(c=>c.is_active);
              const rowHtml = c=>{
                const pay = payMap[c.id];
                const note = noteMap[c.id];
                const att = attByClient[c.id]||0;
                const paid = pay?.paid;
                const debtAlert = !paid && att > 2;
                return `<tr${debtAlert?' style="background:rgba(239,68,68,.06)"':''}>
                  <td style="font-weight:500">
                    ${debtAlert?'<span title="Ходит без оплаты" style="color:#ef4444;margin-right:4px">⚠️</span>':''}
                    ${c.name}${c.age?`, ${c.age}л`:''}
                  </td>
                  <td style="color:${paid?'#10b981':'#ef4444'}">${paid?fmt(pay?.amount||0)+' ✓':'—'}</td>
                  <td style="font-size:11px;color:var(--hint)">${pay?.sub_start?fmtDate(pay.sub_start)+(pay.sub_end?' – '+fmtDate(pay.sub_end):''):'—'}</td>
                  <td style="color:${debtAlert?'#ef4444':''};font-weight:${debtAlert?'600':''}">${att}/${totalSessions}</td>
                  <td style="font-size:11px;color:var(--hint);max-width:120px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${note?.note||'—'}</td>
                </tr>`;
              };
              // Подгруппы: если их больше одной — строки группируем с подзаголовками
              const subNames = [...new Set(active.map(c=>c.subgroup||''))];
              if (subNames.length<=1) return active.map(rowHtml).join('');
              return ['', ...subNames.filter(Boolean).sort()]
                .filter(s=>active.some(c=>(c.subgroup||'')===s))
                .map(s=>`<tr><td colspan="5" style="font-weight:700;font-size:12px;background:rgba(124,58,237,.08);padding:6px 8px">${subLabel(s)}</td></tr>`
                  + active.filter(c=>(c.subgroup||'')===s).map(rowHtml).join('')).join('');
            })()}
          </tbody>
        </table>
      </div>

      <!-- Конспекты группы -->
      ${notes.length ? `
      <h4 style="margin-top:20px;margin-bottom:8px">📝 Конспекты за месяц</h4>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${notes.map(n=>{
          const clientName = (clients.find(c=>c.id===n.group_client_id)?.name)||'—';
          return `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px">
            <div style="font-size:12px;color:var(--hint);margin-bottom:4px">${clientName}</div>
            <div style="font-size:13px">${n.note||'—'}</div>
          </div>`;
        }).join('')}
      </div>` : ''}
      `:''}

      <!-- ЗП тренерам — авто-расчёт (только координатор / старший) -->
      ${showPayroll?(()=>{
        const canSee = isAdmin || STATE.profile.role==='senior_trainer';
        if (!canSee) return '';

        const isArtSwim   = isArtSwimGroup;
        const activeCount = clients.filter(c=>c.is_active!==false).length;
        const paidCount   = payments.filter(p=>p.paid).length;

        // Замены за месяц: в деньгах участвуют только утверждённые старшим (со ставкой);
        // pending показываются с бейджем «⏳» без сумм — иначе отчёт расходится со сводкой ЗП
        const allSubs      = substitutions || [];
        const approvedSubs = allSubs.filter(s => s.status === 'approved');
        const pendingSubs  = allSubs.filter(s => s.status !== 'approved');

        // ЕДИНАЯ формула — calcChildGroupPayroll (db.js): вал, пул-лимит, история ставок,
        // премии/штрафы из group_trainer_payouts. payout_value не читается — ЗП полностью авто.
        const {totalRevenue, pool, leaderName, leaderPct, leaderFee, poolCapped, remainder, rows: trainerRows} =
          calcChildGroupPayroll({
            payments, trainers, instanceSessions, substitutions: approvedSubs,
            rateHistory, adjustments: payouts, monthStr, isArtSwim, attendance,
          });
        const allFlat = trainers.length>0
          && !trainers.some(t=>t.rate_type==='percent')
          && trainers.some(t=>t.rate_type==='flat');

        // Замены от внешних тренеров (не прикреплённых к группе)
        const attachedTrainerIds = new Set(trainers.map(t => t.trainer_id));
        const externalSubs = approvedSubs.filter(s => !attachedTrainerIds.has(s.substitute_trainer_id));

        return `
        <div style="margin-top:20px" id="gmr-payroll">
          <h4 style="margin-bottom:12px">ЗП тренерам за месяц</h4>

          ${pendingSubs.length ? `<div class="warn-banner" style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.4);border-radius:10px;padding:12px;margin-bottom:12px">
            <div style="font-weight:600;margin-bottom:6px">⏳ Неутверждённые замены (${pendingSubs.length}) — в расчёте не участвуют</div>
            ${pendingSubs.map(s=>`<div style="font-size:12px;padding:4px 0;border-top:1px solid rgba(245,158,11,.2)">
              ${s.substitute?.fio||'?'} вместо ${s.original?.fio||'?'} · ${fmtDate(s.session_date)}
              <span style="font-size:11px;color:#f59e0b;font-weight:600;margin-left:4px">⏳ не утверждена</span>
            </div>`).join('')}
            <div style="font-size:11px;color:var(--hint);margin-top:6px">Утвердите замены до расчёта ЗП — после утверждения они вычтутся у заменённого и уйдут заменяющему отдельной строкой.</div>
          </div>` : ''}

          ${isArtSwim ? `<div style="background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.3);border-radius:10px;padding:12px;margin-bottom:12px">
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:13px;color:var(--hint)">Вал (оплаты за месяц: ${paidCount} из ${activeCount} дет)</span>
              <span style="font-weight:700;font-size:15px">${fmt(totalRevenue)} сум</span>
            </div>
            <div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:13px;color:var(--hint)">Пул (50% вала) — распределяется весь</span>
              <span style="font-weight:600;font-size:14px">${fmt(pool)} сум</span>
            </div>
            ${leaderName ? `<div style="display:flex;justify-content:space-between;margin-bottom:4px">
              <span style="font-size:12px;color:var(--hint)">Руководитель${allFlat ? ` (${leaderPct}% пула + остаток)` : ` (${leaderPct}% пула)`}: ${leaderName}</span>
              <span style="font-size:13px;color:#f59e0b;font-weight:600">−${fmt(leaderFee)} сум</span>
            </div>` : ''}
            <div style="display:flex;justify-content:space-between;padding-top:8px;border-top:1px solid rgba(124,58,237,.2)">
              <span style="font-size:12px;color:var(--hint)">Нераспределённый остаток пула</span>
              <span style="font-size:13px;font-weight:600;color:${Math.abs(remainder)<1000?'#10b981':'#f59e0b'}">${fmt(remainder)} сум</span>
            </div>
          </div>` : ''}

          ${trainerRows.map(r => `
          <div class="staff-card" style="flex-direction:column;gap:8px;margin-bottom:10px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div class="staff-fio">${r.fio}</div>
                <div class="staff-meta">${r.role} · ${r.rateLabel}</div>
              </div>
              <span style="font-size:13px;color:#10b981;font-weight:700">${fmt(r.final)} сум · авто</span>
            </div>
            <div style="background:rgba(16,185,129,.07);border-radius:8px;padding:10px;font-size:13px">
              <div style="display:flex;justify-content:space-between">
                <span style="color:var(--hint)">${r.calcNote}</span>
                <span style="font-weight:600">${fmt(r.autoAmt)} сум</span>
              </div>
              ${r.subsICovered.length ? `<div style="display:flex;justify-content:space-between;margin-top:4px">
                <span style="color:#10b981;font-size:12px">+ замены (утверждённые, ${r.subsICovered.length} зан) — отдельной строкой в сводке ЗП</span>
                <span style="color:#10b981;font-weight:600">+${fmt(r.subsICoveredCost)} сум</span>
              </div>` : ''}
              ${r.mySubs.length ? `<div style="margin-top:6px;font-size:12px;color:#ef4444">
                Заменили (${r.mySubs.length} зан): ${r.mySubs.map(s=>`${s.substitute?.fio||'?'} ${fmtDate(s.session_date)} ${canSee?`<button onclick="editSubRate('${s.id}',${s.rate||75000},'${groupId}','${monthStr}')" style="background:none;border:none;cursor:pointer;color:var(--hint);font-size:11px">✏️ ${fmt(s.rate||75000)}</button>`:fmt(s.rate||75000)+' сум'}`).join(', ')}
              </div>` : ''}
              <div style="display:flex;gap:8px;margin-top:8px">
                <div style="flex:1">
                  <label style="font-size:11px;color:var(--hint)">Премия</label>
                  <input id="bonus-${r.trainerId}" type="number" value="${r.bonus}" min="0" placeholder="0"
                    oninput="updateGroupPayoutTotal('${r.trainerId}',${r.autoAmt})"
                    style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:13px">
                </div>
                <div style="flex:1">
                  <label style="font-size:11px;color:var(--hint)">Штраф</label>
                  <input id="penalty-${r.trainerId}" type="number" value="${r.penalty}" min="0" placeholder="0"
                    oninput="updateGroupPayoutTotal('${r.trainerId}',${r.autoAmt})"
                    style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px 8px;color:var(--text);font-size:13px">
                </div>
              </div>
              <div style="display:flex;justify-content:space-between;margin-top:8px;padding-top:8px;border-top:1px solid var(--border)">
                <span style="font-weight:600">К выплате (без замен):</span>
                <span id="gtotal-${r.trainerId}" style="font-weight:700;color:var(--accent)">${fmt(r.final)} сум</span>
              </div>
            </div>
            <button class="btn btn-sm btn-primary btn-full"
              onclick="doSaveGroupAdjustment('${r.tgId}','${r.trainerId}','${monthStr}',${r.autoAmt},'${groupId}')">
              💾 Сохранить премию/штраф</button>
          </div>`).join('')}

          ${externalSubs.length ? `<div style="background:var(--card);border:1px solid var(--border);border-radius:10px;padding:12px;margin-top:8px">
            <div style="font-weight:600;margin-bottom:8px">Замены (внешние тренеры)</div>
            ${externalSubs.map(s=>`<div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:6px">
              <div>
                <div style="font-size:13px;font-weight:500">${s.substitute?.fio||'?'}</div>
                <div style="font-size:11px;color:var(--hint)">${fmtDate(s.session_date)} · вместо ${s.original?.fio||'?'}</div>
              </div>
              <div style="display:flex;align-items:center;gap:6px">
                <span style="font-weight:600;color:var(--accent)">${fmt(s.rate||75000)} сум</span>
                ${canSee?`<button onclick="editSubRate('${s.id}',${s.rate||75000},'${groupId}','${monthStr}')" style="background:none;border:none;cursor:pointer;color:var(--hint);font-size:13px">✏️</button>`:''}
              </div>
            </div>`).join('')}
          </div>` : ''}

          ${leaderName ? `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-top:8px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div>
                <div style="font-weight:600;font-size:14px">Руководитель: ${leaderName}</div>
                <div style="font-size:12px;color:var(--hint)">${isArtSwim ? (allFlat ? `${leaderPct}% пула + остаток пула` : `${leaderPct}% пула ${fmt(pool)} сум`) : leaderPct+'% от вала '+fmt(totalRevenue)+' сум'}</div>
              </div>
              <div style="display:flex;align-items:center;gap:8px">
                <span style="font-size:18px;font-weight:700;color:var(--accent)">${fmt(leaderFee)} сум</span>
                ${isAdmin ? `<button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
                  onclick="renderLeaderFeeModal('${groupId}','${encodeURIComponent(leaderName)}',${leaderPct})">✏️</button>` : ''}
              </div>
            </div>
          </div>` : `
          ${isAdmin ? `<div style="margin-top:8px"><button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
            onclick="renderLeaderFeeModal('${groupId}','',0)">+ Руководитель группы</button></div>` : ''}`}
        </div>`;
      })():''}

    </div></div>`);
  } catch(e) {
    toast('Ошибка: ' + (e?.message||String(e)), 'error');
    console.error('[renderGroupMonthReport]', e);
  }
}

function renderLeaderFeeModal(groupId, nameEnc, pct) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Руководитель группы</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Имя и % отчислений от суммы оплат за месяц. Видно только координатору и старшим.</p>
    <div class="form-group"><label>Имя руководителя</label>
      <input id="lf-name" type="text" placeholder="Иванов Иван" value="${name}"></div>
    <div class="form-group"><label>Процент (%)</label>
      <input id="lf-pct" type="number" min="0" max="100" value="${pct||10}"></div>
    <button class="btn btn-primary btn-full" onclick="doSaveLeaderFee('${groupId}')">Сохранить</button>
    ${name?`<button class="btn btn-full btn-danger" style="margin-top:8px" onclick="doSaveLeaderFee('${groupId}',true)">Удалить руководителя</button>`:''}
  </div>`;
  document.body.appendChild(m);
}
async function doSaveLeaderFee(groupId, remove=false) {
  const name = remove ? null : document.getElementById('lf-name')?.value.trim()||null;
  const pct  = remove ? 0   : parseInt(document.getElementById('lf-pct')?.value)||0;
  try {
    await sb().from('trainer_groups')
      .update({leader_name: name, leader_fee_percent: pct})
      .eq('id', groupId);
    document.querySelector('.modal-overlay')?.remove();
    toast(remove?'Руководитель удалён':'Сохранено ✅','success');
    // Перезагрузить текущий отчёт
    const ms = new Date().toISOString().slice(0,7)+'-01';
    renderGroupMonthReport(groupId, ms);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doExportGroupPayroll(groupId, monthStr) {
  if (window.Telegram?.WebApp?.initData) {
    const m=el('div','modal-overlay');
    m.innerHTML=`<div class="modal"><div class="modal-header"><h3>Скачать ЗП</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <p style="line-height:1.6">Откройте приложение в браузере для скачивания файла.</p>
      <button class="btn btn-primary btn-full" onclick="openInBrowser(APP_URL+'?tgid='+STATE.tgId);this.closest('.modal-overlay').remove()">Открыть в браузере</button>
    </div>`;
    document.body.appendChild(m); return;
  }
  await ensureXlsx();
  try {
    const report = await DB.getGroupMonthReport(groupId, monthStr);
    const {clients, payments, attendance, payouts, trainers, instanceSessions, substitutions, groupTypeInfo} = report;
    const activeCount   = clients.filter(c=>c.is_active!==false).length;
    const pricePerChild = groupTypeInfo?.price_per_month || 0;
    const isArtSwim     = groupTypeInfo?.name?.toLowerCase().includes('art');
    // Только утверждённые замены — как в отчёте на экране
    const approvedSubs  = (substitutions || []).filter(s=>s.status==='approved');
    const rateHistory   = await DB.getRateHistory(trainers.map(t=>t.id), monthStr);

    // Та же ЕДИНАЯ формула, что и в отчёте на экране — calcChildGroupPayroll (db.js)
    const calc = calcChildGroupPayroll({
      payments, trainers, instanceSessions, substitutions: approvedSubs,
      rateHistory, adjustments: payouts, monthStr, isArtSwim, attendance,
    });
    const rows = calc.rows.map(r=>({fio:r.fio, role:r.role, note:r.calcNote,
      autoAmt:r.autoAmt, bonus:r.bonus, penalty:r.penalty, final:r.final}));

    exportGroupPayrollExcel(groupTypeInfo?.name||'Группа', monthStr, calc.totalRevenue,
      activeCount, pricePerChild, rows, calc.leaderName, calc.leaderPct, calc.leaderFee);
  } catch(e) { toast('Ошибка: '+(e?.message||String(e)),'error'); console.error(e); }
}

// Конец ГРУППОВОГО абонемента = ровно 30 дней с начала включительно (купил 2.06 → закрывается 1.07).
// Не путать с calcSubEnd(start, qty) из config.js — та для пакетов ПТ.
function calcGroupSubEnd(startStr) {
  const [y,m,d] = startStr.split('-').map(Number);
  const end = new Date(y, m-1, d + 29);
  return `${end.getFullYear()}-${String(end.getMonth()+1).padStart(2,'0')}-${String(end.getDate()).padStart(2,'0')}`;
}
function syncGroupSubEnd() {
  const start = document.getElementById('gp-sub-start')?.value;
  const endInp = document.getElementById('gp-sub-end');
  if (start && endInp) endInp.value = calcGroupSubEnd(start);
}
function prevMonthStr(monthStr) {
  const d = new Date(monthStr); d.setMonth(d.getMonth()-1);
  return d.toISOString().slice(0,7)+'-01';
}
function nextMonthStr(monthStr) {
  const d = new Date(monthStr); d.setMonth(d.getMonth()+1);
  return d.toISOString().slice(0,7)+'-01';
}
function updateGroupPayoutTotal(trainerId, autoAmt) {
  const bonus   = parseInt(document.getElementById(`bonus-${trainerId}`)?.value)||0;
  const penalty = parseInt(document.getElementById(`penalty-${trainerId}`)?.value)||0;
  const el = document.getElementById(`gtotal-${trainerId}`);
  if (el) el.textContent = fmt(autoAmt + bonus - penalty) + ' сум';
}
// Сохранение премии/штрафа к авто-расчёту. ЗП считается полностью авто (calcChildGroupPayroll);
// payout_value пишется = итог только для аудита и нигде не читается.
// Замены НЕ входят в итог — они выплачиваются отдельной строкой (groupSubSum в calcSalary).
async function doSaveGroupAdjustment(tgId, trainerId, monthStr, autoAmt, groupId) {
  const bonus   = parseInt(document.getElementById(`bonus-${trainerId}`)?.value)||0;
  const penalty = parseInt(document.getElementById(`penalty-${trainerId}`)?.value)||0;
  const final   = autoAmt + bonus - penalty;
  const note    = `авто ${fmt(autoAmt)}${bonus?` + премия ${fmt(bonus)}`:''}${penalty?` − штраф ${fmt(penalty)}`:''} (замены отдельной строкой)`;
  if (_pending.has(`payout_${tgId}_${trainerId}`)) return;
  _pending.add(`payout_${tgId}_${trainerId}`);
  try {
    await DB.saveGroupAdjustment(parseInt(tgId), parseInt(trainerId), monthStr, bonus, penalty, final, STATE.profile.id, note);
    DB.auditLog('group_payout', STATE.profile.id, STATE.profile.fio, trainerId, 'group_adjustment',
      { group_id: tgId, month: monthStr, bonus, penalty, amount: final, note }, STATE.profile.branches?.[0]);
    toast('Премия/штраф сохранены ✅','success');
    renderGroupMonthReport(groupId||tgId, monthStr);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(`payout_${tgId}_${trainerId}`); }
}
async function editSubRate(subId, currentRate, groupId, monthStr) {
  const canEdit = ['admin','senior_trainer'].includes(STATE.profile.role);
  if (!canEdit) return;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Ставка замены</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Ставка (сум)</label>
      <input id="sub-rate-inp" type="number" value="${currentRate}" min="0"></div>
    <button class="btn btn-primary btn-full" onclick="doSaveSubRate('${subId}','${groupId}','${monthStr}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveSubRate(subId, groupId, monthStr) {
  const rate = parseInt(document.getElementById('sub-rate-inp')?.value)||75000;
  try {
    await DB.updateGroupSubstitutionRate(subId, rate);
    document.querySelector('.modal-overlay')?.remove();
    toast('Ставка обновлена ✅','success');
    renderGroupMonthReport(groupId, monthStr);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
// Модал «Ставки за месяц» (ручное утверждение payout_value) удалён:
// ЗП детских групп считается полностью авто, ставки тренеров правятся в меню тренера группы.

// ── УТВЕРЖДЕНИЕ ЗАМЕН ─────────────────────────────────────────
async function renderSubstitutionsApproval() {
  const isAdmin = ['admin','ceo'].includes(STATE.profile.role);
  const branches = STATE.profile.branches||[];
  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth()+1;

  const render = async ()=>{
    const monthStr = `${year}-${String(month).padStart(2,'0')}-01`;
    const [groupSubs, ptSubs] = await Promise.all([
      DB.getGroupSubstitutionsForMonth(branches[0]||'', year, month).catch(()=>[]),
      DB.getPTSubstitutionsForMonth(branches[0]||'', year, month).catch(()=>[]),
    ]);
    document.getElementById('subs-body').innerHTML = `
      <!-- Групповые замены -->
      <h4 style="margin-bottom:8px">Групповые замены</h4>
      ${!groupSubs.length?'<p class="hint">Нет замен за период</p>':
        groupSubs.map(s=>`<div class="staff-card" style="flex-direction:column;gap:8px">
          <div>
            <div class="staff-fio">${s.substitute?.fio||'?'} <span class="hint" style="font-weight:400">вместо ${s.original?.fio||'?'}</span></div>
            <div class="staff-meta">${s.trainer_groups?.group_types?.name||'Группа'} · ${fmtDate(s.session_date)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input id="gsub-rate-${s.id}" type="number" value="${s.rate||''}" placeholder="Ставка (сум)"
              style="width:140px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);font-size:13px">
            <span style="font-size:12px;padding:3px 10px;border-radius:10px;
              background:${s.status==='approved'?'rgba(16,185,129,.15)':'rgba(245,158,11,.15)'};
              color:${s.status==='approved'?'#10b981':'#f59e0b'}">${s.status==='approved'?'✓ Утверждено':'Ожидает'}</span>
            ${s.status!=='approved'?`<button class="btn btn-sm btn-primary"
              onclick="doApproveGroupSub('${s.id}')">Утвердить</button>`:''}
          </div>
        </div>`).join('')}

      <!-- ПТ-замены -->
      <h4 style="margin-top:20px;margin-bottom:8px">ПТ-замены</h4>
      ${!ptSubs.length?'<p class="hint">Нет ПТ-замен за период</p>':
        ptSubs.map(s=>`<div class="staff-card" style="flex-direction:column;gap:8px">
          <div>
            <div class="staff-fio">${s.profiles?.fio||'?'} <span class="hint" style="font-weight:400">вместо ${s.sub_profile?.fio||'?'}</span></div>
            <div class="staff-meta">${s.clients?.fio||'?'} · ${fmtDT(s.workout_date)}</div>
          </div>
          <div style="display:flex;gap:8px;align-items:center;flex-wrap:wrap">
            <input id="ptsub-rate-${s.id}" type="number" value="${s.substitute_rate||''}" placeholder="Ставка (сум)"
              style="width:140px;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);font-size:13px">
            <span style="font-size:12px;padding:3px 10px;border-radius:10px;
              background:${s.substitute_rate?'rgba(16,185,129,.15)':'rgba(245,158,11,.15)'};
              color:${s.substitute_rate?'#10b981':'#f59e0b'}">${s.substitute_rate?'✓ '+fmt(s.substitute_rate)+' сум':'Ожидает'}</span>
            ${!s.substitute_rate?`<button class="btn btn-sm btn-primary"
              onclick="doApprovePTSub('${s.id}')">Утвердить</button>`:''}
          </div>
        </div>`).join('')}
    `;
  };

  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header">
      <h3>Утверждение замен</h3>
      <div class="month-nav">
        <button id="sub-prev">‹</button>
        <span id="sub-month">${fmtMY(year,month)}</span>
        <button id="sub-next">›</button>
      </div>
    </div>
    <div id="subs-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  document.getElementById('sub-prev')?.addEventListener('click',()=>{
    if(month===1){year--;month=12;}else month--;
    document.getElementById('sub-month').textContent=fmtMY(year,month); render();
  });
  document.getElementById('sub-next')?.addEventListener('click',()=>{
    if(month===12){year++;month=1;}else month++;
    document.getElementById('sub-month').textContent=fmtMY(year,month); render();
  });
  await render();
}
async function doApproveGroupSub(subId) {
  if (_pending.has('gsub_'+subId)) return;
  _pending.add('gsub_'+subId);
  const rate = parseFloat(document.getElementById(`gsub-rate-${subId}`)?.value||0);
  if (!rate) { _pending.delete('gsub_'+subId); return toast('Введите ставку','error'); }
  try {
    await DB.approveSubstitution(subId, rate);
    toast('Замена утверждена ✅','success');
    document.getElementById(`gsub-rate-${subId}`)?.closest('.staff-card')
      ?.querySelector('span[style*="f59e0b"]')
      ?.setAttribute('style','font-size:12px;padding:3px 10px;border-radius:10px;background:rgba(16,185,129,.15);color:#10b981');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('gsub_'+subId); }
}
async function doApprovePTSub(workoutId) {
  if (_pending.has('ptsub_'+workoutId)) return;
  _pending.add('ptsub_'+workoutId);
  const rate = parseFloat(document.getElementById(`ptsub-rate-${workoutId}`)?.value||0);
  if (!rate) { _pending.delete('ptsub_'+workoutId); return toast('Введите ставку','error'); }
  try {
    await DB.setPTSubstituteRate(workoutId, rate);
    toast('Ставка выставлена ✅','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('ptsub_'+workoutId); }
}

function onRateTypeChange(sel) {
  const label = document.getElementById('ag-rate-label');
  const input = document.getElementById('ag-rate-value');
  if (sel.value==='percent') {
    if (label) label.textContent='Процент (%)';
    if (input) { input.value=40; input.placeholder='40'; }
  } else {
    if (label) label.textContent='Сумма (сум)';
    if (input) { input.value=60000; input.placeholder='60000'; }
  }
}
// ─ ADMIN: КОНТРОЛЬ
// ============================================================
// SECTION: ADMIN:CONTROL — renderAdminControl, audit log, сессии, конспекты, поздние запросы
// ============================================================
async function renderAdminControl() {
  $('#tab-content').innerHTML=`<div class="tab-pad"><h3>Контроль</h3>
    <div class="center-screen"><div class="spinner"></div></div></div>`;
  try {
    const data=await DB.getControlData();
    const now=new Date(); const y=now.getFullYear(),mo=now.getMonth()+1;
    const from=new Date(y,mo-1,1).toISOString(),to=new Date(y,mo,1).toISOString();
    const {data:activeIds}=await sb().from('workouts').select('trainer_id').gte('workout_date',from).lt('workout_date',to);
    const activeSet=new Set((activeIds||[]).map(x=>x.trainer_id));
    const inactive=data.inactiveTrainers.filter(t=>!activeSet.has(t.id));
    // Загружаем статистику активности тренеров
    const activityStats = await DB.getTrainersActivityStats(y, mo).catch(()=>[]);
    // Пробные тренировки за месяц
    const allTrials = await DB.getAllTrialSessions(y, mo, null).catch(()=>[]);
    const sections=[];
    if (data.expiringClients.length) sections.push(`<div class="control-section">
      <div class="control-title warn">⚠️ Абонементы истекают (${data.expiringClients.length})</div>
      ${data.expiringClients.map(c=>`<div class="control-item">
        <div class="ci-main">${c.fio} <span class="hint">→ ${c.profiles?.fio||'?'}</span></div>
        <div class="ci-sub">Истекает: ${c.subscription_end} (${daysUntil(c.subscription_end)} дн.)</div>
      </div>`).join('')}</div>`);
    if (data.oldDebt.length) sections.push(`<div class="control-section">
      <div class="control-title danger">❗ Долг > 3 дней (${data.oldDebt.length})</div>
      ${data.oldDebt.map(w=>`<div class="control-item">
        <div class="ci-main">${w.clients?.fio||'?'} ← ${w.profiles?.fio||'?'}</div>
        <div class="ci-sub">${fmtDate(w.workout_date)}</div>
      </div>`).join('')}</div>`);
    if (data.childDropinAbuse.length) sections.push(`<div class="control-section">
      <div class="control-title danger">🚫 Дети с повторным разовым (${data.childDropinAbuse.length})</div>
      ${data.childDropinAbuse.map(c=>`<div class="control-item">
        <div class="ci-main">${c.fio} (${c.age} лет)</div>
        <div class="ci-sub">${c.profiles?.fio||'?'}</div>
      </div>`).join('')}</div>`);
    if (data.suspiciousBatch.length) sections.push(`<div class="control-section">
      <div class="control-title warn">🔍 Подозрительные пакетные</div>
      ${data.suspiciousBatch.map(x=>`<div class="control-item">
        <div class="ci-main">${x.rec.profiles?.fio||'?'}</div>
        <div class="ci-sub">«${x.rec.notes}» — ${x.count} ПТ · ${fmtDate(x.rec.workout_date)}</div>
      </div>`).join('')}</div>`);
    if (inactive.length) sections.push(`<div class="control-section">
      <div class="control-title hint-title">💤 Нет активности (${inactive.length})</div>
      ${inactive.map(t=>`<div class="control-item">
        <div class="ci-main">${t.fio}</div>
        <div class="ci-sub">${(t.branches||[]).join(', ')}</div>
      </div>`).join('')}</div>`);
    // Запросы на поздние тренировки
    const lateRequests = await DB.getPendingLateRequests(null).catch(()=>[]);
    if (lateRequests.length) sections.unshift(`<div class="control-section">
      <div class="control-title danger">⏰ Запросы на поздние тренировки (${lateRequests.length})</div>
      ${lateRequests.map(r=>`<div class="control-item">
        <div class="ci-main"><b>${r.clients?.fio||'?'}</b> · кат.${r.category} · ${r.profiles?.fio||'?'}</div>
        <div class="ci-sub">📅 ${fmtDT(r.workout_date)} · ${r.branch}</div>
        <div class="ci-sub" style="margin-top:4px;color:var(--text)">💬 ${r.reason}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-sm btn-primary" onclick="doApproveLateRequest(${r.id})">✓ Одобрить</button>
          <button class="btn btn-sm btn-danger" onclick="doRejectLateRequest(${r.id})">✗ Отклонить</button>
        </div>
      </div>`).join('')}
    </div>`);

    // Пробные тренировки — алерт если >5 у одного тренера
    if (allTrials.length) {
      const trialByTrainer = {};
      allTrials.forEach(t=>{
        const fio = t.profiles?.fio||'?';
        if (!trialByTrainer[fio]) trialByTrainer[fio]=[];
        trialByTrainer[fio].push(t);
      });
      const heavy = Object.entries(trialByTrainer).filter(([,arr])=>arr.length>=5);
      if (heavy.length) {
        sections.push(`<div class="control-section">
          <div class="control-title warn">🆕 Много пробных (${heavy.map(([f,a])=>f+': '+a.length).join(', ')})</div>
          ${heavy.map(([fio,arr])=>`<div class="control-item">
            <div class="ci-main">${fio} — <b>${arr.length}</b> пробных за месяц</div>
            <div class="ci-sub">${arr.slice(0,3).map(t=>`${t.first_name}${t.last_name?' '+t.last_name:''}`).join(', ')}${arr.length>3?` и ещё ${arr.length-3}`:''}</div>
          </div>`).join('')}
        </div>`);
      }
      // Все пробные — информационный блок
      sections.push(`<div class="control-section">
        <div class="control-title" style="background:rgba(139,92,246,.15);color:#7c3aed">🆕 Пробные за месяц (${allTrials.length})</div>
        ${allTrials.map(t=>`<div class="control-item">
          <div class="ci-main">${t.first_name}${t.last_name?' '+t.last_name:''} · Кат.${t.category}${t.phone?' · '+t.phone:''}</div>
          <div class="ci-sub">${t.profiles?.fio||'?'} · ${fmtDate(t.session_date)}</div>
        </div>`).join('')}
      </div>`);
    }

    // Блок активности тренеров
    if (activityStats.length) {
      const withProblems = activityStats.filter(t=>t.overdueNotes>0||t.monthWorkouts===0);
      const allSorted = [...activityStats].sort((a,b)=>b.overdueNotes-a.overdueNotes||b.monthWorkouts-a.monthWorkouts);
      const daysSince = (dateStr) => {
        if (!dateStr) return '∞';
        const d = Math.floor((Date.now()-new Date(dateStr))/(86400000));
        return d===0?'сегодня':d===1?'вчера':`${d} дн. назад`;
      };
      sections.push(`<div class="control-section">
        <div class="control-title" style="background:rgba(99,102,241,.15);color:#6366f1">📋 Активность тренеров (${new Date(y,mo-1).toLocaleString('ru-RU',{month:'long'})})</div>
        ${allSorted.map(t=>{
          const hasIssue = t.overdueNotes>0||t.monthWorkouts===0;
          const borderColor = t.overdueNotes>0?'var(--danger)':t.monthWorkouts===0?'var(--warn)':'var(--success)';
          return `<div class="control-item" style="border-left:3px solid ${borderColor}">
            <div class="ci-main" style="display:flex;justify-content:space-between;align-items:center">
              <span>${t.fio}</span>
              <div style="display:flex;gap:6px;font-size:12px">
                ${t.overdueNotes>0?`<span style="background:rgba(239,68,68,.15);color:var(--danger);padding:2px 6px;border-radius:8px">⚠️ ${t.overdueNotes} конспект${t.overdueNotes>1?'ов':''}</span>`:''}
                <span style="background:rgba(59,130,246,.1);color:#3b82f6;padding:2px 6px;border-radius:8px">${t.monthWorkouts} ПТ</span>
              </div>
            </div>
            <div class="ci-sub">${(t.branches||[]).join(', ')} · последняя ПТ: ${daysSince(t.lastWorkout)}${!t.tg_id?' · ⏳ не входил':''}</div>
          </div>`;
        }).join('')}
      </div>`);
    }
    // Запросы на удаление ПТ
    const workoutDelReqs = await DB.getAllWorkoutDeleteRequests().catch(()=>[]);
    if (workoutDelReqs.length) sections.unshift(`<div class="control-section">
      <div class="control-title danger">🗑 Запросы на удаление ПТ (${workoutDelReqs.length})</div>
      ${workoutDelReqs.map(r=>`<div class="control-item">
        <div class="ci-main">${r.client_name||'—'} · ${fmtDate(r.workout_date)}</div>
        <div class="ci-sub">Тренер: ${r.profiles?.fio||'?'} · ${r.branch||''}</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="btn btn-sm btn-danger" onclick="doApproveWorkoutDelete('${r.id}','${r.workout_id}')">Удалить</button>
          <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
            onclick="doRejectWorkoutDelete('${r.id}')">Отклонить</button>
        </div>
      </div>`).join('')}
    </div>`);
    // Add delete requests
    const deleteReqs = await DB.getAllDeleteRequests().catch(()=>[]);
    if (deleteReqs.length) sections.unshift(`<div class="control-section">
      <div class="control-title danger">🗑 Запросы на удаление (${deleteReqs.length})</div>
      ${deleteReqs.map(r=>`<div class="control-item">
        <div class="ci-main">${r.client_name} <span class="hint">← ${r.profiles?.fio||'?'}</span></div>
        <div class="ci-sub" style="font-size:11px;color:var(--text-secondary)">
          Запрос: ${fmtDate(r.created_at)}${r.clients?.balance!=null?' · Баланс: '+r.clients.balance:''}${r.clients?.subscription_end?' · Абон до: '+fmtDate(r.clients.subscription_end):''}
        </div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="btn btn-sm btn-danger" onclick="doApproveDelete('${r.id}','${r.client_id}','${encodeURIComponent(r.client_name||'')}')">Удалить</button>
          <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
            onclick="doRejectDelete('${r.id}')">Отклонить</button>
        </div>
      </div>`).join('')}
    </div>`);
    // Последние входы в систему
    const sessions = await DB.getRecentSessions(30).catch(()=>[]);
    if (sessions.length) {
      const rows = sessions.map(s=>{
        const dt = new Date(s.opened_at);
        const dtStr = dt.toLocaleString('ru-RU',{day:'2-digit',month:'2-digit',hour:'2-digit',minute:'2-digit'});
        const deviceIcon = s.device==='iOS'?'🍎':s.device==='Android'?'🤖':s.device==='Desktop'?'💻':'📱';
        return `<div class="control-item">
          <div class="ci-main">${s.fio||s.tg_id} <span class="hint">${s.role||''}</span></div>
          <div class="ci-sub">${deviceIcon} ${s.device} · v${s.js_version||'?'} · ${dtStr}</div>
        </div>`;
      }).join('');
      sections.push(`<div class="control-section">
        <div class="control-title" style="background:rgba(16,185,129,.12);color:#10b981">🟢 Входы за последние 30 дней (${sessions.length})</div>
        ${rows}
      </div>`);
    }
    $('#tab-content').innerHTML=`<div class="tab-pad">
      <h3>Контроль</h3><p class="hint" style="margin-bottom:16px">На ${todayStr()}</p>
      ${sections.length?sections.join(''):'<div class="empty-state">✅<p>Проблем не обнаружено</p></div>'}
    </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
// ─── ТЕХНИЧКА ────────────────────────────────────────────────────────────────

const TECH_SECTIONS = ['chlorine','plans','equipment','issues','shopping','bills'];
const TECH_LABELS   = {chlorine:'Хлор', plans:'Планы', equipment:'Оборудование', issues:'Поломки', shopping:'Закупки', bills:'Счета'};
const TECH_ICONS    = {chlorine:'🧪', plans:'📋', equipment:'🔩', issues:'🔴', shopping:'🛒', bills:'💳'};
const EQUIP_CATS    = ['Насосы','Фильтры','Нагреватели','Дорожки','Инвентарь','Электрика','Прочее'];
const EQUIP_STATUS  = {ok:'✅ Исправно', broken:'🔴 Сломано', maintenance:'🟡 Обслуживание'};
const PRIORITY_LBL  = {urgent:'🔴 Срочно', normal:'🟡 Обычный', low:'⚪ Низкий'};
const ISSUE_STATUS  = {open:'Открыта', in_progress:'В работе', resolved:'Решена'};
const BILL_CATS     = ['Химия','Электричество','Вода','Ремонт','Инвентарь','Прочее'];

let _techBranch = '';
let _techSection = 'chlorine';

// ============================================================
// SECTION: ADMIN:TECH — renderAdminTech, оборудование, счета, закупки, хлор, планы
// ============================================================
async function renderAdminTech() {
  const allBranches = await cached('branches',()=>DB.getBranches());
  const branches = allBranches.map(b=>b.name);
  // '' = все филиалы, по умолчанию показываем все
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>⚙️ Операционка</h3>
      <span class="hint">${_techBranch||'Все филиалы'}</span></div>
    <div class="form-group">
      <select id="tech-branch" onchange="_techBranch=this.value;loadTechSection()">
        <option value="" ${_techBranch===''?'selected':''}>Все филиалы</option>
        ${branches.map(b=>`<option value="${b}" ${b===_techBranch?'selected':''}>${b}</option>`).join('')}
      </select></div>
    <div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:16px">
      ${TECH_SECTIONS.map(s=>`<button class="btn btn-sm ${s===_techSection?'btn-primary':''}"
        onclick="_techSection='${s}';renderAdminTech()">
        ${TECH_ICONS[s]} ${TECH_LABELS[s]}</button>`).join('')}
    </div>
    <div id="tech-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  await loadTechSection();
}

async function loadTechSection() {
  const body = document.getElementById('tech-body'); if (!body) return;
  const branch = document.getElementById('tech-branch')?.value || _techBranch;
  _techBranch = branch;
  try {
    if (_techSection==='chlorine')  await renderTechChlorine(body, branch);
    if (_techSection==='plans')     await renderTechPlans(body, branch);
    if (_techSection==='equipment') await renderTechEquipment(body, branch);
    if (_techSection==='issues')    await renderTechIssues(body, branch);
    if (_techSection==='shopping')  await renderTechShopping(body, branch);
    if (_techSection==='bills')     await renderTechBills(body, branch);
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// ── ОБОРУДОВАНИЕ ─────────────────────────────
async function renderTechEquipment(body, branch) {
  const items = await DB.getTechEquipment(branch);
  const bycat = {};
  EQUIP_CATS.forEach(c=>bycat[c]=[]);
  items.forEach(i=>{ if(bycat[i.category]) bycat[i.category].push(i); else bycat['Прочее'].push(i); });
  body.innerHTML=`
    <button class="btn btn-sm btn-primary" style="margin-bottom:12px;width:100%"
      onclick="renderAddEquipmentModal('${branch}')">+ Добавить оборудование</button>
    ${EQUIP_CATS.map(cat=>!bycat[cat]?.length?'':
      `<div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:12px;color:var(--hint);margin-bottom:6px">${cat}</div>
        ${bycat[cat].map(eq=>`<div class="staff-card" style="flex-direction:column;gap:4px">
          <div style="display:flex;justify-content:space-between;align-items:center">
            <div>
              <div class="staff-fio">${eq.name}</div>
              <div class="staff-meta">${!branch?eq.branch+' · ':''}${EQUIP_STATUS[eq.status]||eq.status}
                ${eq.next_service?` · ТО: ${eq.next_service}`:''}</div>
            </div>
            <div style="display:flex;gap:6px">
              <select style="font-size:11px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px"
                onchange="updateEquipStatus('${eq.id}',this.value)">
                ${Object.entries(EQUIP_STATUS).map(([v,l])=>`<option value="${v}" ${eq.status===v?'selected':''}>${l}</option>`).join('')}
              </select>
              <button class="btn btn-sm btn-danger" onclick="deleteTechItem('equipment','${eq.id}')">🗑</button>
            </div>
          </div>
          ${eq.notes?`<div style="font-size:11px;color:var(--hint)">${eq.notes}</div>`:''}
        </div>`).join('')}
      </div>`).join('')}
    ${!items.length?'<p class="hint">Нет оборудования</p>':''}`;
}

function renderAddEquipmentModal(branch) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить оборудование</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label>
      <input id="eq-name" type="text" placeholder="Насос циркуляционный"></div>
    <div class="form-group"><label>Категория</label>
      <select id="eq-cat">${EQUIP_CATS.map(c=>`<option>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label>Статус</label>
      <select id="eq-status">
        ${Object.entries(EQUIP_STATUS).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select></div>
    <div class="form-group"><label>Следующее ТО</label>
      <input id="eq-service" type="date"></div>
    <div class="form-group"><label>Заметка</label>
      <input id="eq-notes" type="text" placeholder="Необязательно"></div>
    <button class="btn btn-primary btn-full" onclick="doAddEquipment('${branch}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddEquipment(branch) {
  const name = document.getElementById('eq-name')?.value.trim();
  if (!name) return toast('Введите название','error');
  await DB.addTechEquipment({
    branch, name,
    category:    document.getElementById('eq-cat')?.value,
    status:      document.getElementById('eq-status')?.value||'ok',
    next_service:document.getElementById('eq-service')?.value||null,
    notes:       document.getElementById('eq-notes')?.value.trim()||null,
  });
  document.querySelector('.modal-overlay')?.remove();
  toast('Добавлено','success'); loadTechSection();
}
async function updateEquipStatus(id, status) {
  await DB.updateTechEquipment(id,{status}); toast('Обновлено','success');
}

// ── ПОЛОМКИ ──────────────────────────────────
async function renderTechIssues(body, branch) {
  const [issues, equip] = await Promise.all([DB.getTechIssues(branch), DB.getTechEquipment(branch)]);
  body.innerHTML=`
    <button class="btn btn-sm btn-primary" style="margin-bottom:12px;width:100%"
      onclick="renderAddIssueModal('${branch}',${JSON.stringify(equip.map(e=>({id:e.id,name:e.name}))).replace(/"/g,"'")})">
      + Добавить поломку</button>
    ${!issues.length?'<p class="hint">Поломок нет 🎉</p>':issues.map(iss=>`
      <div class="staff-card" style="flex-direction:column;gap:6px">
        <div style="display:flex;justify-content:space-between">
          <div>
            <div class="staff-fio">${iss.description}</div>
            <div class="staff-meta">${PRIORITY_LBL[iss.priority]||iss.priority}
              ${iss.tech_equipment?.name?' · '+iss.tech_equipment.name:''}</div>
          </div>
          <select style="font-size:11px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px"
            onchange="updateIssueStatus('${iss.id}',this.value)">
            ${Object.entries(ISSUE_STATUS).map(([v,l])=>`<option value="${v}" ${iss.status===v?'selected':''}>${l}</option>`).join('')}
          </select>
        </div>
      </div>`).join('')}`;
}
function renderAddIssueModal(branch, equip) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить поломку</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Описание</label>
      <input id="iss-desc" type="text" placeholder="Что сломалось"></div>
    <div class="form-group"><label>Оборудование</label>
      <select id="iss-eq">
        <option value="">— не привязывать —</option>
        ${equip.map(e=>`<option value="${e.id}">${e.name}</option>`).join('')}
      </select></div>
    <div class="form-group"><label>Приоритет</label>
      <select id="iss-pri">
        ${Object.entries(PRIORITY_LBL).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select></div>
    <button class="btn btn-primary btn-full" onclick="doAddIssue('${branch}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddIssue(branch) {
  const desc = document.getElementById('iss-desc')?.value.trim();
  if (!desc) return toast('Введите описание','error');
  await DB.addTechIssue({
    branch, description:desc,
    equipment_id: document.getElementById('iss-eq')?.value||null,
    priority:     document.getElementById('iss-pri')?.value||'normal',
    status:'open',
  });
  document.querySelector('.modal-overlay')?.remove();
  toast('Добавлено','success'); loadTechSection();
}
async function updateIssueStatus(id, status) {
  const fields = {status};
  if (status==='resolved') fields.resolved_at = new Date().toISOString();
  await DB.updateTechIssue(id, fields); toast('Обновлено','success'); loadTechSection();
}

// ── ЗАКУПКИ ──────────────────────────────────
async function renderTechShopping(body, branch) {
  const items = await DB.getTechShopping(branch);
  const STATUS = {pending:'⏳ Ожидает', ordered:'📦 Заказано', received:'✅ Получено'};
  body.innerHTML=`
    <button class="btn btn-sm btn-primary" style="margin-bottom:12px;width:100%"
      onclick="renderAddShoppingModal('${branch}')">+ Добавить</button>
    ${!items.length?'<p class="hint">Список пуст</p>':items.map(it=>`
      <div class="staff-card" style="flex-direction:column;gap:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="staff-fio">${it.name}</div>
            <div class="staff-meta">${PRIORITY_LBL[it.priority]}
              ${it.quantity?' · '+it.quantity:''}
              ${it.price?` · ${fmt(it.price)} сум`:''}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <select style="font-size:11px;background:var(--card);border:1px solid var(--border);border-radius:6px;color:var(--text);padding:3px"
              onchange="updateShoppingStatus('${it.id}',this.value)">
              ${Object.entries(STATUS).map(([v,l])=>`<option value="${v}" ${it.status===v?'selected':''}>${l}</option>`).join('')}
            </select>
            <button class="btn btn-sm btn-danger" onclick="deleteTechItem('shopping','${it.id}')">🗑</button>
          </div>
        </div>
      </div>`).join('')}`;
}
function renderAddShoppingModal(branch) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить в закупки</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label>
      <input id="sh-name" type="text" placeholder="Хлор 50 кг"></div>
    <div class="form-group"><label>Количество</label>
      <input id="sh-qty" type="text" placeholder="2 мешка"></div>
    <div class="form-group"><label>Примерная стоимость (сум)</label>
      <input id="sh-price" type="number" placeholder="0"></div>
    <div class="form-group"><label>Приоритет</label>
      <select id="sh-pri">
        ${Object.entries(PRIORITY_LBL).map(([v,l])=>`<option value="${v}">${l}</option>`).join('')}
      </select></div>
    <button class="btn btn-primary btn-full" onclick="doAddShopping('${branch}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddShopping(branch) {
  const name = document.getElementById('sh-name')?.value.trim();
  if (!name) return toast('Введите название','error');
  await DB.addTechShopping({
    branch, name,
    quantity: document.getElementById('sh-qty')?.value.trim()||null,
    price:    parseFloat(document.getElementById('sh-price')?.value)||0,
    priority: document.getElementById('sh-pri')?.value||'normal',
  });
  document.querySelector('.modal-overlay')?.remove();
  toast('Добавлено','success'); loadTechSection();
}
async function updateShoppingStatus(id, status) {
  await DB.updateTechShopping(id,{status}); toast('Обновлено','success'); loadTechSection();
}

// ── СЧЕТА ─────────────────────────────────────
async function renderTechBills(body, branch) {
  const bills = await DB.getTechBills(branch);
  const unpaidTotal = bills.filter(b=>!b.paid).reduce((s,b)=>s+b.amount,0);
  body.innerHTML=`
    <button class="btn btn-sm btn-primary" style="margin-bottom:8px;width:100%"
      onclick="renderAddBillModal('${branch}')">+ Добавить счёт</button>
    ${unpaidTotal>0?`<div class="warn-banner" style="margin-bottom:12px">
      💳 Неоплачено: ${fmt(Math.round(unpaidTotal))} сум</div>`:''}
    ${!bills.length?'<p class="hint">Счетов нет</p>':bills.map(b=>`
      <div class="staff-card" style="flex-direction:column;gap:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="staff-fio">${b.category}${b.description?' — '+b.description:''}</div>
            <div class="staff-meta">${!branch?b.branch+' · ':''}${fmt(b.amount)} сум · ${b.bill_date}</div>
          </div>
          <div style="display:flex;gap:6px;align-items:center">
            <span style="font-size:11px;padding:3px 8px;border-radius:12px;
              background:${b.paid?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)'};
              color:${b.paid?'#10b981':'#ef4444'}">
              ${b.paid?'Оплачен':'Не оплачен'}</span>
            <button class="btn btn-sm" style="${b.paid?'background:rgba(239,68,68,.12);color:#ef4444;border:1px solid rgba(239,68,68,.3)':'background:rgba(16,185,129,.12);color:#10b981;border:1px solid rgba(16,185,129,.3)'}"
              onclick="toggleBillPaid('${b.id}',${b.paid})">
              ${b.paid?'✕ Отменить':'✓ Оплачен'}</button>
            <button class="btn btn-sm btn-danger" onclick="deleteTechItem('bills','${b.id}')">🗑</button>
          </div>
        </div>
      </div>`).join('')}`;
}
function renderAddBillModal(branch) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить счёт</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Категория</label>
      <select id="bill-cat">${BILL_CATS.map(c=>`<option>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label>Описание</label>
      <input id="bill-desc" type="text" placeholder="Необязательно"></div>
    <div class="form-group"><label>Сумма (сум)</label>
      <input id="bill-amount" type="number" placeholder="0"></div>
    <div class="form-group"><label>Дата</label>
      <input id="bill-date" type="date" value="${todayStr()}"></div>
    <button class="btn btn-primary btn-full" onclick="doAddBill('${branch}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddBill(branch) {
  const amount = parseFloat(document.getElementById('bill-amount')?.value)||0;
  if (!amount) return toast('Введите сумму','error');
  await DB.addTechBill({
    branch,
    category:    document.getElementById('bill-cat')?.value,
    description: document.getElementById('bill-desc')?.value.trim()||null,
    amount,
    bill_date:   document.getElementById('bill-date')?.value||todayStr(),
  });
  document.querySelector('.modal-overlay')?.remove();
  toast('Добавлено','success'); loadTechSection();
}
async function toggleBillPaid(id, currentPaid) {
  await DB.updateTechBill(id,{
    paid: !currentPaid,
    paid_at: !currentPaid ? new Date().toISOString() : null
  });
  toast('Обновлено','success'); loadTechSection();
}

// ── ХЛОР ──────────────────────────────────────
async function renderTechChlorine(body, branch) {
  let q = sb().from('chlorine_orders').select('*').order('order_date',{ascending:false});
  if (branch) q = q.eq('branch',branch);
  const {data:orders} = await q;
  const totalKg   = (orders||[]).reduce((s,o)=>s+Number(o.quantity_kg),0);
  const totalSum  = (orders||[]).reduce((s,o)=>s+Number(o.price_total),0);
  body.innerHTML=`
    <button class="btn btn-sm btn-primary" style="margin-bottom:12px;width:100%"
      onclick="renderAddChlorineModal('${branch}')">+ Добавить закуп</button>
    <div class="summary-cards" style="margin-bottom:16px">
      <div class="summary-card"><div class="s-val">${totalKg.toFixed(1)}</div><div class="s-lbl">кг всего</div></div>
      <div class="summary-card"><div class="s-val" style="font-size:14px">${fmt(Math.round(totalSum))}</div><div class="s-lbl">потрачено</div></div>
    </div>
    ${!(orders||[]).length?'<p class="hint">Закупов нет</p>':(orders||[]).map(o=>`
      <div class="staff-card" style="flex-direction:column;gap:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <div class="staff-fio">${o.quantity_kg} кг · ${fmt(o.price_total)} сум</div>
            <div class="staff-meta">${fmtDate(o.order_date)}${!branch?' · '+o.branch:''}${o.supplier?' · '+o.supplier:''}${o.note?' · '+o.note:''}</div>
          </div>
          <button class="btn btn-sm btn-danger" onclick="deleteChlorineOrder(${o.id})">🗑</button>
        </div>
      </div>`).join('')}`;
}
function renderAddChlorineModal(branch) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🧪 Закуп хлора</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дата</label>
      <input type="date" id="chl-date" value="${todayStr()}"></div>
    <div class="form-group"><label>Количество (кг)</label>
      <input type="number" id="chl-qty" min="0.1" step="0.1" placeholder="50"></div>
    <div class="form-group"><label>Сумма (сум)</label>
      <input type="number" id="chl-sum" placeholder="500000"></div>
    <div class="form-group"><label>Поставщик</label>
      <input id="chl-sup" placeholder="Название компании"></div>
    <div class="form-group"><label>Примечание</label>
      <input id="chl-note" placeholder=""></div>
    <button class="btn btn-primary btn-full" onclick="doAddChlorine('${branch}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddChlorine(branch) {
  const date = document.getElementById('chl-date')?.value;
  const qty  = parseFloat(document.getElementById('chl-qty')?.value||0);
  const sum  = parseFloat(document.getElementById('chl-sum')?.value||0);
  const sup  = document.getElementById('chl-sup')?.value.trim()||null;
  const note = document.getElementById('chl-note')?.value.trim()||null;
  if (!qty||!sum) return toast('Укажите количество и сумму','error');
  try {
    await sb().from('chlorine_orders').insert({branch,order_date:date,quantity_kg:qty,price_total:sum,supplier:sup,note});
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Добавлено','success'); loadTechSection();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function deleteChlorineOrder(id) {
  if (!confirm('Удалить запись?')) return;
  try { await sb().from('chlorine_orders').delete().eq('id',id); toast('Удалено','success'); loadTechSection(); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}

// ── ПЛАНЫ ─────────────────────────────────────
const PLAN_TYPES = {
  strategy: {label:'Стратегия', icon:'🎯', color:'rgba(124,58,237,.15)', textColor:'#a78bfa'},
  calendar:  {label:'Календарный план', icon:'📅', color:'rgba(59,130,246,.15)', textColor:'#60a5fa'},
  event:     {label:'Ивент', icon:'🏆', color:'rgba(16,185,129,.15)', textColor:'#10b981'},
  task:      {label:'Важная задача', icon:'⚡', color:'rgba(239,68,68,.15)', textColor:'#ef4444'},
};
async function renderTechPlans(body, branch) {
  let pq = sb().from('ops_plans').select('*, profiles!created_by(fio)').neq('status','cancelled').order('due_date',{ascending:true,nullsFirst:false});
  if (branch) pq = pq.or(`branch.is.null,branch.eq.${branch}`);
  const {data:plans} = await pq;
  body.innerHTML=`
    <button class="btn btn-sm btn-primary" style="margin-bottom:12px;width:100%"
      onclick="renderAddPlanModal('${branch}')">+ Добавить</button>
    ${!(plans||[]).length?'<p class="hint">Нет планов</p>':
      Object.keys(PLAN_TYPES).map(type=>{
        const items = (plans||[]).filter(p=>p.plan_type===type);
        if (!items.length) return '';
        const pt = PLAN_TYPES[type];
        return `<div style="margin-bottom:16px">
          <div style="font-weight:700;font-size:13px;margin-bottom:8px">${pt.icon} ${pt.label}</div>
          ${items.map(p=>`<div class="staff-card" style="flex-direction:column;gap:4px;border-left:3px solid ${pt.textColor}">
            <div style="display:flex;justify-content:space-between;align-items:flex-start">
              <div>
                <div class="staff-fio">${p.title}</div>
                ${p.description?`<div class="staff-meta">${p.description}</div>`:''}
                <div class="staff-meta">${p.branch&&!branch?p.branch+' · ':''}${p.due_date?'до '+fmtDate(p.due_date):''}${p.profiles?.fio?' · '+p.profiles.fio:''}</div>
              </div>
              <div style="display:flex;gap:4px">
                ${p.status==='active'?`<button class="btn btn-sm" style="background:rgba(16,185,129,.15);color:#10b981;font-size:11px"
                  onclick="updatePlanStatus(${p.id},'done')">✓</button>`:'<span style="font-size:11px;color:#10b981">✓</span>'}
                <button class="btn btn-sm btn-danger" style="font-size:11px"
                  onclick="updatePlanStatus(${p.id},'cancelled')">✕</button>
              </div>
            </div>
          </div>`).join('')}
        </div>`;
      }).join('')}`;
}
function renderAddPlanModal(branch) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>📋 Новый план</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Тип</label>
      <select id="pl-type">
        ${Object.entries(PLAN_TYPES).map(([k,v])=>`<option value="${k}">${v.icon} ${v.label}</option>`).join('')}
      </select></div>
    <div class="form-group"><label>Название</label>
      <input id="pl-title" placeholder="Описание..."></div>
    <div class="form-group"><label>Подробнее (необязательно)</label>
      <textarea id="pl-desc" rows="2"></textarea></div>
    <div class="form-group"><label>Дата (необязательно)</label>
      <input type="date" id="pl-date"></div>
    <div class="form-group"><label>Филиал</label>
      <select id="pl-branch">
        <option value="">Все филиалы</option>
        <option value="${branch}" selected>${branch}</option>
      </select></div>
    <button class="btn btn-primary btn-full" onclick="doAddPlan()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddPlan() {
  const type  = document.getElementById('pl-type')?.value;
  const title = document.getElementById('pl-title')?.value.trim();
  const desc  = document.getElementById('pl-desc')?.value.trim()||null;
  const date  = document.getElementById('pl-date')?.value||null;
  const branch= document.getElementById('pl-branch')?.value||null;
  if (!title) return toast('Введите название','error');
  try {
    await sb().from('ops_plans').insert({plan_type:type,title,description:desc,due_date:date,branch:branch||null,created_by:STATE.profile.id});
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Добавлено','success'); loadTechSection();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function updatePlanStatus(id, status) {
  try { await sb().from('ops_plans').update({status}).eq('id',id); toast('Обновлено','success'); loadTechSection(); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}

// ── ОБЩЕЕ УДАЛЕНИЕ ────────────────────────────
async function deleteTechItem(type, id) {
  if (!confirm('Удалить?')) return;
  try {
    if (type==='equipment') await DB.deleteTechEquipment(id);
    if (type==='shopping')  await DB.updateTechShopping(id,{status:'received'});
    if (type==='bills')     await DB.updateTechBill(id,{paid:true});
    toast('Удалено','success'); loadTechSection();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
// ══════════════════════════════════════════════════════════════
// СЕО ПАНЕЛЬ
// ══════════════════════════════════════════════════════════════

// ============================================================
// SECTION: CEO — renderCeoApp, renderCeoFinance, renderCeoStats, renderCeoTrainers
// ============================================================
async function renderCeoApp() {
  setupBack(null);
  setScreen(`
    <div class="app-header">
      <div>
        <div class="app-title">👑 AquaDesk</div>
        <div class="app-sub">${STATE.profile.fio} · Топ-менеджмент</div>
      </div>
      <button class="btn-icon" id="notif-bell" onclick="renderInAppNotifications()" style="position:relative">🔔<span id="notif-count" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center"></span></button>
    </div>
    <div id="tab-content" class="tab-content"></div>
    <nav class="bottom-nav">
      <button class="nav-btn" onclick="ceoTab('finance')"><span>💰</span>Финансы</button>
      <button class="nav-btn" onclick="ceoTab('stats')"><span>📊</span>Аналитика</button>
      <button class="nav-btn" onclick="ceoTab('trainers')"><span>🏋️</span>Тренеры</button>
    </nav>`);
  ceoTab('finance');
  setTimeout(checkInAppNotifications, 2000);
}

function ceoTab(tab) {
  const tabs = ['finance','stats','trainers'];
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',tabs[i]===tab));
  if (tab==='finance')  renderCeoFinance();
  if (tab==='stats')    renderCeoStats();
  if (tab==='trainers') renderCeoTrainers();
}

// ЗП всех тренеров за месяц из данных getSummary → [{p, sal}]
function ceoFotRows(data) {
  const {groupSubstitutions=[],ptSubstitutions=[],childAutoByTrainer={}} = data;
  const adjMap={}; (data.adjustments||[]).forEach(a=>{adjMap[a.trainer_id]=a;});
  return (data.profiles||[]).map(p=>({p, sal: calcSalary({
    workouts:[...(data.workouts||[]).filter(w=>w.trainer_id===p.id),
              ...(ptSubstitutions||[]).filter(w=>w.trainer_id===p.id)],
    duties:(data.duties||[]).filter(d=>d.trainer_id===p.id),
    trainerGroups:(data.trainerGroups||[]).filter(tg=>tg.trainer_id===p.id),
    groupSessions:(data.groupSessions||[]).filter(gs=>gs.trainer_id===p.id),
    trialSessions:(data.trialSessions||[]).filter(t=>t.trainer_id===p.id),
    adjustment:adjMap[p.id]||null,
    childAutoSum:childAutoByTrainer[p.id]||0,
    groupSubstitutions, trainerId:p.id,
  })}));
}

// Общие хелперы для расчёта выручки (используются в Finance и Trainers)
const _isPaidPT = w => !w.is_drop_in && (!w.is_debt || w.debt_confirmed_at);
const _wRev     = w => w.is_drop_in ? (PT_PRICES[w.drop_in_category||1]||0) : (PT_PRICES[w.category_at_moment]||0);
const _ptRev    = ws => (ws||[]).filter(_isPaidPT).reduce((s,w)=>s+_wRev(w),0);
const _diRev    = ws => (ws||[]).filter(w=>w.is_drop_in).reduce((s,w)=>s+_wRev(w),0);
const _grRev    = gps => (gps||[]).filter(g=>g.paid).reduce((s,g)=>s+Number(g.amount||0),0);

// Общий шаблон вкладки с переключателем месяца
function _ceoMonthShell(title, bodyId, prevId, nextId, year, month) {
  return `<div class="tab-pad">
    <div class="section-header"><h3>${title}</h3>
      <div class="month-nav">
        <button id="${prevId}">‹</button>
        <span id="${nextId}-lbl">${fmtMY(year,month)}</span>
        <button id="${nextId}">›</button>
      </div>
    </div>
    <div id="${bodyId}"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
}

// Карточка метрики (переиспользуется в Finance и Stats)
function _anCard(icon, label, val, currN, prevN, py, pm, higherIsBetter=true) {
  return `<div class="an-card">
    <div class="an-icon">${icon}</div>
    <div class="an-val">${val}</div>
    <div class="an-label">${label}</div>
    ${prevN?`<div class="an-delta ${pctClass(currN,prevN,higherIsBetter)}">${pct(currN,prevN)} vs ${fmtMY(py,pm)}</div>`:''}
  </div>`;
}

// ── ФИНАНСЫ ───────────────────────────────────
async function renderCeoFinance() {
  let year=new Date().getFullYear(), month=new Date().getMonth()+1;
  $('#tab-content').innerHTML = _ceoMonthShell('💰 Финансы','ceo-fin-body','ceo-fin-prev','ceo-fin-next',year,month);

  const load = async () => {
    const body=document.getElementById('ceo-fin-body'); if (!body) return;
    body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
    try {
      const py=month===1?year-1:year, pm=month===1?12:month-1;
      const [curr, prev, extra, branches] = await Promise.all([
        DB.getSummary(year, month, null),
        DB.getSummary(py, pm, null),
        DB.getCeoAnalytics(year, month),
        cached('branches',()=>DB.getBranches()),
      ]);
      const mShort = v => v>=1000000?(v/1000000).toFixed(1).replace('.0','')+' млн':fmt(Math.round(v));

      const currPtRev=_ptRev(curr.workouts), currDiRev=_diRev(curr.workouts), currGrRev=_grRev(extra.groupPayments);
      const prevPtRev=_ptRev(prev.workouts), prevDiRev=_diRev(prev.workouts), prevGrRev=_grRev(extra.prevGroupPayments);
      const revenue=currPtRev+currDiRev+currGrRev, prevRevenue=prevPtRev+prevDiRev+prevGrRev;

      const fotRows=ceoFotRows(curr);
      const fot=fotRows.reduce((s,r)=>s+r.sal.total,0);
      const prevFot=ceoFotRows(prev).reduce((s,r)=>s+r.sal.total,0);
      const ratio=revenue>0?Math.round(fot/revenue*100):0;
      const prevRatio=prevRevenue>0?Math.round(prevFot/prevRevenue*100):0;

      const activeBase=(extra.clients||[]).filter(c=>c.balance>0);
      const avgCheck=activeBase.length?revenue/activeBase.length:0;

      const revRow=(label,val,prevVal)=>{
        const share=revenue>0?Math.round(val/revenue*100):0;
        return `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span>${label}</span>
            <span><b>${fmt(Math.round(val))}</b> сум
              <span class="hint" style="margin-left:4px">${share}%</span>
              <span class="an-delta ${pctClass(val,prevVal)}" style="margin-left:4px">${pct(val,prevVal)}</span>
            </span>
          </div>
          <div style="height:6px;background:var(--card);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${share}%;background:var(--accent,#7c3aed);border-radius:3px"></div>
          </div>
        </div>`;
      };

      body.innerHTML=`
        <div class="an-grid" style="margin-bottom:8px">
          ${_anCard('📈','Выручка',mShort(revenue),revenue,prevRevenue,py,pm,true)}
          ${_anCard('💸','ФОТ',mShort(fot),fot,prevFot,py,pm,false)}
          ${_anCard('⚖️','ФОТ / Выручка',ratio+'%',ratio,prevRatio,py,pm,false)}
          ${_anCard('🧾','Ср. чек',mShort(avgCheck),Math.round(avgCheck),0,py,pm,true)}
        </div>
        <p class="hint" style="font-size:11px;margin:0 0 14px">
          ПТ — расчётно (проведённые × тариф категории). Группы — фактические оплаты.
          Ср. чек = выручка / ${activeBase.length} активных клиентов.
        </p>

        <div style="margin-bottom:20px">
          ${revRow('🏊 ПТ по абонементам',currPtRev,prevPtRev)}
          ${revRow('🎟 Разовые',currDiRev,prevDiRev)}
          ${revRow('👥 Группы (оплаты)',currGrRev,prevGrRev)}
        </div>

        <h4 style="margin-bottom:10px">По филиалам</h4>
        ${branches.map(b=>{
          const bPT=(curr.workouts||[]).filter(w=>w.branch===b.name&&_isPaidPT(w)).length;
          const bDi=(curr.workouts||[]).filter(w=>w.branch===b.name&&w.is_drop_in).length;
          const bRev=(curr.workouts||[]).filter(w=>w.branch===b.name).reduce((s,w)=>
            (_isPaidPT(w)||w.is_drop_in)?s+_wRev(w):s, 0);
          return `<div class="staff-card" style="flex-direction:column;gap:4px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-weight:700;font-size:14px">${b.name}</div>
              <div style="font-size:13px;font-weight:600">${fmt(Math.round(bRev))} сум</div>
            </div>
            <div style="font-size:12px;color:var(--hint);display:flex;gap:12px">
              <span>🏊 ${bPT} ПТ</span>${bDi?`<span>🎟 ${bDi} разовых</span>`:''}
            </div>
          </div>`;
        }).join('')}
      `;
    } catch(e) { document.getElementById('ceo-fin-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
  };

  document.getElementById('ceo-fin-prev')?.addEventListener('click',()=>{
    if(month===1){year--;month=12;}else month--;
    document.getElementById('ceo-fin-next-lbl').textContent=fmtMY(year,month); load();
  });
  document.getElementById('ceo-fin-next')?.addEventListener('click',()=>{
    if(month===12){year++;month=1;}else month++;
    document.getElementById('ceo-fin-next-lbl').textContent=fmtMY(year,month); load();
  });
  await load();
}

// ── АНАЛИТИКА (клиенты + тренировки + загруженность) ──────────
async function renderCeoStats() {
  let year=new Date().getFullYear(), month=new Date().getMonth()+1;
  $('#tab-content').innerHTML = _ceoMonthShell('📊 Аналитика','ceo-st-body','ceo-st-prev','ceo-st-next',year,month);

  const load = async () => {
    const body=document.getElementById('ceo-st-body'); if (!body) return;
    body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
    try {
      const py=month===1?year-1:year, pm=month===1?12:month-1;
      const [curr, prev, extra] = await Promise.all([
        DB.getSummary(year, month, null),
        DB.getSummary(py, pm, null),
        DB.getCeoAnalytics(year, month),
      ]);

      const clients=extra.clients||[];
      const activeBase=clients.filter(c=>c.balance>0);
      const avgBalance=activeBase.length?activeBase.reduce((s,c)=>s+c.balance,0)/activeBase.length:0;

      // Новые клиенты — первый абонемент в этом месяце
      const firstSub={};
      (extra.subscriptions||[]).forEach(s=>{
        if (!firstSub[s.client_id]||s.start_date<firstSub[s.client_id]) firstSub[s.client_id]=s.start_date;
      });
      const mStart=`${year}-${String(month).padStart(2,'0')}-01`;
      const mEnd=new Date(year,month,1).toISOString().slice(0,10);
      const pStart=`${py}-${String(pm).padStart(2,'0')}-01`;
      const newCurr=Object.values(firstSub).filter(d=>d>=mStart&&d<mEnd).length;
      const newPrev=Object.values(firstSub).filter(d=>d>=pStart&&d<mStart).length;

      // Отток
      const cutoff=new Date(Date.now()-14*86400000).toISOString().slice(0,10);
      const churned=clients.filter(c=>c.balance<=0&&c.subscription_end&&c.subscription_end<cutoff);
      const atRisk=clients.filter(c=>c.balance<=0&&c.subscription_end&&c.subscription_end>=cutoff&&c.subscription_end<todayStr());
      const fioMap={}; (curr.profiles||[]).forEach(p=>fioMap[p.id]=p.fio);

      // ПТ за месяц
      const currPT=(curr.workouts||[]).filter(_isPaidPT).length;
      const prevPT=(prev.workouts||[]).filter(_isPaidPT).length;
      const currDi=(curr.workouts||[]).filter(w=>w.is_drop_in).length;
      const prevDi=(prev.workouts||[]).filter(w=>w.is_drop_in).length;

      // Загруженность по слотам
      const HOURS=Array.from({length:16},(_,i)=>i+7);
      const heat=Array.from({length:7},()=>({}));
      let maxHeat=0;
      (extra.slots||[]).filter(s=>s.slot_type!=='duty').forEach(s=>{
        const sh=parseInt(s.start_time), eh=Math.max(sh+1,parseInt(s.end_time)||sh+1);
        for (let h=sh; h<eh; h++) {
          if (h<7||h>22||!heat[s.day_of_week]) continue;
          heat[s.day_of_week][h]=(heat[s.day_of_week][h]||0)+1;
          maxHeat=Math.max(maxHeat,heat[s.day_of_week][h]);
        }
      });

      body.innerHTML=`
        <h4>👤 Клиенты</h4>
        <div class="an-grid" style="margin-bottom:8px">
          ${_anCard('👥','Активная база',activeBase.length,activeBase.length,0,py,pm,true)}
          ${_anCard('➕','Новых',newCurr,newCurr,newPrev,py,pm,true)}
          ${_anCard('🚪','Отток >14д',churned.length,churned.length,0,py,pm,false)}
          ${_anCard('🔋','Ср. остаток',avgBalance.toFixed(1),Math.round(avgBalance*10),0,py,pm,true)}
        </div>
        ${atRisk.length?`<div class="warn-banner" style="margin-bottom:10px;font-size:12px">
          ⏳ <b>Риск оттока:</b> ${atRisk.length} клиентов закончили ПТ за последние 14 дней
        </div>`:''}
        ${churned.length?`<details style="margin-bottom:16px">
          <summary style="font-size:12px;color:var(--hint);cursor:pointer">Отток — список (${churned.length})</summary>
          <div style="margin-top:6px">
            ${churned.slice(0,15).map(c=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span>${c.fio}</span><span class="hint">${fioMap[c.trainer_id]||''} · до ${fmtDate(c.subscription_end)}</span>
            </div>`).join('')}
            ${churned.length>15?`<p class="hint" style="margin-top:4px">Ещё ${churned.length-15}...</p>`:''}
          </div>
        </details>`:``}

        <h4 style="margin-top:4px">🏊 Тренировки</h4>
        <div class="an-grid" style="margin-bottom:20px">
          ${_anCard('📋','ПТ за месяц',currPT,currPT,prevPT,py,pm,true)}
          ${_anCard('🎟','Разовые',currDi,currDi,prevDi,py,pm,true)}
        </div>

        <h4>🕐 Загруженность по времени</h4>
        <p class="hint" style="font-size:11px;margin-bottom:8px">Слоты расписания (ПТ + группы), число одновременных занятий</p>
        <div style="display:grid;grid-template-columns:38px repeat(7,1fr);gap:2px;font-size:10px">
          <div></div>${DAYS_SHORT.map(d=>`<div style="text-align:center;color:var(--hint)">${d}</div>`).join('')}
          ${HOURS.map(h=>`<div style="color:var(--hint);line-height:18px">${String(h).padStart(2,'0')}:00</div>`+
            DAYS_SHORT.map((_,d)=>{
              const v=heat[d][h]||0, a=maxHeat?v/maxHeat:0;
              return `<div style="height:18px;border-radius:3px;text-align:center;line-height:18px;background:${v?`rgba(124,58,237,${(0.15+0.85*a).toFixed(2)})`:'var(--card)'};color:${a>0.5?'#fff':'var(--hint)'}">${v||''}</div>`;
            }).join('')).join('')}
        </div>
      `;
    } catch(e) { document.getElementById('ceo-st-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
  };

  document.getElementById('ceo-st-prev')?.addEventListener('click',()=>{
    if(month===1){year--;month=12;}else month--;
    document.getElementById('ceo-st-next-lbl').textContent=fmtMY(year,month); load();
  });
  document.getElementById('ceo-st-next')?.addEventListener('click',()=>{
    if(month===12){year++;month=1;}else month++;
    document.getElementById('ceo-st-next-lbl').textContent=fmtMY(year,month); load();
  });
  await load();
}

// ── ТРЕНЕРЫ — клиенты, ПТ, ФОТ ────────────────
async function renderCeoTrainers() {
  let year=new Date().getFullYear(), month=new Date().getMonth()+1;
  $('#tab-content').innerHTML = _ceoMonthShell('🏋️ Тренеры','ceo-tr-body','ceo-tr-prev','ceo-tr-next',year,month);

  const load = async () => {
    const body=document.getElementById('ceo-tr-body'); if (!body) return;
    body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
    try {
      const [data, allClients] = await Promise.all([
        DB.getSummary(year, month, null),
        DB.getAllClients(),
      ]);

      const fotRows=ceoFotRows(data).sort((a,b)=>b.sal.total-a.sal.total);
      const totalFot=fotRows.reduce((s,r)=>s+r.sal.total,0);

      // Активных клиентов на тренера
      const activeByTrainer={};
      allClients.filter(c=>!c.is_archived&&c.balance>0).forEach(c=>{
        activeByTrainer[c.trainer_id]=(activeByTrainer[c.trainer_id]||0)+1;
      });
      const totalByTrainer={};
      allClients.filter(c=>!c.is_archived).forEach(c=>{
        totalByTrainer[c.trainer_id]=(totalByTrainer[c.trainer_id]||0)+1;
      });

      // ПТ за месяц на тренера
      const ptByTrainer={};
      (data.workouts||[]).filter(_isPaidPT).forEach(w=>{
        ptByTrainer[w.trainer_id]=(ptByTrainer[w.trainer_id]||0)+1;
      });

      const maxPt=Math.max(1,...fotRows.map(r=>ptByTrainer[r.p.id]||0));
      const maxClients=Math.max(1,...fotRows.map(r=>activeByTrainer[r.p.id]||0));

      body.innerHTML=`
        <div class="summary-cards" style="margin-bottom:16px">
          <div class="summary-card"><div class="s-val">${fotRows.filter(r=>r.sal.total>0).length}</div><div class="s-lbl">Тренеров</div></div>
          <div class="summary-card accent"><div class="s-val">${fmt(Math.round(totalFot))}</div><div class="s-lbl">ФОТ (сум)</div></div>
        </div>
        ${fotRows.map(({p,sal})=>{
          const active=activeByTrainer[p.id]||0;
          const total=totalByTrainer[p.id]||0;
          const pt=ptByTrainer[p.id]||0;
          return `<div class="staff-card" style="flex-direction:column;gap:6px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div class="staff-fio" style="flex:1;min-width:0">${p.fio}</div>
              <div style="font-weight:700;font-size:15px;white-space:nowrap;flex-shrink:0">${fmt(sal.total)} сум</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
              <div>
                <div style="color:var(--hint);margin-bottom:2px">Клиентов активных</div>
                <div style="font-weight:600">${active} <span class="hint">/ ${total} всего</span></div>
                <div style="height:4px;background:var(--card);border-radius:2px;margin-top:3px;overflow:hidden">
                  <div style="height:100%;width:${Math.round(active/maxClients*100)}%;background:#10b981;border-radius:2px"></div>
                </div>
              </div>
              <div>
                <div style="color:var(--hint);margin-bottom:2px">ПТ за месяц</div>
                <div style="font-weight:600">${pt}</div>
                <div style="height:4px;background:var(--card);border-radius:2px;margin-top:3px;overflow:hidden">
                  <div style="height:100%;width:${Math.round(pt/maxPt*100)}%;background:var(--accent,#7c3aed);border-radius:2px"></div>
                </div>
              </div>
            </div>
            <div style="font-size:11px;color:var(--hint);display:flex;gap:10px;flex-wrap:wrap">
              ${sal.cat[1]+sal.cat[2]+sal.cat[3]>0?`<span>🏊 ${sal.cat[1]+sal.cat[2]+sal.cat[3]} ПТ</span>`:''}
              ${sal.hours>0?`<span>⏱ ${sal.hours.toFixed(1)}ч деж.</span>`:''}
              ${sal.adultSum+sal.childSum>0?`<span>👥 ${fmt(sal.adultSum+sal.childSum)} группы</span>`:''}
              ${sal.bonus>0?`<span style="color:var(--success)">+${fmt(sal.bonus)}</span>`:''}
              ${sal.penalty>0?`<span style="color:var(--danger)">−${fmt(sal.penalty)}</span>`:''}
            </div>
          </div>`;
        }).join('')}
      `;
    } catch(e) { document.getElementById('ceo-tr-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
  };

  document.getElementById('ceo-tr-prev')?.addEventListener('click',()=>{
    if(month===1){year--;month=12;}else month--;
    document.getElementById('ceo-tr-next-lbl').textContent=fmtMY(year,month); load();
  });
  document.getElementById('ceo-tr-next')?.addEventListener('click',()=>{
    if(month===12){year++;month=1;}else month++;
    document.getElementById('ceo-tr-next-lbl').textContent=fmtMY(year,month); load();
  });
  await load();
}


// setClientColor moved to module

// renderTrainerEditProfile moved to module

// ============================================================
// SECTION: SHARED:DELETE — doDeleteClientCheck, doApproveDelete, doApproveWorkoutDelete
// ============================================================
async function doDeleteClientCheck(clientId, fioEnc, createdAt) {
  const fio = decodeURIComponent(fioEnc);
  const diffH = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (diffH <= 24) {
    if (!confirm(`Удалить «${fio}» полностью?\nЭто действие нельзя отменить.`)) return;
    try {
      await DB.deleteClient(clientId);
      toast('Клиент удалён','success');
      switchTab(STATE.currentTab||'clients');
    } catch(e) { toast('Ошибка','error'); console.error(e); }
  } else {
    if (!confirm(`Отправить запрос на удаление «${fio}»?\nЗапрос уйдёт старшему тренеру или координатору.`)) return;
    try {
      await DB.createDeleteRequest(clientId, fio, STATE.profile.id, STATE.profile.branches?.[0]||'');
      toast('Запрос отправлен ✅','success');
    } catch(e) {
      if (e.message==='already_pending') toast('Запрос уже отправлен ранее','info');
      else { toast('Ошибка','error'); console.error(e); }
    }
  }
}

async function doApproveWorkoutDelete(reqId, workoutId) {
  if (_pending.has('wda_'+reqId)) return;
  if (!confirm('Удалить тренировку окончательно?')) return;
  _pending.add('wda_'+reqId);
  try {
    await DB.approveWorkoutDeleteRequest(reqId, workoutId);
    toast('Тренировка удалена','success');
    adminTab('control');
  } catch(e) { console.error(e); toast('Ошибка','error'); }
  finally { _pending.delete('wda_'+reqId); }
}
async function doRejectWorkoutDelete(reqId) {
  if (_pending.has('wdr2_'+reqId)) return;
  _pending.add('wdr2_'+reqId);
  try {
    await DB.rejectWorkoutDeleteRequest(reqId);
    toast('Запрос отклонён','success');
    adminTab('control');
  } catch(e) { console.error(e); toast('Ошибка','error'); }
  finally { _pending.delete('wdr2_'+reqId); }
}

async function doApproveDelete(reqId, clientId, nameEnc) {
  if (_pending.has('approve_'+reqId)) return;
  const fio = decodeURIComponent(nameEnc);
  try {
    // Check if client has records
    const {data:wks} = await sb().from('workouts').select('id').eq('client_id',clientId).limit(1);
    const hasRecords = wks && wks.length > 0;
    if (hasRecords) {
      const m = el('div','modal-overlay');
      m.innerHTML=`<div class="modal">
        <div class="modal-header"><h3>Удаление клиента</h3>
          <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
        <div class="warn-banner" style="margin-bottom:16px">
          ⚠️ У клиента <b>${fio}</b> есть история тренировок и записи.<br>
          Удаление уберёт все данные безвозвратно.
        </div>
        <button class="btn btn-full btn-danger" style="margin-bottom:8px"
          onclick="doForceDelete('${reqId}','${clientId}','${encodeURIComponent(fio)}')">
          🗑 Удалить принудительно вместе с историей</button>
        <button class="btn btn-full" style="background:var(--card)"
          onclick="this.closest('.modal-overlay').remove()">Отмена</button>
      </div>`;
      document.body.appendChild(m);
    } else {
      if (!confirm(`Удалить клиента «${fio}» окончательно?`)) return;
      _pending.add('approve_'+reqId);
      await DB.approveDeleteRequest(reqId, clientId);
      _pending.delete('approve_'+reqId);
      DB.auditLog('client_delete', STATE.profile.id, STATE.profile.fio, clientId, 'client',
        { fio, force: false }, STATE.profile.branches?.[0]);
      toast('Клиент удалён','success');
      adminTab('control');
    }
  } catch(e) { _pending.delete('approve_'+reqId); toast('Ошибка','error'); console.error(e); }
}
async function doForceDelete(reqId, clientId, nameEnc) {
  if (_pending.has('force_'+reqId)) return;
  _pending.add('force_'+reqId);
  document.querySelector('.modal-overlay')?.remove();
  try {
    const fioDecoded = decodeURIComponent(nameEnc);
    await DB.approveDeleteRequest(reqId, clientId);
    DB.auditLog('client_delete', STATE.profile.id, STATE.profile.fio, clientId, 'client',
      { fio: fioDecoded, force: true }, STATE.profile.branches?.[0]);
    toast('Клиент удалён вместе с историей','success');
    adminTab('control');
  } catch(e) { toast('Ошибка удаления','error'); console.error(e); }
  finally { _pending.delete('force_'+reqId); }
}
async function doRejectDelete(reqId) {
  if (_pending.has('reject_'+reqId)) return;
  _pending.add('reject_'+reqId);
  try {
    await DB.rejectDeleteRequest(reqId);
    toast('Запрос отклонён','success');
    adminTab('control');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('reject_'+reqId); }
}

// ── ЦВЕТА КЛИЕНТОВ ────────────────────────────────────────────────────────────

// setClientColor moved to module

// ── РЕДАКТИРОВАНИЕ ПРОФИЛЯ ТРЕНЕРОМ ──────────────────────────────────────────

// ============================================================
// SECTION: SHARED:PROFILE — renderTrainerEditProfile, doSaveTrainerProfile
// ============================================================
async function renderTrainerEditProfile() {
  const profile = STATE.profile;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Мой профиль</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Фамилия Имя</label>
      <input id="ep-fio" type="text" value="${profile.fio}"></div>
    <div class="form-group"><label>Телефон</label>
      <input id="ep-phone" type="tel" placeholder="+998 90 000 00 00" value="${profile.phone||''}"></div>
    <div class="form-group"><label>Новый PIN (оставьте пустым чтобы не менять)</label>
      <input id="ep-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <div class="form-group"><label>Подтвердите PIN</label>
      <input id="ep-pin2" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <button class="btn btn-primary btn-full" onclick="doSaveTrainerProfile()">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveTrainerProfile() {
  const fio   = document.getElementById('ep-fio')?.value.trim();
  const phone = document.getElementById('ep-phone')?.value.trim();
  const pin   = document.getElementById('ep-pin')?.value;
  const pin2  = document.getElementById('ep-pin2')?.value;
  if (!fio) return toast('Введите ФИО','error');
  if (pin && !/^\d{4}$/.test(pin)) return toast('PIN: 4 цифры','error');
  if (pin && pin !== pin2) return toast('PIN не совпадает','error');
  try {
    const fields = {fio};
    if (phone) fields.phone = phone;
    if (pin) await DB.changePin(STATE.profile.id, pin);
    await DB.updateProfile(STATE.profile.id, fields);
    STATE.profile = {...STATE.profile, ...fields};
    document.querySelector('.modal-overlay')?.remove();
    toast('Профиль обновлён ✅','success');
    const sub = document.querySelector('.app-sub');
    if (sub) sub.textContent = fio;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── УВЕДОМЛЕНИЯ ВНУТРИ ПРИЛОЖЕНИЯ ────────────────────────────────────────────

// ============================================================
// SECTION: SHARED:NOTIFICATIONS — checkInAppNotifications, renderAdminNotifications
// ============================================================
async function checkInAppNotifications() {
  try {
    const notifs = await DB.getMyNotifications(STATE.profile.tg_id);
    const unread = notifs.filter(n=>!n.read_at).length;
    const count = document.getElementById('notif-count');
    if (count) {
      count.style.display = unread > 0 ? '' : 'none';
      count.textContent = unread > 9 ? '9+' : String(unread);
    }
  } catch(e) { console.error(e); }
}
// Периодически проверяем новые уведомления каждые 60 секунд
setInterval(()=>{ if (STATE.profile?.tg_id) checkInAppNotifications(); }, 60000);
async function renderInAppNotifications() {
  try {
    const notifs = await DB.getMyNotifications(STATE.profile.tg_id);
    await DB.markNotificationsRead(STATE.profile.tg_id);
    checkInAppNotifications();
    const m = el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>🔔 Уведомления</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div style="max-height:60vh;overflow-y:auto">
      ${!notifs.length?'<p class="hint" style="text-align:center;padding:20px">Нет уведомлений</p>':
        notifs.map(n=>`<div style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;line-height:1.5">${n.message}</div>
          <div style="font-size:11px;color:var(--hint);margin-top:4px">
            ${fmtDT(n.created_at)}
            ${!n.read_at?'<span style="color:var(--accent);margin-left:6px">● новое</span>':''}
          </div>
        </div>`).join('')}
      </div>
    </div>`;
    document.body.appendChild(m);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function renderMissedSlotsPanel() {
  const slots = window._missedSlots || [];
  const date  = window._missedDate  || '';
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal" style="max-height:80vh;display:flex;flex-direction:column">
    <div class="modal-header" style="flex-shrink:0">
      <h3>⚠️ Пропущенные</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
    </div>
    <p class="hint" style="margin-bottom:12px;flex-shrink:0">Не внесено вчера · ${date}</p>
    <div style="overflow-y:auto;flex:1">
      ${!slots.length
        ? '<div class="empty-state" style="padding:30px 0">✅<p>Всё внесено!</p></div>'
        : slots.map(s=>renderTodaySlot(s, date)).join('')}
    </div>
  </div>`;
  document.body.appendChild(m);
}

async function renderAdminNotifications() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const [recent, profiles] = await Promise.all([
      DB.getRecentNotifications(50),
      DB.getAllProfiles(),
    ]);

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header"><h3>Уведомления</h3></div>

      <!-- Отправить сообщение -->
      <div class="staff-card" style="flex-direction:column;gap:10px;margin-bottom:20px">
        <div style="font-weight:600;font-size:14px">📤 Отправить уведомление</div>
        <div class="form-group" style="margin-bottom:0">
          <label>Кому</label>
          <select id="notif-target">
            <option value="all">Всем сотрудникам</option>
            <option value="trainers">Всем тренерам</option>
            ${profiles.filter(p=>p.tg_id).map(p=>`<option value="${p.tg_id}">${p.fio}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Сообщение</label>
          <textarea id="notif-msg" rows="3" placeholder="Текст уведомления..."></textarea>
        </div>
        <button class="btn btn-primary btn-full" onclick="doSendAdminNotification()">Отправить</button>
      </div>

      <!-- История -->
      <h4 style="margin-bottom:12px">История (последние 50)</h4>
      ${!recent.length?'<p class="hint">Нет уведомлений</p>':
        recent.map(n=>`<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="flex:1">
              <div style="font-size:13px">${n.message}</div>
              <div style="font-size:11px;color:var(--hint);margin-top:3px">
                → ${n.recipient_name||n.recipient_tg_id} · ${fmtDT(n.created_at)}
                ${n.read_at?`<span style="color:#10b981;margin-left:6px">✓ прочитано</span>`:'<span style="color:var(--accent);margin-left:6px">● не прочитано</span>'}
              </div>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
  } catch(e) { $('#tab-content').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

async function doSendAdminNotification() {
  const target  = document.getElementById('notif-target')?.value;
  const message = document.getElementById('notif-msg')?.value.trim();
  if (!message) return toast('Введите текст','error');
  try {
    const allProfiles = await DB.getAllProfiles();
    let recipients = [];
    if (target==='all') {
      recipients = allProfiles.filter(p=>p.tg_id);
    } else if (target==='trainers') {
      recipients = allProfiles.filter(p=>p.tg_id && ['trainer','senior_trainer'].includes(p.role));
    } else {
      const tgId = parseInt(target);
      recipients = allProfiles.filter(p=>p.tg_id===tgId);
    }
    if (!recipients.length) return toast('Нет получателей с привязанным аккаунтом','error');
    const count = await DB.queueBroadcast(recipients, message, null, STATE.profile.id);
    toast(`✅ Отправлено ${count} получател${count===1?'ю':'ям'}`, 'success');
    document.getElementById('notif-msg').value='';
    renderAdminNotifications();
  } catch(e) { toast('Ошибка: '+(e?.message||String(e)),'error'); console.error(e); }
}

// ── ЗАМЕНА В ГРУППАХ ──────────────────────────────────────────────────────────

// ── РАСПИСАНИЕ ГРУППЫ (дни/время) ────────────────────────────────────────────
async function resolveGroupDuplicate(flagId, status, groupId, monthStr) {
  try {
    await DB.resolveDuplicateFlag(flagId, status);
    if (status === 'merged') toast('Дубль помечен — удалите лишнего ребёнка вручную','success');
    else toast('Подтверждено: разные дети ✅','success');
    renderGroupMonthReport(groupId, monthStr);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ============================================================
// SECTION: SHARED:GROUP_MODALS — расписание группы, замены, взрослые группы
// ============================================================
function renderGroupScheduleModal(groupId, daysEnc, time) {
  const currentDays = JSON.parse(decodeURIComponent(daysEnc)||'[]');
  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Расписание группы</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дни занятий</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        ${DAYS.map(d=>`<label style="display:flex;align-items:center;gap:4px;cursor:pointer">
          <input type="checkbox" class="sched-day" value="${d}" ${currentDays.includes(d)?'checked':''} style="width:18px;height:18px">
          <span style="font-size:14px">${d}</span>
        </label>`).join('')}
      </div>
    </div>
    <div class="form-group"><label>Время начала</label>
      <input type="time" id="sched-time" value="${time||''}"
        style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px;width:100%;box-sizing:border-box">
    </div>
    <button class="btn btn-primary btn-full" onclick="doSaveGroupSchedule('${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveGroupSchedule(groupId) {
  const days = [...document.querySelectorAll('.sched-day:checked')].map(cb=>cb.value);
  const time = document.getElementById('sched-time')?.value||null;
  if (!days.length) return toast('Выберите хотя бы один день','error');
  try {
    await DB.updateTrainerGroupSchedule(groupId, days, time);
    document.querySelector('.modal-overlay')?.remove();
    toast('Расписание сохранено ✅','success');
    // Из списка групп — перерисовать список; из хаба группы — перерисовать хаб
    if (document.getElementById('groups-list')) loadSeniorGroupsList();
    else if (window._gd?.groupId) renderGroupDetail(window._gd.groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── СВЯЗАТЬ ТРЕНЕРОВ В ОДИН INSTANCE (Арт-свим) ──────────────────────────────
async function renderLinkGroupInstanceModal(groupId) {
  // Ищем все группы того же типа и филиала с разными instance
  const {data:thisGroup} = await sb().from('trainer_groups')
    .select('group_type_id,branch,group_instance_id,group_types(name)')
    .eq('id',groupId).single();
  if (!thisGroup) return toast('Ошибка','error');

  const {data:candidates} = await sb().from('trainer_groups')
    .select('id,group_instance_id,days_of_week,session_time,profiles(fio)')
    .eq('group_type_id', thisGroup.group_type_id)
    .eq('branch', thisGroup.branch)
    .is('subscription_end',null)
    .neq('id', groupId)
    .neq('group_instance_id', thisGroup.group_instance_id);

  const groups = [];
  const seen = new Set();
  (candidates||[]).forEach(c=>{
    if (!seen.has(c.group_instance_id)) {
      seen.add(c.group_instance_id);
      const days = c.days_of_week?.join('/')|| 'без расписания';
      const t = c.session_time||'';
      groups.push({instance_id: c.group_instance_id, label: `${days}${t?' '+t:''}`});
    }
  });

  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Связать с группой</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Выберите существующую группу ${thisGroup.group_types?.name||''} в ${thisGroup.branch}, к которой относится этот тренер. Они будут делить общий список детей и баланс.</p>
    ${!groups.length
      ? '<p class="hint">Других групп этого типа в этом филиале нет. Сначала задайте расписание каждой группе.</p>'
      : groups.map(g=>`
        <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);margin-bottom:8px;text-align:left;padding:12px"
          onclick="doLinkGroupInstance('${groupId}','${g.instance_id}')">
          <div style="font-weight:600">${g.label}</div>
          <div style="font-size:12px;color:var(--hint)">instance: ${g.instance_id.slice(0,8)}...</div>
        </button>`).join('')}
    <button class="btn btn-full" style="margin-top:8px;background:rgba(239,68,68,.1);color:#ef4444"
      onclick="this.closest('.modal-overlay').remove()">Отмена</button>
  </div>`;
  document.body.appendChild(m);
}
async function doLinkGroupInstance(groupId, newInstanceId) {
  try {
    await DB.linkTrainerGroupInstance(groupId, newInstanceId);
    document.querySelector('.modal-overlay')?.remove();
    toast('Связано ✅','success');
    loadSeniorGroupsList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Экран «История замен» — список замен группы (создание замены живёт на «Занятие сегодня»)
async function renderGroupSubstitutionsHistory(groupId) {
  navPush(()=>renderGroupDetail(groupId));
  setupBack(()=>renderGroupDetail(groupId));
  loading('Загрузка замен...');
  try {
    const subs = await DB.getGroupSubstitutionsHistory(groupId);
    const statusMeta = {
      approved: {label:'утверждена', color:'#10b981', bg:'rgba(16,185,129,.12)'},
      pending:  {label:'⏳ ожидает', color:'#f59e0b', bg:'rgba(245,158,11,.12)'},
      rejected: {label:'отклонена', color:'#ef4444', bg:'rgba(239,68,68,.12)'},
    };
    const list = subs.length ? subs.map(s=>{
      const st = statusMeta[s.status]||statusMeta.pending;
      return `<div class="staff-card" style="flex-direction:column;align-items:stretch;gap:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;font-weight:500">${s.substitute?.fio||'?'}</span>
          <span style="font-size:11px;font-weight:600;color:${st.color};background:${st.bg};padding:2px 8px;border-radius:8px">${st.label}</span>
        </div>
        <div style="font-size:12px;color:var(--hint)">вместо ${s.original?.fio||'?'} · ${fmtDate(s.session_date)}${s.status==='approved'&&s.rate?` · ${fmt(s.rate)} сум`:''}</div>
      </div>`;
    }).join('') : '<div class="empty-state">🔄<p>Замен пока не было</p></div>';
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">История замен</div>
      <span></span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <button class="btn btn-primary btn-full" style="margin-bottom:12px"
        onclick="renderGroupSubstitutionModal('${groupId}')">＋ Новая замена</button>
      <div style="display:flex;flex-direction:column;gap:8px">${list}</div>
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function renderGroupSubstitutionModal(groupId) {
  try {
    const trainers = await cached('profiles',()=>DB.getAllProfiles());
    const others = trainers.filter(t=>
      ['trainer','senior_trainer'].includes(t.role) &&
      t.id !== STATE.profile.id && t.tg_id
    );
    const m = el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>Замена на занятии</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <p style="font-size:13px;color:var(--hint);margin-bottom:12px">Кто провёл занятие вместо вас?</p>
      <div class="form-group"><label>Дата занятия</label>
        <input type="date" id="sub-date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="form-group"><label>Тренер-замена</label>
        <select id="sub-trainer">
          <option value="">— выберите —</option>
          ${others.map(t=>`<option value="${t.id}">${t.fio}</option>`).join('')}
        </select></div>
      <button class="btn btn-primary btn-full" onclick="doCreateSubstitution('${groupId}')">Отправить запрос</button>
    </div>`;
    document.body.appendChild(m);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doCreateSubstitution(groupId) {
  const date = document.getElementById('sub-date')?.value;
  const subId = parseInt(document.getElementById('sub-trainer')?.value);
  if (!date || !subId) return toast('Заполните все поля','error');
  try {
    await DB.createGroupSubstitution(groupId, STATE.profile.id, subId, date);
    DB.auditLog('group_substitution_create', STATE.profile.id, STATE.profile.fio, groupId, 'group_substitution',
      { substitute_id: subId, date }, STATE.profile.branches?.[0]);
    document.querySelector('.modal-overlay')?.remove();
    toast('Запрос отправлен старшему тренеру ✅','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Для старшего тренера — одобрение замены со ставкой
async function renderPendingSubstitutions() {
  const body = document.getElementById('pending-subs'); if (!body) return;
  try {
    const subs = await DB.getPendingSubstitutions();
    if (!subs.length) { body.innerHTML=''; return; }
    body.innerHTML=`<div class="warn-banner" style="margin-bottom:12px">
      🔄 Запросы на замену (${subs.length})
      ${subs.map(s=>`<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.1)">
        <div style="font-size:12px">${s.trainer_groups?.group_types?.name||'Группа'} · ${s.session_date}</div>
        <div style="font-size:12px">Провёл: <b>${s.substitute?.fio||'?'}</b> вместо ${s.original?.fio||'?'}</div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          <input type="number" id="sub-rate-${s.id}" placeholder="Ставка (сум)" 
            style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text);font-size:12px">
          <button class="btn btn-sm btn-primary" onclick="doApproveSubstitution('${s.id}')">✓</button>
        </div>
      </div>`).join('')}
    </div>`;
  } catch(e) { console.error(e); }
}
async function doApproveSubstitution(id) {
  const rate = parseFloat(document.getElementById(`sub-rate-${id}`)?.value)||0;
  if (!rate) return toast('Укажите ставку','error');
  try {
    await DB.approveSubstitution(id, rate);
    DB.auditLog('group_substitution_approve', STATE.profile.id, STATE.profile.fio, id, 'group_substitution',
      { rate }, STATE.profile.branches?.[0]);
    toast('Замена одобрена ✅','success');
    renderPendingSubstitutions();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ВЗРОСЛЫЕ ГРУППЫ — КЛИЕНТЫ ────────────────────────────────────────────────

// Точка возврата на вкладку «Группы» по роли — переустанавливаем при заходе в хаб.
function _backToGroupsByRole() {
  const role = STATE.profile?.role;
  if (role==='admin'||role==='ceo') return ()=>renderAdminApp('groups');
  if (role==='senior_trainer')      return ()=>renderSeniorApp('groups');
  return ()=>renderTrainerShell('groups');
}

// Загрузить занятия взрослой группы за месяц (для тренера — только его).
async function _loadAdultSessions(tgInfo, monthStr) {
  const [mYear, mMonth] = monthStr.split('-').map(Number);
  const toDay = new Date(mYear, mMonth, 1).toISOString().slice(0,10);
  const isAdminView = ['admin','ceo','senior_trainer'].includes(STATE.profile.role);
  let q = sb().from('group_sessions').select('*, profiles(fio)')
    .eq('group_type_id', tgInfo?.group_type_id||0)
    .eq('branch', tgInfo?.branch||'')
    .gte('session_date',monthStr).lt('session_date',toDay)
    .order('session_date',{ascending:false});
  if (!isAdminView) q = q.eq('trainer_id', STATE.profile.id);
  return q.then(r=>r.data||[]);
}

// ═══ ХАБ ВЗРОСЛОЙ ГРУППЫ (Акваджим / Аквафитнес) ═══
// Единый стиль с детским хабом: шапка-инфо + разделы крупными кнопками.
// Биллинг по явке (getAdultGroupRate), участники без оплат/подгрупп.
async function renderAdultGroupDetail(groupId) {
  const role = STATE.profile?.role;
  const canPayroll = ['admin','senior_trainer'].includes(role);
  const back = _backToGroupsByRole();
  navPush(back);
  setupBack(back);
  const month = new Date().toISOString().slice(0,7)+'-01';
  loading('Загрузка...');
  try {
    const {data:tgInfo} = await sb().from('trainer_groups')
      .select('branch,group_type_id,group_types(name)').eq('id',groupId).single();
    const [clients, sessions] = await Promise.all([
      DB.getAdultGroupClients(groupId),
      _loadAdultSessions(tgInfo, month),
    ]);
    const branch = tgInfo?.branch||'';
    const monthTotal = sessions.reduce((s,x)=>s+getAdultGroupRate(x.headcount),0);
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">${tgInfo?.group_types?.name||'Группа'}</div>
      <span style="font-size:12px;color:var(--hint)">${branch}</span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="staff-card" style="flex-direction:column;align-items:stretch;gap:8px;margin-bottom:14px">
        ${groupHubInfoRow('Филиал', `<span style="font-weight:600;font-size:13px">${branch}</span>`)}
        ${groupHubInfoRow('Участников', `<span style="font-weight:600;font-size:13px">${clients.length}</span>`)}
        ${groupHubInfoRow('Занятий в этом месяце', `<span style="font-weight:600;font-size:13px">${sessions.length}${monthTotal?` · ${fmt(monthTotal)} сум`:''}</span>`)}
      </div>
      ${groupHubSection('Управление')}
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
        ${canPayroll?groupHubBigBtn('👥','Персонал','тренеры · ставки · расписание',`openSeniorGroupPersonnel('${groupId}')`):''}
        ${groupHubBigBtn('👤',`Участники (${clients.length})`,'добавление · архив',`renderAdultGroupMembers('${groupId}')`)}
      </div>

      ${groupHubSection('Занятия')}
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
        ${groupHubBigBtn('📊','Отметить занятие','кто был · ставка по явке',`renderAdultGroupHeadcount('${groupId}')`)}
        ${groupHubBigBtn('📅','История занятий','по месяцам · правка/удаление',`renderAdultGroupHistory('${groupId}')`)}
        ${groupHubBigBtn('🔄','История замен','прошедшие и текущие замены',`renderGroupSubstitutionsHistory('${groupId}')`)}
      </div>

      ${groupHubSection('Финансы и отчёты')}
      <div style="display:flex;flex-direction:column;gap:8px">
        ${groupHubBigBtn('💰','Отчёт за месяц','занятия · сумма по тренерам',`renderAdultGroupReport('${groupId}')`)}
      </div>
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Список участников взрослой группы
async function renderAdultGroupMembers(groupId) {
  navPush(()=>renderAdultGroupDetail(groupId));
  setupBack(()=>renderAdultGroupDetail(groupId));
  loading('Загрузка...');
  try {
    const clients = await DB.getAdultGroupClients(groupId);
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">Участники</div>
      <button class="btn btn-sm" onclick="renderAddAdultGroupClientModal('${groupId}')">+ Участник</button>
    </div>
    <div class="tab-content"><div class="tab-pad">
      ${!clients.length?'<div class="empty-state">👤<p>Участников нет</p></div>':
        clients.map(c=>`<div class="staff-card" style="justify-content:space-between">
          <span>${c.name}</span>
          <button class="btn btn-sm btn-danger" onclick="archiveAdultClientConfirm('${c.id}','${encodeURIComponent(c.name)}','${groupId}')">✕</button>
        </div>`).join('')}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// История занятий взрослой группы с навигацией по месяцам
async function renderAdultGroupHistory(groupId, monthStr) {
  navPush(()=>renderAdultGroupDetail(groupId));
  setupBack(()=>renderAdultGroupDetail(groupId));
  if (!monthStr) monthStr = new Date().toISOString().slice(0,7)+'-01';
  loading('Загрузка...');
  try {
    const {data:tgInfo} = await sb().from('trainer_groups')
      .select('branch,group_type_id,group_types(name)').eq('id',groupId).single();
    const [mYear, mMonth] = monthStr.split('-').map(Number);
    const prevMonth = mMonth===1 ? `${mYear-1}-12-01` : `${mYear}-${String(mMonth-1).padStart(2,'0')}-01`;
    const nextMonth = mMonth===12 ? `${mYear+1}-01-01` : `${mYear}-${String(mMonth+1).padStart(2,'0')}-01`;
    const isCurrentMonth = monthStr === new Date().toISOString().slice(0,7)+'-01';
    const isAdminView = ['admin','ceo','senior_trainer'].includes(STATE.profile.role);
    const sessions = await _loadAdultSessions(tgInfo, monthStr);
    const monthLabel = new Date(mYear,mMonth-1,1).toLocaleString('ru-RU',{month:'long',year:'numeric'});
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">История занятий</div>
      ${isCurrentMonth?`<button class="btn btn-sm" onclick="renderAddManualGroupSession('${groupId}')">+ Добавить</button>`:'<span></span>'}
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="section-header">
        <div class="month-nav" style="display:flex;align-items:center;gap:4px;width:100%;justify-content:center">
          <button onclick="renderAdultGroupHistory('${groupId}','${prevMonth}')">‹</button>
          <span style="font-size:13px;min-width:120px;text-align:center">${monthLabel}</span>
          <button ${isCurrentMonth?'disabled':''} onclick="renderAdultGroupHistory('${groupId}','${nextMonth}')">›</button>
        </div>
      </div>
      ${!sessions.length?'<div class="empty-state">📅<p>Нет занятий за этот месяц</p></div>':sessions.map(s=>{
        const rate = getAdultGroupRate(s.headcount);
        return `<div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${fmtDate(s.session_date)}</span>
            <span class="hi-cat" style="background:rgba(16,185,129,.15);color:#10b981">${fmt(rate)} сум</span>
            <span class="hint">${s.headcount} чел.</span>
            ${isAdminView && s.profiles?.fio ? `<span class="hint" style="font-size:11px">· ${s.profiles.fio}</span>` : ''}
          </div>
          ${isCurrentMonth?`<div style="display:flex;gap:6px;margin-top:4px">
            <button class="btn btn-sm" style="font-size:11px;background:var(--card);border:1px solid var(--border)"
              onclick="renderEditGroupSession('${s.id}','${s.session_date}',${s.headcount},'${groupId}')">✏️</button>
            <button class="btn btn-sm btn-danger" style="font-size:11px"
              onclick="doDeleteGroupSession('${s.id}','${groupId}')">🗑</button>
          </div>`:''}
        </div>`;
      }).join('')}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Отчёт за месяц по взрослой группе — занятия и сумма в разрезе тренеров
async function renderAdultGroupReport(groupId, monthStr) {
  navPush(()=>renderAdultGroupDetail(groupId));
  setupBack(()=>renderAdultGroupDetail(groupId));
  if (!monthStr) monthStr = new Date().toISOString().slice(0,7)+'-01';
  loading('Загрузка...');
  try {
    const {data:tgInfo} = await sb().from('trainer_groups')
      .select('branch,group_type_id,group_types(name)').eq('id',groupId).single();
    const [mYear, mMonth] = monthStr.split('-').map(Number);
    const prevMonth = mMonth===1 ? `${mYear-1}-12-01` : `${mYear}-${String(mMonth-1).padStart(2,'0')}-01`;
    const nextMonth = mMonth===12 ? `${mYear+1}-01-01` : `${mYear}-${String(mMonth+1).padStart(2,'0')}-01`;
    const isCurrentMonth = monthStr === new Date().toISOString().slice(0,7)+'-01';
    const sessions = await _loadAdultSessions(tgInfo, monthStr);
    const monthLabel = new Date(mYear,mMonth-1,1).toLocaleString('ru-RU',{month:'long',year:'numeric'});
    const byTrainer = {};
    sessions.forEach(s=>{
      const k = s.trainer_id;
      (byTrainer[k] ||= {fio: s.profiles?.fio||'?', count:0, sum:0});
      byTrainer[k].count++;
      byTrainer[k].sum += getAdultGroupRate(s.headcount);
    });
    const rows = Object.values(byTrainer).sort((a,b)=>b.sum-a.sum);
    const total = rows.reduce((s,r)=>s+r.sum,0);
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">Отчёт за месяц</div>
      <span></span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="section-header">
        <div class="month-nav" style="display:flex;align-items:center;gap:4px;width:100%;justify-content:center">
          <button onclick="renderAdultGroupReport('${groupId}','${prevMonth}')">‹</button>
          <span style="font-size:13px;min-width:120px;text-align:center">${monthLabel}</span>
          <button ${isCurrentMonth?'disabled':''} onclick="renderAdultGroupReport('${groupId}','${nextMonth}')">›</button>
        </div>
      </div>
      <div class="staff-card" style="flex-direction:column;align-items:stretch;gap:8px;margin-bottom:14px">
        ${groupHubInfoRow('Всего занятий', `<span style="font-weight:600;font-size:13px">${sessions.length}</span>`)}
        ${groupHubInfoRow('Итого', `<span style="font-weight:700;font-size:14px;color:#10b981">${fmt(total)} сум</span>`)}
      </div>
      ${!rows.length?'<div class="empty-state">💰<p>Нет занятий за этот месяц</p></div>':rows.map(r=>`
        <div class="staff-card" style="justify-content:space-between">
          <div><div class="staff-fio">${r.fio}</div><div class="staff-meta">${r.count} занятий</div></div>
          <span style="font-weight:600;color:#10b981">${fmt(r.sum)} сум</span>
        </div>`).join('')}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderAddAdultGroupClientModal(groupId) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить участника</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Имя Фамилия</label>
      <input id="agc-name" type="text" placeholder="Иванов Иван"></div>
    <button class="btn btn-primary btn-full" onclick="doAddAdultGroupClient('${groupId}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddAdultGroupClient(groupId) {
  const name = document.getElementById('agc-name')?.value.trim();
  if (!name) return toast('Введите имя','error');
  try {
    await DB.addAdultGroupClient(groupId, name);
    document.querySelector('.modal-overlay')?.remove();
    toast('Добавлено ✅','success');
    renderAdultGroupMembers(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
// ── РЕДАКЦИЯ ГРУПП ────────────────────────────────────────────

// Редактировать ребёнка (имя, возраст, цена)
function renderEditGroupClientModal(clientId, nameEnc, age, price, groupId) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать ребёнка</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Имя</label>
      <input id="egc-name" value="${name}"></div>
    <div class="form-group"><label>Возраст</label>
      <input id="egc-age" type="number" min="3" max="18" value="${age||''}"></div>
    <div class="form-group"><label>Стоимость (сум/мес)</label>
      <input id="egc-price" type="number" value="${price||0}"></div>
    <button class="btn btn-primary btn-full" onclick="doEditGroupClient('${clientId}','${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditGroupClient(clientId, groupId) {
  const name  = document.getElementById('egc-name')?.value.trim();
  const age   = parseInt(document.getElementById('egc-age')?.value)||null;
  const price = parseInt(document.getElementById('egc-price')?.value)||0;
  if (!name) return toast('Введите имя','error');
  try {
    await DB.updateGroupClient(clientId, {name, age, monthly_price:price});
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Сохранено','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Открыть редактор посещаемости за конкретную дату из истории
async function renderGroupAttendanceEdit(groupId, date) {
  const {data:tg} = await sb().from('trainer_groups')
    .select('group_instance_id').eq('id',groupId).single();
  const instanceId = tg?.group_instance_id||null;
  const [clients, existing] = await Promise.all([
    instanceId ? DB.getGroupClientsByInstance(instanceId) : DB.getGroupClients(groupId),
    instanceId ? DB.getGroupAttendanceByInstance(instanceId, date) : DB.getGroupAttendance(groupId, date),
  ]);
  const attMap = Object.fromEntries(existing.map(a=>[a.group_client_id, a.attended]));
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Посещаемость: ${fmtDate(date)}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div id="att-list">
      ${clients.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:14px">${c.name}</span>
        <input type="checkbox" id="att-${c.id}" ${attMap[c.id]?'checked':''} style="width:22px;height:22px">
      </div>`).join('')}
    </div>
    <input type="hidden" id="att-date" value="${date}">
    <input type="hidden" id="att-instance" value="${instanceId||''}">
    <button class="btn btn-primary btn-full" style="margin-top:12px"
      onclick="saveAttendanceByDate('${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}

// Посещаемость за другую дату
async function renderGroupAttendanceByDate(groupId) {
  const {data:tg} = await sb().from('trainer_groups')
    .select('group_instance_id').eq('id',groupId).single();
  const instanceId = tg?.group_instance_id||null;
  const clients = instanceId
    ? await DB.getGroupClientsByInstance(instanceId)
    : await DB.getGroupClients(groupId);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Посещаемость за дату</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дата</label>
      <input type="date" id="att-date" value="${todayStr()}" onchange="loadAttendanceForDate('${groupId}',this.value,'${instanceId||''}')"></div>
    <div id="att-list">
      ${clients.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <span>${c.name}</span>
        <input type="checkbox" id="att-${c.id}" style="width:20px;height:20px">
      </div>`).join('')}
    </div>
    <input type="hidden" id="att-instance" value="${instanceId||''}">
    <button class="btn btn-primary btn-full" style="margin-top:12px"
      onclick="saveAttendanceByDate('${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
  await loadAttendanceForDate(groupId, todayStr(), instanceId||'');
}
async function loadAttendanceForDate(groupId, date, instanceId='') {
  try {
    const existing = instanceId
      ? await DB.getGroupAttendanceByInstance(instanceId, date)
      : await DB.getGroupAttendance(groupId, date);
    const attMap = Object.fromEntries(existing.map(a=>[a.group_client_id, a.attended]));
    const clients = instanceId
      ? await DB.getGroupClientsByInstance(instanceId)
      : await DB.getGroupClients(groupId);
    clients.forEach(c=>{
      const cb = document.getElementById(`att-${c.id}`);
      if (cb) cb.checked = attMap[c.id]||false;
    });
  } catch(e) { console.error(e); }
}
async function saveAttendanceByDate(groupId) {
  const date = document.getElementById('att-date')?.value;
  const instanceId = document.getElementById('att-instance')?.value||null;
  if (!date) return toast('Выберите дату','error');
  const clients = instanceId
    ? await DB.getGroupClientsByInstance(instanceId)
    : await DB.getGroupClients(groupId);
  try {
    // Снимаем значения ДО удаления модала
    const checked = Object.fromEntries(clients.map(c=>[c.id, document.getElementById(`att-${c.id}`)?.checked||false]));
    await Promise.all(clients.map(c=>
      DB.saveGroupAttendance(groupId, c.id, date, checked[c.id], instanceId||null)
    ));
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Посещаемость сохранена','success');
    // Обновляем открытый экран группы (история/занятие), если правили из него
    const g = window._gd;
    if (g && String(g.groupId)===String(groupId)) {
      if (date===g.today) clients.forEach(c=>{ g.attMap[c.id] = checked[c.id]; });
      if (g._screen==='history'||g._screen==='session') refreshGroupScreen(groupId);
    }
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Добавить занятие взрослой группы вручную (за прошедшую дату)
function renderAddManualGroupSession(groupId) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить занятие</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дата</label>
      <input type="date" id="mgs-date" value="${todayStr()}"></div>
    <div class="form-group"><label>Явка (кол-во человек)</label>
      <input type="number" id="mgs-count" min="1" placeholder="0"></div>
    <button class="btn btn-primary btn-full" onclick="doAddManualGroupSession('${groupId}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddManualGroupSession(groupId) {
  const date = document.getElementById('mgs-date')?.value;
  const headcount = parseInt(document.getElementById('mgs-count')?.value||0);
  if (!date || !headcount) return toast('Заполните дату и явку','error');
  try {
    const {data:tg} = await sb().from('trainer_groups')
      .select('branch,group_type_id,trainer_id').eq('id',groupId).single();
    // Используем trainer_id из группы (не STATE.profile.id — координатор мог добавлять)
    const logTrainerId = tg?.trainer_id || STATE.profile.id;
    await DB.logGroupSession(logTrainerId, tg?.group_type_id, tg?.branch||'', date, headcount);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Занятие добавлено','success');
    renderAdultGroupHistory(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Редактировать занятие взрослой группы
function renderEditGroupSession(sessionId, date, headcount, groupId) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать занятие</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дата</label>
      <input type="date" id="egs-date" value="${date}"></div>
    <div class="form-group"><label>Явка (чел.)</label>
      <input type="number" id="egs-count" value="${headcount}" min="1"></div>
    <button class="btn btn-primary btn-full" onclick="doEditGroupSession('${sessionId}','${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditGroupSession(sessionId, groupId) {
  const date      = document.getElementById('egs-date')?.value;
  const headcount = parseInt(document.getElementById('egs-count')?.value||0);
  if (!date || !headcount) return toast('Заполните поля','error');
  try {
    await sb().from('group_sessions').update({session_date:date, headcount}).eq('id',sessionId);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Обновлено','success');
    renderAdultGroupHistory(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteGroupSession(sessionId, groupId) {
  if (!confirm('Удалить занятие?')) return;
  try {
    await sb().from('group_sessions').delete().eq('id',sessionId);
    toast('Удалено','success');
    renderAdultGroupHistory(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doDeleteAttendanceDay(groupId, date) {
  if (!confirm(`Удалить запись о занятии ${fmtDate(date)}?`)) return;
  if (_pending.has(`delday_${groupId}_${date}`)) return;
  _pending.add(`delday_${groupId}_${date}`);
  try {
    // instance_id из контекста — иначе удалялись бы только строки с group_id этого тренера
    const instId = (window._gd && String(window._gd.groupId)===String(groupId)) ? window._gd.instanceId : null;
    await DB.deleteGroupAttendanceDay(groupId, date, instId||null);
    toast('Занятие удалено','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(`delday_${groupId}_${date}`); }
}

function archiveAdultClientConfirm(id, nameEnc, groupId) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${name}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:16px">Архив — скрыть из группы. Удалить — навсегда.</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="doArchiveAdultClient('${id}','${groupId}')">📦 Архивировать</button>
      <button class="btn btn-full btn-danger"
        onclick="doDeleteAdultGroupClient('${id}','${groupId}')">🗑 Удалить навсегда</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
async function archiveAdultClient(id, groupId) {
  archiveAdultClientConfirm(id, encodeURIComponent('участник'), groupId);
}
async function doArchiveAdultClient(id, groupId) {
  document.querySelector('.modal-overlay')?.remove();
  try {
    await DB.archiveAdultGroupClient(id);
    toast('Архивирован','success');
    renderAdultGroupMembers(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteAdultGroupClient(id, groupId) {
  document.querySelector('.modal-overlay')?.remove();
  if (!confirm('Удалить безвозвратно?')) return;
  try {
    await DB.deleteAdultGroupClient(id);
    toast('Удалён','success');
    renderAdultGroupMembers(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function renderAdultGroupHeadcount(groupId) {
  try {
    const clients = await DB.getAdultGroupClients(groupId);
    const m = el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>Отметить занятие</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div style="display:flex;gap:8px">
        <div class="form-group" style="flex:1"><label>Дата</label>
          <input type="date" id="ag-hc-date" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="form-group" style="flex:1"><label>Время начала</label>
          <select id="ag-hc-time" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)">
            ${Array.from({length:14},(_,i)=>{const h=7+i;return `<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}:00</option>`;}).join('')}
          </select></div>
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:13px;font-weight:600">Кто был:</label>
        ${clients.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <span>${c.name}</span>
          <input type="checkbox" id="hc-${c.id}" style="width:20px;height:20px">
        </div>`).join('')}
        ${!clients.length?`<div class="form-group" style="margin-top:8px"><label>Или введите количество вручную</label>
          <input type="number" id="ag-hc-count" min="0" placeholder="0"></div>`:''}
      </div>
      <button class="btn btn-primary btn-full" onclick="doLogAdultGroupSession('${groupId}')">Записать</button>
    </div>`;
    document.body.appendChild(m);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doLogAdultGroupSession(groupId) {
  const date = document.getElementById('ag-hc-date')?.value;
  const clients = await DB.getAdultGroupClients(groupId);
  let headcount = 0;
  const clientIds = [];
  if (clients.length) {
    clients.forEach(c=>{
      if (document.getElementById(`hc-${c.id}`)?.checked) {
        headcount++;
        clientIds.push(c.id);
      }
    });
  } else {
    headcount = parseInt(document.getElementById('ag-hc-count')?.value)||0;
  }
  if (!headcount) return toast('Укажите хотя бы одного участника','error');
  const time = document.getElementById('ag-hc-time')?.value||'09:00';
  try {
    const {data:tg} = await sb().from('trainer_groups')
      .select('branch,group_type_id').eq('id',groupId).single();
    await DB.logGroupSession(STATE.profile.id, tg?.group_type_id||null, tg?.branch||STATE.profile.branches?.[0]||'', date, headcount);
    DB.auditLog('group_session', STATE.profile.id, STATE.profile.fio, groupId, 'group_session',
      { date, headcount, branch: tg?.branch }, tg?.branch||STATE.profile.branches?.[0]);
    document.querySelector('.modal-overlay')?.remove();
    const rate = headcount>=7?130000:headcount>=4?120000:110000;
    toast(`Записано: ${headcount} чел. · ${(rate/1000).toFixed(0)}к сум · ${time} ✅`,'success');
    // Обновляем хаб, чтобы счётчик занятий/сумма за месяц подтянулись
    if (typeof renderAdultGroupDetail==='function') renderAdultGroupDetail(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── СВОДНОЕ РАСПИСАНИЕ КООРДИНАТОРА ──────────────────────────────────────────

async function renderCoordinatorSchedule() {
  const branches = (await cached('branches',()=>DB.getBranches())).map(b=>b.name);
  let selBranch = branches[0]||'';
  
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>📅 Расписание</h3>
      <div class="month-nav">
        <button id="cs-prev">‹</button>
        <span id="cs-week-label"></span>
        <button id="cs-next">›</button>
      </div>
    </div>
    ${branches.length>1?`<select id="cs-branch" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);margin-bottom:12px"
      onchange="selBranch=this.value;window._csLoad&&window._csLoad()">
      ${branches.map(b=>`<option>${b}</option>`).join('')}
    </select>`:''}
    <div id="cs-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;

  let weekOffset = 0;

  const load = async () => {
    window._csLoad = load; // делаем доступной из onchange
    const body = document.getElementById('cs-body'); if (!body) return;
    const branch = document.getElementById('cs-branch')?.value || selBranch;
    const now = new Date();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (now.getDay()+6)%7 + weekOffset*7);
    mon.setHours(0,0,0,0);
    const sun = new Date(mon); sun.setDate(mon.getDate()+6);
    
    const label = document.getElementById('cs-week-label');
    if (label) label.textContent = `${mon.getDate()}.${mon.getMonth()+1} – ${sun.getDate()}.${sun.getMonth()+1}`;
    
    body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
    try {
      const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
      const trainers = (await cached('profiles',()=>DB.getAllProfiles())).filter(t=>
        ['trainer','senior_trainer'].includes(t.role) &&
        (t.branches||[]).includes(branch)
      );
      
      const from = mon.toISOString();
      const to   = sun.toISOString();
      
      // Load duties for the week for this branch
      const dutiesRes = await DB.getDutiesForSchedule(branch, from, to);
      const duties = dutiesRes||[];

      let html = '';
      for (let d=0; d<7; d++) {
        const day = new Date(mon); day.setDate(mon.getDate()+d);
        const dayStr = day.toISOString().slice(0,10);
        const dayDuties = duties.filter(duty=>duty.start_time?.slice(0,10)===dayStr);
        html += `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:11px;font-weight:600;color:var(--hint);margin-bottom:4px">${DAYS[d]} ${day.getDate()}.${day.getMonth()+1}</div>
          ${dayDuties.length?dayDuties.map(duty=>{
            const h = ((new Date(duty.end_time)-new Date(duty.start_time))/3600000).toFixed(1);
            const start = new Date(duty.start_time).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
            const end   = new Date(duty.end_time).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
            return `<div style="font-size:12px;padding:2px 0;color:var(--text)">
              🟢 ${duty.profiles?.fio||'?'} · ${start}–${end} · ${h}ч</div>`;
          }).join(''):`<div style="font-size:11px;color:var(--hint);padding:2px 0">Нет дежурств</div>`}
        </div>`;
      }
      body.innerHTML = html;
    } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
  };

  document.getElementById('cs-prev')?.addEventListener('click',()=>{ weekOffset--; load(); });
  document.getElementById('cs-next')?.addEventListener('click',()=>{ weekOffset++; load(); });
  await load();
}


function renderEditGroupTypeModal(id, nameEnc, type, price, pct) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать тип</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label>
      <input id="egt-name" value="${name}"></div>
    <div class="form-group"><label>Тип</label>
      <select id="egt-type" onchange="onGtTypeChange(this.value)" disabled>
        <option value="children" ${type==='children'?'selected':''}>👶 Детская</option>
        <option value="adult" ${type==='adult'?'selected':''}>🏊 Взрослая</option>
      </select></div>
    ${type==='children'?`
    <div class="form-group"><label>Стоимость (сум/мес)</label>
      <input id="egt-price" type="number" value="${price}"></div>
    <div class="form-group"><label>% тренеру</label>
      <input id="egt-pct" type="number" value="${pct}"></div>`:
    `<div style="background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint)">
      Ставки: 1-3 чел = 110к · 4-6 = 120к · 7+ = 130к</div>`}
    <button class="btn btn-primary btn-full" style="margin-top:16px"
      onclick="doEditGroupType(${id},'${type}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditGroupType(id, type) {
  const name  = document.getElementById('egt-name')?.value.trim();
  const price = parseInt(document.getElementById('egt-price')?.value||0);
  const pct   = parseInt(document.getElementById('egt-pct')?.value||40);
  if (!name) return toast('Введите название','error');
  try {
    await DB.updateGroupType(id, {
      name,
      price_per_month: type==='children' ? price : 0,
      trainer_percentage: type==='children' ? pct : 0
    });
    document.querySelector('.modal-overlay')?.remove();
    toast('Обновлено ✅','success');
    loadGroupsList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteGroupType(id, nameEnc) {
  const name = decodeURIComponent(nameEnc);
  if (!confirm(`Удалить тип группы «${name}»?\nВсе назначения тренеров будут откреплены.`)) return;
  try {
    await DB.deleteGroupType(id);
    toast('Удалено','success');
    loadGroupsList();
  } catch(e) { toast('Ошибка — возможно есть назначенные тренеры','error'); console.error(e); }
}
window.addEventListener('DOMContentLoaded', init);
