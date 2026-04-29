-- Ferriol OS · Upgrade: kiosquero → partner (misma cuenta)
-- El kiosquero solicita desde la app; solo super aprueba y aplica licencia + rol.
-- Requiere: profiles con partner_sponsor_id (supabase-profiles-kiosco-vs-partner-sponsor.sql).
-- Ejecutá en Supabase → SQL Editor.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS partner_sponsor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

-- Usada también en provision kit y por kiosco-app.js; debe existir antes de RPC de aprobación.
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS partner_license_pending boolean NOT NULL DEFAULT false;
COMMENT ON COLUMN public.profiles.partner_license_pending IS 'true: alta kit esperando aprobación Ferriol; trial_ends_at = fin de ventana de gracia hasta que aprueben.';

CREATE TABLE IF NOT EXISTS public.ferriol_kiosquero_partner_upgrade_requests (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  profile_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_kit_sponsor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  applicant_note text,
  status text NOT NULL DEFAULT 'pending',
  reviewed_at timestamptz,
  reviewed_by uuid REFERENCES public.profiles(id) ON DELETE SET NULL,
  reject_note text,
  CONSTRAINT ferriol_kpur_status_chk CHECK (status IN ('pending', 'approved', 'rejected'))
);

CREATE UNIQUE INDEX IF NOT EXISTS ferriol_kpur_one_pending_per_profile
  ON public.ferriol_kiosquero_partner_upgrade_requests (profile_id)
  WHERE status = 'pending';

CREATE INDEX IF NOT EXISTS idx_ferriol_kpur_status ON public.ferriol_kiosquero_partner_upgrade_requests (status, created_at DESC);

COMMENT ON TABLE public.ferriol_kiosquero_partner_upgrade_requests IS 'Solicitud de pasar de kiosquero a socio distribuidor (upgrade misma cuenta). Fila approved: la app habilita solo a esos perfiles partner la vista negocio (misma cuenta). Socios alta solo kit no tienen esa fila.';

ALTER TABLE public.ferriol_kiosquero_partner_upgrade_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "ferriol_kpur_super_all" ON public.ferriol_kiosquero_partner_upgrade_requests;
CREATE POLICY "ferriol_kpur_super_all" ON public.ferriol_kiosquero_partner_upgrade_requests
  FOR ALL TO authenticated
  USING ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super')
  WITH CHECK ((SELECT role FROM public.profiles WHERE id = auth.uid()) = 'super');

DROP POLICY IF EXISTS "ferriol_kpur_own_select" ON public.ferriol_kiosquero_partner_upgrade_requests;
CREATE POLICY "ferriol_kpur_own_select" ON public.ferriol_kiosquero_partner_upgrade_requests
  FOR SELECT TO authenticated
  USING (profile_id = auth.uid());

GRANT SELECT ON public.ferriol_kiosquero_partner_upgrade_requests TO authenticated;

-- Solicitud (solo kiosquero; una pending por perfil)
CREATE OR REPLACE FUNCTION public.ferriol_request_kiosquero_partner_upgrade(
  p_partner_kit_sponsor_id uuid DEFAULT NULL,
  p_note text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_role text;
  v_id uuid;
  v_kit_role text;
BEGIN
  v_id := auth.uid();
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Iniciá sesión como kiosquero.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_id;
  IF v_role IS DISTINCT FROM 'kiosquero' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo cuentas de negocio (kiosquero) pueden pedir este upgrade.');
  END IF;

  IF EXISTS (
    SELECT 1 FROM public.ferriol_kiosquero_partner_upgrade_requests
    WHERE profile_id = v_id AND status = 'pending'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Ya tenés una solicitud pendiente. Esperá la respuesta de la empresa.');
  END IF;

  IF p_partner_kit_sponsor_id IS NOT NULL THEN
    SELECT role INTO v_kit_role FROM public.profiles WHERE id = p_partner_kit_sponsor_id;
    IF NOT FOUND OR v_kit_role IS NULL OR (v_kit_role NOT IN ('partner', 'super')) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'El socio del kit indicado no es válido (debe ser socio o empresa).');
    END IF;
    IF p_partner_kit_sponsor_id = v_id THEN
      RETURN jsonb_build_object('ok', false, 'error', 'No podés indicarte a vos mismo como socio del kit.');
    END IF;
  END IF;

  INSERT INTO public.ferriol_kiosquero_partner_upgrade_requests (profile_id, partner_kit_sponsor_id, applicant_note)
  VALUES (
    v_id,
    p_partner_kit_sponsor_id,
    NULLIF(trim(p_note), '')
  );

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_request_kiosquero_partner_upgrade(uuid, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_request_kiosquero_partner_upgrade(uuid, text) TO authenticated;

-- Aprobación / rechazo (solo super)
CREATE OR REPLACE FUNCTION public.ferriol_approve_kiosquero_partner_upgrade(
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
  v_actor_role text;
  v_tgt_role text;
  r public.ferriol_kiosquero_partner_upgrade_requests%ROWTYPE;
  lic_days int;
  trial_end timestamptz;
  attempts int := 0;
  new_code text;
  ok_code boolean := false;
  v_sponsor uuid;
  v_psid uuid;
BEGIN
  SELECT role INTO v_actor_role FROM public.profiles WHERE id = auth.uid();
  IF v_actor_role IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo la empresa puede aprobar o rechazar este upgrade.');
  END IF;

  SELECT * INTO r FROM public.ferriol_kiosquero_partner_upgrade_requests WHERE id = p_request_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;
  IF r.status IS DISTINCT FROM 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'La solicitud ya fue procesada.');
  END IF;

  IF NOT p_approve THEN
    UPDATE public.ferriol_kiosquero_partner_upgrade_requests
    SET status = 'rejected',
        reviewed_at = now(),
        reviewed_by = auth.uid(),
        reject_note = NULLIF(trim(p_reject_note), '')
    WHERE id = p_request_id;
    RETURN jsonb_build_object('ok', true, 'action', 'rejected');
  END IF;

  SELECT role, sponsor_id, partner_sponsor_id
  INTO v_tgt_role, v_sponsor, v_psid
  FROM public.profiles WHERE id = r.profile_id;
  IF NOT FOUND OR v_tgt_role IS DISTINCT FROM 'kiosquero' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'El usuario ya no es kiosquero o el perfil no existe.');
  END IF;

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

  trial_end := now() + (lic_days || ' days')::interval;

  -- sponsor_id = línea negocio (sin tocar); partner_sponsor_id = línea kit o fallback al mismo referidor negocio
  UPDATE public.profiles SET
    role = 'partner',
    partner_sponsor_id = COALESCE(r.partner_kit_sponsor_id, v_psid, v_sponsor),
    trial_ends_at = trial_end,
    partner_license_pending = false,
    active = true
  WHERE id = r.profile_id;

  IF EXISTS (
    SELECT 1 FROM public.profiles WHERE id = r.profile_id AND referral_code IS NOT NULL AND trim(referral_code::text) <> ''
  ) THEN
    ok_code := true;
  ELSE
    WHILE attempts < 24 AND NOT ok_code LOOP
      attempts := attempts + 1;
      new_code := upper(substring(replace(gen_random_uuid()::text, '-', ''), 1, 8));
      BEGIN
        UPDATE public.profiles SET referral_code = new_code
        WHERE id = r.profile_id AND (referral_code IS NULL OR trim(referral_code::text) = '');
        IF FOUND THEN
          ok_code := true;
        END IF;
      EXCEPTION WHEN unique_violation THEN
        ok_code := false;
      END;
    END LOOP;
  END IF;

  UPDATE public.ferriol_kiosquero_partner_upgrade_requests
  SET status = 'approved',
      reviewed_at = now(),
      reviewed_by = auth.uid(),
      reject_note = NULL
  WHERE id = p_request_id;

  RETURN jsonb_build_object(
    'ok', true,
    'action', 'approved',
    'trial_ends_at', to_char(trial_end AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"'),
    'license_days', lic_days
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_approve_kiosquero_partner_upgrade(uuid, boolean, text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_approve_kiosquero_partner_upgrade(uuid, boolean, text) TO authenticated;
