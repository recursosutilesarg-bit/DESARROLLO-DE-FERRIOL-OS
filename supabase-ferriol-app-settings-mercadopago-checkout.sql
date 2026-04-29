-- Links Mercado Pago por producto en app_settings.
-- JSON: ferriol_mercadopago_checkout_urls → {"kit":"","kioscoMonthly":"","vendorMonthly":""}
-- Legacy: ferriol_mercadopago_checkout_url (primer valor si solo existía un link; la app fusiona ambos).

INSERT INTO public.app_settings (key, value)
SELECT 'ferriol_mercadopago_checkout_url', ''
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'ferriol_mercadopago_checkout_url');

INSERT INTO public.app_settings (key, value)
SELECT 'ferriol_mercadopago_checkout_urls', '{}'
WHERE NOT EXISTS (SELECT 1 FROM public.app_settings WHERE key = 'ferriol_mercadopago_checkout_urls');

-- Lectura para usuarios autenticados (misma idea que ferriol_transfer_info en supabase-ferriol-payments.sql)
-- Ajustá el nombre si chocara con otra política tuya.
/*
DROP POLICY IF EXISTS "app_settings_read_ferriol_checkout_urls" ON public.app_settings;
CREATE POLICY "app_settings_read_ferriol_checkout_urls" ON public.app_settings
  FOR SELECT TO authenticated
  USING (key IN ('ferriol_transfer_info', 'ferriol_mercadopago_checkout_url', 'ferriol_mercadopago_checkout_urls'));
*/
