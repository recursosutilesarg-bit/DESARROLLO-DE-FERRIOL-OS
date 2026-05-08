-- Ferriol OS · Permitir que socios (partner) vean solicitudes de upgrade kiosco→distribuidor de su red.
-- Ejecutá en Supabase → SQL Editor DESPUÉS de supabase-ferriol-kiosquero-partner-upgrade-requests.sql
--
-- Visibilidad: filas donde el socio figura como vendedor del kit (partner_kit_sponsor_id)
-- o donde el comercio que pide upgrade tiene como sponsor al socio (profiles.sponsor_id).

DROP POLICY IF EXISTS "ferriol_kpur_partner_referrals_select" ON public.ferriol_kiosquero_partner_upgrade_requests;

CREATE POLICY "ferriol_kpur_partner_referrals_select" ON public.ferriol_kiosquero_partner_upgrade_requests
  FOR SELECT TO authenticated
  USING (
    (SELECT role FROM public.profiles WHERE id = auth.uid()) = 'partner'
    AND (
      partner_kit_sponsor_id = auth.uid()
      OR EXISTS (
        SELECT 1
        FROM public.profiles pr
        WHERE pr.id = ferriol_kiosquero_partner_upgrade_requests.profile_id
          AND pr.sponsor_id = auth.uid()
      )
    )
  );

COMMENT ON POLICY "ferriol_kpur_partner_referrals_select" ON public.ferriol_kiosquero_partner_upgrade_requests IS
  'Socio ve upgrades de referidos (kit suyo o sponsor del kiosco).';
