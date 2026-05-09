// =============================================
// Слой базы данных v2
// =============================================

let _sb = null;
function sb() {
  if (!_sb) _sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return _sb;
}

const DB = {

  // ==================== AUTH ====================

  async getProfileByTgId(tgId) {
    const { data, error } = await sb().from('profiles').select('*').eq('tg_id', tgId).maybeSingle();
    if (error) throw error;
    return data;
  },

  async getUnclaimedProfileByFio(fio) {
    const { data, error } = await sb().from('profiles').select('*')
      .ilike('fio', fio.trim()).is('tg_id', null).maybeSingle();
    if (error) throw error;
    return data;
  },

  async claimProfile(profileId, tgId, pincode) {
    const { data, error } = await sb().from('profiles')
      .update({ tg_id: tgId, pincode })
      .eq('id', profileId).select().single();
    if (error) throw error;
    return data;
  },

  // ==================== PROFILES ====================

  async getAllProfiles() {
    const { data, error } = await sb().from('profiles').select('*').order('fio');
    if (error) throw error;
    return data || [];
  },

  async getProfilesByRole(role) {
    const { data, error } = await sb().from('profiles').select('*')
      .eq('role', role).order('fio');
    if (error) throw error;
    return data || [];
  },

  async addTrainer(fio, branches, role = 'trainer') {
    const { data, error } = await sb().from('profiles')
      .insert({ fio: fio.trim(), branches, role }).select().single();
    if (error) throw error;
    return data;
  },

  async updateProfile(id, fields) {
    const { data, error } = await sb().from('profiles')
      .update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  // ==================== BRANCHES ====================

  async getBranches() {
    const { data, error } = await sb().from('branches').select('*').order('name');
    if (error) throw error;
    return data || [];
  },

  async addBranch(name) {
    const { data, error } = await sb().from('branches')
      .insert({ name: name.trim() }).select().single();
    if (error) throw error;
    return data;
  },

  async deleteBranch(id) {
    const { error } = await sb().from('branches').delete().eq('id', id);
    if (error) throw error;
  },

  // ==================== CLIENTS ====================

  async getClients(trainerId) {
    const { data, error } = await sb().from('clients').select('*')
      .eq('trainer_id', trainerId)
      .order('last_used', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data || [];
  },

  async getAllClientsInBranch(branch) {
    // Для старшего тренера: клиенты всех тренеров филиала
    const { data: trainers } = await sb().from('profiles').select('id')
      .contains('branches', [branch]);
    const ids = (trainers || []).map(t => t.id);
    if (!ids.length) return [];
    const { data, error } = await sb().from('clients').select('*, profiles!trainer_id(fio)')
      .in('trainer_id', ids).order('fio');
    if (error) throw error;
    return data || [];
  },

  async addClient(fio, category, trainerId) {
    const { data, error } = await sb().from('clients')
      .insert({ fio: fio.trim(), category, trainer_id: trainerId, balance: 0 })
      .select().single();
    if (error) throw error;
    return data;
  },

  async addBalance(clientId, amount) {
    const { data: cl } = await sb().from('clients').select('balance').eq('id', clientId).single();
    const { data, error } = await sb().from('clients')
      .update({ balance: (cl?.balance || 0) + amount })
      .eq('id', clientId).select().single();
    if (error) throw error;
    return data;
  },

  // ==================== WORKOUTS ====================

  /** Списание ПТ (одна или несколько). is_debt = не уменьшает баланс */
  async logWorkouts(rows) {
    const { data, error } = await sb().from('workouts').insert(rows).select();
    if (error) throw error;

    // Если не долг — уменьшаем баланс
    const nonDebt = rows.filter(r => !r.is_debt);
    if (nonDebt.length > 0) {
      const clientId = nonDebt[0].client_id;
      const { data: cl } = await sb().from('clients').select('balance').eq('id', clientId).single();
      await sb().from('clients').update({
        balance: Math.max(0, (cl?.balance || 0) - nonDebt.length),
        last_used: new Date().toISOString(),
      }).eq('id', clientId);
    } else {
      // Обновляем last_used даже для долга
      await sb().from('clients').update({ last_used: new Date().toISOString() })
        .eq('id', rows[0].client_id);
    }

    return data;
  },

  /** Подтвердить долговую ПТ — снять с баланса */
  async confirmDebt(workoutId, clientId) {
    const { error: e1 } = await sb().from('workouts')
      .update({ debt_confirmed_at: new Date().toISOString() }).eq('id', workoutId);
    if (e1) throw e1;

    const { data: cl } = await sb().from('clients').select('balance').eq('id', clientId).single();
    await sb().from('clients').update({ balance: Math.max(0, (cl?.balance || 0) - 1) })
      .eq('id', clientId);
  },

  async getWorkouts(trainerId, year, month) {
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month,     1).toISOString();
    const { data, error } = await sb().from('workouts')
      .select('*, clients(fio)').eq('trainer_id', trainerId)
      .gte('created_at', from).lt('created_at', to)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async getWorkoutsByBranch(branch, year, month) {
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month,     1).toISOString();
    const { data, error } = await sb().from('workouts')
      .select('*, clients(fio), profiles!trainer_id(fio)')
      .eq('branch', branch).gte('workout_date', from).lt('workout_date', to)
      .order('workout_date', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async deleteWorkout(id) {
    const { error } = await sb().from('workouts').delete().eq('id', id);
    if (error) throw error;
  },

  // ==================== DUTIES ====================

  async getActiveDuty(trainerId) {
    const { data, error } = await sb().from('duties')
      .select('*').eq('trainer_id', trainerId).is('end_time', null).maybeSingle();
    if (error) throw error;
    return data;
  },

  async startDuty(trainerId, branch) {
    const { data, error } = await sb().from('duties')
      .insert({ trainer_id: trainerId, branch }).select().single();
    if (error) throw error;
    return data;
  },

  async endDuty(dutyId) {
    const { data, error } = await sb().from('duties')
      .update({ end_time: new Date().toISOString() }).eq('id', dutyId).select().single();
    if (error) throw error;
    return data;
  },

  async getDuties(trainerId, year, month) {
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month,     1).toISOString();
    const { data, error } = await sb().from('duties').select('*')
      .eq('trainer_id', trainerId).gte('start_time', from).lt('start_time', to)
      .not('end_time', 'is', null).order('start_time', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // ==================== GROUP TYPES ====================

  async getGroupTypes() {
    const { data, error } = await sb().from('group_types').select('*').order('name');
    if (error) throw error;
    return data || [];
  },

  async addGroupType(fields) {
    const { data, error } = await sb().from('group_types').insert(fields).select().single();
    if (error) throw error;
    return data;
  },

  async updateGroupType(id, fields) {
    const { data, error } = await sb().from('group_types')
      .update(fields).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  // ==================== TRAINER GROUPS ====================

  async getTrainerGroups(trainerId) {
    const { data, error } = await sb().from('trainer_groups')
      .select('*, group_types(*)').eq('trainer_id', trainerId)
      .is('subscription_end', null).order('subscription_start', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  async addTrainerGroup(trainerId, groupTypeId, branch, startDate) {
    const { data, error } = await sb().from('trainer_groups')
      .insert({ trainer_id: trainerId, group_type_id: groupTypeId, branch, subscription_start: startDate })
      .select('*, group_types(*)').single();
    if (error) throw error;
    return data;
  },

  async endTrainerGroup(id, endDate) {
    const { data, error } = await sb().from('trainer_groups')
      .update({ subscription_end: endDate }).eq('id', id).select().single();
    if (error) throw error;
    return data;
  },

  // ==================== GROUP SESSIONS ====================

  async logGroupSession(trainerId, groupTypeId, branch, date, headcount) {
    const { data, error } = await sb().from('group_sessions')
      .insert({ trainer_id: trainerId, group_type_id: groupTypeId, branch, session_date: date, headcount })
      .select().single();
    if (error) throw error;
    return data;
  },

  async getGroupSessions(trainerId, year, month) {
    const from = `${year}-${String(month).padStart(2,'0')}-01`;
    const to   = new Date(year, month, 1).toISOString().slice(0,10);
    const { data, error } = await sb().from('group_sessions')
      .select('*, group_types(name,type,billing_model)')
      .eq('trainer_id', trainerId).gte('session_date', from).lt('session_date', to)
      .order('session_date', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // ==================== SCHEDULE SLOTS ====================

  async getSlots(trainerId) {
    const { data, error } = await sb().from('schedule_slots')
      .select('*, clients(fio), group_types(name,type)')
      .eq('trainer_id', trainerId).eq('active', true)
      .order('day_of_week').order('start_time');
    if (error) throw error;
    return data || [];
  },

  async getAllActiveSlots() {
    // Для публичного расписания — только PT и group
    const { data, error } = await sb().from('schedule_slots')
      .select('*, profiles!trainer_id(fio), clients(fio), group_types(name)')
      .eq('active', true).in('slot_type', ['pt', 'group'])
      .order('day_of_week').order('start_time');
    if (error) throw error;
    return data || [];
  },

  async addSlot(fields) {
    const { data, error } = await sb().from('schedule_slots')
      .insert(fields).select('*, clients(fio), group_types(name,type)').single();
    if (error) throw error;
    return data;
  },

  async deactivateSlot(id) {
    const { error } = await sb().from('schedule_slots')
      .update({ active: false }).eq('id', id);
    if (error) throw error;
  },

  // ==================== SCHEDULE CONFIRMATIONS ====================

  /** Получить все слоты на сегодня + статус подтверждения */
  async getTodaySlots(trainerId, dateStr) {
    const dow = (new Date(dateStr).getDay() + 6) % 7; // JS Sun=0 → Mon=0

    const { data: slots, error: e1 } = await sb().from('schedule_slots')
      .select('*, clients(fio,balance), group_types(name,type,billing_model)')
      .eq('trainer_id', trainerId).eq('day_of_week', dow).eq('active', true)
      .order('start_time');
    if (e1) throw e1;
    if (!slots?.length) return [];

    const slotIds = slots.map(s => s.id);

    const { data: confs } = await sb().from('schedule_confirmations')
      .select('*').in('slot_id', slotIds).eq('session_date', dateStr);

    const confMap = {};
    (confs || []).forEach(c => { confMap[c.slot_id] = c; });

    return slots.map(s => ({ ...s, confirmation: confMap[s.id] || null }));
  },

  async upsertConfirmation(slotId, date, fields) {
    const { data, error } = await sb().from('schedule_confirmations')
      .upsert({ slot_id: slotId, session_date: date, ...fields, updated_at: new Date().toISOString() },
              { onConflict: 'slot_id,session_date' })
      .select().single();
    if (error) throw error;
    return data;
  },

  /** Незакрытые ПТ-слоты за сегодня (для напоминания) */
  async getPendingToday(trainerId, dateStr) {
    const dow = (new Date(dateStr).getDay() + 6) % 7;
    const { data: slots } = await sb().from('schedule_slots')
      .select('id,slot_type,start_time,clients(fio)').eq('trainer_id', trainerId)
      .eq('day_of_week', dow).eq('active', true).in('slot_type', ['pt', 'group']);
    if (!slots?.length) return [];

    const slotIds = slots.map(s => s.id);
    const { data: confs } = await sb().from('schedule_confirmations')
      .select('slot_id,status').in('slot_id', slotIds).eq('session_date', dateStr);
    const confirmedIds = new Set((confs || []).map(c => c.slot_id));
    return slots.filter(s => !confirmedIds.has(s.id));
  },

  async getAllTrainersWithTgId() {
    const { data, error } = await sb().from('profiles')
      .select('id,fio,tg_id').not('tg_id', 'is', null)
      .in('role', ['trainer', 'senior_trainer']);
    if (error) throw error;
    return data || [];
  },

  // ==================== REPORTS ====================

  async getSummary(year, month, branch = null) {
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month, 1).toISOString();

    let wq = sb().from('workouts').select('trainer_id,category_at_moment,branch,is_debt')
      .gte('workout_date', from).lt('workout_date', to);
    if (branch) wq = wq.eq('branch', branch);

    let dq = sb().from('duties').select('trainer_id,branch,start_time,end_time')
      .gte('start_time', from).lt('start_time', to).not('end_time', 'is', null);
    if (branch) dq = dq.eq('branch', branch);

    const fromDate = `${year}-${String(month).padStart(2,'0')}-01`;
    const toDate   = new Date(year, month, 1).toISOString().slice(0,10);

    let tgq = sb().from('trainer_groups')
      .select('trainer_id,group_type_id,group_types(name,type,billing_model,price_per_month,trainer_percentage)')
      .lte('subscription_start', toDate)
      .or(`subscription_end.is.null,subscription_end.gte.${fromDate}`);
    if (branch) tgq = tgq.eq('branch', branch);

    let gsq = sb().from('group_sessions').select('trainer_id,group_type_id,headcount,group_types(billing_model)')
      .gte('session_date', fromDate).lt('session_date', toDate);
    if (branch) gsq = gsq.eq('branch', branch);

    let pq = sb().from('profiles').select('id,fio,branches,role')
      .in('role', ['trainer', 'senior_trainer']);
    if (branch) pq = pq.contains('branches', [branch]);

    const [w, d, tg, gs, p] = await Promise.all([wq, dq, tgq, gsq, pq]);
    return {
      workouts:      w.data  || [],
      duties:        d.data  || [],
      trainerGroups: tg.data || [],
      groupSessions: gs.data || [],
      profiles:      p.data  || [],
    };
  },

  async getTrainerDetail(trainerId, year, month) {
    const from    = new Date(year, month - 1, 1).toISOString();
    const to      = new Date(year, month,     1).toISOString();
    const fromDay = `${year}-${String(month).padStart(2,'0')}-01`;
    const toDay   = new Date(year, month, 1).toISOString().slice(0,10);

    const [w, d, tg, gs] = await Promise.all([
      sb().from('workouts').select('*, clients(fio)').eq('trainer_id', trainerId)
        .gte('workout_date', from).lt('workout_date', to)
        .order('workout_date', { ascending: false }),
      sb().from('duties').select('*').eq('trainer_id', trainerId)
        .gte('start_time', from).lt('start_time', to)
        .not('end_time', 'is', null).order('start_time', { ascending: false }),
      sb().from('trainer_groups')
        .select('*, group_types(*)')
        .eq('trainer_id', trainerId)
        .lte('subscription_start', toDay)
        .or(`subscription_end.is.null,subscription_end.gte.${fromDay}`),
      sb().from('group_sessions').select('*, group_types(*)')
        .eq('trainer_id', trainerId).gte('session_date', fromDay).lt('session_date', toDay)
        .order('session_date', { ascending: false }),
    ]);

    return {
      workouts:      w.data  || [],
      duties:        d.data  || [],
      trainerGroups: tg.data || [],
      groupSessions: gs.data || [],
    };
  },
};
