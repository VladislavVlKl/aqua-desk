// ─── ТЕХНИЧКА ────────────────────────────────
Object.assign(DB, {
  async getTechEquipment(branch) {
    let q = sb().from('tech_equipment').select('*').order('category').order('name');
    if (branch) q = q.eq('branch',branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addTechEquipment(fields) {
    const {data,error} = await sb().from('tech_equipment')
      .insert(fields).select().single();
    if (error) throw error; return data;
  },
  async updateTechEquipment(id, fields) {
    const {error} = await sb().from('tech_equipment').update(fields).eq('id',id);
    if (error) throw error;
  },
  async deleteTechEquipment(id) {
    const {error} = await sb().from('tech_equipment').delete().eq('id',id);
    if (error) throw error;
  },
  async getTechIssues(branch) {
    let q = sb().from('tech_issues').select('*, tech_equipment(name)').neq('status','resolved').order('priority').order('created_at',{ascending:false});
    if (branch) q = q.eq('branch',branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addTechIssue(fields) {
    const {data,error} = await sb().from('tech_issues')
      .insert(fields).select().single();
    if (error) throw error; return data;
  },
  async updateTechIssue(id, fields) {
    const {error} = await sb().from('tech_issues').update(fields).eq('id',id);
    if (error) throw error;
  },
  async getTechShopping(branch) {
    let q = sb().from('tech_shopping').select('*').neq('status','received').order('priority').order('created_at',{ascending:false});
    if (branch) q = q.eq('branch',branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addTechShopping(fields) {
    const {data,error} = await sb().from('tech_shopping')
      .insert(fields).select().single();
    if (error) throw error; return data;
  },
  async updateTechShopping(id, fields) {
    const {error} = await sb().from('tech_shopping').update(fields).eq('id',id);
    if (error) throw error;
  },
  async getTechBills(branch) {
    let q = sb().from('tech_bills').select('*').order('bill_date',{ascending:false});
    if (branch) q = q.eq('branch',branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addTechBill(fields) {
    const {data,error} = await sb().from('tech_bills')
      .insert(fields).select().single();
    if (error) throw error; return data;
  },
  async updateTechBill(id, fields) {
    const {error} = await sb().from('tech_bills').update(fields).eq('id',id);
    if (error) throw error;
  },
  async getDutiesForSchedule(branch, from, to) {
    const {data,error} = await sb().from('duties')
      .select('*, profiles(fio)')
      .eq('branch',branch)
      .gte('start_time',from)
      .lt('start_time',to)
      .not('end_time','is',null)
      .order('start_time',{ascending:true});
    if (error) throw error; return data||[];
  },
  // ─── ЦВЕТА КЛИЕНТОВ ──────────────────────────
  async updateClientColor(clientId, color) {
    const {error} = await sb().from('clients')
      .update({color: color || null}).eq('id', clientId);
    if (error) throw error;
  },

  // ─── УВЕДОМЛЕНИЯ ВНУТРИ ПРИЛОЖЕНИЯ ───────────
  async getMyNotifications(tgId) {
    const {data,error} = await sb().from('notifications_queue')
      .select('*').eq('recipient_tg_id', tgId)
      .order('created_at',{ascending:false}).limit(30);
    if (error) throw error; return data||[];
  },
  async markNotificationsRead(tgId) {
    const {error} = await sb().from('notifications_queue')
      .update({read_at: new Date().toISOString()})
      .eq('recipient_tg_id', tgId).is('read_at', null);
    if (error) throw error;
  },

  // ─── ЗАПРОСЫ НА УДАЛЕНИЕ КЛИЕНТА ─────────────
  async createDeleteRequest(clientId, clientName, requestedBy, branch) {
    const {data:existing} = await sb().from('delete_requests')
      .select('id').eq('client_id',clientId).eq('status','pending').limit(1);
    if (existing?.length) throw new Error('already_pending');
    const {data,error} = await sb().from('delete_requests')
      .insert({client_id:clientId, client_name:clientName,
               requested_by:requestedBy, branch, status:'pending'})
      .select().single();
    if (error) throw error; return data;
  },
  async getDeleteRequests(branch) {
    const {data,error} = await sb().from('delete_requests')
      .select('*, profiles!requested_by(fio)')
      .eq('status','pending')
      .eq('branch', branch)
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async getAllDeleteRequests() {
    const {data,error} = await sb().from('delete_requests')
      .select('*, profiles!requested_by(fio), clients!client_id(balance, subscription_end)')
      .eq('status','pending')
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async approveDeleteRequest(requestId, clientId) {
    await sb().from('delete_requests').update({status:'approved'}).eq('id',requestId);
    await this.forceDeleteClient(clientId);
  },
  async forceDeleteClient(clientId) {
    // Правильный порядок: сначала дочерние таблицы, потом родительские
    // session_notes ссылается на workouts — удаляем ДО workouts
    await sb().from('schedule_slots').delete().eq('client_id', clientId);
    await sb().from('session_notes').delete().eq('client_id', clientId);
    await sb().from('workouts').delete().eq('client_id', clientId);
    await sb().from('client_transfers').delete().eq('client_id', clientId);
    await sb().from('training_goals').delete().eq('client_id', clientId);
    // Дополнительно чистим по subscription_id
    const {data:subs} = await sb().from('subscriptions').select('id').eq('client_id',clientId);
    if (subs?.length) {
      for (const s of subs) {
        await sb().from('training_goals').delete().eq('subscription_id', s.id);
        await sb().from('session_notes').delete().eq('subscription_id', s.id);
      }
    }
    await sb().from('subscriptions').delete().eq('client_id', clientId);
    await sb().from('delete_requests').delete().eq('client_id', clientId);
    const {error} = await sb().from('clients').delete().eq('id', clientId);
    if (error) throw error;
  },
  async rejectDeleteRequest(requestId) {
    const {error} = await sb().from('delete_requests')
      .update({status:'rejected'}).eq('id',requestId);
    if (error) throw error;
  },

  // ─── ЗАПРОСЫ НА УДАЛЕНИЕ ТРЕНИРОВОК ─────────
  async requestWorkoutDelete(workoutId, trainerId, clientName, workoutDate, branch) {
    const {data:existing} = await sb().from('workout_delete_requests')
      .select('id').eq('workout_id',workoutId).eq('status','pending').limit(1);
    if (existing?.length) throw new Error('already_pending');
    const {error} = await sb().from('workout_delete_requests')
      .insert({workout_id:workoutId, trainer_id:trainerId, client_name:clientName,
               workout_date:workoutDate, branch, status:'pending'});
    if (error) throw error;
  },
  async getWorkoutDeleteRequests(branch) {
    const {data,error} = await sb().from('workout_delete_requests')
      .select('*, profiles!trainer_id(fio)')
      .eq('status','pending').eq('branch',branch)
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async getAllWorkoutDeleteRequests() {
    const {data,error} = await sb().from('workout_delete_requests')
      .select('*, profiles!trainer_id(fio)')
      .eq('status','pending')
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async approveWorkoutDeleteRequest(reqId, workoutId) {
    // Закрываем все pending-запросы на эту тренировку ДО удаления (иначе CASCADE сотрёт их)
    await sb().from('workout_delete_requests').update({status:'approved'}).eq('workout_id',workoutId).eq('status','pending');
    await this.deleteWorkout(workoutId);
  },
  async rejectWorkoutDeleteRequest(reqId) {
    const {error} = await sb().from('workout_delete_requests').update({status:'rejected'}).eq('id',reqId);
    if (error) throw error;
  },

  // ─── РЕЕСТР (AUDIT LOG) ──────────────────────
  async auditLog(action, actorId, actorFio, targetId, targetType, details, branch) {
    // Fire-and-forget: никогда не бросает исключение наружу
    try {
      await sb().from('audit_log').insert({
        action,
        actor_id: actorId || null,
        actor_fio: actorFio || null,
        target_id: targetId ? String(targetId) : null,
        target_type: targetType || null,
        details: details || {},
        branch: branch || null,
      });
    } catch(e) { console.error('[audit]', e); }
  },
  async getAuditLog({ branch, actorId, action, limit = 200 } = {}) {
    let q = sb().from('audit_log').select('*')
      .order('created_at', { ascending: false }).limit(limit);
    if (branch)   q = q.eq('branch', branch);
    if (actorId)  q = q.eq('actor_id', actorId);
    if (action)   q = q.eq('action', action);
    const { data, error } = await q;
    if (error) throw error;
    return data || [];
  },

  // ─── ВЗРОСЛЫЕ ГРУППЫ — КЛИЕНТЫ ───────────────
  async getAdultGroupClients(groupId) {
    const {data,error} = await sb().from('adult_group_clients')
      .select('*').eq('group_id',groupId).eq('is_active',true).order('name');
    if (error) throw error; return data||[];
  },
  async addAdultGroupClient(groupId, name) {
    invalidateCachePrefix('grp:');
    const {data,error} = await sb().from('adult_group_clients')
      .insert({group_id:groupId, name}).select().single();
    if (error) throw error; return data;
  },
  async archiveAdultGroupClient(id) {
    const {error} = await sb().from('adult_group_clients')
      .update({is_active:false}).eq('id',id);
    if (error) throw error;
  },

  // ─── ЗАМЕНА В ГРУППАХ ────────────────────────
  async createGroupSubstitution(groupId, originalTrainerId, substituteTrainerId, sessionDate) {
    invalidateCachePrefix('grp:');
    const {data,error} = await sb().from('group_substitutions')
      .insert({group_id:groupId, original_trainer_id:originalTrainerId,
               substitute_trainer_id:substituteTrainerId,
               session_date:sessionDate, status:'pending'})
      .select('*, trainer_groups(branch, group_types(name)), original:profiles!original_trainer_id(fio), substitute:profiles!substitute_trainer_id(fio)').single();
    if (error) throw error;
    // Уведомить подтверждающих филиала: всех координаторов + старшего тренера (если есть).
    // Кто первый подтвердит — тот и подтвердит (approveSubstitution идемпотентен).
    try {
      const branch  = data.trainer_groups?.branch;
      const grpName = data.trainer_groups?.group_types?.name || 'группа';
      const subFio  = data.substitute?.fio || 'тренер';
      const origFio = data.original?.fio || 'тренер';
      const approvers = await DB.getBranchApprovers(branch);
      const msg = `🔄 Замена на подтверждение: ${subFio} вместо ${origFio} · ${grpName} · ${sessionDate}${branch?` · ${branch}`:''}. Подтвердите во вкладке «Контроль».`;
      await Promise.all(approvers.map(a => DB.enqueueTrainerNotification(a.id, msg, 'substitution_approve')));
    } catch(e) { console.error('[sub-notify]', e); }
    return data;
  },
  // Подтверждающие замены: координаторы (все филиалы) + старшие тренеры данного филиала.
  async getBranchApprovers(branch) {
    const {data,error} = await sb().from('profiles')
      .select('id,role,branches,tg_id').eq('is_archived',false)
      .in('role',['admin','senior_trainer']);
    if (error) throw error;
    return (data||[]).filter(p => p.role==='admin' || (p.branches||[]).includes(branch));
  },
  // История замен группы (по всем строкам инстанса), новые сверху
  async getGroupSubstitutionsHistory(groupId) {
    const {data:tg} = await sb().from('trainer_groups').select('group_instance_id').eq('id',groupId).single();
    let gIds = [groupId];
    if (tg?.group_instance_id) {
      const {data:rows} = await sb().from('trainer_groups').select('id').eq('group_instance_id',tg.group_instance_id);
      gIds = (rows||[]).map(r=>r.id);
    }
    const {data,error} = await sb().from('group_substitutions')
      .select('*, original:profiles!original_trainer_id(fio), substitute:profiles!substitute_trainer_id(fio)')
      .in('group_id', gIds)
      .order('session_date',{ascending:false});
    if (error) throw error; return data||[];
  },
  async getPendingSubstitutions(branch) {
    const {data,error} = await sb().from('group_substitutions')
      .select('*, original:profiles!original_trainer_id(fio), substitute:profiles!substitute_trainer_id(fio), trainer_groups(*, group_types(name))')
      .eq('status','pending')
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async approveSubstitution(id, rate) {
    invalidateCachePrefix('grp:');
    // Идемпотентно: одобряем только если запись ещё pending → «кто первый, тот подтвердил».
    const {data,error} = await sb().from('group_substitutions')
      .update({status:'approved', rate}).eq('id',id).eq('status','pending').select('id');
    if (error) throw error;
    return (data||[]).length > 0;   // false → уже подтвердил кто-то другой
  },
});
