-- Ferriol OS · Retiros de comisiones (socios → revisión fundador → pago y comprobante)
-- Ejecutá en Supabase SQL Editor DESPUÉS de supabase-mlm-foundation.sql y profiles.

CREATE TABLE IF NOT EXISTS public.ferriol_partner_withdrawal_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  partner_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  amount_ars numeric NOT NULL CHECK (amount_ars > 0),
  status text NOT NULL DEFAULT 'pending_review' CHECK (status IN (
    'pending_review',
    'approved_pending_payout',
    'paid',
    'rejected'
  )),
  reject_note text,
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  founder_congrats_message text,
  payment_proof_path text,
  paid_at timestamptz,
  paid_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_fpwr_partner ON public.ferriol_partner_withdrawal_requests (partner_user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_fpwr_status ON public.ferriol_partner_withdrawal_requests (status, created_at DESC);

COMMENT ON TABLE public.ferriol_partner_withdrawal_requests IS 'Retiros de comisiones acreditadas en libro MLM; el fundador aprueba fondos y luego registra pago con comprobante.';

ALTER TABLE public.ferriol_partner_withdrawal_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "fpwr_super_all" ON public.ferriol_partner_withdrawal_requests;
CREATE POLICY "fpwr_super_all" ON public.ferriol_partner_withdrawal_requests
  FOR ALL TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'super')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'super');

DROP POLICY IF EXISTS "fpwr_partner_select" ON public.ferriol_partner_withdrawal_requests;
CREATE POLICY "fpwr_partner_select" ON public.ferriol_partner_withdrawal_requests
  FOR SELECT TO authenticated
  USING (partner_user_id = auth.uid());

GRANT SELECT ON public.ferriol_partner_withdrawal_requests TO authenticated;

-- ——— Saldo retirable = mismo “libro” que la pestaña Ingresos del socio (sale_commission + approved, histórico)
--     menos retiros pagados y montos reservados (pending_review + approved_pending_payout). ———
CREATE OR REPLACE FUNCTION public.ferriol_partner_withdrawable_balance(p_partner_id uuid)
RETURNS numeric
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT GREATEST(0,
    COALESCE((
      SELECT SUM(l.amount) FROM public.mlm_ledger l
      WHERE l.beneficiary_user_id = p_partner_id
        AND l.status = 'approved'
        AND l.event_type = 'sale_commission'
    ), 0)
    - COALESCE((
      SELECT SUM(w.amount_ars) FROM public.ferriol_partner_withdrawal_requests w
      WHERE w.partner_user_id = p_partner_id AND w.status = 'paid'
    ), 0)
    - COALESCE((
      SELECT SUM(w.amount_ars) FROM public.ferriol_partner_withdrawal_requests w
      WHERE w.partner_user_id = p_partner_id
        AND w.status IN ('pending_review', 'approved_pending_payout')
    ), 0)
  );
$$;

CREATE OR REPLACE FUNCTION public.ferriol_partner_create_withdrawal_request(p_amount_ars numeric)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_uid uuid := auth.uid();
  v_bal numeric;
  v_id uuid;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_uid LIMIT 1;
  IF v_role IS DISTINCT FROM 'partner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo administradores de red (socio) pueden solicitar retiros.');
  END IF;
  IF p_amount_ars IS NULL OR p_amount_ars <= 0 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Monto inválido.');
  END IF;
  v_bal := public.ferriol_partner_withdrawable_balance(v_uid);
  IF p_amount_ars > v_bal THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Supera el saldo disponible para retiro (' || round(v_bal, 2) || ' ARS).');
  END IF;
  INSERT INTO public.ferriol_partner_withdrawal_requests (partner_user_id, amount_ars, status)
  VALUES (v_uid, p_amount_ars, 'pending_review')
  RETURNING id INTO v_id;
  RETURN jsonb_build_object('ok', true, 'id', v_id);
END;
$$;

CREATE OR REPLACE FUNCTION public.ferriol_founder_review_partner_withdrawal(
  p_request_id uuid,
  p_approve boolean,
  p_reject_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  r public.ferriol_partner_withdrawal_requests%ROWTYPE;
  v_bal numeric;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo la empresa (fundador) puede revisar retiros.');
  END IF;
  SELECT * INTO r FROM public.ferriol_partner_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;
  IF r.status IS DISTINCT FROM 'pending_review' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La solicitud ya fue procesada en esta etapa.');
  END IF;
  IF p_approve IS TRUE THEN
    SELECT GREATEST(0,
      COALESCE((SELECT SUM(l.amount) FROM public.mlm_ledger l
        WHERE l.beneficiary_user_id = r.partner_user_id AND l.status = 'approved'
        AND l.event_type = 'sale_commission'), 0)
      - COALESCE((SELECT SUM(w.amount_ars) FROM public.ferriol_partner_withdrawal_requests w
        WHERE w.partner_user_id = r.partner_user_id AND w.status = 'paid'), 0)
      - COALESCE((SELECT SUM(w.amount_ars) FROM public.ferriol_partner_withdrawal_requests w
        WHERE w.partner_user_id = r.partner_user_id AND w.id IS DISTINCT FROM p_request_id
        AND w.status IN ('pending_review', 'approved_pending_payout')), 0)
    ) INTO v_bal;
    IF r.amount_ars > v_bal THEN
      RETURN jsonb_build_object('ok', false, 'error', 'Fondos insuficientes: disponible ' || round(v_bal, 2) || ' ARS (libro menos retiros y otras reservas).');
    END IF;
    UPDATE public.ferriol_partner_withdrawal_requests
    SET status = 'approved_pending_payout',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        reject_note = NULL,
        updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'approved', true);
  ELSE
    UPDATE public.ferriol_partner_withdrawal_requests
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        reject_note = NULLIF(trim(COALESCE(p_reject_note, '')), ''),
        updated_at = now()
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'rejected', true);
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.ferriol_founder_mark_withdrawal_paid(
  p_request_id uuid,
  p_proof_path text,
  p_congrats_message text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  r public.ferriol_partner_withdrawal_requests%ROWTYPE;
  v_bal numeric;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = auth.uid() LIMIT 1;
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo la empresa puede registrar el pago.');
  END IF;
  IF p_proof_path IS NULL OR trim(p_proof_path) = '' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Falta la ruta del comprobante en storage.');
  END IF;
  SELECT * INTO r FROM public.ferriol_partner_withdrawal_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;
  IF r.status IS DISTINCT FROM 'approved_pending_payout' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Estado inválido: debe estar aprobada y pendiente de acreditación bancaria.');
  END IF;
  SELECT GREATEST(0,
    COALESCE((SELECT SUM(l.amount) FROM public.mlm_ledger l
      WHERE l.beneficiary_user_id = r.partner_user_id AND l.status = 'approved'
      AND l.event_type = 'sale_commission'), 0)
    - COALESCE((SELECT SUM(w.amount_ars) FROM public.ferriol_partner_withdrawal_requests w
      WHERE w.partner_user_id = r.partner_user_id AND w.status = 'paid'), 0)
    - COALESCE((SELECT SUM(w.amount_ars) FROM public.ferriol_partner_withdrawal_requests w
      WHERE w.partner_user_id = r.partner_user_id AND w.id IS DISTINCT FROM p_request_id
      AND w.status IN ('pending_review', 'approved_pending_payout')), 0)
  ) INTO v_bal;
  IF r.amount_ars > v_bal THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya no hay saldo suficiente (' || round(v_bal, 2) || ' ARS). Rechazá y pedí una nueva solicitud.');
  END IF;
  UPDATE public.ferriol_partner_withdrawal_requests
  SET status = 'paid',
      paid_at = now(),
      paid_by = auth.uid(),
      payment_proof_path = trim(p_proof_path),
      founder_congrats_message = NULLIF(trim(COALESCE(p_congrats_message, '')), ''),
      updated_at = now()
  WHERE id = p_request_id;
  RETURN jsonb_build_object('ok', true);
END;
$$;

GRANT EXECUTE ON FUNCTION public.ferriol_partner_withdrawable_balance(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ferriol_partner_create_withdrawal_request(numeric) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ferriol_founder_review_partner_withdrawal(uuid, boolean, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ferriol_founder_mark_withdrawal_paid(uuid, text, text) TO authenticated;

-- Storage: comprobantes de pago de retiros (sube el fundador). Prefijo withdrawal-proofs/
DROP POLICY IF EXISTS "comprobantes_ferriol_super_withdrawal_insert" ON storage.objects;
CREATE POLICY "comprobantes_ferriol_super_withdrawal_insert" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comprobantes-ferriol'
    AND (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'super'
    AND name LIKE 'withdrawal-proofs/%'
  );
