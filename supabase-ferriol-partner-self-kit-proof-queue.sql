-- Ferriol OS · Socio nuevo (partner) que se registra con referidor: puede subir comprobante de kit a la misma cola que el kiosco.
-- Ejecutar DESPUÉS de supabase-ferriol-kiosk-proofs-partner-queue.sql (tabla + políticas base).

-- ─── 1) INSERT cola: partner + kit_inicial, mismo sponsor ───
DROP POLICY IF EXISTS "ferriol_kpq_kiosk_insert" ON public.ferriol_kiosk_partner_proof_queue;
CREATE POLICY "ferriol_kpq_kiosk_insert" ON public.ferriol_kiosk_partner_proof_queue
  FOR INSERT TO authenticated
  WITH CHECK (
    (
      kiosco_user_id = auth.uid()
      AND (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'kiosquero'
      AND partner_id IS NOT NULL
      AND partner_id = (SELECT sponsor_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    )
    OR
    (
      kiosco_user_id = auth.uid()
      AND (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'partner'
      AND payment_type = 'kit_inicial'
      AND partner_id IS NOT NULL
      AND partner_id = (SELECT sponsor_id FROM public.profiles WHERE id = auth.uid() LIMIT 1)
    )
  );

-- ─── 2) Storage: socio sube en {sponsor_id}/{su_user_id}/… (misma forma que kiosco) ───
DROP POLICY IF EXISTS "comprobantes_ferriol_insert_kiosk_sponsor_folder" ON storage.objects;
CREATE POLICY "comprobantes_ferriol_insert_kiosk_sponsor_folder" ON storage.objects
  FOR INSERT TO authenticated
  WITH CHECK (
    bucket_id = 'comprobantes-ferriol'
    AND (
      EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'kiosquero'
          AND p.sponsor_id IS NOT NULL
          AND split_part(name::text, '/', 1) = p.sponsor_id::text
          AND split_part(name::text, '/', 2) = p.id::text
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles p
        WHERE p.id = auth.uid()
          AND p.role = 'partner'
          AND p.sponsor_id IS NOT NULL
          AND split_part(name::text, '/', 1) = p.sponsor_id::text
          AND split_part(name::text, '/', 2) = p.id::text
      )
    )
  );
