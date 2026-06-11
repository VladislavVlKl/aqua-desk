
-- 1. Включить pgcrypto
CREATE EXTENSION IF NOT EXISTS pgcrypto;

-- 2. Захешировать существующие 4-значные PIN-ы (bcrypt)
UPDATE profiles
SET pincode = crypt(pincode, gen_salt('bf', 8))
WHERE pincode IS NOT NULL
  AND pincode ~ '^\d{4}$';

-- 3. Верификация PIN на сервере (не возвращает хеш клиенту)
CREATE OR REPLACE FUNCTION verify_pin(p_tg_id bigint, p_pin text)
RETURNS boolean
LANGUAGE sql
SECURITY DEFINER
STABLE
AS $$
  SELECT EXISTS(
    SELECT 1 FROM profiles
    WHERE tg_id = p_tg_id
      AND is_archived = false
      AND crypt(p_pin, pincode) = pincode
  );
$$;

-- 4. Сохранение профиля при регистрации (хеш PIN-а)
CREATE OR REPLACE FUNCTION claim_profile(p_profile_id uuid, p_tg_id bigint, p_pin text)
RETURNS json
LANGUAGE plpgsql
SECURITY DEFINER
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

  -- Не возвращаем pincode
  RETURN json_build_object(
    'id',       v_row.id,
    'tg_id',    v_row.tg_id,
    'fio',      v_row.fio,
    'role',     v_row.role,
    'branches', v_row.branches,
    'is_archived', v_row.is_archived
  );
END;
$$;


