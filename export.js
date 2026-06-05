// =============================================
// Excel Export — xlsx-js-style
// =============================================

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
function mc(v, s={}) { return { v: Number(v)||0,  t:'n', z:'# ##0', s }; } // деньги с пробелом

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

  const {workouts,duties,groupSessions,profiles,adjustments,groupPayouts,groupSubstitutions,ptSubstitutions,trialSessions:allTrials} = summaryData;
  const adjMap = {};
  (adjustments||[]).forEach(a => { adjMap[a.trainer_id] = a; });

  // Тренеры отфильтрованные и отсортированные
  const trainers = [...(profiles||[])].sort((a,b)=>a.fio.localeCompare(b.fio,'ru'));

  // Хелпер: день из ISO-строки
  const dayOf = s => new Date(s).getDate();

  // isChild по возрасту клиента
  const childAge = w => {
    const age = w.clients?.age;
    return typeof age==='number' && age <= CHILD_MAX_AGE;
  };

  // ═══════════════════════════════════════════
  // Лист 1: ВЕДОМОСТЬ
  // ═══════════════════════════════════════════
  const vRows = [];
  vRows.push([tc(`${branch} — З.П. Аква департамента — ${monthName}`, titleStyle())]);
  vRows.push([]);

  const vHeader = ['N','ФИО тренера','Деж.ч','Сумма деж.','Взр.ГП (сум)',
                   'ПТ (кол-во)','Сумма ПТ','Премия','Штраф','Итого','Система'];
  vRows.push(sr(vHeader, hStyle()));

  const vTotals = {dh:0,ds:0,gs:0,pt:0,ps:0,bon:0,pen:0,tot:0};
  let n=1;

  trainers.forEach((p,i) => {
    const pw  = (workouts||[]).filter(w=>w.trainer_id===p.id && (!w.is_debt||w.debt_confirmed_at));
    const pd  = (duties||[]).filter(d=>d.trainer_id===p.id);
    const pgs = (groupSessions||[]).filter(gs=>gs.trainer_id===p.id && gs.group_types?.billing_model==='headcount');
    const adj = adjMap[p.id]||null;
    const pts = (allTrials||[]).filter(t=>t.trainer_id===p.id);
    const sal = calcSalary({workouts:pw, duties:pd, groupSessions:pgs, adjustment:adj,
                             groupPayouts:(groupPayouts||[]), groupSubstitutions:(groupSubstitutions||[]),
                             ptSubstitutions:(ptSubstitutions||[]), trialSessions:pts, trainerId:p.id});
    const ptCount = sal.cat[1]+sal.cat[2]+sal.cat[3]+(sal.cat.dropIn1||0)+(sal.cat.dropIn2||0)+(sal.cat.dropIn3||0);
    const adultGP = sal.adultSum;

    const row = sr([
      n++, p.fio,
      +sal.hours.toFixed(2), mc(sal.dutySum),
      mc(adultGP),
      ptCount, mc(sal.ptSum+sal.dropInSum),
      mc(sal.bonus), mc(sal.penalty),
      mc(sal.total),
      '', // Система — пустая
    ], rStyle(i%2===0));
    vRows.push(row);

    vTotals.dh  += sal.hours;
    vTotals.ds  += sal.dutySum;
    vTotals.gs  += adultGP;
    vTotals.pt  += ptCount;
    vTotals.ps  += sal.ptSum+sal.dropInSum;
    vTotals.bon += sal.bonus;
    vTotals.pen += sal.penalty;
    vTotals.tot += sal.total;
  });

  vRows.push(sr([
    '','ИТОГО:',
    +vTotals.dh.toFixed(2), mc(vTotals.ds),
    mc(vTotals.gs),
    vTotals.pt, mc(vTotals.ps),
    mc(vTotals.bon), mc(vTotals.pen),
    mc(vTotals.tot), '',
  ], gStyle()));

  const wsV = buildSheet(vRows);
  wsV['!cols'] = [{wch:4},{wch:24},{wch:8},{wch:14},{wch:14},{wch:10},{wch:14},{wch:10},{wch:10},{wch:14},{wch:12}];
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
    const pw = (workouts||[]).filter(w=>w.trainer_id===p.id && (!w.is_debt||w.debt_confirmed_at));
    const pd = (duties||[]).filter(d=>d.trainer_id===p.id);
    const adj = adjMap[p.id]||null;

    // Группируем тренировки по дням
    const byDay = {};
    pw.forEach(w => {
      const day = dayOf(w.workout_date);
      if (!byDay[day]) byDay[day] = {c1:0,c2:0,c3:0,v1:0,v2:0,v3:0,r1:0,r2:0,r3:0};
      const cat = w.category_at_moment;
      const isAdult = !childAge(w);
      if (w.is_drop_in) {
        const dc = w.drop_in_category||1;
        byDay[day][`r${dc}`]++;
      } else if (isAdult) {
        byDay[day][`v${cat}`]++;
      } else {
        byDay[day][`c${cat}`]++;
      }
    });

    // Дежурства по дням
    const dutyByDay = {};
    pd.forEach(d => {
      const day = dayOf(d.start_time);
      dutyByDay[day] = (dutyByDay[day]||0) + (new Date(d.end_time)-new Date(d.start_time))/3600000;
    });

    const rows = [];

    // Заголовок
    rows.push([tc(`${p.fio} — ${monthName}`, titleStyle())]);
    rows.push([]);

    // Шапка таблицы
    rows.push(sr(['Число','1кат','2кат','3кат','1катВ','2катВ','3катВ',
                   'Разов.1к','Разов.2к','Разов.3к','Деж.(ч)'], hStyle()));

    // Дни 31 → 1
    let tot = {c1:0,c2:0,c3:0,v1:0,v2:0,v3:0,r1:0,r2:0,r3:0,dh:0};
    for (let day=daysInMonth; day>=1; day--) {
      const b  = byDay[day]||{c1:0,c2:0,c3:0,v1:0,v2:0,v3:0,r1:0,r2:0,r3:0};
      const dh = dutyByDay[day]||0;
      const even = (daysInMonth-day) % 2 === 0;
      rows.push(sr([
        day,
        b.c1||0, b.c2||0, b.c3||0,
        b.v1||0, b.v2||0, b.v3||0,
        b.r1||0, b.r2||0, b.r3||0,
        dh ? +dh.toFixed(2) : 0,
      ], rStyle(even)));
      ['c1','c2','c3','v1','v2','v3','r1','r2','r3'].forEach(k=>{tot[k]+=b[k];});
      tot.dh += dh;
    }

    // Строка итого
    rows.push(sr(['Итого:',
      tot.c1,tot.c2,tot.c3,
      tot.v1,tot.v2,tot.v3,
      tot.r1,tot.r2,tot.r3,
      +tot.dh.toFixed(2),
    ], tStyle()));
    rows.push([]);

    // ── Расчёт ЗП ──
    const pgs = (groupSessions||[]).filter(gs=>gs.trainer_id===p.id && gs.group_types?.billing_model==='headcount');
    const pts = (allTrials||[]).filter(t=>t.trainer_id===p.id);
    const sal = calcSalary({workouts:pw, duties:pd, groupSessions:pgs, adjustment:adj,
                             groupPayouts:(groupPayouts||[]), groupSubstitutions:(groupSubstitutions||[]),
                             ptSubstitutions:(ptSubstitutions||[]), trialSessions:pts, trainerId:p.id});

    rows.push(sr(['── Расчёт зарплаты ──'], hStyle(XL.BLUE_DARK)));

    const salLines = [
      ['ПТ кат.1 (дети)',   tot.c1, mc(RATES.pt[1]), mc(tot.c1*RATES.pt[1])],
      ['ПТ кат.2 (дети)',   tot.c2, mc(RATES.pt[2]), mc(tot.c2*RATES.pt[2])],
      ['ПТ кат.3 (дети)',   tot.c3, mc(RATES.pt[3]), mc(tot.c3*RATES.pt[3])],
      ['ПТ кат.1В (взрослые)',tot.v1,mc(RATES.pt[1]),mc(tot.v1*RATES.pt[1])],
      ['ПТ кат.2В (взрослые)',tot.v2,mc(RATES.pt[2]),mc(tot.v2*RATES.pt[2])],
      ['ПТ кат.3В (взрослые)',tot.v3,mc(RATES.pt[3]),mc(tot.v3*RATES.pt[3])],
      ['Разовые 1кт',       tot.r1, mc(RATES.pt[1]), mc(tot.r1*RATES.pt[1])],
      ['Разовые 2кт',       tot.r2, mc(RATES.pt[2]), mc(tot.r2*RATES.pt[2])],
      ['Разовые 3кт',       tot.r3, mc(RATES.pt[3]), mc(tot.r3*RATES.pt[3])],
      ['Дежурство',         +tot.dh.toFixed(2), mc(RATES.duty_per_hour), mc(sal.dutySum)],
    ];
    if (sal.adultSum)  salLines.push(['Взрослые ГП','','',mc(sal.adultSum)]);
    if (sal.bonus)     salLines.push(['Премия',     '','',mc(sal.bonus)]);
    if (sal.penalty)   salLines.push(['Штраф',      '','',mc(-sal.penalty)]);

    salLines.forEach((r,i) => rows.push(sr(r, rStyle(i%2===0))));
    rows.push(sr(['ИТОГО К ВЫПЛАТЕ','','',mc(sal.total)], gStyle()));

    // Лист
    const sheetName = `${pi+1} ${p.fio.split(' ')[0]}`; // "1 Иванов"
    const ws = buildSheet(rows);
    ws['!cols'] = [{wch:12},{wch:6},{wch:6},{wch:6},{wch:7},{wch:7},{wch:7},
                   {wch:9},{wch:9},{wch:9},{wch:8},{wch:16}];
    XLSX.utils.book_append_sheet(wb, ws, sheetName.slice(0,31));
  });

  XLSX.writeFile(wb, `ЗП_${branch}_${monthName}.xlsx`);
}

// ─────────────────────────────────────────────
// ЭКСПОРТ ИНДИВИДУАЛЬНОГО ОТЧЁТА ТРЕНЕРА
// ─────────────────────────────────────────────
function exportTrainerExcel(trainerFio, year, month, workouts, duties, groupSessions, adjustment) {
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();
  const daysInMonth = new Date(year, month, 0).getDate();
  const monthName   = new Date(year, month-1).toLocaleDateString('ru-RU', {month:'long',year:'numeric'});

  const byDay = {};
  workouts.forEach(w => {
    const day = new Date(w.workout_date).getDate();
    if (!byDay[day]) byDay[day]={c1:0,c2:0,c3:0,v1:0,v2:0,v3:0,r1:0,r2:0,r3:0};
    const cat = w.category_at_moment;
    const age = w.clients?.age;
    const isAdult = typeof age==='number' && age > CHILD_MAX_AGE;
    if (w.is_drop_in) {
      const dc = w.drop_in_category||1;
      byDay[day][`r${dc}`]++;
    } else if (isAdult) {
      byDay[day][`v${cat}`]++;
    } else {
      byDay[day][`c${cat}`]++;
    }
  });
  const dutyByDay = {};
  duties.forEach(d => {
    const day = new Date(d.start_time).getDate();
    dutyByDay[day] = (dutyByDay[day]||0)+(new Date(d.end_time)-new Date(d.start_time))/3600000;
  });

  const rows = [];
  rows.push([tc(`${trainerFio} — ${monthName}`, titleStyle())]);
  rows.push([]);
  rows.push(sr(['Число','1кат','2кат','3кат','1катВ','2катВ','3катВ',
                 'Разов.1к','Разов.2к','Разов.3к','Деж.(ч)'], hStyle()));

  let tot={c1:0,c2:0,c3:0,v1:0,v2:0,v3:0,r1:0,r2:0,r3:0,dh:0};
  for (let day=daysInMonth; day>=1; day--) {
    const b  = byDay[day]||{c1:0,c2:0,c3:0,v1:0,v2:0,v3:0,r1:0,r2:0,r3:0};
    const dh = dutyByDay[day]||0;
    rows.push(sr([day,b.c1||0,b.c2||0,b.c3||0,b.v1||0,b.v2||0,b.v3||0,
                  b.r1||0,b.r2||0,b.r3||0,dh?+dh.toFixed(2):0], rStyle((daysInMonth-day)%2===0)));
    ['c1','c2','c3','v1','v2','v3','r1','r2','r3'].forEach(k=>{tot[k]+=b[k];});
    tot.dh+=dh;
  }

  rows.push(sr(['Итого:',tot.c1,tot.c2,tot.c3,tot.v1,tot.v2,tot.v3,
                tot.r1,tot.r2,tot.r3,+tot.dh.toFixed(2)], tStyle()));
  rows.push([]);

  const pgs = (groupSessions||[]).filter(gs=>gs.group_types?.billing_model==='headcount');
  const sal = calcSalary({workouts,duties,groupSessions:pgs,adjustment});

  rows.push(sr(['── Расчёт зарплаты ──'], hStyle(XL.BLUE_DARK)));
  const salLines = [
    ['ПТ кат.1 (дети)',     tot.c1,mc(RATES.pt[1]),mc(tot.c1*RATES.pt[1])],
    ['ПТ кат.2 (дети)',     tot.c2,mc(RATES.pt[2]),mc(tot.c2*RATES.pt[2])],
    ['ПТ кат.3 (дети)',     tot.c3,mc(RATES.pt[3]),mc(tot.c3*RATES.pt[3])],
    ['ПТ кат.1В (взрослые)',tot.v1,mc(RATES.pt[1]),mc(tot.v1*RATES.pt[1])],
    ['ПТ кат.2В (взрослые)',tot.v2,mc(RATES.pt[2]),mc(tot.v2*RATES.pt[2])],
    ['ПТ кат.3В (взрослые)',tot.v3,mc(RATES.pt[3]),mc(tot.v3*RATES.pt[3])],
    ['Разовые 1кт',         tot.r1,mc(RATES.pt[1]),mc(tot.r1*RATES.pt[1])],
    ['Разовые 2кт',         tot.r2,mc(RATES.pt[2]),mc(tot.r2*RATES.pt[2])],
    ['Разовые 3кт',         tot.r3,mc(RATES.pt[3]),mc(tot.r3*RATES.pt[3])],
    ['Дежурство',           +tot.dh.toFixed(2),mc(RATES.duty_per_hour),mc(sal.dutySum)],
  ];
  if (sal.adultSum) salLines.push(['Взрослые ГП','','',mc(sal.adultSum)]);
  if (sal.bonus)    salLines.push(['Премия','','',mc(sal.bonus)]);
  if (sal.penalty)  salLines.push(['Штраф','','',mc(-sal.penalty)]);
  salLines.forEach((r,i)=>rows.push(sr(r,rStyle(i%2===0))));
  rows.push(sr(['ИТОГО К ВЫПЛАТЕ','','',mc(sal.total)],gStyle()));

  const ws = buildSheet(rows);
  ws['!cols']=[{wch:12},{wch:6},{wch:6},{wch:6},{wch:7},{wch:7},{wch:7},
               {wch:9},{wch:9},{wch:9},{wch:8},{wch:16}];
  XLSX.utils.book_append_sheet(wb,ws,'По дням');
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
  const totalPaid   = payments.filter(p=>p.paid).reduce((s,p)=>s+Number(p.amount||0),0);
  const totalUnpaid = payments.filter(p=>!p.paid).reduce((s,p)=>s+Number(p.amount||0),0);

  // ── Лист: Ведомость группы ──
  const rows = [];

  // Заголовок
  rows.push([tc(`${groupName} — ${branch} — ${monthLabel}`, titleStyle())]);
  rows.push([tc(`Тренер: ${trainerFio}`, {font:{sz:11,name:'Arial',color:{rgb:XL.TEXT_DARK}}})]);
  rows.push([tc(`Занятий в месяце: ${sessionDates.length}`, {font:{sz:11,name:'Arial',color:{rgb:XL.TEXT_DARK}}})]);
  rows.push([]);

  // Шапка таблицы
  rows.push(sr(
    ['N','Имя ребёнка','Возраст','Посещаемость','% явки','Сумма','Оплачено','Дата оплаты','Долг','Прогресс / заметка'],
    hStyle()
  ));

  // Строки детей
  activeClients.forEach((c,i) => {
    const pay   = payMap[c.id];
    const note  = noteMap[c.id];
    const att   = attByClient[c.id]||0;
    const pct   = sessionDates.length ? Math.round(att/sessionDates.length*100) : 0;
    const isPaid = pay?.paid || false;
    const amount = pay?.amount ? Number(pay.amount) : 0;
    const debt   = isPaid ? 0 : amount;

    const rs = rStyle(i%2===0);
    const paidStyle = isPaid
      ? {...rs, font:{...rs.font, color:{rgb:XL.GREEN_DARK}}}
      : {...rs, font:{...rs.font, color:{rgb:'DC2626'}}};

    rows.push([
      tc(i+1, rs),
      tc(c.name||'—', rs),
      tc(c.age||'—', rs),
      tc(`${att}/${sessionDates.length}`, rs),
      {v:pct, t:'n', z:'0"%"', s:rs},
      mc(amount, rs),
      tc(isPaid?'✅ Оплачено':'❌ Не оплачено', paidStyle),
      tc(pay?.paid_at ? new Date(pay.paid_at).toLocaleDateString('ru-RU') : '—', rs),
      mc(debt, {...rs, font:{...rs.font, color:{rgb:debt>0?'DC2626':XL.TEXT_DARK}}}),
      tc(note?.note||'—', rs),
    ]);
  });

  rows.push([]);

  // Итоговые строки
  rows.push(sr(['','ИТОГО:','',`${activeClients.length} детей`,'','','','','',''], tStyle()));
  rows.push(sr(['','Оплачено:','','','','','','','',`${payments.filter(p=>p.paid).length} чел.`], {
    ...rStyle(false), font:{...rStyle(false).font, color:{rgb:XL.GREEN_DARK}, bold:true}
  }));
  rows.push(sr(['','Не оплатили:','','','','','','','',`${activeClients.length-payments.filter(p=>p.paid).length} чел.`], {
    ...rStyle(true), font:{...rStyle(true).font, color:{rgb:'DC2626'}, bold:true}
  }));
  rows.push(sr(['','Сумма оплат:','','','', mc(totalPaid),'','','',''], gStyle()));
  if (totalUnpaid > 0)
    rows.push(sr(['','Задолженность:','','','', mc(totalUnpaid),'','','',''], {
      ...rStyle(false), fill:{fgColor:{rgb:'FEE2E2'}}, font:{color:{rgb:'DC2626'},bold:true,sz:10,name:'Arial'}
    }));

  rows.push([]);

  // Блок выплат тренеру
  if (payouts?.length) {
    rows.push(sr(['── Выплата тренеру ──'], hStyle(XL.BLUE_DARK)));
    payouts.forEach((p,i) => {
      const typeLabel = p.payout_type==='fixed'?'Фиксированная':'Процент';
      rows.push(sr([trainerFio, typeLabel, p.payout_type==='fixed'?mc(p.payout_value):`${p.payout_value}%`, '', '', mc(p.payout_value),'','','',''], rStyle(i%2===0)));
    });
  }

  const ws = buildSheet(rows);
  ws['!cols'] = [{wch:4},{wch:22},{wch:8},{wch:12},{wch:8},{wch:14},{wch:14},{wch:14},{wch:12},{wch:30}];

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
function exportBranchChildGroupsExcel(branch, monthStr, groupReports) {
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

    if (payouts?.length) {
      rows.push([]);
      rows.push(sr(['── Выплата тренеру ──'], hStyle(XL.BLUE_DARK)));
      payouts.forEach((p,i)=>{
        rows.push(sr([trainerFio, p.payout_type==='fixed'?'Фикс.':'Процент',
          mc(p.payout_value),'','','','','','',''], rStyle(i%2===0)));
      });
    }

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
             tc(`${activeCount} детей × ${fmt(pricePerChild)} сум = ${fmt(totalRevenue)} сум`,
                {font:{sz:12,name:'Arial',bold:false,color:{rgb:XL.TEXT_DARK}}})]);
  rows.push([]);
  rows.push(sr(['Тренер','Роль','Формула','К выплате','Утверждено','Статус'], hStyle()));

  let grandTotal = 0;
  trainerRows.forEach((r,i)=>{
    const toPayAmt = r.approved !== null ? r.approved : r.autoAmt;
    grandTotal += toPayAmt;
    const status = r.approved !== null ? '✅ Утверждено' : '⏳ Авто';
    const rs = rStyle(i%2===0);
    const payStyle = {...rs, font:{...rs.font, bold:true, color:{rgb:XL.GREEN_DARK}}};
    rows.push([
      tc(r.fio, rs),
      tc(r.role, rs),
      tc(r.note, rs),
      mc(r.autoAmt, rs),
      r.approved !== null ? mc(r.approved, payStyle) : tc('—', rs),
      tc(status, rs),
    ]);
  });

  if (leaderName) {
    const ls = rStyle(trainerRows.length%2===0);
    grandTotal += leaderFee;
    rows.push([
      tc(leaderName, ls),
      tc('Руководитель', ls),
      tc(`${leaderPct}% от выручки`, ls),
      mc(leaderFee, ls),
      tc('—', ls),
      tc('ℹ️ Отдельно', ls),
    ]);
  }

  rows.push([]);
  rows.push(sr(['ИТОГО к выплате:','','', mc(grandTotal),'',''], gStyle()));

  const ws = buildSheet(rows);
  ws['!cols'] = [{wch:22},{wch:14},{wch:30},{wch:14},{wch:14},{wch:14}];
  ws['!merges'] = [{s:{r:0,c:0},e:{r:0,c:5}}];
  XLSX.utils.book_append_sheet(wb, ws, 'ЗП тренерам');
  XLSX.writeFile(wb, `ЗП_${safeName}_${monthLabel}.xlsx`);
}
