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

// ═════════════════════════════════════════════════════════════════════
// ЭТАП B — API-СЛОЙ: клиент нового FastAPI-бэкенда (aqua-desk-v2)
// Сосуществует с Supabase. Каждый DB-метод сам решает, куда идти,
// по CONFIG.API_MODE[domain] (см. useApi). Сигнатуры DB.* не меняются.
// ═════════════════════════════════════════════════════════════════════

// Домен переключён на новый API? ('api' у самого домена или у 'all').
function useApi(domain) {
  const m = (typeof CONFIG !== 'undefined' && CONFIG.API_MODE) || {};
  return m[domain] === 'api' || (m.all === 'api' && m[domain] !== 'supabase');
}

// ─── ТОКЕНЫ ──────────────────────────────────
// access — полноценный токен после PIN/входа (30 мин). preauth — короткий (5 мин),
// живёт только в процессе входа (Telegram→PIN/claim), в localStorage не кладём.
let _apiToken = null;
let _apiPreauth = null;
function getApiToken() {
  if (_apiToken) return _apiToken;
  try { _apiToken = localStorage.getItem('aq_api_token') || null; } catch (e) {}
  return _apiToken;
}
function setApiToken(t) {
  _apiToken = t || null;
  try { t ? localStorage.setItem('aq_api_token', t) : localStorage.removeItem('aq_api_token'); } catch (e) {}
}
function setApiPreauth(t) { _apiPreauth = t || null; }

// Реакция на протухший/невалидный access-токен. Рефреш-эндпоинта у бэкенда пока
// нет (access живёт 30 мин) — при 401 сбрасываем токен и уводим на экран входа,
// откуда повторный Telegram-логин выдаст свежий токен. Не бросает.
let _apiReauthing = false;
function onApiUnauthorized() {
  if (_apiReauthing) return;
  _apiReauthing = true;
  setApiToken(null);
  try {
    if (typeof toast === 'function') toast('Сессия истекла, войдите заново', 'error');
    // init() перезапустит поток входа (Telegram→PIN); в браузерном режиме — перезагрузка.
    if (typeof init === 'function') { init().finally(() => { _apiReauthing = false; }); return; }
  } catch (e) {}
  _apiReauthing = false;
}

// Универсальный вызов нового API. Возвращает распарсенный JSON (или null для 204).
// При !ok бросает Error(code), где code — бизнес-код из {"error":{"code"}} бэкенда
// (INSUFFICIENT_BALANCE, WRONG_PIN, already_pending, ...). e.message === code —
// совместимо с прежним разбором ошибок в app-коде (e?.message).
async function api(path, opts = {}) {
  const { method = 'GET', body, preauth = false, auth = true, query } = opts;
  let url = CONFIG.API_BASE + path;
  if (query && typeof query === 'object') {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) {
      if (v === undefined || v === null || v === '') continue;
      if (Array.isArray(v)) v.forEach(x => qs.append(k, x));
      else qs.append(k, v);
    }
    const s = qs.toString();
    if (s) url += (url.includes('?') ? '&' : '?') + s;
  }
  const headers = {};
  if (body !== undefined) headers['Content-Type'] = 'application/json';
  if (auth) {
    const tok = preauth ? _apiPreauth : getApiToken();
    if (tok) headers['Authorization'] = 'Bearer ' + tok;
  }
  const res = await fetch(url, {
    method,
    headers,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  let payload = null;
  if (text) { try { payload = JSON.parse(text); } catch (e) { payload = text; } }
  if (!res.ok) {
    const code = payload?.error?.code || payload?.detail || res.statusText || 'API_ERROR';
    if (res.status === 401 && auth && !preauth) onApiUnauthorized();
    const err = new Error(code);
    err.code = code; err.status = res.status; err.payload = payload;
    throw err;
  }
  return payload;
}

// Вход через новый API. Возвращает профиль в форме, которую ждёт boot-поток
// (init()): объект профиля | null (нужна регистрация) | заглушка с has_pin
// (нужен PIN). Побочно кладёт preauth/access-токены. Ошибок не глотает.
async function _apiTelegramProfile(tgId) {
  const initData = _rawInitData();
  let data;
  if (initData) {
    // Боевой путь: подписанный Telegram initData → проверка HMAC на бэкенде.
    data = await api('/auth/telegram', { method: 'POST', body: { init_data: initData }, auth: false });
  } else {
    // Браузерный dev-режим (?tgid=) — подписи нет. Dev-login (только environment=local
    // на бэкенде) сразу выдаёт access-токен по tg_id, минуя Telegram и PIN.
    data = await api('/auth/dev-login', { method: 'POST', body: { tg_id: Number(tgId) }, auth: false });
  }
  if (data.preauth_token) setApiPreauth(data.preauth_token);
  if (data.access_token)  setApiToken(data.access_token);
  if (data.status === 'needs_registration') return null;
  if (data.status === 'needs_pin') {
    // Профиль приходит для приветствия по имени на PIN-экране; access-токен — после PIN
    // (см. verifyPin). has_pin:true держит PIN-гейт (токена ещё нет → boot идёт на PIN).
    const pr = data.profile || { id: null, tg_id: Number(tgId), fio: '', role: '', branches: [] };
    return { ...pr, tg_id: pr.tg_id || Number(tgId), has_pin: true };
  }
  // status 'ok' — профиль привязан и PIN не требуется (или dev-login).
  if (data.profile) {
    if (typeof STATE !== 'undefined') STATE.profile = data.profile;
    return data.profile;
  }
  return null;
}


const DB = {};

Object.assign(DB, {

  // ─── SESSION LOG ────────────────────────────
  async logSession(tgId, fio, role, jsVersion) {
    const ua = navigator.userAgent||'';
    const device = /iPhone|iPad/.test(ua) ? 'iOS'
                 : /Android/.test(ua)     ? 'Android'
                 : /Macintosh|Windows|Linux/.test(ua) ? 'Desktop' : 'Unknown';
    if (useApi('staff')) {
      await api('/sessions', { method:'POST', body:{ tg_id: tgId, fio, role, device, js_version: jsVersion } });
      return;
    }
    await sb().from('user_sessions').insert({tg_id:tgId, fio, role, device, js_version:jsVersion});
  },
  async getRecentSessions(days=30) {
    if (useApi('staff')) return await api('/sessions', { query: { days, limit: 100 } });
    const since = new Date(Date.now() - days*86400000).toISOString();
    const {data,error} = await sb().from('user_sessions')
      .select('*').gte('opened_at',since).order('opened_at',{ascending:false}).limit(100);
    if (error) throw error; return data||[];
  },

  // ─── AUTH ───────────────────────────────────
  async getProfileByTgId(id) {
    if (useApi('auth')) return _apiTelegramProfile(id);
    const {data,error} = await sb().rpc('get_profile_by_tg_id',{p_tg_id:id});
    if (error) throw error; return data;
  },
  async getUnclaimedProfileByFio(fio) {
    if (useApi('auth')) {
      const data = await api('/auth/unclaimed', { query: { fio: fio.trim().replace(/\s+/g,' ') }, preauth: true });
      return data || null;
    }
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
    if (useApi('auth')) {
      const data = await api('/auth/claim', { method:'POST', body:{ profile_id: profileId, pin }, preauth: true });
      setApiToken(data.access_token);
      if (data.profile && typeof STATE !== 'undefined') STATE.profile = data.profile;
      return data.profile;
    }
    const {data,error} = await sb().rpc('claim_profile',{p_profile_id:profileId,p_tg_id:tgId,p_pin:pin});
    if (error) throw error; return data;
  },
  async verifyPin(tgId, pin) {
    if (useApi('auth')) {
      try {
        const data = await api('/auth/pin', { method:'POST', body:{ pin }, preauth: true });
        setApiToken(data.access_token);
        if (data.profile && typeof STATE !== 'undefined') STATE.profile = data.profile;
        return true;
      } catch (e) {
        if (e.code === 'WRONG_PIN') return false; // сохраняем bool-контракт метода
        throw e;
      }
    }
    const {data,error} = await sb().rpc('verify_pin',{p_tg_id:tgId,p_pin:pin});
    if (error) throw error; return data;
  },
  async changePin(profileId, pin, oldPin=null) {
    if (useApi('auth')) {
      await api('/auth/pin/change', { method:'POST', body:{ pin, old_pin: oldPin } });
      return;
    }
    // Смена существующего PIN требует старый (WRONG_OLD_PIN при несовпадении);
    // первичная установка (pincode ещё NULL) проходит без него.
    const {error} = await sb().rpc('change_pin',{p_profile_id:profileId,p_pin:pin,p_old_pin:oldPin});
    if (error) throw error;
  },

  // ─── PROFILES ────────────────────────────────
  async getAllProfiles() {
    if (useApi('staff')) return await api('/profiles');
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
    if (useApi('staff')) return await api('/profiles', { query: { role } });
    const {data,error} = await sb().from('profiles').select('*').eq('role',role).order('fio');
    if (error) throw error; return data||[];
  },
  async addTrainer(fio, branches, role='trainer') {
    if (useApi('staff')) return await api('/profiles', { method:'POST', body:{ fio: fio.trim(), branches, role } });
    const {data,error} = await sb().from('profiles')
      .insert({fio:fio.trim(),branches,role}).select().single();
    if (error) throw error; return data;
  },
  async updateProfile(id, fields) {
    if (useApi('staff')) return await api('/profiles/'+id, { method:'PATCH', body: fields });
    const {data,error} = await sb().from('profiles')
      .update(fields).eq('id',id).select().single();
    if (error) throw error; return data;
  },

  /** Архивировать тренера: закрывает доступ, история сохраняется */
  async archiveTrainer(id) {
    if (useApi('staff')) { await api('/profiles/'+id+'/archive', { method:'POST' }); return; }
    const {error} = await sb().from('profiles')
      .update({ tg_id: null, pincode: null, is_archived: true })
      .eq('id', id);
    if (error) throw error;
  },

  /** Удалить тренера: полное удаление (только если нет workouts) */
  async deleteTrainer(id) {
    // Бэкенд сам проверяет наличие workouts → 400 has_history (api() бросит Error('has_history')).
    if (useApi('staff')) { await api('/profiles/'+id+'/delete', { method:'POST' }); return; }
    const {data: wk} = await sb().from('workouts')
      .select('id').eq('trainer_id', id).limit(1);
    if (wk?.length) throw new Error('has_history');
    const {error} = await sb().from('profiles').delete().eq('id', id);
    if (error) throw error;
  },

  // ─── BRANCHES ────────────────────────────────
  async getBranches() {
    if (useApi('staff')) return await api('/branches');
    const {data,error} = await sb().from('branches').select('*').order('name');
    if (error) throw error; return data||[];
  },
  async addBranch(name) {
    if (useApi('staff')) return await api('/branches', { method:'POST', body:{ name: name.trim() } });
    const {data,error} = await sb().from('branches')
      .insert({name:name.trim()}).select().single();
    if (error) throw error; return data;
  },
  async deleteBranch(id) {
    if (useApi('staff')) { await api('/branches/'+id+'/delete', { method:'POST' }); return; }
    const {error} = await sb().from('branches').delete().eq('id',id);
    if (error) throw error;
  },
  // ─── BRANCH ACCESS (субпанель) ───────────────
  async getBranchAccess(trainerId) {
    if (useApi('staff')) {
      const rows = await api('/branch-access', { query: { trainer_id: trainerId } });
      return (rows||[]).map(r=>r.branch);
    }
    const {data,error} = await sb().from('branch_access')
      .select('branch').eq('trainer_id',trainerId);
    if (error) throw error; return (data||[]).map(r=>r.branch);
  },
  async setBranchAccess(trainerId, branches) {
    if (useApi('staff')) { await api('/branch-access', { method:'POST', body:{ trainer_id: trainerId, branches } }); return; }
    // Удаляем старые и вставляем новые
    await sb().from('branch_access').delete().eq('trainer_id',trainerId);
    if (branches.length) {
      await sb().from('branch_access').insert(
        branches.map(b=>({trainer_id:trainerId, branch:b}))
      );
    }
  },
  async renameBranch(oldName, newName) {
    if (useApi('staff')) { await api('/branches/rename', { method:'POST', body:{ old_name: oldName, new_name: newName.trim() } }); return; }
    const {error:e1} = await sb().from('branches')
      .update({name:newName.trim()}).eq('name',oldName);
    if (e1) throw e1;
    const {error:e2} = await sb().rpc('rename_branch',{old_name:oldName,new_name:newName.trim()});
    if (e2) throw e2;
  },
});
