-- Снимок остатка на момент списания + RPC списания, возвращающий новый баланс.
--
-- Зачем: ресепшн переходит с реконструкции «N/M» (из subscriptions+workouts) на
-- трансляцию РЕАЛЬНОГО остатка тренера. Чтобы показать ровно то, что видел тренер
-- в момент списания (а не текущий баланс, ушедший вперёд), фиксируем остаток прямо
-- на строке ПТ: balance_before / balance_after.
--
-- Применять ВМЕСТЕ с деплоем фронта, который пишет снимок (db.clients.logWorkouts и др.)
-- и показывает его на карточке ресепшна вместо «_enrichReceptionSeq».

ALTER TABLE public.workouts
  ADD COLUMN IF NOT EXISTS balance_before integer,
  ADD COLUMN IF NOT EXISTS balance_after  integer;

COMMENT ON COLUMN public.workouts.balance_after IS
  'Остаток ПТ клиента сразу ПОСЛЕ этого списания (снимок для ресепшна). NULL — старые ПТ до внедрения снимка.';
COMMENT ON COLUMN public.workouts.balance_before IS
  'Остаток ПТ клиента ДО этого списания. NULL — старые ПТ / без списания баланса.';

-- Атомарное списание n ПТ с защитой от минуса, ВОЗВРАЩАЕТ новый остаток.
-- Аналог increment_balance(delta<0), но отдаёт итог — нужен для снимка balance_after.
CREATE OR REPLACE FUNCTION public.deduct_balance(client_id uuid, n integer)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE newbal integer;
BEGIN
  IF n IS NULL OR n <= 0 THEN
    RAISE EXCEPTION 'BAD_DEDUCTION';
  END IF;
  UPDATE clients c
     SET balance = COALESCE(c.balance, 0) - n
   WHERE c.id = client_id
     AND COALESCE(c.balance, 0) - n >= 0
   RETURNING c.balance INTO newbal;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM clients c WHERE c.id = client_id) THEN
      RAISE EXCEPTION 'INSUFFICIENT_BALANCE';
    ELSE
      RAISE EXCEPTION 'CLIENT_NOT_FOUND';
    END IF;
  END IF;
  RETURN newbal;
END;
$$;

GRANT EXECUTE ON FUNCTION public.deduct_balance(uuid, integer) TO anon, authenticated, service_role;
