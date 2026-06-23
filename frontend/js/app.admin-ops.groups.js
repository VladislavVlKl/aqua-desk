// =============================================
// app.admin-ops.js — координатор: операционка (Этап 3)
// Секции: ADMIN:GROUPS / CONTROL / TECH
// Грузится СТРОГО после app.admin.js (top-level window._glInstances; порядок сохранён).
// =============================================

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
    const ok = await DB.approveSubstitution(subId, rate);
    if (!ok) { toast('Уже подтверждено','info'); return; }
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
