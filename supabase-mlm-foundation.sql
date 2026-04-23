-- Ferriol OS · Fundación MLM (estructura base, sin lógica de pago en la app aún)
-- Ejecutá DESPUÉS de supabase-referral-network.sql (necesita profiles + sponsor_id).
-- Podés correrlo aunque no uses comisiones: columnas/tablas quedan listas para evolucionar.

-- ——— A) Perfil: metadatos de red ———
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS mlm_rank text;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS network_joined_at timestamptz;
ALTER TABLE profiles ADD COLUMN IF NOT EXISTS placement_parent_id uuid REFERENCES profiles(id) ON DELETE SET NULL;

COMMENT ON COLUMN profiles.mlm_rank IS 'Rango MLM futuro (ej. bronze, silver); NULL = sin asignar';
COMMENT ON COLUMN profiles.network_joined_at IS 'Momento de ingreso a la red comercial; rellenar desde app o trigger cuando definan reglas';
COMMENT ON COLUMN profiles.placement_parent_id IS 'Opcional: padre en árbol de colocación (matrix/binario); puede diferir de sponsor_id';

-- ——— B) Parámetros del plan (JSON versionable) ———
CREATE TABLE IF NOT EXISTS mlm_plan_config (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text NOT NULL UNIQUE,
  value jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

COMMENT ON TABLE mlm_plan_config IS 'Reglas del plan: niveles, %, montos. Ej. key=commission_v1, value={"levels":[...]}';

CREATE INDEX IF NOT EXISTS idx_mlm_plan_config_key ON mlm_plan_config (key);

ALTER TABLE mlm_plan_config ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mlm_plan_config_super_all" ON mlm_plan_config;
CREATE POLICY "mlm_plan_config_super_all" ON mlm_plan_config
  FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');

-- ——— C) Libro de movimientos MLM (accruals / ajustes / pagos futuros) ———
CREATE TABLE IF NOT EXISTS mlm_ledger (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  created_at timestamptz NOT NULL DEFAULT now(),
  beneficiary_user_id uuid NOT NULL REFERENCES profiles(id) ON DELETE CASCADE,
  origin_user_id uuid REFERENCES profiles(id) ON DELETE SET NULL,
  event_type text NOT NULL,
  status text NOT NULL DEFAULT 'pending',
  amount numeric NOT NULL DEFAULT 0,
  currency text NOT NULL DEFAULT 'ARS',
  depth smallint,
  rule_ref text,
  idempotency_key text UNIQUE,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  period_month date
);

COMMENT ON TABLE mlm_ledger IS 'Movimientos MLM; la app puede no escribir hasta que activen el motor de comisiones';
COMMENT ON COLUMN mlm_ledger.depth IS 'Nivel en cadena de upline (0 = línea directa del origin_user)';
COMMENT ON COLUMN mlm_ledger.idempotency_key IS 'Mismo evento origen no debe acreditar dos veces';
COMMENT ON COLUMN mlm_ledger.period_month IS 'Opcional: mes de liquidación (primer día del mes)';

CREATE INDEX IF NOT EXISTS idx_mlm_ledger_beneficiary ON mlm_ledger (beneficiary_user_id);
CREATE INDEX IF NOT EXISTS idx_mlm_ledger_status ON mlm_ledger (status);
CREATE INDEX IF NOT EXISTS idx_mlm_ledger_created ON mlm_ledger (created_at DESC);

ALTER TABLE mlm_ledger ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mlm_ledger_super_all" ON mlm_ledger;
CREATE POLICY "mlm_ledger_super_all" ON mlm_ledger
  FOR ALL TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');

DROP POLICY IF EXISTS "mlm_ledger_beneficiary_select" ON mlm_ledger;
CREATE POLICY "mlm_ledger_beneficiary_select" ON mlm_ledger
  FOR SELECT TO authenticated
  USING (beneficiary_user_id = auth.uid());

-- ——— Notas ———
-- Eventos sugeridos en cliente (ver FerriolMlm.EVENT en kiosco-app.js): membership_sale, renewal, etc.
-- Estados sugeridos: pending, approved, paid, void
-- Si necesitás que un RPC (service role) inserte en mlm_ledger sin sesión super, usá Edge Function o política aparte.
