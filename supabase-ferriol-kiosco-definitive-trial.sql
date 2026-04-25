-- Ferriol OS · Prueba configurable + venta licencia kiosco tras alta definitiva (post-prueba)
-- Ejecutá DESPUÉS de supabase-ferriol-payments.sql
-- La app usa app_settings.trial_duration_days (días) para nuevos registros.
-- ferriol_register_kiosco_definitive_sale: super registra venta 20/80 según plan (una vez por kiosco).

INSERT INTO app_settings (key, value)
SELECT 'trial_duration_days', '15'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'trial_duration_days');

-- El socio solo ve filas con beneficiary_user_id = su id (comisión 80% y obligación 20% a empresa).

CREATE OR REPLACE FUNCTION public.ferriol_register_kiosco_definitive_sale(p_kiosco_user_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  k profiles%ROWTYPE;
  spon profiles%ROWTYPE;
  plan jsonb;
  M numeric;
  sc numeric;
  sv numeric;
  comp_amt numeric;
  sell_amt numeric;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo administradores pueden registrar esta venta.');
  END IF;

  SELECT * INTO k FROM profiles WHERE id = p_kiosco_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Usuario no encontrado.');
  END IF;
  IF k.role IS DISTINCT FROM 'kiosquero' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo aplica a cuentas kiosquero.');
  END IF;
  IF k.sponsor_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El kiosco debe tener un referidor (socio vendedor).');
  END IF;

  SELECT * INTO spon FROM profiles WHERE id = k.sponsor_id;
  IF NOT FOUND OR spon.role IS DISTINCT FROM 'partner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El referidor debe ser socio vendedor (partner) que cerró la venta.');
  END IF;

  SELECT value INTO plan FROM mlm_plan_config WHERE key = 'compensation_v1' LIMIT 1;
  IF plan IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Falta compensation_v1 en mlm_plan_config.');
  END IF;

  M := COALESCE((plan->>'kiosco_monthly')::numeric, 9900);
  sc := COALESCE((plan->>'sale_company_pct')::numeric, 0.20);
  sv := COALESCE((plan->>'sale_vendor_pct')::numeric, 0.80);
  comp_amt := round(M * sc, 2);
  sell_amt := round(M * sv, 2);

  INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
  VALUES (NULL, p_kiosco_user_id, 'company_reserve', 'pending', comp_amt, 'ARS', NULL,
    'kiosdef:' || p_kiosco_user_id::text || ':company',
    jsonb_build_object('seller_user_id', k.sponsor_id, 'kiosco_user_id', p_kiosco_user_id, 'sale_kind', 'kiosco_definitive', 'label', 'empresa_20pct'),
    date_trunc('month', now())::date);

  INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
  VALUES (k.sponsor_id, p_kiosco_user_id, 'vendor_payable_company', 'pending', comp_amt, 'ARS', NULL,
    'kiosdef:' || p_kiosco_user_id::text || ':payable',
    jsonb_build_object('seller_user_id', k.sponsor_id, 'kiosco_user_id', p_kiosco_user_id, 'sale_kind', 'kiosco_definitive', 'label', 'vendedor_debe_empresa_20pct'),
    date_trunc('month', now())::date);

  INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
  VALUES (k.sponsor_id, p_kiosco_user_id, 'sale_commission', 'pending', sell_amt, 'ARS', 0,
    'kiosdef:' || p_kiosco_user_id::text || ':seller',
    jsonb_build_object('seller_user_id', k.sponsor_id, 'kiosco_user_id', p_kiosco_user_id, 'sale_kind', 'kiosco_definitive', 'label', 'vendedor_80pct'),
    date_trunc('month', now())::date);

  RETURN jsonb_build_object('ok', true, 'kiosco_user_id', p_kiosco_user_id, 'company_pct_amount', comp_amt, 'seller_pct_amount', sell_amt);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Esta venta ya estaba registrada para este kiosco.');
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_register_kiosco_definitive_sale(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_register_kiosco_definitive_sale(uuid) TO authenticated;
