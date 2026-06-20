// =============================================
// app.shared.js — вынесено из app.js (Этап 3, пилот разбивки монолита)
// Секции: SHARED:DELETE / SHARED:PROFILE / SHARED:NOTIFICATIONS / SHARED:GROUP_MODALS
// ВАЖНО: грузится СТРОГО после app.js (top-level setInterval + bootstrap зависят
// от STATE и других глобалов). Порядок исполнения сохранён — поведение идентично монолиту.
// =============================================

// ============================================================
// SECTION: SHARED:DELETE — doDeleteClientCheck, doApproveDelete, doApproveWorkoutDelete
// ============================================================
async function doDeleteClientCheck(clientId, fioEnc, createdAt) {
  const fio = decodeURIComponent(fioEnc);
  const diffH = (Date.now() - new Date(createdAt).getTime()) / 3600000;
  if (diffH <= 24) {
    if (!confirm(`Удалить «${fio}» полностью?\nЭто действие нельзя отменить.`)) return;
    try {
      await DB.deleteClient(clientId);
      toast('Клиент удалён','success');
      switchTab(STATE.currentTab||'clients');
    } catch(e) { toast('Ошибка','error'); console.error(e); }
  } else {
    if (!confirm(`Отправить запрос на удаление «${fio}»?\nЗапрос уйдёт старшему тренеру или координатору.`)) return;
    try {
      await DB.createDeleteRequest(clientId, fio, STATE.profile.id, STATE.profile.branches?.[0]||'');
      toast('Запрос отправлен ✅','success');
    } catch(e) {
      if (e.message==='already_pending') toast('Запрос уже отправлен ранее','info');
      else { toast('Ошибка','error'); console.error(e); }
    }
  }
}

async function doApproveWorkoutDelete(reqId, workoutId) {
  if (_pending.has('wda_'+reqId)) return;
  if (!confirm('Удалить тренировку окончательно?')) return;
  _pending.add('wda_'+reqId);
  try {
    await DB.approveWorkoutDeleteRequest(reqId, workoutId);
    toast('Тренировка удалена','success');
    invalidateCachePrefix('adm_control'); adminTab('control');
  } catch(e) { console.error(e); toast('Ошибка','error'); }
  finally { _pending.delete('wda_'+reqId); }
}
async function doRejectWorkoutDelete(reqId) {
  if (_pending.has('wdr2_'+reqId)) return;
  _pending.add('wdr2_'+reqId);
  try {
    await DB.rejectWorkoutDeleteRequest(reqId);
    toast('Запрос отклонён','success');
    invalidateCachePrefix('adm_control'); adminTab('control');
  } catch(e) { console.error(e); toast('Ошибка','error'); }
  finally { _pending.delete('wdr2_'+reqId); }
}

async function doApproveDelete(reqId, clientId, nameEnc) {
  if (_pending.has('approve_'+reqId)) return;
  const fio = decodeURIComponent(nameEnc);
  try {
    // Check if client has records
    const {data:wks} = await sb().from('workouts').select('id').eq('client_id',clientId).limit(1);
    const hasRecords = wks && wks.length > 0;
    if (hasRecords) {
      const m = el('div','modal-overlay');
      m.innerHTML=`<div class="modal">
        <div class="modal-header"><h3>Удаление клиента</h3>
          <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
        <div class="warn-banner" style="margin-bottom:16px">
          ⚠️ У клиента <b>${fio}</b> есть история тренировок и записи.<br>
          Удаление уберёт все данные безвозвратно.
        </div>
        <button class="btn btn-full btn-danger" style="margin-bottom:8px"
          onclick="doForceDelete('${reqId}','${clientId}','${encodeURIComponent(fio)}')">
          🗑 Удалить принудительно вместе с историей</button>
        <button class="btn btn-full" style="background:var(--card)"
          onclick="this.closest('.modal-overlay').remove()">Отмена</button>
      </div>`;
      document.body.appendChild(m);
    } else {
      if (!confirm(`Удалить клиента «${fio}» окончательно?`)) return;
      _pending.add('approve_'+reqId);
      await DB.approveDeleteRequest(reqId, clientId);
      _pending.delete('approve_'+reqId);
      DB.auditLog('client_delete', STATE.profile.id, STATE.profile.fio, clientId, 'client',
        { fio, force: false }, STATE.profile.branches?.[0]);
      toast('Клиент удалён','success');
      invalidateCachePrefix('adm_control'); adminTab('control');
    }
  } catch(e) { _pending.delete('approve_'+reqId); toast('Ошибка','error'); console.error(e); }
}
async function doForceDelete(reqId, clientId, nameEnc) {
  if (_pending.has('force_'+reqId)) return;
  _pending.add('force_'+reqId);
  document.querySelector('.modal-overlay')?.remove();
  try {
    const fioDecoded = decodeURIComponent(nameEnc);
    await DB.approveDeleteRequest(reqId, clientId);
    DB.auditLog('client_delete', STATE.profile.id, STATE.profile.fio, clientId, 'client',
      { fio: fioDecoded, force: true }, STATE.profile.branches?.[0]);
    toast('Клиент удалён вместе с историей','success');
    invalidateCachePrefix('adm_control'); adminTab('control');
  } catch(e) { toast('Ошибка удаления','error'); console.error(e); }
  finally { _pending.delete('force_'+reqId); }
}
async function doRejectDelete(reqId) {
  if (_pending.has('reject_'+reqId)) return;
  _pending.add('reject_'+reqId);
  try {
    await DB.rejectDeleteRequest(reqId);
    toast('Запрос отклонён','success');
    invalidateCachePrefix('adm_control'); adminTab('control');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete('reject_'+reqId); }
}

// ── ЦВЕТА КЛИЕНТОВ ────────────────────────────────────────────────────────────

// setClientColor moved to module

// ── РЕДАКТИРОВАНИЕ ПРОФИЛЯ ТРЕНЕРОМ ──────────────────────────────────────────

// ============================================================
// SECTION: SHARED:PROFILE — renderTrainerEditProfile, doSaveTrainerProfile
// ============================================================
async function renderTrainerEditProfile() {
  const profile = STATE.profile;
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Мой профиль</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Фамилия Имя</label>
      <input id="ep-fio" type="text" value="${profile.fio}"></div>
    <div class="form-group"><label>Телефон</label>
      <input id="ep-phone" type="tel" placeholder="+998 90 000 00 00" value="${profile.phone||''}"></div>
    <div class="form-group"><label>Новый PIN (оставьте пустым чтобы не менять)</label>
      <input id="ep-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <div class="form-group"><label>Подтвердите PIN</label>
      <input id="ep-pin2" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <button class="btn btn-primary btn-full" onclick="doSaveTrainerProfile()">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveTrainerProfile() {
  const fio   = document.getElementById('ep-fio')?.value.trim();
  const phone = document.getElementById('ep-phone')?.value.trim();
  const pin   = document.getElementById('ep-pin')?.value;
  const pin2  = document.getElementById('ep-pin2')?.value;
  if (!fio) return toast('Введите ФИО','error');
  if (pin && !/^\d{4}$/.test(pin)) return toast('PIN: 4 цифры','error');
  if (pin && pin !== pin2) return toast('PIN не совпадает','error');
  try {
    const fields = {fio};
    if (phone) fields.phone = phone;
    if (pin) await DB.changePin(STATE.profile.id, pin);
    await DB.updateProfile(STATE.profile.id, fields);
    STATE.profile = {...STATE.profile, ...fields};
    document.querySelector('.modal-overlay')?.remove();
    toast('Профиль обновлён ✅','success');
    const sub = document.querySelector('.app-sub');
    if (sub) sub.textContent = fio;
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── УВЕДОМЛЕНИЯ ВНУТРИ ПРИЛОЖЕНИЯ ────────────────────────────────────────────

// ============================================================
// SECTION: SHARED:NOTIFICATIONS — checkInAppNotifications, renderAdminNotifications
// ============================================================
async function checkInAppNotifications() {
  try {
    const notifs = await DB.getMyNotifications(STATE.profile.tg_id);
    const unread = notifs.filter(n=>!n.read_at).length;
    const count = document.getElementById('notif-count');
    if (count) {
      count.style.display = unread > 0 ? '' : 'none';
      count.textContent = unread > 9 ? '9+' : String(unread);
    }
  } catch(e) { console.error(e); }
}
// Периодически проверяем новые уведомления каждые 60 секунд
setInterval(()=>{ if (STATE.profile?.tg_id) checkInAppNotifications(); }, 60000);
async function renderInAppNotifications() {
  try {
    const notifs = await DB.getMyNotifications(STATE.profile.tg_id);
    await DB.markNotificationsRead(STATE.profile.tg_id);
    checkInAppNotifications();
    const m = el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>🔔 Уведомления</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div style="max-height:60vh;overflow-y:auto">
      ${!notifs.length?'<p class="hint" style="text-align:center;padding:20px">Нет уведомлений</p>':
        notifs.map(n=>`<div style="padding:12px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:13px;line-height:1.5">${n.message}</div>
          <div style="font-size:11px;color:var(--hint);margin-top:4px">
            ${fmtDT(n.created_at)}
            ${!n.read_at?'<span style="color:var(--accent);margin-left:6px">● новое</span>':''}
          </div>
        </div>`).join('')}
      </div>
    </div>`;
    document.body.appendChild(m);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

function renderMissedSlotsPanel() {
  const slots = window._missedSlots || [];
  const date  = window._missedDate  || '';
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal" style="max-height:80vh;display:flex;flex-direction:column">
    <div class="modal-header" style="flex-shrink:0">
      <h3>⚠️ Пропущенные</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
    </div>
    <p class="hint" style="margin-bottom:12px;flex-shrink:0">Не внесено вчера · ${date}</p>
    <div style="overflow-y:auto;flex:1">
      ${!slots.length
        ? '<div class="empty-state" style="padding:30px 0">✅<p>Всё внесено!</p></div>'
        : slots.map(s=>renderTodaySlot(s, date)).join('')}
    </div>
  </div>`;
  document.body.appendChild(m);
}

async function renderAdminNotifications() {
  $('#tab-content').innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const [recent, profiles] = await Promise.all([
      DB.getRecentNotifications(50),
      DB.getAllProfiles(),
    ]);

    $('#tab-content').innerHTML=`<div class="tab-pad">
      <div class="section-header"><h3>Уведомления</h3></div>

      <!-- Отправить сообщение -->
      <div class="staff-card" style="flex-direction:column;gap:10px;margin-bottom:20px">
        <div style="font-weight:600;font-size:14px">📤 Отправить уведомление</div>
        <div class="form-group" style="margin-bottom:0">
          <label>Кому</label>
          <select id="notif-target">
            <option value="all">Всем сотрудникам</option>
            <option value="trainers">Всем тренерам</option>
            ${profiles.filter(p=>p.tg_id).map(p=>`<option value="${p.tg_id}">${p.fio}</option>`).join('')}
          </select>
        </div>
        <div class="form-group" style="margin-bottom:0">
          <label>Сообщение</label>
          <textarea id="notif-msg" rows="3" placeholder="Текст уведомления..."></textarea>
        </div>
        <button class="btn btn-primary btn-full" onclick="doSendAdminNotification()">Отправить</button>
      </div>

      <!-- История -->
      <h4 style="margin-bottom:12px">История (последние 50)</h4>
      ${!recent.length?'<p class="hint">Нет уведомлений</p>':
        recent.map(n=>`<div style="padding:10px 0;border-bottom:1px solid var(--border)">
          <div style="display:flex;justify-content:space-between;align-items:flex-start">
            <div style="flex:1">
              <div style="font-size:13px">${n.message}</div>
              <div style="font-size:11px;color:var(--hint);margin-top:3px">
                → ${n.recipient_name||n.recipient_tg_id} · ${fmtDT(n.created_at)}
                ${n.read_at?`<span style="color:#10b981;margin-left:6px">✓ прочитано</span>`:'<span style="color:var(--accent);margin-left:6px">● не прочитано</span>'}
              </div>
            </div>
          </div>
        </div>`).join('')}
    </div>`;
  } catch(e) { $('#tab-content').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
}

async function doSendAdminNotification() {
  const target  = document.getElementById('notif-target')?.value;
  const message = document.getElementById('notif-msg')?.value.trim();
  if (!message) return toast('Введите текст','error');
  try {
    const allProfiles = await DB.getAllProfiles();
    let recipients = [];
    if (target==='all') {
      recipients = allProfiles.filter(p=>p.tg_id);
    } else if (target==='trainers') {
      recipients = allProfiles.filter(p=>p.tg_id && ['trainer','senior_trainer'].includes(p.role));
    } else {
      const tgId = parseInt(target);
      recipients = allProfiles.filter(p=>p.tg_id===tgId);
    }
    if (!recipients.length) return toast('Нет получателей с привязанным аккаунтом','error');
    const count = await DB.queueBroadcast(recipients, message, null, STATE.profile.id);
    toast(`✅ Отправлено ${count} получател${count===1?'ю':'ям'}`, 'success');
    document.getElementById('notif-msg').value='';
    renderAdminNotifications();
  } catch(e) { toast('Ошибка: '+(e?.message||String(e)),'error'); console.error(e); }
}

// ── ЗАМЕНА В ГРУППАХ ──────────────────────────────────────────────────────────

// ── РАСПИСАНИЕ ГРУППЫ (дни/время) ────────────────────────────────────────────
async function resolveGroupDuplicate(flagId, status, groupId, monthStr) {
  try {
    await DB.resolveDuplicateFlag(flagId, status);
    if (status === 'merged') toast('Дубль помечен — удалите лишнего ребёнка вручную','success');
    else toast('Подтверждено: разные дети ✅','success');
    renderGroupMonthReport(groupId, monthStr);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ============================================================
// SECTION: SHARED:GROUP_MODALS — расписание группы, замены, взрослые группы
// ============================================================
function renderGroupScheduleModal(groupId, daysEnc, time) {
  const currentDays = JSON.parse(decodeURIComponent(daysEnc)||'[]');
  const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Расписание группы</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дни занятий</label>
      <div style="display:flex;gap:8px;flex-wrap:wrap;margin-top:6px">
        ${DAYS.map(d=>`<label style="display:flex;align-items:center;gap:4px;cursor:pointer">
          <input type="checkbox" class="sched-day" value="${d}" ${currentDays.includes(d)?'checked':''} style="width:18px;height:18px">
          <span style="font-size:14px">${d}</span>
        </label>`).join('')}
      </div>
    </div>
    <div class="form-group"><label>Время начала</label>
      <input type="time" id="sched-time" value="${time||''}"
        style="background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text);font-size:14px;width:100%;box-sizing:border-box">
    </div>
    <button class="btn btn-primary btn-full" onclick="doSaveGroupSchedule('${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doSaveGroupSchedule(groupId) {
  const days = [...document.querySelectorAll('.sched-day:checked')].map(cb=>cb.value);
  const time = document.getElementById('sched-time')?.value||null;
  if (!days.length) return toast('Выберите хотя бы один день','error');
  try {
    await DB.updateTrainerGroupSchedule(groupId, days, time);
    document.querySelector('.modal-overlay')?.remove();
    toast('Расписание сохранено ✅','success');
    // Из списка групп — перерисовать список; из хаба группы — перерисовать хаб
    if (document.getElementById('groups-list')) loadSeniorGroupsList();
    else if (window._gd?.groupId) renderGroupDetail(window._gd.groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── СВЯЗАТЬ ТРЕНЕРОВ В ОДИН INSTANCE (Арт-свим) ──────────────────────────────
async function renderLinkGroupInstanceModal(groupId) {
  // Ищем все группы того же типа и филиала с разными instance
  const {data:thisGroup} = await sb().from('trainer_groups')
    .select('group_type_id,branch,group_instance_id,group_types(name)')
    .eq('id',groupId).single();
  if (!thisGroup) return toast('Ошибка','error');

  const {data:candidates} = await sb().from('trainer_groups')
    .select('id,group_instance_id,days_of_week,session_time,profiles(fio)')
    .eq('group_type_id', thisGroup.group_type_id)
    .eq('branch', thisGroup.branch)
    .is('subscription_end',null)
    .neq('id', groupId)
    .neq('group_instance_id', thisGroup.group_instance_id);

  const groups = [];
  const seen = new Set();
  (candidates||[]).forEach(c=>{
    if (!seen.has(c.group_instance_id)) {
      seen.add(c.group_instance_id);
      const days = c.days_of_week?.join('/')|| 'без расписания';
      const t = c.session_time||'';
      groups.push({instance_id: c.group_instance_id, label: `${days}${t?' '+t:''}`});
    }
  });

  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Связать с группой</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">Выберите существующую группу ${thisGroup.group_types?.name||''} в ${thisGroup.branch}, к которой относится этот тренер. Они будут делить общий список детей и баланс.</p>
    ${!groups.length
      ? '<p class="hint">Других групп этого типа в этом филиале нет. Сначала задайте расписание каждой группе.</p>'
      : groups.map(g=>`
        <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border);margin-bottom:8px;text-align:left;padding:12px"
          onclick="doLinkGroupInstance('${groupId}','${g.instance_id}')">
          <div style="font-weight:600">${g.label}</div>
          <div style="font-size:12px;color:var(--hint)">instance: ${g.instance_id.slice(0,8)}...</div>
        </button>`).join('')}
    <button class="btn btn-full" style="margin-top:8px;background:rgba(239,68,68,.1);color:#ef4444"
      onclick="this.closest('.modal-overlay').remove()">Отмена</button>
  </div>`;
  document.body.appendChild(m);
}
async function doLinkGroupInstance(groupId, newInstanceId) {
  try {
    await DB.linkTrainerGroupInstance(groupId, newInstanceId);
    document.querySelector('.modal-overlay')?.remove();
    toast('Связано ✅','success');
    loadSeniorGroupsList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Экран «История замен» — список замен группы (создание замены живёт на «Занятие сегодня»)
async function renderGroupSubstitutionsHistory(groupId) {
  navPush(()=>renderGroupDetail(groupId));
  setupBack(()=>renderGroupDetail(groupId));
  loading('Загрузка замен...');
  try {
    const subs = await DB.getGroupSubstitutionsHistory(groupId);
    const statusMeta = {
      approved: {label:'утверждена', color:'#10b981', bg:'rgba(16,185,129,.12)'},
      pending:  {label:'⏳ ожидает', color:'#f59e0b', bg:'rgba(245,158,11,.12)'},
      rejected: {label:'отклонена', color:'#ef4444', bg:'rgba(239,68,68,.12)'},
    };
    const list = subs.length ? subs.map(s=>{
      const st = statusMeta[s.status]||statusMeta.pending;
      return `<div class="staff-card" style="flex-direction:column;align-items:stretch;gap:4px">
        <div style="display:flex;justify-content:space-between;align-items:center">
          <span style="font-size:14px;font-weight:500">${s.substitute?.fio||'?'}</span>
          <span style="font-size:11px;font-weight:600;color:${st.color};background:${st.bg};padding:2px 8px;border-radius:8px">${st.label}</span>
        </div>
        <div style="font-size:12px;color:var(--hint)">вместо ${s.original?.fio||'?'} · ${fmtDate(s.session_date)}${s.status==='approved'&&s.rate?` · ${fmt(s.rate)} сум`:''}</div>
      </div>`;
    }).join('') : '<div class="empty-state">🔄<p>Замен пока не было</p></div>';
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">История замен</div>
      <span></span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <button class="btn btn-primary btn-full" style="margin-bottom:12px"
        onclick="renderGroupSubstitutionModal('${groupId}')">＋ Новая замена</button>
      <div style="display:flex;flex-direction:column;gap:8px">${list}</div>
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function renderGroupSubstitutionModal(groupId) {
  try {
    const trainers = await cached('profiles',()=>DB.getAllProfiles());
    const others = trainers.filter(t=>
      ['trainer','senior_trainer'].includes(t.role) &&
      t.id !== STATE.profile.id && t.tg_id
    );
    const m = el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>Замена на занятии</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <p style="font-size:13px;color:var(--hint);margin-bottom:12px">Кто провёл занятие вместо вас?</p>
      <div class="form-group"><label>Дата занятия</label>
        <input type="date" id="sub-date" value="${new Date().toISOString().slice(0,10)}"></div>
      <div class="form-group"><label>Тренер-замена</label>
        <select id="sub-trainer">
          <option value="">— выберите —</option>
          ${others.map(t=>`<option value="${t.id}">${t.fio}</option>`).join('')}
        </select></div>
      <button class="btn btn-primary btn-full" onclick="doCreateSubstitution('${groupId}')">Отправить запрос</button>
    </div>`;
    document.body.appendChild(m);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doCreateSubstitution(groupId) {
  const date = document.getElementById('sub-date')?.value;
  const subId = parseInt(document.getElementById('sub-trainer')?.value);
  if (!date || !subId) return toast('Заполните все поля','error');
  try {
    await DB.createGroupSubstitution(groupId, STATE.profile.id, subId, date);
    DB.auditLog('group_substitution_create', STATE.profile.id, STATE.profile.fio, groupId, 'group_substitution',
      { substitute_id: subId, date }, STATE.profile.branches?.[0]);
    document.querySelector('.modal-overlay')?.remove();
    toast('Запрос отправлен старшему тренеру ✅','success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Для старшего тренера — одобрение замены со ставкой
async function renderPendingSubstitutions() {
  const body = document.getElementById('pending-subs'); if (!body) return;
  try {
    const subs = await DB.getPendingSubstitutions();
    if (!subs.length) { body.innerHTML=''; return; }
    body.innerHTML=`<div class="warn-banner" style="margin-bottom:12px">
      🔄 Запросы на замену (${subs.length})
      ${subs.map(s=>`<div style="padding:8px 0;border-top:1px solid rgba(255,255,255,.1)">
        <div style="font-size:12px">${s.trainer_groups?.group_types?.name||'Группа'} · ${s.session_date}</div>
        <div style="font-size:12px">Провёл: <b>${s.substitute?.fio||'?'}</b> вместо ${s.original?.fio||'?'}</div>
        <div style="display:flex;gap:6px;margin-top:6px;align-items:center">
          <input type="number" id="sub-rate-${s.id}" placeholder="Ставка (сум)" 
            style="flex:1;background:var(--card);border:1px solid var(--border);border-radius:6px;padding:6px;color:var(--text);font-size:12px">
          <button class="btn btn-sm btn-primary" onclick="doApproveSubstitution('${s.id}')">✓</button>
        </div>
      </div>`).join('')}
    </div>`;
  } catch(e) { console.error(e); }
}
async function doApproveSubstitution(id) {
  const rate = parseFloat(document.getElementById(`sub-rate-${id}`)?.value)||0;
  if (!rate) return toast('Укажите ставку','error');
  try {
    await DB.approveSubstitution(id, rate);
    DB.auditLog('group_substitution_approve', STATE.profile.id, STATE.profile.fio, id, 'group_substitution',
      { rate }, STATE.profile.branches?.[0]);
    toast('Замена одобрена ✅','success');
    renderPendingSubstitutions();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── ВЗРОСЛЫЕ ГРУППЫ — КЛИЕНТЫ ────────────────────────────────────────────────

// Точка возврата на вкладку «Группы» по роли — переустанавливаем при заходе в хаб.
function _backToGroupsByRole() {
  const role = curRole();
  if (role==='admin'||role==='ceo') return ()=>renderAdminApp('groups');
  if (role==='senior_trainer')      return ()=>renderSeniorApp('groups');
  return ()=>renderTrainerShell('groups');
}

// Загрузить занятия взрослой группы за месяц (для тренера — только его).
async function _loadAdultSessions(tgInfo, monthStr) {
  const [mYear, mMonth] = monthStr.split('-').map(Number);
  const toDay = new Date(mYear, mMonth, 1).toISOString().slice(0,10);
  const isAdminView = ['admin','ceo','senior_trainer'].includes(STATE.profile.role);
  let q = sb().from('group_sessions').select('*, profiles(fio)')
    .eq('group_type_id', tgInfo?.group_type_id||0)
    .eq('branch', tgInfo?.branch||'')
    .gte('session_date',monthStr).lt('session_date',toDay)
    .order('session_date',{ascending:false});
  if (!isAdminView) q = q.eq('trainer_id', STATE.profile.id);
  return q.then(r=>r.data||[]);
}

// ═══ ХАБ ВЗРОСЛОЙ ГРУППЫ (Акваджим / Аквафитнес) ═══
// Единый стиль с детским хабом: шапка-инфо + разделы крупными кнопками.
// Биллинг по явке (getAdultGroupRate), участники без оплат/подгрупп.
async function renderAdultGroupDetail(groupId) {
  const role = STATE.profile?.role;
  const canPayroll = ['admin','senior_trainer'].includes(role);
  const back = _backToGroupsByRole();
  navPush(back);
  setupBack(back);
  const month = new Date().toISOString().slice(0,7)+'-01';
  loading('Загрузка...');
  try {
    const {data:tgInfo} = await sb().from('trainer_groups')
      .select('branch,group_type_id,group_types(name)').eq('id',groupId).single();
    const [clients, sessions] = await Promise.all([
      DB.getAdultGroupClients(groupId),
      _loadAdultSessions(tgInfo, month),
    ]);
    const branch = tgInfo?.branch||'';
    const monthTotal = sessions.reduce((s,x)=>s+getAdultGroupRate(x.headcount),0);
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">${tgInfo?.group_types?.name||'Группа'}</div>
      <span style="font-size:12px;color:var(--hint)">${branch}</span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="staff-card" style="flex-direction:column;align-items:stretch;gap:8px;margin-bottom:14px">
        ${groupHubInfoRow('Филиал', `<span style="font-weight:600;font-size:13px">${branch}</span>`)}
        ${groupHubInfoRow('Участников', `<span style="font-weight:600;font-size:13px">${clients.length}</span>`)}
        ${groupHubInfoRow('Занятий в этом месяце', `<span style="font-weight:600;font-size:13px">${sessions.length}${monthTotal?` · ${fmt(monthTotal)} сум`:''}</span>`)}
      </div>
      ${groupHubSection('Управление')}
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
        ${canPayroll?groupHubBigBtn('👥','Персонал','тренеры · ставки · расписание',`openSeniorGroupPersonnel('${groupId}')`):''}
        ${groupHubBigBtn('👤',`Участники (${clients.length})`,'добавление · архив',`renderAdultGroupMembers('${groupId}')`)}
      </div>

      ${groupHubSection('Занятия')}
      <div style="display:flex;flex-direction:column;gap:8px;margin-bottom:8px">
        ${groupHubBigBtn('📊','Отметить занятие','кто был · ставка по явке',`renderAdultGroupHeadcount('${groupId}')`)}
        ${groupHubBigBtn('📅','История занятий','по месяцам · правка/удаление',`renderAdultGroupHistory('${groupId}')`)}
        ${groupHubBigBtn('🔄','История замен','прошедшие и текущие замены',`renderGroupSubstitutionsHistory('${groupId}')`)}
      </div>

      ${groupHubSection('Финансы и отчёты')}
      <div style="display:flex;flex-direction:column;gap:8px">
        ${groupHubBigBtn('💰','Отчёт за месяц','занятия · сумма по тренерам',`renderAdultGroupReport('${groupId}')`)}
      </div>
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Список участников взрослой группы
async function renderAdultGroupMembers(groupId) {
  navPush(()=>renderAdultGroupDetail(groupId));
  setupBack(()=>renderAdultGroupDetail(groupId));
  loading('Загрузка...');
  try {
    const clients = await DB.getAdultGroupClients(groupId);
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">Участники</div>
      <button class="btn btn-sm" onclick="renderAddAdultGroupClientModal('${groupId}')">+ Участник</button>
    </div>
    <div class="tab-content"><div class="tab-pad">
      ${!clients.length?'<div class="empty-state">👤<p>Участников нет</p></div>':
        clients.map(c=>`<div class="staff-card" style="justify-content:space-between">
          <span>${c.name}</span>
          <button class="btn btn-sm btn-danger" onclick="archiveAdultClientConfirm('${c.id}','${encodeURIComponent(c.name)}','${groupId}')">✕</button>
        </div>`).join('')}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// История занятий взрослой группы с навигацией по месяцам
async function renderAdultGroupHistory(groupId, monthStr) {
  navPush(()=>renderAdultGroupDetail(groupId));
  setupBack(()=>renderAdultGroupDetail(groupId));
  if (!monthStr) monthStr = new Date().toISOString().slice(0,7)+'-01';
  loading('Загрузка...');
  try {
    const {data:tgInfo} = await sb().from('trainer_groups')
      .select('branch,group_type_id,group_types(name)').eq('id',groupId).single();
    const [mYear, mMonth] = monthStr.split('-').map(Number);
    const prevMonth = mMonth===1 ? `${mYear-1}-12-01` : `${mYear}-${String(mMonth-1).padStart(2,'0')}-01`;
    const nextMonth = mMonth===12 ? `${mYear+1}-01-01` : `${mYear}-${String(mMonth+1).padStart(2,'0')}-01`;
    const isCurrentMonth = monthStr === new Date().toISOString().slice(0,7)+'-01';
    const isAdminView = ['admin','ceo','senior_trainer'].includes(STATE.profile.role);
    const sessions = await _loadAdultSessions(tgInfo, monthStr);
    const monthLabel = new Date(mYear,mMonth-1,1).toLocaleString('ru-RU',{month:'long',year:'numeric'});
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">История занятий</div>
      ${isCurrentMonth?`<button class="btn btn-sm" onclick="renderAddManualGroupSession('${groupId}')">+ Добавить</button>`:'<span></span>'}
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="section-header">
        <div class="month-nav" style="display:flex;align-items:center;gap:4px;width:100%;justify-content:center">
          <button onclick="renderAdultGroupHistory('${groupId}','${prevMonth}')">‹</button>
          <span style="font-size:13px;min-width:120px;text-align:center">${monthLabel}</span>
          <button ${isCurrentMonth?'disabled':''} onclick="renderAdultGroupHistory('${groupId}','${nextMonth}')">›</button>
        </div>
      </div>
      ${!sessions.length?'<div class="empty-state">📅<p>Нет занятий за этот месяц</p></div>':sessions.map(s=>{
        const rate = getAdultGroupRate(s.headcount);
        return `<div class="history-item">
          <div class="hi-main">
            <span class="hi-client">${fmtDate(s.session_date)}</span>
            <span class="hi-cat" style="background:rgba(16,185,129,.15);color:#10b981">${fmt(rate)} сум</span>
            <span class="hint">${s.headcount} чел.</span>
            ${isAdminView && s.profiles?.fio ? `<span class="hint" style="font-size:11px">· ${s.profiles.fio}</span>` : ''}
          </div>
          ${isCurrentMonth?`<div style="display:flex;gap:6px;margin-top:4px">
            <button class="btn btn-sm" style="font-size:11px;background:var(--card);border:1px solid var(--border)"
              onclick="renderEditGroupSession('${s.id}','${s.session_date}',${s.headcount},'${groupId}')">✏️</button>
            <button class="btn btn-sm btn-danger" style="font-size:11px"
              onclick="doDeleteGroupSession('${s.id}','${groupId}')">🗑</button>
          </div>`:''}
        </div>`;
      }).join('')}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Отчёт за месяц по взрослой группе — занятия и сумма в разрезе тренеров
async function renderAdultGroupReport(groupId, monthStr) {
  navPush(()=>renderAdultGroupDetail(groupId));
  setupBack(()=>renderAdultGroupDetail(groupId));
  if (!monthStr) monthStr = new Date().toISOString().slice(0,7)+'-01';
  loading('Загрузка...');
  try {
    const {data:tgInfo} = await sb().from('trainer_groups')
      .select('branch,group_type_id,group_types(name)').eq('id',groupId).single();
    const [mYear, mMonth] = monthStr.split('-').map(Number);
    const prevMonth = mMonth===1 ? `${mYear-1}-12-01` : `${mYear}-${String(mMonth-1).padStart(2,'0')}-01`;
    const nextMonth = mMonth===12 ? `${mYear+1}-01-01` : `${mYear}-${String(mMonth+1).padStart(2,'0')}-01`;
    const isCurrentMonth = monthStr === new Date().toISOString().slice(0,7)+'-01';
    const sessions = await _loadAdultSessions(tgInfo, monthStr);
    const monthLabel = new Date(mYear,mMonth-1,1).toLocaleString('ru-RU',{month:'long',year:'numeric'});
    const byTrainer = {};
    sessions.forEach(s=>{
      const k = s.trainer_id;
      (byTrainer[k] ||= {fio: s.profiles?.fio||'?', count:0, sum:0});
      byTrainer[k].count++;
      byTrainer[k].sum += getAdultGroupRate(s.headcount);
    });
    const rows = Object.values(byTrainer).sort((a,b)=>b.sum-a.sum);
    const total = rows.reduce((s,r)=>s+r.sum,0);
    setScreen(`<div class="app-header">
      ${backBtn()}
      <div class="app-title">Отчёт за месяц</div>
      <span></span>
    </div>
    <div class="tab-content"><div class="tab-pad">
      <div class="section-header">
        <div class="month-nav" style="display:flex;align-items:center;gap:4px;width:100%;justify-content:center">
          <button onclick="renderAdultGroupReport('${groupId}','${prevMonth}')">‹</button>
          <span style="font-size:13px;min-width:120px;text-align:center">${monthLabel}</span>
          <button ${isCurrentMonth?'disabled':''} onclick="renderAdultGroupReport('${groupId}','${nextMonth}')">›</button>
        </div>
      </div>
      <div class="staff-card" style="flex-direction:column;align-items:stretch;gap:8px;margin-bottom:14px">
        ${groupHubInfoRow('Всего занятий', `<span style="font-weight:600;font-size:13px">${sessions.length}</span>`)}
        ${groupHubInfoRow('Итого', `<span style="font-weight:700;font-size:14px;color:#10b981">${fmt(total)} сум</span>`)}
      </div>
      ${!rows.length?'<div class="empty-state">💰<p>Нет занятий за этот месяц</p></div>':rows.map(r=>`
        <div class="staff-card" style="justify-content:space-between">
          <div><div class="staff-fio">${r.fio}</div><div class="staff-meta">${r.count} занятий</div></div>
          <span style="font-weight:600;color:#10b981">${fmt(r.sum)} сум</span>
        </div>`).join('')}
    </div></div>`);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
function renderAddAdultGroupClientModal(groupId) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить участника</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Имя Фамилия</label>
      <input id="agc-name" type="text" placeholder="Иванов Иван"></div>
    <button class="btn btn-primary btn-full" onclick="doAddAdultGroupClient('${groupId}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddAdultGroupClient(groupId) {
  const name = document.getElementById('agc-name')?.value.trim();
  if (!name) return toast('Введите имя','error');
  try {
    await DB.addAdultGroupClient(groupId, name);
    document.querySelector('.modal-overlay')?.remove();
    toast('Добавлено ✅','success');
    renderAdultGroupMembers(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
// ── РЕДАКЦИЯ ГРУПП ────────────────────────────────────────────

// Редактировать ребёнка (имя, возраст, цена)
function renderEditGroupClientModal(clientId, nameEnc, age, price, groupId) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать ребёнка</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Имя</label>
      <input id="egc-name" value="${name}"></div>
    <div class="form-group"><label>Возраст</label>
      <input id="egc-age" type="number" min="3" max="18" value="${age||''}"></div>
    <div class="form-group"><label>Стоимость (сум/мес)</label>
      <input id="egc-price" type="number" value="${price||0}"></div>
    <button class="btn btn-primary btn-full" onclick="doEditGroupClient('${clientId}','${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditGroupClient(clientId, groupId) {
  const name  = document.getElementById('egc-name')?.value.trim();
  const age   = parseInt(document.getElementById('egc-age')?.value)||null;
  const price = parseInt(document.getElementById('egc-price')?.value)||0;
  if (!name) return toast('Введите имя','error');
  try {
    await DB.updateGroupClient(clientId, {name, age, monthly_price:price});
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Сохранено','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Открыть редактор посещаемости за конкретную дату из истории
async function renderGroupAttendanceEdit(groupId, date) {
  const {data:tg} = await sb().from('trainer_groups')
    .select('group_instance_id').eq('id',groupId).single();
  const instanceId = tg?.group_instance_id||null;
  const [clients, existing] = await Promise.all([
    instanceId ? DB.getGroupClientsByInstance(instanceId) : DB.getGroupClients(groupId),
    instanceId ? DB.getGroupAttendanceByInstance(instanceId, date) : DB.getGroupAttendance(groupId, date),
  ]);
  const attMap = Object.fromEntries(existing.map(a=>[a.group_client_id, a.attended]));
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Посещаемость: ${fmtDate(date)}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div id="att-list">
      ${clients.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <span style="font-size:14px">${c.name}</span>
        <input type="checkbox" id="att-${c.id}" ${attMap[c.id]?'checked':''} style="width:22px;height:22px">
      </div>`).join('')}
    </div>
    <input type="hidden" id="att-date" value="${date}">
    <input type="hidden" id="att-instance" value="${instanceId||''}">
    <button class="btn btn-primary btn-full" style="margin-top:12px"
      onclick="saveAttendanceByDate('${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}

// Посещаемость за другую дату
async function renderGroupAttendanceByDate(groupId) {
  const {data:tg} = await sb().from('trainer_groups')
    .select('group_instance_id').eq('id',groupId).single();
  const instanceId = tg?.group_instance_id||null;
  const clients = instanceId
    ? await DB.getGroupClientsByInstance(instanceId)
    : await DB.getGroupClients(groupId);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Посещаемость за дату</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дата</label>
      <input type="date" id="att-date" value="${todayStr()}" onchange="loadAttendanceForDate('${groupId}',this.value,'${instanceId||''}')"></div>
    <div id="att-list">
      ${clients.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:10px 0;border-bottom:1px solid var(--border)">
        <span>${c.name}</span>
        <input type="checkbox" id="att-${c.id}" style="width:20px;height:20px">
      </div>`).join('')}
    </div>
    <input type="hidden" id="att-instance" value="${instanceId||''}">
    <button class="btn btn-primary btn-full" style="margin-top:12px"
      onclick="saveAttendanceByDate('${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
  await loadAttendanceForDate(groupId, todayStr(), instanceId||'');
}
async function loadAttendanceForDate(groupId, date, instanceId='') {
  try {
    const existing = instanceId
      ? await DB.getGroupAttendanceByInstance(instanceId, date)
      : await DB.getGroupAttendance(groupId, date);
    const attMap = Object.fromEntries(existing.map(a=>[a.group_client_id, a.attended]));
    const clients = instanceId
      ? await DB.getGroupClientsByInstance(instanceId)
      : await DB.getGroupClients(groupId);
    clients.forEach(c=>{
      const cb = document.getElementById(`att-${c.id}`);
      if (cb) cb.checked = attMap[c.id]||false;
    });
  } catch(e) { console.error(e); }
}
async function saveAttendanceByDate(groupId) {
  const date = document.getElementById('att-date')?.value;
  const instanceId = document.getElementById('att-instance')?.value||null;
  if (!date) return toast('Выберите дату','error');
  const clients = instanceId
    ? await DB.getGroupClientsByInstance(instanceId)
    : await DB.getGroupClients(groupId);
  try {
    // Снимаем значения ДО удаления модала
    const checked = Object.fromEntries(clients.map(c=>[c.id, document.getElementById(`att-${c.id}`)?.checked||false]));
    await Promise.all(clients.map(c=>
      DB.saveGroupAttendance(groupId, c.id, date, checked[c.id], instanceId||null)
    ));
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Посещаемость сохранена','success');
    // Обновляем открытый экран группы (история/занятие), если правили из него
    const g = window._gd;
    if (g && String(g.groupId)===String(groupId)) {
      if (date===g.today) clients.forEach(c=>{ g.attMap[c.id] = checked[c.id]; });
      if (g._screen==='history'||g._screen==='session') refreshGroupScreen(groupId);
    }
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Добавить занятие взрослой группы вручную (за прошедшую дату)
function renderAddManualGroupSession(groupId) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Добавить занятие</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дата</label>
      <input type="date" id="mgs-date" value="${todayStr()}"></div>
    <div class="form-group"><label>Явка (кол-во человек)</label>
      <input type="number" id="mgs-count" min="1" placeholder="0"></div>
    <button class="btn btn-primary btn-full" onclick="doAddManualGroupSession('${groupId}')">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddManualGroupSession(groupId) {
  const date = document.getElementById('mgs-date')?.value;
  const headcount = parseInt(document.getElementById('mgs-count')?.value||0);
  if (!date || !headcount) return toast('Заполните дату и явку','error');
  try {
    const {data:tg} = await sb().from('trainer_groups')
      .select('branch,group_type_id,trainer_id').eq('id',groupId).single();
    // Используем trainer_id из группы (не STATE.profile.id — координатор мог добавлять)
    const logTrainerId = tg?.trainer_id || STATE.profile.id;
    await DB.logGroupSession(logTrainerId, tg?.group_type_id, tg?.branch||'', date, headcount);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Занятие добавлено','success');
    renderAdultGroupHistory(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// Редактировать занятие взрослой группы
function renderEditGroupSession(sessionId, date, headcount, groupId) {
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать занятие</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Дата</label>
      <input type="date" id="egs-date" value="${date}"></div>
    <div class="form-group"><label>Явка (чел.)</label>
      <input type="number" id="egs-count" value="${headcount}" min="1"></div>
    <button class="btn btn-primary btn-full" onclick="doEditGroupSession('${sessionId}','${groupId}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditGroupSession(sessionId, groupId) {
  const date      = document.getElementById('egs-date')?.value;
  const headcount = parseInt(document.getElementById('egs-count')?.value||0);
  if (!date || !headcount) return toast('Заполните поля','error');
  try {
    await sb().from('group_sessions').update({session_date:date, headcount}).eq('id',sessionId);
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Обновлено','success');
    renderAdultGroupHistory(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteGroupSession(sessionId, groupId) {
  if (!confirm('Удалить занятие?')) return;
  try {
    await sb().from('group_sessions').delete().eq('id',sessionId);
    toast('Удалено','success');
    renderAdultGroupHistory(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doDeleteAttendanceDay(groupId, date) {
  if (!confirm(`Удалить запись о занятии ${fmtDate(date)}?`)) return;
  if (_pending.has(`delday_${groupId}_${date}`)) return;
  _pending.add(`delday_${groupId}_${date}`);
  try {
    // instance_id из контекста — иначе удалялись бы только строки с group_id этого тренера
    const instId = (window._gd && String(window._gd.groupId)===String(groupId)) ? window._gd.instanceId : null;
    await DB.deleteGroupAttendanceDay(groupId, date, instId||null);
    toast('Занятие удалено','success');
    refreshGroupScreen(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(`delday_${groupId}_${date}`); }
}

function archiveAdultClientConfirm(id, nameEnc, groupId) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>${name}</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:16px">Архив — скрыть из группы. Удалить — навсегда.</p>
    <div style="display:flex;flex-direction:column;gap:8px">
      <button class="btn btn-full" style="background:var(--card);border:1px solid var(--border)"
        onclick="doArchiveAdultClient('${id}','${groupId}')">📦 Архивировать</button>
      <button class="btn btn-full btn-danger"
        onclick="doDeleteAdultGroupClient('${id}','${groupId}')">🗑 Удалить навсегда</button>
    </div>
  </div>`;
  document.body.appendChild(m);
}
async function archiveAdultClient(id, groupId) {
  archiveAdultClientConfirm(id, encodeURIComponent('участник'), groupId);
}
async function doArchiveAdultClient(id, groupId) {
  document.querySelector('.modal-overlay')?.remove();
  try {
    await DB.archiveAdultGroupClient(id);
    toast('Архивирован','success');
    renderAdultGroupMembers(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteAdultGroupClient(id, groupId) {
  document.querySelector('.modal-overlay')?.remove();
  if (!confirm('Удалить безвозвратно?')) return;
  try {
    await DB.deleteAdultGroupClient(id);
    toast('Удалён','success');
    renderAdultGroupMembers(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function renderAdultGroupHeadcount(groupId) {
  try {
    const clients = await DB.getAdultGroupClients(groupId);
    const m = el('div','modal-overlay');
    m.innerHTML=`<div class="modal">
      <div class="modal-header"><h3>Отметить занятие</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
      <div style="display:flex;gap:8px">
        <div class="form-group" style="flex:1"><label>Дата</label>
          <input type="date" id="ag-hc-date" value="${new Date().toISOString().slice(0,10)}"></div>
        <div class="form-group" style="flex:1"><label>Время начала</label>
          <select id="ag-hc-time" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:10px;color:var(--text)">
            ${Array.from({length:14},(_,i)=>{const h=7+i;return `<option value="${String(h).padStart(2,'0')}:00">${String(h).padStart(2,'0')}:00</option>`;}).join('')}
          </select></div>
      </div>
      <div style="margin-bottom:12px">
        <label style="font-size:13px;font-weight:600">Кто был:</label>
        ${clients.map(c=>`<div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
          <span>${c.name}</span>
          <input type="checkbox" id="hc-${c.id}" style="width:20px;height:20px">
        </div>`).join('')}
        ${!clients.length?`<div class="form-group" style="margin-top:8px"><label>Или введите количество вручную</label>
          <input type="number" id="ag-hc-count" min="0" placeholder="0"></div>`:''}
      </div>
      <button class="btn btn-primary btn-full" onclick="doLogAdultGroupSession('${groupId}')">Записать</button>
    </div>`;
    document.body.appendChild(m);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doLogAdultGroupSession(groupId) {
  const date = document.getElementById('ag-hc-date')?.value;
  const clients = await DB.getAdultGroupClients(groupId);
  let headcount = 0;
  const clientIds = [];
  if (clients.length) {
    clients.forEach(c=>{
      if (document.getElementById(`hc-${c.id}`)?.checked) {
        headcount++;
        clientIds.push(c.id);
      }
    });
  } else {
    headcount = parseInt(document.getElementById('ag-hc-count')?.value)||0;
  }
  if (!headcount) return toast('Укажите хотя бы одного участника','error');
  const time = document.getElementById('ag-hc-time')?.value||'09:00';
  try {
    const {data:tg} = await sb().from('trainer_groups')
      .select('branch,group_type_id').eq('id',groupId).single();
    await DB.logGroupSession(STATE.profile.id, tg?.group_type_id||null, tg?.branch||STATE.profile.branches?.[0]||'', date, headcount);
    DB.auditLog('group_session', STATE.profile.id, STATE.profile.fio, groupId, 'group_session',
      { date, headcount, branch: tg?.branch }, tg?.branch||STATE.profile.branches?.[0]);
    document.querySelector('.modal-overlay')?.remove();
    const rate = headcount>=7?130000:headcount>=4?120000:110000;
    toast(`Записано: ${headcount} чел. · ${(rate/1000).toFixed(0)}к сум · ${time} ✅`,'success');
    // Обновляем хаб, чтобы счётчик занятий/сумма за месяц подтянулись
    if (typeof renderAdultGroupDetail==='function') renderAdultGroupDetail(groupId);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

// ── СВОДНОЕ РАСПИСАНИЕ КООРДИНАТОРА ──────────────────────────────────────────

async function renderCoordinatorSchedule() {
  const branches = (await cached('branches',()=>DB.getBranches())).map(b=>b.name);
  let selBranch = branches[0]||'';
  
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>📅 Расписание</h3>
      <div class="month-nav">
        <button id="cs-prev">‹</button>
        <span id="cs-week-label"></span>
        <button id="cs-next">›</button>
      </div>
    </div>
    ${branches.length>1?`<select id="cs-branch" style="width:100%;background:var(--card);border:1px solid var(--border);border-radius:8px;padding:8px;color:var(--text);margin-bottom:12px"
      onchange="selBranch=this.value;window._csLoad&&window._csLoad()">
      ${branches.map(b=>`<option>${b}</option>`).join('')}
    </select>`:''}
    <div id="cs-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;

  let weekOffset = 0;

  const load = async () => {
    window._csLoad = load; // делаем доступной из onchange
    const body = document.getElementById('cs-body'); if (!body) return;
    const branch = document.getElementById('cs-branch')?.value || selBranch;
    const now = new Date();
    const mon = new Date(now);
    mon.setDate(now.getDate() - (now.getDay()+6)%7 + weekOffset*7);
    mon.setHours(0,0,0,0);
    const sun = new Date(mon); sun.setDate(mon.getDate()+6);
    
    const label = document.getElementById('cs-week-label');
    if (label) label.textContent = `${mon.getDate()}.${mon.getMonth()+1} – ${sun.getDate()}.${sun.getMonth()+1}`;
    
    body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
    try {
      const DAYS = ['Пн','Вт','Ср','Чт','Пт','Сб','Вс'];
      const trainers = (await cached('profiles',()=>DB.getAllProfiles())).filter(t=>
        ['trainer','senior_trainer'].includes(t.role) &&
        (t.branches||[]).includes(branch)
      );
      
      const from = mon.toISOString();
      const to   = sun.toISOString();
      
      // Load duties for the week for this branch
      const dutiesRes = await DB.getDutiesForSchedule(branch, from, to);
      const duties = dutiesRes||[];

      let html = '';
      for (let d=0; d<7; d++) {
        const day = new Date(mon); day.setDate(mon.getDate()+d);
        const dayStr = day.toISOString().slice(0,10);
        const dayDuties = duties.filter(duty=>duty.start_time?.slice(0,10)===dayStr);
        html += `<div style="padding:8px 0;border-bottom:1px solid var(--border)">
          <div style="font-size:11px;font-weight:600;color:var(--hint);margin-bottom:4px">${DAYS[d]} ${day.getDate()}.${day.getMonth()+1}</div>
          ${dayDuties.length?dayDuties.map(duty=>{
            const h = ((new Date(duty.end_time)-new Date(duty.start_time))/3600000).toFixed(1);
            const start = new Date(duty.start_time).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
            const end   = new Date(duty.end_time).toLocaleTimeString('ru',{hour:'2-digit',minute:'2-digit'});
            return `<div style="font-size:12px;padding:2px 0;color:var(--text)">
              🟢 ${duty.profiles?.fio||'?'} · ${start}–${end} · ${h}ч</div>`;
          }).join(''):`<div style="font-size:11px;color:var(--hint);padding:2px 0">Нет дежурств</div>`}
        </div>`;
      }
      body.innerHTML = html;
    } catch(e) { body.innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
  };

  document.getElementById('cs-prev')?.addEventListener('click',()=>{ weekOffset--; load(); });
  document.getElementById('cs-next')?.addEventListener('click',()=>{ weekOffset++; load(); });
  await load();
}


function renderEditGroupTypeModal(id, nameEnc, type, price, pct) {
  const name = decodeURIComponent(nameEnc);
  const m = el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>Редактировать тип</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <div class="form-group"><label>Название</label>
      <input id="egt-name" value="${name}"></div>
    <div class="form-group"><label>Тип</label>
      <select id="egt-type" onchange="onGtTypeChange(this.value)" disabled>
        <option value="children" ${type==='children'?'selected':''}>👶 Детская</option>
        <option value="adult" ${type==='adult'?'selected':''}>🏊 Взрослая</option>
      </select></div>
    ${type==='children'?`
    <div class="form-group"><label>Стоимость (сум/мес)</label>
      <input id="egt-price" type="number" value="${price}"></div>
    <div class="form-group"><label>% тренеру</label>
      <input id="egt-pct" type="number" value="${pct}"></div>`:
    `<div style="background:rgba(16,185,129,.1);border-radius:8px;padding:10px;font-size:12px;color:var(--hint)">
      Ставки: 1-3 чел = 110к · 4-6 = 120к · 7+ = 130к</div>`}
    <button class="btn btn-primary btn-full" style="margin-top:16px"
      onclick="doEditGroupType(${id},'${type}')">Сохранить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doEditGroupType(id, type) {
  const name  = document.getElementById('egt-name')?.value.trim();
  const price = parseInt(document.getElementById('egt-price')?.value||0);
  const pct   = parseInt(document.getElementById('egt-pct')?.value||40);
  if (!name) return toast('Введите название','error');
  try {
    await DB.updateGroupType(id, {
      name,
      price_per_month: type==='children' ? price : 0,
      trainer_percentage: type==='children' ? pct : 0
    });
    document.querySelector('.modal-overlay')?.remove();
    toast('Обновлено ✅','success');
    loadGroupsList();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function doDeleteGroupType(id, nameEnc) {
  const name = decodeURIComponent(nameEnc);
  if (!confirm(`Удалить тип группы «${name}»?\nВсе назначения тренеров будут откреплены.`)) return;
  try {
    await DB.deleteGroupType(id);
    toast('Удалено','success');
    loadGroupsList();
  } catch(e) { toast('Ошибка — возможно есть назначенные тренеры','error'); console.error(e); }
}
window.addEventListener('DOMContentLoaded', init);
