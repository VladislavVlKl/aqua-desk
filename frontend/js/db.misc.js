// ─── ТЕХНИЧКА ────────────────────────────────
Object.assign(DB, {
  async getTechEquipment(branch) {
    if (useApi('tech')) return await api('/ops/tech-equipment', { query: { branch: branch || undefined } });
    let q = sb().from('tech_equipment').select('*').order('category').order('name');
    if (branch) q = q.eq('branch',branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addTechEquipment(fields) {
    if (useApi('tech')) return await api('/ops/tech-equipment', { method:'POST', body: fields });
    const {data,error} = await sb().from('tech_equipment')
      .insert(fields).select().single();
    if (error) throw error; return data;
  },
  async updateTechEquipment(id, fields) {
    if (useApi('tech')) { await api('/ops/tech-equipment/'+id+'/update', { method:'POST', body: fields }); return; }
    const {error} = await sb().from('tech_equipment').update(fields).eq('id',id);
    if (error) throw error;
  },
  async deleteTechEquipment(id) {
    if (useApi('tech')) { await api('/ops/tech-equipment/'+id+'/delete', { method:'POST' }); return; }
    const {error} = await sb().from('tech_equipment').delete().eq('id',id);
    if (error) throw error;
  },
  async getTechIssues(branch) {
    if (useApi('tech')) {
      // Бэкенд: только открытые + плоское equipment_name → эмбед tech_equipment{name}.
      const rows = await api('/ops/tech-issues', { query: { branch: branch || undefined } });
      return (rows || []).map(r => ({ ...r, tech_equipment: { name: r.equipment_name } }));
    }
    let q = sb().from('tech_issues').select('*, tech_equipment(name)').neq('status','resolved').order('priority').order('created_at',{ascending:false});
    if (branch) q = q.eq('branch',branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addTechIssue(fields) {
    if (useApi('tech')) return await api('/ops/tech-issues', { method:'POST', body: fields });
    const {data,error} = await sb().from('tech_issues')
      .insert(fields).select().single();
    if (error) throw error; return data;
  },
  async updateTechIssue(id, fields) {
    if (useApi('tech')) { await api('/ops/tech-issues/'+id+'/update', { method:'POST', body: fields }); return; }
    const {error} = await sb().from('tech_issues').update(fields).eq('id',id);
    if (error) throw error;
  },
  async getTechShopping(branch) {
    if (useApi('tech')) return await api('/ops/tech-shopping', { query: { branch: branch || undefined } });
    let q = sb().from('tech_shopping').select('*').neq('status','received').order('priority').order('created_at',{ascending:false});
    if (branch) q = q.eq('branch',branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addTechShopping(fields) {
    if (useApi('tech')) return await api('/ops/tech-shopping', { method:'POST', body: fields });
    const {data,error} = await sb().from('tech_shopping')
      .insert(fields).select().single();
    if (error) throw error; return data;
  },
  async updateTechShopping(id, fields) {
    if (useApi('tech')) { await api('/ops/tech-shopping/'+id+'/update', { method:'POST', body: fields }); return; }
    const {error} = await sb().from('tech_shopping').update(fields).eq('id',id);
    if (error) throw error;
  },
  // general:true → только «общие» счета (is_general), branch игнорируется.
  // general:false (по умолч.) → обычные счета филиалов, «общие» всегда исключены.
  async getTechBills(branch, {general=false}={}) {
    if (useApi('tech')) return await api('/ops/tech-bills', { query: { branch: general ? undefined : (branch || undefined), general: general ? 'true' : undefined } });
    let q = sb().from('tech_bills').select('*').order('bill_date',{ascending:false});
    if (general) {
      q = q.eq('is_general', true);
    } else {
      q = q.eq('is_general', false);
      if (branch) q = q.eq('branch', branch);
    }
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addTechBill(fields) {
    if (useApi('tech')) return await api('/ops/tech-bills', { method:'POST', body: fields });
    const {data,error} = await sb().from('tech_bills')
      .insert(fields).select().single();
    if (error) throw error; return data;
  },
  async updateTechBill(id, fields) {
    if (useApi('tech')) { await api('/ops/tech-bills/'+id+'/update', { method:'POST', body: fields }); return; }
    const {error} = await sb().from('tech_bills').update(fields).eq('id',id);
    if (error) throw error;
  },
  async deleteTechBill(id) {
    if (useApi('tech')) { await api('/ops/tech-bills/'+id+'/delete', { method:'POST' }); return; }
    const {error} = await sb().from('tech_bills').delete().eq('id',id);
    if (error) throw error;
  },
  async getChlorineOrders(branch) {
    if (useApi('tech')) return await api('/ops/chlorine', { query: { branch: branch || undefined } });
    let q = sb().from('chlorine_orders').select('*').order('order_date',{ascending:false});
    if (branch) q = q.eq('branch', branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async addChlorineOrder(fields) {
    if (useApi('tech')) return await api('/ops/chlorine', { method:'POST', body: fields });
    const {data,error} = await sb().from('chlorine_orders').insert(fields).select().single();
    if (error) throw error; return data;
  },
  async deleteChlorineOrder(id) {
    if (useApi('tech')) { await api('/ops/chlorine/'+id+'/delete', { method:'POST' }); return; }
    const {error} = await sb().from('chlorine_orders').delete().eq('id',id);
    if (error) throw error;
  },
  async getDutiesForSchedule(branch, from, to) {
    if (useApi('schedule')) {
      const rows = await api('/duties/schedule', { query: { branch, from, to } });
      return (rows || []).map(r => ({ ...r, profiles: { fio: r.trainer_fio } }));
    }
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
    if (useApi('clients')) { await api('/clients/'+clientId, { method:'PATCH', body:{ color: color || null } }); return; }
    const {error} = await sb().from('clients')
      .update({color: color || null}).eq('id', clientId);
    if (error) throw error;
  },

  // ─── УВЕДОМЛЕНИЯ ВНУТРИ ПРИЛОЖЕНИЯ ───────────
  async getMyNotifications(tgId) {
    if (useApi('notifications')) return await api('/notifications', { query: { recipient_tg_id: tgId, limit: 30 } });
    const {data,error} = await sb().from('notifications_queue')
      .select('*').eq('recipient_tg_id', tgId)
      .order('created_at',{ascending:false}).limit(30);
    if (error) throw error; return data||[];
  },
  async markNotificationsRead(tgId) {
    if (useApi('notifications')) { await api('/notifications/read', { method:'POST', body:{ recipient_tg_id: tgId } }); return; }
    const {error} = await sb().from('notifications_queue')
      .update({read_at: new Date().toISOString()})
      .eq('recipient_tg_id', tgId).is('read_at', null);
    if (error) throw error;
  },

  // ─── ЗАПРОСЫ НА УДАЛЕНИЕ КЛИЕНТА ─────────────
  async createDeleteRequest(clientId, clientName, requestedBy, branch) {
    if (useApi('requests')) {
      return await api('/requests/delete', { method:'POST', body:{ client_id: clientId, client_name: clientName, branch } });
    }
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
    if (useApi('requests')) {
      const rows = await api('/requests/delete', { query: { status: 'pending', branch } });
      return (rows || []).map(r => ({ ...r, profiles: { fio: r.requester_fio } }));
    }
    const {data,error} = await sb().from('delete_requests')
      .select('*, profiles!requested_by(fio)')
      .eq('status','pending')
      .eq('branch', branch)
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async getAllDeleteRequests() {
    if (useApi('requests')) {
      const rows = await api('/requests/delete', { query: { status: 'pending' } });
      return (rows || []).map(r => ({ ...r,
        profiles: { fio: r.requester_fio },
        clients: { balance: r.client_balance, subscription_end: r.client_sub_end } }));
    }
    const {data,error} = await sb().from('delete_requests')
      .select('*, profiles!requested_by(fio), clients!client_id(balance, subscription_end)')
      .eq('status','pending')
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async approveDeleteRequest(requestId, clientId) {
    // В api-режиме бэкенд делает и смену статуса, и forceDeleteClient (ручной каскад).
    if (useApi('requests')) { await api('/requests/delete/'+requestId+'/approve', { method:'POST' }); return; }
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
    if (useApi('requests')) { await api('/requests/delete/'+requestId+'/reject', { method:'POST' }); return; }
    const {error} = await sb().from('delete_requests')
      .update({status:'rejected'}).eq('id',requestId);
    if (error) throw error;
  },

  // ─── ЗАПРОСЫ НА УДАЛЕНИЕ ТРЕНИРОВОК ─────────
  async requestWorkoutDelete(workoutId, trainerId, clientName, workoutDate, branch) {
    if (useApi('requests')) {
      await api('/requests/workout-delete', { method:'POST', body:{
        workout_id: workoutId, client_name: clientName, workout_date: workoutDate, branch,
      }});
      return;
    }
    const {data:existing} = await sb().from('workout_delete_requests')
      .select('id').eq('workout_id',workoutId).eq('status','pending').limit(1);
    if (existing?.length) throw new Error('already_pending');
    const {error} = await sb().from('workout_delete_requests')
      .insert({workout_id:workoutId, trainer_id:trainerId, client_name:clientName,
               workout_date:workoutDate, branch, status:'pending'});
    if (error) throw error;
  },
  async getWorkoutDeleteRequests(branch) {
    if (useApi('requests')) {
      const rows = await api('/requests/workout-delete', { query: { status: 'pending', branch } });
      return (rows || []).map(r => ({ ...r, profiles: { fio: r.trainer_fio } }));
    }
    const {data,error} = await sb().from('workout_delete_requests')
      .select('*, profiles!trainer_id(fio)')
      .eq('status','pending').eq('branch',branch)
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async getAllWorkoutDeleteRequests() {
    if (useApi('requests')) {
      const rows = await api('/requests/workout-delete', { query: { status: 'pending' } });
      return (rows || []).map(r => ({ ...r, profiles: { fio: r.trainer_fio } }));
    }
    const {data,error} = await sb().from('workout_delete_requests')
      .select('*, profiles!trainer_id(fio)')
      .eq('status','pending')
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async approveWorkoutDeleteRequest(reqId, workoutId) {
    if (useApi('requests')) { await api('/requests/workout-delete/'+reqId+'/approve', { method:'POST' }); return; }
    // Закрываем все pending-запросы на эту тренировку ДО удаления (иначе CASCADE сотрёт их)
    await sb().from('workout_delete_requests').update({status:'approved'}).eq('workout_id',workoutId).eq('status','pending');
    await this.deleteWorkout(workoutId);
  },
  async rejectWorkoutDeleteRequest(reqId) {
    if (useApi('requests')) { await api('/requests/workout-delete/'+reqId+'/reject', { method:'POST' }); return; }
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
    if (useApi('audit')) {
      return await api('/audit', { query: { branch: branch || undefined, action: action || undefined, actor_id: actorId || undefined, limit } });
    }
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
    if (useApi('groups')) return await api('/adult-group-clients', { query: { group_id: groupId } });
    const {data,error} = await sb().from('adult_group_clients')
      .select('*').eq('group_id',groupId).eq('is_active',true).order('name');
    if (error) throw error; return data||[];
  },
  async addAdultGroupClient(groupId, name) {
    invalidateCachePrefix('grp:');
    if (useApi('groups')) return await api('/adult-group-clients', { method:'POST', body:{ group_id: groupId, name } });
    const {data,error} = await sb().from('adult_group_clients')
      .insert({group_id:groupId, name}).select().single();
    if (error) throw error; return data;
  },
  async archiveAdultGroupClient(id) {
    if (useApi('groups')) { await api('/adult-group-clients/'+id+'/archive', { method:'POST' }); return; }
    const {error} = await sb().from('adult_group_clients')
      .update({is_active:false}).eq('id',id);
    if (error) throw error;
  },

  // ─── ЗАМЕНА В ГРУППАХ ────────────────────────
  async createGroupSubstitution(groupId, originalTrainerId, substituteTrainerId, sessionDate, headcount=null) {
    invalidateCachePrefix('grp:');
    if (useApi('groups')) {
      // Пуш подтверждающим пока не шлём (нет notifications-write эндпоинта).
      return await api('/group-substitutions', { method:'POST', body:{
        group_id: groupId, original_trainer_id: originalTrainerId, substitute_trainer_id: substituteTrainerId,
        session_date: sessionDate, headcount: (headcount && headcount>0) ? headcount : null,
      }});
    }
    const {data,error} = await sb().from('group_substitutions')
      .insert({group_id:groupId, original_trainer_id:originalTrainerId,
               substitute_trainer_id:substituteTrainerId,
               session_date:sessionDate, status:'pending',
               headcount: (headcount && headcount>0) ? headcount : null})
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
    if (useApi('groups')) {
      const rows = await api('/group-substitutions/history', { query: { group_id: groupId } });
      return (rows || []).map(_apiGroupSub);
    }
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
    if (useApi('groups')) {
      const rows = await api('/group-substitutions/pending');
      return (rows || []).map(_apiGroupSub);
    }
    const {data,error} = await sb().from('group_substitutions')
      .select('*, original:profiles!original_trainer_id(fio), substitute:profiles!substitute_trainer_id(fio), trainer_groups(*, group_types(name, billing_model))')
      .eq('status','pending')
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async approveSubstitution(id, rate) {
    invalidateCachePrefix('grp:');
    if (useApi('groups')) {
      const data = await api('/group-substitutions/'+id+'/approve', { method:'POST', body:{ rate } });
      return !!data?.approved;   // false → уже подтвердил кто-то другой
    }
    // Идемпотентно: одобряем только если запись ещё pending → «кто первый, тот подтвердил».
    const {data,error} = await sb().from('group_substitutions')
      .update({status:'approved', rate}).eq('id',id).eq('status','pending').select('id');
    if (error) throw error;
    return (data||[]).length > 0;   // false → уже подтвердил кто-то другой
  },
});
