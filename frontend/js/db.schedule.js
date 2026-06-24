Object.assign(DB, {
  // ─── SCHEDULE SLOTS ──────────────────────────

  /** Повторяющиеся слоты тренера */
  async getRecurringSlots(trainerId) {
    const {data,error} = await sb().from('schedule_slots')
      .select('*, clients(fio,category,balance,is_archived), group_types(name,type)')
      .eq('trainer_id',trainerId).eq('active',true)
      .is('specific_date',null)
      .order('day_of_week').order('start_time');
    if (error) throw error;
    // ПТ-слоты архивированных клиентов не показываем (групповые слоты — client_id null)
    return (data||[]).filter(s=>!(s.client_id && s.clients?.is_archived));
  },

  /** Разовые слоты тренера для конкретной недели */
  async getOneTimeSlots(trainerId, weekStart, weekEnd) {
    const {data,error} = await sb().from('schedule_slots')
      .select('*, clients(fio,category,balance,is_archived), group_types(name,type)')
      .eq('trainer_id',trainerId).eq('active',true)
      .not('specific_date','is',null)
      .gte('specific_date',weekStart)
      .lte('specific_date',weekEnd)
      .order('specific_date').order('start_time');
    if (error) throw error;
    return (data||[]).filter(s=>!(s.client_id && s.clients?.is_archived));
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
      .select('*, clients(fio,category,balance), group_types(name,type)')
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
    // Защита от дублей: тот же тренер/день/время/тип/клиент(группа) уже есть активным — не плодим копию
    let dupQ = sb().from('schedule_slots').select('id')
      .eq('trainer_id', fields.trainer_id)
      .eq('day_of_week', fields.day_of_week)
      .eq('start_time', fields.start_time)
      .eq('slot_type',  fields.slot_type)
      .eq('active', true);
    dupQ = fields.specific_date ? dupQ.eq('specific_date', fields.specific_date) : dupQ.is('specific_date', null);
    if (fields.client_id)     dupQ = dupQ.eq('client_id', fields.client_id);
    if (fields.group_type_id) dupQ = dupQ.eq('group_type_id', fields.group_type_id);
    const {data:dup} = await dupQ.limit(1);
    if (dup && dup.length) return dup[0]; // уже существует — возвращаем как есть

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

    // Повторяющиеся слоты на этот день недели
    const {data:recurring, error:e1} = await sb().from('schedule_slots')
      .select('*, clients(fio,balance,category,age,drop_in_used,is_archived), group_types(name,type,billing_model)')
      .eq('trainer_id',trainerId).eq('day_of_week',dow).eq('active',true)
      .is('specific_date',null)
      .order('start_time');
    if (e1) throw e1;

    // Разовые слоты именно на эту дату
    const {data:oneTime} = await sb().from('schedule_slots')
      .select('*, clients(fio,balance,category,age,drop_in_used,is_archived), group_types(name,type,billing_model)')
      .eq('trainer_id',trainerId).eq('active',true)
      .eq('specific_date',dateStr)
      .order('start_time');

    const allSlots = [...(recurring||[]), ...(oneTime||[])];
    if (!allSlots.length) return [];

    const recurringIds = (recurring||[]).map(s=>s.id);

    // Проверяем отменённые повторяющиеся
    const {data:cancels} = recurringIds.length
      ? await sb().from('schedule_cancellations')
          .select('slot_id').in('slot_id',recurringIds).eq('cancel_date',dateStr)
      : {data:[]};
    const cancelledSet = new Set((cancels||[]).map(c=>c.slot_id));

    // Подтверждения
    const slotIds = allSlots.map(s=>s.id);
    const {data:confs} = await sb().from('schedule_confirmations')
      .select('*').in('slot_id',slotIds).eq('session_date',dateStr);
    const confMap = {};
    (confs||[]).forEach(c=>{ confMap[c.slot_id]=c; });

    return allSlots
      .filter(s=>!cancelledSet.has(s.id))
      .filter(s=>!(s.client_id && s.clients?.is_archived))
      .map(s=>({...s, confirmation:confMap[s.id]||null}));
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
  async freezeSubscription(subId, clientId, freezeStart, freezeEnd, newSubEnd) {
    const {error: e1} = await sb().from('subscriptions')
      .update({freeze_start: freezeStart, freeze_end: freezeEnd}).eq('id', subId);
    if (e1) throw e1;
    const {error: e2} = await sb().from('clients')
      .update({subscription_end: newSubEnd, freeze_start: freezeStart, freeze_end: freezeEnd}).eq('id', clientId);
    if (e2) throw e2;
  },
  async unfreezeEarly(subId, clientId, newSubEnd) {
    const {error: e1} = await sb().from('subscriptions')
      .update({freeze_start: null, freeze_end: null}).eq('id', subId);
    if (e1) throw e1;
    const {error: e2} = await sb().from('clients')
      .update({subscription_end: newSubEnd, freeze_start: null, freeze_end: null}).eq('id', clientId);
    if (e2) throw e2;
  },
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
      // Обнулить баланс, установить новый, сбросить заморозку
      await sb().from('clients').update({balance:quantity, freeze_start:null, freeze_end:null}).eq('id',clientId);
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
      await sb().from('clients').update({balance:newBal, freeze_start:null, freeze_end:null}).eq('id',clientId);
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
  async closeSubEarly(subId, clientId, isChild, closingNote, today) {
    const note = closingNote || (isChild ? 'Досрочное закрытие. Остаток сгорел.' : 'Досрочное закрытие. Остаток сохранён.');
    const {error} = await sb().from('subscriptions')
      .update({is_active:false, end_date:today, closing_note:note})
      .eq('id',subId);
    if (error) throw error;
    if (isChild) {
      const {error:be} = await sb().from('clients').update({balance:0}).eq('id',clientId);
      if (be) throw be;
    }
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

  // Батч-версия: все просроченные конспекты по тренеру за один запрос
  async getOverdueNotesBatch(trainerId) {
    const cutoff = new Date(Date.now()-48*3600000).toISOString();
    const {data:workouts} = await sb().from('workouts')
      .select('id,client_id,workout_date').eq('trainer_id',trainerId)
      .eq('is_drop_in',false).eq('is_debt',false)
      .lt('workout_date',cutoff);
    if (!workouts?.length) return {};
    const ids = workouts.map(w=>w.id);
    const {data:notes} = await sb().from('session_notes')
      .select('workout_id').in('workout_id',ids).not('accomplishments','is',null);
    const noted = new Set((notes||[]).map(n=>n.workout_id));
    // Возвращаем Map: client_id → count
    const result = {};
    workouts.filter(w=>!noted.has(w.id)).forEach(w=>{
      result[w.client_id] = (result[w.client_id]||0)+1;
    });
    return result;
  },
});
