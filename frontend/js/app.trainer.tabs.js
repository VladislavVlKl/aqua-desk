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
              data-age="${c.age||''}" data-di="${c.drop_in_used}" data-archived="${c.is_archived?'1':''}" data-frozen="${isFrozen?'1':''}" data-weekend="${c.is_weekend?'1':''}">
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
          <option value="late_request">⏰ Старше 72ч — запросить одобрение</option>
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
    // Сортировка: истекает скоро (есть ПТ) → обычные → закончившийся пакет (balance<=0)
    // вниз, над архивными → архивные в самый конец. Внутри группы — по алфавиту.
    arr = [...arr].sort((a,b)=>{
      const score = c=>{
        if (c.is_archived) return 30;           // архивные — в самый конец
        if (c.balance<=0)  return 20;           // пакет закончился — вниз, над архивными
        const d=daysUntil(c.subscription_end);
        if (d!==null&&d<0) return 0;           // членство истекло, но ПТ ещё есть — наверх (алерт)
        if (d!==null&&d<=SUBSCRIPTION_WARN_DAYS) return 1; // истекает скоро
        return 2;                               // обычные активные
      };
      return score(a)-score(b) || a.fio.localeCompare(b.fio,'ru');
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
            ${!isFrozen&&c.subscription_end?(()=>{
              const col = exp?'#ef4444':warn?'#f59e0b':'#10b981';
              const lbl = days<0?'истёк':days===0?'сегодня':`${days} дн.`;
              return `<span style="font-size:13.5px;font-weight:700;color:${col}">⏳ ${lbl}</span>`
                   + `<span style="font-size:11px;color:var(--hint)">${c.subscription_end}</span>`;
            })():''}
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
    // Добавляем свежие тренировки (ещё не старше 72ч, не видны в БД-запросе)
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
