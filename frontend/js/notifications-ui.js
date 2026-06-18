// =============================================
// УВЕДОМЛЕНИЯ — добавить в конец app.js
// =============================================

// ── DB: добавить в объект DB в db.js ────────
// (вставить перед последней закрывающей `};`)
/*
  async getNotificationRules() {
    const {data,error} = await sb().from('notification_rules').select('*').order('id');
    if (error) throw error; return data||[];
  },
  async toggleRule(id, active) {
    const {error} = await sb().from('notification_rules').update({active}).eq('id',id);
    if (error) throw error;
  },
  async queueNotification(recipientTgId, recipientName, message, scheduledFor, createdBy) {
    const {error} = await sb().from('notifications_queue').insert({
      recipient_tg_id: recipientTgId,
      recipient_name:  recipientName,
      message,
      scheduled_for:   scheduledFor || new Date().toISOString(),
      created_by:      createdBy,
      status:          'pending',
    });
    if (error) throw error;
  },
  async queueBroadcast(profiles, message, scheduledFor, createdBy) {
    const rows = profiles.map(p => ({
      recipient_tg_id: p.tg_id,
      recipient_name:  p.fio,
      message,
      scheduled_for:   scheduledFor || new Date().toISOString(),
      created_by:      createdBy,
      status:          'pending',
    }));
    const {error} = await sb().from('notifications_queue').insert(rows);
    if (error) throw error;
    return rows.length;
  },
  async getRecentNotifications(limit=30) {
    const {data,error} = await sb().from('notifications_queue')
      .select('*').order('created_at',{ascending:false}).limit(limit);
    if (error) throw error; return data||[];
  },
*/

// ── ВКЛАДКА УВЕДОМЛЕНИЙ ──────────────────────

async function renderAdminNotifications() {
  $('#tab-content').innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  try {
    const [rules, recent, allProfiles] = await Promise.all([
      DB.getNotificationRules(),
      DB.getRecentNotifications(20),
      DB.getAllProfiles(),
    ]);
    const branches = await DB.getBranches();
    const trainers = allProfiles.filter(p =>
      ['trainer','senior_trainer'].includes(p.role) && p.tg_id
    );

    $('#tab-content').innerHTML = `<div class="tab-pad">

      <!-- Автоматические правила -->
      <h3>🤖 Автоматические правила</h3>
      <p class="hint" style="margin-bottom:12px">Включайте и выключайте — правила сработают сами по расписанию.</p>
      <div id="rules-list">
        ${rules.map(r => `
          <div class="notif-rule-card">
            <div class="notif-rule-info">
              <div class="notif-rule-name">${r.name}</div>
              <div class="notif-rule-desc hint">${r.description||''}</div>
            </div>
            <label class="toggle-row" style="flex-shrink:0">
              <input type="checkbox" ${r.active?'checked':''} onchange="toggleRule(${r.id},this.checked)">
              <span class="toggle-track"><span class="toggle-thumb"></span></span>
            </label>
          </div>`).join('')}
      </div>

      <!-- Ручная рассылка -->
      <h3 style="margin-top:24px">✉️ Отправить сообщение</h3>

      <div class="form-group"><label>Кому</label>
        <select id="notif-to" onchange="onNotifToChange(this)">
          <option value="all">Все тренеры</option>
          <option value="branch">Тренеры филиала</option>
          <option value="specific">Конкретный тренер</option>
        </select>
      </div>

      <div id="notif-branch-wrap" style="display:none" class="form-group">
        <label>Филиал</label>
        <select id="notif-branch">
          ${branches.map(b=>`<option>${b.name}</option>`).join('')}
        </select>
      </div>

      <div id="notif-trainer-wrap" style="display:none" class="form-group">
        <label>Тренер</label>
        <select id="notif-trainer">
          ${trainers.map(t=>`<option value="${t.tg_id}" data-fio="${t.fio}">${t.fio}</option>`).join('')}
        </select>
      </div>

      <div class="form-group"><label>Когда отправить</label>
        <select id="notif-when">
          <option value="now">Сразу</option>
          <option value="scheduled">В определённое время</option>
        </select>
      </div>
      <div id="notif-time-wrap" style="display:none" class="form-group">
        <label>Дата и время</label>
        <input type="datetime-local" id="notif-time" value="${new Date(Date.now()+3600000).toISOString().slice(0,16)}">
      </div>

      <div class="form-group"><label>Текст сообщения</label>
        <textarea id="notif-text" rows="4" placeholder="Завтра в 10:00 обязательная лекция по технике плавания. Явка всех тренеров."></textarea>
      </div>

      <div id="notif-preview" class="notif-preview" style="display:none"></div>

      <div style="display:flex;gap:8px">
        <button class="btn" style="flex:1;background:var(--card)" onclick="previewNotif()">👁 Предпросмотр</button>
        <button class="btn btn-primary" style="flex:1" onclick="doSendNotif(${JSON.stringify(trainers).replace(/"/g,'&quot;')},${JSON.stringify(branches.map(b=>b.name)).replace(/"/g,'&quot;')})">
          Отправить ✓
        </button>
      </div>

      <!-- История -->
      <h3 style="margin-top:24px">📋 История отправок</h3>
      ${!recent.length ? '<p class="hint">Нет записей</p>' :
        recent.map(n => `
          <div class="notif-history-item">
            <div class="notif-h-row">
              <span class="notif-h-name">${n.recipient_name||n.recipient_tg_id}</span>
              <div style="display:flex;gap:6px;align-items:center">
                <span class="notif-status-badge ${n.status}">${
                  n.status==='sent'?'✓ Отправлено':n.status==='failed'?'✗ Ошибка':'⏳ Ожидает'
                }</span>
                ${n.status==='pending'?`<button class="btn-icon" style="color:var(--danger);font-size:14px"
                  onclick="doDeleteNotif('${n.id}')" title="Удалить">✕</button>`:''}
              </div>
            </div>
            <div class="notif-h-msg hint">${n.message.slice(0,80)}${n.message.length>80?'…':''}</div>
            <div class="notif-h-time hint">${fmtDT(n.scheduled_for)}</div>
          </div>`).join('')}
    </div>`;

    // Слушатель для времени
    document.getElementById('notif-when')?.addEventListener('change', function() {
      const wrap = document.getElementById('notif-time-wrap');
      if (wrap) wrap.style.display = this.value === 'scheduled' ? '' : 'none';
    });

  } catch(e) { toast('Ошибка загрузки','error'); console.error(e); }
}

function onNotifToChange(sel) {
  document.getElementById('notif-branch-wrap').style.display  = sel.value==='branch'   ? '' : 'none';
  document.getElementById('notif-trainer-wrap').style.display = sel.value==='specific' ? '' : 'none';
}

function previewNotif() {
  const text = document.getElementById('notif-text')?.value.trim();
  if (!text) return toast('Введите текст','error');
  const preview = document.getElementById('notif-preview');
  if (preview) {
    preview.style.display = '';
    preview.innerHTML = `<div class="notif-preview-label">Предпросмотр:</div>
      <div class="notif-preview-bubble">📢 <b>AquaDesk</b>\n\n${text}</div>`;
  }
}

async function toggleRule(id, active) {
  try {
    await DB.toggleRule(id, active);
    toast(active ? 'Правило включено ✅' : 'Правило выключено', 'success');
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doSendNotif(trainers, branchNames) {
  const text = document.getElementById('notif-text')?.value.trim();
  if (!text) return toast('Введите текст','error');

  const to       = document.getElementById('notif-to')?.value;
  const when     = document.getElementById('notif-when')?.value;
  const timeVal  = document.getElementById('notif-time')?.value;
  const branch   = document.getElementById('notif-branch')?.value;
  const trainerTg= document.getElementById('notif-trainer')?.value;
  const trainerFio = document.querySelector('#notif-trainer option:checked')?.dataset.fio;

  const scheduledFor = when === 'scheduled' && timeVal
    ? new Date(timeVal).toISOString()
    : new Date().toISOString();

  const msg = '📢 <b>AquaDesk</b>\n\n' + text;

  // Формируем список получателей
  let recipients = [];
  if (to === 'all') {
    recipients = trainers;
  } else if (to === 'branch') {
    recipients = trainers.filter(t => (t.branches||[]).includes(branch));
  } else if (to === 'specific') {
    recipients = trainers.filter(t => String(t.tg_id) === String(trainerTg));
  }

  const withTg = recipients.filter(r => r.tg_id);
  if (!withTg.length) return toast('Нет получателей с привязанным Telegram','error');

  if (!confirm(`Отправить ${withTg.length} получателям${when==='scheduled'?' в '+fmtDT(scheduledFor):''}?`)) return;

  try {
    await DB.queueBroadcast(withTg, msg, scheduledFor, STATE.profile.id);
    const label = when === 'scheduled' ? `запланировано на ${fmtDT(scheduledFor)}` : `отправляется (~15 мин)`;
    toast(`✅ ${withTg.length} сообщений — ${label}`, 'success');
    document.getElementById('notif-text').value = '';
    document.getElementById('notif-preview').style.display = 'none';
    setTimeout(()=>renderAdminNotifications(), 1000);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}

async function doDeleteNotif(id) {
  if (!confirm('Удалить уведомление из очереди?')) return;
  try {
    const {error} = await sb().from('notifications_queue').delete().eq('id', id);
    if (error) throw error;
    toast('Удалено ✅', 'success');
    renderAdminNotifications();
  } catch(e) { toast('Ошибка', 'error'); }
}
