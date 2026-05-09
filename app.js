// =============================================
// TWA «Лист тренера» — главный файл приложения
// =============================================

// ------------------------------------------
// ГЛОБАЛЬНОЕ СОСТОЯНИЕ
// ------------------------------------------
const STATE = {
  tgId: null,
  profile: null,
  activeDuty: null,
  dutyTimer: null,
  currentTab: null,
};

// ------------------------------------------
// УТИЛИТЫ
// ------------------------------------------

const $ = (sel) => document.querySelector(sel);
const $$ = (sel) => document.querySelectorAll(sel);

function el(tag, cls, html) {
  const e = document.createElement(tag);
  if (cls) e.className = cls;
  if (html !== undefined) e.innerHTML = html;
  return e;
}

function fmt(n) {
  return Number(n).toLocaleString('ru-RU');
}

function fmtDate(d) {
  return new Date(d).toLocaleDateString('ru-RU', { day: '2-digit', month: '2-digit', year: '2-digit' });
}

function fmtDateTime(d) {
  return new Date(d).toLocaleString('ru-RU', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' });
}

function fmtMonthYear(year, month) {
  return new Date(year, month - 1).toLocaleDateString('ru-RU', { month: 'long', year: 'numeric' });
}

function hoursFromDuty(start, end) {
  return ((new Date(end) - new Date(start)) / 3600000);
}

function calcSummaryRow(workouts, duties) {
  const cat = { 1: 0, 2: 0, 3: 0 };
  workouts.forEach(w => cat[w.category_at_moment]++);
  const hours = duties.reduce((s, d) => s + hoursFromDuty(d.start_time, d.end_time), 0);
  const total =
    cat[1] * RATES.pt[1] +
    cat[2] * RATES.pt[2] +
    cat[3] * RATES.pt[3] +
    hours * RATES.duty_per_hour;
  return { cat, hours, total };
}

function canEdit(createdAt) {
  return (Date.now() - new Date(createdAt)) < EDIT_WINDOW_MINUTES * 60 * 1000;
}

// Toast уведомление
function toast(msg, type = 'info') {
  const t = el('div', `toast toast-${type}`, msg);
  document.body.appendChild(t);
  setTimeout(() => t.classList.add('show'), 10);
  setTimeout(() => { t.classList.remove('show'); setTimeout(() => t.remove(), 300); }, 3000);
}

function setScreen(html) {
  $('#app').innerHTML = html;
}

function loading(text = 'Загрузка...') {
  setScreen(`<div class="center-screen"><div class="spinner"></div><p>${text}</p></div>`);
}

// Обновить кнопку «Назад» в Telegram
function setupBackButton(cb) {
  if (window.Telegram?.WebApp?.BackButton) {
    if (cb) {
      Telegram.WebApp.BackButton.show();
      Telegram.WebApp.BackButton.onClick(cb);
    } else {
      Telegram.WebApp.BackButton.hide();
    }
  }
}

// ------------------------------------------
// ИНИЦИАЛИЗАЦИЯ
// ------------------------------------------

async function init() {
  // Инициализируем Telegram WebApp
  if (window.Telegram?.WebApp) {
    Telegram.WebApp.ready();
    Telegram.WebApp.expand();
  }

  // Получаем tg_id
  STATE.tgId = window.Telegram?.WebApp?.initDataUnsafe?.user?.id || null;

  // Фолбэк для тестирования вне Telegram
  if (!STATE.tgId) {
    const saved = localStorage.getItem('dev_tg_id');
    if (saved) {
      STATE.tgId = parseInt(saved);
    } else {
      const id = prompt('Dev mode: введите Telegram ID (118803972 = админ, 8003119355 = тренер)');
      if (!id) return toast('Нет Telegram ID', 'error');
      STATE.tgId = parseInt(id);
      localStorage.setItem('dev_tg_id', STATE.tgId);
    }
  }

  loading('Проверяем аккаунт...');

  try {
    const profile = await DB.getProfileByTgId(STATE.tgId);

    if (!profile) {
      // Первый вход — экран регистрации
      renderRegister();
    } else {
      STATE.profile = profile;
      // Если PIN установлен — запросить PIN
      if (profile.pincode) {
        renderPinEntry();
      } else {
        // Профиль занят, но PIN не задан (не должно быть, но на всякий случай)
        enterApp();
      }
    }
  } catch (e) {
    toast('Ошибка подключения к базе данных', 'error');
    console.error(e);
  }
}

// ------------------------------------------
// ЭКРАН: РЕГИСТРАЦИЯ
// ------------------------------------------

function renderRegister() {
  setupBackButton(null);
  setScreen(`
    <div class="screen-pad">
      <div class="logo">🏋️</div>
      <h1>Первый вход</h1>
      <p class="hint">Координатор уже внёс ваше ФИО в систему.<br>Введите его точно так же для привязки аккаунта.</p>

      <div class="form-group">
        <label>Ваше ФИО</label>
        <input id="reg-fio" type="text" placeholder="Иванов Иван Иванович" autocomplete="name">
      </div>
      <div class="form-group">
        <label>Придумайте PIN-код (4 цифры)</label>
        <input id="reg-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••">
      </div>
      <div class="form-group">
        <label>Повторите PIN-код</label>
        <input id="reg-pin2" type="password" inputmode="numeric" maxlength="4" placeholder="••••">
      </div>
      <button class="btn btn-primary btn-full" onclick="doRegister()">Войти</button>
    </div>
  `);
}

async function doRegister() {
  const fio  = $('#reg-fio').value.trim();
  const pin  = $('#reg-pin').value.trim();
  const pin2 = $('#reg-pin2').value.trim();

  if (!fio) return toast('Введите ФИО', 'error');
  if (pin.length !== 4 || !/^\d{4}$/.test(pin)) return toast('PIN: 4 цифры', 'error');
  if (pin !== pin2) return toast('PIN-коды не совпадают', 'error');

  loading('Ищем ваш профиль...');

  try {
    const profile = await DB.getUnclaimedProfileByFio(fio);
    if (!profile) {
      renderRegister();
      return toast('ФИО не найдено или уже занято. Проверьте написание или обратитесь к координатору.', 'error');
    }

    const updated = await DB.claimProfile(profile.id, STATE.tgId, pin);
    STATE.profile = updated;
    toast('Аккаунт успешно привязан!', 'success');
    enterApp();
  } catch (e) {
    renderRegister();
    toast('Ошибка регистрации', 'error');
    console.error(e);
  }
}

// ------------------------------------------
// ЭКРАН: ВВОД PIN
// ------------------------------------------

function renderPinEntry() {
  setupBackButton(null);
  setScreen(`
    <div class="screen-pad center-screen">
      <div class="logo">🔐</div>
      <h2>Привет, ${STATE.profile.fio.split(' ')[1] || STATE.profile.fio}!</h2>
      <p class="hint">Введите PIN-код для входа</p>
      <div class="pin-dots" id="pin-dots">
        <span></span><span></span><span></span><span></span>
      </div>
      <div class="pin-pad">
        ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k => `
          <button class="pin-key ${k === '' ? 'pin-key-empty' : ''}"
            onclick="pinKey('${k}')">${k}</button>
        `).join('')}
      </div>
    </div>
  `);
  window._pinValue = '';
}

function pinKey(key) {
  if (key === '⌫') {
    window._pinValue = window._pinValue.slice(0, -1);
  } else if (key !== '' && window._pinValue.length < 4) {
    window._pinValue += key;
  }
  updatePinDots();
  if (window._pinValue.length === 4) checkPin();
}

function updatePinDots() {
  const dots = $$('#pin-dots span');
  dots.forEach((d, i) => {
    d.className = i < window._pinValue.length ? 'filled' : '';
  });
}

async function checkPin() {
  if (window._pinValue === STATE.profile.pincode) {
    toast('Добро пожаловать!', 'success');
    enterApp();
  } else {
    toast('Неверный PIN', 'error');
    window._pinValue = '';
    updatePinDots();
  }
}

// ------------------------------------------
// ВХОД В ПРИЛОЖЕНИЕ
// ------------------------------------------

async function enterApp() {
  if (STATE.profile.role === 'admin') {
    renderAdminApp();
  } else {
    renderTrainerApp();
  }
}

// ==============================================================
// ТРЕНЕР
// ==============================================================

async function renderTrainerApp() {
  setupBackButton(null);
  // Проверяем активное дежурство
  STATE.activeDuty = await DB.getActiveDuty(STATE.profile.id);
  renderTrainerShell('workouts');
}

function renderTrainerShell(tab) {
  STATE.currentTab = tab;
  const duty = STATE.activeDuty;

  setScreen(`
    <div class="app-header">
      <div>
        <div class="app-title">🏋️ Лист тренера</div>
        <div class="app-sub">${STATE.profile.fio}</div>
      </div>
      ${duty ? `<div class="duty-badge active">● Дежурство</div>` : ''}
    </div>
    <div id="tab-content" class="tab-content"></div>
    <nav class="bottom-nav">
      <button class="nav-btn ${tab==='workouts'?'active':''}" onclick="switchTab('workouts')">
        <span>📋</span>Тренировки
      </button>
      <button class="nav-btn ${tab==='duty'?'active':''}" onclick="switchTab('duty')">
        <span>⏱</span>Дежурство
      </button>
      <button class="nav-btn ${tab==='report'?'active':''}" onclick="switchTab('report')">
        <span>📊</span>Отчёт
      </button>
    </nav>
  `);

  switchTab(tab);
}

function switchTab(tab) {
  STATE.currentTab = tab;
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  document.querySelector(`.nav-btn:nth-child(${tab==='workouts'?1:tab==='duty'?2:3})`).classList.add('active');

  if (tab === 'workouts') renderWorkoutsTab();
  else if (tab === 'duty') renderDutyTab();
  else if (tab === 'report') renderReportTab();
}

// ------------------------------------------
// TAB: СПИСАНИЕ ТРЕНИРОВОК
// ------------------------------------------

async function renderWorkoutsTab() {
  $('#tab-content').innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;

  const clients = await DB.getClients(STATE.profile.id);
  const branches = STATE.profile.branches || [];

  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header">
        <h3>Списать тренировку (ПТ)</h3>
        <button class="btn btn-sm" onclick="renderAddClientModal()">+ Клиент</button>
      </div>

      ${branches.length > 1 ? `
      <div class="form-group">
        <label>Филиал</label>
        <select id="wk-branch">
          ${branches.map(b => `<option>${b}</option>`).join('')}
        </select>
      </div>` : `<input type="hidden" id="wk-branch-val" value="${branches[0] || ''}">`}

      <div class="form-group">
        <label>Клиент</label>
        <select id="wk-client">
          <option value="">— выберите клиента —</option>
          ${clients.map(c => `
            <option value="${c.id}" data-cat="${c.category}" data-bal="${c.balance}">
              ${c.fio} (кат.${c.category}, баланс: ${c.balance})
            </option>
          `).join('')}
        </select>
      </div>

      <div class="form-group">
        <label>Количество ПТ</label>
        <select id="wk-count" onchange="renderWorkoutDateFields()">
          ${[1,2,3,4,5,6,7,8,9,10].map(n => `<option>${n}</option>`).join('')}
        </select>
      </div>

      <div id="wk-dates"></div>

      <div class="form-group" id="wk-notes-wrap" style="display:none">
        <label>Примечание <span class="required">*</span></label>
        <textarea id="wk-notes" rows="2" placeholder="Причина пакетного списания"></textarea>
      </div>

      <button class="btn btn-primary btn-full" onclick="doLogWorkout()">Списать ПТ</button>
    </div>
  `;

  renderWorkoutDateFields();

  // Предупреждение при выборе клиента с нулевым балансом
  $('#wk-client').addEventListener('change', function() {
    const opt = this.options[this.selectedIndex];
    const bal = parseInt(opt.dataset.bal || '0');
    if (this.value && bal <= 0) {
      toast('⚠️ У клиента нулевой баланс!', 'error');
    }
  });
}

function renderWorkoutDateFields() {
  const count = parseInt($('#wk-count')?.value || 1);
  const notesWrap = $('#wk-notes-wrap');
  const datesDiv = $('#wk-dates');
  if (!datesDiv) return;

  if (count === 1) {
    datesDiv.innerHTML = `
      <div class="form-group">
        <label>Дата тренировки</label>
        <input type="datetime-local" id="wk-date-0" value="${localDatetimeValue()}">
      </div>
    `;
    if (notesWrap) notesWrap.style.display = 'none';
  } else {
    datesDiv.innerHTML = Array.from({ length: count }, (_, i) => `
      <div class="form-group">
        <label>ПТ №${i + 1} — Дата и время</label>
        <input type="datetime-local" id="wk-date-${i}" value="${localDatetimeValue(-i)}">
      </div>
    `).join('');
    if (notesWrap) notesWrap.style.display = '';
  }
}

function localDatetimeValue(daysOffset = 0) {
  const d = new Date();
  d.setDate(d.getDate() + daysOffset);
  return d.toISOString().slice(0, 16);
}

function getBranch() {
  const sel = document.getElementById('wk-branch');
  if (sel) return sel.value;
  const hidden = document.getElementById('wk-branch-val');
  return hidden ? hidden.value : (STATE.profile.branches?.[0] || '');
}

async function doLogWorkout() {
  const clientSel = $('#wk-client');
  const clientId  = clientSel?.value;
  if (!clientId) return toast('Выберите клиента', 'error');

  const category = parseInt(clientSel.options[clientSel.selectedIndex].dataset.cat);
  const count    = parseInt($('#wk-count')?.value || 1);
  const branch   = getBranch();
  if (!branch) return toast('Выберите филиал', 'error');

  const notes = $('#wk-notes')?.value?.trim() || '';
  if (count > 1 && !notes) return toast('Введите примечание для пакетного списания', 'error');

  const dates = [];
  for (let i = 0; i < count; i++) {
    const v = $(`#wk-date-${i}`)?.value;
    if (!v) return toast(`Введите дату для ПТ №${i + 1}`, 'error');
    dates.push(v);
  }

  const rows = dates.map(d => ({
    trainer_id: STATE.profile.id,
    client_id: clientId,
    category_at_moment: category,
    branch,
    workout_date: new Date(d).toISOString(),
    notes: notes || null,
  }));

  try {
    await DB.logWorkouts(rows);
    toast(`✅ ${count} ПТ списано!`, 'success');
    renderWorkoutsTab();
  } catch (e) {
    toast('Ошибка при списании', 'error');
    console.error(e);
  }
}

// ------------------------------------------
// МОДАЛ: ДОБАВИТЬ КЛИЕНТА
// ------------------------------------------

function renderAddClientModal() {
  const modal = el('div', 'modal-overlay');
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Новый клиент</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div class="form-group">
        <label>ФИО клиента</label>
        <input id="nc-fio" type="text" placeholder="Петрова Анна">
      </div>
      <div class="form-group">
        <label>Категория</label>
        <div class="cat-picker">
          <button class="cat-btn active" data-cat="1" onclick="selectCat(this)">
            Кат.1<br><small>${fmt(RATES.pt[1])} сум</small>
          </button>
          <button class="cat-btn" data-cat="2" onclick="selectCat(this)">
            Кат.2<br><small>${fmt(RATES.pt[2])} сум</small>
          </button>
          <button class="cat-btn" data-cat="3" onclick="selectCat(this)">
            Кат.3<br><small>${fmt(RATES.pt[3])} сум</small>
          </button>
        </div>
      </div>
      <div class="form-group">
        <label>Начальный баланс (кол-во ПТ)</label>
        <input id="nc-balance" type="number" min="0" value="0">
      </div>
      <button class="btn btn-primary btn-full" onclick="doAddClient()">Добавить</button>
    </div>
  `;
  document.body.appendChild(modal);
}

function selectCat(btn) {
  $$('.cat-btn').forEach(b => b.classList.remove('active'));
  btn.classList.add('active');
}

async function doAddClient() {
  const fio = $('#nc-fio')?.value?.trim();
  const cat = parseInt(document.querySelector('.cat-btn.active')?.dataset.cat || '1');
  const bal = parseInt($('#nc-balance')?.value || '0');

  if (!fio) return toast('Введите ФИО', 'error');

  try {
    const client = await DB.addClient(fio, cat, STATE.profile.id);
    if (bal > 0) await DB.addBalance(client.id, bal);
    document.querySelector('.modal-overlay')?.remove();
    toast('Клиент добавлен', 'success');
    renderWorkoutsTab();
  } catch (e) {
    toast('Ошибка', 'error');
    console.error(e);
  }
}

// ------------------------------------------
// TAB: ДЕЖУРСТВО
// ------------------------------------------

async function renderDutyTab() {
  const branches = STATE.profile.branches || [];
  const duty = STATE.activeDuty;

  if (duty) {
    // Активное дежурство
    $('#tab-content').innerHTML = `
      <div class="tab-pad center-col">
        <div class="duty-active-card">
          <div class="duty-icon">⏱</div>
          <div class="duty-branch">${duty.branch}</div>
          <div class="duty-timer" id="duty-timer">00:00:00</div>
          <div class="duty-start">Начало: ${fmtDateTime(duty.start_time)}</div>
        </div>
        <button class="btn btn-danger btn-full" onclick="doEndDuty('${duty.id}')">
          Завершить дежурство
        </button>
      </div>
    `;
    startDutyTimer(duty.start_time);
  } else {
    $('#tab-content').innerHTML = `
      <div class="tab-pad center-col">
        <div class="duty-idle-card">
          <div class="duty-icon">🏃</div>
          <p>Дежурство не начато</p>
        </div>
        ${branches.length > 1 ? `
        <div class="form-group" style="width:100%">
          <label>Филиал</label>
          <select id="duty-branch">
            ${branches.map(b => `<option>${b}</option>`).join('')}
          </select>
        </div>` : `<input type="hidden" id="duty-branch" value="${branches[0] || ''}">`}
        <button class="btn btn-primary btn-full" onclick="doStartDuty()">
          Начать дежурство
        </button>
      </div>
    `;
  }
}

function startDutyTimer(startTime) {
  if (STATE.dutyTimer) clearInterval(STATE.dutyTimer);
  const el = document.getElementById('duty-timer');
  if (!el) return;

  function tick() {
    const diff = Math.floor((Date.now() - new Date(startTime)) / 1000);
    const h = String(Math.floor(diff / 3600)).padStart(2, '0');
    const m = String(Math.floor((diff % 3600) / 60)).padStart(2, '0');
    const s = String(diff % 60).padStart(2, '0');
    if (el) el.textContent = `${h}:${m}:${s}`;
  }
  tick();
  STATE.dutyTimer = setInterval(tick, 1000);
}

async function doStartDuty() {
  const branch = $('#duty-branch')?.value || STATE.profile.branches?.[0] || '';
  if (!branch) return toast('Выберите филиал', 'error');
  try {
    STATE.activeDuty = await DB.startDuty(STATE.profile.id, branch);
    toast('Дежурство начато', 'success');
    renderTrainerShell('duty');
  } catch (e) {
    toast('Ошибка', 'error');
    console.error(e);
  }
}

async function doEndDuty(dutyId) {
  if (!confirm('Завершить дежурство?')) return;
  if (STATE.dutyTimer) clearInterval(STATE.dutyTimer);
  try {
    const ended = await DB.endDuty(dutyId);
    const hours = hoursFromDuty(ended.start_time, ended.end_time);
    const earned = Math.round(hours * RATES.duty_per_hour);
    STATE.activeDuty = null;
    toast(`✅ Дежурство завершено. ${hours.toFixed(1)}ч = ${fmt(earned)} сум`, 'success');
    renderTrainerShell('duty');
  } catch (e) {
    toast('Ошибка', 'error');
    console.error(e);
  }
}

// ------------------------------------------
// TAB: ОТЧЁТ ТРЕНЕРА
// ------------------------------------------

async function renderReportTab() {
  const now = new Date();
  const year = now.getFullYear();
  const month = now.getMonth() + 1;

  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header">
        <h3>Мой отчёт</h3>
        <div class="month-nav">
          <button onclick="loadTrainerReport(${month===1?year-1:year},${month===1?12:month-1})">‹</button>
          <span id="report-month">${fmtMonthYear(year, month)}</span>
          <button onclick="loadTrainerReport(${month===12?year+1:year},${month===12?1:month+1})">›</button>
        </div>
      </div>
      <div id="report-body"><div class="center-screen"><div class="spinner"></div></div></div>
    </div>
  `;

  await loadTrainerReport(year, month);
}

async function loadTrainerReport(year, month) {
  const monthEl = document.getElementById('report-month');
  if (monthEl) monthEl.textContent = fmtMonthYear(year, month);

  const body = document.getElementById('report-body');
  if (!body) return;
  body.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;

  try {
    const [workouts, duties] = await Promise.all([
      DB.getWorkouts(STATE.profile.id, year, month),
      DB.getDuties(STATE.profile.id, year, month),
    ]);

    const byBranch = {};
    [...(STATE.profile.branches || [])].forEach(b => byBranch[b] = { workouts: [], duties: [] });
    workouts.forEach(w => { if (byBranch[w.branch]) byBranch[w.branch].workouts.push(w); else { byBranch[w.branch] = { workouts:[w], duties:[] }; } });
    duties.forEach(d => { if (byBranch[d.branch]) byBranch[d.branch].duties.push(d); else { byBranch[d.branch] = { workouts:[], duties:[d] }; } });

    const { cat, hours, total } = calcSummaryRow(workouts, duties);

    body.innerHTML = `
      <div class="summary-cards">
        <div class="summary-card">
          <div class="s-val">${cat[1]+cat[2]+cat[3]}</div>
          <div class="s-lbl">Всего ПТ</div>
        </div>
        <div class="summary-card">
          <div class="s-val">${hours.toFixed(1)}ч</div>
          <div class="s-lbl">Дежурства</div>
        </div>
        <div class="summary-card accent">
          <div class="s-val">${fmt(total)}</div>
          <div class="s-lbl">К выплате (сум)</div>
        </div>
      </div>

      ${Object.entries(byBranch).map(([branch, data]) => {
        const r = calcSummaryRow(data.workouts, data.duties);
        return `
          <div class="branch-block">
            <div class="branch-title">📍 ${branch}</div>
            <div class="branch-stats">
              <span>Кат.1: ${r.cat[1]}</span>
              <span>Кат.2: ${r.cat[2]}</span>
              <span>Кат.3: ${r.cat[3]}</span>
              <span>Деж: ${r.hours.toFixed(1)}ч</span>
            </div>
            <div class="branch-sum">= ${fmt(r.total)} сум</div>
          </div>`;
      }).join('')}

      <h4 style="margin-top:20px">История записей</h4>
      ${workouts.length === 0 ? '<p class="hint">Нет записей за этот месяц</p>' :
        workouts.map(w => {
          const editable = canEdit(w.created_at);
          return `
          <div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${w.clients?.fio || '—'}</span>
              <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
            </div>
            <div class="hi-sub">
              ${fmtDateTime(w.workout_date)} · ${w.branch}
              ${w.notes ? `· <em>${w.notes}</em>` : ''}
            </div>
            ${editable ? `
            <button class="btn btn-sm btn-danger" onclick="doDeleteWorkout('${w.id}')">
              Удалить
            </button>` : ''}
          </div>`;
        }).join('')
      }
    `;
  } catch (e) {
    body.innerHTML = '<p class="hint">Ошибка загрузки отчёта</p>';
    console.error(e);
  }
}

async function doDeleteWorkout(id) {
  if (!confirm('Удалить эту запись?')) return;
  try {
    await DB.deleteWorkout(id);
    toast('Запись удалена', 'success');
    renderReportTab();
  } catch (e) {
    toast('Ошибка удаления', 'error');
  }
}

// ==============================================================
// АДМИН
// ==============================================================

function renderAdminApp() {
  setupBackButton(null);
  setScreen(`
    <div class="app-header">
      <div>
        <div class="app-title">👑 Координатор</div>
        <div class="app-sub">${STATE.profile.fio}</div>
      </div>
    </div>
    <div id="tab-content" class="tab-content"></div>
    <nav class="bottom-nav">
      <button class="nav-btn active" onclick="adminTab('summary')"><span>📊</span>Сводка</button>
      <button class="nav-btn" onclick="adminTab('staff')"><span>👥</span>Персонал</button>
    </nav>
  `);

  adminTab('summary');
}

function adminTab(tab) {
  $$('.nav-btn').forEach(b => b.classList.remove('active'));
  const idx = tab === 'summary' ? 0 : 1;
  $$('.nav-btn')[idx]?.classList.add('active');

  if (tab === 'summary') renderAdminSummary();
  else if (tab === 'staff') renderAdminStaff();
}

// ------------------------------------------
// ADMIN TAB: СВОДКА
// ------------------------------------------

async function renderAdminSummary() {
  const now = new Date();
  let year  = now.getFullYear();
  let month = now.getMonth() + 1;

  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header">
        <h3>Сводка</h3>
        <div class="month-nav">
          <button id="prev-month">‹</button>
          <span id="sum-month">${fmtMonthYear(year, month)}</span>
          <button id="next-month">›</button>
        </div>
      </div>
      <div class="form-group">
        <select id="filter-branch">
          <option value="">Все филиалы</option>
          ${(STATE.profile.branches || []).map(b => `<option>${b}</option>`).join('')}
        </select>
      </div>
      <div id="summary-body"><div class="center-screen"><div class="spinner"></div></div></div>
    </div>
  `;

  async function load() {
    await loadAdminSummary(year, month, $('#filter-branch')?.value || null);
  }

  $('#prev-month')?.addEventListener('click', () => {
    if (month === 1) { year--; month = 12; } else month--;
    $('#sum-month').textContent = fmtMonthYear(year, month);
    load();
  });
  $('#next-month')?.addEventListener('click', () => {
    if (month === 12) { year++; month = 1; } else month++;
    $('#sum-month').textContent = fmtMonthYear(year, month);
    load();
  });
  $('#filter-branch')?.addEventListener('change', load);

  await load();
}

async function loadAdminSummary(year, month, branch) {
  const body = $('#summary-body');
  if (!body) return;
  body.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;

  try {
    const { workouts, duties, profiles } = await DB.getSummary(year, month, branch || null);

    if (profiles.length === 0) {
      body.innerHTML = '<p class="hint">Нет тренеров</p>';
      return;
    }

    // Группируем по trainer_id
    const rows = profiles.map(p => {
      const pw = workouts.filter(w => w.trainer_id === p.id);
      const pd = duties.filter(d => d.trainer_id === p.id);
      const r  = calcSummaryRow(pw, pd);
      return { profile: p, ...r, wCount: pw.length };
    }).filter(r => r.wCount > 0 || r.hours > 0);

    if (rows.length === 0) {
      body.innerHTML = '<p class="hint">Нет данных за этот период</p>';
      return;
    }

    const grandTotal = rows.reduce((s, r) => s + r.total, 0);

    body.innerHTML = `
      <div class="admin-table-wrap">
        <table class="admin-table">
          <thead>
            <tr>
              <th>Тренер</th>
              <th>К1</th><th>К2</th><th>К3</th>
              <th>Деж.</th>
              <th>Итого</th>
            </tr>
          </thead>
          <tbody>
            ${rows.map(r => `
              <tr onclick="renderAdminTrainerDetail(${r.profile.id},'${r.profile.fio}',${year},${month})" class="clickable">
                <td>${r.profile.fio}</td>
                <td>${r.cat[1]}</td>
                <td>${r.cat[2]}</td>
                <td>${r.cat[3]}</td>
                <td>${r.hours.toFixed(1)}ч</td>
                <td class="total-cell">${fmt(r.total)}</td>
              </tr>
            `).join('')}
          </tbody>
          <tfoot>
            <tr>
              <td colspan="5"><b>Итого к выплате</b></td>
              <td class="total-cell"><b>${fmt(grandTotal)}</b></td>
            </tr>
          </tfoot>
        </table>
      </div>
      <p class="hint" style="text-align:center">Нажмите на тренера для детального лога</p>
    `;
  } catch (e) {
    body.innerHTML = '<p class="hint">Ошибка загрузки</p>';
    console.error(e);
  }
}

// ------------------------------------------
// ADMIN: ДЕТАЛЬНЫЙ ЛОГ ТРЕНЕРА
// ------------------------------------------

async function renderAdminTrainerDetail(trainerId, trainerFio, year, month) {
  setupBackButton(() => {
    renderAdminApp();
    adminTab('summary');
    setupBackButton(null);
  });

  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <h3>${trainerFio}</h3>
      <p class="hint">${fmtMonthYear(year, month)}</p>
      <div class="center-screen"><div class="spinner"></div></div>
    </div>
  `;

  try {
    const { workouts, duties } = await DB.getTrainerDetail(trainerId, year, month);
    const { cat, hours, total } = calcSummaryRow(workouts, duties);

    $('#tab-content').innerHTML = `
      <div class="tab-pad">
        <div class="section-header">
          <div>
            <h3>${trainerFio}</h3>
            <p class="hint">${fmtMonthYear(year, month)}</p>
          </div>
        </div>

        <div class="summary-cards">
          <div class="summary-card"><div class="s-val">${cat[1]}</div><div class="s-lbl">Кат.1</div></div>
          <div class="summary-card"><div class="s-val">${cat[2]}</div><div class="s-lbl">Кат.2</div></div>
          <div class="summary-card"><div class="s-val">${cat[3]}</div><div class="s-lbl">Кат.3</div></div>
          <div class="summary-card"><div class="s-val">${hours.toFixed(1)}ч</div><div class="s-lbl">Деж.</div></div>
          <div class="summary-card accent" style="grid-column:span 2">
            <div class="s-val">${fmt(total)}</div>
            <div class="s-lbl">К выплате (сум)</div>
          </div>
        </div>

        <h4>Тренировки</h4>
        ${workouts.length === 0 ? '<p class="hint">Нет записей</p>' : workouts.map(w => `
          <div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${w.clients?.fio || '—'}</span>
              <span class="hi-cat cat-${w.category_at_moment}">Кат.${w.category_at_moment}</span>
              <span class="branch-tag">${w.branch}</span>
            </div>
            <div class="hi-sub">${fmtDateTime(w.workout_date)}${w.notes ? ' · ' + w.notes : ''}</div>
          </div>
        `).join('')}

        <h4 style="margin-top:16px">Дежурства</h4>
        ${duties.length === 0 ? '<p class="hint">Нет дежурств</p>' : duties.map(d => {
          const h = hoursFromDuty(d.start_time, d.end_time);
          return `
          <div class="history-item">
            <div class="hi-main">
              <span class="hi-client">${d.branch}</span>
              <span class="hi-cat">${h.toFixed(2)}ч</span>
            </div>
            <div class="hi-sub">${fmtDateTime(d.start_time)} → ${fmtDateTime(d.end_time)}</div>
            <div class="hi-sub">${fmt(Math.round(h * RATES.duty_per_hour))} сум</div>
          </div>`;
        }).join('')}
      </div>
    `;
  } catch (e) {
    toast('Ошибка загрузки', 'error');
    console.error(e);
  }
}

// ------------------------------------------
// ADMIN TAB: ПЕРСОНАЛ
// ------------------------------------------

async function renderAdminStaff() {
  $('#tab-content').innerHTML = `
    <div class="tab-pad">
      <div class="section-header">
        <h3>Персонал</h3>
        <button class="btn btn-sm" onclick="renderAddTrainerModal()">+ Тренер</button>
      </div>
      <div id="staff-list"><div class="center-screen"><div class="spinner"></div></div></div>
    </div>
  `;

  await loadStaffList();
}

async function loadStaffList() {
  const body = $('#staff-list');
  if (!body) return;
  try {
    const profiles = await DB.getAllProfiles();
    const trainers = profiles.filter(p => p.role === 'trainer');

    body.innerHTML = trainers.map(t => `
      <div class="staff-card">
        <div class="staff-info">
          <div class="staff-fio">${t.fio}</div>
          <div class="staff-meta">
            ${t.tg_id ? '✅ Зарегистрирован' : '⏳ Ожидает входа'}
            · ${(t.branches || []).join(', ') || 'без филиала'}
          </div>
        </div>
        <div class="staff-actions">
          <button class="btn btn-sm" onclick="renderEditTrainerModal(${t.id},'${t.fio}','${(t.branches||[]).join(',')}','${t.role}')">
            ✏️
          </button>
          ${t.role !== 'admin' ? `
          <button class="btn btn-sm btn-warn" onclick="promoteToAdmin(${t.id},'${t.fio}')">
            👑
          </button>` : '<span class="badge-admin">Админ</span>'}
        </div>
      </div>
    `).join('') || '<p class="hint">Нет тренеров</p>';
  } catch (e) {
    body.innerHTML = '<p class="hint">Ошибка загрузки</p>';
    console.error(e);
  }
}

function renderAddTrainerModal() {
  const allBranches = STATE.profile.branches || [];
  const modal = el('div', 'modal-overlay');
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Добавить тренера</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div class="form-group">
        <label>ФИО тренера</label>
        <input id="nt-fio" type="text" placeholder="Иванов Иван Иванович">
      </div>
      <div class="form-group">
        <label>Филиалы (через запятую)</label>
        <input id="nt-branches" type="text" placeholder="${allBranches.join(', ') || 'Центр, Запад'}">
      </div>
      <button class="btn btn-primary btn-full" onclick="doAddTrainer()">Добавить</button>
    </div>
  `;
  document.body.appendChild(modal);
}

async function doAddTrainer() {
  const fio = $('#nt-fio')?.value?.trim();
  const branchInput = $('#nt-branches')?.value?.trim();
  const branches = branchInput ? branchInput.split(',').map(b => b.trim()).filter(Boolean) : [];

  if (!fio) return toast('Введите ФИО', 'error');
  if (branches.length === 0) return toast('Укажите хотя бы один филиал', 'error');

  try {
    await DB.addTrainer(fio, branches);
    document.querySelector('.modal-overlay')?.remove();
    toast('Тренер добавлен', 'success');
    loadStaffList();
  } catch (e) {
    toast('Ошибка. ФИО должно быть уникальным.', 'error');
    console.error(e);
  }
}

function renderEditTrainerModal(id, fio, branches, role) {
  const modal = el('div', 'modal-overlay');
  modal.innerHTML = `
    <div class="modal">
      <div class="modal-header">
        <h3>Редактировать</h3>
        <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button>
      </div>
      <div class="form-group">
        <label>ФИО</label>
        <input id="et-fio" type="text" value="${fio}">
      </div>
      <div class="form-group">
        <label>Филиалы (через запятую)</label>
        <input id="et-branches" type="text" value="${branches}">
      </div>
      <button class="btn btn-primary btn-full" onclick="doEditTrainer(${id})">Сохранить</button>
    </div>
  `;
  document.body.appendChild(modal);
}

async function doEditTrainer(id) {
  const fio = $('#et-fio')?.value?.trim();
  const branchInput = $('#et-branches')?.value?.trim();
  const branches = branchInput ? branchInput.split(',').map(b => b.trim()).filter(Boolean) : [];

  if (!fio) return toast('Введите ФИО', 'error');

  try {
    await DB.updateTrainer(id, { fio, branches });
    document.querySelector('.modal-overlay')?.remove();
    toast('Сохранено', 'success');
    loadStaffList();
  } catch (e) {
    toast('Ошибка', 'error');
    console.error(e);
  }
}

async function promoteToAdmin(id, fio) {
  if (!confirm(`Дать права администратора: ${fio}?`)) return;
  try {
    await DB.updateTrainer(id, { role: 'admin' });
    toast(`${fio} теперь администратор`, 'success');
    loadStaffList();
  } catch (e) {
    toast('Ошибка', 'error');
  }
}

// ==============================================================
// СТАРТ
// ==============================================================

window.addEventListener('DOMContentLoaded', init);
