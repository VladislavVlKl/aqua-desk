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
        ${renderSessionsList(workouts,activeSub.id,clientId,canEdit,client.fio)}`
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

function renderSessionsList(workouts, activeSubId, clientId, canEdit=true, clientFio='') {
  // Фильтруем: конспекты нужны только для обычных ПТ (не разовые, не долг без подтверждения)
  const ptWorkouts = workouts.filter(w => !w.is_drop_in && (!w.is_debt || w.debt_confirmed_at));
  if (!ptWorkouts.length) return '<p class="hint">Нет тренировок по абонементу</p>';
  // Явные дубли: ≥2 ПТ, созданные почти одновременно (двойной тап) — их разрешаем удалять
  // напрямую даже после 30-мин окна. Все ptWorkouts здесь — один клиент.
  const dupIds = new Set();
  for (let i=0;i<ptWorkouts.length;i++) {
    for (let j=0;j<ptWorkouts.length;j++) {
      if (i===j) continue;
      if (Math.abs(new Date(ptWorkouts[i].created_at)-new Date(ptWorkouts[j].created_at))<=DUP_WORKOUT_WINDOW_MS) {
        dupIds.add(ptWorkouts[i].id); break;
      }
    }
  }
  const fioEnc = encodeURIComponent(clientFio||'');
  return ptWorkouts.map((w,i)=>{
    const note = w.session_notes;
    const hasNote = note?.accomplishments;
    const ageMs = Date.now() - new Date(w.workout_date).getTime();
    const isOverdue = !hasNote && ageMs > 48*3600000;
    const canWriteNote = canEdit && ageMs < 30*24*3600000; // можно писать в течение 30 дней
    // Кнопка удаления (canEdit тут = boolean, глобальная canEdit() затенена — окно считаем вручную)
    const withinEditWindow = (Date.now()-new Date(w.created_at)) < EDIT_WINDOW_MIN*60000;
    const delBtn = (canEdit && !w.is_debt) ? (
      withinEditWindow
        ? `<button class="btn btn-sm btn-danger" style="font-size:11px;margin-top:6px" onclick="doDeleteWorkout('${w.id}','${clientId}')">🗑 Удалить</button>`
        : (dupIds.has(w.id)
            ? `<button class="btn btn-sm btn-danger" style="font-size:11px;margin-top:6px" title="Дубль — создан почти одновременно с другой записью" onclick="doDeleteDuplicate('${w.id}','${clientId}')">🗑 Удалить дубль</button>`
            : `<button class="btn btn-sm" style="font-size:11px;margin-top:6px;background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.25)" onclick="doRequestWorkoutDelete('${w.id}','${w.workout_date}','${fioEnc}','${w.branch||''}')">🗑 Запрос на удаление</button>`)
    ) : '';
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
      ${delBtn}
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
