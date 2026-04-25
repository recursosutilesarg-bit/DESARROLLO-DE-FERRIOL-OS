-- Ferriol OS · Ampliar solicitudes de días a perfiles role = partner (licencia de distribución)
-- Además de kiosqueros. Ejecutá en Supabase si ya corrías ferriol-membership-day-requests.sql

DROP POLICY IF EXISTS "ferriol_mdr_partner_insert" ON ferriol_membership_day_requests;

CREATE POLICY "ferriol_mdr_partner_insert" ON ferriol_membership_day_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('partner', 'super')
    AND ferriol_is_kiosquero_in_upline_of(kiosquero_user_id, auth.uid())
    AND (SELECT role FROM profiles WHERE id = kiosquero_user_id) IN ('kiosquero', 'partner')
  );

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
    RETURN jsonb_build_object('ok', false, 'error', 'Perfil objetivo no encontrado.');
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
