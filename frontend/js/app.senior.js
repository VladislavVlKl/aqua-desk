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
    const [allReqs, allCatReqs] = await Promise.all([
      Promise.all(branches.map(b=>DB.getPendingLateRequests(b))),
      Promise.all(branches.map(b=>DB.getPendingCategoryRecalcRequests(b))),
    ]);
    const reqs = allReqs.flat().filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i); // дедупликация
    const catReqs = allCatReqs.flat().filter((r,i,a)=>a.findIndex(x=>x.id===r.id)===i);
    const body = document.getElementById('late-body');
    if (!reqs.length && !catReqs.length) {
      body.innerHTML='<div class="empty-state">✅<p>Нет запросов на одобрение</p></div>'; return;
    }
    const catHtml = catReqs.length ? `<h4 style="margin:4px 0 8px">🔄 Пересчёт категории (${catReqs.length})</h4>`
      + catReqs.map(r=>catRecalcCardHtml(r,'senior')).join('') : '';
    const lateHtml = reqs.length ? (catReqs.length?'<h4 style="margin:16px 0 8px">⏰ Поздние тренировки</h4>':'')
      + reqs.map(r=>`<div class="staff-card" style="flex-direction:column;gap:8px">
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
    </div>`).join('') : '';
    body.innerHTML = catHtml + lateHtml;
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
