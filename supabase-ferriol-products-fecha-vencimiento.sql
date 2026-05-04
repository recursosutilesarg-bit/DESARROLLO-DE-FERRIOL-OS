-- Ferriol OS · Fecha de vencimiento por producto y días de aviso configurables por el kiosquero.
-- Ejecutar en Supabase → SQL Editor (una vez por proyecto).

ALTER TABLE public.products
  ADD COLUMN IF NOT EXISTS fecha_vencimiento date NULL;

COMMENT ON COLUMN public.products.fecha_vencimiento IS 'Vencimiento del lote (opcional); aviso configurable en perfil antes de esa fecha si hay stock.';

ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS vencimiento_aviso_dias integer NOT NULL DEFAULT 7
    CHECK (vencimiento_aviso_dias >= 0 AND vencimiento_aviso_dias <= 365);

COMMENT ON COLUMN public.profiles.vencimiento_aviso_dias IS 'Cantidad de días antes de fecha_vencimiento para mostrar “VENCE PRONTO”.';
