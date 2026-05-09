// =============================================
// TWA «Лист тренера» v2 — Главный файл
// =============================================

// ==================== СОСТОЯНИЕ ====================

const STATE = {
  tgId:       null,
  profile:    null,
  activeDuty: null,
  dutyTimer:  null,
  currentTab: null,
};

// ==================== УТИЛИТЫ ====================

const $  = sel => document.querySelector(sel);
const $$ = sel => [...document.querySelectorAll(sel)];

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls)            e.className   = cls;
  if (html != null)   e.innerHTML   = html;
  return e;
}

function fmt(n)       { return Number(n).toLocaleString('ru-RU'); }
function fmtDate(d)   { return new Date(d).toLocaleDateString('ru-RU', { day:'2-digit', month:'2-digit', year:'2-digit' }); }
function fmtTime(d)   { return new Date(d).toLocaleTimeString('ru-RU', { hour:'2-digit', minute:'2-digit' }); }
function fmtDT(d)     { return `${fmtDate(d)} ${fmtTime(d)}`; }
function fmtMY(y,m)   { return new Date(y, m-1).toLocaleDateString('ru-RU', { month:'long', year:'numeric' }); }
function todayStr()   { return new Date().toISOString().slice(0,10); }
function localDT(daysOffset=0) {
  const d = new Date(); d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0,16);
}

function hoursFromDuty(s, e) { return (new Date(e) - new Date(s)) / 3600000; }
function canEdit(createdAt)   { return (Date.now() - new Date(createdAt)) < EDIT_WINDOW_MIN * 60000; }

function isValidWorkoutDate(dateStr) {
  const diff = Date.now() - new Date(dateStr).getTime();
  return diff >= 0 && diff <= MAX_BACKDATE_HOURS * 3600000;
}

function getBranchForUser() {
  const sel    = document.getElementById('sel-branch');
  const hidden = document.getElementById('branch-val');
  return sel?.value || hidden?.value || STATE.profile?.branches?.[0] || '';
}

function toast(msg, type = 'info') {
  const t = el('div', `toast toast-${type}`, msg);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3200);
}

function setScreen(html)  { $('#app').innerHTML = html; }
function loading(txt='Загрузка...') {
  setScreen(`<div class="center-screen"><div class="spinner"></div><p>${txt}</p></div>`);
}

function setupBack(cb) {
  if (!window.Telegram?.WebApp?.BackButton) return;
  if (cb) { Telegram.WebApp.BackButton.show(); Telegram.WebApp.BackButton.onClick(cb); }
  else    { Telegram.WebApp.BackButton.hide(); }
}

function branchSelect(id, branches) {
  if (branches.length === 1)
    return `<input type="hidden" id="${id}" value="${branches[0]}">`;
  return `<div class="form-group"><label>Филиал</label>
    <select id="${id}">${branches.map(b=>`<option>${b}</option>`).join('')}</select></div>`;
}

// Расчёт зарплаты за период
function calcSalary({ workouts=[], duties=[], trainerGroups=[], groupSessions=[] }) {
  const cat = { 1:0, 2:0, 3:0, debt:0 };
  workouts.forEach(w => {
    if (w.is_debt && !w.debt_confirmed_at) cat.debt++;
    else cat[w.category_at_moment]++;
  });
  const ptSum   = cat[1]*RATES.pt[1] + cat[2]*RATES.pt[2] + cat[3]*RATES.pt[3];
  const hours   = duties.reduce((s,d) => s + hoursFromDuty(d.start_time, d.end_time), 0);
  const dutySum = Math.round(hours * RATES.duty_per_hour);

  // Детские группы (фиксированный %)
  const childSum = trainerGroups
    .filter(tg => tg.group_types?.type === 'children')
    .reduce((s, tg) => s + Math.round((tg.group_types.price_per_month||0) * RATES.group_children_percentage), 0);

  // Взрослые группы (по явке)
  const adultSum = groupSessions
    .filter(gs => gs.group_types?.billing_model === 'headcount')
    .reduce((s, gs) => s + getAdultGroupRate(gs.headcount), 0);

  return { cat, hours, ptSum, dutySum, childSum, adultSum,
           total: ptSum + dutySum + childSum + adultSum };
}

// ==================== ИНИЦИАЛИЗАЦИЯ ====================

async function init() {
  if (window.Telegram?.WebApp) { Telegram.WebApp.ready(); Telegram.WebApp.expand(); }

  STATE.tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || null;

  if (!STATE.tgId) {
    const saved = localStorage.getItem('dev_tg_id');
    if (saved) { STATE.tgId = parseInt(saved); }
    else {
      const id = prompt('Dev mode: Telegram ID (118803972=admin)');
      if (!id) return toast('Нет Telegram ID', 'error');
      STATE.tgId = parseInt(id);
      localStorage.setItem('dev_tg_id', STATE.tgId);
    }
  }

  loading('Проверяем аккаунт...');
  try {
    const profile = await DB.getProfileByTgId(STATE.tgId);
    if (!profile) { renderRegister(); return; }
    STATE.profile = profile;
    if (profile.pincode) renderPinEntry();
    else enterApp();
  } catch (e) {
    toast('Ошибка подключения', 'error'); console.error(e);
  }
}

async function enterApp() {
  const role = STATE.profile.role;
  if (role === 'admin')          renderAdminApp();
  else if (role === 'senior_trainer') renderSeniorApp();
  else                           renderTrainerApp();
}

// ==================== AUTH: РЕГИСТРАЦИЯ ====================

function renderRegister() {
  setupBack(null);
  setScreen(`
    <div class="screen-pad">
      <div class="logo">🏋️</div>
      <h1>Первый вход</h1>
      <p class="hint">Введите ФИО точно так же, как внёс координатор.</p>
      <div class="form-group"><label>ФИО</label>
        <input id="reg-fio" type="text" placeholder="Иванов Иван Иванович" autocomplete="name"></div>
      <div class="form-group"><label>PIN-код (4 цифры)</label>
        <input id="reg-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <div class="form-group"><label>Повторите PIN</label>
        <input id="reg-pin2" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
      <button class="btn btn-primary btn-full" onclick="doRegister()">Войти</button>
    </div>`);
}

async function doRegister() {
  const fio  = $('#reg-fio')?.value.trim();
  const pin  = $('#reg-pin')?.value.trim();
  const pin2 = $('#reg-pin2')?.value.trim();
  if (!fio)              return toast('Введите ФИО', 'error');
  if (!/^\d{4}$/.test(pin)) return toast('PIN: ровно 4 цифры', 'error');
  if (pin !== pin2)      return toast('PIN не совпадает', 'error');
  loading('Ищем профиль...');
  try {
    const p = await DB.getUnclaimedProfileByFio(fio);
    if (!p) { renderRegister(); return toast('ФИО не найдено или уже занято', 'error'); }
    STATE.profile = await DB.claimProfile(p.id, STATE.tgId, pin);
    toast('Аккаунт привязан!', 'success');
    enterApp();
  } catch (e) { renderRegister(); toast('Ошибка регистрации', 'error'); console.error(e); }
}

// ==================== AUTH: PIN ====================

function renderPinEntry() {
  setupBack(null);
  window._pin = '';
  setScreen(`
    <div class="screen-pad center-screen">
      <div class="logo">🔐</div>
      <h2>Привет, ${STATE.profile.fio.split(' ')[1] || STATE.profile.fio}!</h2>
      <div class="pin-dots" id="pin-dots">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k =>
          `<button class="pin-key ${k===''?'pin-key-empty':''}" onclick="pinKey('${k}')">${k}</button>`
        ).join('')}
      </div>
    </div>`);
}

function pinKey(k) {
  if (k === '⌫')                            window._pin = window._pin.slice(0,-1);
  else if (k !== '' && window._pin.length < 4) window._pin += k;
  $$('#pin-dots span').forEach((d,i) => d.className = i < window._pin.length ? 'filled' : '');
  if (window._pin.length === 4) {
    if (window._pin === STATE.profile.pincode) { toast('Добро пожаловать!','success'); enterApp(); }
    else { toast('Неверный PIN','error'); window._pin=''; $$('#pin-dots span').forEach(d=>d.className=''); }
  }
}

// ==================== ТРЕНЕР: ОБОЛОЧКА ====================

async function renderTrainerApp() {
  setupBack(null);
  STATE.activeDuty = await DB.getActiveDuty(STATE.profile.id);
  renderTrainerShell('workouts');
}

function renderTrainerShell(tab) {
  STATE.currentTab = tab;
  setScreen(`
    <div class="app-header">
      <div><div class="app-title">🏋️ Лист тренера</div>
        <div class="app-sub">${STATE.profile.fio}</div></div>
      ${STATE.activeDuty ? '<div class="duty-badge active">● Дежурство</div>' : ''}
    </div>
    <div id="tab-content" class="tab-content"></div>
    <nav class="bottom-nav">
      <button class="nav-btn" onclick="switchTab('workouts')"><span>📋</span>Списание</button>
      <button class="nav-btn" onclick="switchTab('schedule')"><span>📅</span>Расписание</button>
      <button class="nav-btn" onclick="switchTab('today')"><span>✅</span>Сегодня</button>
      <button class="nav-btn" onclick="switchTab('duty')"><span>⏱</span>Дежурство</button>
      <button class="nav-btn" onclick="switchTab('report')"><span>📊</span>Отчёт</button>
    </nav>`);
  switchTab(tab);
}

function switchTab(tab) {
  STATE.currentTab = tab;
  const tabs = ['workouts','schedule','today','duty','report'];
  $$('.nav-btn').forEach((b,i) => b.classList.toggle('active', tabs[i] === tab));
  if (tab === 'workouts')  renderWorkoutsTab();
  if (tab === 'schedule')  renderScheduleTab();
  if (tab === 'today')     renderTodayTab();
  if (tab === 'duty')      renderDutyTab();
  if (tab === 'report')    renderReportTab();
}

// ==================== ТАБ: СПИСАНИЕ ПТ ====================

async function renderWorkoutsTab() {
  $('#tab-content').innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  const clients  = await DB.getClients(STATE.profile.id);
  const branches = STATE.profile.branches || [];

  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header">
        <h3>Списать ПТ</h3>
        <button class="btn btn-sm" onclick="renderAddClientModal()">+ Клиент</button>
      </div>
      ${branchSelect('sel-branch', branches)}
      <div class="form-group"><label>Клиент</label>
        <select id="wk-client" onchange="onClientChange(this)">
          <option value="">— выберите —</option>
          ${clients.map(c => `<option value="${c.id}" data-cat="${c.category}" data-bal="${c.balance}">
            ${c.fio} (кат.${c.category}, баланс: ${c.balance})</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Количество ПТ</label>
        <select id="wk-count" onchange="renderDateFields()">
          ${[1,2,3,4,5].map(n=>`<option>${n}</option>`).join('')}
        </select>
      </div>
      <div id="wk-dates"></div>
      <div id="wk-notes-wrap" style="display:none" class="form-group">
        <label>Примечание <span class="required">*</span></label>
        <textarea id="wk-notes" rows="2" placeholder="Причина пакетного списания"></textarea>
      </div>

      <div class="debt-toggle">
        <label class="toggle-row">
          <input type="checkbox" id="wk-debt" onchange="toggleDebt(this)">
          <span class="toggle-track"><span class="toggle-thumb"></span></span>
          <span>Тренировка проведена в долг (не оплачена)</span>
        </label>
      </div>

      <button class="btn btn-primary btn-full" onclick="doLogWorkout()">Списать</button>

      ${clients.filter(c=>c.balance===0).length?`<p class="hint" style="margin-top:12px;text-align:center">
        ⚠️ Клиенты с нулевым балансом выделены</p>`:''}
    </div>`;

  renderDateFields();
}

function onClientChange(sel) {
  const bal = parseInt(sel.options[sel.selectedIndex]?.dataset.bal || '1');
  if (sel.value && bal <= 0) toast('⚠️ У клиента нулевой баланс!', 'error');
}

function toggleDebt(cb) {
  const wrap = document.getElementById('debt-note-wrap');
  if (wrap) wrap.style.display = cb.checked ? '' : 'none';
}

function renderDateFields() {
  const count = parseInt($('#wk-count')?.value || 1);
  const notesWrap = $('#wk-notes-wrap');
  if (notesWrap) notesWrap.style.display = count > 1 ? '' : 'none';
  const div = $('#wk-dates');
  if (!div) return;
  div.innerHTML = Array.from({length:count}, (_,i) => `
    <div class="form-group">
      <label>${count > 1 ? `ПТ №${i+1} — ` : ''}Дата и время</label>
      <input type="datetime-local" id="wk-date-${i}" value="${localDT(-i)}">
    </div>`).join('');
}

async function doLogWorkout() {
  const clientSel = $('#wk-client');
  const clientId  = clientSel?.value;
  if (!clientId) return toast('Выберите клиента', 'error');

  const category = parseInt(clientSel.options[clientSel.selectedIndex].dataset.cat);
  const count    = parseInt($('#wk-count')?.value || 1);
  const branch   = getBranchForUser();
  if (!branch)   return toast('Выберите филиал', 'error');

  const isDebt  = document.getElementById('wk-debt')?.checked || false;
  const notes   = $('#wk-notes')?.value.trim() || '';
  if (count > 1 && !notes) return toast('Введите примечание для пакетного списания', 'error');

  const dates = [];
  for (let i = 0; i < count; i++) {
    const v = document.getElementById(`wk-date-${i}`)?.value;
    if (!v) return toast(`Введите дату для ПТ №${i+1}`, 'error');
    if (!isValidWorkoutDate(v)) return toast(`ПТ №${i+1}: нельзя ставить дату старше 24 часов`, 'error');
    dates.push(v);
  }

  const rows = dates.map(d => ({
    trainer_id: STATE.profile.id, client_id: clientId,
    category_at_moment: category, branch,
    workout_date: new Date(d).toISOString(),
    notes: notes || null, is_debt: isDebt,
  }));

  try {
    await DB.logWorkouts(rows);
    toast(isDebt ? `✅ ${count} ПТ записано в долг` : `✅ ${count} ПТ списано!`, 'success');
    renderWorkoutsTab();
  } catch(e) { toast('Ошибка при списании', 'error'); console.error(e); }
}

// Модал: добавить клиента
function renderAddClientModal() {
  const m = el('div','modal-overlay');
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>Новый клиент</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group"><label>ФИО</label>
        <input id="nc-fio" type="text" placeholder="Петрова Анна"></div>
      <div class="form-group"><label>Категория</label>
        <div class="cat-picker">
          ${[1,2,3].map(n=>`<button class="cat-btn ${n===1?'active':''}" data-cat="${n}"
            onclick="selectCat(this)">Кат.${n}<br><small>${fmt(RATES.pt[n])} сум</small></button>`).join('')}
        </div>
      </div>
      <div class="form-group"><label>Начальный баланс</label>
        <input id="nc-balance" type="number" min="0" value="0"></div>
      <button class="btn btn-primary btn-full" onclick="doAddClient()">Добавить</button>
    </div>`;
  document.body.appendChild(m);
}

function selectCat(btn) { $$('.cat-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }

async function doAddClient() {
  const fio = $('#nc-fio')?.value.trim();
  const cat = parseInt(document.querySelector('.cat-btn.active')?.dataset.cat || '1');
  const bal = parseInt($('#nc-balance')?.value || '0');
  if (!fio) return toast('Введите ФИО', 'error');
  try {
    const client = await DB.addClient(fio, cat, STATE.profile.id);
    if (bal > 0) await DB.addBalance(client.id, bal);
    document.querySelector('.modal-overlay')?.remove();
    toast('Клиент добавлен', 'success');
    renderWorkoutsTab();
  } catch(e) { toast('Ошибка', 'error'); console.error(e); }
}

// ==================== ТАБ: РАСПИСАНИЕ ====================

async function renderScheduleTab() {
  $('#tab-content').innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const slots = await DB.getSlots(STATE.profile.id);
    const grid  = buildGrid(slots);
    const branches = STATE.profile.branches || [];

    $('#tab-content').innerHTML = `
      <div class="tab-pad">
        <div class="section-header">
          <h3>Моё расписание</h3>
          <button class="btn btn-sm" onclick="renderAddSlotModal()">+ Слот</button>
        </div>
        <p class="hint" style="margin-bottom:12px">Еженедельное. Нажмите слот для удаления.</p>
        <div class="schedule-scroll">
          <table class="sched-table">
            <thead>
              <tr><th class="sched-time-col"></th>
              ${DAYS_SHORT.map(d=>`<th>${d}</th>`).join('')}</tr>
            </thead>
            <tbody>
              ${SCHEDULE_HOURS.map(h => `
                <tr>
                  <td class="sched-time">${h}</td>
                  ${[0,1,2,3,4,5,6].map(dow => {
                    const daySlots = grid[dow]?.[h] || [];
                    return `<td class="sched-cell">
                      ${daySlots.map(s => `
                        <div class="slot-pill" style="background:${SLOT_COLORS[s.slot_type].bg};color:${SLOT_COLORS[s.slot_type].color}"
                          onclick="confirmDeleteSlot('${s.id}','${s.slot_type}')">
                          ${s.slot_type === 'pt' ? (s.clients?.fio?.split(' ')[0] || 'ПТ') :
                            s.slot_type === 'group' ? (s.group_types?.name || 'Гр') : 'Деж'}
                        </div>`).join('')}
                    </td>`;
                  }).join('')}
                </tr>`).join('')}
            </tbody>
          </table>
        </div>
        <div class="legend">
          ${Object.entries(SLOT_COLORS).map(([k,v])=>
            `<span class="legend-item" style="background:${v.bg};color:${v.color}">${v.label}</span>`
          ).join('')}
        </div>
      </div>`;
  } catch(e) { toast('Ошибка загрузки расписания','error'); console.error(e); }
}

function buildGrid(slots) {
  const grid = {};
  slots.forEach(s => {
    const dow = s.day_of_week;
    const hour = s.start_time.slice(0,5); // HH:MM
    const hKey = hour.slice(0,2) + ':00';
    if (!grid[dow]) grid[dow] = {};
    if (!grid[dow][hKey]) grid[dow][hKey] = [];
    grid[dow][hKey].push(s);
  });
  return grid;
}

async function confirmDeleteSlot(id, type) {
  if (!confirm(`Удалить этот слот (${SLOT_COLORS[type].label})?`)) return;
  try {
    await DB.deactivateSlot(id);
    toast('Слот удалён', 'success');
    renderScheduleTab();
  } catch(e) { toast('Ошибка','error'); }
}

async function renderAddSlotModal() {
  const branches  = STATE.profile.branches || [];
  const clients   = await DB.getClients(STATE.profile.id);
  const groupList = await DB.getTrainerGroups(STATE.profile.id);

  const m = el('div','modal-overlay');
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>Добавить слот</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      ${branchSelect('slot-branch', branches)}
      <div class="form-group"><label>День недели</label>
        <select id="slot-dow">
          ${DAYS_FULL.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}
        </select>
      </div>
      <div class="form-group" style="display:flex;gap:10px">
        <div style="flex:1"><label>Начало</label>
          <input type="time" id="slot-start" value="09:00"></div>
        <div style="flex:1"><label>Конец</label>
          <input type="time" id="slot-end" value="10:00"></div>
      </div>
      <div class="form-group"><label>Тип</label>
        <select id="slot-type" onchange="onSlotTypeChange(this)">
          <option value="duty">Дежурство</option>
          <option value="pt">ПТ (персональная)</option>
          <option value="group">Группа</option>
        </select>
      </div>
      <div id="slot-extra"></div>
      <button class="btn btn-primary btn-full" onclick="doAddSlot(${JSON.stringify(clients).replace(/"/g,'&quot;')}, ${JSON.stringify(groupList.map(g=>({id:g.group_type_id,name:g.group_types?.name}))).replace(/"/g,'&quot;')})">
        Добавить</button>
    </div>`;
  document.body.appendChild(m);
  onSlotTypeChange(document.getElementById('slot-type'));
  // Store data for use in onSlotTypeChange
  window._slotClients   = clients;
  window._slotGroupList = groupList;
}

function onSlotTypeChange(sel) {
  const extra = document.getElementById('slot-extra');
  if (!extra) return;
  const clients   = window._slotClients   || [];
  const groupList = window._slotGroupList || [];

  if (sel.value === 'pt') {
    extra.innerHTML = `<div class="form-group"><label>Клиент</label>
      <select id="slot-client">
        <option value="">— выберите клиента —</option>
        ${clients.map(c=>`<option value="${c.id}">${c.fio}</option>`).join('')}
      </select></div>`;
  } else if (sel.value === 'group') {
    extra.innerHTML = `
      <div class="form-group"><label>Тип группы</label>
        <select id="slot-group">
          <option value="">— выберите —</option>
          ${groupList.map(g=>`<option value="${g.group_type_id}">${g.group_types?.name||'?'}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Средняя явка (чел.)</label>
        <input type="number" id="slot-headcount" min="1" value="5"></div>`;
  } else {
    extra.innerHTML = '';
  }
}

async function doAddSlot() {
  const branch   = document.getElementById('slot-branch')?.value || STATE.profile.branches?.[0] || '';
  const dow      = parseInt(document.getElementById('slot-dow')?.value || '0');
  const start    = document.getElementById('slot-start')?.value;
  const end      = document.getElementById('slot-end')?.value;
  const type     = document.getElementById('slot-type')?.value;
  const clientId = document.getElementById('slot-client')?.value || null;
  const groupId  = document.getElementById('slot-group')?.value  || null;
  const headcount= parseInt(document.getElementById('slot-headcount')?.value || '0');

  if (!start || !end) return toast('Укажите время', 'error');
  if (start >= end)   return toast('Конец должен быть позже начала', 'error');
  if (type === 'pt'   && !clientId) return toast('Выберите клиента', 'error');
  if (type === 'group'&& !groupId)  return toast('Выберите группу', 'error');

  try {
    await DB.addSlot({
      trainer_id: STATE.profile.id, branch, day_of_week: dow,
      start_time: start, end_time: end, slot_type: type,
      client_id:     type === 'pt'    ? clientId : null,
      group_type_id: type === 'group' ? parseInt(groupId) : null,
      avg_headcount: type === 'group' ? headcount : null,
    });
    document.querySelector('.modal-overlay')?.remove();
    toast('Слот добавлен', 'success');
    renderScheduleTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ==================== ТАБ: СЕГОДНЯ ====================

async function renderTodayTab() {
  $('#tab-content').innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  const date = todayStr();
  const dayName = DAYS_FULL[(new Date().getDay() + 6) % 7];

  try {
    const slots = await DB.getTodaySlots(STATE.profile.id, date);
    const ptSlots    = slots.filter(s => s.slot_type === 'pt');
    const groupSlots = slots.filter(s => s.slot_type === 'group');
    const dutySlots  = slots.filter(s => s.slot_type === 'duty');
    const pending    = slots.filter(s => !s.confirmation && s.slot_type !== 'duty').length;

    $('#tab-content').innerHTML = `
      <div class="tab-pad">
        <div class="section-header">
          <div><h3>Сегодня</h3><p class="hint">${dayName}</p></div>
          ${pending > 0 ? `<div class="pending-badge">${pending} не закрыто</div>` : ''}
        </div>

        ${dutySlots.length ? `
          <h4>Дежурство</h4>
          ${dutySlots.map(s=>`
            <div class="today-card duty-card">
              <span class="today-time">${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</span>
              <span>Дежурство · ${s.branch}</span>
            </div>`).join('')}` : ''}

        ${ptSlots.length ? `
          <h4>Персональные тренировки</h4>
          ${ptSlots.map(s => renderTodaySlot(s, date)).join('')}` : ''}

        ${groupSlots.length ? `
          <h4>Групповые занятия</h4>
          ${groupSlots.map(s => renderTodaySlot(s, date)).join('')}` : ''}

        ${!slots.length ? '<div class="empty-state">📭<p>На сегодня занятий нет</p></div>' : ''}
      </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function renderTodaySlot(s, date) {
  const conf   = s.confirmation;
  const status = conf?.status || 'pending';
  const label  = s.slot_type === 'pt'
    ? (s.clients?.fio || 'Клиент не указан')
    : (s.group_types?.name || 'Группа');
  const timeStr = `${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`;
  const isAdult = s.group_types?.billing_model === 'headcount';

  if (status === 'confirmed') return `
    <div class="today-card confirmed-card">
      <div class="today-card-row">
        <span class="today-time">${timeStr}</span>
        <span class="today-label">${label}</span>
        <span class="status-badge confirmed">✓ Подтверждено</span>
      </div>
      ${conf?.actual_headcount ? `<div class="today-sub">Явка: ${conf.actual_headcount} чел.</div>` : ''}
    </div>`;

  if (status === 'cancelled') return `
    <div class="today-card cancelled-card">
      <div class="today-card-row">
        <span class="today-time">${timeStr}</span>
        <span class="today-label">${label}</span>
        <span class="status-badge cancelled">✗ Отменено</span>
      </div>
      ${conf?.cancel_reason ? `<div class="today-sub">${conf.cancel_reason}</div>` : ''}
    </div>`;

  // pending
  return `
    <div class="today-card pending-card" id="today-${s.id}">
      <div class="today-card-row">
        <span class="today-time">${timeStr}</span>
        <span class="today-label">${label}</span>
        <span class="status-badge pending">Ожидает</span>
      </div>
      ${s.clients?.balance === 0 ? '<div class="today-sub warn-text">⚠️ Нулевой баланс</div>' : ''}
      ${isAdult ? `
        <div class="form-group" style="margin:8px 0 0">
          <label>Явка (чел.)</label>
          <input type="number" id="hc-${s.id}" min="1" max="50" value="5" style="width:80px">
        </div>` : ''}
      <div class="today-actions">
        <button class="btn btn-sm btn-primary" onclick="doConfirm('${s.id}','${date}',${s.slot_type==='pt'},${isAdult},'${s.client_id||''}',${s.category_at_moment||1},'${s.branch}')">
          Подтвердить</button>
        <button class="btn btn-sm btn-danger" onclick="doCancelSlot('${s.id}','${date}')">
          Отменить</button>
      </div>
    </div>`;
}

async function doConfirm(slotId, date, isPt, isAdult, clientId, category, branch) {
  const headcount = isAdult ? parseInt(document.getElementById(`hc-${slotId}`)?.value || 5) : null;

  try {
    let workoutId = null;
    if (isPt && clientId) {
      // Создаём запись ПТ
      const rows = [{
        trainer_id: STATE.profile.id, client_id: clientId,
        category_at_moment: category, branch,
        workout_date: new Date().toISOString(), is_debt: false,
      }];
      const w = await DB.logWorkouts(rows);
      workoutId = w?.[0]?.id;
    }
    if (isAdult) {
      // Логируем занятие группы
      const { data: slot } = await sb().from('schedule_slots').select('group_type_id').eq('id',slotId).single();
      if (slot?.group_type_id) {
        await DB.logGroupSession(STATE.profile.id, slot.group_type_id, branch, date, headcount);
      }
    }
    await DB.upsertConfirmation(slotId, date, {
      status: 'confirmed', actual_headcount: headcount, workout_id: workoutId,
    });
    toast('Занятие подтверждено ✅', 'success');
    renderTodayTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function doCancelSlot(slotId, date) {
  const m = el('div','modal-overlay');
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>Причина отмены</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group"><label>Укажите причину</label>
        <textarea id="cancel-reason" rows="3" placeholder="Клиент отменил, болезнь и т.д."></textarea>
      </div>
      <button class="btn btn-danger btn-full" onclick="doConfirmCancel('${slotId}','${date}')">Отменить занятие</button>
    </div>`;
  document.body.appendChild(m);
}

async function doConfirmCancel(slotId, date) {
  const reason = document.getElementById('cancel-reason')?.value.trim() || '';
  try {
    await DB.upsertConfirmation(slotId, date, { status:'cancelled', cancel_reason: reason || null });
    document.querySelector('.modal-overlay')?.remove();
    toast('Занятие отменено', 'success');
    renderTodayTab();
  } catch(e) { toast('Ошибка','error'); }
}

// ==================== ТАБ: ДЕЖУРСТВО ====================

async function renderDutyTab() {
  const branches = STATE.profile.branches || [];
  const duty     = STATE.activeDuty;

  if (duty) {
    $('#tab-content').innerHTML = `
      <div class="tab-pad center-col">
        <div class="duty-active-card">
          <div class="duty-icon">⏱</div>
          <div class="duty-branch">${duty.branch}</div>
          <div class="duty-timer" id="duty-timer">00:00:00</div>
          <div class="duty-start">Начало: ${fmtDT(duty.start_time)}</div>
        </div>
        <button class="btn btn-danger btn-full" onclick="doEndDuty('${duty.id}')">Завершить дежурство</button>
      </div>`;
    startDutyTimer(duty.start_time);
  } else {
    $('#tab-content').innerHTML = `
      <div class="tab-pad center-col">
        <div class="duty-idle-card"><div class="duty-icon">🏃</div><p>Дежурство не начато</p></div>
        ${branchSelect('sel-branch', branches)}
        <button class="btn btn-primary btn-full" onclick="doStartDuty()">Начать дежурство</button>
      </div>`;
  }
}

function startDutyTimer(start) {
  if (STATE.dutyTimer) clearInterval(STATE.dutyTimer);
  const tick = () => {
    const el = document.getElementById('duty-timer'); if (!el) return;
    const s  = Math.floor((Date.now() - new Date(start)) / 1000);
    el.textContent = [Math.floor(s/3600), Math.floor((s%3600)/60), s%60]
      .map(n=>String(n).padStart(2,'0')).join(':');
  };
  tick(); STATE.dutyTimer = setInterval(tick, 1000);
}

async function doStartDuty() {
  const branch = getBranchForUser();
  if (!branch) return toast('Выберите филиал', 'error');
  try {
    STATE.activeDuty = await DB.startDuty(STATE.profile.id, branch);
    toast('Дежурство начато', 'success');
    renderTrainerShell('duty');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doEndDuty(id) {
  if (!confirm('Завершить дежурство?')) return;
  if (STATE.dutyTimer) clearInterval(STATE.dutyTimer);
  try {
    const d = await DB.endDuty(id);
    const h = hoursFromDuty(d.start_time, d.end_time);
    STATE.activeDuty = null;
    toast(`✅ ${h.toFixed(1)}ч = ${fmt(Math.round(h*RATES.duty_per_hour))} сум`, 'success');
    renderTrainerShell('duty');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ==================== ТАБ: ОТЧЁТ ТРЕНЕРА ====================

async function renderReportTab() {
  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth()+1;

  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header">
        <h3>Мой отчёт</h3>
        <div class="month-nav">
          <button id="prev-m">‹</button>
          <span id="rep-month">${fmtMY(year,month)}</span>
          <button id="next-m">›</button>
        </div>
      </div>
      <div id="rep-body"><div class="center-screen"><div class="spinner"></div></div></div>
    </div>`;

  const load = async () => loadTrainerReport(year, month);
  document.getElementById('prev-m')?.addEventListener('click', () => {
    if (month===1){year--;month=12;}else month--;
    document.getElementById('rep-month').textContent=fmtMY(year,month); load();
  });
  document.getElementById('next-m')?.addEventListener('click', () => {
    if (month===12){year++;month=1;}else month++;
    document.getElementById('rep-month').textContent=fmtMY(year,month); load();
  });
  await load();
}

async function loadTrainerReport(year, month) {
  const body = document.getElementById('rep-body');
  if (!body) return;
  body.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const [workouts, duties, trainerGroups, groupSessions] = await Promise.all([
      DB.getWorkouts(STATE.profile.id, year, month),
      DB.getDuties(STATE.profile.id, year, month),
      DB.getTrainerGroups(STATE.profile.id),
      DB.getGroupSessions(STATE.profile.id, year, month),
    ]);
    const sal = calcSalary({ workouts, duties, trainerGroups, groupSessions });

    body.innerHTML = `
      <div class="summary-cards">
        <div class="summary-card"><div class="s-val">${sal.cat[1]+sal.cat[2]+sal.cat[3]}</div><div class="s-lbl">ПТ</div></div>
        <div class="summary-card"><div class="s-val">${sal.cat.debt}</div><div class="s-lbl">В долг</div></div>
        <div class="summary-card"><div class="s-val">${sal.hours.toFixed(1)}ч</div><div class="s-lbl">Деж.</div></div>
        <div class="summary-card"><div class="s-val">${groupSessions.length}</div><div class="s-lbl">Занятий гр.</div></div>
        <div class="summary-card accent" style="grid-column:span 2">
          <div class="s-val">${fmt(sal.total)}</div><div class="s-lbl">К выплате (сум)</div>
        </div>
      </div>

      ${sal.childSum ? `<div class="branch-block">
        <div class="branch-title">Детские группы (месяц)</div>
        <div class="branch-sum">${fmt(sal.childSum)} сум</div></div>` : ''}

      <h4 style="margin-top:16px">Тренировки</h4>
      ${!workouts.length ? '<p class="hint">Нет записей</p>' : workouts.map(w => `
        <div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${w.clients?.fio||'—'}</span>
            <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
            ${w.is_debt && !w.debt_confirmed_at ? '<span class="debt-badge">В долг</span>' : ''}
            ${w.is_debt && w.debt_confirmed_at  ? '<span class="paid-badge">Оплачено</span>' : ''}
          </div>
          <div class="hi-sub">${fmtDT(w.workout_date)} · ${w.branch}</div>
          ${w.is_debt && !w.debt_confirmed_at ? `
            <button class="btn btn-sm btn-primary" onclick="doConfirmDebt('${w.id}','${w.client_id}')">
              Подтвердить оплату</button>` : ''}
          ${canEdit(w.created_at) && !w.is_debt ? `
            <button class="btn btn-sm btn-danger" onclick="doDeleteWorkout('${w.id}')">Удалить</button>` : ''}
        </div>`).join('')}

      ${groupSessions.length ? `
        <h4 style="margin-top:16px">Групповые занятия</h4>
        ${groupSessions.map(gs => {
          const rate = gs.group_types?.billing_model==='headcount' ? getAdultGroupRate(gs.headcount) : 0;
          return `<div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${gs.group_types?.name||'?'}</span>
              <span class="hi-cat">${gs.headcount} чел.</span>
            </div>
            <div class="hi-sub">${gs.session_date} · ${gs.branch}${rate?` · ${fmt(rate)} сум`:''}</div>
          </div>`;
        }).join('')}` : ''}`;
  } catch(e) { body.innerHTML = '<p class="hint">Ошибка загрузки</p>'; console.error(e); }
}

async function doConfirmDebt(workoutId, clientId) {
  if (!confirm('Подтвердить оплату долговой тренировки? Баланс клиента уменьшится на 1.')) return;
  try { await DB.confirmDebt(workoutId, clientId); toast('Долг закрыт ✅','success'); renderReportTab(); }
  catch(e) { toast('Ошибка','error'); }
}

async function doDeleteWorkout(id) {
  if (!confirm('Удалить запись?')) return;
  try { await DB.deleteWorkout(id); toast('Удалено','success'); renderReportTab(); }
  catch(e) { toast('Ошибка','error'); }
}

// ==================== СТАРШИЙ ТРЕНЕР ====================

async function renderSeniorApp() {
  setupBack(null);
  STATE.activeDuty = await DB.getActiveDuty(STATE.profile.id);
  setScreen(`
    <div class="app-header">
      <div><div class="app-title">⭐ Старший тренер</div>
        <div class="app-sub">${STATE.profile.fio}</div></div>
      ${STATE.activeDuty ? '<div class="duty-badge active">● Дежурство</div>' : ''}
    </div>
    <div id="tab-content" class="tab-content"></div>
    <nav class="bottom-nav">
      <button class="nav-btn" onclick="seniorTab('workouts')"><span>📋</span>Списание</button>
      <button class="nav-btn" onclick="seniorTab('schedule')"><span>📅</span>Расписание</button>
      <button class="nav-btn" onclick="seniorTab('today')"><span>✅</span>Сегодня</button>
      <button class="nav-btn" onclick="seniorTab('duty')"><span>⏱</span>Дежурство</button>
      <button class="nav-btn" onclick="seniorTab('branch')"><span>📊</span>Филиал</button>
    </nav>`);
  seniorTab('workouts');
}

function seniorTab(tab) {
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',['workouts','schedule','today','duty','branch'][i]===tab));
  if (tab==='workouts') renderWorkoutsTab();
  if (tab==='schedule') renderScheduleTab();
  if (tab==='today')    renderTodayTab();
  if (tab==='duty')     renderDutyTab();
  if (tab==='branch')   renderBranchReport();
}

async function renderBranchReport() {
  const branches = STATE.profile.branches || [];
  const now = new Date();
  let year = now.getFullYear(), month = now.getMonth()+1;

  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header">
        <h3>Отчёт по филиалу</h3>
        <div class="month-nav">
          <button id="prev-br">‹</button>
          <span id="br-month">${fmtMY(year,month)}</span>
          <button id="next-br">›</button>
        </div>
      </div>
      ${branches.length>1?`<div class="form-group"><label>Филиал</label>
        <select id="branch-filter">${branches.map(b=>`<option>${b}</option>`).join('')}</select></div>`:''}
      <div id="branch-body"><div class="center-screen"><div class="spinner"></div></div></div>
    </div>`;

  const getBranch = () => document.getElementById('branch-filter')?.value || branches[0] || '';
  const load = () => loadBranchSummary(year, month, getBranch(), 'branch-body');
  document.getElementById('prev-br')?.addEventListener('click',()=>{if(month===1){year--;month=12;}else month--;document.getElementById('br-month').textContent=fmtMY(year,month);load();});
  document.getElementById('next-br')?.addEventListener('click',()=>{if(month===12){year++;month=1;}else month++;document.getElementById('br-month').textContent=fmtMY(year,month);load();});
  document.getElementById('branch-filter')?.addEventListener('change',load);
  await load();
}

async function loadBranchSummary(year, month, branch, bodyId) {
  const body = document.getElementById(bodyId);
  if (!body) return;
  body.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const data = await DB.getSummary(year, month, branch);
    body.innerHTML = renderSummaryTable(data, year, month, false);
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// ==================== АДМИНИСТРАТОР ====================

function renderAdminApp() {
  setupBack(null);
  setScreen(`
    <div class="app-header">
      <div><div class="app-title">👑 Координатор</div>
        <div class="app-sub">${STATE.profile.fio}</div></div>
    </div>
    <div id="tab-content" class="tab-content"></div>
    <nav class="bottom-nav">
      <button class="nav-btn" onclick="adminTab('summary')"><span>📊</span>Сводка</button>
      <button class="nav-btn" onclick="adminTab('staff')"><span>👥</span>Персонал</button>
      <button class="nav-btn" onclick="adminTab('branches')"><span>🏢</span>Филиалы</button>
      <button class="nav-btn" onclick="adminTab('groups')"><span>🏊</span>Группы</button>
      <button class="nav-btn" onclick="adminTab('broadcast')"><span>📢</span>Сообщение</button>
    </nav>`);
  adminTab('summary');
}

function adminTab(tab) {
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',['summary','staff','branches','groups','broadcast'][i]===tab));
  if (tab==='summary')   renderAdminSummary();
  if (tab==='staff')     renderAdminStaff();
  if (tab==='branches')  renderAdminBranches();
  if (tab==='groups')    renderAdminGroups();
  if (tab==='broadcast') renderAdminBroadcast();
}

// --- ADMIN: СВОДКА ---

async function renderAdminSummary() {
  let year = new Date().getFullYear(), month = new Date().getMonth()+1;
  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header"><h3>Сводка</h3>
        <div class="month-nav">
          <button id="prev-s">‹</button>
          <span id="sum-m">${fmtMY(year,month)}</span>
          <button id="next-s">›</button>
        </div>
      </div>
      <div class="form-group"><select id="sum-branch">
        <option value="">Все филиалы</option>
        ${(STATE.profile.branches||[]).map(b=>`<option>${b}</option>`).join('')}
      </select></div>
      <div id="sum-body"><div class="center-screen"><div class="spinner"></div></div></div>
    </div>`;

  const getBr = ()=>document.getElementById('sum-branch')?.value||null;
  const load  = ()=>loadAdminSummary(year,month,getBr());
  document.getElementById('prev-s')?.addEventListener('click',()=>{if(month===1){year--;month=12;}else month--;document.getElementById('sum-m').textContent=fmtMY(year,month);load();});
  document.getElementById('next-s')?.addEventListener('click',()=>{if(month===12){year++;month=1;}else month++;document.getElementById('sum-m').textContent=fmtMY(year,month);load();});
  document.getElementById('sum-branch')?.addEventListener('change',load);
  await load();
}

async function loadAdminSummary(year, month, branch) {
  const body = document.getElementById('sum-body');
  if (!body) return;
  body.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const data = await DB.getSummary(year, month, branch);
    body.innerHTML = renderSummaryTable(data, year, month, true);
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

function renderSummaryTable(data, year, month, isAdmin) {
  const { workouts, duties, trainerGroups, groupSessions, profiles } = data;
  if (!profiles.length) return '<p class="hint">Нет тренеров</p>';

  const rows = profiles.map(p => {
    const pw  = workouts.filter(w => w.trainer_id===p.id);
    const pd  = duties.filter(d => d.trainer_id===p.id);
    const ptg = trainerGroups.filter(tg=>tg.trainer_id===p.id);
    const pgs = groupSessions.filter(gs=>gs.trainer_id===p.id);
    const sal = calcSalary({workouts:pw,duties:pd,trainerGroups:ptg,groupSessions:pgs});
    return { profile:p, sal, count: pw.length + pd.length };
  }).filter(r=>r.count>0);

  if (!rows.length) return '<p class="hint">Нет данных за период</p>';
  const grand = rows.reduce((s,r)=>s+r.sal.total,0);

  return `
    <div class="admin-table-wrap">
      <table class="admin-table">
        <thead><tr>
          <th>Тренер</th><th>К1</th><th>К2</th><th>К3</th><th>Долг</th><th>Деж.</th><th>Гр.</th><th>Итого</th>
        </tr></thead>
        <tbody>
          ${rows.map(r=>`
            <tr class="clickable" onclick="${isAdmin?`adminDetail(${r.profile.id},'${r.profile.fio}',${year},${month})`:'void(0)'}">
              <td>${r.profile.fio}</td>
              <td>${r.sal.cat[1]}</td><td>${r.sal.cat[2]}</td><td>${r.sal.cat[3]}</td>
              <td>${r.sal.cat.debt}</td>
              <td>${r.sal.hours.toFixed(1)}ч</td>
              <td>${r.sal.childSum+r.sal.adultSum>0?fmt(r.sal.childSum+r.sal.adultSum):'—'}</td>
              <td class="total-cell">${fmt(r.sal.total)}</td>
            </tr>`).join('')}
        </tbody>
        <tfoot><tr>
          <td colspan="7"><b>Итого к выплате</b></td>
          <td class="total-cell"><b>${fmt(grand)}</b></td>
        </tr></tfoot>
      </table>
    </div>
    ${isAdmin?'<p class="hint" style="text-align:center;margin-top:8px">Нажмите строку для детализации</p>':''}`;
}

async function adminDetail(trainerId, trainerFio, year, month) {
  setupBack(()=>{ renderAdminApp(); adminTab('summary'); setupBack(null); });
  $('#tab-content').innerHTML = `<div class="tab-pad"><h3>${trainerFio}</h3>
    <div class="center-screen"><div class="spinner"></div></div></div>`;
  try {
    const d = await DB.getTrainerDetail(trainerId, year, month);
    const sal = calcSalary(d);
    $('#tab-content').innerHTML = `
      <div class="tab-pad">
        <h3>${trainerFio}</h3><p class="hint">${fmtMY(year,month)}</p>
        <div class="summary-cards">
          <div class="summary-card"><div class="s-val">${sal.cat[1]}</div><div class="s-lbl">Кат.1</div></div>
          <div class="summary-card"><div class="s-val">${sal.cat[2]}</div><div class="s-lbl">Кат.2</div></div>
          <div class="summary-card"><div class="s-val">${sal.cat[3]}</div><div class="s-lbl">Кат.3</div></div>
          <div class="summary-card"><div class="s-val">${sal.cat.debt}</div><div class="s-lbl">Долг</div></div>
          <div class="summary-card"><div class="s-val">${sal.hours.toFixed(1)}ч</div><div class="s-lbl">Деж.</div></div>
          <div class="summary-card accent" style="grid-column:span 2">
            <div class="s-val">${fmt(sal.total)}</div><div class="s-lbl">К выплате</div>
          </div>
        </div>
        <h4>Тренировки</h4>
        ${!d.workouts.length?'<p class="hint">Нет</p>':d.workouts.map(w=>`
          <div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${w.clients?.fio||'—'}</span>
              <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
              ${w.is_debt&&!w.debt_confirmed_at?'<span class="debt-badge">В долг</span>':''}
            </div>
            <div class="hi-sub">${fmtDT(w.workout_date)} · ${w.branch}</div>
          </div>`).join('')}
        <h4 style="margin-top:16px">Дежурства</h4>
        ${!d.duties.length?'<p class="hint">Нет</p>':d.duties.map(duty=>{
          const h=hoursFromDuty(duty.start_time,duty.end_time);
          return `<div class="history-item">
            <div class="hi-main"><span class="hi-client">${duty.branch}</span><span class="hi-cat">${h.toFixed(2)}ч</span></div>
            <div class="hi-sub">${fmtDT(duty.start_time)} → ${fmtDT(duty.end_time)}</div>
            <div class="hi-sub">${fmt(Math.round(h*RATES.duty_per_hour))} сум</div>
          </div>`;
        }).join('')}
      </div>`;
  } catch(e) { toast('Ошибка загрузки','error'); console.error(e); }
}

// --- ADMIN: ПЕРСОНАЛ ---

async function renderAdminStaff() {
  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header"><h3>Персонал</h3>
        <button class="btn btn-sm" onclick="renderAddTrainerModal()">+ Добавить</button>
      </div>
      <div class="form-group"><label>Роль</label>
        <select id="role-filter" onchange="loadStaffList()">
          <option value="">Все</option>
          <option value="trainer">Тренеры</option>
          <option value="senior_trainer">Старшие тренеры</option>
          <option value="admin">Администраторы</option>
        </select>
      </div>
      <div id="staff-list"><div class="center-screen"><div class="spinner"></div></div></div>
    </div>`;
  await loadStaffList();
}

const ROLE_LABELS = {
  trainer:'Тренер', senior_trainer:'Ст. тренер', admin:'Администратор', sales:'Продажи'
};

async function loadStaffList() {
  const body = document.getElementById('staff-list'); if (!body) return;
  const role = document.getElementById('role-filter')?.value || '';
  try {
    let profiles = await DB.getAllProfiles();
    if (role) profiles = profiles.filter(p=>p.role===role);
    const trainers = profiles.filter(p=>p.role!=='admin'||role);
    body.innerHTML = !trainers.length ? '<p class="hint">Нет сотрудников</p>' :
      trainers.map(t=>`
        <div class="staff-card">
          <div class="staff-info">
            <div class="staff-fio">${t.fio}</div>
            <div class="staff-meta">
              ${ROLE_LABELS[t.role]||t.role} ·
              ${t.tg_id?'✅':'⏳'} ·
              ${(t.branches||[]).join(', ')||'—'}
            </div>
          </div>
          <div class="staff-actions">
            <button class="btn btn-sm" onclick="renderEditTrainerModal(${t.id},'${t.fio.replace(/'/g,"\\'")}','${(t.branches||[]).join(',')}','${t.role}')">✏️</button>
          </div>
        </div>`).join('');
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; }
}

function renderAddTrainerModal() {
  const m = el('div','modal-overlay');
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>Добавить сотрудника</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group"><label>ФИО</label><input id="nt-fio" type="text"></div>
      <div class="form-group"><label>Роль</label>
        <select id="nt-role">
          <option value="trainer">Тренер</option>
          <option value="senior_trainer">Старший тренер</option>
          <option value="admin">Администратор</option>
        </select>
      </div>
      <div class="form-group"><label>Филиалы (через запятую)</label>
        <input id="nt-branches" type="text" placeholder="${(STATE.profile.branches||[]).join(', ')}"></div>
      <button class="btn btn-primary btn-full" onclick="doAddTrainer()">Добавить</button>
    </div>`;
  document.body.appendChild(m);
}

async function doAddTrainer() {
  const fio     = document.getElementById('nt-fio')?.value.trim();
  const role    = document.getElementById('nt-role')?.value;
  const brInput = document.getElementById('nt-branches')?.value.trim();
  const branches= brInput?brInput.split(',').map(b=>b.trim()).filter(Boolean):[];
  if (!fio)            return toast('Введите ФИО','error');
  if (!branches.length)return toast('Укажите филиал','error');
  try {
    await DB.addTrainer(fio, branches, role);
    document.querySelector('.modal-overlay')?.remove();
    toast('Добавлено','success'); loadStaffList();
  } catch(e){ toast('Ошибка','error'); console.error(e); }
}

function renderEditTrainerModal(id, fio, branches, role) {
  const m = el('div','modal-overlay');
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>Редактировать</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group"><label>ФИО</label><input id="et-fio" value="${fio}"></div>
      <div class="form-group"><label>Роль</label>
        <select id="et-role">
          <option value="trainer" ${role==='trainer'?'selected':''}>Тренер</option>
          <option value="senior_trainer" ${role==='senior_trainer'?'selected':''}>Старший тренер</option>
          <option value="admin" ${role==='admin'?'selected':''}>Администратор</option>
        </select>
      </div>
      <div class="form-group"><label>Филиалы</label>
        <input id="et-branches" value="${branches}"></div>
      <button class="btn btn-primary btn-full" onclick="doEditTrainer(${id})">Сохранить</button>
    </div>`;
  document.body.appendChild(m);
}

async function doEditTrainer(id) {
  const fio     = document.getElementById('et-fio')?.value.trim();
  const role    = document.getElementById('et-role')?.value;
  const brInput = document.getElementById('et-branches')?.value.trim();
  const branches= brInput?brInput.split(',').map(b=>b.trim()).filter(Boolean):[];
  if (!fio) return toast('Введите ФИО','error');
  try {
    await DB.updateProfile(id,{fio,role,branches});
    document.querySelector('.modal-overlay')?.remove();
    toast('Сохранено','success'); loadStaffList();
  } catch(e){ toast('Ошибка','error'); }
}

// --- ADMIN: ФИЛИАЛЫ ---

async function renderAdminBranches() {
  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header"><h3>Филиалы</h3>
        <button class="btn btn-sm" onclick="renderAddBranchModal()">+ Добавить</button>
      </div>
      <div id="branches-list"><div class="center-screen"><div class="spinner"></div></div></div>
    </div>`;
  await loadBranchesList();
}

async function loadBranchesList() {
  const body = document.getElementById('branches-list'); if (!body) return;
  try {
    const branches = await DB.getBranches();
    body.innerHTML = !branches.length ? '<p class="hint">Нет филиалов</p>' :
      branches.map(b=>`
        <div class="staff-card">
          <div class="staff-info"><div class="staff-fio">🏢 ${b.name}</div></div>
          <button class="btn btn-sm btn-danger" onclick="doDeleteBranch(${b.id},'${b.name}')">Удалить</button>
        </div>`).join('');
  } catch(e){ body.innerHTML='<p class="hint">Ошибка</p>'; }
}

function renderAddBranchModal() {
  const m = el('div','modal-overlay');
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>Новый филиал</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group"><label>Название</label><input id="br-name" placeholder="Центр"></div>
      <button class="btn btn-primary btn-full" onclick="doAddBranch()">Добавить</button>
    </div>`;
  document.body.appendChild(m);
}

async function doAddBranch() {
  const name = document.getElementById('br-name')?.value.trim();
  if (!name) return toast('Введите название','error');
  try {
    await DB.addBranch(name);
    document.querySelector('.modal-overlay')?.remove();
    toast('Филиал добавлен','success'); loadBranchesList();
  } catch(e){ toast('Такой филиал уже есть','error'); }
}

async function doDeleteBranch(id, name) {
  if (!confirm(`Удалить филиал «${name}»?\nЭто не удалит тренеров, только название из справочника.`)) return;
  try { await DB.deleteBranch(id); toast('Удалено','success'); loadBranchesList(); }
  catch(e){ toast('Ошибка','error'); }
}

// --- ADMIN: ГРУППЫ ---

async function renderAdminGroups() {
  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header"><h3>Группы</h3>
        <button class="btn btn-sm" onclick="renderAddGroupTypeModal()">+ Тип</button>
      </div>
      <div id="groups-list"><div class="center-screen"><div class="spinner"></div></div></div>
      <h4 style="margin-top:20px">Назначить группу тренеру</h4>
      <div id="assign-group-form"></div>
    </div>`;
  await loadGroupsList();
  await renderAssignGroupForm();
}

async function loadGroupsList() {
  const body = document.getElementById('groups-list'); if (!body) return;
  try {
    const types = await DB.getGroupTypes();
    body.innerHTML = types.map(gt=>`
      <div class="staff-card">
        <div class="staff-info">
          <div class="staff-fio">${gt.name}</div>
          <div class="staff-meta">
            ${gt.type==='children'?`Детская · ${fmt(gt.price_per_month)} сум/мес · ${gt.trainer_percentage}% тренеру`
              :`Взрослая · По явке`}
          </div>
        </div>
      </div>`).join('') || '<p class="hint">Нет типов групп</p>';
  } catch(e){ body.innerHTML='<p class="hint">Ошибка</p>'; }
}

function renderAddGroupTypeModal() {
  const m = el('div','modal-overlay');
  m.innerHTML = `
    <div class="modal">
      <div class="modal-header"><h3>Новый тип группы</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group"><label>Название</label><input id="gt-name" placeholder="Аквааэробика"></div>
      <div class="form-group"><label>Тип</label>
        <select id="gt-type" onchange="onGtTypeChange(this)">
          <option value="children">Детская</option>
          <option value="adult">Взрослая</option>
        </select>
      </div>
      <div id="gt-extra">
        <div class="form-group"><label>Стоимость абонемента (сум/мес)</label>
          <input id="gt-price" type="number" value="1000000"></div>
        <div class="form-group"><label>% тренеру</label>
          <input id="gt-pct" type="number" value="40" min="1" max="100"></div>
      </div>
      <button class="btn btn-primary btn-full" onclick="doAddGroupType()">Добавить</button>
    </div>`;
  document.body.appendChild(m);
}

function onGtTypeChange(sel) {
  const extra = document.getElementById('gt-extra');
  extra.style.display = sel.value === 'children' ? '' : 'none';
}

async function doAddGroupType() {
  const name  = document.getElementById('gt-name')?.value.trim();
  const type  = document.getElementById('gt-type')?.value;
  const price = parseInt(document.getElementById('gt-price')?.value||0);
  const pct   = parseInt(document.getElementById('gt-pct')?.value||40);
  if (!name) return toast('Введите название','error');
  try {
    await DB.addGroupType({
      name, type, billing_model: type==='children'?'percentage':'headcount',
      price_per_month: type==='children'?price:0,
      trainer_percentage: type==='children'?pct:0,
    });
    document.querySelector('.modal-overlay')?.remove();
    toast('Тип добавлен','success'); loadGroupsList();
  } catch(e){ toast('Ошибка (название должно быть уникальным)','error'); }
}

async function renderAssignGroupForm() {
  const form = document.getElementById('assign-group-form'); if (!form) return;
  try {
    const [profiles, groupTypes, branches] = await Promise.all([
      DB.getProfilesByRole('trainer'),
      DB.getGroupTypes(),
      DB.getBranches(),
    ]);
    const seniors = await DB.getProfilesByRole('senior_trainer');
    const allTrainers = [...profiles, ...seniors];

    form.innerHTML = `
      <div class="form-group"><label>Тренер</label>
        <select id="ag-trainer">
          ${allTrainers.map(t=>`<option value="${t.id}">${t.fio}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Тип группы</label>
        <select id="ag-type">
          ${groupTypes.map(g=>`<option value="${g.id}">${g.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Филиал</label>
        <select id="ag-branch">
          ${branches.map(b=>`<option>${b.name}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Начало абонемента</label>
        <input type="date" id="ag-start" value="${todayStr()}">
      </div>
      <button class="btn btn-primary" onclick="doAssignGroup()">Назначить группу</button>`;
  } catch(e){ form.innerHTML='<p class="hint">Ошибка</p>'; }
}

async function doAssignGroup() {
  const trainerId   = parseInt(document.getElementById('ag-trainer')?.value);
  const groupTypeId = parseInt(document.getElementById('ag-type')?.value);
  const branch      = document.getElementById('ag-branch')?.value;
  const start       = document.getElementById('ag-start')?.value;
  if (!trainerId||!groupTypeId||!branch||!start) return toast('Заполните все поля','error');
  try {
    await DB.addTrainerGroup(trainerId, groupTypeId, branch, start);
    toast('Группа назначена ✅','success');
  } catch(e){ toast('Ошибка','error'); console.error(e); }
}

// --- ADMIN: РАССЫЛКА ---

async function renderAdminBroadcast() {
  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <h3>Сообщение тренерам</h3>
      <p class="hint" style="margin-bottom:16px">Сообщение придёт в личку каждому тренеру через бота.</p>
      <div class="form-group"><label>Фильтр по филиалу</label>
        <select id="bc-branch">
          <option value="">Всем тренерам</option>
          ${(STATE.profile.branches||[]).map(b=>`<option>${b}</option>`).join('')}
        </select>
      </div>
      <div class="form-group"><label>Текст сообщения</label>
        <textarea id="bc-text" rows="5" placeholder="Привет! Напоминаю..."></textarea>
      </div>
      <button class="btn btn-primary btn-full" onclick="doSendBroadcast()">Отправить</button>
      <div id="bc-result" style="margin-top:12px"></div>
    </div>`;
}

async function doSendBroadcast() {
  const text   = document.getElementById('bc-text')?.value.trim();
  const branch = document.getElementById('bc-branch')?.value || null;
  if (!text) return toast('Введите текст','error');

  const result = document.getElementById('bc-result');
  if (result) result.innerHTML = '<div class="spinner" style="margin:0 auto"></div>';

  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/send-broadcast`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ text, branch }),
    });
    const data = await res.json();
    if (result) result.innerHTML = `<p class="hint">✅ Отправлено: ${data.sent||0} получателей</p>`;
    document.getElementById('bc-text').value = '';
  } catch(e) {
    if (result) result.innerHTML = `<p class="hint" style="color:var(--danger)">Ошибка отправки. Убедитесь что Edge Function развёрнута.</p>`;
    console.error(e);
  }
}

// ==================== СТАРТ ====================

window.addEventListener('DOMContentLoaded', init);
