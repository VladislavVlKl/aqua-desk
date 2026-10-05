// =============================================
// Excel Export — xlsx-js-style
// =============================================

// Кол-во ПТ в перерасчётной строке (сверка с 1С) из самой дельты: |delta| / ставка кат.
// Всегда сходится с деньгами. r = {delta, category}.
function _recalcUnits(r) {
  const rate = (typeof RATES!=='undefined' && RATES.pt && RATES.pt[r.category]) || 0;
  if (!rate) return '';
  const n = Math.abs(Number(r.delta||0)) / rate;
  return Number.isInteger(n) ? ` — ${n} ПТ${r.category?` кат.${r.category}`:''}` : '';
}

// ── Палитра ──────────────────────────────────
const XL = {
  BLUE_DARK:  '1E3A5F',
  BLUE_MID:   '2D6A9F',
  BLUE_LIGHT: 'DCE9F5',
  GOLD:       'F59E0B',
  WHITE:      'FFFFFF',
  GRAY:       'F3F4F6',
  TEXT_DARK:  '1F2937',
  TEXT_WHITE: 'FFFFFF',
  GREEN_DARK: '065F46',
  GREEN_LIGHT:'D1FAE5',
};

// ── Ячейки ───────────────────────────────────
function tc(v, s={}) { return { v: String(v??''), t:'s', s }; }
function nc(v, s={}) { return { v: Number(v)||0,  t:'n', s }; }
function mc(v, s={}) { return { v: Number(v)||0,  t:'n', z:'#,##0', s }; } // деньги, группировка по 3 разряда (в ru-локали = пробел: 2 500 000)

// ── Стили ────────────────────────────────────
function thinBorder() {
  const b = { style:'thin', color:{rgb:'CBD5E1'} };
  return { top:b, bottom:b, left:b, right:b };
}
function hStyle(bg=XL.BLUE_DARK) {
  return { fill:{fgColor:{rgb:bg}}, font:{color:{rgb:XL.TEXT_WHITE},bold:true,sz:10,name:'Arial'},
           alignment:{horizontal:'center',vertical:'center',wrapText:true}, border:thinBorder() };
}
function rStyle(even=false) {
  return { fill:{fgColor:{rgb:even?XL.BLUE_LIGHT:XL.WHITE}},
           font:{color:{rgb:XL.TEXT_DARK},sz:10,name:'Arial'},
           alignment:{vertical:'center'}, border:thinBorder() };
}
function tStyle() {  // строка итого
  return { fill:{fgColor:{rgb:XL.BLUE_MID}}, font:{color:{rgb:XL.TEXT_WHITE},bold:true,sz:10,name:'Arial'},
           alignment:{vertical:'center'}, border:thinBorder() };
}
function gStyle() {  // ИТОГО К ВЫПЛАТЕ
  return { fill:{fgColor:{rgb:XL.GOLD}}, font:{color:{rgb:XL.TEXT_DARK},bold:true,sz:11,name:'Arial'},
           alignment:{vertical:'center'}, border:thinBorder() };
}
function titleStyle() {
  return { font:{bold:true,sz:13,color:{rgb:XL.BLUE_DARK},name:'Arial'} };
}

// Применить стиль строки к массиву ячеек
function sr(cells, style) {
  return cells.map(c => {
    if (c && typeof c === 'object' && 't' in c)
      return { ...c, s:{ fill:style.fill, font:style.font, border:style.border,
                         alignment:style.alignment, ...(c.z?{z:c.z}:{}) }};
    const isNum = typeof c === 'number';
    return { v:c??'', t:isNum?'n':'s', s:style };
  });
}

// Собрать Sheet из массива строк
function buildSheet(rows) {
  const ws = {};
  let maxCol = 0;
  rows.forEach((row, r) => {
    maxCol = Math.max(maxCol, row.length);
    row.forEach((cell, c) => {
      const addr = XLSX.utils.encode_cell({r,c});
      if (cell == null)                            ws[addr] = {v:'',t:'s'};
      else if (typeof cell==='object'&&'t' in cell) ws[addr] = cell;
      else ws[addr] = {v:cell, t:typeof cell==='number'?'n':'s'};
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({s:{r:0,c:0},e:{r:rows.length-1,c:maxCol-1}});
  return ws;
}

// Компактная сводка ЗП тренера: ПТ всего / дежурства / прочее / итого.
// tot — счётчики по категориям (c1..r3, dh), sal — результат calcSalary.
function pushSalarySummaryBlock(rows, tot, sal) {
  rows.push(sr(['── Сводка ──','кол-во','','сумма'], hStyle(XL.BLUE_MID)));
  const ptCount = svcCount(tot);
  const ptSum   = svcSum(sal);
  rows.push(sr(['ПТ всего (вкл. разовые, пробные, замены)', ptCount, '', mc(ptSum)], rStyle(true)));
  rows.push(sr(['Дежурства (ч)',   +tot.dh.toFixed(2), '', mc(sal.dutySum)], rStyle(false)));
  const other = sal.total - ptSum - sal.dutySum;
  if (other) rows.push(sr(['Прочее (группы, премии/штрафы, 1С)','','',mc(other)], rStyle(true)));
  rows.push(sr(['ИТОГО','','',mc(sal.total)], gStyle()));
}

// ── Раскладка проведённых услуг по дням (единая для ведомости филиала и личного отчёта) ──
// c1-3 — ПТ дети, v1-3 — ПТ взрослые, r1-3 — разовые, sb — ПТ-замены со ставкой координатора,
// tr — пробные. Раскладка повторяет calcSalary: замена БЕЗ ставки оплачивается по категории →
// попадает в c/v; неподтверждённый долг не оплачивается → не в сетке, считается отдельно (debt).
// Возраст неизвестен → дети.
const SVC_KEYS = ['c1','c2','c3','v1','v2','v3','r1','r2','r3','sb','tr'];
const SVC_HEAD = ['1кат','2кат','3кат','1катВ','2катВ','3катВ','Разов.1к','Разов.2к','Разов.3к','Замены','Пробные'];
const _isSub   = w => w.substitute_for!=null && w.substitute_rate!=null;
function _svcEmpty() { const o={}; SVC_KEYS.forEach(k=>{o[k]=0;}); return o; }
function buildServiceDays(workouts, duties, trials) {
  const byDay = {}, dutyByDay = {};
  const tot = {..._svcEmpty(), dh:0, debt:0};
  const at = d => byDay[d] || (byDay[d] = _svcEmpty());
  (workouts||[]).forEach(w => {
    if (w.is_debt && !w.debt_confirmed_at) { tot.debt++; return; }
    let k;
    if (_isSub(w))         k = 'sb';
    else if (w.is_drop_in) k = `r${w.drop_in_category||1}`;
    else {
      const age = w.clients?.age;
      k = `${typeof age==='number' && age > CHILD_MAX_AGE ? 'v' : 'c'}${w.category_at_moment}`;
    }
    if (!(k in tot)) return;
    at(new Date(w.workout_date).getDate())[k]++; tot[k]++;
  });
  (trials||[]).forEach(t => {
    tot.tr++;
    if (t.session_date) at(new Date(t.session_date).getDate()).tr++;
  });
  (duties||[]).forEach(d => {
    if (d.rejected_at) return;
    const h = (new Date(d.end_time)-new Date(d.start_time))/3600000;
    const day = new Date(d.start_time).getDate();
    dutyByDay[day] = (dutyByDay[day]||0) + h; tot.dh += h;
  });
  return {byDay, dutyByDay, tot};
}
const svcCount = tot => SVC_KEYS.reduce((s,k)=>s+(tot[k]||0),0);
const svcSum   = sal => sal.ptSum + (sal.dropInSum||0) + (sal.trialSum||0) + (sal.ptSubSum||0);

// Таблица «по дням» (31 → 1) + строка итого. blank=true — пустые ячейки вместо нулей.
function pushServiceDayTable(rows, daysInMonth, svc, blank=false) {
  rows.push(sr(['Число', ...SVC_HEAD, 'Деж.(ч)'], hStyle()));
  const z = blank ? '' : 0;
  for (let day=daysInMonth; day>=1; day--) {
    const b  = svc.byDay[day] || _svcEmpty();
    const dh = svc.dutyByDay[day] || 0;
    rows.push(sr([day, ...SVC_KEYS.map(k=>b[k]||z), dh ? +dh.toFixed(2) : z],
      rStyle((daysInMonth-day)%2===0)));
  }
  rows.push(sr(['Итого:', ...SVC_KEYS.map(k=>svc.tot[k]), +svc.tot.dh.toFixed(2)], tStyle()));
}

// Строки «Расчёт зарплаты» по услугам — суммы из calcSalary, количества из раскладки.
function serviceSalaryLines(tot, sal) {
  const L = [];
  [1,2,3].forEach(c => L.push([`ПТ кат.${c} (дети)`, tot[`c${c}`], mc(RATES.pt[c]), mc(tot[`c${c}`]*RATES.pt[c])]));
  [1,2,3].forEach(c => L.push([`ПТ кат.${c}В (взрослые)`, tot[`v${c}`], mc(RATES.pt[c]), mc(tot[`v${c}`]*RATES.pt[c])]));
  [1,2,3].forEach(c => L.push([`Разовые ${c}кт`, tot[`r${c}`], mc(RATES.pt[c]), mc(tot[`r${c}`]*RATES.pt[c])]));
  L.push(['Пробные', tot.tr, '', mc(sal.trialSum||0)]);
  L.push(['Замены ПТ (ставка коорд.)', tot.sb, '', mc(sal.ptSubSum||0)]);
  L.push(['Дежурство', +tot.dh.toFixed(2), mc(RATES.duty_per_hour), mc(sal.dutySum)]);
  if (tot.debt) L.push([`Долг не подтверждён (не оплачивается)`, tot.debt, '', mc(0)]);
  return L;
}

// ─────────────────────────────────────────────
// ЭКСПОРТ СВОДНОЙ ВЕДОМОСТИ (координатор)
// 1 файл = 1 филиал
// Листы: Ведомость | Взрослые ГП | [N] Фамилия × тренеры
// ─────────────────────────────────────────────
function exportSummaryExcel(year, month, summaryData, branch) {
  const XLSX      = window.XLSX;
  const wb        = XLSX.utils.book_new();
  const monthName = new Date(year,month-1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const daysInMonth = new Date(year,month,0).getDate();

  const {workouts,duties,groupSessions,profiles,adjustments,groupSubstitutions,ptSubstitutions,trialSessions:allTrials,childAutoByTrainer={},recalcByTrainer={}} = summaryData;
  // Строк корректировок может быть несколько на тренера (по филиалам) — агрегируем
  const adjMap = aggAdjustments(adjustments);

  // Тренеры отфильтрованные и отсортированные
  const trainers = [...(profiles||[])].sort((a,b)=>a.fio.localeCompare(b.fio,'ru'));

  // Хелпер: день из ISO-строки
  const dayOf = s => new Date(s).getDate();

  // isChild по возрасту клиента
  // Данные и расчёт ЗП тренера — один источник для «Ведомости» и личного листа.
  // ПТ-замены (ptSubstitutions) грузятся отдельно от обычных ПТ — склеиваем, как на экране сводки.
  const trainerCalc = p => {
    const pw  = [...(workouts||[]), ...(ptSubstitutions||[])]
      .filter(w=>w.trainer_id===p.id && (!w.is_debt||w.debt_confirmed_at));
    const pd  = (duties||[]).filter(d=>d.trainer_id===p.id);
    const pgs = (groupSessions||[]).filter(gs=>gs.trainer_id===p.id && gs.group_types?.billing_model==='headcount');
    const pts = (allTrials||[]).filter(t=>t.trainer_id===p.id);
    const recEntry = recalcByTrainer[p.id] || { sum:0, rows:[] };
    const sal = calcSalary({workouts:pw, duties:pd, groupSessions:pgs, adjustment:adjMap[p.id]||null,
                            childAutoSum:childAutoByTrainer[p.id]||0, groupSubstitutions:(groupSubstitutions||[]),
                            trialSessions:pts, trainerId:p.id, recalcSum:recEntry.sum});
    return {pw, pd, pts, recEntry, sal};
  };

  // ═══════════════════════════════════════════
  // Лист 1: ВЕДОМОСТЬ
  // ═══════════════════════════════════════════
  const vRows = [];
  vRows.push([tc(`${branch} — З.П. Аква департамента — ${monthName}`, titleStyle())]);
  vRows.push([]);

  const vHeader = ['N','ФИО тренера','Деж.ч','Сумма деж.','Взр.ГП (сум)','Дет.ГП (сум)','Замены ГП',
                   'ПТ (кол-во)','Сумма ПТ','Премия','Штраф','Разн. 1С','Итого','Система'];
  vRows.push(sr(vHeader, hStyle()));

  const vTotals = {dh:0,ds:0,gs:0,cs:0,gss:0,pt:0,ps:0,bon:0,pen:0,rec:0,tot:0};
  let n=1;

  trainers.forEach((p,i) => {
    const {pw, pd, pts, sal} = trainerCalc(p);
    const ptCount = svcCount(buildServiceDays(pw, pd, pts).tot);
    const ptSum   = svcSum(sal);

    vRows.push(sr([
      n++, p.fio,
      +sal.hours.toFixed(2), mc(sal.dutySum),
      mc(sal.adultSum), mc(sal.childSum), mc(sal.groupSubSum),
      ptCount, mc(ptSum),
      mc(sal.bonus), mc(sal.penalty),
      sal.recalcSum ? mc(sal.recalcSum) : '',
      mc(sal.total),
      '', // Система — пустая
    ], rStyle(i%2===0)));

    vTotals.dh  += sal.hours;
    vTotals.ds  += sal.dutySum;
    vTotals.gs  += sal.adultSum;
    vTotals.cs  += sal.childSum;
    vTotals.gss += sal.groupSubSum;
    vTotals.pt  += ptCount;
    vTotals.ps  += ptSum;
    vTotals.bon += sal.bonus;
    vTotals.pen += sal.penalty;
    vTotals.rec += sal.recalcSum;
    vTotals.tot += sal.total;
  });

  vRows.push(sr([
    '','ИТОГО:',
    +vTotals.dh.toFixed(2), mc(vTotals.ds),
    mc(vTotals.gs), mc(vTotals.cs), mc(vTotals.gss),
    vTotals.pt, mc(vTotals.ps),
    mc(vTotals.bon), mc(vTotals.pen),
    vTotals.rec ? mc(vTotals.rec) : '',
    mc(vTotals.tot), '',
  ], gStyle()));

  const wsV = buildSheet(vRows);
  wsV['!cols'] = [{wch:4},{wch:24},{wch:8},{wch:14},{wch:14},{wch:14},{wch:12},{wch:10},{wch:14},{wch:10},{wch:10},{wch:12},{wch:14},{wch:12}];
  XLSX.utils.book_append_sheet(wb, wsV, 'Ведомость');

  // ═══════════════════════════════════════════
  // Лист 2: ВЗРОСЛЫЕ ГП
  // Верхняя сетка тренер×день + блоки по тренерам
  // ═══════════════════════════════════════════
  const gpRows = [];
  gpRows.push([tc(`Взрослые ГП — ${branch} — ${monthName}`, titleStyle())]);
  gpRows.push([]);

  // Сетка: шапка дней
  const dayHeader = ['Тренер', ...Array.from({length:daysInMonth},(_,i)=>i+1), 'Итого'];
  gpRows.push(sr(dayHeader, hStyle()));

  // adult GP sessions: тренер → день → headcount[]
  const adultGS = (groupSessions||[]).filter(gs=>gs.group_types?.billing_model==='headcount');

  trainers.forEach((p,i) => {
    const tgs = adultGS.filter(gs=>gs.trainer_id===p.id);
    const dayMap = {}; // день → [headcount]
    tgs.forEach(gs => {
      const d = dayOf(gs.session_date);
      if (!dayMap[d]) dayMap[d]=[];
      dayMap[d].push(gs.headcount||0);
    });
    const dayCells = Array.from({length:daysInMonth},(_,i)=>{
      const d=i+1, hcs=dayMap[d]||[];
      return hcs.length ? nc(hcs.reduce((s,v)=>s+v,0)) : null;
    });
    const totalSessions = tgs.length;
    gpRows.push(sr([p.fio, ...dayCells, nc(totalSessions)], rStyle(i%2===0)));
  });

  gpRows.push([]);

  // Блоки под каждым тренером
  RATES.group_adult.forEach((tier,ti) => {
    // ничего, просто ниже по тренерам
  });

  trainers.forEach((p,i) => {
    const tgs = adultGS.filter(gs=>gs.trainer_id===p.id);
    if (!tgs.length) return;

    // Группируем занятия по ставке
    const byRate = {};
    RATES.group_adult.forEach(tier => { byRate[tier.rate] = []; });
    tgs.forEach(gs => {
      const rate = getAdultGroupRate(gs.headcount||0);
      byRate[rate].push(gs);
    });

    gpRows.push(sr([p.fio, 'ставка', 'кол-во', 'сумма'], hStyle(XL.BLUE_MID)));
    let trainerTotal = 0;
    RATES.group_adult.forEach(tier => {
      const sessions = byRate[tier.rate]||[];
      const sum = sessions.length * tier.rate;
      trainerTotal += sum;
      gpRows.push(sr(['', mc(tier.rate), nc(sessions.length), mc(sum)], rStyle(false)));
    });
    gpRows.push(sr(['', 'Итого:', nc(tgs.length), mc(trainerTotal)], tStyle()));
    gpRows.push([]);
  });

  const wsGP = buildSheet(gpRows);
  wsGP['!cols'] = [{wch:22}, ...Array(daysInMonth).fill({wch:4}), {wch:6}];
  XLSX.utils.book_append_sheet(wb, wsGP, 'Взрослые ГП');

  // ═══════════════════════════════════════════
  // Листы 3..N: ИНДИВИДУАЛЬНЫЕ (один на тренера)
  // ═══════════════════════════════════════════
  trainers.forEach((p, pi) => {
    const {pw, pd, pts, recEntry, sal} = trainerCalc(p);
    const svc = buildServiceDays(pw, pd, pts);
    const tot = svc.tot;

    const rows = [];
    rows.push([tc(`${p.fio} — ${monthName}`, titleStyle())]);
    rows.push([]);
    pushServiceDayTable(rows, daysInMonth, svc);
    rows.push([]);

    // ── Расчёт ЗП ──
    rows.push(sr(['── Расчёт зарплаты ──'], hStyle(XL.BLUE_DARK)));
    const salLines = serviceSalaryLines(tot, sal);
    if (sal.adultSum)  salLines.push(['Взрослые ГП','','',mc(sal.adultSum)]);
    if (sal.childSum)  salLines.push(['Детские ГП (авто)','','',mc(sal.childSum)]);
    if (sal.groupSubSum) salLines.push(['Замены в группах','','',mc(sal.groupSubSum)]);
    if (sal.bonus)     salLines.push(['Премия',     '','',mc(sal.bonus)]);
    if (sal.penalty)   salLines.push(['Штраф',      '','',mc(-sal.penalty)]);
    // Разница от пересчёта (сверка с 1С) — строкой + расшифровка по клиентам
    if (sal.recalcSum || recEntry.rows.length) {
      salLines.push(['Разница от пересчёта (1С)','','',mc(sal.recalcSum)]);
      recEntry.rows.forEach(r => salLines.push([`  · ${r.clientFio}${_recalcUnits(r)}`, '', '', mc(r.delta)]));
    }

    salLines.forEach((r,i) => rows.push(sr(r, rStyle(i%2===0))));
    rows.push(sr(['ИТОГО К ВЫПЛАТЕ','','',mc(sal.total)], gStyle()));
    rows.push([]);
    pushSalarySummaryBlock(rows, tot, sal);

    // Лист
    const sheetName = `${pi+1} ${p.fio.split(' ')[0]}`; // "1 Иванов"
    const ws = buildSheet(rows);
    // A широкая под подписи расчёта ЗП, C/D — под суммы с разрядами (иначе в Excel будет ####)
    ws['!cols'] = [{wch:20},{wch:6},{wch:10},{wch:12},{wch:7},{wch:7},{wch:7},
                   {wch:9},{wch:9},{wch:9},{wch:8},{wch:8},{wch:8}];
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0,31));
  });

  XLSX.writeFile(wb, `ЗП_${branch}_${monthName}.xlsx`);
}

// ─────────────────────────────────────────────
// ЭКСПОРТ ИНДИВИДУАЛЬНОГО ОТЧЁТА ТРЕНЕРА
// ─────────────────────────────────────────────
// Карта workout.id → № занятия по абонементу клиента.
// Абонемент тренировки = последний абонемент клиента с start_date <= даты тренировки;
// номер = счёт тренировок клиента (не-разовых, любым тренером) внутри этого абонемента.
function buildWorkoutNumbers(numbering) {
  const map = {};
  if (!numbering) return map;
  const subsBy = {};
  (numbering.subs||[]).forEach(s=>{ (subsBy[s.client_id]=subsBy[s.client_id]||[]).push(s); });
  Object.values(subsBy).forEach(a=>a.sort((x,y)=>x.start_date<y.start_date?-1:1));
  const histBy = {};
  (numbering.history||[]).filter(w=>!w.is_drop_in).forEach(w=>{ (histBy[w.client_id]=histBy[w.client_id]||[]).push(w); });
  Object.entries(histBy).forEach(([cid,list])=>{
    list.sort((a,b)=> a.workout_date<b.workout_date?-1 : a.workout_date>b.workout_date?1 : (a.id<b.id?-1:1));
    const subsC = subsBy[cid]||[];
    const counters = {};
    list.forEach(w=>{
      const day = String(w.workout_date).slice(0,10);
      let sub = null;
      for (const s of subsC) { if (s.start_date<=day) sub=s; else break; }
      const key = sub ? sub.start_date : 'nosub';
      counters[key]=(counters[key]||0)+1;
      map[w.id]=counters[key];
    });
  });
  return map;
}

// extras — то, что не делится по филиалам: {trainerId, childAutoSum, childAutoRows, groupSubstitutions}
// (авто-ЗП детских групп и замены в группах). При нескольких филиалах — строками на сводном листе.
function exportTrainerExcel(trainerFio, year, month, workouts, duties, groupSessions, adjustment, numbering=null, trials=[], recalcRows=[], extras={}) {
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();
  const numMap = buildWorkoutNumbers(numbering);
  const hasNumbers = Object.keys(numMap).length > 0;
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthName   = new Date(year, month-1).toLocaleDateString('ru-RU', {month:'long',year:'numeric'});

  // adjustment: массив строк по филиалам (новое) или один объект-агрегат (легаси)
  const adjList = Array.isArray(adjustment) ? adjustment : (adjustment ? [adjustment] : []);
  const adjFor  = b => {
    const rows = adjList.filter(a => (a.branch||'') === b);
    if (!rows.length) return null;
    return rows.reduce((m,a)=>({bonus:m.bonus+(a.bonus||0), penalty:m.penalty+(a.penalty||0)}), {bonus:0,penalty:0});
  };
  const adjAgg = adjList.length
    ? adjList.reduce((m,a)=>({bonus:m.bonus+(a.bonus||0), penalty:m.penalty+(a.penalty||0)}), {bonus:0,penalty:0})
    : null;

  // Филиалы тренера в этом месяце: >1 → отдельная пара листов на каждый филиал + сводный лист
  const allBranches = [...new Set([...(workouts||[]),...(duties||[]),...(groupSessions||[]),...(trials||[])]
    .map(x=>x.branch).filter(Boolean))].sort((a,b)=>a.localeCompare(b,'ru'));
  const multiBranch = allBranches.length > 1;

  // Строит пару листов («По дням»+suffix, «По клиентам»+suffix) по подмножеству данных.
  // Возвращает {tot, sal} для сводного листа по филиалам.
  function addBranchSheets(workouts, duties, groupSessions, adjustment, suffix, trials=[], recalcRows=[], withGroupExtras=false) {
  const svc = buildServiceDays(workouts, duties, trials);
  const tot = svc.tot;

  const rows = [];
  rows.push([tc(`${trainerFio} — ${monthName}${suffix}`, titleStyle())]);
  rows.push([]);
  pushServiceDayTable(rows, daysInMonth, svc, true);
  rows.push([]);

  const pgs = (groupSessions||[]).filter(gs=>gs.group_types?.billing_model==='headcount');
  const recalcSum = (recalcRows||[]).reduce((s,r)=>s+Number(r.delta||0),0);
  const sal = calcSalary({workouts,duties,groupSessions:pgs,adjustment,trialSessions:trials,recalcSum,
    ...(withGroupExtras ? {childAutoSum:extras.childAutoSum||0, groupSubstitutions:extras.groupSubstitutions||[],
                           trainerId:extras.trainerId??null} : {})});

  rows.push(sr(['── Расчёт зарплаты ──'], hStyle(XL.BLUE_DARK)));
  const salLines = serviceSalaryLines(tot, sal);
  if (sal.adultSum) salLines.push(['Взрослые ГП','','',mc(sal.adultSum)]);
  if (sal.childSum) {
    salLines.push(['Детские ГП (авто)','','',mc(sal.childSum)]);
    (extras.childAutoRows||[]).forEach(r => salLines.push([`  · ${r.groupName}`,'','',mc(r.final)]));
  }
  if (sal.groupSubSum) salLines.push(['Замены в группах','','',mc(sal.groupSubSum)]);
  if (sal.bonus)    salLines.push(['Премия','','',mc(sal.bonus)]);
  if (sal.penalty)  salLines.push(['Штраф','','',mc(-sal.penalty)]);
  if (sal.recalcSum || (recalcRows||[]).length) {
    salLines.push(['Разница от пересчёта (1С)','','',mc(sal.recalcSum)]);
    (recalcRows||[]).forEach(r => salLines.push([`  · ${r.clientFio}${_recalcUnits(r)}`, '', '', mc(r.delta)]));
  }
  salLines.forEach((r,i)=>rows.push(sr(r,rStyle(i%2===0))));
  rows.push(sr(['ИТОГО К ВЫПЛАТЕ','','',mc(sal.total)],gStyle()));
  rows.push([]);
  pushSalarySummaryBlock(rows, tot, sal);

  const ws = buildSheet(rows);
  // A широкая под подписи расчёта ЗП, C/D — под суммы с разрядами (иначе в Excel будет ####)
  ws['!cols']=[{wch:20},{wch:6},{wch:10},{wch:12},{wch:7},{wch:7},{wch:7},
               {wch:9},{wch:9},{wch:9},{wch:8},{wch:8},{wch:8}];
  XLSX.utils.book_append_sheet(wb,ws,('По дням'+suffix).slice(0,31));

  // ── Лист 2: По клиентам (сетка клиент × день) ──
  const DOW = ['Вс','Пн','Вт','Ср','Чт','Пт','Сб'];

  // Группируем тренировки по клиенту
  const byClient = {};
  workouts.forEach(w => {
    const cid = w.client_id || w.clients?.fio || w.clients?.name || '—';
    if (!byClient[cid]) byClient[cid] = { name: w.clients?.fio||w.clients?.name||'—', days: {}, total: 0 };
    const day = new Date(w.workout_date).getDate();
    if (!byClient[cid].days[day]) byClient[cid].days[day] = [];
    if (w.is_drop_in) {
      byClient[cid].days[day].push(`Р${w.drop_in_category||1}`);
    } else {
      // № занятия по абонементу (7-я, 8-я…); без данных нумерации — категория, как раньше.
      // З — замена (провёл за другого тренера), Д — долг, не подтверждён (не оплачивается)
      const mark = w.substitute_for!=null ? 'З' : (w.is_debt && !w.debt_confirmed_at ? 'Д' : '');
      byClient[cid].days[day].push(mark + String(numMap[w.id] ?? (w.category_at_moment||'?')));
    }
    byClient[cid].total++;
  });

  // Разовые агрегируем отдельно: кат → день → кол-во
  const dropInByDay = {1:{},2:{},3:{}};
  workouts.filter(w=>w.is_drop_in).forEach(w => {
    const dc = w.drop_in_category||1;
    const day = new Date(w.workout_date).getDate();
    dropInByDay[dc][day] = (dropInByDay[dc][day]||0)+1;
  });

  // Клиенты, у кого хоть одна не-разовая тренировка (разовые — отдельными строками ниже)
  const regularClientIds = new Set(workouts.filter(w=>!w.is_drop_in).map(w=>w.client_id||w.clients?.fio||w.clients?.name||'—'));
  const clientList = Object.entries(byClient)
    .filter(([id]) => regularClientIds.has(id))
    .sort(([,a],[,b]) => a.name.localeCompare(b.name,'ru'));

  const clRows = [];
  clRows.push([tc(`${trainerFio} — ${monthName}${suffix} — по клиентам`, titleStyle())]);
  clRows.push([tc(hasNumbers
    ? 'В ячейке — № занятия по абонементу клиента (два числа = два занятия в день); Р1/Р2/Р3 — разовые; З — замена; Д — долг (не подтв.); П — пробная (кат.)'
    : 'В ячейке — категория занятия (два числа = два занятия в день); Р1/Р2/Р3 — разовые; З — замена; Д — долг (не подтв.); П — пробная (кат.)',
    {font:{sz:10,name:'Arial',color:{rgb:'6B7280'},italic:true}})]);

  // Шапка: день недели
  const dowRow = [tc('ФИО', hStyle())];
  for (let d=1; d<=daysInMonth; d++) {
    const dow = DOW[new Date(year,month-1,d).getDay()];
    const isSat = new Date(year,month-1,d).getDay()===6;
    const isSun = new Date(year,month-1,d).getDay()===0;
    dowRow.push(tc(dow, hStyle(isSun?'DC2626':isSat?'2D6A9F':XL.BLUE_DARK)));
  }
  dowRow.push(tc('Итого', hStyle()));
  clRows.push(dowRow);

  // Шапка: числа
  const dayNumRow = [tc('', hStyle(XL.BLUE_MID))];
  for (let d=1; d<=daysInMonth; d++) dayNumRow.push(tc(d, hStyle(XL.BLUE_MID)));
  dayNumRow.push(tc('', hStyle(XL.BLUE_MID)));
  clRows.push(dayNumRow);

  // Строки клиентов
  clientList.forEach(([id, cl], i) => {
    const st = rStyle(i%2===0);
    const row = [tc(cl.name, st)];
    for (let d=1; d<=daysInMonth; d++) {
      const sessions = cl.days[d];
      row.push(sessions?.length ? tc(sessions.join(','), {...st, font:{...st.font, bold:true}}) : tc('', st));
    }
    row.push(tc(cl.total, {...st, font:{...st.font, bold:true}}));
    clRows.push(row);
  });

  // Разовые строки
  [1,2,3].forEach((cat,i) => {
    const hasAny = Object.keys(dropInByDay[cat]).length > 0;
    if (!hasAny) return;
    const st = rStyle(i%2===0);
    const row = [tc(`Разовые ${cat} Кт`, {...st, font:{...st.font, bold:true, color:{rgb:XL.BLUE_DARK}}})];
    let total = 0;
    for (let d=1; d<=daysInMonth; d++) {
      const cnt = dropInByDay[cat][d]||0;
      row.push(cnt ? tc(cnt, st) : tc('', st));
      total += cnt;
    }
    row.push(tc(total, {...st, font:{...st.font, bold:true}}));
    clRows.push(row);
  });

  // Пробные — строка на каждого гостя (П + категория)
  const trialBy = {};
  (trials||[]).forEach(t => {
    const name = [t.last_name, t.first_name].filter(Boolean).join(' ') || 'Гость';
    const k = `${name}|${t.phone||''}`;
    const e = trialBy[k] || (trialBy[k] = {name, days:{}, total:0});
    if (t.session_date) {
      const d = new Date(t.session_date).getDate();
      (e.days[d] = e.days[d] || []).push(`П${t.category||''}`);
    }
    e.total++;
  });
  Object.values(trialBy).sort((a,b)=>a.name.localeCompare(b.name,'ru')).forEach((e,i) => {
    const st = rStyle(i%2===0);
    const row = [tc(`Пробная: ${e.name}`, {...st, font:{...st.font, bold:true, color:{rgb:XL.BLUE_DARK}}})];
    for (let d=1; d<=daysInMonth; d++) row.push(tc((e.days[d]||[]).join(','), st));
    row.push(tc(e.total, {...st, font:{...st.font, bold:true}}));
    clRows.push(row);
  });

  const ws2 = buildSheet(clRows);
  ws2['!cols'] = [{wch:22}, ...Array.from({length:daysInMonth}, ()=>({wch:4})), {wch:7}];
  XLSX.utils.book_append_sheet(wb, ws2, ('По клиентам'+suffix).slice(0,31));

  return {tot, sal};
  } // конец addBranchSheets

  if (!multiBranch) {
    addBranchSheets(workouts, duties, groupSessions, adjAgg, '', trials, recalcRows, true);
  } else {
    // Пара листов на каждый филиал; премия/штраф филиала — в его листах.
    // Легаси-строки без филиала (branch='') — отдельно на сводном листе.
    const perBranch = allBranches.map(b => {
      const r = addBranchSheets(
        (workouts||[]).filter(w=>w.branch===b),
        (duties||[]).filter(d=>d.branch===b),
        (groupSessions||[]).filter(g=>g.branch===b),
        adjFor(b), ` — ${b}`, (trials||[]).filter(t=>t.branch===b),
        (recalcRows||[]).filter(r=>r.branch===b));
      return {branch:b, ...r};
    });

    // Сводный лист по филиалам
    const sRows = [];
    sRows.push([tc(`${trainerFio} — ${monthName} — по филиалам`, titleStyle())]);
    sRows.push([]);
    sRows.push(sr(['Филиал','ПТ (кол-во)','Сумма ПТ','Деж.(ч)','Сумма деж.','Прочее','Итого'], hStyle()));

    const g = {pt:0,ps:0,dh:0,ds:0,ot:0,tot:0};
    perBranch.forEach(({branch,tot,sal},i) => {
      const ptCount = svcCount(tot);
      const ptSum   = svcSum(sal);
      const other   = sal.total - ptSum - sal.dutySum;
      sRows.push(sr([branch, ptCount, mc(ptSum), +tot.dh.toFixed(2), mc(sal.dutySum), mc(other), mc(sal.total)], rStyle(i%2===0)));
      g.pt+=ptCount; g.ps+=ptSum; g.dh+=tot.dh; g.ds+=sal.dutySum; g.ot+=other; g.tot+=sal.total;
    });
    // Премии/штрафы филиалов уже внутри «Итого» филиальных строк; здесь — только легаси без филиала
    const legacy  = adjFor('');
    const bonus   = legacy?.bonus  ||0;
    const penalty = legacy?.penalty||0;
    if (bonus)   sRows.push(sr(['Премия (без филиала)','','','','','',mc(bonus)],   rStyle(false)));
    if (penalty) sRows.push(sr(['Штраф (без филиала)','','','','','',mc(-penalty)], rStyle(true)));
    // Детские группы и замены в группах на филиалы не делятся — отдельными строками
    const childSum = Number(extras.childAutoSum)||0;
    if (childSum) {
      sRows.push(sr(['Детские ГП (авто)','','','','','',mc(childSum)], rStyle(false)));
      (extras.childAutoRows||[]).forEach(r => sRows.push(sr([`  · ${r.groupName}`,'','','','','',mc(r.final)], rStyle(false))));
    }
    const groupSubSum = calcSalary({groupSessions:(groupSessions||[]).filter(gs=>gs.group_types?.billing_model==='headcount'),
      groupSubstitutions:extras.groupSubstitutions||[], trainerId:extras.trainerId??null}).groupSubSum;
    if (groupSubSum) sRows.push(sr(['Замены в группах','','','','','',mc(groupSubSum)], rStyle(true)));
    sRows.push(sr(['ИТОГО', g.pt, mc(g.ps), +g.dh.toFixed(2), mc(g.ds), mc(g.ot+childSum+groupSubSum),
                   mc(g.tot+bonus-penalty+childSum+groupSubSum)], gStyle()));

    const wsS = buildSheet(sRows);
    wsS['!cols'] = [{wch:20},{wch:11},{wch:13},{wch:8},{wch:12},{wch:13},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsS, 'Сводка по филиалам');
  }

  XLSX.writeFile(wb,`ЗП_${trainerFio.split(' ')[0]}_${monthName}.xlsx`);
}

// ─────────────────────────────────────────────
// ЭКСПОРТ ДЕТСКОЙ ГРУППЫ (ведомость за месяц)
// ─────────────────────────────────────────────
function exportChildGroupExcel(groupId, monthStr, report, groupInfo) {
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();

  const {clients, payments, notes, attendance, payouts} = report;
  const monthLabel = new Date(monthStr).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const groupName  = groupInfo?.group_types?.name || 'Группа';
  const branch     = groupInfo?.branch || '';
  const trainerFio = groupInfo?.profiles?.fio || '—';

  // Карты для быстрого доступа
  const payMap = Object.fromEntries(payments.map(p=>[p.group_client_id, p]));
  const noteMap = Object.fromEntries(notes.map(n=>[n.group_client_id, n]));

  // Даты занятий и посещаемость
  const sessionDates = [...new Set(attendance.map(a=>a.session_date))].sort();
  const attByClient = {};
  attendance.forEach(a => {
    if (!attByClient[a.group_client_id]) attByClient[a.group_client_id] = 0;
    if (a.attended) attByClient[a.group_client_id]++;
  });

  const activeClients = clients.filter(c=>c.is_active!==false);
  const archivedClients = report.archived || [];
  const totalPaid   = payments.filter(p=>p.paid).reduce((s,p)=>s+Number(p.amount||0),0);
  const totalUnpaid = payments.filter(p=>!p.paid).reduce((s,p)=>s+Number(p.amount||0),0);

  // 4-статусная модель (docs/group-payment-status-4state.md): единый источник — statusMap
  const statusMap = report.statusMap || {};
  const statusOf = c => c.is_active===false ? 'left' : (statusMap[c.id]?.status || 'debt');
  const ST = {
    paid:  {label:'✅ Оплачено',        rgb:XL.GREEN_DARK},
    carry: {label:'🟡 Оплачено в том мес.', rgb:'B45309'},
    debt:  {label:'❌ Без оплаты',      rgb:'DC2626'},
    left:  {label:'— Ушёл',             rgb:'64748B'},
  };
  const sCount = {paid:0, carry:0, debt:0, left:archivedClients.length};
  activeClients.forEach(c=>{ sCount[statusOf(c)]++; });

  // ── Лист: Ведомость группы ──
  const rows = [];

  // Заголовок
  rows.push([tc(`${groupName} — ${branch} — ${monthLabel}`, titleStyle())]);
  rows.push([tc(`Тренер: ${trainerFio}`, {font:{sz:11,name:'Arial',color:{rgb:XL.TEXT_DARK}}})]);
  rows.push([tc(`Занятий в месяце: ${sessionDates.length}`, {font:{sz:11,name:'Arial',color:{rgb:XL.TEXT_DARK}}})]);
  rows.push([]);

  // Шапка таблицы
  rows.push(sr(
    ['N','Имя ребёнка','Возраст','Посещаемость','% явки','Сумма','Статус','Дата оплаты','Начало абонемента','Конец абонемента','Долг','Прогресс / заметка'],
    hStyle()
  ));

  // Строки активных детей
  const clientRow = (c, i, forceLeft=false) => {
    const pay   = statusMap[c.id]?.pay || payMap[c.id];
    const note  = noteMap[c.id];
    const att   = attByClient[c.id]||0;
    const pct   = sessionDates.length ? Math.round(att/sessionDates.length*100) : 0;
    const st    = forceLeft ? 'left' : statusOf(c);
    const amount = st==='paid' && pay?.amount ? Number(pay.amount) : 0;
    const debt   = st==='debt' ? Number((payMap[c.id]?.amount)||c.monthly_price||0) : 0;

    const rs = rStyle(i%2===0);
    const stStyle = {...rs, font:{...rs.font, color:{rgb:ST[st].rgb}}};

    return [
      tc(i+1, rs),
      tc(c.name||'—', st==='left' ? {...rs, font:{...rs.font, color:{rgb:'94A3B8'}}} : rs),
      tc(c.age||'—', rs),
      tc(`${att}/${sessionDates.length}`, rs),
      {v:pct, t:'n', z:'0"%"', s:rs},
      mc(amount, rs),
      tc(ST[st].label, stStyle),
      tc(pay?.paid_at ? new Date(pay.paid_at).toLocaleDateString('ru-RU') : '—', rs),
      tc(pay?.sub_start ? new Date(pay.sub_start).toLocaleDateString('ru-RU') : '—', rs),
      tc(pay?.sub_end ? new Date(pay.sub_end).toLocaleDateString('ru-RU') : '—', rs),
      mc(debt, {...rs, font:{...rs.font, color:{rgb:debt>0?'DC2626':XL.TEXT_DARK}}}),
      tc(note?.note||'—', rs),
    ];
  };
  activeClients.forEach((c,i)=> rows.push(clientRow(c,i)));
  // Ушедшие — отдельным блоком в конце (согласовано: включаем в файл)
  if (archivedClients.length) {
    rows.push(sr(['','── Ушли (архив) ──','','','','','','','','','',''], {
      ...rStyle(false), font:{color:{rgb:'64748B'},bold:true,sz:10,name:'Arial'}
    }));
    archivedClients.forEach((c,i)=> rows.push(clientRow(c, activeClients.length+i, true)));
  }

  rows.push([]);

  // Итоговые строки — 4 статуса
  rows.push(sr(['','ИТОГО:','',`${activeClients.length} активных`,'','','','','','','',''], tStyle()));
  rows.push(sr(['','Оплатили (этот месяц):','','','','','','','','','',`${sCount.paid} чел.`], {
    ...rStyle(false), font:{...rStyle(false).font, color:{rgb:XL.GREEN_DARK}, bold:true}
  }));
  rows.push(sr(['','Оплатили в том месяце:','','','','','','','','','',`${sCount.carry} чел.`], {
    ...rStyle(true), font:{...rStyle(true).font, color:{rgb:'B45309'}, bold:true}
  }));
  rows.push(sr(['','Без оплаты:','','','','','','','','','',`${sCount.debt} чел.`], {
    ...rStyle(false), font:{...rStyle(false).font, color:{rgb:'DC2626'}, bold:true}
  }));
  rows.push(sr(['','Ушли (архив):','','','','','','','','','',`${sCount.left} чел.`], {
    ...rStyle(true), font:{...rStyle(true).font, color:{rgb:'64748B'}, bold:true}
  }));
  rows.push(sr(['','Оплачено сейчас (🟢+🟡):','','','','','','','','','',`${sCount.paid+sCount.carry} чел.`], {
    ...rStyle(false), font:{...rStyle(false).font, bold:true}
  }));
  rows.push(sr(['','Сумма оплат (этот месяц):','','','', mc(totalPaid),'','','','','',''], gStyle()));
  if (totalUnpaid > 0)
    rows.push(sr(['','Задолженность:','','','', mc(totalUnpaid),'','','','','',''], {
      ...rStyle(false), fill:{fgColor:{rgb:'FEE2E2'}}, font:{color:{rgb:'DC2626'},bold:true,sz:10,name:'Arial'}
    }));

  rows.push([]);
  // Блок «Выплата тренеру» убран: ЗП считается авто (calcChildGroupPayroll),
  // отдельная выгрузка — кнопка «⬇️ ЗП» (exportGroupPayrollExcel)

  const ws = buildSheet(rows);
  ws['!cols'] = [{wch:4},{wch:22},{wch:8},{wch:12},{wch:8},{wch:14},{wch:14},{wch:14},{wch:14},{wch:14},{wch:12},{wch:30}];

  XLSX.utils.book_append_sheet(wb, ws, 'Ведомость');

  // ── Лист: Посещаемость по дням ──
  if (sessionDates.length) {
    const attRows = [];
    attRows.push([tc(`Посещаемость — ${groupName} — ${monthLabel}`, titleStyle())]);
    attRows.push([]);

    const attHeader = ['Имя', ...sessionDates.map(d=>new Date(d).getDate()), 'Итого'];
    attRows.push(sr(attHeader, hStyle()));

    activeClients.forEach((c,i) => {
      const attMap = Object.fromEntries(
        attendance.filter(a=>a.group_client_id===c.id).map(a=>[a.session_date, a.attended])
      );
      const dayCells = sessionDates.map(d => {
        const val = attMap[d];
        if (val===undefined) return tc('—', rStyle(i%2===0));
        return tc(val?'✓':'✗', {
          ...rStyle(i%2===0),
          font:{...rStyle(i%2===0).font, color:{rgb: val?XL.GREEN_DARK:'DC2626'}, bold:true}
        });
      });
      attRows.push([tc(c.name, rStyle(i%2===0)), ...dayCells, nc(attByClient[c.id]||0, rStyle(i%2===0))]);
    });

    const wsAtt = buildSheet(attRows);
    wsAtt['!cols'] = [{wch:22}, ...sessionDates.map(()=>({wch:5})), {wch:6}];
    XLSX.utils.book_append_sheet(wb, wsAtt, 'Посещаемость');
  }

  const safeName = groupName.replace(/[\\/:*?"<>|]/g,'').slice(0,20);
  XLSX.writeFile(wb, `ГП_${safeName}_${branch}_${monthLabel}.xlsx`);
}

// ─────────────────────────────────────────────
// ФИЛИАЛЬНАЯ ВЫГРУЗКА ДЕТСКИХ ГП
// Один файл = один филиал, лист на каждую группу + сводный
// ─────────────────────────────────────────────
function exportBranchChildGroupsExcel(branch, monthStr, groupReports, payrolls=[]) {
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();
  const monthLabel = new Date(monthStr).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});

  // ── Сводный лист ──
  const summaryRows = [];
  summaryRows.push([tc(`Детские группы — ${branch} — ${monthLabel}`, titleStyle())]);
  summaryRows.push([]);
  summaryRows.push(sr(['Группа','Тренер','Детей','Занятий','Оплатили','Не оплатили','Сумма оплат','Задолженность'], hStyle()));

  let totKids=0, totPaid=0, totUnpaid=0, totSum=0, totDebt=0;

  groupReports.forEach(({tg, report}, i) => {
    const {clients, payments, attendance} = report;
    const active = (clients||[]).filter(c=>c.is_active!==false);
    const sessionDates = [...new Set((attendance||[]).map(a=>a.session_date))];
    const paid   = (payments||[]).filter(p=>p.paid).length;
    const unpaid = active.length - paid;
    const sumPaid = (payments||[]).filter(p=>p.paid).reduce((s,p)=>s+Number(p.amount||0),0);
    const debt    = (payments||[]).filter(p=>!p.paid).reduce((s,p)=>s+Number(p.amount||0),0);

    summaryRows.push(sr([
      tg.group_types?.name||'—',
      tg.profiles?.fio||'—',
      active.length, sessionDates.length,
      paid, unpaid,
      mc(sumPaid), mc(debt),
    ], rStyle(i%2===0)));

    totKids   += active.length;
    totPaid   += paid;
    totUnpaid += unpaid;
    totSum    += sumPaid;
    totDebt   += debt;
  });

  summaryRows.push(sr(['ИТОГО:','', totKids,'', totPaid, totUnpaid, mc(totSum), mc(totDebt)], gStyle()));

  const wsSum = buildSheet(summaryRows);
  wsSum['!cols'] = [{wch:22},{wch:22},{wch:8},{wch:8},{wch:10},{wch:12},{wch:14},{wch:14}];
  XLSX.utils.book_append_sheet(wb, wsSum, 'Сводка');

  // ── Лист: ЗП сводка (все группы разом, формула calcChildGroupPayroll) ──
  if (payrolls.length) {
    const zRows = [];
    zRows.push([tc(`ЗП тренеров — детские ГП — ${branch} — ${monthLabel}`, titleStyle())]);
    zRows.push([]);
    zRows.push(sr(['Группа','Тренер','Роль','Формула','Авто','Премия','Штраф','К выплате'], hStyle()));

    let grand = 0, ri = 0;
    payrolls.forEach(({groupName, calc}) => {
      (calc.rows||[]).forEach(r => {
        const finalAmt = r.final !== undefined ? r.final : r.autoAmt;
        grand += finalAmt;
        const rs = rStyle(ri++%2===0);
        zRows.push([
          tc(groupName, rs), tc(r.fio, rs), tc(r.role, rs), tc(r.calcNote||'', rs),
          mc(r.autoAmt, rs), mc(r.bonus||0, rs), mc(r.penalty||0, rs),
          mc(finalAmt, {...rs, font:{...rs.font, bold:true, color:{rgb:XL.GREEN_DARK}}}),
        ]);
      });
      if (calc.leaderName) {
        grand += calc.leaderFee;
        const rs = rStyle(ri++%2===0);
        zRows.push([
          tc(groupName, rs), tc(calc.leaderName, rs), tc('Руководитель', rs),
          tc(`${calc.leaderPct}% пула (+ остаток, если все ставочники)`, rs),
          mc(calc.leaderFee, rs), tc('—', rs), tc('—', rs), mc(calc.leaderFee, rs),
        ]);
      }
    });

    zRows.push([]);
    zRows.push(sr(['ИТОГО к выплате:','','','','','','', mc(grand)], gStyle()));

    const wsZ = buildSheet(zRows);
    wsZ['!cols'] = [{wch:20},{wch:22},{wch:14},{wch:44},{wch:14},{wch:10},{wch:10},{wch:14}];
    XLSX.utils.book_append_sheet(wb, wsZ, 'ЗП сводка');
  }

  // ── Лист на каждую группу ──
  groupReports.forEach(({tg, report}) => {
    const {clients, payments, notes, attendance, payouts} = report;
    const groupName  = tg.group_types?.name || 'Группа';
    const trainerFio = tg.profiles?.fio || '—';
    const groupInfo  = { branch, group_types:{name:groupName}, profiles:{fio:trainerFio} };

    // Переиспользуем логику из exportChildGroupExcel — строим листы вручную
    const active = (clients||[]).filter(c=>c.is_active!==false);
    const payMap  = Object.fromEntries((payments||[]).map(p=>[p.group_client_id, p]));
    const noteMap = Object.fromEntries((notes||[]).map(n=>[n.group_client_id, n]));
    const sessionDates = [...new Set((attendance||[]).map(a=>a.session_date))].sort();
    const attByClient = {};
    (attendance||[]).forEach(a=>{
      if (!attByClient[a.group_client_id]) attByClient[a.group_client_id]=0;
      if (a.attended) attByClient[a.group_client_id]++;
    });
    const totalPaid   = (payments||[]).filter(p=>p.paid).reduce((s,p)=>s+Number(p.amount||0),0);
    const totalUnpaid = (payments||[]).filter(p=>!p.paid).reduce((s,p)=>s+Number(p.amount||0),0);

    const rows = [];
    rows.push([tc(`${groupName} — ${branch} — ${monthLabel}`, titleStyle())]);
    rows.push([tc(`Тренер: ${trainerFio}`, {font:{sz:11,name:'Arial',color:{rgb:XL.TEXT_DARK}}})]);
    rows.push([tc(`Занятий: ${sessionDates.length}`, {font:{sz:11,name:'Arial',color:{rgb:XL.TEXT_DARK}}})]);
    rows.push([]);
    rows.push(sr(['N','Имя','Возраст','Явка','%','Сумма','Оплачено','Дата оплаты','Долг','Заметка'], hStyle()));

    active.forEach((c,i)=>{
      const pay  = payMap[c.id];
      const note = noteMap[c.id];
      const att  = attByClient[c.id]||0;
      const pctV = sessionDates.length ? Math.round(att/sessionDates.length*100) : 0;
      const isPaid = pay?.paid||false;
      const amount = pay?.amount ? Number(pay.amount) : 0;
      const debt   = isPaid ? 0 : amount;
      const rs = rStyle(i%2===0);
      const paidStyle = {...rs, font:{...rs.font, color:{rgb: isPaid?XL.GREEN_DARK:'DC2626'}}};
      rows.push([
        tc(i+1,rs), tc(c.name||'—',rs), tc(c.age||'—',rs),
        tc(`${att}/${sessionDates.length}`,rs),
        {v:pctV,t:'n',z:'0"%"',s:rs},
        mc(amount,rs),
        tc(isPaid?'✅ Оплачено':'❌ Не оплачено', paidStyle),
        tc(pay?.paid_at?new Date(pay.paid_at).toLocaleDateString('ru-RU'):'—',rs),
        mc(debt,{...rs,font:{...rs.font,color:{rgb:debt>0?'DC2626':XL.TEXT_DARK}}}),
        tc(note?.note||'—',rs),
      ]);
    });

    rows.push([]);
    rows.push(sr(['','Сумма оплат:','','','',mc(totalPaid),'','','',''], gStyle()));
    if (totalUnpaid>0)
      rows.push(sr(['','Задолженность:','','','',mc(totalUnpaid),'','','',''],{
        ...rStyle(false),fill:{fgColor:{rgb:'FEE2E2'}},font:{color:{rgb:'DC2626'},bold:true,sz:10,name:'Arial'}
      }));

    // Блок «Выплата тренеру» убран: ЗП считается авто, выгрузка — exportGroupPayrollExcel

    const ws = buildSheet(rows);
    ws['!cols'] = [{wch:4},{wch:20},{wch:7},{wch:10},{wch:6},{wch:12},{wch:14},{wch:12},{wch:10},{wch:28}];
    // Уникальное имя листа: группа + фамилия тренера (Excel ограничение 31 символ)
    const lastName = (trainerFio||'').split(' ')[0] || '';
    const rawName  = `${groupName} ${lastName}`.replace(/[\\/:*?"<>|]/g,'').trim();
    let sheetName  = rawName.slice(0,31);
    // Если такое имя уже есть — добавляем счётчик
    let counter = 2;
    while (wb.SheetNames.includes(sheetName)) {
      sheetName = rawName.slice(0,28) + ` ${counter++}`;
    }
    XLSX.utils.book_append_sheet(wb, ws, sheetName);
  });

  XLSX.writeFile(wb, `Дет_ГП_${branch}_${monthLabel}.xlsx`);
}

// ─────────────────────────────────────────────
// ЗП ТРЕНЕРОВ ПО ГРУППЕ
// ─────────────────────────────────────────────
function exportGroupPayrollExcel(groupName, monthStr, totalRevenue, activeCount, pricePerChild, trainerRows, leaderName, leaderPct, leaderFee) {
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();
  const monthLabel = new Date(monthStr).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});
  const safeName = groupName.replace(/[\\/:*?"<>|]/g,'').slice(0,20);

  const rows = [];
  rows.push([tc(`Выплаты тренерам — ${groupName} — ${monthLabel}`, titleStyle())]);
  rows.push([]);
  rows.push([tc('База расчёта', hStyle().font ? hStyle() : {}),
             tc(`Оплаты за месяц: ${fmt(totalRevenue)} сум (в группе ${activeCount} детей)`,
                {font:{sz:12,name:'Arial',bold:false,color:{rgb:XL.TEXT_DARK}}})]);
  rows.push([]);
  // ЗП полностью авто: колонка «Утверждено» заменена на Авто/Премия/Штраф/К выплате
  rows.push(sr(['Тренер','Роль','Формула','Авто','Премия','Штраф','К выплате'], hStyle()));

  let grandTotal = 0;
  trainerRows.forEach((r,i)=>{
    const finalAmt = r.final !== undefined ? r.final : r.autoAmt;
    grandTotal += finalAmt;
    const rs = rStyle(i%2===0);
    const payStyle = {...rs, font:{...rs.font, bold:true, color:{rgb:XL.GREEN_DARK}}};
    rows.push([
      tc(r.fio, rs),
      tc(r.role, rs),
      tc(r.note, rs),
      mc(r.autoAmt, rs),
      mc(r.bonus||0, rs),
      mc(r.penalty||0, rs),
      mc(finalAmt, payStyle),
    ]);
  });

  if (leaderName) {
    const ls = rStyle(trainerRows.length%2===0);
    grandTotal += leaderFee;
    rows.push([
      tc(leaderName, ls),
      tc('Руководитель', ls),
      tc(`${leaderPct}% пула (+ остаток, если все ставочники)`, ls),
      mc(leaderFee, ls),
      tc('—', ls),
      tc('—', ls),
      mc(leaderFee, ls),
    ]);
  }

  rows.push([]);
  rows.push(sr(['ИТОГО к выплате:','','','','','', mc(grandTotal)], gStyle()));

  const ws = buildSheet(rows);
  ws['!cols'] = [{wch:22},{wch:14},{wch:44},{wch:14},{wch:10},{wch:10},{wch:14}];
  ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:6}}];
  XLSX.utils.book_append_sheet(wb, ws, 'ЗП тренерам');
  XLSX.writeFile(wb, `ЗП_${safeName}_${monthLabel}.xlsx`);
}
