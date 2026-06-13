// =============================================
// База данных v5 — полный файл
// =============================================

let _sb = null;
function sb() {
  if (!_sb) _sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return _sb;
}

const DB = {

  // ─── SESSION LOG ────────────────────────────
  async logSession(tgId, fio, role, jsVersion) {
    const ua = navigator.userAgent||'';
    const device = /iPhone|iPad/.test(ua) ? 'iOS'
                 : /Android/.test(ua)     ? 'Android'
                 : /Macintosh|Windows|Linux/.test(ua) ? 'Desktop' : 'Unknown';
    await sb().from('user_sessions').insert({tg_id:tgId, fio, role, device, js_version:jsVersion});
  },
  async getRecentSessions(days=30) {
    const since = new Date(Date.now() - days*86400000).toISOString();
    const {data,error} = await sb().from('user_sessions')
      .select('*').gte('opened_at',since).order('opened_at',{ascending:false}).limit(100);
    if (error) throw error; return data||[];
  },

  // ─── AUTH ───────────────────────────────────
  async getProfileByTgId(id) {
    const {data,error} = await sb().rpc('get_profile_by_tg_id',{p_tg_id:id});
    if (error) throw error; return data;
  },
  async getUnclaimedProfileByFio(fio) {
    const normalized = fio.trim().replace(/\s+/g,' ');
    // Сначала ищем точное совпадение (case-insensitive)
    const {data:exact} = await sb().from('profiles')
      .select('id,fio,role,branches')
      .ilike('fio', normalized).is('tg_id',null);
    if (exact?.length === 1) return exact[0];
    // Запасной поиск: по каждому слову (Фамилия + Имя)
    const words = normalized.split(' ').filter(Boolean);
    if (words.length >= 2) {
      const pattern = `%${words[0]}%${words[1]}%`;
      const {data:fuzzy} = await sb().from('profiles')
        .select('id,fio,role,branches')
        .ilike('fio', pattern).is('tg_id',null);
      if (fuzzy?.length === 1) return fuzzy[0];
      if (fuzzy?.length > 1) {
        // Несколько совпадений — берём самое похожее (точно совпадающее начало)
        const best = fuzzy.find(p=>p.fio.toLowerCase().startsWith(words[0].toLowerCase()));
        if (best) return best;
        return fuzzy[0];
      }
    }
    // Ничего не найдено
    return null;
  },
  async claimProfile(profileId, tgId, pin) {
    const {data,error} = await sb().rpc('claim_profile',{p_profile_id:profileId,p_tg_id:tgId,p_pin:pin});
    if (error) throw error; return data;
  },
  async verifyPin(tgId, pin) {
    const {data,error} = await sb().rpc('verify_pin',{p_tg_id:tgId,p_pin:pin});
    if (error) throw error; return data;
  },
  async changePin(profileId, pin) {
    const {error} = await sb().rpc('change_pin',{p_profile_id:profileId,p_pin:pin});
    if (error) throw error;
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
  // ─── BRANCH ACCESS (субпанель) ───────────────
  async getBranchAccess(trainerId) {
    const {data,error} = await sb().from('branch_access')
      .select('branch').eq('trainer_id',trainerId);
    if (error) throw error; return (data||[]).map(r=>r.branch);
  },
  async setBranchAccess(trainerId, branches) {
    // Удаляем старые и вставляем новые
    await sb().from('branch_access').delete().eq('trainer_id',trainerId);
    if (branches.length) {
      await sb().from('branch_access').insert(
        branches.map(b=>({trainer_id:trainerId, branch:b}))
      );
    }
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

  // ─── WORKOUTS ────────────────────────────────
  async logWorkouts(rows) {
    const {data,error} = await sb().from('workouts').insert(rows).select();
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
               age:age||null, category, session_date:new Date().toISOString()})
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
  async deleteWorkout(id) {
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

    // Повторяющиеся слоты на этот день недели
    const {data:recurring, error:e1} = await sb().from('schedule_slots')
      .select('*, clients(fio,balance,category,age,drop_in_used), group_types(name,type,billing_model)')
      .eq('trainer_id',trainerId).eq('day_of_week',dow).eq('active',true)
      .is('specific_date',null)
      .order('start_time');
    if (e1) throw e1;

    // Разовые слоты именно на эту дату
    const {data:oneTime} = await sb().from('schedule_slots')
      .select('*, clients(fio,balance,category,age,drop_in_used), group_types(name,type,billing_model)')
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

    // ── АВТО-ЗП детских групп: один расчёт на инстанс, без N+1 ──
    const childTgs = (tg.data||[]).filter(_isChildTg);
    const rateHistory = childTgs.length
      ? await DB.getRateHistory(childTgs.map(t=>t.id), fromDay) : [];
    const childAutoByTrainer = {};
    _calcChildInstances({
      childTgs,
      payments:      gpayR.data||[],
      sessions:      gs.data   ||[],
      substitutions: gsubR.data||[],   // уже только approved
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
      groupSubstitutions:  gsubR.data  ||[],
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
      .select().single();
    if (error) throw error; return data;
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
    const {error} = await sb().from('group_substitutions')
      .update({status:'approved', rate}).eq('id',id);
    if (error) throw error;
  },
});
