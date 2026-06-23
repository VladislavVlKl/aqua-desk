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
    if (!isValidWorkoutDate(v)) return toast(`ПТ №${i+1}: можно вносить тренировки за последние 72 часа. Если тренировка была раньше — обратитесь к координатору.`,'error');
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
