// ── РЕГИСТРАЦИЯ ───────────────────────────────
// ============================================================
// SECTION: AUTH — регистрация, PIN-вход, привязка профиля
// ============================================================
function renderRegister() {
  setupBack(null);
  setScreen(`<div class="screen-pad">
    <div class="logo">🏋️</div><h1>Первый вход</h1>
    <p class="hint" style="color:#ef4444;font-weight:600">⚠️ Только Фамилия и Имя — без отчества!</p><p class="hint">Пример: Иванов Иван</p>
    <div class="form-group"><label>ФИО</label>
      <input id="reg-fio" type="text" autocomplete="name" placeholder="Иванов Иван Иванович"></div>
    <div class="form-group"><label>PIN-код (4 цифры)</label>
      <input id="reg-pin" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <div class="form-group"><label>Повторите PIN</label>
      <input id="reg-pin2" type="password" inputmode="numeric" maxlength="4" placeholder="••••"></div>
    <button class="btn btn-primary btn-full" onclick="doRegister()">Войти</button>
  </div>`);
}
async function doRegister() {
  const fio=$('#reg-fio')?.value.trim(), pin=$('#reg-pin')?.value.trim(), pin2=$('#reg-pin2')?.value.trim();
  if (!fio)              return toast('Введите ФИО','error');
  if (!/^\d{4}$/.test(pin)) return toast('PIN: ровно 4 цифры','error');
  if (pin!==pin2)        return toast('PIN не совпадает','error');
  loading('Ищем профиль...');
  try {
    const p=await DB.getUnclaimedProfileByFio(fio);
    if (!p) { renderRegister(); return toast('ФИО не найдено или уже занято','error'); }
    STATE.profile=await DB.claimProfile(p.id,STATE.tgId,pin);
    toast('Аккаунт привязан! ✅','success'); enterApp();
  } catch(e) { renderRegister(); toast('Ошибка: '+(e?.message||String(e)),'error'); console.error('[doRegister]',e); }
}

// ── PIN — принудительная установка ───────────
function renderForcePinSetup() {
  setupBack(null); window._newPin=''; window._newPin2=''; window._pinStep=1;
  setScreen(`<div class="screen-pad center-screen">
    <div style="font-size:40px;margin-bottom:12px">🔐</div>
    <h2 style="margin-bottom:8px">Создайте PIN-код</h2>
    <p class="hint" style="margin-bottom:24px;text-align:center">Для защиты вашего аккаунта необходимо установить 4-значный PIN. Без него вход в приложение будет закрыт.</p>
    <div id="pin-step-label" style="font-size:14px;font-weight:600;margin-bottom:16px">Введите новый PIN</div>
    <div id="pin-dots" style="display:flex;gap:12px;margin-bottom:24px">
      ${[0,1,2,3].map(()=>'<span style="width:16px;height:16px;border-radius:50%;border:2px solid var(--accent);display:inline-block"></span>').join('')}
    </div>
    <div style="display:grid;grid-template-columns:repeat(3,1fr);gap:10px;max-width:220px;margin:0 auto">
      ${[1,2,3,4,5,6,7,8,9,'',0,'←'].map(k=>`<button
        style="height:56px;border-radius:12px;background:var(--card);border:1px solid var(--border);
               color:var(--text);font-size:20px;font-weight:600;cursor:pointer;${k===''?'visibility:hidden':''}"
        onclick="forcePinKey('${k}')">
        ${k}
      </button>`).join('')}
    </div>
  </div>`);
}
function forcePinKey(k) {
  if (k==='←') { if(window._pinStep===1)window._newPin=window._newPin.slice(0,-1); else window._newPin2=window._newPin2.slice(0,-1); }
  else if (k!==''&&(window._pinStep===1?window._newPin:window._newPin2).length<4) {
    if(window._pinStep===1)window._newPin+=k; else window._newPin2+=k;
  }
  const cur = window._pinStep===1?window._newPin:window._newPin2;
  $$('#pin-dots span').forEach((d,i)=>d.style.background=i<cur.length?'var(--accent)':'transparent');

  if (cur.length===4) {
    if (window._pinStep===1) {
      // Переходим к подтверждению
      window._pinStep=2; window._newPin2='';
      document.getElementById('pin-step-label').textContent='Повторите PIN';
      $$('#pin-dots span').forEach(d=>d.style.background='transparent');
    } else {
      // Проверяем совпадение
      if (window._newPin!==window._newPin2) {
        toast('PIN не совпадает, попробуйте снова','error');
        window._pinStep=1; window._newPin=''; window._newPin2='';
        document.getElementById('pin-step-label').textContent='Введите новый PIN';
        $$('#pin-dots span').forEach(d=>d.style.background='transparent');
        return;
      }
      DB.changePin(STATE.profile.id, window._newPin).then(()=>{
        STATE.profile.has_pin = true;
        toast('✅ PIN установлен!','success');
        enterApp();
      }).catch(()=>toast('Ошибка создания PIN','error'));
    }
  }
}

// ── PIN ───────────────────────────────────────
function renderPinEntry() {
  setupBack(null); window._pin='';
  setScreen(`<div class="screen-pad center-screen">
    <div class="logo">🔐</div>
    <h2>Привет, ${STATE.profile.fio.split(' ')[1]||STATE.profile.fio}!</h2>
    <div class="pin-dots" id="pin-dots">
      <span></span><span></span><span></span><span></span>
    </div>
    <div class="pin-pad">
      ${[1,2,3,4,5,6,7,8,9,'',0,'⌫'].map(k=>
        `<button class="pin-key ${k===''?'pin-key-empty':''}" onclick="pinKey('${k}')">${k}</button>`
      ).join('')}
    </div>
  </div>`);
}
function pinKey(k) {
  if (k==='⌫')                            window._pin=window._pin.slice(0,-1);
  else if (k!==''&&window._pin.length<4)  window._pin+=k;
  $$('#pin-dots span').forEach((d,i)=>d.className=i<window._pin.length?'filled':'');
  if (window._pin.length===4) {
    const attempt=window._pin; window._pin='';
    $$('#pin-dots span').forEach(d=>d.className='');
    // Rate limiting: блокировка после 5 неверных попыток
    if (Date.now() < _pinBlockedUntil) {
      const sec = Math.ceil((_pinBlockedUntil-Date.now())/1000);
      toast(`Слишком много попыток. Подождите ${sec} сек.`,'error'); return;
    }
    DB.verifyPin(STATE.tgId,attempt).then(ok=>{
      if (ok) { _pinFailCount=0; toast('Добро пожаловать! 👋','success'); enterApp(); }
      else {
        _pinFailCount++;
        if (_pinFailCount>=5) { _pinBlockedUntil=Date.now()+30000; _pinFailCount=0; toast('5 неверных попыток. Блокировка на 30 сек.','error'); }
        else toast(`Неверный PIN (${_pinFailCount}/5)`,'error');
      }
    }).catch(()=>toast('Ошибка проверки PIN','error'));
  }
}
