-- Ferriol OS · Comprobantes de pago cargados por el mismo usuario (kiosco / socio) a cuenta Ferriol
-- Tras ejecutar client-sale-requests.sql y ferriol-payments.sql.

CREATE TABLE IF NOT EXISTS public.ferriol_empresa_payment_proof_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_type text NOT NULL CHECK (
    payment_type IN ('kit_inicial', 'kiosco_licencia', 'vendor_mantenimiento')
  ),
  amount_ars numeric NOT NULL CHECK (amount_ars > 0),
  comprobante_path text NOT NULL,
  sponsor_code_raw text,
  sponsor_resolved_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  period_month date,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'approved', 'rejected')),
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reject_note text,
  ferriol_payment_id uuid REFERENCES public.ferriol_payments(id) ON DELETE SET NULL,
  CONSTRAINT ferriol_ep_proof_vendor_month CHECK (
    payment_type IS DISTINCT FROM 'vendor_mantenimiento'
    OR period_month IS NOT NULL
  )
);

CREATE INDEX IF NOT EXISTS idx_ferriol_ep_proof_status ON public.ferriol_empresa_payment_proof_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ferriol_ep_proof_user ON public.ferriol_empresa_payment_proof_requests (user_id);

COMMENT ON TABLE public.ferriol_empresa_payment_proof_requests IS 'Comprobante de cobro empresa subido por el pagador mismo; empresa aprueba y dispara ferriol_verify_payment.';

CREATE OR REPLACE FUNCTION public.ferriol_ep_proof_norm()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.sponsor_code_raw IS NOT NULL THEN
    NEW.sponsor_code_raw := trim(NEW.sponsor_code_raw);
  END IF;
  IF NEW.comprobante_path IS NOT NULL THEN NEW.comprobante_path := trim(NEW.comprobante_path); END IF;
  IF NEW.status IS NULL THEN NEW.status := 'pending'; END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ferriol_ep_proof_norm ON public.ferriol_empresa_payment_proof_requests;
CREATE TRIGGER trg_ferriol_ep_proof_norm
  BEFORE INSERT OR UPDATE ON public.ferriol_empresa_payment_proof_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.ferriol_ep_proof_norm();

ALTER TABLE public.ferriol_empresa_payment_proof_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ferriol_ep_proof_insert_self" ON public.ferriol_empresa_payment_proof_requests;
CREATE POLICY "ferriol_ep_proof_insert_self" ON public.ferriol_empresa_payment_proof_requests
  FOR INSERT TO authenticated
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS "ferriol_ep_proof_select_self" ON public.ferriol_empresa_payment_proof_requests;
CREATE POLICY "ferriol_ep_proof_select_self" ON public.ferriol_empresa_payment_proof_requests
  FOR SELECT TO authenticated
  USING (user_id = auth.uid() OR (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'super');

GRANT SELECT, INSERT ON public.ferriol_empresa_payment_proof_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.ferriol_approve_empresa_payment_proof_request(
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
  r public.ferriol_empresa_payment_proof_requests%ROWTYPE;
  v_amt numeric;
  v_pay_id uuid;
  v_res jsonb;
  v_msg text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo la empresa (fundador) puede aprobar o rechazar.');
  END IF;

  SELECT * INTO r FROM public.ferriol_empresa_payment_proof_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La solicitud ya fue procesada.');
  END IF;

  IF p_approve IS NOT TRUE THEN
    UPDATE public.ferriol_empresa_payment_proof_requests
    SET status = 'rejected', reviewed_by = auth.uid(), reviewed_at = now(),
        reject_note = NULLIF(trim(COALESCE(p_reject_note, '')), '')
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'rejected', true);
  END IF;

  v_amt := COALESCE(p_amount_override, r.amount_ars);
  IF v_amt IS NULL OR v_amt <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Monto inválido.');
  END IF;

  IF r.payment_type IN ('kit_inicial', 'kiosco_licencia') AND r.sponsor_resolved_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Falta patrocinador resuelto (comisión al socio). No se puede verificar sin vendedor ejecutor.');
  END IF;

  INSERT INTO public.ferriol_payments (
    payment_type, amount, currency, payer_user_id, seller_user_id, period_month,
    status, external_note, created_by, updated_at
  ) VALUES (
    r.payment_type,
    v_amt,
    'ARS',
    r.user_id,
    CASE WHEN r.payment_type IN ('kit_inicial', 'kiosco_licencia') THEN r.sponsor_resolved_id ELSE NULL END,
    CASE WHEN r.payment_type = 'vendor_mantenimiento' THEN r.period_month ELSE NULL END,
    'pending',
    'Comprobante (carga propia): ' || r.comprobante_path,
    auth.uid(),
    now()
  ) RETURNING id INTO v_pay_id;

  v_res := public.ferriol_verify_payment(v_pay_id);
  IF coalesce((v_res->>'ok')::boolean, false) IS NOT TRUE THEN
    DELETE FROM public.ferriol_payments WHERE id = v_pay_id;
    v_msg := coalesce(v_res->>'error', 'No se pudo verificar el pago.');
    RETURN jsonb_build_object('ok', false, 'error', v_msg, 'verify_detail', v_res);
  END IF;

  UPDATE public.ferriol_empresa_payment_proof_requests
  SET status = 'approved', reviewed_by = auth.uid(), reviewed_at = now(), ferriol_payment_id = v_pay_id
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'payment_id', v_pay_id, 'request_id', p_request_id);
EXCEPTION WHEN OTHERS THEN
  IF v_pay_id IS NOT NULL THEN
    BEGIN DELETE FROM public.ferriol_payments WHERE id = v_pay_id; EXCEPTION WHEN OTHERS THEN NULL; END;
  END IF;
  RETURN jsonb_build_object('ok', false, 'error', 'Error: ' || SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_approve_empresa_payment_proof_request(uuid, boolean, text, numeric) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_approve_empresa_payment_proof_request(uuid, boolean, text, numeric) TO authenticated;
