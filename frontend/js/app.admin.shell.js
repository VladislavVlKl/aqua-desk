// =============================================
// app.admin.js — координатор: управление (Этап 3)
// Секции: ADMIN:SHELL / ANALYTICS / CLIENTS / SALARY / STAFF / BRANCHES
// Грузится после app.js и app.trainer.js. Операционка вынесена в app.admin-ops.js.
// =============================================

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
      <button class="btn-icon" onclick="openSelfInBrowser()" title="Открыть в браузере (больше экран)">🖥</button>
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
    ${isDev()?`<button class="nav-btn" onclick="adminTab('dev')"><span>🛠</span>Дев</button>`:''}
  </nav>`);
  adminTab(initialTab);
  setTimeout(checkInAppNotifications, 2000);
}
function adminTab(tab) {
  // Сброс навигации хаба/глубокого экрана: иначе нативная «назад» Telegram остаётся
  // висеть со старым колбэком после ухода из хаба через нижнюю навигацию.
  setupBack(null); STATE._backFn = null;
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',
    ['summary','analytics','clients','staff','groups','control','more','dev'][i]===tab));
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
  if (tab==='dev' && isDev()) renderDevPanel(); // SECTION: DEV
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
        onclick="adminTab('tech')">⚙️ Техчасть</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="renderCoordinatorSchedule()">📅 Расписание</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="renderAdminSessionNotes()">📝 Конспекты и цели</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);text-align:left;padding:14px 16px;border-radius:12px"
        onclick="renderAdminMonitoring()">📋 Мониторинг</button>
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
  // Экран переиспользуется панелью старшего тренера (renderSeniorMore) — возврат по роли,
  // иначе «назад» уводит старшего на панель координатора.
  setupBack(()=>{
    if (curRole()==='senior_trainer') seniorTab('more');
    else renderAdminApp('more');
    setupBack(null);
  });
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
