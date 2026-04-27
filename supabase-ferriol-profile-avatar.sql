-- Ferriol OS · Foto de perfil (URL pública tras subir a Storage)
-- Ejecutá en Supabase → SQL Editor (una vez).
-- La app guarda la URL en profiles.avatar_url; sube archivos a bucket comprobantes-ferriol en:
--   {auth.uid()}/profile-avatar/...

ALTER TABLE public.profiles ADD COLUMN IF NOT EXISTS avatar_url text;

COMMENT ON COLUMN public.profiles.avatar_url IS 'URL pública de la foto de perfil (p. ej. getPublicUrl tras subir a Storage).';
