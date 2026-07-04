-- Защита баланса от ухода в минус.
-- Списание (delta < 0) отклоняется, если итог станет отрицательным: RAISE 'INSUFFICIENT_BALANCE'.
-- Пополнение (delta >= 0) разрешено всегда — в т.ч. клиентам с уже отрицательным балансом
-- (покупка пакета 5 ПТ при балансе -6 должна проходить: -6+5=-1 — это погашение долга).
-- ВАЖНО: применять ОДНОВРЕМЕННО с деплоем фронта >= 20260703a — старый фронт при ошибке
-- RPC не откатывает вставленную ПТ (появится тренировка без списания).
CREATE OR REPLACE FUNCTION public.increment_balance(client_id uuid, delta integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF delta < 0 THEN
    UPDATE clients c
       SET balance = COALESCE(c.balance, 0) + delta
     WHERE c.id = client_id
       AND COALESCE(c.balance, 0) + delta >= 0;
    IF NOT FOUND THEN
      IF EXISTS (SELECT 1 FROM clients c WHERE c.id = client_id) THEN
        RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
      ELSE
        RAISE EXCEPTION 'CLIENT_NOT_FOUND';
      END IF;
    END IF;
  ELSE
    UPDATE clients c
       SET balance = COALESCE(c.balance, 0) + delta
     WHERE c.id = client_id;
  END IF;
END;
$$;
