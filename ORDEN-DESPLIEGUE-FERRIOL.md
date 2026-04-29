# Ferriol OS — Orden de despliegue

Referencia única: **qué ejecutar en Supabase** y **qué subir al hosting**. Si un script ya lo corriste antes, volver a ejecutarlo suele ser seguro (`IF NOT EXISTS`, `CREATE OR REPLACE`).

---

## 1. Supabase (SQL Editor) — orden recomendado

| # | Archivo | Rol |
|---|---------|-----|
| 1 | `supabase-referral-network.sql` | Base red: `sponsor_id`, `referral_code`, función `resolve_referral_code`. |
| 1b | `supabase-profiles-allow-role-partner.sql` | **Obligatorio** si el CHECK de `profiles.role` no incluye `partner` (error al registrar distribuidor). |
| 2 | `supabase-mlm-foundation.sql` | Tablas/plan MLM si usás compensaciones en libro. |
| 3 | `supabase-ferriol-kiosco-definitive-trial.sql` | Asegura `trial_duration_days` en `app_settings`. |
| 4 | `supabase-ferriol-payments.sql` | Cobros `ferriol_payments`, verificación, textos banco; claves `app_settings` (transferencias, horas kit socio, días licencia distribuidor, etc.). |
| 5 | `supabase-ferriol-membership-day-requests.sql` | Solicitudes de días (kiosco) + aprobación solo `super`. |
| 6 | `supabase-ferriol-mdr-partner-license-target.sql` | **Parche:** mismas solicitudes también para perfil **socio** (además de kiosco). Ejecutar **después** del #5. |
| 7 | `supabase-ferriol-partner-provision-requests.sql` | Alta kit distribuidor: solicitud → aprobación → token o cuenta anticipada + gracia + `ferriol_link_partner_pending_kit`. |
| 8 | `supabase-ferriol-kiosquero-provision-requests.sql` | Alta negocio (kiosco) con aprobación Ferriol. |
| 9 | `supabase-ferriol-monthly-auto.sql` | Cargos mensuales automáticos (si los usás). |
| 10 | `supabase-ferriol-notifications-rls.sql` | Notificaciones globales (RLS). |
| 11 | `supabase-fix-products-caja.sql` | Arreglos RLS/columnas productos y caja (si la app lo pide). |
| *opc* | `supabase-ferriol-demo-seed.sql` | Solo entorno de prueba / demo ledger. |

**Notas**

- Políticas RLS de `profiles` y resto de tablas: según tu proyecto (comentarios en `kiosco-app.js` y en cada `.sql`).
- Si algo falla por “ya existe”, leé el error: a veces conviene ejecutar solo el bloque que falta.

---

## 2. Hosting / web — archivos a publicar

Junto con la **misma carpeta** de recursos:

| Obligatorios para la app principal | Comentario |
|-----------------------------------|------------|
| `kiosco.html` | Entrada de la SPA. |
| `kiosco-app.js` | Lógica + Supabase. |
| `kiosco.css` | Estilos. |
| `kiosco-config.js` | URL y anon key de Supabase. |
| `kiosco-pwa.js` | PWA (si lo cargás desde el HTML). |
| `manifest.json` | PWA. |
| `sw.js` | Service worker. |
| `icons/` | Iconos PWA. |

Opcional: `index.html` si redirige o es landing.

---

## 3. Checklist rápido “subo todo lo nuevo”

1. Subir **`kiosco.html`** y **`kiosco-app.js`** (y `kiosco-config.js` si cambió).
2. En Supabase, ejecutar al menos: **`supabase-ferriol-partner-provision-requests.sql`** y **`supabase-ferriol-payments.sql`** (si no los tenías al día).
3. Si faltaba flujo kiosco o días para socios: **`supabase-ferriol-kiosquero-provision-requests.sql`**, **`supabase-ferriol-mdr-partner-license-target.sql`**.

---

## 4. Otros documentos en el repo

- `PLAN-COMPENSACIONES-FERRIOL.md` — plan de negocio / compensaciones (no es SQL).
- `SUBIR-A-GITHUB.txt`, `kiosco-FUNCTIONS-INVENTORY.txt` — notas internas.
