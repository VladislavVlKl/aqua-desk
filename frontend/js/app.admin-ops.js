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

