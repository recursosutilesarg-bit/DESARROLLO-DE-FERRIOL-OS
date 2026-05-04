-- Ferriol OS · Partner puede leer perfiles de su descendencia (sponsor_id → árbol).
-- IMPORTANTE: la política NO debe hacer SELECT directo sobre profiles (provoca “infinite recursion” en RLS).
-- Las comprobaciones van en funciones SECURITY DEFINER con row_security off.

CREATE OR REPLACE FUNCTION public.ferriol_is_partner_user()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.profiles
    WHERE id = auth.uid() AND role = 'partner'
  );
$$;

CREATE OR REPLACE FUNCTION public.ferriol_profile_is_in_downline_of(p_viewer uuid, p_target uuid)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
SET row_security = off
AS $$
  SELECT CASE
    WHEN p_viewer IS NULL OR p_target IS NULL THEN false
    WHEN p_viewer = p_target THEN true
    ELSE EXISTS (
      WITH RECURSIVE ancestors AS (
        SELECT id, sponsor_id FROM public.profiles WHERE id = p_target
        UNION ALL
        SELECT pr.id, pr.sponsor_id
        FROM public.profiles pr
        INNER JOIN ancestors a ON pr.id = a.sponsor_id
        WHERE a.sponsor_id IS NOT NULL
      )
      SELECT 1 FROM ancestors WHERE id = p_viewer LIMIT 1
    )
  END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_is_partner_user() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_is_partner_user() TO authenticated;
GRANT EXECUTE ON FUNCTION public.ferriol_is_partner_user() TO service_role;

REVOKE ALL ON FUNCTION public.ferriol_profile_is_in_downline_of(uuid, uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_profile_is_in_downline_of(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.ferriol_profile_is_in_downline_of(uuid, uuid) TO service_role;

DROP POLICY IF EXISTS "profiles_partner_select_downline" ON public.profiles;
CREATE POLICY "profiles_partner_select_downline"
  ON public.profiles
  FOR SELECT
  TO authenticated
  USING (
    public.ferriol_is_partner_user()
    AND public.ferriol_profile_is_in_downline_of(auth.uid(), profiles.id)
  );

COMMENT ON FUNCTION public.ferriol_is_partner_user() IS 'RLS helper: true si auth.uid() es role partner (sin consultar profiles bajo RLS del caller).';
COMMENT ON FUNCTION public.ferriol_profile_is_in_downline_of(uuid, uuid) IS 'True si p_target está en la línea de p_viewer (sube por sponsor_id).';
