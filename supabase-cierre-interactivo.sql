-- Cierre de caja interactivo: saldo teórico vs físico, denominaciones, fondo siguiente turno.
-- Ejecutá en Supabase → SQL Editor y habilitá RLS como el resto del proyecto.

CREATE TABLE IF NOT EXISTS cierres_interactivos (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  fecha_hora timestamptz NOT NULL DEFAULT now(),
  saldo_inicial numeric NOT NULL DEFAULT 0,
  ventas_efectivo_sistema numeric NOT NULL DEFAULT 0,
  cobro_libreta_incluido boolean NOT NULL DEFAULT true,
  cobro_libreta_monto numeric NOT NULL DEFAULT 0,
  pagos_proveedor_turno numeric NOT NULL DEFAULT 0,
  egresos_gastos_fijos_turno numeric NOT NULL DEFAULT 0,
  saldo_esperado_efectivo numeric NOT NULL DEFAULT 0,
  efectivo_estado text,
  efectivo_real numeric,
  efectivo_diferencia numeric,
  tarjeta_sistema numeric NOT NULL DEFAULT 0,
  tarjeta_ok boolean,
  tarjeta_real numeric,
  transferencia_sistema numeric NOT NULL DEFAULT 0,
  transferencia_ok boolean,
  transferencia_real numeric,
  justificacion text,
  fondo_siguiente_turno numeric,
  detalle jsonb,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_cierres_interactivos_user_fecha ON cierres_interactivos(user_id, fecha_hora DESC);

ALTER TABLE cierres_interactivos ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "cierres_interactivos_own" ON cierres_interactivos;
CREATE POLICY "cierres_interactivos_own" ON cierres_interactivos
  FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);

COMMENT ON TABLE cierres_interactivos IS 'Auditoría de cierre: saldo teórico efectivo vs contado, validación por medio.';
COMMENT ON COLUMN cierres_interactivos.detalle IS 'JSON extendido: denominaciones, estados de checklist por medio, y auditoria (fecha_operativo_local, cerrado_por_*, total_ventas_dia_todos_medios, ganancia_dia, egresos[{tipo,descripcion,monto}], notas_usuario) para historial y reportes.';
