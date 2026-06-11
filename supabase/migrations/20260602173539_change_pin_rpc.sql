
CREATE OR REPLACE FUNCTION change_pin(p_profile_id integer, p_pin text)
RETURNS void
LANGUAGE sql
SECURITY DEFINER
AS $$
  UPDATE profiles
  SET pincode = crypt(p_pin, gen_salt('bf', 8))
  WHERE id = p_profile_id;
$$;


