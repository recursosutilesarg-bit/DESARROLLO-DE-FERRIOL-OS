-- Periodicidad de gastos fijos: el monto se reparte por día en el período (estado de cuenta).
-- Ejecutar en Supabase → SQL.

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS periodicidad text DEFAULT 'puntual';

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS vigencia_desde date;

ALTER TABLE gastos
  ADD COLUMN IF NOT EXISTS vigencia_hasta date;

COMMENT ON COLUMN gastos.periodicidad IS 'diario | semanal | quincenal | mensual | trimestral | anual | puntual (legado)';
COMMENT ON COLUMN gastos.vigencia_desde IS 'Inicio de vigencia del gasto recurrente (por defecto = fecha del alta)';
COMMENT ON COLUMN gastos.vigencia_hasta IS 'Fin inclusive opcional; NULL = sin fin';

UPDATE gastos
SET periodicidad = COALESCE(NULLIF(trim(periodicidad), ''), 'puntual'),
    vigencia_desde = COALESCE(vigencia_desde, fecha::date)
WHERE vigencia_desde IS NULL OR periodicidad IS NULL;
