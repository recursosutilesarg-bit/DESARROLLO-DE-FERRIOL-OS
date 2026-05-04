-- Ferriol OS · Alta de venta con comprobante (imagen) → aprobación fundador → pago + comisión (ferriol_payments + ferriol_verify_payment)
-- Ejecutá DESPUÉS de supabase-ferriol-payments.sql (y tenés la función public.ferriol_verify_payment).
-- 1) Tabla  2) RLS  3) Bucket + políticas de Storage  4) RPC aprobar / rechazar

-- ——— 1) Tabla ———
CREATE TABLE IF NOT EXISTS public.ferriol_client_sale_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  partner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  client_name text NOT NULL,
  client_email text NOT NULL,
  comprobante_path text NOT NULL,
  amount_ars numeric NOT NULL CHECK (amount_ars > 0),
  payment_type text NOT NULL CHECK (payment_type IN ('kit_inicial', 'kiosco_licencia', 'vendor_mantenimiento')),
  period_month date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reject_note text,
  ferriol_payment_id uuid REFERENCES public.ferriol_payments(id) ON DELETE SET NULL,
  CONSTRAINT ferriol_csr_vendor_period CHECK (
    payment_type IS DISTINCT FROM 'vendor_mantenimiento' OR period_month IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_ferriol_csr_status ON public.ferriol_client_sale_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ferriol_csr_partner ON public.ferriol_client_sale_requests (partner_id);

COMMENT ON TABLE public.ferriol_client_sale_requests IS 'Solicitud de socio: cliente + monto + comprobante; fundador valida y genera pago verificado.';

-- Normaliza email (trigger)
CREATE OR REPLACE FUNCTION public.ferriol_csr_norm_email()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.client_email := lower(trim(NEW.client_email));
  IF NEW.client_name IS NOT NULL THEN NEW.client_name := trim(NEW.client_name); END IF;
  IF NEW.comprobante_path IS NOT NULL THEN NEW.comprobante_path := trim(NEW.comprobante_path); END IF;
  IF NEW.status IS NULL THEN NEW.status := 'pending'; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_ferriol_csr_norm ON public.ferriol_client_sale_requests;
CREATE TRIGGER trg_ferriol_csr_norm
  BEFORE INSERT OR UPDATE ON public.ferriol_client_sale_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.ferriol_csr_norm_email();

ALTER TABLE public.ferriol_client_sale_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ferriol_csr_partner_select" ON public.ferriol_client_sale_requests;
CREATE POLICY "ferriol_csr_partner_select" ON public.ferriol_client_sale_requests
  FOR SELECT TO authenticated
  USING (partner_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'super');

DROP POLICY IF EXISTS "ferriol_csr_partner_insert" ON public.ferriol_client_sale_requests;
CREATE POLICY "ferriol_csr_partner_insert" ON public.ferriol_client_sale_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    partner_id = auth.uid()
    AND (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) IN ('partner', 'super')
  );

-- Sin UPDATE/DELETE directo: solo RPC (bypassa con SECURITY DEFINER)

GRANT SELECT, INSERT ON public.ferriol_client_sale_requests TO authenticated;

-- ——— 2) Storage ———
INSERT INTO storage.buckets (id, name, public)
VALUES ('comprobantes-ferriol', 'comprobantes-ferriol', true)
ON CONFLICT (id) DO UPDATE SET public = true;

DROP POLICY IF EXISTS "comprobantes_ferriol_read" ON storage.objects;
CREATE POLICY "comprobantes_ferriol_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'comprobantes-ferriol'
    AND (
      split_part(name, '/', 1) = (auth.uid())::text
      OR (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'super'
    )
  );

DROP POLICY IF EXISTS "comprobantes_ferriol_insert" ON storage.objects;
CREATE POLICY "comprobantes_ferriol_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comprobantes-ferriol'
    AND split_part(name, '/', 1) = (auth.uid())::text
  );

-- ——— 3) RPC aprobar / rechazar ———
CREATE OR REPLACE FUNCTION public.ferriol_approve_client_sale_request(
  p_request_id uuid,
  p_approve boolean,
  p_reject_note text DEFAULT NULL,
  p_amount_override numeric DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  r public.ferriol_client_sale_requests%ROWTYPE;
  v_payer uuid;
  v_amt numeric;
  v_pay_id uuid;
  v_res jsonb;
  v_msg text;
  v_payer_role text;
  lic_days int;
  trial_end timestamptz;
  v_existing_trial timestamptz;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo la empresa (fundador) puede aprobar o rechazar.');
  END IF;

  SELECT * INTO r FROM public.ferriol_client_sale_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La solicitud ya fue procesada.');
  END IF;

  IF p_approve IS NOT TRUE THEN
    UPDATE public.ferriol_client_sale_requests
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        reject_note = NULLIF(trim(COALESCE(p_reject_note, '')), '')
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'rejected', true);
  END IF;

  SELECT id INTO v_payer FROM public.profiles WHERE lower(trim(email)) = r.client_email LIMIT 1;
  IF v_payer IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No hay perfil con el email ' || r.client_email || '. El cliente debe registrarse primero (mismo email).');
  END IF;

  -- Lista Afiliados / chips del socio usan profiles.sponsor_id en la línea “negocio”.
  -- Al aprobar la venta que cargó este partner, el comercio (kiosquero) queda referido por él (corrige alta sin ref o sponsor viejo).
  UPDATE public.profiles p
  SET sponsor_id = r.partner_id
  WHERE p.id = v_payer
    AND p.role = 'kiosquero';

  v_amt := COALESCE(p_amount_override, r.amount_ars);
  IF v_amt IS NULL OR v_amt <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Monto inválido.');
  END IF;

  INSERT INTO public.ferriol_payments (
    payment_type, amount, currency, payer_user_id, seller_user_id, period_month,
    status, external_note, created_by, updated_at
  ) VALUES (
    r.payment_type, v_amt, 'ARS', v_payer, r.partner_id,
    CASE WHEN r.payment_type = 'vendor_mantenimiento' THEN r.period_month ELSE NULL END,
    'pending', 'Aprobado desde comprobante: ' || r.comprobante_path, auth.uid(), now()
  ) RETURNING id INTO v_pay_id;

  v_res := public.ferriol_verify_payment(v_pay_id);
  IF coalesce((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    DELETE FROM public.ferriol_payments WHERE id = v_pay_id;
    v_msg := coalesce(v_res->>'error', 'No se pudo verificar el pago.');
    RETURN jsonb_build_object('ok', false, 'error', v_msg, 'verify_detail', v_res);
  END IF;

  UPDATE public.ferriol_client_sale_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), ferriol_payment_id = v_pay_id
  WHERE id = p_request_id;

  SELECT role INTO v_payer_role FROM public.profiles WHERE id = v_payer LIMIT 1;
  IF v_payer_role = 'partner' AND r.payment_type = 'kit_inicial' THEN
    lic_days := NULL;
    BEGIN
      SELECT trim(value)::int INTO lic_days FROM public.app_settings WHERE key = 'partner_distribution_license_days' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      lic_days := NULL;
    END;
    IF lic_days IS NULL OR lic_days < 1 OR lic_days > 3650 THEN
      BEGIN
        SELECT trim(value)::int INTO lic_days FROM public.app_settings WHERE key = 'trial_duration_days' LIMIT 1;
      EXCEPTION WHEN OTHERS THEN
        lic_days := NULL;
      END;
    END IF;
    IF lic_days IS NULL OR lic_days < 1 OR lic_days > 3650 THEN
      lic_days := 30;
    END IF;
    SELECT trial_ends_at INTO v_existing_trial FROM public.profiles WHERE id = v_payer LIMIT 1;
    IF v_existing_trial IS NOT NULL AND v_existing_trial > now() THEN
      trial_end := v_existing_trial + (lic_days || ' days')::interval;
    ELSE
      trial_end := now() + (lic_days || ' days')::interval;
    END IF;
    UPDATE public.profiles
    SET trial_ends_at = trial_end,
        partner_kit_review_until = NULL,
        partner_license_pending = false,
        active = true
    WHERE id = v_payer AND role = 'partner';
  END IF;

  RETURN jsonb_build_object('ok', true, 'payment_id', v_pay_id, 'request_id', p_request_id);
EXCEPTION WHEN OTHERS THEN
  IF v_pay_id IS NOT NULL THEN
    BEGIN DELETE FROM public.ferriol_payments WHERE id = v_pay_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'Error: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_approve_client_sale_request(uuid, boolean, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_approve_client_sale_request(uuid, boolean, text, numeric) TO authenticated;
