// ── ТАБ: ОТЧЁТ ТРЕНЕРА ───────────────────────
async function renderReportTab() {
  const now=new Date(); let year=now.getFullYear(), month=now.getMonth()+1;
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div id="seq-survey-banner"></div>
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
  renderSeqSurveyBanner();   // баннер опросника «Сверка списаний» (если включён для филиала)
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
      DB.getMyGroupSubstitutions(STATE.profile.id, year, month),
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
    window._reportTrials = trialSessions; // для модалки правки пробной
    // ⚠️ unpaidGroups (дети ходят, но не платят), pending (замены), transfers (передачи)
    // и lateRequests загружены выше в общем Promise.all

    // Явные дубли: ≥2 обычных ПТ одного клиента, созданные почти одновременно (двойной тап).
    // Их тренеру разрешаем удалять напрямую даже после 30-мин окна — это очевидное двойное
    // списание, а не правка истории. Удаление вернёт балансу +1 (DB.deleteWorkout).
    const _dupWorkoutIds = new Set();
    for (let i=0;i<workouts.length;i++) {
      const a=workouts[i];
      if (a.is_debt||a.is_drop_in) continue;
      for (let j=0;j<workouts.length;j++) {
        if (i===j) continue;
        const b=workouts[j];
        if (b.is_debt||b.is_drop_in) continue;
        if (a.client_id===b.client_id
            && Math.abs(new Date(a.created_at)-new Date(b.created_at))<=DUP_WORKOUT_WINDOW_MS) {
          _dupWorkoutIds.add(a.id); break;
        }
      }
    }

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
        <div class="summary-card"><div class="s-val">${sal.cat[1]+sal.cat[2]+sal.cat[3]+tConfirmed.length+(sal.cat.dropIn1||0)+(sal.cat.dropIn2||0)+(sal.cat.dropIn3||0)}</div><div class="s-lbl">ПТ</div></div>
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
        ${sal.cat[1]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>ПТ 1кт × ${sal.cat[1]} шт</span><span style="font-weight:600">${fmt(sal.cat[1]*RATES.pt[1])} сум</span></div>`:''}
        ${sal.cat[2]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>ПТ 2кт × ${sal.cat[2]} шт</span><span style="font-weight:600">${fmt(sal.cat[2]*RATES.pt[2])} сум</span></div>`:''}
        ${sal.cat[3]?`<div style="display:flex;justify-content:space-between;padding:4px 0;border-bottom:1px solid var(--border);font-size:13px"><span>ПТ 3кт × ${sal.cat[3]} шт</span><span style="font-weight:600">${fmt(sal.cat[3]*RATES.pt[3])} сум</span></div>`:''}
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
              (_dupWorkoutIds.has(w.id)?`
              <button class="btn btn-sm btn-danger" onclick="doDeleteDuplicate('${w.id}')" title="Дубль — создан почти одновременно с другой записью этого клиента">🗑 Удалить дубль</button>`:
              `<button class="btn btn-sm" style="background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.25)"
                onclick="doRequestWorkoutDelete('${w.id}','${w.workout_date}','${encodeURIComponent(w.clients?.fio||'')}','${w.branch||''}')">Запрос на удаление</button>`)
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
          <div style="display:flex;gap:6px;margin-top:6px;flex-wrap:wrap">
            ${STATE.profile.role==='admin'
              ? `<button class="btn btn-sm btn-danger" onclick="doDeleteTrial(${t.id})">Удалить</button>`
              : (canEdit(t.created_at)
                  ? `<button class="btn btn-sm btn-danger" onclick="doDeleteTrial(${t.id})">Удалить</button>`
                  : `<button class="btn btn-sm" style="background:rgba(239,68,68,.1);color:#ef4444;border:1px solid rgba(239,68,68,.25)"
                       onclick="doRequestTrialDelete(${t.id},'${encodeURIComponent(t.first_name+(t.last_name?' '+t.last_name:''))}','${t.session_date}','${t.branch||''}')">Запрос на удаление</button>`)}
            ${isToday(t.session_date)?`<button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
              onclick="renderEditTrialModal(${t.id})">✏️</button>`:''}
          </div>
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
async function doDeleteDuplicate(id) {
  if(!confirm('Удалить дублирующую запись?\n\nЭта ПТ создана почти одновременно с другой записью того же клиента — похоже на двойное списание. Баланс клиента вернётся +1.'))return;
  try{
    await DB.deleteWorkout(id);
    DB.auditLog('workout_delete_dup', STATE.profile.id, STATE.profile.fio, id, 'workout', {reason:'duplicate'}, STATE.profile.branches?.[0]);
    toast('Дубль удалён','success');renderReportTab();
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

// ─── ПРОБНЫЕ: удаление / запрос на удаление / правка (паритет с ПТ) ──
async function doDeleteTrial(trialId) {
  if (!confirm('Удалить пробную тренировку?')) return;
  try {
    await DB.deleteTrialSession(trialId);
    DB.auditLog('trial_delete', STATE.profile.id, STATE.profile.fio, String(trialId), 'trial', {}, STATE.profile.branches?.[0]);
    toast('Удалено','success'); renderReportTab();
  } catch(e){ console.error(e); toast('Ошибка','error'); }
}
async function doRequestTrialDelete(trialId, nameEnc, sessionDate, branch) {
  const name = decodeURIComponent(nameEnc);
  if (!confirm(`Запросить удаление пробной?\n${name} · ${fmtDate(sessionDate)}\n\nЗапрос уйдёт координатору на подтверждение.`)) return;
  if (_pending.has('tdr_'+trialId)) return;
  _pending.add('tdr_'+trialId);
  try {
    await DB.requestTrialDelete(trialId, STATE.profile.id, name, sessionDate, branch);
    DB.auditLog('trial_delete_request', STATE.profile.id, STATE.profile.fio, String(trialId), 'trial',
      { name, date: sessionDate?.slice(0,10) }, branch);
    toast('Запрос отправлен координатору','success');
  } catch(e) {
    if (e.message==='already_pending') toast('Запрос уже отправлен ранее','info');
    else { console.error(e); toast('Ошибка','error'); }
  }
  finally { _pending.delete('tdr_'+trialId); }
}
function renderEditTrialModal(trialId) {
  const t = (window._reportTrials||[]).find(x=>String(x.id)===String(trialId));
  if (!t) return toast('Пробная не найдена','error');
  const dateLocal = new Date(t.session_date).toISOString().slice(0,16);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>✏️ Редактировать пробную</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Имя</label><input id="et-fname" value="${t.first_name||''}"></div>
      <div style="flex:1"><label>Фамилия</label><input id="et-lname" value="${t.last_name||''}"></div>
    </div>
    <div class="form-group"><label>Категория</label>
      <select id="et-cat">
        ${[1,2,3].map(n=>`<option value="${n}" ${n==t.category?'selected':''}>Кат.${n} — ${fmt(RATES.pt[n])} сум</option>`).join('')}
      </select></div>
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Возраст</label><input id="et-age" type="number" min="1" max="99" value="${t.age||''}"></div>
      <div style="flex:1"><label>Телефон</label><input id="et-phone" value="${t.phone||''}"></div>
    </div>
    <div class="form-group"><label>Дата и время</label>
      <input type="datetime-local" id="et-date" value="${dateLocal}"></div>
    <p class="hint" style="margin-bottom:12px">Редактировать можно только пробные текущего дня</p>
    <button class="btn btn-primary btn-full" onclick="doEditTrial(${trialId})">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditTrial(trialId) {
  const fname = document.getElementById('et-fname')?.value.trim();
  const lname = document.getElementById('et-lname')?.value.trim()||null;
  const cat   = parseInt(document.getElementById('et-cat')?.value||1);
  const age   = parseInt(document.getElementById('et-age')?.value)||null;
  const phone = document.getElementById('et-phone')?.value.trim()||null;
  const date  = document.getElementById('et-date')?.value;
  if (!fname) return toast('Укажите имя','error');
  if (!date || !isToday(date)) return toast('Можно редактировать только пробные сегодняшнего дня','error');
  if (_pending.has('editTrial_'+trialId)) return;
  _pending.add('editTrial_'+trialId);
  try {
    await DB.updateTrialSession(trialId, {
      first_name:fname, last_name:lname, category:cat, age, phone,
      session_date:new Date(date).toISOString(),
    });
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Пробная обновлена','success');
    renderReportTab();
  } catch(e){ console.error(e); toast('Ошибка','error'); }
  finally { _pending.delete('editTrial_'+trialId); }
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
    await DB.updateWorkout(workoutId, updates);
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
    refreshTrainerScreen();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doResolveTransfer(transferId, clientId, toTrainerId, confirmed) {
  try {
    await DB.resolveTransfer(transferId, clientId, toTrainerId, confirmed);
    toast(confirmed ? '✅ Клиент принят' : 'Передача отклонена', confirmed?'success':'info');
    refreshTrainerScreen();
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
        ${packages.map((p,i)=>`<button class="btn pkg-btn ${i===1?'btn-primary':''}" data-qty="${p.qty}" data-weekend="${p.weekend?'1':''}"
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
    <div id="pkg-end-preview" class="hint" data-child="${isChildClient?'1':''}" style="margin-bottom:12px"></div>
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
  const sel = document.querySelector('.pkg-btn.btn-primary');
  const weekend = !customOn && sel?.dataset.weekend==='1';
  const qty = customOn
    ? parseInt(document.getElementById('pkg-custom-qty')?.value||'0')
    : parseInt(sel?.dataset.qty||'0');
  const start = document.getElementById('pkg-start')?.value || todayStr();
  const preview = document.getElementById('pkg-end-preview');
  if (!preview) return;
  if (!qty) { preview.textContent=''; return; }
  if (preview.dataset.child !== '1') { preview.textContent = '♾️ Бессрочно — ПТ не сгорают'; return; }
  preview.textContent = `📅 Действует до: ${calcSubEnd(start, qty, weekend)}`
    + (weekend ? ' · только сб/вс' : '');
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
  const selBtn = document.querySelector('.pkg-btn.btn-primary');
  const isWeekend = !customOn && selBtn?.dataset.weekend==='1';
  const qty = customOn
    ? parseInt(document.getElementById('pkg-custom-qty')?.value||'0')
    : parseInt(selBtn?.dataset.qty||'10');
  if (!qty) return toast('Выберите пакет или введите количество','error');
  const start = document.getElementById('pkg-start')?.value||todayStr();
  try {
    await DB.buyNewPackage(clientId, STATE.profile.id, isChildClient, qty, start, isWeekend);
    DB.auditLog('sub_buy', STATE.profile.id, STATE.profile.fio, clientId, 'subscription',
      { qty, start, is_child: isChildClient, weekend: isWeekend }, STATE.profile.branches?.[0]);
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
    <div class="form-group"><label>Баланс ПТ</label>
      <div style="display:flex;align-items:center;gap:12px">
        <div style="font-weight:700;font-size:18px">${balance||0} ПТ</div>
        <button type="button" class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
          onclick="this.closest('.modal-overlay').remove();renderBalanceCorrectionModal('${clientId}',${balance||0},'${fioEnc}')">⚙ Коррекция</button>
      </div>
      <p class="hint" style="margin-top:6px">Пополнение — только через «Купить пакет». «Коррекция» — для исправления ошибки, с записью в аудит.</p></div>
    <div class="form-group"><label>Начало абонемента</label>
      <input id="ec-sub-start" type="date" value="${subStart||''}"></div>
    <div class="form-group"><label>Конец абонемента</label>
      <input id="ec-sub-end" type="date" value="${subEnd||''}"></div>
    <button class="btn btn-primary btn-full" onclick="doEditClient('${clientId}',${balance||0},${cat})">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditClient(clientId, oldBalance, oldCat) {
  const fio       = document.getElementById('ec-fio')?.value.trim();
  const category  = parseInt(document.getElementById('ec-cat')?.value)||1;
  const age       = parseInt(document.getElementById('ec-age')?.value)||null;
  const subStart  = document.getElementById('ec-sub-start')?.value||null;
  const subEnd    = document.getElementById('ec-sub-end')?.value||null;
  if (!fio) return toast('Введите ФИО','error');
  try {
    // Баланс здесь НЕ меняем — только через «Купить пакет» или «Коррекцию остатка» (аудит).
    const fields = {fio, category, age, subscription_start:subStart, subscription_end:subEnd};
    await DB.updateClient(clientId, fields);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Данные сохранены','success');
    // Категория изменилась → предложить пересчитать прошлые ПТ (ошибочная категория)
    if (oldCat != null && category !== Number(oldCat)) {
      renderRecalcCategoryModal(clientId, category, fio);
    } else {
      renderClientProfile(clientId, STATE.currentTab||'clients');
    }
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Коррекция остатка — явное исправление ошибки (не пополнение!). Пишется в аудит.
// Пополнение оформляется через «Купить пакет» (создаёт абонемент). Требует причину.
function renderBalanceCorrectionModal(clientId, curBalance, fioEnc) {
  const fio = decodeURIComponent(fioEnc||'');
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Коррекция остатка</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:14px">${fio} · текущий остаток <b>${curBalance} ПТ</b>.<br>Только для исправления ошибки. Обычное пополнение — через «Купить пакет».</p>
    <div class="form-group"><label>Новый остаток, ПТ</label>
      <input id="bc-value" type="number" min="0" value="${curBalance}"></div>
    <div class="form-group"><label>Причина (обязательно)</label>
      <input id="bc-reason" type="text" placeholder="Напр.: задвоение при внесении"></div>
    <button class="btn btn-primary btn-full" onclick="doBalanceCorrection('${clientId}',${curBalance})">Применить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doBalanceCorrection(clientId, curBalance) {
  if (_pending.has('balcorr_'+clientId)) return;
  const nb = parseInt(document.getElementById('bc-value')?.value);
  const reason = document.getElementById('bc-reason')?.value.trim()||'';
  if (isNaN(nb) || nb < 0) return toast('Введите остаток (0 или больше)','error');
  if (!reason) return toast('Укажите причину коррекции','error');
  if (nb === curBalance) return toast('Остаток не изменился','info');
  _pending.add('balcorr_'+clientId);
  try {
    await DB.correctBalance(clientId, nb, reason, STATE.profile);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Остаток скорректирован','success');
    renderClientProfile(clientId, STATE.currentTab||'clients');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('balcorr_'+clientId); }
}

// Спросить, пересчитывать ли категорию у уже проведённых тренировок клиента.
// Тренер отправляет запрос → одобряет координатор/старший. Сам тренер не применяет.
function renderRecalcCategoryModal(clientId, newCat, fio) {
  const isApprover = ['admin','senior_trainer'].includes(STATE.profile.role);
  const fioEnc = encodeURIComponent(fio||'');
  const cancelJs = `this.closest('.modal-overlay').remove();renderClientProfile('${clientId}',STATE.currentTab||'clients')`;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Пересчитать прошлые ПТ?</h3>
      <button class="btn-close" onclick="${cancelJs}">✕</button></div>
    <p class="hint" style="margin-bottom:14px">Категория изменена на <b>Кат.${newCat}</b>. Уже проведённые тренировки остались по старой категории и считаются в ЗП по ней. ${isApprover?'Пересчитать их под новую ставку?':'Отправить запрос координатору/старшему тренеру на пересчёт?'}</p>
    <div class="warn-banner" style="margin-bottom:14px;font-size:13px">⚠️ «Все тренировки» затронут и прошлые месяцы — ЗП за уже закрытые периоды изменится. Если категория была неверна только что — выбирайте «Текущий месяц».</div>
    <button class="btn btn-primary btn-full" style="margin-bottom:8px"
      onclick="doRecalcCategory('${clientId}',${newCat},'month','${fioEnc}')">📅 ${isApprover?'Пересчитать текущий месяц':'Запросить: текущий месяц'}</button>
    <button class="btn btn-full btn-danger" style="margin-bottom:8px"
      onclick="doRecalcCategory('${clientId}',${newCat},'all','${fioEnc}')">🗂 ${isApprover?'Пересчитать все ПТ':'Запросить: все ПТ'}</button>
    <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
      onclick="${cancelJs}">Не пересчитывать</button>
  </div>`;
  document.body.appendChild(m);
}
async function doRecalcCategory(clientId, newCat, scope, fioEnc) {
  if (_pending.has('recalcCat_'+clientId)) return;
  _pending.add('recalcCat_'+clientId);
  const isApprover = ['admin','senior_trainer'].includes(STATE.profile.role);
  const fio = decodeURIComponent(fioEnc||'');
  try {
    let fromDate = null;
    if (scope === 'month') {
      const now = new Date();
      fromDate = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-01`;
    }
    if (isApprover) {
      // Координатор/старший применяет сразу
      const n = await DB.recalcWorkoutsCategory(clientId, newCat, fromDate);
      DB.auditLog('workout_category_recalc', STATE.profile.id, STATE.profile.fio, clientId, 'client',
        {new_cat:newCat, scope, count:n}, STATE.profile.branches?.[0]);
      document.querySelector('.modal-overlay')?.remove();
      toast(`✅ Пересчитано тренировок: ${n}`,'success');
    } else {
      // Тренер — отправляет запрос на одобрение
      await DB.addCategoryRecalcRequest(STATE.profile.id, clientId, fio,
        STATE.profile.branches?.[0]||'', newCat, scope, fromDate);
      document.querySelector('.modal-overlay')?.remove();
      toast('Запрос на пересчёт отправлен ✅','success');
    }
    renderClientProfile(clientId, STATE.currentTab||'clients');
  } catch(e) {
    if (e.message==='already_pending') toast('Запрос на пересчёт уже отправлен','info');
    else { console.error(e); toast('Ошибка','error'); }
  }
  finally { _pending.delete('recalcCat_'+clientId); }
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



// ============================================================
// SECTION: TRAINER:SEQ_SURVEY — опросник «Сверка порядковых списаний»
// Тренер сверяет расчётный номер списания (N из M) с листами/1С.
// Только сбор (clients.balance не трогаем). Данные → pt_sequence_survey.
// ============================================================

// Человекочитаемый дедлайн: '2026-09-08' → '8 сентября'
function _seqDeadlineLabel() {
  try {
    const M = ['января','февраля','марта','апреля','мая','июня','июля','августа','сентября','октября','ноября','декабря'];
    const [y,m,d] = SEQ_SURVEY.deadline.split('-').map(Number);
    return `${d} ${M[m-1]}`;
  } catch(e) { return SEQ_SURVEY.deadline; }
}

// Баннер на главной тренера. Три состояния: не начато / в процессе / пройдено.
async function renderSeqSurveyBanner() {
  const box = document.getElementById('seq-survey-banner');
  if (!box) return;
  if (!seqSurveyEnabled(STATE.profile)) { box.innerHTML=''; return; }
  let prog;
  try { prog = await DB.getSeqSurveyProgress(STATE.profile.id, SEQ_SURVEY.round); }
  catch(e) { console.error('[seq] progress', e); box.innerHTML=''; return; }
  if (!prog.total) { box.innerHTML=''; return; }   // нечего сверять

  const { answered, total } = prog;
  const dl = _seqDeadlineLabel();
  if (answered >= total) {
    box.innerHTML = `<div class="seq-done-chip" onclick="openSeqSurvey()">
      <span>✓ Сверка списаний пройдена — ${total} клиентов</span><span class="seq-open">открыть →</span></div>`;
    return;
  }
  if (answered === 0) {
    box.innerHTML = `<div class="seq-hero" onclick="openSeqSurvey()">
      <span class="seq-pin">★ Важно · до ${dl}</span>
      <h3>Сверьте порядок списаний</h3>
      <p>Проверьте, что номер занятия у клиентов совпадает с листами и 1С. ~5 минут.</p>
      <button class="seq-cta" onclick="event.stopPropagation();openSeqSurvey()">Пройти сверку →</button>
      <div class="seq-hero-meta"><span class="seq-chip">0 из ${total} готово</span><span class="seq-chip">≈ 5 мин</span></div>
    </div>`;
    return;
  }
  const pct = Math.round(answered/total*100);
  box.innerHTML = `<div class="seq-hero" onclick="openSeqSurvey()">
    <span class="seq-pin">Продолжите сверку · срок ${dl}</span>
    <h3>Сверено ${answered} из ${total}</h3>
    <div class="seq-hbar"><i style="width:${pct}%"></i></div>
    <button class="seq-cta" onclick="event.stopPropagation();openSeqSurvey()">Продолжить →</button>
  </div>`;
}

// Экран опросника
async function openSeqSurvey() {
  const branch = STATE.profile?.branches?.[0];
  loading('Загружаю базу...');
  let data;
  try { data = await DB.getSeqSurveyList(STATE.profile.id, SEQ_SURVEY.round); }
  catch(e) { console.error('[seq] list', e); toast('Не удалось загрузить','error'); renderTrainerApp(); switchTab('home'); return; }
  window._seq = { round: SEQ_SURVEY.round, trainerId: STATE.profile.id, branch, data };
  navPush(()=>{ renderTrainerApp(); switchTab('home'); });
  setScreen(`
    <div class="seq-screen">
      <div class="seq-head">
        ${backBtn('←')}
        <div>
          <h2>Сверка списаний</h2>
          <div class="seq-sub">Совпадает ли номер занятия с листами и 1С? · срок ${_seqDeadlineLabel()}</div>
        </div>
      </div>
      <div class="seq-progress">
        <div class="seq-pbar"><span id="seq-pfill"></span></div>
        <div class="seq-pcap"><span>Сверено</span><span><b id="seq-pdone">0</b> из <b id="seq-ptot">0</b></span></div>
      </div>
      <div id="seq-body" class="seq-list"></div>
    </div>`);
  setupBack(goBack);
  _seqRenderBody();
}

function _seqCardHtml(it) {
  const initials = (it.fio||'?').split(' ').map(s=>s[0]).join('').slice(0,2);
  const cat = it.category ? `Категория ${it.category} · ` : '';
  const pkg = it.total != null ? `пакет ${it.total} ПТ` : 'без пакета';
  const reopen = it._reopen;
  // Состояние «отвечено»
  if (it.answer && !reopen) {
    const a = it.answer;
    if (a.is_manual) {
      return `<div class="seq-card done-manual" data-cid="${it.client_id}">
        <div class="seq-top"><div class="seq-cav" style="background:#0ea5e9">${initials}</div>
          <div class="seq-nm">${it.fio}<small>добавлен вручную · ${cat}${pkg}</small></div>
          <div class="seq-seq"><div class="big">${a.final_next} из ${a.final_total ?? '?'}</div><div class="lbl2">учтено</div></div></div>
        <button class="seq-edit" onclick="seqEdit('${it.client_id}')">Изменить</button></div>`;
    }
    const yes = a.matches === true;
    return `<div class="seq-card ${yes?'done-yes':'done-no'}" data-cid="${it.client_id}">
      <div class="seq-top"><div class="seq-cav" style="background:${yes?'var(--success)':'var(--danger)'}">${initials}</div>
        <div class="seq-nm">${it.fio}<small>${cat}${pkg}</small></div>
        <div class="seq-seq"><div class="big" style="color:${yes?'var(--success)':'var(--danger)'}">${yes?'✓':'✗'} ${a.final_next} из ${a.final_total ?? it.total}</div>
          <div class="lbl2">${yes?'совпадает':'исправлено'}</div></div></div>
      ${a.comment?`<div class="seq-cmt">💬 ${a.comment}</div>`:''}
      <button class="seq-edit" onclick="seqEdit('${it.client_id}')">Изменить</button></div>`;
  }
  // Состояние «вопрос»
  const barPct = it.total ? Math.round(it.used/it.total*100) : 0;
  return `<div class="seq-card" data-cid="${it.client_id}">
    <div class="seq-top"><div class="seq-cav" style="background:var(--accent)">${initials}</div>
      <div class="seq-nm">${it.fio}<small>${cat}${pkg}</small></div>
      <div class="seq-seq"><div class="big">след. <b>${it.next}</b> из ${it.total}</div><div class="lbl2">сделано ${it.used}</div></div></div>
    <div class="seq-bar"><span>${it.used}</span><div class="track"><i style="width:${barPct}%"></i></div><span>осталось ${it.total-it.used}</span></div>
    <div class="seq-ask">Следующее списание — <b>${it.next}-е</b>. Совпадает с листами и 1С?</div>
    <div class="seq-yn">
      <button onclick="seqYes('${it.client_id}')">✓ Да, совпадает</button>
      <button class="no" onclick="seqNo('${it.client_id}')">✕ Нет, другое</button>
    </div>
    <div class="seq-fix" id="fix-${it.client_id}">
      <label>Правильный номер следующего занятия:</label>
      <div class="in"><input type="number" id="fixn-${it.client_id}" value="${it.next}" min="1" max="${it.total}"><span class="of">из ${it.total}</span></div>
      <textarea id="fixc-${it.client_id}" rows="2" placeholder="Комментарий: напр. в 1С уже другое число"></textarea>
      <button class="seq-save" onclick="seqSaveNo('${it.client_id}')">Сохранить</button>
    </div>
  </div>`;
}

function _seqRenderBody() {
  const s = window._seq; if (!s) return;
  const body = document.getElementById('seq-body'); if (!body) return;
  const { items, candidates } = s.data;
  const answered = items.filter(it=>it.answer).length;
  const total = items.length;

  const cards = items.map(_seqCardHtml).join('');

  // Финальный блок: «все ли отметили?» + добавить упущенного
  const allDone = total>0 && answered===total;
  const candOpts = candidates.map(c=>`<option value="${c.client_id}">${c.fio}</option>`).join('');
  const finalBlock = `
    <div class="seq-final ${allDone?'ok':''}">
      ${allDone
        ? `<div class="seq-final-done">✓ Все ${total} клиентов отмечены</div>`
        : `<div class="seq-final-cap">Отмечено <b>${answered}</b> из <b>${total}</b> — отметьте оставшихся</div>`}
      <div class="seq-add-q">Кого-то из клиентов нет в списке?</div>
      ${candidates.length
        ? `<div class="seq-add">
             <select id="seq-add-sel"><option value="">— выберите упущенного клиента —</option>${candOpts}</select>
             <div class="seq-add-nums">
               <label>Уже сделано</label>
               <input type="number" id="seq-add-used" min="0" placeholder="напр. 6"> из
               <input type="number" id="seq-add-total" min="1" placeholder="напр. 10">
             </div>
             <textarea id="seq-add-cmt" rows="1" placeholder="Комментарий"></textarea>
             <button class="seq-save" onclick="seqAddManual()">Добавить клиента</button>
           </div>`
        : `<div class="seq-add-empty">Все ваши клиенты уже в списке — добавлять некого.</div>`}
    </div>`;

  body.innerHTML = cards + finalBlock;

  // прогресс
  const pfill = document.getElementById('seq-pfill');
  const pct = total ? Math.round(answered/total*100) : 0;
  if (pfill) { pfill.style.width = Math.max(pct,3)+'%'; pfill.style.background = allDone ? 'var(--success)' : 'var(--warn)'; }
  const pd = document.getElementById('seq-pdone'); if (pd) pd.textContent = answered;
  const pt = document.getElementById('seq-ptot');  if (pt) pt.textContent = total;
}

function _seqItem(clientId) { return window._seq?.data.items.find(it=>it.client_id===clientId); }

async function seqYes(clientId) {
  const it = _seqItem(clientId); if (!it) return;
  try {
    await DB.saveSeqSurveyAnswer({ round: window._seq.round, trainerId: window._seq.trainerId, branch: window._seq.branch,
      clientId, systemNext: it.next, systemTotal: it.total, matches: true, finalNext: it.next, finalTotal: it.total });
    it.answer = { matches:true, final_next:it.next, final_total:it.total, comment:null };
    it._reopen = false; _seqRenderBody();
  } catch(e) { console.error('[seq] yes', e); toast('Не сохранилось','error'); }
}

function seqNo(clientId) {
  const fix = document.getElementById('fix-'+clientId);
  if (fix) { fix.classList.add('show'); document.getElementById('fixn-'+clientId)?.focus(); }
}

async function seqSaveNo(clientId) {
  const it = _seqItem(clientId); if (!it) return;
  const v = parseInt(document.getElementById('fixn-'+clientId)?.value, 10);
  if (!Number.isFinite(v) || v < 1) { toast('Укажите номер','error'); return; }
  const cmt = document.getElementById('fixc-'+clientId)?.value || '';
  try {
    await DB.saveSeqSurveyAnswer({ round: window._seq.round, trainerId: window._seq.trainerId, branch: window._seq.branch,
      clientId, systemNext: it.next, systemTotal: it.total, matches: false, finalNext: v, finalTotal: it.total, comment: cmt });
    it.answer = { matches:false, final_next: Math.min(v, it.total||v), final_total:it.total, comment:cmt.trim()||null };
    it._reopen = false; _seqRenderBody();
  } catch(e) { console.error('[seq] no', e); toast('Не сохранилось','error'); }
}

function seqEdit(clientId) {
  const it = _seqItem(clientId); if (!it) return;
  it._reopen = true; _seqRenderBody();
  if (it.answer && it.answer.matches === false) seqNo(clientId);
}

async function seqAddManual() {
  const s = window._seq; if (!s) return;
  const clientId = document.getElementById('seq-add-sel')?.value;
  const used = parseInt(document.getElementById('seq-add-used')?.value, 10);
  const total = parseInt(document.getElementById('seq-add-total')?.value, 10);
  const cmt = document.getElementById('seq-add-cmt')?.value || '';
  if (!clientId) { toast('Выберите клиента','error'); return; }
  if (!Number.isFinite(total) || total < 1) { toast('Укажите размер пакета','error'); return; }
  if (!Number.isFinite(used) || used < 0 || used > total) { toast('«Сделано» должно быть 0…'+total,'error'); return; }
  const next = Math.min(used + 1, total);
  try {
    await DB.saveSeqSurveyAnswer({ round: s.round, trainerId: s.trainerId, branch: s.branch,
      clientId, systemNext: null, systemTotal: null, matches: null,
      finalNext: next, finalTotal: total, comment: cmt, isManual: true });
    const cand = s.data.candidates.find(c=>c.client_id===clientId);
    s.data.candidates = s.data.candidates.filter(c=>c.client_id!==clientId);
    s.data.items.push({ client_id: clientId, fio: cand?cand.fio:'(клиент)', category: null,
      total, used, next, is_manual: true, answer: { is_manual:true, matches:null, final_next:next, final_total:total, comment:cmt.trim()||null } });
    _seqRenderBody();
    toast('Клиент добавлен','success');
  } catch(e) { console.error('[seq] add', e); toast('Не сохранилось','error'); }
}
