// ============================================================
// SECTION: SENIOR:GROUPS — renderSeniorGroups, renderGroupDetail, renderSeniorAssignForm
// ============================================================
async function renderSeniorGroups() {
  const isSenior = STATE.profile.role === 'senior_trainer';
  const branches = STATE.profile.branches||[];
  const monthStr = new Date().toISOString().slice(0,7)+'-01';
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Группы</h3>
      <div style="display:flex;gap:6px">
        ${isSenior?`<button class="btn btn-sm" onclick="renderSubstitutionsApproval()">🔄 Замены</button>`:''}
        ${isSenior?`<button class="btn btn-sm" style="background:rgba(16,185,129,.15);color:#059669" onclick="doExportBranchChildGroups('${monthStr}',${JSON.stringify(branches)})">⬇️ Дет.ГП</button>`:''}
      </div>
    </div>
    ${isSenior?'<div id="pending-subs"></div>':''}
    <h4 style="margin-bottom:8px">Мои группы</h4>
    <div id="groups-list"><div class="center-screen"><div class="spinner"></div></div></div>
    ${isSenior?`<h4 style="margin-top:20px;margin-bottom:8px">Назначить тренера в своём филиале</h4>
    <div id="senior-assign-form"></div>`:''}
  </div>`;
  await loadSeniorGroupsList();
  if (isSenior) {
    await renderPendingSubstitutions();
    await renderSeniorAssignForm();
    // Загружаем доп.доступ и показываем группы других филиалов
    await loadExtraBranchGroups();
  }
}

async function loadExtraBranchGroups() {
  try {
    const extraBranches = await DB.getBranchAccess(STATE.profile.id);
    if (!extraBranches.length) return;
    const body = document.getElementById('tab-content');
    const existingExtra = document.getElementById('extra-branch-groups');
    if (existingExtra) existingExtra.remove();
    const div = el('div','');
    div.id = 'extra-branch-groups';
    div.style.cssText = 'padding:0 16px 16px';
    div.innerHTML = `<h4 style="margin-bottom:8px">Дополнительные филиалы</h4>`;
    for (const branch of extraBranches) {
      const {data:tgs} = await sb().from('trainer_groups')
        .select('*, group_types(name,type), profiles(fio)')
        .eq('branch',branch).is('subscription_end',null);
      const monthStr = new Date().toISOString().slice(0,7)+'-01';
      div.innerHTML += `<div style="margin-bottom:12px">
        <div style="font-weight:600;font-size:13px;color:var(--hint);margin-bottom:6px">${branch}</div>
        ${(tgs||[]).map(tg=>`<div class="staff-card" style="flex-direction:column;align-items:flex-start;gap:6px">
          <div style="display:flex;justify-content:space-between;width:100%">
            <div>
              <div class="staff-fio">${tg.group_types?.name||'Группа'}</div>
              <div class="staff-meta">${tg.profiles?.fio||'—'}</div>
            </div>
            <div style="display:flex;gap:6px">
              ${tg.group_types?.type==='children'?`<button class="btn btn-sm btn-primary"
                onclick="openGroupReport('${tg.id}','${monthStr}','list')">📊 Отчёт</button>`:''}
            </div>
          </div>
        </div>`).join('')||'<p class="hint">Нет групп</p>'}
      </div>`;
    }
    body.querySelector('.tab-pad')?.appendChild(div);
  } catch(e) { console.error(e); }
}

// Защита от назначения группы на «мёртвый» профиль (дубль / не привязан к Telegram).
// Нормализация ФИО без учёта порядка слов: «Сафина Джураева» == «Джураева Сафина».
function _normFio(s) { return (s||'').trim().toLowerCase().replace(/\s+/g,' ').split(' ').sort().join(' '); }
// Строит <option>'ы тренеров с пометками: «⚠️ не в Telegram» и «дубль?».
function _trainerOptionsWithFlags(trainers) {
  const counts = {};
  trainers.forEach(t => { const k=_normFio(t.fio); counts[k]=(counts[k]||0)+1; });
  return trainers.map(t => {
    const flags = [];
    if (!t.tg_id) flags.push('⚠️ не в Telegram');
    if (counts[_normFio(t.fio)] > 1) flags.push('дубль?');
    const suffix = flags.length ? ` — ${flags.join(', ')}` : '';
    return `<option value="${t.id}" data-unclaimed="${t.tg_id?'':'1'}">${t.fio}${suffix}</option>`;
  }).join('');
}
// Подтверждение, если выбран непривязанный профиль (тренер не увидит группу).
function _confirmUnclaimedTrainer(selectId) {
  const opt = document.querySelector(`#${selectId} option:checked`);
  if (opt?.dataset.unclaimed === '1')
    return confirm('⚠️ Этот профиль не привязан к Telegram — тренер не увидит группу (возможно, это дубль профиля).\n\nВсё равно назначить?');
  return true;
}

async function renderSeniorAssignForm() {
  const form = document.getElementById('senior-assign-form'); if (!form) return;
  try {
    const branches = STATE.profile.branches||[];
    const [allTrainers, allSeniors, gts, activeGroupsArr] = await Promise.all([
      DB.getProfilesByRole('trainer'),
      DB.getProfilesByRole('senior_trainer'),
      DB.getGroupTypes(),
      Promise.all(branches.map(b=>DB.getActiveGroupsByBranch(b))),
    ]);
    const myTrainers = [...allTrainers, ...allSeniors].filter(t=>
      !t.is_archived && (t.branches||[]).some(b=>branches.includes(b))
    );
    // Конкретные активные группы филиалов старшего (строки trainer_groups)
    const activeGroups = activeGroupsArr.flat();
    window._saGroups = Object.fromEntries(activeGroups.map(g=>[String(g.id), g]));
    const groupOpts = activeGroups.map(g=>{
      const label = `${g.group_types?.name||'Группа'} · ${g.branch}${g.profiles?.fio?' — '+g.profiles.fio:''}${g.role?' ('+g.role+')':''}`;
      return `<option value="${g.id}" data-type="${g.group_types?.type||''}">${label}</option>`;
    }).join('');
    const trainerOpts = `<option value="">— выберите —</option>${_trainerOptionsWithFlags(myTrainers)}`;
    const gtOpts = gts.map(g=>`<option value="${g.id}" data-type="${g.type}" data-name="${g.name}">${g.name}</option>`).join('');
    const branchOpts = branches.map(b=>`<option>${b}</option>`).join('');

    form.innerHTML=`
      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px;margin-bottom:16px">
        <div style="font-weight:600;font-size:13px;margin-bottom:12px">Новое назначение</div>
        <div class="form-group"><label>Тренер</label>
          <select id="sa-trainer">${trainerOpts}</select></div>
        <div class="form-group"><label>Тип группы</label>
          <select id="sa-type" onchange="onSaTypeChange(this)">${gtOpts}</select></div>
        <div class="form-group"><label>Филиал</label>
          <select id="sa-branch">${branchOpts}</select></div>
        <div id="sa-rate-section">
          <div class="form-group"><label>Процент тренеру (%)</label>
            <input id="sa-rate" type="number" value="40" min="0" max="100"></div>
        </div>
        <div id="sa-adult-note" style="display:none;background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint);margin-bottom:12px">
          ✅ Ставка по явке: 1-3 чел = 110к · 4-6 = 120к · 7+ = 130к
        </div>
        <button class="btn btn-primary btn-full" onclick="doSeniorAssignGroup()">Назначить</button>
      </div>

      <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px">
        <div style="font-weight:600;font-size:13px;margin-bottom:12px">Добавить второго тренера</div>
        <div class="form-group"><label>Группа (в вашем филиале)</label>
          <select id="sa2-group" onchange="onSa2GroupChange(this)">
            <option value="">— выберите —</option>
            ${groupOpts}
          </select></div>
        <div class="form-group"><label>Второй тренер</label>
          <select id="sa2-trainer">${trainerOpts}</select></div>
        <div id="sa2-rate-section">
          <div class="form-group"><label id="sa2-rate-label">Ставка за занятие (сум)</label>
            <input id="sa2-rate" type="number" value="75000" min="0"></div>
        </div>
        <div id="sa2-adult-note" style="display:none;background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint);margin-bottom:12px">
          ✅ Взрослая группа: ставка по явке (1-3=110к · 4-6=120к · 7+=130к)
        </div>
        <button class="btn btn-primary btn-full" onclick="doSeniorAssignSecond()">Добавить второго тренера</button>
      </div>`;

    // Init type change
    const sel = document.getElementById('sa-type');
    if (sel) onSaTypeChange(sel);
  } catch(e) { form.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

function onSaTypeChange(sel) {
  const opt = sel.options[sel.selectedIndex];
  const isAdult = opt?.dataset.type === 'adult';
  const rateSection = document.getElementById('sa-rate-section');
  const adultNote   = document.getElementById('sa-adult-note');
  if (rateSection) rateSection.style.display = isAdult ? 'none' : '';
  if (adultNote)   adultNote.style.display   = isAdult ? '' : 'none';
}

async function doSeniorAssignGroup() {
  const trainerId   = parseInt(document.getElementById('sa-trainer')?.value);
  const groupTypeId = parseInt(document.getElementById('sa-type')?.value);
  const branch      = document.getElementById('sa-branch')?.value;
  const opt         = document.querySelector('#sa-type option:checked');
  const groupName   = opt?.textContent||'';
  const isAdult     = opt?.dataset.type === 'adult';
  const rateType    = isAdult ? 'headcount' : 'percent';
  const rateValue   = isAdult ? 0 : (parseFloat(document.getElementById('sa-rate')?.value)||40);
  if (!trainerId||!groupTypeId||!branch) return toast('Заполните все поля','error');
  if (!_confirmUnclaimedTrainer('sa-trainer')) return;
  try {
    await DB.addTrainerGroup(trainerId, groupTypeId, branch, todayStr(), rateType, rateValue, null);
    DB.auditLog('group_assign', STATE.profile.id, STATE.profile.fio, trainerId, 'trainer_group',
      { group: groupName, trainer_id: trainerId }, branch);
    toast('✅ Назначено','success');
    await loadSeniorGroupsList();
    await renderSeniorAssignForm();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function onSa2GroupChange(sel) {
  const isAdult = sel.options[sel.selectedIndex]?.dataset.type === 'adult';
  const rateSection = document.getElementById('sa2-rate-section');
  const adultNote   = document.getElementById('sa2-adult-note');
  if (rateSection) rateSection.style.display = isAdult ? 'none' : '';
  if (adultNote)   adultNote.style.display   = isAdult ? '' : 'none';
}
async function doSeniorAssignSecond() {
  const groupId   = document.getElementById('sa2-group')?.value;
  const trainerId = parseInt(document.getElementById('sa2-trainer')?.value);
  if (!groupId||!trainerId) return toast('Выберите группу и тренера','error');
  if (!_confirmUnclaimedTrainer('sa2-trainer')) return;
  // Берём параметры у выбранной КОНКРЕТНОЙ группы — как в админском doAddSecondTrainer
  const g = window._saGroups?.[String(groupId)];
  if (!g) return toast('Группа не найдена, обновите страницу','error');
  const groupTypeId = g.group_type_id;
  const branch      = g.branch;
  const instanceId  = g.group_instance_id || null;
  const isAdult     = g.group_types?.type === 'adult';
  const rateType    = isAdult ? 'headcount' : 'flat';
  const rateValue   = isAdult ? 0 : (parseFloat(document.getElementById('sa2-rate')?.value)||75000);
  if (_pending.has(`sa2_${groupId}_${trainerId}`)) return;
  _pending.add(`sa2_${groupId}_${trainerId}`);
  try {
    // instanceId передаём в addTrainerGroup → второй тренер встаёт в ту же физическую группу
    await DB.addTrainerGroup(trainerId, groupTypeId, branch, todayStr(), rateType, rateValue, null, instanceId);
    DB.auditLog('group_assign_second', STATE.profile.id, STATE.profile.fio, trainerId, 'trainer_group',
      { group_id: groupId, instance: instanceId }, branch);
    toast('✅ Второй тренер добавлен','success');
    await loadSeniorGroupsList();
    await renderSeniorAssignForm();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(`sa2_${groupId}_${trainerId}`); }
}

// Цветная точка роли (суша=жёлтый, вода=синий, суша+вода=градиент)
function _groupRoleDot(role) {
  if (role==='суша')      return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#eab308;margin-right:4px;vertical-align:middle"></span>';
  if (role==='вода')      return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:#3b82f6;margin-right:4px;vertical-align:middle"></span>';
  if (role==='суша+вода') return '<span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:linear-gradient(90deg,#eab308 50%,#3b82f6 50%);margin-right:4px;vertical-align:middle"></span>';
  return '';
}

async function loadSeniorGroupsList() {
  const body=document.getElementById('groups-list'); if (!body) return;
  try {
    const groups = await DB.getTrainerGroups(STATE.profile.id);
    if (!groups.length) { body.innerHTML='<p class="hint">Нет назначенных групп</p>'; return; }
    const canEdit = ['admin','senior_trainer'].includes(STATE.profile.role);

    // Детские группы схлопываем по group_instance_id — одна карточка на физгруппу.
    // Роли (вода/суша) и расписание живут внутри хаба. Взрослые остаются как были.
    const children = groups.filter(g=>g.group_types?.type==='children');
    const adults   = groups.filter(g=>g.group_types?.type!=='children');

    const byInstance = {};
    children.forEach(g=>{ const k = g.group_instance_id || `solo_${g.id}`; (byInstance[k] ||= []).push(g); });

    const childCards = Object.values(byInstance).map(rows=>{
      const rep = rows[0];
      // Все роли тренера в этой физгруппе (вода + суша → две строки)
      const roles = [...new Set(rows.map(r=>r.role).filter(Boolean))];
      const dots  = roles.map(_groupRoleDot).join('');
      const roleLabel = roles.length ? ` (${roles.join(' + ')})` : '';
      // Расписание: показываем строки, у которых оно задано; иначе предупреждение
      const sched = rows.filter(r=>r.days_of_week?.length)
        .map(r=>`${r.days_of_week.join('/')}${r.session_time?' '+r.session_time:''}`);
      const schedLabel = sched.length
        ? `<span style="font-size:11px;background:rgba(124,58,237,.15);color:#a78bfa;padding:2px 8px;border-radius:6px;margin-top:4px;display:inline-block">${[...new Set(sched)].join(' · ')}</span>`
        : `<span style="font-size:11px;color:var(--hint);margin-top:4px;display:inline-block">⚠️ Расписание не задано — задайте внутри</span>`;
      return `<div class="staff-card" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div style="display:flex;justify-content:space-between;width:100%">
          <div>
            <div class="staff-fio">${dots}${rep.group_types?.name||'Группа'}${roleLabel}</div>
            <div class="staff-meta">${rep.branch} · с ${rep.subscription_start||'—'}</div>
            ${schedLabel}
          </div>
          <button class="btn btn-sm btn-primary" style="align-self:flex-start"
            onclick="renderGroupDetail('${rep.id}')">Открыть</button>
        </div>
      </div>`;
    });

    const adultCards = adults.map(g=>{
      const schedLabel = g.days_of_week?.length
        ? `<span style="font-size:11px;background:rgba(124,58,237,.15);color:#a78bfa;padding:2px 8px;border-radius:6px;margin-top:4px;display:inline-block">
            ${g.days_of_week.join('/')}${g.session_time?' '+g.session_time:''}</span>`
        : `<span style="font-size:11px;color:var(--hint);margin-top:4px;display:inline-block">⚠️ Расписание не задано</span>`;
      return `<div class="staff-card" style="flex-direction:column;align-items:flex-start;gap:8px">
        <div style="display:flex;justify-content:space-between;width:100%">
          <div>
            <div class="staff-fio">${g.group_types?.name||'Группа'}</div>
            <div class="staff-meta">${g.branch} · с ${g.subscription_start||'—'}</div>
            ${schedLabel}
          </div>
          <button class="btn btn-sm btn-primary" style="align-self:flex-start"
            onclick="renderAdultGroupDetail('${g.id}')">Открыть</button>
        </div>
      </div>`;
    });

    body.innerHTML = [...childCards, ...adultCards].join('');
  } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// «Персонал» из списка групп старшего (Блок H): собираем instance-объект из его данных
// и кладём в window._glInstances в формате, совместимом с openGroupPersonnel координатора
async function openSeniorGroupPersonnel(tgId) {
  try {
    const groups = await DB.getTrainerGroups(STATE.profile.id);
    const g = groups.find(x=>String(x.id)===String(tgId));
    if (!g) return toast('Группа не найдена','error');
    const members = g.group_instance_id
      ? await DB.getGroupInstanceMembers(g.group_instance_id)
      : [{...g, profiles:{fio: STATE.profile.fio}}];
    const key = g.group_instance_id || `solo_${g.id}`;
    window._glInstances = window._glInstances || {};
    window._glInstances[key] = {
      gt: { id: g.group_type_id, name: g.group_types?.name||'Группа', type: g.group_types?.type||'children' },
      branch: g.branch, trainers: members, key,
    };
    openGroupPersonnel(key, new Date().toISOString().slice(0,7)+'-01');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Уровни детей в группе (справочник UI)
const GROUP_LEVELS = ['Подготовительный','Обучающий','Совершенствование','Спортивный'];
// Станции занятия (кто где был). «процент» убран из UI — процентникам ЗП идёт
// от пула независимо от присутствия (calcChildGroupPayroll). Старые 'процент'-записи
// в истории отображаются как есть, но новые не создаём.
const CONDUCTED_ROLES = ['суша','вода'];
const STATION_META = { 'суша': {icon:'☀️', dot:'#eab308'}, 'вода': {icon:'🌊', dot:'#3b82f6'} };

// ═══ ОБЩИЕ ВИЗУАЛЬНЫЕ ХЕЛПЕРЫ ХАБА ГРУППЫ (детские + взрослые — единый стиль) ═══
const groupHubInfoRow = (label, val) => `<div style="display:flex;justify-content:space-between;align-items:center">
  <span style="color:var(--hint);font-size:13px">${label}</span>${val}</div>`;
const groupHubSection = t => `<div style="font-size:12px;font-weight:600;color:var(--hint);text-transform:uppercase;letter-spacing:.4px;margin:6px 2px 2px">${t}</div>`;
const groupHubBigBtn = (icon, title, sub, onclick) => `
  <button class="staff-card" style="width:100%;cursor:pointer;text-align:left;display:flex;align-items:center;gap:12px;border:1px solid var(--border);background:var(--card)"
    onclick="${onclick}">
    <span style="font-size:22px">${icon}</span>
    <span style="flex:1;min-width:0">
      <span style="display:block;font-size:15px;font-weight:600;color:var(--text)">${title}</span>
      ${sub?`<span style="display:block;font-size:12px;color:var(--hint);margin-top:2px">${sub}</span>`:''}
    </span>
    <span style="color:var(--hint)">›</span>
  </button>`;
// Отображаемое имя подгруппы: '' = главная (метка mainLabel, напр. '15:00', иначе «Основная»)
function subLabel(s) { return s ? s : (window._gd?.mainLabel || 'Основная'); }

// ═══ ЭКРАН ГРУППЫ — ХАБ ═══
// Главный экран = шапка (филиал/дети/тренеры/должники) + крупные кнопки-входы.
// Каждое окно (занятие/дети/история) — отдельный экран через setScreen, назад — к хабу.
// Хаб ВСЕГДА переустанавливает точку возврата на вкладку «Группы» своей роли,
// поэтому внутренние экраны не затирают навигацию.
async function renderGroupDetail(groupId) {
  const role = curRole();
  const canPayroll = ['admin','senior_trainer'].includes(role);
  const _backToGroups = role==='admin'||role==='ceo'
    ? ()=>{ renderAdminApp('groups'); }
    : role==='senior_trainer'
    ? ()=>{ renderSeniorApp('groups'); }
    : ()=>{ renderTrainerShell('groups'); };
  navPush(_backToGroups);
  setupBack(_backToGroups);
  const month = new Date().toISOString().slice(0,7)+'-01';
  const today = todayStr();
  loading('Загрузка группы...');
  try {
    // Тип группы — взрослые уводим в отдельный обработчик
    const {data:groupInfo} = await sb().from('trainer_groups')
      .select('*, group_types(name,type)').eq('id',groupId).single();
    if (groupInfo?.group_types?.type !== 'children') {
      renderAdultGroupDetail(groupId); return;
    }
    const instanceId = groupInfo.group_instance_id;
    const branch = groupInfo.branch;
    const groupTypeId = groupInfo.group_type_id;
    const [clients, payments, members, subgData] = await Promise.all([
      instanceId ? DB.getGroupClientsByInstance(instanceId) : DB.getGroupClients(groupId),
      instanceId ? DB.getGroupPaymentsByInstance(instanceId, month) : DB.getGroupPayments(groupId, month),
      instanceId ? DB.getGroupInstanceMembers(instanceId) : Promise.resolve([groupInfo]),
      DB.getGroupSubgroups(instanceId, groupId),
    ]);
    const dbSubgroups = subgData.names||[];
    const paidMap = Object.fromEntries(payments.map(p=>[p.group_client_id, p]));
    const debtors = clients.filter(c=>!paidMap[c.id]?.paid);

    // Подгруппы: персистентные (group_subgroups) ∪ те, в которые уже переведены дети
    const subgroups = [...new Set([...dbSubgroups, ...clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
    const prevSub = (window._gd && String(window._gd.groupId)===String(groupId)) ? (window._gd.currentSubgroup||'') : '';

    // Кешируем контекст для onclick-обработчиков (без JSON в атрибутах)
    window._gd = { groupId, instanceId, branch, groupTypeId, month, today,
                   members, clients, paidMap, noteMap:{}, canPayroll, role,
                   groupName: groupInfo.group_types?.name||'Группа',
                   subgroups, dbSubgroups, mainLabel: subgData.mainLabel||null,
                   currentSubgroup: subgroups.includes(prevSub) ? prevSub : '',
                   conductedMap: {}, attMap: {}, _screen: 'hub' };

    const infoRow = groupHubInfoRow;
    const bigBtn = groupHubBigBtn;

    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">${window._gd.groupName}</div>
      <span style="font-size:12px;color:var(--hint)">${branch}</span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="staff-card" style="flex-direction:column;align-items:stretch;gap:8px;margin-bottom:14px">
        ${infoRow('Филиал', `<span style="font-weight:600;font-size:13px">${branch}</span>`)}
        ${infoRow('Детей', `<span style="font-weight:600;font-size:13px">${clients.length}${subgroups.length?` · подгрупп: ${subgroups.length+1}`:''}</span>`)}
        ${infoRow('Тренеров', `<span style="font-weight:600;font-size:13px">${new Set(members.map(t=>t.trainer_id)).size}</span>`)}
        ${infoRow('Должники', debtors.length
          ? `<button class="btn btn-sm" style="background:rgba(239,68,68,.12);border:1px solid rgba(239,68,68,.3);color:#ef4444;font-size:12px"
              onclick="renderGroupDebtorsModal(${JSON.stringify(debtors.map(c=>c.name)).replace(/"/g,'&quot;')})">⚠️ ${debtors.length}</button>`
          : `<span style="font-weight:600;font-size:13px;color:#10b981">нет</span>`)}
      </div>
      ${(()=>{
        const grpHdr = t => `<div style="font-size:12px;font-weight:600;color:var(--hint);text-transform:uppercase;letter-spacing:.4px;margin:6px 2px 2px">${t}</div>`;
        return `
        ${grpHdr('Управление')}
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
          ${canPayroll?bigBtn('👥','Персонал','тренеры · ставки · расписание',`openSeniorGroupPersonnel('${groupId}')`):''}
          ${bigBtn('👶',`Список детей (${clients.length})`, subgroups.length?'по подгруппам · оплаты · заметки':'добавление · оплаты · заметки',`renderGroupChildrenScreen('${groupId}')`)}
        </div>

        ${grpHdr('Занятия')}
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
          ${bigBtn('✅','Занятие сегодня',`${fmtDate(today)} · кто на станции`,`renderGroupSessionScreen('${groupId}')`)}
          ${bigBtn('📅','История занятий','по датам · явка · кто проводил',`renderGroupHistoryScreen('${groupId}')`)}
          ${bigBtn('🔄','История замен','прошедшие и текущие замены',`renderGroupSubstitutionsHistory('${groupId}')`)}
        </div>

        ${grpHdr('Финансы и отчёты')}
        <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
          ${bigBtn('📊','Отчёт по детям','посещаемость · оплаты · Excel',`openGroupReport('${groupId}','${month}','detail')`)}
          ${canPayroll?bigBtn('💰','ЗП за месяц','авто-расчёт · премии/штрафы',`openGroupReport('${groupId}','${month}','detail','payroll')`):''}
        </div>

        ${grpHdr('Прочее')}
        <div style="display:flex;flex-direction:column;gap:8px">
          ${bigBtn('📦','Архив детей','вернуть ребёнка в группу',`renderGroupArchiveModal('${groupId}','${instanceId||''}')`)}
        </div>`;
      })()}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Перерисовать ТЕКУЩИЙ экран группы (хаб или внутреннее окно) после записи —
// чтобы действия из меню ребёнка/оплат не выкидывали со «Списка детей» на хаб
function refreshGroupScreen(groupId) {
  const g = window._gd;
  if (!g || String(g.groupId)!==String(groupId)) return renderGroupDetail(groupId);
  if (g._screen==='children') return renderGroupChildrenScreen(groupId);
  if (g._screen==='session')  return renderGroupSessionScreen(groupId);
  if (g._screen==='history')  return renderGroupHistoryScreen(groupId, g.historyMonth);
  if (g._screen==='subgroups') return openSubgroupManager(groupId, g._subgroupFrom);
  return renderGroupDetail(groupId);
}

// Контекст _gd обязателен для внутренних экранов; при прямом входе строим его через хаб
async function ensureGd(groupId) {
  if (window._gd && String(window._gd.groupId)===String(groupId)) return window._gd;
  await renderGroupDetail(groupId);
  return (window._gd && String(window._gd.groupId)===String(groupId)) ? window._gd : null;
}

// ═══ ЭКРАН «ЗАНЯТИЕ СЕГОДНЯ» (отметка детей + кто проводил, в разрезе подгрупп) ═══
async function renderGroupSessionScreen(groupId) {
  const g = await ensureGd(groupId); if (!g) return;
  g._screen = 'session';
  navPush(()=>renderGroupDetail(groupId));
  setupBack(()=>renderGroupDetail(groupId));
  loading('Загрузка занятия...');
  try {
    const [conducted, todayAtt, clients, subgData] = await Promise.all([
      g.instanceId ? DB.getGroupConductedByDate(g.instanceId, g.today) : Promise.resolve([]),
      g.instanceId ? DB.getGroupAttendanceByInstance(g.instanceId, g.today) : DB.getGroupAttendance(g.groupId, g.today),
      g.instanceId ? DB.getGroupClientsByInstance(g.instanceId) : DB.getGroupClients(g.groupId),
      DB.getGroupSubgroups(g.instanceId, g.groupId),
    ]);
    g.clients = clients;
    g.dbSubgroups = subgData.names||[];
    g.mainLabel = subgData.mainLabel||null;
    g.subgroups = [...new Set([...g.dbSubgroups, ...clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
    if (g.currentSubgroup && !g.subgroups.includes(g.currentSubgroup)) g.currentSubgroup = '';
    // Карта «кто проводил»: подгруппа → trainer_id → [роли]
    const cm = {};
    conducted.forEach(s=>{ const sg = s.subgroup||''; ((cm[sg] ||= {})[s.trainer_id] ||= []).push(s.conducted_role); });
    g.conductedMap = cm;
    g.attMap = Object.fromEntries(todayAtt.map(a=>[a.group_client_id, a.attended]));
    renderGroupSessionScreenHtml();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Пилюля тренера на станции (мультивыбор). Активная красится в ЦВЕТ СТАНЦИИ
// (суша=жёлтый, вода=синий) — цвет несёт смысл «отмечен на этой станции».
function _cndPillStyle(active, role) {
  const c = STATION_META[role]?.dot || 'var(--accent)';
  return active
    ? `font-size:13px;padding:7px 14px;border-radius:16px;background:${c};color:#fff;border:1px solid ${c};cursor:pointer;font-weight:600`
    : 'font-size:13px;padding:7px 14px;border-radius:16px;background:var(--card);color:var(--text);border:1px solid var(--border);cursor:pointer';
}
function _cndPill(trainerId, role, fio, active) {
  return `<button class="cnd-chip" id="cnd-${trainerId}-${role}" style="${_cndPillStyle(active, role)}"
    onclick="toggleConducted('${trainerId}','${role}')">${fio}${active?' ✓':''}</button>`;
}
// Уникальные тренеры (один человек может быть в двух строках инстанса: вода + суша)
function _uniqMembers(members) {
  const seen = new Set();
  return (members||[]).filter(t=>{ if (seen.has(t.trainer_id)) return false; seen.add(t.trainer_id); return true; });
}
// Сводка «кто где сегодня» по текущей подгруппе
function _cndSummaryInner(g, sub) {
  const cm = g.conductedMap[sub]||{};
  const uniq = _uniqMembers(g.members);
  const parts = CONDUCTED_ROLES.map(role=>{
    const names = uniq.filter(t=>(cm[t.trainer_id]||[]).includes(role)).map(t=>t.profiles?.fio||'—');
    if (!names.length) return '';
    return `<span style="white-space:nowrap">${STATION_META[role]?.icon||''} ${role[0].toUpperCase()+role.slice(1)} — ${names.join(', ')}</span>`;
  }).filter(Boolean);
  return parts.length ? parts.join(' &nbsp;·&nbsp; ') : '<span style="color:var(--hint)">пока никто не отмечен</span>';
}

function renderGroupSessionScreenHtml() {
  const g = window._gd; if (!g) return;
  const sub = g.currentSubgroup||'';
  const subClients = g.clients.filter(c=>(c.subgroup||'')===sub);
  const headcount = subClients.filter(c=>g.attMap[c.id]).length;
  const cm = g.conductedMap[sub]||{};
  const hasSubs = g.subgroups.length > 0;
  const segHtml = `
    <div style="display:flex;gap:6px;flex-wrap:wrap;align-items:center;margin-bottom:12px">
      ${hasSubs ? ['', ...g.subgroups].map(s=>`<button class="btn btn-sm"
        style="font-size:12px;${s===sub?'background:var(--accent);color:#fff':'background:var(--card);border:1px solid var(--border)'}"
        onclick="switchSessionSubgroup('${encodeURIComponent(s)}')">${subLabel(s)}</button>`).join('') : ''}
      <button class="btn btn-sm" style="font-size:12px;background:var(--card);border:1px solid var(--border)${hasSubs?';margin-left:auto':''}"
        onclick="openSubgroupManager('${g.groupId}','session')">${hasSubs?'👥 Подгруппы':'➕ Подгруппа'}</button>
    </div>`;

  const uniqMembers = _uniqMembers(g.members);
  const stationCards = uniqMembers.length ? CONDUCTED_ROLES.map(role=>{
    const m = STATION_META[role]||{};
    const pills = uniqMembers.map(t=>_cndPill(t.trainer_id, role, t.profiles?.fio||'—', (cm[t.trainer_id]||[]).includes(role))).join('');
    return `<div class="staff-card" style="flex-direction:column;align-items:stretch;gap:10px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${m.dot}"></span>
        ${m.icon||''} ${role[0].toUpperCase()+role.slice(1)}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${pills}</div>
    </div>`;
  }).join('') : '<p class="hint">Тренеры не назначены</p>';

  setScreen(`<div class="app-header">
    ${backBtn()}
    <div class="app-title">Занятие сегодня</div>
    <span style="font-size:12px;color:var(--hint)">${fmtDate(g.today)}</span>
  </div>
  <div class="tab-content"><div class="tab-pad">
    ${segHtml}
    <div class="staff-card" style="flex-direction:column;align-items:stretch;gap:10px;margin-bottom:12px">
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1" onclick="renderGroupAttendance('${g.groupId}')">✅ Отметить детей</button>
        <button class="btn btn-sm" style="background:var(--card);border:1px solid var(--border)"
          onclick="renderGroupSubstitutionModal('${g.groupId}')">🔄 Замена</button>
      </div>
      <div style="font-size:12px;color:var(--hint)">Отмечено сегодня${hasSubs?` (${subLabel(sub)})`:''}: <b>${headcount}</b> из ${subClients.length} дет.</div>
    </div>

    <div class="staff-card" style="background:rgba(124,58,237,.08);border:1px solid rgba(124,58,237,.25);flex-direction:column;align-items:stretch;gap:6px;margin-bottom:10px">
      <div style="font-size:12px;color:var(--hint)">Кто где сегодня${hasSubs?` — ${subLabel(sub)}`:''}</div>
      <div id="cnd-summary" style="font-size:13px;line-height:1.6">${_cndSummaryInner(g, sub)}</div>
    </div>

    <button class="btn btn-sm btn-full" style="background:var(--card);border:1px solid var(--border);margin-bottom:12px"
      onclick="repeatLastConducted('${g.groupId}')">🔁 Повторить прошлое занятие</button>

    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Кто на какой станции${hasSubs?` — ${subLabel(sub)}`:''}</div>
    ${stationCards}
    <div style="font-size:11px;color:var(--hint);margin:2px 0 12px">Тап по имени — отметить на станции, повторный тап — снять. Можно отметить тренера на обеих станциях. Кого не было — не отмечайте. Процентникам ЗП идёт независимо от присутствия.</div>

    <div style="display:flex;gap:8px;flex-wrap:wrap">
      <button class="btn btn-sm" style="flex:1;min-width:160px;background:var(--card);border:1px solid var(--border)"
        onclick="renderGroupAttendanceByDate('${g.groupId}')">📅 Посещаемость за другую дату</button>
      <button class="btn btn-sm" style="flex:1;min-width:160px;background:var(--card);border:1px solid var(--border)"
        onclick="renderConductedByDate('${g.groupId}')">✏️ Кто проводил — другая дата</button>
    </div>
  </div></div>`);
}

// «Повторить прошлое занятие» — переносит отметки последнего занятия на сегодня (текущая подгруппа)
async function repeatLastConducted(groupId) {
  const g = window._gd; if (!g || !g.instanceId) return toast('Недоступно для этой группы','error');
  if (_pending.has('repeatcnd')) return;
  _pending.add('repeatcnd');
  try {
    const {date, rows} = await DB.getLastConductedBefore(g.instanceId, g.today);
    if (!date || !rows.length) { toast('Нет прошлых занятий для копирования','info'); return; }
    const sub = g.currentSubgroup||'';
    const mine = rows.filter(r=>(r.subgroup||'')===sub && CONDUCTED_ROLES.includes(r.conducted_role));
    if (!mine.length) { toast('В прошлом занятии нет отметок для этой подгруппы','info'); return; }
    const headcount = g.clients.filter(c=>(c.subgroup||'')===sub && g.attMap[c.id]).length;
    for (const r of mine) {
      await DB.setGroupConducted(r.trainer_id, g.groupTypeId, g.branch, g.today, headcount, r.conducted_role, g.instanceId, sub);
    }
    toast(`Перенесено с ${fmtDate(date)} ✅`,'success');
    renderGroupSessionScreen(groupId); // перезагрузка с обновлёнными отметками
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('repeatcnd'); }
}

function switchSessionSubgroup(subEnc) {
  const g = window._gd; if (!g) return;
  g.currentSubgroup = decodeURIComponent(subEnc);
  renderGroupSessionScreenHtml();
}

// Переключатель «кто проводил» — UPSERT/DELETE в group_sessions с conducted_role + subgroup.
// БЕЗ полной перерисовки экрана: обновляем только нажатый чип (экран не прыгает, Блок F)
async function toggleConducted(trainerId, conductedRole) {
  const g = window._gd; if (!g) return;
  trainerId = parseInt(trainerId);
  const sub = g.currentSubgroup||'';
  const key = `conducted_${trainerId}_${g.today}_${conductedRole}_${sub}`;
  if (_pending.has(key)) return;
  _pending.add(key);
  try {
    // Роли независимы: тренер может вести и сушу, и воду в один день (две оплаты).
    // Подгруппы независимы: суша 16:00 + суша 17:00 = 2 занятия (instanceSessions считает строки)
    const subMap = (g.conductedMap[sub] ||= {});
    const roles = subMap[trainerId] || [];
    const already = roles.includes(conductedRole);
    // headcount = отмеченные дети ИМЕННО ЭТОЙ подгруппы за сегодня
    const headcount = g.clients.filter(c=>(c.subgroup||'')===sub && g.attMap[c.id]).length;
    if (already) {
      await DB.removeGroupConducted(trainerId, g.groupTypeId, g.branch, g.today, conductedRole, sub);
      subMap[trainerId] = roles.filter(r=>r!==conductedRole);
      if (!subMap[trainerId].length) delete subMap[trainerId];
      toast('Отметка снята','success');
    } else {
      await DB.setGroupConducted(trainerId, g.groupTypeId, g.branch, g.today, headcount, conductedRole, g.instanceId, sub);
      subMap[trainerId] = [...roles, conductedRole];
      toast('Отмечено ✅','success');
    }
    DB.auditLog('group_conducted', STATE.profile.id, STATE.profile.fio, trainerId, 'group_session',
      { date:g.today, role:conductedRole, removed:already, subgroup:sub }, g.branch);
    // Обновляем только нажатую пилюлю и сводку — без перерисовки экрана (не прыгает)
    const btn = document.getElementById(`cnd-${trainerId}-${conductedRole}`);
    if (btn) { const fio = g.members.find(t=>t.trainer_id===trainerId)?.profiles?.fio||'—';
               btn.outerHTML = _cndPill(trainerId, conductedRole, fio, !already); }
    const sumEl = document.getElementById('cnd-summary');
    if (sumEl) sumEl.innerHTML = _cndSummaryInner(g, sub);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(key); }
}

// ═══ РЕДАКТОР «КТО ПРОВОДИЛ» ЗА ДРУГУЮ ДАТУ (правка задним числом) ═══
// Зеркало экрана занятия для прошлой даты: забыли отметить тренера (напр. арт-свим) — можно исправить.
// Пишет в ту же group_sessions через setGroupConducted/removeGroupConducted.
async function renderConductedByDate(groupId) {
  const g = await ensureGd(groupId); if (!g) return;
  if (!g.instanceId) return toast('Недоступно для этой группы','error');
  g._cbd = { date: g.today, sub: g.currentSubgroup||'', conductedMap:{}, attMap:{} };
  const m = el('div','modal-overlay'); m.id = 'cbd-modal';
  m.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>Кто проводил — правка</h3>
      <button class="btn-close" onclick="cbdClose('${groupId}')">✕</button></div>
    <div class="form-group"><label>Дата</label>
      <input type="date" id="cbd-date" value="${g._cbd.date}" max="${todayStr()}"
        onchange="cbdReload('${groupId}')"></div>
    <div id="cbd-body"><p class="hint">Загрузка…</p></div>
  </div>`;
  document.body.appendChild(m);
  await cbdReload(groupId);
}

async function cbdReload(groupId) {
  const g = window._gd; if (!g || !g._cbd) return;
  const dateEl = document.getElementById('cbd-date');
  if (dateEl) g._cbd.date = dateEl.value;
  const date = g._cbd.date;
  try {
    const [conducted, att] = await Promise.all([
      DB.getGroupConductedByDate(g.instanceId, date),
      DB.getGroupAttendanceByInstance(g.instanceId, date),
    ]);
    const cm = {};
    conducted.forEach(s=>{ const sg = s.subgroup||''; ((cm[sg] ||= {})[s.trainer_id] ||= []).push(s.conducted_role); });
    g._cbd.conductedMap = cm;
    g._cbd.attMap = Object.fromEntries(att.map(a=>[a.group_client_id, a.attended]));
    cbdRenderBody();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function _cbdPill(trainerId, role, fio, active) {
  return `<button id="cbd-${trainerId}-${role}" style="${_cndPillStyle(active, role)}"
    onclick="cbdToggle('${trainerId}','${role}')">${fio}${active?' ✓':''}</button>`;
}
function cbdRenderBody() {
  const g = window._gd; const cbd = g?._cbd; if (!cbd) return;
  const sub = cbd.sub||'';
  const cm = cbd.conductedMap[sub]||{};
  const uniqMembers = _uniqMembers(g.members);
  const hasSubs = g.subgroups.length > 0;
  const segHtml = hasSubs ? `<div style="display:flex;gap:6px;flex-wrap:wrap;margin-bottom:10px">
    ${['', ...g.subgroups].map(s=>`<button class="btn btn-sm"
      style="font-size:12px;${s===sub?'background:var(--accent);color:#fff':'background:var(--card);border:1px solid var(--border)'}"
      onclick="cbdSwitchSub('${encodeURIComponent(s)}')">${subLabel(s)}</button>`).join('')}</div>` : '';
  const cards = uniqMembers.length ? CONDUCTED_ROLES.map(role=>{
    const meta = STATION_META[role]||{};
    const pills = uniqMembers.map(t=>_cbdPill(t.trainer_id, role, t.profiles?.fio||'—', (cm[t.trainer_id]||[]).includes(role))).join('');
    return `<div class="staff-card" style="flex-direction:column;align-items:stretch;gap:10px;margin-bottom:10px">
      <div style="display:flex;align-items:center;gap:6px;font-size:14px;font-weight:600">
        <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${meta.dot}"></span>
        ${meta.icon||''} ${role[0].toUpperCase()+role.slice(1)}
      </div>
      <div style="display:flex;gap:8px;flex-wrap:wrap">${pills}</div></div>`;
  }).join('') : '<p class="hint">Тренеры не назначены</p>';
  const body = document.getElementById('cbd-body');
  if (body) body.innerHTML = segHtml + cards +
    `<p class="hint" style="font-size:11px;margin-top:4px">Тап по имени — отметить/снять «кто проводил» на станции за выбранную дату.</p>`;
}

function cbdSwitchSub(subEnc) {
  const g = window._gd; if (!g || !g._cbd) return;
  g._cbd.sub = decodeURIComponent(subEnc);
  cbdRenderBody();
}

// UPSERT/DELETE в group_sessions за ВЫБРАННУЮ дату (g._cbd.date), без перерисовки всей модалки
async function cbdToggle(trainerId, conductedRole) {
  const g = window._gd; const cbd = g?._cbd; if (!cbd) return;
  trainerId = parseInt(trainerId);
  const date = cbd.date, sub = cbd.sub||'';
  const key = `cbd_${trainerId}_${date}_${conductedRole}_${sub}`;
  if (_pending.has(key)) return;
  _pending.add(key);
  try {
    const subMap = (cbd.conductedMap[sub] ||= {});
    const roles = subMap[trainerId] || [];
    const already = roles.includes(conductedRole);
    // headcount = отмеченные дети этой подгруппы за выбранную дату
    const headcount = g.clients.filter(c=>(c.subgroup||'')===sub && cbd.attMap[c.id]).length;
    if (already) {
      await DB.removeGroupConducted(trainerId, g.groupTypeId, g.branch, date, conductedRole, sub);
      subMap[trainerId] = roles.filter(r=>r!==conductedRole);
      if (!subMap[trainerId].length) delete subMap[trainerId];
      toast('Отметка снята','success');
    } else {
      await DB.setGroupConducted(trainerId, g.groupTypeId, g.branch, date, headcount, conductedRole, g.instanceId, sub);
      subMap[trainerId] = [...roles, conductedRole];
      toast('Отмечено ✅','success');
    }
    DB.auditLog('group_conducted_edit', STATE.profile.id, STATE.profile.fio, trainerId, 'group_session',
      { date, role:conductedRole, removed:already, subgroup:sub }, g.branch);
    const fio = g.members.find(t=>t.trainer_id===trainerId)?.profiles?.fio||'—';
    const btn = document.getElementById(`cbd-${trainerId}-${conductedRole}`);
    if (btn) btn.outerHTML = _cbdPill(trainerId, conductedRole, fio, !already);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(key); }
}

// Закрыть редактор; если правили сегодняшнюю дату и открыт экран занятия — перезагрузить его
function cbdClose(groupId) {
  document.getElementById('cbd-modal')?.remove();
  const g = window._gd;
  const editedToday = g && g._cbd && g._cbd.date===g.today;
  if (g) g._cbd = null;
  if (editedToday && String(g.groupId)===String(groupId) && g._screen==='session') renderGroupSessionScreen(groupId);
}

// ═══ ЭКРАН «СПИСОК ДЕТЕЙ» (плоский список или аккордеоны подгрупп) ═══
async function renderGroupChildrenScreen(groupId) {
  const g = await ensureGd(groupId); if (!g) return;
  g._screen = 'children';
  navPush(()=>renderGroupDetail(groupId));
  setupBack(()=>renderGroupDetail(groupId));
  loading('Загрузка списка...');
  try {
    const [clients, payments, notes, subgData] = await Promise.all([
      g.instanceId ? DB.getGroupClientsByInstance(g.instanceId) : DB.getGroupClients(g.groupId),
      g.instanceId ? DB.getGroupPaymentsByInstance(g.instanceId, g.month) : DB.getGroupPayments(g.groupId, g.month),
      DB.getGroupProgressNotes(g.groupId, g.month),
      DB.getGroupSubgroups(g.instanceId, g.groupId),
    ]);
    g.clients = clients;
    g.paidMap = Object.fromEntries(payments.map(p=>[p.group_client_id, p]));
    g.noteMap = Object.fromEntries(notes.map(n=>[n.group_client_id, n]));
    g.dbSubgroups = subgData.names||[];
    g.mainLabel = subgData.mainLabel||null;
    g.subgroups = [...new Set([...g.dbSubgroups, ...clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
    renderGroupChildrenScreenHtml();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function _childCardHtml(c) {
  const g = window._gd;
  const pay = g.paidMap?.[c.id]; const paid = pay?.paid; const note = g.noteMap?.[c.id];
  return `<div class="staff-card" onclick="openChildMenu('${c.id}')" style="cursor:pointer">
    <div style="flex:1;min-width:0">
      <div class="staff-fio">${c.name}</div>
      <div class="staff-meta">${c.level} · ${fmt(c.monthly_price)} сум/мес${note?.note?' · 📝':''}</div>
    </div>
    <span style="font-size:11px;padding:3px 8px;border-radius:12px;
      background:${paid?'rgba(16,185,129,.15)':'rgba(239,68,68,.15)'};color:${paid?'#10b981':'#ef4444'}">
      ${paid?'Оплачен':'Не оплачен'}</span>
    <span style="font-size:14px;color:var(--hint);margin-left:8px">⋯</span>
  </div>`;
}

function renderGroupChildrenScreenHtml() {
  const g = window._gd; if (!g) return;
  // ОДИН общий список без деления по подгруппам (подгруппа правится в меню ребёнка / менеджере подгрупп)
  const listHtml = g.clients.length ? g.clients.map(_childCardHtml).join('') : '<p class="hint">Детей пока нет</p>';
  setScreen(`<div class="app-header">
    ${backBtn()}
    <div class="app-title">Список детей</div>
    <div style="display:flex;gap:6px">
      <button class="btn btn-sm" style="font-size:12px;background:var(--card);border:1px solid var(--border)"
        onclick="openSubgroupManager('${g.groupId}','children')">👥 Подгруппы</button>
      <button class="btn btn-sm btn-primary" style="font-size:12px"
        onclick="renderAddGroupClientModal('${g.groupId}')">+ Ребёнок</button>
    </div>
  </div>
  <div class="tab-content"><div class="tab-pad">
    ${listHtml}
  </div></div>`);
}

// ═══ МЕНЕДЖЕР ПОДГРУПП — общий для «Список детей» и «Занятие сегодня» ═══
// Создать подгруппу + раскидать детей. Данные персистентны (group_subgroups + group_clients.subgroup),
// поэтому правки видны на обоих экранах и не конфликтуют.
async function openSubgroupManager(groupId, from='children') {
  const g = await ensureGd(groupId); if (!g) return;
  g._subgroupFrom = from;
  g._screen = 'subgroups';
  // Свежие дети + подгруппы
  loading('Загрузка подгрупп...');
  try {
    const [clients, subgData] = await Promise.all([
      g.instanceId ? DB.getGroupClientsByInstance(g.instanceId) : DB.getGroupClients(g.groupId),
      DB.getGroupSubgroups(g.instanceId, g.groupId),
    ]);
    g.clients = clients;
    g.dbSubgroups = subgData.names||[];
    g.mainLabel = subgData.mainLabel||null;
    g.subgroups = [...new Set([...g.dbSubgroups, ...clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
    renderSubgroupManagerHtml();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function _subgroupBack(g) {
  return g._subgroupFrom==='session'
    ? ()=>renderGroupSessionScreen(g.groupId)
    : ()=>renderGroupChildrenScreen(g.groupId);
}
function renderSubgroupManagerHtml() {
  const g = window._gd; if (!g) return;
  setupBack(_subgroupBack(g));
  navPush(_subgroupBack(g));
  const subOptions = (cur) => ['', ...g.subgroups]
    .map(s=>`<option value="${encodeURIComponent(s)}" ${s===(cur||'')?'selected':''}>${subLabel(s)}</option>`).join('');
  const childRows = g.clients.length ? g.clients.map(c=>`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:10px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:10px 12px">
      <div style="flex:1;min-width:0">
        <div style="font-size:14px;font-weight:500;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${c.name||'Без имени'}</div>
        ${c.level?`<div style="font-size:11px;color:var(--hint)">${c.level}</div>`:''}
      </div>
      <select onchange="quickAssignSubgroup('${c.id}',this.value)"
        style="background:var(--bg);border:1px solid var(--border);border-radius:8px;padding:7px 8px;color:var(--text);font-size:13px;flex-shrink:0;max-width:140px">
        ${subOptions(c.subgroup)}
      </select>
    </div>`).join('') : '<p class="hint">Детей пока нет</p>';
  const counts = {};
  g.clients.forEach(c=>{ const s=c.subgroup||''; counts[s]=(counts[s]||0)+1; });
  // Список подгрупп с переименованием (включая главную '' — её метку храним отдельно)
  const subEditRows = ['', ...g.subgroups].map(s=>`
    <div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--card);border:1px solid var(--border);border-radius:10px;padding:9px 12px">
      <span style="font-size:14px">${subLabel(s)}${s===''?' <span style="font-size:11px;color:var(--hint)">(главная)</span>':''} · <span style="color:var(--hint)">${counts[s]||0} дет.</span></span>
      <button class="btn btn-sm" style="background:var(--bg);border:1px solid var(--border);font-size:12px"
        onclick="promptRenameSubgroup('${encodeURIComponent(s)}')">✏️ Переименовать</button>
    </div>`).join('');
  setScreen(`<div class="app-header">
    ${backBtn()}
    <div class="app-title">Подгруппы</div>
    <button class="btn btn-sm btn-primary" style="font-size:12px" onclick="promptAddSubgroup()">+ подгруппа</button>
  </div>
  <div class="tab-content"><div class="tab-pad">
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Подгруппы</div>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:18px">${subEditRows}</div>
    <div style="font-size:13px;font-weight:600;margin-bottom:8px">Кто в какой подгруппе</div>
    <div style="display:flex;flex-direction:column;gap:8px">${childRows}</div>
    <p class="hint" style="margin-top:12px">Можно переименовать любую подгруппу, включая главную (удобно ставить время, напр. «15:00»). Изменения сразу видны в «Сегодня» и «Список детей».</p>
  </div></div>`);
}
function _subgroupCountsChips(g) {
  const counts = {};
  g.clients.forEach(c=>{ const s=c.subgroup||''; counts[s]=(counts[s]||0)+1; });
  return ['', ...g.subgroups].map(s=>`<span style="font-size:12px;padding:5px 10px;border-radius:14px;background:rgba(124,58,237,.1);border:1px solid rgba(124,58,237,.25);color:var(--text)">
    ${subLabel(s)} <b style="color:var(--accent)">${counts[s]||0}</b></span>`).join('');
}
async function quickAssignSubgroup(childId, encSub) {
  const g = window._gd; if (!g) return;
  const sub = decodeURIComponent(encSub);
  if (_pending.has(`qsub_${childId}`)) return;
  _pending.add(`qsub_${childId}`);
  try {
    await DB.updateGroupClient(childId, {subgroup: sub});
    const c = g.clients.find(x=>String(x.id)===String(childId)); if (c) c.subgroup = sub;
    // Обновляем только строку-сводку счётчиков — без перерисовки (не сбрасывает скролл)
    const el = document.getElementById('subg-counts');
    if (el) el.innerHTML = _subgroupCountsChips(g);
  } catch(e) { toast('Ошибка сохранения','error'); console.error(e); }
  finally { _pending.delete(`qsub_${childId}`); }
}

// Создание подгруппы = появление опции в списках (дети добавляются/переводятся с этим subgroup)
// prompt() в Telegram WebApp заблокирован — используем модалку с input.
function promptAddSubgroup() {
  const g = window._gd; if (!g) return;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новая подгруппа</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название (например, 16:00)</label>
      <input id="new-subgroup-name" type="text" placeholder="16:00" autocomplete="off"
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)"
        onkeydown="if(event.key==='Enter')doAddSubgroup()"></div>
    <button class="btn btn-primary btn-full" onclick="doAddSubgroup()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
  setTimeout(()=>document.getElementById('new-subgroup-name')?.focus(), 50);
}
async function doAddSubgroup() {
  const g = window._gd; if (!g) return;
  const name = (document.getElementById('new-subgroup-name')?.value||'').trim();
  if (!name) return toast('Введите название','error');
  if (g.subgroups.includes(name)) return toast('Такая подгруппа уже есть','error');
  if (_pending.has('addsubg')) return;
  _pending.add('addsubg');
  try {
    await DB.addGroupSubgroup(g.instanceId, g.groupId, name, STATE.profile?.id);
    (g.dbSubgroups ||= []).push(name);
    g.subgroups = [...new Set([...g.subgroups, name])].sort();
    document.querySelector('.modal-overlay')?.remove();
    toast(`Подгруппа «${name}» добавлена — переведите в неё детей`,'success');
    if (g._screen==='subgroups') renderSubgroupManagerHtml();
    else if (g._screen==='children') renderGroupChildrenScreenHtml();
    else if (g._screen==='session') renderGroupSessionScreenHtml();
  } catch(e) { toast('Ошибка сохранения подгруппы','error'); console.error(e); }
  finally { _pending.delete('addsubg'); }
}

// Переименование подгруппы (включая главную '' → её отображаемая метка)
function promptRenameSubgroup(encS) {
  const g = window._gd; if (!g) return;
  const s = decodeURIComponent(encS);
  const isMain = s==='';
  const cur = isMain ? (g.mainLabel||'') : s;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${isMain?'Название главной подгруппы':'Переименовать подгруппу'}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>${isMain?'Напр. 15:00 (пусто = «Основная»)':'Новое название'}</label>
      <input id="ren-subgroup-name" type="text" value="${cur}" placeholder="15:00" autocomplete="off"
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)"
        onkeydown="if(event.key==='Enter')doRenameSubgroup('${encS}')"></div>
    <button class="btn btn-primary btn-full" onclick="doRenameSubgroup('${encS}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
  setTimeout(()=>document.getElementById('ren-subgroup-name')?.focus(), 50);
}
async function doRenameSubgroup(encS) {
  const g = window._gd; if (!g) return;
  const s = decodeURIComponent(encS);
  const isMain = s==='';
  const val = (document.getElementById('ren-subgroup-name')?.value||'').trim();
  if (!isMain && !val) return toast('Введите название','error');
  if (val && val!==s && (g.subgroups.includes(val) || val===(g.mainLabel||'')))
    return toast('Такое название уже есть','error');
  if (_pending.has('rensubg')) return;
  _pending.add('rensubg');
  try {
    if (isMain) {
      await DB.setMainSubgroupLabel(g.instanceId, g.groupId, val);
      g.mainLabel = val||null;
    } else {
      await DB.renameGroupSubgroup(g.instanceId, g.groupId, s, val);
      g.dbSubgroups = (g.dbSubgroups||[]).map(x=>x===s?val:x);
      g.clients.forEach(c=>{ if ((c.subgroup||'')===s) c.subgroup=val; });
      g.subgroups = [...new Set([...g.dbSubgroups, ...g.clients.map(c=>c.subgroup||'').filter(Boolean)])].sort();
      if (g.currentSubgroup===s) g.currentSubgroup=val;
    }
    document.querySelector('.modal-overlay')?.remove();
    toast('Переименовано ✅','success');
    renderSubgroupManagerHtml();
  } catch(e) { toast('Ошибка переименования','error'); console.error(e); }
  finally { _pending.delete('rensubg'); }
}

// Модал «Перевести в подгруппу…» из меню ребёнка
function renderMoveSubgroupModal(clientId) {
  const g = window._gd; if (!g) return;
  const c = g.clients.find(x=>String(x.id)===String(clientId)); if (!c) return;
  const cur = c.subgroup||'';
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Подгруппа — ${c.name}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Перевести в</label>
      <select id="msg-sub">
        <option value="" ${cur===''?'selected':''}>${subLabel('')}</option>
        ${g.subgroups.map(s=>`<option value="${encodeURIComponent(s)}" ${s===cur?'selected':''}>${s}</option>`).join('')}
      </select></div>
    <button class="btn btn-primary btn-full" onclick="doMoveSubgroup('${clientId}')">Перевести</button>
  </div>`;
  document.body.appendChild(m);
}
async function doMoveSubgroup(clientId) {
  const g = window._gd; if (!g) return;
  const sub = decodeURIComponent(document.getElementById('msg-sub')?.value||'');
  if (_pending.has(`movesub_${clientId}`)) return;
  _pending.add(`movesub_${clientId}`);
  try {
    await DB.updateGroupClient(clientId, {subgroup: sub});
    document.querySelector('.modal-overlay')?.remove();
    toast('Переведён ✅','success');
    refreshGroupScreen(g.groupId);
  } catch(e) { toast('Ошибка (подгруппы заработают после обновления базы)','error'); console.error(e); }
  finally { _pending.delete(`movesub_${clientId}`); }
}

// ═══ ЭКРАН «ИСТОРИЯ ЗАНЯТИЙ» (Блок I): даты ↓, месячная навигация, явка/кто проводил/замены ═══
async function renderGroupHistoryScreen(groupId, monthStr) {
  const g = await ensureGd(groupId); if (!g) return;
  g._screen = 'history';
  if (!monthStr) monthStr = g.month;
  g.historyMonth = monthStr;
  navPush(()=>renderGroupDetail(groupId));
  setupBack(()=>renderGroupDetail(groupId));
  loading('Загрузка истории...');
  try {
    // Один запрос за месяц: явка + group_sessions (кто проводил) + замены + клиенты (подгруппы)
    const report = await DB.getGroupMonthReport(groupId, monthStr);
    const {clients, attendance, instanceSessions, substitutions, trainers} = report;
    const fioByTrainer = Object.fromEntries(trainers.map(t=>[t.trainer_id, t.profiles?.fio||'—']));
    const subByClient = Object.fromEntries(clients.map(c=>[c.id, c.subgroup||'']));
    const hasSubs = clients.some(c=>(c.subgroup||'')!=='');
    const days = {}; // date → {att:{sub:n}, total:{sub:n}, conducted:[], subs:[]}
    const day = d => (days[d] ||= {att:{}, total:{}, conducted:[], subs:[]});
    attendance.forEach(a=>{
      const d = day(a.session_date); const sg = subByClient[a.group_client_id]||'';
      d.total[sg] = (d.total[sg]||0)+1;
      if (a.attended) d.att[sg] = (d.att[sg]||0)+1;
    });
    instanceSessions.filter(s=>s.conducted_role).forEach(s=>day(s.session_date).conducted.push(s));
    (substitutions||[]).forEach(s=>day(s.session_date).subs.push(s));
    const dates = Object.keys(days).sort().reverse();
    const monthLabel = new Date(monthStr).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
    const isCurrentMonth = monthStr === new Date().toISOString().slice(0,7)+'-01';
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">История занятий</div>
      <span style="font-size:12px;color:var(--hint)">${g.groupName||''}</span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="section-header"><h3>${monthLabel}</h3>
        <div class="month-nav">
          <button onclick="renderGroupHistoryScreen('${groupId}','${prevMonthStr(monthStr)}')">‹</button>
          <button ${isCurrentMonth?'disabled':''} onclick="renderGroupHistoryScreen('${groupId}','${nextMonthStr(monthStr)}')">›</button>
        </div>
      </div>
      ${!dates.length?'<p class="hint">Занятий за этот месяц нет</p>':dates.map(date=>{
        const d = days[date];
        const attTotal = Object.values(d.att).reduce((s,v)=>s+v,0);
        const totTotal = Object.values(d.total).reduce((s,v)=>s+v,0);
        const attLine = hasSubs && totTotal
          ? Object.keys(d.total).sort().map(sg=>`${sg||'осн.'}: ${d.att[sg]||0}/${d.total[sg]||0}`).join(' · ')
          : '';
        const condLine = d.conducted.length
          ? d.conducted.map(s=>`${fioByTrainer[s.trainer_id]||'—'} <span style="color:var(--hint)">(${s.conducted_role}${(s.subgroup||'')?` · ${s.subgroup}`:''})</span>`).join(', ')
          : '<span style="color:var(--hint)">не отмечено</span>';
        const subsLine = d.subs.length
          ? d.subs.map(s=>`${s.substitute?.fio||'?'} вместо ${s.original?.fio||'?'}${s.status!=='approved'?' ⏳':''}`).join(', ')
          : '';
        return `<div class="history-item">
          <div class="hi-main" style="justify-content:space-between">
            <span class="hi-client">${fmtDate(date)}</span>
            <span style="font-size:13px;font-weight:600;color:${attTotal===totTotal&&totTotal>0?'#10b981':'#f59e0b'}">${attTotal} / ${totTotal} дет.</span>
          </div>
          ${attLine?`<div style="font-size:12px;color:var(--hint);margin-top:4px">${attLine}</div>`:''}
          <div style="font-size:12px;margin-top:4px">Проводил: ${condLine}</div>
          ${subsLine?`<div style="font-size:12px;margin-top:4px;color:#a78bfa">🔄 ${subsLine}</div>`:''}
          ${totTotal?`<div style="display:flex;gap:6px;justify-content:flex-end;margin-top:6px">
            <button class="btn btn-sm" style="font-size:11px;background:var(--card);border:1px solid var(--border)"
              onclick="renderGroupAttendanceEdit('${groupId}','${date}')">✏️ Изменить</button>
            <button class="btn btn-sm btn-danger" style="font-size:11px"
              onclick="doDeleteAttendanceDay('${groupId}','${date}')">🗑</button>
          </div>`:''}
        </div>`;
      }).join('')}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Меню функций по ребёнку (тап в списке детей)
function openChildMenu(clientId) {
  const g = window._gd; if (!g) return;
  const c = g.clients.find(x=>String(x.id)===String(clientId)); if (!c) return;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${c.name}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div style="font-size:12px;color:var(--hint);margin-bottom:12px">${c.level} · ${fmt(c.monthly_price)} сум/мес${c.age?` · ${c.age}л`:''}</div>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-full btn-primary"
        onclick="this.closest('.modal-overlay').remove();toggleGroupPayment('${g.groupId}','${c.id}',true,${c.monthly_price||0},'${g.month}')">💳 Оплата абонемента</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();doToggleUnpay('${c.id}')">✕ Снять оплату</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderGroupNoteModal('${g.groupId}','${c.id}','${encodeURIComponent(c.name)}','${g.month}','')">📝 Заметка</button>
      <div class="form-group" style="margin:0"><label style="font-size:12px">Уровень</label>
        <select onchange="updateGroupClientLevel('${c.id}',this.value)">
          ${GROUP_LEVELS.map(l=>`<option ${l===c.level?'selected':''}>${l}</option>`).join('')}
        </select></div>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderEditGroupClientModal('${c.id}','${encodeURIComponent(c.name)}',${c.age||0},${c.monthly_price||0},'${g.groupId}')">✏️ Редактировать</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderChildAttendanceHistory('${c.id}','${encodeURIComponent(c.name)}')">📅 История посещений</button>
      ${g.subgroups?.length?`<button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderMoveSubgroupModal('${c.id}')">👥 Перевести в подгруппу…${(c.subgroup||'')?` <span style="font-size:11px;color:var(--hint)">(сейчас: ${c.subgroup})</span>`:''}</button>`:''}
      <button class="btn btn-full btn-danger"
        onclick="this.closest('.modal-overlay').remove();archiveGroupClientConfirm('${c.id}','${encodeURIComponent(c.name)}','${g.groupId}')">📦 Архив / Удалить</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}

// Снять оплату за текущий месяц без модала суммы
async function doToggleUnpay(clientId) {
  const g = window._gd; if (!g) return;
  try {
    await DB.setGroupPayment(g.groupId, clientId, g.month, 0, false, null, null, g.instanceId||null);
    toast('Оплата снята','success');
    refreshGroupScreen(g.groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// История посещений конкретного ребёнка
async function renderChildAttendanceHistory(clientId, nameEnc) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal"><div class="modal-header"><h3>Посещения — ${name}</h3>
    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div id="cah-body"><div class="center-screen"><div class="spinner"></div></div></div></div>`;
  document.body.appendChild(m);
  try {
    const hist = await DB.getGroupClientAttendanceHistory(clientId);
    const body = document.getElementById('cah-body');
    if (!hist.length) { body.innerHTML='<p class="hint">Записей нет</p>'; return; }
    const present = hist.filter(h=>h.attended).length;
    body.innerHTML=`<div style="font-size:12px;color:var(--hint);margin-bottom:10px">Был: <b>${present}</b> из ${hist.length}</div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${hist.map(h=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px">${fmtDate(h.session_date)}</span>
          <span style="font-size:13px;color:${h.attended?'#10b981':'#ef4444'}">${h.attended?'✓ был':'✕ не был'}</span>
        </div>`).join('')}
      </div>`;
  } catch(e) { document.getElementById('cah-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

// Меню функций по тренеру (только admin/senior_trainer)
function openTrainerMenu(tgId) {
  const g = window._gd; if (!g || !g.canPayroll) return;
  const t = g.members.find(x=>String(x.id)===String(tgId)); if (!t) return;
  const fio = t.profiles?.fio||'—';
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${fio}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div style="font-size:12px;color:var(--hint);margin-bottom:4px">${t.role||'тренер'} · текущая ставка: ${t.rate_type==='percent'?(t.rate_value||0)+'%':t.rate_type==='flat'?fmt(t.rate_value||75000)+' сум/зан':'по явке'}</div>
    <div id="rate-hist-${t.id}" style="font-size:11px;color:var(--hint);margin-bottom:12px"></div>
    <div style="display:flex;flex-direction:column;gap:8px">
      ${t.rate_type!=='headcount'?`<button class="btn btn-full btn-primary"
        onclick="this.closest('.modal-overlay').remove();renderTrainerRateModal('${t.id}','${t.rate_type||'percent'}',${t.rate_value||0})">💰 Ставка / процент</button>`:''}
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderLeaderFeeModal('${g.groupId}','${encodeURIComponent(t.leader_name||'')}',${t.leader_fee_percent||0})">👑 Руководитель группы</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderGroupSubstitutionModal('${g.groupId}')">🔄 Замена</button>
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="this.closest('.modal-overlay').remove();renderTrainerGroupSessions('${t.trainer_id}','${encodeURIComponent(fio)}')">📅 Его занятия за месяц</button>
      <button class="btn btn-full btn-danger"
        onclick="this.closest('.modal-overlay').remove();doUnassignGroup(${t.id})">Убрать из группы</button>
    </div>
  </div>`;
  document.body.appendChild(m);
  // История ставок (2-3 последние записи); до миграции вернёт [] — блок просто не покажется
  if (t.rate_type!=='headcount') DB.getRateHistoryByTg(t.id, 3).then(hist=>{
    const box = document.getElementById(`rate-hist-${t.id}`);
    if (!box || !hist.length) return;
    box.innerHTML = `<div style="font-weight:600;margin-bottom:2px">История ставки:</div>`+
      hist.map(h=>`<div>с ${fmtDate(h.effective_from)} — ${h.rate_type==='percent'?(h.rate_value||0)+'%':fmt(h.rate_value||0)+' сум/зан'}</div>`).join('');
  }).catch(()=>{});
}

// Модал пересмотра ставки/процента тренера в группе (+ период применения → rate_history)
function renderTrainerRateModal(tgId, rateType, rateValue) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Ставка тренера</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Тип</label>
      <select id="tr-type" onchange="document.getElementById('tr-label').textContent=this.value==='percent'?'Процент (%)':'Сумма за занятие (сум)'">
        <option value="percent" ${rateType==='percent'?'selected':''}>Процент (%)</option>
        <option value="flat" ${rateType==='flat'?'selected':''}>Ставка за занятие</option>
      </select></div>
    <div class="form-group"><label id="tr-label">${rateType==='percent'?'Процент (%)':'Сумма за занятие (сум)'}</label>
      <input id="tr-val" type="number" min="0" value="${rateValue||0}"></div>
    <div class="form-group"><label>Применить</label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">
        <input type="radio" name="tr-eff" value="cur_month" checked> За весь текущий месяц</label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">
        <input type="radio" name="tr-eff" value="prev_month"> За прошлый месяц</label>
      <label style="display:flex;align-items:center;gap:8px;font-size:13px;padding:4px 0">
        <input type="radio" name="tr-eff" value="today"> С этого дня</label>
    </div>
    <p class="hint" style="margin-bottom:12px">ЗП пересчитается автоматически: занятия — по ставке на дату занятия, оплаты — по проценту на дату оплаты.</p>
    <button class="btn btn-primary btn-full" onclick="doSaveTrainerRateMenu('${tgId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveTrainerRateMenu(tgId) {
  const type = document.getElementById('tr-type')?.value||'percent';
  const val  = parseFloat(document.getElementById('tr-val')?.value)||0;
  const eff  = document.querySelector('input[name="tr-eff"]:checked')?.value||'cur_month';
  // Даты строим локально (НЕ toISOString — UTC сдвигает день назад)
  const now = new Date();
  const dstr = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
  const effectiveFrom =
    eff==='today'      ? dstr(now) :
    eff==='prev_month' ? dstr(new Date(now.getFullYear(), now.getMonth()-1, 1)) :
                         dstr(new Date(now.getFullYear(), now.getMonth(), 1));
  if (_pending.has(`rate_${tgId}`)) return;
  _pending.add(`rate_${tgId}`);
  try {
    // История ставок — основа ретро-пересчёта; до миграции таблицы нет: пишем только текущую ставку
    try { await DB.addRateHistory(tgId, type, val, effectiveFrom, STATE.profile.id); }
    catch(e) { console.warn('[addRateHistory] не записана (миграция ещё не применена?)', e?.message||e); }
    await DB.updateTrainerGroupRate(tgId, type, val);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Ставка сохранена','success');
    invalidateCache('groupTypes');
    if (window._gd) refreshGroupScreen(window._gd.groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(`rate_${tgId}`); }
}
// Занятия тренера за текущий месяц (из меню тренера)
async function renderTrainerGroupSessions(trainerId, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const now = new Date();
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal"><div class="modal-header"><h3>Занятия — ${fio}</h3>
    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div id="tgs-body"><div class="center-screen"><div class="spinner"></div></div></div></div>`;
  document.body.appendChild(m);
  try {
    const sessions = await DB.getGroupSessions(parseInt(trainerId), now.getFullYear(), now.getMonth()+1);
    const body = document.getElementById('tgs-body');
    if (!sessions.length) { body.innerHTML='<p class="hint">Занятий за месяц нет</p>'; return; }
    body.innerHTML=`<div style="font-size:12px;color:var(--hint);margin-bottom:8px">Всего: <b>${sessions.length}</b></div>
      <div style="display:flex;flex-direction:column;gap:4px">
        ${sessions.map(s=>`<div style="display:flex;justify-content:space-between;padding:6px 0;border-bottom:1px solid var(--border)">
          <span style="font-size:13px">${fmtDate(s.session_date)}</span>
          <span style="font-size:12px;color:var(--hint)">${s.conducted_role||(s.group_types?.name||'')} · ${s.headcount||0} дет.</span>
        </div>`).join('')}
      </div>`;
  } catch(e) { document.getElementById('tgs-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}
