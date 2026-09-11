// ─ ADMIN: КОНТРОЛЬ
// ============================================================
// SECTION: ADMIN:CONTROL — renderAdminControl, audit log, сессии, конспекты, поздние запросы
// ============================================================
// ── КОНТРОЛЬ: очередь действий (inbox координатора) ──
// Наблюдательные метрики вынесены в renderAdminMonitoring («Ещё»).
// Память раскрытости наблюдательных блоков «Контроля» (переживает перерисовку/обновление)
function _ctrlOpenState() {
  try { return JSON.parse(localStorage.getItem('ctrl_open')||'{}'); } catch(e) { return {}; }
}
function _ctrlSetOpen(key, val) {
  const s = _ctrlOpenState(); s[key] = !!val;
  try { localStorage.setItem('ctrl_open', JSON.stringify(s)); } catch(e) {}
}

async function renderAdminControl(force=false) {
  // При обновлении (🔄 или после действия) не показываем спиннер и сохраняем скролл,
  // чтобы страница не «прыгала» наверх и блоки не схлопывались.
  const scroller = document.getElementById('tab-content');
  const savedTop = force ? (scroller?.scrollTop||0) : 0;
  const savedWin = force ? (window.scrollY||0) : 0;
  if (!force) $('#tab-content').innerHTML=`<div class="tab-pad">
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
      // «Списанные» храним в списке 3 дня (потом — в отдельный архив/выгрузку)
      const d3=new Date(now); d3.setDate(d3.getDate()-2);
      const confFrom=`${d3.getFullYear()}-${_p2(d3.getMonth()+1)}-${_p2(d3.getDate())}`;
      const [lateRequests, workoutDelReqs, deleteReqs, recHanging, recHangingTrials, recRejected, recConfirmed, pendingSubs, catRecalcReqs, trialDelReqs, mismatchFlags] = await Promise.all([
        DB.getPendingLateRequests(null).catch(()=>[]),
        DB.getAllWorkoutDeleteRequests().catch(()=>[]),
        DB.getAllDeleteRequests().catch(()=>[]),
        DB.getReceptionHanging(branches).catch(()=>[]),
        DB.getReceptionHangingTrials(branches).catch(()=>[]),
        DB.getReceptionRejected(branches, monthFrom, monthTo).catch(()=>({workouts:[],trials:[]})),
        DB.getReceptionConfirmed(branches, confFrom, monthTo).catch(()=>({workouts:[],trials:[]})),
        DB.getPendingSubstitutions().catch(()=>[]),   // замены — все филиалы
        DB.getPendingCategoryRecalcRequests(null).catch(()=>[]),
        DB.getAllTrialDeleteRequests().catch(()=>[]),
        DB.getPtMismatchFlags(branches).catch(()=>[]),
      ]);
      return {lateRequests, workoutDelReqs, deleteReqs, recHanging, recHangingTrials, recRejected, recConfirmed, pendingSubs, catRecalcReqs, trialDelReqs, mismatchFlags};
    }, 60000);
    const {lateRequests, workoutDelReqs, deleteReqs, recHanging, recHangingTrials, recRejected, recConfirmed, pendingSubs, catRecalcReqs, trialDelReqs, mismatchFlags} = D;
    window._mmFlags = Object.fromEntries((mismatchFlags||[]).map(f=>[String(f.id),f]));
    const actionSections=[];   // ⚡ требует решения (кнопки Одобрить/Отклонить/Удалить)
    const monitorSections=[];  // 👁 контроль/наблюдение (сворачиваемое)
    // 🔄 Запросы на замену (подтверждает координатор или старший — кто первый)
    if (pendingSubs.length) actionSections.push(`<div class="control-section">
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
    // ⚠ Расхождения остатка ПТ с 1С (перерасчёт: остаток + ФОТ)
    if (mismatchFlags.length) actionSections.push(`<div class="control-section">
      <div class="control-title warn">⚠ Расхождения с 1С (${mismatchFlags.length})</div>
      ${mismatchFlags.map(f=>_mmCard(f)).join('')}
    </div>`);
    // Списания ресепшн: три раскрывающихся блока (несписанные / отказанные / списанные).
    // Номер списания в абонементе (N/M) — у всех; пробные без номера.
    const seqStr = it => (it._kind!=='t' && it.balance_after!=null) ? ` · остаток ${it.balance_after} ПТ` : '';
    // Наблюдательный блок: <details> с запоминанием раскрытости (по умолчанию свёрнут).
    const _open = _ctrlOpenState();
    const collapse = (key, title, cls, inner) => {
      const isOpen = (key in _open) ? _open[key] : false;
      return `<details class="control-section" data-sec="${key}"${isOpen?' open':''}
        ontoggle="_ctrlSetOpen('${key}', this.open)">
        <summary class="control-title ${cls}" style="cursor:pointer">${title}</summary>${inner}</details>`;
    };

    // 🛎 НЕСПИСАННЫЕ — висящие подтверждения ресепшн (эскалация >24ч)
    if (recHanging.length) {
      const escThreshold = Date.now() - RECEPTION_ESCALATE_HRS*3600000;
      const overdue = recHanging.filter(w=>new Date(w.workout_date).getTime() < escThreshold);
      const ageStr = (d)=>{ const h=Math.floor((Date.now()-new Date(d))/3600000); return h<24?`${h} ч`:`${Math.floor(h/24)} дн.`; };
      monitorSections.push(collapse('hanging',
        `🛎 Несписанные — висят у ресепшн (${recHanging.length}${overdue.length?` · ⏰ ${overdue.length} > ${RECEPTION_ESCALATE_HRS}ч`:''})`,
        overdue.length?'danger':'warn',
        recHanging.slice(0,30).map(w=>{
          const esc=new Date(w.workout_date).getTime()<escThreshold;
          return `<div class="control-item" id="ctrl-hang-${w.id}" ${esc?'style="border-left:3px solid var(--danger)"':''}>
            <div class="ci-main">${w.clients?.fio||'?'} <span class="hint">← ${w.profiles?.fio||'?'}</span>${seqStr(w)}</div>
            <div class="ci-sub">🏊 ${w.branch||'—'} · ПТ ${fmtDT(w.workout_date)} · висит ${ageStr(w.workout_date)}${esc?' ⏰':''}</div>
            <div style="margin-top:8px">
              <button class="btn btn-sm btn-primary" onclick="doControlConfirmDeduction('${w.id}')" title="Подтвердить списание за ресепшн (Шаг 1 → 1С)">✓ Подтвердить</button>
            </div>
          </div>`;
        }).join('')));
    }
    // 🆕 НЕСПИСАННЫЕ ПРОБНЫЕ — висят у ресепшн (отдельная таблица trial_sessions)
    if (recHangingTrials.length) {
      const ageStrT = (d)=>{ const h=Math.floor((Date.now()-new Date(d))/3600000); return h<24?`${h} ч`:`${Math.floor(h/24)} дн.`; };
      monitorSections.push(collapse('hanging_trials',
        `🆕 Несписанные пробные — висят у ресепшн (${recHangingTrials.length})`, 'warn',
        recHangingTrials.slice(0,30).map(t=>{
          const cname = `${t.first_name||''}${t.last_name?' '+t.last_name:''}`.trim()||'?';
          return `<div class="control-item" id="ctrl-hangt-${t.id}">
            <div class="ci-main">${cname} <span class="hint">← ${t.profiles?.fio||'?'}</span>${t.category?` <span class="hi-cat cat-${t.category}">Кат.${t.category}</span>`:''}</div>
            <div class="ci-sub">🏊 ${t.branch||'—'} · 🆕 Пробная ${fmtDT(t.session_date)} · висит ${ageStrT(t.session_date)}</div>
            <div style="margin-top:8px">
              <button class="btn btn-sm btn-primary" onclick="doControlConfirmTrial('${t.id}')" title="Подтвердить пробную за ресепшн (Шаг 1 → 1С)">✓ Подтвердить</button>
            </div>
          </div>`;
        }).join('')));
    }
    // 🔴 ОТКАЗАННЫЕ — все причины; клуб + время ПТ + время отклонения (тренер может быть в 2 клубах)
    const recRej=[
      ...(recRejected.workouts||[]).map(w=>({...w, _kind:'w', fio:w.clients?.fio||'?', trainer:w.profiles?.fio||'?',
        branch:w.branch||'', wdate:w.workout_date, ts:w.reception_at, reason:w.reception_reason})),
      ...(recRejected.trials||[]).map(t=>({...t, _kind:'t', fio:`${t.first_name}${t.last_name?' '+t.last_name:''}`, trainer:t.profiles?.fio||'?',
        branch:t.branch||'', wdate:t.session_date, ts:t.reception_at, reason:t.reception_reason})),
    ].sort((a,b)=>new Date(b.ts)-new Date(a.ts));
    if (recRej.length) monitorSections.push(collapse('rejected',
      `🔴 Отказанные списания (${recRej.length})`, 'danger',
      recRej.map(q=>`<div class="control-item" id="recrej-${q._kind}-${q.id}">
        <div class="ci-main">${q.fio} <span class="hint">← ${q.trainer}</span>${q._kind==='t'?' <span class="hint">(пробное)</span>':''}${seqStr(q)}</div>
        <div class="ci-sub">🏊 ${q.branch||'—'} · ПТ ${fmtDT(q.wdate)}</div>
        <div class="ci-sub">✗ отклонено ${fmtDT(q.ts)}${q.reason?` · ${RECEPTION_REJECT_REASONS[q.reason]||q.reason}`:''}</div>
        ${q._kind==='w'?`<div style="margin-top:8px">
          <button class="btn btn-sm btn-primary" onclick="doRestoreRejectedWorkout('${q.id}')" title="Отклонили ошибочно — заново списать ПТ и засчитать в ЗП">↩︎ Вернуть списание</button>
        </div>`:''}
      </div>`).join('')));
    // 🧾 СПИСАННЫЕ — подтверждённые за последние 3 дня (потом переносятся в архив/выгрузку)
    const recConf=[
      ...(recConfirmed.workouts||[]).map(w=>({...w, _kind:'w', fio:w.clients?.fio||'?', trainer:w.profiles?.fio||'?',
        branch:w.branch||'', wdate:w.workout_date, ts:w.reception_at})),
      ...(recConfirmed.trials||[]).map(t=>({...t, _kind:'t', fio:`${t.first_name}${t.last_name?' '+t.last_name:''}`, trainer:t.profiles?.fio||'?',
        branch:t.branch||'', wdate:t.session_date, ts:t.reception_at})),
    ].sort((a,b)=>new Date(b.ts)-new Date(a.ts));
    if (recConf.length) monitorSections.push(collapse('confirmed',
      `🧾 Списанные за 3 дня (${recConf.length})`, '',
      recConf.slice(0,100).map(q=>`<div class="control-item">
        <div class="ci-main">${q.fio} <span class="hint">← ${q.trainer}</span>${q._kind==='t'?' <span class="hint">(пробное)</span>':''}${seqStr(q)}</div>
        <div class="ci-sub">🏊 ${q.branch||'—'} · ПТ ${fmtDT(q.wdate)}</div>
      </div>`).join('')
      + (recConf.length>100?`<div class="ci-sub" style="padding:8px 0;color:var(--hint)">…показаны первые 100 из ${recConf.length}</div>`:'')));
    // ⏰ Запросы на поздние тренировки
    if (lateRequests.length) actionSections.push(`<div class="control-section">
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
    if (catRecalcReqs.length) actionSections.push(`<div class="control-section">
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
    if (workoutDelReqs.length) actionSections.push(`<div class="control-section">
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
    if (trialDelReqs.length) actionSections.push(`<div class="control-section">
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
    if (deleteReqs.length) actionSections.push(`<div class="control-section">
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

    const nothing = !actionSections.length && !monitorSections.length;
    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header"><h3>Контроль</h3>
        <button class="btn-icon" onclick="renderAdminControl(true)" title="Обновить">🔄</button></div>
      <p class="hint" style="margin-bottom:16px">На ${todayStr()} · очередь действий</p>
      ${nothing ? '<div class="empty-state">✅<p>Очередь пуста</p></div>' : `
        ${actionSections.length
          ? `<div style="font-size:12px;font-weight:700;color:var(--hint);letter-spacing:.03em;margin:0 0 8px">⚡ ТРЕБУЕТ РЕШЕНИЯ</div>${actionSections.join('')}`
          : '<div class="empty-state" style="padding:16px">✅<p style="margin:4px 0 0">Активных запросов нет</p></div>'}
        ${monitorSections.length
          ? `<div style="border-top:1px solid var(--border);margin:18px 0 10px"></div>
             <div style="font-size:12px;font-weight:700;color:var(--hint);letter-spacing:.03em;margin:0 0 8px">👁 КОНТРОЛЬ · НАБЛЮДЕНИЕ</div>${monitorSections.join('')}`
          : ''}`}
    </div>`;
    // Восстанавливаем позицию прокрутки после обновления (без прыжка наверх)
    if (force) { if (scroller) scroller.scrollTop = savedTop; if (savedWin) window.scrollTo(0, savedWin); }
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

// Вернуть ошибочно отклонённое ресепшном списание: rejected → confirmed + заново списать ПТ.
// Если баланс 0 — оформляется долгом (в минус не уводим).
async function doRestoreRejectedWorkout(id) {
  if (_pending.has('recrestore_'+id)) return;
  if (!confirm('Вернуть это списание? ПТ снова спишется у клиента и попадёт в ЗП тренера.')) return;
  _pending.add('recrestore_'+id);
  try {
    const res = await DB.restoreRejectedWorkout(id, STATE.profile.id, STATE.profile.fio);
    document.getElementById(`recrej-w-${id}`)?.remove();
    toast(res.wentDebt ? '↩︎ Возвращено · баланс 0 → оформлено долгом' : '↩︎ Списание возвращено', 'success');
    invalidateCachePrefix('adm_control'); renderAdminControl(true);
  } catch(e) {
    toast(String(e.message||'').includes('not_rejected') ? 'Уже обработано' : 'Ошибка','error');
    console.error(e);
  } finally { _pending.delete('recrestore_'+id); }
}

// Координатор подтверждает списание тренера за ресепшн (Шаг 1 → 1С).
// То же действие, что «✓ Подтвердить» в панели ресепшена (confirmWorkout).
async function doControlConfirmDeduction(id) {
  if (_pending.has('ctrlconf_'+id)) return;
  _pending.add('ctrlconf_'+id);
  try {
    await DB.confirmWorkout(id, STATE.profile.id);
    document.getElementById(`ctrl-hang-${id}`)?.remove();
    try { DB.auditLog('reception_confirm', STATE.profile.id, STATE.profile.fio, id, 'workout',
      { via:'admin_control' }, STATE.profile.branches?.[0]); } catch(_){}
    toast('✓ Списание подтверждено','success');
    invalidateCachePrefix('adm_control'); renderAdminControl(true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('ctrlconf_'+id); }
}

// Координатор подтверждает пробную за ресепшн (Шаг 1 → 1С).
async function doControlConfirmTrial(id) {
  if (_pending.has('ctrlconft_'+id)) return;
  _pending.add('ctrlconft_'+id);
  try {
    await DB.confirmTrial(id, STATE.profile.id);
    document.getElementById(`ctrl-hangt-${id}`)?.remove();
    try { DB.auditLog('reception_confirm', STATE.profile.id, STATE.profile.fio, id, 'trial',
      { via:'admin_control' }, STATE.profile.branches?.[0]); } catch(_){}
    toast('✓ Пробная подтверждена','success');
    invalidateCachePrefix('adm_control'); renderAdminControl(true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('ctrlconft_'+id); }
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
      const [data, activityStats, allTrials, sessions, recStats] = await Promise.all([
        DB.getControlData(),
        DB.getTrainersActivityStats(y, mo).catch(()=>[]),
        DB.getAllTrialSessions(y, mo, null).catch(()=>[]),
        DB.getRecentSessions(30).catch(()=>[]),
        DB.getReceptionStats(branches, y, mo).catch(()=>[]),
      ]);
      return {data, activityStats, allTrials, sessions, recStats};
    }, 60000);
    const {data, activityStats, allTrials, sessions, recStats} = D;
    // Активный тренер = есть тренировки в текущем месяце (берём из activityStats.monthWorkouts).
    const activeSet=new Set((activityStats||[]).filter(t=>t.monthWorkouts>0).map(t=>t.id));
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

// ── РАСХОЖДЕНИЕ С 1С: перерасчёт (координатор + старший) ──
// Карточка одного флага. c = f.clients, tr = f.profiles.
function _mmCard(f) {
  const c = f.clients || {}; const tr = f.profiles || {};
  const cur = c.balance ?? 0;
  const prefill = (f.trainer_suggested != null) ? f.trainer_suggested : cur;
  const cat = c.category;
  return `<div class="control-item" id="mm-item-${f.id}">
    <div class="ci-main"><b>${c.fio||'клиент'}</b> <span class="hint">${f.branch||''}</span></div>
    <div class="ci-sub">Отметил: ${tr.fio||'—'} · ${fmtDate(f.created_at)}</div>
    <div class="ci-sub">Остаток в системе: <b>${cur}</b> · Кат.${cat||'?'}${f.trainer_suggested!=null?` · тренер считает: <b>${f.trainer_suggested}</b>`:''}</div>
    ${f.trainer_note?`<div class="ci-sub" style="color:var(--hint)">💬 ${f.trainer_note}</div>`:''}
    <div style="display:flex;gap:8px;align-items:center;margin-top:8px;flex-wrap:wrap">
      <input type="number" id="mm1c-${f.id}" value="${prefill}" min="0" placeholder="Остаток по 1С"
        style="width:110px;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text);font-size:13px">
      <label style="font-size:12px;color:var(--hint);display:flex;align-items:center;gap:5px">
        <input type="checkbox" id="mmfot-${f.id}" checked> корректировать ФОТ</label>
    </div>
    <div style="display:flex;gap:6px;margin-top:8px">
      <button class="btn btn-sm btn-primary" onclick="doResolveMismatch('${f.id}')">Пересчитать</button>
      <button class="btn btn-sm" style="background:rgba(239,68,68,.12);color:#fca5a5;border:1px solid rgba(239,68,68,.25)" onclick="doRejectMismatch('${f.id}')">Отклонить</button>
    </div>
  </div>`;
}

// Отдельный экран для старшего тренера (у координатора — внутри «Контроля»).
async function renderMismatchFlags(branches, backFn) {
  navPush(backFn || (()=>renderSeniorApp('more')));
  setScreen(`<div class="center-screen"><div class="spinner"></div></div>`);
  setupBack(goBack);
  let flags = [];
  try { flags = await DB.getPtMismatchFlags(branches); }
  catch(e) { console.error('[mismatch] list', e); toast('Ошибка загрузки','error'); }
  window._mmFlags = Object.fromEntries((flags||[]).map(f=>[String(f.id),f]));
  setScreen(`<div class="tab-pad">
    <div class="section-header">${backBtn()}<h3>⚠ Расхождения с 1С</h3></div>
    ${flags.length ? `<div class="control-section">${flags.map(f=>_mmCard(f)).join('')}</div>`
      : '<div class="empty-state">✅<p>Открытых расхождений нет</p></div>'}
  </div>`);
}

function _mmRefresh() {
  if (curRole()==='admin' || curRole()==='ceo') renderAdminControl(true);
  else renderMismatchFlags(STATE.profile.branches);
}

async function doResolveMismatch(flagId) {
  const f = (window._mmFlags||{})[String(flagId)]; if (!f) return;
  const v = parseInt(document.getElementById('mm1c-'+flagId)?.value, 10);
  if (!Number.isFinite(v) || v < 0) { toast('Укажите остаток по 1С','error'); return; }
  const applyFot = !!document.getElementById('mmfot-'+flagId)?.checked;
  if (_pending.has('mmres-'+flagId)) return; _pending.add('mmres-'+flagId);
  try {
    await DB.resolvePtMismatch({
      flagId, clientId: f.client_id, trainerId: f.trainer_id,
      beforeBalance: (f.clients?.balance ?? 0), correctedBalance: v,
      category: f.clients?.category, applyFot, branch: f.branch, resolvedBy: STATE.profile.id,
    });
    toast('Пересчитано ✓','success');
    _mmRefresh();
  } catch(e) { console.error('[mismatch] resolve', e); toast('Не удалось пересчитать','error'); }
  finally { _pending.delete('mmres-'+flagId); }
}

async function doRejectMismatch(flagId) {
  const reason = prompt('Причина отклонения (необязательно):') ?? '';
  if (_pending.has('mmrej-'+flagId)) return; _pending.add('mmrej-'+flagId);
  try {
    await DB.rejectPtMismatch(flagId, reason, STATE.profile.id);
    toast('Отклонено','info');
    _mmRefresh();
  } catch(e) { console.error('[mismatch] reject', e); toast('Ошибка','error'); }
  finally { _pending.delete('mmrej-'+flagId); }
}
