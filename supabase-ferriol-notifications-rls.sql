-- Ferriol OS · Notificaciones: solo la empresa (role = super) puede insertar filas.
-- Los kiosqueros y socios (partner) siguen pudiendo leer (SELECT) según tu política actual.
-- Columna audience (destinatarios): ver supabase-ferriol-notifications-audience.sql
-- Ejecutá en Supabase si tenías INSERT abierto a cualquier usuario autenticado.

DROP POLICY IF EXISTS "notifications_insert" ON notifications;
DROP POLICY IF EXISTS "notifications_insert_super_only" ON notifications;

CREATE POLICY "notifications_insert_super_only" ON notifications
  FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');

-- Si aún no tenés política de lectura, descomentá:
-- ALTER TABLE notifications ENABLE ROW LEVEL SECURITY;
-- CREATE POLICY "notifications_select_authenticated" ON notifications
--   FOR SELECT TO authenticated USING (true);
