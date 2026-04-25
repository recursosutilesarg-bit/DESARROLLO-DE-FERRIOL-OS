-- Ferriol OS · Simulación / datos de prueba en mlm_ledger (idempotente)
-- Ejecutá en Supabase SQL Editor DESPUÉS de supabase-ferriol-payments.sql (beneficiary_user_id nullable).
-- Desde la app (Cobros): botón «Insertar 3 movimientos demo» llama a ferriol_demo_seed_ledger().
--
-- Crea 3 filas:
--   1) company_reserve pending → la empresa tiene algo «a cobrar» (admin).
--   2) vendor_payable_company + sale_commission pending con beneficiario = tu usuario super
--      → los ves en Panel admin → Cobros (lista de pendientes). Los kiosqueros no consultan mlm_ledger en la app.
--
-- No borra datos; volver a ejecutar no duplica (idempotency_key).
-- Para quitar solo esas filas: ferriol_demo_clear_seed_ledger() o el botón «Quitar movimientos demo».

CREATE OR REPLACE FUNCTION public.ferriol_demo_seed_ledger()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  n_company int := 0;
  n_pay int := 0;
  n_comm int := 0;
  v_month date := date_trunc('month', now())::date;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo administradores pueden cargar la demo.');
  END IF;

  INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
  VALUES (
    NULL, v_uid, 'company_reserve', 'pending', 1980, 'ARS', NULL,
    'ferriol:demo:seed:company',
    jsonb_build_object('demo', true, 'label', 'Demo · empresa 20% licencia (a cobrar)'),
    v_month
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n_company = ROW_COUNT;

  INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
  VALUES (
    v_uid, v_uid, 'vendor_payable_company', 'pending', 1980, 'ARS', NULL,
    'ferriol:demo:seed:payable',
    jsonb_build_object('demo', true, 'label', 'Demo · aporte 20% pendiente (vista socio)'),
    v_month
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n_pay = ROW_COUNT;

  INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
  VALUES (
    v_uid, v_uid, 'sale_commission', 'pending', 7920, 'ARS', 0,
    'ferriol:demo:seed:commission',
    jsonb_build_object('demo', true, 'label', 'Demo · comisión 80% pendiente'),
    v_month
  )
  ON CONFLICT (idempotency_key) DO NOTHING;
  GET DIAGNOSTICS n_comm = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'inserted_rows', n_company + n_pay + n_comm,
    'inserted_company_reserve', n_company > 0,
    'inserted_vendor_payable', n_pay > 0,
    'inserted_sale_commission', n_comm > 0,
    'hint', 'Si inserted_rows = 0, las 3 filas ya existían. Vista admin: Cobros. Kiosqueros: solo licencia en Inicio.'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_demo_seed_ledger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_demo_seed_ledger() TO authenticated;

CREATE OR REPLACE FUNCTION public.ferriol_demo_clear_seed_ledger()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  n_del int := 0;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo administradores pueden quitar la demo.');
  END IF;

  DELETE FROM mlm_ledger
  WHERE idempotency_key IN (
    'ferriol:demo:seed:company',
    'ferriol:demo:seed:payable',
    'ferriol:demo:seed:commission'
  );
  GET DIAGNOSTICS n_del = ROW_COUNT;

  RETURN jsonb_build_object(
    'ok', true,
    'deleted_rows', n_del,
    'hint', 'Solo se borran filas con esas claves de idempotencia (insertadas por la demo).'
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_demo_clear_seed_ledger() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_demo_clear_seed_ledger() TO authenticated;
