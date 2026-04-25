-- Ferriol OS · Datos bancarios del referidor (partner) visibles a sus kiosqueros
-- Ejecutá en Supabase → SQL Editor (una vez).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS partner_transfer_info text;

COMMENT ON COLUMN profiles.partner_transfer_info IS 'Datos bancarios del socio (referidor) para abonos de cuota; lo ven los usuarios cuyo sponsor_id apunta a este perfil, además de los datos de empresa.';

-- Si al kiosquero le falla RLS al leer al sponsor, descomentá y ejecutá:
-- Los SELECT existentes a profiles con OR; esto añade lectura al referidor inmediato.
-- CREATE POLICY "profiles_kiosquero_read_sponsor_row" ON public.profiles
-- FOR SELECT TO authenticated
-- USING (
--   id IN (SELECT p.sponsor_id FROM public.profiles p WHERE p.id = auth.uid() AND p.sponsor_id IS NOT NULL)
-- );
