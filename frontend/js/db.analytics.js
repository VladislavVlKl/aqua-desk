Object.assign(DB, {
  // Статистика активности всех тренеров (для координатора)
  async getTrainersActivityStats(year, month) {
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const to   = new Date(year, month, 1).toISOString().slice(0,10);
    const cutoff48 = new Date(Date.now()-48*3600000).toISOString();

    const [profilesR, workoutsR, dutiesR, notesR, workoutsAllR] = await Promise.all([
      sb().from('profiles').select('id,fio,role,branches,tg_id').in('role',['trainer','senior_trainer']),
      // Тренировки за текущий месяц
      sb().from('workouts').select('trainer_id,workout_date,created_at,is_debt,debt_confirmed_at')
        .gte('workout_date', from).lt('workout_date', to),
      // Дежурства за месяц
      sb().from('duties').select('trainer_id,start_time').gte('start_time',from).lt('start_time',to),
      // Все тренировки старше 48ч без конспекта
      sb().from('workouts').select('id,trainer_id,workout_date')
        .eq('is_drop_in',false).eq('is_debt',false).lt('workout_date', cutoff48),
      // Последняя тренировка каждого тренера (вообще)
      sb().from('workouts').select('trainer_id,workout_date').order('workout_date',{ascending:false}),
    ]);

    const profiles  = profilesR.data||[];
    const workouts  = workoutsR.data||[];
    const duties    = dutiesR.data||[];
    const allOld    = notesR.data||[];
    const allW      = workoutsAllR.data||[];

    // Получаем id тренировок у которых есть конспект
    const oldIds = allOld.map(w=>w.id);
    let notedSet = new Set();
    if (oldIds.length) {
      const {data:notes} = await sb().from('session_notes')
        .select('workout_id').in('workout_id', oldIds).not('accomplishments','is',null);
      notedSet = new Set((notes||[]).map(n=>n.workout_id));
    }

    // Строим карту последних тренировок
    const lastWorkoutMap = {};
    allW.forEach(w => {
      if (!lastWorkoutMap[w.trainer_id]) lastWorkoutMap[w.trainer_id] = w.workout_date;
    });

    return profiles.map(p => {
      const pw = workouts.filter(w=>w.trainer_id===p.id && (!w.is_debt||w.debt_confirmed_at));
      const pd = duties.filter(d=>d.trainer_id===p.id);
      const overdueCount = allOld.filter(w=>w.trainer_id===p.id && !notedSet.has(w.id)).length;
      return {
        ...p,
        monthWorkouts: pw.length,
        monthDuties:   pd.length,
        overdueNotes:  overdueCount,
        lastWorkout:   lastWorkoutMap[p.id]||null,
      };
    });
  },
  async getClientProfile(clientId, viewerRole, viewerBranches) {
    const {data:client,error} = await sb().from('clients')
      .select('*, profiles!trainer_id(fio,branches)').eq('id',clientId).single();
    if (error) throw error;
    if (viewerRole==='senior_trainer') {
      const hasAccess = (client.profiles?.branches||[]).some(b=>(viewerBranches||[]).includes(b));
      if (!hasAccess) throw new Error('Нет доступа');
    }
    const [subs,workouts] = await Promise.all([
      sb().from('subscriptions').select('*, training_goals(*)')
        .eq('client_id',clientId).order('created_at',{ascending:false}),
      sb().from('workouts').select('*, session_notes(*)')
        .eq('client_id',clientId).order('workout_date',{ascending:false}).limit(50),
    ]);
    return { client, subscriptions:subs.data||[], workouts:workouts.data||[] };
  },

  // ─── CLIENT REPORT ───────────────────────────
  async getClientDataForReport(clientId) {
    const [subsR, workoutsR] = await Promise.all([
      sb().from('subscriptions').select('id,start_date,end_date,is_active')
        .eq('client_id',clientId).order('created_at',{ascending:false}),
      sb().from('workouts').select('workout_date,is_drop_in,is_debt,debt_confirmed_at')
        .eq('client_id',clientId).order('workout_date',{ascending:false}),
    ]);
    return { subscriptions: subsR.data||[], workouts: workoutsR.data||[] };
  },

  // ─── EVENTS ──────────────────────────────────
  async getUpcomingEvents(branch) {
    const now  = new Date().toISOString();
    const in30 = new Date(Date.now()+30*86400000).toISOString();
    let q = sb().from('events')
      .select('*, event_participants(trainer_id), profiles!created_by(fio)')
      .gte('end_time',now).lte('start_time',in30).order('start_time');
    if (branch) q = q.or(`branch.is.null,branch.eq.${branch}`);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async getBlockingEvents(branch, startTime, endTime) {
    const {data,error} = await sb().from('events')
      .select('id,title,start_time,end_time').eq('blocks_pool',true)
      .or(`branch.is.null,branch.eq.${branch}`)
      .lt('start_time',endTime).gt('end_time',startTime);
    if (error) throw error; return data||[];
  },
  async createEvent(fields) {
    const {data,error} = await sb().from('events').insert(fields)
      .select('*, profiles!created_by(fio)').single();
    if (error) throw error; return data;
  },
  async deleteEvent(id) {
    const {error} = await sb().from('events').delete().eq('id',id);
    if (error) throw error;
  },
  async joinEvent(eventId, trainerId) {
    const {error} = await sb().from('event_participants')
      .insert({event_id:eventId,trainer_id:trainerId});
    if (error&&!error.message.includes('unique')) throw error;
  },
  async leaveEvent(eventId, trainerId) {
    const {error} = await sb().from('event_participants')
      .delete().eq('event_id',eventId).eq('trainer_id',trainerId);
    if (error) throw error;
  },

  // ─── АНАЛИТИКА ───────────────────────────────

  async getAnalytics(year, month, branch=null) {
    // Текущий месяц
    const from    = new Date(year,month-1,1).toISOString();
    const to      = new Date(year,month,  1).toISOString();
    const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const toDay   = new Date(year,month,1).toISOString().slice(0,10);

    // Предыдущий месяц
    const py = month===1 ? year-1 : year;
    const pm = month===1 ? 12 : month-1;
    const pfrom    = new Date(py,pm-1,1).toISOString();
    const pto      = new Date(py,pm,  1).toISOString();
    const pfromDay = `${py}-${String(pm).padStart(2,'0')}-01`;
    const ptoDay   = new Date(py,pm,1).toISOString().slice(0,10);

    // Запросы параллельно
    let currWQ = sb().from('workouts')
      .select('trainer_id,category_at_moment,is_debt,debt_confirmed_at,is_drop_in,drop_in_category')
      .gte('workout_date',from).lt('workout_date',to);
    if (branch) currWQ = currWQ.eq('branch',branch);

    let prevWQ = sb().from('workouts')
      .select('trainer_id,category_at_moment,is_debt,debt_confirmed_at,is_drop_in,drop_in_category')
      .gte('workout_date',pfrom).lt('workout_date',pto);
    if (branch) prevWQ = prevWQ.eq('branch',branch);

    // Новые абонементы
    let currSubQ = sb().from('subscriptions')
      .select('id,client_id,trainer_id').gte('start_date',fromDay).lt('start_date',toDay);
    let prevSubQ = sb().from('subscriptions')
      .select('id,client_id,trainer_id').gte('start_date',pfromDay).lt('start_date',ptoDay);

    // Закрытые абонементы (отток)
    let currChurnQ = sb().from('subscriptions')
      .select('id').eq('is_active',false).not('end_date','is',null)
      .gte('end_date',fromDay).lt('end_date',toDay);
    let prevChurnQ = sb().from('subscriptions')
      .select('id').eq('is_active',false).not('end_date','is',null)
      .gte('end_date',pfromDay).lt('end_date',ptoDay);

    // Активные клиенты (хотя бы 1 ПТ в этом месяце)
    let activeClientsQ = sb().from('workouts')
      .select('client_id').gte('workout_date',from).lt('workout_date',to);
    if (branch) activeClientsQ = activeClientsQ.eq('branch',branch);

    // Рейтинг тренеров
    let rankQ = sb().from('workouts')
      .select('trainer_id, profiles!trainer_id(fio)')
      .gte('workout_date',from).lt('workout_date',to)
      .eq('is_drop_in',false);
    if (branch) rankQ = rankQ.eq('branch',branch);

    // Дежурства
    let currDutyQ = sb().from('duties')
      .select('trainer_id,start_time,end_time')
      .gte('start_time',from).lt('start_time',to).not('end_time','is',null);
    if (branch) currDutyQ = currDutyQ.eq('branch',branch);
    let prevDutyQ = sb().from('duties')
      .select('start_time,end_time')
      .gte('start_time',pfrom).lt('start_time',pto).not('end_time','is',null);
    if (branch) prevDutyQ = prevDutyQ.eq('branch',branch);

    const [cW,pW,cS,pS,cC,pC,aC,rQ,cD,pD] = await Promise.all([
      currWQ,prevWQ,currSubQ,prevSubQ,currChurnQ,prevChurnQ,
      activeClientsQ,rankQ,currDutyQ,prevDutyQ,
    ]);

    // Считаем ПТ (не долговые неподтверждённые)
    const countPT = (arr) => (arr||[]).filter(w=>!w.is_drop_in&&(!w.is_debt||w.debt_confirmed_at)).length;
    const currPT  = countPT(cW.data);
    const prevPT  = countPT(pW.data);

    const currDropIn = (cW.data||[]).filter(w=>w.is_drop_in).length;
    const prevDropIn = (pW.data||[]).filter(w=>w.is_drop_in).length;

    // Уникальные активные клиенты
    const currActiveClients = new Set((aC.data||[]).map(w=>w.client_id)).size;

    // Рейтинг тренеров
    const trainerCounts = {};
    const trainerNames  = {};
    ;(rQ.data||[]).forEach(w=>{
      trainerCounts[w.trainer_id] = (trainerCounts[w.trainer_id]||0)+1;
      trainerNames[w.trainer_id]  = w.profiles?.fio||'?';
    });
    const ranking = Object.entries(trainerCounts)
      .sort((a,b)=>b[1]-a[1])
      .slice(0,10)
      .map(([id,count])=>({fio:trainerNames[id],count}));

    // Часы дежурств
    const sumHours = (arr) => (arr||[]).reduce((s,d)=>
      s+(new Date(d.end_time)-new Date(d.start_time))/3600000, 0);
    const currDutyHours = sumHours(cD.data);
    const prevDutyHours = sumHours(pD.data);

    return {
      currPT, prevPT,
      currDropIn, prevDropIn,
      currNewClients: (cS.data||[]).length,
      prevNewClients: (pS.data||[]).length,
      currChurn: (cC.data||[]).length,
      prevChurn: (pC.data||[]).length,
      currActiveClients,
      currDutyHours, prevDutyHours,
      ranking,
      month: { year, month },
      prevMonth: { year:py, month:pm },
    };
  },

  // Данные для CEO-аналитики: оплаты групп (тек/прошлый месяц), клиенты, абонементы, слоты
  async getCeoAnalytics(year, month) {
    const py = month===1 ? year-1 : year;
    const pm = month===1 ? 12 : month-1;
    const monthDay  = `${year}-${String(month).padStart(2,'0')}-01`;
    const pMonthDay = `${py}-${String(pm).padStart(2,'0')}-01`;
    const [cgp, pgp, cl, subs, slots] = await Promise.all([
      sb().from('group_payments').select('group_id,amount,paid,trainer_groups(trainer_id)').eq('month',monthDay),
      sb().from('group_payments').select('group_id,amount,paid').eq('month',pMonthDay),
      sb().from('clients').select('id,fio,balance,subscription_end,trainer_id').eq('is_archived',false),
      sb().from('subscriptions').select('client_id,start_date'),
      sb().from('schedule_slots').select('day_of_week,start_time,end_time,slot_type').eq('active',true),
    ]);
    return {
      groupPayments:     cgp.data  ||[],
      prevGroupPayments: pgp.data  ||[],
      clients:           cl.data   ||[],
      subscriptions:     subs.data ||[],
      slots:             slots.data||[],
      prevMonth: { year:py, month:pm },
    };
  },

  // ─── REPORTS ─────────────────────────────────
  async getSummary(year, month, branch=null) {
    const from    = new Date(year,month-1,1).toISOString();
    const to      = new Date(year,month,  1).toISOString();
    const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const toDay   = new Date(year,month,1).toISOString().slice(0,10);

    let wq  = sb().from('workouts')
      .select('trainer_id,category_at_moment,branch,is_debt,debt_confirmed_at,is_drop_in,drop_in_category,workout_date,clients!client_id(age)')
      .gte('workout_date',from).lt('workout_date',to)
      .eq('pending_confirmation',false)   // исключаем незаконфирмированные замены
      .is('substitute_for',null);         // обычные ПТ; замены с ставкой — отдельно в ptSubstitutions
    if (branch) wq = wq.eq('branch',branch);

    let dq = sb().from('duties')
      .select('trainer_id,branch,start_time,end_time')
      .gte('start_time',from).lt('start_time',to).not('end_time','is',null);
    if (branch) dq = dq.eq('branch',branch);

    let tgq = sb().from('trainer_groups')
      .select('id,trainer_id,group_instance_id,rate_type,rate_value,role,leader_name,leader_fee_percent,branch,profiles(fio),group_types(name,type,billing_model,price_per_month,trainer_percentage)')
      .lte('subscription_start',toDay)
      .or(`subscription_end.is.null,subscription_end.gte.${fromDay}`);
    if (branch) tgq = tgq.eq('branch',branch);

    let gsq = sb().from('group_sessions')
      .select('trainer_id,group_type_id,branch,headcount,session_date,group_instance_id,group_types(billing_model)')
      .gte('session_date',fromDay).lt('session_date',toDay);
    if (branch) gsq = gsq.eq('branch',branch);

    // Оплаты и посещаемость детских групп за месяц — для авто-ЗП (фильтруются по инстансам ниже)
    let gpayq = sb().from('group_payments')
      .select('group_id,group_instance_id,amount,paid,paid_at').eq('month',fromDay);
    let gattq = sb().from('group_attendance')
      .select('group_id,group_instance_id,session_date')
      .gte('session_date',fromDay).lt('session_date',toDay);

    let pq = sb().from('profiles').select('id,fio,branches,role')
      .in('role',['trainer','senior_trainer']);
    if (branch) pq = pq.contains('branches',[branch]);

    let aq  = sb().from('month_adjustments').select('*').eq('year',year).eq('month',month);
    let gpq = sb().from('group_trainer_payouts').select('*').eq('month',fromDay);
    // trainer_groups(group_type_id,branch) нужен calcSalary: фильтр двойной оплаты замен во взрослых группах
    let gsub= sb().from('group_substitutions').select('*, trainer_groups(group_type_id,branch)')
      .gte('session_date',fromDay).lt('session_date',toDay).eq('status','approved');
    // ПТ-замены с выставленной ставкой
    let ptsub = sb().from('workouts')
      .select('trainer_id,substitute_for,substitute_rate,branch')
      .not('substitute_for','is',null).not('substitute_rate','is',null)
      .gte('workout_date',from).lt('workout_date',to)
      .eq('pending_confirmation',false);
    if (branch) ptsub = ptsub.eq('branch',branch);

    let trialq = sb().from('trial_sessions')
      .select('trainer_id,category').gte('session_date',from).lt('session_date',to);
    if (branch) trialq = trialq.eq('branch',branch);

    const [w,d,tg,gs,p,adj,gp,gsubR,ptsubR,trialR,gpayR,gattR] =
      await Promise.all([wq,dq,tgq,gsq,pq,aq,gpq,gsub,ptsub,trialq,gpayq,gattq]);

    // Замены в группах: при выборке по филиалу оставляем только замены в группах ЭТОГО филиала,
    // иначе замена тренера в другом филиале попадёт в ведомости обоих филиалов (двойной счёт)
    const gsubData = branch
      ? (gsubR.data||[]).filter(s => !s.trainer_groups?.branch || s.trainer_groups.branch===branch)
      : (gsubR.data||[]);

    // ── АВТО-ЗП детских групп: один расчёт на инстанс, без N+1 ──
    const childTgs = (tg.data||[]).filter(_isChildTg);
    const rateHistory = childTgs.length
      ? await DB.getRateHistory(childTgs.map(t=>t.id), fromDay) : [];
    const childAutoByTrainer = {};
    _calcChildInstances({
      childTgs,
      payments:      gpayR.data||[],
      sessions:      gs.data   ||[],
      substitutions: gsubData,         // уже только approved + фильтр по филиалу
      adjustments:   gp.data   ||[],
      rateHistory,
      attendance:    gattR.data||[],
      monthStr:      fromDay,
    }).forEach(({result})=>{
      result.rows.forEach(r=>{
        childAutoByTrainer[r.trainerId] = (childAutoByTrainer[r.trainerId]||0) + r.final;
      });
    });

    return {
      workouts:            w.data      ||[],
      duties:              d.data      ||[],
      trainerGroups:       tg.data     ||[],
      groupSessions:       gs.data     ||[],
      profiles:            p.data      ||[],
      adjustments:         adj.data    ||[],
      groupPayouts:        gp.data     ||[],
      groupSubstitutions:  gsubData,
      ptSubstitutions:     ptsubR.data ||[],
      trialSessions:       trialR.data ||[],
      childAutoByTrainer,
    };
  },

  // Авто-ЗП тренера по всем его детским группам за месяц — та же формула calcChildGroupPayroll.
  // Используется в отчёте тренера (loadTrainerReport) и деталях (getTrainerDetail).
  async getChildGroupsAutoSalary(trainerId, monthStr) {
    return cached(`grp:autosal:${trainerId}:${monthStr}`, async () => {
    try {
      const nextD = new Date(monthStr); nextD.setMonth(nextD.getMonth()+1);
      const toDay = nextD.toISOString().slice(0,10);
      const {data:myTgs} = await sb().from('trainer_groups')
        .select('id,trainer_id,group_instance_id,group_types(name,type,billing_model)')
        .eq('trainer_id',trainerId)
        .lte('subscription_start',toDay)
        .or(`subscription_end.is.null,subscription_end.gte.${monthStr}`);
      const childMy = (myTgs||[]).filter(_isChildTg);
      if (!childMy.length) return {total:0, rows:[]};

      const instanceIds = [...new Set(childMy.map(t=>t.group_instance_id).filter(Boolean))];
      // Полный состав инстансов — формула зависит от всех тренеров группы
      let childTgs = childMy.filter(t=>!t.group_instance_id);
      if (instanceIds.length) {
        const {data:instTgs} = await sb().from('trainer_groups')
          .select('*, profiles(fio), group_types(name,type,billing_model)')
          .in('group_instance_id',instanceIds).is('subscription_end',null);
        childTgs = [...childTgs, ...(instTgs||[])];
      }
      const gIds  = childTgs.map(t=>t.id);
      const trIds = [...new Set(childTgs.map(t=>t.trainer_id))];
      const orInst = instanceIds.length
        ? `group_instance_id.in.(${instanceIds.join(',')}),group_id.in.(${gIds.join(',')})`
        : `group_id.in.(${gIds.join(',')})`;
      const orSess = instanceIds.length
        ? `group_instance_id.in.(${instanceIds.join(',')}),and(group_instance_id.is.null,trainer_id.in.(${trIds.join(',')}))`
        : `trainer_id.in.(${trIds.join(',')})`;

      const [pays, sess, subs, adjs, rh, atts] = await Promise.all([
        sb().from('group_payments').select('group_id,group_instance_id,amount,paid,paid_at')
          .eq('month',monthStr).or(orInst).then(r=>r.data||[]),
        sb().from('group_sessions').select('trainer_id,session_date,group_instance_id')
          .gte('session_date',monthStr).lt('session_date',toDay).or(orSess).then(r=>r.data||[]),
        sb().from('group_substitutions').select('*').in('group_id',gIds)
          .gte('session_date',monthStr).lt('session_date',toDay)
          .eq('status','approved').then(r=>r.data||[]),
        sb().from('group_trainer_payouts').select('*')
          .eq('month',monthStr).in('group_id',gIds).then(r=>r.data||[]),
        DB.getRateHistory(gIds, monthStr),
        sb().from('group_attendance').select('group_id,group_instance_id,session_date')
          .gte('session_date',monthStr).lt('session_date',toDay).or(orInst).then(r=>r.data||[]),
      ]);

      let total = 0; const rows = [];
      _calcChildInstances({childTgs, payments:pays, sessions:sess, substitutions:subs,
                           adjustments:adjs, rateHistory:rh, attendance:atts, monthStr})
        .forEach(({members, result})=>{
          const groupName = members[0]?.group_types?.name || 'Группа';
          result.rows.filter(r=>r.trainerId===trainerId).forEach(r=>{
            total += r.final;
            rows.push({tgId:r.tgId, groupName, autoAmt:r.autoAmt, calcNote:r.calcNote,
                       bonus:r.bonus, penalty:r.penalty, final:r.final});
          });
        });
      return {total, rows};
    } catch(e) { console.error('[getChildGroupsAutoSalary]', e); return {total:0, rows:[]}; }
    });
  },

  /** Дети, которые ХОДИЛИ в этом месяце, но НЕ оплатили (сигнал ⚠️ тренеру) */
  async getGroupUnpaidAttendees(trainerId, monthStr) {
    try {
      const nextD = new Date(monthStr); nextD.setMonth(nextD.getMonth()+1);
      const toDay = nextD.toISOString().slice(0,10);
      const {data:myTgs} = await sb().from('trainer_groups')
        .select('id,group_instance_id,group_types(name,type)')
        .eq('trainer_id',trainerId).is('subscription_end',null);
      const childMy = (myTgs||[]).filter(t=>t.group_types?.type==='children');
      const seen = new Set(), uniq = [];
      for (const g of childMy) {
        const k = g.group_instance_id || `g${g.id}`;
        if (seen.has(k)) continue; seen.add(k); uniq.push(g);
      }
      const result = [];
      for (const g of uniq) {
        const inst = g.group_instance_id;
        const children = inst ? await this.getGroupClientsByInstance(inst) : await this.getGroupClients(g.id);
        if (!children.length) continue;
        const childIds = children.map(c=>c.id);
        const [{data:atts}, {data:pays}] = await Promise.all([
          sb().from('group_attendance').select('group_client_id')
            .eq('attended',true).gte('session_date',monthStr).lt('session_date',toDay)
            .in('group_client_id',childIds),
          sb().from('group_payments').select('group_client_id,paid')
            .eq('month',monthStr).in('group_client_id',childIds),
        ]);
        const attendedIds = new Set((atts||[]).map(a=>a.group_client_id));
        const paidIds = new Set((pays||[]).filter(p=>p.paid).map(p=>p.group_client_id));
        const unpaid = children.filter(c=>attendedIds.has(c.id) && !paidIds.has(c.id));
        if (unpaid.length) result.push({groupName:g.group_types?.name||'Группа', children:unpaid.map(c=>c.name)});
      }
      return result;
    } catch(e) { console.error('[getGroupUnpaidAttendees]', e); return []; }
  },

  async getTrainerDetail(trainerId, year, month) {
    const from    = new Date(year,month-1,1).toISOString();
    const to      = new Date(year,month,  1).toISOString();
    const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const toDay   = new Date(year,month,1).toISOString().slice(0,10);
    const [w,d,tg,gs,adj,gp,gsub,notes,trials,childAuto] = await Promise.all([
      sb().from('workouts').select('*, clients(fio,age), sub_profile:profiles!substitute_for(fio)')
        .eq('trainer_id',trainerId).gte('workout_date',from).lt('workout_date',to)
        .eq('pending_confirmation',false)
        .order('workout_date',{ascending:false}),
      sb().from('duties').select('*').eq('trainer_id',trainerId)
        .gte('start_time',from).lt('start_time',to)
        .not('end_time','is',null).order('start_time',{ascending:false}),
      sb().from('trainer_groups').select('*, group_types(*)')
        .eq('trainer_id',trainerId).lte('subscription_start',toDay)
        .or(`subscription_end.is.null,subscription_end.gte.${fromDay}`),
      sb().from('group_sessions').select('*, group_types(*)')
        .eq('trainer_id',trainerId).gte('session_date',fromDay).lt('session_date',toDay)
        .order('session_date',{ascending:false}),
      sb().from('month_adjustments').select('*')
        .eq('trainer_id',trainerId).eq('year',year).eq('month',month).maybeSingle(),
      sb().from('group_trainer_payouts').select('*')
        .eq('trainer_id',trainerId).eq('month',fromDay),
      sb().from('group_substitutions').select('*, trainer_groups(*, group_types(name))')
        .eq('substitute_trainer_id',trainerId)
        .gte('session_date',fromDay).lt('session_date',toDay),
      sb().from('session_notes').select('*, clients(fio), workouts(workout_date,category_at_moment)')
        .eq('trainer_id',trainerId)
        .gte('created_at',from).lt('created_at',to)
        .order('created_at',{ascending:false}),
      sb().from('trial_sessions').select('*').eq('trainer_id',trainerId)
        .gte('session_date',from).lt('session_date',to)
        .order('session_date',{ascending:false}),
      DB.getChildGroupsAutoSalary(trainerId, fromDay),
    ]);
    return {
      workouts:           w.data      ||[],
      duties:             d.data      ||[],
      trainerGroups:      tg.data     ||[],
      groupSessions:      gs.data     ||[],
      adjustment:         adj.data    ||null,
      groupPayouts:       gp.data     ||[],
      groupSubstitutions: gsub.data   ||[],
      sessionNotes:       notes.data  ||[],
      trialSessions:      trials.data ||[],
      childAutoSum:       childAuto.total,
      childAutoRows:      childAuto.rows,
    };
  },

  // ─── КОНТРОЛЬ ────────────────────────────────
  async getControlData() {
    const today      = todayStr();
    const warnDay    = new Date(); warnDay.setDate(warnDay.getDate()+SUBSCRIPTION_WARN_DAYS);
    const warnStr    = warnDay.toISOString().slice(0,10);
    const threeDaysAgo = new Date(); threeDaysAgo.setDate(threeDaysAgo.getDate()-3);
    const [expiring,oldDebt,childDropin,batchWO,inactive] = await Promise.all([
      sb().from('clients').select('*, profiles!trainer_id(fio)')
        .not('subscription_end','is',null)
        .gte('subscription_end',today).lte('subscription_end',warnStr),
      sb().from('workouts').select('*, clients(fio), profiles!trainer_id(fio)')
        .eq('is_debt',true).is('debt_confirmed_at',null)
        .lt('created_at',threeDaysAgo.toISOString()),
      sb().from('clients').select('*, profiles!trainer_id(fio)')
        .eq('drop_in_used',true).lte('age',CHILD_MAX_AGE),
      sb().from('workouts')
        .select('trainer_id,notes,workout_date,profiles!trainer_id(fio)')
        .not('notes','is',null)
        .gte('workout_date',new Date(new Date().getFullYear(),new Date().getMonth(),1).toISOString()),
      sb().from('profiles').select('id,fio,branches').in('role',['trainer','senior_trainer']),
    ]);
    const notesCount = {};
    (batchWO.data||[]).forEach(w=>{
      if (!w.notes) return;
      const key=`${w.trainer_id}::${w.notes}`;
      notesCount[key]=notesCount[key]||{count:0,rec:w};
      notesCount[key].count++;
    });
    return {
      expiringClients:  expiring.data  ||[],
      oldDebt:          oldDebt.data   ||[],
      childDropinAbuse: childDropin.data||[],
      suspiciousBatch:  Object.values(notesCount).filter(x=>x.count>3),
      inactiveTrainers: inactive.data  ||[],
    };
  },

  // ─── АНАЛИТИКА КООРДИНАТОРА (Overview + хабы) ──
  // Выручка детских групп за месяц (оплаты). branch — через join trainer_groups.
  async getAnGroupRevenue(year, month, branch=null) {
    const monthDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const { data, error } = await sb().from('group_payments')
      .select('amount,paid,group_id,trainer_groups(branch)').eq('month', monthDay);
    if (error) throw error;
    let rows = data || [];
    if (branch) rows = rows.filter(r => r.trainer_groups?.branch === branch);
    return rows;
  },

  // Клиенты + все абонементы (хаб «Клиентская база»). Фильтр по филиалу — в JS по branches тренера.
  async getAnClients() {
    const [cl, subs] = await Promise.all([
      sb().from('clients').select(
        'id,fio,balance,age,is_archived,subscription_start,subscription_end,freeze_start,freeze_end,trainer_id,profiles!trainer_id(fio,branches)'),
      sb().from('subscriptions').select(
        'client_id,trainer_id,start_date,end_date,initial_balance,is_active,closing_note'),
    ]);
    if (cl.error)   throw cl.error;
    if (subs.error) throw subs.error;
    return { clients: cl.data || [], subscriptions: subs.data || [] };
  },

  // Проданные абонементы за месяц (для выручки детских ПТ — по цене пакета).
  async getAnSubsRevenue(year, month, branch=null) {
    const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const toDay   = new Date(year, month, 1).toISOString().slice(0,10);
    const { data, error } = await sb().from('subscriptions')
      .select('start_date,initial_balance,trainer_id,clients(age,category),profiles!trainer_id(branches)')
      .gte('start_date', fromDay).lt('start_date', toDay);
    if (error) throw error;
    let rows = data || [];
    if (branch) rows = rows.filter(r => (r.profiles?.branches||[]).includes(branch));
    return rows;
  },

  // Тренировки за месяц (тепловая карта, распределение, выручка по начислению).
  async getAnWorkouts(year, month, branch=null) {
    const from = new Date(year, month-1, 1).toISOString();
    const to   = new Date(year, month,   1).toISOString();
    let q = sb().from('workouts')
      .select('trainer_id,client_id,category_at_moment,drop_in_category,workout_date,is_drop_in,is_debt,debt_confirmed_at,branch,profiles!trainer_id(fio),clients!client_id(age,category)')
      .gte('workout_date', from).lt('workout_date', to)
      .eq('pending_confirmation', false).is('substitute_for', null);
    if (branch) q = q.eq('branch', branch);
    const { data, error } = await q;
    if (error) throw error; return data || [];
  },

  // Абонементы за окно ~8 мес до конца месяца — карта «размер пакета клиента на дату»
  // для выручки по начислению (accrual).
  async getAnAllSubs(year, month) {
    const toDay = new Date(year, month,   1).toISOString().slice(0,10);
    const loDay = new Date(year, month-9, 1).toISOString().slice(0,10);
    const { data, error } = await sb().from('subscriptions')
      .select('client_id,start_date,initial_balance')
      .gte('start_date', loDay).lt('start_date', toDay);
    if (error) throw error; return data || [];
  },

  // Данные для хаба «Контроль»: конспекты, поздние внесения, удаления ПТ, активность.
  async getAnControl(year, month, branch=null) {
    const from = new Date(year, month-1, 1).toISOString();
    const to   = new Date(year, month,   1).toISOString();
    let notesQ = sb().from('session_notes')
      .select('trainer_id,created_at,deadline,workouts!inner(branch,workout_date)')
      .gte('workouts.workout_date', from).lt('workouts.workout_date', to);
    if (branch) notesQ = notesQ.eq('workouts.branch', branch);
    let lateQ = sb().from('late_workout_requests')
      .select('trainer_id,client_id,workout_date,status,created_at,branch,clients(fio),profiles!trainer_id(fio)')
      .gte('created_at', from).lt('created_at', to);
    if (branch) lateQ = lateQ.eq('branch', branch);
    let delQ = sb().from('workout_delete_requests')
      .select('trainer_id,client_name,workout_date,status,created_at,branch,profiles!trainer_id(fio)')
      .gte('created_at', from).lt('created_at', to);
    if (branch) delQ = delQ.eq('branch', branch);
    let auditQ = sb().from('audit_log').select('created_at,branch,action')
      .gte('created_at', from).lt('created_at', to);
    if (branch) auditQ = auditQ.eq('branch', branch);
    const [notes, late, dels, audit] = await Promise.all([notesQ, lateQ, delQ, auditQ]);
    return {
      notes: notes.data || [], late: late.data || [],
      dels:  dels.data  || [], audit: audit.data || [],
    };
  },
});
