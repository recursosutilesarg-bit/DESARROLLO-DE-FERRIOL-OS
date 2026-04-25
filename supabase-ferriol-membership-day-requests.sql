-- Ferriol OS · Solicitudes de carga/quita de días de membresía (aprobación empresa)
-- El administrador de red no modifica trial_ends_at directo: envía solicitud; un super aprueba.
-- Ejecutá en Supabase → SQL Editor después de tener profiles.

-- ——— 1) ¿El kiosquero pertenece al árbol del solicitante? (sube por sponsor_id) ———
CREATE OR REPLACE FUNCTION public.ferriol_is_kiosquero_in_upline_of(p_kiosquero uuid, p_admin uuid)
RETURNS boolean
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cur uuid;
  steps int := 0;
BEGIN
  IF p_kiosquero IS NULL OR p_admin IS NULL THEN
    RETURN false;
  END IF;
  SELECT sponsor_id INTO cur FROM profiles WHERE id = p_kiosquero;
  WHILE cur IS NOT NULL LOOP
    IF cur = p_admin THEN
      RETURN true;
    END IF;
    SELECT sponsor_id INTO cur FROM profiles WHERE id = cur;
    steps := steps + 1;
    IF steps > 80 THEN
      EXIT;
    END IF;
  END LOOP;
  RETURN false;
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_is_kiosquero_in_upline_of(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_is_kiosquero_in_upline_of(uuid, uuid) TO authenticated;

-- ——— 2) Tabla ———
CREATE TABLE IF NOT EXISTS ferriol_membership_day_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  kiosquero_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  days_delta integer NOT NULL,
  client_payment_ars numeric,
  company_share_ars numeric,
  company_transfer_note text,
  reason text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reject_note text,
  CONSTRAINT ferriol_mdr_days_chk CHECK (days_delta >= -365 AND days_delta <= 365 AND days_delta <> 0),
  CONSTRAINT ferriol_mdr_status_chk CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE INDEX IF NOT EXISTS idx_ferriol_mdr_status_created ON ferriol_membership_day_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ferriol_mdr_requested_by ON ferriol_membership_day_requests (requested_by);
CREATE INDEX IF NOT EXISTS idx_ferriol_mdr_kiosquero ON ferriol_membership_day_requests (kiosquero_user_id);

COMMENT ON TABLE ferriol_membership_day_requests IS 'Solicitudes de suma/resta de días de membresía kiosco; la empresa (super) aprueba antes de aplicar trial_ends_at';

-- ——— 3) Validar motivo en quita ———
CREATE OR REPLACE FUNCTION public.ferriol_mdr_validate_reason()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.days_delta < 0 THEN
    IF NEW.reason IS NULL OR length(trim(NEW.reason)) < 5 THEN
      RAISE EXCEPTION 'Motivo obligatorio (mín. 5 caracteres) para solicitar quita de días';
    END IF;
  END IF;
  IF NEW.days_delta > 0 THEN
    IF NEW.client_payment_ars IS NULL OR NEW.client_payment_ars <= 0 THEN
      RAISE EXCEPTION 'Indicá el monto cobrado al cliente (ARS) para solicitar suma de días';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ferriol_mdr_validate ON ferriol_membership_day_requests;
CREATE TRIGGER trg_ferriol_mdr_validate
  BEFORE INSERT ON ferriol_membership_day_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.ferriol_mdr_validate_reason();

-- ——— 4) RLS ———
ALTER TABLE ferriol_membership_day_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ferriol_mdr_super_all" ON ferriol_membership_day_requests;
CREATE POLICY "ferriol_mdr_super_all" ON ferriol_membership_day_requests
  FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');

DROP POLICY IF EXISTS "ferriol_mdr_partner_select_own" ON ferriol_membership_day_requests;
CREATE POLICY "ferriol_mdr_partner_select_own" ON ferriol_membership_day_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('partner', 'super')
  );

DROP POLICY IF EXISTS "ferriol_mdr_partner_insert" ON ferriol_membership_day_requests;
CREATE POLICY "ferriol_mdr_partner_insert" ON ferriol_membership_day_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('partner', 'super')
    AND ferriol_is_kiosquero_in_upline_of(kiosquero_user_id, auth.uid())
    AND (SELECT role FROM profiles WHERE id = kiosquero_user_id) = 'kiosquero'
  );

-- ——— 5) Aprobar / rechazar (solo super; aplica trial_ends_at) ———
CREATE OR REPLACE FUNCTION public.ferriol_approve_membership_day_request(
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
  v_req ferriol_membership_day_requests%ROWTYPE;
  v_trial timestamptz;
  v_now timestamptz := now();
  v_from timestamptz;
  v_new timestamptz;
  v_days int;
  v_active boolean;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo la empresa (administrador principal) puede aprobar o rechazar.');
  END IF;

  SELECT * INTO v_req FROM ferriol_membership_day_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;
  IF v_req.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La solicitud ya fue procesada.');
  END IF;

  IF NOT p_approve THEN
    UPDATE ferriol_membership_day_requests
    SET status = 'rejected',
        reviewed_at = v_now,
        reviewed_by = auth.uid(),
        reject_note = NULLIF(trim(p_reject_note), '')
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'action', 'rejected');
  END IF;

  SELECT trial_ends_at, active INTO v_trial, v_active FROM profiles WHERE id = v_req.kiosquero_user_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Perfil kiosquero no encontrado.');
  END IF;

  v_days := v_req.days_delta;
  IF v_days > 0 THEN
    IF v_trial IS NOT NULL AND v_trial > v_now THEN
      v_from := v_trial;
    ELSE
      v_from := v_now;
    END IF;
    v_new := v_from + (v_days || ' days')::interval;
    v_active := true;
  ELSE
    v_from := COALESCE(v_trial, v_now);
    v_new := v_from + (v_days || ' days')::interval;
  END IF;

  UPDATE profiles
  SET trial_ends_at = v_new,
      active = v_active
  WHERE id = v_req.kiosquero_user_id;

  UPDATE ferriol_membership_day_requests
  SET status = 'approved',
      reviewed_at = v_now,
      reviewed_by = auth.uid(),
      reject_note = NULL
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'action', 'approved', 'trial_ends_at', to_char(v_new AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'));
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_approve_membership_day_request(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_approve_membership_day_request(uuid, boolean, text) TO authenticated;

GRANT SELECT, INSERT ON ferriol_membership_day_requests TO authenticated;
