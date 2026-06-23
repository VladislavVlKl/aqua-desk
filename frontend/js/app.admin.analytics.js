// ─ ADMIN: АНАЛИТИКА ──────────────────────────
// ============================================================
// SECTION: ADMIN:ANALYTICS — Overview + 4 хаба (Деньги, Клиенты, Загрузка, Контроль)
// ============================================================
// Главный экран: 4 карточки → хабы. Месяц/филиал общие, данные грузятся
// независимо (падение одной карточки не ломает остальные), кеш 5 мин.

// Диапазон месяца + предыдущий месяц
function _anRange(year, month) {
  const from    = new Date(year, month-1, 1).toISOString();
  const to      = new Date(year, month,   1).toISOString();
  const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
  const toDay   = new Date(year, month, 1).toISOString().slice(0,10);
  const py = month===1 ? year-1 : year;
  const pm = month===1 ? 12 : month-1;
  const pFromDay = `${py}-${String(pm).padStart(2,'0')}-01`;
  const pToDay   = new Date(py, pm, 1).toISOString().slice(0,10);
  return { from, to, fromDay, toDay, pFromDay, pToDay };
}

// Подобрать купленный пакет под (возможно нестандартный) баланс абонемента → { qty, price }.
// Дети: докупать/переносить НЕЛЬЗЯ — баланс только убывает, неиспользованное сгорает.
//   Поэтому купленный пакет = ближайший стандартный ≥ баланса (округление ВВЕРХ),
//   10/25/50 (5 не заведён); баланс >50 — аномалия, потолок 50.
// Взрослые: платят за занятия и могут накапливать → наибольший стандартный ≤ баланса
//   (баланс = купленный пакет + перенесённый остаток), 10/5/1.
function _pkgMatch(child, balance, cat) {
  if (!balance || balance <= 0) return { qty:null, price:undefined };
  if (child) {
    for (const t of [10,25,50]) if (balance <= t) return { qty:t, price: CHILD_SUB_PRICES[t]?.[cat] };
    return { qty:50, price: CHILD_SUB_PRICES[50]?.[cat] }; // >50 — аномалия
  }
  for (const t of [10,5,1]) if (balance >= t) return { qty:t, price: ADULT_SUB_PRICES[t]?.[cat] };
  return { qty:null, price:undefined };
}

// ФОТ по тренерам за месяц — общая функция поверх существующих
// DB.getSummary + calcSalary (логику ЗП НЕ дублируем).
async function calcMonthPayroll(branch, year, month) {
  const data = await DB.getSummary(year, month, branch||null);
  const { groupSubstitutions=[], ptSubstitutions=[], childAutoByTrainer={} } = data;
  const adjMap = {}; (data.adjustments||[]).forEach(a=>{ adjMap[a.trainer_id]=a; });
  const rows = (data.profiles||[]).map(p=>{
    const sal = calcSalary({
      workouts:[...(data.workouts||[]).filter(w=>w.trainer_id===p.id),
                ...(ptSubstitutions||[]).filter(w=>w.trainer_id===p.id)],
      duties:(data.duties||[]).filter(d=>d.trainer_id===p.id),
      trainerGroups:(data.trainerGroups||[]).filter(tg=>tg.trainer_id===p.id),
      groupSessions:(data.groupSessions||[]).filter(gs=>gs.trainer_id===p.id),
      trialSessions:(data.trialSessions||[]).filter(t=>t.trainer_id===p.id),
      adjustment:adjMap[p.id]||null,
      childAutoSum:childAutoByTrainer[p.id]||0,
      groupSubstitutions, trainerId:p.id,
    });
    return {
      id:p.id, fio:p.fio,
      pt:    sal.ptSum+sal.dropInSum+sal.trialSum+sal.ptSubSum,
      duty:  sal.dutySum,
      group: sal.childSum+sal.adultSum+sal.groupSubSum,
      total: sal.total,
    };
  }).filter(r=>r.total>0).sort((a,b)=>b.total-a.total);
  const totalFot = rows.reduce((s,r)=>s+r.total,0);
  return { rows, totalFot, raw:data };
}

// ── Загрузчики данных (кешируются, переиспользуются Overview-карточками и хабами) ──
// Воркауты за месяц нужны сразу трём загрузчикам (Деньги/Загрузка/Контроль).
// Общий ключ + in-flight дедуп в cached() → один запрос вместо трёх параллельных.
function _anWs(year, month, branch) {
  return cached(`an_ws_${branch||'all'}_${year}_${month}`,
    () => DB.getAnWorkouts(year, month, branch), 300000);
}
function _anMoney(year, month, branch) {
  return cached(`an_money_${branch||'all'}_${year}_${month}`, async () => {
    const pr   = await calcMonthPayroll(branch, year, month);
    const data = pr.raw;
    const [childRev, subsRev, ws, allSubs] = await Promise.all([
      DB.getAnGroupRevenue(year, month, branch).catch(()=>[]),
      DB.getAnSubsRevenue(year, month, branch).catch(()=>[]),
      _anWs(year, month, branch).catch(()=>[]),
      DB.getAnAllSubs(year, month).catch(()=>[]),
    ]);
    const fioMap = {}; (data.profiles||[]).forEach(p=>{ fioMap[p.id]=p.fio; });
    const rev = {adultSub:0, childSub:0, drop:0, childGroup:0};
    const revByTrainer = {};
    const addRT = (id,v)=>{ revByTrainer[id]=(revByTrainer[id]||0)+v; };

    // Карта абонементов клиента (для accrual: размер пакета на дату занятия)
    const subMap = {};
    allSubs.forEach(s=>{ (subMap[s.client_id]=subMap[s.client_id]||[]).push(s); });
    Object.values(subMap).forEach(a=>a.sort((x,y)=>(y.start_date||'').localeCompare(x.start_date||'')));
    const qtyFor = (cid,date)=>{ const a=subMap[cid]||[]; const s=a.find(x=>(x.start_date||'')<=date)||a[a.length-1]; return s?.initial_balance; };

    // Проведённые ПТ: разовые/пробные → PT_PRICES (одинаково в обоих способах);
    // обычные ПТ копим для способа Б (accrual) = цена пакета ÷ кол-во.
    let accrualReg = 0;
    (ws||[]).forEach(w=>{
      const paid = !w.is_debt || w.debt_confirmed_at;
      if (!paid) return;
      if (w.is_drop_in) { const v=PT_PRICES[w.drop_in_category||1]; rev.drop+=v; addRT(w.trainer_id,v); return; }
      const cat=w.clients?.category||w.category_at_moment;
      const child=isChild(w.clients?.age);
      const qty=qtyFor(w.client_id, String(w.workout_date).slice(0,10));
      const m=_pkgMatch(child, qty, cat);
      accrualReg += (m.price && m.qty) ? m.price/m.qty : (PT_PRICES[cat]||0);
    });
    (data.trialSessions||[]).forEach(t=>{ const v=PT_PRICES[t.category]||0; rev.drop+=v; addRT(t.trainer_id,v); });

    // СПОСОБ А (основной, по продаже): абонементы, проданные за месяц, по цене купленного
    // пакета (нестандартный баланс приводится к пакету через _pkgMatch: дети — вверх,
    // взрослые — вниз). Баланс ≤ 0 — пустой абонемент, пропускаем.
    let subsCounted = 0;
    (subsRev||[]).forEach(s=>{
      const cat = s.clients?.category, child = isChild(s.clients?.age);
      const m = _pkgMatch(child, s.initial_balance, cat);
      if (!m.price) return;
      if (child) rev.childSub += m.price; else rev.adultSub += m.price;
      addRT(s.trainer_id, m.price); subsCounted++;
    });
    // Взрослые группы в выручку НЕ входят (услуга во взрослом абонементе; ФОТ — по посещениям).
    // Детские группы: каждый оплаченный клиент-месяц = GROUP_CHILD_PRICE.
    rev.childGroup = childRev.filter(r=>r.paid).length * GROUP_CHILD_PRICE;

    const totalRev   = rev.adultSub+rev.childSub+rev.drop+rev.childGroup;   // А: по продаже
    const accrualRev = Math.round(accrualReg)+rev.drop+rev.childGroup;      // Б: по начислению
    const topTrainers = Object.entries(revByTrainer)
      .map(([id,v])=>({fio:fioMap[id]||'—', sum:v}))
      .sort((a,b)=>b.sum-a.sum).slice(0,3);
    return {
      rev, totalRev, accrualRev,
      avgCheck:     subsCounted ? Math.round((rev.adultSub+rev.childSub)/subsCounted) : 0,
      ratio:        totalRev   ? Math.round(pr.totalFot/totalRev*100)   : 0,
      accrualRatio: accrualRev ? Math.round(pr.totalFot/accrualRev*100) : 0,
      fot: pr.totalFot, fotRows: pr.rows, topTrainers,
    };
  }, 300000);
}

function _anClients(year, month, branch) {
  return cached(`an_clients_${branch||'all'}_${year}_${month}`, async () => {
    const { clients, subscriptions } = await DB.getAnClients();
    const { fromDay, toDay } = _anRange(year, month);
    const today = todayStr();
    const inBranch = c => !branch || (c.profiles?.branches||[]).includes(branch);
    const cl = clients.filter(inBranch);
    const subsByClient = {};
    subscriptions.forEach(s=>{ (subsByClient[s.client_id]=subsByClient[s.client_id]||[]).push(s); });

    const active = cl.filter(c=>!c.is_archived && c.balance>0);
    const newClients = cl.filter(c=>{
      const ss = (subsByClient[c.id]||[]).filter(s=>s.start_date)
        .sort((a,b)=>a.start_date.localeCompare(b.start_date));
      if (!ss.length) return false;
      const first = ss[0].start_date;
      return first>=fromDay && first<toDay;
    });
    const churn = cl.filter(c=>{
      const all = subsByClient[c.id]||[];
      if (all.some(s=>s.is_active)) return false;
      const ended = all.filter(s=>s.end_date).sort((a,b)=>a.end_date.localeCompare(b.end_date));
      if (!ended.length) return false;
      const last = ended[ended.length-1];
      return last.end_date>=fromDay && last.end_date<toDay;
    });
    const risk = cl.filter(c=>!c.is_archived && c.balance>0 && c.balance<=3)
      .sort((a,b)=>a.balance-b.balance);
    const frozen = cl.filter(c=>!c.is_archived && c.freeze_end && c.freeze_end>=today)
      .sort((a,b)=>(a.freeze_end||'').localeCompare(b.freeze_end||''));

    const pkg = c => {
      const ss=(subsByClient[c.id]||[]).filter(s=>s.start_date)
        .sort((a,b)=>b.start_date.localeCompare(a.start_date));
      return ss[0]?.initial_balance ? `${ss[0].initial_balance} ПТ` : '—';
    };
    const closeNote = c => {
      const ss=(subsByClient[c.id]||[]).filter(s=>s.end_date)
        .sort((a,b)=>b.end_date.localeCompare(a.end_date));
      return ss[0]?.closing_note || '';
    };
    const tr = c => c.profiles?.fio || '—';
    return {
      activeCount:active.length, newCount:newClients.length,
      churnCount:churn.length, riskCount:risk.length, frozenCount:frozen.length,
      newClients: newClients.map(c=>({fio:c.fio, trainer:tr(c), date:c.subscription_start, pkg:pkg(c)})),
      churn:      churn.map(c=>({fio:c.fio, trainer:tr(c), date:c.subscription_end, note:closeNote(c)})),
      risk:       risk.map(c=>({fio:c.fio, trainer:tr(c), balance:c.balance, end:c.subscription_end})),
      frozen:     frozen.map(c=>({fio:c.fio, trainer:tr(c), start:c.freeze_start, end:c.freeze_end})),
    };
  }, 300000);
}

function _anLoad(year, month, branch) {
  return cached(`an_load_${branch||'all'}_${year}_${month}`, async () => {
    const ws = await _anWs(year, month, branch);
    const grid = {};                       // 'dow-hour' → count (dow 0=Пн)
    const byDay = [0,0,0,0,0,0,0];
    const byHour = {};
    const byTrainer = {};
    let total = 0;
    ws.forEach(w=>{
      const d = new Date(w.workout_date);
      const dow = (d.getDay()+6)%7;        // Пн=0 … Вс=6
      const h = d.getHours();
      byDay[dow]++; total++;
      byHour[h] = (byHour[h]||0)+1;
      grid[`${dow}-${h}`] = (grid[`${dow}-${h}`]||0)+1;
      const t = byTrainer[w.trainer_id] = byTrainer[w.trainer_id] || {fio:w.profiles?.fio||'—', count:0};
      t.count++;
    });
    let max = 0, peakKey = null;
    Object.entries(grid).forEach(([k,v])=>{ if (v>max){ max=v; peakKey=k; } });
    const peak = peakKey ? (()=>{ const [d,h]=peakKey.split('-'); return {day:DAYS_SHORT[+d], hour:`${String(h).padStart(2,'0')}:00`, count:max}; })() : null;
    const trainers = Object.values(byTrainer).sort((a,b)=>b.count-a.count);
    return { grid, byDay, byHour, max, total, peak, trainers };
  }, 300000);
}

function _anControl(year, month, branch) {
  return cached(`an_control_${branch||'all'}_${year}_${month}`, async () => {
    const [ctl, ws] = await Promise.all([
      DB.getAnControl(year, month, branch),
      _anWs(year, month, branch),
    ]);
    const byTrainer = {};
    const get = (id,fio) => (byTrainer[id] = byTrainer[id] || {fio:fio||'—', pt:0, notes:0, overdue:0});
    ws.filter(w=>!w.is_drop_in).forEach(w=>{ get(w.trainer_id, w.profiles?.fio).pt++; });
    let totalNotes=0, totalInTime=0, totalPt=0;
    Object.values(byTrainer).forEach(t=>{ totalPt+=t.pt; });
    ctl.notes.forEach(n=>{
      const t = get(n.trainer_id);
      t.notes++;
      const late = n.created_at && n.deadline && n.created_at > n.deadline;
      if (late) t.overdue++; else totalInTime++;
      totalNotes++;
    });
    const lateApproved = ctl.late.filter(r=>r.status==='approved').length;
    const activity = {};
    ctl.audit.forEach(a=>{ const d=String(a.created_at).slice(0,10); activity[d]=(activity[d]||0)+1; });
    return {
      byTrainer: Object.values(byTrainer).sort((a,b)=>b.pt-a.pt),
      notesPct: totalPt ? Math.round(totalInTime/totalPt*100) : 0,
      late: ctl.late, lateCount: ctl.late.length, lateApproved,
      dels: ctl.dels, delsCount: ctl.dels.length,
      activity,
    };
  }, 300000);
}

// ── Цвета и хелперы ──
// Норма ФОТ/Выручка = 37–42%. Вне нормы — отклонение (жёлтый), далеко — аномалия (красный).
function _ratioClass(r) {
  if (r>=37 && r<=42) return 'r-green';
  if (r>=30 && r<=50) return 'r-yellow';
  return 'r-red';
}
function _heatStyle(v, max) {
  if (!v) return 'background:var(--card)';
  const op = 0.18 + 0.72*(v/(max||1));
  return `background:rgba(124,58,237,${op.toFixed(2)});color:#fff`;
}
function _anSkel(n=3) {
  return Array.from({length:n}).map(()=>`<div class="an-skel-line"></div>`).join('');
}
function _statusBadge(s) {
  const m = {approved:['✅ Одобрено','var(--success)'], rejected:['❌ Отклонено','var(--danger)'], pending:['⏳ Ожидает','var(--hint)']};
  const [txt,col] = m[s] || [s||'—','var(--hint)'];
  return `<span style="font-size:11px;color:${col}">${txt}</span>`;
}
function _d(s) { return s ? fmtDate(s) : '—'; }

// ── OVERVIEW ──
async function renderAdminAnalytics(year, month, branch) {
  const now = new Date();
  if (year==null)  year  = now.getFullYear();
  if (month==null) month = now.getMonth()+1;
  if (branch===undefined) branch = null;
  setupBack(null); STATE._backFn = null;
  window._anCtx = { year, month, branch };

  const branches = await cached('branches',()=>DB.getBranches());
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="section-header"><h3>Аналитика</h3>
      <div class="month-nav">
        <button id="prev-an">‹</button>
        <span id="an-month">${fmtMY(year,month)}</span>
        <button id="next-an">›</button>
      </div>
    </div>
    <select id="an-branch" style="margin-bottom:14px">
      <option value="">Все филиалы</option>
      ${branches.map(b=>`<option ${b.name===branch?'selected':''}>${b.name}</option>`).join('')}
    </select>
    <div class="aov-grid">
      <div class="aov-card" id="aov-money"   onclick="openAnHub('money')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-clients" onclick="openAnHub('clients')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-load"    onclick="openAnHub('load')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-control" onclick="openAnHub('control')">${_anSkel(4)}</div>
    </div>
  </div>`;

  const goMonth = (dy,dm)=>renderAdminAnalytics(dm>12?year+1:(dm<1?year-1:year), dm>12?1:(dm<1?12:dm), branch);
  document.getElementById('prev-an')?.addEventListener('click',()=>goMonth(0,month-1));
  document.getElementById('next-an')?.addEventListener('click',()=>goMonth(0,month+1));
  document.getElementById('an-branch')?.addEventListener('change',e=>renderAdminAnalytics(year,month,e.target.value||null));

  _fillMoneyCard(year,month,branch);
  _fillClientsCard(year,month,branch);
  _fillLoadCard(year,month,branch);
  _fillControlCard(year,month,branch);
}

function openAnHub(which) {
  const {year,month,branch} = window._anCtx||{};
  if (which==='money')   renderAnalyticsMoneyHub(year,month,branch);
  if (which==='clients') renderAnalyticsClientsHub(year,month,branch);
  if (which==='load')    renderAnalyticsLoadHub(year,month,branch);
  if (which==='control') renderAnalyticsControlHub(year,month,branch);
}

async function _fillMoneyCard(y,m,b) {
  const el=document.getElementById('aov-money'); if(!el) return;
  try {
    const d=await _anMoney(y,m,b);
    el.innerHTML=`<h5>💰 Деньги и ФОТ</h5>
      <div class="aov-row"><span>Выручка</span><b>${fmt(d.accrualRev)}</b></div>
      <div class="aov-row"><span>Продажи</span><b>${fmt(d.totalRev)}</b></div>
      <div class="aov-row"><span>ФОТ</span><b>${fmt(d.fot)}</b></div>
      <div class="aov-row"><span>ФОТ/выручка</span><b class="${_ratioClass(d.accrualRatio)}">${d.accrualRatio}%</b></div>
      <span class="aov-arrow">›</span>`;
  } catch(e){ console.error(e); el.innerHTML=`<h5>💰 Деньги и ФОТ</h5><p class="hint">⚠️ Ошибка загрузки</p>`; }
}
async function _fillClientsCard(y,m,b) {
  const el=document.getElementById('aov-clients'); if(!el) return;
  try {
    const d=await _anClients(y,m,b);
    el.innerHTML=`<h5>👥 Клиентская база</h5>
      <div class="aov-row"><span>Активных</span><b>${d.activeCount}</b></div>
      <div class="aov-row"><span>Новых за месяц</span><b class="r-green">${d.newCount}</b></div>
      <div class="aov-row"><span>Отток</span><b class="r-red">${d.churnCount}</b></div>
      <div class="aov-row"><span>Зона риска (≤3)</span><b class="r-yellow">${d.riskCount}</b></div>
      <span class="aov-arrow">›</span>`;
  } catch(e){ console.error(e); el.innerHTML=`<h5>👥 Клиентская база</h5><p class="hint">⚠️ Ошибка загрузки</p>`; }
}
async function _fillLoadCard(y,m,b) {
  const el=document.getElementById('aov-load'); if(!el) return;
  try {
    const d=await _anLoad(y,m,b);
    // мини-карта 7×4: дни × блоки (утро 7-12, день 12-17, вечер 17-22, ночь иначе)
    const block=h=> h<7?3 : h<12?0 : h<17?1 : h<22?2 : 3;
    const mini={}; let mmax=0;
    Object.entries(d.grid).forEach(([k,v])=>{ const [dow,h]=k.split('-'); const key=`${dow}-${block(+h)}`; mini[key]=(mini[key]||0)+v; if(mini[key]>mmax)mmax=mini[key]; });
    const cells=[];
    for(let dd=0;dd<7;dd++) for(let bl=0;bl<4;bl++){ const v=mini[`${dd}-${bl}`]||0; cells.push(`<div class="aov-heat-cell" style="${_heatStyle(v,mmax)}"></div>`); }
    el.innerHTML=`<h5>🗓 Загрузка</h5>
      <div class="aov-mini-heat">${cells.join('')}</div>
      <div class="aov-row"><span>Пик</span><b>${d.peak?`${d.peak.day} ${d.peak.hour}`:'—'}</b></div>
      <div class="aov-row"><span>Всего ПТ</span><b>${d.total}</b></div>
      <span class="aov-arrow">›</span>`;
  } catch(e){ console.error(e); el.innerHTML=`<h5>🗓 Загрузка</h5><p class="hint">⚠️ Ошибка загрузки</p>`; }
}
async function _fillControlCard(y,m,b) {
  const el=document.getElementById('aov-control'); if(!el) return;
  try {
    const d=await _anControl(y,m,b);
    el.innerHTML=`<h5>🔍 Контроль</h5>
      <div class="aov-row"><span>Конспекты в срок</span><b class="${d.notesPct>=80?'r-green':d.notesPct>=50?'r-yellow':'r-red'}">${d.notesPct}%</b></div>
      <div class="aov-row"><span>Поздних внесений</span><b>${d.lateApproved}</b></div>
      <div class="aov-row"><span>Запросов на удаление</span><b>${d.delsCount}</b></div>
      <span class="aov-arrow">›</span>`;
  } catch(e){ console.error(e); el.innerHTML=`<h5>🔍 Контроль</h5><p class="hint">⚠️ Ошибка загрузки</p>`; }
}

// ── ХАБ 1: ДЕНЬГИ И ФОТ ──
async function renderAnalyticsMoneyHub(year, month, branch) {
  window._anCtx={year,month,branch};
  navPush(()=>renderAdminAnalytics(year,month,branch));
  setupBack(()=>renderAdminAnalytics(year,month,branch));
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>💰 Деньги и ФОТ</h3></div>
    <p class="hint">${fmtMY(year,month)}${branch?' · '+branch:' · все филиалы'}</p>
    <div id="ah-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const d=await _anMoney(year,month,branch);
    const types=[
      {l:'Абонементы взрослые', v:d.rev.adultSub},
      {l:'Абонементы детские',  v:d.rev.childSub},
      {l:'Разовые / пробные',   v:d.rev.drop},
      {l:'Группы детские',       v:d.rev.childGroup},
    ];
    const maxT=Math.max(1,...types.map(t=>t.v));
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-section"><div class="ah-h">Продажи за месяц по типам</div>
        ${types.map(t=>`<div class="ah-bar-row">
          <span class="ah-bar-lbl">${t.l}</span>
          <div class="ah-bar-track"><div class="ah-bar-fill" style="width:${Math.round(t.v/maxT*100)}%"></div></div>
          <span class="ah-bar-val">${fmt(t.v)}</span>
        </div>`).join('')}
        <div class="ah-bar-row" style="border-top:1px solid var(--border);margin-top:6px;padding-top:8px">
          <span class="ah-bar-lbl"><b>Итого</b></span><div class="ah-bar-track"></div>
          <span class="ah-bar-val"><b>${fmt(d.totalRev)}</b></span>
        </div>
      </div>

      <div class="ah-section"><div class="ah-h">ФОТ по тренерам</div>
        ${d.fotRows.length?`<div class="ah-table-wrap"><table class="ah-table">
          <thead><tr><th>Тренер</th><th>ПТ</th><th>Деж.</th><th>Группы</th><th>Итого</th></tr></thead>
          <tbody>${d.fotRows.map(r=>`<tr>
            <td>${r.fio}</td><td>${fmt(r.pt)}</td><td>${fmt(r.duty)}</td>
            <td>${r.group?fmt(r.group):'—'}</td><td class="ah-total">${fmt(r.total)}</td></tr>`).join('')}</tbody>
          <tfoot><tr><td colspan="4"><b>Итого ФОТ</b></td><td class="ah-total"><b>${fmt(d.fot)}</b></td></tr></tfoot>
        </table></div>`:'<p class="hint">Нет данных за этот период</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">ФОТ / Выручка (по начислению)</div>
        <div class="ah-ratio ${_ratioClass(d.accrualRatio)}">${d.accrualRatio}%</div>
        <p class="hint" style="text-align:center">Норма: 37–42%. Выручка (начисление): ${fmt(d.accrualRev)}</p>
      </div>

      <div class="ah-section"><div class="ah-h">Справка: по продаже (касса)</div>
        <div class="ah-bar-row"><span class="ah-bar-lbl">Продажи за месяц</span><div class="ah-bar-track"></div><span class="ah-bar-val">${fmt(d.totalRev)}</span></div>
        <div class="ah-bar-row"><span class="ah-bar-lbl">ФОТ / Продажи</span><div class="ah-bar-track"></div><span class="ah-bar-val">${d.ratio}%</span></div>
        <p class="hint">«По продаже» = полная цена абонементов, проданных в этом месяце (кэш). % низкий, т.к. пакеты оплачивают вперёд, а ФОТ — за проведённые занятия. Для KPI ФОТ/Выручка смотри «по начислению» выше.</p>
      </div>

      ${d.topTrainers.length?`<div class="ah-section"><div class="ah-h">Топ-3 тренера по выручке</div>
        <div class="ah-top3">${d.topTrainers.map((t,i)=>`<div class="ah-top-card">
          <div class="ah-top-rank">${['🥇','🥈','🥉'][i]}</div>
          <div class="ah-top-fio">${t.fio}</div>
          <div class="ah-top-sum">${fmt(t.sum)}</div></div>`).join('')}</div>
      </div>`:''}`;
  } catch(e){ console.error(e); document.getElementById('ah-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

// ── ХАБ 2: КЛИЕНТСКАЯ БАЗА ──
async function renderAnalyticsClientsHub(year, month, branch) {
  window._anCtx={year,month,branch};
  navPush(()=>renderAdminAnalytics(year,month,branch));
  setupBack(()=>renderAdminAnalytics(year,month,branch));
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>👥 Клиентская база</h3></div>
    <p class="hint">${fmtMY(year,month)}${branch?' · '+branch:' · все филиалы'}</p>
    <div id="ah-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const d=await _anClients(year,month,branch);
    const list=(items,render,empty)=> items.length
      ? items.slice(0,10).map(render).join('') +
        (items.length>10?`<div class="an-more" style="display:none">${items.slice(10).map(render).join('')}</div>
          <button class="btn btn-sm" style="width:100%;margin-top:8px" onclick="this.previousElementSibling.style.display='block';this.remove()">Показать всех (${items.length})</button>`:'')
      : `<p class="hint">${empty}</p>`;
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-tiles">
        <div class="ah-tile"><div class="ah-tile-v">${d.activeCount}</div><div class="ah-tile-l">Активных</div></div>
        <div class="ah-tile"><div class="ah-tile-v r-green">${d.newCount}</div><div class="ah-tile-l">Новых за месяц</div></div>
        <div class="ah-tile"><div class="ah-tile-v r-red">${d.churnCount}</div><div class="ah-tile-l">Отток</div></div>
        <div class="ah-tile"><div class="ah-tile-v r-yellow">${d.riskCount}</div><div class="ah-tile-l">Зона риска ≤3</div></div>
      </div>

      <div class="ah-section"><div class="ah-h">Новые клиенты</div>
        ${list(d.newClients, c=>`<div class="ah-li"><div><b>${c.fio}</b><div class="hint">${c.trainer} · ${c.pkg}</div></div><span class="hint">${_d(c.date)}</span></div>`, 'Нет новых')}
      </div>
      <div class="ah-section"><div class="ah-h">Отток</div>
        ${list(d.churn, c=>`<div class="ah-li"><div><b>${c.fio}</b><div class="hint">${c.trainer}${c.note?' · '+c.note:''}</div></div><span class="hint">${_d(c.date)}</span></div>`, 'Нет оттока')}
      </div>
      <div class="ah-section"><div class="ah-h">Зона риска (≤3 занятий)</div>
        ${list(d.risk, c=>`<div class="ah-li"><div><b>${c.fio}</b><div class="hint">${c.trainer}${c.end?' · до '+_d(c.end):''}</div></div><span class="ah-badge r-yellow">${c.balance} ПТ</span></div>`, 'Никого в зоне риска')}
      </div>
      <div class="ah-section"><div class="ah-h">На заморозке</div>
        ${list(d.frozen, c=>`<div class="ah-li"><div><b>${c.fio}</b><div class="hint">${c.trainer}</div></div><span class="hint">${_d(c.start)} → ${_d(c.end)}</span></div>`, 'Нет на заморозке')}
      </div>`;
  } catch(e){ console.error(e); document.getElementById('ah-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

// ── ХАБ 3: ЗАГРУЗКА ──
async function renderAnalyticsLoadHub(year, month, branch) {
  window._anCtx={year,month,branch};
  navPush(()=>renderAdminAnalytics(year,month,branch));
  setupBack(()=>renderAdminAnalytics(year,month,branch));
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>🗓 Загрузка</h3></div>
    <p class="hint">${fmtMY(year,month)}${branch?' · '+branch:' · все филиалы'}</p>
    <div id="ah-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const d=await _anLoad(year,month,branch);
    const hours=Array.from({length:16},(_,i)=>i+7); // 07..22
    let head=`<div class="heat-cell heat-corner"></div>`+hours.map(h=>`<div class="heat-cell heat-hdr">${String(h).padStart(2,'0')}</div>`).join('');
    let rows='';
    for(let dd=0;dd<7;dd++){
      rows+=`<div class="heat-cell heat-day">${DAYS_SHORT[dd]}</div>`;
      rows+=hours.map(h=>{ const v=d.grid[`${dd}-${h}`]||0; return `<div class="heat-cell" style="${_heatStyle(v,d.max)}" title="${DAYS_SHORT[dd]} ${String(h).padStart(2,'0')}:00 — ${v} ПТ">${v||''}</div>`; }).join('');
    }
    const maxDay=Math.max(1,...d.byDay);
    const peakHours=Object.entries(d.byHour).sort((a,b)=>b[1]-a[1]).slice(0,3);
    const quietHours=Object.entries(d.byHour).sort((a,b)=>a[1]-b[1]).slice(0,3);
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-section"><div class="ah-h">Тепловая карта (ПТ по часам)</div>
        <div class="heat-scroll"><div class="heat-grid" style="grid-template-columns:32px repeat(16,26px)">${head}${rows}</div></div>
        <div class="heat-legend"><span>меньше</span><div class="heat-legend-bar"></div><span>больше</span></div>
      </div>

      <div class="ah-section"><div class="ah-h">Распределение по дням</div>
        ${DAYS_SHORT.map((dn,i)=>`<div class="ah-bar-row">
          <span class="ah-bar-lbl" style="width:30px">${dn}</span>
          <div class="ah-bar-track"><div class="ah-bar-fill" style="width:${Math.round(d.byDay[i]/maxDay*100)}%"></div></div>
          <span class="ah-bar-val">${d.byDay[i]}</span></div>`).join('')}
      </div>

      <div class="ah-section"><div class="ah-h">По тренерам</div>
        ${d.trainers.length?`<div class="ah-table-wrap"><table class="ah-table">
          <thead><tr><th>Тренер</th><th>ПТ</th><th>Доля</th></tr></thead>
          <tbody>${d.trainers.map(t=>`<tr><td>${t.fio}</td><td>${t.count}</td>
            <td>${d.total?Math.round(t.count/d.total*100):0}%</td></tr>`).join('')}</tbody>
        </table></div>`:'<p class="hint">Нет данных</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">Пиковые и свободные часы</div>
        <div class="ah-twocol">
          <div><div class="hint" style="margin-bottom:4px">🔥 Пиковые</div>
            ${peakHours.map(([h,c])=>`<div class="ah-li"><b>${String(h).padStart(2,'0')}:00</b><span class="hint">${c} ПТ</span></div>`).join('')||'<p class="hint">—</p>'}</div>
          <div><div class="hint" style="margin-bottom:4px">💤 Свободные</div>
            ${quietHours.map(([h,c])=>`<div class="ah-li"><b>${String(h).padStart(2,'0')}:00</b><span class="hint">${c} ПТ</span></div>`).join('')||'<p class="hint">—</p>'}</div>
        </div>
      </div>`;
  } catch(e){ console.error(e); document.getElementById('ah-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

// ── ХАБ 4: КОНТРОЛЬ ──
async function renderAnalyticsControlHub(year, month, branch) {
  window._anCtx={year,month,branch};
  navPush(()=>renderAdminAnalytics(year,month,branch));
  setupBack(()=>renderAdminAnalytics(year,month,branch));
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>🔍 Контроль</h3></div>
    <p class="hint">${fmtMY(year,month)}${branch?' · '+branch:' · все филиалы'}</p>
    <div id="ah-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  try {
    const d=await _anControl(year,month,branch);
    const rowCls=t=> t.pt? (t.notes/t.pt*100<50?'ah-row-red':t.notes/t.pt*100<80?'ah-row-yellow':'') : '';
    const maxAct=Math.max(1,...Object.values(d.activity));
    const days=Object.keys(d.activity).sort();
    document.getElementById('ah-body').innerHTML=`
      <div class="ah-section"><div class="ah-h">Конспекты по тренерам</div>
        ${d.byTrainer.length?`<div class="ah-table-wrap"><table class="ah-table">
          <thead><tr><th>Тренер</th><th>ПТ</th><th>Консп.</th><th>%</th><th>Проср.</th></tr></thead>
          <tbody>${d.byTrainer.map(t=>{const p=t.pt?Math.round(t.notes/t.pt*100):0;return `<tr class="${rowCls(t)}">
            <td>${t.fio}</td><td>${t.pt}</td><td>${t.notes}</td><td>${p}%</td>
            <td>${t.overdue?`<span class="r-red">${t.overdue}</span>`:'—'}</td></tr>`;}).join('')}</tbody>
        </table></div>`:'<p class="hint">Нет данных</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">Поздние внесения ПТ (${d.lateCount})</div>
        ${d.late.length?d.late.map(r=>`<div class="ah-li">
          <div><b>${r.profiles?.fio||'—'}</b><div class="hint">${r.clients?.fio||'—'} · ПТ ${_d(r.workout_date)}</div></div>
          <div style="text-align:right"><div class="hint">${_d(r.created_at)}</div>${_statusBadge(r.status)}</div></div>`).join(''):'<p class="hint">Нет</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">Запросы на удаление ПТ (${d.delsCount})</div>
        ${d.dels.length?d.dels.map(r=>`<div class="ah-li">
          <div><b>${r.profiles?.fio||'—'}</b><div class="hint">${r.client_name||'—'} · ПТ ${_d(r.workout_date)}</div></div>
          <div style="text-align:right"><div class="hint">${_d(r.created_at)}</div>${_statusBadge(r.status)}</div></div>`).join(''):'<p class="hint">Нет</p>'}
      </div>

      <div class="ah-section"><div class="ah-h">Активность по дням</div>
        ${days.length?`<div class="ah-actchart">${days.map(dt=>`<div class="ah-actbar" title="${fmtDate(dt)} — ${d.activity[dt]}" style="height:${Math.round(d.activity[dt]/maxAct*100)}%"></div>`).join('')}</div>
          <div class="hint" style="text-align:center;margin-top:4px">${days.length} дн. · всего ${Object.values(d.activity).reduce((s,v)=>s+v,0)} действий</div>`:'<p class="hint">Нет действий за период</p>'}
      </div>`;
  } catch(e){ console.error(e); document.getElementById('ah-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}
