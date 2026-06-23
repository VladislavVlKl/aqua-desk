Object.assign(DB, {
  // ─── УВЕДОМЛЕНИЯ ─────────────────────────────
  async getNotificationRules() {
    const {data,error} = await sb().from('notification_rules').select('*').order('id');
    if (error) throw error; return data||[];
  },
  async toggleRule(id, active) {
    const {error} = await sb().from('notification_rules').update({active}).eq('id',id);
    if (error) throw error;
  },
  async queueBroadcast(profiles, message, scheduledFor, createdBy) {
    const rows = profiles.map(p=>({
      recipient_tg_id: p.tg_id,
      recipient_name:  p.fio,
      message,
      scheduled_for:   scheduledFor||new Date().toISOString(),
      created_by:      createdBy,
      status:          'pending',
    }));
    const {error} = await sb().from('notifications_queue').insert(rows);
    if (error) throw error; return rows.length;
  },
  async getRecentNotifications(limit=30) {
    const {data,error} = await sb().from('notifications_queue')
      .select('*').order('created_at',{ascending:false}).limit(limit);
    if (error) throw error; return data||[];
  },

  // ─── ЗАМЕНЫ И ПЕРЕДАЧА ───────────────────────

  /** Создать ПТ-замену (ЗП тренеру Б, ждёт подтверждения) */
  async logSubstituteWorkout(rows, substituteForId, toBTrainerId) {
    const subRows = rows.map(r => ({
      ...r,
      trainer_id:           toBTrainerId,
      substitute_for:       substituteForId,
      pending_confirmation: true,   // ждёт подтверждения тренера Б
      // в очередь ресепшена попадёт после тренера Б — только если фича включена
      ...(RECEPTION_SUBMIT_ENABLED ? {reception_status:'pending'} : {}),
    }));
    const {data,error} = await sb().from('workouts').insert(subRows).select('*, clients(fio), a:profiles!substitute_for(fio)');
    if (error) throw error;
    const w0 = data?.[0];
    const cFio = w0?.clients?.fio || 'клиента';
    const aFio = w0?.a?.fio || 'Тренер';
    const n = data?.length || 1;
    DB.enqueueTrainerNotification(toBTrainerId,
      `⚡ ${aFio} записал(а) на вас замену${n>1?` (${n} тренировок)`:''}: ${cFio}. Подтвердите во вкладке «Отчёт».`,
      'substitution');
    return data;
  },

  /** Тренировки ожидающие подтверждения у тренера */
  async getPendingConfirmations(trainerId) {
    const {data,error} = await sb().from('workouts')
      .select('*, clients(fio), profiles!substitute_for(fio)')
      .eq('trainer_id', trainerId)
      .eq('pending_confirmation', true)
      .order('workout_date',{ascending:false});
    if (error) throw error; return data||[];
  },

  /** Подтвердить/отклонить замену */
  async resolveSubstitute(workoutId, clientId, confirmed) {
    if (confirmed) {
      // Подтвердить — снять с баланса клиента
      const {error} = await sb().from('workouts')
        .update({pending_confirmation:false}).eq('id',workoutId);
      if (error) throw error;
      const {data:cl} = await sb().from('clients').select('balance').eq('id',clientId).single();
      await sb().from('clients')
        .update({balance:Math.max(0,(cl?.balance||0)-1),last_used:new Date().toISOString()})
        .eq('id',clientId);
    } else {
      // Отклонить — удалить запись
      const {error} = await sb().from('workouts').delete().eq('id',workoutId);
      if (error) throw error;
    }
  },

  /** Инициировать передачу клиента */
  async initiateTransfer(clientId, fromId, toId, initiatedBy, note='') {
    const {data,error} = await sb().from('client_transfers')
      .insert({client_id:clientId,from_trainer_id:fromId,to_trainer_id:toId,
               initiated_by:initiatedBy,status:'pending',note:note||null})
      .select('*, clients(fio), from:profiles!from_trainer_id(fio)').single();
    if (error) throw error;
    const cFio = data?.clients?.fio || 'клиента';
    const fromFio = data?.from?.fio || 'тренер';
    DB.enqueueTrainerNotification(toId,
      `👤 ${fromFio} передаёт вам клиента: ${cFio}.${note?` Комментарий: ${note}.`:''} Подтвердите во вкладке «Отчёт».`,
      'client_transfer');
    return data;
  },

  /** Входящие запросы на передачу (для тренера Б) */
  async getIncomingTransfers(trainerId) {
    const {data,error} = await sb().from('client_transfers')
      .select('*, clients(fio,category,balance), profiles!from_trainer_id(fio)')
      .eq('to_trainer_id',trainerId).eq('status','pending')
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },

  /** Подтвердить/отклонить передачу */
  async resolveTransfer(transferId, clientId, toTrainerId, confirmed) {
    const status = confirmed ? 'confirmed' : 'rejected';
    const {error:e1} = await sb().from('client_transfers')
      .update({status,resolved_at:new Date().toISOString()}).eq('id',transferId);
    if (e1) throw e1;
    if (confirmed) {
      const {error:e2} = await sb().from('clients')
        .update({trainer_id:toTrainerId}).eq('id',clientId);
      if (e2) throw e2;
    }
  },

  /** Административная передача без подтверждения */
  async adminTransfer(clientId, toTrainerId, adminId, note='') {
    await sb().from('client_transfers')
      .insert({client_id:clientId,from_trainer_id:0,to_trainer_id:toTrainerId,
               initiated_by:adminId,status:'admin',note:note||null});
    const {error} = await sb().from('clients')
      .update({trainer_id:toTrainerId}).eq('id',clientId);
    if (error) throw error;
  },

  // ─── РЕСЕПШН: ПОДТВЕРЖДЕНИЕ СПИСАНИЙ (Шаг 1 интеграции с 1С) ───
  // workouts/trial_sessions.reception_status: pending → confirmed | rejected.
  // Замена (pending_confirmation=true) попадает в очередь только после тренера Б.
  _dayRange(dateStr) {
    return [`${dateStr}T00:00:00+05:00`, `${dateStr}T23:59:59+05:00`];
  },

  /** Очередь pending филиала за день: ПТ + пробные */
  async getReceptionPending(branch, dateStr) {
    const [from, to] = this._dayRange(dateStr);
    const wq = sb().from('workouts')
      .select('*, clients(fio,age), profiles!trainer_id(fio)')
      .eq('branch', branch).eq('reception_status','pending').eq('pending_confirmation', false)
      .gte('workout_date', from).lte('workout_date', to)
      .order('workout_date',{ascending:true});
    const tq = sb().from('trial_sessions')
      .select('*, profiles!trainer_id(fio)')
      .eq('branch', branch).eq('reception_status','pending')
      .gte('session_date', from).lte('session_date', to)
      .order('session_date',{ascending:true});
    const [w, t] = await Promise.all([wq, tq]);
    if (w.error) throw w.error; if (t.error) throw t.error;
    return { workouts: w.data||[], trials: t.data||[] };
  },

  /** Количество pending за день (для бейджа) */
  async getReceptionPendingCount(branch, dateStr) {
    const [from, to] = this._dayRange(dateStr);
    const wq = sb().from('workouts').select('id',{count:'exact',head:true})
      .eq('branch',branch).eq('reception_status','pending').eq('pending_confirmation',false)
      .gte('workout_date',from).lte('workout_date',to);
    const tq = sb().from('trial_sessions').select('id',{count:'exact',head:true})
      .eq('branch',branch).eq('reception_status','pending')
      .gte('session_date',from).lte('session_date',to);
    const [w, t] = await Promise.all([wq, tq]);
    return (w.count||0) + (t.count||0);
  },

  /** Подтвердить ПТ */
  async confirmWorkout(id, receptionId) {
    const {error} = await sb().from('workouts')
      .update({reception_status:'confirmed', reception_by:receptionId, reception_at:new Date().toISOString()})
      .eq('id',id).eq('reception_status','pending');
    if (error) throw error;
  },

  /** Отклонить ПТ — статус rejected + откат баланса по типу */
  async rejectWorkout(id, receptionId, reasonCode) {
    const {data:w, error:ge} = await sb().from('workouts')
      .select('id,client_id,is_debt,is_drop_in,reception_status').eq('id',id).single();
    if (ge) throw ge;
    if (w.reception_status!=='pending') return;  // уже обработана
    const {error} = await sb().from('workouts')
      .update({reception_status:'rejected', reception_reason:reasonCode||null,
               reception_by:receptionId, reception_at:new Date().toISOString()})
      .eq('id',id).eq('reception_status','pending');
    if (error) throw error;
    // Обычная ПТ (и подтверждённая замена) списывала баланс → вернуть +1.
    // Долг/разовое баланс не трогали.
    if (!w.is_debt && !w.is_drop_in) {
      await sb().rpc('increment_balance', {client_id: w.client_id, delta: +1});
    }
    // Разовое ребёнка пометило drop_in_used → сбросить
    if (w.is_drop_in) {
      const {data:cl} = await sb().from('clients').select('age,drop_in_used').eq('id',w.client_id).single();
      if (cl && isChild(cl.age) && cl.drop_in_used)
        await sb().from('clients').update({drop_in_used:false}).eq('id',w.client_id);
    }
  },

  /** Подтвердить пробную */
  async confirmTrial(id, receptionId) {
    const {error} = await sb().from('trial_sessions')
      .update({reception_status:'confirmed', reception_by:receptionId, reception_at:new Date().toISOString()})
      .eq('id',id).eq('reception_status','pending');
    if (error) throw error;
  },

  /** Отклонить пробную — баланс не трогает */
  async rejectTrial(id, receptionId, reasonCode) {
    const {error} = await sb().from('trial_sessions')
      .update({reception_status:'rejected', reception_reason:reasonCode||null,
               reception_by:receptionId, reception_at:new Date().toISOString()})
      .eq('id',id).eq('reception_status','pending');
    if (error) throw error;
  },

  /** Подтвердить всё за день (ПТ + пробные) */
  async confirmAllReception(branch, dateStr, receptionId) {
    const [from, to] = this._dayRange(dateStr);
    const ts = new Date().toISOString();
    const {error:we} = await sb().from('workouts')
      .update({reception_status:'confirmed', reception_by:receptionId, reception_at:ts})
      .eq('branch',branch).eq('reception_status','pending').eq('pending_confirmation',false)
      .gte('workout_date',from).lte('workout_date',to);
    if (we) throw we;
    const {error:te} = await sb().from('trial_sessions')
      .update({reception_status:'confirmed', reception_by:receptionId, reception_at:ts})
      .eq('branch',branch).eq('reception_status','pending')
      .gte('session_date',from).lte('session_date',to);
    if (te) throw te;
  },

  /** Отклонённые за период (по дате решения reception_at) */
  async getReceptionRejected(branch, fromDate, toDate) {
    const from = `${fromDate}T00:00:00+05:00`, to = `${toDate}T23:59:59+05:00`;
    let wq = sb().from('workouts')
      .select('*, clients(fio), profiles!trainer_id(fio)')
      .eq('reception_status','rejected')
      .gte('reception_at',from).lte('reception_at',to)
      .order('reception_at',{ascending:false});
    wq = _brFilter(wq, branch);
    let tq = sb().from('trial_sessions')
      .select('*, profiles!trainer_id(fio)')
      .eq('reception_status','rejected')
      .gte('reception_at',from).lte('reception_at',to)
      .order('reception_at',{ascending:false});
    tq = _brFilter(tq, branch);
    const [w, t] = await Promise.all([wq, tq]);
    if (w.error) throw w.error; if (t.error) throw t.error;
    return { workouts:w.data||[], trials:t.data||[] };
  },

  /** Подтверждённые за период (вкладка «История») */
  async getReceptionConfirmed(branch, fromDate, toDate) {
    const from = `${fromDate}T00:00:00+05:00`, to = `${toDate}T23:59:59+05:00`;
    const wq = sb().from('workouts')
      .select('*, clients(fio), profiles!trainer_id(fio)')
      .eq('branch',branch).eq('reception_status','confirmed')
      .gte('reception_at',from).lte('reception_at',to)
      .order('reception_at',{ascending:false}).limit(300);
    const tq = sb().from('trial_sessions')
      .select('*, profiles!trainer_id(fio)')
      .eq('branch',branch).eq('reception_status','confirmed')
      .gte('reception_at',from).lte('reception_at',to)
      .order('reception_at',{ascending:false}).limit(300);
    const [w, t] = await Promise.all([wq, tq]);
    if (w.error) throw w.error; if (t.error) throw t.error;
    return { workouts:w.data||[], trials:t.data||[] };
  },

  /** Все висящие pending филиала (для эскалации в «Контроле» координатора) */
  async getReceptionHanging(branch) {
    let wq = sb().from('workouts')
      .select('id,branch,workout_date,trainer_id,profiles!trainer_id(fio)')
      .eq('reception_status','pending').eq('pending_confirmation',false)
      .order('workout_date',{ascending:true});
    wq = _brFilter(wq, branch);
    const {data,error} = await wq;
    if (error) throw error; return data||[];
  },

  /** Статистика подтверждено/отклонено по тренерам за месяц (для «Контроля») */
  async getReceptionStats(branch, year, month) {
    const from = new Date(year,month-1,1).toISOString();
    const to   = new Date(year,month,  1).toISOString();
    let q = sb().from('workouts')
      .select('trainer_id, reception_status, reception_reason, profiles!trainer_id(fio)')
      .gte('workout_date',from).lt('workout_date',to);
    q = _brFilter(q, branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },

  /** Детские группы филиала с оплатами за месяц (вкладка «Группы» ресепшена) */
  async getReceptionGroups(branch, month) {
    const groups = await this.getActiveGroupsByBranch(branch);
    const child = groups.filter(g=>g.group_types?.type==='children');
    const seen = new Set(), uniq = [];
    for (const g of child) {
      const key = g.group_instance_id || `g${g.id}`;
      if (seen.has(key)) continue; seen.add(key); uniq.push(g);
    }
    const result = [];
    for (const g of uniq) {
      const inst = g.group_instance_id;
      const [children, payments] = await Promise.all([
        inst ? this.getGroupClientsByInstance(inst) : this.getGroupClients(g.id),
        inst ? this.getGroupPaymentsByInstance(inst, month) : this.getGroupPayments(g.id, month),
      ]);
      const payMap = Object.fromEntries(payments.map(p=>[p.group_client_id, p]));
      result.push({
        groupId: g.id, instanceId: inst,
        name: g.group_types?.name||'Группа', trainer: g.profiles?.fio||'',
        children: children.map(c=>({
          id: c.id, name: c.name,
          monthly_price: c.monthly_price||0,
          paid: !!payMap[c.id]?.paid,
          amount: payMap[c.id]?.amount || c.monthly_price || 0,
        })),
      });
    }
    return result;
  },

  /** Получатели-ресепшн филиала */
  async getReceptionProfiles(branch) {
    let q = sb().from('profiles').select('id,tg_id,fio')
      .eq('role','reception').eq('is_archived',false);
    if (branch) q = q.contains('branches',[branch]);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },

  /** Уведомление «конец дня» ресепшену (дедуп по rule_key за сутки) */
  async queueReceptionEodOnce(branch, dateStr, count, createdBy) {
    const ruleKey = `reception_eod:${branch}:${dateStr}`;
    const {data:exists} = await sb().from('notifications_queue')
      .select('id').eq('rule_key',ruleKey).limit(1);
    if (exists && exists.length) return 0;  // уже поставлено сегодня
    const recs = await this.getReceptionProfiles(branch);
    if (!recs.length) return 0;
    const rows = recs.filter(r=>r.tg_id).map(r=>({
      recipient_tg_id: r.tg_id,
      recipient_name:  r.fio,
      message: `🔔 Осталось ${count} неподтверждённых списаний за сегодня (${branch}).`,
      scheduled_for: new Date().toISOString(),
      created_by: createdBy||null,
      status: 'pending',
      rule_key: ruleKey,
    }));
    if (!rows.length) return 0;
    const {error} = await sb().from('notifications_queue').insert(rows);
    if (error) throw error; return rows.length;
  },

  /** Уведомление тренеру об отклонении его списания */
  async notifyTrainerRejected(trainerId, clientName, dateStr, reasonLabel) {
    return DB.enqueueTrainerNotification(trainerId,
      `❌ Ресепшн отклонил списание: ${clientName} · ${dateStr}. Причина: ${reasonLabel}. Баланс возвращён.`,
      'reception_reject');
  },
  // Положить уведомление тренеру в очередь → бейдж колокольчика + Telegram-пуш (воркер каждые 5 мин).
  // Fire-and-forget: ошибка не должна валить основную операцию.
  async enqueueTrainerNotification(trainerId, message, ruleKey) {
    try {
      const {data:tr} = await sb().from('profiles').select('tg_id,fio').eq('id',trainerId).maybeSingle();
      if (!tr?.tg_id) return;
      await sb().from('notifications_queue').insert({
        recipient_tg_id: tr.tg_id,
        recipient_name:  tr.fio,
        message,
        scheduled_for: new Date().toISOString(),
        status: 'pending',
        rule_key: ruleKey || 'system',
      });
    } catch(e) { console.error('[notify]', e); }
  },
});
