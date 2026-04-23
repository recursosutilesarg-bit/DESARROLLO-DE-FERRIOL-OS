# Plan de compensaciones y modelo comercial · Ferriol OS

**Versión:** 1.2  
**Fecha de redacción:** abril 2026  
**Estado:** documento de negocio interno; la implementación en software y en contabilidad puede estar parcial o pendiente.

---

## 1. Propósito y alcance

Este documento define:

- Precios públicos orientativos de **licencia software (kiosquero)** y **kit / membresía (socio vendedor)**.
- Reparto **empresa vs vendedor ejecutor** en ventas de **kit** y **software al kiosco** (regla **20 % / 80 %**).
- Reparto de **regalías generacionales** sobre la **cuota mensual de mantenimiento del socio vendedor** (regla **30 % / 15 %** en dos niveles).
- Rol de la **red de referidos** (`sponsor_id`, códigos de invitación) y quién puede referir.

**No constituye asesoramiento legal, contable ni fiscal.** Debe revisarse con profesionales en Argentina antes de publicarlo a terceros o cobrar.

---

## 2. Roles en el sistema

| Rol | Descripción breve |
|-----|-------------------|
| **super** | Administración global (fundadores). Acceso total a directorio, ajustes y bloque de enlaces fundadores. |
| **partner** | Socio vendedor. Puede referir **otros vendedores** y **kioscos**; tiene código de referido y enlaces de invitación. Ve su red en el panel de negocios. |
| **kiosquero** | Negocio que usa Ferriol OS en el local. **No refiere** en el modelo actual: no tiene enlaces de referido en configuración ni se le genera código para invitar. |

La relación de patrocinio se guarda en base de datos como **`sponsor_id`** (UUID del perfil del referidor directo).

---

## 3. Precios (valores de referencia)

Montos en **pesos argentinos (ARS)** salvo que se indique lo contrario. Los precios pueden actualizarse por anexo o nueva versión de este documento.

### 3.1 Kiosquero — software

| Concepto | Monto | Periodicidad |
|----------|--------|----------------|
| Licencia / uso del sistema en el comercio | **$ 9.900** | **Mensual** |

### 3.2 Socio vendedor — kit y mantenimiento

| Concepto | Monto | Periodicidad |
|----------|--------|----------------|
| Kit de negocios (licencia de vendedor, panel de administración, formación, derecho a regalías de nivel 1 y 2 según plan) | **$ 60.000** | **Pago inicial** (una vez por alta como socio vendedor, salvo promociones) |
| Mantenimiento de panel y licencia de trabajo | **$ 20.000** | **Mensual** |

### 3.3 Medios de cobro (decisión operativa)

- **Todos los cobros** previstos en este plan (kit, cuota mensual kiosquero, mantenimiento del socio vendedor) se **cobran por transferencia bancaria** u otros medios **sin pasarela de pago** por ahora, para **no pagar comisiones** a terceros (MP, Stripe, etc.).
- La empresa publica **datos de cuenta** (CBU/alias, titular, concepto sugerido) y el **proceso** para el cliente o socio: envío de **comprobante** (WhatsApp, email o carga en la app cuando exista).
- Hasta automatizar: la **acreditación** y el **disparo de comisiones** en sistema serán **manuales o semi-manuales** (ej. un **super** marca “pago verificado” sobre un registro de cobro). Más adelante se puede sumar pasarela **sin cambiar** los porcentajes del plan.
- **Contrapartida:** más trabajo de **conciliación**, riesgo de demoras y errores si no hay checklist; conviene un **registro único por cobro** (monto, fecha, quién pagó, qué concepto, quién vendió).

---

## 4. Ventas de kit y de software al kiosco: regla 20 % / 80 %

Aplica a:

- **Venta del kit** de socio vendedor (**$ 60.000** iniciales).
- **Venta del software** al kiosquero (**$ 9.900** mensuales o el primer cobro que se defina como “venta cerrada por el vendedor”).

### 4.1 Reparto

Sobre el **monto cobrado al cliente** en esa operación (sin incluir en este apartado impuestos que correspondan facturar aparte):

| Destino | Porcentaje | Destinatario |
|---------|------------|--------------|
| **Empresa (Ferriol / casa)** | **20 %** | Tesorería de la empresa |
| **Canal de venta** | **80 %** | **Socio vendedor que llevó a cabo la venta** (cierra el negocio con el cliente) |

### 4.2 Ejemplos numéricos

**Kit $ 60.000**

| | Monto |
|---|--------|
| Empresa (20 %) | **$ 12.000** |
| Vendedor ejecutor (80 %) | **$ 48.000** |

**Software kiosquero $ 9.900 (un mes)**

| | Monto |
|---|--------|
| Empresa (20 %) | **$ 1.980** |
| Vendedor ejecutor (80 %) | **$ 7.920** |

### 4.3 Alcance

- Esta regla es **por transacción de venta** (kit o alta/cobro de software atribuible al vendedor).
- **No** sustituye ni se mezcla automáticamente con el reparto de la **cuota mensual de $ 20.000** del socio vendedor (ver sección 5): son **reglas distintas** sobre **hechos económicos distintos**.

---

## 5. Cuota mensual del socio vendedor ($ 20.000): regalías generacionales

### 5.1 Hecho generador

El socio vendedor **abona a la empresa** la **membresía / mantenimiento** de **$ 20.000** por mes (licencia y panel de trabajo).

Sobre ese pago mensual se calculan las **regalías en profundidad** (solo entre socios vendedores, según cadena de `sponsor_id`).

### 5.2 Porcentajes

Sobre el monto **$ 20.000** pagado en ese período por un socio vendedor dado:

| Nivel | Quién cobra | Porcentaje sobre los $ 20.000 |
|-------|-------------|-------------------------------|
| **Nivel 1** | Patrocinador **directo** del socio que paga | **30 %** |
| **Nivel 2** | Patrocinador del patrocinador (abuelo en la red) | **15 %** |

**Total máximo saliente por regalías sobre una misma cuota de $ 20.000:** 30 % + 15 % = **45 %** (= **$ 9.000**), quedando **55 %** (= **$ 11.000**) para la empresa **en ese esquema de reparto**, salvo que se defina otra reserva en anexo.

### 5.3 Fundador o socio sin patrocinador

- Quien **no tiene** `sponsor_id` (ej. fundador en la cima) **paga** sus **$ 20.000** si aplica la misma membresía; **no** genera regalía a upline inexistente.
- Los porcentajes anteriores **no** se redistribuyen automáticamente a otro nivel salvo regla escrita adicional.

### 5.4 Kiosquero

La cuota **$ 9.900** del kiosquero **no** está incluida en la tabla 30 % / 15 % de esta sección. Si en el futuro se desea comisión sobre el kiosco, debe agregarse **nueva sección** y **nuevos porcentajes** aprobados.

---

## 6. Resumen: qué regla aplica a qué cobro

| Cobro | Regla principal |
|-------|-----------------|
| Venta kit **$ 60.000** | **20 %** empresa · **80 %** vendedor que vende |
| Cobro software kiosco **$ 9.900** (venta/atribución al vendedor) | **20 %** empresa · **80 %** vendedor que vende |
| Mensual socio **$ 20.000** (mantenimiento) | **30 %** N1 · **15 %** N2 sobre el pago · resto según política empresa (p. ej. 55 %) |

---

## 7. Red de referidos e invitación

- Solo **partner** y **super** tienen **código de referido** y enlaces de invitación en la aplicación.
- **Kiosquero** no refiere en el producto actual.
- Enlaces típicos: `?ref=CÓDIGO&nicho=kiosco` (alta negocio) y `?ref=CÓDIGO&nicho=socio` (alta vendedor). El código es el mismo; cambia el tipo de alta.

---

## 8. Ejemplo de escenario (un mes)

**Árbol:**

- **A** (vos): referís a **B** (vendedor) y a **K1** (kiosquero).
- **B** referís a **C** (vendedor) y a **K2** (kiosquero).
- **C** referís solo a **K3** (kiosquero).

**Supuesto:** A, B y C son socios vendedores activos y cada uno paga **$ 20.000** de mantenimiento ese mes.

| Paga | Regalía N1 (30 %) | Regalía N2 (15 %) | Nota |
|------|-------------------|-------------------|------|
| A → empresa $ 20.000 | — | — | Sin upline |
| B → empresa $ 20.000 | A recibe **$ 6.000** | — | |
| C → empresa $ 20.000 | B recibe **$ 6.000** | A recibe **$ 3.000** | |

**Totales regalías ese mes (solo por estas tres cuotas):** A **$ 9.000**, B **$ 6.000**.

**Kioscos K1, K2, K3:** si cada uno paga **$ 9.900** y aplica solo 20/80 a quien vendió, cada cobro se reparte entre empresa y **vendedor ejecutor** de esa venta (sin tabla 30/15 sobre el kiosco en este documento).

---

## 9. Contabilidad, impuestos y cumplimiento

- Definir **quién factura** a quién (empresa ↔ socio ↔ kiosco).
- Definir **momento de imputación** de las regalías (accrual vs pago).
- Retenciones, monotributo, IVA, ingresos brutos y **normativa de oferta pública** o vínculos comerciales aplicable en Argentina: **revisión obligatoria** con asesor.
- Cualquier material público (web, PDF, WhatsApp) debe ser **coherente** con este plan y no prometer rentabilidad fija.

---

## 10. Implementación técnica (referencia)

- Red básica: `supabase-referral-network.sql` (`sponsor_id`, `referral_code`, función `resolve_referral_code`).
- Base MLM futura (ledger, plan en JSON, columnas extra en `profiles`): `supabase-mlm-foundation.sql`.
- En cliente: objeto **`FerriolMlm`** en `kiosco-app.js` (cadenas upline/downline, constantes de tablas y tipos de evento).
- La **aplicación** puede aún **no** liquidar automáticamente comisiones; este documento sirve como **fuente de verdad** para desarrollo y operaciones.
- **Cobro solo por transferencia:** el MVP suele ser tabla **`payment_intents`** / **`invoices`** (monto, tipo, `payer_user_id`, `seller_user_id`, período, estado `pending` → `verified`) y acción de **super** “confirmar pago”; al confirmar, RPC o función que inserte líneas en **`mlm_ledger`** según este plan.

---

## 11. Checklist: cambios para que el modelo funcione de punta a punta

Lista maestra de trabajo. Orden sugerido: **A → B → C → D** en paralelo con **E** (legal).

### A. Legal, fiscal y operación (previo o en paralelo al código)

- [ ] Definir **razón social** que factura y **titular de la cuenta bancaria** de cobro.
- [ ] Definir **qué se factura** (kit, licencia kiosco, membresía vendedor) y **a nombre de quién** va cada concepto.
- [ ] Definir **cuándo nace la obligación de pago** del socio (fecha de alta, día de mes de renovación).
- [ ] Redactar **instrucciones de pago** públicas (CBU/alias, conceptos obligatorios, a quién enviar comprobante).
- [ ] Definir **procedimiento de conciliación manual** (quién revisa el home banking, con qué frecuencia).
- [ ] Acordar **política de mora**: avisos, suspensión de panel, `active` en `profiles`, etc.
- [ ] Revisión con **asesor contable/legal** (Argentina) antes de escalar ventas.

### B. Base de datos (Supabase)

- [ ] Ejecutar (si aún no): `supabase-referral-network.sql` y `supabase-mlm-foundation.sql`.
- [ ] Crear tabla(s) de **cobros / órdenes**, por ejemplo `ferriol_payments` o `payment_records`, con campos mínimos:
  - `id`, `created_at`, `updated_at`
  - `payment_type`: `kit_inicial` | `kiosco_licencia` | `vendor_mantenimiento` (o equivalente)
  - `amount`, `currency` (default `ARS`)
  - `payer_user_id` (uuid → `profiles`)
  - `seller_user_id` (uuid, nullable si el pago es solo empresa; para 20/80 **obligatorio** en kit y kiosco)
  - `period_month` (date, primer día del mes; null en kit único)
  - `status`: `pending` | `verified` | `rejected`
  - `verified_at`, `verified_by` (uuid super)
  - `external_note` (número de operación, comentario)
  - `idempotency_key` (único; ej. `payer + type + period`) para no duplicar comisiones
- [ ] **Índices** por `payer_user_id`, `status`, `period_month`, `payment_type`.
- [ ] **RLS:** solo `super` insert/update en verificación; `partner`/`kiosquero` select propios pendientes si aplica; documentar políticas.
- [ ] Sembrar **`mlm_plan_config`** con clave única (ej. `compensation_v1`) y JSON: montos (`kit`, `kiosco_monthly`, `vendor_monthly`), `sale_split_company`, `sale_split_vendor`, `royalty_n1`, `royalty_n2`, etc., alineado a las secciones 4 y 5 de este documento.
- [ ] (Opcional) Columnas en `profiles`: `billing_day`, `last_maintenance_paid_month`, `kit_paid_at` para UX y reportes.

### C. Lógica de comisiones (servidor)

- [ ] Función **SECURITY DEFINER** o **Edge Function** invocada al pasar un pago a `verified`:
  - Leer reglas desde `mlm_plan_config`.
  - Si `payment_type` es **kit** o **kiosco_licencia**: repartir **20 % / 80 %** en líneas `mlm_ledger` (beneficiario empresa como usuario sistema **o** campo especial; si no hay “usuario empresa”, usar `metadata` + reporte solo contable).
  - Si `payment_type` es **vendor_mantenimiento**: repartir **30 % / 15 %** a uplines vía `sponsor_id`; resto contabilizado como empresa (según plan).
- [ ] **Idempotencia:** si ya existe `mlm_ledger` con mismo `idempotency_key`, no insertar de nuevo.
- [ ] Mapear `event_type` y `status` (`pending` en ledger hasta que definan pago físico a socios, o `approved` directo).
- [ ] (Definir) Cómo representar **“empresa”** en `mlm_ledger` si `beneficiary_user_id` es obligatorio FK a `profiles`: usuario interno `super` sistema, tabla aparte, o solo filas con `beneficiary` = null + política (requiere ajuste de esquema).

### D. Aplicación — panel **super**

- [ ] Pantalla o sección **“Cobros”**: listar `pending`, filtrar por tipo/fecha/pagador.
- [ ] Acción **Verificar pago** → actualiza fila + llama RPC de comisiones.
- [ ] Acción **Rechazar** con motivo.
- [ ] Vista **resumen / export** de `mlm_ledger` (CSV) para contador.
- [ ] Cargar en **Ajustes** (o `app_settings`) **datos bancarios** y texto de instrucciones para mostrar en cliente.

### E. Aplicación — panel **partner**

- [ ] Pantalla **“Mis cobros y comisiones”** o sección en Negocios: totales del mes, historial desde `mlm_ledger` donde `beneficiary_user_id` = yo.
- [ ] (Opcional) Ver **pendientes** de mis referidos si ayuda al seguimiento comercial (solo si RLS lo permite y lo quieren).
- [ ] Al dar de alta un **kiosco** o **socio** desde flujo comercial: capturar y guardar **`seller_user_id`** en el primer `payment_record` o en el perfil hasta el primer pago.

### F. Aplicación — **kiosquero**

- [ ] Sección **“Licencia / pago”**: monto según plan ($9.900), datos de transferencia, estado (al día / pendiente), enlace a soporte.
- [ ] Si está **vencido o pendiente**, coherente con la lógica actual de trial/`active` (definir reglas).

### G. Coherencia con registros existentes

- [ ] Revisar **modal “Agregar negocio”** y **registro público**: asegurar `sponsor_id` y, cuando exista tabla de pagos, crear `pending` del tipo correcto.
- [ ] Documentar en README interno: **orden** recomendado (crear usuario → crear `payment_record` pending → cliente transfiere → super verifica).

### H. Pruebas y calidad

- [ ] Casos de prueba: un pago kit, un pago kiosco, un pago mantenimiento con árbol de 2 niveles; doble clic en verificar no duplica ledger.
- [ ] Probar RLS con usuario `partner` y `kiosquero` (no ven datos ajenos).

### I. Fase posterior (cuando decidan)

- [ ] Pasarela de pago + webhook (misma RPC de comisiones).
- [ ] Notificaciones email/WhatsApp de vencimiento.
- [ ] Portal de **factura PDF** o integración contable.

---

## 12. Control de versiones

| Versión | Fecha | Cambios |
|---------|--------|---------|
| 1.0 | 2026-04 | Primera consolidación escrita (precios, 20/80, 30/15, roles, ejemplo). |
| 1.1 | 2026-04 | Medios de cobro: transferencia bancaria; sin pasarela por ahora; notas de conciliación y MVP manual. |
| 1.2 | 2026-04 | Checklist §11: todos los cambios para operar el modelo (DB, RPC, paneles, pruebas). |

---

*Fin del documento.*
