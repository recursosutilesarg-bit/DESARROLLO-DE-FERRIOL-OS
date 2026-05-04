-- Ferriol OS · Alta de nuevo administrador de red (socio) con aprobación de la empresa
-- El socio solicita; la empresa aprueba y se genera un token; el socio completa el registro (signUp) y el RPC asigna role partner.
-- Ejecutá en Supabase → SQL Editor (después de profiles, referral-network).

CREATE TABLE IF NOT EXISTS ferriol_partner_provision_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  requested_by uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  target_email text NOT NULL,
  display_name text,
  phone text,
  client_payment_ars numeric NOT NULL,
  company_share_ars numeric,
  company_transfer_note text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  reject_note text,
  completion_token uuid,
  completion_token_expires_at timestamptz,
  registered_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  completed_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  CONSTRAINT ferriol_ppr_status_chk CHECK (status IN ('pending', 'approved', 'rejected', 'completed')),
  CONSTRAINT ferriol_ppr_pay_chk CHECK (client_payment_ars > 0)
);

CREATE UNIQUE INDEX IF NOT EXISTS ferriol_ppr_email_pending_unique
  ON ferriol_partner_provision_requests (lower(trim(target_email)))
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ferriol_ppr_status ON ferriol_partner_provision_requests (status, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ferriol_ppr_requested_by ON ferriol_partner_provision_requests (requested_by);

COMMENT ON TABLE ferriol_partner_provision_requests IS 'Alta kit distribuidor: referidor carga solicitud; el nuevo puede registrarse antes de la aprobación (gracia partner_pending_grace_hours); fundador aprueba y acredita días de licencia (partner_distribution_license_days).';

-- Validación al insertar
CREATE OR REPLACE FUNCTION public.ferriol_ppr_validate_insert()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW.target_email IS NULL OR length(trim(NEW.target_email)) < 5 OR position('@' IN NEW.target_email) < 2 THEN
    RAISE EXCEPTION 'Email del nuevo administrador inválido';
  END IF;
  NEW.target_email := lower(trim(NEW.target_email));
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_ferriol_ppr_validate ON ferriol_partner_provision_requests;
CREATE TRIGGER trg_ferriol_ppr_validate
  BEFORE INSERT ON ferriol_partner_provision_requests
  FOR EACH ROW
  EXECUTE PROCEDURE public.ferriol_ppr_validate_insert();

ALTER TABLE ferriol_partner_provision_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ferriol_ppr_super_all" ON ferriol_partner_provision_requests;
CREATE POLICY "ferriol_ppr_super_all" ON ferriol_partner_provision_requests
  FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');

DROP POLICY IF EXISTS "ferriol_ppr_network_select_own" ON ferriol_partner_provision_requests;
CREATE POLICY "ferriol_ppr_network_select_own" ON ferriol_partner_provision_requests
  FOR SELECT TO authenticated
  USING (
    requested_by = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('partner', 'super')
  );

DROP POLICY IF EXISTS "ferriol_ppr_network_insert" ON ferriol_partner_provision_requests;
CREATE POLICY "ferriol_ppr_network_insert" ON ferriol_partner_provision_requests
  FOR INSERT TO authenticated
  WITH CHECK (
    requested_by = auth.uid()
    AND (SELECT role FROM profiles WHERE id = auth.uid()) IN ('partner', 'super')
  );

-- El nuevo socio puede ver la solicitud vinculada a su cuenta (estado pendiente / aprobación).
DROP POLICY IF EXISTS "ferriol_ppr_registered_user_select" ON ferriol_partner_provision_requests;
CREATE POLICY "ferriol_ppr_registered_user_select" ON ferriol_partner_provision_requests
  FOR SELECT TO authenticated
  USING (registered_user_id = auth.uid());

GRANT SELECT, INSERT ON ferriol_partner_provision_requests TO authenticated;

-- Instalaciones previas: columnas nuevas
ALTER TABLE ferriol_partner_provision_requests
  ADD COLUMN IF NOT EXISTS completion_token_expires_at timestamptz;
ALTER TABLE ferriol_partner_provision_requests
  ADD COLUMN IF NOT EXISTS registered_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

ALTER TABLE profiles
  ADD COLUMN IF NOT EXISTS partner_license_pending boolean NOT NULL DEFAULT false;

COMMENT ON COLUMN ferriol_partner_provision_requests.completion_token_expires_at IS 'Tras aprobar, el referidor/nuevo debe completar signUp antes de esta hora (UTC). Config: app_settings.partner_provision_completion_hours, default 24.';
COMMENT ON COLUMN ferriol_partner_provision_requests.registered_user_id IS 'Socio que ya creó cuenta mientras la solicitud estaba pending; gracia = partner_pending_grace_hours.';
COMMENT ON COLUMN profiles.partner_license_pending IS 'true: alta kit esperando aprobación Ferriol; trial_ends_at = fin de ventana de gracia hasta que aprueben.';

CREATE INDEX IF NOT EXISTS idx_ferriol_ppr_registered_user ON ferriol_partner_provision_requests(registered_user_id) WHERE registered_user_id IS NOT NULL;

-- Tras signUp como socio: vincular fila pending (mismo email + sponsor) y aplicar gracia (p. ej. 24 h).
CREATE OR REPLACE FUNCTION public.ferriol_link_partner_pending_kit(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_email text;
  v_spon uuid;
  v_role text;
  r ferriol_partner_provision_requests%ROWTYPE;
  v_hours int;
  v_kit_hours int;
  v_grace_end timestamptz;
  v_kit_until timestamptz;
BEGIN
  IF p_profile_id IS NULL OR auth.uid() IS DISTINCT FROM p_profile_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;

  SELECT lower(trim(email)), sponsor_id, role
  INTO v_email, v_spon, v_role
  FROM profiles WHERE id = p_profile_id;

  IF v_role IS DISTINCT FROM 'partner' OR v_spon IS NULL OR v_email IS NULL OR length(v_email) < 3 THEN
    RETURN jsonb_build_object('ok', true, 'linked', false);
  END IF;

  SELECT * INTO r FROM ferriol_partner_provision_requests
  WHERE status = 'pending'
    AND lower(trim(target_email)) = v_email
    AND requested_by = v_spon
  ORDER BY created_at DESC
  LIMIT 1
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', true, 'linked', false);
  END IF;

  IF r.registered_user_id IS NOT NULL AND r.registered_user_id IS DISTINCT FROM p_profile_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este alta de kit ya está vinculada a otra cuenta.');
  END IF;

  v_hours := 24;
  BEGIN
    SELECT trim(value)::int INTO v_hours FROM app_settings WHERE key = 'partner_pending_grace_hours' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_hours := 24;
  END;
  IF v_hours IS NULL OR v_hours < 1 OR v_hours > 168 THEN
    v_hours := 24;
  END IF;
  v_grace_end := now() + make_interval(hours => v_hours);

  v_kit_hours := NULL;
  BEGIN
    SELECT trim(value)::int INTO v_kit_hours FROM app_settings WHERE key = 'partner_kit_review_hours' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_kit_hours := NULL;
  END;
  IF v_kit_hours IS NULL OR v_kit_hours < 1 OR v_kit_hours > 168 THEN
    v_kit_hours := v_hours;
  END IF;
  v_kit_until := now() + make_interval(hours => v_kit_hours);

  UPDATE ferriol_partner_provision_requests
  SET registered_user_id = p_profile_id
  WHERE id = r.id;

  UPDATE profiles SET
    partner_license_pending = true,
    trial_ends_at = v_grace_end,
    partner_kit_review_until = v_kit_until,
    active = true
  WHERE id = p_profile_id;

  RETURN jsonb_build_object(
    'ok', true,
    'linked', true,
    'grace_hours', v_hours,
    'grace_ends_at', to_char(v_grace_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_link_partner_pending_kit(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_link_partner_pending_kit(uuid) TO authenticated;

-- Aprobar / rechazar (solo super)
CREATE OR REPLACE FUNCTION public.ferriol_approve_partner_provision_request(
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
  r ferriol_partner_provision_requests%ROWTYPE;
  tok uuid;
  v_hours int;
  v_exp timestamptz;
  v_pemail text;
  v_pspon uuid;
  v_prole text;
  lic_days int;
  trial_end timestamptz;
  attempts int := 0;
  new_code text;
  ok_code boolean := false;
  pid uuid;
BEGIN
  SELECT role INTO v_role FROM profiles WHERE id = auth.uid();
  IF v_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo la empresa puede aprobar o rechazar altas de administradores.');
  END IF;

  SELECT * INTO r FROM ferriol_partner_provision_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La solicitud ya fue procesada.');
  END IF;

  IF NOT p_approve THEN
    IF r.registered_user_id IS NOT NULL THEN
      UPDATE profiles
      SET active = false,
          partner_license_pending = false,
          partner_kit_review_until = NULL
      WHERE id = r.registered_user_id;
    END IF;
    UPDATE ferriol_partner_provision_requests
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        reject_note = NULLIF(trim(p_reject_note), ''),
        completion_token = NULL,
        completion_token_expires_at = NULL,
        registered_user_id = NULL
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'action', 'rejected');
  END IF;

  -- Ya se registró solo: acreditar días de licencia de distribuidor y cerrar sin token.
  IF r.registered_user_id IS NOT NULL THEN
    pid := r.registered_user_id;
    SELECT lower(trim(email)), sponsor_id, role
    INTO v_pemail, v_pspon, v_prole
    FROM profiles WHERE id = pid;
    IF NOT FOUND
       OR v_pemail IS DISTINCT FROM lower(trim(r.target_email))
       OR v_pspon IS DISTINCT FROM r.requested_by
       OR v_prole IS DISTINCT FROM 'partner' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'El perfil registrado no coincide con la solicitud (email o referidor).');
    END IF;

    lic_days := NULL;
    BEGIN
      SELECT trim(value)::int INTO lic_days FROM app_settings WHERE key = 'partner_distribution_license_days' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      lic_days := NULL;
    END;
    IF lic_days IS NULL OR lic_days < 1 OR lic_days > 3650 THEN
      BEGIN
        SELECT trim(value)::int INTO lic_days FROM app_settings WHERE key = 'trial_duration_days' LIMIT 1;
      EXCEPTION WHEN OTHERS THEN
        lic_days := NULL;
      END;
    END IF;
    IF lic_days IS NULL OR lic_days < 1 OR lic_days > 3650 THEN
      lic_days := 30;
    END IF;

    trial_end := now() + (lic_days || ' days')::interval;

    UPDATE profiles SET
      trial_ends_at = trial_end,
      partner_license_pending = false,
      partner_kit_review_until = NULL,
      active = true,
      kiosco_name = COALESCE(NULLIF(trim(r.display_name), ''), kiosco_name),
      phone = COALESCE(NULLIF(trim(r.phone), ''), phone)
    WHERE id = pid;

    IF EXISTS (
      SELECT 1 FROM profiles WHERE id = pid AND referral_code IS NOT NULL AND trim(referral_code) <> ''
    ) THEN
      ok_code := true;
    ELSE
      ok_code := false;
      WHILE attempts < 24 AND NOT ok_code LOOP
        attempts := attempts + 1;
        new_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
        BEGIN
          UPDATE profiles SET referral_code = new_code
          WHERE id = pid AND (referral_code IS NULL OR trim(referral_code) = '');
          IF FOUND THEN
            ok_code := true;
          END IF;
        EXCEPTION WHEN unique_violation THEN
          ok_code := false;
        END;
      END LOOP;
    END IF;

    UPDATE ferriol_partner_provision_requests SET
      status = 'completed',
      completed_user_id = pid,
      registered_user_id = pid,
      completion_token = NULL,
      completion_token_expires_at = NULL,
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      reject_note = NULL
    WHERE id = p_request_id;

    RETURN jsonb_build_object(
      'ok', true,
      'action', 'approved_completed',
      'trial_ends_at', to_char(trial_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
      'license_days', lic_days
    );
  END IF;

  -- Clásico: aún no hay cuenta → token para definir contraseña.
  v_hours := 24;
  BEGIN
    SELECT trim(value)::int INTO v_hours FROM app_settings WHERE key = 'partner_provision_completion_hours' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_hours := 24;
  END;
  IF v_hours IS NULL OR v_hours < 1 OR v_hours > 168 THEN
    v_hours := 24;
  END IF;
  v_exp := now() + make_interval(hours => v_hours);

  tok := gen_random_uuid();
  UPDATE ferriol_partner_provision_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      reject_note = NULL,
      completion_token = tok,
      completion_token_expires_at = v_exp
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'approved',
    'completion_token', tok::text,
    'completion_expires_at', to_char(v_exp AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_approve_partner_provision_request(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_approve_partner_provision_request(uuid, boolean, text) TO authenticated;

-- Completar: patrocinador o el usuario recién creado (sesión tras signUp)
CREATE OR REPLACE FUNCTION public.ferriol_finalize_partner_provision(p_token uuid, p_new_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r ferriol_partner_provision_requests%ROWTYPE;
  v_email text;
  trial_end timestamptz;
  td int;
  attempts int := 0;
  new_code text;
  ok_code boolean := false;
BEGIN
  IF p_token IS NULL OR p_new_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Datos incompletos.');
  END IF;

  SELECT * INTO r FROM ferriol_partner_provision_requests
  WHERE completion_token = p_token AND status = 'approved'
  FOR UPDATE;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Enlace inválido o solicitud ya utilizada. Pedí una nueva aprobación a la empresa.');
  END IF;

  IF r.completion_token_expires_at IS NOT NULL AND now() > r.completion_token_expires_at THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error',
      'Venció el plazo para completar el alta con este enlace. El fundador debe volver a aprobar la solicitud (o ajustá partner_provision_completion_hours en app_settings).'
    );
  END IF;

  IF NOT (
    r.requested_by IS NOT DISTINCT FROM auth.uid()
    OR p_new_profile_id IS NOT DISTINCT FROM auth.uid()
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Iniciá sesión con tu usuario de socio o con el email del nuevo administrador para completar el alta.');
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
    INSERT INTO profiles (id, email, role, active, sponsor_id, trial_ends_at, kiosco_name, phone, partner_license_pending, partner_kit_review_until)
    VALUES (
      p_new_profile_id,
      r.target_email,
      'partner',
      true,
      r.requested_by,
      trial_end,
      NULLIF(trim(r.display_name), ''),
      NULLIF(trim(r.phone), ''),
      false,
      NULL
    );
  ELSE
    IF v_email IS NULL OR lower(trim(v_email)) IS DISTINCT FROM r.target_email THEN
      RETURN jsonb_build_object('ok', false, 'error', 'El email del perfil no coincide con el de la solicitud aprobada.');
    END IF;
    UPDATE profiles SET
      role = 'partner',
      sponsor_id = r.requested_by,
      kiosco_name = COALESCE(NULLIF(trim(r.display_name), ''), kiosco_name),
      phone = COALESCE(NULLIF(trim(r.phone), ''), phone),
      active = true,
      partner_license_pending = false,
      partner_kit_review_until = NULL,
      trial_ends_at = trial_end
    WHERE id = p_new_profile_id;
  END IF;

  IF EXISTS (
    SELECT 1 FROM profiles WHERE id = p_new_profile_id AND referral_code IS NOT NULL AND trim(referral_code) <> ''
  ) THEN
    ok_code := true;
  ELSE
    ok_code := false;
    WHILE attempts < 24 AND NOT ok_code LOOP
      attempts := attempts + 1;
      new_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      BEGIN
        UPDATE profiles SET referral_code = new_code
        WHERE id = p_new_profile_id AND (referral_code IS NULL OR trim(referral_code) = '');
        IF FOUND THEN
          ok_code := true;
        END IF;
      EXCEPTION WHEN unique_violation THEN
        ok_code := false;
      END;
    END LOOP;
  END IF;

  UPDATE ferriol_partner_provision_requests SET
    status = 'completed',
    completed_user_id = p_new_profile_id,
    registered_user_id = p_new_profile_id,
    completion_token = NULL,
    completion_token_expires_at = NULL
  WHERE id = r.id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_finalize_partner_provision(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_finalize_partner_provision(uuid, uuid) TO authenticated;
