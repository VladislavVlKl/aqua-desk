// =============================================
// Excel Export — SheetJS
// =============================================

/**
 * Экспорт индивидуального отчёта тренера
 * Формат: лист с днями (строки) × категориями (столбцы)
 */
function exportTrainerExcel(trainerFio, year, month, workouts, duties, groupSessions, adjustment) {
  const XLSX = window.XLSX;
  const wb   = XLSX.utils.book_new();

  const daysInMonth = new Date(year, month, 0).getDate();
  const monthName   = new Date(year, month-1).toLocaleDateString('ru-RU', {month:'long', year:'numeric'});

  // ── Лист 1: По дням ──
  const rows = [];
  rows.push([trainerFio]);
  rows.push([]);
  rows.push(['Число', '1 кат', '2 кат', '3 кат', 'Разовые', 'Деж. (ч)']);

  const byDay = {};
  workouts.forEach(w => {
    const day = new Date(w.workout_date).getDate();
    if (!byDay[day]) byDay[day] = {1:0, 2:0, 3:0, dropIn:0};
    if (w.is_drop_in)            byDay[day].dropIn++;
    else if (!w.is_debt || w.debt_confirmed_at) byDay[day][w.category_at_moment]++;
  });
  const dutyByDay = {};
  duties.forEach(d => {
    const day = new Date(d.start_time).getDate();
    dutyByDay[day] = (dutyByDay[day]||0) + (new Date(d.end_time)-new Date(d.start_time))/3600000;
  });

  let tot1=0, tot2=0, tot3=0, totDI=0, totH=0;
  for (let day = 1; day <= daysInMonth; day++) {
    const d  = byDay[day]    || {1:0,2:0,3:0,dropIn:0};
    const dh = dutyByDay[day]|| 0;
    tot1+=d[1]; tot2+=d[2]; tot3+=d[3]; totDI+=d.dropIn; totH+=dh;
    rows.push([
      day,
      d[1]||'', d[2]||'', d[3]||'', d.dropIn||'',
      dh ? dh.toFixed(2) : '',
    ]);
  }

  rows.push([]);
  rows.push(['Сумма ПТ', tot1, tot2, tot3, totDI, totH.toFixed(2)]);
  rows.push([]);

  // Расчёт ЗП
  const sal = calcSalary({workouts, duties, groupSessions, adjustment});
  rows.push(['── Расчёт ЗП ──']);
  rows.push(['ПТ кат.1', tot1, `× ${fmt(RATES.pt[1])}`, '=', fmt(tot1*RATES.pt[1])]);
  rows.push(['ПТ кат.2', tot2, `× ${fmt(RATES.pt[2])}`, '=', fmt(tot2*RATES.pt[2])]);
  rows.push(['ПТ кат.3', tot3, `× ${fmt(RATES.pt[3])}`, '=', fmt(tot3*RATES.pt[3])]);
  rows.push(['Разовые',  totDI,`× ${fmt(RATES.drop_in_trainer)}`, '=', fmt(totDI*RATES.drop_in_trainer)]);
  rows.push(['Дежурство',totH.toFixed(2), `× ${fmt(RATES.duty_per_hour)}/ч`, '=', fmt(sal.dutySum)]);
  if (sal.childSum)  rows.push(['Детские группы','','','', fmt(sal.childSum)]);
  if (sal.adultSum)  rows.push(['Взрослые группы','','','',fmt(sal.adultSum)]);
  if (sal.bonus)     rows.push(['Премия',   '','','', fmt(sal.bonus)]);
  if (sal.penalty)   rows.push(['Штраф',    '','','', `−${fmt(sal.penalty)}`]);
  rows.push(['ИТОГО К ВЫПЛАТЕ','','','', fmt(sal.total)]);

  const ws = XLSX.utils.aoa_to_sheet(rows);

  // Ширина столбцов
  ws['!cols'] = [{wch:10},{wch:8},{wch:8},{wch:8},{wch:10},{wch:10},{wch:20}];

  // Стиль заголовка (только в xlsx — базовая поддержка)
  XLSX.utils.book_append_sheet(wb, ws, 'По дням');
  XLSX.writeFile(wb, `ЗП_${trainerFio.split(' ')[0]}_${monthName}.xlsx`);
}

/**
 * Экспорт сводного отчёта (все тренеры за месяц)
 * Формат: строка = тренер, столбцы = категории + итого
 */
function exportSummaryExcel(year, month, summaryData) {
  const XLSX     = window.XLSX;
  const wb       = XLSX.utils.book_new();
  const monthName = new Date(year,month-1).toLocaleDateString('ru-RU',{month:'long',year:'numeric'});

  const {workouts,duties,trainerGroups,groupSessions,profiles,adjustments} = summaryData;
  const adjMap = {};
  (adjustments||[]).forEach(a => { adjMap[a.trainer_id] = a; });

  // ── Шапка ──
  const rows = [];
  rows.push([`З.П. Аква департамента за ${monthName}`]);
  rows.push([]);
  rows.push([
    'N','ФИО',
    'Деж.часы','Сумма деж.',
    'Гр. (сум)',
    'ПТ кат.1','ПТ кат.2','ПТ кат.3','Разовые','Сумма ПТ',
    'Премия','Штрафы',
    'ИТОГО',
  ]);

  let n = 1;
  const totals = {dh:0, ds:0, gs:0, p1:0, p2:0, p3:0, di:0, ps:0, bon:0, pen:0, tot:0};

  const trainerRows = profiles.map(p => {
    const pw  = workouts.filter(w=>w.trainer_id===p.id);
    const pd  = duties.filter(d=>d.trainer_id===p.id);
    const ptg = trainerGroups.filter(tg=>tg.trainer_id===p.id);
    const pgs = groupSessions.filter(gs=>gs.trainer_id===p.id);
    const adj = adjMap[p.id]||null;
    const sal = calcSalary({workouts:pw,duties:pd,trainerGroups:ptg,groupSessions:pgs,adjustment:adj});
    return {profile:p, sal};
  }).filter(r => r.sal.cat[1]+r.sal.cat[2]+r.sal.cat[3]+r.sal.hours+r.sal.cat.dropIn > 0);

  trainerRows.forEach(({profile:p, sal}) => {
    rows.push([
      n++, p.fio,
      sal.hours.toFixed(2), sal.dutySum,
      sal.childSum + sal.adultSum,
      sal.cat[1], sal.cat[2], sal.cat[3], sal.cat.dropIn,
      sal.ptSum + sal.dropInSum,
      sal.bonus, sal.penalty,
      sal.total,
    ]);
    totals.dh  += sal.hours;
    totals.ds  += sal.dutySum;
    totals.gs  += sal.childSum + sal.adultSum;
    totals.p1  += sal.cat[1];
    totals.p2  += sal.cat[2];
    totals.p3  += sal.cat[3];
    totals.di  += sal.cat.dropIn;
    totals.ps  += sal.ptSum + sal.dropInSum;
    totals.bon += sal.bonus;
    totals.pen += sal.penalty;
    totals.tot += sal.total;
  });

  rows.push([]);
  rows.push([
    '', 'ИТОГО:',
    totals.dh.toFixed(2), totals.ds,
    totals.gs,
    totals.p1, totals.p2, totals.p3, totals.di, totals.ps,
    totals.bon, totals.pen,
    totals.tot,
  ]);

  const ws = XLSX.utils.aoa_to_sheet(rows);
  ws['!cols'] = [
    {wch:4},{wch:22},{wch:10},{wch:12},{wch:12},
    {wch:8},{wch:8},{wch:8},{wch:8},{wch:12},
    {wch:10},{wch:10},{wch:14},
  ];
  XLSX.utils.book_append_sheet(wb, ws, 'Сводка');
  XLSX.writeFile(wb, `ЗП_Аква_${monthName}.xlsx`);
}

function fmt(n) { return Number(n).toLocaleString('ru-RU'); }
