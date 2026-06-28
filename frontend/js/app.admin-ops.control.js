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
      const [lateRequests, workoutDelReqs, deleteReqs, recHanging, recRejected, pendingSubs, catRecalcReqs, trialDelReqs] = await Promise.all([
        DB.getPendingLateRequests(null).catch(()=>[]),
        DB.getAllWorkoutDeleteRequests().catch(()=>[]),
        DB.getAllDeleteRequests().catch(()=>[]),
        DB.getReceptionHanging(branches).catch(()=>[]),
        DB.getReceptionRejected(branches, monthFrom, monthTo).catch(()=>({workouts:[],trials:[]})),
        DB.getPendingSubstitutions().catch(()=>[]),   // замены — все филиалы
        DB.getPendingCategoryRecalcRequests(null).catch(()=>[]),
        DB.getAllTrialDeleteRequests().catch(()=>[]),
      ]);
      return {lateRequests, workoutDelReqs, deleteReqs, recHanging, recRejected, pendingSubs, catRecalcReqs, trialDelReqs};
    }, 60000);
    const {lateRequests, workoutDelReqs, deleteReqs, recHanging, recRejected, pendingSubs, catRecalcReqs, trialDelReqs} = D;
    const sections=[];
    // 🔄 Запросы на замену (подтверждает координатор или старший — кто первый)
    if (pendingSubs.length) sections.push(`<div class="control-section">
      <div class="control-title warn">🔄 Запросы на замену (${pendingSubs.length})</div>
      ${pendingSubs.map(s=>{
        const sugg = (s.trainer_groups?.group_types?.billing_model==='headcount' && s.headcount) ? getAdultGroupRate(s.headcount) : '';
        return `<div class="control-item">
        <div class="ci-main"><b>${s.substitute?.fio||'?'}</b> вместо ${s.original?.fio||'?'} <span class="hint">${s.trainer_groups?.branch||''}</span></div>
        <div class="ci-sub">${s.trainer_groups?.group_types?.name||'Группа'} · ${fmtDate(s.session_date)}</div>
        ${s.headcount?`<div class="ci-sub" style="color:#10b981">👥 ${s.headcount} чел.${sugg?` → ставка ${fmt(sugg)} сум`:''}</div>`:''}
        <div style="display:flex;gap:6px;margin-top:8px;align-items:center">
          <input type="number" id="asub-rate-${s.id}" placeholder="Ставка (сум)" value="${sugg||''}"
            style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text);font-size:13px">
          <button class="btn btn-sm btn-primary" onclick="doApproveSubstitutionAdmin('${s.id}')">✓ Подтвердить</button>
        </div>
      </div>`;}).join('')}
    </div>`);
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
    // 🔄 Запросы на пересчёт категории прошлых ПТ
    if (catRecalcReqs.length) sections.push(`<div class="control-section">
      <div class="control-title warn">🔄 Пересчёт категории прошлых ПТ (${catRecalcReqs.length})</div>
      ${catRecalcReqs.map(r=>`<div class="control-item">
        <div class="ci-main"><b>${r.clients?.fio||r.client_fio||'?'}</b> · Кат.${r.clients?.category||'?'} → Кат.${r.new_category}</div>
        <div class="ci-sub">Тренер: ${r.profiles?.fio||'?'} · ${r.branch||''} · ${r.scope==='all'?'все ПТ':'текущий месяц'}</div>
        <div style="display:flex;gap:6px;margin-top:8px">
          <button class="btn btn-sm btn-primary" onclick="doApproveCatRecalc(${r.id},'admin')">✓ Одобрить</button>
          <button class="btn btn-sm btn-danger" onclick="doRejectCatRecalc(${r.id},'admin')">✗ Отклонить</button>
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
    // 🗑 Запросы на удаление пробной
    if (trialDelReqs.length) sections.push(`<div class="control-section">
      <div class="control-title danger">🗑 Запросы на удаление пробной (${trialDelReqs.length})</div>
      ${trialDelReqs.map(r=>`<div class="control-item">
        <div class="ci-main">${r.client_name||'—'} · ${fmtDate(r.session_date)}</div>
        <div class="ci-sub">Тренер: ${r.profiles?.fio||'?'} · ${r.branch||''}</div>
        <div style="display:flex;gap:6px;margin-top:6px">
          <button class="btn btn-sm btn-danger" onclick="doApproveTrialDelete('${r.id}','${r.trial_id}')">Удалить</button>
          <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
            onclick="doRejectTrialDelete('${r.id}')">Отклонить</button>
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

// Подтверждение замены координатором (доступ во все филиалы). Идемпотентно:
// если старший уже подтвердил — покажем «уже подтверждено».
async function doApproveSubstitutionAdmin(id) {
  const rate = parseFloat(document.getElementById(`asub-rate-${id}`)?.value)||0;
  if (!rate) return toast('Укажите ставку','error');
  if (_pending.has('asub_'+id)) return;
  _pending.add('asub_'+id);
  try {
    const ok = await DB.approveSubstitution(id, rate);
    if (ok) {
      DB.auditLog('group_substitution_approve', STATE.profile.id, STATE.profile.fio, id, 'group_substitution',
        { rate }, STATE.profile.branches?.[0]);
      toast('Замена одобрена ✅','success');
    } else {
      toast('Уже подтверждено','info');
    }
    invalidateCachePrefix('adm_control'); renderAdminControl(true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('asub_'+id); }
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
