// =============================================
// app.trainer.js — вынесено из app.js (Этап 3)
// Секции: TRAINER:SHELL/HOME/CLIENTS/WORKOUTS/CLIENTS:ADD/SCHEDULE/TODAY/DUTIES/EVENTS/REPORT
// Только объявления функций (top-level кода нет) — грузится после app.js (core+auth+client+senior).
// =============================================

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
        <div class="form-group"><label>Тренер Б <span class="required">*</span></label>
          <select id="wk-sub-trainer">
            <option value="">— выберите тренера —</option>
            ${(await cached('profiles',()=>DB.getAllProfiles())).filter(p=>p.role!=='admin'&&p.id!==STATE.profile.id)
              .sort((a,b)=>a.fio.localeCompare(b.fio,'ru'))
              .map(p=>`<option value="${p.id}">${p.fio}</option>`).join('')}
          </select>
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
            <span style="font-size:12px;${noBalance?'color:#ef4444;font-weight:600':'color:var(--hint)'}">${c.balance} ПТ</span>
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
    subTrainerId = document.getElementById('wk-sub-trainer')?.value || '';
    if (!subTrainerId) return toast('Выберите тренера для замены','error');
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
      if (s.slot_type==='pt' && (s.clients?.balance||0)<=0) return; // нулевой остаток ПТ
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
      if (s.slot_type==='pt' && (s.clients?.balance||0)<=0) return; // нулевой остаток ПТ
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

    // Скрываем ПТ-слоты клиентов с нулевым остатком (закрытые/истёкшие абонементы),
    // кроме уже подтверждённых на сегодня — их оставляем, чтобы не «потерять» проведённую тренировку.
    const ptSlots=slots.filter(s=>s.slot_type==='pt' && ((s.clients?.balance||0)>0 || s.confirmation));
    const grpSlots=slots.filter(s=>s.slot_type==='group');
    const dutySlots=slots.filter(s=>s.slot_type==='duty');
    const pending=[...ptSlots,...grpSlots].filter(s=>!s.confirmation).length;
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
      ${!ptSlots.length&&!grpSlots.length&&!dutySlots.length&&!todayEvents.length&&!missedSlots.length?'<div class="empty-state">📭<p>На сегодня ничего нет</p></div>':''}
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
            <div style="display:flex;gap:6px;align-items:center">
              ${w.reception_status==='pending'?'<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(245,158,11,.15);color:#f59e0b">⏳</span>':''}
              <span style="font-size:12px;padding:2px 8px;border-radius:8px;background:rgba(16,185,129,.1);color:${color};font-weight:600">${type}</span>
            </div>
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
    renderAdminControl(true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doRejectLateRequest(id) {
  const note = prompt('Причина отказа (опционально):');
  if (note === null) return; // отмена
  try {
    await DB.rejectLateRequest(id, STATE.profile.id, note);
    toast('Запрос отклонён','success');
    renderAdminControl(true);
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
    // Все запросы независимы — грузим одним батчем (1 round-trip вместо 6 последовательных)
    const [workouts,duties,trainerGroups,groupSessions,childAuto,groupSubstitutions,trialSessions,adjustment,unpaidGroups,pending,transfers,lateRequests]=await Promise.all([
      DB.getWorkouts(STATE.profile.id,year,month),
      DB.getDuties(STATE.profile.id,year,month),
      DB.getTrainerGroups(STATE.profile.id),
      DB.getGroupSessions(STATE.profile.id,year,month),
      DB.getChildGroupsAutoSalary(STATE.profile.id, fromDay),
      sb().from('group_substitutions').select('*, trainer_groups(*, group_types(name))').eq('substitute_trainer_id',STATE.profile.id).gte('session_date',fromDay).lt('session_date',new Date(year,month,1).toISOString().slice(0,10)).then(r=>r.data||[]),
      DB.getTrialSessions(STATE.profile.id,year,month),
      DB.getAdjustment(STATE.profile.id,year,month),
      DB.getGroupUnpaidAttendees(STATE.profile.id, fromDay).catch(()=>[]),
      DB.getPendingConfirmations(STATE.profile.id),
      DB.getIncomingTransfers(STATE.profile.id),
      DB.getMyLateRequests(STATE.profile.id).catch(()=>[]),
    ]);
    // Ресепшн-статус: в ЗП идёт только confirmed; rejected исключается; pending — отдельной строкой.
    // Старые записи бэкфилнуты в confirmed → всё кроме 'pending'/'rejected' считаем confirmed.
    const wConfirmed = workouts.filter(w=>w.reception_status!=='pending'&&w.reception_status!=='rejected');
    const wPending   = workouts.filter(w=>w.reception_status==='pending');
    const tConfirmed = trialSessions.filter(t=>t.reception_status!=='pending'&&t.reception_status!=='rejected');
    const tPending   = trialSessions.filter(t=>t.reception_status==='pending');
    const sal=calcSalary({workouts:wConfirmed,duties,trainerGroups,groupSessions,adjustment,groupSubstitutions,trialSessions:tConfirmed,trainerId:STATE.profile.id,childAutoSum:childAuto.total});
    const salP=calcSalary({workouts:wPending,trialSessions:tPending,trainerId:STATE.profile.id});
    const pendingPtSum = salP.ptSum + salP.dropInSum + salP.trialSum + salP.ptSubSum;
    const pendingCnt = wPending.length + tPending.length;
    // ⚠️ unpaidGroups (дети ходят, но не платят), pending (замены), transfers (передачи)
    // и lateRequests загружены выше в общем Promise.all
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

        ${(sal.cat[1]||sal.cat[2]||sal.cat[3]||sal.cat.dropIn1||sal.cat.dropIn2||sal.cat.dropIn3||trialSessions.length||sal.ptSubSum||pendingPtSum)?`
        <div style="font-size:12px;color:var(--hint);font-weight:600;margin-bottom:4px">ПЕРСОНАЛЬНЫЕ ТРЕНИРОВКИ</div>
        ${sal.cat[1]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>К1 × ${sal.cat[1]} шт</span><span style="font-weight:600">${fmt(sal.cat[1]*RATES.pt[1])} сум</span></div>`:''}
        ${sal.cat[2]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>К2 × ${sal.cat[2]} шт</span><span style="font-weight:600">${fmt(sal.cat[2]*RATES.pt[2])} сум</span></div>`:''}
        ${sal.cat[3]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>К3 × ${sal.cat[3]} шт</span><span style="font-weight:600">${fmt(sal.cat[3]*RATES.pt[3])} сум</span></div>`:''}
        ${sal.cat.dropIn1||sal.cat.dropIn2||sal.cat.dropIn3?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Разовые (${(sal.cat.dropIn1||0)+(sal.cat.dropIn2||0)+(sal.cat.dropIn3||0)} шт)</span><span style="font-weight:600">${fmt(sal.dropInSum)} сум</span></div>`:''}
        ${tConfirmed.length?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Пробные (${tConfirmed.length} шт)</span><span style="font-weight:600">${fmt(sal.trialSum)} сум</span></div>`:''}
        ${sal.ptSubSum?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Замены ПТ</span><span style="font-weight:600">${fmt(sal.ptSubSum)} сум</span></div>`:''}
        ${pendingPtSum?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px;color:var(--hint)"><span>⏳ В ожидании ресепшн (${pendingCnt} шт)</span><span style="font-weight:600">${fmt(pendingPtSum)} сум</span></div>`:''}
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

      ${unpaidGroups.length?`<div class="warn-banner" style="background:rgba(245,158,11,.1);border-color:rgba(245,158,11,.35);color:var(--text);cursor:pointer" onclick="this.querySelector('.unpaid-list').style.display=this.querySelector('.unpaid-list').style.display==='none'?'block':'none'">
        <b>⚠️ Ходят, но не оплатили (${unpaidGroups.reduce((s,g)=>s+g.children.length,0)})</b>
        <div class="hint" style="margin-top:2px">ЗП по этим детям не начисляется — напомните родителям. Нажмите, чтобы раскрыть.</div>
        <div class="unpaid-list" style="display:none;margin-top:8px">
          ${unpaidGroups.map(g=>`<div style="margin-bottom:6px"><b style="font-size:13px">${g.groupName}</b><div class="hint">${g.children.join(', ')}</div></div>`).join('')}
        </div>
      </div>`:''}

      <h4>Тренировки за месяц</h4>
      ${!workouts.length?'<p class="hint">Нет записей за этот период</p>':workouts.map(w=>`
        <div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${w.clients?.fio||'—'}</span>
            <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
            ${w.is_drop_in?`<span class="drop-badge">Разовая ${w.drop_in_category||1}кт</span>`:''}
            ${w.is_debt&&!w.debt_confirmed_at?'<span class="debt-badge">В долг</span>':''}
            ${w.is_debt&&w.debt_confirmed_at?'<span class="paid-badge">Оплачено</span>':''}
            ${w.reception_status==='pending'?'<span style="font-size:11px;background:rgba(245,158,11,.15);color:#f59e0b;padding:2px 8px;border-radius:8px">⏳ ожидает</span>':''}
            ${w.reception_status==='rejected'?'<span style="font-size:11px;background:rgba(239,68,68,.15);color:#ef4444;padding:2px 8px;border-radius:8px">✗ отклонено</span>':''}
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
      ${lateRequests.length?`
        <h4 style="margin-top:16px">⏰ Мои запросы на поздние тренировки</h4>
        ${lateRequests.map(r=>{
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
        }).join('')}`:''}
      ${trialSessions.length?`
        <h4 style="margin-top:16px">🆕 Пробные тренировки</h4>
        ${trialSessions.map(t=>`<div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${t.first_name}${t.last_name?' '+t.last_name:''}</span>
            <span class="hi-cat cat-${t.category}">Кат.${t.category}</span>
            <span style="font-size:11px;background:rgba(139,92,246,.15);color:#7c3aed;padding:2px 6px;border-radius:6px">Пробная</span>
            ${t.reception_status==='pending'?'<span style="font-size:11px;background:rgba(245,158,11,.15);color:#f59e0b;padding:2px 8px;border-radius:8px">⏳ ожидает</span>':''}
            ${t.reception_status==='rejected'?'<span style="font-size:11px;background:rgba(239,68,68,.15);color:#ef4444;padding:2px 8px;border-radius:8px">✗ не оплачено</span>':''}
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

// Списание ПТ из общего пакета (зал+бассейн) — тренер вносит, сколько клиент отходил в ТЗ
function renderGymDeductModal(clientId, fioEnc, balance) {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header">
      <h3>➖ Списать в ТЗ</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
    </div>
    <p class="hint" style="margin-bottom:12px">${fio} — общий пакет зал+бассейн.<br>Текущий остаток: <strong>${balance} ПТ</strong>. Укажите, сколько клиент отходил в зале.</p>
    <div class="form-group">
      <label>Сколько ПТ списать (зал)</label>
      <input type="number" id="gym-deduct-n" min="1" max="${balance}" value="1" inputmode="numeric">
    </div>
    <button class="btn btn-primary btn-full" id="btn-gym-deduct"
      onclick="doGymDeduct('${clientId}')">Списать</button>
  </div>`;
  document.body.appendChild(m);
}
async function doGymDeduct(clientId) {
  const n = parseInt($('#gym-deduct-n')?.value);
  if (!n || n < 1) return toast('Укажите количество','error');
  const btn = $('#btn-gym-deduct'); if (btn) btn.disabled = true;
  try {
    const r = await DB.deductGymSessions(clientId, n, STATE.profile);
    document.querySelector('.modal-overlay')?.remove();
    toast(`✅ Списано в ТЗ: ${r.deducted} ПТ · остаток ${r.after}`,'success');
    renderClientProfile(clientId);
  } catch(e){ console.error(e); toast('Ошибка','error'); if(btn) btn.disabled=false; }
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
async function renderTransferClientModal(clientId, clientFio, fromTrainerId) {
  const profiles = (await cached('profiles',()=>DB.getAllProfiles()))
    .filter(p=>p.role!=='admin'&&p.id!==STATE.profile.id)
    .sort((a,b)=>a.fio.localeCompare(b.fio,'ru'));
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Передать клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Клиент: <b>${clientFio}</b></p>
    <div class="form-group"><label>Тренер <span class="required">*</span></label>
      <select id="transfer-trainer">
        <option value="">— выберите тренера —</option>
        ${profiles.map(p=>`<option value="${p.id}">${p.fio}</option>`).join('')}
      </select>
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
  const toId = document.getElementById('transfer-trainer')?.value || '';
  const note = document.getElementById('transfer-note')?.value.trim()||'';
  if (!toId) return toast('Выберите тренера','error');
  try {
    await DB.initiateTransfer(clientId, fromTrainerId, toId, STATE.profile.id, note);
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

