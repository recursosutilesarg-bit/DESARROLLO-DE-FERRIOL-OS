-- Ferriol OS · Kiosquero: ver datos del referidor (sponsor) aunque RLS bloquee SELECT en profiles ajenas
-- Ejecutá en Supabase → SQL Editor (una vez), después de profiles y sponsor_id.
--
-- Motivo: muchas políticas solo permiten SELECT donde id = auth.uid(); el kiosquero necesita leer
-- la fila cuyo id = su sponsor_id (nombre, email, WhatsApp para contacto). NO exponer partner_transfer_info al referido.

CREATE OR REPLACE FUNCTION public.ferriol_get_my_sponsor_display()
RETURNS TABLE (
  kiosco_name text,
  email text,
  role text,
  phone text
)
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT p.kiosco_name, p.email, p.role, p.phone
  FROM public.profiles u
  INNER JOIN public.profiles p ON p.id = u.sponsor_id
  WHERE u.id = auth.uid()
    AND u.sponsor_id IS NOT NULL
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.ferriol_get_my_sponsor_display() FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.ferriol_get_my_sponsor_display() TO authenticated;

COMMENT ON FUNCTION public.ferriol_get_my_sponsor_display() IS 'Nombre, rol, email y teléfono del referidor inmediato; no incluye datos bancarios (partner_transfer_info).';

-- Opcional: política RLS alternativa (si preferís no depender del RPC; podés usar una u otra o ambas)
-- DROP POLICY IF EXISTS "profiles_kiosquero_read_sponsor_row" ON public.profiles;
-- CREATE POLICY "profiles_kiosquero_read_sponsor_row" ON public.profiles
-- FOR SELECT TO authenticated
-- USING (
--   id IN (
--     SELECT p.sponsor_id FROM public.profiles p
--     WHERE p.id = auth.uid() AND p.sponsor_id IS NOT NULL
--   )
-- );
