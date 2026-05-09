// =============================================
// TWA «Лист тренера» v3
// =============================================

const STATE = {
  tgId: null, profile: null,
  activeDuty: null, dutyTimer: null, currentTab: null,
};

// ── УТИЛИТЫ ──────────────────────────────────
const $  = s => document.querySelector(s);
const $$ = s => [...document.querySelectorAll(s)];

function el(tag,cls,html) {
  const e=document.createElement(tag);
  if (cls)      e.className=cls;
  if (html!=null) e.innerHTML=html;
  return e;
}
function fmt(n)     { return Number(n).toLocaleString('ru-RU'); }
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
  const diff = Date.now()-new Date(v).getTime();
  return diff>=0 && diff<=MAX_BACKDATE_HOURS*3600000;
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

function setScreen(html) { $('#app').innerHTML=html; }
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
  cb ? (Telegram.WebApp.BackButton.show(), Telegram.WebApp.BackButton.onClick(cb))
     :  Telegram.WebApp.BackButton.hide();
}
function openSchedule() {
  const url = window.location.href.replace('index.html','').replace(/\/$/, '') + '/schedule.html';
  window.Telegram?.WebApp?.openLink
    ? Telegram.WebApp.openLink(url)
    : window.open(url,'_blank');
}

// ── ИНИЦИАЛИЗАЦИЯ ─────────────────────────────
async function init() {
  if (window.Telegram?.WebApp) { Telegram.WebApp.ready(); Telegram.WebApp.expand(); }
  STATE.tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || null;
  if (!STATE.tgId) {
    const saved = localStorage.getItem('dev_tg_id');
    if (saved) STATE.tgId=parseInt(saved);
    else {
      const id=prompt('Dev mode: Telegram ID');
      if (!id) return;
      STATE.tgId=parseInt(id);
      localStorage.setItem('dev_tg_id',STATE.tgId);
    }
  }
  loading('Проверяем аккаунт...');
  try {
    const p=await DB.getProfileByTgId(STATE.tgId);
    if (!p) { renderRegister(); return; }
    STATE.profile=p;
    if (p.pincode) renderPinEntry(); else enterApp();
  } catch(e) { toast('Ошибка подключения','error'); console.error(e); }
}
async function enterApp() {
  if      (STATE.profile.role==='admin')          renderAdminApp();
  else if (STATE.profile.role==='senior_trainer') renderSeniorApp();
  else                                            renderTrainerApp();
}

// ── РЕГИСТРАЦИЯ ───────────────────────────────
function renderRegister() {
  setupBack(null);
  setScreen(`<div class="screen-pad">
    <div class="logo">🏋️</div><h1>Первый вход</h1>
    <p class="hint">Введите ФИО точно так же, как внёс координатор.</p>
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
    toast('Аккаунт привязан! ✅','success');
    enterApp();
  } catch(e) { renderRegister(); toast('Ошибка регистрации','error'); console.error(e); }
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
    if (window._pin===STATE.profile.pincode) { toast('Добро пожаловать! 👋','success'); enterApp(); }
    else { toast('Неверный PIN','error'); window._pin=''; $$('#pin-dots span').forEach(d=>d.className=''); }
  }
}

// ── ОБОЛОЧКА ТРЕНЕРА ──────────────────────────
async function renderTrainerApp() {
  setupBack(null);
  STATE.activeDuty=await DB.getActiveDuty(STATE.profile.id);
  renderTrainerShell('workouts');
}
function renderTrainerShell(tab) {
  STATE.currentTab=tab;
  setScreen(`
    <div class="app-header">
      <div><div class="app-title">🏋️ Лист тренера</div>
        <div class="app-sub">${STATE.profile.fio}</div></div>
      <div style="display:flex;gap:8px;align-items:center">
        ${STATE.activeDuty?'<div class="duty-badge active">● Дежурство</div>':''}
        <button class="btn-icon" onclick="openSchedule()" title="Общее расписание">📅</button>
      </div>
    </div>
    <div id="tab-content" class="tab-content"></div>
    <nav class="bottom-nav">
      <button class="nav-btn" onclick="switchTab('workouts')"><span>📋</span>Списание</button>
      <button class="nav-btn" onclick="switchTab('schedule')"><span>🗓</span>Расписание</button>
      <button class="nav-btn" onclick="switchTab('today')"><span>✅</span>Сегодня</button>
      <button class="nav-btn" onclick="switchTab('duty')"><span>⏱</span>Дежурство</button>
      <button class="nav-btn" onclick="switchTab('report')"><span>📊</span>Отчёт</button>
    </nav>`);
  switchTab(tab);
}
function switchTab(tab) {
  STATE.currentTab=tab;
  const tabs=['workouts','schedule','today','duty','report'];
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',tabs[i]===tab));
  if (tab==='workouts')  renderWorkoutsTab();
  if (tab==='schedule')  renderScheduleTab();
  if (tab==='today')     renderTodayTab();
  if (tab==='duty')      renderDutyTab();
  if (tab==='report')    renderReportTab();
}

// ── ТАБ: СПИСАНИЕ ─────────────────────────────
async function renderWorkoutsTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const clients  = await DB.getClients(STATE.profile.id);
  const branches = STATE.profile.branches||[];
  const expiring = clients.filter(c => {
    const d = daysUntil(c.subscription_end);
    return d !== null && d <= SUBSCRIPTION_WARN_DAYS && d >= 0;
  });

  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header">
      <h3>Списать тренировку</h3>
      <button class="btn btn-sm" onclick="renderAddClientModal()">+ Клиент</button>
    </div>

    ${expiring.length ? `<div class="warn-banner">
      ⚠️ Абонемент истекает у ${expiring.length} клиента(ов):
      ${expiring.map(c=>`<b>${c.fio.split(' ')[0]}</b> (${daysUntil(c.subscription_end)} дн.)`).join(', ')}
    </div>` : ''}

    ${branchSelect('sel-branch', branches)}

    <div class="form-group"><label>Клиент</label>
      <select id="wk-client" onchange="onClientChange(this)">
        <option value="">— выберите —</option>
        ${clients.map(c=>{
          const days = daysUntil(c.subscription_end);
          const warn = days!==null && days<=SUBSCRIPTION_WARN_DAYS && days>=0 ? ' ⚠️' : '';
          const expired = days!==null && days<0 ? ' ❌' : '';
          return `<option value="${c.id}" data-cat="${c.category}" data-bal="${c.balance}"
            data-age="${c.age||''}" data-di="${c.drop_in_used}">
            ${c.fio}${warn}${expired} (кат.${c.category}, баланс: ${c.balance})
          </option>`;
        }).join('')}
      </select>
    </div>

    <div class="form-group"><label>Тип тренировки</label>
      <select id="wk-type" onchange="onWkTypeChange(this)">
        <option value="regular">Обычная ПТ</option>
        <option value="dropin">Разовое посещение (${fmt(RATES.drop_in_price)} сум)</option>
        <option value="debt">В долг (не оплачена)</option>
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

    <button class="btn btn-primary btn-full" onclick="doLogWorkout()">Списать</button>
  </div>`;

  renderDateFields();
}

function onWkTypeChange(sel) {
  const regOpts = document.getElementById('wk-regular-opts');
  if (regOpts) regOpts.style.display = sel.value==='dropin' ? 'none' : '';
}

function onClientChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const bal = parseInt(opt?.dataset.bal||'1');
  const age = parseInt(opt?.dataset.age||'99');
  const diUsed = opt?.dataset.di === 'true';
  const typeEl = document.getElementById('wk-type');

  if (sel.value && bal<=0) toast('⚠️ Нулевой баланс!','error');

  // Если ребёнок уже использовал разовое — убрать опцию
  if (typeEl) {
    const diOpt = [...typeEl.options].find(o=>o.value==='dropin');
    if (diOpt) {
      if (isChild(age) && diUsed) {
        diOpt.disabled=true;
        diOpt.textContent='Разовое (недоступно — ребёнок уже посещал)';
      } else {
        diOpt.disabled=false;
        diOpt.textContent=`Разовое посещение (${fmt(RATES.drop_in_price)} сум)`;
      }
    }
  }
}

function renderDateFields() {
  const count  = parseInt($('#wk-count')?.value||1);
  const notesW = $('#wk-notes-wrap');
  if (notesW) notesW.style.display = count>1?'':'none';
  const div = $('#wk-dates'); if (!div) return;
  div.innerHTML = Array.from({length:count},(_,i)=>`
    <div class="form-group">
      <label>${count>1?`ПТ №${i+1} — `:''}Дата и время</label>
      <input type="datetime-local" id="wk-date-${i}" value="${localDT(-i)}"
        min="${new Date(Date.now()-MAX_BACKDATE_HOURS*3600000).toISOString().slice(0,16)}"
        max="${new Date().toISOString().slice(0,16)}">
    </div>`).join('');
}

async function doLogWorkout() {
  const clientSel = $('#wk-client');
  const clientId  = clientSel?.value;
  if (!clientId) return toast('Выберите клиента','error');

  const opt      = clientSel.options[clientSel.selectedIndex];
  const category = parseInt(opt.dataset.cat);
  const type     = $('#wk-type')?.value || 'regular';
  const isDropIn = type==='dropin';
  const isDebt   = type==='debt';
  const count    = isDropIn ? 1 : parseInt($('#wk-count')?.value||1);
  const branch   = getBranch();
  if (!branch) return toast('Выберите филиал','error');
  const notes = $('#wk-notes')?.value.trim()||'';
  if (count>1 && !notes) return toast('Введите примечание','error');

  // Проверка: ребёнок + разовое уже было
  if (isDropIn) {
    const age  = parseInt(opt.dataset.age||'99');
    const diUsed = opt.dataset.di==='true';
    if (isChild(age) && diUsed) return toast('Ребёнок уже использовал разовое посещение','error');
  }

  const dates=[];
  for (let i=0;i<count;i++) {
    const v=document.getElementById(`wk-date-${i}`)?.value;
    if (!v) return toast(`Введите дату для ПТ №${i+1}`,'error');
    if (!isValidWorkoutDate(v)) return toast(`ПТ №${i+1}: дата не старше 24 часов`,'error');
    dates.push(v);
  }

  const rows=dates.map(d=>({
    trainer_id: STATE.profile.id, client_id: clientId,
    category_at_moment: category, branch,
    workout_date: new Date(d).toISOString(),
    notes: notes||null,
    is_debt:   isDebt,
    is_drop_in: isDropIn,
  }));

  try {
    await DB.logWorkouts(rows);
    toast(isDebt?`✅ ${count} ПТ записано в долг`:isDropIn?'✅ Разовое записано!':`✅ ${count} ПТ списано!`,'success');
    renderWorkoutsTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Модал: добавить клиента
function renderAddClientModal() {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новый клиент</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>ФИО</label>
      <input id="nc-fio" type="text" placeholder="Петрова Анна Ивановна"></div>
    <div class="form-group"><label>Возраст (лет)</label>
      <input id="nc-age" type="number" min="3" max="99" placeholder="например, 35"></div>
    <div class="form-group"><label>Категория</label>
      <div class="cat-picker">
        ${[1,2,3].map(n=>`<button class="cat-btn ${n===1?'active':''}" data-cat="${n}"
          onclick="selectCat(this)">Кат.${n}<br><small>${fmt(RATES.pt[n])} сум</small></button>`).join('')}
      </div>
    </div>
    <div class="form-group"><label>Начальный баланс (ПТ)</label>
      <input id="nc-balance" type="number" min="0" value="0"></div>
    <div class="form-group"><label>Начало абонемента</label>
      <input id="nc-sub-start" type="date"></div>
    <div class="form-group"><label>Конец абонемента</label>
      <input id="nc-sub-end" type="date"></div>
    <button class="btn btn-primary btn-full" onclick="doAddClient()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
function selectCat(btn) { $$('.cat-btn').forEach(b=>b.classList.remove('active')); btn.classList.add('active'); }
async function doAddClient() {
  const fio    = $('#nc-fio')?.value.trim();
  const age    = parseInt($('#nc-age')?.value)||null;
  const cat    = parseInt(document.querySelector('.cat-btn.active')?.dataset.cat||'1');
  const bal    = parseInt($('#nc-balance')?.value||'0');
  const ss     = $('#nc-sub-start')?.value||null;
  const se     = $('#nc-sub-end')?.value||null;
  if (!fio) return toast('Введите ФИО','error');
  try {
    const client=await DB.addClient(fio,cat,STATE.profile.id,age,ss,se);
    if (bal>0) await DB.addBalance(client.id,bal);
    document.querySelector('.modal-overlay')?.remove();
    toast('Клиент добавлен','success'); renderWorkoutsTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: РАСПИСАНИЕ ───────────────────────────
async function renderScheduleTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const slots = await DB.getSlots(STATE.profile.id);
    const grid  = buildGrid(slots);
    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header">
        <h3>Моё расписание</h3>
        <button class="btn btn-sm" onclick="renderAddSlotModal()">+ Слот</button>
      </div>
      <p class="hint" style="margin-bottom:10px">Нажмите слот для удаления.</p>
      <div class="schedule-scroll">
        <table class="sched-table">
          <thead><tr><th class="sched-time-col"></th>
            ${DAYS_SHORT.map(d=>`<th>${d}</th>`).join('')}
          </tr></thead>
          <tbody>
            ${SCHEDULE_HOURS.map(h=>`
              <tr>
                <td class="sched-time">${h}</td>
                ${[0,1,2,3,4,5,6].map(dow=>{
                  const daySlots=grid[dow]?.[h]||[];
                  return `<td class="sched-cell">
                    ${daySlots.map(s=>renderSlotPill(s)).join('')}
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
  const grid={};
  for (let d=0;d<7;d++) { grid[d]={}; SCHEDULE_HOURS.forEach(h=>{grid[d][h]=[];}); }
  slots.forEach(s=>{
    const startH=parseInt(s.start_time.slice(0,2));
    const endH  =parseInt(s.end_time.slice(0,2));
    if (s.slot_type==='duty') {
      // Дежурство — показываем во всех охваченных часах
      for (let h=startH;h<endH;h++) {
        const hKey=`${String(h).padStart(2,'0')}:00`;
        if (grid[s.day_of_week]?.[hKey]) {
          grid[s.day_of_week][hKey].push({...s, _dutyFirst:h===startH, _dutyLast:h===endH-1});
        }
      }
    } else {
      const hKey=`${String(startH).padStart(2,'0')}:00`;
      if (grid[s.day_of_week]?.[hKey]) grid[s.day_of_week][hKey].push(s);
    }
  });
  return grid;
}

function renderSlotPill(s) {
  const c = SLOT_COLORS[s.slot_type];
  if (s.slot_type==='duty') {
    const borderTop    = s._dutyFirst ? `border-top:2px solid ${c.color};border-radius:4px 4px 0 0;` : '';
    const borderBottom = s._dutyLast  ? `border-bottom:2px solid ${c.color};border-radius:0 0 4px 4px;margin-bottom:0;` : '';
    const label = s._dutyFirst
      ? `${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`
      : '│';
    return `<div class="slot-pill slot-duty-block"
      style="background:${c.bg};color:${c.color};${borderTop}${borderBottom}"
      onclick="confirmDeleteSlot('${s.id}','duty')">${label}</div>`;
  }
  const label = s.slot_type==='pt'
    ? (s.clients?.fio?.split(' ')[0]||'ПТ')
    : (s.group_types?.name?.slice(0,6)||'Гр');
  return `<div class="slot-pill" style="background:${c.bg};color:${c.color}"
    onclick="confirmDeleteSlot('${s.id}','${s.slot_type}')">${label}</div>`;
}

async function confirmDeleteSlot(id,type) {
  if (!confirm(`Удалить слот (${SLOT_COLORS[type]?.label||type})?`)) return;
  try { await DB.deactivateSlot(id); toast('Слот удалён','success'); renderScheduleTab(); }
  catch(e) { toast('Ошибка','error'); }
}

async function renderAddSlotModal() {
  const branches  = STATE.profile.branches||[];
  const clients   = await DB.getClients(STATE.profile.id);
  const groupList = await DB.getTrainerGroups(STATE.profile.id);
  window._slotClients=clients; window._slotGroupList=groupList;

  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить слот</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${branchSelect('slot-branch',branches)}
    <div class="form-group"><label>День недели</label>
      <select id="slot-dow">
        ${DAYS_FULL.map((d,i)=>`<option value="${i}">${d}</option>`).join('')}
      </select></div>
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label><input type="time" id="slot-start" value="09:00"></div>
      <div style="flex:1"><label>Конец</label><input type="time" id="slot-end" value="10:00"></div>
    </div>
    <div class="form-group"><label>Тип</label>
      <select id="slot-type" onchange="onSlotTypeChange(this)">
        <option value="duty">Дежурство</option>
        <option value="pt">ПТ</option>
        <option value="group">Группа</option>
      </select></div>
    <div id="slot-extra"></div>
    <button class="btn btn-primary btn-full" onclick="doAddSlot()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
  onSlotTypeChange(document.getElementById('slot-type'));
}

function onSlotTypeChange(sel) {
  const extra=document.getElementById('slot-extra'); if (!extra) return;
  const clients=window._slotClients||[], groups=window._slotGroupList||[];
  if (sel.value==='pt') {
    extra.innerHTML=`<div class="form-group"><label>Клиент</label>
      <select id="slot-client">
        <option value="">— выберите —</option>
        ${clients.map(c=>`<option value="${c.id}">${c.fio}</option>`).join('')}
      </select></div>`;
  } else if (sel.value==='group') {
    extra.innerHTML=`
      <div class="form-group"><label>Тип группы</label>
        <select id="slot-group">
          <option value="">— выберите —</option>
          ${groups.map(g=>`<option value="${g.group_type_id}">${g.group_types?.name||'?'}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Средняя явка (чел.)</label>
        <input type="number" id="slot-headcount" min="1" value="5"></div>`;
  } else { extra.innerHTML=''; }
}

async function doAddSlot() {
  const branch  = document.getElementById('slot-branch')?.value||STATE.profile.branches?.[0]||'';
  const dow     = parseInt(document.getElementById('slot-dow')?.value||'0');
  const start   = document.getElementById('slot-start')?.value;
  const end     = document.getElementById('slot-end')?.value;
  const type    = document.getElementById('slot-type')?.value;
  const clientId= document.getElementById('slot-client')?.value||null;
  const groupId = document.getElementById('slot-group')?.value||null;
  const headcount=parseInt(document.getElementById('slot-headcount')?.value||'0');
  if (!start||!end) return toast('Укажите время','error');
  if (start>=end)   return toast('Конец позже начала','error');
  if (type==='pt'&&!clientId) return toast('Выберите клиента','error');
  if (type==='group'&&!groupId) return toast('Выберите группу','error');
  try {
    await DB.addSlot({
      trainer_id:STATE.profile.id, branch, day_of_week:dow,
      start_time:start, end_time:end, slot_type:type,
      client_id:     type==='pt'    ? clientId : null,
      group_type_id: type==='group' ? parseInt(groupId) : null,
      avg_headcount: type==='group' ? headcount : null,
    });
    document.querySelector('.modal-overlay')?.remove();
    toast('Слот добавлен','success'); renderScheduleTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: СЕГОДНЯ ──────────────────────────────
async function renderTodayTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const date    = todayStr();
  const dayName = DAYS_FULL[(new Date().getDay()+6)%7];
  try {
    const slots     = await DB.getTodaySlots(STATE.profile.id, date);
    const ptSlots   = slots.filter(s=>s.slot_type==='pt');
    const grpSlots  = slots.filter(s=>s.slot_type==='group');
    const dutySlots = slots.filter(s=>s.slot_type==='duty');
    const pending   = slots.filter(s=>!s.confirmation&&s.slot_type!=='duty').length;

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header">
        <div><h3>Сегодня</h3><p class="hint">${dayName}, ${date}</p></div>
        ${pending>0?`<div class="pending-badge">${pending} не закрыто</div>`:''}
      </div>

      ${dutySlots.length?`<h4>Дежурство</h4>
        ${dutySlots.map(s=>`<div class="today-card duty-card">
          <div class="today-card-row">
            <span class="today-time">⏱ ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</span>
            <span class="today-label">Дежурство · ${s.branch}</span>
          </div></div>`).join('')}`:''}

      ${ptSlots.length?`<h4>Персональные тренировки</h4>
        ${ptSlots.map(s=>renderTodaySlot(s,date)).join('')}`:''}

      ${grpSlots.length?`<h4>Групповые занятия</h4>
        ${grpSlots.map(s=>renderTodaySlot(s,date)).join('')}`:''}

      ${!slots.length?'<div class="empty-state">📭<p>На сегодня занятий нет</p></div>':''}
    </div>`;
  } catch(e) { toast('Ошибка загрузки','error'); console.error(e); }
}

function renderTodaySlot(s, date) {
  const conf   = s.confirmation;
  const status = conf?.status||'pending';
  const isAdult = s.group_types?.billing_model==='headcount';
  const label   = s.slot_type==='pt'
    ? (s.clients?.fio||'Клиент')
    : (s.group_types?.name||'Группа');
  const timeStr = `${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`;
  const cat     = s.clients?.category||1;
  const clientId= s.client_id||'';
  const slotBranch = encodeURIComponent(s.branch||'');

  if (status==='confirmed') return `<div class="today-card confirmed-card">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span>
      <span class="today-label">${label}</span>
      <span class="status-badge confirmed">✓ Подтверждено</span>
    </div>
    ${conf?.actual_headcount?`<div class="today-sub">Явка: ${conf.actual_headcount} чел.</div>`:''}
  </div>`;

  if (status==='cancelled') return `<div class="today-card cancelled-card">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span>
      <span class="today-label">${label}</span>
      <span class="status-badge cancelled">✗ Отменено</span>
    </div>
    ${conf?.cancel_reason?`<div class="today-sub">${conf.cancel_reason}</div>`:''}
  </div>`;

  const isPt = s.slot_type==='pt';
  return `<div class="today-card pending-card" id="today-${s.id}">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span>
      <span class="today-label">${label}</span>
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
      <button class="btn btn-sm btn-danger"
        onclick="doCancelSlot('${s.id}','${date}')">Отменить</button>
    </div>
  </div>`;
}

async function doConfirm(slotId, date, isPt, isAdult, clientId, category, branchEnc, groupTypeId) {
  const branch    = decodeURIComponent(branchEnc);
  const headcount = isAdult ? parseInt(document.getElementById(`hc-${slotId}`)?.value||5) : null;
  try {
    let workoutId=null;
    if (isPt && clientId) {
      const rows=[{
        trainer_id:STATE.profile.id, client_id:clientId,
        category_at_moment:category, branch,
        workout_date:new Date().toISOString(), is_debt:false, is_drop_in:false,
      }];
      const w=await DB.logWorkouts(rows);
      workoutId=w?.[0]?.id;
    }
    if (isAdult && groupTypeId) {
      await DB.logGroupSession(STATE.profile.id, parseInt(groupTypeId), branch, date, headcount);
    }
    await DB.upsertConfirmation(slotId, date, {
      status:'confirmed', actual_headcount:headcount, workout_id:workoutId,
    });
    toast('✅ Занятие подтверждено','success');
    renderTodayTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function doCancelSlot(slotId, date) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Причина отмены</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Причина</label>
      <textarea id="cancel-reason" rows="3" placeholder="Клиент отменил, болезнь..."></textarea></div>
    <button class="btn btn-danger btn-full"
      onclick="doConfirmCancel('${slotId}','${date}')">Отменить занятие</button>
  </div>`;
  document.body.appendChild(m);
}
async function doConfirmCancel(slotId, date) {
  const reason=document.getElementById('cancel-reason')?.value.trim()||'';
  try {
    await DB.upsertConfirmation(slotId, date, {status:'cancelled', cancel_reason:reason||null});
    document.querySelector('.modal-overlay')?.remove();
    toast('Занятие отменено','success'); renderTodayTab();
  } catch(e) { toast('Ошибка','error'); }
}

// ── ТАБ: ДЕЖУРСТВО ───────────────────────────
async function renderDutyTab() {
  const branches=STATE.profile.branches||[];
  const duty=STATE.activeDuty;
  if (duty) {
    $('#tab-content').innerHTML=`<div class="tab-pad center-col">
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
    $('#tab-content').innerHTML=`<div class="tab-pad center-col">
      <div class="duty-idle-card"><div class="duty-icon">🏃</div><p>Дежурство не начато</p></div>
      ${branchSelect('sel-branch',branches)}
      <button class="btn btn-primary btn-full" onclick="doStartDuty()">Начать дежурство</button>
    </div>`;
  }
}
function startDutyTimer(start) {
  if (STATE.dutyTimer) clearInterval(STATE.dutyTimer);
  const tick=()=>{
    const el=document.getElementById('duty-timer'); if (!el) return;
    const s=Math.floor((Date.now()-new Date(start))/1000);
    el.textContent=[Math.floor(s/3600),Math.floor((s%3600)/60),s%60].map(n=>String(n).padStart(2,'0')).join(':');
  };
  tick(); STATE.dutyTimer=setInterval(tick,1000);
}
async function doStartDuty() {
  const branch=getBranch(); if (!branch) return toast('Выберите филиал','error');
  try {
    STATE.activeDuty=await DB.startDuty(STATE.profile.id,branch);
    toast('Дежурство начато','success'); renderTrainerShell('duty');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doEndDuty(id) {
  if (!confirm('Завершить дежурство?')) return;
  if (STATE.dutyTimer) clearInterval(STATE.dutyTimer);
  try {
    const d=await DB.endDuty(id);
    const h=hoursFromDuty(d.start_time,d.end_time);
    STATE.activeDuty=null;
    toast(`✅ ${h.toFixed(1)}ч = ${fmt(Math.round(h*RATES.duty_per_hour))} сум`,'success');
    renderTrainerShell('duty');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: ОТЧЁТ ТРЕНЕРА ───────────────────────
async function renderReportTab() {
  const now=new Date(); let year=now.getFullYear(), month=now.getMonth()+1;
  $('#tab-content').innerHTML=`<div class="tab-pad">
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
  const load=()=>loadTrainerReport(year,month);
  document.getElementById('prev-m')?.addEventListener('click',()=>{if(month===1){year--;month=12;}else month--;document.getElementById('rep-month').textContent=fmtMY(year,month);load();});
  document.getElementById('next-m')?.addEventListener('click',()=>{if(month===12){year++;month=1;}else month++;document.getElementById('rep-month').textContent=fmtMY(year,month);load();});
  await load();
}

async function loadTrainerReport(year, month) {
  const body=document.getElementById('rep-body'); if (!body) return;
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const [workouts,duties,trainerGroups,groupSessions] = await Promise.all([
      DB.getWorkouts(STATE.profile.id,year,month),
      DB.getDuties(STATE.profile.id,year,month),
      DB.getTrainerGroups(STATE.profile.id),
      DB.getGroupSessions(STATE.profile.id,year,month),
    ]);
    const adjustment = await DB.getAdjustment(STATE.profile.id,year,month);
    const sal=calcSalary({workouts,duties,trainerGroups,groupSessions,adjustment});

    body.innerHTML=`
      <div class="summary-cards">
        <div class="summary-card"><div class="s-val">${sal.cat[1]+sal.cat[2]+sal.cat[3]}</div><div class="s-lbl">ПТ</div></div>
        <div class="summary-card"><div class="s-val">${sal.cat.dropIn}</div><div class="s-lbl">Разовые</div></div>
        <div class="summary-card"><div class="s-val">${sal.cat.debt}</div><div class="s-lbl">В долг</div></div>
        <div class="summary-card"><div class="s-val">${sal.hours.toFixed(1)}ч</div><div class="s-lbl">Дежурство</div></div>
        <div class="summary-card accent" style="grid-column:span 2">
          <div class="s-val">${fmt(sal.total)}</div><div class="s-lbl">К выплате (сум)</div>
        </div>
      </div>

      <button class="btn btn-sm" style="margin-bottom:12px;width:100%"
        onclick="doExportTrainer(${STATE.profile.id},'${encodeURIComponent(STATE.profile.fio)}',${year},${month})">
        ⬇️ Скачать Excel
      </button>

      <h4>Тренировки</h4>
      ${!workouts.length?'<p class="hint">Нет записей за период</p>':workouts.map(w=>`
        <div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${w.clients?.fio||'—'}</span>
            <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
            ${w.is_drop_in?'<span class="drop-badge">Разовая</span>':''}
            ${w.is_debt&&!w.debt_confirmed_at?'<span class="debt-badge">В долг</span>':''}
            ${w.is_debt&&w.debt_confirmed_at?'<span class="paid-badge">Оплачено</span>':''}
          </div>
          <div class="hi-sub">${fmtDT(w.workout_date)} · ${w.branch}</div>
          ${w.is_debt&&!w.debt_confirmed_at?`
            <button class="btn btn-sm btn-primary" onclick="doConfirmDebt('${w.id}','${w.client_id}')">
              Подтвердить оплату</button>`:''}
          ${canEdit(w.created_at)&&!w.is_debt?`
            <button class="btn btn-sm btn-danger" onclick="doDeleteWorkout('${w.id}')">Удалить</button>`:''}
        </div>`).join('')}`;
  } catch(e) { body.innerHTML='<p class="hint">Ошибка загрузки</p>'; console.error(e); }
}

async function doExportTrainer(trainerId, fioEnc, year, month) {
  const fio = decodeURIComponent(fioEnc);
  try {
    const d = await DB.getTrainerDetail(trainerId, year, month);
    exportTrainerExcel(fio, year, month, d.workouts, d.duties, d.groupSessions, d.adjustment);
  } catch(e) { toast('Ошибка экспорта','error'); console.error(e); }
}
async function doConfirmDebt(workoutId, clientId) {
  if (!confirm('Подтвердить оплату? Баланс клиента уменьшится на 1.')) return;
  try { await DB.confirmDebt(workoutId,clientId); toast('✅ Долг закрыт','success'); renderReportTab(); }
  catch(e) { toast('Ошибка','error'); }
}
async function doDeleteWorkout(id) {
  if (!confirm('Удалить запись?')) return;
  try { await DB.deleteWorkout(id); toast('Удалено','success'); renderReportTab(); }
  catch(e) { toast('Ошибка','error'); }
}

// ── СТАРШИЙ ТРЕНЕР ────────────────────────────
async function renderSeniorApp() {
  setupBack(null);
  STATE.activeDuty=await DB.getActiveDuty(STATE.profile.id);
  setScreen(`<div class="app-header">
    <div><div class="app-title">⭐ Старший тренер</div>
      <div class="app-sub">${STATE.profile.fio}</div></div>
    <div style="display:flex;gap:8px;align-items:center">
      ${STATE.activeDuty?'<div class="duty-badge active">● Дежурство</div>':''}
      <button class="btn-icon" onclick="openSchedule()">📅</button>
    </div>
  </div>
  <div id="tab-content" class="tab-content"></div>
  <nav class="bottom-nav">
    <button class="nav-btn" onclick="seniorTab('workouts')"><span>📋</span>Списание</button>
    <button class="nav-btn" onclick="seniorTab('schedule')"><span>🗓</span>Расписание</button>
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
  const branches=STATE.profile.branches||[];
  const now=new Date(); let year=now.getFullYear(), month=now.getMonth()+1;
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Отчёт по филиалу</h3>
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

// ── АДМИНИСТРАТОР ────────────────────────────
function renderAdminApp() {
  setupBack(null);
  setScreen(`<div class="app-header">
    <div><div class="app-title">👑 Координатор</div>
      <div class="app-sub">${STATE.profile.fio}</div></div>
    <button class="btn-icon" onclick="openSchedule()">📅</button>
  </div>
  <div id="tab-content" class="tab-content"></div>
  <nav class="bottom-nav">
    <button class="nav-btn" onclick="adminTab('summary')"><span>📊</span>Сводка</button>
    <button class="nav-btn" onclick="adminTab('staff')"><span>👥</span>Персонал</button>
    <button class="nav-btn" onclick="adminTab('branches')"><span>🏢</span>Филиалы</button>
    <button class="nav-btn" onclick="adminTab('groups')"><span>🏊</span>Группы</button>
    <button class="nav-btn" onclick="adminTab('control')"><span>🔍</span>Контроль</button>
  </nav>`);
  adminTab('summary');
}
function adminTab(tab) {
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',['summary','staff','branches','groups','control'][i]===tab));
  if (tab==='summary')  renderAdminSummary();
  if (tab==='staff')    renderAdminStaff();
  if (tab==='branches') renderAdminBranches();
  if (tab==='groups')   renderAdminGroups();
  if (tab==='control')  renderAdminControl();
}

// ─ ADMIN: СВОДКА ─────────────────────────────
async function renderAdminSummary() {
  let year=new Date().getFullYear(), month=new Date().getMonth()+1;
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Сводка</h3>
      <div class="month-nav">
        <button id="prev-s">‹</button><span id="sum-m">${fmtMY(year,month)}</span><button id="next-s">›</button>
      </div>
    </div>
    <div class="form-group"><select id="sum-branch">
      <option value="">Все филиалы</option>
      ${(STATE.profile.branches||[]).map(b=>`<option>${b}</option>`).join('')}
    </select></div>
    <div id="sum-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  let _data=null;
  const getBr=()=>document.getElementById('sum-branch')?.value||null;
  const load=async()=>{_data=await loadAdminSummary(year,month,getBr());};
  document.getElementById('prev-s')?.addEventListener('click',()=>{if(month===1){year--;month=12;}else month--;document.getElementById('sum-m').textContent=fmtMY(year,month);load();});
  document.getElementById('next-s')?.addEventListener('click',()=>{if(month===12){year++;month=1;}else month++;document.getElementById('sum-m').textContent=fmtMY(year,month);load();});
  document.getElementById('sum-branch')?.addEventListener('change',load);
  await load();
}
async function loadAdminSummary(year,month,branch) {
  const body=document.getElementById('sum-body'); if (!body) return;
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const data=await DB.getSummary(year,month,branch||null);
    body.innerHTML=renderSummaryTable(data,year,month,true);
    body.innerHTML+=`<button class="btn btn-sm" style="margin-top:12px;width:100%"
      onclick="doExportSummary(${year},${month},'${branch||''}')">⬇️ Скачать Excel (сводный)</button>`;
    return data;
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

function renderSummaryTable(data,year,month,isAdmin) {
  const {workouts,duties,trainerGroups,groupSessions,profiles,adjustments=[]}=data;
  if (!profiles.length) return '<p class="hint">Нет тренеров</p>';
  const adjMap={}; (adjustments||[]).forEach(a=>{adjMap[a.trainer_id]=a;});
  const rows=profiles.map(p=>{
    const sal=calcSalary({
      workouts:      workouts.filter(w=>w.trainer_id===p.id),
      duties:        duties.filter(d=>d.trainer_id===p.id),
      trainerGroups: trainerGroups.filter(tg=>tg.trainer_id===p.id),
      groupSessions: groupSessions.filter(gs=>gs.trainer_id===p.id),
      adjustment:    adjMap[p.id]||null,
    });
    return {p,sal};
  }).filter(r=>r.sal.cat[1]+r.sal.cat[2]+r.sal.cat[3]+r.sal.hours+r.sal.cat.dropIn>0);
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
        <td>${sal.cat.dropIn}</td><td>${sal.cat.debt}</td>
        <td>${sal.hours.toFixed(1)}ч</td>
        <td>${sal.childSum+sal.adultSum>0?fmt(sal.childSum+sal.adultSum):'—'}</td>
        ${isAdmin?`<td>${sal.bonus?'+'+fmt(sal.bonus):''}${sal.penalty?'−'+fmt(sal.penalty):''}</td>`:''}
        <td class="total-cell">${fmt(sal.total)}</td>
      </tr>`).join('')}
    </tbody>
    <tfoot><tr>
      <td colspan="${isAdmin?9:8}"><b>Итого к выплате</b></td>
      <td class="total-cell"><b>${fmt(grand)}</b></td>
    </tr></tfoot>
  </table></div>
  ${isAdmin?'<p class="hint" style="text-align:center;margin-top:8px">Нажмите строку для детализации</p>':''}`;
}

async function adminDetail(trainerId, fioEnc, year, month) {
  const fio=decodeURIComponent(fioEnc);
  setupBack(()=>{renderAdminApp();adminTab('summary');setupBack(null);});
  $('#tab-content').innerHTML=`<div class="tab-pad"><h3>${fio}</h3>
    <div class="center-screen"><div class="spinner"></div></div></div>`;
  try {
    const d=await DB.getTrainerDetail(trainerId,year,month);
    const sal=calcSalary(d);
    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header">
        <div><h3>${fio}</h3><p class="hint">${fmtMY(year,month)}</p></div>
        <button class="btn btn-sm" onclick="doExportTrainer(${trainerId},'${encodeURIComponent(fio)}',${year},${month})">
          ⬇️ Excel</button>
      </div>
      <div class="summary-cards">
        <div class="summary-card"><div class="s-val">${sal.cat[1]}</div><div class="s-lbl">Кат.1</div></div>
        <div class="summary-card"><div class="s-val">${sal.cat[2]}</div><div class="s-lbl">Кат.2</div></div>
        <div class="summary-card"><div class="s-val">${sal.cat[3]}</div><div class="s-lbl">Кат.3</div></div>
        <div class="summary-card"><div class="s-val">${sal.cat.dropIn}</div><div class="s-lbl">Разовые</div></div>
        <div class="summary-card"><div class="s-val">${sal.hours.toFixed(1)}ч</div><div class="s-lbl">Деж.</div></div>
        <div class="summary-card accent" style="grid-column:span 2">
          <div class="s-val">${fmt(sal.total)}</div><div class="s-lbl">К выплате</div>
        </div>
      </div>

      <div class="adj-form">
        <h4>Премия / Штраф</h4>
        <div style="display:flex;gap:10px;margin-bottom:8px">
          <div class="form-group" style="flex:1;margin:0">
            <label>Премия (сум)</label>
            <input type="number" id="adj-bonus" value="${d.adjustment?.bonus||0}" min="0">
          </div>
          <div class="form-group" style="flex:1;margin:0">
            <label>Штраф (сум)</label>
            <input type="number" id="adj-penalty" value="${d.adjustment?.penalty||0}" min="0">
          </div>
        </div>
        <input id="adj-notes" type="text" placeholder="Комментарий" value="${d.adjustment?.notes||''}">
        <button class="btn btn-sm btn-primary" style="margin-top:8px;width:100%"
          onclick="doSaveAdj(${trainerId},${year},${month})">Сохранить</button>
      </div>

      <h4 style="margin-top:16px">Тренировки</h4>
      ${!d.workouts.length?'<p class="hint">Нет</p>':d.workouts.map(w=>`
        <div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${w.clients?.fio||'—'}</span>
            <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
            ${w.is_drop_in?'<span class="drop-badge">Разовая</span>':''}
            ${w.is_debt&&!w.debt_confirmed_at?'<span class="debt-badge">В долг</span>':''}
          </div>
          <div class="hi-sub">${fmtDT(w.workout_date)} · ${w.branch}</div>
        </div>`).join('')}

      <h4 style="margin-top:16px">Дежурства</h4>
      ${!d.duties.length?'<p class="hint">Нет</p>':d.duties.map(duty=>{
        const h=hoursFromDuty(duty.start_time,duty.end_time);
        return `<div class="history-item">
          <div class="hi-main"><span class="hi-client">${duty.branch}</span>
            <span class="hi-cat">${h.toFixed(2)}ч</span></div>
          <div class="hi-sub">${fmtDT(duty.start_time)} → ${fmtDT(duty.end_time)}</div>
          <div class="hi-sub">${fmt(Math.round(h*RATES.duty_per_hour))} сум</div>
        </div>`;
      }).join('')}
    </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doSaveAdj(trainerId, year, month) {
  const bonus  = parseInt(document.getElementById('adj-bonus')?.value||0);
  const penalty= parseInt(document.getElementById('adj-penalty')?.value||0);
  const notes  = document.getElementById('adj-notes')?.value.trim()||'';
  try { await DB.upsertAdjustment(trainerId,year,month,bonus,penalty,notes); toast('Сохранено ✅','success'); }
  catch(e) { toast('Ошибка','error'); }
}

async function doExportSummary(year, month, branch) {
  try {
    const data=await DB.getSummary(year,month,branch||null);
    exportSummaryExcel(year,month,data);
  } catch(e) { toast('Ошибка экспорта','error'); console.error(e); }
}

// ─ ADMIN: ПЕРСОНАЛ ────────────────────────────
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
const ROLE_LBL={trainer:'Тренер',senior_trainer:'Ст.тренер',admin:'Администратор'};
async function loadStaffList() {
  const body=document.getElementById('staff-list'); if (!body) return;
  const role=document.getElementById('role-filter')?.value||'';
  try {
    let profiles=await DB.getAllProfiles();
    if (role) profiles=profiles.filter(p=>p.role===role);
    body.innerHTML=!profiles.length?'<p class="hint">Нет сотрудников</p>':
      profiles.map(t=>`<div class="staff-card">
        <div class="staff-info">
          <div class="staff-fio">${t.fio}</div>
          <div class="staff-meta">${ROLE_LBL[t.role]||t.role} · ${t.tg_id?'✅':'⏳'} · ${(t.branches||[]).join(', ')||'—'}</div>
        </div>
        <button class="btn btn-sm" onclick="renderEditTrainerModal(${t.id},'${encodeURIComponent(t.fio)}','${(t.branches||[]).join(',')}','${t.role}')">✏️</button>
      </div>`).join('');
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; }
}
function renderAddTrainerModal() {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить сотрудника</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>ФИО</label><input id="nt-fio" type="text"></div>
    <div class="form-group"><label>Роль</label>
      <select id="nt-role">
        <option value="trainer">Тренер</option>
        <option value="senior_trainer">Старший тренер</option>
        <option value="admin">Администратор</option>
      </select></div>
    <div class="form-group"><label>Филиалы (через запятую)</label>
      <input id="nt-branches" placeholder="${(STATE.profile.branches||[]).join(', ')}"></div>
    <button class="btn btn-primary btn-full" onclick="doAddTrainer()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddTrainer() {
  const fio=document.getElementById('nt-fio')?.value.trim();
  const role=document.getElementById('nt-role')?.value;
  const brs=(document.getElementById('nt-branches')?.value||'').split(',').map(b=>b.trim()).filter(Boolean);
  if (!fio)        return toast('Введите ФИО','error');
  if (!brs.length) return toast('Укажите филиал','error');
  try {
    await DB.addTrainer(fio,brs,role);
    document.querySelector('.modal-overlay')?.remove();
    toast('Добавлено ✅','success'); loadStaffList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderEditTrainerModal(id,fioEnc,branches,role) {
  const fio=decodeURIComponent(fioEnc);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>ФИО</label><input id="et-fio" value="${fio}"></div>
    <div class="form-group"><label>Роль</label>
      <select id="et-role">
        <option value="trainer" ${role==='trainer'?'selected':''}>Тренер</option>
        <option value="senior_trainer" ${role==='senior_trainer'?'selected':''}>Старший тренер</option>
        <option value="admin" ${role==='admin'?'selected':''}>Администратор</option>
      </select></div>
    <div class="form-group"><label>Филиалы</label><input id="et-branches" value="${branches}"></div>
    <button class="btn btn-primary btn-full" onclick="doEditTrainer(${id})">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditTrainer(id) {
  const fio=(document.getElementById('et-fio')?.value||'').trim();
  const role=document.getElementById('et-role')?.value;
  const brs=(document.getElementById('et-branches')?.value||'').split(',').map(b=>b.trim()).filter(Boolean);
  if (!fio) return toast('Введите ФИО','error');
  try {
    await DB.updateProfile(id,{fio,role,branches:brs});
    document.querySelector('.modal-overlay')?.remove();
    toast('Сохранено ✅','success'); loadStaffList();
  } catch(e) { toast('Ошибка','error'); }
}

// ─ ADMIN: ФИЛИАЛЫ ─────────────────────────────
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
    const branches=await DB.getBranches();
    body.innerHTML=!branches.length?'<p class="hint">Нет филиалов</p>':
      branches.map(b=>`<div class="staff-card">
        <div class="staff-info"><div class="staff-fio">🏢 ${b.name}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="renderRenameBranchModal(${b.id},'${encodeURIComponent(b.name)}')">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="doDeleteBranch(${b.id},'${b.name}')">🗑</button>
        </div>
      </div>`).join('');
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; }
}
function renderAddBranchModal() {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новый филиал</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label><input id="br-name" placeholder="Центр"></div>
    <button class="btn btn-primary btn-full" onclick="doAddBranch()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddBranch() {
  const name=document.getElementById('br-name')?.value.trim();
  if (!name) return toast('Введите название','error');
  try { await DB.addBranch(name); document.querySelector('.modal-overlay')?.remove(); toast('Добавлено ✅','success'); loadBranchesList(); }
  catch(e) { toast('Такой филиал уже есть','error'); }
}
function renderRenameBranchModal(id, nameEnc) {
  const name=decodeURIComponent(nameEnc);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Переименовать</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Обновит название во всех записях (тренировках, дежурствах, расписании).</p>
    <div class="form-group"><label>Текущее</label><input disabled value="${name}"></div>
    <div class="form-group"><label>Новое название</label><input id="br-new-name" value="${name}"></div>
    <button class="btn btn-primary btn-full" onclick="doRenameBranch('${name}')">Переименовать</button>
  </div>`;
  document.body.appendChild(m);
}
async function doRenameBranch(oldName) {
  const newName=document.getElementById('br-new-name')?.value.trim();
  if (!newName||newName===oldName) return toast('Введите новое название','error');
  try {
    await DB.renameBranch(oldName,newName);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Переименовано во всех записях','success'); loadBranchesList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteBranch(id,name) {
  if (!confirm(`Удалить филиал «${name}» из справочника?`)) return;
  try { await DB.deleteBranch(id); toast('Удалено','success'); loadBranchesList(); }
  catch(e) { toast('Ошибка','error'); }
}

// ─ ADMIN: ГРУППЫ ─────────────────────────────
async function renderAdminGroups() {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Группы</h3>
      <button class="btn btn-sm" onclick="renderAddGroupTypeModal()">+ Тип</button></div>
    <div id="groups-list"><div class="center-screen"><div class="spinner"></div></div></div>
    <h4 style="margin-top:20px">Назначить группу тренеру</h4>
    <div id="assign-form"></div>
  </div>`;
  await loadGroupsList(); await renderAssignGroupForm();
}
async function loadGroupsList() {
  const body=document.getElementById('groups-list'); if (!body) return;
  try {
    const types=await DB.getGroupTypes();
    body.innerHTML=types.map(gt=>`<div class="staff-card">
      <div class="staff-info">
        <div class="staff-fio">${gt.name}</div>
        <div class="staff-meta">${gt.type==='children'?`Детская · ${fmt(gt.price_per_month)} сум/мес · ${gt.trainer_percentage}%`:'Взрослая · по явке'}</div>
      </div>
    </div>`).join('')||'<p class="hint">Нет типов групп</p>';
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; }
}
function renderAddGroupTypeModal() {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Тип группы</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label><input id="gt-name" placeholder="Аквааэробика"></div>
    <div class="form-group"><label>Тип</label>
      <select id="gt-type" onchange="this.nextElementSibling.style.display=this.value==='children'?'':'none'">
        <option value="children">Детская (% от абонемента)</option>
        <option value="adult">Взрослая (по явке)</option>
      </select></div>
    <div id="gt-child-fields">
      <div class="form-group"><label>Стоимость абонемента (сум/мес)</label>
        <input id="gt-price" type="number" value="1000000"></div>
      <div class="form-group"><label>% тренеру</label>
        <input id="gt-pct" type="number" value="40" min="1" max="100"></div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doAddGroupType()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddGroupType() {
  const name=document.getElementById('gt-name')?.value.trim();
  const type=document.getElementById('gt-type')?.value;
  const price=parseInt(document.getElementById('gt-price')?.value||0);
  const pct=parseInt(document.getElementById('gt-pct')?.value||40);
  if (!name) return toast('Введите название','error');
  try {
    await DB.addGroupType({name,type,billing_model:type==='children'?'percentage':'headcount',
      price_per_month:type==='children'?price:0, trainer_percentage:type==='children'?pct:0});
    document.querySelector('.modal-overlay')?.remove();
    toast('Тип добавлен ✅','success'); loadGroupsList();
  } catch(e) { toast('Ошибка (название уникальное)','error'); }
}
async function renderAssignGroupForm() {
  const form=document.getElementById('assign-form'); if (!form) return;
  try {
    const [trainers,seniors,gts,branches]=await Promise.all([
      DB.getProfilesByRole('trainer'),DB.getProfilesByRole('senior_trainer'),
      DB.getGroupTypes(),DB.getBranches(),
    ]);
    const allT=[...trainers,...seniors];
    // Для детских групп — нужна дата начала абонемента
    form.innerHTML=`
      <div class="form-group"><label>Тренер</label><select id="ag-trainer">
        ${allT.map(t=>`<option value="${t.id}">${t.fio}</option>`).join('')}
      </select></div>
      <div class="form-group"><label>Тип группы</label>
        <select id="ag-type" onchange="onAgTypeChange(this,${JSON.stringify(gts).replace(/"/g,'&quot;')})">
          ${gts.map(g=>`<option value="${g.id}" data-type="${g.type}">${g.name}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Филиал</label><select id="ag-branch">
        ${branches.map(b=>`<option>${b.name}</option>`).join('')}
      </select></div>
      <div id="ag-date-wrap" class="form-group"><label>Начало абонемента</label>
        <input type="date" id="ag-start" value="${todayStr()}"></div>
      <button class="btn btn-primary" onclick="doAssignGroup()">Назначить группу</button>`;
    // Проверим сразу
    const sel=document.getElementById('ag-type');
    if (sel) onAgTypeChange(sel, gts);
  } catch(e) { form.innerHTML='<p class="hint">Ошибка</p>'; }
}
function onAgTypeChange(sel, gts) {
  const opt=sel.options[sel.selectedIndex];
  const isChildren=opt?.dataset.type==='children';
  const wrap=document.getElementById('ag-date-wrap');
  if (wrap) wrap.style.display=isChildren?'':'none';
}
async function doAssignGroup() {
  const trainerId=parseInt(document.getElementById('ag-trainer')?.value);
  const groupTypeId=parseInt(document.getElementById('ag-type')?.value);
  const branch=document.getElementById('ag-branch')?.value;
  const start=document.getElementById('ag-start')?.value||todayStr();
  if (!trainerId||!groupTypeId||!branch) return toast('Заполните все поля','error');
  try { await DB.addTrainerGroup(trainerId,groupTypeId,branch,start); toast('✅ Группа назначена','success'); }
  catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ─ ADMIN: КОНТРОЛЬ ───────────────────────────
async function renderAdminControl() {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <h3>Контроль</h3><p class="hint" style="margin-bottom:16px">Проблемные и подозрительные места</p>
    <div class="center-screen"><div class="spinner"></div></div>
  </div>`;
  try {
    const data=await DB.getControlData();
    // Активные тренеры этого месяца
    const now=new Date(); const y=now.getFullYear(), mo=now.getMonth()+1;
    const from=new Date(y,mo-1,1).toISOString(), to=new Date(y,mo,1).toISOString();
    const {data:activeIds}=await sb().from('workouts').select('trainer_id').gte('workout_date',from).lt('workout_date',to);
    const activeSet=new Set((activeIds||[]).map(x=>x.trainer_id));
    const inactive=data.inactiveTrainers.filter(t=>!activeSet.has(t.id));

    const sections=[];

    if (data.expiringClients.length) sections.push(`
      <div class="control-section">
        <div class="control-title warn">⚠️ Абонементы истекают (${data.expiringClients.length})</div>
        ${data.expiringClients.map(c=>`<div class="control-item">
          <div class="ci-main">${c.fio} <span class="hint">→ ${c.profiles?.fio||'?'}</span></div>
          <div class="ci-sub">Истекает: ${c.subscription_end} (${daysUntil(c.subscription_end)} дн.)</div>
        </div>`).join('')}
      </div>`);

    if (data.oldDebt.length) sections.push(`
      <div class="control-section">
        <div class="control-title danger">❗ Долг > 3 дней не подтверждён (${data.oldDebt.length})</div>
        ${data.oldDebt.map(w=>`<div class="control-item">
          <div class="ci-main">${w.clients?.fio||'?'} <span class="hint">← ${w.profiles?.fio||'?'}</span></div>
          <div class="ci-sub">${fmtDate(w.workout_date)}</div>
        </div>`).join('')}
      </div>`);

    if (data.childDropinAbuse.length) sections.push(`
      <div class="control-section">
        <div class="control-title danger">🚫 Дети с повторным разовым (${data.childDropinAbuse.length})</div>
        ${data.childDropinAbuse.map(c=>`<div class="control-item">
          <div class="ci-main">${c.fio} (${c.age} лет)</div>
          <div class="ci-sub">Тренер: ${c.profiles?.fio||'?'}</div>
        </div>`).join('')}
      </div>`);

    if (data.suspiciousBatch.length) sections.push(`
      <div class="control-section">
        <div class="control-title warn">🔍 Подозрительные пакетные (> 3 ПТ за раз)</div>
        ${data.suspiciousBatch.map(x=>`<div class="control-item">
          <div class="ci-main">${x.rec.profiles?.fio||'?'}</div>
          <div class="ci-sub">«${x.rec.notes}» — ${x.count} ПТ · ${fmtDate(x.rec.workout_date)}</div>
        </div>`).join('')}
      </div>`);

    if (inactive.length) sections.push(`
      <div class="control-section">
        <div class="control-title hint-title">💤 Нет активности в этом месяце (${inactive.length})</div>
        ${inactive.map(t=>`<div class="control-item">
          <div class="ci-main">${t.fio}</div>
          <div class="ci-sub">${(t.branches||[]).join(', ')}</div>
        </div>`).join('')}
      </div>`);

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <h3>Контроль</h3><p class="hint" style="margin-bottom:16px">На ${todayStr()}</p>
      ${sections.length?sections.join(''):'<div class="empty-state">✅<p>Проблем не обнаружено</p></div>'}
    </div>`;
  } catch(e) { toast('Ошибка загрузки','error'); console.error(e); }
}

window.addEventListener('DOMContentLoaded', init);
