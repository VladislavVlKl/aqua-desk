// =============================================
// База данных v5 — полный файл
// =============================================

let _sb = null;
function sb() {
  if (!_sb) _sb = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);
  return _sb;
}

// ─── JWT-АУТЕНТИФИКАЦИЯ (Telegram initData → Supabase-сессия) ──────────
// Сырой подписанный initData от Telegram (НЕ initDataUnsafe). В браузере вне
// Telegram его нет → вернётся '' и весь JWT-поток корректно пропускается.
function _rawInitData() {
  try { return window.Telegram?.WebApp?.initData || ''; } catch (e) { return ''; }
}

// Декод payload JWT для диагностики (только чтение claims, без проверки подписи).
function _decodeJwt(token) {
  try {
    const p = token.split('.')[1];
    return JSON.parse(decodeURIComponent(escape(atob(p.replace(/-/g,'+').replace(/_/g,'/')))));
  } catch (e) { return null; }
}

// Запрашивает Supabase-сессию у Edge Function telegram-auth. Никогда не бросает:
// при любой ошибке/отсутствии initData возвращает null, и приложение продолжает
// работать под anon (текущее поведение).
async function _fetchJwtSession() {
  const initData = _rawInitData();
  if (!initData) return null; // браузерный/dev-вход без подписи — JWT не запрашиваем
  try {
    const res = await fetch(`${CONFIG.SUPABASE_URL}/functions/v1/telegram-auth`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'apikey': CONFIG.SUPABASE_ANON_KEY,
        'Authorization': `Bearer ${CONFIG.SUPABASE_ANON_KEY}`,
      },
      body: JSON.stringify({ initData }),
    });
    if (!res.ok) {
      console.warn('[jwt] telegram-auth вернул', res.status, await res.text().catch(()=>''));
      return null;
    }
    return await res.json(); // { session, tg_id }
  } catch (e) {
    console.warn('[jwt] запрос telegram-auth не удался:', e?.message || e);
    return null;
  }
}

// Главная точка входа JWT. Поведение по CONFIG.JWT_MODE. Никогда не бросает.
// Возвращает true, если сессия реально переключена на authenticated (режим 'on').
async function ensureJwtSession() {
  const mode = (typeof CONFIG !== 'undefined' && CONFIG.JWT_MODE) || 'off';
  if (mode === 'off') return false;
  const data = await _fetchJwtSession();
  if (!data?.session?.access_token) return false;

  if (mode === 'diagnostic') {
    // Только смотрим, что токен валиден и несёт tg_id — сессию НЕ переключаем.
    const claims = _decodeJwt(data.session.access_token);
    console.log('[jwt:diagnostic] получен токен. role=', claims?.role,
                'app_metadata.tg_id=', claims?.app_metadata?.tg_id,
                'exp=', claims?.exp ? new Date(claims.exp*1000).toISOString() : '?');
    return false; // остаёмся под anon — ничего не ломается
  }

  if (mode === 'on') {
    try {
      const { error } = await sb().auth.setSession({
        access_token:  data.session.access_token,
        refresh_token: data.session.refresh_token,
      });
      if (error) { console.warn('[jwt] setSession error:', error.message); return false; }
      return true;
    } catch (e) {
      console.warn('[jwt] setSession упал:', e?.message || e);
      return false;
    }
  }
  return false;
}

// Фильтр запроса по филиалу: строка → один филиал (.eq), массив → несколько (.in),
// null/'' /[] → без фильтра. Обратно совместимо со старыми вызовами (строка).
function _brFilter(q, branch) {
  if (Array.isArray(branch)) return branch.length ? q.in('branch', branch) : q;
  return branch ? q.eq('branch', branch) : q;
}


const DB = {};

Object.assign(DB, {

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
});
