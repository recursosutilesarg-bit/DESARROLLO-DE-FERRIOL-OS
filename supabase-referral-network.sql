-- Ferriol OS · Red de referidos / base MLM
-- Ejecutá este script en Supabase → SQL Editor (una vez).

-- 1) Columnas en profiles
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS sponsor_id uuid REFERENCES profiles(id) ON DELETE SET NULL;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS referral_code text;

COMMENT ON COLUMN profiles.sponsor_id IS 'Usuario que refirió (upline inmediato)';
COMMENT ON COLUMN profiles.referral_code IS 'Código único para invitar (mayúsculas recomendado)';

-- Índice único parcial: varios NULL permitidos antes de asignar código
CREATE UNIQUE INDEX IF NOT EXISTS profiles_referral_code_unique ON profiles (referral_code) WHERE referral_code IS NOT NULL;

-- 2) Rol adicional para líderes de red (acceso limitado en la app; ver kiosco-app.js)
-- Los administradores globales siguen con role = 'super'.
-- Ejemplo de socio: UPDATE profiles SET role = 'partner' WHERE email = '...';

-- 3) Resolver código sin exponer filas completas (usable con anon key en el registro)
CREATE OR REPLACE FUNCTION public.resolve_referral_code(p_code text)
RETURNS uuid
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
  SELECT id FROM profiles
  WHERE referral_code IS NOT NULL
    AND upper(trim(referral_code)) = upper(trim(p_code))
  LIMIT 1;
$$;

REVOKE ALL ON FUNCTION public.resolve_referral_code(text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.resolve_referral_code(text) TO anon;
GRANT EXECUTE ON FUNCTION public.resolve_referral_code(text) TO authenticated;

-- 4) RLS: asegurate de que INSERT/UPDATE del propio perfil permitan sponsor_id y referral_code
-- (si ya tenés políticas "usuarios actualizan su fila", suele alcanzar).

-- 5) Socios con role = 'partner' necesitan leer profiles para listar su red (igual que super).
--    Si al entrar como partner ves error de RLS, agregá algo equivalente a:
--
-- CREATE POLICY "partner_select_profiles"
-- ON profiles FOR SELECT TO authenticated
-- USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'partner');
--
-- (Si ya tenés una política amplia para super, podés extenderla con OR role = 'partner'.)

-- 6) Promover un usuario a líder de red (acceso limitado: solo ve su árbol de referidos):
-- UPDATE profiles SET role = 'partner' WHERE email = 'socio@ejemplo.com';
-- Los administradores globales mantienen role = 'super' (acceso total a la app).
