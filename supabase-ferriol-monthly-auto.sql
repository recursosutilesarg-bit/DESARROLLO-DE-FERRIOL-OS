-- Ferriol OS · Facturación mensual automática (pg_cron) + anclas en profiles
-- Ejecutá DESPUÉS de supabase-ferriol-kiosco-definitive-trial.sql (y ferriol-payments).
--
-- Qué hace:
-- 1) profiles.kiosco_license_billing_from → desde qué mes corre cargo automático 20/80 licencia kiosco (9900).
-- 2) profiles.partner_membership_from → mes de alta membresía socio; desde el mes SIGUIENTE corre cuota vendor_monthly + regalías.
-- 3) ferriol_accrue_monthly_billing(mes) → idempotente, inserta mlm_ledger pending.
-- 4) pg_cron día 1 de cada mes (habilitar extensión en Supabase si hace falta).
-- 5) ferriol_verify_payment enriquecido (metadata + seteo de fechas) y alta definitiva ajusta billing_from al mes siguiente.

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS kiosco_license_billing_from date;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS partner_membership_from date;

COMMENT ON COLUMN profiles.kiosco_license_billing_from IS 'Primer día del primer mes en que aplica cargo automático mensual licencia kiosco (evita duplicar el mes ya liquidado manual/pago verificado).';
COMMENT ON COLUMN profiles.partner_membership_from IS 'Primer día del mes calendario de alta membresía socio; la cuota automática empieza el mes siguiente.';

-- ——— Reemplazar verificación de pagos: metadata + fechas de anclaje ———
CREATE OR REPLACE FUNCTION public.ferriol_verify_payment(p_payment_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_role text;
  r ferriol_payments%ROWTYPE;
  plan jsonb;
  sc numeric;
  sv numeric;
  r1 numeric;
  r2 numeric;
  amt numeric;
  payer uuid;
  seller uuid;
  n1 uuid;
  n2 uuid;
  n1_amt numeric := 0;
  n2_amt numeric := 0;
  comp_amt numeric;
  sell_amt numeric;
  payer_email text;
  seller_email text;
  payer_name text;
  meta_base jsonb;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = v_uid;
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo administradores pueden verificar pagos.');
  END IF;

  SELECT * INTO r FROM ferriol_payments WHERE id = p_payment_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Pago no encontrado.');
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El pago no está pendiente.');
  END IF;

  SELECT value INTO plan FROM mlm_plan_config WHERE key = 'compensation_v1' LIMIT 1;
  IF plan IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Falta clave compensation_v1 en mlm_plan_config.');
  END IF;

  sc := COALESCE((plan->>'sale_company_pct')::numeric, 0.20);
  sv := COALESCE((plan->>'sale_vendor_pct')::numeric, 0.80);
  r1 := COALESCE((plan->>'royalty_n1_pct')::numeric, 0.30);
  r2 := COALESCE((plan->>'royalty_n2_pct')::numeric, 0.15);
  amt := r.amount;
  payer := r.payer_user_id;
  seller := r.seller_user_id;

  SELECT p.email, p.kiosco_name INTO payer_email, payer_name FROM profiles p WHERE p.id = payer;
  SELECT p.email INTO seller_email FROM profiles p WHERE p.id = seller;

  IF r.payment_type IN ('kit_inicial', 'kiosco_licencia') THEN
    IF seller IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Indicá el vendedor ejecutor (seller_user_id) para kit o licencia kiosco.');
    END IF;
    comp_amt := round(amt * sc, 2);
    sell_amt := round(amt * sv, 2);
    meta_base := jsonb_build_object(
      'payment_id', p_payment_id,
      'payment_type', r.payment_type,
      'bucket', 'company',
      'payer_email', payer_email,
      'seller_email', seller_email,
      'payer_kiosco_or_name', COALESCE(payer_name, payer_email)
    );
    INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
    VALUES (NULL, payer, 'company_reserve', 'approved', comp_amt, COALESCE(r.currency, 'ARS'), NULL,
      'pay:' || p_payment_id::text || ':company',
      meta_base,
      r.period_month);
    INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
    VALUES (seller, payer, 'sale_commission', 'approved', sell_amt, COALESCE(r.currency, 'ARS'), 0,
      'pay:' || p_payment_id::text || ':seller',
      jsonb_build_object(
        'payment_id', p_payment_id,
        'payment_type', r.payment_type,
        'payer_email', payer_email,
        'seller_email', seller_email
      ),
      r.period_month);
  ELSIF r.payment_type = 'vendor_mantenimiento' THEN
    SELECT sponsor_id INTO n1 FROM profiles WHERE id = payer;
    IF n1 IS NOT NULL THEN
      n1_amt := round(amt * r1, 2);
      SELECT sponsor_id INTO n2 FROM profiles WHERE id = n1;
      IF n2 IS NOT NULL THEN
        n2_amt := round(amt * r2, 2);
      END IF;
    END IF;
    comp_amt := round(amt - n1_amt - n2_amt, 2);
    IF comp_amt > 0 THEN
      INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
      VALUES (NULL, payer, 'company_reserve', 'approved', comp_amt, COALESCE(r.currency, 'ARS'), NULL,
        'pay:' || p_payment_id::text || ':company',
        jsonb_build_object('payment_id', p_payment_id, 'payment_type', r.payment_type, 'bucket', 'company'),
        r.period_month);
    END IF;
    IF n1_amt > 0 AND n1 IS NOT NULL THEN
      INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
      VALUES (n1, payer, 'renewal', 'approved', n1_amt, COALESCE(r.currency, 'ARS'), 1,
        'pay:' || p_payment_id::text || ':n1',
        jsonb_build_object('payment_id', p_payment_id, 'payment_type', r.payment_type),
        r.period_month);
    END IF;
    IF n2_amt > 0 AND n2 IS NOT NULL THEN
      INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
      VALUES (n2, payer, 'renewal', 'approved', n2_amt, COALESCE(r.currency, 'ARS'), 2,
        'pay:' || p_payment_id::text || ':n2',
        jsonb_build_object('payment_id', p_payment_id, 'payment_type', r.payment_type),
        r.period_month);
    END IF;
  ELSE
    RETURN jsonb_build_object('ok', false, 'error', 'Tipo de pago no reconocido.');
  END IF;

  IF r.payment_type = 'kit_inicial' THEN
    UPDATE profiles
    SET partner_membership_from = COALESCE(
      partner_membership_from,
      date_trunc('month', COALESCE(r.period_month::timestamp, now()))::date
    )
    WHERE id = payer AND role = 'partner';
  END IF;

  IF r.payment_type = 'kiosco_licencia' THEN
    UPDATE profiles
    SET kiosco_license_billing_from = COALESCE(
      kiosco_license_billing_from,
      (date_trunc('month', COALESCE(r.period_month::timestamp, now())) + interval '1 month')::date
    )
    WHERE id = payer AND role = 'kiosquero';
  END IF;

  UPDATE ferriol_payments
  SET status = 'verified', verified_at = now(), verified_by = v_uid, updated_at = now()
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Comisiones ya registradas (idempotencia).');
END;
$$;

-- ——— Alta definitiva: primer mes manual; facturación automática desde el mes siguiente ———
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
  next_bill date;
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
  next_bill := (date_trunc('month', now()) + interval '1 month')::date;

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

  UPDATE profiles
  SET kiosco_license_billing_from = next_bill
  WHERE id = p_kiosco_user_id;

  RETURN jsonb_build_object('ok', true, 'kiosco_user_id', p_kiosco_user_id, 'company_pct_amount', comp_amt, 'seller_pct_amount', sell_amt, 'next_auto_billing_month', next_bill);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Esta venta ya estaba registrada para este kiosco.');
END;
$$;

-- ——— Motor mensual (cron o llamada manual como super) ———
CREATE OR REPLACE FUNCTION public.ferriol_accrue_monthly_billing(p_month date DEFAULT NULL)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_month date := COALESCE(p_month, date_trunc('month', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date);
  plan jsonb;
  M numeric;
  vm numeric;
  sc numeric;
  sv numeric;
  r1 numeric;
  r2 numeric;
  comp_amt numeric;
  sell_amt numeric;
  n1 uuid;
  n2 uuid;
  n1_amt numeric;
  n2_amt numeric;
  comp_part numeric;
  total_k int := 0;
  total_p int := 0;
  ins_rows int;
  r_k RECORD;
  r_p RECORD;
  first_partner_bill date;
  km text;
BEGIN
  IF auth.uid() IS NOT NULL AND (SELECT role FROM profiles WHERE id = auth.uid()) IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo administradores pueden ejecutar esto manualmente.');
  END IF;

  SELECT value INTO plan FROM mlm_plan_config WHERE key = 'compensation_v1' LIMIT 1;
  IF plan IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Falta compensation_v1.');
  END IF;

  M := COALESCE((plan->>'kiosco_monthly')::numeric, 9900);
  vm := COALESCE((plan->>'vendor_monthly')::numeric, 20000);
  sc := COALESCE((plan->>'sale_company_pct')::numeric, 0.20);
  sv := COALESCE((plan->>'sale_vendor_pct')::numeric, 0.80);
  r1 := COALESCE((plan->>'royalty_n1_pct')::numeric, 0.30);
  r2 := COALESCE((plan->>'royalty_n2_pct')::numeric, 0.15);
  comp_amt := round(M * sc, 2);
  sell_amt := round(M * sv, 2);

  FOR r_k IN
    SELECT p.id AS kid, p.sponsor_id AS sid, p.email AS kem, p.kiosco_name AS kname
    FROM profiles p
    WHERE p.role = 'kiosquero'
      AND p.active = true
      AND p.sponsor_id IS NOT NULL
      AND p.kiosco_license_billing_from IS NOT NULL
      AND p.kiosco_license_billing_from <= v_month
      AND EXISTS (SELECT 1 FROM profiles s WHERE s.id = p.sponsor_id AND s.role = 'partner')
  LOOP
    km := 'km:' || r_k.kid::text || ':' || to_char(v_month, 'YYYY-MM-DD') || ':company';
    INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
    VALUES (NULL, r_k.kid, 'company_reserve', 'pending', comp_amt, 'ARS', NULL, km,
      jsonb_build_object(
        'seller_user_id', r_k.sid,
        'kiosco_user_id', r_k.kid,
        'sale_kind', 'kiosco_monthly_auto',
        'kiosco_email', r_k.kem,
        'kiosco_name', r_k.kname
      ),
      v_month)
    ON CONFLICT (idempotency_key) DO NOTHING;
    GET DIAGNOSTICS ins_rows = ROW_COUNT;
    IF ins_rows > 0 THEN
      INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
      VALUES (r_k.sid, r_k.kid, 'vendor_payable_company', 'pending', comp_amt, 'ARS', NULL,
        'km:' || r_k.kid::text || ':' || to_char(v_month, 'YYYY-MM-DD') || ':payable',
        jsonb_build_object('seller_user_id', r_k.sid, 'kiosco_user_id', r_k.kid, 'sale_kind', 'kiosco_monthly_auto'),
        v_month)
      ON CONFLICT (idempotency_key) DO NOTHING;
      INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
      VALUES (r_k.sid, r_k.kid, 'sale_commission', 'pending', sell_amt, 'ARS', 0,
        'km:' || r_k.kid::text || ':' || to_char(v_month, 'YYYY-MM-DD') || ':seller',
        jsonb_build_object('seller_user_id', r_k.sid, 'kiosco_user_id', r_k.kid, 'sale_kind', 'kiosco_monthly_auto'),
        v_month)
      ON CONFLICT (idempotency_key) DO NOTHING;
      total_k := total_k + 1;
    END IF;
  END LOOP;

  FOR r_p IN
    SELECT p.id AS pid, p.sponsor_id AS pspon, p.email AS pemail, p.partner_membership_from AS pmf
    FROM profiles p
    WHERE p.role = 'partner'
      AND p.active = true
      AND p.partner_membership_from IS NOT NULL
  LOOP
    first_partner_bill := (date_trunc('month', r_p.pmf::timestamp) + interval '1 month')::date;
    IF v_month < first_partner_bill THEN
      CONTINUE;
    END IF;

    n1_amt := 0;
    n2_amt := 0;
    n1 := r_p.pspon;
    IF n1 IS NOT NULL THEN
      n1_amt := round(vm * r1, 2);
      SELECT sponsor_id INTO n2 FROM profiles WHERE id = n1;
      IF n2 IS NOT NULL THEN
        n2_amt := round(vm * r2, 2);
      END IF;
    END IF;
    comp_part := round(vm - n1_amt - n2_amt, 2);

    IF comp_part > 0 THEN
      INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
      VALUES (NULL, r_p.pid, 'company_reserve', 'pending', comp_part, 'ARS', NULL,
        'pmm:' || r_p.pid::text || ':' || to_char(v_month, 'YYYY-MM-DD') || ':company',
        jsonb_build_object(
          'sale_kind', 'partner_membership_auto',
          'partner_email', r_p.pemail,
          'period', to_char(v_month, 'YYYY-MM')
        ),
        v_month)
      ON CONFLICT (idempotency_key) DO NOTHING;
      GET DIAGNOSTICS ins_rows = ROW_COUNT;
      IF ins_rows > 0 THEN
        IF n1_amt > 0 AND n1 IS NOT NULL THEN
          INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
          VALUES (n1, r_p.pid, 'renewal', 'pending', n1_amt, 'ARS', 1,
            'pmm:' || r_p.pid::text || ':' || to_char(v_month, 'YYYY-MM-DD') || ':n1',
            jsonb_build_object('sale_kind', 'partner_membership_auto', 'depth', 1),
            v_month)
          ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
        IF n2_amt > 0 AND n2 IS NOT NULL THEN
          INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
          VALUES (n2, r_p.pid, 'renewal', 'pending', n2_amt, 'ARS', 2,
            'pmm:' || r_p.pid::text || ':' || to_char(v_month, 'YYYY-MM-DD') || ':n2',
            jsonb_build_object('sale_kind', 'partner_membership_auto', 'depth', 2),
            v_month)
          ON CONFLICT (idempotency_key) DO NOTHING;
        END IF;
        total_p := total_p + 1;
      END IF;
    END IF;
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'period_month', v_month,
    'kiosco_months_new', total_k,
    'partner_months_new', total_p
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_accrue_monthly_billing(date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_accrue_monthly_billing(date) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ferriol_accrue_monthly_billing(date) TO service_role;

REVOKE ALL ON FUNCTION public.ferriol_verify_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_verify_payment(uuid) TO authenticated;

REVOKE ALL ON FUNCTION public.ferriol_register_kiosco_definitive_sale(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_register_kiosco_definitive_sale(uuid) TO authenticated;

-- ——— pg_cron: día 1 ~08:00 AR (11:00 UTC) ———
-- Supabase → Database → Extensions → activá "pg_cron". Si no existe la extensión, ignorá errores y llamá la función a mano desde SQL o desde la app.
DO $cron$
DECLARE
  jid int;
BEGIN
  IF EXISTS (SELECT 1 FROM pg_extension WHERE extname = 'pg_cron') THEN
    SELECT j.jobid INTO jid FROM cron.job j WHERE j.jobname = 'ferriol_accrue_monthly' LIMIT 1;
    IF jid IS NOT NULL THEN
      PERFORM cron.unschedule(jid);
    END IF;
    PERFORM cron.schedule(
      'ferriol_accrue_monthly',
      '0 11 1 * *',
      $cmd$SELECT public.ferriol_accrue_monthly_billing(date_trunc('month', (now() AT TIME ZONE 'America/Argentina/Buenos_Aires'))::date);$cmd$
    );
  END IF;
EXCEPTION WHEN OTHERS THEN
  RAISE NOTICE 'pg_cron no programado: %. Habilitá la extensión o ejecutá ferriol_accrue_monthly_billing desde SQL.', SQLERRM;
END;
$cron$;
