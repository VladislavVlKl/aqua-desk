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
          const adjMap = aggAdjustments(data.adjustments);
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
  const adjMap=aggAdjustments(adjustments);
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
    const {data:prof}=await sb().from('profiles').select('branches').eq('id',trainerId).single();
    const trainerBranches=prof?.branches||[];
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
      ${renderAdjForm(trainerId, year, month, d.adjustments||[], trainerBranches)}

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
// Форма премии/штрафа — теперь ПО ФИЛИАЛАМ (строка month_adjustments на филиал).
// window._adjRows: branch → строка корректировки текущего тренера/месяца.
function renderAdjForm(trainerId, year, month, adjRows, branches) {
  window._adjRows = {};
  (adjRows||[]).forEach(a=>{ window._adjRows[a.branch||''] = a; });
  const opts = [...(branches||[])];
  // «Общая» опция — только если есть легаси-строка без филиала (или у тренера нет филиалов)
  const showLegacy = !!window._adjRows[''] || !opts.length;
  const cur = opts[0] ?? '';
  const curAdj = window._adjRows[cur]||{};
  const multi = opts.length>1 || showLegacy;
  return `<div class="adj-form">
    <h4>Премия / Штраф${multi?' <span style="font-weight:normal;font-size:12px;color:var(--hint)">по филиалу</span>':''}</h4>
    ${multi?`<div class="form-group" style="margin-bottom:8px"><select id="adj-branch" onchange="onAdjBranchChange()">
      ${opts.map(b=>`<option value="${b}">${b}</option>`).join('')}
      ${showLegacy?'<option value="">Общая (без филиала)</option>':''}
    </select></div>`:`<input type="hidden" id="adj-branch" value="${cur}">`}
    <div style="display:flex;gap:10px;margin-bottom:8px">
      <div class="form-group" style="flex:1;margin:0"><label>Премия</label>
        <input type="number" id="adj-bonus" value="${curAdj.bonus||0}" min="0"></div>
      <div class="form-group" style="flex:1;margin:0"><label>Штраф</label>
        <input type="number" id="adj-penalty" value="${curAdj.penalty||0}" min="0"></div>
    </div>
    <input id="adj-notes" type="text" placeholder="Комментарий" value="${curAdj.notes||''}">
    <button class="btn btn-sm btn-primary" style="margin-top:8px;width:100%"
      onclick="doSaveAdj(${trainerId},${year},${month})">Сохранить</button>
  </div>`;
}
function onAdjBranchChange() {
  const b = document.getElementById('adj-branch')?.value ?? '';
  const a = (window._adjRows||{})[b]||{};
  const set=(id,v)=>{ const e=document.getElementById(id); if(e) e.value=v; };
  set('adj-bonus', a.bonus||0); set('adj-penalty', a.penalty||0); set('adj-notes', a.notes||'');
}
async function doSaveAdj(trainerId,year,month) {
  const branch=document.getElementById('adj-branch')?.value ?? '';
  const bonus=parseInt(document.getElementById('adj-bonus')?.value||0);
  const penalty=parseInt(document.getElementById('adj-penalty')?.value||0);
  const notes=document.getElementById('adj-notes')?.value.trim()||'';
  try {
    const saved=await DB.upsertAdjustment(trainerId,year,month,bonus,penalty,notes,branch);
    if (window._adjRows) window._adjRows[branch]=saved;
    invalidateCachePrefix('adm_summary'); toast('Сохранено ✅','success');
  }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}
