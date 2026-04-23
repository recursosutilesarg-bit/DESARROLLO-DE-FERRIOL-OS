-- Ferriol OS · Cobros manuales (transferencia) + liquidación en mlm_ledger
-- Ejecutá DESPUÉS de supabase-mlm-foundation.sql
-- Documentación: PLAN-COMPENSACIONES-FERRIOL.md

-- Permitir filas de reserva empresa sin beneficiario usuario
ALTER TABLE mlm_ledger ALTER COLUMN beneficiary_user_id DROP NOT NULL;

CREATE TABLE IF NOT EXISTS ferriol_payments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  payment_type text NOT NULL CHECK (payment_type IN ('kit_inicial', 'kiosco_licencia', 'vendor_mantenimiento')),
  amount numeric NOT NULL CHECK (amount > 0),
  currency text NOT NULL DEFAULT 'ARS',
  payer_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  seller_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  period_month date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'verified', 'rejected')),
  verified_at timestamptz,
  verified_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  external_note text,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);

COMMENT ON TABLE ferriol_payments IS 'Cobros declarados; super verifica transferencia y dispara comisiones';

CREATE INDEX IF NOT EXISTS idx_ferriol_payments_status ON ferriol_payments (status);
CREATE INDEX IF NOT EXISTS idx_ferriol_payments_payer ON ferriol_payments (payer_user_id);
CREATE INDEX IF NOT EXISTS idx_ferriol_payments_created ON ferriol_payments (created_at DESC);

CREATE UNIQUE INDEX IF NOT EXISTS ferriol_payments_vendor_month_uniq
  ON ferriol_payments (payer_user_id, period_month)
  WHERE payment_type = 'vendor_mantenimiento' AND status IN ('pending', 'verified');

ALTER TABLE ferriol_payments ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ferriol_payments_super_all" ON ferriol_payments;
CREATE POLICY "ferriol_payments_super_all" ON ferriol_payments
  FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');

DROP POLICY IF EXISTS "ferriol_payments_partner_select" ON ferriol_payments;
CREATE POLICY "ferriol_payments_partner_select" ON ferriol_payments
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'partner'
    AND (payer_user_id = auth.uid() OR seller_user_id = auth.uid())
  );

DROP POLICY IF EXISTS "ferriol_payments_kiosquero_select" ON ferriol_payments;
CREATE POLICY "ferriol_payments_kiosquero_select" ON ferriol_payments
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'kiosquero'
    AND payer_user_id = auth.uid()
  );

-- Plan alineado a PLAN-COMPENSACIONES-FERRIOL.md (montos orientativos; editá el JSON si cambian)
INSERT INTO mlm_plan_config (key, value, updated_at)
VALUES (
  'compensation_v1',
  '{
    "kit_amount": 60000,
    "kiosco_monthly": 9900,
    "vendor_monthly": 20000,
    "sale_company_pct": 0.20,
    "sale_vendor_pct": 0.80,
    "royalty_n1_pct": 0.30,
    "royalty_n2_pct": 0.15
  }'::jsonb,
  now()
)
ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = now();

INSERT INTO app_settings (key, value)
SELECT
  'ferriol_transfer_info',
  'Titular: [TU RAZÓN SOCIAL]
CBU: [COMPLETAR]
Alias: [COMPLETAR]
Concepto: email del usuario + tipo de pago (kit / licencia kiosco / cuota vendedor)'
WHERE NOT EXISTS (SELECT 1 FROM app_settings WHERE key = 'ferriol_transfer_info');

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

  IF r.payment_type IN ('kit_inicial', 'kiosco_licencia') THEN
    IF seller IS NULL THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Indicá el vendedor ejecutor (seller_user_id) para kit o licencia kiosco.');
    END IF;
    comp_amt := round(amt * sc, 2);
    sell_amt := round(amt * sv, 2);
    INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
    VALUES (NULL, payer, 'company_reserve', 'approved', comp_amt, COALESCE(r.currency, 'ARS'), NULL,
      'pay:' || p_payment_id::text || ':company',
      jsonb_build_object('payment_id', p_payment_id, 'payment_type', r.payment_type, 'bucket', 'company'),
      r.period_month);
    INSERT INTO mlm_ledger (beneficiary_user_id, origin_user_id, event_type, status, amount, currency, depth, idempotency_key, metadata, period_month)
    VALUES (seller, payer, 'sale_commission', 'approved', sell_amt, COALESCE(r.currency, 'ARS'), 0,
      'pay:' || p_payment_id::text || ':seller',
      jsonb_build_object('payment_id', p_payment_id, 'payment_type', r.payment_type),
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

  UPDATE ferriol_payments
  SET status = 'verified', verified_at = now(), verified_by = v_uid, updated_at = now()
  WHERE id = p_payment_id;

  RETURN jsonb_build_object('ok', true, 'payment_id', p_payment_id);
EXCEPTION WHEN unique_violation THEN
  RETURN jsonb_build_object('ok', false, 'error', 'Comisiones ya registradas (idempotencia).');
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_verify_payment(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_verify_payment(uuid) TO authenticated;

-- Si app_settings tiene RLS y los kiosqueros/socios no ven ferriol_transfer_info en Configuración,
-- descomentá y ajustá según tus políticas existentes (ej. solo esta clave pública):
-- DROP POLICY IF EXISTS "app_settings_read_ferriol_transfer_info" ON app_settings;
-- CREATE POLICY "app_settings_read_ferriol_transfer_info" ON app_settings
--   FOR SELECT TO authenticated
--   USING (key = 'ferriol_transfer_info');
