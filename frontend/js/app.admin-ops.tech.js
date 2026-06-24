// ─── ТЕХЧАСТЬ ────────────────────────────────────────────────────────────────
// Три раздела: Счета (оплата + сводка), Техничка (поломки с датой), Хлор (закупы).
// Один и тот же набор рендеров используют 3 роли:
//   • Координатор (admin) — все филиалы, редактирование
//   • CEO            — все филиалы, только просмотр
//   • Управляющий    — свой филиал, только просмотр
// Редактируемость управляется флагом `editable`.

const TECH_SECTIONS = ['bills','issues','chlorine'];
const TECH_LABELS   = {bills:'Счета', issues:'Техничка', chlorine:'Хлор'};
const TECH_ICONS    = {bills:'💳', issues:'🔧', chlorine:'🧪'};
const PRIORITY_LBL  = {urgent:'🔴 Срочно', normal:'🟡 Обычная', low:'⚪ Низкая'};
const BILL_CATS     = ['Химия','Электричество','Вода','Ремонт','Инвентарь','Прочее'];

let _techSection = 'bills';
let _techBranch  = '';

// сколько дней «висит» запись (по created_at)
function techDaysAgo(iso) {
  if (!iso) return null;
  return Math.floor((Date.now() - new Date(iso).getTime()) / 86400000);
}
function techAgeBadge(iso) {
  const d = techDaysAgo(iso);
  if (d == null) return '';
  const cls = d >= 14 ? 'stale' : d >= 5 ? 'old' : '';
  const lbl = d <= 0 ? 'сегодня' : `висит ${d} дн.`;
  return `<span class="tc-age ${cls}">⏳ ${lbl} · с ${fmtDate(iso)}</span>`;
}

// поле выбора филиала для модалок добавления.
// Если филиал уже выбран сверху — фиксируем его; если «Все филиалы» — даём выбрать.
async function techBranchField(id, selected) {
  const branches = (await cached('branches',()=>DB.getBranches())).map(b=>b.name);
  const ownerOpt = isDev()
    ? `<option value="__general__" ${selected==='__general__'?'selected':''}>🔒 Общие (только я)</option>` : '';
  return `<div class="form-group"><label>Филиал</label>
    <select id="${id}">
      ${selected?'':'<option value="">— выберите филиал —</option>'}
      ${branches.map(b=>`<option value="${b}" ${b===selected?'selected':''}>${b}</option>`).join('')}
      ${ownerOpt}
    </select></div>`;
}

// панель выбора раздела (общая)
function techTabBar(switchFn) {
  return `<div class="tech-tabs">
    ${TECH_SECTIONS.map(s=>`<button class="tech-tab ${s===_techSection?'active':''}"
      onclick="${switchFn}('${s}')">
      <span class="ic">${TECH_ICONS[s]}</span>${TECH_LABELS[s]}</button>`).join('')}
  </div>`;
}

// диспетчер: рисует выбранный раздел в #tech-body
async function techLoadSection(branch, editable) {
  const body = document.getElementById('tech-body'); if (!body) return;
  try {
    if (_techSection==='bills')    await techRenderBills(body, branch, editable);
    if (_techSection==='issues')   await techRenderIssues(body, branch, editable);
    if (_techSection==='chlorine') await techRenderChlorine(body, branch, editable);
  } catch(e) { body.innerHTML='<p class="tech-empty">⚠️ Ошибка загрузки</p>'; console.error(e); }
}

// ============================================================
// SECTION: ADMIN:TECH — оболочки по ролям (admin / ceo / manager)
// ============================================================

// ── Координатор: все филиалы, редактирование ──
async function renderAdminTech() {
  const branches = (await cached('branches',()=>DB.getBranches())).map(b=>b.name);
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>⚙️ Техчасть</h3></div>
    <div class="form-group">
      <select id="tech-branch" onchange="_techBranch=this.value;techLoadSection(_techBranch,true)">
        <option value="" ${_techBranch===''?'selected':''}>🏢 Все филиалы</option>
        ${branches.map(b=>`<option value="${b}" ${b===_techBranch?'selected':''}>📍 ${b}</option>`).join('')}
        ${isDev()?`<option value="__general__" ${_techBranch==='__general__'?'selected':''}>🔒 Общие (только я)</option>`:''}
      </select></div>
    ${techTabBar('techSwitchAdmin')}
    <div id="tech-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  await techLoadSection(_techBranch, true);
}
function techSwitchAdmin(s){ _techSection=s; renderAdminTech(); }

// ── CEO: все филиалы, только просмотр ──
async function renderCeoTech() {
  const branches = (await cached('branches',()=>DB.getBranches())).map(b=>b.name);
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>⚙️ Техчасть</h3><span class="hint">👁 Просмотр</span></div>
    <div class="form-group">
      <select id="tech-branch" onchange="_techBranch=this.value;techLoadSection(_techBranch,false)">
        <option value="" ${_techBranch===''?'selected':''}>🏢 Все филиалы</option>
        ${branches.map(b=>`<option value="${b}" ${b===_techBranch?'selected':''}>📍 ${b}</option>`).join('')}
      </select></div>
    ${techTabBar('techSwitchCeo')}
    <div id="tech-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  await techLoadSection(_techBranch, false);
}
function techSwitchCeo(s){ _techSection=s; renderCeoTech(); }

// ── Управляющий: свой филиал, только просмотр ──
async function renderManagerTech() {
  const branch = (typeof _mgrBranch==='function') ? _mgrBranch() : (STATE.profile.branches?.[0]||'');
  $('#tab-content').innerHTML=`<div class="tab-pad">
    <div class="section-header"><h3>⚙️ Техчасть</h3><span class="hint">${branch||'—'} · 👁 Просмотр</span></div>
    ${techTabBar('techSwitchMgr')}
    <div id="tech-body"><div class="center-screen"><div class="spinner"></div></div></div>
  </div>`;
  await techLoadSection(branch, false);
}
function techSwitchMgr(s){ _techSection=s; renderManagerTech(); }

// ============================================================
// SECTION: ADMIN:TECH — Счета
// ============================================================
async function techRenderBills(body, branch, editable) {
  const general = branch === '__general__';
  const bills  = await DB.getTechBills(general?'':branch, {general});
  const unpaid = bills.filter(b=>!b.paid);
  const unpaidSum = unpaid.reduce((s,b)=>s+Number(b.amount),0);
  const paidSum   = bills.filter(b=>b.paid).reduce((s,b)=>s+Number(b.amount),0);
  body.innerHTML=`
    <div class="summary-cards" style="grid-template-columns:repeat(2,1fr)">
      <div class="summary-card ${unpaidSum>0?'':''}" style="${unpaidSum>0?'border-color:rgba(239,68,68,.3);background:rgba(239,68,68,.08)':''}">
        <div class="s-val" style="font-size:16px;color:${unpaidSum>0?'var(--danger)':'var(--text)'}">${fmt(Math.round(unpaidSum))}</div>
        <div class="s-lbl">к оплате · ${unpaid.length} шт.</div></div>
      <div class="summary-card">
        <div class="s-val" style="font-size:16px;color:var(--success)">${fmt(Math.round(paidSum))}</div>
        <div class="s-lbl">оплачено</div></div>
    </div>
    ${editable?`<button class="btn btn-primary btn-full" style="margin-bottom:14px"
      onclick="renderAddBillModal('${branch}')">+ Добавить счёт</button>`:''}
    ${!bills.length?'<div class="tech-empty"><span class="ic">💳</span>Счетов нет</div>':
      bills.map(b=>`<div class="tech-card ${b.paid?'paid':'unpaid'}">
        <div class="tc-row">
          <div>
            <div class="tc-title">${b.category}${b.description?` — ${b.description}`:''}</div>
            <div class="tc-meta">${!branch?b.branch+' · ':''}${fmtDate(b.bill_date)}</div>
          </div>
          <div class="tc-amount ${b.paid?'paid':'unpaid'}">${fmt(Number(b.amount))}</div>
        </div>
        ${editable?`<div class="tc-actions">
          <button class="btn btn-sm ${b.paid?'btn-warn':'btn-primary'} grow"
            onclick="toggleBillPaid('${b.id}',${b.paid})">
            ${b.paid?'↩ Вернуть в долг':'✓ Оплачено'}</button>
          <button class="btn btn-sm btn-danger" onclick="deleteTechBill('${b.id}')">🗑</button>
        </div>`:`<div class="tc-actions">
          <span class="${b.paid?'paid-badge':'debt-badge'}">${b.paid?'Оплачено':'Не оплачено'}</span>
        </div>`}
      </div>`).join('')}`;
}
async function renderAddBillModal(branch) {
  const branchField = await techBranchField('bill-branch', branch);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>💳 Добавить счёт</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${branchField}
    <div class="form-group"><label>Категория</label>
      <select id="bill-cat">${BILL_CATS.map(c=>`<option>${c}</option>`).join('')}</select></div>
    <div class="form-group"><label>Описание</label>
      <input id="bill-desc" type="text" placeholder="Необязательно"></div>
    <div class="form-group"><label>Сумма (сум)</label>
      <input id="bill-amount" type="number" placeholder="0"></div>
    <div class="form-group"><label>Дата</label>
      <input id="bill-date" type="date" value="${todayStr()}"></div>
    <button class="btn btn-primary btn-full" onclick="doAddBill()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddBill() {
  const sel    = document.getElementById('bill-branch')?.value || '';
  const isGen  = sel === '__general__';
  const branch = isGen ? '' : sel;
  const amount = parseFloat(document.getElementById('bill-amount')?.value)||0;
  if (!isGen && !branch) return toast('Выберите филиал','error');
  if (!amount) return toast('Введите сумму','error');
  await DB.addTechBill({
    branch, is_general:isGen,
    category:    document.getElementById('bill-cat')?.value,
    description: document.getElementById('bill-desc')?.value.trim()||null,
    amount,
    bill_date:   document.getElementById('bill-date')?.value||todayStr(),
  });
  document.querySelector('.modal-overlay')?.remove();
  toast('Добавлено','success'); techLoadSection(isGen?'__general__':branch, true);
}
async function toggleBillPaid(id, currentPaid) {
  await DB.updateTechBill(id,{ paid:!currentPaid, paid_at:!currentPaid?new Date().toISOString():null });
  toast('Обновлено','success'); techLoadSection(_techBranch, true);
}
async function deleteTechBill(id) {
  if (!confirm('Удалить счёт?')) return;
  try { await sb().from('tech_bills').delete().eq('id',id); toast('Удалено','success'); techLoadSection(_techBranch, true); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}

// ============================================================
// SECTION: ADMIN:TECH — Техничка (поломки)
// ============================================================
async function techRenderIssues(body, branch, editable) {
  const issues = await DB.getTechIssues(branch);   // только незакрытые, сорт. по приоритету
  body.innerHTML=`
    ${editable?`<button class="btn btn-primary btn-full" style="margin-bottom:14px"
      onclick="renderAddIssueModal('${branch}')">+ Сообщить о поломке</button>`:''}
    ${!issues.length?'<div class="tech-empty"><span class="ic">✅</span>Всё исправно</div>':
      issues.map(iss=>`<div class="tech-card">
        <div class="tc-row">
          <div>
            <div class="tc-title">${iss.description}</div>
            <div class="tc-meta">${!branch?iss.branch+' · ':''}${techAgeBadge(iss.created_at)}</div>
          </div>
          <span class="tc-prio ${iss.priority}">${PRIORITY_LBL[iss.priority]||iss.priority}</span>
        </div>
        ${editable?`<div class="tc-actions">
          <button class="btn btn-sm btn-primary grow" onclick="resolveIssue('${iss.id}')">✓ Починено</button>
        </div>`:''}
      </div>`).join('')}`;
}
async function renderAddIssueModal(branch) {
  const branchField = await techBranchField('iss-branch', branch);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🔧 Поломка</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${branchField}
    <div class="form-group"><label>Что сломалось</label>
      <input id="iss-desc" type="text" placeholder="Напр.: насос мамской ванны"></div>
    <div class="form-group"><label>Приоритет</label>
      <select id="iss-pri">
        ${Object.entries(PRIORITY_LBL).map(([v,l])=>`<option value="${v}" ${v==='normal'?'selected':''}>${l}</option>`).join('')}
      </select></div>
    <button class="btn btn-primary btn-full" onclick="doAddIssue()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddIssue() {
  const branch = document.getElementById('iss-branch')?.value || '';
  const desc = document.getElementById('iss-desc')?.value.trim();
  if (!branch) return toast('Выберите филиал','error');
  if (!desc) return toast('Опишите поломку','error');
  await DB.addTechIssue({
    branch, description:desc,
    priority: document.getElementById('iss-pri')?.value||'normal',
    status:'open',
  });
  document.querySelector('.modal-overlay')?.remove();
  toast('Добавлено','success'); techLoadSection(branch, true);
}
async function resolveIssue(id) {
  await DB.updateTechIssue(id,{ status:'resolved', resolved_at:new Date().toISOString() });
  toast('Готово','success'); techLoadSection(_techBranch, true);
}

// ============================================================
// SECTION: ADMIN:TECH — Хлор
// ============================================================
async function techRenderChlorine(body, branch, editable) {
  let q = sb().from('chlorine_orders').select('*').order('order_date',{ascending:false});
  if (branch) q = q.eq('branch',branch);
  const {data:orders} = await q;
  const list     = orders||[];
  const totalKg  = list.reduce((s,o)=>s+Number(o.quantity_kg),0);
  const totalSum = list.reduce((s,o)=>s+Number(o.price_total),0);
  body.innerHTML=`
    <div class="summary-cards" style="grid-template-columns:repeat(2,1fr)">
      <div class="summary-card"><div class="s-val">${totalKg.toFixed(1)}</div><div class="s-lbl">кг всего</div></div>
      <div class="summary-card"><div class="s-val" style="font-size:16px">${fmt(Math.round(totalSum))}</div><div class="s-lbl">потрачено</div></div>
    </div>
    ${editable?`<button class="btn btn-primary btn-full" style="margin-bottom:14px"
      onclick="renderAddChlorineModal('${branch}')">+ Добавить закуп</button>`:''}
    ${!list.length?'<div class="tech-empty"><span class="ic">🧪</span>Закупов нет</div>':
      list.map(o=>`<div class="tech-card">
        <div class="tc-row">
          <div>
            <div class="tc-title">${o.quantity_kg} кг</div>
            <div class="tc-meta">${fmtDate(o.order_date)}${!branch?' · '+o.branch:''}${o.supplier?' · '+o.supplier:''}${o.note?' · '+o.note:''}</div>
          </div>
          <div class="tc-amount">${fmt(Number(o.price_total))}</div>
        </div>
        ${editable?`<div class="tc-actions">
          <button class="btn btn-sm btn-danger" onclick="deleteChlorineOrder(${o.id})">🗑 Удалить</button>
        </div>`:''}
      </div>`).join('')}`;
}
async function renderAddChlorineModal(branch) {
  const branchField = await techBranchField('chl-branch', branch);
  const m=el('div','modal-overlay');
  m.innerHTML=`<div class="modal">
    <div class="modal-header"><h3>🧪 Закуп хлора</h3>
      <button class="btn-close" onclick="this.closest('.modal-overlay').remove()">✕</button></div>
    ${branchField}
    <div class="form-group"><label>Дата</label>
      <input type="date" id="chl-date" value="${todayStr()}"></div>
    <div class="form-group"><label>Количество (кг)</label>
      <input type="number" id="chl-qty" min="0.1" step="0.1" placeholder="50"></div>
    <div class="form-group"><label>Сумма (сум)</label>
      <input type="number" id="chl-sum" placeholder="500000"></div>
    <div class="form-group"><label>Поставщик</label>
      <input id="chl-sup" placeholder="Необязательно"></div>
    <div class="form-group"><label>Примечание</label>
      <input id="chl-note" placeholder="Необязательно"></div>
    <button class="btn btn-primary btn-full" onclick="doAddChlorine()">Добавить</button>
  </div>`;
  document.body.appendChild(m);
}
async function doAddChlorine() {
  const branch = document.getElementById('chl-branch')?.value || '';
  const date = document.getElementById('chl-date')?.value;
  const qty  = parseFloat(document.getElementById('chl-qty')?.value||0);
  const sum  = parseFloat(document.getElementById('chl-sum')?.value||0);
  const sup  = document.getElementById('chl-sup')?.value.trim()||null;
  const note = document.getElementById('chl-note')?.value.trim()||null;
  if (!branch) return toast('Выберите филиал','error');
  if (!qty||!sum) return toast('Укажите количество и сумму','error');
  try {
    await sb().from('chlorine_orders').insert({branch,order_date:date,quantity_kg:qty,price_total:sum,supplier:sup,note});
    document.querySelector('.modal-overlay')?.remove();
    toast('✅ Добавлено','success'); techLoadSection(branch, true);
  } catch(e) { toast('Ошибка','error'); console.error(e); }
}
async function deleteChlorineOrder(id) {
  if (!confirm('Удалить запись?')) return;
  try { await sb().from('chlorine_orders').delete().eq('id',id); toast('Удалено','success'); techLoadSection(_techBranch, true); }
  catch(e) { console.error(e); toast('Ошибка','error'); }
}
