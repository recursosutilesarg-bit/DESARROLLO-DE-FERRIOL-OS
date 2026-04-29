-- Ferriol OS · Permitir rol "partner" (distribuidor) en public.profiles
--
-- Sin esto, al registrarse por el enlace de afiliación (socio/distribuidor) aparece:
--   new row violates check constraint "profiles_role_check"
--
-- Ejecutá en Supabase → SQL Editor (una vez por proyecto).

ALTER TABLE public.profiles DROP CONSTRAINT IF EXISTS profiles_role_check;

ALTER TABLE public.profiles ADD CONSTRAINT profiles_role_check
  CHECK (
    role::text IN ('kiosquero', 'partner', 'super')
  );
