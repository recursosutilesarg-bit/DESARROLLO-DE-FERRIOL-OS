-- Ferriol OS · Comprobantes del kiosco hacia el partner directo → el partner registra solicitud de venta (ferriol_client_sale_requests).
-- Ejecutar DESPUÉS de ferriol-empresa-payment-proof-requests.sql y supabase-ferriol-client-sale-requests.sql

-- ─── 1) Tabla cola ───
CREATE TABLE IF NOT EXISTS public.ferriol_kiosk_partner_proof_queue (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  kiosco_user_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  partner_id uuid NOT NULL REFERENCES public.profiles(id) ON DELETE CASCADE,
  payment_type text NOT NULL CHECK (
    payment_type IN ('kit_inicial', 'kiosco_licencia')
  ),
  amount_ars numeric NOT NULL CHECK (amount_ars > 0),
  comprobante_path text NOT NULL,
  sponsor_code_raw text,
  period_month date,
  status text NOT NULL DEFAULT 'pending_sale' CHECK (
    status IN ('pending_sale', 'sale_registered', 'cancelled')
  ),
  partner_sale_request_id uuid REFERENCES public.ferriol_client_sale_requests(id) ON DELETE SET NULL,
  registered_at timestamptz
);

CREATE INDEX IF NOT EXISTS idx_ferriol_kpq_partner_status
  ON public.ferriol_kiosk_partner_proof_queue (partner_id, status, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_ferriol_kpq_kiosk
  ON public.ferriol_kiosk_partner_proof_queue (kiosco_user_id);

COMMENT ON TABLE public.ferriol_kiosk_partner_proof_queue IS 'Comprobante subido por kiosco; llega al sponsor (partner) para que cargue solicitud de venta ante empresa.';

ALTER TABLE public.ferriol_kiosk_partner_proof_queue ENABLE ROW LEVEL SECURITY;

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

DROP POLICY IF EXISTS "ferriol_kpq_select_partner_kiosk_super" ON public.ferriol_kiosk_partner_proof_queue;
CREATE POLICY "ferriol_kpq_select_partner_kiosk_super" ON public.ferriol_kiosk_partner_proof_queue
  FOR SELECT TO authenticated
  USING (
    kiosco_user_id = auth.uid()
    OR partner_id = auth.uid()
    OR (SELECT role FROM public.profiles WHERE id = auth.uid() LIMIT 1) = 'super'
  );

GRANT SELECT, INSERT ON public.ferriol_kiosk_partner_proof_queue TO authenticated;

-- ─── 2) Storage: kiosk sube en {sponsor_id}/{kiosco_id}/… ; partner puede leer su prefijo ───

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

DROP POLICY IF EXISTS "comprobantes_ferriol_read" ON storage.objects;
CREATE POLICY "comprobantes_ferriol_read" ON storage.objects
  FOR SELECT TO authenticated
  USING (
    bucket_id = 'comprobantes-ferriol'
    AND (
      split_part(name::text, '/', 1) = (auth.uid())::text
      OR EXISTS (
        SELECT 1 FROM public.profiles prof
        WHERE prof.id = auth.uid()
          AND prof.role = 'super'
      )
      OR (
        EXISTS (
          SELECT 1 FROM public.profiles prof
          WHERE prof.id = auth.uid()
            AND prof.role = 'kiosquero'
            AND prof.sponsor_id IS NOT NULL
            AND split_part(name::text, '/', 1) = prof.sponsor_id::text
            AND split_part(name::text, '/', 2) = prof.id::text
        )
      )
      OR EXISTS (
        SELECT 1 FROM public.profiles prof
        WHERE prof.id = auth.uid()
          AND prof.role = 'partner'
          AND split_part(name::text, '/', 1) = prof.id::text
      )
    )
  );

-- ─── 3) RPC: partner convierte cola → ferriol_client_sale_requests ───

CREATE OR REPLACE FUNCTION public.ferriol_partner_register_sale_from_kiosk_proof(p_queue_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_role text;
  q public.ferriol_kiosk_partner_proof_queue%ROWTYPE;
  v_csr_id uuid;
  kem text;
  knm text;
BEGIN
  SELECT role INTO v_role FROM public.profiles WHERE id = v_actor LIMIT 1;
  IF v_role IS DISTINCT FROM 'partner' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solo distribuidores (partners) pueden registrar la venta.');
  END IF;

  SELECT * INTO q FROM public.ferriol_kiosk_partner_proof_queue WHERE id = p_queue_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Solicitud no encontrada.');
  END IF;

  IF q.partner_id <> v_actor THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Este comprobante no corresponde a tu cuenta.');
  END IF;

  IF q.status IS DISTINCT FROM 'pending_sale' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'Esta entrada ya fue procesada o está cancelada.');
  END IF;

  SELECT trim(lower(email::text)), COALESCE(NULLIF(trim(kiosco_name::text), ''), trim(lower(email::text)), 'Cliente')
    INTO kem, knm FROM public.profiles WHERE id = q.kiosco_user_id LIMIT 1;

  IF kem IS NULL OR length(kem) < 3 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'No se pudo leer el email del comercio en el sistema.');
  END IF;

  INSERT INTO public.ferriol_client_sale_requests (
    partner_id, client_name, client_email, comprobante_path, amount_ars,
    payment_type, period_month, status
  ) VALUES (
    q.partner_id, knm, kem, trim(q.comprobante_path),
    q.amount_ars, q.payment_type,
    q.period_month, 'pending'
  ) RETURNING id INTO v_csr_id;

  UPDATE public.ferriol_kiosk_partner_proof_queue
    SET status = 'sale_registered',
        partner_sale_request_id = v_csr_id,
        registered_at = now()
    WHERE id = p_queue_id;

  RETURN jsonb_build_object(
    'ok', true,
    'client_sale_request_id', v_csr_id,
    'queue_id', p_queue_id
  );
EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('ok', false, 'error', SQLERRM);
END;
$$;

REVOKE ALL ON FUNCTION public.ferriol_partner_register_sale_from_kiosk_proof(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_partner_register_sale_from_kiosk_proof(uuid) TO authenticated;
