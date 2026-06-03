// =============================================
// Excel Export — xlsx-js-style (цвета + данные)
// =============================================

// ── Палитра цветов ──
const XL = {
  BLUE_DARK:  '1E3A5F',  // шапки разделов
  BLUE_MID:   '2D6A9F',  // строка итого
  BLUE_LIGHT: 'DCE9F5',  // чётные строки
  GOLD:       'F59E0B',  // финальный итог
  GOLD_LIGHT: 'FEF3C7',
  GREEN:      '065F46',
  GREEN_LIGHT:'D1FAE5',
  RED_LIGHT:  'FEE2E2',
  WHITE:      'FFFFFF',
  GRAY:       'F3F4F6',
  TEXT_DARK:  '1F2937',
  TEXT_WHITE: 'FFFFFF',
};

// Ячейка с числом
function nc(v, s={}) {
  return { v: Number(v)||0, t:'n', s };
}
// Ячейка с текстом
function tc(v, s={}) {
  return { v: String(v??''), t:'s', s };
}

// Стиль шапки раздела
function headerStyle(bg=XL.BLUE_DARK) {
  return {
    fill: { fgColor: { rgb: bg } },
    font: { color: { rgb: XL.TEXT_WHITE }, bold: true, sz: 10 },
    alignment: { horizontal: 'center', vertical: 'center', wrapText: true },
    border: thinBorder(),
  };
}
// Стиль строки с данными (чётная/нечётная)
function rowStyle(even=false) {
  return {
    fill: { fgColor: { rgb: even ? XL.BLUE_LIGHT : XL.WHITE } },
    font: { color: { rgb: XL.TEXT_DARK }, sz: 10 },
    alignment: { vertical: 'center' },
    border: thinBorder(),
  };
}
// Стиль строки итогов
function totalStyle() {
  return {
    fill: { fgColor: { rgb: XL.BLUE_MID } },
    font: { color: { rgb: XL.TEXT_WHITE }, bold: true, sz: 10 },
    alignment: { vertical: 'center' },
    border: thinBorder(),
  };
}
// Стиль строки ИТОГО К ВЫПЛАТЕ
function grandTotalStyle() {
  return {
    fill: { fgColor: { rgb: XL.GOLD } },
    font: { color: { rgb: XL.TEXT_DARK }, bold: true, sz: 11 },
    alignment: { vertical: 'center' },
    border: thinBorder(),
  };
}
function thinBorder() {
  const s = { style: 'thin', color: { rgb: 'CBD5E1' } };
  return { top:s, bottom:s, left:s, right:s };
}

// Применить стиль к строке ячеек (массив с автоотступом)
function styledRow(cells, style) {
  return cells.map(c => {
    if (c && typeof c === 'object' && 't' in c) return {...c, s: {...c.s, ...style, fill: style.fill, font: style.font, border: style.border }};
    const isNum = typeof c === 'number';
    return { v: c??'', t: isNum?'n':'s', s: style };
  });
}

// Собрать Sheet из массива строк-объектов
function buildSheet(rowsData) {
  const ws = {};
  let maxCol = 0;
  rowsData.forEach((row, r) => {
    maxCol = Math.max(maxCol, row.length);
    row.forEach((cell, c) => {
      const addr = XLSX.utils.encode_cell({r, c});
      if (cell === null || cell === undefined) {
        ws[addr] = { v: '', t: 's' };
      } else if (typeof cell === 'object' && 't' in cell) {
        ws[addr] = cell;
      } else {
        ws[addr] = { v: cell, t: typeof cell === 'number' ? 'n' : 's' };
      }
    });
  });
  ws['!ref'] = XLSX.utils.encode_range({ s:{r:0,c:0}, e:{r:rowsData.length-1,c:maxCol-1} });
  return ws;
}

// ─────────────────────────────────────────────
// Экспорт индивидуального отчёта тренера
// ─────────────────────────────────────────────
function exportTrainerExcel(trainerFio, year, month, workouts, duties, groupSessions, adjustment) {
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthName   = new Date(year, month-1).toLocaleDateString('ru-RU', {month:'long', year:'numeric'});

  // Считаем по дням
  const byDay = {};
  workouts.forEach(w => {
    const day = new Date(w.workout_date).getDate();
    if (!byDay[day]) byDay[day] = {1:0, 2:0, 3:0, di1:0, di2:0, di3:0};
    if (w.is_drop_in) {
      const dc = w.drop_in_category||1;
      byDay[day][`di${dc}`]++;
    } else if (!w.is_debt || w.debt_confirmed_at) {
      byDay[day][w.category_at_moment]++;
    }
  });
  const dutyByDay = {};
  duties.forEach(d => {
    const day = new Date(d.start_time).getDate();
    dutyByDay[day] = (dutyByDay[day]||0) + (new Date(d.end_time)-new Date(d.start_time))/3600000;
  });

  let tot1=0, tot2=0, tot3=0, totDI1=0, totDI2=0, totDI3=0, totH=0;
  for (let d=1; d<=daysInMonth; d++) {
    const b = byDay[d]||{1:0,2:0,3:0,di1:0,di2:0,di3:0};
    tot1+=b[1]; tot2+=b[2]; tot3+=b[3];
    totDI1+=b.di1; totDI2+=b.di2; totDI3+=b.di3;
    totH+=(dutyByDay[d]||0);
  }
  const totDI = totDI1+totDI2+totDI3;

  // ── Шапка таблицы ──
  const H = headerStyle();
  const rows = [];

  // Название
  rows.push([tc(`${trainerFio} — ${monthName}`, {
    font: {bold:true, sz:13, color:{rgb:XL.BLUE_DARK}},
    alignment: {horizontal:'left'},
  })]);
  rows.push([]); // пустая

  // Заголовки
  rows.push(styledRow(
    ['Число','1 кат','2 кат','3 кат','Разовые (1к)','Разовые (2к)','Разовые (3к)','Деж. (ч)'],
    headerStyle()
  ));

  // Строки по дням
  for (let day=1; day<=daysInMonth; day++) {
    const b  = byDay[day]||{1:0,2:0,3:0,di1:0,di2:0,di3:0};
    const dh = dutyByDay[day]||0;
    const even = day % 2 === 0;
    const rs = rowStyle(even);
    rows.push(styledRow(
      [day, b[1]||0, b[2]||0, b[3]||0, b.di1||0, b.di2||0, b.di3||0, dh ? +dh.toFixed(2) : 0],
      rs
    ));
  }

  // Итого по колонкам
  rows.push(styledRow(
    ['Итого:', tot1, tot2, tot3, totDI1, totDI2, totDI3, +totH.toFixed(2)],
    totalStyle()
  ));
  rows.push([]);

  // ── Расчёт ЗП ──
  const sal = calcSalary({workouts, duties, groupSessions, adjustment});

  rows.push(styledRow(['── Расчёт зарплаты ──'], headerStyle(XL.BLUE_DARK)));

  const salRows = [
    ['ПТ кат.1',   tot1,           RATES.pt[1],            tot1*RATES.pt[1]],
    ['ПТ кат.2',   tot2,           RATES.pt[2],            tot2*RATES.pt[2]],
    ['ПТ кат.3',   tot3,           RATES.pt[3],            tot3*RATES.pt[3]],
    ['Разовые 1кт',totDI1,         RATES.pt[1],            totDI1*RATES.pt[1]],
    ['Разовые 2кт',totDI2,         RATES.pt[2],            totDI2*RATES.pt[2]],
    ['Разовые 3кт',totDI3,         RATES.pt[3],            totDI3*RATES.pt[3]],
    ['Дежурство',  +totH.toFixed(2),RATES.duty_per_hour,   sal.dutySum],
  ];
  if (sal.childSum)  salRows.push(['Детские группы','','',sal.childSum]);
  if (sal.adultSum)  salRows.push(['Взрослые группы','','',sal.adultSum]);
  if (sal.bonus)     salRows.push(['Премия','','',sal.bonus]);
  if (sal.penalty)   salRows.push(['Штраф','','',-sal.penalty]);

  salRows.forEach((r, i) => {
    rows.push(styledRow(r, rowStyle(i%2===0)));
  });

  // Финальный итог
  rows.push(styledRow(['ИТОГО К ВЫПЛАТЕ', '', '', sal.total], grandTotalStyle()));

  const ws = buildSheet(rows);
  ws['!cols'] = [{wch:14},{wch:8},{wch:8},{wch:8},{wch:12},{wch:12},{wch:12},{wch:10},{wch:16}];
  ws['!rows'] = [{hpt:20}, {hpt:6}, {hpt:22}]; // высота первых строк

  XLSX.utils.book_append_sheet(wb, ws, 'По дням');
  XLSX.writeFile(wb, `ЗП_${trainerFio.split(' ')[0]}_${monthName}.xlsx`);
}

// ─────────────────────────────────────────────
// Экспорт сводного отчёта (все тренеры за месяц)
// ─────────────────────────────────────────────
function exportSummaryExcel(year, month, summaryData) {
  const XLSX      = window.XLSX;
  const wb        = XLSX.utils.book_new();
  const monthName = new Date(year,month-1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});

  const {workouts,duties,trainerGroups,groupSessions,profiles,adjustments} = summaryData;
  const adjMap = {};
  (adjustments||[]).forEach(a => { adjMap[a.trainer_id] = a; });

  const rows = [];

  // Заголовок
  rows.push([tc(`Зарплата — Аква Департамент — ${monthName}`, {
    font: {bold:true, sz:13, color:{rgb:XL.BLUE_DARK}},
  })]);
  rows.push([]);

  // Шапка таблицы
  rows.push(styledRow([
    'N','ФИО тренера',
    'Деж.ч','Сумма деж.',
    'Группы (сум)',
    'ПТ кат.1','ПТ кат.2','ПТ кат.3','Разовые',
    'Сумма ПТ',
    'Премия','Штраф',
    'ИТОГО',
  ], headerStyle()));

  const totals = {dh:0,ds:0,gs:0,p1:0,p2:0,p3:0,di:0,ps:0,bon:0,pen:0,tot:0};
  let n = 1;

  const trainerRows = (profiles||[]).map(p => {
    const pw  = (workouts||[]).filter(w=>w.trainer_id===p.id);
    const pd  = (duties||[]).filter(d=>d.trainer_id===p.id);
    const ptg = (trainerGroups||[]).filter(tg=>tg.trainer_id===p.id);
    const pgs = (groupSessions||[]).filter(gs=>gs.trainer_id===p.id);
    const adj = adjMap[p.id]||null;
    const sal = calcSalary({workouts:pw,duties:pd,trainerGroups:ptg,groupSessions:pgs,adjustment:adj});
    return {profile:p, sal};
  }).filter(r => {
    const s = r.sal;
    return s.cat[1]+s.cat[2]+s.cat[3]+s.hours+s.cat.dropIn1+s.cat.dropIn2+s.cat.dropIn3 > 0;
  });

  trainerRows.forEach(({profile:p, sal}, i) => {
    const totDI = (sal.cat.dropIn1||0)+(sal.cat.dropIn2||0)+(sal.cat.dropIn3||0);
    rows.push(styledRow([
      n++, p.fio,
      +sal.hours.toFixed(2), sal.dutySum,
      sal.childSum + sal.adultSum,
      sal.cat[1], sal.cat[2], sal.cat[3], totDI,
      sal.ptSum + sal.dropInSum,
      sal.bonus, sal.penalty,
      sal.total,
    ], rowStyle(i%2===0)));

    totals.dh  += sal.hours;
    totals.ds  += sal.dutySum;
    totals.gs  += sal.childSum + sal.adultSum;
    totals.p1  += sal.cat[1];
    totals.p2  += sal.cat[2];
    totals.p3  += sal.cat[3];
    totals.di  += totDI;
    totals.ps  += sal.ptSum + sal.dropInSum;
    totals.bon += sal.bonus;
    totals.pen += sal.penalty;
    totals.tot += sal.total;
  });

  // Строка итогов
  rows.push(styledRow([
    '', 'ИТОГО:',
    +totals.dh.toFixed(2), totals.ds,
    totals.gs,
    totals.p1, totals.p2, totals.p3, totals.di,
    totals.ps,
    totals.bon, totals.pen,
    totals.tot,
  ], grandTotalStyle()));

  const ws = buildSheet(rows);
  ws['!cols'] = [
    {wch:4},{wch:24},{wch:8},{wch:14},{wch:14},
    {wch:9},{wch:9},{wch:9},{wch:9},{wch:14},
    {wch:10},{wch:10},{wch:16},
  ];

  XLSX.utils.book_append_sheet(wb, ws, 'Сводка');
  XLSX.writeFile(wb, `ЗП_Аква_${monthName}.xlsx`);
}
