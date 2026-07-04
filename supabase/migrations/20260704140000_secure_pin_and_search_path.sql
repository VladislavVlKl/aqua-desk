-- Пуш защиты (этап 0): change_pin требует старый PIN + search_path на SECURITY DEFINER.
-- Применено в прод 2026-07-04 (apply_migration secure_pin_and_search_path).
-- pgcrypto (crypt/gen_salt) живёт в схеме extensions — включаем её в search_path там, где нужна.

-- 1) change_pin: смена существующего PIN — только со старым PIN (WRONG_OLD_PIN).
--    Первичная установка (pincode IS NULL) — без старого. Старую 2-арг сигнатуру дропаем,
--    иначе PostgREST получит неоднозначность перегрузок.
DROP FUNCTION IF EXISTS public.change_pin(integer, text);
CREATE OR REPLACE FUNCTION public.change_pin(p_profile_id integer, p_pin text, p_old_pin text DEFAULT NULL)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE v_pin text;
BEGIN
  IF p_pin !~ '^\d{4}$' THEN
    RAISE EXCEPTION 'BAD_PIN';
  END IF;
  SELECT pincode INTO v_pin FROM profiles WHERE id = p_profile_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'PROFILE_NOT_FOUND';
  END IF;
  IF v_pin IS NOT NULL AND (p_old_pin IS NULL OR crypt(p_old_pin, v_pin) <> v_pin) THEN
    RAISE EXCEPTION 'WRONG_OLD_PIN';
  END IF;
  UPDATE profiles SET pincode = crypt(p_pin, gen_salt('bf', 8)) WHERE id = p_profile_id;
END;
$$;

-- 2) verify_pin: + search_path
CREATE OR REPLACE FUNCTION public.verify_pin(p_tg_id bigint, p_pin text)
RETURNS boolean
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public, extensions
AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles
    WHERE tg_id = p_tg_id
      AND is_archived = false
      AND crypt(p_pin, pincode) = pincode
  );
$$;

-- 3) claim_profile: + search_path
CREATE OR REPLACE FUNCTION public.claim_profile(p_profile_id integer, p_tg_id bigint, p_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, extensions
AS $$
DECLARE
  v_row profiles%ROWTYPE;
BEGIN
  UPDATE profiles
  SET tg_id   = p_tg_id,
      pincode = crypt(p_pin, gen_salt('bf', 8))
  WHERE id = p_profile_id
    AND tg_id IS NULL
  RETURNING * INTO v_row;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Profile not found or already claimed';
  END IF;

  RETURN json_build_object(
    'id',          v_row.id,
    'tg_id',       v_row.tg_id,
    'fio',         v_row.fio,
    'role',        v_row.role,
    'branches',    v_row.branches,
    'is_archived', v_row.is_archived,
    'has_pin',     true
  );
END;
$$;

-- 4) get_profile_by_tg_id: + search_path
CREATE OR REPLACE FUNCTION public.get_profile_by_tg_id(p_tg_id bigint)
RETURNS json
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT json_build_object(
    'id',          id,
    'tg_id',       tg_id,
    'fio',         fio,
    'role',        role,
    'extra_roles', COALESCE(extra_roles, '{}'),
    'branches',    branches,
    'is_archived', is_archived,
    'has_pin',     (pincode IS NOT NULL)
  )
  FROM profiles
  WHERE tg_id = p_tg_id
  LIMIT 1;
$$;

-- 5) rename_branch: + search_path
CREATE OR REPLACE FUNCTION public.rename_branch(old_name text, new_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE profiles      SET branches = array_replace(branches, old_name, new_name) WHERE old_name = ANY(branches);
  UPDATE workouts      SET branch   = new_name WHERE branch = old_name;
  UPDATE duties        SET branch   = new_name WHERE branch = old_name;
  UPDATE schedule_slots SET branch  = new_name WHERE branch = old_name;
  UPDATE trainer_groups SET branch  = new_name WHERE branch = old_name;
  UPDATE group_sessions SET branch  = new_name WHERE branch = old_name;
END;
$$;
