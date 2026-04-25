-- Ferriol OS · Alta de negocio (kiosquero) con aprobación de la empresa
-- Mismo patrón que ferriol_partner_provision_requests: solicitud → aprobación super → token → signUp → finalize.
-- Ejecutá en Supabase después de profiles y ferriol_partner_provision_requests (mismo estilo RLS).

CREATE TABLE IF NOT EXISTS ferriol_kiosquero_provision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_email text NOT NULL,
  kiosco_name text NOT NULL,
  phone text,
  client_payment_ars numeric NOT NULL,
  company_share_ars numeric,
  company_transfer_note text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reject_note text,
  completion_token uuid,
  completed_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT ferriol_kpr_status_chk CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  CONSTRAINT ferriol_kpr_pay_chk CHECK (client_payment_ars > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ferriol_kpr_email_pending_unique
  ON ferriol_kiosquero_provision_requests (lower(trim(target_email)))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ferriol_kpr_status ON ferriol_kiosquero_provision_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ferriol_kpr_requested_by ON ferriol_kiosquero_provision_requests (requested_by);

CREATE OR REPLACE FUNCTION public.ferriol_kpr_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.target_email IS NULL OR length(trim(NEW.target_email)) < 5 OR position('@' IN NEW.target_email) < 2 THEN
    RAISE EXCEPTION 'Email del negocio inválido';
  END IF;
  IF NEW.kiosco_name IS NULL OR length(trim(NEW.kiosco_name)) < 2 THEN
    RAISE EXCEPTION 'Nombre del negocio obligatorio';
  END IF;
  NEW.target_email := lower(trim(NEW.target_email));
  NEW.kiosco_name := trim(NEW.kiosco_name);
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ferriol_kpr_validate ON ferriol_kiosquero_provision_requests;
CREATE TRIGGER trg_ferriol_kpr_validate
  BEFORE INSERT ON ferriol_kiosquero_provision_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.ferriol_kpr_validate_insert();

ALTER TABLE ferriol_kiosquero_provision_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ferriol_kpr_super_all" ON ferriol_kiosquero_provision_requests;
CREATE POLICY "ferriol_kpr_super_all" ON ferriol_kiosquero_provision_requests
  FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');

DROP POLICY IF EXISTS "ferriol_kpr_network_select_own" ON ferriol_kiosquero_provision_requests;
CREATE POLICY "ferriol_kpr_network_select_own" ON ferriol_kiosquero_provision_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('partner', 'super')
  );

DROP POLICY IF EXISTS "ferriol_kpr_network_insert" ON ferriol_kiosquero_provision_requests;
CREATE POLICY "ferriol_kpr_network_insert" ON ferriol_kiosquero_provision_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('partner', 'super')
  );

GRANT SELECT, INSERT ON ferriol_kiosquero_provision_requests TO authenticated;

CREATE OR REPLACE FUNCTION public.ferriol_approve_kiosquero_provision_request(
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
  r ferriol_kiosquero_provision_requests%ROWTYPE;
  tok uuid;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo la empresa puede aprobar o rechazar altas de negocios.');
  END IF;

  SELECT * INTO r FROM ferriol_kiosquero_provision_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La solicitud ya fue procesada.');
  END IF;

  IF NOT p_approve THEN
    UPDATE ferriol_kiosquero_provision_requests
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        reject_note = NULLIF(trim(p_reject_note), ''),
        completion_token = NULL
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'action', 'rejected');
  END IF;

  tok := gen_random_uuid();
  UPDATE ferriol_kiosquero_provision_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      reject_note = NULL,
      completion_token = tok
  WHERE id = p_request_id;

  RETURN jsonb_build_object('ok', true, 'action', 'approved', 'completion_token', tok::text);
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_approve_kiosquero_provision_request(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_approve_kiosquero_provision_request(uuid, boolean, text) TO authenticated;

CREATE OR REPLACE FUNCTION public.ferriol_finalize_kiosquero_provision(p_token uuid, p_new_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r ferriol_kiosquero_provision_requests%ROWTYPE;
  v_email text;
  trial_end timestamptz;
  td int;
BEGIN
  IF p_token IS NULL OR p_new_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Datos incompletos.');
  END IF;

  SELECT * INTO r FROM ferriol_kiosquero_provision_requests
  WHERE completion_token = p_token AND status = 'approved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enlace inválido o solicitud ya utilizada.');
  END IF;

  IF NOT (
    r.requested_by IS NOT DISTINCT FROM auth.uid()
    OR p_new_profile_id IS NOT DISTINCT FROM auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Iniciá sesión con el referidor o con el usuario del negocio para completar el alta.');
  END IF;

  SELECT email INTO v_email FROM profiles WHERE id = p_new_profile_id;

  td := 15;
  BEGIN
    SELECT value::int INTO td FROM app_settings WHERE key = 'trial_duration_days' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    td := 15;
  END;
  IF td IS NULL OR td < 1 OR td > 365 THEN
    td := 15;
  END IF;
  trial_end := now() + (td || ' days')::interval;

  IF NOT EXISTS (SELECT 1 FROM profiles WHERE id = p_new_profile_id) THEN
    INSERT INTO profiles (id, email, role, active, sponsor_id, trial_ends_at, kiosco_name, phone)
    VALUES (
      p_new_profile_id,
      r.target_email,
      'kiosquero',
      true,
      r.requested_by,
      trial_end,
      r.kiosco_name,
      NULLIF(trim(r.phone), '')
    );
  ELSE
    IF v_email IS NULL OR lower(trim(v_email)) IS DISTINCT FROM r.target_email THEN
      RETURN jsonb_build_object('ok', false, 'error', 'El email del perfil no coincide con la solicitud.');
    END IF;
    UPDATE profiles SET
      role = 'kiosquero',
      sponsor_id = r.requested_by,
      kiosco_name = r.kiosco_name,
      phone = COALESCE(NULLIF(trim(r.phone), ''), phone),
      active = true,
      trial_ends_at = trial_end
    WHERE id = p_new_profile_id;
  END IF;

  UPDATE ferriol_kiosquero_provision_requests SET
    status = 'completed',
    completed_user_id = p_new_profile_id,
    completion_token = NULL
  WHERE id = r.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_finalize_kiosquero_provision(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_finalize_kiosquero_provision(uuid, uuid) TO authenticated;
