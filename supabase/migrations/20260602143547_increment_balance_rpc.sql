
CREATE OR REPLACE FUNCTION increment_balance(client_id uuid, delta integer)
RETURNS void LANGUAGE sql SECURITY DEFINER AS $$
  UPDATE clients SET balance = COALESCE(balance, 0) + delta WHERE id = client_id;
$$;


