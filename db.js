// =============================================
// База данных v5 — полный файл
// =============================================

let _sb = null;
function sb() {
  if (!_sb) _sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return _sb;
}

const DB = {

  // ─── AUTH ───────────────────────────────────
  async getProfileByTgId(id) {
    const {data,error} = await sb().from('profiles').select('*').eq('tg_id',id).maybeSingle();
    if (error) throw error; return data;
  },
  async getUnclaimedProfileByFio(fio) {
    const {data,error} = await sb().from('profiles').select('*')
      .ilike('fio',fio.trim()).is('tg_id',null).maybeSingle();
    if (error) throw error; return data;
  },
  async claimProfile(profileId, tgId, pincode) {
    const {data,error} = await sb().from('profiles')
      .update({tg_id:tgId,pincode}).eq('id',profileId).select().single();
    if (error) throw error; return data;
  },

  // ─── PROFILES ────────────────────────────────
  async getAllProfiles() {
    const {data,error} = await sb().from('profiles')
      .select('*').eq('is_archived', false).order('fio');
    if (error) {
      // Fallback if column doesn't exist yet
      const {data:d2,error:e2} = await sb().from('profiles').select('*').order('fio');
      if (e2) throw e2; return d2||[];
    }
    return data||[];
  },
  async getProfilesByRole(role) {
    const {data,error} = await sb().from('profiles').select('*').eq('role',role).order('fio');
    if (error) throw error; return data||[];
  },
  async addTrainer(fio, branches, role='trainer') {
    const {data,error} = await sb().from('profiles')
      .insert({fio:fio.trim(),branches,role}).select().single();
    if (error) throw error; return data;
  },
  async updateProfile(id, fields) {
    const {data,error} = await sb().from('profiles')
      .update(fields).eq('id',id).select().single();
    if (error) throw error; return data;
  },

  /** Архивировать тренера: закрывает доступ, история сохраняется */
  async archiveTrainer(id) {
    const {error} = await sb().from('profiles')
      .update({ tg_id: null, pincode: null, is_archived: true })
      .eq('id', id);
    if (error) throw error;
  },

  /** Удалить тренера: полное удаление (только если нет workouts) */
  async deleteTrainer(id) {
    const {data: wk} = await sb().from('workouts')
      .select('id').eq('trainer_id', id).limit(1);
    if (wk?.length) throw new Error('has_history');
    const {error} = await sb().from('profiles').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── BRANCHES ────────────────────────────────
  async getBranches() {
    const {data,error} = await sb().from('branches').select('*').order('name');
    if (error) throw error; return data||[];
  },
  async addBranch(name) {
    const {data,error} = await sb().from('branches')
      .insert({name:name.trim()}).select().single();
    if (error) throw error; return data;
  },
  async deleteBranch(id) {
    const {error} = await sb().from('branches').delete().eq('id',id);
    if (error) throw error;
  },
  async renameBranch(oldName, newName) {
    const {error:e1} = await sb().from('branches')
      .update({name:newName.trim()}).eq('name',oldName);
    if (e1) throw e1;
    const {error:e2} = await sb().rpc('rename_branch',{old_name:oldName,new_name:newName.trim()});
    if (e2) throw e2;
  },

  // ─── CLIENTS ─────────────────────────────────
  async getClients(trainerId) {
    const {data,error} = await sb().from('clients').select('*')
      .eq('trainer_id',trainerId)
      .eq('is_archived',false)
      .order('last_used',{ascending:false,nullsFirst:false});
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
  async addBalance(clientId, amount) {
    const {data:cl} = await sb().from('clients').select('balance').eq('id',clientId).single();
    const {data,error} = await sb().from('clients')
      .update({balance:(cl?.balance||0)+amount}).eq('id',clientId).select().single();
    if (error) throw error; return data;
  },

  // ─── WORKOUTS ────────────────────────────────
  async logWorkouts(rows) {
    const {data,error} = await sb().from('workouts').insert(rows).select();
    if (error) throw error;
    const nonDebtNonDropin = rows.filter(r=>!r.is_debt&&!r.is_drop_in);
    if (nonDebtNonDropin.length) {
      const cid = nonDebtNonDropin[0].client_id;
      const {data:cl} = await sb().from('clients').select('balance').eq('id',cid).single();
      await sb().from('clients').update({
        balance:Math.max(0,(cl?.balance||0)-nonDebtNonDropin.length),
        last_used:new Date().toISOString(),
      }).eq('id',cid);
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
  async getWorkouts(trainerId, year, month) {
    const from = new Date(year,month-1,1).toISOString();
    const to   = new Date(year,month,  1).toISOString();
    const {data,error} = await sb().from('workouts')
      .select('*, clients(fio,age)').eq('trainer_id',trainerId)
      .gte('workout_date',from).lt('workout_date',to)
      .order('workout_date',{ascending:false});
    if (error) throw error; return data||[];
  },
  async deleteWorkout(id) {
    const {error} = await sb().from('workouts').delete().eq('id',id);
    if (error) throw error;
  },
async deleteClient(id) {
    const {error} = await sb().from('clients').delete().eq('id',id);
    if (error) throw error;
  },
  async archiveClient(id) {
    const {error} = await sb().from('clients')
      .update({is_archived:true}).eq('id',id);
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

  // ─── GROUP TYPES ─────────────────────────────
  async getGroupTypes() {
    const {data,error} = await sb().from('group_types').select('*').order('name');
    if (error) throw error; return data||[];
  },
  async addGroupType(fields) {
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
  async addTrainerGroup(trainerId, groupTypeId, branch, startDate, rateType='percent', rateValue=40) {
    const {data,error} = await sb().from('trainer_groups')
      .insert({trainer_id:trainerId,group_type_id:groupTypeId,branch,
               subscription_start:startDate,rate_type:rateType,rate_value:rateValue})
      .select('*, group_types(*)').single();
    if (error) throw error; return data;
  },
async unassignTrainerGroup(id) {
    const {error} = await sb().from('trainer_groups')
      .update({subscription_end: todayStr()}).eq('id',id);
    if (error) throw error;
  },

  // ─── GROUP CLIENTS ────────────────────────────
  async getGroupClients(groupId) {
    const {data,error} = await sb().from('group_clients')
      .select('*').eq('group_id',groupId).eq('is_active',true).order('name');
    if (error) throw error; return data||[];
  },
  async addGroupClient(groupId, name, age, monthlyPrice, startDate) {
    const {data,error} = await sb().from('group_clients')
      .insert({group_id:groupId, name, age:age||null,
               monthly_price:monthlyPrice||0, start_date:startDate})
      .select().single();
    if (error) throw error; return data;
  },
  async updateGroupClient(id, fields) {
    const {error} = await sb().from('group_clients').update(fields).eq('id',id);
    if (error) throw error;
  },
  async archiveGroupClient(id) {
    const {error} = await sb().from('group_clients')
      .update({is_active:false}).eq('id',id);
    if (error) throw error;
  },

  // ─── GROUP ATTENDANCE ─────────────────────────
  async getGroupAttendance(groupId, date) {
    const {data,error} = await sb().from('group_attendance')
      .select('*').eq('group_id',groupId).eq('session_date',date);
    if (error) throw error; return data||[];
  },
  async saveGroupAttendance(groupId, groupClientId, date, attended) {
    const {error} = await sb().from('group_attendance')
      .upsert({group_id:groupId, group_client_id:groupClientId,
               session_date:date, attended},
              {onConflict:'group_client_id,session_date'});
    if (error) throw error;
  },

  // ─── GROUP PAYMENTS ───────────────────────────
  async getGroupPayments(groupId, month) {
    const {data,error} = await sb().from('group_payments')
      .select('*').eq('group_id',groupId).eq('month',month);
    if (error) throw error; return data||[];
  },
  async setGroupPayment(groupId, groupClientId, month, amount, paid) {
    const {error} = await sb().from('group_payments')
      .upsert({group_id:groupId, group_client_id:groupClientId,
               month, amount, paid,
               paid_at: paid ? new Date().toISOString() : null},
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
    const {error} = await sb().from('group_progress_notes')
      .upsert({group_id:groupId, group_client_id:groupClientId,
               trainer_id:trainerId, month, note},
              {onConflict:'group_client_id,month'});
    if (error) throw error;
  },
  // ─── GROUP SESSIONS ──────────────────────────
  async logGroupSession(trainerId, groupTypeId, branch, date, headcount) {
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

  // ─── SCHEDULE SLOTS ──────────────────────────

  /** Повторяющиеся слоты тренера */
  async getRecurringSlots(trainerId) {
    const {data,error} = await sb().from('schedule_slots')
      .select('*, clients(fio,category), group_types(name,type)')
      .eq('trainer_id',trainerId).eq('active',true)
      .is('specific_date',null)
      .order('day_of_week').order('start_time');
    if (error) throw error; return data||[];
  },

  /** Разовые слоты тренера для конкретной недели */
  async getOneTimeSlots(trainerId, weekStart, weekEnd) {
    const {data,error} = await sb().from('schedule_slots')
      .select('*, clients(fio,category), group_types(name,type)')
      .eq('trainer_id',trainerId).eq('active',true)
      .not('specific_date','is',null)
      .gte('specific_date',weekStart)
      .lte('specific_date',weekEnd)
      .order('specific_date').order('start_time');
    if (error) throw error; return data||[];
  },

  /** Отмены повторяющихся слотов за неделю */
  async getCancellations(slotIds, weekStart, weekEnd) {
    if (!slotIds.length) return [];
    const {data,error} = await sb().from('schedule_cancellations')
      .select('slot_id,cancel_date')
      .in('slot_id',slotIds)
      .gte('cancel_date',weekStart)
      .lte('cancel_date',weekEnd);
    if (error) throw error; return data||[];
  },

  /** Все активные слоты — для обратной совместимости */
  async getSlots(trainerId) {
    const {data,error} = await sb().from('schedule_slots')
      .select('*, clients(fio,category), group_types(name,type)')
      .eq('trainer_id',trainerId).eq('active',true)
      .is('specific_date',null)
      .order('day_of_week').order('start_time');
    if (error) throw error; return data||[];
  },

  async getAllActiveSlots() {
    const {data,error} = await sb().from('schedule_slots')
      .select('*, profiles!trainer_id(fio), clients(fio), group_types(name)')
      .eq('active',true).in('slot_type',['pt','group'])
      .order('day_of_week').order('start_time');
    if (error) throw error; return data||[];
  },

  async addSlot(fields) {
    const {data,error} = await sb().from('schedule_slots')
      .insert(fields).select('*, clients(fio,category), group_types(name,type)').single();
    if (error) throw error; return data;
  },

  async deactivateSlot(id) {
    const {error} = await sb().from('schedule_slots').update({active:false}).eq('id',id);
    if (error) throw error;
  },

  /** Отменить повторяющийся слот на одну дату */
  async cancelSlotDate(slotId, date, reason='') {
    const {error} = await sb().from('schedule_cancellations')
      .upsert({slot_id:slotId, cancel_date:date, reason:reason||null},
              {onConflict:'slot_id,cancel_date'});
    if (error) throw error;
  },

  /** Восстановить отменённый слот */
  async restoreSlotDate(slotId, date) {
    const {error} = await sb().from('schedule_cancellations')
      .delete().eq('slot_id',slotId).eq('cancel_date',date);
    if (error) throw error;
  },

  /** События за неделю */
  async getEventsForWeek(weekStart, weekEnd, branch) {
    let q = sb().from('events')
      .select('id,title,event_type,start_time,end_time,blocks_pool,branch')
      .gte('end_time', weekStart+'T00:00:00')
      .lte('start_time', weekEnd+'T23:59:59');
    if (branch) q = q.or(`branch.is.null,branch.eq.${branch}`);
    const {data,error} = await q;
    if (error) throw error; return data||[];
  },

  // ─── TODAY / CONFIRMATIONS ───────────────────
  async getTodaySlots(trainerId, dateStr) {
    const dow = (new Date(dateStr+'T12:00:00').getDay()+6) % 7;
    const {data:slots,error:e1} = await sb().from('schedule_slots')
      .select('*, clients(fio,balance,category,age,drop_in_used), group_types(name,type,billing_model)')
      .eq('trainer_id',trainerId).eq('day_of_week',dow).eq('active',true)
      .order('start_time');
    if (e1) throw e1;
    if (!slots?.length) return [];
    const slotIds = slots.map(s=>s.id);
    const {data:confs} = await sb().from('schedule_confirmations')
      .select('*').in('slot_id',slotIds).eq('session_date',dateStr);
    const confMap = {};
    (confs||[]).forEach(c=>{ confMap[c.slot_id]=c; });
    return slots.map(s=>({...s, confirmation:confMap[s.id]||null}));
  },
  async upsertConfirmation(slotId, date, fields) {
    const {data,error} = await sb().from('schedule_confirmations')
      .upsert({slot_id:slotId,session_date:date,...fields,updated_at:new Date().toISOString()},
              {onConflict:'slot_id,session_date'})
      .select().single();
    if (error) throw error; return data;
  },

  // ─── MONTH ADJUSTMENTS ───────────────────────
  async getAdjustment(trainerId, year, month) {
    const {data,error} = await sb().from('month_adjustments').select('*')
      .eq('trainer_id',trainerId).eq('year',year).eq('month',month).maybeSingle();
    if (error) throw error; return data;
  },
  async upsertAdjustment(trainerId, year, month, bonus, penalty, notes) {
    const {data,error} = await sb().from('month_adjustments')
      .upsert({trainer_id:trainerId,year,month,bonus,penalty,notes},
              {onConflict:'trainer_id,year,month'})
      .select().single();
    if (error) throw error; return data;
  },

  // ─── SUBSCRIPTIONS ───────────────────────────
  async getActiveSubscription(clientId) {
    const {data,error} = await sb().from('subscriptions')
      .select('*, training_goals(*)')
      .eq('client_id',clientId).eq('is_active',true)
      .order('created_at',{ascending:false}).limit(1).maybeSingle();
    if (error) throw error; return data;
  },
  async createSubscription(clientId, trainerId, startDate, initialBalance) {
    await sb().from('subscriptions')
      .update({is_active:false}).eq('client_id',clientId).eq('is_active',true);
    const {data,error} = await sb().from('subscriptions')
      .insert({client_id:clientId,trainer_id:trainerId,
               start_date:startDate,initial_balance:initialBalance,is_active:true})
      .select().single();
    if (error) throw error; return data;
  },

  /** Создать абонемент для действующего клиента (баланс уже установлен отдельно) */
  async createSubscriptionWithInitial(clientId, trainerId, startDate, initialBalance, currentBalance) {
    await sb().from('subscriptions')
      .update({is_active:false}).eq('client_id',clientId).eq('is_active',true);
    const {data,error} = await sb().from('subscriptions')
      .insert({client_id:clientId,trainer_id:trainerId,
               start_date:startDate,initial_balance:initialBalance,is_active:true})
      .select().single();
    if (error) throw error;
    // Синхронизируем баланс клиента
    await sb().from('clients').update({balance:currentBalance}).eq('id',clientId);
    return data;
  },

  /** Купить новый пакет ПТ:
   *  - Ребёнок: закрывает старый (остаток сгорает), создаёт новый
   *  - Взрослый: добавляет ПТ к балансу, абонемент не закрывается */
  async buyNewPackage(clientId, trainerId, isChild, quantity, startDate) {
    const endDate = calcSubEnd(startDate, quantity);
    if (isChild) {
      // Закрыть старый (баланс сгорает)
      await sb().from('subscriptions')
        .update({is_active:false, end_date:startDate, closing_note:'Истёк. Остаток сгорел.'})
        .eq('client_id',clientId).eq('is_active',true);
      // Обнулить баланс и установить новый
      await sb().from('clients').update({balance:quantity}).eq('id',clientId);
      // Создать новый абонемент
      const {data,error} = await sb().from('subscriptions')
        .insert({client_id:clientId,trainer_id:trainerId,
                 start_date:startDate,end_date:endDate,initial_balance:quantity,is_active:true})
        .select().single();
      if (error) throw error; return data;
    } else {
      // Взрослый: просто добавить к балансу
      const {data:cl} = await sb().from('clients').select('balance').eq('id',clientId).single();
      const newBal = (cl?.balance||0) + quantity;
      await sb().from('clients').update({balance:newBal}).eq('id',clientId);
      // Если нет активного абонемента — создать
      const {data:subs} = await sb().from('subscriptions')
        .select('id').eq('client_id',clientId).eq('is_active',true).limit(1);
      if (!subs?.length) {
        await sb().from('subscriptions')
          .insert({client_id:clientId,trainer_id:trainerId,
                   start_date:startDate,initial_balance:quantity,is_active:true})
          .select().single();
      } else {
        // Обновить initial_balance активного абонемента (суммируем пакеты)
        await sb().from('subscriptions')
          .update({initial_balance: (subs[0].initial_balance||0)+quantity})
          .eq('id',subs[0].id);
      }
      return {balance:newBal};
    }
  },
  async closeSubscription(subId, closingNote, endDate) {
    const {data,error} = await sb().from('subscriptions')
      .update({is_active:false,end_date:endDate,closing_note:closingNote||null})
      .eq('id',subId).select().single();
    if (error) throw error; return data;
  },

  // ─── TRAINING GOALS ──────────────────────────
  async addGoal(subscriptionId, clientId, goalText) {
    const {data,error} = await sb().from('training_goals')
      .insert({subscription_id:subscriptionId,client_id:clientId,goal_text:goalText})
      .select().single();
    if (error) throw error; return data;
  },
  async deleteGoal(goalId) {
    const {error} = await sb().from('training_goals').delete().eq('id',goalId);
    if (error) throw error;
  },

  // ─── SESSION NOTES ───────────────────────────
  async getNoteByWorkout(workoutId) {
    const {data,error} = await sb().from('session_notes')
      .select('*').eq('workout_id',workoutId).maybeSingle();
    if (error) throw error; return data;
  },
  async upsertNote(workoutId, clientId, trainerId, subscriptionId, accomplishments, nextTask, sessionNumber) {
    const deadline = new Date(Date.now()+48*3600000).toISOString();
    const {data,error} = await sb().from('session_notes')
      .upsert({
        workout_id:workoutId,client_id:clientId,trainer_id:trainerId,
        subscription_id:subscriptionId,
        accomplishments:accomplishments||null,next_task:nextTask||null,
        session_number:sessionNumber||null,
        deadline,updated_at:new Date().toISOString(),
      },{onConflict:'workout_id'})
      .select().single();
    if (error) throw error; return data;
  },
  async getOverdueNotes(clientId, trainerId) {
    const cutoff = new Date(Date.now()-48*3600000).toISOString();
    const {data:workouts} = await sb().from('workouts')
      .select('id,workout_date').eq('client_id',clientId).eq('trainer_id',trainerId)
      .eq('is_drop_in',false).eq('is_debt',false)
      .lt('workout_date',cutoff).order('workout_date',{ascending:false});
    if (!workouts?.length) return [];
    const ids = workouts.map(w=>w.id);
    const {data:notes} = await sb().from('session_notes')
      .select('workout_id').in('workout_id',ids).not('accomplishments','is',null);
    const noted = new Set((notes||[]).map(n=>n.workout_id));
    return workouts.filter(w=>!noted.has(w.id));
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
      .select('trainer_id,category_at_moment,is_debt,debt_confirmed_at,is_drop_in')
      .gte('workout_date',from).lt('workout_date',to);
    if (branch) currWQ = currWQ.eq('branch',branch);

    let prevWQ = sb().from('workouts')
      .select('trainer_id,category_at_moment,is_debt,debt_confirmed_at,is_drop_in')
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

  // ─── REPORTS ─────────────────────────────────
  async getSummary(year, month, branch=null) {
    const from    = new Date(year,month-1,1).toISOString();
    const to      = new Date(year,month,  1).toISOString();
    const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const toDay   = new Date(year,month,1).toISOString().slice(0,10);

    let wq  = sb().from('workouts')
      .select('trainer_id,category_at_moment,branch,is_debt,debt_confirmed_at,is_drop_in')
      .gte('workout_date',from).lt('workout_date',to);
    if (branch) wq = wq.eq('branch',branch);

    let dq = sb().from('duties')
      .select('trainer_id,branch,start_time,end_time')
      .gte('start_time',from).lt('start_time',to).not('end_time','is',null);
    if (branch) dq = dq.eq('branch',branch);

    let tgq = sb().from('trainer_groups')
      .select('trainer_id,group_types(name,type,billing_model,price_per_month,trainer_percentage)')
      .lte('subscription_start',toDay)
      .or(`subscription_end.is.null,subscription_end.gte.${fromDay}`);
    if (branch) tgq = tgq.eq('branch',branch);

    let gsq = sb().from('group_sessions')
      .select('trainer_id,group_type_id,headcount,group_types(billing_model)')
      .gte('session_date',fromDay).lt('session_date',toDay);
    if (branch) gsq = gsq.eq('branch',branch);

    let pq = sb().from('profiles').select('id,fio,branches,role')
      .in('role',['trainer','senior_trainer']);
    if (branch) pq = pq.contains('branches',[branch]);

    let aq = sb().from('month_adjustments').select('*').eq('year',year).eq('month',month);

    const [w,d,tg,gs,p,adj] = await Promise.all([wq,dq,tgq,gsq,pq,aq]);
    return {
      workouts:      w.data  ||[],
      duties:        d.data  ||[],
      trainerGroups: tg.data ||[],
      groupSessions: gs.data ||[],
      profiles:      p.data  ||[],
      adjustments:   adj.data||[],
    };
  },

  async getTrainerDetail(trainerId, year, month) {
    const from    = new Date(year,month-1,1).toISOString();
    const to      = new Date(year,month,  1).toISOString();
    const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const toDay   = new Date(year,month,1).toISOString().slice(0,10);
    const [w,d,tg,gs,adj] = await Promise.all([
      sb().from('workouts').select('*, clients(fio,age)')
        .eq('trainer_id',trainerId).gte('workout_date',from).lt('workout_date',to)
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
    ]);
    return {
      workouts:      w.data   ||[],
      duties:        d.data   ||[],
      trainerGroups: tg.data  ||[],
      groupSessions: gs.data  ||[],
      adjustment:    adj.data ||null,
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
      pending_confirmation: true,
    }));
    const {data,error} = await sb().from('workouts').insert(subRows).select();
    if (error) throw error;
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
      .select().single();
    if (error) throw error; return data;
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
};

// ─── РАСЧЁТ ЗП ───────────────────────────────
function calcSalary({workouts=[], duties=[], trainerGroups=[], groupSessions=[], adjustment=null}) {
  const cat={1:0,2:0,3:0,debt:0,dropIn:0};
  workouts.forEach(w=>{
    if (w.is_drop_in)                          cat.dropIn++;
    else if (w.is_debt&&!w.debt_confirmed_at)  cat.debt++;
    else                                       cat[w.category_at_moment]++;
  });
  const ptSum     = cat[1]*RATES.pt[1]+cat[2]*RATES.pt[2]+cat[3]*RATES.pt[3];
  const dropInSum = cat.dropIn*RATES.drop_in_trainer;
  const hours     = duties.reduce((s,d)=>s+(new Date(d.end_time)-new Date(d.start_time))/3600000,0);
  const dutySum   = Math.round(hours*RATES.duty_per_hour);
  const childSum  = trainerGroups
    .filter(tg=>tg.group_types?.type==='children')
    .reduce((s,tg)=>s+Math.round((tg.group_types.price_per_month||0)*RATES.group_children_pct),0);
  const adultSum  = groupSessions
    .filter(gs=>gs.group_types?.billing_model==='headcount')
    .reduce((s,gs)=>s+getAdultGroupRate(gs.headcount),0);
  const bonus   = adjustment?.bonus  ||0;
  const penalty = adjustment?.penalty||0;
  const total   = ptSum+dropInSum+dutySum+childSum+adultSum+bonus-penalty;
  return {cat,hours,ptSum,dropInSum,dutySum,childSum,adultSum,bonus,penalty,total};
}
