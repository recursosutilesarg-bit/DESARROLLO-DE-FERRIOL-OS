-- Opcional · ejecutar en Supabase si ventas ya aprobadas pero el comercio no aparece en Afiliados / chip activos del socio.
-- Causas típicas: (1) RLS sin política de lectura para descendencia del partner → ejecutá supabase-ferriol-profiles-rls-partner-downline.sql
--                 (2) sponsor_id del kiosquero no era el partner que cargó la venta → este UPDATE corrige desde ferriol_client_sale_requests.

-- Vista previa (solo lectura):
-- SELECT p.id, p.email, p.kiosco_name, p.sponsor_id AS sponsor_actual, csr.partner_id AS socio_venta_aprobada
-- FROM public.profiles p
-- INNER JOIN public.ferriol_client_sale_requests csr ON lower(trim(p.email)) = csr.client_email
-- WHERE csr.status = 'approved'
--   AND p.role = 'kiosquero'
--   AND p.id <> csr.partner_id;

UPDATE public.profiles p
SET sponsor_id = csr.partner_id
FROM public.ferriol_client_sale_requests csr
WHERE csr.status = 'approved'
  AND lower(trim(p.email)) = csr.client_email
  AND p.role = 'kiosquero'
  AND p.id <> csr.partner_id;
