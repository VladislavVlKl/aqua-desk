// ─ ADMIN: ПЕРСОНАЛ
// ============================================================
// SECTION: ADMIN:STAFF — renderAdminStaff, renderAddTrainerModal, doAddTrainer
// ============================================================
async function renderAdminStaff() {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Персонал</h3>
      <button class="btn btn-sm" onclick="renderAddTrainerModal()">+ Добавить</button></div>
    <div class="form-group"><select id="role-filter" onchange="loadStaffList()">
      <option value="">Все</option>
      <option value="trainer">Тренеры</option>
      <option value="senior_trainer">Старшие тренеры</option>
      <option value="admin">Администраторы</option>
    </select></div>
    <div id="staff-list"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  await loadStaffList();
}
const ROLE_LBL={trainer:'Тренер',senior_trainer:'Ст.тренер',admin:'Администратор',ceo:'Топ-менеджмент',manager:'Управляющий',reception:'Ресепшн'};
async function loadStaffList() {
  const body=document.getElementById('staff-list'); if (!body) return;
  const role=document.getElementById('role-filter')?.value||'';
  try {
    let profiles=await cached('profiles',()=>DB.getAllProfiles());
    if (role) profiles=profiles.filter(p=>p.role===role);
    body.innerHTML=!profiles.length?'<p class="hint">Нет</p>':
      profiles.map(t=>`<div class="staff-card">
        <div class="staff-info">
          <div class="staff-fio">${esc(t.fio)}</div>
          <div class="staff-meta">${ROLE_LBL[t.role]||t.role} · ${t.tg_id?'✅ В системе':'⏳ Не входил'} · ${esc((t.branches||[]).join(', ')||'—')}</div>
        </div>
        <div style="display:flex;gap:6px;flex-wrap:wrap">
          <button class="btn btn-sm" onclick="renderEditTrainerModal(${t.id},'${encArg(t.fio)}','${jsq((t.branches||[]).join(','))}','${t.role}')">✏️</button>
          ${t.role==='senior_trainer'?`<button class="btn btn-sm" style="background:rgba(124,58,237,.15);color:#a78bfa"
            onclick="renderBranchAccessModal(${t.id},'${encArg(t.fio)}')">🔑</button>`:''}
          <button class="btn btn-sm" style="background:rgba(245,158,11,.15);color:#f59e0b"
            onclick="doArchiveTrainer(${t.id},'${encArg(t.fio)}')">📦</button>
          <button class="btn btn-sm btn-danger"
            onclick="doDeleteTrainer(${t.id},'${encArg(t.fio)}')">🗑</button>
        </div>
      </div>`).join('');
  } catch(e) { console.error(e); body.innerHTML='<p class="hint">Ошибка</p>'; }
}
async function renderAddTrainerModal() {
  const branches = await cached('branches',()=>DB.getBranches());
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить сотрудника</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>ФИО</label><input id="nt-fio" type="text" placeholder="Иванов Иван Иванович"></div>
    <div class="form-group"><label>Роль</label>
      <select id="nt-role">
        <option value="trainer">Тренер</option>
        <option value="senior_trainer">Старший тренер</option>
        <option value="admin">Администратор</option>
        <option value="ceo">Топ-менеджмент</option>
        <option value="manager">Управляющий</option>
        <option value="reception">Ресепшн</option>
      </select></div>
    <div class="form-group"><label>Филиалы</label>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${branches.map(b=>`<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
          <input type="checkbox" class="nt-branch-cb" value="${esc(b.name)}" style="width:18px;height:18px">
          ${esc(b.name)}
        </label>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doAddTrainer()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddTrainer() {
  const fio=document.getElementById('nt-fio')?.value.trim();
  const role=document.getElementById('nt-role')?.value;
  const brs=[...document.querySelectorAll('.nt-branch-cb:checked')].map(cb=>cb.value);
  if (!fio)        return toast('Введите ФИО','error');
  if (!brs.length) return toast('Выберите хотя бы один филиал','error');
  // Защита от дубля профиля (как было с Сафиной Джураевой): ищем по ФИО без учёта порядка слов
  try {
    const existing = await cached('profiles',()=>DB.getAllProfiles());
    const dup = (existing||[]).find(p=>!p.is_archived && _normFio(p.fio)===_normFio(fio));
    if (dup && !confirm(`⚠️ Сотрудник «${dup.fio}» уже есть. Создавать дубликат?\n\nЕсли это тот же человек — не создавайте, а отредактируйте существующий профиль.`)) return;
  } catch(_) { /* проверка дубля не критична */ }
  try { await DB.addTrainer(fio,brs,role); invalidateCache('profiles'); document.querySelector('.modal-overlay')?.remove(); toast('✅','success'); loadStaffList(); }
  catch(e) { toast('Ошибка: '+(e?.message||String(e)),'error'); console.error(e); }
}
async function renderEditTrainerModal(id,fioEnc,branchesStr,role) {
  const fio=decodeURIComponent(fioEnc);
  const currentBranches=(branchesStr||'').split(',').filter(Boolean);
  const allBranches = await cached('branches',()=>DB.getBranches());
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>ФИО</label><input id="et-fio" value="${esc(fio)}"></div>
    <div class="form-group"><label>Роль</label>
      <select id="et-role">
        <option value="trainer" ${role==='trainer'?'selected':''}>Тренер</option>
        <option value="senior_trainer" ${role==='senior_trainer'?'selected':''}>Старший тренер</option>
        <option value="admin" ${role==='admin'?'selected':''}>Координатор</option>
        <option value="ceo" ${role==='ceo'?'selected':''}>Топ-менеджмент</option>
        <option value="manager" ${role==='manager'?'selected':''}>Управляющий</option>
        <option value="reception" ${role==='reception'?'selected':''}>Ресепшн</option>
      </select></div>
    <div class="form-group"><label>Филиалы</label>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${allBranches.map(b=>`<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
          <input type="checkbox" class="et-branch-cb" value="${esc(b.name)}" ${currentBranches.includes(b.name)?'checked':''} style="width:18px;height:18px">
          ${esc(b.name)}
        </label>`).join('')}
      </div>
    </div>
    <button class="btn btn-primary btn-full" onclick="doEditTrainer(${id})">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditTrainer(id) {
  const fio=(document.getElementById('et-fio')?.value||'').trim();
  const role=document.getElementById('et-role')?.value;
  const brs=[...document.querySelectorAll('.et-branch-cb:checked')].map(cb=>cb.value);
  if (!fio) return toast('Введите ФИО','error');
  if (!brs.length) return toast('Выберите хотя бы один филиал','error');
  try {
    await DB.updateProfile(id,{fio,role,branches:brs});
    invalidateCache('profiles');
    document.querySelector('.modal-overlay')?.remove();
    toast('✅','success'); loadStaffList();
  } catch(e) { toast('Ошибка: '+(e?.message||String(e)),'error'); console.error('[doEditTrainer]',e); }
}
function renderAddGroupClientModal(groupId) {
  // Селект подгруппы — если в группе есть подгруппы (контекст _gd текущей группы)
  const g = window._gd;
  const subs = (g && String(g.groupId)===String(groupId)) ? (g.subgroups||[]) : [];
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить ребёнка</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Имя</label>
      <input id="gc-name" type="text" placeholder="Иванова Маша"></div>
    <div class="form-group"><label>Возраст</label>
      <input id="gc-age" type="number" min="3" max="18" placeholder="8"></div>
    <div class="form-group"><label>Сумма оплаты в месяц (сум)</label>
      <input id="gc-price" type="number" placeholder="800000"></div>
    ${subs.length?`<div class="form-group"><label>Подгруппа</label>
      <select id="gc-subgroup">
        <option value="" ${(g?.currentSubgroup||'')===''?'selected':''}>${subLabel('')}</option>
        ${subs.map(s=>`<option value="${encArg(s)}" ${s===g?.currentSubgroup?'selected':''}>${s}</option>`).join('')}
      </select></div>`:''}
    <button class="btn btn-primary btn-full" onclick="doAddGroupClient('${groupId}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddGroupClient(groupId) {
  const name  = document.getElementById('gc-name')?.value.trim();
  const age   = parseInt(document.getElementById('gc-age')?.value)||null;
  const price = parseInt(document.getElementById('gc-price')?.value)||0;
  const subgroup = decodeURIComponent(document.getElementById('gc-subgroup')?.value||'');
  if (!name) return toast('Введите имя','error');
  try {
    // Получаем group_instance_id для этой группы
    const tg = await DB.getTrainerGroupById(groupId);
    const instanceId = tg?.group_instance_id||null;

    const newClient = await DB.addGroupClient(groupId, name, age, price, todayStr(), instanceId, subgroup);
    DB.auditLog('group_client_add', STATE.profile.id, STATE.profile.fio, groupId, 'group_client',
      { name, age, price }, STATE.profile.branches?.[0]);

    // Проверка дублей по instance
    if (instanceId && newClient) {
      const existing = await DB.getGroupClientsByInstance(instanceId);
      const others = existing.filter(c=>c.id!==newClient.id);
      const nameLower = name.toLowerCase();
      for (const other of others) {
        const dist = levenshtein(nameLower, other.name.toLowerCase());
        if (dist > 0 && dist <= 2) {
          // Создаём флаг потенциального дубля
          await DB.addDuplicateFlag(instanceId, newClient.id, other.id);
        }
      }
    }

    document.querySelector('.modal-overlay')?.remove();
    toast('Ребёнок добавлен ✅','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function toggleGroupPayment(groupId, clientId, paid, amount, month) {
  const isPaid = paid==='true'||paid===true;
  if (isPaid) {
    // Дефолт начала = фактическая дата оплаты (сегодня), если она в просматриваемом месяце;
    // при вводе задним числом за прошлый месяц — 1-е число того месяца.
    const _today = new Date().toISOString().slice(0,10);
    const defStart = _today.slice(0,7)===month.slice(0,7) ? _today : month.slice(0,10);
    // Открываем модал для ввода суммы и дат абонемента
    const m=el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>Оплата абонемента</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div class="form-group"><label>Сумма (сум)</label>
        <input id="gp-amount" type="number" value="${amount||0}"></div>
      <div class="form-group"><label>Начало абонемента</label>
        <input id="gp-sub-start" type="date" value="${defStart}" onchange="syncGroupSubEnd()"></div>
      <div class="form-group"><label>Конец абонемента <span style="font-size:11px;color:var(--hint)">(авто: +1 месяц)</span></label>
        <input id="gp-sub-end" type="date" value="${calcGroupSubEnd(defStart)}"></div>
      <button class="btn btn-primary btn-full"
        onclick="doSetGroupPayment('${groupId}','${clientId}','${month}',true)">✓ Оплачен</button>
    </div>`;
    document.body.appendChild(m);
  } else {
    // Снять оплату — без модала
    DB.getTrainerGroupById(groupId)
      .then(tg=>DB.setGroupPayment(groupId, clientId, month, amount, false, null, null, tg?.group_instance_id||null))
      .then(()=>refreshGroupScreen(groupId))
      .catch(()=>toast('Ошибка','error'));
  }
}
async function doSetGroupPayment(groupId, clientId, month, paid) {
  const amount   = parseInt(document.getElementById('gp-amount')?.value)||0;
  const subStart = document.getElementById('gp-sub-start')?.value||null;
  const subEnd   = document.getElementById('gp-sub-end')?.value||null;
  document.querySelector('.modal-overlay')?.remove();
  try {
    // Берём instance_id для этой группы
    const tg = await DB.getTrainerGroupById(groupId);
    const instanceId = tg?.group_instance_id||null;
    await DB.setGroupPayment(groupId, clientId, month, amount, paid, subStart, subEnd, instanceId);
    DB.auditLog('group_payment', STATE.profile.id, STATE.profile.fio, groupId, 'group_payment',
      { client_id: clientId, amount, month, paid }, STATE.profile.branches?.[0]);
    toast('Оплата отмечена ✅','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function updateGroupClientLevel(clientId, level) {
  try {
    await DB.updateGroupClient(clientId, {level});
    toast('Уровень обновлён','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderGroupNoteModal(groupId, clientId, nameEnc, month, noteEnc) {
  const name = decodeURIComponent(nameEnc);
  const note = decodeURIComponent(noteEnc);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Заметка — ${esc(name)}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Прогресс за месяц</label>
      <textarea id="gn-note" rows="4" placeholder="Освоил технику кроля, работаем над дыханием..."
        style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px">${esc(note)}</textarea></div>
    <button class="btn btn-primary btn-full"
      onclick="doSaveGroupNote('${groupId}','${clientId}','${month}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveGroupNote(groupId, clientId, month) {
  const note = document.getElementById('gn-note')?.value.trim();
  try {
    await DB.saveGroupProgressNote(groupId, clientId, STATE.profile.id, month, note);
    DB.auditLog('group_progress_note', STATE.profile.id, STATE.profile.fio, groupId, 'group_progress',
      { client_id: clientId, month }, STATE.profile.branches?.[0]);
    document.querySelector('.modal-overlay')?.remove();
    toast('Заметка сохранена ✅','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function renderGroupArchiveModal(groupId, instanceId) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal"><div class="modal-header"><h3>📦 Архив группы</h3>
    <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div id="archive-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  document.body.appendChild(m);
  try {
    const archived = instanceId
      ? await DB.getArchivedGroupClientsByInstance(instanceId)
      : await DB.getArchivedGroupClients(groupId);
    const body = document.getElementById('archive-body');
    if (!archived.length) { body.innerHTML='<p class="hint">Архив пуст</p>'; return; }
    body.innerHTML=`<p class="hint" style="margin-bottom:12px">Нажмите «Вернуть», чтобы восстановить ребёнка в группу:</p>
      <div style="display:flex;flex-direction:column;gap:8px">
        ${archived.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 12px;background:var(--card);border:1px solid var(--border);border-radius:10px">
          <div>
            <div style="font-weight:500">${esc(c.name)}</div>
            <div style="font-size:12px;color:var(--hint)">${fmt(c.monthly_price||0)} сум/мес</div>
          </div>
          <button class="btn btn-sm btn-primary" style="font-size:12px" onclick="doRestoreGroupClient('${c.id}','${groupId}','${instanceId||''}')">Вернуть</button>
        </div>`).join('')}
      </div>`;
  } catch(e) { document.getElementById('archive-body').innerHTML='<p class="hint">Ошибка загрузки</p>'; console.error(e); }
}

async function doRestoreGroupClient(clientId, groupId, instanceId) {
  try {
    await DB.restoreGroupClient(clientId);
    toast('Ребёнок восстановлен','success');
    document.querySelector('.modal-overlay')?.remove();
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function archiveGroupClientConfirm(clientId, nameEnc, groupId) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${esc(name)}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:16px">Архив — скрыть из группы (можно вернуть). Удалить — навсегда.</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="doArchiveGroupClient('${clientId}','${groupId}')">📦 Архивировать</button>
      <button class="btn btn-full btn-danger"
        onclick="doDeleteGroupClient('${clientId}','${groupId}')">🗑 Удалить навсегда</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
async function doArchiveGroupClient(clientId, groupId) {
  document.querySelector('.modal-overlay')?.remove();
  try {
    await DB.archiveGroupClient(clientId);
    toast('Архивирован','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteGroupClient(clientId, groupId) {
  document.querySelector('.modal-overlay')?.remove();
  if (!confirm('Удалить безвозвратно?')) return;
  try {
    await DB.deleteGroupClient(clientId);
    DB.auditLog('group_client_remove', STATE.profile.id, STATE.profile.fio, clientId, 'group_client',
      { group_id: groupId }, STATE.profile.branches?.[0]);
    toast('Удалён','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function renderGroupAttendance(groupId) {
  // Берём instance_id группы
  const tg = await DB.getTrainerGroupById(groupId);
  const instanceId = tg?.group_instance_id||null;
  let clients = instanceId
    ? await DB.getGroupClientsByInstance(instanceId)
    : await DB.getGroupClients(groupId);
  // Если у группы есть подгруппы — отмечаем детей ВЫБРАННОЙ подгруппы (экран занятия)
  const g = (window._gd && String(window._gd.groupId)===String(groupId)) ? window._gd : null;
  const sub = g?.currentSubgroup||'';
  const hasSubs = !!(g && g.subgroups?.length);
  if (hasSubs) clients = clients.filter(c=>(c.subgroup||'')===sub);
  const today = todayStr();
  const existing = instanceId
    ? await DB.getGroupAttendanceByInstance(instanceId, today)
    : await DB.getGroupAttendance(groupId, today);
  const attMap = Object.fromEntries(existing.map(a=>[a.group_client_id, a.attended]));
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Посещаемость — ${today}${hasSubs?` · ${subLabel(sub)}`:''}</h3>
      <button class="btn-close" onclick="closeAttendanceModal(this)">✕</button></div>
    ${clients.map(c=>`
      <div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <span>${esc(c.name)}</span>
        <input type="checkbox" ${attMap[c.id]?'checked':''} style="width:20px;height:20px"
          onchange="saveAttendance('${groupId}','${c.id}','${today}',this.checked,'${instanceId||''}')">
      </div>`).join('')||'<p class="hint">В этой подгруппе детей нет</p>'}
    <button class="btn btn-primary btn-full" style="margin-top:12px"
      onclick="closeAttendanceModal(this)">Готово</button>
  </div>`;
  document.body.appendChild(m);
}
// Закрыть модал отметки и обновить счётчик «Отмечено сегодня» на экране занятия
function closeAttendanceModal(btn) {
  btn.closest('.modal-overlay')?.remove();
  if (window._gd?._screen==='session') renderGroupSessionScreenHtml();
}
async function saveAttendance(groupId, clientId, date, attended, instanceId='') {
  try {
    await DB.saveGroupAttendance(groupId, clientId, date, attended, instanceId||null);
    // Поддерживаем _gd.attMap актуальным — от него считается headcount «кто проводил»
    const g = window._gd;
    if (g && String(g.groupId)===String(groupId) && date===g.today) g.attMap[clientId] = attended;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderArchiveClientModal(clientId, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>📦 Архивировать клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;font-weight:500">${esc(fio)}</p>
    <p class="hint" style="margin-bottom:12px">Причина архивации:</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:20px">
      <label style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:10px;cursor:pointer">
        <input type="radio" name="arch-reason" value="stopped" style="width:18px;height:18px"> Перестали ходить</label>
      <label style="display:flex;align-items:center;gap:10px;padding:12px;background:var(--card);border:1px solid var(--border);border-radius:10px;cursor:pointer">
        <input type="radio" name="arch-reason" value="refund" style="width:18px;height:18px"> Потребовали возврат</label>
    </div>
    <div id="arch-confirm-wrap" style="display:none;background:rgba(239,68,68,.07);border:1px solid rgba(239,68,68,.2);border-radius:10px;padding:14px;margin-bottom:16px">
      <p style="margin:0 0 12px;font-weight:600;color:#ef4444">Вы уверены?</p>
      <p class="hint" style="margin:0 0 12px">Клиент уйдёт в архив. История тренировок сохранится. Новые списания будут недоступны.</p>
      <div style="display:flex;gap:8px">
        <button class="btn btn-primary" style="flex:1" onclick="doArchiveClientConfirmed('${clientId}')">Да, архивировать</button>
        <button class="btn" style="flex:1;background:var(--card);border:1px solid var(--border)" onclick="this.closest('.modal-overlay').remove()">Нет</button>
      </div>
    </div>
  </div>`;
  document.body.appendChild(m);
  m.querySelectorAll('input[name="arch-reason"]').forEach(r => {
    r.addEventListener('change', () => {
      document.getElementById('arch-confirm-wrap').style.display = '';
    });
  });
}
async function doArchiveClientConfirmed(clientId) {
  const reasonVal = document.querySelector('input[name="arch-reason"]:checked')?.value;
  const reasonMap = { stopped: 'Перестали ходить', refund: 'Потребовали возврат' };
  const reason = reasonMap[reasonVal] || '';
  try {
    await DB.archiveClient(clientId, reason);
    document.querySelector('.modal-overlay')?.remove();
    toast('Клиент архивирован','success');
    invalidateCache('clients');
    switchTab(STATE.currentTab||'clients');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderRestoreClientModal(clientId, fioEnc, backTab='home') {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>♻️ Восстановить клиента</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;font-weight:500">${esc(fio)}</p>
    <p class="hint" style="margin-bottom:16px">Клиент вернётся в активные. Баланс и история тренировок сохранены. Списания снова будут доступны.</p>
    <div style="display:flex;gap:8px">
      <button class="btn btn-primary" style="flex:1" onclick="doRestoreClientConfirmed('${clientId}','${backTab}')">Да, восстановить</button>
      <button class="btn" style="flex:1;background:var(--card);border:1px solid var(--border)" onclick="this.closest('.modal-overlay').remove()">Нет</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
async function doRestoreClientConfirmed(clientId, backTab='home') {
  try {
    await DB.restoreClient(clientId);
    document.querySelector('.modal-overlay')?.remove();
    toast('Клиент восстановлен','success');
    invalidateCache('clients');
    renderClientProfile(clientId, backTab);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function renderBranchAccessModal(trainerId, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const [allBranches, currentAccess] = await Promise.all([
    cached('branches',()=>DB.getBranches()),
    DB.getBranchAccess(trainerId),
  ]);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🔑 Субпанель — ${esc(fio)}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Выберите филиалы к которым тренер получит доступ к группам и отчётам (дополнительно к своим)</p>
    <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:16px">
      ${allBranches.map(b=>`<label style="display:flex;align-items:center;gap:8px;font-size:14px;cursor:pointer">
        <input type="checkbox" class="ba-cb" value="${esc(b.name)}" ${currentAccess.includes(b.name)?'checked':''} style="width:18px;height:18px">
        ${esc(b.name)}
      </label>`).join('')}
    </div>
    <button class="btn btn-primary btn-full" onclick="doSaveBranchAccess(${trainerId})">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveBranchAccess(trainerId) {
  const selected = [...document.querySelectorAll('.ba-cb:checked')].map(cb=>cb.value);
  try {
    await DB.setBranchAccess(trainerId, selected);
    document.querySelector('.modal-overlay')?.remove();
    toast(selected.length?`✅ Доступ к ${selected.length} филиал(ам) выдан`:'Доп. доступ убран','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doArchiveTrainer(id, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>📦 Архивировать</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;line-height:1.6">
      <b>${esc(fio)}</b> потеряет доступ к приложению.<br>
      История тренировок сохранится и будет видна координатору.<br>
      Тренер не сможет войти снова под этим именем.
    </p>
    <button class="btn btn-full" style="background:rgba(245,158,11,.15);color:#f59e0b;margin-bottom:8px"
      onclick="doArchiveConfirm(${id})">📦 Архивировать</button>
    <button class="btn btn-full" style="background:var(--card)"
      onclick="this.closest('.modal-overlay').remove()">Отмена</button>
  </div>`;
  document.body.appendChild(m);
}
async function doArchiveConfirm(id) {
  try {
    await DB.archiveTrainer(id);
    document.querySelector('.modal-overlay')?.remove();
    toast('Тренер архивирован','success');
    loadStaffList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doDeleteTrainer(id, fioEnc) {
  const fio = decodeURIComponent(fioEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🗑 Удалить профиль</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p style="margin-bottom:16px;line-height:1.6">
      <b>${esc(fio)}</b><br><br>
      <b>Если у тренера нет истории</b> — профиль удалится полностью. Тренер сможет создать новый аккаунт.<br><br>
      <b>Если история есть</b> — нельзя удалить, только архивировать.
    </p>
    <button class="btn btn-danger btn-full" style="margin-bottom:8px"
      onclick="doDeleteConfirm(${id})">🗑 Удалить</button>
    <button class="btn btn-full" style="background:var(--card)"
      onclick="this.closest('.modal-overlay').remove()">Отмена</button>
  </div>`;
  document.body.appendChild(m);
}
async function doDeleteConfirm(id) {
  try {
    await DB.deleteTrainer(id);
    document.querySelector('.modal-overlay')?.remove();
    toast('Профиль удалён','success');
    loadStaffList();
  } catch(e) {
    document.querySelector('.modal-overlay')?.remove();
    if (e.message === 'has_history') {
      toast('Есть история тренировок — используйте архивирование','error');
    } else {
      toast('Ошибка удаления','error');
    }
  }
}

// ─ ADMIN: ФИЛИАЛЫ
// ============================================================
// SECTION: ADMIN:BRANCHES — renderAdminBranches, CRUD филиалов
// ============================================================
async function renderAdminBranches() {
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>Филиалы</h3>
      <button class="btn btn-sm" onclick="renderAddBranchModal()">+ Добавить</button></div>
    <div id="branches-list"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  await loadBranchesList();
}
async function loadBranchesList() {
  const body=document.getElementById('branches-list'); if (!body) return;
  try {
    const branches=await cached('branches',()=>DB.getBranches());
    body.innerHTML=!branches.length?'<p class="hint">Нет филиалов</p>':
      branches.map(b=>`<div class="staff-card">
        <div class="staff-info"><div class="staff-fio">🏢 ${esc(b.name)}</div></div>
        <div style="display:flex;gap:6px">
          <button class="btn btn-sm" onclick="renderRenameBranchModal('${encArg(b.name)}')">✏️</button>
          <button class="btn btn-sm btn-danger" onclick="doDeleteBranch(${b.id},'${jsq(b.name)}')">🗑</button>
        </div>
      </div>`).join('');
  } catch(e) { console.error(e); body.innerHTML='<p class="hint">Ошибка</p>'; }
}
function renderAddBranchModal() {
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Новый филиал</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label><input id="br-name"></div>
    <button class="btn btn-primary btn-full" onclick="doAddBranch()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddBranch() {
  const name=document.getElementById('br-name')?.value.trim();
  if (!name) return toast('Введите название','error');
  try { await DB.addBranch(name); invalidateCache('branches'); document.querySelector('.modal-overlay')?.remove(); toast('✅','success'); loadBranchesList(); }
  catch(e) { console.error(e); toast('Такой уже есть','error'); }
}
function renderRenameBranchModal(nameEnc) {
  const name=decodeURIComponent(nameEnc);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Переименовать</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Обновит название во всех записях.</p>
    <div class="form-group"><label>Новое название</label>
      <input id="br-new-name" value="${esc(name)}"></div>
    <button class="btn btn-primary btn-full" onclick="doRenameBranch('${nameEnc}')">Переименовать</button>
  </div>`;
  document.body.appendChild(m);
}
async function doRenameBranch(oldEnc) {
  const oldName=decodeURIComponent(oldEnc);
  const newName=document.getElementById('br-new-name')?.value.trim();
  if (!newName||newName===oldName) return toast('Введите новое название','error');
  try { await DB.renameBranch(oldName,newName); document.querySelector('.modal-overlay')?.remove(); toast('✅ Переименовано везде','success'); loadBranchesList(); }
  catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteBranch(id,name) {
  if (!confirm(`Удалить «${name}»?`)) return;
  try { await DB.deleteBranch(id); toast('Удалено','success'); loadBranchesList(); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}


// ============================================================
// SECTION: ADMIN:SCHEDULE — renderAdminSchedule (вкладка «📅 Расписание» в навбаре)
// План из schedule_slots по филиалу/тренеру на неделю (без сверки с фактом).
// Карточка тренера; блок 🔔 (пуши по расписанию, notification_rules.schedule_reminder) — только isDev().
// ============================================================
const _ASCH = { branch:null, trainer:'all', week:0, types:{duty:true, group:true, pt:true}, key:null, data:null, seq:0 };
const _ASCH_TYPES = [['duty','🛎','Дежурства'], ['group','👥','Группы'], ['pt','🏊','ПТ']];
const _aschDs = d => `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`;
function _aschMonday(offset) {
  const m = new Date(); m.setHours(0,0,0,0);
  m.setDate(m.getDate() - (m.getDay()+6)%7 + offset*7);
  return m;
}

async function renderAdminSchedule() {
  const branches = (await cached('branches',()=>DB.getBranches())).map(b=>b.name);
  if (!branches.includes(_ASCH.branch)) _ASCH.branch = branches[0]||'';
  const sel = 'width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);margin-bottom:8px';
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="section-header"><h3>📅 Расписание</h3>
      <div class="month-nav">
        <button onclick="_aschWeek(-1)">‹</button><span id="asch-week"></span><button onclick="_aschWeek(1)">›</button>
      </div>
    </div>
    ${branches.length>1?`<select style="${sel}" onchange="_ASCH.branch=this.value;_ASCH.trainer='all';loadAdminSchedule()">
      ${branches.map(b=>`<option value="${esc(b)}" ${b===_ASCH.branch?'selected':''}>${esc(b)}</option>`).join('')}
    </select>`:''}
    <select id="asch-trainer" style="${sel}" onchange="_ASCH.trainer=this.value;_aschRender()"></select>
    <div id="asch-types" style="display:flex;gap:6px;margin-bottom:12px"></div>
    <div id="asch-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  loadAdminSchedule();
}

function _aschWeek(delta) { _ASCH.week += delta; loadAdminSchedule(); }
function _aschToggleType(t) { _ASCH.types[t] = !_ASCH.types[t]; _aschRender(); }

async function loadAdminSchedule() {
  const mon = _aschMonday(_ASCH.week), sun = new Date(mon); sun.setDate(mon.getDate()+6);
  const lbl = document.getElementById('asch-week');
  if (lbl) lbl.textContent = `${mon.getDate()}.${mon.getMonth()+1} – ${sun.getDate()}.${sun.getMonth()+1}`;
  const key = `${_ASCH.branch}|${_aschDs(mon)}`;
  if (_ASCH.key === key && _ASCH.data) { _aschRender(); return; }
  const body = document.getElementById('asch-body');
  if (body) body.innerHTML = '<div class="center-screen"><div class="spinner"></div></div>';
  const seq = ++_ASCH.seq; // защита от гонки при быстром листании недель
  try {
    const [slots, profiles, rule] = await Promise.all([
      DB.getBranchWeekSlots(_ASCH.branch, _aschDs(mon), _aschDs(sun)),
      cached('profiles',()=>DB.getAllProfiles()),
      isDev() ? DB.getScheduleReminderRule().catch(()=>null) : null,
    ]);
    const cancels = await DB.getSlotCancellations(slots.map(s=>s.id), _aschDs(mon), _aschDs(sun));
    if (seq !== _ASCH.seq) return;
    const trainers = (profiles||[]).filter(p=>['trainer','senior_trainer'].includes(p.role) && !p.is_archived
      && ((p.branches||[]).includes(_ASCH.branch) || slots.some(s=>s.trainer_id===p.id)))
      .sort((a,b)=>a.fio.localeCompare(b.fio,'ru'));
    _ASCH.key = key;
    _ASCH.data = { mon, slots, cancels, trainers, rule };
    if (_ASCH.trainer!=='all' && !trainers.some(t=>String(t.id)===String(_ASCH.trainer))) _ASCH.trainer = 'all';
    _aschRender();
  } catch(e) {
    console.error('[adminSchedule]', e);
    if (seq === _ASCH.seq && body) body.innerHTML = '<p class="hint">Не удалось загрузить расписание</p>';
  }
}

// 🔔 — тренер в списке напоминаний; возвращает массив типов или null
function _aschReminderTypes(rule, trainerId) {
  if (!rule?.active || !(rule.recipients||[]).includes(trainerId)) return null;
  return rule.schedule?.types?.[trainerId] || ['duty','group','pt'];
}

function _aschRender() {
  const D = _ASCH.data; if (!D) return;
  const {mon, slots, cancels, trainers, rule} = D;
  const one = _ASCH.trainer !== 'all' ? Number(_ASCH.trainer) : null;

  // Селект тренера: число слотов в неделю, 🔔 — только для isDev()
  const cnt = {}; slots.forEach(s=>{ cnt[s.trainer_id]=(cnt[s.trainer_id]||0)+1; });
  const tSel = document.getElementById('asch-trainer');
  if (tSel) tSel.innerHTML = `<option value="all">Все тренеры (${trainers.length})</option>` +
    trainers.map(t=>`<option value="${t.id}" ${one===t.id?'selected':''}>${esc(t.fio)}${cnt[t.id]?` · ${cnt[t.id]}`:' · нет расписания'}${isDev()&&_aschReminderTypes(rule,t.id)?' 🔔':''}</option>`).join('');

  const tBox = document.getElementById('asch-types');
  if (tBox) tBox.innerHTML = _ASCH_TYPES.map(([k,ic,l])=>`<button class="btn btn-sm" onclick="_aschToggleType('${k}')"
    style="flex:1;border-radius:16px;${_ASCH.types[k]?'background:var(--accent,#2563eb);color:#fff':'background:var(--card);border:1px solid var(--border);color:var(--hint)'}">${ic} ${l}</button>`).join('');

  const shown = slots.filter(s => _ASCH.types[s.slot_type] && (!one || s.trainer_id===one));
  const today = _aschDs(new Date());
  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  let html = one ? _aschTrainerCard(trainers.find(t=>t.id===one), slots.filter(s=>s.trainer_id===one), rule) : '';

  for (let d=0; d<7; d++) {
    const day = new Date(mon); day.setDate(mon.getDate()+d);
    const ds = _aschDs(day);
    const items = shown.filter(s => s.specific_date ? s.specific_date===ds : s.day_of_week===d)
      .sort((a,b)=> a.start_time<b.start_time?-1 : a.start_time>b.start_time?1 : (a.profiles?.fio||'').localeCompare(b.profiles?.fio||'','ru'));
    const isToday = ds===today, past = ds<today;
    html += `<div style="padding:8px 0;border-bottom:1px solid var(--border);${past?'opacity:.6':''}">
      <div style="font-size:12px;font-weight:700;margin-bottom:4px;color:${isToday?'var(--accent,#2563eb)':'var(--hint)'}">
        ${DAYS[d]} ${day.getDate()}.${day.getMonth()+1}${isToday?' · сегодня':''}</div>
      ${items.length ? items.map(s=>_aschRow(s, cancels.has(`${s.id}|${ds}`), !one)).join('')
                     : '<div style="font-size:12px;color:var(--hint);padding:2px 0">—</div>'}
    </div>`;
  }
  const body = document.getElementById('asch-body');
  if (body) body.innerHTML = html;
}

function _aschRow(s, cancelled, withTrainer) {
  const t = (s.start_time||'').slice(0,5), e = (s.end_time||'').slice(0,5);
  let icon, what;
  if (s.slot_type==='duty')       { icon='🛎'; what=`Дежурство ${t}–${e}`; }
  else if (s.slot_type==='group') { icon='👥'; what=`${t} ${esc(s.group_types?.name||'Группа')}`; }
  else                            { icon='🏊'; what=`${t} ПТ — ${esc(s.clients?.fio||'клиент')}`; }
  const noBal = s.slot_type==='pt' && (s.clients?.balance||0)<=0;
  const tags = [
    s.specific_date ? 'разово' : '',
    noBal ? 'нет остатка' : '',
    cancelled ? 'отменено' : '',
  ].filter(Boolean).map(x=>`<span style="font-size:10px;color:var(--hint);margin-left:4px">· ${x}</span>`).join('');
  const st = ['font-size:13px','padding:3px 0', cancelled&&'text-decoration:line-through', (cancelled||noBal)&&'opacity:.5'].filter(Boolean).join(';');
  return `<div style="${st}">
    ${icon} ${what}${withTrainer?` <span style="color:var(--hint)">· ${esc(s.profiles?.fio||'?')}</span>`:''}${tags}</div>`;
}

function _aschTrainerCard(t, tSlots, rule) {
  if (!t) return '';
  const by = {duty:0, group:0, pt:0}; tSlots.forEach(s=>{ by[s.slot_type]=(by[s.slot_type]||0)+1; });
  let bell = '';
  if (isDev()) {
    const types = _aschReminderTypes(rule, t.id);
    const name = {duty:'дежурства', group:'группы', pt:'ПТ'};
    const ev = rule?.schedule?.evening_hour ?? 20, before = Math.round((rule?.schedule?.before_min ?? 120)/60);
    bell = types
      ? `<div style="margin-top:8px;font-size:12px">🔔 Напоминания в бот: <b>${types.map(x=>name[x]||x).join(', ')}</b>
           <div class="hint" style="font-size:11px">вечером в ${ev}:00 — на завтра · за ${before} ч до начала</div></div>`
      : `<div style="margin-top:8px;font-size:12px;color:var(--hint)">🔕 Не в списке напоминаний</div>`;
  }
  // Последняя активность — подгружаем асинхронно в уже отрисованную карточку
  setTimeout(async () => {
    const el = document.getElementById('asch-last'); if (!el) return;
    try {
      const a = await DB.getTrainerLastActivity(t.id);
      const f = x => x ? new Date(x).toLocaleDateString('ru-RU',{day:'numeric',month:'short'}) : 'никогда';
      if (document.getElementById('asch-last')) el.textContent = `Последняя ПТ внесена: ${f(a.lastPt)} · дежурство: ${f(a.lastDuty)}`;
    } catch(e) { el.textContent = ''; }
  }, 0);
  return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:8px">
    <div style="font-weight:700">${esc(t.fio)}</div>
    <div class="hint" style="font-size:12px">${esc((t.branches||[]).join(', '))}</div>
    <div style="font-size:12px;margin-top:6px">В неделю: 🛎 ${by.duty} · 👥 ${by.group} · 🏊 ${by.pt}</div>
    <div id="asch-last" class="hint" style="font-size:11px;margin-top:2px">…</div>
    ${bell}
  </div>`;
}
