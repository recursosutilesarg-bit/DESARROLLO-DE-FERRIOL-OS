-- Ferriol OS · Datos bancarios opcionales en el perfil del socio (partner)
-- Ejecutá en Supabase → SQL Editor (una vez).

ALTER TABLE profiles ADD COLUMN IF NOT EXISTS partner_transfer_info text;

COMMENT ON COLUMN profiles.partner_transfer_info IS 'Texto opcional para el socio (CBU/datos útiles). La app Ferriol no lo muestra al kiosco referido; uso interno/socio‑empresa/retiros.';

-- Si falta función de contacto sponsor: ejecutá supabase-ferriol-kiosquero-sponsor-display.sql
