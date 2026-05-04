-- Ferriol OS · Notificaciones: audiencia por destinatario (all | kiosquero | partner | red)
-- Ejecutá en Supabase SQL Editor después de tener la tabla `notifications`.
--
-- La app filtra por `audience` al mostrar; las filas viejas sin columna se tratan como 'all'.
-- Si querés reforzar en RLS, podés reemplazar SELECT USING (true) por políticas según
-- profiles.role (no cubre bien el “preview kiosco” del fundador; por eso el filtro fino queda en la app).

ALTER TABLE notifications
  ADD COLUMN IF NOT EXISTS audience text NOT NULL DEFAULT 'all';

ALTER TABLE notifications
  DROP CONSTRAINT IF EXISTS notifications_audience_check;

ALTER TABLE notifications
  ADD CONSTRAINT notifications_audience_check
  CHECK (audience IN ('all', 'kiosquero', 'partner', 'red'));

COMMENT ON COLUMN notifications.audience IS 'all=todos con campana; kiosquero=negocios; partner=solo rol partner; red=socios + fundador en vista socio (sin kiosqueros).';
