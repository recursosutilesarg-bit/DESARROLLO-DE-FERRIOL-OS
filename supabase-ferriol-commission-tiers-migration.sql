-- Ferriol OS — Migración: comisiones intro vs normal (kit + licencia kiosco) + metadatos en libro
-- Ejecutá en Supabase (SQL) si la base ya existía con compensation_v1 antiguo (solo 80/20 fijo).
-- Luego: misma lógica que en supabase-ferriol-payments.sql (función ferriol_verify_payment).

UPDATE mlm_plan_config
SET
  value = value || '{
    "partner_intro_months": 1,
    "sale_vendor_pct_intro": 0.8,
    "sale_company_pct_intro": 0.2,
    "sale_vendor_pct_normal": 0.5,
    "sale_company_pct_normal": 0.5
  }'::jsonb,
  updated_at = now()
WHERE key = 'compensation_v1';

-- Copiá aquí el bloque completo CREATE OR REPLACE FUNCTION public.ferriol_verify_payment
-- desde supabase-ferriol-payments.sql (líneas CREATE OR REPLACE … hasta GRANT),
-- o ejecutá de nuevo solo ese script si preferís reemplazar la función.
