-- Ferriol OS · Período de “aprobación kit” para distribuidores (partner)
-- Ventana configurable (horas) en app_settings; aviso en perfil hasta que expire o el fundador confirme el pago.
-- Ejecutá en Supabase → SQL Editor después de profiles / app_settings.

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS partner_kit_review_until timestamptz NULL;

COMMENT ON COLUMN public.profiles.partner_kit_review_until IS 'Si mayor que now(): aviso período confirmación pago kit en UI; fundador puede limpiar con ferriol_founder_clear_partner_kit_review.';

INSERT INTO public.app_settings (key, value)
SELECT 'partner_kit_review_hours', '24'
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'partner_kit_review_hours');

INSERT INTO public.app_settings (key, value)
SELECT 'partner_kit_review_message', 'Estás en período de aprobación. Esto puede tardar entre 12hs y 24hs hábiles.'
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'partner_kit_review_message');

CREATE OR REPLACE FUNCTION public.ferriol_partner_apply_kit_review_window()
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_id uuid;
  v_role text;
  v_hours int;
  v_until timestamptz;
BEGIN
  v_id := auth.uid();
  IF v_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;

  SELECT role INTO v_role FROM public.profiles WHERE id = v_id;
  IF v_role IS DISTINCT FROM 'partner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo para cuentas distribuidor.');
  END IF;

  v_hours := NULL;
  BEGIN
    SELECT trim(value)::int INTO v_hours FROM public.app_settings WHERE key = 'partner_kit_review_hours' LIMIT 1;
  EXCEPTION WHEN OTHERS THEN
    v_hours := NULL;
  END;
  IF v_hours IS NULL OR v_hours < 1 OR v_hours > 168 THEN
    BEGIN
      SELECT trim(value)::int INTO v_hours FROM public.app_settings WHERE key = 'partner_pending_grace_hours' LIMIT 1;
    EXCEPTION WHEN OTHERS THEN
      v_hours := NULL;
    END;
  END IF;
  IF v_hours IS NULL OR v_hours < 1 OR v_hours > 168 THEN
    v_hours := 24;
  END IF;

  v_until := now() + make_interval(hours => v_hours);

  UPDATE public.profiles SET partner_kit_review_until = v_until WHERE id = v_id;

  RETURN jsonb_build_object(
    'ok', true,
    'hours', v_hours,
    'until', to_char(v_until AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
  );
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_partner_apply_kit_review_window() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_partner_apply_kit_review_window() TO authenticated;

CREATE OR REPLACE FUNCTION public.ferriol_founder_clear_partner_kit_review(p_profile_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
DECLARE
  v_actor text;
BEGIN
  IF auth.uid() IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Sesión inválida.');
  END IF;

  SELECT role INTO v_actor FROM public.profiles WHERE id = auth.uid();
  IF v_actor IS DISTINCT FROM 'super' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo fundadores pueden confirmar el pago del kit.');
  END IF;

  IF p_profile_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Perfil inválido.');
  END IF;

  UPDATE public.profiles SET partner_kit_review_until = NULL WHERE id = p_profile_id;

  RETURN jsonb_build_object('ok', true);
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_founder_clear_partner_kit_review(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_founder_clear_partner_kit_review(uuid) TO authenticated;
