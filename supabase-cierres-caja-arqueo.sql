-- Ampliación opcional de cierres_caja: arqueo de efectivo y totales por medio (cierre tipo comercio).
-- Ejecutá en Supabase → SQL Editor si querés persistir conteo físico, diferencia y notas.

ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS efectivo_registrado numeric DEFAULT 0;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS tarjeta_total numeric DEFAULT 0;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS transferencia_total numeric DEFAULT 0;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS cobro_libreta_total numeric DEFAULT 0;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS transacciones_count integer DEFAULT 0;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS efectivo_contado numeric;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS efectivo_diferencia numeric;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS arqueo_omitido boolean DEFAULT false;
ALTER TABLE cierres_caja ADD COLUMN IF NOT EXISTS notas_cierre text;

COMMENT ON COLUMN cierres_caja.efectivo_registrado IS 'Efectivo según ventas registradas en el día.';
COMMENT ON COLUMN cierres_caja.efectivo_contado IS 'Efectivo físico contado en gaveta (null si no hubo arqueo).';
COMMENT ON COLUMN cierres_caja.efectivo_diferencia IS 'contado − registrado.';
COMMENT ON COLUMN cierres_caja.arqueo_omitido IS 'Usuario cerró sin cargar conteo físico.';
|