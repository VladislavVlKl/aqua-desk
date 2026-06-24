// ── ТАБ: РАСПИСАНИЕ ───────────────────────────
// ── ТАБ: РАСПИСАНИЕ (КАЛЕНДАРНОЕ) ────────────

// Глобальное состояние недели
let _schedWeekOffset = 0;

// ============================================================
// SECTION: TRAINER:SCHEDULE — renderScheduleTab, loadScheduleWeek, renderAddSlotModal
// ============================================================
function getWeekBounds(offset=0) {
  const now = new Date();
  const mon = new Date(now);
  mon.setDate(now.getDate() - (now.getDay()+6)%7 + offset*7);
  mon.setHours(0,0,0,0);
  const sun = new Date(mon); sun.setDate(mon.getDate()+6);
  const fmt = d => d.toISOString().slice(0,10);
  return { mon, sun, monStr: fmt(mon), sunStr: fmt(sun) };
}

function weekLabel(offset) {
  const {mon,sun} = getWeekBounds(offset);
  if (offset===0) return 'Эта неделя';
  if (offset===1) return 'Следующая неделя';
  if (offset===-1) return 'Прошлая неделя';
  return `${mon.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})} – ${sun.toLocaleDateString('ru-RU',{day:'2-digit',month:'short'})}`;
}

async function renderScheduleTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  await loadScheduleWeek(_schedWeekOffset);
}

async function loadScheduleWeek(offset) {
  _schedWeekOffset = offset;
  const {mon, monStr, sunStr} = getWeekBounds(offset);
  const branch = STATE.profile.branches?.[0]||'';

  try {
    const [recurring, oneTime, events, trainerGroups] = await Promise.all([
      DB.getRecurringSlots(STATE.profile.id),
      DB.getOneTimeSlots(STATE.profile.id, monStr, sunStr),
      DB.getEventsForWeek(monStr, sunStr, branch),
      DB.getTrainerGroups(STATE.profile.id),
    ]);
    // Карта group_type_id → role для этого тренера
    window._myGroupRoleMap = {};
    trainerGroups.forEach(g => {
      if (g.role) window._myGroupRoleMap[g.group_type_id] = g.role;
    });

    const recurringIds = recurring.map(s=>s.id);
    const cancellations = await DB.getCancellations(recurringIds, monStr, sunStr);
    const cancelledSet = new Set(cancellations.map(c=>`${c.slot_id}__${c.cancel_date}`));

    // Строим сетку по датам недели
    const grid = {}; // grid[dow][hKey] = []
    for (let d=0;d<7;d++) { grid[d]={}; SCHEDULE_HOURS.forEach(h=>{grid[d][h]=[];}); }

    // Повторяющиеся (фильтруем отменённые)
    recurring.forEach(s=>{
      const dateForDow = new Date(mon); dateForDow.setDate(mon.getDate()+s.day_of_week);
      const dateStr = dateForDow.toISOString().slice(0,10);
      if (cancelledSet.has(`${s.id}__${dateStr}`)) return; // отменён
      // Остаток ПТ исчерпан → НЕ скрываем, а помечаем приглушённо (тренер должен видеть слот)
      const lowBal = s.slot_type==='pt' && (s.clients?.balance||0)<=0;
      const startH = parseInt(s.start_time.slice(0,2));
      const endH   = parseInt(s.end_time.slice(0,2));
      if (s.slot_type==='duty') {
        for (let h=startH;h<endH;h++) {
          const hKey=`${String(h).padStart(2,'0')}:00`;
          if (grid[s.day_of_week]?.[hKey])
            grid[s.day_of_week][hKey].push({...s,_dutyFirst:h===startH,_dutyLast:h===endH-1,_date:dateStr});
        }
      } else {
        const hKey=`${String(startH).padStart(2,'0')}:00`;
        if (grid[s.day_of_week]?.[hKey]) grid[s.day_of_week][hKey].push({...s,_date:dateStr,_lowBalance:lowBal});
      }
    });

    // Разовые слоты
    oneTime.forEach(s=>{
      const lowBal = s.slot_type==='pt' && (s.clients?.balance||0)<=0;
      const date = new Date(s.specific_date+'T12:00:00');
      const dow  = (date.getDay()+6)%7;
      const startH = parseInt(s.start_time.slice(0,2));
      const hKey=`${String(startH).padStart(2,'0')}:00`;
      if (grid[dow]?.[hKey]) grid[dow][hKey].push({...s,_date:s.specific_date,_oneTime:true,_lowBalance:lowBal});
    });

    // События
    events.forEach(ev=>{
      const startDate = new Date(ev.start_time);
      const dow = (startDate.getDay()+6)%7;
      // Используем локальное время (Supabase хранит в UTC, +5 Ташкент)
      const h   = startDate.getUTCHours() + 5;
      const adjH = h % 24;
      const hKey = `${String(adjH).padStart(2,'0')}:00`;
      const fallback = adjH < 7 ? '07:00' : adjH > 23 ? '22:00' : hKey;
      if (grid[dow]) {
        const key = grid[dow][hKey] !== undefined ? hKey : fallback;
        if (grid[dow][key]) grid[dow][key].push({...ev,_isEvent:true,_date:ev.start_time.slice(0,10)});
      }
    });

    // Заголовки дней с датами
    const dayHeaders = DAYS_SHORT.map((d,i)=>{
      const date = new Date(mon); date.setDate(mon.getDate()+i);
      const isToday = date.toISOString().slice(0,10) === todayStr();
      return `<th class="${isToday?'sched-today':''}">
        ${d}<br><span class="sched-date-num">${date.getDate()}</span>
      </th>`;
    }).join('');

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header">
        <h3>Расписание</h3>
        <button class="btn btn-sm" onclick="renderAddSlotModal()">+ Слот</button>
      </div>

      <!-- Навигация по неделям -->
      <div class="week-nav">
        <button class="btn btn-sm" onclick="loadScheduleWeek(${offset-1})">‹</button>
        <span class="week-label">${weekLabel(offset)}</span>
        <button class="btn btn-sm" onclick="loadScheduleWeek(${offset+1})">›</button>
      </div>
      ${offset!==0?`<button class="btn btn-sm" style="width:100%;margin-bottom:10px;background:var(--card)"
        onclick="loadScheduleWeek(0)">Сегодня</button>`:''}

      <div class="schedule-scroll">
        <table class="sched-table">
          <thead><tr>
            <th class="sched-time-col"></th>${dayHeaders}
          </tr></thead>
          <tbody>
            ${SCHEDULE_HOURS.map(h=>`<tr>
              <td class="sched-time">${h}</td>
              ${[0,1,2,3,4,5,6].map(dow=>`<td class="sched-cell">
                ${(grid[dow]?.[h]||[]).map(s=>renderSlotPill(s)).join('')}
              </td>`).join('')}
            </tr>`).join('')}
          </tbody>
        </table>
      </div>

      <div class="legend">
        ${Object.entries(SLOT_COLORS).map(([k,v])=>
          `<span class="legend-item" style="background:${v.bg};color:${v.color}">${v.label}</span>`
        ).join('')}
        <span class="legend-item" style="background:rgba(245,158,11,.15);color:var(--warn)">📌 Событие</span>
        <span class="legend-item" style="background:rgba(99,102,241,.15);color:#818cf8">★ Разовый</span>
      </div>
    </div>`;
  } catch(e) { toast('Ошибка загрузки расписания','error'); console.error(e); }
}

function renderSlotPill(s) {
  // Событие
  if (s._isEvent) {
    const bg = s.blocks_pool ? 'rgba(239,68,68,.15)' : 'rgba(245,158,11,.15)';
    const color = s.blocks_pool ? 'var(--danger)' : 'var(--warn)';
    return `<div class="slot-pill" style="background:${bg};color:${color}" title="${s.title}">
      📌 ${s.title.slice(0,8)}</div>`;
  }
  // Для групп — определяем цвет по роли тренера
  let c = SLOT_COLORS[s.slot_type];
  if (s.slot_type==='group') {
    const role = (window._myGroupRoleMap||{})[s.group_type_id]||'';
    if (role==='суша') c = {bg:'rgba(234,179,8,.18)',  color:'#ca8a04'};
    else               c = {bg:'rgba(59,130,246,.18)', color:'#3b82f6'};
  }
  const oneTimeMark = s._oneTime ? '★ ' : '';
  const oneBorder   = s._oneTime ? `border:1px dashed ${c.color};` : '';

  if (s.slot_type==='duty') {
    const bTop=s._dutyFirst?`border-top:2px solid ${c.color};border-radius:4px 4px 0 0;`:'';
    const bBot=s._dutyLast?`border-bottom:2px solid ${c.color};border-radius:0 0 4px 4px;margin-bottom:0;`:'';
    const label=s._dutyFirst?`${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`:'│';
    return `<div class="slot-pill slot-duty-block" style="background:${c.bg};color:${c.color};${bTop}${bBot}"
      onclick="showSlotMenu('${s.id}','${s.slot_type}','${s._date||''}',${!!s._oneTime})">${label}</div>`;
  }
  const label = s.slot_type==='pt'
    ? (s.clients?.fio?.split(' ')[0]||'ПТ')
    : (s.group_types?.name?.slice(0,6)||'Гр');
  // Остаток ПТ исчерпан — слот виден, но приглушён + показываем остаток (напр. «(0)», «(-1)»)
  const lowBal   = !!s._lowBalance;
  const lowStyle = lowBal ? 'opacity:.45;' : '';
  const lowMark  = lowBal ? ` (${s.clients?.balance ?? 0})` : '';
  const lowTitle = lowBal ? ' title="Остаток ПТ исчерпан — продлите абонемент"' : '';
  return `<div class="slot-pill" style="background:${c.bg};color:${c.color};${oneBorder}${lowStyle}"${lowTitle}
    onclick="showSlotMenu('${s.id}','${s.slot_type}','${s._date||''}',${!!s._oneTime})">
    ${oneTimeMark}${label}${lowMark}</div>`;
}

function showSlotMenu(slotId, type, date, isOneTime) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Действие со слотом</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${date&&!isOneTime?`
      <button class="btn btn-full" style="margin-bottom:8px;background:var(--card);border:1px solid var(--warn);color:var(--warn)"
        onclick="this.closest('.modal-overlay').remove();doSkipSlotDate('${slotId}','${date}')">
        Пропустить ${date} (только этот день)</button>`:''}
    <button class="btn btn-danger btn-full"
      onclick="this.closest('.modal-overlay').remove();doDeleteSlot('${slotId}','${type}',${isOneTime})">
      ${isOneTime?'Удалить разовый слот':'Удалить из расписания навсегда'}</button>
  </div>`;
  document.body.appendChild(m);
}

async function doSkipSlotDate(slotId, date) {
  try {
    await DB.cancelSlotDate(slotId, date);
    toast(`Слот ${date} пропущен`,'success');
    loadScheduleWeek(_schedWeekOffset);
  } catch(e) { console.error(e); toast('Ошибка','error'); }
}

async function doDeleteSlot(slotId, type, isOneTime) {
  const msg = isOneTime ? 'Удалить разовый слот?' : `Удалить слот (${SLOT_COLORS[type]?.label||type}) навсегда?`;
  if (!confirm(msg)) return;
  try { await DB.deactivateSlot(slotId); toast('Удалено','success'); loadScheduleWeek(_schedWeekOffset); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}

async function confirmDeleteSlot(id,type) {
  await doDeleteSlot(id,type,false);
}

async function renderAddSlotModal() {
  const branches=STATE.profile.branches||[];
  const clients=await DB.getClients(STATE.profile.id);
  const groupList=await DB.getTrainerGroups(STATE.profile.id);
  window._slotClients=clients.filter(c=>!c.is_archived); window._slotGroupList=groupList;

  // Даты текущей недели для разового слота
  const {mon} = getWeekBounds(_schedWeekOffset);
  const weekDates = DAYS_FULL.map((d,i)=>{
    const date=new Date(mon); date.setDate(mon.getDate()+i);
    const ds=[date.getFullYear(),String(date.getMonth()+1).padStart(2,'0'),String(date.getDate()).padStart(2,'0')].join('-');
    return `<option value="${ds}">${d} (${date.getDate()})</option>`;
  }).join('');

  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить слот</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${branchSelect('slot-branch',branches)}

    <div class="form-group"><label>Тип добавления</label>
      <select id="slot-recur" onchange="onSlotRecurChange(this)">
        <option value="recurring">Постоянный (каждую неделю)</option>
        <option value="onetime">Разовый (конкретная дата)</option>
      </select>
    </div>

    <div id="slot-recurring-dow" class="form-group"><label>Дни недели (можно выбрать несколько)</label>
      <div style="display:flex;gap:6px;flex-wrap:wrap" id="slot-dow-checkboxes">
        ${DAYS_FULL.map((d,i)=>`<label style="display:flex;align-items:center;gap:4px;font-size:13px;padding:6px 10px;background:var(--card);border:1px solid var(--border);border-radius:8px;cursor:pointer">
          <input type="checkbox" name="slot-dow" value="${i}" ${i===0?'checked':''}> ${d}</label>`).join('')}
      </div></div>
    <div id="slot-onetime-date" class="form-group" style="display:none"><label>Дата</label>
      <select id="slot-date">${weekDates}</select></div>

    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label><input type="time" id="slot-start" value="09:00" oninput="(()=>{const[h,m]=this.value.split(':').map(Number);const e=new Date(0,0,0,h+1,m);document.getElementById('slot-end').value=String(e.getHours()).padStart(2,'0')+':'+String(e.getMinutes()).padStart(2,'0')})()"></div>
      <div style="flex:1"><label>Конец</label><input type="time" id="slot-end" value="10:00"></div>
    </div>
    <div class="form-group"><label>Тип</label>
      <select id="slot-type" onchange="onSlotTypeChange(this)">
        <option value="duty">Дежурство</option>
        <option value="pt">ПТ</option>
        <option value="group">Группа</option>
      </select>
    </div>
    <div id="slot-extra"></div>
    <button class="btn btn-primary btn-full" onclick="doAddSlot()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
  onSlotTypeChange(document.getElementById('slot-type'));
}

function onSlotRecurChange(sel) {
  document.getElementById('slot-recurring-dow').style.display = sel.value==='onetime' ? 'none' : '';
  document.getElementById('slot-onetime-date').style.display  = sel.value==='onetime' ? '' : 'none';
}

function onSlotTypeChange(sel) {
  const extra=document.getElementById('slot-extra'); if (!extra) return;
  const clients=window._slotClients||[], groups=window._slotGroupList||[];
  if (sel.value==='pt') {
    extra.innerHTML=`<div class="form-group"><label>Клиент</label>
      <select id="slot-client"><option value="">— выберите —</option>
        ${clients.map(c=>`<option value="${c.id}">${c.fio}</option>`).join('')}
      </select></div>`;
  } else if (sel.value==='group') {
    extra.innerHTML=`
      <div class="form-group"><label>Тип группы</label>
        <select id="slot-group"><option value="">— выберите —</option>
          ${groups.map(g=>`<option value="${g.group_type_id}">${g.group_types?.name||'?'}</option>`).join('')}
        </select></div>
      <div class="form-group"><label>Средняя явка (чел.)</label>
        <input type="number" id="slot-headcount" min="1" value="5"></div>`;
  } else { extra.innerHTML=''; }
}

async function doAddSlot() {
  const branch    = document.getElementById('slot-branch')?.value||STATE.profile.branches?.[0]||'';
  const recur     = document.getElementById('slot-recur')?.value||'recurring';
  const checkedDows = recur==='onetime' ? [] :
    [...document.querySelectorAll('input[name="slot-dow"]:checked')].map(el=>parseInt(el.value));
  const dow       = checkedDows.length ? checkedDows[0] : 0;
  const date      = document.getElementById('slot-date')?.value||null;
  const start     = document.getElementById('slot-start')?.value;
  const end       = document.getElementById('slot-end')?.value;
  const type      = document.getElementById('slot-type')?.value;
  const clientId  = document.getElementById('slot-client')?.value||null;
  const groupId   = document.getElementById('slot-group')?.value||null;
  const headcount = parseInt(document.getElementById('slot-headcount')?.value||'0');
  if (!start||!end)            return toast('Укажите время','error');
  if (start>=end)              return toast('Конец позже начала','error');
  if (type==='pt'&&!clientId)  return toast('Выберите клиента','error');
  if (type==='group'&&!groupId)return toast('Выберите группу','error');

  const baseFields = {
    trainer_id:    STATE.profile.id,
    branch,
    start_time:    start,
    end_time:      end,
    slot_type:     type,
    client_id:     type==='pt'    ? clientId          : null,
    group_type_id: type==='group' ? parseInt(groupId) : null,
    avg_headcount: type==='group' ? headcount         : null,
    specific_date: recur==='onetime' ? date : null,
  };

  try {
    if (recur==='onetime') {
      await DB.addSlot({...baseFields,
        day_of_week: date ? (new Date(date+'T12:00:00').getDay()+6)%7 : dow});
    } else {
      const days = checkedDows && checkedDows.length ? checkedDows : [dow];
      for (const d of days) {
        await DB.addSlot({...baseFields, day_of_week: d});
      }
    }
    document.querySelector('.modal-overlay')?.remove();
    toast('Слот добавлен ✅','success');
    loadScheduleWeek(_schedWeekOffset);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: СЕГОДНЯ ──────────────────────────────
// ============================================================
// SECTION: TRAINER:TODAY — renderTodayTab, doConfirm
// ============================================================
async function renderTodayTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const date=todayStr();
  const yesterday=new Date(); yesterday.setDate(yesterday.getDate()-1);
  const yesterdayStr=yesterday.toISOString().slice(0,10);
  const dayName=DAYS_FULL[(new Date().getDay()+6)%7];
  try {
    const [slots, yesterdaySlots, events, todayWorkouts] = await Promise.all([
      DB.getTodaySlots(STATE.profile.id, date),
      DB.getTodaySlots(STATE.profile.id, yesterdayStr),
      DB.getUpcomingEvents(STATE.profile.branches?.[0]||null),
      DB.getTodayWorkouts(STATE.profile.id, date),
    ]);

    // Вчерашние незакрытые (только PT и группы, без дежурств)
    const missedSlots = yesterdaySlots.filter(s=>
      s.slot_type!=='duty' && !s.confirmation
    );

    // Скрываем ПТ-слоты клиентов с нулевым остатком (закрытые/истёкшие абонементы),
    // кроме уже подтверждённых на сегодня — их оставляем, чтобы не «потерять» проведённую тренировку.
    const ptSlots=slots.filter(s=>s.slot_type==='pt' && ((s.clients?.balance||0)>0 || s.confirmation));
    const grpSlots=slots.filter(s=>s.slot_type==='group');
    const dutySlots=slots.filter(s=>s.slot_type==='duty');
    const pending=[...ptSlots,...grpSlots].filter(s=>!s.confirmation).length;
    const todayEvents=events.filter(e=>fmtDate(e.start_time)===fmtDate(new Date()));

    // Сохраняем пропущенные в глобальной переменной для панели
    window._missedSlots = missedSlots;
    window._missedDate  = yesterdayStr;

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header">
        <div><h3>Сегодня</h3><p class="hint">${dayName}, ${date}</p></div>
        <div style="display:flex;align-items:center;gap:8px">
          ${pending>0?`<div class="pending-badge">${pending}</div>`:''}
          <button onclick="renderMissedSlotsPanel()" style="background:${missedSlots.length?'rgba(239,68,68,.15)':'rgba(255,255,255,.07)'};color:${missedSlots.length?'#ef4444':'var(--hint)'};border:1px solid ${missedSlots.length?'rgba(239,68,68,.3)':'var(--border)'};border-radius:10px;padding:4px 10px;font-size:12px;font-weight:600;cursor:pointer">
            ⚠️ Пропущенные${missedSlots.length?` (${missedSlots.length})`:''}
          </button>
        </div>
      </div>
      ${todayEvents.map(ev=>`<div class="today-card event-card-mini ${ev.blocks_pool?'event-blocking':''}">
        <span>${EVENT_TYPES[ev.event_type]||'📌'} <b>${ev.title}</b></span>
        <span class="hint">${fmtTime(ev.start_time)}–${fmtTime(ev.end_time)}</span>
        ${ev.blocks_pool?'<span class="overdue-badge">Бассейн закрыт</span>':''}
      </div>`).join('')}
      ${dutySlots.length?`<h4>Дежурство</h4>
        ${dutySlots.map(s=>`<div class="today-card duty-card">
          <div class="today-card-row">
            <span class="today-time">⏱ ${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}</span>
            <span class="today-label">Дежурство · ${s.branch}</span>
          </div></div>`).join('')}`:''}
      ${ptSlots.length?`<h4>Персональные тренировки</h4>${ptSlots.map(s=>renderTodaySlot(s,date)).join('')}`:''}
      ${grpSlots.length?`<h4>Групповые занятия</h4>${grpSlots.map(s=>renderTodaySlot(s,date)).join('')}`:''}
      ${!ptSlots.length&&!grpSlots.length&&!dutySlots.length&&!todayEvents.length&&!missedSlots.length?'<div class="empty-state">📭<p>На сегодня ничего нет</p></div>':''}
      ${todayWorkouts.length?`
      <h4 style="margin-top:20px">✅ Списано сегодня (${todayWorkouts.length})</h4>
      <div style="display:flex;flex-direction:column;gap:6px">
        ${todayWorkouts.map(w=>{
          const type = w.is_drop_in?'Разовое':w.is_debt?'В долг':'ПТ';
          const color = w.is_debt?'#f59e0b':w.is_drop_in?'#7c3aed':'#10b981';
          return `<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px">
            <div>
              <div style="font-weight:500">${w.clients?.fio||'—'}</div>
              <div style="font-size:12px;color:var(--hint)">Кат.${w.clients?.category||w.category||'?'}</div>
            </div>
            <div style="display:flex;gap:6px;align-items:center">
              ${w.reception_status==='pending'?'<span style="font-size:11px;padding:2px 8px;border-radius:8px;background:rgba(245,158,11,.15);color:#f59e0b">⏳</span>':''}
              <span style="font-size:12px;padding:2px 8px;border-radius:8px;background:rgba(16,185,129,.1);color:${color};font-weight:600">${type}</span>
            </div>
          </div>`;
        }).join('')}
      </div>`:''}
    </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function renderTodaySlot(s,date) {
  const conf=s.confirmation, status=conf?.status||'pending';
  const isAdult=s.group_types?.billing_model==='headcount';
  const label=s.slot_type==='pt'?(s.clients?.fio||'Клиент'):(s.group_types?.name||'Группа');
  const timeStr=`${s.start_time.slice(0,5)}–${s.end_time.slice(0,5)}`;
  const cat=s.clients?.category||1;
  const clientId=s.client_id||'';
  const slotBranch=encodeURIComponent(s.branch||'');

  if (status==='confirmed') return `<div class="today-card confirmed-card">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span><span class="today-label">${label}</span>
      <span class="status-badge confirmed">✓ Подтверждено</span>
    </div>
    ${conf?.actual_headcount?`<div class="today-sub">Явка: ${conf.actual_headcount} чел.</div>`:''}
  </div>`;

  if (status==='cancelled') return `<div class="today-card cancelled-card">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span><span class="today-label">${label}</span>
      <span class="status-badge cancelled">✗ Отменено</span>
    </div>
    ${conf?.cancel_reason?`<div class="today-sub">${conf.cancel_reason}</div>`:''}
  </div>`;

  const isPt=s.slot_type==='pt';
  return `<div class="today-card pending-card">
    <div class="today-card-row">
      <span class="today-time">${timeStr}</span><span class="today-label">${label}</span>
      <span class="status-badge pending">Ожидает</span>
    </div>
    ${s.clients?.balance===0?'<div class="today-sub warn-text">⚠️ Нулевой баланс</div>':''}
    ${isAdult?`<div class="form-group" style="margin:8px 0 0">
      <label>Явка (чел.)</label>
      <input type="number" id="hc-${s.id}" min="1" max="50" value="5" style="width:80px;display:inline-block">
    </div>`:''}
    <div class="today-actions">
      <button class="btn btn-sm btn-primary"
        onclick="doConfirm('${s.id}','${date}',${isPt},${isAdult},'${clientId}',${cat},'${slotBranch}','${s.group_type_id||''}')">
        Подтвердить</button>
      <button class="btn btn-sm btn-danger" onclick="doCancelSlot('${s.id}','${date}')">Отменить</button>
    </div>
  </div>`;
}

async function doConfirm(slotId,date,isPt,isAdult,clientId,category,branchEnc,groupTypeId) {
  const branch=decodeURIComponent(branchEnc);
  const headcount=isAdult?parseInt(document.getElementById(`hc-${slotId}`)?.value||5):null;
  try {
    let workoutId=null;
    if (isPt&&clientId) {
      const rows=[{trainer_id:STATE.profile.id,client_id:clientId,category_at_moment:category,
        branch,workout_date:new Date().toISOString(),is_debt:false,is_drop_in:false}];
      const w=await DB.logWorkouts(rows); workoutId=w?.[0]?.id;
    }
    if (isAdult&&groupTypeId) {
      await DB.logGroupSession(STATE.profile.id,parseInt(groupTypeId),branch,date,headcount);
    }
    await DB.upsertConfirmation(slotId,date,{status:'confirmed',actual_headcount:headcount,workout_id:workoutId});
    toast('✅ Подтверждено','success'); renderTodayTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function doCancelSlot(slotId,date) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Причина отмены</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Причина</label>
      <textarea id="cancel-reason" rows="3" placeholder="Клиент отменил, болезнь..."></textarea></div>
    <button class="btn btn-danger btn-full" onclick="doConfirmCancel('${slotId}','${date}')">Отменить занятие</button>
  </div>`;
  document.body.appendChild(m);
}
async function doConfirmCancel(slotId,date) {
  const reason=document.getElementById('cancel-reason')?.value.trim()||'';
  try {
    await DB.upsertConfirmation(slotId,date,{status:'cancelled',cancel_reason:reason||null});
    document.querySelector('.modal-overlay')?.remove();
    toast('Отменено','success'); renderTodayTab();
  } catch(e) { console.error(e); toast('Ошибка','error'); }
}

// ── ТАБ: ДЕЖУРСТВО (РУЧНОЙ ВВОД) ────────────
// ============================================================
// SECTION: TRAINER:DUTIES — renderDutyTab, doLogDuty, renderLateRequestModal
// ============================================================
async function renderDutyTab() {
  const branches=STATE.profile.branches||[];
  const now=new Date();
  const _p2=n=>String(n).padStart(2,'0');
  const _ymd=`${now.getFullYear()}-${_p2(now.getMonth()+1)}-${_p2(now.getDate())}`;
  const defStart=`${_ymd}T07:00`;
  const defEnd=`${_ymd}T${_p2(now.getHours())}:00`;
  const duties=await DB.getDuties(STATE.profile.id,now.getFullYear(),now.getMonth()+1);

  $('#tab-content').innerHTML=`<div class="tab-pad">
    <h3>Записать дежурство</h3>
    <p class="hint" style="margin-bottom:16px">Выберите смену или введите время вручную.</p>
    ${branchSelect('sel-branch',branches)}
    ${dutyShiftSelect('sel-branch')}
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label>
        <input type="datetime-local" id="duty-start" value="${defStart}" step="3600"
          onchange="this.value=this.value.slice(0,13)+':00'"></div>
      <div style="flex:1"><label>Конец</label>
        <input type="datetime-local" id="duty-end" value="${defEnd.slice(0,13)+':00'}" step="3600"
          onchange="this.value=this.value.slice(0,13)+':00'"></div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doLogDuty()">Записать</button>
    <h4 style="margin-top:20px">Дежурства в этом месяце</h4>
    ${!duties.length?'<p class="hint">Нет записей</p>':duties.map(d=>{
      const h=hoursFromDuty(d.start_time,d.end_time);
      const startLocal=new Date(d.start_time).toISOString().slice(0,16);
      const endLocal  =new Date(d.end_time).toISOString().slice(0,16);
      return `<div class="history-item">
        <div class="hi-main" style="display:flex;justify-content:space-between;align-items:center">
          <div>
            <span class="hi-client">${d.branch}</span>
            <span class="hi-cat">${h.toFixed(2)}ч = ${fmt(Math.round(h*RATES.duty_per_hour))} сум</span>
          </div>
          <div style="display:flex;gap:4px">
            <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
              onclick="renderEditDutyModal('${d.id}','${startLocal}','${endLocal}','${d.branch}')">✏️</button>
            <button class="btn btn-sm btn-danger"
              onclick="doDeleteDuty('${d.id}')">🗑</button>
          </div>
        </div>
        <div class="hi-sub">${fmtDT(d.start_time)} → ${fmtDT(d.end_time)}</div>
      </div>`;
    }).join('')}
  </div>`;
  wireDutyShift('sel-branch');
}
async function doLogDuty() {
  const start=document.getElementById('duty-start')?.value;
  const end=document.getElementById('duty-end')?.value;
  const branch=getBranch();
  if (!start||!end) return toast('Введите время','error');
  if (start>=end) return toast('Конец позже начала','error');
  if (!branch) return toast('Выберите филиал','error');
  const h=hoursFromDuty(new Date(start),new Date(end));
  if (h>16) return toast('Не более 16 часов','error');
  try {
    await sb().from('duties').insert({
      trainer_id:STATE.profile.id,branch,
      start_time:new Date(start).toISOString(),
      end_time:new Date(end).toISOString(),
    });
    toast(`✅ ${h.toFixed(1)}ч = ${fmt(Math.round(h*RATES.duty_per_hour))} сум`,'success');
    renderDutyTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ПОЗДНИЕ ТРЕНИРОВКИ (>72ч) ─────────────────
async function renderLateRequestModal() {
  const clients = (await DB.getClients(STATE.profile.id)).filter(c=>!c.is_archived);
  if (!clients.length) return toast('Нет клиентов','error');
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header">
      <h3>⏰ Запрос на позднюю тренировку</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
    </div>
    <div style="background:rgba(245,158,11,.1);border:1px solid rgba(245,158,11,.3);border-radius:8px;padding:10px;margin-bottom:14px;font-size:13px;color:var(--text)">
      Тренировка будет внесена только после одобрения координатора или старшего тренера
    </div>
    <div class="form-group"><label>Клиент</label>
      <select id="lr-client">
        <option value="">— выберите —</option>
        ${clients.map(c=>`<option value="${c.id}" data-cat="${c.category}">${c.fio} (кат.${c.category}, баланс:${c.balance})</option>`).join('')}
      </select></div>
    <div class="form-group"><label>Дата и время тренировки</label>
      <input type="datetime-local" id="lr-date"></div>
    <div class="form-group"><label>Причина <span style="color:var(--danger)">*</span></label>
      <textarea id="lr-reason" rows="3" placeholder="Объясните почему тренировка не была внесена вовремя..." style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px;resize:none"></textarea></div>
    <button class="btn btn-primary btn-full" onclick="doSendLateRequest()">Отправить запрос</button>
  </div>`;
  document.body.appendChild(m);
}

async function doSendLateRequest() {
  const clientId = document.getElementById('lr-client')?.value;
  const dateVal  = document.getElementById('lr-date')?.value;
  const reason   = document.getElementById('lr-reason')?.value.trim();
  const clientOpt= document.getElementById('lr-client');
  const cat      = parseInt(clientOpt?.options[clientOpt.selectedIndex]?.dataset.cat||'1');
  const branch   = getBranch();
  if (!clientId) return toast('Выберите клиента','error');
  if (!dateVal)  return toast('Укажите дату тренировки','error');
  if (!reason)   return toast('Напишите причину','error');
  if (!branch)   return toast('Выберите филиал','error');
  // Проверяем что дата действительно старше лимита (72ч) — иначе вносится обычным способом
  if (Date.now() - new Date(dateVal).getTime() < MAX_BACKDATE_HOURS*3600000)
    return toast(`Дата должна быть старше ${MAX_BACKDATE_HOURS} часов. Обычные тренировки вносите стандартным способом.`,'error');
  try {
    await DB.addLateRequest(STATE.profile.id, clientId, branch, new Date(dateVal).toISOString(), cat, reason);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Запрос отправлен координатору','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Одобрение / отклонение (для координатора и старшего тренера)
async function doApproveLateRequest(id) {
  if (!confirm('Одобрить тренировку и списать с баланса клиента?')) return;
  try {
    await DB.approveLateRequest(id, STATE.profile.id);
    toast('✅ Тренировка добавлена','success');
    renderAdminControl(true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doRejectLateRequest(id) {
  const note = prompt('Причина отказа (опционально):');
  if (note === null) return; // отмена
  try {
    await DB.rejectLateRequest(id, STATE.profile.id, note);
    toast('Запрос отклонён','success');
    renderAdminControl(true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doApproveLateRequestSenior(id) {
  if (!confirm('Одобрить тренировку и списать с баланса клиента?')) return;
  try {
    await DB.approveLateRequest(id, STATE.profile.id);
    toast('✅ Тренировка добавлена','success');
    renderSeniorAnalytics();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doRejectLateRequestSenior(id) {
  const note = prompt('Причина отказа (опционально):');
  if (note === null) return;
  try {
    await DB.rejectLateRequest(id, STATE.profile.id, note);
    toast('Запрос отклонён','success');
    renderSeniorAnalytics();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
// Карточка запроса на пересчёт категории (общая для панелей старшего и координатора)
function catRecalcCardHtml(r, after) {
  const scopeLbl = r.scope==='all' ? 'все тренировки' : 'текущий месяц';
  return `<div class="staff-card" style="flex-direction:column;gap:8px;border-left:3px solid #8b5cf6">
    <div>
      <div class="staff-fio">🔄 ${r.clients?.fio||r.client_fio||'?'} · Кат.${r.clients?.category||'?'} → <b>Кат.${r.new_category}</b></div>
      <div class="staff-meta">${r.profiles?.fio||'?'} · ${r.branch||''}</div>
      <div class="staff-meta">Пересчёт: ${scopeLbl}</div>
    </div>
    <div style="display:flex;gap:8px">
      <button class="btn btn-sm btn-primary" style="flex:1" onclick="doApproveCatRecalc(${r.id},'${after}')">✓ Одобрить</button>
      <button class="btn btn-sm btn-danger" style="flex:1" onclick="doRejectCatRecalc(${r.id},'${after}')">✗ Отклонить</button>
    </div>
  </div>`;
}
// Одобрение/отказ запросов на пересчёт категории. after — что перерисовать.
async function doApproveCatRecalc(id, after) {
  if (_pending.has('catr_'+id)) return;
  if (!confirm('Одобрить пересчёт категории прошлых тренировок? ЗП за них пересчитается.')) return;
  _pending.add('catr_'+id);
  try {
    const n = await DB.approveCategoryRecalcRequest(id, STATE.profile.id);
    toast(`✅ Пересчитано тренировок: ${n}`,'success');
    if (after==='senior') renderSeniorAnalytics(); else renderAdminControl(true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('catr_'+id); }
}
async function doRejectCatRecalc(id, after) {
  const note = prompt('Причина отказа (опционально):');
  if (note === null) return;
  try {
    await DB.rejectCategoryRecalcRequest(id, STATE.profile.id, note);
    toast('Запрос отклонён','success');
    if (after==='senior') renderSeniorAnalytics(); else renderAdminControl(true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ПРОБНЫЕ ТРЕНИРОВКИ ────────────────────────
function renderTrialSessionModal() {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header">
      <h3>🆕 Пробная тренировка</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
    </div>
    <p class="hint" style="margin-bottom:12px">ЗП начисляется как за разовое посещение</p>
    <div class="form-group"><label>Имя <span style="color:var(--danger)">*</span></label>
      <input id="tr-fname" type="text" placeholder="Анна"></div>
    <div class="form-group"><label>Фамилия</label>
      <input id="tr-lname" type="text" placeholder="Иванова"></div>
    <div class="form-group"><label>Телефон</label>
      <input id="tr-phone" type="tel" placeholder="+998 90 000 00 00"></div>
    <div class="form-group"><label>Возраст</label>
      <input id="tr-age" type="number" min="3" max="99" placeholder="—"></div>
    <div class="form-group"><label>Категория <span style="color:var(--danger)">*</span></label>
      <div class="cat-picker">
        ${[1,2,3].map(n=>`<button class="cat-btn ${n===1?'active':''}" data-cat="${n}"
          onclick="selectCat(this)">Кат.${n}<br><small>${fmt(RATES.pt[n])} сум</small></button>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doAddTrialSession()">Записать</button>
  </div>`;
  document.body.appendChild(m);
}

async function doAddTrialSession() {
  const fname = document.getElementById('tr-fname')?.value.trim();
  const lname = document.getElementById('tr-lname')?.value.trim();
  const phone = document.getElementById('tr-phone')?.value.trim();
  const age   = parseInt(document.getElementById('tr-age')?.value)||null;
  const cat   = parseInt(document.querySelector('.cat-btn.active')?.dataset.cat||'1');
  const branch = getBranch();
  if (!fname) return toast('Введите имя','error');
  if (!branch) return toast('Выберите филиал','error');
  try {
    await DB.addTrialSession(STATE.profile.id, branch, fname, lname, phone, age, cat);
    document.querySelector('.modal-overlay')?.remove();
    toast(`✅ Пробная записана — ${fname}${lname?' '+lname:''}  · ${fmt(RATES.pt[cat])} сум`,'success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function renderEditDutyModal(dutyId, start, end, branch) {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать дежурство</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label>
        <input type="datetime-local" id="ed-start" value="${start}"></div>
      <div style="flex:1"><label>Конец</label>
        <input type="datetime-local" id="ed-end" value="${end}"></div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doEditDuty('${dutyId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditDuty(dutyId) {
  const start = document.getElementById('ed-start')?.value;
  const end   = document.getElementById('ed-end')?.value;
  if (!start||!end||start>=end) return toast('Проверьте время','error');
  const h = hoursFromDuty(new Date(start),new Date(end));
  if (h>16) return toast('Не более 16 часов','error');
  try {
    await sb().from('duties').update({
      start_time:new Date(start).toISOString(),
      end_time:new Date(end).toISOString(),
    }).eq('id',dutyId);
    document.querySelector('.modal-overlay')?.remove();
    toast(`✅ ${h.toFixed(1)}ч сохранено`,'success');
    renderDutyTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteDuty(dutyId) {
  if (!confirm('Удалить дежурство?')) return;
  try {
    await sb().from('duties').delete().eq('id',dutyId);
    toast('Удалено','success'); renderDutyTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ТАБ: СОБЫТИЯ ──────────────────────────────
// ============================================================
// SECTION: TRAINER:EVENTS — renderEventsTab
// ============================================================
async function renderEventsTab() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const branch=STATE.profile.branches?.[0]||null;
    const events=await DB.getUpcomingEvents(branch);
    const canCreate=['admin','senior_trainer'].includes(STATE.profile.role);
    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header"><h3>События</h3>
        ${canCreate?`<button class="btn btn-sm" onclick="renderCreateEventModal()">+ Событие</button>`:''}
      </div>
      ${!events.length?'<div class="empty-state">📭<p>Предстоящих событий нет</p></div>':
        events.map(ev=>renderEventCard(ev)).join('')}
    </div>`;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderEventCard(ev) {
  const isParticipant=ev.event_participants?.some(p=>p.trainer_id===STATE.profile.id);
  const count=ev.event_participants?.length||0;
  const canCreate=['admin','senior_trainer'].includes(STATE.profile.role);
  return `<div class="event-card ${ev.blocks_pool?'event-blocking':''}">
    <div class="event-type-badge">${EVENT_TYPES[ev.event_type]||'📌 Другое'}</div>
    <div class="event-title">${ev.title}</div>
    <div class="event-meta">📍 ${ev.location||'—'} · ${ev.branch||'Все филиалы'}</div>
    <div class="event-meta">🕐 ${fmtDT(ev.start_time)} → ${fmtDT(ev.end_time)}</div>
    ${ev.description?`<div class="event-desc">${ev.description}</div>`:''}
    ${ev.blocks_pool?'<div class="event-block-warn">🚫 Бассейн закрыт в это время</div>':''}
    <div class="event-footer">
      <span class="hint">👥 ${count} · ${ev.profiles?.fio?.split(' ')[0]||'?'}</span>
      <div style="display:flex;gap:6px">
        ${isParticipant
          ?`<button class="btn btn-sm btn-danger" onclick="doLeaveEvent('${ev.id}')">Не иду</button>`
          :`<button class="btn btn-sm btn-primary" onclick="doJoinEvent('${ev.id}')">Иду ✓</button>`}
        ${canCreate?`<button class="btn btn-sm btn-danger" onclick="doDeleteEvent('${ev.id}')">🗑</button>`:''}
      </div>
    </div>
  </div>`;
}
async function doJoinEvent(id)  { try { await DB.joinEvent(id,STATE.profile.id);  toast('✅ Записаны','success'); renderEventsTab(); } catch(e){console.error(e);toast('Ошибка','error');} }
async function doLeaveEvent(id) { try { await DB.leaveEvent(id,STATE.profile.id); toast('Отменено','success'); renderEventsTab(); } catch(e){console.error(e);toast('Ошибка','error');} }
async function doDeleteEvent(id){ if(!confirm('Удалить событие?'))return; try{await DB.deleteEvent(id);toast('Удалено','success');renderEventsTab();}catch(e){console.error(e);toast('Ошибка','error');} }

function renderCreateEventModal() {
  const branches=STATE.profile.branches||[];
  const now=new Date().toISOString().slice(0,16);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новое событие</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label><input id="ev-title" placeholder="Соревнования"></div>
    <div class="form-group"><label>Тип</label>
      <select id="ev-type">
        <option value="competition">🏆 Соревнование</option>
        <option value="qualification">📚 Квалификация</option>
        <option value="repair">🔧 Ремонт</option>
        <option value="other">📌 Другое</option>
      </select></div>
    <div class="form-group"><label>Описание</label><textarea id="ev-desc" rows="2"></textarea></div>
    <div class="form-group"><label>Место</label><input id="ev-location"></div>
    <div class="form-group"><label>Филиал</label>
      <select id="ev-branch"><option value="">Все филиалы</option>
        ${branches.map(b=>`<option>${b}</option>`).join('')}
      </select></div>
    <div class="form-group" style="display:flex;gap:10px">
      <div style="flex:1"><label>Начало</label><input type="datetime-local" id="ev-start" value="${now}"></div>
      <div style="flex:1"><label>Конец</label><input type="datetime-local" id="ev-end" value="${now}"></div>
    </div>
    <label class="toggle-row" style="margin-bottom:16px">
      <input type="checkbox" id="ev-blocks">
      <span class="toggle-track"><span class="toggle-thumb"></span></span>
      <span>Бассейн закрыт (блокирует)</span>
    </label>
    <button class="btn btn-primary btn-full" onclick="doCreateEvent()">Создать</button>
  </div>`;
  document.body.appendChild(m);
}
async function doCreateEvent() {
  const title=document.getElementById('ev-title')?.value.trim();
  const type=document.getElementById('ev-type')?.value;
  const desc=document.getElementById('ev-desc')?.value.trim();
  const location=document.getElementById('ev-location')?.value.trim();
  const branch=document.getElementById('ev-branch')?.value||null;
  const start=document.getElementById('ev-start')?.value;
  const end=document.getElementById('ev-end')?.value;
  const blocks=document.getElementById('ev-blocks')?.checked||false;
  if (!title) return toast('Введите название','error');
  if (!start||!end||start>=end) return toast('Проверьте время','error');
  try {
    await DB.createEvent({title,event_type:type,description:desc||null,
      location:location||null,branch,blocks_pool:blocks,
      start_time:new Date(start).toISOString(),end_time:new Date(end).toISOString(),
      created_by:STATE.profile.id});
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Событие создано','success'); renderEventsTab();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
