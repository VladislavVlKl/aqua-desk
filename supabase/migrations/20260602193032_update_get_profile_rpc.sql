
CREATE OR REPLACE FUNCTION public.get_profile_by_tg_id(p_tg_id bigint)
RETURNS json LANGUAGE sql STABLE SECURITY DEFINER AS $$
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


