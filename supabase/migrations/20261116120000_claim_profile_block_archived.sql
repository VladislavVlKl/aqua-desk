-- claim_profile: архивный профиль привязать нельзя.
-- Архивация обнуляет tg_id → без проверки уволенный сотрудник мог заново
-- «привязаться» по ФИО на экране первого входа и задать новый PIN.
CREATE OR REPLACE FUNCTION public.claim_profile(p_profile_id integer, p_tg_id bigint, p_pin text)
 RETURNS json
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public', 'extensions'
AS $function$
DECLARE
  v_row profiles%ROWTYPE;
BEGIN
  UPDATE profiles
  SET tg_id   = p_tg_id,
      pincode = crypt(p_pin, gen_salt('bf', 8))
  WHERE id = p_profile_id
    AND tg_id IS NULL
    AND is_archived = false
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
$function$;
