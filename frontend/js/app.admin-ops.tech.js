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

