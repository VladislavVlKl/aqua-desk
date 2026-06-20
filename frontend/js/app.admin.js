// =============================================
// app.admin.js — вынесено из app.js (Этап 3)
// Секции: ADMIN:SHELL / ANALYTICS / CLIENTS / SALARY / STAFF / BRANCHES / GROUPS / CONTROL / TECH
// Грузится СТРОГО после app.js (зависит от STATE, утилит, рендеров ядра).
// Содержит top-level: window._glInstances = {}. Порядок исполнения сохранён.
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
        onclick="adminTab('tech')">⚙️ Операционка</button>
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

// Подобрать купленный пакет под (возможно нестандартный) баланс абонемента → { qty, price }.
// Дети: докупать/переносить НЕЛЬЗЯ — баланс только убывает, неиспользованное сгорает.
//   Поэтому купленный пакет = ближайший стандартный ≥ баланса (округление ВВЕРХ),
//   10/25/50 (5 не заведён); баланс >50 — аномалия, потолок 50.
// Взрослые: платят за занятия и могут накапливать → наибольший стандартный ≤ баланса
//   (баланс = купленный пакет + перенесённый остаток), 10/5/1.
function _pkgMatch(child, balance, cat) {
  if (!balance || balance <= 0) return { qty:null, price:undefined };
  if (child) {
    for (const t of [10,25,50]) if (balance <= t) return { qty:t, price: CHILD_SUB_PRICES[t]?.[cat] };
    return { qty:50, price: CHILD_SUB_PRICES[50]?.[cat] }; // >50 — аномалия
  }
  for (const t of [10,5,1]) if (balance >= t) return { qty:t, price: ADULT_SUB_PRICES[t]?.[cat] };
  return { qty:null, price:undefined };
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
// Воркауты за месяц нужны сразу трём загрузчикам (Деньги/Загрузка/Контроль).
// Общий ключ + in-flight дедуп в cached() → один запрос вместо трёх параллельных.
function _anWs(year, month, branch) {
  return cached(`an_ws_${branch||'all'}_${year}_${month}`,
    () => DB.getAnWorkouts(year, month, branch), 300000);
}
function _anMoney(year, month, branch) {
  return cached(`an_money_${branch||'all'}_${year}_${month}`, async () => {
    const pr   = await calcMonthPayroll(branch, year, month);
    const data = pr.raw;
    const [childRev, subsRev, ws, allSubs] = await Promise.all([
      DB.getAnGroupRevenue(year, month, branch).catch(()=>[]),
      DB.getAnSubsRevenue(year, month, branch).catch(()=>[]),
      _anWs(year, month, branch).catch(()=>[]),
      DB.getAnAllSubs(year, month).catch(()=>[]),
    ]);
    const fioMap = {}; (data.profiles||[]).forEach(p=>{ fioMap[p.id]=p.fio; });
    const rev = {adultSub:0, childSub:0, drop:0, childGroup:0};
    const revByTrainer = {};
    const addRT = (id,v)=>{ revByTrainer[id]=(revByTrainer[id]||0)+v; };

    // Карта абонементов клиента (для accrual: размер пакета на дату занятия)
    const subMap = {};
    allSubs.forEach(s=>{ (subMap[s.client_id]=subMap[s.client_id]||[]).push(s); });
    Object.values(subMap).forEach(a=>a.sort((x,y)=>(y.start_date||'').localeCompare(x.start_date||'')));
    const qtyFor = (cid,date)=>{ const a=subMap[cid]||[]; const s=a.find(x=>(x.start_date||'')<=date)||a[a.length-1]; return s?.initial_balance; };

    // Проведённые ПТ: разовые/пробные → PT_PRICES (одинаково в обоих способах);
    // обычные ПТ копим для способа Б (accrual) = цена пакета ÷ кол-во.
    let accrualReg = 0;
    (ws||[]).forEach(w=>{
      const paid = !w.is_debt || w.debt_confirmed_at;
      if (!paid) return;
      if (w.is_drop_in) { const v=PT_PRICES[w.drop_in_category||1]; rev.drop+=v; addRT(w.trainer_id,v); return; }
      const cat=w.clients?.category||w.category_at_moment;
      const child=isChild(w.clients?.age);
      const qty=qtyFor(w.client_id, String(w.workout_date).slice(0,10));
      const m=_pkgMatch(child, qty, cat);
      accrualReg += (m.price && m.qty) ? m.price/m.qty : (PT_PRICES[cat]||0);
    });
    (data.trialSessions||[]).forEach(t=>{ const v=PT_PRICES[t.category]||0; rev.drop+=v; addRT(t.trainer_id,v); });

    // СПОСОБ А (основной, по продаже): абонементы, проданные за месяц, по цене купленного
    // пакета (нестандартный баланс приводится к пакету через _pkgMatch: дети — вверх,
    // взрослые — вниз). Баланс ≤ 0 — пустой абонемент, пропускаем.
    let subsCounted = 0;
    (subsRev||[]).forEach(s=>{
      const cat = s.clients?.category, child = isChild(s.clients?.age);
      const m = _pkgMatch(child, s.initial_balance, cat);
      if (!m.price) return;
      if (child) rev.childSub += m.price; else rev.adultSub += m.price;
      addRT(s.trainer_id, m.price); subsCounted++;
    });
    // Взрослые группы в выручку НЕ входят (услуга во взрослом абонементе; ФОТ — по посещениям).
    // Детские группы: каждый оплаченный клиент-месяц = GROUP_CHILD_PRICE.
    rev.childGroup = childRev.filter(r=>r.paid).length * GROUP_CHILD_PRICE;

    const totalRev   = rev.adultSub+rev.childSub+rev.drop+rev.childGroup;   // А: по продаже
    const accrualRev = Math.round(accrualReg)+rev.drop+rev.childGroup;      // Б: по начислению
    const topTrainers = Object.entries(revByTrainer)
      .map(([id,v])=>({fio:fioMap[id]||'—', sum:v}))
      .sort((a,b)=>b.sum-a.sum).slice(0,3);
    return {
      rev, totalRev, accrualRev,
      avgCheck:     subsCounted ? Math.round((rev.adultSub+rev.childSub)/subsCounted) : 0,
      ratio:        totalRev   ? Math.round(pr.totalFot/totalRev*100)   : 0,
      accrualRatio: accrualRev ? Math.round(pr.totalFot/accrualRev*100) : 0,
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
    const ws = await _anWs(year, month, branch);
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
      _anWs(year, month, branch),
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
// Норма ФОТ/Выручка = 37–42%. Вне нормы — отклонение (жёлтый), далеко — аномалия (красный).
function _ratioClass(r) {
  if (r>=37 && r<=42) return 'r-green';
  if (r>=30 && r<=50) return 'r-yellow';
  return 'r-red';
}
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
      <div class="aov-row"><span>Выручка</span><b>${fmt(d.accrualRev)}</b></div>
      <div class="aov-row"><span>Продажи</span><b>${fmt(d.totalRev)}</b></div>
      <div class="aov-row"><span>ФОТ</span><b>${fmt(d.fot)}</b></div>
      <div class="aov-row"><span>ФОТ/выручка</span><b class="${_ratioClass(d.accrualRatio)}">${d.accrualRatio}%</b></div>
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
      {l:'Абонементы взрослые', v:d.rev.adultSub},
      {l:'Абонементы детские',  v:d.rev.childSub},
      {l:'Разовые / пробные',   v:d.rev.drop},
      {l:'Группы детские',       v:d.rev.childGroup},
    ];
    const maxT=Math.max(1,...types.map(t=>t.v));
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-section"><div class="ah-h">Продажи за месяц по типам</div>
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

      <div class="ah-section"><div class="ah-h">ФОТ / Выручка (по начислению)</div>
        <div class="ah-ratio ${_ratioClass(d.accrualRatio)}">${d.accrualRatio}%</div>
        <p class="hint" style="text-align:center">Норма: 37–42%. Выручка (начисление): ${fmt(d.accrualRev)}</p>
      </div>

      <div class="ah-section"><div class="ah-h">Справка: по продаже (касса)</div>
        <div class="ah-bar-row"><span class="ah-bar-lbl">Продажи за месяц</span><div class="ah-bar-track"></div><span class="ah-bar-val">${fmt(d.totalRev)}</span></div>
        <div class="ah-bar-row"><span class="ah-bar-lbl">ФОТ / Продажи</span><div class="ah-bar-track"></div><span class="ah-bar-val">${d.ratio}%</span></div>
        <p class="hint">«По продаже» = полная цена абонементов, проданных в этом месяце (кэш). % низкий, т.к. пакеты оплачивают вперёд, а ФОТ — за проведённые занятия. Для KPI ФОТ/Выручка смотри «по начислению» выше.</p>
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
    // Кеш 90с: Сводка — стартовая вкладка, getSummary тяжёлый (~12 запросов).
    // Сбрасывается в doSaveAdj при сохранении корректировки ЗП.
    const [data, allClients] = await cached(`adm_summary_${branch||'all'}_${year}_${month}`, () =>
      Promise.all([
        DB.getSummary(year,month,branch||null),
        DB.getAllClients().catch(()=>[]),
      ]), 90000);
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
  try { await DB.upsertAdjustment(trainerId,year,month,bonus,penalty,notes); invalidateCachePrefix('adm_summary'); toast('Сохранено ✅','success'); }
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
const ROLE_LBL={trainer:'Тренер',senior_trainer:'Ст.тренер',admin:'Администратор',ceo:'Топ-менеджмент',manager:'Управляющий',reception:'Ресепшн'};
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
        <option value="manager">Управляющий</option>
        <option value="reception">Ресепшн</option>
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
        <option value="manager" ${role==='manager'?'selected':''}>Управляющий</option>
        <option value="reception" ${role==='reception'?'selected':''}>Ресепшн</option>
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
  const role = curRole();
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
// ── КОНТРОЛЬ: очередь действий (inbox координатора) ──
// Наблюдательные метрики вынесены в renderAdminMonitoring («Ещё»).
async function renderAdminControl(force=false) {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Контроль</h3>
      <button class="btn-icon" onclick="renderAdminControl(true)" title="Обновить">🔄</button></div>
    <div class="center-screen"><div class="spinner"></div></div></div>`;
  try {
    const now=new Date(); const y=now.getFullYear(),mo=now.getMonth()+1;
    const _p2=x=>String(x).padStart(2,'0');
    const branches = STATE.profile.branches||null;   // мультифилиал координатора
    const cacheKey=`adm_control_${y}_${mo}`;
    if (force) invalidateCache(cacheKey);
    const D = await cached(cacheKey, async () => {
      const monthFrom=`${y}-${_p2(mo)}-01`, monthTo=`${y}-${_p2(mo)}-${_p2(now.getDate())}`;
      const [lateRequests, workoutDelReqs, deleteReqs, recHanging, recRejected] = await Promise.all([
        DB.getPendingLateRequests(null).catch(()=>[]),
        DB.getAllWorkoutDeleteRequests().catch(()=>[]),
        DB.getAllDeleteRequests().catch(()=>[]),
        DB.getReceptionHanging(branches).catch(()=>[]),
        DB.getReceptionRejected(branches, monthFrom, monthTo).catch(()=>({workouts:[],trials:[]})),
      ]);
      return {lateRequests, workoutDelReqs, deleteReqs, recHanging, recRejected};
    }, 60000);
    const {lateRequests, workoutDelReqs, deleteReqs, recHanging, recRejected} = D;
    const sections=[];
    // 🛎 Висящие подтверждения ресепшн (эскалация >24ч)
    if (recHanging.length) {
      const escThreshold = Date.now() - RECEPTION_ESCALATE_HRS*3600000;
      const overdue = recHanging.filter(w=>new Date(w.workout_date).getTime() < escThreshold);
      const ageStr = (d)=>{ const h=Math.floor((Date.now()-new Date(d))/3600000); return h<24?`${h} ч`:`${Math.floor(h/24)} дн.`; };
      sections.push(`<div class="control-section">
        <div class="control-title ${overdue.length?'danger':'warn'}">🛎 Висящие подтверждения ресепшн (${recHanging.length}${overdue.length?` · ⏰ ${overdue.length} > ${RECEPTION_ESCALATE_HRS}ч`:''})</div>
        ${recHanging.slice(0,30).map(w=>{
          const esc=new Date(w.workout_date).getTime()<escThreshold;
          return `<div class="control-item" ${esc?'style="border-left:3px solid var(--danger)"':''}>
            <div class="ci-main">${w.profiles?.fio||'?'} <span class="hint">${w.branch||''}</span></div>
            <div class="ci-sub">${fmtDT(w.workout_date)} · висит ${ageStr(w.workout_date)}${esc?' ⏰':''}</div>
          </div>`;
        }).join('')}
      </div>`);
    }
    // 🔴 Отклонённые «вопросы по списанию» (сигнал расхождений)
    const recQuestions=[
      ...(recRejected.workouts||[]).filter(w=>w.reception_reason==='questions').map(w=>({fio:w.clients?.fio||'?',trainer:w.profiles?.fio||'?',ts:w.reception_at})),
      ...(recRejected.trials||[]).filter(t=>t.reception_reason==='questions').map(t=>({fio:`${t.first_name}${t.last_name?' '+t.last_name:''}`,trainer:t.profiles?.fio||'?',ts:t.reception_at})),
    ].sort((a,b)=>new Date(b.ts)-new Date(a.ts));
    if (recQuestions.length) sections.push(`<div class="control-section">
      <div class="control-title danger">🔴 Отклонено: вопросы по списанию (${recQuestions.length})</div>
      ${recQuestions.map(q=>`<div class="control-item">
        <div class="ci-main">${q.fio} <span class="hint">← ${q.trainer}</span></div>
        <div class="ci-sub">отклонено ${fmtDT(q.ts)}</div>
      </div>`).join('')}
    </div>`);
    // ⏰ Запросы на поздние тренировки
    if (lateRequests.length) sections.push(`<div class="control-section">
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
    // 🗑 Запросы на удаление ПТ
    if (workoutDelReqs.length) sections.push(`<div class="control-section">
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
    // 🗑 Запросы на удаление клиента
    if (deleteReqs.length) sections.push(`<div class="control-section">
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

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header"><h3>Контроль</h3>
        <button class="btn-icon" onclick="renderAdminControl(true)" title="Обновить">🔄</button></div>
      <p class="hint" style="margin-bottom:16px">На ${todayStr()} · очередь действий</p>
      ${sections.length?sections.join(''):'<div class="empty-state">✅<p>Очередь пуста</p></div>'}
    </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── МОНИТОРИНГ: наблюдательные метрики координатора (открывается из «Ещё») ──
async function renderAdminMonitoring(force=false) {
  setupBack(()=>{renderAdminApp('more');setupBack(null);});
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>📋 Мониторинг</h3>
      <button class="btn-icon" onclick="renderAdminMonitoring(true)" title="Обновить" style="margin-left:auto">🔄</button></div>
    <div class="center-screen"><div class="spinner"></div></div></div>`;
  try {
    const now=new Date(); const y=now.getFullYear(),mo=now.getMonth()+1;
    const branches = STATE.profile.branches||null;   // мультифилиал координатора
    const cacheKey=`adm_monitor_${y}_${mo}`;
    if (force) invalidateCache(cacheKey);
    const D = await cached(cacheKey, async () => {
      const from=new Date(y,mo-1,1).toISOString(),to=new Date(y,mo,1).toISOString();
      const [data, activeRes, activityStats, allTrials, sessions, recStats] = await Promise.all([
        DB.getControlData(),
        sb().from('workouts').select('trainer_id').gte('workout_date',from).lt('workout_date',to),
        DB.getTrainersActivityStats(y, mo).catch(()=>[]),
        DB.getAllTrialSessions(y, mo, null).catch(()=>[]),
        DB.getRecentSessions(30).catch(()=>[]),
        DB.getReceptionStats(branches, y, mo).catch(()=>[]),
      ]);
      return {data, activeRes, activityStats, allTrials, sessions, recStats};
    }, 60000);
    const {data, activeRes, activityStats, allTrials, sessions, recStats} = D;
    const activeSet=new Set((activeRes?.data||[]).map(x=>x.trainer_id));
    const inactive=data.inactiveTrainers.filter(t=>!activeSet.has(t.id));
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
      sections.push(`<div class="control-section">
        <div class="control-title" style="background:rgba(139,92,246,.15);color:#7c3aed">🆕 Пробные за месяц (${allTrials.length})</div>
        ${allTrials.map(t=>`<div class="control-item">
          <div class="ci-main">${t.first_name}${t.last_name?' '+t.last_name:''} · Кат.${t.category}${t.phone?' · '+t.phone:''}</div>
          <div class="ci-sub">${t.profiles?.fio||'?'} · ${fmtDate(t.session_date)}</div>
        </div>`).join('')}
      </div>`);
    }
    // 📋 Активность тренеров
    if (activityStats.length) {
      const allSorted = [...activityStats].sort((a,b)=>b.overdueNotes-a.overdueNotes||b.monthWorkouts-a.monthWorkouts);
      const daysSince = (dateStr) => {
        if (!dateStr) return '∞';
        const d = Math.floor((Date.now()-new Date(dateStr))/(86400000));
        return d===0?'сегодня':d===1?'вчера':`${d} дн. назад`;
      };
      sections.push(`<div class="control-section">
        <div class="control-title" style="background:rgba(99,102,241,.15);color:#6366f1">📋 Активность тренеров (${new Date(y,mo-1).toLocaleString('ru-RU',{month:'long'})})</div>
        ${allSorted.map(t=>{
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
    // 🛎 % подтверждено/отклонено по тренерам (ресепшн)
    if (recStats.length) {
      const byTr={};
      recStats.forEach(r=>{
        const fio=r.profiles?.fio||'?';
        (byTr[fio] ||= {confirmed:0,rejected:0,pending:0});
        if (r.reception_status==='rejected') byTr[fio].rejected++;
        else if (r.reception_status==='pending') byTr[fio].pending++;
        else byTr[fio].confirmed++;
      });
      const rows=Object.entries(byTr).map(([fio,s])=>{
        const total=s.confirmed+s.rejected;
        const pct=total?Math.round(s.confirmed/total*100):100;
        return {fio,...s,total,pct};
      }).sort((a,b)=>a.pct-b.pct);
      sections.push(`<div class="control-section">
        <div class="control-title" style="background:rgba(16,185,129,.12);color:#10b981">🛎 Подтверждения по тренерам (${new Date(y,mo-1).toLocaleString('ru-RU',{month:'long'})})</div>
        ${rows.map(r=>`<div class="control-item" ${r.rejected>0?'style="border-left:3px solid var(--warn)"':''}>
          <div class="ci-main" style="display:flex;justify-content:space-between">
            <span>${r.fio}</span>
            <span style="font-size:12px">✓ ${r.pct}%</span>
          </div>
          <div class="ci-sub">подтверждено ${r.confirmed} · отклонено ${r.rejected}${r.pending?` · ⏳ ${r.pending}`:''}</div>
        </div>`).join('')}
      </div>`);
    }
    // 🟢 Входы за последние 30 дней
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
      <div class="ah-head">${backBtn()}<h3>📋 Мониторинг</h3>
        <button class="btn-icon" onclick="renderAdminMonitoring(true)" title="Обновить" style="margin-left:auto">🔄</button></div>
      <p class="hint" style="margin-bottom:16px">На ${todayStr()}</p>
      ${sections.length?sections.join(''):'<div class="empty-state">✅<p>Всё спокойно</p></div>'}
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

