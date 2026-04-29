-- Ferriol OS · Patrocinio del kiosco vs patrocinio del partner (dos líneas en la misma cuenta)
--
-- Modelo conceptual:
--   • Sponsor del **kiosquero** (línea del negocio / comercio): columna ya existente `sponsor_id`
--     — quién ingresó o refiere ese **punto de venta**.
--   • Sponsor del **partner** (línea distribuidor / kit / licencia): nueva columna `partner_sponsor_id`
--     — quién tiene la genealogía MLM como **socio** cuando difiere del kiosco o se registra sólo ese vínculo.
--
-- Una persona con una sola cuenta puede tener dos UUID distintos (ej.: suscripción bajo socio A,
-- compra del kit/licencia con socio B) sin repetir emails en Auth.
--
-- Ejecutá en Supabase → SQL Editor (una vez por proyecto).

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS partner_sponsor_id uuid REFERENCES public.profiles(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_profiles_partner_sponsor_id
  ON public.profiles (partner_sponsor_id)
  WHERE partner_sponsor_id IS NOT NULL;

COMMENT ON COLUMN public.profiles.sponsor_id IS 'Patrocinador línea negocio (kiosco): quién refiere ese comercio en la red.';
COMMENT ON COLUMN public.profiles.partner_sponsor_id IS 'Patrocinador línea partner/distribuidor cuando aplica al perfil como socio (p. ej. quien cerró kit/licencia). Puede diferir de sponsor_id.';

-- Opcional tras desplegar lógica en la app para socios sólo-distribuidor:
--   UPDATE profiles SET partner_sponsor_id = sponsor_id WHERE role = 'partner' AND partner_sponsor_id IS NULL;
-- Si no corrés esto, en partner el referidor efectivo suele seguir siendo sólo sponsor_id hasta que implementéis lectura priorizada.
