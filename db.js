// =============================================
// Слой базы данных — все запросы к Supabase
// =============================================

let _sb = null;

function getSupabase() {
  if (!_sb) _sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return _sb;
}

const DB = {

  // ------------------------------------------
  // АВТОРИЗАЦИЯ
  // ------------------------------------------

  /** Найти профиль по Telegram ID */
  async getProfileByTgId(tgId) {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('*')
      .eq('tg_id', tgId)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Найти незанятый профиль по ФИО (для первичной регистрации) */
  async getUnclaimedProfileByFio(fio) {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('*')
      .ilike('fio', fio.trim())
      .is('tg_id', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Привязать Telegram ID и PIN к профилю (регистрация тренера) */
  async claimProfile(profileId, tgId, pincode) {
    const { data, error } = await getSupabase()
      .from('profiles')
      .update({ tg_id: tgId, pincode: pincode })
      .eq('id', profileId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ------------------------------------------
  // УПРАВЛЕНИЕ ПЕРСОНАЛОМ (АДМИН)
  // ------------------------------------------

  /** Все профили */
  async getAllProfiles() {
    const { data, error } = await getSupabase()
      .from('profiles')
      .select('*')
      .order('fio');
    if (error) throw error;
    return data;
  },

  /** Добавить тренера */
  async addTrainer(fio, branches) {
    const { data, error } = await getSupabase()
      .from('profiles')
      .insert({ fio: fio.trim(), branches, role: 'trainer' })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Обновить профиль тренера */
  async updateTrainer(id, fields) {
    const { data, error } = await getSupabase()
      .from('profiles')
      .update(fields)
      .eq('id', id)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  // ------------------------------------------
  // КЛИЕНТЫ
  // ------------------------------------------

  /** Клиенты тренера */
  async getClients(trainerId) {
    const { data, error } = await getSupabase()
      .from('clients')
      .select('*')
      .eq('trainer_id', trainerId)
      .order('last_used', { ascending: false, nullsFirst: false });
    if (error) throw error;
    return data || [];
  },

  /** Добавить клиента */
  async addClient(fio, category, trainerId) {
    const { data, error } = await getSupabase()
      .from('clients')
      .insert({ fio: fio.trim(), category, trainer_id: trainerId, balance: 0 })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Пополнить баланс клиента */
  async addBalance(clientId, amount) {
    const { data, error } = await getSupabase().rpc('increment_balance', {
      client_id: clientId,
      amount: amount,
    });
    // Fallback если RPC не создан — обычный select+update
    if (error) {
      const { data: cl } = await getSupabase()
        .from('clients').select('balance').eq('id', clientId).single();
      const { data: updated, error: e2 } = await getSupabase()
        .from('clients')
        .update({ balance: (cl?.balance || 0) + amount })
        .eq('id', clientId)
        .select().single();
      if (e2) throw e2;
      return updated;
    }
    return data;
  },

  // ------------------------------------------
  // ТРЕНИРОВКИ
  // ------------------------------------------

  /** Записать одну или несколько тренировок */
  async logWorkouts(rows) {
    // rows: [{trainer_id, client_id, category_at_moment, branch, workout_date, notes}]
    const { data, error } = await getSupabase()
      .from('workouts')
      .insert(rows)
      .select();
    if (error) throw error;

    // Уменьшаем баланс клиента на кол-во записей
    const clientId = rows[0].client_id;
    const { data: cl } = await getSupabase()
      .from('clients').select('balance').eq('id', clientId).single();
    await getSupabase()
      .from('clients')
      .update({
        balance: Math.max(0, (cl?.balance || 0) - rows.length),
        last_used: new Date().toISOString(),
      })
      .eq('id', clientId);

    return data;
  },

  /** История тренировок тренера за месяц */
  async getWorkouts(trainerId, year, month) {
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month, 1).toISOString();
    const { data, error } = await getSupabase()
      .from('workouts')
      .select('*, clients(fio)')
      .eq('trainer_id', trainerId)
      .gte('created_at', from)
      .lt('created_at', to)
      .order('created_at', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  /** Удалить тренировку (только в окне 30 мин) */
  async deleteWorkout(id) {
    const { error } = await getSupabase()
      .from('workouts')
      .delete()
      .eq('id', id);
    if (error) throw error;
  },

  // ------------------------------------------
  // ДЕЖУРСТВА
  // ------------------------------------------

  /** Активное дежурство тренера */
  async getActiveDuty(trainerId) {
    const { data, error } = await getSupabase()
      .from('duties')
      .select('*')
      .eq('trainer_id', trainerId)
      .is('end_time', null)
      .maybeSingle();
    if (error) throw error;
    return data;
  },

  /** Начать дежурство */
  async startDuty(trainerId, branch) {
    const { data, error } = await getSupabase()
      .from('duties')
      .insert({ trainer_id: trainerId, branch })
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Завершить дежурство */
  async endDuty(dutyId) {
    const { data, error } = await getSupabase()
      .from('duties')
      .update({ end_time: new Date().toISOString() })
      .eq('id', dutyId)
      .select()
      .single();
    if (error) throw error;
    return data;
  },

  /** Дежурства тренера за месяц */
  async getDuties(trainerId, year, month) {
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month, 1).toISOString();
    const { data, error } = await getSupabase()
      .from('duties')
      .select('*')
      .eq('trainer_id', trainerId)
      .gte('start_time', from)
      .lt('start_time', to)
      .not('end_time', 'is', null)
      .order('start_time', { ascending: false });
    if (error) throw error;
    return data || [];
  },

  // ------------------------------------------
  // ОТЧЁТЫ (АДМИН)
  // ------------------------------------------

  /** Сводка по всем тренерам за месяц */
  async getSummary(year, month, branch = null) {
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month, 1).toISOString();

    // Тренировки
    let wq = getSupabase()
      .from('workouts')
      .select('trainer_id, category_at_moment, branch')
      .gte('workout_date', from)
      .lt('workout_date', to);
    if (branch) wq = wq.eq('branch', branch);
    const { data: workouts } = await wq;

    // Дежурства
    let dq = getSupabase()
      .from('duties')
      .select('trainer_id, branch, start_time, end_time')
      .gte('start_time', from)
      .lt('start_time', to)
      .not('end_time', 'is', null);
    if (branch) dq = dq.eq('branch', branch);
    const { data: duties } = await dq;

    // Профили
    const { data: profiles } = await getSupabase()
      .from('profiles')
      .select('id, fio, branches')
      .eq('role', 'trainer');

    return { workouts: workouts || [], duties: duties || [], profiles: profiles || [] };
  },

  /** Детальный лог тренера за месяц (для сверки) */
  async getTrainerDetail(trainerId, year, month) {
    const from = new Date(year, month - 1, 1).toISOString();
    const to   = new Date(year, month, 1).toISOString();

    const [w, d] = await Promise.all([
      getSupabase()
        .from('workouts')
        .select('*, clients(fio)')
        .eq('trainer_id', trainerId)
        .gte('workout_date', from)
        .lt('workout_date', to)
        .order('workout_date', { ascending: false }),
      getSupabase()
        .from('duties')
        .select('*')
        .eq('trainer_id', trainerId)
        .gte('start_time', from)
        .lt('start_time', to)
        .not('end_time', 'is', null)
        .order('start_time', { ascending: false }),
    ]);

    return { workouts: w.data || [], duties: d.data || [] };
  },
};
