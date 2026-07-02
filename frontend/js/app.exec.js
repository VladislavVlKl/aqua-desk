// =============================================
// app.exec.js — вынесено из app.js (Этап 3)
// Секции: CEO (топ-менеджмент) / RECEPTION (ресепшн) / MANAGER (управляющий)
// Грузится после app.js и app.admin.js. Порядок исполнения сохранён.
// =============================================

// ============================================================
// SECTION: CEO — renderCeoApp, renderCeoFinance, renderCeoStats, renderCeoTrainers
// ============================================================
async function renderCeoApp() {
  setupBack(null);
  setScreen(`
    <div class="app-header">
      <div>
        <div class="app-title">👑 AquaDesk</div>
        <div class="app-sub">${STATE.profile.fio} · Топ-менеджмент</div>
      </div>
      <button class="btn-icon" id="notif-bell" onclick="renderInAppNotifications()" style="position:relative">🔔<span id="notif-count" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center"></span></button>
    </div>
    <div id="tab-content" class="tab-content"></div>
    <nav class="bottom-nav">
      <button class="nav-btn" onclick="ceoTab('finance')"><span>💰</span>Финансы</button>
      <button class="nav-btn" onclick="ceoTab('stats')"><span>📊</span>Аналитика</button>
      <button class="nav-btn" onclick="ceoTab('trainers')"><span>🏋️</span>Тренеры</button>
      <button class="nav-btn" onclick="ceoTab('tech')"><span>⚙️</span>Техчасть</button>
    </nav>`);
  ceoTab('finance');
  setTimeout(checkInAppNotifications, 2000);
}

function ceoTab(tab) {
  const tabs = ['finance','stats','trainers','tech'];
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',tabs[i]===tab));
  if (tab==='finance')  renderCeoFinance();
  if (tab==='stats')    renderCeoStats();
  if (tab==='trainers') renderCeoTrainers();
  if (tab==='tech')     renderCeoTech();
}

// ЗП всех тренеров за месяц из данных getSummary → [{p, sal}]
function ceoFotRows(data) {
  const {groupSubstitutions=[],ptSubstitutions=[],childAutoByTrainer={}} = data;
  const adjMap=aggAdjustments(data.adjustments);
  return (data.profiles||[]).map(p=>({p, sal: calcSalary({
    workouts:[...(data.workouts||[]).filter(w=>w.trainer_id===p.id),
              ...(ptSubstitutions||[]).filter(w=>w.trainer_id===p.id)],
    duties:(data.duties||[]).filter(d=>d.trainer_id===p.id),
    trainerGroups:(data.trainerGroups||[]).filter(tg=>tg.trainer_id===p.id),
    groupSessions:(data.groupSessions||[]).filter(gs=>gs.trainer_id===p.id),
    trialSessions:(data.trialSessions||[]).filter(t=>t.trainer_id===p.id),
    adjustment:adjMap[p.id]||null,
    childAutoSum:childAutoByTrainer[p.id]||0,
    groupSubstitutions, trainerId:p.id,
  })}));
}

// Общие хелперы для расчёта выручки (используются в Finance и Trainers)
const _isPaidPT = w => !w.is_drop_in && (!w.is_debt || w.debt_confirmed_at);
const _wRev     = w => w.is_drop_in ? (PT_PRICES[w.drop_in_category||1]||0) : (PT_PRICES[w.category_at_moment]||0);
const _ptRev    = ws => (ws||[]).filter(_isPaidPT).reduce((s,w)=>s+_wRev(w),0);
const _diRev    = ws => (ws||[]).filter(w=>w.is_drop_in).reduce((s,w)=>s+_wRev(w),0);
const _grRev    = gps => (gps||[]).filter(g=>g.paid).reduce((s,g)=>s+Number(g.amount||0),0);

// Общий шаблон вкладки с переключателем месяца
function _ceoMonthShell(title, bodyId, prevId, nextId, year, month) {
  return `<div class="tab-pad">
    <div class="section-header"><h3>${title}</h3>
      <div class="month-nav">
        <button id="${prevId}">‹</button>
        <span id="${nextId}-lbl">${fmtMY(year,month)}</span>
        <button id="${nextId}">›</button>
      </div>
    </div>
    <div id="${bodyId}"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
}

// Карточка метрики (переиспользуется в Finance и Stats)
function _anCard(icon, label, val, currN, prevN, py, pm, higherIsBetter=true) {
  return `<div class="an-card">
    <div class="an-icon">${icon}</div>
    <div class="an-val">${val}</div>
    <div class="an-label">${label}</div>
    ${prevN?`<div class="an-delta ${pctClass(currN,prevN,higherIsBetter)}">${pct(currN,prevN)} vs ${fmtMY(py,pm)}</div>`:''}
  </div>`;
}

// ── ФИНАНСЫ ───────────────────────────────────
async function renderCeoFinance() {
  let year=new Date().getFullYear(), month=new Date().getMonth()+1;
  $('#tab-content').innerHTML = _ceoMonthShell('💰 Финансы','ceo-fin-body','ceo-fin-prev','ceo-fin-next',year,month);

  const load = async () => {
    const body=document.getElementById('ceo-fin-body'); if (!body) return;
    body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
    try {
      const py=month===1?year-1:year, pm=month===1?12:month-1;
      const [curr, prev, extra, branches] = await Promise.all([
        DB.getSummary(year, month, null),
        DB.getSummary(py, pm, null),
        DB.getCeoAnalytics(year, month),
        cached('branches',()=>DB.getBranches()),
      ]);
      const mShort = v => v>=1000000?(v/1000000).toFixed(1).replace('.0','')+' млн':fmt(Math.round(v));

      const currPtRev=_ptRev(curr.workouts), currDiRev=_diRev(curr.workouts), currGrRev=_grRev(extra.groupPayments);
      const prevPtRev=_ptRev(prev.workouts), prevDiRev=_diRev(prev.workouts), prevGrRev=_grRev(extra.prevGroupPayments);
      const revenue=currPtRev+currDiRev+currGrRev, prevRevenue=prevPtRev+prevDiRev+prevGrRev;

      const fotRows=ceoFotRows(curr);
      const fot=fotRows.reduce((s,r)=>s+r.sal.total,0);
      const prevFot=ceoFotRows(prev).reduce((s,r)=>s+r.sal.total,0);
      const ratio=revenue>0?Math.round(fot/revenue*100):0;
      const prevRatio=prevRevenue>0?Math.round(prevFot/prevRevenue*100):0;

      const activeBase=(extra.clients||[]).filter(c=>c.balance>0);
      const avgCheck=activeBase.length?revenue/activeBase.length:0;

      const revRow=(label,val,prevVal)=>{
        const share=revenue>0?Math.round(val/revenue*100):0;
        return `<div style="margin-bottom:10px">
          <div style="display:flex;justify-content:space-between;font-size:13px;margin-bottom:4px">
            <span>${label}</span>
            <span><b>${fmt(Math.round(val))}</b> сум
              <span class="hint" style="margin-left:4px">${share}%</span>
              <span class="an-delta ${pctClass(val,prevVal)}" style="margin-left:4px">${pct(val,prevVal)}</span>
            </span>
          </div>
          <div style="height:6px;background:var(--card);border-radius:3px;overflow:hidden">
            <div style="height:100%;width:${share}%;background:var(--accent,#7c3aed);border-radius:3px"></div>
          </div>
        </div>`;
      };

      body.innerHTML=`
        <div class="an-grid" style="margin-bottom:8px">
          ${_anCard('📈','Выручка',mShort(revenue),revenue,prevRevenue,py,pm,true)}
          ${_anCard('💸','ФОТ',mShort(fot),fot,prevFot,py,pm,false)}
          ${_anCard('⚖️','ФОТ / Выручка',ratio+'%',ratio,prevRatio,py,pm,false)}
          ${_anCard('🧾','Ср. чек',mShort(avgCheck),Math.round(avgCheck),0,py,pm,true)}
        </div>
        <p class="hint" style="font-size:11px;margin:0 0 14px">
          ПТ — расчётно (проведённые × тариф категории). Группы — фактические оплаты.
          Ср. чек = выручка / ${activeBase.length} активных клиентов.
        </p>

        <div style="margin-bottom:20px">
          ${revRow('🏊 ПТ по абонементам',currPtRev,prevPtRev)}
          ${revRow('🎟 Разовые',currDiRev,prevDiRev)}
          ${revRow('👥 Группы (оплаты)',currGrRev,prevGrRev)}
        </div>

        <h4 style="margin-bottom:10px">По филиалам</h4>
        ${branches.map(b=>{
          const bPT=(curr.workouts||[]).filter(w=>w.branch===b.name&&_isPaidPT(w)).length;
          const bDi=(curr.workouts||[]).filter(w=>w.branch===b.name&&w.is_drop_in).length;
          const bRev=(curr.workouts||[]).filter(w=>w.branch===b.name).reduce((s,w)=>
            (_isPaidPT(w)||w.is_drop_in)?s+_wRev(w):s, 0);
          return `<div class="staff-card" style="flex-direction:column;gap:4px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:center">
              <div style="font-weight:700;font-size:14px">${b.name}</div>
              <div style="font-size:13px;font-weight:600">${fmt(Math.round(bRev))} сум</div>
            </div>
            <div style="font-size:12px;color:var(--hint);display:flex;gap:12px">
              <span>🏊 ${bPT} ПТ</span>${bDi?`<span>🎟 ${bDi} разовых</span>`:''}
            </div>
          </div>`;
        }).join('')}
      `;
    } catch(e) { document.getElementById('ceo-fin-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
  };

  document.getElementById('ceo-fin-prev')?.addEventListener('click',()=>{
    if(month===1){year--;month=12;}else month--;
    document.getElementById('ceo-fin-next-lbl').textContent=fmtMY(year,month); load();
  });
  document.getElementById('ceo-fin-next')?.addEventListener('click',()=>{
    if(month===12){year++;month=1;}else month++;
    document.getElementById('ceo-fin-next-lbl').textContent=fmtMY(year,month); load();
  });
  await load();
}

// ── АНАЛИТИКА (клиенты + тренировки + загруженность) ──────────
async function renderCeoStats() {
  let year=new Date().getFullYear(), month=new Date().getMonth()+1;
  $('#tab-content').innerHTML = _ceoMonthShell('📊 Аналитика','ceo-st-body','ceo-st-prev','ceo-st-next',year,month);

  const load = async () => {
    const body=document.getElementById('ceo-st-body'); if (!body) return;
    body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
    try {
      const py=month===1?year-1:year, pm=month===1?12:month-1;
      const [curr, prev, extra] = await Promise.all([
        DB.getSummary(year, month, null),
        DB.getSummary(py, pm, null),
        DB.getCeoAnalytics(year, month),
      ]);

      const clients=extra.clients||[];
      const activeBase=clients.filter(c=>c.balance>0);
      const avgBalance=activeBase.length?activeBase.reduce((s,c)=>s+c.balance,0)/activeBase.length:0;

      // Новые клиенты — первый абонемент в этом месяце
      const firstSub={};
      (extra.subscriptions||[]).forEach(s=>{
        if (!firstSub[s.client_id]||s.start_date<firstSub[s.client_id]) firstSub[s.client_id]=s.start_date;
      });
      const mStart=`${year}-${String(month).padStart(2,'0')}-01`;
      const mEnd=new Date(year,month,1).toISOString().slice(0,10);
      const pStart=`${py}-${String(pm).padStart(2,'0')}-01`;
      const newCurr=Object.values(firstSub).filter(d=>d>=mStart&&d<mEnd).length;
      const newPrev=Object.values(firstSub).filter(d=>d>=pStart&&d<mStart).length;

      // Отток
      const cutoff=new Date(Date.now()-14*86400000).toISOString().slice(0,10);
      const churned=clients.filter(c=>c.balance<=0&&c.subscription_end&&c.subscription_end<cutoff);
      const atRisk=clients.filter(c=>c.balance<=0&&c.subscription_end&&c.subscription_end>=cutoff&&c.subscription_end<todayStr());
      const fioMap={}; (curr.profiles||[]).forEach(p=>fioMap[p.id]=p.fio);

      // ПТ за месяц
      const currPT=(curr.workouts||[]).filter(_isPaidPT).length;
      const prevPT=(prev.workouts||[]).filter(_isPaidPT).length;
      const currDi=(curr.workouts||[]).filter(w=>w.is_drop_in).length;
      const prevDi=(prev.workouts||[]).filter(w=>w.is_drop_in).length;

      // Загруженность по слотам
      const HOURS=Array.from({length:16},(_,i)=>i+7);
      const heat=Array.from({length:7},()=>({}));
      let maxHeat=0;
      (extra.slots||[]).filter(s=>s.slot_type!=='duty').forEach(s=>{
        const sh=parseInt(s.start_time), eh=Math.max(sh+1,parseInt(s.end_time)||sh+1);
        for (let h=sh; h<eh; h++) {
          if (h<7||h>22||!heat[s.day_of_week]) continue;
          heat[s.day_of_week][h]=(heat[s.day_of_week][h]||0)+1;
          maxHeat=Math.max(maxHeat,heat[s.day_of_week][h]);
        }
      });

      body.innerHTML=`
        <h4>👤 Клиенты</h4>
        <div class="an-grid" style="margin-bottom:8px">
          ${_anCard('👥','Активная база',activeBase.length,activeBase.length,0,py,pm,true)}
          ${_anCard('➕','Новых',newCurr,newCurr,newPrev,py,pm,true)}
          ${_anCard('🚪','Отток >14д',churned.length,churned.length,0,py,pm,false)}
          ${_anCard('🔋','Ср. остаток',avgBalance.toFixed(1),Math.round(avgBalance*10),0,py,pm,true)}
        </div>
        ${atRisk.length?`<div class="warn-banner" style="margin-bottom:10px;font-size:12px">
          ⏳ <b>Риск оттока:</b> ${atRisk.length} клиентов закончили ПТ за последние 14 дней
        </div>`:''}
        ${churned.length?`<details style="margin-bottom:16px">
          <summary style="font-size:12px;color:var(--hint);cursor:pointer">Отток — список (${churned.length})</summary>
          <div style="margin-top:6px">
            ${churned.slice(0,15).map(c=>`<div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:12px">
              <span>${c.fio}</span><span class="hint">${fioMap[c.trainer_id]||''} · до ${fmtDate(c.subscription_end)}</span>
            </div>`).join('')}
            ${churned.length>15?`<p class="hint" style="margin-top:4px">Ещё ${churned.length-15}...</p>`:''}
          </div>
        </details>`:``}

        <h4 style="margin-top:4px">🏊 Тренировки</h4>
        <div class="an-grid" style="margin-bottom:20px">
          ${_anCard('📋','ПТ за месяц',currPT,currPT,prevPT,py,pm,true)}
          ${_anCard('🎟','Разовые',currDi,currDi,prevDi,py,pm,true)}
        </div>

        <h4>🕐 Загруженность по времени</h4>
        <p class="hint" style="font-size:11px;margin-bottom:8px">Слоты расписания (ПТ + группы), число одновременных занятий</p>
        <div style="display:grid;grid-template-columns:38px repeat(7,1fr);gap:2px;font-size:10px">
          <div></div>${DAYS_SHORT.map(d=>`<div style="text-align:center;color:var(--hint)">${d}</div>`).join('')}
          ${HOURS.map(h=>`<div style="color:var(--hint);line-height:18px">${String(h).padStart(2,'0')}:00</div>`+
            DAYS_SHORT.map((_,d)=>{
              const v=heat[d][h]||0, a=maxHeat?v/maxHeat:0;
              return `<div style="height:18px;border-radius:3px;text-align:center;line-height:18px;background:${v?`rgba(124,58,237,${(0.15+0.85*a).toFixed(2)})`:'var(--card)'};color:${a>0.5?'#fff':'var(--hint)'}">${v||''}</div>`;
            }).join('')).join('')}
        </div>
      `;
    } catch(e) { document.getElementById('ceo-st-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
  };

  document.getElementById('ceo-st-prev')?.addEventListener('click',()=>{
    if(month===1){year--;month=12;}else month--;
    document.getElementById('ceo-st-next-lbl').textContent=fmtMY(year,month); load();
  });
  document.getElementById('ceo-st-next')?.addEventListener('click',()=>{
    if(month===12){year++;month=1;}else month++;
    document.getElementById('ceo-st-next-lbl').textContent=fmtMY(year,month); load();
  });
  await load();
}

// ── ТРЕНЕРЫ — клиенты, ПТ, ФОТ ────────────────
async function renderCeoTrainers() {
  let year=new Date().getFullYear(), month=new Date().getMonth()+1;
  $('#tab-content').innerHTML = _ceoMonthShell('🏋️ Тренеры','ceo-tr-body','ceo-tr-prev','ceo-tr-next',year,month);

  const load = async () => {
    const body=document.getElementById('ceo-tr-body'); if (!body) return;
    body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
    try {
      const [data, allClients] = await Promise.all([
        DB.getSummary(year, month, null),
        DB.getAllClients(),
      ]);

      const fotRows=ceoFotRows(data).sort((a,b)=>b.sal.total-a.sal.total);
      const totalFot=fotRows.reduce((s,r)=>s+r.sal.total,0);

      // Активных клиентов на тренера
      const activeByTrainer={};
      allClients.filter(c=>!c.is_archived&&c.balance>0).forEach(c=>{
        activeByTrainer[c.trainer_id]=(activeByTrainer[c.trainer_id]||0)+1;
      });
      const totalByTrainer={};
      allClients.filter(c=>!c.is_archived).forEach(c=>{
        totalByTrainer[c.trainer_id]=(totalByTrainer[c.trainer_id]||0)+1;
      });

      // ПТ за месяц на тренера
      const ptByTrainer={};
      (data.workouts||[]).filter(_isPaidPT).forEach(w=>{
        ptByTrainer[w.trainer_id]=(ptByTrainer[w.trainer_id]||0)+1;
      });

      const maxPt=Math.max(1,...fotRows.map(r=>ptByTrainer[r.p.id]||0));
      const maxClients=Math.max(1,...fotRows.map(r=>activeByTrainer[r.p.id]||0));

      body.innerHTML=`
        <div class="summary-cards" style="margin-bottom:16px">
          <div class="summary-card"><div class="s-val">${fotRows.filter(r=>r.sal.total>0).length}</div><div class="s-lbl">Тренеров</div></div>
          <div class="summary-card accent"><div class="s-val">${fmt(Math.round(totalFot))}</div><div class="s-lbl">ФОТ (сум)</div></div>
        </div>
        ${fotRows.map(({p,sal})=>{
          const active=activeByTrainer[p.id]||0;
          const total=totalByTrainer[p.id]||0;
          const pt=ptByTrainer[p.id]||0;
          return `<div class="staff-card" style="flex-direction:column;gap:6px;margin-bottom:8px">
            <div style="display:flex;justify-content:space-between;align-items:flex-start;gap:8px">
              <div class="staff-fio" style="flex:1;min-width:0">${p.fio}</div>
              <div style="font-weight:700;font-size:15px;white-space:nowrap;flex-shrink:0">${fmt(sal.total)} сум</div>
            </div>
            <div style="display:grid;grid-template-columns:1fr 1fr;gap:6px;font-size:12px">
              <div>
                <div style="color:var(--hint);margin-bottom:2px">Клиентов активных</div>
                <div style="font-weight:600">${active} <span class="hint">/ ${total} всего</span></div>
                <div style="height:4px;background:var(--card);border-radius:2px;margin-top:3px;overflow:hidden">
                  <div style="height:100%;width:${Math.round(active/maxClients*100)}%;background:#10b981;border-radius:2px"></div>
                </div>
              </div>
              <div>
                <div style="color:var(--hint);margin-bottom:2px">ПТ за месяц</div>
                <div style="font-weight:600">${pt}</div>
                <div style="height:4px;background:var(--card);border-radius:2px;margin-top:3px;overflow:hidden">
                  <div style="height:100%;width:${Math.round(pt/maxPt*100)}%;background:var(--accent,#7c3aed);border-radius:2px"></div>
                </div>
              </div>
            </div>
            <div style="font-size:11px;color:var(--hint);display:flex;gap:10px;flex-wrap:wrap">
              ${sal.cat[1]+sal.cat[2]+sal.cat[3]>0?`<span>🏊 ${sal.cat[1]+sal.cat[2]+sal.cat[3]} ПТ</span>`:''}
              ${sal.hours>0?`<span>⏱ ${sal.hours.toFixed(1)}ч деж.</span>`:''}
              ${sal.adultSum+sal.childSum>0?`<span>👥 ${fmt(sal.adultSum+sal.childSum)} группы</span>`:''}
              ${sal.bonus>0?`<span style="color:var(--success)">+${fmt(sal.bonus)}</span>`:''}
              ${sal.penalty>0?`<span style="color:var(--danger)">−${fmt(sal.penalty)}</span>`:''}
            </div>
          </div>`;
        }).join('')}
      `;
    } catch(e) { document.getElementById('ceo-tr-body').innerHTML='<p class="hint">Ошибка</p>'; console.error(e); }
  };

  document.getElementById('ceo-tr-prev')?.addEventListener('click',()=>{
    if(month===1){year--;month=12;}else month--;
    document.getElementById('ceo-tr-next-lbl').textContent=fmtMY(year,month); load();
  });
  document.getElementById('ceo-tr-next')?.addEventListener('click',()=>{
    if(month===12){year++;month=1;}else month++;
    document.getElementById('ceo-tr-next-lbl').textContent=fmtMY(year,month); load();
  });
  await load();
}


// setClientColor moved to module

// renderTrainerEditProfile moved to module

// ============================================================
// SECTION: RECEPTION — панель ресепшена: подтверждение списаний (Шаг 1 → 1С)
// ============================================================
function _recBranch() { return STATE.profile.branches?.[0] || ''; }
function _recToday()  {
  const n=new Date(), p=x=>String(x).padStart(2,'0');
  return `${n.getFullYear()}-${p(n.getMonth()+1)}-${p(n.getDate())}`;
}
function _recMonth(d) { return `${d.slice(0,7)}-01`; }
const _recTypeLabel = (it) =>
    it._trial               ? '🆕 Пробная'
  : it.substitute_for!=null ? '🔄 Замена'
  : it.is_drop_in           ? 'Разовое'
  : it.is_debt              ? 'В долг'
  :                           'ПТ';

function renderReceptionApp(initialTab='pending') {
  setupBack(null);
  if (!STATE._recDate) STATE._recDate = _recToday();
  setScreen(`<div class="app-header">
    <div><div class="app-title">🛎 Ресепшн</div>
      <div class="app-sub">${STATE.profile.fio}${_recBranch()?' · '+_recBranch():''}</div></div>
    <div style="display:flex;gap:6px;align-items:center">
      <button class="btn-icon" id="notif-bell" onclick="renderInAppNotifications()" style="position:relative">🔔<span id="notif-count" style="display:none;position:absolute;top:-4px;right:-4px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;width:16px;height:16px;line-height:16px;text-align:center"></span></button>
    </div>
  </div>
  <div id="tab-content" class="tab-content"></div>
  <nav class="bottom-nav">
    <button class="nav-btn" onclick="receptionTab('pending')"><span style="position:relative;display:inline-block">⏳<span id="rec-pending-badge" style="display:none;position:absolute;top:-6px;right:-10px;background:#ef4444;color:#fff;border-radius:50%;font-size:9px;min-width:16px;height:16px;line-height:16px;text-align:center;padding:0 2px">0</span></span>Подтвердить</button>
    <button class="nav-btn" onclick="receptionTab('rejected')"><span>✗</span>Отклонённые</button>
    <button class="nav-btn" onclick="receptionTab('groups')"><span>🏊</span>Группы</button>
    <button class="nav-btn" onclick="receptionTab('history')"><span>📋</span>История</button>
  </nav>`);
  receptionTab(initialTab);
  setTimeout(checkInAppNotifications, 2000);
  setTimeout(checkReceptionBadge, 1200);
  setTimeout(maybeQueueReceptionEod, 2500);
}

function receptionTab(tab) {
  setupBack(null); STATE._backFn = null;
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',
    ['pending','rejected','groups','history'][i]===tab));
  if (tab==='pending')  renderReceptionPending();
  if (tab==='rejected') renderReceptionRejected();
  if (tab==='groups')   renderReceptionGroups();
  if (tab==='history')  renderReceptionHistory();
}

async function checkReceptionBadge() {
  try {
    const br=_recBranch(), today=_recToday();
    const [n, older] = await Promise.all([
      DB.getReceptionPendingCount(br, today),
      DB.getReceptionOlderPendingCount(br, today),
    ]);
    const total = n + older;  // бейдж считает сегодня + висящие за прошлые дни
    const b = document.getElementById('rec-pending-badge');
    if (b) { b.style.display = total>0?'inline-block':'none'; b.textContent = total>99?'99+':String(total); }
  } catch(e) { /* тихо */ }
}

async function maybeQueueReceptionEod() {
  try {
    if (new Date().getHours() < RECEPTION_EOD_HOUR) return;
    const date=_recToday(), branch=_recBranch();
    const n=await DB.getReceptionPendingCount(branch, date);
    if (n>0) await DB.queueReceptionEodOnce(branch, date, n, STATE.profile.id);
  } catch(e) { /* тихо */ }
}

// ── ВКЛАДКА 1: НА ПОДТВЕРЖДЕНИЕ ──────────────
async function renderReceptionPending() {
  const body = $('#tab-content');
  body.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  const branch = _recBranch();
  if (!branch) { body.innerHTML = '<div class="tab-pad"><p class="hint">Филиал не задан в профиле ресепшена.</p></div>'; return; }
  const date = STATE._recDate || _recToday();
  try {
    const [{ workouts, trials }, olderN] = await Promise.all([
      DB.getReceptionPending(branch, date),
      DB.getReceptionOlderPendingCount(branch, _recToday()),
    ]);
    const items = [
      ...workouts.map(w=>({...w, _kind:'w', _ts:w.workout_date, _client:w.clients?.fio||'—', _trainer:w.profiles?.fio||'—', _cat:w.category_at_moment})),
      ...trials.map(t=>({...t, _kind:'t', _trial:true, _ts:t.session_date, _client:`${t.first_name}${t.last_name?' '+t.last_name:''}`, _trainer:t.profiles?.fio||'—', _cat:t.category})),
    ].sort((a,b)=>new Date(a._ts)-new Date(b._ts));
    const total = items.length;
    body.innerHTML = `<div class="tab-pad">
      ${olderN>0?`<div class="warn-banner" style="background:rgba(245,158,11,.12);border-color:rgba(245,158,11,.4);color:var(--text);cursor:pointer;margin-bottom:12px" onclick="renderReceptionOlder()">
        ⚠️ <b>Висящие за прошлые дни: ${olderN}</b> — нажмите, чтобы разобрать
      </div>`:''}
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <input type="date" id="rec-date" value="${date}" onchange="recSetDate(this.value)"
          style="flex:1;padding:10px;border-radius:10px;background:var(--card);border:1px solid var(--border);color:var(--text)">
        <button class="btn btn-sm" onclick="recSetDate('${_recToday()}')" style="background:var(--card);border:1px solid var(--border)">Сегодня</button>
      </div>
      <div style="display:flex;justify-content:space-between;align-items:center;margin-bottom:12px">
        <div style="font-weight:700;font-size:15px">${total?`${total} ожидают подтверждения`:'Очередь пуста'}</div>
        ${total?`<button class="btn btn-sm btn-primary" onclick="doReceptionConfirmAll()">✓ Подтвердить всё</button>`:''}
      </div>
      ${!total ? `<div style="text-align:center;padding:40px 16px;color:var(--hint)"><div style="font-size:40px;margin-bottom:8px">✓</div>Всё подтверждено</div>`
        : items.map(recCard).join('')}
    </div>`;
    checkReceptionBadge();
  } catch(e) { body.innerHTML='<div class="tab-pad"><p class="hint">Ошибка загрузки</p></div>'; console.error(e); }
}

// Экран «Висящие за прошлые дни» — pending до сегодня, сгруппированы по дате
async function renderReceptionOlder() {
  const body = $('#tab-content');
  body.innerHTML = `<div class="center-screen"><div class="spinner"></div></div>`;
  const branch = _recBranch();
  try {
    const { workouts, trials } = await DB.getReceptionOlderPending(branch, _recToday());
    const items = [
      ...workouts.map(w=>({...w, _kind:'w', _ts:w.workout_date, _client:w.clients?.fio||'—', _trainer:w.profiles?.fio||'—', _cat:w.category_at_moment})),
      ...trials.map(t=>({...t, _kind:'t', _trial:true, _ts:t.session_date, _client:`${t.first_name}${t.last_name?' '+t.last_name:''}`, _trainer:t.profiles?.fio||'—', _cat:t.category})),
    ].sort((a,b)=>new Date(a._ts)-new Date(b._ts));
    const byDate = {};
    items.forEach(it=>{ const d=fmtDate(it._ts); (byDate[d] ||= []).push(it); });
    body.innerHTML = `<div class="tab-pad">
      <div style="display:flex;align-items:center;gap:8px;margin-bottom:12px">
        <button class="btn btn-sm" onclick="receptionTab('pending')" style="background:var(--card);border:1px solid var(--border)">← Назад</button>
        <div style="font-weight:700;font-size:15px">Висящие за прошлые дни (${items.length})</div>
      </div>
      ${!items.length ? '<p class="hint">Нет висящих за прошлые дни ✓</p>'
        : Object.entries(byDate).map(([d,arr])=>`
          <div style="font-size:12px;color:var(--hint);font-weight:600;margin:10px 0 6px">${d}</div>
          ${arr.map(recCard).join('')}`).join('')}
    </div>`;
    navPush(()=>receptionTab('pending'));
    setupBack(()=>receptionTab('pending'));
    checkReceptionBadge();
  } catch(e) { body.innerHTML='<div class="tab-pad"><p class="hint">Ошибка</p></div>'; console.error(e); }
}

function recCard(it) {
  const cat = it._cat?`<span class="hi-cat cat-${it._cat}">Кат.${it._cat}</span>`:'';
  const typeBadge = `<span style="font-size:11px;background:rgba(124,58,237,.12);color:#a78bfa;padding:2px 8px;border-radius:8px">${_recTypeLabel(it)}</span>`;
  const cnameEnc = encodeURIComponent(it._client);
  return `<div class="history-item" id="rec-card-${it._kind}-${it.id}">
    <div class="hi-main">
      <span class="hi-client">${it._client}</span> ${cat} ${typeBadge}
    </div>
    <div class="hi-sub">👤 ${it._trainer} · ${fmtTime(it._ts)}</div>
    <div style="display:flex;gap:8px;margin-top:8px">
      <button class="btn btn-sm btn-primary" style="flex:1" onclick="doReceptionConfirm('${it._kind}','${it.id}')">✓ Подтвердить</button>
      <button class="btn btn-sm btn-danger" style="flex:1" onclick="renderReceptionRejectModal('${it._kind}','${it.id}','${cnameEnc}',${it.trainer_id||'null'})">✗ Отклонить</button>
    </div>
  </div>`;
}

function recSetDate(d) { STATE._recDate = d; renderReceptionPending(); }

async function doReceptionConfirm(kind, id) {
  const key = `recconf_${kind}_${id}`;
  if (_pending.has(key)) return;
  _pending.add(key);
  try {
    if (kind==='w') await DB.confirmWorkout(id, STATE.profile.id);
    else            await DB.confirmTrial(id, STATE.profile.id);
    document.getElementById(`rec-card-${kind}-${id}`)?.remove();
    toast('✓ Подтверждено','success');
    checkReceptionBadge();
    if (!document.querySelector('[id^="rec-card-"]')) renderReceptionPending();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(key); }
}

async function doReceptionConfirmAll() {
  const key = 'recconfall';
  if (_pending.has(key)) return;
  if (!confirm('Подтвердить ВСЕ списания за выбранный день?')) return;
  _pending.add(key);
  try {
    await DB.confirmAllReception(_recBranch(), STATE._recDate||_recToday(), STATE.profile.id);
    toast('✓ Все подтверждены','success');
    renderReceptionPending();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(key); }
}

function renderReceptionRejectModal(kind, id, cnameEnc, trainerId) {
  const cname = decodeURIComponent(cnameEnc);
  const opts = Object.entries(RECEPTION_REJECT_REASONS).map(([code,label],i)=>`
    <label style="display:flex;align-items:center;gap:10px;padding:12px;border:1px solid var(--border);border-radius:10px;margin-bottom:8px;cursor:pointer">
      <input type="radio" name="rec-reason" value="${code}" ${i===0?'checked':''}>
      <span>${label}</span>
    </label>`).join('');
  const m = el('div','modal-overlay');
  m.innerHTML = `<div class="modal">
    <div class="modal-header"><h3>Отклонить списание</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    <p class="hint" style="margin-bottom:12px">${cname}</p>
    ${opts}
    <button class="btn btn-danger btn-full" onclick="doReceptionReject('${kind}','${id}',${trainerId},'${cnameEnc}')">Отклонить</button>
  </div>`;
  document.body.appendChild(m);
}

async function doReceptionReject(kind, id, trainerId, cnameEnc) {
  const code = document.querySelector('input[name="rec-reason"]:checked')?.value;
  if (!code) return toast('Выберите причину','error');
  const key = `recrej_${kind}_${id}`;
  if (_pending.has(key)) return;
  _pending.add(key);
  try {
    if (kind==='w') await DB.rejectWorkout(id, STATE.profile.id, code);
    else            await DB.rejectTrial(id, STATE.profile.id, code);
    const label = RECEPTION_REJECT_REASONS[code]||code;
    if (trainerId) DB.notifyTrainerRejected(trainerId, decodeURIComponent(cnameEnc||''), STATE._recDate||_recToday(), label).catch(()=>{});
    document.querySelector('.modal-overlay')?.remove();
    document.getElementById(`rec-card-${kind}-${id}`)?.remove();
    toast('✗ Отклонено — баланс возвращён','success');
    checkReceptionBadge();
    if (!document.querySelector('[id^="rec-card-"]')) renderReceptionPending();
  } catch(e) { toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(key); }
}

// ── ВКЛАДКА 2: ОТКЛОНЁННЫЕ ───────────────────
async function renderReceptionRejected() {
  const body=$('#tab-content');
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const branch=_recBranch();
  const now=new Date(), p=x=>String(x).padStart(2,'0');
  const fromDate=`${now.getFullYear()}-${p(now.getMonth()+1)}-01`, toDate=_recToday();
  try {
    const {workouts,trials}=await DB.getReceptionRejected(branch, fromDate, toDate);
    const items=[
      ...workouts.map(w=>({...w,_kind:'w',_ts:w.reception_at,_client:w.clients?.fio||'—',_trainer:w.profiles?.fio||'—'})),
      ...trials.map(t=>({...t,_kind:'t',_trial:true,_ts:t.reception_at,_client:`${t.first_name}${t.last_name?' '+t.last_name:''}`,_trainer:t.profiles?.fio||'—'})),
    ].sort((a,b)=>new Date(b._ts)-new Date(a._ts));
    body.innerHTML=`<div class="tab-pad">
      <h3 style="margin-bottom:4px">Отклонённые</h3>
      <p class="hint" style="margin-bottom:12px">${fmtDate(fromDate)} — ${fmtDate(toDate)}</p>
      ${!items.length?'<p class="hint">Нет отклонённых за период</p>':items.map(it=>{
        const q = it.reception_reason==='questions';
        const label = RECEPTION_REJECT_REASONS[it.reception_reason]||it.reception_reason||'—';
        return `<div class="history-item" ${q?'style="border-left:3px solid #ef4444;padding-left:9px"':''}>
          <div class="hi-main"><span class="hi-client">${it._client}</span>
            <span style="font-size:11px;background:rgba(239,68,68,.12);color:#ef4444;padding:2px 8px;border-radius:8px">${q?'🔴 ':''}${label}</span></div>
          <div class="hi-sub">👤 ${it._trainer} · отклонено ${fmtDT(it._ts)}</div>
        </div>`;
      }).join('')}
    </div>`;
  } catch(e){ body.innerHTML='<div class="tab-pad"><p class="hint">Ошибка</p></div>'; console.error(e); }
}

// ── ВКЛАДКА 3: ГРУППЫ ────────────────────────
async function renderReceptionGroups() {
  const body=$('#tab-content');
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const branch=_recBranch();
  const month=STATE._recGroupMonth || _recMonth(_recToday());
  try {
    const groups=await DB.getReceptionGroups(branch, month);
    body.innerHTML=`<div class="tab-pad">
      <div style="display:flex;gap:8px;align-items:center;margin-bottom:12px">
        <input type="month" id="rec-grp-month" value="${month.slice(0,7)}" onchange="recSetGroupMonth(this.value)"
          style="flex:1;padding:10px;border-radius:10px;background:var(--card);border:1px solid var(--border);color:var(--text)">
      </div>
      ${!groups.length?'<p class="hint">Нет активных детских групп в филиале</p>':groups.map(g=>{
        const paidN=g.children.filter(c=>c.paid).length;
        return `<div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:12px;margin-bottom:12px">
          <div style="font-weight:700;margin-bottom:2px">${g.name}</div>
          <div class="hint" style="margin-bottom:10px">${g.trainer?'👤 '+g.trainer+' · ':''}оплачено ${paidN}/${g.children.length}</div>
          ${!g.children.length?'<p class="hint">Нет детей</p>':g.children.map(c=>`
            <div style="display:flex;justify-content:space-between;align-items:center;padding:8px 0;border-bottom:1px solid var(--border)">
              <div><div style="font-size:14px">${c.name}</div><div class="hint">${fmt(c.amount)} сум</div></div>
              <button class="btn btn-sm" id="recpay-${c.id}"
                onclick="doReceptionTogglePay('${g.groupId}','${c.id}',${g.instanceId?`'${g.instanceId}'`:'null'},${c.amount},${c.paid?'false':'true'},'${encodeURIComponent(month)}')"
                style="${c.paid?'background:rgba(16,185,129,.15);color:#10b981;border:1px solid rgba(16,185,129,.3)':'background:var(--primary);color:#fff'}">${c.paid?'✓ Оплачено':'Отметить'}</button>
            </div>`).join('')}
        </div>`;
      }).join('')}
    </div>`;
  } catch(e){ body.innerHTML='<div class="tab-pad"><p class="hint">Ошибка</p></div>'; console.error(e); }
}
function recSetGroupMonth(ym){ STATE._recGroupMonth=`${ym}-01`; renderReceptionGroups(); }

async function doReceptionTogglePay(groupId, clientId, instanceId, amount, paid, monthEnc) {
  const month=decodeURIComponent(monthEnc);
  const key=`recpay_${clientId}_${month}`;
  if (_pending.has(key)) return;
  _pending.add(key);
  try {
    await DB.setGroupPayment(groupId, clientId, month, amount, paid, null, null, instanceId);
    toast(paid?'✓ Оплата отмечена':'Оплата снята','success');
    renderReceptionGroups();
  } catch(e){ toast('Ошибка','error'); console.error(e); }
  finally { _pending.delete(key); }
}

// ── ВКЛАДКА 4: ИСТОРИЯ (подтверждённые) ──────
async function renderReceptionHistory() {
  const body=$('#tab-content');
  body.innerHTML=`<div class="center-screen"><div class="spinner"></div></div>`;
  const branch=_recBranch();
  const now=new Date(), p=x=>String(x).padStart(2,'0');
  const fromDate=`${now.getFullYear()}-${p(now.getMonth()+1)}-01`, toDate=_recToday();
  try {
    const {workouts,trials}=await DB.getReceptionConfirmed(branch, fromDate, toDate);
    const items=[
      ...workouts.map(w=>({...w,_kind:'w',_ts:w.reception_at,_client:w.clients?.fio||'—',_trainer:w.profiles?.fio||'—',_cat:w.category_at_moment})),
      ...trials.map(t=>({...t,_kind:'t',_trial:true,_ts:t.reception_at,_client:`${t.first_name}${t.last_name?' '+t.last_name:''}`,_trainer:t.profiles?.fio||'—',_cat:t.category})),
    ].sort((a,b)=>new Date(b._ts)-new Date(a._ts));
    body.innerHTML=`<div class="tab-pad">
      <h3 style="margin-bottom:4px">История подтверждений</h3>
      <p class="hint" style="margin-bottom:12px">${fmtDate(fromDate)} — ${fmtDate(toDate)} · ${items.length}</p>
      ${!items.length?'<p class="hint">Пусто</p>':items.map(it=>`
        <div class="history-item">
          <div class="hi-main"><span class="hi-client">${it._client}</span>
            ${it._cat?`<span class="hi-cat cat-${it._cat}">Кат.${it._cat}</span>`:''}
            <span style="font-size:11px;background:rgba(16,185,129,.12);color:#10b981;padding:2px 8px;border-radius:8px">✓ ${_recTypeLabel(it)}</span></div>
          <div class="hi-sub">👤 ${it._trainer} · ${fmtDT(it._ts)}</div>
        </div>`).join('')}
    </div>`;
  } catch(e){ body.innerHTML='<div class="tab-pad"><p class="hint">Ошибка</p></div>'; console.error(e); }
}

// ============================================================
// SECTION: MANAGER — read-only панель управляющего (директор филиала, один филиал)
// ============================================================
// Принцип: НЕ переиспользуем рендеры координатора со «спрятанными» кнопками —
// отдельные read-only функции. Данные тянем теми же DB.* методами ЧТЕНИЯ.
// Ни одного вызова записи (insert/update/delete/upsert) — только select.
// Всё фильтруется по STATE.profile.branches[0].
function _mgrBranch() { return STATE.profile.branches?.[0] || null; }

function renderManagerApp(initialTab='analytics') {
  setupBack(null);
  setScreen(`<div class="app-header">
    <div><div class="app-title">📊 Управляющий</div>
      <div class="app-sub">${STATE.profile.fio}${_mgrBranch()?' · '+_mgrBranch():''}</div></div>
    <div style="display:flex;gap:6px;align-items:center">
      <span style="font-size:11px;padding:3px 9px;border-radius:10px;background:rgba(124,58,237,.15);color:#a78bfa;font-weight:600">👁 Просмотр</span>
      <button class="btn-icon" onclick="openSelfInBrowser()" title="Открыть в браузере (больше экран)">🖥</button>
    </div>
  </div>
  <div id="tab-content" class="tab-content"></div>
  <nav class="bottom-nav">
    <button class="nav-btn" onclick="managerTab('analytics')"><span>📈</span>Аналитика</button>
    <button class="nav-btn" onclick="managerTab('staff')"><span>🧑‍💼</span>Персонал</button>
    <button class="nav-btn" onclick="managerTab('groups')"><span>🏊</span>Группы</button>
    <button class="nav-btn" onclick="managerTab('tech')"><span>⚙️</span>Техчасть</button>
    <button class="nav-btn" onclick="managerTab('salary')"><span>💰</span>ЗП</button>
  </nav>`);
  managerTab(initialTab);
}

function managerTab(tab) {
  setupBack(null); STATE._backFn = null;
  $$('.nav-btn').forEach((b,i)=>b.classList.toggle('active',
    ['analytics','staff','groups','tech','salary'][i]===tab));
  if (tab==='analytics') renderManagerAnalytics();
  if (tab==='staff')     renderManagerStaff();
  if (tab==='groups')    renderManagerGroups();
  if (tab==='tech')      renderManagerTech();
  if (tab==='salary')    renderManagerSalary();
}

// ── АНАЛИТИКА ─────────────────────────────────
// Отдельная read-only копия оболочки аналитики: филиал ЖЁСТКО залочен на
// branches[0] (без селектора «Все филиалы» → нет утечки чужих филиалов).
// Переиспользуем готовые загрузчики карточек (_fill*Card) и хабы — они уже
// read-only и принимают branch параметром. Shared-код координатора не трогаем.
function renderManagerAnalytics(year, month) {
  const now = new Date();
  if (year==null)  year  = now.getFullYear();
  if (month==null) month = now.getMonth()+1;
  const branch = _mgrBranch();
  setupBack(null); STATE._backFn = null;
  window._anCtx = { year, month, branch };
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="section-header"><h3>Аналитика</h3>
      <div class="month-nav">
        <button id="prev-man">‹</button>
        <span id="man-month">${fmtMY(year,month)}</span>
        <button id="next-man">›</button>
      </div>
    </div>
    <p class="hint" style="margin-bottom:14px">📍 ${branch||'—'}</p>
    <div class="aov-grid">
      <div class="aov-card" id="aov-money"   onclick="openManagerAnHub('money')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-clients" onclick="openManagerAnHub('clients')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-load"    onclick="openManagerAnHub('load')">${_anSkel(4)}</div>
      <div class="aov-card" id="aov-control" onclick="openManagerAnHub('control')">${_anSkel(4)}</div>
    </div>
  </div>`;
  const goMonth = (dm)=>renderManagerAnalytics(dm>12?year+1:(dm<1?year-1:year), dm>12?1:(dm<1?12:dm));
  document.getElementById('prev-man')?.addEventListener('click',()=>goMonth(month-1));
  document.getElementById('next-man')?.addEventListener('click',()=>goMonth(month+1));
  _fillMoneyCard(year,month,branch);
  _fillClientsCard(year,month,branch);
  _fillLoadCard(year,month,branch);
  _fillControlCard(year,month,branch);
}

// Открыть хаб аналитики и ПЕРЕОПРЕДЕЛИТЬ возврат на manager-оболочку
// (хаб внутри ставит navPush/setupBack на renderAdminAnalytics — синхронно,
// до await; наш override после вызова перебивает STATE._backFn и BackButton).
function openManagerAnHub(which) {
  const { year, month, branch } = window._anCtx || {};
  if (which==='money')   renderAnalyticsMoneyHub(year,month,branch);
  if (which==='clients') renderAnalyticsClientsHub(year,month,branch);
  if (which==='load')    renderAnalyticsLoadHub(year,month,branch);
  if (which==='control') renderAnalyticsControlHub(year,month,branch);
  const back = ()=>renderManagerAnalytics(year,month);
  navPush(back); setupBack(back);
}

// ── ПЕРСОНАЛ (read-only) ──────────────────────
async function renderManagerStaff(year, month) {
  const now = new Date();
  if (year==null)  year  = now.getFullYear();
  if (month==null) month = now.getMonth()+1;
  const branch = _mgrBranch();
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="section-header"><h3>Персонал</h3>
      <div class="month-nav"><button id="prev-mst">‹</button><span id="mst-m">${fmtMY(year,month)}</span><button id="next-mst">›</button></div>
    </div>
    <p class="hint" style="margin-bottom:12px">📍 ${branch||'—'} · показатели за месяц</p>
    <div id="mst-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  document.getElementById('prev-mst')?.addEventListener('click',()=>{let y=year,m=month-1;if(m<1){y--;m=12;}renderManagerStaff(y,m);});
  document.getElementById('next-mst')?.addEventListener('click',()=>{let y=year,m=month+1;if(m>12){y++;m=1;}renderManagerStaff(y,m);});
  const body = document.getElementById('mst-body');
  try {
    const [profiles, payroll] = await Promise.all([
      cached('profiles',()=>DB.getAllProfiles()),
      calcMonthPayroll(branch, year, month),
    ]);
    const raw = payroll.raw || {};
    const payMap = {}; (payroll.rows||[]).forEach(r=>{ payMap[r.id]=r; });
    const wc = {}, dh = {};
    (raw.workouts||[]).forEach(w=>{ wc[w.trainer_id]=(wc[w.trainer_id]||0)+1; });
    (raw.duties||[]).forEach(d=>{ if(d.start_time&&d.end_time){ dh[d.trainer_id]=(dh[d.trainer_id]||0)+(new Date(d.end_time)-new Date(d.start_time))/3600000; } });
    window._mgrStaff = { year, month, wc, dh, payMap };
    const inBr = p=>(p.branches||[]).includes(branch);
    const staff = (profiles||[]).filter(p=>inBr(p) && ['trainer','senior_trainer'].includes(p.role));
    const active = staff.filter(p=>!p.is_archived);
    const archived = staff.filter(p=>p.is_archived);
    const card = p=>{
      const m = payMap[p.id]||{}; const cnt = wc[p.id]||0; const hrs = dh[p.id]||0;
      return `<div class="staff-card clickable" onclick="renderManagerTrainerCard(${p.id},'${encodeURIComponent(p.fio)}',${year},${month})">
        <div class="staff-info">
          <div class="staff-fio">${p.fio}</div>
          <div class="staff-meta">${ROLE_LBL[p.role]||p.role}${p.phone?' · '+p.phone:''}</div>
          <div class="staff-meta">ПТ: ${cnt} · Дежур: ${hrs.toFixed(1)}ч · ФОТ: ${fmt(m.total||0)} сум</div>
        </div>
        <span style="color:var(--hint)">›</span>
      </div>`;
    };
    body.innerHTML = `
      ${active.length?active.map(card).join(''):'<p class="hint">Нет тренеров в филиале</p>'}
      ${archived.length?`<details style="margin-top:14px"><summary style="cursor:pointer;color:var(--hint);font-size:13px">📦 Архив (${archived.length})</summary>
        <div style="margin-top:10px;opacity:.65">${archived.map(card).join('')}</div></details>`:''}`;
  } catch(e){ console.error(e); body.innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

function renderManagerTrainerCard(id, fioEnc, year, month) {
  const fio = decodeURIComponent(fioEnc);
  const M = window._mgrStaff || {};
  const m = (M.payMap||{})[id] || { pt:0, duty:0, group:0, total:0 };
  const cnt = (M.wc||{})[id]||0, hrs = (M.dh||{})[id]||0;
  const back = ()=>renderManagerStaff(year,month);
  navPush(back); setupBack(back);
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="ah-head">${backBtn()}<h3>${fio}</h3></div>
    <p class="hint">${fmtMY(year,month)} · ${_mgrBranch()||'—'}</p>
    <div class="summary-cards" style="margin:12px 0">
      <div class="summary-card"><div class="s-val">${cnt}</div><div class="s-lbl">ПТ за месяц</div></div>
      <div class="summary-card"><div class="s-val">${hrs.toFixed(1)}</div><div class="s-lbl">часов дежурств</div></div>
      <div class="summary-card accent"><div class="s-val" style="font-size:15px">${fmt(m.total||0)}</div><div class="s-lbl">ФОТ (сум)</div></div>
    </div>
    <div style="background:var(--card);border:1px solid var(--border);border-radius:12px;padding:14px">
      <div style="font-weight:700;font-size:14px;margin-bottom:10px">Детализация ЗП</div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Персональные тренировки</span><b>${fmt(m.pt||0)} сум</b></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Дежурства</span><b>${fmt(m.duty||0)} сум</b></div>
      <div style="display:flex;justify-content:space-between;padding:5px 0;border-bottom:1px solid var(--border);font-size:13px"><span>Группы</span><b>${fmt(m.group||0)} сум</b></div>
      <div style="display:flex;justify-content:space-between;padding:8px 0 0;font-size:14px"><span><b>Итого</b></span><b>${fmt(m.total||0)} сум</b></div>
    </div>
    <p class="hint" style="text-align:center;margin-top:14px">👁 Только просмотр</p>
  </div>`;
}

// ── ГРУППЫ (read-only) ────────────────────────
async function renderManagerGroups(year, month) {
  const now = new Date();
  if (year==null)  year  = now.getFullYear();
  if (month==null) month = now.getMonth()+1;
  const branch = _mgrBranch();
  const monthStr = `${year}-${String(month).padStart(2,'0')}-01`;
  window._mgrGroupMonth = { year, month };
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="section-header"><h3>Группы</h3>
      <div class="month-nav"><button id="prev-mg">‹</button><span id="mg-m">${fmtMY(year,month)}</span><button id="next-mg">›</button></div>
    </div>
    <p class="hint" style="margin-bottom:12px">📍 ${branch||'—'} · активные группы</p>
    <div id="mg-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  document.getElementById('prev-mg')?.addEventListener('click',()=>{let y=year,m=month-1;if(m<1){y--;m=12;}renderManagerGroups(y,m);});
  document.getElementById('next-mg')?.addEventListener('click',()=>{let y=year,m=month+1;if(m>12){y++;m=1;}renderManagerGroups(y,m);});
  const body = document.getElementById('mg-body');
  try {
    // Чтение с расписанием (getActiveGroupsByBranch не отдаёт days/time) — только select.
    const { data: rows } = await sb().from('trainer_groups')
      .select('id, group_type_id, group_instance_id, role, days_of_week, session_time, profiles(fio), group_types(name,type)')
      .eq('branch', branch).is('subscription_end', null).order('group_type_id');
    const byInst = {};
    (rows||[]).forEach(r=>{ const key = r.group_instance_id || ('g'+r.id); (byInst[key]=byInst[key]||[]).push(r); });
    const groups = Object.values(byInst);
    body.innerHTML = !groups.length ? '<p class="hint">Нет активных групп</p>' :
      groups.map(g=>{
        const head = g[0];
        const trainers = [...new Set(g.map(x=>x.profiles?.fio).filter(Boolean))].join(', ')||'—';
        const typeName = head.group_types?.name||'Группа';
        const kind = head.group_types?.type==='children'?'🧒 Дети':'🏊 Взрослые';
        const sched = `${(head.days_of_week||[]).join('/')}${head.session_time?' '+String(head.session_time).slice(0,5):''}`.trim();
        return `<div class="staff-card clickable" onclick="renderManagerGroupCard(${head.id},'${monthStr}')">
          <div class="staff-info">
            <div class="staff-fio">${typeName}</div>
            <div class="staff-meta">${kind} · ${trainers}</div>
            ${sched?`<div class="staff-meta">🗓 ${sched}</div>`:''}
          </div>
          <span style="color:var(--hint)">›</span>
        </div>`;
      }).join('');
  } catch(e){ console.error(e); body.innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

async function renderManagerGroupCard(groupId, monthStr) {
  const back = ()=>renderManagerGroups((window._mgrGroupMonth||{}).year,(window._mgrGroupMonth||{}).month);
  navPush(back); setupBack(back);
  $('#tab-content').innerHTML = `<div class="tab-pad"><div class="ah-head">${backBtn()}<h3>Группа</h3></div>
    <div id="mgc-body"><div class="center-screen"><div class="spinner"></div></div></div></div>`;
  try {
    const rep = await DB.getGroupMonthReport(groupId, monthStr);
    const clients = rep.clients||[], payments = rep.payments||[];
    const payByClient = {}; payments.forEach(p=>{ payByClient[p.group_client_id]=p; });
    const paidCnt = clients.filter(c=>payByClient[c.id]?.paid).length;
    const debtors = clients.filter(c=>!payByClient[c.id]?.paid);
    const typeName = rep.groupTypeInfo?.name||'Группа';
    const trainers = (rep.trainers||[]).map(t=>t.profiles?.fio).filter(Boolean).join(', ')||'—';
    const sessCnt = [...new Set((rep.instanceSessions||[]).map(s=>s.session_date))].length;
    document.getElementById('mgc-body').innerHTML = `
      <h3 style="margin:0 0 2px">${typeName}</h3>
      <p class="hint" style="margin-bottom:12px">${trainers} · ${monthStr.slice(0,7)}</p>
      <div class="summary-cards" style="margin-bottom:14px">
        <div class="summary-card"><div class="s-val">${clients.length}</div><div class="s-lbl">клиентов</div></div>
        <div class="summary-card"><div class="s-val" style="color:var(--success)">${paidCnt}</div><div class="s-lbl">оплатили</div></div>
        <div class="summary-card"><div class="s-val" style="color:var(--danger)">${debtors.length}</div><div class="s-lbl">должники</div></div>
      </div>
      <div style="font-weight:700;font-size:13px;margin:6px 0">Состав (${clients.length})</div>
      ${clients.length?clients.map(c=>{
        const pd = payByClient[c.id];
        return `<div class="staff-card"><div class="staff-info">
          <div class="staff-fio">${c.name}${c.age?` · ${c.age} лет`:''}</div>
          <div class="staff-meta">${c.level?c.level+' · ':''}${pd?.paid?'<span style="color:var(--success)">оплачено</span>':'<span style="color:var(--danger)">не оплачено</span>'}${pd?.amount?' · '+fmt(pd.amount)+' сум':''}</div>
        </div></div>`;
      }).join(''):'<p class="hint">Нет клиентов</p>'}
      ${debtors.length?`<div class="warn-banner" style="margin-top:12px"><b>Должники (${debtors.length}):</b> ${debtors.map(c=>c.name).join(', ')}</div>`:''}
      <p class="hint" style="text-align:center;margin-top:14px">👁 Только просмотр · ${sessCnt} занятий за месяц</p>`;
  } catch(e){ console.error(e); document.getElementById('mgc-body').innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

// ── ТЕХЧАСТЬ (read-only) ──────────────────────
// renderManagerTech вынесен в app.admin-ops.tech.js (общие рендеры с координатором/CEO).

// ── ЗП (read-only, поимённо) ──────────────────
async function renderManagerSalary(year, month) {
  const now = new Date();
  if (year==null)  year  = now.getFullYear();
  if (month==null) month = now.getMonth()+1;
  const branch = _mgrBranch();
  $('#tab-content').innerHTML = `<div class="tab-pad">
    <div class="section-header"><h3>ЗП по филиалу</h3>
      <div class="month-nav"><button id="prev-msl">‹</button><span id="msl-m">${fmtMY(year,month)}</span><button id="next-msl">›</button></div>
    </div>
    <p class="hint" style="margin-bottom:12px">📍 ${branch||'—'} · поимённо</p>
    <div id="msl-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  document.getElementById('prev-msl')?.addEventListener('click',()=>{let y=year,m=month-1;if(m<1){y--;m=12;}renderManagerSalary(y,m);});
  document.getElementById('next-msl')?.addEventListener('click',()=>{let y=year,m=month+1;if(m>12){y++;m=1;}renderManagerSalary(y,m);});
  const body = document.getElementById('msl-body');
  try {
    const [data, money] = await Promise.all([
      DB.getSummary(year, month, branch||null),
      _anMoney(year, month, branch).catch(()=>null),
    ]);
    body.innerHTML = `
      <div class="summary-cards" style="margin-bottom:16px">
        <div class="summary-card accent"><div class="s-val" style="font-size:15px">${fmt(money?money.fot:0)}</div><div class="s-lbl">ФОТ (сум)</div></div>
        <div class="summary-card"><div class="s-val">${money?money.accrualRatio+'%':'—'}</div><div class="s-lbl">ФОТ/выручка</div></div>
      </div>
      ${renderSummaryTable(data, year, month, false)}
      <button class="btn btn-sm" style="margin-top:12px;width:100%"
        onclick="doExportSummary(${year},${month},'${branch||''}')">⬇️ Скачать Excel (сводный)</button>`;
  } catch(e){ console.error(e); body.innerHTML='<p class="hint">⚠️ Ошибка загрузки</p>'; }
}

