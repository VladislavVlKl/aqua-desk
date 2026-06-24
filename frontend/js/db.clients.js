Object.assign(DB, {
  // ─── CLIENTS ─────────────────────────────────
  async getClients(trainerId) {
    const {data,error} = await sb().from('clients').select('*, workouts(count)')
      .eq('trainer_id',trainerId)
      .order('last_used',{ascending:false,nullsFirst:false});
    if (error) throw error; return data||[];
  },
  // Все клиенты всех тренеров за один запрос (для админа)
  async getAllClients() {
    const {data,error} = await sb().from('clients')
      .select('*, profiles!trainer_id(fio,branches), workouts(count)')
      .eq('is_archived',false)
      .order('fio');
    if (error) throw error; return data||[];
  },
  async addClient(fio, category, trainerId, age, subStart, subEnd) {
    const {data,error} = await sb().from('clients').insert({
      fio:fio.trim(), category, trainer_id:trainerId, balance:0,
      age:age||null, subscription_start:subStart||null, subscription_end:subEnd||null,
    }).select().single();
    if (error) throw error; return data;
  },
  async updateClient(id, fields) {
    const {data,error} = await sb().from('clients')
      .update(fields).eq('id',id).select().single();
    if (error) throw error; return data;
  },
  // Пересчёт категории у уже проведённых ПТ клиента (ошибочно выставленная категория).
  // Обновляет category_at_moment → ЗП за эти тренировки пересчитается по новой ставке.
  // fromDate (YYYY-MM-DD) ограничивает периодом; null = все тренировки клиента.
  // Разовые (is_drop_in) не трогаем — у них своя категория drop_in_category.
  async recalcWorkoutsCategory(clientId, newCat, fromDate=null) {
    let q = sb().from('workouts').update({category_at_moment:newCat})
      .eq('client_id',clientId).eq('is_drop_in',false);
    if (fromDate) q = q.gte('workout_date', fromDate + 'T00:00:00');
    const {data,error} = await q.select('id');
    if (error) throw error;
    return data?.length || 0;
  },
  async addBalance(clientId, amount) {
    // Атомарное обновление через RPC чтобы избежать race condition
    const {data,error} = await sb().rpc('increment_balance', {client_id: clientId, delta: amount});
    if (error) {
      // Fallback если RPC не создана
      const {data:cl} = await sb().from('clients').select('balance').eq('id',clientId).single();
      const {data:d2,error:e2} = await sb().from('clients')
        .update({balance:(cl?.balance||0)+amount}).eq('id',clientId).select().single();
      if (e2) throw e2; return d2;
    }
    return data;
  },
  // Списание ПТ из общего (зал+бассейн) пакета взрослого: тренер вносит, сколько
  // клиент отходил в ТЗ. Баланс уменьшается, остаток не уходит ниже 0. Пишем в audit_log.
  async deductGymSessions(clientId, count, actor) {
    const n = Math.max(1, parseInt(count) || 0);
    const {data:cl} = await sb().from('clients')
      .select('balance,fio').eq('id',clientId).single();
    const before = cl?.balance || 0;
    const after = Math.max(0, before - n);
    const {error} = await sb().from('clients').update({balance:after}).eq('id',clientId);
    if (error) throw error;
    await DB.auditLog('gym_deduct', actor?.id, actor?.fio, clientId, 'client',
      {count:n, balance_before:before, balance_after:after, fio:cl?.fio}, actor?.branch);
    invalidateCache('clients');
    return {before, after, deducted: before - after};
  },

  // ─── WORKOUTS ────────────────────────────────
  async logWorkouts(rows) {
    // Новые списания уходят на подтверждение ресепшену (Шаг 1 → 1С) только для
    // филиалов из RECEPTION_ENABLED_BRANCHES (пофилиальный запуск). Иначе остаются
    // confirmed по DB DEFAULT — у тренеров нет «ожидающего баланса».
    const rows2 = rows.map(r => (receptionEnabledForBranch(r.branch) ? {reception_status:'pending', ...r} : r));
    const {data,error} = await sb().from('workouts').insert(rows2).select();
    if (error) throw error;
    const nonDebtNonDropin = rows.filter(r=>!r.is_debt&&!r.is_drop_in);
    if (nonDebtNonDropin.length) {
      const cid = nonDebtNonDropin[0].client_id;
      // Атомарное списание через RPC — исключает race condition при двух устройствах
      const {error:balErr} = await sb().rpc('increment_balance', {client_id: cid, delta: -nonDebtNonDropin.length});
      if (balErr) throw balErr;
      await sb().from('clients').update({last_used:new Date().toISOString()}).eq('id',cid);
    } else {
      await sb().from('clients')
        .update({last_used:new Date().toISOString()}).eq('id',rows[0].client_id);
    }
    const dropInRow = rows.find(r=>r.is_drop_in);
    if (dropInRow) {
      const {data:cl} = await sb().from('clients').select('age').eq('id',dropInRow.client_id).single();
      if (cl && isChild(cl.age))
        await sb().from('clients').update({drop_in_used:true}).eq('id',dropInRow.client_id);
    }
    return data;
  },
  async confirmDebt(workoutId, clientId) {
    const {error:e1} = await sb().from('workouts')
      .update({debt_confirmed_at:new Date().toISOString()}).eq('id',workoutId);
    if (e1) throw e1;
    const {data:cl} = await sb().from('clients').select('balance').eq('id',clientId).single();
    await sb().from('clients')
      .update({balance:Math.max(0,(cl?.balance||0)-1)}).eq('id',clientId);
  },
  async getTodayWorkouts(trainerId, dateStr) {
    const from = dateStr + 'T00:00:00';
    const to   = dateStr + 'T23:59:59';
    const {data,error} = await sb().from('workouts')
      .select('*, clients(fio,category)').eq('trainer_id',trainerId)
      .gte('workout_date',from).lte('workout_date',to)
      .order('workout_date',{ascending:false});
    if (error) throw error; return data||[];
  },
  async getWorkouts(trainerId, year, month) {
    const from = new Date(year,month-1,1).toISOString();
    const to   = new Date(year,month,  1).toISOString();
    const {data,error} = await sb().from('workouts')
      .select('*, clients(fio,age)').eq('trainer_id',trainerId)
      .gte('workout_date',from).lt('workout_date',to)
      .order('workout_date',{ascending:false});
    if (error) throw error; return data||[];
  },
  // ─── ПРОБНЫЕ ТРЕНИРОВКИ ──────────────────────
  async addTrialSession(trainerId, branch, firstName, lastName, phone, age, category) {
    const {data,error} = await sb().from('trial_sessions')
      .insert({trainer_id:trainerId, branch, first_name:firstName.trim(),
               last_name:lastName?.trim()||null, phone:phone?.trim()||null,
               age:age||null, category, session_date:new Date().toISOString(),
               ...(receptionEnabledForBranch(branch) ? {reception_status:'pending'} : {})})
      .select().single();
    if (error) throw error; return data;
  },
  async getTrialSessions(trainerId, year, month) {
    const from = new Date(year,month-1,1).toISOString();
    const to   = new Date(year,month,  1).toISOString();
    const {data,error} = await sb().from('trial_sessions')
      .select('*').eq('trainer_id',trainerId)
      .gte('session_date',from).lt('session_date',to)
      .order('session_date',{ascending:false});
    if (error) throw error; return data||[];
  },
  async getAllTrialSessions(year, month, branch) {
    const from = new Date(year,month-1,1).toISOString();
    const to   = new Date(year,month,  1).toISOString();
    let q = sb().from('trial_sessions')
      .select('*, profiles!trainer_id(fio)')
      .gte('session_date',from).lt('session_date',to);
    if (branch) q = q.eq('branch',branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async deleteTrialSession(id) {
    const {error} = await sb().from('trial_sessions').delete().eq('id',id);
    if (error) throw error;
  },
  async updateTrialSession(id, fields) {
    const {error} = await sb().from('trial_sessions').update(fields).eq('id',id);
    if (error) throw error;
  },
  // ─── ЗАПРОСЫ НА УДАЛЕНИЕ ПРОБНОЙ (паритет с workout_delete_requests) ──
  async requestTrialDelete(trialId, trainerId, clientName, sessionDate, branch) {
    const {data:existing} = await sb().from('trial_delete_requests')
      .select('id').eq('trial_id',trialId).eq('status','pending').limit(1);
    if (existing?.length) throw new Error('already_pending');
    const {error} = await sb().from('trial_delete_requests')
      .insert({trial_id:trialId, trainer_id:trainerId, client_name:clientName,
               session_date:sessionDate, branch, status:'pending'});
    if (error) throw error;
  },
  async getAllTrialDeleteRequests() {
    const {data,error} = await sb().from('trial_delete_requests')
      .select('*, profiles!trainer_id(fio)')
      .eq('status','pending')
      .order('created_at',{ascending:false});
    if (error) throw error; return data||[];
  },
  async approveTrialDeleteRequest(reqId, trialId) {
    // Закрываем все pending-запросы на эту пробную ДО удаления (иначе CASCADE сотрёт их)
    await sb().from('trial_delete_requests').update({status:'approved'}).eq('trial_id',trialId).eq('status','pending');
    await this.deleteTrialSession(trialId);
  },
  async rejectTrialDeleteRequest(reqId) {
    const {error} = await sb().from('trial_delete_requests').update({status:'rejected'}).eq('id',reqId);
    if (error) throw error;
  },

  // ─── ЗАПРОСЫ НА ПОЗДНИЕ ТРЕНИРОВКИ ──────────
  async addLateRequest(trainerId, clientId, branch, workoutDate, category, reason) {
    const {data,error} = await sb().from('late_workout_requests')
      .insert({trainer_id:trainerId, client_id:clientId, branch,
               workout_date:workoutDate, category, reason: reason.trim()})
      .select().single();
    if (error) throw error; return data;
  },
  async getPendingLateRequests(branch) {
    let q = sb().from('late_workout_requests')
      .select('*, profiles!trainer_id(fio,branches), clients(fio,category)')
      .eq('status','pending').order('created_at',{ascending:false});
    if (branch) q = q.eq('branch', branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async getMyLateRequests(trainerId) {
    const {data,error} = await sb().from('late_workout_requests')
      .select('*, clients(fio)')
      .eq('trainer_id',trainerId).order('created_at',{ascending:false}).limit(20);
    if (error) throw error; return data||[];
  },
  async approveLateRequest(requestId, reviewerId) {
    // Получаем данные запроса
    const {data:req,error:re} = await sb().from('late_workout_requests')
      .select('*').eq('id',requestId).single();
    if (re) throw re;
    // Создаём тренировку
    const {error:we} = await sb().from('workouts').insert({
      trainer_id:   req.trainer_id,
      client_id:    req.client_id,
      branch:       req.branch,
      workout_date: req.workout_date,
      category_at_moment: req.category,
      is_debt: false, is_drop_in: false,
      pending_confirmation: false,
      // позднее списание тоже подтверждает ресепшн — если филиал включён
      ...(receptionEnabledForBranch(req.branch) ? {reception_status:'pending'} : {}),
    });
    if (we) throw we;
    // Списываем баланс клиента — ошибка пробрасывается наверх
    const {error:be} = await sb().rpc('increment_balance', {client_id: req.client_id, delta: -1});
    if (be) throw be;
    // Обновляем статус запроса
    const {error:ue} = await sb().from('late_workout_requests')
      .update({status:'approved', reviewed_by:reviewerId, reviewed_at:new Date().toISOString()})
      .eq('id',requestId);
    if (ue) throw ue;
  },
  async rejectLateRequest(requestId, reviewerId, note='') {
    const {error} = await sb().from('late_workout_requests')
      .update({status:'rejected', reviewed_by:reviewerId,
               reviewed_at:new Date().toISOString(), reject_note:note||null})
      .eq('id',requestId);
    if (error) throw error;
  },

  // ─── ЗАПРОСЫ НА ПЕРЕСЧЁТ КАТЕГОРИИ ПРОШЛЫХ ПТ ──
  // Тренер запрашивает → координатор/старший одобряет → category_at_moment обновляется.
  async addCategoryRecalcRequest(trainerId, clientId, clientFio, branch, newCategory, scope, fromDate) {
    // Дедуп: один pending на клиента
    const {data:exist} = await sb().from('category_recalc_requests')
      .select('id').eq('client_id',clientId).eq('status','pending').maybeSingle();
    if (exist) { const e=new Error('already_pending'); throw e; }
    const {data,error} = await sb().from('category_recalc_requests')
      .insert({trainer_id:trainerId, client_id:clientId, client_fio:clientFio||null,
               branch:branch||null, new_category:newCategory, scope, from_date:fromDate||null})
      .select().single();
    if (error) throw error; return data;
  },
  async getPendingCategoryRecalcRequests(branch) {
    let q = sb().from('category_recalc_requests')
      .select('*, profiles!trainer_id(fio,branches), clients(fio,category)')
      .eq('status','pending').order('created_at',{ascending:false});
    if (branch) q = q.eq('branch', branch);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },
  async getMyCategoryRecalcRequests(trainerId) {
    const {data,error} = await sb().from('category_recalc_requests')
      .select('*, clients(fio)')
      .eq('trainer_id',trainerId).order('created_at',{ascending:false}).limit(20);
    if (error) throw error; return data||[];
  },
  async approveCategoryRecalcRequest(requestId, reviewerId) {
    const {data:req,error:re} = await sb().from('category_recalc_requests')
      .select('*').eq('id',requestId).eq('status','pending').single();
    if (re) throw re;
    const n = await DB.recalcWorkoutsCategory(req.client_id, req.new_category, req.from_date);
    const {error:ue} = await sb().from('category_recalc_requests')
      .update({status:'approved', reviewed_by:reviewerId,
               reviewed_at:new Date().toISOString(), applied_count:n})
      .eq('id',requestId);
    if (ue) throw ue;
    DB.enqueueTrainerNotification(req.trainer_id,
      `✅ Пересчёт категории одобрен: ${req.client_fio||'клиент'} → Кат.${req.new_category} (${req.scope==='all'?'все ПТ':'текущий месяц'}). Затронуто тренировок: ${n}.`,
      'cat_recalc_approved');
    return n;
  },
  async rejectCategoryRecalcRequest(requestId, reviewerId, note='') {
    const {data:req} = await sb().from('category_recalc_requests')
      .select('trainer_id,client_fio,new_category').eq('id',requestId).maybeSingle();
    const {error} = await sb().from('category_recalc_requests')
      .update({status:'rejected', reviewed_by:reviewerId,
               reviewed_at:new Date().toISOString(), reject_note:note||null})
      .eq('id',requestId);
    if (error) throw error;
    if (req) DB.enqueueTrainerNotification(req.trainer_id,
      `❌ Пересчёт категории отклонён: ${req.client_fio||'клиент'} → Кат.${req.new_category}.${note?` Причина: ${note}.`:''}`,
      'cat_recalc_rejected');
  },
  async deleteWorkout(id) {
    // Перед удалением вернуть баланс, если тренировка его списывала.
    // Списывали баланс: обычная ПТ (logWorkouts -1), подтверждённый долг (confirmDebt -1),
    // подтверждённая замена (resolveSubstitute -1). НЕ списывали: разовое, неподтверждённый
    // долг, замена в ожидании (pending_confirmation), уже отклонённое ресепшеном (баланс
    // вернул rejectWorkout) — для них возврат не делаем (иначе двойной +1).
    const {data:w} = await sb().from('workouts')
      .select('client_id,is_debt,debt_confirmed_at,is_drop_in,pending_confirmation,reception_status,cl:clients(age,drop_in_used)')
      .eq('id',id).maybeSingle();
    if (w) {
      const consumedBalance = !w.is_drop_in && !w.pending_confirmation
        && w.reception_status !== 'rejected'
        && (!w.is_debt || w.debt_confirmed_at);
      if (consumedBalance) {
        await sb().rpc('increment_balance', {client_id: w.client_id, delta: +1});
      }
      // Разовое ребёнка пометило drop_in_used → сбросить (как в rejectWorkout)
      if (w.is_drop_in && w.cl && isChild(w.cl.age) && w.cl.drop_in_used) {
        await sb().from('clients').update({drop_in_used:false}).eq('id',w.client_id);
      }
    }
    // schedule_confirmations ссылается на workouts без CASCADE — удаляем вручную
    await sb().from('schedule_confirmations').delete().eq('workout_id', id);
    const {error} = await sb().from('workouts').delete().eq('id',id);
    if (error) throw error;
  },
async deleteClient(id) {
    const {error} = await sb().from('clients').delete().eq('id',id);
    if (error) throw error;
  },
  async archiveClient(id, reason='') {
    const {error} = await sb().from('clients')
      .update({is_archived:true, archive_reason:reason||null}).eq('id',id);
    if (error) throw error;
  },
  async restoreClient(id) {
    const {error} = await sb().from('clients')
      .update({is_archived:false, archive_reason:null}).eq('id',id);
    if (error) throw error;
  },
  // ─── DUTIES ──────────────────────────────────
  async getActiveDuty(trainerId) {
    const {data,error} = await sb().from('duties').select('*')
      .eq('trainer_id',trainerId).is('end_time',null).maybeSingle();
    if (error) throw error; return data;
  },
  async startDuty(trainerId, branch) {
    const {data,error} = await sb().from('duties')
      .insert({trainer_id:trainerId,branch}).select().single();
    if (error) throw error; return data;
  },
  async endDuty(dutyId) {
    const {data,error} = await sb().from('duties')
      .update({end_time:new Date().toISOString()}).eq('id',dutyId).select().single();
    if (error) throw error; return data;
  },
  async getDuties(trainerId, year, month) {
    const from = new Date(year,month-1,1).toISOString();
    const to   = new Date(year,month,  1).toISOString();
    const {data,error} = await sb().from('duties').select('*')
      .eq('trainer_id',trainerId).gte('start_time',from).lt('start_time',to)
      .not('end_time','is',null).order('start_time',{ascending:false});
    if (error) throw error; return data||[];
  },
  async deleteDuty(id) {
    const {error} = await sb().from('duties').delete().eq('id',id);
    if (error) throw error;
  },
});
