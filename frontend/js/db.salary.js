// ─── РАСЧЁТ ЗП ───────────────────────────────
function calcSalary({workouts=[], duties=[], trainerGroups=[], groupSessions=[], adjustment=null,
                     groupPayouts=[], groupSubstitutions=[], trainerId=null, trialSessions=[],
                     childAutoSum=0}) {
  const cat={1:0,2:0,3:0,debt:0,dropIn1:0,dropIn2:0,dropIn3:0,trial1:0,trial2:0,trial3:0};
  workouts.forEach(w=>{
    // Замены с кастомной ставкой идут только в ptSubSum — не двойной счёт
    if (w.substitute_for!=null && w.substitute_rate!=null) return;
    if (w.is_drop_in) {
      const dc = w.drop_in_category||1;
      cat[`dropIn${dc}`]++;
    } else if (w.is_debt&&!w.debt_confirmed_at) cat.debt++;
    else cat[w.category_at_moment]++;
  });
  // Пробные — та же ставка что и разовые
  (trialSessions||[]).forEach(t=>{ cat[`trial${t.category}`]++; });

  const ptSum      = cat[1]*RATES.pt[1]+cat[2]*RATES.pt[2]+cat[3]*RATES.pt[3];
  const dropInSum  = cat.dropIn1*RATES.pt[1]+cat.dropIn2*RATES.pt[2]+cat.dropIn3*RATES.pt[3];
  const trialSum   = cat.trial1*RATES.pt[1]+cat.trial2*RATES.pt[2]+cat.trial3*RATES.pt[3];

  // ПТ-замены: суммируем только записи где substitute_for != null и есть ставка
  const ptSubSum = workouts
    .filter(w=>w.substitute_for!=null && w.substitute_rate!=null)
    .reduce((s,w)=>s+Number(w.substitute_rate),0);

  const hours    = duties.reduce((s,d)=>s+(new Date(d.end_time)-new Date(d.start_time))/3600000,0);
  const dutySum  = Math.round(hours*RATES.duty_per_hour);

  // Детские группы: полностью АВТО — сумма считается вызывающим через calcChildGroupPayroll
  // (премии/штрафы из group_trainer_payouts уже внутри). payout_value не читается.
  const childSum = Number(childAutoSum)||0;

  // Взрослые группы: по явке (авто)
  const adultSum = groupSessions
    .filter(gs=>gs.group_types?.billing_model==='headcount')
    .reduce((s,gs)=>s+getAdultGroupRate(gs.headcount),0);

  // Групповые замены: утверждённые старшим/админом.
  // Взрослые группы (headcount): если заменяющий сам отметил занятие в ту же дату
  // в той же группе (group_type_id + branch) — ставка уже учтена в adultSum, замену пропускаем.
  const groupSubSum = (groupSubstitutions||[])
    .filter(s=>{
      if (s.status!=='approved' || s.substitute_trainer_id!==trainerId) return false;
      const subTg = s.trainer_groups;
      if (subTg) {
        const alreadyPaid = groupSessions.some(gs =>
          gs.group_types?.billing_model==='headcount' &&
          gs.group_type_id===subTg.group_type_id &&
          (!subTg.branch || !gs.branch || gs.branch===subTg.branch) &&
          String(gs.session_date).slice(0,10)===String(s.session_date).slice(0,10));
        if (alreadyPaid) return false;
      }
      return true;
    })
    .reduce((s,sub)=>s+Number(sub.rate||0),0);

  const bonus   = adjustment?.bonus  ||0;
  const penalty = adjustment?.penalty||0;
  const total   = ptSum+dropInSum+trialSum+ptSubSum+dutySum+childSum+adultSum+groupSubSum+bonus-penalty;
  return {cat,hours,ptSum,dropInSum,trialSum,ptSubSum,dutySum,childSum,adultSum,groupSubSum,bonus,penalty,total};
}

// ─── АВТО-РАСЧЁТ ЗП ДЕТСКОЙ ГРУППЫ ───────────
// Чистая функция: один вызов = один инстанс группы за месяц. Единственный источник
// формулы — используется в отчёте группы, экспорте ЗП и сводке (getSummary).
//   payments         — group_payments месяца (paid фильтруется внутри)
//   trainers         — строки trainer_groups инстанса (желательно с profiles(fio))
//   instanceSessions — group_sessions месяца этого инстанса (для ставочников)
//   substitutions    — замены месяца, УЖЕ отфильтрованные по status==='approved'
//   rateHistory      — trainer_group_rate_history по tg-id инстанса (DB.getRateHistory)
//   adjustments      — строки group_trainer_payouts месяца (источник bonus/penalty)
//   monthStr         — 'YYYY-MM-01'
//   isArtSwim        — формула арт-свима: вычет ставочников у процентника, пул-лимит, allFlat
//   attendance       — group_attendance месяца (для не-арт ставочника: занятий × ставка)
// Замены НЕ входят в autoAmt/final — выплачиваются заменяющему отдельной строкой (groupSubSum).
function calcChildGroupPayroll({payments=[], trainers=[], instanceSessions=[], substitutions=[],
                                rateHistory=[], adjustments=[], monthStr,
                                isArtSwim=true, attendance=[]}) {
  const F = typeof fmt==='function' ? fmt : (n=>Number(n||0).toLocaleString('ru-RU'));

  const paidPayments = (payments||[]).filter(p=>p.paid);
  // Вал — всегда от реальных оплат месяца
  const totalRevenue = paidPayments.reduce((s,p)=>s+Number(p.amount||0),0);
  // Пул = вал/2 — ЛИМИТ суммарных выплат, не база процентов
  const pool = Math.round(totalRevenue/2);
  // Уникальные даты занятий (для не-арт ставочника — старая логика по посещаемости)
  const sessionDates = [...new Set((attendance||[]).map(a=>String(a.session_date).slice(0,10)))].sort();

  const tgWithLeader = trainers.find(t=>t.leader_name);
  const leaderName   = tgWithLeader?.leader_name || '';
  const leaderPct    = tgWithLeader?.leader_fee_percent || 0;

  // ── История ставок: действующая запись на дату D — последняя с effective_from <= D ──
  const histByTg = {};
  (rateHistory||[]).forEach(h=>{ (histByTg[h.trainer_group_id] ||= []).push(h); });
  Object.values(histByTg).forEach(l=>l.sort((a,b)=>String(a.effective_from).localeCompare(String(b.effective_from))));
  const rateAt = (t, dateStr) => {
    const list = histByTg[t.id];
    const d = String(dateStr||monthStr).slice(0,10);
    let eff = null;
    (list||[]).forEach(h=>{ if (String(h.effective_from).slice(0,10) <= d) eff = h; });
    if (!eff) return {type:t.rate_type, value:Number(t.rate_value||0), fromHistory:false};
    return {type:eff.rate_type, value:Number(eff.rate_value||0), fromHistory:true};
  };

  const percentTrainers = trainers.filter(t=>t.rate_type==='percent');
  const flatTrainers    = trainers.filter(t=>t.rate_type==='flat');
  const allFlat         = percentTrainers.length===0 && flatTrainers.length>0;

  // Ставочник: каждое занятие по ставке на session_date (история), fallback 75 000
  const flatSessionsCost = t => (instanceSessions||[])
    .filter(s=>s.trainer_id===t.trainer_id)
    .reduce((acc,s)=>acc + (rateAt(t, s.session_date).value || 75000), 0);
  // Суммарные выплаты ставочников — вычитаются у процентных тренеров (арт-свим)
  const flatCost = flatTrainers.reduce((acc,ft)=>acc+flatSessionsCost(ft),0);

  // Процентник: оплаты по % на дату paid_at (история); без paid_at — % на 1-е число месяца
  const pctBase = (t, fallbackPct) => {
    const list = histByTg[t.id];
    if (!list?.length) {
      const pct = Number(t.rate_value)||fallbackPct;
      return {base: Math.round(totalRevenue*pct/100), pctLabel:`${pct}%`};
    }
    let base=0; const pcts=[];
    paidPayments.forEach(p=>{
      const r = rateAt(t, p.paid_at ? String(p.paid_at).slice(0,10) : monthStr);
      const pct = r.type==='percent' ? r.value : (Number(t.rate_value)||fallbackPct);
      if (!pcts.includes(pct)) pcts.push(pct);
      base += Number(p.amount||0)*pct/100;
    });
    return {base: Math.round(base), pctLabel: (pcts.length?pcts:[Number(t.rate_value)||fallbackPct]).join('→')+'%'};
  };

  const adjByTrainer = {};
  (adjustments||[]).forEach(a=>{ adjByTrainer[a.trainer_id] = a; });

  // ── НОВАЯ модель Арт-свим: ВСЁ считается от ПУЛА (вал/2) ──
  // 1) руководитель = leaderPct% пула; 2) ставочники = занятия×ставка;
  // 3) остаток пула делят процентники ПРОПОРЦИОНАЛЬНО своим % (один — берёт весь остаток);
  // 4) процентников нет (все ставочники) → остаток уходит руководителю.
  const leaderFeeBaseArt = leaderPct>0 ? Math.round(pool*leaderPct/100) : 0;
  const remainderArt = pool - leaderFeeBaseArt - flatCost; // на процентников
  const sumPctWeight = percentTrainers.reduce((s,t)=>s+(Number(t.rate_value)||0),0);
  const pctShareArt = {}; // trainerId → доля остатка пула (до вычета его замен)
  percentTrainers.forEach(t=>{
    const w = Number(t.rate_value)||0;
    const share = percentTrainers.length===1 ? remainderArt
                : sumPctWeight>0               ? remainderArt * w / sumPctWeight
                :                                remainderArt / percentTrainers.length;
    pctShareArt[t.trainer_id] = Math.max(0, Math.round(share));
  });

  const subs = substitutions||[];
  const rows = trainers.map(t=>{
    const mySessions   = (instanceSessions||[]).filter(s=>s.trainer_id===t.trainer_id);
    // Замены, где заменяли ЭТОГО тренера (вычитаются у него)
    const mySubs       = subs.filter(s=>s.original_trainer_id===t.trainer_id);
    const mySubCost    = mySubs.reduce((acc,s)=>acc+Number(s.rate||75000),0);
    // Замены, которые провёл ЭТОТ тренер (как заменяющий) — отдельной строкой в сводке
    const subsICovered = subs.filter(s=>s.substitute_trainer_id===t.trainer_id);
    const subsICoveredCost = subsICovered.reduce((acc,s)=>acc+Number(s.rate||75000),0);
    const hasHist = !!histByTg[t.id]?.length;

    let autoAmt=0, calcNote='';
    if (isArtSwim) {
      if (t.rate_type==='percent') {
        // Процентник берёт долю ОСТАТКА ПУЛА (пропорц. своему %; один — весь остаток),
        // из неё вычитаются замены, где заменяли его.
        const share = pctShareArt[t.trainer_id]||0;
        autoAmt  = Math.max(0, share - mySubCost);
        calcNote = percentTrainers.length>1
          ? `доля пула ${t.rate_value||0}%: ${F(share)}${mySubCost?` − замены (${F(mySubCost)})`:''}`
          : `остаток пула: ${F(share)}${mySubCost?` − замены (${F(mySubCost)})`:''}`;
      } else {
        // Flat тренер: занятия × ставка (по истории на дату занятия)
        autoAmt  = flatSessionsCost(t);
        calcNote = hasHist
          ? `${mySessions.length} занятий × ставка на дату занятия`
          : `${mySessions.length} занятий × ${F(t.rate_value||75000)}`;
      }
    } else {
      // Детские группы (не Арт-свим) — старая логика
      if (t.rate_type==='flat') {
        autoAmt  = hasHist
          ? sessionDates.reduce((acc,d)=>acc + (rateAt(t,d).value||0), 0)
          : sessionDates.length*(Number(t.rate_value)||0);
        calcNote = hasHist
          ? `${sessionDates.length} занятий × ставка на дату занятия`
          : `${sessionDates.length} занятий × ${F(t.rate_value||0)}`;
      } else {
        const {base,pctLabel} = pctBase(t,40);
        autoAmt  = Math.max(0, base - mySubCost);
        calcNote = `${pctLabel} × ${F(totalRevenue)}${mySubCost?` − замены (${F(mySubCost)})`:''}`;
      }
    }

    const adj = adjByTrainer[t.trainer_id];
    const bonus   = Number(adj?.bonus||0);
    const penalty = Number(adj?.penalty||0);
    const rateLabel = t.rate_type==='percent' ? `${t.rate_value||0}%`
                    : t.rate_type==='flat'    ? `${F(t.rate_value||75000)} сум/зан` : 'по явке';
    return {trainerId:t.trainer_id, tgId:t.id, fio:t.profiles?.fio||'—', role:t.role||'основной',
            rateType:t.rate_type, rateLabel, autoAmt, calcNote, bonus, penalty,
            final:0, mySubs, subsICovered, subsICoveredCost};
  });

  // Руководитель.
  //  • Арт-свим, есть процентники → leaderPct% пула (база).
  //  • Арт-свим, все ставочники   → leaderPct% пула + ВЕСЬ остаток пула (остаток руководителю).
  //  • Не арт-свим                → старая логика: % от полного вала.
  let leaderFee = 0;
  let poolCapped = false; // в новой модели пул сходится по построению, ужатие не нужно
  if (isArtSwim) {
    if (allFlat) {
      const totalFlatPay = rows.reduce((s,r)=>s+r.autoAmt,0);
      leaderFee = Math.max(0, pool - totalFlatPay); // 10% базы + остаток пула
    } else {
      leaderFee = leaderFeeBaseArt;
    }
  } else {
    leaderFee = leaderPct>0 ? Math.round(totalRevenue*leaderPct/100) : 0;
  }

  // Итог по тренеру = авто + премия − штраф (замены НЕ входят)
  rows.forEach(r=>{ r.final = r.autoAmt + r.bonus - r.penalty; });
  const totalTrainerPay = rows.reduce((s,r)=>s+r.autoAmt,0);
  const remainder = pool - totalTrainerPay - leaderFee;

  return {totalRevenue, pool, leaderName, leaderPct, leaderFee, poolCapped, remainder, rows};
}

// Детский инстанс = trainer_groups с billing_model !== 'headcount' (взрослые — headcount)
function _isChildTg(t) { return !!t.group_types && t.group_types.billing_model!=='headcount'; }

// Группировка детских trainer_groups по «физическим» инстансам и авто-расчёт каждого.
// Возвращает [{key, instanceId, members, result}] — result от calcChildGroupPayroll.
function _calcChildInstances({childTgs, payments, sessions, substitutions, adjustments, rateHistory, attendance, monthStr}) {
  const instances = {};
  (childTgs||[]).forEach(t=>{ const key = t.group_instance_id || `tg_${t.id}`; (instances[key] ||= []).push(t); });
  return Object.entries(instances).map(([key, members])=>{
    const iid   = members[0].group_instance_id||null;
    const gIds  = new Set(members.map(m=>m.id));
    const trIds = new Set(members.map(m=>m.trainer_id));
    const isArtSwim = members.some(m=>m.group_types?.name?.toLowerCase().includes('art'));
    // Оплаты: по инстансу, иначе по group_id (паритет с getGroupMonthReport)
    const pays = (payments||[]).filter(p=> iid ? p.group_instance_id===iid : gIds.has(p.group_id));
    // Занятия: по инстансу + fallback по trainer_id для записей без instance (паритет с отчётом)
    const sess = (sessions||[]).filter(s=> iid
      ? (s.group_instance_id===iid || (!s.group_instance_id && trIds.has(s.trainer_id)))
      : trIds.has(s.trainer_id));
    const subsI = (substitutions||[]).filter(s=>gIds.has(s.group_id));
    const adjI  = (adjustments||[]).filter(p=>gIds.has(p.group_id));
    const rhI   = (rateHistory||[]).filter(h=>gIds.has(h.trainer_group_id));
    const attI  = (attendance||[]).filter(a=> iid ? a.group_instance_id===iid : gIds.has(a.group_id));
    const result = calcChildGroupPayroll({payments:pays, trainers:members, instanceSessions:sess,
      substitutions:subsI, rateHistory:rhI, adjustments:adjI, monthStr, isArtSwim, attendance:attI});
    return {key, instanceId:iid, members, result};
  });
}
