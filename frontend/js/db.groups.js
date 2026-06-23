Object.assign(DB, {
  // ─── GROUP TYPES ─────────────────────────────
  async getGroupTypes() {
    const {data,error} = await sb().from('group_types').select('*').order('name');
    if (error) throw error; return data||[];
  },

  async updateGroupType(id, fields) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_types').update(fields).eq('id',id);
    if (error) throw error;
  },
  async deleteGroupType(id) {
    invalidateCachePrefix('grp:');
    // Unassign all trainers first
    await sb().from('trainer_groups')
      .update({subscription_end: new Date().toISOString().slice(0,10)})
      .eq('group_type_id',id).is('subscription_end',null);
    const {error} = await sb().from('group_types').delete().eq('id',id);
    if (error) throw error;
  },
  async addGroupType(fields) {
    invalidateCachePrefix('grp:');
    const {data,error} = await sb().from('group_types').insert(fields).select().single();
    if (error) throw error; return data;
  },
async getAssignedTrainers(groupTypeId) {
    const {data,error} = await sb().from('trainer_groups')
      .select('*, profiles(fio)')
      .eq('group_type_id',groupTypeId)
      .is('subscription_end',null);
    if (error) throw error; return data||[];
  },
  
  // ─── TRAINER GROUPS ──────────────────────────
  async getTrainerGroups(trainerId) {
    const {data,error} = await sb().from('trainer_groups')
      .select('*, group_types(*)').eq('trainer_id',trainerId)
      .is('subscription_end',null).order('subscription_start',{ascending:false});
    if (error) throw error; return data||[];
  },
  async addTrainerGroup(trainerId, groupTypeId, branch, startDate, rateType='percent', rateValue=40, role=null, groupInstanceId=null) {
    invalidateCachePrefix('grp:');
    const {data,error} = await sb().from('trainer_groups')
      .insert({trainer_id:trainerId, group_type_id:groupTypeId, branch,
               subscription_start:startDate, rate_type:rateType,
               rate_value:rateValue, role,
               group_instance_id: groupInstanceId || crypto.randomUUID()})
      .select('*, group_types(*)').single();
    if (error) throw error; return data;
  },
  async updateTrainerGroupSchedule(id, daysOfWeek, sessionTime) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('trainer_groups')
      .update({days_of_week: daysOfWeek, session_time: sessionTime}).eq('id',id);
    if (error) throw error;
  },
  async updateTrainerGroupRate(id, rateType, rateValue) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('trainer_groups')
      .update({rate_type: rateType, rate_value: rateValue}).eq('id',id);
    if (error) throw error;
  },
  async updateTrainerGroupLeader(id, leaderName, leaderFeePct) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('trainer_groups')
      .update({leader_name: leaderName||null, leader_fee_percent: leaderFeePct||0}).eq('id',id);
    if (error) throw error;
  },
  async linkTrainerGroupInstance(id, groupInstanceId) {
    const {error} = await sb().from('trainer_groups')
      .update({group_instance_id: groupInstanceId}).eq('id',id);
    if (error) throw error;
  },
  async getGroupInstanceMembers(groupInstanceId) {
    return cached(`grp:members:${groupInstanceId}`, async () => {
      const {data,error} = await sb().from('trainer_groups')
        .select('*, profiles(fio), group_types(name,type)')
        .eq('group_instance_id', groupInstanceId)
        .is('subscription_end',null);
      if (error) throw error; return data||[];
    });
  },
  // Клиенты по instance (общий список)
  async getGroupClientsByInstance(groupInstanceId) {
    return cached(`grp:cli:i:${groupInstanceId}`, async () => {
      const {data,error} = await sb().from('group_clients')
        .select('*').eq('group_instance_id', groupInstanceId)
        .eq('is_active',true).order('name');
      if (error) throw error; return data||[];
    });
  },
  async getGroupPaymentsByInstance(groupInstanceId, month) {
    return cached(`grp:pay:i:${groupInstanceId}:${month}`, async () => {
      const {data,error} = await sb().from('group_payments')
        .select('*').eq('group_instance_id', groupInstanceId).eq('month',month);
      if (error) throw error; return data||[];
    });
  },
  async getGroupAttendanceByInstance(groupInstanceId, date) {
    const {data,error} = await sb().from('group_attendance')
      .select('*').eq('group_instance_id', groupInstanceId).eq('session_date',date);
    if (error) throw error; return data||[];
  },
  async getDuplicateFlags(groupInstanceId) {
    return cached(`grp:dup:${groupInstanceId}`, async () => {
      const {data,error} = await sb().from('group_client_duplicate_flags')
        .select('*')
        .eq('group_instance_id', groupInstanceId).eq('status','pending');
      if (error) return []; // таблица или FK не настроены — просто пропускаем
      if (!data?.length) return [];
      // Подтягиваем имена клиентов отдельно
      const ids = [...new Set(data.flatMap(f=>[f.client_id_1, f.client_id_2].filter(Boolean)))];
      const {data:clients} = await sb().from('group_clients').select('id,name,age').in('id',ids);
      const cMap = Object.fromEntries((clients||[]).map(c=>[c.id,c]));
      return data.map(f=>({...f, c1: cMap[f.client_id_1]||null, c2: cMap[f.client_id_2]||null}));
    });
  },
  async resolveDuplicateFlag(id, status) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_client_duplicate_flags')
      .update({status}).eq('id',id);
    if (error) throw error;
  },
async unassignTrainerGroup(id) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('trainer_groups')
      .update({subscription_end: todayStr()}).eq('id',id);
    if (error) throw error;
  },

  // ─── GROUP CLIENTS ────────────────────────────
  async getGroupClients(groupId) {
    return cached(`grp:cli:g:${groupId}`, async () => {
      const {data,error} = await sb().from('group_clients')
        .select('*').eq('group_id',groupId).eq('is_active',true).order('name');
      if (error) throw error; return data||[];
    });
  },
  async addGroupClient(groupId, name, age, monthlyPrice, startDate, groupInstanceId=null, subgroup='') {
    invalidateCachePrefix('grp:');
    // subgroup: '' = основная подгруппа (колонка group_clients.subgroup, NOT NULL DEFAULT '')
    const {data,error} = await sb().from('group_clients')
      .insert({group_id:groupId, name, age:age||null,
               monthly_price:monthlyPrice||0, start_date:startDate,
               group_instance_id: groupInstanceId,
               subgroup: subgroup||''})
      .select().single();
    if (error) throw error; return data;
  },
  async updateGroupClient(id, fields) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_clients').update(fields).eq('id',id);
    if (error) throw error;
  },
  async archiveGroupClient(id) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_clients')
      .update({is_active:false}).eq('id',id);
    if (error) throw error;
  },
  async restoreGroupClient(id) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_clients')
      .update({is_active:true}).eq('id',id);
    if (error) throw error;
  },
  async getArchivedGroupClients(groupId) {
    const {data,error} = await sb().from('group_clients')
      .select('*').eq('group_id',groupId).eq('is_active',false).order('name');
    if (error) throw error; return data||[];
  },
  async getArchivedGroupClientsByInstance(groupInstanceId) {
    const {data,error} = await sb().from('group_clients')
      .select('*').eq('group_instance_id',groupInstanceId).eq('is_active',false).order('name');
    if (error) throw error; return data||[];
  },

  async deleteGroupClient(id) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_clients').delete().eq('id',id);
    if (error) throw error;
  },
  async deleteAdultGroupClient(id) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('adult_group_clients').delete().eq('id',id);
    if (error) throw error;
  },
  async deleteGroupAttendanceDay(groupId, date, groupInstanceId=null) {
    invalidateCachePrefix('grp:');
    // Удаляем по instance_id если есть, иначе по group_id
    let q = sb().from('group_attendance').delete().eq('session_date',date);
    if (groupInstanceId) q = q.eq('group_instance_id', groupInstanceId);
    else q = q.eq('group_id', groupId);
    const {error} = await q;
    if (error) throw error;
  },

  // ─── GROUP ATTENDANCE ─────────────────────────
  async getGroupAttendance(groupId, date) {
    const {data,error} = await sb().from('group_attendance')
      .select('*').eq('group_id',groupId).eq('session_date',date);
    if (error) throw error; return data||[];
  },
  async saveGroupAttendance(groupId, groupClientId, date, attended, groupInstanceId=null) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_attendance')
      .upsert({group_id:groupId, group_client_id:groupClientId,
               session_date:date, attended,
               ...(groupInstanceId ? {group_instance_id:groupInstanceId} : {})},
              {onConflict:'group_client_id,session_date'});
    if (error) throw error;
  },

  // Уникальные даты занятий с явкой (по instance_id если есть, иначе по group_id)
  async getGroupSessionHistory(groupId) {
    // Сначала получаем instance_id
    const {data:tg} = await sb().from('trainer_groups')
      .select('group_instance_id').eq('id',groupId).single();
    const instanceId = tg?.group_instance_id;
    let q = sb().from('group_attendance').select('session_date, attended').limit(500).order('session_date',{ascending:false});
    if (instanceId) q = q.eq('group_instance_id', instanceId);
    else q = q.eq('group_id', groupId);
    const {data} = await q;
    const map = {};
    (data||[]).forEach(r=>{
      if (!map[r.session_date]) map[r.session_date] = {total:0, attended:0};
      map[r.session_date].total++;
      if (r.attended) map[r.session_date].attended++;
    });
    return Object.entries(map)
      .sort((a,b)=>b[0].localeCompare(a[0]))
      .map(([date,v])=>({date,...v}));
  },

  // История посещений конкретного ребёнка (последние записи)
  async getGroupClientAttendanceHistory(groupClientId) {
    const {data,error} = await sb().from('group_attendance')
      .select('session_date,attended').eq('group_client_id',groupClientId)
      .order('session_date',{ascending:false}).limit(120);
    if (error) throw error; return data||[];
  },

  // ─── GROUP PAYMENTS ───────────────────────────
  async getGroupPayments(groupId, month) {
    return cached(`grp:pay:g:${groupId}:${month}`, async () => {
      const {data,error} = await sb().from('group_payments')
        .select('*').eq('group_id',groupId).eq('month',month);
      if (error) throw error; return data||[];
    });
  },
  async setGroupPayment(groupId, groupClientId, month, amount, paid, subStart=null, subEnd=null, groupInstanceId=null) {
    invalidateCachePrefix('grp:');
    // Сохраняем оригинальную дату оплаты если уже была оплачена
    const {data:existing} = await sb().from('group_payments')
      .select('paid_at').eq('group_client_id',groupClientId).eq('month',month).maybeSingle();
    const paid_at = paid ? (existing?.paid_at || new Date().toISOString()) : null;
    const {error} = await sb().from('group_payments')
      .upsert({group_id:groupId, group_client_id:groupClientId,
               month, amount, paid,
               sub_start: subStart||null,
               sub_end:   subEnd||null,
               paid_at,
               ...(groupInstanceId ? {group_instance_id:groupInstanceId} : {})},
              {onConflict:'group_client_id,month'});
    if (error) throw error;
  },

  // ─── GROUP PROGRESS NOTES ─────────────────────
  async getGroupProgressNotes(groupId, month) {
    const {data,error} = await sb().from('group_progress_notes')
      .select('*').eq('group_id',groupId).eq('month',month);
    if (error) throw error; return data||[];
  },
  async saveGroupProgressNote(groupId, groupClientId, trainerId, month, note) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_progress_notes')
      .upsert({group_id:groupId, group_client_id:groupClientId,
               trainer_id:trainerId, month, note},
              {onConflict:'group_client_id,month'});
    if (error) throw error;
  },
  // ─── GROUP TRAINER PAYOUTS ───────────────────
  async getGroupTrainerPayout(groupId, trainerId, month) {
    const {data,error} = await sb().from('group_trainer_payouts')
      .select('*').eq('group_id',groupId).eq('trainer_id',trainerId).eq('month',month).maybeSingle();
    if (error) throw error; return data;
  },
  async setGroupTrainerPayout(groupId, trainerId, month, payoutType, payoutValue, approvedBy, note='', bonus=0, penalty=0) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_trainer_payouts')
      .upsert({group_id:groupId, trainer_id:trainerId, month,
               payout_type:payoutType, payout_value:payoutValue,
               note, approved_by:approvedBy, approved_at:new Date().toISOString(),
               bonus: bonus||0, penalty: penalty||0},
              {onConflict:'group_id,trainer_id,month'});
    if (error) throw error;
  },
  async getGroupPayoutsForMonth(month) {
    const {data,error} = await sb().from('group_trainer_payouts')
      .select('*, trainer_groups(*, group_types(name,type)), profiles!trainer_id(fio)')
      .eq('month', month);
    if (error) throw error; return data||[];
  },
  // Премия/штраф к авто-расчёту детской группы. payout_value пишем = итог для аудита,
  // но в расчётах он больше НЕ читается (ЗП считается авто через calcChildGroupPayroll).
  async saveGroupAdjustment(groupId, trainerId, month, bonus, penalty, finalForAudit, savedBy, note='') {
    return DB.setGroupTrainerPayout(groupId, trainerId, month, 'fixed', finalForAudit, savedBy, note, bonus, penalty);
  },
  // ─── ИСТОРИЯ СТАВОК (trainer_group_rate_history) ───
  // Действующая ставка на дату D = последняя запись с effective_from <= D;
  // нет записей → fallback trainer_groups.rate_type/rate_value.
  // try/catch fallback []: до применения миграции таблицы нет — код не должен падать.
  async getRateHistory(trainerGroupIds, monthStr) {
    if (!trainerGroupIds?.length) return [];
    return cached(`grp:rate:${[...trainerGroupIds].sort().join(',')}:${monthStr}`, async () => {
    try {
      const next = new Date(monthStr); next.setMonth(next.getMonth()+1);
      const {data,error} = await sb().from('trainer_group_rate_history')
        .select('*').in('trainer_group_id', trainerGroupIds)
        .lt('effective_from', next.toISOString().slice(0,10))
        .order('effective_from',{ascending:true});
      if (error) throw error; return data||[];
    } catch(e) { console.warn('[getRateHistory]', e?.message||e); return []; }
    });
  },
  async getRateHistoryByTg(tgId, limit=5) {
    try {
      const {data,error} = await sb().from('trainer_group_rate_history')
        .select('*').eq('trainer_group_id', tgId)
        .order('effective_from',{ascending:false}).limit(limit);
      if (error) throw error; return data||[];
    } catch(e) { console.warn('[getRateHistoryByTg]', e?.message||e); return []; }
  },
  async addRateHistory(trainerGroupId, rateType, rateValue, effectiveFrom, createdBy) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('trainer_group_rate_history')
      .insert({trainer_group_id:trainerGroupId, rate_type:rateType, rate_value:rateValue,
               effective_from:effectiveFrom, created_by:createdBy});
    if (error) throw error;
  },
  // Отчёт по детской группе за месяц (для старшего/админа)
  async getGroupMonthReport(groupId, month) {
    return cached(`grp:report:${groupId}:${month}`, async () => {
    const nextMonth = new Date(month); nextMonth.setMonth(nextMonth.getMonth()+1);
    const nextMonthStr = nextMonth.toISOString().slice(0,10);

    // Сначала получаем данные этой trainer_groups строки (чтобы знать instance_id)
    const {data:tgRow} = await sb().from('trainer_groups')
      .select('*, profiles(fio), group_types(name,type,price_per_month)')
      .eq('id',groupId).single();

    const instanceId = tgRow?.group_instance_id;

    // Если есть instance — заранее грузим список тренеров для зависимых запросов
    let instanceTgRows = [];
    if (instanceId) {
      const {data:tgList} = await sb().from('trainer_groups')
        .select('id,trainer_id').eq('group_instance_id',instanceId).is('subscription_end',null);
      instanceTgRows = tgList||[];
    }
    const instanceGroupIds    = instanceTgRows.map(t=>t.id);
    const instanceTrainerIds  = instanceTgRows.map(t=>t.trainer_id);

    // Загружаем всё параллельно
    const [clients, payments, notes, attendance, payouts, instanceTrainers, instanceSessions, substitutions] = await Promise.all([
      // Клиенты и оплаты — по instance если есть, иначе по groupId
      instanceId
        ? sb().from('group_clients').select('*').eq('group_instance_id',instanceId).eq('is_active',true).order('name')
        : sb().from('group_clients').select('*').eq('group_id',groupId).eq('is_active',true).order('name'),
      instanceId
        ? sb().from('group_payments').select('*').eq('group_instance_id',instanceId).eq('month',month)
        : sb().from('group_payments').select('*').eq('group_id',groupId).eq('month',month),
      sb().from('group_progress_notes').select('*').eq('group_id',groupId).eq('month',month),
      instanceId
        ? sb().from('group_attendance').select('*').eq('group_instance_id',instanceId)
            .gte('session_date',month).lt('session_date',nextMonthStr)
        : sb().from('group_attendance').select('*').eq('group_id',groupId)
            .gte('session_date',month).lt('session_date',nextMonthStr),
      // Все payouts по instance за месяц
      instanceId
        ? sb().from('group_trainer_payouts').select('*').eq('month',month).in('group_id',instanceGroupIds)
        : sb().from('group_trainer_payouts').select('*').eq('group_id',groupId).eq('month',month),
      // Все тренеры этого instance
      instanceId
        ? sb().from('trainer_groups').select('*, profiles(fio), group_types(name,type)')
            .eq('group_instance_id',instanceId).is('subscription_end',null)
        : sb().from('trainer_groups').select('*, profiles(fio), group_types(name,type)')
            .eq('id',groupId).is('subscription_end',null),
      // Занятия (для ставки по сессиям) — строго по этому инстансу.
      // Фильтр по group_instance_id, чтобы занятия того же тренера в ДРУГОЙ группе
      // не попадали в чужой отчёт. Fallback по trainer_id — для старых записей без
      // instance (в т.ч. взрослые headcount-записи logGroupSession).
      instanceId
        ? sb().from('group_sessions').select('*')
            .gte('session_date',month).lt('session_date',nextMonthStr)
            .or(`group_instance_id.eq.${instanceId},and(group_instance_id.is.null,trainer_id.in.(${instanceTrainerIds.join(',')||0}))`)
        : sb().from('group_sessions').select('*')
            .gte('session_date',month).lt('session_date',nextMonthStr)
            .eq('trainer_id', tgRow?.trainer_id),
      // Замены за месяц (по всем group_id instance)
      instanceId
        ? sb().from('group_substitutions').select('*, substitute:profiles!substitute_trainer_id(fio), original:profiles!original_trainer_id(fio)')
            .in('group_id', instanceGroupIds.length ? instanceGroupIds : [groupId])
            .gte('session_date',month).lt('session_date',nextMonthStr)
        : sb().from('group_substitutions').select('*, substitute:profiles!substitute_trainer_id(fio), original:profiles!original_trainer_id(fio)')
            .eq('group_id',groupId)
            .gte('session_date',month).lt('session_date',nextMonthStr),
    ]);

    return {
      clients:          clients.data||[],
      payments:         payments.data||[],
      notes:            notes.data||[],
      attendance:       attendance.data||[],
      payouts:          payouts.data||[],
      trainers:         instanceTrainers.data||[tgRow].filter(Boolean),
      instanceSessions: instanceSessions.data||[],
      substitutions:    substitutions.data||[],
      groupTypeInfo:    tgRow?.group_types||null,
    };
    });
  },

  async updateGroupSubstitutionRate(id, rate) {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_substitutions').update({rate}).eq('id',id);
    if (error) throw error;
  },

  // ─── PT SUBSTITUTIONS FOR MONTH ─────────────
  async getPTSubstitutionsForMonth(branch, year, month) {
    const from = new Date(year,month-1,1).toISOString();
    const to   = new Date(year,month,  1).toISOString();
    const {data,error} = await sb().from('workouts')
      .select('*, clients(fio), profiles!trainer_id(fio), sub_profile:profiles!substitute_for(fio)')
      .not('substitute_for','is',null)
      .eq('pending_confirmation', false)
      .gte('workout_date',from).lt('workout_date',to)
      .eq('branch',branch)
      .order('workout_date',{ascending:false});
    if (error) throw error; return data||[];
  },
  async setPTSubstituteRate(workoutId, rate) {
    const {error} = await sb().from('workouts')
      .update({substitute_rate: rate}).eq('id', workoutId);
    if (error) throw error;
  },

  // Групповые замены за месяц
  async getGroupSubstitutionsForMonth(branch, year, month) {
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const to   = new Date(year,month,1).toISOString().slice(0,10);
    const {data,error} = await sb().from('group_substitutions')
      .select('*, original:profiles!original_trainer_id(fio), substitute:profiles!substitute_trainer_id(fio), trainer_groups(*, group_types(name))')
      .gte('session_date',from).lt('session_date',to)
      .eq('trainer_groups.branch', branch)
      .order('session_date',{ascending:false});
    if (error) throw error; return data||[];
  },

  // ─── GROUP SESSIONS ──────────────────────────
  async logGroupSession(trainerId, groupTypeId, branch, date, headcount) {
    invalidateCachePrefix('grp:');
    const {data,error} = await sb().from('group_sessions')
      .insert({trainer_id:trainerId,group_type_id:groupTypeId,branch,session_date:date,headcount})
      .select().single();
    if (error) throw error; return data;
  },
  async getGroupSessions(trainerId, year, month) {
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const to   = new Date(year,month,1).toISOString().slice(0,10);
    const {data,error} = await sb().from('group_sessions')
      .select('*, group_types(name,type,billing_model)')
      .eq('trainer_id',trainerId).gte('session_date',from).lt('session_date',to)
      .order('session_date',{ascending:false});
    if (error) throw error; return data||[];
  },

  // ─── КТО ПРОВОДИЛ ДЕТСКОЕ ЗАНЯТИЕ (conducted_role) ──────────
  // Детский флоу: каждое проведённое занятие тренером инстанса = строка в group_sessions
  // с conducted_role IN ('суша','вода','процент'). NULL = взрослая запись (logGroupSession).
  // ─── ПОДГРУППЫ (персистентные, не зависят от наличия детей) ───
  // {names:[обычные подгруппы], mainLabel:строка|null} — метка главной ('') подгруппы
  async getGroupSubgroups(groupInstanceId, groupId) {
    return cached(`grp:subg:${groupInstanceId||'g'+groupId}`, async () => {
      let q = sb().from('group_subgroups').select('name,is_main');
      q = groupInstanceId ? q.eq('group_instance_id', groupInstanceId) : q.eq('group_id', groupId).is('group_instance_id', null);
      const {data,error} = await q;
      if (error) { console.warn('[getGroupSubgroups]', error.message); return {names:[], mainLabel:null}; }
      const rows = data||[];
      const mainRow = rows.find(r=>r.is_main);
      return { names: rows.filter(r=>!r.is_main).map(r=>r.name), mainLabel: mainRow?.name || null };
    });
  },
  async addGroupSubgroup(groupInstanceId, groupId, name, createdBy=null) {
    invalidateCachePrefix('grp:subg:');
    const {error} = await sb().from('group_subgroups')
      .insert({group_instance_id: groupInstanceId||null, group_id: groupInstanceId?null:groupId, name, created_by: createdBy});
    if (error && error.code!=='23505') throw error; // 23505 = уже есть, не ошибка
  },
  async removeGroupSubgroup(groupInstanceId, groupId, name) {
    invalidateCachePrefix('grp:subg:');
    let q = sb().from('group_subgroups').delete().eq('name', name).eq('is_main', false);
    q = groupInstanceId ? q.eq('group_instance_id', groupInstanceId) : q.eq('group_id', groupId).is('group_instance_id', null);
    const {error} = await q;
    if (error) throw error;
  },
  // Метка главной ('') подгруппы. label='' → вернуть к «Основная» (удалить метку).
  async setMainSubgroupLabel(groupInstanceId, groupId, label) {
    invalidateCachePrefix('grp:subg:');
    let del = sb().from('group_subgroups').delete().eq('is_main', true);
    del = groupInstanceId ? del.eq('group_instance_id', groupInstanceId) : del.eq('group_id', groupId).is('group_instance_id', null);
    await del;
    if (!label) return;
    const {error} = await sb().from('group_subgroups')
      .insert({group_instance_id: groupInstanceId||null, group_id: groupInstanceId?null:groupId, name: label, is_main: true});
    if (error && error.code!=='23505') throw error;
  },
  // Переименовать обычную подгруппу: меняем имя в group_subgroups + во всех записях детей и занятий
  async renameGroupSubgroup(groupInstanceId, groupId, oldName, newName) {
    invalidateCachePrefix('grp:');
    const matchSub = q => groupInstanceId ? q.eq('group_instance_id', groupInstanceId) : q.eq('group_id', groupId).is('group_instance_id', null);
    await matchSub(sb().from('group_subgroups').update({name:newName}).eq('name', oldName).eq('is_main', false));
    // Дети: по инстансу или по группе
    let cq = sb().from('group_clients').update({subgroup:newName}).eq('subgroup', oldName);
    cq = groupInstanceId ? cq.eq('group_instance_id', groupInstanceId) : cq.eq('group_id', groupId);
    await cq;
    // Отметки занятий (история «кто проводил») — только при инстансе
    if (groupInstanceId) {
      await sb().from('group_sessions').update({subgroup:newName})
        .eq('subgroup', oldName).eq('group_instance_id', groupInstanceId);
    }
  },
  // Отметки «кто проводил» последнего занятия ДО указанной даты (для «повторить прошлое»)
  async getLastConductedBefore(groupInstanceId, beforeDate) {
    const {data,error} = await sb().from('group_sessions')
      .select('trainer_id,conducted_role,subgroup,session_date,headcount')
      .eq('group_instance_id', groupInstanceId)
      .not('conducted_role','is',null)
      .lt('session_date', beforeDate)
      .order('session_date',{ascending:false}).limit(50);
    if (error) throw error;
    const rows = data||[];
    if (!rows.length) return {date:null, rows:[]};
    const lastDate = rows[0].session_date;
    return {date:lastDate, rows: rows.filter(r=>r.session_date===lastDate)};
  },
  async getGroupConductedByDate(groupInstanceId, date) {
    // select('*') — безопасно и до миграции subgroup (явный список колонок упал бы)
    const {data,error} = await sb().from('group_sessions')
      .select('*')
      .eq('group_instance_id', groupInstanceId).eq('session_date', date)
      .not('conducted_role','is',null);
    if (error) throw error; return data||[];
  },
  async setGroupConducted(trainerId, groupTypeId, branch, date, headcount, conductedRole, groupInstanceId, subgroup='') {
    invalidateCachePrefix('grp:');
    // subgroup ВСЕГДА в payload ('' = основная) — уникальный индекс из 6 колонок
    const {data,error} = await sb().from('group_sessions')
      .upsert({trainer_id:trainerId, group_type_id:groupTypeId, branch,
               session_date:date, headcount,
               conducted_role:conductedRole, group_instance_id:groupInstanceId||null,
               subgroup: subgroup||''},
              {onConflict:'trainer_id,session_date,group_type_id,branch,conducted_role,subgroup'})
      .select().single();
    if (error) throw error; return data;
  },
  async removeGroupConducted(trainerId, groupTypeId, branch, date, conductedRole, subgroup='') {
    invalidateCachePrefix('grp:');
    const {error} = await sb().from('group_sessions').delete()
      .eq('trainer_id',trainerId).eq('group_type_id',groupTypeId).eq('branch',branch)
      .eq('session_date',date).eq('conducted_role',conductedRole)
      .eq('subgroup', subgroup||'');
    if (error) throw error;
  },
  // Активные группы филиала (строки trainer_groups) — для формы «второй тренер» у старшего
  async getActiveGroupsByBranch(branch) {
    const {data,error} = await sb().from('trainer_groups')
      .select('id, group_type_id, branch, group_instance_id, role, profiles(fio), group_types(name,type)')
      .eq('branch', branch).is('subscription_end',null)
      .order('group_type_id');
    if (error) throw error; return data||[];
  },
});
