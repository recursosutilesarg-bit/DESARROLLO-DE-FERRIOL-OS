    // Iconos Lucide: no llamar createIcons() acá — si el CDN falla, el script entero dejaría de cargar y el login no funcionaría.

    // ——— Supabase: pegá tu Project URL y anon key acá ———
    // Si el panel Super no muestra usuarios: ejecutá supabase_rls_super_profiles.sql en SQL Editor.
    // Si ves 400 en products o caja: ejecutá supabase-fix-products-caja.sql en SQL Editor (columnas + índice único en caja).
    // Si usás "Transferir pendiente" o cobros de libreta: ALTER TABLE caja ADD COLUMN IF NOT EXISTS transferencia_pendiente numeric DEFAULT 0; ADD COLUMN IF NOT EXISTS cobro_libreta numeric DEFAULT 0;
    // Para historial de ventas y clientes, creá en Supabase (SQL Editor) estas tablas:
    // CREATE TABLE ventas ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, fecha_hora timestamptz NOT NULL DEFAULT now(), total numeric NOT NULL DEFAULT 0, metodo_pago text, cliente_nombre text, items jsonb DEFAULT '[]'::jsonb, created_at timestamptz DEFAULT now() );
    // ALTER TABLE ventas ENABLE ROW LEVEL SECURITY; CREATE POLICY "ventas_policy" ON ventas FOR ALL USING (auth.uid() = user_id);
    // CREATE TABLE clientes ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, nombre text, telefono text, email text, direccion text, notas text, created_at timestamptz DEFAULT now() );
    // ALTER TABLE clientes ENABLE ROW LEVEL SECURITY; CREATE POLICY "clientes_policy" ON clientes FOR ALL USING (auth.uid() = user_id);
    // Fiados y cuentas corrientes: Caja → Libreta (libreta_clientes / libreta_items en Supabase).
    // Tabla legacy saldos_acobrar: ya no la usa la app; podés ignorarla o borrarla en Supabase si no la necesitás.
    // Notificaciones del admin a los kiosqueros:
    // CREATE TABLE notifications ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), message text NOT NULL );
    // ALTER TABLE notifications ENABLE ROW LEVEL SECURITY; CREATE POLICY "notifications_select" ON notifications FOR SELECT TO authenticated USING (true); CREATE POLICY "notifications_insert" ON notifications FOR INSERT TO authenticated WITH CHECK (true);
    // Recordatorios de fin de prueba (mensajes por día + ventana): guardá en app_settings una fila key = 'trial_reminder_config', value = JSON, ej. {"windowDays":5,"messages":{"5":"...","4":"..."}}. Placeholders en textos: {dias}, {dias_restantes}, {nombre}, {negocio}.
    // Red de referidos: solo role 'partner' o 'super' tienen código y enlaces (kiosquero no refiere). SQL: supabase-referral-network.sql, supabase-mlm-foundation.sql, supabase-ferriol-payments.sql (cobros + RPC ferriol_verify_payment). Objeto FerriolMlm en este archivo.
    // Enlaces: ?ref=CÓDIGO&nicho=kiosco (alta negocio) | ?ref=CÓDIGO&nicho=socio (membresía vendedor). Aliases: nicho=vendedor|red|membresia, membresia=1, tipo=...
    // Historial de cierres de caja (facturación y ganancia por día):
    // CREATE TABLE cierres_caja ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), user_id uuid REFERENCES auth.users(id) ON DELETE CASCADE, fecha date NOT NULL, fecha_cierre timestamptz NOT NULL DEFAULT now(), total_facturado numeric NOT NULL DEFAULT 0, ganancia numeric NOT NULL DEFAULT 0, created_at timestamptz DEFAULT now() );
    // ALTER TABLE cierres_caja ENABLE ROW LEVEL SECURITY; CREATE POLICY "cierres_caja_policy" ON cierres_caja FOR ALL USING (auth.uid() = user_id);
    // Para que el admin pueda EXPORTAR e IMPORTAR copia de todos los usuarios, agregá estas políticas (super puede leer, insertar y borrar):
    // SELECT (exportar):
    //   CREATE POLICY "super_select_products" ON products FOR SELECT USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    //   CREATE POLICY "super_select_clientes" ON clientes FOR SELECT USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    // INSERT y DELETE (importar/restaurar):
    //   CREATE POLICY "super_all_products" ON products FOR ALL USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    //   CREATE POLICY "super_all_clientes" ON clientes FOR ALL USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'super');
    // (Si ya tenés "super_select_*", podés agregar solo las de ALL para no duplicar.)
    var _cfg = window.FERRIOL_CONFIG || {};
    const SUPABASE_URL = _cfg.SUPABASE_URL || '';
    const SUPABASE_ANON_KEY = _cfg.SUPABASE_ANON_KEY || '';
    const APP_URL = _cfg.APP_URL || '';
    const supabaseClient = (SUPABASE_URL && SUPABASE_ANON_KEY && window.supabase && typeof window.supabase.createClient === 'function')
      ? window.supabase.createClient(SUPABASE_URL, SUPABASE_ANON_KEY)
      : null;

    (function ferriolCaptureReferralFromUrl() {
      try {
        var p = new URLSearchParams(window.location.search);
        var r = p.get('ref') || p.get('referral') || p.get('codigo');
        if (r && String(r).trim()) {
          var c = String(r).trim().toUpperCase().replace(/[^A-Za-z0-9]/g, '').slice(0, 32);
          if (c) sessionStorage.setItem('ferriol_signup_ref', c);
        }
        var nRaw = (p.get('nicho') || p.get('tipo') || '').toLowerCase().trim();
        if (nRaw === 'socio' || nRaw === 'vendedor' || nRaw === 'red' || nRaw === 'membresia' || p.get('membresia') === '1') {
          sessionStorage.setItem('ferriol_signup_nicho', 'socio');
        } else if (nRaw === 'kiosco' || nRaw === 'negocio' || nRaw === 'tienda' || nRaw === 'almacen') {
          sessionStorage.setItem('ferriol_signup_nicho', 'kiosco');
        } else if (r && String(r).trim() && !sessionStorage.getItem('ferriol_signup_nicho')) {
          sessionStorage.setItem('ferriol_signup_nicho', 'kiosco');
        }
      } catch (_) {}
    })();

    function ferriolPublicSignupBaseUrl() {
      try {
        if (typeof APP_URL !== 'undefined' && APP_URL && String(APP_URL).indexOf('TU-USUARIO') === -1) {
          return String(APP_URL).replace(/\/?$/, '/');
        }
      } catch (_) {}
      try {
        if (typeof window !== 'undefined' && window.location && window.location.href) {
          return window.location.href.split('#')[0].replace(/\?.*$/, '');
        }
      } catch (_) {}
      return '';
    }
    function ferriolReferralInviteUrl(code, nicho) {
      var base = ferriolPublicSignupBaseUrl() || '';
      if (!base) base = (typeof window !== 'undefined' && window.location) ? (window.location.origin + '/') : '';
      var sep = base.indexOf('?') >= 0 ? '&' : '?';
      return base + sep + 'ref=' + encodeURIComponent(code || '') + '&nicho=' + (nicho === 'socio' ? 'socio' : 'kiosco');
    }
    function getSignupNichoFromStorage() {
      try {
        return sessionStorage.getItem('ferriol_signup_nicho') === 'socio' ? 'socio' : 'kiosco';
      } catch (_) { return 'kiosco'; }
    }
    function getSelectedSignupNicho() {
      var rS = document.querySelector('input[name="signUpNicho"][value="socio"]');
      var rK = document.querySelector('input[name="signUpNicho"][value="kiosco"]');
      if (rS && rS.checked) return 'socio';
      if (rK && rK.checked) return 'kiosco';
      return getSignupNichoFromStorage();
    }
    function syncSignUpNichoUI() {
      var n = getSelectedSignupNicho();
      try { sessionStorage.setItem('ferriol_signup_nicho', n === 'socio' ? 'socio' : 'kiosco'); } catch (_) {}
      var hint = document.getElementById('signUpTypeHint');
      var sub = document.getElementById('signUpLeadLine');
      var nameIn = document.getElementById('signUpKioscoName');
      if (hint) {
        hint.textContent = n === 'socio'
          ? 'Registro como vendedor/a de la red: membresía para comercializar Ferriol OS. Tu referidor queda registrado en tu perfil.'
          : 'Registro para usar Ferriol OS en tu kiosco, almacén o comercio de barrio.';
      }
      if (sub) sub.textContent = n === 'socio' ? 'Membresía red · vendedor del sistema' : 'Alta de negocio · uso del sistema';
      if (nameIn) nameIn.placeholder = n === 'socio' ? 'Nombre o equipo comercial (visible en la red)' : 'Nombre del negocio';
    }
    function copyTextToClipboard(text, doneMsg) {
      var t = text || '';
      if (!t) return;
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(function () { alert(doneMsg || 'Copiado.'); }).catch(function () { window.prompt('Copiá:', t); });
      } else window.prompt('Copiá:', t);
    }

    function isNetworkAdminRole(role) {
      return role === 'super' || role === 'partner';
    }
    function normalizeReferralCode(s) {
      if (s == null || s === '') return '';
      return String(s).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
    }
    async function resolveReferralCodeToSponsorId(code) {
      if (!supabaseClient || !code) return null;
      var c = normalizeReferralCode(code);
      if (!c) return null;
      try {
        var r = await supabaseClient.rpc('resolve_referral_code', { p_code: c });
        if (r.error) return null;
        return r.data || null;
      } catch (_) { return null; }
    }
    async function resolveSponsorForSignup() {
      var inputEl = document.getElementById('signUpReferralCode');
      var fromInput = inputEl ? normalizeReferralCode(inputEl.value) : '';
      var fromStore = '';
      try { fromStore = normalizeReferralCode(sessionStorage.getItem('ferriol_signup_ref') || ''); } catch (_) {}
      var code = fromInput || fromStore;
      if (!code) return { sponsorId: null, error: null };
      var sponsorId = await resolveReferralCodeToSponsorId(code);
      if (sponsorId) return { sponsorId: sponsorId, error: null };
      if (fromInput) return { sponsorId: null, error: 'El código de referido no es válido. Revisalo o dejalo vacío.' };
      try { sessionStorage.removeItem('ferriol_signup_ref'); } catch (_) {}
      return { sponsorId: null, error: null };
    }
    function randomReferralCodeSegment(len) {
      var chars = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
      var s = '';
      for (var i = 0; i < len; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
      return s;
    }
    async function ensureUserReferralCode(userId) {
      if (!supabaseClient || !userId) return null;
      try {
        var r = await supabaseClient.from('profiles').select('referral_code').eq('id', userId).maybeSingle();
        if (r.data && r.data.referral_code) return r.data.referral_code;
        for (var attempt = 0; attempt < 16; attempt++) {
          var code = randomReferralCodeSegment(8);
          var up = await supabaseClient.from('profiles').update({ referral_code: code }).eq('id', userId).is('referral_code', null);
          if (up.error && String(up.error.message || '').toLowerCase().indexOf('unique') !== -1) continue;
          var chk = await supabaseClient.from('profiles').select('referral_code').eq('id', userId).maybeSingle();
          if (chk.data && chk.data.referral_code) return chk.data.referral_code;
        }
      } catch (_) {}
      return null;
    }
    async function getSponsorIdForNewKiosqueroProfile() {
      var fromStore = '';
      try { fromStore = normalizeReferralCode(sessionStorage.getItem('ferriol_signup_ref') || ''); } catch (_) {}
      if (!fromStore) return null;
      var sponsorId = await resolveReferralCodeToSponsorId(fromStore);
      if (!sponsorId) { try { sessionStorage.removeItem('ferriol_signup_ref'); } catch (_) {} }
      return sponsorId;
    }
    function getPartnerDownlineUserIdSet(allProfiles, partnerId) {
      var bySponsor = {};
      allProfiles.forEach(function (p) {
        if (!p.sponsor_id) return;
        if (!bySponsor[p.sponsor_id]) bySponsor[p.sponsor_id] = [];
        bySponsor[p.sponsor_id].push(p.id);
      });
      var seen = new Set();
      var queue = [partnerId];
      while (queue.length) {
        var id = queue.shift();
        var kids = bySponsor[id] || [];
        kids.forEach(function (kid) {
          if (!seen.has(kid)) { seen.add(kid); queue.push(kid); }
        });
      }
      return seen;
    }

    /** Estructura MLM en cliente: utilidades y nombres de tablas para motor de comisiones futuro (sin escritura aún). */
    var FerriolMlm = (function () {
      var TABLE_LEDGER = 'mlm_ledger';
      var TABLE_PLAN = 'mlm_plan_config';
      var EVENT = {
        membership_sale: 'membership_sale',
        renewal: 'renewal',
        subscription: 'subscription',
        manual_adjustment: 'manual_adjustment'
      };
      var LEDGER_STATUS = {
        pending: 'pending',
        approved: 'approved',
        paid: 'paid',
        void: 'void'
      };
      function uplineUserIds(allProfiles, userId, maxDepth) {
        var cap = maxDepth == null ? 64 : Math.max(0, maxDepth);
        var byId = {};
        (allProfiles || []).forEach(function (p) { if (p && p.id) byId[p.id] = p; });
        var out = [];
        var cur = byId[userId];
        var n = 0;
        while (cur && cur.sponsor_id && n < cap) {
          var sp = byId[cur.sponsor_id];
          if (!sp) break;
          out.push(sp.id);
          cur = sp;
          n++;
        }
        return out;
      }
      function directReferralUserIds(allProfiles, sponsorId) {
        if (!sponsorId) return [];
        return (allProfiles || []).filter(function (p) { return p && p.sponsor_id === sponsorId; }).map(function (p) { return p.id; });
      }
      return {
        TABLE_LEDGER: TABLE_LEDGER,
        TABLE_PLAN: TABLE_PLAN,
        EVENT: EVENT,
        LEDGER_STATUS: LEDGER_STATUS,
        uplineUserIds: uplineUserIds,
        directReferralUserIds: directReferralUserIds,
        downlineTreeIds: getPartnerDownlineUserIdSet
      };
    })();
    try { if (typeof window !== 'undefined') window.FerriolMlm = FerriolMlm; } catch (_) {}

    /** Montos orientativos (alineados a mlm_plan_config compensation_v1 y PLAN-COMPENSACIONES-FERRIOL.md) */
    var FERRIOL_PLAN_AMOUNTS = { kit: 60000, kioscoMonthly: 9900, vendorMonthly: 20000 };

    async function getTrialDurationDays() {
      if (!supabaseClient) return 15;
      try {
        var r = await supabaseClient.from('app_settings').select('value').eq('key', 'trial_duration_days').maybeSingle();
        var n = parseInt(r.data && r.data.value, 10);
        if (!isNaN(n) && n >= 1 && n <= 365) return n;
      } catch (_) {}
      return 15;
    }

    function ferriolMonthInputToPeriodDate(monthStr) {
      if (!monthStr || String(monthStr).length < 7) return null;
      var p = String(monthStr).slice(0, 7).split('-');
      if (p.length !== 2) return null;
      return p[0] + '-' + p[1] + '-01';
    }
    async function ferriolResolveProfileIdByEmail(email) {
      if (!supabaseClient) return null;
      var e = String(email || '').trim().toLowerCase();
      if (!e) return null;
      var r = await supabaseClient.from('profiles').select('id').eq('email', e).maybeSingle();
      if (r.data && r.data.id) return r.data.id;
      var r2 = await supabaseClient.from('profiles').select('id').ilike('email', e).limit(1);
      if (!r2.error && r2.data && r2.data.length && r2.data[0].id) return r2.data[0].id;
      return null;
    }
    function ferriolSyncNewPaymentFormDefaults() {
      var sel = document.getElementById('ferriolNewPayType');
      var amt = document.getElementById('ferriolNewPayAmount');
      var wrap = document.getElementById('ferriolNewPayPeriodWrap');
      var perIn = document.getElementById('ferriolNewPayPeriod');
      if (!sel || !amt) return;
      var t = sel.value;
      if (t === 'kit_inicial') amt.value = String(FERRIOL_PLAN_AMOUNTS.kit);
      else if (t === 'kiosco_licencia') amt.value = String(FERRIOL_PLAN_AMOUNTS.kioscoMonthly);
      else amt.value = String(FERRIOL_PLAN_AMOUNTS.vendorMonthly);
      if (wrap) wrap.classList.toggle('hidden', t !== 'vendor_mantenimiento');
      if (perIn && t === 'vendor_mantenimiento' && !perIn.value) {
        var d = new Date();
        perIn.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
      }
    }
    function ferriolMlmLedgerRowLineLi(r) {
      return '<li class="border-b border-white/10 pb-1">' + String(r.created_at || '').slice(0, 10) + ' · $' + Number(r.amount).toLocaleString('es-AR', { minimumFractionDigits: 2 }) + ' · ' + String(r.event_type || '') + ' · ' + String(r.status || '') + '</li>';
    }
    function ferriolPartnerLedgerLineLi(r) {
      var d = r.depth != null && r.depth !== '' ? ' · niv.' + r.depth : '';
      var pm = r.period_month ? ' · ' + String(r.period_month).slice(0, 7) : '';
      return '<li class="border-b border-white/10 pb-1">' + String(r.created_at || '').slice(0, 10) + pm + ' · $' + Number(r.amount).toLocaleString('es-AR', { minimumFractionDigits: 2 }) + ' · ' + String(r.event_type || '') + d + ' · ' + String(r.status || '') + '</li>';
    }
    function ferriolPartnerResumenHtml(rows, nKioscosActive) {
      var unit = FERRIOL_PLAN_AMOUNTS.kioscoMonthly;
      var orientMes = (nKioscosActive || 0) * unit;
      var pendPay = rows.filter(function (r) { return r.event_type === 'vendor_payable_company' && r.status === 'pending'; });
      var pendComm = rows.filter(function (r) { return r.event_type === 'sale_commission' && r.status === 'pending'; });
      var ren1 = rows.filter(function (r) { return r.event_type === 'renewal' && r.status === 'pending' && Number(r.depth) === 1; });
      var ren2 = rows.filter(function (r) { return r.event_type === 'renewal' && r.status === 'pending' && Number(r.depth) === 2; });
      var sumPay = pendPay.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
      var sumComm = pendComm.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
      var s1 = ren1.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
      var s2 = ren2.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
      var head = '<p class="font-semibold text-emerald-200/95 mb-2 flex items-center gap-2"><i data-lucide="layout-list" class="w-4 h-4"></i> Resumen Ferriol · socio vendedor</p>' +
        '<p class="text-[11px] text-white/50 mb-3">Licencias con tus negocios (cobro como referidor), obligaciones y regalías según el <strong class="text-white/65">libro</strong> (cuando el admin liquida transferencias o corre el mes).</p>';
      var secK =
        '<div class="text-xs space-y-1.5 mb-3 rounded-lg border border-[#22c55e]/35 bg-[#22c55e]/08 px-2 py-2">' +
        '<p class="text-[#86efac] font-medium flex items-center gap-1"><i data-lucide="store" class="w-3.5 h-3.5"></i> Licencias con tus kioscos (operativo)</p>' +
        '<p class="text-white/80">Negocios activos referidos: <strong>' + (nKioscosActive || 0) + '</strong>. Cuota orientativa de licencia ($ ' + unit.toLocaleString('es-AR') + ' c/u): <strong>$ ' + orientMes.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + '</strong> ARS/mes a coordinar con ellos (vos cobrás como referidor; no reemplaza el libro).</p></div>';
      var secPay =
        '<div class="text-xs space-y-1.5 mb-3 rounded-lg border border-amber-500/35 bg-amber-500/10 px-2 py-2">' +
        '<p class="text-amber-100/95 font-medium">A pagar a la empresa (libro · 20% licencia kiosco u obligaciones similares)</p>' +
        '<p class="text-white/80">Total pendiente: <strong>$ ' + sumPay.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + '</strong> ARS</p>' +
        (pendPay.length === 0 ? '<p class="text-white/45">Sin partidas pendientes en esta categoría.</p>' : '<ul class="space-y-1 max-h-24 overflow-y-auto">' + pendPay.map(ferriolPartnerLedgerLineLi).join('') + '</ul>') +
        '</div>';
      var secComm =
        '<div class="text-xs space-y-1.5 mb-3 rounded-lg border border-emerald-500/35 bg-emerald-500/10 px-2 py-2">' +
        '<p class="text-emerald-100/95 font-medium">Tu parte en el libro (ej. 80% licencia · pendiente de liquidación)</p>' +
        '<p class="text-white/80">Total pendiente: <strong>$ ' + sumComm.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + '</strong> ARS</p>' +
        (pendComm.length === 0 ? '<p class="text-white/45">Nada pendiente; cuando el admin verifique cobros verás movimientos.</p>' : '<ul class="space-y-1 max-h-24 overflow-y-auto">' + pendComm.map(ferriolPartnerLedgerLineLi).join('') + '</ul>') +
        '</div>';
      var secRoy =
        '<div class="text-xs space-y-1.5 mb-3 rounded-lg border border-violet-500/30 bg-violet-500/10 px-2 py-2">' +
        '<p class="text-violet-100/95 font-medium">Regalías · cuotas de socios (libro · pendiente)</p>' +
        '<p class="text-white/75">Nivel 1 (línea directa): <strong>$ ' + s1.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + '</strong> · Nivel 2: <strong>$ ' + s2.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + '</strong> ARS</p>' +
        ((ren1.length + ren2.length) === 0 ? '<p class="text-white/45">Sin regalías pendientes registradas.</p>' : '<ul class="space-y-1 max-h-28 overflow-y-auto">' + ren1.concat(ren2).map(ferriolPartnerLedgerLineLi).join('') + '</ul>') +
        '</div>';
      var tail = '<p class="text-[10px] text-white/45 mb-1">Últimos movimientos en tu cuenta (libro)</p>' +
        (rows.length === 0 ? '<p class="text-xs text-white/50">Sin movimientos.</p>' :
          '<ul class="text-xs space-y-1 max-h-36 overflow-y-auto">' + rows.slice(0, 18).map(ferriolPartnerLedgerLineLi).join('') + '</ul>');
      return head + secK + secPay + secComm + secRoy + tail;
    }
    async function loadPartnerCommissionsCard() {
      var el = document.getElementById('superPartnerCommissionsCard');
      if (!el) return;
      if (!supabaseClient || !currentUser || !isPartnerLens()) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      try {
        var res = await supabaseClient.from('mlm_ledger').select('created_at, amount, event_type, status, depth, period_month').eq('beneficiary_user_id', currentUser.id).order('created_at', { ascending: false }).limit(80);
        if (res.error) throw res.error;
        var nk = 0;
        try {
          var pr = await supabaseClient.from('profiles').select('id').eq('sponsor_id', currentUser.id).eq('role', 'kiosquero').eq('active', true);
          if (!pr.error && pr.data) nk = pr.data.length;
        } catch (_) {}
        var rows = res.data || [];
        el.classList.remove('hidden');
        el.innerHTML = ferriolPartnerResumenHtml(rows, nk);
      } catch (e) {
        el.classList.remove('hidden');
        el.innerHTML = '<p class="text-xs text-amber-200">No se pudo cargar el resumen Ferriol. Ejecutá los SQL de compensaciones o revisá RLS.</p>';
      }
      lucide.createIcons();
    }
    async function loadSuperMainFerriolResumenCard() {
      var el = document.getElementById('superMainFerriolResumenCard');
      if (!el) return;
      if (!supabaseClient || !currentUser || !isEmpresaLensSuper()) {
        el.classList.add('hidden');
        el.innerHTML = '';
        return;
      }
      el.classList.remove('hidden');
      el.innerHTML = '<p class="text-xs text-white/50">Cargando resumen Ferriol…</p>';
      try {
        var lr = await supabaseClient.from('mlm_ledger').select('amount').is('beneficiary_user_id', null).eq('status', 'pending').eq('event_type', 'company_reserve');
        var sumCo = 0;
        var nCo = 0;
        if (!lr.error && lr.data) {
          nCo = lr.data.length;
          sumCo = lr.data.reduce(function (a, x) { return a + Number(x.amount || 0); }, 0);
        }
        var pendLed = await supabaseClient.from('mlm_ledger').select('amount, event_type, beneficiary_user_id').eq('status', 'pending');
        var sumSoc = 0;
        var nSoc = 0;
        if (!pendLed.error && pendLed.data) {
          var partnerEv = { sale_commission: true, vendor_payable_company: true, renewal: true };
          var toSoc = pendLed.data.filter(function (r) { return r.beneficiary_user_id && partnerEv[r.event_type]; });
          nSoc = toSoc.length;
          sumSoc = toSoc.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
        }
        var nK = 0;
        var nP = 0;
        try {
          var cK = await supabaseClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'kiosquero');
          if (!cK.error && cK.count != null) nK = cK.count;
          var cP = await supabaseClient.from('profiles').select('id', { count: 'exact', head: true }).eq('role', 'partner');
          if (!cP.error && cP.count != null) nP = cP.count;
        } catch (_) {}
        el.innerHTML =
          '<p class="font-semibold text-cyan-100 mb-2 flex items-center gap-2"><i data-lucide="pie-chart" class="w-4 h-4"></i> Resumen Ferriol · administrador</p>' +
          '<div class="grid grid-cols-1 sm:grid-cols-2 gap-2 text-xs">' +
          '<div class="rounded-lg border border-cyan-400/25 bg-black/20 px-2 py-2">' +
          '<p class="text-white/55">Empresa · pendiente de cobro (reserva libro)</p>' +
          '<p class="text-cyan-100 font-bold text-base">$ ' + sumCo.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + ' <span class="text-xs font-normal text-white/50">· ' + nCo + ' part.</span></p></div>' +
          '<div class="rounded-lg border border-amber-400/25 bg-black/20 px-2 py-2">' +
          '<p class="text-white/55">Red · pendiente de liquidar a socios</p>' +
          '<p class="text-amber-100 font-bold text-base">$ ' + sumSoc.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + ' <span class="text-xs font-normal text-white/50">· ' + nSoc + ' part.</span></p></div></div>' +
          '<p class="text-[11px] text-white/45 mt-2">Directorio: <strong class="text-white/65">' + nK + '</strong> kioscos · <strong class="text-white/65">' + nP + '</strong> socios vendedores. Detalle de transferencias, verificaciones y libro: pestaña <strong class="text-white/70">Cobros</strong>.</p>';
      } catch (e) {
        el.innerHTML = '<p class="text-xs text-amber-200">No se pudo cargar el resumen. ¿Ejecutaste los SQL de Ferriol?</p>';
      }
      lucide.createIcons();
    }
    function ferriolKioscoSponsorHintHtml() {
      if (!currentUser || !currentUser.sponsorId) {
        return 'No figura referidor en tu perfil. Si entraste por invitación, pedí que lo carguen en administración.';
      }
      return null;
    }
    async function ferriolFetchSponsorHintText() {
      var fallback = ferriolKioscoSponsorHintHtml();
      if (fallback !== null) return { html: fallback, ok: true };
      if (!supabaseClient) return { html: 'Configurá Supabase para ver datos del referidor.', ok: false };
      try {
        var sp = await supabaseClient.from('profiles').select('kiosco_name, email, role').eq('id', currentUser.sponsorId).maybeSingle();
        if (sp.error || !sp.data) return { html: 'Tenés referidor asignado. Si no sabés quién es, consultá con el administrador.', ok: true };
        var d = sp.data;
        var nm = (d.kiosco_name || '').trim() || (d.email ? String(d.email).split('@')[0] : '') || '—';
        var roleL = d.role === 'super' ? 'Administrador' : (d.role === 'partner' ? 'Socio vendedor' : 'Referidor');
        var em = d.email ? String(d.email).replace(/</g, '&lt;').replace(/&/g, '&amp;') : '';
        var nmEsc = String(nm).replace(/</g, '&lt;').replace(/&/g, '&amp;');
        var html = 'Pagás la licencia a: <strong class="text-[#86efac]/95">' + nmEsc + '</strong>' + (em ? ' · ' + em : '') + ' <span class="text-white/45">(' + roleL + ')</span>. Usá los datos de transferencia de abajo; si no coinciden, confirmá con esa persona o con el administrador.';
        return { html: html, ok: true };
      } catch (_) {
        return { html: 'Consultá con el administrador quién es tu referidor.', ok: false };
      }
    }
    async function loadKioscoLicensePaymentInfo() {
      var block = document.getElementById('kioscoLicensePaymentBlock');
      var pre = document.getElementById('kioscoTransferInfoText');
      var priceEl = document.getElementById('kioscoLicensePriceHint');
      var sponsorEl = document.getElementById('kioscoLicenseSponsorHint');
      var dash = document.getElementById('dashboardKioscoLicenseCard');
      if (!currentUser) return;
      var show = currentUser.role === 'kiosquero' || isSuperKioscoPreviewMode();
      if (block) block.style.display = show ? '' : 'none';
      if (dash) {
        if (!show) {
          dash.classList.add('hidden');
          dash.innerHTML = '';
        }
      }
      if (!show) return;
      var amt = FERRIOL_PLAN_AMOUNTS.kioscoMonthly;
      var amtStr = amt.toLocaleString('es-AR');
      if (priceEl) {
        priceEl.innerHTML = 'Cuota orientativa: <strong class="text-[#86efac]">$ ' + amtStr + ' ARS</strong> por mes. Confirmá monto y forma de pago con tu <strong class="text-white/85">referidor o administrador</strong>.';
      }
      var transferBody = 'El administrador debe cargar en Ajustes los datos de cuenta a los que transferís la licencia (referidor / administrador).';
      if (!supabaseClient) {
        transferBody = 'Configurá Supabase para ver datos de pago.';
      } else {
        try {
          var r = await supabaseClient.from('app_settings').select('value').eq('key', 'ferriol_transfer_info').maybeSingle();
          transferBody = (r.data && r.data.value) ? String(r.data.value) : transferBody;
        } catch (_) {
          transferBody = 'No se pudieron cargar los datos de transferencia.';
        }
      }
      if (pre) pre.textContent = transferBody;
      var spHint = await ferriolFetchSponsorHintText();
      if (sponsorEl) sponsorEl.innerHTML = spHint.html;
      if (dash) {
        dash.classList.remove('hidden');
        var spDash = spHint.html;
        dash.innerHTML =
          '<h3 class="font-semibold text-base mb-2 flex items-center gap-2 text-[#86efac]">' +
          '<i data-lucide="landmark" class="w-5 h-5 shrink-0"></i> Licencia mensual Ferriol OS</h3>' +
          '<p class="text-2xl sm:text-3xl font-bold text-white mb-1">$ ' + amtStr + '<span class="text-lg font-normal text-white/60"> ARS / mes</span></p>' +
          '<p class="text-xs text-white/65 mb-2">Cuota de <strong class="text-white/85">tu negocio</strong> por usar Ferriol OS. El pago lo hacés al <strong class="text-white/85">referidor o administrador</strong> (canal acordado); los datos concretos van abajo. Lo que ocurre después con empresa y comisiones lo gestiona la red, no tu pantalla de caja.</p>' +
          '<p class="text-xs text-white/70 mb-2">' + spDash + '</p>' +
          '<p class="text-[10px] text-white/45 mb-2">Datos para transferir (los define el administrador en Ajustes):</p>' +
          '<pre class="text-xs whitespace-pre-wrap text-white/90 glass rounded-lg p-3 border border-white/15 max-h-40 overflow-y-auto font-sans"></pre>' +
          '<p class="text-[10px] text-white/40 mt-2">¿Dudas? Escribí a quien te dio de alta o al administrador.</p>';
        var preInDash = dash.querySelector('pre');
        if (preInDash) preInDash.textContent = transferBody;
        try {
          if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
        } catch (_) {}
      }
    }
    async function renderSuperCobrosSection() {
      if (!supabaseClient || !isEmpresaLensSuper()) return;
      var pendingEl = document.getElementById('ferriolPaymentsPendingList');
      var verifiedEl = document.getElementById('ferriolPaymentsVerifiedList');
      if (!pendingEl || !verifiedEl) return;
      pendingEl.innerHTML = '<p class="text-white/50 text-xs">Cargando…</p>';
      verifiedEl.innerHTML = '';
      try {
        var recvEl = document.getElementById('ferriolCompanyReceivableText');
        var partPayEl = document.getElementById('ferriolPartnersPayableText');
        var prevEl = document.getElementById('ferriolLedgerPendingPreview');
        if (recvEl) {
          try {
            var lr = await supabaseClient.from('mlm_ledger').select('amount, metadata, idempotency_key').is('beneficiary_user_id', null).eq('status', 'pending').eq('event_type', 'company_reserve');
            if (!lr.error && lr.data && lr.data.length) {
              var sum20 = lr.data.reduce(function (a, x) { return a + Number(x.amount || 0); }, 0);
              recvEl.innerHTML = 'Total empresa <strong class="text-cyan-100">pendiente de cobro</strong> (20% kiosco, cuotas socios automáticas, etc.): <strong class="text-cyan-100">$ ' + sum20.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + '</strong> ARS · ' + lr.data.length + ' partida(s).';
            } else if (!lr.error) {
              recvEl.textContent = 'Sin partidas empresa pendientes. Verificá pagos en la lista de abajo o ejecutá “Generar cargos del mes” si corresponde.';
            } else {
              recvEl.textContent = 'No se pudo cargar el resumen. ¿Ejecutaste los SQL de Ferriol (payments + monthly-auto)?';
            }
          } catch (_) {
            recvEl.textContent = '—';
          }
        }
        var cache = window._ferriolAllProfilesCache || [];
        if (!cache.length) {
          var pr = await supabaseClient.from('profiles').select('id, email, kiosco_name').limit(800);
          if (!pr.error && pr.data) {
            window._ferriolAllProfilesCache = pr.data;
            cache = pr.data;
          }
        }
        var res = await supabaseClient.from('ferriol_payments').select('id, created_at, payment_type, amount, status, payer_user_id, seller_user_id, period_month, external_note').order('created_at', { ascending: false }).limit(80);
        if (res.error) throw res.error;
        var rows = res.data || [];
        var byId = {};
        cache.forEach(function (p) { if (p && p.id) byId[p.id] = p; });
        function emailOf(uid) {
          var p = byId[uid];
          return p ? (p.email || uid.slice(0, 8)) : String(uid || '').slice(0, 8);
        }
        try {
          var pendLed = await supabaseClient.from('mlm_ledger').select('created_at, amount, event_type, beneficiary_user_id, metadata, idempotency_key').eq('status', 'pending').order('created_at', { ascending: false }).limit(40);
          if (partPayEl) {
            if (!pendLed.error && pendLed.data) {
              var partnerEv = { sale_commission: true, vendor_payable_company: true, renewal: true };
              var toSoc = pendLed.data.filter(function (r) { return r.beneficiary_user_id && partnerEv[r.event_type]; });
              var sumSoc = toSoc.reduce(function (a, r) { return a + Number(r.amount || 0); }, 0);
              partPayEl.innerHTML = toSoc.length ? ('Socios · <strong class="text-amber-100">pendiente de liquidar</strong> en el libro (comisiones, aportes 20%, renovaciones): <strong class="text-amber-100">$ ' + sumSoc.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + '</strong> ARS · ' + toSoc.length + ' partida(s).') : 'Socios · sin partidas pendientes de liquidar en el libro (comisiones / aportes).';
            } else {
              partPayEl.textContent = 'Socios · no se pudo cargar el libro.';
            }
          }
          if (prevEl) {
            if (!pendLed.error && pendLed.data && pendLed.data.length) {
              prevEl.innerHTML = pendLed.data.map(function (r) {
                var meta = r.metadata && typeof r.metadata === 'object' ? r.metadata : {};
                var lbl = meta.label ? String(meta.label) : '';
                var ben = r.beneficiary_user_id ? emailOf(r.beneficiary_user_id) : 'Empresa (reserva)';
                var demo = meta.demo ? ' <span class="text-violet-300/90">[demo]</span>' : '';
                return '<div class="py-1.5 border-b border-white/10">' +
                  '<span class="text-white/55">' + String(r.created_at || '').slice(0, 16) + '</span> · <strong class="text-white/85">$' + Number(r.amount).toLocaleString('es-AR', { minimumFractionDigits: 2 }) + '</strong> · <span class="text-cyan-200/80">' + String(r.event_type || '') + '</span>' + demo + '<br/>' +
                  '<span class="text-white/45">Benef.: ' + ben.replace(/</g, '&lt;') + (lbl ? ' · ' + lbl.replace(/</g, '&lt;') : '') + '</span></div>';
              }).join('');
            } else if (!pendLed.error) {
              prevEl.innerHTML = '<p class="text-white/45">Sin movimientos pending. Usá «Insertar 3 movimientos demo» o generá cargos del mes.</p>';
            } else {
              prevEl.innerHTML = '<p class="text-red-300/90">Error al leer mlm_ledger.</p>';
            }
          }
        } catch (_) {
          if (partPayEl) partPayEl.textContent = '—';
          if (prevEl) prevEl.innerHTML = '';
        }
        var pend = rows.filter(function (r) { return r.status === 'pending'; });
        var ver = rows.filter(function (r) { return r.status === 'verified'; }).slice(0, 20);
        if (pend.length === 0) pendingEl.innerHTML = '<p class="text-white/50 text-xs">No hay cobros pendientes.</p>';
        else {
          pendingEl.innerHTML = pend.map(function (r) {
            return '<div class="glass rounded-lg p-3 border border-amber-500/30">' +
              '<p class="font-medium">' + r.payment_type + ' · $' + Number(r.amount).toLocaleString('es-AR') + '</p>' +
              '<p class="text-xs text-white/60">Paga: ' + emailOf(r.payer_user_id) + (r.seller_user_id ? ' · Vendedor: ' + emailOf(r.seller_user_id) : '') + (r.period_month ? ' · Mes: ' + String(r.period_month).slice(0, 7) : '') + '</p>' +
              (r.external_note ? '<p class="text-xs text-white/45">' + String(r.external_note).replace(/</g, '&lt;') + '</p>' : '') +
              '<button type="button" class="ferriol-verify-pay mt-2 btn-glow rounded-lg py-1.5 px-3 text-xs font-semibold touch-target" data-id="' + r.id + '">Verificar y liquidar</button></div>';
          }).join('');
          pendingEl.querySelectorAll('.ferriol-verify-pay').forEach(function (btn) {
            btn.onclick = async function () {
              var pid = btn.dataset.id;
              if (!confirm('¿Confirmás que la transferencia está acreditada? Se generarán comisiones en mlm_ledger.')) return;
              var rpc = await supabaseClient.rpc('ferriol_verify_payment', { p_payment_id: pid });
              if (rpc.error) { alert('Error: ' + (rpc.error.message || '')); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo verificar.'); return; }
              alert('Listo. Comisiones registradas.');
              renderSuperCobrosSection();
              lucide.createIcons();
            };
          });
        }
        verifiedEl.innerHTML = ver.length === 0 ? '<p class="text-white/45">—</p>' : ver.map(function (r) {
          return '<div class="border-b border-white/10 py-1">' + String(r.created_at || '').slice(0, 16) + ' · ' + r.payment_type + ' · $' + Number(r.amount).toLocaleString('es-AR') + ' · ' + emailOf(r.payer_user_id) + '</div>';
        }).join('');
      } catch (e) {
        pendingEl.innerHTML = '<p class="text-red-300 text-xs">Error o falta la tabla. Ejecutá supabase-ferriol-payments.sql. ' + (e.message || '') + '</p>';
      }
      lucide.createIcons();
    }

    const DEFAULT_WHATSAPP = 'Hola {cliente}, te recordamos que tenés un saldo de ${monto} en nuestro kiosco. ¡Gracias!';

    function escapeCSV(str) {
      if (str == null) return '';
      var s = String(str);
      if (/[;,"\r\n]/.test(s)) return '"' + s.replace(/"/g, '""') + '"';
      return s;
    }
    function stringToLatin1Bytes(str) {
      if (typeof str !== 'string') str = String(str);
      var map = { '\u00E1': 225, '\u00E9': 233, '\u00ED': 237, '\u00F3': 243, '\u00FA': 250, '\u00F1': 241, '\u00D1': 209, '\u00C1': 193, '\u00C9': 201, '\u00CD': 205, '\u00D3': 211, '\u00DA': 218, '\u00FC': 252, '\u00F6': 246 };
      var out = [], s = str.normalize('NFC');
      for (var i = 0; i < s.length; i++) {
        var c = s[i], code = c.charCodeAt(0);
        if (code <= 255) out.push(code);
        else if (map[c] !== undefined) out.push(map[c]);
        else out.push(0x3F);
      }
      return new Uint8Array(out);
    }
    function downloadCSV(filename, csvContent) {
      if (typeof csvContent !== 'string') csvContent = String(csvContent);
      var normalized = csvContent.normalize('NFC');
      var enc = stringToLatin1Bytes(normalized);
      var blob = new Blob([enc], { type: 'text/csv;charset=iso-8859-1' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = filename;
      a.click();
      URL.revokeObjectURL(a.href);
    }
    function exportProductosCSV() {
      var prods = getData().products || {};
      var header = 'Código;Nombre;Precio;Costo;Ganancia unitaria;Stock';
      var rows = Object.entries(prods).map(function (_ref) {
        var codigo = _ref[0];
        var p = _ref[1];
        var precio = Number(p.precio) || 0;
        var costo = Number(p.costo) || 0;
        var ganancia = precio - costo;
        return escapeCSV(codigo) + ';' + escapeCSV(p.nombre || '') + ';' + precio + ';' + costo + ';' + ganancia + ';' + (p.stock != null ? p.stock : '');
      });
      var csv = header + '\r\n' + rows.join('\r\n');
      downloadCSV('productos_precios_ganancias_' + new Date().toISOString().slice(0, 10) + '.csv', csv);
    }
    async function exportClientesCSV() {
      if (!supabaseClient || !currentUser?.id) {
        alert('Configurá Supabase para exportar clientes.');
        return;
      }
      var list = await loadClientes();
      var header = 'Nombre;Teléfono;Email;Dirección;Notas';
      var rows = (list || []).map(function (c) {
        return escapeCSV(c.nombre || '') + ';' + escapeCSV(c.telefono || '') + ';' + escapeCSV(c.email || '') + ';' + escapeCSV(c.direccion || '') + ';' + escapeCSV(c.notas || '');
      });
      var csv = header + '\r\n' + rows.join('\r\n');
      downloadCSV('clientes_' + new Date().toISOString().slice(0, 10) + '.csv', csv);
    }
    async function exportVentasCSV() {
      if (!supabaseClient || !currentUser?.id) {
        alert('Configurá Supabase para exportar el historial de ventas.');
        return;
      }
      var end = new Date();
      var start = new Date(end);
      start.setMonth(start.getMonth() - 2);
      start.setHours(0, 0, 0, 0);
      var rangeStart = start.toISOString();
      var rangeEnd = end.toISOString();
      var methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pendiente', cobro_libreta: 'Cobro libreta' };
      var _r = await supabaseClient.from('ventas').select('id, fecha_hora, total, metodo_pago, cliente_nombre, items').eq('user_id', currentUser.id).gte('fecha_hora', rangeStart).lte('fecha_hora', rangeEnd).order('fecha_hora', { ascending: false });
      var list = _r.data || [];
      if (_r.error) {
        alert('No se pudo cargar el historial. Revisá la tabla ventas en Supabase.');
        return;
      }
      var header = 'Fecha y hora;Cliente;Método de pago;Total;Productos';
      var rows = list.map(function (v) {
        var fecha = v.fecha_hora ? new Date(v.fecha_hora).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
        var productos = (v.items || []).map(function (i) { return (i.nombre || '') + ' x' + (i.cant || 0) + ' $' + ((i.precio || 0) * (i.cant || 0)); }).join(' | ');
        return escapeCSV(fecha) + ';' + escapeCSV(v.cliente_nombre || '') + ';' + escapeCSV(methodLabels[v.metodo_pago] || v.metodo_pago) + ';' + (v.total || 0) + ';' + escapeCSV(productos);
      });
      var csv = header + '\r\n' + rows.join('\r\n');
      downloadCSV('historial_ventas_' + new Date().toISOString().slice(0, 10) + '.csv', csv);
    }

    let currentUser = null;
    let _dataCache = { products: {}, ventas: { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 }, transacciones: 0, deudores: [], lastCierreDate: null };

    const STORAGE_KEY_PREFIX = 'ferriol_data_';
    const LAST_QUICK_PAYMENT_KEY = 'ferriol_last_quick_payment';
    function getStorageKey() { return currentUser?.id ? STORAGE_KEY_PREFIX + currentUser.id : null; }
    function loadFromLocalStorage() {
      const key = getStorageKey();
      if (!key) return null;
      try {
        const raw = localStorage.getItem(key);
        if (!raw) return null;
        const data = JSON.parse(raw);
        if (data && typeof data === 'object' && data.products) return data;
      } catch (e) { console.warn('Ferriol localStorage load:', e); }
      return null;
    }
    function saveToLocalStorage() {
      const key = getStorageKey();
      if (!key || !currentUser?.id) return;
      try {
        localStorage.setItem(key, JSON.stringify({
          products: _dataCache.products || {},
          ventas: _dataCache.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 },
          transacciones: _dataCache.transacciones || 0,
          deudores: _dataCache.deudores || [],
          lastCierreDate: _dataCache.lastCierreDate || null,
          transaccionesList: (typeof state !== 'undefined' && state.transaccionesList) ? state.transaccionesList : []
        }));
      } catch (e) { console.warn('Ferriol localStorage save:', e); }
    }

    async function loadDataFromSupabase() {
      const uid = currentUser?.id;
      if (!uid) return;
      if (supabaseClient) {
        try {
          var prevLocal = loadFromLocalStorage();
          const [prodsRes, cajaRes] = await Promise.all([
            supabaseClient.from('products').select('*').eq('user_id', uid),
            supabaseClient.from('caja').select('*').eq('user_id', uid).maybeSingle()
          ]);
          const products = {};
          (prodsRes.data || []).forEach(p => {
            products[p.codigo] = { nombre: p.nombre, codigo: p.codigo, precio: p.precio, stock: p.stock, stockInicial: p.stock_inicial || p.stock, costo: p.costo != null ? Number(p.costo) : 0 };
          });
          const caja = cajaRes.data;
          var productsFinal = products;
          if (Object.keys(productsFinal).length === 0 && prevLocal && prevLocal.products && Object.keys(prevLocal.products).length > 0) {
            productsFinal = prevLocal.products;
          }
          _dataCache = {
            products: productsFinal,
            ventas: caja ? { efectivo: Number(caja.efectivo), tarjeta: Number(caja.tarjeta), transferencia: Number(caja.transferencia), fiado: Number(caja.fiado), transferencia_pendiente: Number(caja.transferencia_pendiente || 0), cobro_libreta: Number(caja.cobro_libreta || 0) } : { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 },
            transacciones: caja ? (caja.transacciones || 0) : 0,
            deudores: _dataCache.deudores || [],
            lastCierreDate: (prevLocal && prevLocal.lastCierreDate) ? prevLocal.lastCierreDate : (_dataCache.lastCierreDate || null)
          };
          var _hoyStr = new Date().toISOString().slice(0, 10);
          if (prevLocal && prevLocal.lastCierreDate === _hoyStr && prevLocal.ventas && prevLocal.ventas.cobro_libreta) {
            _dataCache.ventas.cobro_libreta = Number(prevLocal.ventas.cobro_libreta) || 0;
          }
          restoreTodayFromLocalStorage();
          saveToLocalStorage();
          return;
        } catch (e) { console.warn('Supabase load failed, using localStorage:', e); }
      }
      var local = loadFromLocalStorage();
      if (local) {
        _dataCache.products = local.products || {};
        _dataCache.ventas = local.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 };
        if (_dataCache.ventas.cobro_libreta == null) _dataCache.ventas.cobro_libreta = 0;
        _dataCache.transacciones = local.transacciones || 0;
        _dataCache.deudores = local.deudores || [];
        _dataCache.lastCierreDate = local.lastCierreDate || null;
        var today = new Date().toISOString().slice(0, 10);
        if (local.transaccionesList && Array.isArray(local.transaccionesList) && local.lastCierreDate === today && state) state.transaccionesList = local.transaccionesList;
      } else {
        restoreTodayFromLocalStorage();
      }
    }

    function restoreTodayFromLocalStorage() {
      var local = loadFromLocalStorage();
      if (!local) return;
      var today = new Date().toISOString().slice(0, 10);
      if (local.lastCierreDate !== today) return;
      if (local.ventas && typeof local.ventas === 'object') _dataCache.ventas = local.ventas;
      if (local.transacciones !== undefined) _dataCache.transacciones = local.transacciones;
      if (state && local.transaccionesList && Array.isArray(local.transaccionesList)) state.transaccionesList = local.transaccionesList;
    }

    async function saveDataToSupabase(updates) {
      const uid = currentUser?.id;
      if (!uid) return;
      saveToLocalStorage();
      if (!supabaseClient) return;
      try {
        if (updates.products !== undefined) {
          var delP = await supabaseClient.from('products').delete().eq('user_id', uid);
          if (delP.error) console.warn('products (delete):', delP.error.message || delP.error, delP.error.details || '', delP.error.hint || '');
          const rows = Object.entries(updates.products)
            .map(function (ref) {
              var codigo = String(ref[0] || '').trim();
              var p = ref[1];
              if (!codigo) return null;
              return {
                user_id: uid,
                codigo: codigo.slice(0, 200),
                nombre: String((p && p.nombre) != null ? p.nombre : '').trim() || codigo.slice(0, 80),
                precio: Number(p.precio) || 0,
                stock: Math.max(0, parseInt(p.stock, 10) || 0),
                stock_inicial: Math.max(0, parseInt(p.stockInicial != null ? p.stockInicial : p.stock, 10) || 0),
                costo: (function () { var c = Number(p.costo); return Number.isFinite(c) ? c : 0; })()
              };
            })
            .filter(Boolean);
          if (rows.length) {
            var insP = await supabaseClient.from('products').insert(rows);
            if (insP.error) {
              console.warn('products (insert 400):', insP.error.message, insP.error.details || '', insP.error.hint || '', '— En Supabase ejecutá el archivo supabase-fix-products-caja.sql (columnas costo, stock_inicial) y revisá políticas RLS para DELETE/INSERT en products.');
            }
          }
        }
        if (updates.ventas !== undefined || updates.transacciones !== undefined) {
          const v = updates.ventas || _dataCache.ventas;
          const t = updates.transacciones !== undefined ? updates.transacciones : _dataCache.transacciones;
          var fiadoSum = 0, tpSum = 0;
          if (typeof state !== 'undefined' && state.transaccionesList && Array.isArray(state.transaccionesList)) {
            state.transaccionesList.forEach(function (tr) {
              var tot = Number(tr.total) || 0;
              if (tr.method === 'fiado') fiadoSum += tot;
              else if (tr.method === 'transferencia_pendiente') tpSum += tot;
            });
          }
          const cajaRow = {
            user_id: uid,
            efectivo: Number(v.efectivo) || 0,
            tarjeta: Number(v.tarjeta) || 0,
            transferencia: Number(v.transferencia) || 0,
            fiado: fiadoSum,
            transferencia_pendiente: tpSum,
            cobro_libreta: Number(v.cobro_libreta) || 0,
            transacciones: Number(t) || 0
          };
          var cajaEx = await supabaseClient.from('caja').select('user_id').eq('user_id', uid).maybeSingle();
          if (cajaEx.error && cajaEx.error.code !== 'PGRST116') console.warn('caja (lectura):', cajaEx.error.message || cajaEx.error);
          if (cajaEx.data) {
            var up = await supabaseClient.from('caja').update({
              efectivo: cajaRow.efectivo,
              tarjeta: cajaRow.tarjeta,
              transferencia: cajaRow.transferencia,
              fiado: cajaRow.fiado,
              transferencia_pendiente: cajaRow.transferencia_pendiente,
              cobro_libreta: cajaRow.cobro_libreta,
              transacciones: cajaRow.transacciones
            }).eq('user_id', uid);
            if (up.error) console.warn('caja (update):', up.error.message || up.error);
          } else {
            var ins = await supabaseClient.from('caja').insert(cajaRow);
            if (ins.error) console.warn('caja (insert):', ins.error.message || ins.error, '— Si falta columna: ALTER TABLE caja ADD COLUMN IF NOT EXISTS transferencia_pendiente numeric DEFAULT 0; ADD COLUMN IF NOT EXISTS cobro_libreta numeric DEFAULT 0;');
          }
        }
      } catch (e) { console.warn('Supabase save failed, data saved in this device (localStorage):', e); }
    }

    function getData() {
      if (!currentUser?.id) return { products: {}, ventas: { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 }, transacciones: 0, deudores: [], lastCierreDate: null };
      const d = _dataCache;
      d.ventas = d.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 };
      d.deudores = d.deudores || [];
      return d;
    }

    function checkMidnightReset() {
      var today = new Date().toISOString().slice(0, 10);
      var last = _dataCache.lastCierreDate;
      if (last && last !== today) {
        _dataCache.ventas = { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 };
        _dataCache.transacciones = 0;
        state.transaccionesList = [];
        _dataCache.lastCierreDate = today;
        setData({ ventas: _dataCache.ventas, transacciones: 0, lastCierreDate: today });
      } else if (!last) {
        _dataCache.lastCierreDate = today;
      }
    }
    function setData(updates) {
      if (!currentUser?.id) return;
      Object.assign(_dataCache, updates);
      if (updates.ventas) _dataCache.ventas = { ..._dataCache.ventas, ...updates.ventas };
      saveDataToSupabase(updates);
    }

    // Estado en memoria (cart + lista de transacciones del día hasta cierre de caja)
    const state = {
      cart: [],
      cobroRapidoItems: [],  // [{ nombre, precio, costo }] para una sola venta con varios productos
      transaccionesList: [],  // { id, method, client, items: [{ nombre, codigo, precio, cant }], total }
      currentPanel: 'dashboard',
      cajaTab: 'hub',
      _restoringFromHistory: false,
      _suppressCajaHistoryPush: false,
      historialFilter: 'hoy',
      superSection: 'negocios',  // negocios | ajustes | notificaciones | mas
      superUiMode: 'empresa'  // empresa | socio | negocio — solo si role === 'super'
    };

    function ferriolNormalizeSuperUiMode(raw) {
      if (raw === 'negocio') return 'negocio';
      if (raw === 'socio') return 'socio';
      return 'empresa';
    }
    function isSuperKioscoPreviewMode() {
      return !!(currentUser && currentUser.role === 'super' && state.superUiMode === 'negocio');
    }
    function isSuperSocioLens() {
      return !!(currentUser && currentUser.role === 'super' && state.superUiMode === 'socio');
    }
    function isPartnerLens() {
      return !!(currentUser && (currentUser.role === 'partner' || isSuperSocioLens()));
    }
    function isEmpresaLensSuper() {
      return !!(currentUser && currentUser.role === 'super' && state.superUiMode === 'empresa');
    }

    var FERRIOL_NOTIF_SOUND_KEY = 'ferriol_notif_sound_enabled';
    function ferriolNotifSoundEnabled() {
      try {
        return localStorage.getItem(FERRIOL_NOTIF_SOUND_KEY) !== '0';
      } catch (_) {
        return true;
      }
    }
    var _ferriolAudioCtx = null;
    function ferriolGetAudioContext() {
      if (_ferriolAudioCtx) return _ferriolAudioCtx;
      var AC = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!AC) return null;
      _ferriolAudioCtx = new AC();
      return _ferriolAudioCtx;
    }
    (function ferriolSetupNotifAudioUnlock() {
      var unlocked = false;
      function unlock() {
        if (unlocked) return;
        var ctx = ferriolGetAudioContext();
        if (ctx && ctx.state === 'suspended') ctx.resume().catch(function () {});
        unlocked = true;
        document.removeEventListener('pointerdown', unlock);
        document.removeEventListener('keydown', unlock);
      }
      document.addEventListener('pointerdown', unlock, { passive: true });
      document.addEventListener('keydown', unlock);
    })();
    function ferriolPlayNotificationChime() {
      if (!ferriolNotifSoundEnabled()) return;
      var ctx = ferriolGetAudioContext();
      if (!ctx) return;
      ctx.resume().catch(function () {});
      function tone(freq, start, dur, vol) {
        var osc = ctx.createOscillator();
        var g = ctx.createGain();
        osc.connect(g);
        g.connect(ctx.destination);
        osc.type = 'sine';
        osc.frequency.setValueAtTime(freq, start);
        g.gain.setValueAtTime(0.0001, start);
        g.gain.exponentialRampToValueAtTime(vol, start + 0.02);
        g.gain.exponentialRampToValueAtTime(0.0001, start + dur);
        osc.start(start);
        osc.stop(start + dur + 0.03);
      }
      var t = ctx.currentTime;
      tone(784, t, 0.11, 0.11);
      tone(1046.5, t + 0.09, 0.14, 0.09);
    }
    function ferriolKiosqueroNotifShell() {
      return !!(currentUser && (currentUser.role === 'kiosquero' || isSuperKioscoPreviewMode()));
    }
    function ferriolStartNotificationPolling() {
      if (window._ferriolNotifPollInterval) clearInterval(window._ferriolNotifPollInterval);
      window._ferriolNotifPollInterval = setInterval(function () {
        if (document.hidden || !supabaseClient) return;
        if (!ferriolKiosqueroNotifShell()) return;
        loadNotifications();
      }, 60000);
    }
    function ferriolStopNotificationPolling() {
      if (window._ferriolNotifPollInterval) {
        clearInterval(window._ferriolNotifPollInterval);
        window._ferriolNotifPollInterval = null;
      }
    }

    async function ferriolSetSuperLens(lens) {
      if (!currentUser || currentUser.role !== 'super') return;
      if (lens !== 'empresa' && lens !== 'socio' && lens !== 'negocio') return;
      if (lens === 'negocio') {
        await window._superIrModoNegocio();
        return;
      }
      ferriolStopNotificationPolling();
      try { sessionStorage.setItem('ferriol_super_ui', lens); } catch (_) {}
      state.superUiMode = lens;
      if (window._trialCountdownInterval) { clearInterval(window._trialCountdownInterval); window._trialCountdownInterval = null; }
      applyAppShell();
      state._restoringFromHistory = true;
      showPanel('super');
      state._restoringFromHistory = false;
      await renderSuper();
      lucide.createIcons();
    }

    function currentHistoryBase() {
      return {
        panel: state.currentPanel,
        cajaTab: state.currentPanel === 'caja' ? state.cajaTab : undefined
      };
    }

    function pushHistoryExtra(extra) {
      if (state._restoringFromHistory) return;
      history.pushState(Object.assign({}, currentHistoryBase(), extra || {}), '', location.href);
    }


    function roundToNearest100(x) {
      if (typeof x !== 'number' || isNaN(x)) return 0;
      return Math.round(x / 100) * 100;
    }
    const defaultProducts = {
      '123456': { nombre: 'Café Premium', precio: 850, stock: 50, codigo: '123456', stockInicial: 50, costo: 0 },
      '789012': { nombre: 'Alfajor Artesanal', precio: 450, stock: 3, codigo: '789012', stockInicial: 3, costo: 0 },
      '345678': { nombre: 'Agua Mineral', precio: 320, stock: 20, codigo: '345678', stockInicial: 20, costo: 0 }
    };

    async function initData() {
      await loadDataFromSupabase();
      checkMidnightReset();
      const d = getData();
      if (Object.keys(d.products).length === 0) {
        d.products = JSON.parse(JSON.stringify(defaultProducts));
        Object.values(d.products).forEach(p => { if (!p.stockInicial) p.stockInicial = p.stock; });
        setData(d);
      }
    }

    function getStockStatus(stock) {
      if (stock <= 0) return { label: 'Agotado', class: 'status-agotado' };
      if (stock <= 5) return { label: 'Crítico', class: 'status-critico' };
      return { label: 'Stock Alto', class: 'status-alto' };
    }

    // Beep tipo supermercado: tono agudo corto (escáner / producto agregado)
    function playBeep() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        const osc = ctx.createOscillator();
        const gain = ctx.createGain();
        osc.connect(gain);
        gain.connect(ctx.destination);
        osc.type = 'square';
        osc.frequency.setValueAtTime(1850, ctx.currentTime);
        osc.frequency.setValueAtTime(1950, ctx.currentTime + 0.04);
        gain.gain.setValueAtTime(0.18, ctx.currentTime);
        gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.12);
        osc.start(ctx.currentTime);
        osc.stop(ctx.currentTime + 0.12);
        osc.onended = function () { ctx.close(); };
      } catch (_) {}
    }

    // Beep de cobro exitoso: doble tono ascendente (como caja registradora)
    function playBeepCobro() {
      try {
        const ctx = new (window.AudioContext || window.webkitAudioContext)();
        function tone(freq, start, duration) {
          const osc = ctx.createOscillator();
          const gain = ctx.createGain();
          osc.connect(gain);
          gain.connect(ctx.destination);
          osc.type = 'sine';
          osc.frequency.value = freq;
          gain.gain.setValueAtTime(0.22, ctx.currentTime + start);
          gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + start + duration);
          osc.start(ctx.currentTime + start);
          osc.stop(ctx.currentTime + start + duration);
        }
        tone(880, 0, 0.12);
        tone(1320, 0.13, 0.18);
        setTimeout(function () { ctx.close(); }, 500);
      } catch (_) {}
    }

    function renderInventory() {
      const list = document.getElementById('inventoryList');
      const search = document.getElementById('searchInventory')?.value?.toLowerCase() || '';
      const data = getData();
      const items = Object.values(data.products || {}).filter(p => 
        p.nombre.toLowerCase().includes(search) || (p.codigo || '').includes(search)
      );
      list.innerHTML = items.map(p => {
        const quedan = Math.max(0, Number(p.stock) || 0);
        const stockColor = quedan === 0 ? 'text-red-400' : quedan <= 3 ? 'text-amber-400' : 'text-white/40';
        return `
          <div class="inventory-item" data-codigo="${p.codigo}" role="button" tabindex="0">
            <div class="inv-item-info">
              <span class="inv-item-name">${(p.nombre || '').replace(/</g, '&lt;')}</span>
              <span class="inv-item-price">$${(p.precio ?? 0).toLocaleString('es-AR')}</span>
              <span class="inv-item-stock ${stockColor}">${quedan}</span>
            </div>
            <button type="button" class="add-to-cart-btn inv-item-btn" data-codigo="${p.codigo}" title="Agregar al carrito">
              <i data-lucide="plus" class="w-4 h-4"></i>
            </button>
          </div>
        `;
      }).join('');
      lucide.createIcons();
      list.querySelectorAll('.inventory-item').forEach(el => {
        el.addEventListener('click', function (e) {
          if (e.target.closest('.add-to-cart-btn')) return;
          showProductDetail(el.dataset.codigo);
        });
      });
      list.querySelectorAll('.add-to-cart-btn').forEach(btn => {
        btn.onclick = (e) => { e.stopPropagation(); addToCart(btn.dataset.codigo); };
      });
    }

    function showProductDetail(codigo) {
      const d = getData();
      const p = (d.products || {})[codigo];
      if (!p) return;
      document.getElementById('productDetailName').textContent = p.nombre || '';
      document.getElementById('productDetailPrice').textContent = '$' + (p.precio ?? 0).toLocaleString('es-AR');
      document.getElementById('productDetailCost').textContent = p.costo != null ? '$' + Number(p.costo).toLocaleString('es-AR') : 'No cargado';
      const margin = (p.costo && p.precio && p.costo > 0) ? Math.round(((p.precio - p.costo) / p.costo) * 100) : null;
      document.getElementById('productDetailMargin').textContent = margin !== null ? margin + '%' : 'No calculado';
      document.getElementById('productDetailStock').textContent = (Math.max(0, Number(p.stock) || 0)) + ' unidades';
      document.getElementById('productDetailCode').textContent = p.codigo || 'Sin código';
      document.getElementById('productDetailEdit').onclick = function() {
        closeProductDetail();
        openEditProduct(codigo);
      };
      document.getElementById('productDetailDelete').onclick = function() {
        if (confirm('¿Eliminar "' + (p.nombre || 'este producto') + '"?')) {
          deleteProduct(codigo);
          closeProductDetail();
        }
      };
      document.getElementById('productDetailBack').onclick = closeProductDetail;
      const panel = document.getElementById('productDetailPanel');
      panel.classList.remove('hidden');
      panel.classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ overlay: 'productDetailPanel' });
      lucide.createIcons();
    }

    function closeProductDetail() {
      const panel = document.getElementById('productDetailPanel');
      panel.classList.add('hidden');
      panel.classList.remove('flex');
      if (!state._restoringFromHistory && history.state && history.state.overlay === 'productDetailPanel') {
        var n = Object.assign({}, history.state);
        delete n.overlay;
        history.replaceState(n, '', location.href);
      }
    }

    function openEditProduct(codigo) {
      const d = getData();
      const p = (d.products || {})[codigo];
      if (!p) return;
      document.getElementById('productModalTitle').textContent = 'Configurar producto';
      document.getElementById('prodEditCodigo').value = codigo;
      document.getElementById('prodNombre').value = p.nombre || '';
      document.getElementById('prodCodigo').value = p.codigo || '';
      const costo = p.costo != null ? Number(p.costo) : '';
      document.getElementById('prodCosto').value = costo;
      const precioNum = p.precio != null ? Number(p.precio) : 0;
      const costoNum = p.costo != null ? Number(p.costo) : 0;
      const margen = costoNum > 0 && precioNum > 0 ? Math.round(((precioNum - costoNum) / costoNum) * 100) : '';
      document.getElementById('prodMargen').value = margen;
      resetMargenRapidoBtns(margen);
      document.getElementById('prodPrecio').value = p.precio ?? '';
      document.getElementById('prodStock').value = p.stock ?? '';
      document.getElementById('prodStockInicialWrap').classList.remove('hidden');
      const siEl = document.getElementById('prodStockInicial');
      siEl.value = p.stockInicial ?? p.stock ?? '';
      document.getElementById('deleteProductInModal').classList.remove('hidden');
      document.getElementById('productModal').classList.remove('hidden');
      document.getElementById('productModal').classList.add('flex');
      _userTouchedCost = true;
      if (typeof updateCostoCampoEstado === 'function') updateCostoCampoEstado();
      document.getElementById('prodMargenError').classList.add('hidden');
      lucide.createIcons();
    }

    function deleteProduct(codigo) {
      if (confirm('¿Eliminar este producto?')) {
        const d = getData();
        delete d.products[codigo];
        setData(d);
        renderInventory();
      }
    }

    function addToCart(codigo) {
      const d = getData();
      const p = (d.products || {})[codigo];
      if (!p || p.stock <= 0) return;
      const existing = state.cart.find(i => i.codigo === codigo);
      const costo = p.costo != null ? Number(p.costo) : 0;
      if (existing) existing.cant++;
      else state.cart.push({ ...p, cant: 1, costo });
      const cartQty = state.cart.find(i => i.codigo === codigo).cant;
      const stockInicial = p.stockInicial || p.stock || 1;
      const remaining = Math.max(0, p.stock - cartQty);
      const pct = stockInicial > 0 ? (remaining / stockInicial) : 0;
      if (pct <= 0.2 && pct > 0) {
        showStockWarning('¡Queda poco stock! ' + p.nombre + ' — menos del 20%');
      } else if (remaining === 0) {
        showStockWarning('¡Última unidad! ' + p.nombre);
      }
      playBeep();
      updateCartUI();
      document.getElementById('cartPanel').classList.add('translate-x-0');
      document.getElementById('cartDrawer').classList.remove('hidden');
      document.getElementById('cartDrawer').classList.add('flex');
    }

    function removeFromCart(idx) {
      state.cart.splice(idx, 1);
      updateCartUI();
    }

    function updateCartUI() {
      const count = state.cart.reduce((a, i) => a + i.cant, 0);
      document.getElementById('cartCount').textContent = count;
      const itemsEl = document.getElementById('cartItems');
      const total = state.cart.reduce((a, i) => a + i.precio * i.cant, 0);
      if (state.cart.length === 0) {
        itemsEl.innerHTML = `
          <div class="flex flex-col items-center justify-center py-10 px-4 text-center">
            <div class="w-16 h-16 rounded-2xl bg-white/10 flex items-center justify-center mb-4">
              <i data-lucide="shopping-cart" class="w-8 h-8 text-white/50"></i>
            </div>
            <p class="font-medium text-white/80 mb-1">Tu carrito está vacío</p>
            <p class="text-sm text-white/50 mb-4">Agregá productos desde el escáner o la lista de productos.</p>
            <button type="button" id="cartEmptyAddBtn" class="btn-glow rounded-xl py-2.5 px-5 text-sm font-medium flex items-center gap-2 touch-target">
              <i data-lucide="package" class="w-4 h-4"></i> Ir a productos
            </button>
          </div>`;
        lucide.createIcons();
        document.getElementById('cartEmptyAddBtn').onclick = function () {
          closeCart();
          setTimeout(function () { goToPanel('inventory'); }, 320);
        };
      } else {
        itemsEl.innerHTML = state.cart.map((item, idx) => `
          <div class="flex items-center gap-3 glass rounded-xl p-3">
            <div class="w-10 h-10 rounded-lg bg-[#dc2626]/30 flex items-center justify-center">
              <i data-lucide="package" class="w-5 h-5 text-[#f87171]"></i>
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-medium truncate">${item.nombre}</p>
              <p class="text-sm text-white/60">$${item.precio} x ${item.cant}</p>
            </div>
            <p class="font-semibold">$${item.precio * item.cant}</p>
            <button class="remove-cart text-red-400 p-2 touch-target rounded-lg hover:bg-red-500/20" data-idx="${idx}">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>
        `).join('');
        lucide.createIcons();
        itemsEl.querySelectorAll('.remove-cart').forEach(btn => {
          btn.onclick = () => removeFromCart(parseInt(btn.dataset.idx));
        });
      }
      document.getElementById('cartTotal').textContent = `$${total.toLocaleString('es-AR')}`;
    }

    function openPaymentModal() {
      if (state.cart.length === 0) return;
      _selectedLibretaClienteForPayment = null;
      var we = document.getElementById('paymentWhatsappErr'); if (we) we.classList.add('hidden');
      document.getElementById('paymentModal').classList.remove('hidden');
      document.getElementById('paymentModal').classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ modal: 'payment' });
      lucide.createIcons();
    }
    function closePaymentModal() {
      document.getElementById('paymentModal').classList.add('hidden');
      document.getElementById('paymentModal').classList.remove('flex');
      if (!state._restoringFromHistory && history.state && history.state.modal === 'payment') {
        var n = Object.assign({}, history.state);
        delete n.modal;
        history.replaceState(n, '', location.href);
      }
    }
    async function completeSaleWithMethod(method, clientName, whatsapp) {
      const total = state.cart.reduce((a, i) => a + i.precio * i.cant, 0);
      const items = state.cart.map(i => ({ nombre: i.nombre, codigo: i.codigo, precio: i.precio, cant: i.cant, costo: i.costo != null ? i.costo : 0 }));
      const fechaHora = new Date().toISOString();
      state.transaccionesList.push({
        id: Date.now(),
        method,
        client: clientName || '—',
        items: [...items],
        total,
        fechaHora
      });
      if (supabaseClient && currentUser?.id) {
        try {
          var ventaRes = await supabaseClient.from('ventas').insert({
            user_id: currentUser.id,
            fecha_hora: fechaHora,
            total,
            metodo_pago: method,
            cliente_nombre: (clientName || '').trim() || null,
            items
          });
          if (ventaRes.error) throw ventaRes.error;
        } catch (err) {
          console.warn('No se guardó venta en la nube:', err && err.message);
          if (typeof showScanToast === 'function') showScanToast('Venta guardada en este dispositivo. Revisá la conexión para sincronizar.', false);
        }
      }
      const d = getData();
      d.ventas = d.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 };
      if (method !== 'fiado' && method !== 'transferencia_pendiente') {
        d.ventas[method] = (d.ventas[method] || 0) + total;
      }
      d.transacciones = (d.transacciones || 0) + 1;
      state.cart.forEach(item => {
        if (d.products[item.codigo]) d.products[item.codigo].stock -= item.cant;
      });
      state.cart = [];
      d.lastCierreDate = new Date().toISOString().slice(0, 10);
      setData(d);
      updateCartUI();
      updateDashboard();
      closePaymentModal();
      closeCart();
      if (typeof playBeepCobro === 'function') playBeepCobro();
      showScanToast('¡Venta registrada! $' + total.toLocaleString('es-AR'), false);
      if (method === 'fiado' || method === 'transferencia_pendiente') {
        var preseleccionado = _selectedLibretaClienteForPayment;
        _selectedLibretaClienteForPayment = null;
        if (preseleccionado && preseleccionado.id) {
          setTimeout(async function () {
            _libretalDesdePago = { items: items, total: total, tipo: method };
            await _agregarItemsDesdePago(preseleccionado.id);
            if (typeof showScanToast === 'function') showScanToast('Agregado a la cuenta de ' + (preseleccionado.nombre || 'cliente'), false);
          }, 300);
        } else {
          setTimeout(function () { if (typeof window._mostrarFiadoPrompt === 'function') window._mostrarFiadoPrompt(items, total, method); }, 400);
        }
      }
    }
    function completeSale() {
      if (state.cart.length === 0) return;
      openPaymentModal();
    }

    function getTodayRange() {
      var now = new Date();
      var start = new Date(now); start.setHours(0, 0, 0, 0);
      var end = new Date(now); end.setHours(23, 59, 59, 999);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    async function getMetricasDelDia() {
      var range = getTodayRange();
      if (supabaseClient && currentUser && currentUser.id) {
        try {
          var res = await supabaseClient.from('ventas').select('id, fecha_hora, total, metodo_pago, items').eq('user_id', currentUser.id).gte('fecha_hora', range.start).lte('fecha_hora', range.end);
          if (!res.error && res.data && res.data.length > 0) {
            var efectivo = 0, tarjeta = 0, transferencia = 0, fiado = 0, transferencia_pendiente = 0, cobroLibreta = 0;
            var totalIngresos = 0;
            var ganancia = 0;
            res.data.forEach(function (v) {
              var t = Number(v.total) || 0;
              var metodo = (v.metodo_pago || '').toLowerCase().replace(/\s/g, '_');
              if (metodo === 'fiado') {
                fiado += t;
              } else if (metodo === 'transferencia_pendiente') {
                transferencia_pendiente += t;
              } else if (metodo === 'cobro_libreta') {
                cobroLibreta += t;
                totalIngresos += t;
              } else if (metodo === 'efectivo') {
                efectivo += t;
                totalIngresos += t;
              } else if (metodo === 'tarjeta') {
                tarjeta += t;
                totalIngresos += t;
              } else if (metodo === 'transferencia') {
                transferencia += t;
                totalIngresos += t;
              } else {
                efectivo += t;
                totalIngresos += t;
              }
              (v.items || []).forEach(function (i) {
                var costo = i.costo != null ? Number(i.costo) : 0;
                ganancia += ((Number(i.precio) || 0) - costo) * (i.cant || 0);
              });
            });
            return { total: totalIngresos, efectivo, tarjeta, transferencia, fiado, transferencia_pendiente, cobro_libreta: cobroLibreta, ganancia, count: res.data.length };
          }
        } catch (_) {}
      }
      var d = getData();
      var ventas = d.ventas || {};
      var fiado = 0;
      var transfPend = 0;
      (state.transaccionesList || []).forEach(function (t) {
        var tot = Number(t.total) || 0;
        if (t.method === 'fiado') fiado += tot;
        else if (t.method === 'transferencia_pendiente') transfPend += tot;
      });
      var cobroLibretaL = ventas.cobro_libreta || 0;
      var total = (ventas.efectivo || 0) + (ventas.tarjeta || 0) + (ventas.transferencia || 0) + cobroLibretaL;
      var ganancia = (state.transaccionesList || []).reduce(function (sum, t) {
        return sum + (t.items || []).reduce(function (s, i) {
          var costo = i.costo != null ? Number(i.costo) : 0;
          var precio = Number(i.precio) || 0;
          var cant = i.cant || 0;
          var g = (precio - costo) * cant;
          return s + (Number.isFinite(g) ? g : 0);
        }, 0);
      }, 0);
      return { total, efectivo: ventas.efectivo || 0, tarjeta: ventas.tarjeta || 0, transferencia: ventas.transferencia || 0, fiado, transferencia_pendiente: transfPend, cobro_libreta: cobroLibretaL, ganancia, count: d.transacciones || 0 };
    }
    async function updateDashboard() {
      checkMidnightReset();
      var m = await getMetricasDelDia();
      document.getElementById('metricVentas').textContent = '$' + m.total.toLocaleString('es-AR');
      document.getElementById('metricTrans').textContent = '$' + Math.round(m.ganancia).toLocaleString('es-AR');
      document.getElementById('cajaEfectivo').textContent = '$' + m.efectivo.toLocaleString('es-AR');
      document.getElementById('cajaTarjeta').textContent = '$' + m.tarjeta.toLocaleString('es-AR');
      document.getElementById('cajaTransf').textContent = '$' + m.transferencia.toLocaleString('es-AR');
      var cajaCobroLibretaEl = document.getElementById('cajaCobroLibreta');
      if (cajaCobroLibretaEl) cajaCobroLibretaEl.textContent = '$' + (m.cobro_libreta || 0).toLocaleString('es-AR');
      document.getElementById('cajaFiado').textContent = '$' + m.fiado.toLocaleString('es-AR');
      var cajaTransfPendEl = document.getElementById('cajaTransfPend');
      if (cajaTransfPendEl) cajaTransfPendEl.textContent = '$' + m.transferencia_pendiente.toLocaleString('es-AR');
      document.getElementById('cajaTotal').textContent = '$' + m.total.toLocaleString('es-AR');
      var cajaUtilidadEl = document.getElementById('cajaUtilidad');
      if (cajaUtilidadEl) cajaUtilidadEl.textContent = '$' + Math.round(m.ganancia).toLocaleString('es-AR');
      var resumenEl = document.getElementById('resumenDiaTexto');
      var resumenVentasEl = document.getElementById('resumenDiaVentas');
      if (resumenEl) resumenEl.textContent = 'Ingresos de caja $' + m.total.toLocaleString('es-AR');
      if (resumenVentasEl) resumenVentasEl.textContent = m.count + ' movimientos';
      var porMetodoEl = document.getElementById('resumenDiaPorMetodo');
      if (porMetodoEl) {
        var methods = [
          { key: 'efectivo', label: 'Efectivo', icon: 'banknote', color: 'text-green-400', bg: 'bg-green-500/20' },
          { key: 'tarjeta', label: 'Tarjeta', icon: 'credit-card', color: 'text-blue-400', bg: 'bg-blue-500/20' },
          { key: 'transferencia', label: 'Transf.', icon: 'smartphone', color: 'text-cyan-400', bg: 'bg-cyan-500/20' },
          { key: 'cobro_libreta', label: 'Cobro libreta', icon: 'wallet', color: 'text-emerald-300', bg: 'bg-emerald-500/20' },
          { key: 'fiado', label: 'Fiado (cuenta)', icon: 'user-check', color: 'text-amber-400', bg: 'bg-amber-500/20', libreta: true },
          { key: 'transferencia_pendiente', label: 'Pend. (cuenta)', icon: 'clock', color: 'text-orange-400', bg: 'bg-orange-500/20', libreta: true }
        ];
        porMetodoEl.innerHTML = methods.map(function (x) {
          var val = m[x.key] || 0;
          if (val === 0) return '';
          var inner = '<i data-lucide="' + x.icon + '" class="w-3 h-3 shrink-0"></i><span>' + x.label + ' $' + val.toLocaleString('es-AR') + '</span>';
          if (x.libreta) inner += '<i data-lucide="chevron-right" class="w-3 h-3 shrink-0 opacity-70"></i>';
          var baseCls = 'inline-flex items-center gap-1 px-2 py-0.5 rounded-lg text-xs font-medium ' + x.bg + ' ' + x.color;
          if (x.libreta) {
            return '<button type="button" class="' + baseCls + ' touch-target active:scale-[0.97] hover:brightness-110 border-0 cursor-pointer" title="Abrir libreta de fiado" aria-label="Abrir libreta de fiado" onclick="window._goToCajaLibreta && window._goToCajaLibreta()">' + inner + '</button>';
          }
          return '<span class="' + baseCls + '">' + inner + '</span>';
        }).filter(Boolean).join('');
        try {
          if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
        } catch (_) {}
      }
      renderFrequentProducts();
      await loadKioscoLicensePaymentInfo();
    }
    function openDetalleVentaModal(v) {
      var content = document.getElementById('detalleVentaModalContent');
      if (!content || !v) return;
      var fmt = (s) => s ? new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '—';
      var methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pend.', cobro_libreta: 'Cobro libreta' };
      var items = (v.items || []).map(function (i) {
        var subtotal = (i.precio || 0) * (i.cant || 0);
        return '<li class="flex justify-between py-1 border-b border-white/10">' +
          '<span>' + (i.nombre || '—').replace(/</g, '&lt;') + ' x ' + (i.cant || 0) + '</span>' +
          '<span>$' + subtotal.toLocaleString('es-AR') + '</span></li>';
      }).join('');
      content.innerHTML = '<p><span class="text-white/50">Fecha y hora:</span> ' + fmt(v.fecha_hora) + '</p>' +
        '<p><span class="text-white/50">Cliente:</span> ' + ((v.cliente_nombre || '').trim() || 'Sin nombre').replace(/</g, '&lt;') + '</p>' +
        '<p><span class="text-white/50">Método de pago:</span> ' + (methodLabels[v.metodo_pago] || v.metodo_pago) + '</p>' +
        '<p><span class="text-white/50">Total:</span> <strong class="text-[#f87171]">$' + Number(v.total).toLocaleString('es-AR') + '</strong></p>' +
        '<div class="pt-2"><p class="text-white/70 mb-2">Productos:</p><ul class="space-y-0">' + items + '</ul></div>';
      document.getElementById('detalleVentaModal').classList.remove('hidden');
      document.getElementById('detalleVentaModal').classList.add('flex');
      lucide.createIcons();
    }
    document.getElementById('detalleVentaModalClose').onclick = function () { document.getElementById('detalleVentaModal').classList.add('hidden'); document.getElementById('detalleVentaModal').classList.remove('flex'); };
    document.getElementById('detalleVentaModalCloseBtn').onclick = function () { document.getElementById('detalleVentaModal').classList.add('hidden'); document.getElementById('detalleVentaModal').classList.remove('flex'); };
    document.getElementById('detalleVentaModalOverlay').onclick = function () { document.getElementById('detalleVentaModal').classList.add('hidden'); document.getElementById('detalleVentaModal').classList.remove('flex'); };
    function getFrequentProductsToday(maxItems) {
      var list = state.transaccionesList || [];
      var agg = {};
      list.forEach(function (t) {
        (t.items || []).forEach(function (it) {
          if (it.codigo === '_rapida') return;
          var k = it.codigo;
          if (!agg[k]) agg[k] = { nombre: it.nombre, codigo: it.codigo, cant: 0 };
          agg[k].cant += it.cant || 0;
        });
      });
      var prods = getData().products || {};
      return Object.values(agg)
        .filter(function (p) { return prods[p.codigo]; })
        .sort(function (a, b) { return b.cant - a.cant; })
        .slice(0, maxItems || 8);
    }
    var _frequentProductsRenderKey = '';

    function renderFrequentProducts() {
      var wrap = document.getElementById('dashboardFrecuentesWrap');
      var cont = document.getElementById('dashboardFrecuentes');
      if (!wrap || !cont) return;
      var frequent = getFrequentProductsToday(8);
      if (frequent.length === 0) {
        _frequentProductsRenderKey = '';
        wrap.classList.add('hidden');
        return;
      }
      var prods = getData().products || {};
      var renderKey = frequent.map(function (p) {
        var prod = prods[p.codigo];
        var stock = prod ? prod.stock : 0;
        return (p.codigo || '') + ':' + p.cant + ':' + stock + ':' + (prod ? prod.precio : '');
      }).join('|');
      wrap.classList.remove('hidden');
      if (renderKey === _frequentProductsRenderKey && cont.querySelector('.freq-product-btn')) {
        return;
      }
      _frequentProductsRenderKey = renderKey;
      cont.innerHTML = frequent.map(function (p) {
        var prod = prods[p.codigo];
        var nombre = (prod && prod.nombre) ? prod.nombre : p.nombre;
        var precio = prod ? prod.precio : 0;
        var stock = prod ? prod.stock : 0;
        var disabled = stock <= 0 ? ' opacity-50 pointer-events-none' : '';
        return '<button type="button" class="freq-product-btn flex-shrink-0 glass rounded-xl px-4 py-3 border border-white/10 hover:border-[#22c55e]/50 active:opacity-90 touch-target text-left min-w-0 max-w-[140px]' + disabled + '" data-codigo="' + (p.codigo || '').replace(/"/g, '&quot;') + '" title="Agregar al carrito"><p class="font-medium truncate text-sm leading-snug">' + (nombre || '').replace(/</g, '&lt;') + '</p><p class="text-[#86efac] text-xs mt-1 leading-none tabular-nums">$' + (precio || 0).toLocaleString('es-AR') + '</p></button>';
      }).join('');
      cont.querySelectorAll('.freq-product-btn').forEach(function (btn) {
        btn.onclick = function () {
          var codigo = btn.dataset.codigo;
          if (codigo) addToCart(codigo);
        };
      });
    }

    function updateCobroRapidoLista() {
      var listEl = document.getElementById('cobroRapidoLista');
      var emptyEl = document.getElementById('cobroRapidoListaEmpty');
      var totalEl = document.getElementById('cobroRapidoTotal');
      if (!listEl) return;
      var items = state.cobroRapidoItems || [];
      if (items.length === 0) {
        listEl.innerHTML = '';
        if (emptyEl) emptyEl.classList.remove('hidden');
        if (totalEl) { totalEl.classList.add('hidden'); totalEl.textContent = 'Total: $0'; }
        return;
      }
      if (emptyEl) emptyEl.classList.add('hidden');
      var total = items.reduce(function (s, it) { return s + (it.precio || 0); }, 0);
      listEl.innerHTML = items.map(function (it, i) {
        var nombre = (it.nombre || 'Item').replace(/</g, '&lt;').replace(/"/g, '&quot;');
        var precio = it.precio || 0;
        return '<div class="flex items-center justify-between gap-1.5 py-1 px-2 rounded-lg bg-white/10"><span class="text-xs text-white truncate flex-1">' + nombre + ' <span class="text-white/60">$' + precio + '</span></span><button type="button" class="cobro-rapido-quitar shrink-0 p-1 rounded text-red-300 hover:bg-red-500/20 touch-target text-sm" data-index="' + i + '" aria-label="Quitar">×</button></div>';
      }).join('');
      if (totalEl) { totalEl.classList.remove('hidden'); totalEl.textContent = 'Total: $' + total; }
      listEl.querySelectorAll('.cobro-rapido-quitar').forEach(function (btn) {
        btn.onclick = function () {
          var idx = parseInt(btn.dataset.index, 10);
          state.cobroRapidoItems.splice(idx, 1);
          updateCobroRapidoLista();
        };
      });
      lucide.createIcons();
    }
    window._abrirCobroRapido = function () { openCobroRapidoModal(); };
    function openCobroRapidoModal() {
      state.cobroRapidoItems = [];
      _selectedLibretaClienteForPayment = null;
      document.getElementById('cobroRapidoMonto').value = '';
      var margenEl = document.getElementById('cobroRapidoMargen'); if (margenEl) margenEl.value = '';
      document.getElementById('cobroRapidoOtroNombre').value = '';
      document.getElementById('cobroRapidoWhatsapp').value = '';
      var crwe = document.getElementById('cobroRapidoWhatsappErr'); if (crwe) crwe.classList.add('hidden');
      document.querySelectorAll('.quick-payment-option').forEach(function (el) { el.classList.remove('ring-2', 'ring-[#dc2626]'); });
      var lastMethod = '';
      try { lastMethod = localStorage.getItem(LAST_QUICK_PAYMENT_KEY) || ''; } catch (_) {}
      if (lastMethod) document.querySelectorAll('.quick-payment-option').forEach(function (el) { if (el.dataset.quickPayment === lastMethod) el.classList.add('ring-2', 'ring-[#dc2626]'); });
      updateCobroRapidoLista();
      var crDet = document.querySelector('#cobroRapidoModal details');
      if (crDet) crDet.removeAttribute('open');
      document.getElementById('cobroRapidoModal').classList.remove('hidden');
      document.getElementById('cobroRapidoModal').classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ modal: 'cobroRapido' });
      setTimeout(function () { document.getElementById('cobroRapidoMonto').focus(); }, 100);
      lucide.createIcons();
    }
    function getCobroRapidoProductoNombre() {
      var el = document.getElementById('cobroRapidoOtroNombre');
      return (el && el.value.trim()) ? el.value.trim() : 'Venta rápida';
    }
    function getCobroRapidoProductoMargen() {
      var inputEl = document.getElementById('cobroRapidoMargen');
      if (inputEl && inputEl.value !== '' && !isNaN(parseFloat(inputEl.value))) return parseFloat(inputEl.value) || 0;
      return 0;
    }
    function costoDesdeMargen(amount, margenPct) {
      var a = Number(amount);
      var m = Number(margenPct);
      if (!Number.isFinite(a) || a <= 0) return 0;
      if (!Number.isFinite(m) || m <= 0) return 0;
      var denom = 1 + m / 100;
      if (!Number.isFinite(denom) || denom <= 0) return 0;
      var c = Math.round(a / denom);
      return Number.isFinite(c) && c >= 0 ? c : 0;
    }
    function closeCobroRapidoModal() {
      if (!state._restoringFromHistory && history.state && history.state.modal === 'cobroRapido') {
        var n = Object.assign({}, history.state);
        delete n.modal;
        history.replaceState(n, '', location.href);
      }
      document.getElementById('cobroRapidoModal').classList.add('hidden');
      document.getElementById('cobroRapidoModal').classList.remove('flex');
    }
    async function completeQuickSale(method, clientName, whatsapp) {
      var items;
      var total;
      if (state.cobroRapidoItems && state.cobroRapidoItems.length > 0) {
        items = state.cobroRapidoItems.map(function (it) {
          var nombre = it.nombre || 'Venta rápida';
          var codigoRapida = '_rapida_' + (nombre.replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'venta') + '_' + Date.now();
          var pr = Number(it.precio) || 0;
          var co = it.costo != null ? Number(it.costo) : 0;
          if (!Number.isFinite(co) || co < 0) co = 0;
          return { nombre: nombre, codigo: codigoRapida, precio: pr, cant: 1, costo: co };
        });
        total = items.reduce(function (s, it) { return s + (Number(it.precio) || 0); }, 0);
      } else {
        var montoEl = document.getElementById('cobroRapidoMonto');
        var amount = parseInt((montoEl.value || '').replace(/\D/g, ''), 10) || 0;
        if (amount <= 0) { alert('Agregá al menos un producto (producto + monto → Agregar) o ingresá un monto.'); return; }
        var productName = getCobroRapidoProductoNombre();
        var margen = getCobroRapidoProductoMargen();
        var costo = costoDesdeMargen(amount, margen);
        var codigoRapida = '_rapida_' + (productName.replace(/\s+/g, '_').toLowerCase().replace(/[^a-z0-9_]/g, '') || 'venta');
        items = [{ nombre: productName, codigo: codigoRapida, precio: amount, cant: 1, costo: costo }];
        total = amount;
      }
      items = (items || []).map(function (it) {
        return {
          nombre: it.nombre,
          codigo: it.codigo,
          precio: Number(it.precio) || 0,
          cant: Number(it.cant) || 1,
          costo: (function (c) { return Number.isFinite(c) && c >= 0 ? c : 0; })(Number(it.costo))
        };
      });
      var fechaHora = new Date().toISOString();
      state.transaccionesList.push({
        id: Date.now(),
        method: method,
        client: (clientName || '').trim() || '—',
        items: items,
        total: total,
        fechaHora: fechaHora
      });
      if (supabaseClient && currentUser && currentUser.id) {
        try {
          var ventaRes = await supabaseClient.from('ventas').insert({
            user_id: currentUser.id,
            fecha_hora: fechaHora,
            total: total,
            metodo_pago: method,
            cliente_nombre: (clientName || '').trim() || null,
            items: items
          });
          if (ventaRes.error) throw ventaRes.error;
        } catch (err) {
          console.warn('Venta rápida no guardada en historial:', err && err.message);
          if (typeof showScanToast === 'function') showScanToast('Cobro guardado en este dispositivo. Revisá la conexión para sincronizar.', false);
        }
      }
      var d = getData();
      d.ventas = d.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 };
      if (method !== 'fiado' && method !== 'transferencia_pendiente') {
        d.ventas[method] = (d.ventas[method] || 0) + total;
      }
      d.transacciones = (d.transacciones || 0) + 1;
      d.lastCierreDate = new Date().toISOString().slice(0, 10);
      setData(d);
      try {
        await updateDashboard();
      } catch (e) {
        console.warn('No se pudo refrescar el panel tras cobro rápido:', e && e.message ? e.message : e);
      }
      state.cobroRapidoItems = [];
      try { localStorage.setItem(LAST_QUICK_PAYMENT_KEY, method); } catch (_) {}
      closeCobroRapidoModal();
      if (typeof playBeepCobro === 'function') playBeepCobro();
      if (typeof showScanToast === 'function') showScanToast('Cobro registrado', false);
      if (method === 'fiado' || method === 'transferencia_pendiente') {
        var preseleccionadoQ = _selectedLibretaClienteForPayment;
        _selectedLibretaClienteForPayment = null;
        if (preseleccionadoQ && preseleccionadoQ.id) {
          setTimeout(async function () {
            _libretalDesdePago = { items: items, total: total, tipo: method };
            await _agregarItemsDesdePago(preseleccionadoQ.id);
            if (typeof showScanToast === 'function') showScanToast('Agregado a la cuenta de ' + (preseleccionadoQ.nombre || 'cliente'), false);
          }, 300);
        } else {
          setTimeout(function () { if (typeof window._mostrarFiadoPrompt === 'function') window._mostrarFiadoPrompt(items, total, method); }, 400);
        }
      }
    }

    function openCart() {
      document.getElementById('cartDrawer').classList.remove('hidden');
      document.getElementById('cartDrawer').classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ modal: 'cart' });
      setTimeout(() => document.getElementById('cartPanel').classList.add('translate-x-0'), 10);
    }

    function closeCart() {
      if (!state._restoringFromHistory && history.state && history.state.modal === 'cart') {
        var n = Object.assign({}, history.state);
        delete n.modal;
        history.replaceState(n, '', location.href);
      }
      document.getElementById('cartPanel').classList.remove('translate-x-0');
      setTimeout(() => {
        document.getElementById('cartDrawer').classList.add('hidden');
        document.getElementById('cartDrawer').classList.remove('flex');
      }, 300);
    }

    // Navegación (barra inferior + panel Más)
    function showLoginScreenTrialEnded() {
      document.getElementById('appWrap').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
      document.getElementById('signUpBox').classList.add('hidden');
      var errEl = document.getElementById('loginErr');
      errEl.textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá por WhatsApp para renovar.';
      errEl.classList.add('show');
      var wrap = document.getElementById('loginContactAdminWrap');
      if (wrap) {
        fillLoginContactLinks('Hola, mi período de prueba de Ferriol OS terminó y quiero renovar.');
        wrap.classList.remove('hidden');
      }
    }
    function updateTrialCountdown() {
      const banner = document.getElementById('trialCountdownBanner');
      const textEl = document.getElementById('trialCountdownText');
      const daysEl = document.getElementById('trialCountdownDays');
      if (!banner || !currentUser || currentUser.role !== 'kiosquero') return;
      const endsAt = currentUser.trialEndsAt;
      if (!endsAt) {
        banner.classList.add('hidden');
        banner.classList.remove('trial-countdown-banner--urgent');
        var st = document.getElementById('trialCountdownSubtext');
        if (st) { st.textContent = ''; st.classList.add('hidden'); }
        var subEl = document.getElementById('headerSub');
        if (subEl && currentUser.role === 'kiosquero') subEl.textContent = 'Sistema Premium';
        return;
      }
      const end = new Date(endsAt);
      const now = new Date();
      const msLeft = end - now;
      if (msLeft <= 0) {
        banner.classList.add('hidden');
        banner.classList.remove('trial-countdown-banner--urgent');
        var st0 = document.getElementById('trialCountdownSubtext');
        if (st0) { st0.textContent = ''; st0.classList.add('hidden'); }
        if (supabaseClient && currentUser && currentUser.id && !currentUser._trialBlockTriggered) {
          currentUser._trialBlockTriggered = true;
          supabaseClient.from('profiles').update({ active: false }).eq('id', currentUser.id).then(function () {
            loadAdminContactForTrialEnded().then(function () {
              window._adminWhatsappForContact = adminContact.whatsapp;
              supabaseClient.auth.signOut().then(showLoginScreenTrialEnded);
            });
          });
        }
        return;
      }
      const daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      const win = getTrialReminderWindowDays();
      const inReminderWindow = daysLeft >= 1 && daysLeft <= win;
      banner.classList.remove('hidden');
      banner.classList.toggle('trial-countdown-banner--urgent', inReminderWindow);
      daysEl.textContent = daysLeft;
      textEl.textContent = daysLeft === 1 ? 'Último día de prueba' : (daysLeft + ' días de prueba restantes');
      var subTxt = document.getElementById('trialCountdownSubtext');
      if (subTxt) {
        if (inReminderWindow) {
          var cfg = window._trialReminderConfig || { messages: {} };
          var custom = (cfg.messages && (cfg.messages[String(daysLeft)] != null ? cfg.messages[String(daysLeft)] : cfg.messages[daysLeft])) || '';
          var line = applyTrialReminderTokens(custom, daysLeft, currentUser.kioscoName);
          subTxt.textContent = line;
          subTxt.classList.remove('hidden');
        } else {
          subTxt.textContent = '';
          subTxt.classList.add('hidden');
        }
      }
      var subEl = document.getElementById('headerSub');
      if (subEl) subEl.textContent = 'Sistema de prueba';
    }
    function loadAdminContactForTrialEnded() {
      return loadAdminContact();
    }
    document.getElementById('trialRenovarBtn') && document.getElementById('trialRenovarBtn').addEventListener('click', function () {
      loadAdminContact().then(function () {
        fillRenovarWhatsAppLinks();
        if (!adminContact.whatsappList || adminContact.whatsappList.length === 0) { alert('El administrador aún no configuró su WhatsApp.'); return; }
        document.getElementById('renovarModal').classList.remove('hidden');
        document.getElementById('renovarModal').classList.add('flex');
        if (!state._restoringFromHistory) pushHistoryExtra({ modal: 'renovar' });
        lucide.createIcons();
      });
    });
    document.getElementById('closeRenovarModal') && document.getElementById('closeRenovarModal').addEventListener('click', closeRenovarModal);
    document.getElementById('renovarModalOverlay') && document.getElementById('renovarModalOverlay').addEventListener('click', closeRenovarModal);
    function closeRenovarModal() {
      var m = document.getElementById('renovarModal');
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
      if (!state._restoringFromHistory && history.state && history.state.modal === 'renovar') {
        var n = Object.assign({}, history.state);
        delete n.modal;
        history.replaceState(n, '', location.href);
      }
    }
    function closeAllModals() {
      document.getElementById('ventasProductosModal') && (function () { var m = document.getElementById('ventasProductosModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('ventasCobradasModal') && (function () { var m = document.getElementById('ventasCobradasModal'); m.classList.add('hidden'); })();
      document.getElementById('transaccionesModal') && (function () { var m = document.getElementById('transaccionesModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('paymentModal') && (function () { var m = document.getElementById('paymentModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('cobroRapidoModal') && (function () { var m = document.getElementById('cobroRapidoModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('renovarModal') && (function () { var m = document.getElementById('renovarModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      document.getElementById('detalleVentaModal') && (function () { var m = document.getElementById('detalleVentaModal'); m.classList.add('hidden'); m.classList.remove('flex'); })();
      var cartPanel = document.getElementById('cartPanel');
      var cartDrawer = document.getElementById('cartDrawer');
      if (cartPanel) cartPanel.classList.remove('translate-x-0');
      if (cartDrawer) { cartDrawer.classList.add('hidden'); cartDrawer.classList.remove('flex'); }
    }

    function closeAllOverlays() {
      closeAllModals();
      if (typeof closeProductDetail === 'function') closeProductDetail();
      var pm = document.getElementById('productModal');
      if (pm) { pm.classList.add('hidden'); pm.classList.remove('flex'); }
      var cm = document.getElementById('clienteModal');
      if (cm) { cm.classList.add('hidden'); cm.classList.remove('flex'); }
      var nk = document.getElementById('newKiosqueroModal');
      if (nk) { nk.classList.add('hidden'); nk.classList.remove('flex'); }
      var sud = document.getElementById('superUserDetailModal');
      if (sud) { sud.classList.add('hidden'); sud.classList.remove('flex'); }
      if (typeof window._cerrarModalLibreta === 'function') {
        window._cerrarModalLibreta('libretalNuevoClienteModal');
        window._cerrarModalLibreta('libretalNuevoItemModal');
        window._cerrarModalLibreta('libretalEditarClienteModal');
      }
      if (typeof window._cerrarItemDetalle === 'function') window._cerrarItemDetalle();
      if (typeof window._cerrarCuentaLibreta === 'function') window._cerrarCuentaLibreta();
      if (typeof window._cerrarFiadoPrompt === 'function') window._cerrarFiadoPrompt();
      var terms = document.getElementById('termsModal');
      if (terms) { terms.classList.add('hidden'); terms.classList.remove('flex'); }
    }

    function applyAppShell() {
      if (!currentUser) return;
      var isSuper = currentUser.role === 'super';
      var isPartner = currentUser.role === 'partner';
      var isNetworkAdmin = isNetworkAdminRole(currentUser.role);
      var uiNegocio = isSuperKioscoPreviewMode();
      var asKiosquero = !isNetworkAdmin || uiNegocio;
      document.querySelectorAll('.kiosquero-only').forEach(function (el) {
        if (el.id === 'navKiosquero') return;
        el.style.display = asKiosquero ? '' : 'none';
      });
      var navK = document.getElementById('navKiosquero');
      if (navK) navK.classList.toggle('hidden', !asKiosquero);
      document.querySelectorAll('.super-only').forEach(function (el) {
        if (!isNetworkAdmin) {
          el.style.display = 'none';
          return;
        }
        if ((isPartner || isSuperSocioLens()) && el.classList.contains('super-main-only')) {
          el.style.display = 'none';
          return;
        }
        if (el.classList.contains('super-section')) return;
        if (el.id === 'navSuperBottom') return;
        if (el.id === 'logoutBtn') {
          el.style.display = 'inline-flex';
          return;
        }
        el.style.display = uiNegocio ? 'none' : (el.tagName === 'BUTTON' ? 'inline-flex' : 'block');
      });
      var navS = document.getElementById('navSuperBottom');
      if (navS) {
        if (!isNetworkAdmin || uiNegocio) {
          navS.classList.add('hidden');
          navS.style.display = 'none';
        } else if (state.currentPanel === 'super') {
          navS.classList.remove('hidden');
          navS.style.display = 'block';
        } else {
          navS.classList.add('hidden');
          navS.style.display = 'none';
        }
      }
      var ht = document.getElementById('headerTitle');
      var subEl = document.getElementById('headerSub');
      if (ht) {
        if (isSuper && !uiNegocio) {
          ht.textContent = 'FERRIOL OS';
          if (subEl) {
            subEl.classList.add('header-sub--toggle');
            if (isSuperSocioLens()) {
              subEl.textContent = 'Administración';
              subEl.title = 'Tocá para abrir Modo usuario (vista tienda)';
              subEl.setAttribute('aria-label', 'Cambiar a Modo usuario');
            } else {
              subEl.innerHTML = '<span class="inline-flex items-center gap-1.5 min-w-0 max-w-full"><i data-lucide="crown" class="w-3.5 h-3.5 text-amber-300 shrink-0" aria-hidden="true"></i><span class="truncate">Fundador</span></span>';
              subEl.title = 'Tocá para abrir Administración (vista socio)';
              subEl.setAttribute('aria-label', 'Cambiar a Administración');
            }
          }
        } else if (isSuper && uiNegocio) {
          ht.textContent = currentUser.kioscoName || 'Ferriol OS';
          if (subEl) {
            subEl.textContent = 'Modo usuario';
            subEl.classList.add('header-sub--toggle');
            subEl.title = 'Tocá para volver a Fundador';
            subEl.setAttribute('aria-label', 'Volver a vista Fundador');
          }
        } else if (isPartner) {
          ht.textContent = 'FERRIOL OS';
          if (subEl) {
            subEl.textContent = 'Tu red · Ferriol';
            subEl.classList.remove('header-sub--toggle');
            subEl.removeAttribute('title');
            subEl.removeAttribute('aria-label');
          }
        } else {
          ht.textContent = currentUser.kioscoName || 'Ferriol OS';
          if (subEl) {
            subEl.classList.remove('header-sub--toggle');
            subEl.removeAttribute('title');
            subEl.removeAttribute('aria-label');
            if (currentUser.trialEndsAt && new Date(currentUser.trialEndsAt) > new Date()) subEl.textContent = 'Sistema de prueba';
            else subEl.textContent = 'Sistema Premium';
          }
        }
      }
      if (currentUser && (currentUser.role === 'kiosquero' || isSuperKioscoPreviewMode())) {
        loadKioscoLicensePaymentInfo();
      }
      if (currentUser && currentUser.role === 'super') {
        loadSuperMainFerriolResumenCard();
      }
      try {
        if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    }

    function showPanel(name, cajaTabOverride) {
      if (name === 'super' && currentUser && currentUser.role === 'super' && state.superUiMode === 'negocio') {
        state.superUiMode = 'empresa';
        try { sessionStorage.setItem('ferriol_super_ui', 'empresa'); } catch (_) {}
        applyAppShell();
      }
      if (name === 'super' && currentUser && currentUser.role === 'partner' && state.superSection && state.superSection !== 'negocios') {
        switchSuperSection('negocios');
      }
      if (name !== 'scanner') window._scanForProductCode = false;
      state.currentPanel = name;
      document.body.setAttribute('data-panel', name);
      const navKey = (name === 'config' || name === 'historial' || name === 'clientes') ? 'mas' : name;
      var kNav = document.getElementById('navKiosquero');
      if (kNav) {
        kNav.querySelectorAll('[data-nav]').forEach(function (n) { n.classList.remove('active'); });
        var kBtn = kNav.querySelector('[data-nav="' + navKey + '"]');
        if (kBtn) kBtn.classList.add('active');
        if (document.activeElement && kNav.contains(document.activeElement)) {
          try { document.activeElement.blur(); } catch (_) {}
        }
      }
      document.querySelectorAll('.panel').forEach(p => p.classList.add('hidden'));
      const panel = document.getElementById('panel-' + name);
      if (panel) panel.classList.remove('hidden');
      if (name === 'config') fillConfigForm();
      if (name === 'super') {
        if (superListCountdownInterval) clearInterval(superListCountdownInterval);
        renderSuper();
        superListCountdownInterval = setInterval(updateSuperListCountdowns, 1000);
        var navSuperBottom = document.getElementById('navSuperBottom');
        if (navSuperBottom) navSuperBottom.classList.remove('hidden');
        switchSuperSection('negocios');
      } else {
        if (superListCountdownInterval) { clearInterval(superListCountdownInterval); superListCountdownInterval = null; }
        var navSuperBottom = document.getElementById('navSuperBottom');
        if (navSuperBottom) navSuperBottom.classList.add('hidden');
      }
      if (name === 'dashboard') {
        updateTrialCountdown();
        updateDashboard();
        if (ferriolKiosqueroNotifShell()) { loadAdminContact(); loadNotifications(); }
      }
      if (name === 'scanner') {
        if (typeof window._startScannerCamera === 'function') window._startScannerCamera();
        if (typeof window._stopScannerInterval === 'function') window._stopScannerInterval();
      } else if (typeof window._stopScannerInterval === 'function') window._stopScannerInterval();
      if (name === 'caja') {
        state._suppressCajaHistoryPush = true;
        var ctab = cajaTabOverride != null && cajaTabOverride !== '' ? cajaTabOverride : 'hub';
        window._switchCajaTab(ctab);
        state._suppressCajaHistoryPush = false;
      }
      if (name === 'historial') {
        renderHistorial(state.historialFilter || 'hoy');
      }
      if (name === 'clientes') loadClientes().then(renderClientes);
      applyAppShell();
      lucide.createIcons();
    }
    function goToPanel(name, cajaTabOpt) {
      showPanel(name, cajaTabOpt);
      if (!state._restoringFromHistory) {
        history.pushState({
          panel: state.currentPanel,
          cajaTab: state.currentPanel === 'caja' ? state.cajaTab : undefined
        }, '', location.href);
      }
    }
    window._goToCajaLibreta = function () {
      goToPanel('caja', 'libreta');
    };
    window.addEventListener('popstate', function (e) {
      state._restoringFromHistory = true;
      closeAllOverlays();
      var s = e.state;
      if (s && s.panel) {
        showPanel(s.panel, s.cajaTab != null && s.cajaTab !== '' ? s.cajaTab : undefined);
      } else {
        showPanel('dashboard');
        history.replaceState({ panel: 'dashboard', root: true }, '', location.href);
      }
      state._restoringFromHistory = false;
    });
    document.querySelectorAll('[data-nav]').forEach(btn => {
      btn.onclick = () => goToPanel(btn.dataset.nav);
    });
    function switchSuperSection(sectionName) {
      state.superSection = sectionName || 'negocios';
      var reqSuper = state.superSection === 'cobros';
      if (reqSuper && currentUser && (currentUser.role !== 'super' || !isEmpresaLensSuper())) {
        state.superSection = 'negocios';
      }
      document.querySelectorAll('#panel-super .super-section').forEach(function (el) {
        el.classList.add('hidden');
        el.style.setProperty('display', 'none', 'important');
        el.style.zIndex = '0';
      });
      var section = document.getElementById('super-section-' + state.superSection);
      if (section) {
        section.classList.remove('hidden');
        section.style.setProperty('display', 'block', 'important');
        section.style.zIndex = '10';
      }
      document.querySelectorAll('.super-nav-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.superSection === state.superSection);
      });
      var headerAjustesBtn = document.getElementById('headerSuperAjustesBtn');
      if (headerAjustesBtn) headerAjustesBtn.classList.toggle('active', state.superSection === 'ajustes');
      var headerNotifBtn = document.getElementById('headerSuperNotifBtn');
      if (headerNotifBtn) headerNotifBtn.classList.toggle('active', state.superSection === 'notificaciones');
      if (state.superSection === 'cobros' && isEmpresaLensSuper()) renderSuperCobrosSection();
      lucide.createIcons();
    }
    var headerAjustesBtnEl = document.getElementById('headerSuperAjustesBtn');
    if (headerAjustesBtnEl) headerAjustesBtnEl.addEventListener('click', function () { switchSuperSection('ajustes'); });
    var headerNotifBtnEl = document.getElementById('headerSuperNotifBtn');
    if (headerNotifBtnEl) headerNotifBtnEl.addEventListener('click', function () { switchSuperSection('notificaciones'); });
    document.querySelectorAll('.super-nav-btn').forEach(function (btn) {
      btn.onclick = function () {
        if (btn.dataset.superSection) switchSuperSection(btn.dataset.superSection);
      };
    });

    function closeNotifDropdown() {
      var dd = document.getElementById('notifDropdown');
      if (!dd) return;
      var wasOpen = !dd.classList.contains('hidden');
      dd.classList.add('hidden');
      if (wasOpen) {
        markTrialReminderAcknowledged();
        renderNotificationsMerged();
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    document.getElementById('notifBtn').addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      var dd = document.getElementById('notifDropdown');
      if (dd.classList.contains('hidden')) {
        dd.classList.remove('hidden');
        loadNotifications().then(function () {
          setNotifLastRead();
          renderNotificationsMerged();
        });
      } else closeNotifDropdown();
      lucide.createIcons();
    });
    document.getElementById('notifBtn').addEventListener('touchend', function (e) {
      e.preventDefault();
      document.getElementById('notifBtn').click();
    }, { passive: false });
    document.getElementById('notifDropdownClose').onclick = function () { closeNotifDropdown(); };
    document.addEventListener('click', function (e) {
      var dd = document.getElementById('notifDropdown');
      var btn = document.getElementById('notifBtn');
      if (dd && !dd.classList.contains('hidden') && btn && !dd.contains(e.target) && !btn.contains(e.target)) closeNotifDropdown();
    });
    // Carrito
    document.getElementById('cartBtn').onclick = openCart;
    document.getElementById('closeCart').onclick = closeCart;
    document.getElementById('cartOverlay').onclick = closeCart;
    document.getElementById('completeSale').onclick = completeSale;
    document.getElementById('closePaymentModal').onclick = closePaymentModal;
    document.getElementById('paymentModalOverlay').onclick = closePaymentModal;

    document.getElementById('btnCobroRapido').onclick = openCobroRapidoModal;
    document.getElementById('closeCobroRapido').onclick = closeCobroRapidoModal;
    document.getElementById('cobroRapidoOverlay').onclick = closeCobroRapidoModal;
    document.getElementById('cobroRapidoAgregarBtn').onclick = function () {
      var amount = parseInt((document.getElementById('cobroRapidoMonto').value || '').replace(/\D/g, ''), 10) || 0;
      if (amount <= 0) { alert('Ingresá un monto mayor a 0.'); return; }
      var productName = getCobroRapidoProductoNombre();
      var margen = getCobroRapidoProductoMargen();
      var costo = costoDesdeMargen(amount, margen);
      state.cobroRapidoItems = state.cobroRapidoItems || [];
      state.cobroRapidoItems.push({ nombre: productName, precio: amount, costo: costo });
      document.getElementById('cobroRapidoMonto').value = '';
      updateCobroRapidoLista();
    };
    document.querySelectorAll('.quick-payment-option').forEach(function (btn) {
      btn.onclick = function () {
        var method = btn.dataset.quickPayment;
        _selectedLibretaClienteForPayment = null;
        completeQuickSale(method, '', '').catch(function (err) {
          console.warn('Cobro rápido:', err && err.message ? err.message : err);
        });
      };
    });

    function showScanToast(msg, isError) {
      const el = document.getElementById('scanToast');
      const text = document.getElementById('scanToastText');
      text.textContent = msg;
      text.className = 'glass-strong rounded-xl px-4 py-3 text-sm font-medium shadow-lg ' + (isError ? 'text-red-300' : 'text-green-300');
      el.classList.remove('hidden');
      el.classList.add('flex');
      lucide.createIcons();
      setTimeout(() => { el.classList.add('hidden'); el.classList.remove('flex'); }, 2200);
    }
    function showStockWarning(msg) {
      const el = document.getElementById('scanToast');
      const text = document.getElementById('scanToastText');
      text.textContent = msg;
      text.className = 'glass-strong rounded-xl px-4 py-3 text-sm font-medium shadow-lg text-amber-300';
      el.classList.remove('hidden');
      el.classList.add('flex');
      lucide.createIcons();
      setTimeout(() => { el.classList.add('hidden'); el.classList.remove('flex'); }, 2000);
    }

    function openVentasProductosModal() {
      const list = state.transaccionesList || [];
      const agg = {};
      list.forEach(t => (t.items || []).forEach(it => {
        const k = it.codigo;
        if (!agg[k]) agg[k] = { nombre: it.nombre, codigo: it.codigo, cant: 0 };
        agg[k].cant += it.cant;
      }));
      const items = Object.values(agg).sort((a, b) => b.cant - a.cant);
      const el = document.getElementById('ventasProductosList');
      if (items.length === 0) {
        el.innerHTML = '<p class="text-white/60 py-4 text-center">Aún no hay productos vendidos hoy.</p>';
      } else {
        el.innerHTML = items.map(p => `
          <div class="glass rounded-xl p-3 flex justify-between items-center">
            <span class="font-medium truncate flex-1">${p.nombre}</span>
            <span class="text-[#f87171] font-semibold shrink-0 ml-2">${p.cant} un.</span>
          </div>
        `).join('');
      }
      document.getElementById('ventasProductosModal').classList.remove('hidden');
      document.getElementById('ventasProductosModal').classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ modal: 'ventasProductos' });
      lucide.createIcons();
    }
    function openTransaccionesModal() {
      const list = state.transaccionesList || [];
      const methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pendiente', cobro_libreta: 'Cobro libreta' };
      const el = document.getElementById('transaccionesList');
      if (list.length === 0) {
        el.innerHTML = '<p class="text-white/60 py-4 text-center">Aún no hay transacciones hoy.</p>';
      } else {
        const fmt = (s) => s ? new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
        el.innerHTML = list.slice().reverse().map(t => `
          <div class="glass rounded-xl p-4 border border-white/10">
            <div class="flex justify-between items-start mb-2">
              <span class="px-2 py-0.5 rounded text-xs bg-[#dc2626]/30">${methodLabels[t.method] || t.method}</span>
              <span class="font-bold text-[#f87171]">$${t.total.toLocaleString('es-AR')}</span>
            </div>
            <p class="text-white/40 text-[10px] mb-1">${fmt(t.fechaHora)}</p>
            <p class="text-white/60 text-xs mb-2">Cliente: ${t.client || '—'}</p>
            <ul class="space-y-1 text-xs">
              ${(t.items || []).map(i => `<li>${i.nombre} x ${i.cant} — $${(i.precio * i.cant).toLocaleString('es-AR')}</li>`).join('')}
            </ul>
          </div>
        `).join('');
      }
      document.getElementById('transaccionesModal').classList.remove('hidden');
      document.getElementById('transaccionesModal').classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ modal: 'transacciones' });
      lucide.createIcons();
    }
    function openVentasCobradasModal() {
      const raw = state.transaccionesList || [];
      const cobradas = raw.filter(function (t) {
        return t.method !== 'fiado' && t.method !== 'transferencia_pendiente';
      });
      var fiadoHoy = 0;
      var pendHoy = 0;
      raw.forEach(function (t) {
        var tot = Number(t.total) || 0;
        if (t.method === 'fiado') fiadoHoy += tot;
        else if (t.method === 'transferencia_pendiente') pendHoy += tot;
      });
      const methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pendiente', cobro_libreta: 'Cobro libreta' };
      const listEl = document.getElementById('ventasCobradasList');
      const footEl = document.getElementById('ventasCobradasFooter');
      if (listEl) {
        if (cobradas.length === 0) {
          listEl.innerHTML = '<div class="ventas-dia-empty">Aún no hay ventas del día (caja) en este dispositivo.</div>';
        } else {
          const fmt = (s) => s ? new Date(s).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
          listEl.innerHTML = cobradas.slice().reverse().map(function (t) {
            var meta = fmt(t.fechaHora) + ' · ' + (methodLabels[t.method] || t.method);
            var items = t.items || [];
            var itemsHtml = items.map(function (i) {
              var nombre = String(i.nombre || '—').replace(/</g, '&lt;');
              var cant = i.cant || 0;
              var sub = Number(i.precio) * cant;
              var etiqueta = cant > 1 ? nombre + ' ×' + cant : nombre;
              return '<div class="ventas-dia-row"><span class="ventas-dia-name">' + etiqueta + '</span><span class="ventas-dia-monto">$' + sub.toLocaleString('es-AR') + '</span></div>';
            }).join('');
            if (!itemsHtml) {
              itemsHtml = '<div class="ventas-dia-row"><span class="ventas-dia-name">Venta</span><span class="ventas-dia-monto">$' + Number(t.total).toLocaleString('es-AR') + '</span></div>';
            }
            return '<div class="ventas-dia-meta-row">' + meta.replace(/</g, '&lt;') + '</div>' + itemsHtml;
          }).join('');
        }
      }
      if (footEl) {
        var parts = [];
        if (fiadoHoy > 0) {
          parts.push('<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-amber-500/15 border border-amber-400/30 px-3 py-2">' +
            '<span class="text-amber-100/90">Fiado en cuenta hoy: <strong>$' + fiadoHoy.toLocaleString('es-AR') + '</strong></span>' +
            '<button type="button" class="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-amber-500/30 text-amber-100 border border-amber-400/40 touch-target" onclick="document.getElementById(\'closeVentasCobradas\').click();window._goToCajaLibreta && window._goToCajaLibreta();">Ver libreta</button></div>');
        }
        if (pendHoy > 0) {
          parts.push('<div class="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-2 rounded-xl bg-orange-500/15 border border-orange-400/30 px-3 py-2">' +
            '<span class="text-orange-100/90">Transf. pendiente hoy: <strong>$' + pendHoy.toLocaleString('es-AR') + '</strong></span>' +
            '<button type="button" class="shrink-0 text-xs font-semibold px-3 py-1.5 rounded-lg bg-orange-500/30 text-orange-100 border border-orange-400/40 touch-target" onclick="document.getElementById(\'closeVentasCobradas\').click();window._goToCajaLibreta && window._goToCajaLibreta();">Ver libreta</button></div>');
        }
        if (parts.length === 0) {
          footEl.innerHTML = '<p class="text-white/40 text-center py-1">Sin fiado ni transf. pendiente registrados hoy.</p>';
        } else {
          footEl.innerHTML = parts.join('');
        }
      }
      var modal = document.getElementById('ventasCobradasModal');
      if (modal) modal.classList.remove('hidden');
      if (!state._restoringFromHistory) pushHistoryExtra({ modal: 'ventasCobradas' });
      try {
        if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
      } catch (_) {}
    }
    window._openVentasDelDia = openVentasCobradasModal;
    var btnVentasCardEl = document.getElementById('btnVentasCard');
    if (btnVentasCardEl) btnVentasCardEl.onclick = openVentasProductosModal;
    var btnTransCardEl = document.getElementById('btnTransCard');
    if (btnTransCardEl) btnTransCardEl.onclick = openTransaccionesModal;
    var btnVentasDelDia = document.getElementById('btnVentasDelDia');
    if (btnVentasDelDia) btnVentasDelDia.onclick = openVentasCobradasModal;
    document.getElementById('closeVentasProductos').onclick = () => {
      document.getElementById('ventasProductosModal').classList.add('hidden');
      document.getElementById('ventasProductosModal').classList.remove('flex');
      if (!state._restoringFromHistory && history.state && history.state.modal === 'ventasProductos') {
        var nv = Object.assign({}, history.state);
        delete nv.modal;
        history.replaceState(nv, '', location.href);
      }
    };
    document.getElementById('ventasProductosOverlay').onclick = () => document.getElementById('closeVentasProductos').click();
    document.getElementById('closeTransacciones').onclick = () => {
      document.getElementById('transaccionesModal').classList.add('hidden');
      document.getElementById('transaccionesModal').classList.remove('flex');
      if (!state._restoringFromHistory && history.state && history.state.modal === 'transacciones') {
        var nt = Object.assign({}, history.state);
        delete nt.modal;
        history.replaceState(nt, '', location.href);
      }
    };
    document.getElementById('transaccionesOverlay').onclick = () => document.getElementById('closeTransacciones').click();
    document.getElementById('closeVentasCobradas').onclick = function () {
      var m = document.getElementById('ventasCobradasModal');
      if (m) m.classList.add('hidden');
      if (!state._restoringFromHistory && history.state && history.state.modal === 'ventasCobradas') {
        var nv = Object.assign({}, history.state);
        delete nv.modal;
        history.replaceState(nv, '', location.href);
      }
    };
    var ventasCobradasOv = document.getElementById('ventasCobradasOverlay');
    if (ventasCobradasOv) ventasCobradasOv.onclick = function () { document.getElementById('closeVentasCobradas').click(); };

    const methodLabels = { efectivo: 'Efectivo', tarjeta: 'Tarjeta', transferencia: 'Transferencia', fiado: 'Fiado', transferencia_pendiente: 'Transf. pend.', cobro_libreta: 'Cobro libreta' };
    function getHistorialRange(filter) {
      const now = new Date();
      const start = new Date(now);
      start.setHours(0, 0, 0, 0);
      const end = new Date(now);
      end.setHours(23, 59, 59, 999);
      if (filter === 'hoy') return { start: start.toISOString(), end: end.toISOString() };
      if (filter === 'ayer') {
        start.setDate(start.getDate() - 1);
        end.setDate(end.getDate() - 1);
        end.setHours(23, 59, 59, 999);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      if (filter === 'semana') {
        const day = start.getDay();
        const diff = day === 0 ? 6 : day - 1;
        start.setDate(start.getDate() - diff);
        start.setHours(0, 0, 0, 0);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      if (filter === 'semana_pasada') {
        const day = start.getDay();
        const diff = day === 0 ? 6 : day - 1;
        start.setDate(start.getDate() - diff - 7);
        start.setHours(0, 0, 0, 0);
        end.setDate(end.getDate() - diff - 1);
        end.setHours(23, 59, 59, 999);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      if (filter === 'mes') {
        start.setMonth(start.getMonth() - 1);
        start.setHours(0, 0, 0, 0);
        return { start: start.toISOString(), end: end.toISOString() };
      }
      start.setMonth(start.getMonth() - 2);
      start.setHours(0, 0, 0, 0);
      return { start: start.toISOString(), end: end.toISOString() };
    }
    async function renderHistorial(filter) {
      const listEl = document.getElementById('historialList');
      if (!listEl) return;
      if (typeof applyHistorialFilterUI === 'function') applyHistorialFilterUI(filter);
      const range = getHistorialRange(filter);
      if (!supabaseClient || !currentUser?.id) {
        listEl.innerHTML = '<p class="text-white/60 py-4">Configurá Supabase para ver el historial.</p>';
        lucide.createIcons();
        return;
      }
      const { data: rows, error } = await supabaseClient.from('ventas').select('id, fecha_hora, total, metodo_pago, cliente_nombre, items').eq('user_id', currentUser.id).gte('fecha_hora', range.start).lte('fecha_hora', range.end).order('fecha_hora', { ascending: false });
      if (error) {
        listEl.innerHTML = '<p class="text-white/60 py-4">No existe la tabla ventas. Creala en Supabase (ver comentarios en el código).</p>';
        lucide.createIcons();
        return;
      }
      const list = rows || [];
      if (list.length === 0) {
        listEl.innerHTML = '<p class="text-white/60 py-4 text-center">No hay ventas en este período.</p>';
        lucide.createIcons();
        return;
      }
      state.historialRows = list;
      listEl.innerHTML = list.map((v, idx) => {
        var cliente = (v.cliente_nombre || '').trim();
        if (!cliente) cliente = 'Sin nombre';
        cliente = cliente.replace(/</g, '&lt;');
        return '<button type="button" class="historial-venta-row w-full flex items-center justify-between gap-3 py-3 px-3 rounded-xl border-b border-white/10 hover:bg-white/5 active:bg-[#dc2626]/20 text-left touch-target transition-colors" data-index="' + idx + '"><span class="font-medium truncate min-w-0">' + cliente + '</span><span class="font-bold text-[#f87171] shrink-0">$' + Number(v.total).toLocaleString('es-AR') + '</span></button>';
      }).join('');
      listEl.querySelectorAll('.historial-venta-row').forEach(btn => {
        btn.onclick = function () {
          var idx = parseInt(btn.dataset.index, 10);
          if (state.historialRows && state.historialRows[idx]) openDetalleVentaModal(state.historialRows[idx]);
        };
      });
      lucide.createIcons();
    }
    document.getElementById('historialFiltroBtn').onclick = function () {
      var dd = document.getElementById('historialFiltroDropdown');
      if (dd) dd.classList.toggle('hidden');
      lucide.createIcons();
    };
    document.querySelectorAll('.historial-filter').forEach(btn => {
      btn.onclick = function () {
        state.historialFilter = btn.dataset.filter;
        var dd = document.getElementById('historialFiltroDropdown');
        if (dd) dd.classList.add('hidden');
        applyHistorialFilterUI(btn.dataset.filter);
        renderHistorial(btn.dataset.filter);
        lucide.createIcons();
      };
    });
    function applyHistorialFilterUI(filter) {
      var filterLabels = { hoy: 'Hoy', ayer: 'Ayer', semana: 'Esta semana', semana_pasada: 'Semana pasada', mes: 'Último mes', '2meses': 'Últimos 2 meses' };
      var filtroBtn = document.getElementById('historialFiltroBtn');
      var filtroLabel = filtroBtn && filtroBtn.querySelector('.historial-filtro-label');
      if (filtroBtn) filtroBtn.dataset.filter = filter;
      if (filtroLabel) filtroLabel.textContent = filterLabels[filter] || filter;
      document.querySelectorAll('.historial-chip').forEach(function (chip) {
        var active = chip.dataset.filter === filter;
        chip.className = 'historial-chip px-2.5 py-1.5 rounded-xl text-xs font-medium touch-target transition-all border ' + (active ? 'bg-[#dc2626]/30 border-[#dc2626]/50' : 'border-white/20');
      });
    }
    document.querySelectorAll('.historial-chip').forEach(function (btn) {
      btn.onclick = function () {
        state.historialFilter = btn.dataset.filter;
        document.getElementById('historialFiltroDropdown').classList.add('hidden');
        applyHistorialFilterUI(btn.dataset.filter);
        renderHistorial(btn.dataset.filter);
        lucide.createIcons();
      };
    });
    document.addEventListener('click', function (e) {
      var dd = document.getElementById('historialFiltroDropdown');
      var btn = document.getElementById('historialFiltroBtn');
      if (dd && !dd.classList.contains('hidden') && btn && !dd.contains(e.target) && !btn.contains(e.target)) dd.classList.add('hidden');
    });
    let clientesCache = [];
    async function loadClientes() {
      if (!supabaseClient || !currentUser?.id) return [];
      const { data } = await supabaseClient.from('clientes').select('*').eq('user_id', currentUser.id).order('nombre');
      clientesCache = data || [];
      return clientesCache;
    }
    function renderClientes() {
      const listEl = document.getElementById('clientesList');
      const searchEl = document.getElementById('clientesSearch');
      if (!listEl) return;
      const q = (searchEl?.value || '').toLowerCase().trim();
      const list = q ? clientesCache.filter(c => (c.nombre || '').toLowerCase().includes(q) || (c.telefono || '').includes(q) || (c.email || '').toLowerCase().includes(q)) : clientesCache;
      if (clientesCache.length === 0) {
        listEl.innerHTML = '<p class="text-white/60 py-4 text-center">No hay clientes. Agregá uno con el botón.</p>';
      } else if (list.length === 0) {
        listEl.innerHTML = '<p class="text-white/60 py-4 text-center">Ningún cliente coincide con la búsqueda.</p>';
      } else {
        listEl.innerHTML = list.map(c => `
          <div class="glass rounded-xl p-3 border border-white/10 flex flex-col sm:flex-row sm:items-center gap-2">
            <div class="flex-1 min-w-0">
              <p class="font-medium">${(c.nombre || '—').replace(/</g, '&lt;')}</p>
              <p class="text-xs text-white/60">${(c.telefono || '—').replace(/</g, '&lt;')}</p>
              ${c.email ? `<p class="text-xs text-white/50">${(c.email || '').replace(/</g, '&lt;')}</p>` : ''}
              ${c.direccion ? `<p class="text-xs text-white/50 truncate">${(c.direccion || '').replace(/</g, '&lt;')}</p>` : ''}
            </div>
            <div class="flex gap-1 shrink-0">
              <button type="button" class="edit-cliente-btn px-2 py-1 rounded-lg text-xs bg-white/10 border border-white/20" data-id="${c.id}">Editar</button>
              <button type="button" class="delete-cliente-btn px-2 py-1 rounded-lg text-xs bg-red-500/20 text-red-300 border border-red-500/40" data-id="${c.id}">Eliminar</button>
            </div>
          </div>
        `).join('');
        listEl.querySelectorAll('.edit-cliente-btn').forEach(b => { b.onclick = () => openClienteModal(b.dataset.id); });
        listEl.querySelectorAll('.delete-cliente-btn').forEach(b => { b.onclick = () => deleteCliente(b.dataset.id); });
      }
      lucide.createIcons();
    }
    function openClienteModal(id) {
      document.getElementById('clienteModalTitle').textContent = id ? 'Editar cliente' : 'Nuevo cliente';
      document.getElementById('clienteId').value = id || '';
      if (id) {
        const c = clientesCache.find(x => x.id === id);
        if (c) {
          document.getElementById('clienteNombre').value = c.nombre || '';
          document.getElementById('clienteTelefono').value = c.telefono || '';
          document.getElementById('clienteEmail').value = c.email || '';
          document.getElementById('clienteDireccion').value = c.direccion || '';
          document.getElementById('clienteNotas').value = c.notas || '';
        }
      } else {
        document.getElementById('clienteNombre').value = '';
        document.getElementById('clienteTelefono').value = '';
        document.getElementById('clienteEmail').value = '';
        document.getElementById('clienteDireccion').value = '';
        document.getElementById('clienteNotas').value = '';
      }
      document.getElementById('clienteModal').classList.remove('hidden');
      document.getElementById('clienteModal').classList.add('flex');
    }
    async function saveCliente() {
      const id = document.getElementById('clienteId').value.trim();
      const nombre = document.getElementById('clienteNombre').value.trim();
      const telefono = document.getElementById('clienteTelefono').value.trim();
      const email = document.getElementById('clienteEmail').value.trim();
      const direccion = document.getElementById('clienteDireccion').value.trim();
      const notas = document.getElementById('clienteNotas').value.trim();
      if (!nombre && !telefono) { alert('Nombre o teléfono es obligatorio.'); return; }
      if (!supabaseClient || !currentUser?.id) return;
      const row = { user_id: currentUser.id, nombre: nombre || null, telefono: telefono || null, email: email || null, direccion: direccion || null, notas: notas || null };
      if (id) {
        await supabaseClient.from('clientes').update(row).eq('id', id).eq('user_id', currentUser.id);
      } else {
        await supabaseClient.from('clientes').insert(row);
      }
      await loadClientes();
      renderClientes();
      document.getElementById('clienteModal').classList.add('hidden');
      document.getElementById('clienteModal').classList.remove('flex');
    }
    async function deleteCliente(id) {
      if (!confirm('¿Eliminar este cliente?')) return;
      if (!supabaseClient || !currentUser?.id) return;
      await supabaseClient.from('clientes').delete().eq('id', id).eq('user_id', currentUser.id);
      await loadClientes();
      renderClientes();
    }
    document.getElementById('btnAddCliente').onclick = () => openClienteModal();
    document.getElementById('saveCliente').onclick = saveCliente;
    document.getElementById('clienteModalOverlay').onclick = () => { document.getElementById('clienteModal').classList.add('hidden'); document.getElementById('clienteModal').classList.remove('flex'); };
    document.getElementById('clientesSearch').addEventListener('input', () => renderClientes());

    document.querySelectorAll('[data-payment]').forEach(btn => {
      btn.onclick = () => {
        const method = btn.dataset.payment;
        _selectedLibretaClienteForPayment = null;
        completeSaleWithMethod(method, '', '');
        if (document.getElementById('cartClientName')) document.getElementById('cartClientName').value = '';
      };
    });

    // Manual add (usa misma búsqueda que escáner para códigos con/sin ceros)
    const doManualAdd = () => {
      const code = document.getElementById('manualCode').value.trim();
      if (!code) return;
      const data = getData();
      const found = findProductByCode(data.products, code);
      if (found && found.product.stock > 0) {
        addToCart(found.codigo);
        playBeep();
        showScanToast('Agregado: ' + found.product.nombre, false);
      } else if (found && found.product.stock <= 0) {
        showScanToast('Sin stock: ' + found.product.nombre, true);
      } else {
        showScanToast('Producto no encontrado', true);
      }
      document.getElementById('manualCode').value = '';
    };
    document.getElementById('manualAdd').onclick = doManualAdd;
    document.getElementById('manualCode').addEventListener('keydown', e => { if (e.key === 'Enter') doManualAdd(); });

    // Escáner con BarcodeDetector — normaliza código para mejorar detección
    let scannerStream = null;
    let scanInterval = null;
    let lastScannedCode = '';
    let lastScanTime = 0;
    const SCAN_COOLDOWN_MS = 2500;
    const video = document.getElementById('scannerVideo');
    const canvas = document.getElementById('scannerCanvas');
    const ctx = canvas.getContext('2d');

    function normalizeBarcode(raw) {
      return String(raw || '').trim().replace(/\s/g, '');
    }
    function findProductByCode(products, code) {
      if (!products || !code) return null;
      const n = normalizeBarcode(code);
      if (products[n]) return { codigo: n, product: products[n] };
      const stripZeros = s => String(s).replace(/^0+/, '') || s;
      const nStripped = stripZeros(n);
      for (const [k, p] of Object.entries(products)) {
        if (k === n || stripZeros(k) === nStripped) return { codigo: k, product: p };
      }
      if (n.length >= 3) {
        const match = Object.keys(products).find(k => k.endsWith(n) || n.endsWith(k) || k.includes(n) || n.includes(k));
        if (match) return { codigo: match, product: products[match] };
      }
      return null;
    }

    async function scanFrame() {
      if (!scannerStream || video.readyState !== 4) return;
      if (typeof BarcodeDetector === 'undefined') return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const codes = await new BarcodeDetector().detect(canvas);
        if (codes.length) {
          const rawCode = codes[0].rawValue;
          const now = Date.now();
          if (rawCode === lastScannedCode && now - lastScanTime < SCAN_COOLDOWN_MS) return;
          if (window._scanForProductCode) {
            lastScannedCode = rawCode;
            lastScanTime = now;
            var prodCodigoEl = document.getElementById('prodCodigo');
            if (prodCodigoEl) prodCodigoEl.value = rawCode;
            window._scanForProductCode = false;
            goToPanel('inventory');
            document.getElementById('productModal').classList.remove('hidden');
            document.getElementById('productModal').classList.add('flex');
            lucide.createIcons();
            return;
          }
          const data = getData();
          const found = findProductByCode(data.products, rawCode);
          if (found && found.product.stock > 0) {
            lastScannedCode = rawCode;
            lastScanTime = now;
            addToCart(found.codigo);
            playBeep();
            showScanToast('Agregado: ' + found.product.nombre, false);
          } else if (found && found.product.stock <= 0) {
            lastScannedCode = rawCode;
            lastScanTime = now;
            showScanToast('Sin stock: ' + found.product.nombre, true);
          } else {
            lastScannedCode = rawCode;
            lastScanTime = now;
            showScanToast('Producto no encontrado (código: ' + normalizeBarcode(rawCode) + ')', true);
          }
        }
      } catch (_) {}
    }

    function stopScanInterval() {
      if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    }
    window._stopScannerInterval = stopScanInterval;
    async function startScannerCamera() {
      if (scannerStream) return;
      try {
        scannerStream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: 'environment' } });
        video.srcObject = scannerStream;
        await video.play();
      } catch (e) {
        alert('No se pudo acceder a la cámara');
      }
    }
    window._startScannerCamera = startScannerCamera;
    var scanHoldBtn = document.getElementById('scanHoldBtn');
    if (scanHoldBtn) {
      scanHoldBtn.addEventListener('pointerdown', async function (e) {
        e.preventDefault();
        await startScannerCamera();
        if (scannerStream && typeof BarcodeDetector !== 'undefined' && !scanInterval) scanInterval = setInterval(scanFrame, 400);
      });
      scanHoldBtn.addEventListener('pointerup', stopScanInterval);
      scanHoldBtn.addEventListener('pointerleave', stopScanInterval);
      scanHoldBtn.addEventListener('pointercancel', stopScanInterval);
    }

    window.addEventListener('visibilitychange', () => {
      if (document.hidden) stopScanInterval();
    });

    // Generar ticket digital
    document.getElementById('generateTicket').onclick = async () => {
      const d = getData();
      const mT = await getMetricasDelDia();
      const v = d.ventas || {};
      const totalIngresos = mT.total;
      const cobroLib = mT.cobro_libreta || 0;
      const fiado = mT.fiado || 0;
      const transfPend = mT.transferencia_pendiente || 0;
      const utilidadDiaTicket = Math.round(mT.ganancia || 0);
      const t = document.getElementById('ticketContent');
      t.classList.remove('hidden');
      document.getElementById('ticketFecha').textContent = new Date().toLocaleString('es-AR');
      document.getElementById('ticketBody').innerHTML = `
        <p>Efectivo: $${(mT.efectivo || 0).toLocaleString('es-AR')}</p>
        <p>Tarjeta: $${(mT.tarjeta || 0).toLocaleString('es-AR')}</p>
        <p>Transferencia: $${(mT.transferencia || 0).toLocaleString('es-AR')}</p>
        <p>Cobro libreta: $${cobroLib.toLocaleString('es-AR')}</p>
        <p class="text-white/60 text-sm">Fiado (cuenta, no ingreso hasta cobrar): $${fiado.toLocaleString('es-AR')}</p>
        <p class="text-white/60 text-sm">Transf. pendiente: $${transfPend.toLocaleString('es-AR')}</p>
        <p>Cant. movimientos: ${d.transacciones || 0}</p>
        <p class="text-green-400">Ganancia del día (precio − costo): $${utilidadDiaTicket.toLocaleString('es-AR')}</p>
      `;
      document.getElementById('ticketTotal').textContent = `Ingresos de caja: $${totalIngresos.toLocaleString('es-AR')}`;
      const texto = `FERRIOL OS - Cierre de Caja\n${new Date().toLocaleString('es-AR')}\n\nEfectivo: $${(mT.efectivo || 0).toLocaleString('es-AR')}\nTarjeta: $${(mT.tarjeta || 0).toLocaleString('es-AR')}\nTransferencia: $${(mT.transferencia || 0).toLocaleString('es-AR')}\nCobro libreta: $${cobroLib.toLocaleString('es-AR')}\n— Fiado (cuenta): $${fiado.toLocaleString('es-AR')}\n— Transf. pendiente: $${transfPend.toLocaleString('es-AR')}\nCant. movimientos: ${d.transacciones || 0}\nGanancia del día (precio − costo): $${utilidadDiaTicket.toLocaleString('es-AR')}\n\nIngresos de caja: $${totalIngresos.toLocaleString('es-AR')}`;
      if (navigator.share) {
        try {
          await navigator.share({
            title: 'Cierre de Caja - Ferriol OS',
            text: texto
          });
        } catch (e) { if (e.name !== 'AbortError') navigator.clipboard?.writeText(texto); }
      } else {
        navigator.clipboard?.writeText(texto);
      }
      t.classList.add('hidden');
    };

    function _monthBoundsLocal(d) {
      var y = d.getFullYear();
      var m = d.getMonth();
      var pad = function (n) { return (n < 10 ? '0' : '') + n; };
      var startDate = y + '-' + pad(m + 1) + '-01';
      var lastD = new Date(y, m + 1, 0);
      var endDate = y + '-' + pad(m + 1) + '-' + pad(lastD.getDate());
      var start = new Date(y, m, 1, 0, 0, 0, 0);
      var end = new Date(y, m + 1, 0, 23, 59, 59, 999);
      var todayStr = y + '-' + pad(m + 1) + '-' + pad(d.getDate());
      return {
        startDate: startDate,
        endDate: endDate,
        startISO: start.toISOString(),
        endISO: end.toISOString(),
        label: start.toLocaleString('es-AR', { month: 'long', year: 'numeric' }),
        todayStr: todayStr
      };
    }

    async function renderResumenMensualCaja() {
      var labelEl = document.getElementById('cajaMesLabel');
      var fuenteEl = document.getElementById('cajaMesIngresosFuente');
      var ingEl = document.getElementById('cajaMesIngresos');
      var gfEl = document.getElementById('cajaMesGastosFijos');
      var gpEl = document.getElementById('cajaMesGastosProv');
      var gtEl = document.getElementById('cajaMesGastosTotal');
      var balEl = document.getElementById('cajaMesBalance');
      var notaEl = document.getElementById('cajaMesNota');
      if (!labelEl || !ingEl) return;
      var now = new Date();
      var mb = _monthBoundsLocal(now);
      labelEl.textContent = mb.label;
      if (fuenteEl) {
        fuenteEl.classList.add('hidden');
        fuenteEl.textContent = '';
      }
      if (!supabaseClient || !currentUser?.id) {
        ingEl.textContent = '—';
        if (gfEl) gfEl.textContent = '—';
        if (gpEl) gpEl.textContent = '—';
        if (gtEl) gtEl.textContent = '—';
        if (balEl) { balEl.textContent = '—'; balEl.className = 'font-bold text-xl shrink-0 text-white/50'; }
        if (notaEl) notaEl.textContent = 'Configurá Supabase para ver ingresos, gastos y balance del mes.';
        try { lucide.createIcons(); } catch (_) {}
        return;
      }
      var uid = currentUser.id;
      var ingresos = null;
      var fuente = '';
      try {
        var vres = await supabaseClient.from('ventas').select('total, metodo_pago').eq('user_id', uid).gte('fecha_hora', mb.startISO).lte('fecha_hora', mb.endISO);
        if (!vres.error && Array.isArray(vres.data)) {
          ingresos = vres.data.reduce(function (s, v) {
            var metodo = (v.metodo_pago || '').toLowerCase().replace(/\s/g, '_');
            if (metodo === 'fiado' || metodo === 'transferencia_pendiente') return s;
            return s + (Number(v.total) || 0);
          }, 0);
          fuente = 'Ingresos: suma de ventas del mes (efectivo, tarjeta, transferencia y cobro libreta). Fiado y transf. pendiente no suman.';
        }
      } catch (_) {}
      if (ingresos === null) {
        ingresos = 0;
        try {
          var cres = await supabaseClient.from('cierres_caja').select('fecha, total_facturado').eq('user_id', uid).gte('fecha', mb.startDate).lte('fecha', mb.endDate);
          if (!cres.error && Array.isArray(cres.data)) {
            var fechasCierre = {};
            cres.data.forEach(function (r) {
              ingresos += Number(r.total_facturado) || 0;
              fechasCierre[(r.fecha || '').toString().slice(0, 10)] = true;
            });
            if (!fechasCierre[mb.todayStr]) {
              var mLive = await getMetricasDelDia();
              ingresos += mLive.total || 0;
              fuente = 'Ingresos: cierres guardados este mes más lo vendido hoy (aún sin cerrar). Si falta el historial de ventas, este modo es el que aplica.';
            } else {
              fuente = 'Ingresos: solo cierres de caja guardados en el mes (no se pudo usar la tabla ventas).';
            }
          } else {
            fuente = 'No se pudieron leer ventas ni cierres para el mes.';
          }
        } catch (_) {
          fuente = 'Error al calcular ingresos del mes.';
        }
      }
      var gastosF = 0;
      var gastosP = 0;
      try {
        var gres = await supabaseClient.from('gastos').select('tipo, monto').eq('user_id', uid).gte('fecha', mb.startDate).lte('fecha', mb.endDate);
        if (!gres.error && Array.isArray(gres.data)) {
          gres.data.forEach(function (r) {
            var mo = Number(r.monto) || 0;
            if (r.tipo === 'proveedor') gastosP += mo;
            else if (r.tipo === 'gasto_fijo') gastosF += mo;
            else gastosP += mo;
          });
        }
      } catch (_) {}
      var gastosTot = gastosF + gastosP;
      var balance = ingresos - gastosTot;
      ingEl.textContent = '$' + Math.round(ingresos).toLocaleString('es-AR');
      if (gfEl) gfEl.textContent = '−$' + Math.round(gastosF).toLocaleString('es-AR');
      if (gpEl) gpEl.textContent = '−$' + Math.round(gastosP).toLocaleString('es-AR');
      if (gtEl) gtEl.textContent = '−$' + Math.round(gastosTot).toLocaleString('es-AR');
      if (balEl) {
        balEl.textContent = (balance >= 0 ? '' : '−') + '$' + Math.abs(Math.round(balance)).toLocaleString('es-AR');
        balEl.className = 'font-bold text-xl shrink-0 ' + (balance >= 0 ? 'text-[#86efac]' : 'text-red-300');
      }
      if (fuenteEl && fuente) {
        fuenteEl.textContent = fuente;
        fuenteEl.classList.remove('hidden');
      }
      if (notaEl) {
        notaEl.textContent = 'Balance aproximado: ingresos cobrados del mes menos gastos fijos y pagos a proveedores registrados con fecha en el mes. No incluye stock ni impuestos.';
      }
      try { lucide.createIcons(); } catch (_) {}
    }

    async function renderCierresCajaHistorial() {
      var listEl = document.getElementById('cierresCajaList');
      if (!listEl) return;
      if (!supabaseClient || !currentUser?.id) {
        listEl.innerHTML = '<p class="text-white/50 text-center py-4">Configurá Supabase para ver el historial.</p>';
        lucide.createIcons();
        return;
      }
      try {
        var res = await supabaseClient.from('cierres_caja').select('id, fecha, fecha_cierre, total_facturado, ganancia').eq('user_id', currentUser.id).order('fecha_cierre', { ascending: false }).limit(50);
        if (res.error) throw res.error;
        var rows = res.data || [];
        if (rows.length === 0) {
          listEl.innerHTML = '<p class="text-white/50 text-center py-4">Aún no hay cierres guardados.</p>';
        } else {
          listEl.innerHTML = rows.map(function (r) {
            var fecha = (r.fecha || r.fecha_cierre || '').toString().slice(0, 10);
            var total = Number(r.total_facturado || 0);
            var gan = Number(r.ganancia || 0);
            return '<div class="glass rounded-xl p-3 border border-white/10 flex justify-between items-center gap-2"><div><span class="text-white/70">' + fecha + '</span></div><div class="text-right"><span class="font-semibold text-[#f87171]">$' + total.toLocaleString('es-AR') + '</span><span class="text-green-400/90 text-xs ml-2">$' + Math.round(gan).toLocaleString('es-AR') + ' gan.</span></div></div>';
          }).join('');
        }
      } catch (e) {
        listEl.innerHTML = '<p class="text-white/50 text-center py-4">Creá la tabla cierres_caja en Supabase (ver comentarios en el código).</p>';
      }
      lucide.createIcons();
    }
    document.getElementById('cerrarCaja').onclick = async () => {
      if (!confirm('¿Reiniciar caja? Se mantendrá el inventario y los productos vendidos volverán a cero para el nuevo día.')) return;
      var m = await getMetricasDelDia();
      if (supabaseClient && currentUser?.id) {
        try {
          var hoy = new Date().toISOString().slice(0, 10);
          await supabaseClient.from('cierres_caja').insert({ user_id: currentUser.id, fecha: hoy, fecha_cierre: new Date().toISOString(), total_facturado: m.total, ganancia: Math.round(m.ganancia) });
        } catch (_) {}
      }
      var d = getData();
      d.ventas = { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 };
      d.transacciones = 0;
      d.lastCierreDate = new Date().toISOString().slice(0, 10);
      state.transaccionesList = [];
      Object.keys(d.products || {}).forEach(function (codigo) {
        var p = d.products[codigo];
        if (p) p.stockInicial = p.stock;
      });
      setData(d);
      updateDashboard();
      renderCierresCajaHistorial();
      renderResumenMensualCaja();
    };

    // ============================================================
    // GASTOS Y PROVEEDORES
    // ============================================================
    var _gastosFiltro = { proveedor: 'hoy', gasto_fijo: 'hoy' };

    function _fechaDesde(filtro) {
      var hoy = new Date();
      if (filtro === 'hoy') return hoy.toISOString().slice(0, 10);
      if (filtro === 'semana') { var d = new Date(hoy); d.setDate(hoy.getDate() - 6); return d.toISOString().slice(0, 10); }
      if (filtro === 'mes') { var d = new Date(hoy); d.setDate(1); return d.toISOString().slice(0, 10); }
      return hoy.toISOString().slice(0, 10);
    }

    async function loadGastos(tipo) {
      if (!supabaseClient || !currentUser?.id) return [];
      try {
        var desde = _fechaDesde(_gastosFiltro[tipo]);
        var res = await supabaseClient.from('gastos')
          .select('id, tipo, descripcion, monto, fecha, created_at')
          .eq('user_id', currentUser.id).eq('tipo', tipo).gte('fecha', desde)
          .order('fecha', { ascending: false }).order('created_at', { ascending: false });
        if (res.error) throw res.error;
        return res.data || [];
      } catch (e) { return []; }
    }

    async function renderGastos(tipo) {
      var listId = tipo === 'proveedor' ? 'proveedoresList' : 'gastosList';
      var resumenId = tipo === 'proveedor' ? 'proveedoresResumen' : 'gastosResumen';
      var totalId = tipo === 'proveedor' ? 'proveedoresTotalText' : 'gastosTotalText';
      var listEl = document.getElementById(listId);
      var resumenEl = document.getElementById(resumenId);
      var totalEl = document.getElementById(totalId);
      if (!listEl) return;
      listEl.innerHTML = '<p class="text-white/50 text-center py-4">Cargando...</p>';
      var rows = await loadGastos(tipo);
      if (rows.length === 0) {
        listEl.innerHTML = '<p class="text-white/50 text-center py-4">Sin registros para este período.</p>';
        if (resumenEl) resumenEl.classList.add('hidden');
        lucide.createIcons(); return;
      }
      var total = rows.reduce(function (s, r) { return s + Number(r.monto || 0); }, 0);
      if (totalEl) totalEl.textContent = '$' + Math.round(total).toLocaleString('es-AR');
      if (resumenEl) resumenEl.classList.remove('hidden');
      listEl.innerHTML = rows.map(function (r) {
        var desc = r.descripcion || '';
        var fecha = (r.fecha || '').toString().slice(0, 10);
        var monto = Number(r.monto || 0);
        var icono = tipo === 'proveedor' ? 'truck' : 'receipt';
        return '<div class="gasto-item glass rounded-xl px-4 py-3 border border-white/10 flex items-center gap-3">' +
          '<i data-lucide="' + icono + '" class="w-4 h-4 text-[#86efac] shrink-0"></i>' +
          '<div class="flex-1 min-w-0"><p class="font-medium text-sm truncate">' + desc.replace(/</g,'&lt;') + '</p>' +
          '<p class="text-xs text-white/50">' + fecha + '</p></div>' +
          '<div class="flex items-center gap-2 shrink-0">' +
          '<span class="font-bold text-sm text-red-300">−$' + Math.round(monto).toLocaleString('es-AR') + '</span>' +
          '<button onclick="window._eliminarGasto(\'' + r.id + '\',\'' + tipo + '\')" class="p-1.5 rounded-lg hover:bg-red-500/20 touch-target transition-colors" title="Eliminar"><i data-lucide="trash-2" class="w-3.5 h-3.5 text-red-400/70"></i></button>' +
          '</div></div>';
      }).join('');
      lucide.createIcons();
    }

    window._switchCajaTab = function (tab) {
      var hub = document.getElementById('caja-hub');
      var subs = ['cierre', 'proveedores', 'gastos'];
      if (tab === 'hub') {
        if (hub) hub.classList.remove('hidden');
        subs.forEach(function (s) { var el = document.getElementById('caja-sub-' + s); if (el) el.classList.add('hidden'); });
        return;
      }
      if (hub) hub.classList.add('hidden');
      subs.forEach(function (s) { var el = document.getElementById('caja-sub-' + s); if (el) el.classList.add('hidden'); });
      var sub = document.getElementById('caja-sub-' + tab);
      if (sub) sub.classList.remove('hidden');
      if (tab === 'cierre') {
        renderCierresCajaHistorial();
        renderResumenMensualCaja();
      }
      if (tab === 'proveedores') { _resetFormInline('proveedor'); renderGastos('proveedor'); }
      if (tab === 'gastos') { _resetFormInline('gasto_fijo'); renderGastos('gasto_fijo'); }
      lucide.createIcons();
    };

    function _resetFormInline(tipo) {
      var hoy = new Date().toISOString().slice(0, 10);
      if (tipo === 'proveedor') {
        var n = document.getElementById('provNombre'); if (n) n.value = '';
        var d = document.getElementById('provDescripcion'); if (d) d.value = '';
        var m = document.getElementById('provMonto'); if (m) m.value = '';
        var f = document.getElementById('provFecha'); if (f) f.value = hoy;
        var e = document.getElementById('provErr'); if (e) e.classList.add('hidden');
      } else {
        var d = document.getElementById('gastoDescInline'); if (d) d.value = '';
        var m = document.getElementById('gastoMontoInline'); if (m) m.value = '';
        var f = document.getElementById('gastoFechaInline'); if (f) f.value = hoy;
        var e = document.getElementById('gastoErrInline'); if (e) e.classList.add('hidden');
      }
    }

    window._guardarGastoInline = async function (tipo) {
      var errId = tipo === 'proveedor' ? 'provErr' : 'gastoErrInline';
      var errEl = document.getElementById(errId);
      if (errEl) errEl.classList.add('hidden');
      var descripcionFinal = '';
      var monto = 0;
      var fecha = '';
      if (tipo === 'proveedor') {
        var nombre = (document.getElementById('provNombre').value || '').trim();
        var desc = (document.getElementById('provDescripcion').value || '').trim();
        monto = parseFloat(document.getElementById('provMonto').value) || 0;
        fecha = document.getElementById('provFecha').value;
        if (!nombre) { if (errEl) { errEl.textContent = 'Ingresá el nombre del proveedor.'; errEl.classList.remove('hidden'); } return; }
        descripcionFinal = nombre + (desc ? ' — ' + desc : '');
      } else {
        var desc = (document.getElementById('gastoDescInline').value || '').trim();
        monto = parseFloat(document.getElementById('gastoMontoInline').value) || 0;
        fecha = document.getElementById('gastoFechaInline').value;
        if (!desc) { if (errEl) { errEl.textContent = 'Ingresá una descripción.'; errEl.classList.remove('hidden'); } return; }
        descripcionFinal = desc;
      }
      if (monto <= 0) { if (errEl) { errEl.textContent = 'Ingresá un monto mayor a 0.'; errEl.classList.remove('hidden'); } return; }
      if (!fecha) { if (errEl) { errEl.textContent = 'Seleccioná una fecha.'; errEl.classList.remove('hidden'); } return; }
      if (!supabaseClient || !currentUser?.id) { if (errEl) { errEl.textContent = 'Sin conexión a Supabase.'; errEl.classList.remove('hidden'); } return; }
      try {
        var res = await supabaseClient.from('gastos').insert({ user_id: currentUser.id, tipo: tipo, descripcion: descripcionFinal, monto: monto, fecha: fecha });
        if (res.error) throw res.error;
        _resetFormInline(tipo);
        renderGastos(tipo);
        renderResumenMensualCaja();
      } catch (e) {
        if (errEl) { errEl.textContent = 'Error al guardar: ' + (e.message || 'intente de nuevo.'); errEl.classList.remove('hidden'); }
      }
    };

    window._filtrarGastos = function (tipo, filtro) {
      _gastosFiltro[tipo] = filtro;
      var selectorClass = tipo === 'proveedor' ? '.prov-filtro' : '.gasto-filtro';
      document.querySelectorAll(selectorClass).forEach(function (b) {
        b.classList.toggle('active', b.dataset.filtro === filtro);
      });
      renderGastos(tipo);
    };

    window._eliminarGasto = async function (id, tipo) {
      if (!confirm('¿Eliminar este registro?')) return;
      if (!supabaseClient || !currentUser?.id) return;
      try {
        await supabaseClient.from('gastos').delete().eq('id', id).eq('user_id', currentUser.id);
        renderGastos(tipo);
        renderResumenMensualCaja();
      } catch (_) {}
    };
    // ============================================================
    // LIBRETA DE FIADO
    // ============================================================
    var _libretalClienteActual = null; // { id, nombre, telefono }
    var _libretalDesdePago = null;     // { items, total, tipo } — datos del pago post-venta
    var _selectedLibretaClienteForPayment = null; // cliente de libreta preseleccionado al cobrar
    var _pendingPaymentMethod = null;             // método fiado/transf_pendiente en curso
    var _libretaFiltroLista = 'deuda';             // 'deuda' | 'todos'

    function _syncLibretaFiltroChips() {
      var d = document.getElementById('libretalFiltroDeuda');
      var t = document.getElementById('libretalFiltroTodos');
      if (d) d.classList.toggle('active', _libretaFiltroLista === 'deuda');
      if (t) t.classList.toggle('active', _libretaFiltroLista === 'todos');
    }

    window._setLibretaFiltroLista = function (mode) {
      if (mode !== 'deuda' && mode !== 'todos') return;
      _libretaFiltroLista = mode;
      renderLibretaClientes();
    };

    function _libretaItemRowHtml(item) {
      var desc = (item.descripcion || '').replace(/</g, '&lt;');
      var monto = Number(item.monto || 0);
      var pagadoStyle = item.pagado ? 'opacity-40' : '';
      var coment = item.comentario ? '<i data-lucide="message-circle" class="w-3 h-3 inline-block ml-1 opacity-50"></i>' : '';
      return '<div class="libreta-detalle-row ' + pagadoStyle + '" onclick="window._abrirItemDetalle(\'' + item.id + '\')">' +
        '<span class="libreta-detalle-desc' + (item.pagado ? ' line-through opacity-50' : '') + '">' + desc + coment + '</span>' +
        '<div class="flex items-center gap-2 shrink-0">' +
        '<span class="libreta-detalle-monto ' + (item.pagado ? 'text-green-400' : 'text-[#4ade80]') + '">$' + Math.round(monto).toLocaleString('es-AR') + '</span>' +
        (!item.pagado ? '<button onclick="event.stopPropagation();window._eliminarItemLibreta(\'' + item.id + '\')" class="libreta-detalle-del touch-target"><i data-lucide="trash-2" class="w-3.5 h-3.5"></i></button>' : '') +
        '</div>' +
        '</div>';
    }

    async function loadLibretaClientes() {
      if (!supabaseClient || !currentUser?.id) return { ok: false, data: [], sinTabla: false };
      try {
        var res = await supabaseClient.from('libreta_clientes')
          .select('id, nombre, telefono, created_at')
          .eq('user_id', currentUser.id)
          .order('nombre');
        if (res.error) {
          var sinTabla = res.error.code === '42P01' || (res.error.message && res.error.message.includes('does not exist'));
          return { ok: false, data: [], sinTabla: sinTabla };
        }
        return { ok: true, data: res.data || [], sinTabla: false };
      } catch (e) { return { ok: false, data: [], sinTabla: false }; }
    }

    async function loadLibretaItems(clienteId, soloPendientes) {
      if (!supabaseClient || !currentUser?.id) return [];
      try {
        var q = supabaseClient.from('libreta_items')
          .select('*')
          .eq('user_id', currentUser.id)
          .eq('cliente_id', clienteId)
          .order('fecha_hora', { ascending: false });
        if (soloPendientes) q = q.eq('pagado', false);
        var res = await q;
        if (res.error) throw res.error;
        return res.data || [];
      } catch (e) { return []; }
    }

    async function renderLibretaClientes() {
      var el = document.getElementById('libretalClientesList');
      if (!el) return;
      el.innerHTML = '<p class="text-white/50 text-center py-6">Cargando...</p>';
      try {
        var result = await loadLibretaClientes();
        if (!result.ok && result.sinTabla) {
          el.innerHTML = '<div class="glass rounded-xl p-4 border border-amber-500/30 text-center">' +
            '<p class="text-amber-400 font-semibold text-sm mb-1">⚠️ Falta ejecutar el SQL</p>' +
            '<p class="text-white/50 text-xs">Copiá el SQL de la conversación y ejecutalo en Supabase → SQL Editor.</p>' +
            '</div>';
          _syncLibretaFiltroChips();
          return;
        }
        if (!result.ok) {
          el.innerHTML = '<p class="text-white/40 text-center py-6 text-sm">Error al conectar. Revisá la conexión.</p>';
          _syncLibretaFiltroChips();
          return;
        }
        var clientes = result.data;
        if (clientes.length === 0) {
          el.innerHTML = '<div class="text-center py-10"><p class="text-white/40 text-sm">Sin clientes en la libreta.</p><p class="text-white/30 text-xs mt-1">Presioná "Nuevo cliente" para agregar.</p></div>';
          lucide.createIcons();
          _syncLibretaFiltroChips();
          return;
        }
        var totalesPromises = clientes.map(async function (c) {
          var items = await loadLibretaItems(c.id, true);
          var total = items.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
          return { cliente: c, total: total };
        });
        var datos = await Promise.all(totalesPromises);
        if (_libretaFiltroLista === 'deuda') {
          datos = datos.filter(function (d) { return d.total > 0; });
        }
        if (datos.length === 0) {
          el.innerHTML = '<div class="text-center py-10 px-4"><p class="text-white/50 text-sm">Nadie debe dinero en este momento.</p><p class="text-white/35 text-xs mt-2">Tocá <span class="text-[#86efac] font-medium">Todos</span> para ver clientes al día.</p></div>';
          lucide.createIcons();
          _syncLibretaFiltroChips();
          return;
        }
        el.innerHTML = datos.map(function (d) {
          var c = d.cliente;
          var total = d.total;
          var montoStr = total > 0
            ? '<span class="libreta-item-deuda text-amber-400">$' + Math.round(total).toLocaleString('es-AR') + '</span>'
            : '<span class="libreta-item-deuda text-green-400 text-xs">Al día</span>';
          return '<button onclick="window._verClienteLibreta(\'' + c.id + '\')" class="libreta-item-row w-full touch-target">' +
            '<div class="libreta-item-icon"><i data-lucide="user" class="w-4 h-4 text-[#86efac]"></i></div>' +
            '<div class="libreta-item-info">' +
            '<span class="libreta-item-nombre">' + (c.nombre || '').replace(/</g,'&lt;') + '</span>' +
            (c.telefono ? '<span class="libreta-item-tel">' + c.telefono + '</span>' : '') +
            '</div>' +
            montoStr +
            '<i data-lucide="chevron-right" class="w-4 h-4 text-white/30 shrink-0"></i></button>';
        }).join('');
        lucide.createIcons();
        _syncLibretaFiltroChips();
      } catch (e) {
        if (el) el.innerHTML = '<p class="text-white/40 text-center py-6 text-sm">Error inesperado. Revisá la consola.</p>';
        _syncLibretaFiltroChips();
      }
    }

    window._verClienteLibreta = async function (clienteId) {
      var result = await loadLibretaClientes();
      var clientes = (result && result.ok) ? result.data : [];
      var c = clientes.find(function (x) { return x.id === clienteId; });
      if (!c) return;
      _libretalClienteActual = c;
      document.getElementById('libretalClienteNombre').textContent = c.nombre;
      document.getElementById('libretalClienteTel').textContent = c.telefono || '';
      await renderLibretaItems(clienteId);
      window._switchCajaTab('libreta-cliente');
    };

    async function renderLibretaItems(clienteId) {
      var el = document.getElementById('libretalItemsList');
      var totalEl = document.getElementById('libretalClienteTotal');
      if (!el) return;
      var items = await loadLibretaItems(clienteId, false);
      var pendientes = items.filter(function (i) { return !i.pagado; });
      var total = pendientes.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
      if (totalEl) totalEl.textContent = '$' + Math.round(total).toLocaleString('es-AR');
      if (items.length === 0) {
        el.innerHTML = '<p class="text-white/40 text-center py-4">Sin ítems registrados.</p>';
        lucide.createIcons(); return;
      }
      var pagados = items.filter(function (i) { return i.pagado; });
      var htmlPend = pendientes.map(_libretaItemRowHtml).join('');
      var htmlPag = '';
      if (pagados.length) {
        var grouped = _libretaGroupPagadosForHistorial(pagados);
        var htmlBloques = grouped.grupos.map(function (g) {
          var fLabel = g.fechaSort > 0
            ? new Date(g.fechaSort).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' })
            : 'sin fecha';
          var gid = String(g.grupoId || '').replace(/\\/g, '').replace(/'/g, '');
          var head = '<div class="libreta-cobro-bloque-head flex items-center justify-between gap-2 px-3 py-2 bg-white/5 border-b border-white/10">' +
            '<span class="text-xs text-white/70 min-w-0">Cobro · ' + fLabel + ' · <strong class="text-[#86efac]">$' + Math.round(g.total).toLocaleString('es-AR') + '</strong></span>' +
            '<button type="button" onclick="event.stopPropagation();window._libretaCompartirCobroHistorial(\'' + gid + '\')" class="shrink-0 text-[11px] px-2.5 py-1.5 rounded-lg bg-[#25d366]/25 text-[#86efac] touch-target font-semibold">Ticket</button>' +
            '</div>';
          var rows = g.items.map(_libretaItemRowHtml).join('');
          return '<div class="libreta-cobro-bloque rounded-xl border border-white/10 overflow-hidden mb-2">' + head + rows + '</div>';
        }).join('');
        var htmlSueltos = grouped.sueltos.map(_libretaItemRowHtml).join('');
        htmlPag = '<details class="libreta-historial-details"><summary class="libreta-historial-summary touch-target">Cobrados (' + pagados.length + ')</summary>' +
          htmlBloques + htmlSueltos + '</details>';
      }
      if (pendientes.length === 0) {
        el.innerHTML = '<p class="text-white/40 text-center py-3 text-sm">Sin deuda pendiente.</p>' + htmlPag;
      } else {
        el.innerHTML = htmlPend + htmlPag;
      }
      lucide.createIcons();
    }

    window._abrirEditarClienteLibreta = function () {
      if (!_libretalClienteActual) return;
      var err = document.getElementById('libretalEditClienteErr');
      if (err) err.classList.add('hidden');
      document.getElementById('libretalEditNombre').value = _libretalClienteActual.nombre || '';
      document.getElementById('libretalEditTel').value = _libretalClienteActual.telefono || '';
      var m = document.getElementById('libretalEditarClienteModal');
      if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
      if (!state._restoringFromHistory) pushHistoryExtra({ overlay: 'libretalEditarClienteModal' });
      lucide.createIcons();
      setTimeout(function () { var n = document.getElementById('libretalEditNombre'); if (n) n.focus(); }, 100);
    };

    window._guardarEditarClienteLibreta = async function () {
      if (!_libretalClienteActual) return;
      var nombre = (document.getElementById('libretalEditNombre').value || '').trim();
      var tel = (document.getElementById('libretalEditTel').value || '').trim();
      var err = document.getElementById('libretalEditClienteErr');
      err.classList.add('hidden');
      if (!nombre) { err.textContent = 'El nombre es obligatorio.'; err.classList.remove('hidden'); return; }
      if (!supabaseClient || !currentUser?.id) { err.textContent = 'Sin conexión.'; err.classList.remove('hidden'); return; }
      try {
        var res = await supabaseClient.from('libreta_clientes').update({ nombre: nombre, telefono: tel || null }).eq('id', _libretalClienteActual.id).eq('user_id', currentUser.id);
        if (res.error) throw res.error;
        _libretalClienteActual.nombre = nombre;
        _libretalClienteActual.telefono = tel;
        document.getElementById('libretalClienteNombre').textContent = nombre;
        document.getElementById('libretalClienteTel').textContent = tel || '';
        window._cerrarModalLibreta('libretalEditarClienteModal');
        renderLibretaClientes();
        if (typeof showScanToast === 'function') showScanToast('Cliente actualizado', false);
      } catch (e) {
        err.textContent = 'Error: ' + (e.message || 'intentá de nuevo.');
        err.classList.remove('hidden');
      }
    };

    window._abrirNuevoClienteLibreta = function () {
      var el = document.getElementById('libretalNuevoNombre');
      var tel = document.getElementById('libretalNuevoTel');
      var err = document.getElementById('libretalNuevoClienteErr');
      if (el) el.value = ''; if (tel) tel.value = ''; if (err) err.classList.add('hidden');
      var m = document.getElementById('libretalNuevoClienteModal');
      m.classList.remove('hidden'); m.classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ overlay: 'libretalNuevoClienteModal' });
      lucide.createIcons();
      setTimeout(function () { if (el) el.focus(); }, 100);
    };

    window._guardarNuevoClienteLibreta = async function () {
      var nombre = (document.getElementById('libretalNuevoNombre').value || '').trim();
      var tel = (document.getElementById('libretalNuevoTel').value || '').trim();
      var err = document.getElementById('libretalNuevoClienteErr');
      err.classList.add('hidden');
      if (!nombre) { err.textContent = 'Ingresá el nombre del cliente.'; err.classList.remove('hidden'); return; }
      if (!supabaseClient || !currentUser?.id) { err.textContent = 'Sin conexión.'; err.classList.remove('hidden'); return; }
      try {
        var res = await supabaseClient.from('libreta_clientes').insert({ user_id: currentUser.id, nombre: nombre, telefono: tel }).select().single();
        if (res.error) throw res.error;
        window._cerrarModalLibreta('libretalNuevoClienteModal');
        await renderLibretaClientes();
        if (_libretalDesdePago) {
          window._verClienteLibreta(res.data.id).then(function () { _agregarItemsDesdePago(res.data.id); });
        }
      } catch (e) { err.textContent = 'Error: ' + (e.message || 'intente de nuevo.'); err.classList.remove('hidden'); }
    };

    window._abrirNuevoItemLibreta = function () {
      if (!_libretalClienteActual) return;
      var el = document.getElementById('libretalItemDesc');
      var m = document.getElementById('libretalItemMonto');
      var err = document.getElementById('libretalItemErr');
      var sub = document.getElementById('libretalItemModalSubtitle');
      if (el) el.value = ''; if (m) m.value = ''; if (err) err.classList.add('hidden');
      if (sub) sub.textContent = 'Cliente: ' + _libretalClienteActual.nombre;
      var modal = document.getElementById('libretalNuevoItemModal');
      modal.classList.remove('hidden'); modal.classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ overlay: 'libretalNuevoItemModal' });
      lucide.createIcons();
      setTimeout(function () { if (el) el.focus(); }, 100);
    };

    window._guardarItemLibreta = async function () {
      if (!_libretalClienteActual) return;
      var desc = (document.getElementById('libretalItemDesc').value || '').trim();
      var monto = parseFloat(document.getElementById('libretalItemMonto').value) || 0;
      var tipo = document.getElementById('libretalItemTipo').value;
      var err = document.getElementById('libretalItemErr');
      err.classList.add('hidden');
      if (!desc) { err.textContent = 'Ingresá una descripción.'; err.classList.remove('hidden'); return; }
      if (monto <= 0) { err.textContent = 'Ingresá un monto mayor a 0.'; err.classList.remove('hidden'); return; }
      if (!supabaseClient || !currentUser?.id) { err.textContent = 'Sin conexión.'; err.classList.remove('hidden'); return; }
      try {
        var res = await supabaseClient.from('libreta_items').insert({ user_id: currentUser.id, cliente_id: _libretalClienteActual.id, descripcion: desc, monto: monto, tipo: tipo });
        if (res.error) throw res.error;
        window._cerrarModalLibreta('libretalNuevoItemModal');
        renderLibretaItems(_libretalClienteActual.id);
      } catch (e) { err.textContent = 'Error: ' + (e.message || 'intente de nuevo.'); err.classList.remove('hidden'); }
    };

    window._eliminarItemLibreta = async function (itemId) {
      if (!confirm('¿Eliminar este ítem?')) return;
      if (!supabaseClient || !currentUser?.id || !_libretalClienteActual) return;
      try {
        await supabaseClient.from('libreta_items').delete().eq('id', itemId).eq('user_id', currentUser.id);
        renderLibretaItems(_libretalClienteActual.id);
      } catch (_) {}
    };

    var _libretalCuentaItemsCache = null;
    var _libretalCuentaUltimoMonto = 0;
    var _libretalCuentaUltimoItems = null;

    function _libretaNewCobroGrupoId() {
      if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
      return 'xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx'.replace(/[xy]/g, function (c) {
        var r = Math.random() * 16 | 0;
        var v = c === 'x' ? r : (r & 0x3 | 0x8);
        return v.toString(16);
      });
    }

    function _libretaGroupPagadosForHistorial(pagados) {
      var byGrupo = new Map();
      var sinGrupo = [];
      pagados.forEach(function (i) {
        var g = i.cobro_grupo_id;
        if (!g) { sinGrupo.push(i); return; }
        if (!byGrupo.has(g)) byGrupo.set(g, []);
        byGrupo.get(g).push(i);
      });
      var grupos = Array.from(byGrupo.entries()).map(function (entry) {
        var arr = entry[1];
        var total = arr.reduce(function (s, x) { return s + Number(x.monto || 0); }, 0);
        var fechas = arr.map(function (x) { return x.fecha_hora ? new Date(x.fecha_hora).getTime() : 0; });
        var fmax = Math.max.apply(null, fechas.length ? fechas : [0]);
        arr.sort(function (a, b) {
          var ta = a.fecha_hora ? new Date(a.fecha_hora).getTime() : 0;
          var tb = b.fecha_hora ? new Date(b.fecha_hora).getTime() : 0;
          return tb - ta;
        });
        return { grupoId: entry[0], items: arr, total: total, fechaSort: fmax };
      });
      grupos.sort(function (a, b) { return b.fechaSort - a.fechaSort; });
      sinGrupo.sort(function (a, b) {
        var ta = a.fecha_hora ? new Date(a.fecha_hora).getTime() : 0;
        var tb = b.fecha_hora ? new Date(b.fecha_hora).getTime() : 0;
        return tb - ta;
      });
      return { grupos: grupos, sueltos: sinGrupo };
    }

    function _libretaBuildMsgPendiente(cliente, items) {
      var total = items.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
      var negocio = (currentUser && currentUser.kioscoName) ? currentUser.kioscoName : 'El negocio';
      var hoy = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric' });
      var detalle = items.map(function (item) {
        var d = item.descripcion || '';
        var m = Math.round(Number(item.monto || 0)).toLocaleString('es-AR');
        var fh = item.fecha_hora ? new Date(item.fecha_hora).toLocaleString('es-AR', { day:'2-digit', month:'2-digit', hour:'2-digit', minute:'2-digit' }) : '';
        return '• ' + d + ' — $' + m + (fh ? ' (' + fh + ')' : '');
      }).join('\n');
      return '📋 *CUENTA DE FIADO*\n'
        + '👤 Cliente: *' + (cliente.nombre || '') + '*\n'
        + '📅 ' + hoy + '\n\n'
        + '🛒 *Detalle:*\n'
        + detalle + '\n\n'
        + '💰 *TOTAL ADEUDADO: $' + Math.round(total).toLocaleString('es-AR') + '*\n\n'
        + '_' + negocio + '_';
    }

    function _libretaBuildMsgComprobante(cliente, montoPagado) {
      var negocio = (currentUser && currentUser.kioscoName) ? currentUser.kioscoName : 'El negocio';
      var hoy = new Date().toLocaleDateString('es-AR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });
      return '✅ *CUENTA SALDADA*\n'
        + '👤 Cliente: *' + (cliente.nombre || '') + '*\n'
        + '💵 Monto cobrado: *$' + Math.round(montoPagado).toLocaleString('es-AR') + '*\n'
        + '📅 ' + hoy + '\n\n'
        + 'Gracias por tu pago.\n'
        + '_' + negocio + '_';
    }

    function _libretaBuildMsgComprobanteDetalle(cliente, items, montoTotal) {
      var negocio = (currentUser && currentUser.kioscoName) ? currentUser.kioscoName : 'El negocio';
      var ahora = new Date().toLocaleString('es-AR', { day: '2-digit', month: '2-digit', year: 'numeric', hour: '2-digit', minute: '2-digit' });
      var detalle = items.map(function (item) {
        var d = item.descripcion || '';
        var m = Math.round(Number(item.monto || 0)).toLocaleString('es-AR');
        var fh = item.fecha_hora ? new Date(item.fecha_hora).toLocaleString('es-AR', { day: '2-digit', month: '2-digit', hour: '2-digit', minute: '2-digit' }) : '';
        return '• ' + d + ' — $' + m + (fh ? ' (' + fh + ')' : '');
      }).join('\n');
      return '✅ *COMPROBANTE DE COBRO*\n'
        + '👤 Cliente: *' + (cliente.nombre || '') + '*\n'
        + '📅 ' + ahora + '\n\n'
        + '🛒 *Detalle saldado:*\n'
        + detalle + '\n\n'
        + '💵 *Total cobrado: $' + Math.round(montoTotal).toLocaleString('es-AR') + '*\n\n'
        + 'Gracias por tu pago.\n'
        + '_' + negocio + '_';
    }

    function _libretaAbrirWhatsAppConTexto(telRaw, texto) {
      if (!telRaw) {
        if (typeof showScanToast === 'function') showScanToast('Falta el teléfono del cliente', true);
        return;
      }
      var tel = String(telRaw).replace(/\D/g, '');
      if (!tel) {
        if (typeof showScanToast === 'function') showScanToast('Teléfono no válido', true);
        return;
      }
      window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(texto), '_blank');
    }

    window._abrirCuentaLibreta = async function () {
      if (!_libretalClienteActual) return;
      var items = await loadLibretaItems(_libretalClienteActual.id, true);
      if (!items.length) {
        if (typeof showScanToast === 'function') showScanToast('No hay deuda pendiente', false);
        return;
      }
      _libretalCuentaItemsCache = items;
      var total = items.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
      var nombreEl = document.getElementById('libretalCuentaClienteNombre');
      if (nombreEl) nombreEl.textContent = _libretalClienteActual.nombre || '';
      var ticketEl = document.getElementById('libretalCuentaTicket');
      var sinTel = document.getElementById('libretalCuentaSinTel');
      if (ticketEl) {
        ticketEl.innerHTML = items.map(function (item) {
          var desc = (item.descripcion || '').replace(/</g, '&lt;');
          var m = Math.round(Number(item.monto || 0)).toLocaleString('es-AR');
          return '<div class="libreta-cuenta-line flex justify-between gap-3 px-4 py-3 border-b border-white/08"><span class="text-white/90 min-w-0 flex-1 truncate">' + desc + '</span><span class="font-bold text-[#4ade80] shrink-0">$' + m + '</span></div>';
        }).join('') + '<div class="flex justify-between items-baseline px-4 pt-4 pb-2"><span class="text-white/60 text-sm">Total adeudado</span><span class="font-bold text-xl text-amber-400">$' + Math.round(total).toLocaleString('es-AR') + '</span></div>';
      }
      if (sinTel) {
        var tieneTel = !!(_libretalClienteActual.telefono && String(_libretalClienteActual.telefono).replace(/\D/g, ''));
        sinTel.classList.toggle('hidden', tieneTel);
      }
      var btnWA = document.getElementById('libretalCuentaBtnWA');
      if (btnWA) {
        var okTel = !!(_libretalClienteActual.telefono && String(_libretalClienteActual.telefono).replace(/\D/g, ''));
        btnWA.disabled = !okTel;
        btnWA.classList.toggle('opacity-45', !okTel);
      }
      document.getElementById('libretalCuentaFooterPendiente').classList.remove('hidden');
      document.getElementById('libretalCuentaFooterExito').classList.add('hidden');
      var modal = document.getElementById('libretalCuentaModal');
      if (modal) { modal.classList.remove('hidden'); modal.classList.add('flex'); }
      if (!state._restoringFromHistory) pushHistoryExtra({ overlay: 'libretalCuentaModal' });
      lucide.createIcons();
    };

    window._cerrarCuentaLibreta = function () {
      var modal = document.getElementById('libretalCuentaModal');
      if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
      if (!state._restoringFromHistory && history.state && history.state.overlay === 'libretalCuentaModal') {
        var n = Object.assign({}, history.state);
        delete n.overlay;
        history.replaceState(n, '', location.href);
      }
      _libretalCuentaItemsCache = null;
    };

    window._libretaCuentaCompartirPendiente = function () {
      if (!_libretalClienteActual || !_libretalCuentaItemsCache || !_libretalCuentaItemsCache.length) return;
      var msg = _libretaBuildMsgPendiente(_libretalClienteActual, _libretalCuentaItemsCache);
      _libretaAbrirWhatsAppConTexto(_libretalClienteActual.telefono, msg);
    };

    window._libretaCuentaConfirmarCobro = async function () {
      if (!_libretalClienteActual || !supabaseClient || !currentUser?.id) return;
      var items = _libretalCuentaItemsCache;
      if (!items || !items.length) return;
      var total = items.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
      if (!confirm('¿Confirmás que cobraste $' + Math.round(total).toLocaleString('es-AR') + ' y querés saldar la cuenta?')) return;
      var ids = items.map(function (i) { return i.id; }).filter(Boolean);
      if (!ids.length) return;
      var cobroGrupoId = _libretaNewCobroGrupoId();
      try {
        var chunkSize = 80;
        var lastErr = null;
        for (var c = 0; c < ids.length; c += chunkSize) {
          var chunk = ids.slice(c, c + chunkSize);
          var res = await supabaseClient.from('libreta_items').update({ pagado: true, cobro_grupo_id: cobroGrupoId })
            .eq('cliente_id', _libretalClienteActual.id)
            .eq('user_id', currentUser.id)
            .eq('pagado', false)
            .in('id', chunk);
          if (res.error) { lastErr = res.error; break; }
        }
        if (lastErr) {
          var msg = (lastErr.message || '').toLowerCase();
          if (msg.indexOf('cobro_grupo') !== -1 || msg.indexOf('schema cache') !== -1 || lastErr.code === 'PGRST204') {
            alert('Para agrupar cada cobro como ticket ejecutá en Supabase → SQL:\n\nALTER TABLE libreta_items ADD COLUMN IF NOT EXISTS cobro_grupo_id text;\n');
            throw lastErr;
          }
          throw lastErr;
        }
        var ventaItems = items.map(function (it, idx) {
          var m = Number(it.monto) || 0;
          return {
            nombre: ((it.descripcion || '') + '').trim() || 'Cuenta libreta',
            codigo: '_libreta_' + String(it.id != null ? it.id : idx),
            precio: m,
            cant: 1,
            costo: m
          };
        });
        var fechaHoraCobro = new Date().toISOString();
        var clienteNombreCobro = (_libretalClienteActual.nombre || '').trim() || null;
        state.transaccionesList.push({
          id: Date.now(),
          method: 'cobro_libreta',
          client: clienteNombreCobro || '—',
          items: ventaItems,
          total: total,
          fechaHora: fechaHoraCobro
        });
        try {
          var ventaCobroRes = await supabaseClient.from('ventas').insert({
            user_id: currentUser.id,
            fecha_hora: fechaHoraCobro,
            total: total,
            metodo_pago: 'cobro_libreta',
            cliente_nombre: clienteNombreCobro,
            items: ventaItems
          });
          if (ventaCobroRes.error) throw ventaCobroRes.error;
        } catch (errV) {
          console.warn('Venta cobro libreta no guardada en la nube:', errV && errV.message);
          if (typeof showScanToast === 'function') showScanToast('Cuenta saldada. Revisá conexión para el historial de ventas.', false);
        }
        var dCobro = getData();
        dCobro.ventas = dCobro.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 };
        dCobro.ventas.cobro_libreta = (dCobro.ventas.cobro_libreta || 0) + total;
        dCobro.transacciones = (dCobro.transacciones || 0) + 1;
        dCobro.lastCierreDate = new Date().toISOString().slice(0, 10);
        setData(dCobro);
        try { await updateDashboard(); } catch (_) {}
        _libretalCuentaUltimoMonto = total;
        _libretalCuentaUltimoItems = items.map(function (it) {
          return {
            descripcion: it.descripcion,
            monto: it.monto,
            fecha_hora: it.fecha_hora,
            tipo: it.tipo
          };
        });
        await renderLibretaItems(_libretalClienteActual.id);
        document.getElementById('libretalCuentaFooterPendiente').classList.add('hidden');
        var exito = document.getElementById('libretalCuentaFooterExito');
        var txt = document.getElementById('libretalCuentaExitoTexto');
        if (txt) txt.textContent = 'Cuenta saldada por $' + Math.round(total).toLocaleString('es-AR');
        var btnWAc = document.getElementById('libretalCuentaBtnWAComprobante');
        var okTel = !!(_libretalClienteActual.telefono && String(_libretalClienteActual.telefono).replace(/\D/g, ''));
        if (btnWAc) {
          btnWAc.disabled = !okTel;
          btnWAc.classList.toggle('opacity-45', !okTel);
        }
        if (exito) exito.classList.remove('hidden');
        if (typeof showScanToast === 'function') showScanToast('Cuenta saldada', false);
        lucide.createIcons();
      } catch (e) {
        console.error(e);
        if (typeof showScanToast === 'function') showScanToast('No se pudo actualizar', true);
      }
    };

    window._libretaCuentaCompartirComprobante = function () {
      if (!_libretalClienteActual) return;
      var ultItems = _libretalCuentaUltimoItems;
      if (ultItems && ultItems.length) {
        var t = ultItems.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
        var msgDet = _libretaBuildMsgComprobanteDetalle(_libretalClienteActual, ultItems, t);
        _libretaAbrirWhatsAppConTexto(_libretalClienteActual.telefono, msgDet);
        return;
      }
      var msg = _libretaBuildMsgComprobante(_libretalClienteActual, _libretalCuentaUltimoMonto);
      _libretaAbrirWhatsAppConTexto(_libretalClienteActual.telefono, msg);
    };

    window._libretaCompartirCobroHistorial = async function (grupoId) {
      if (!_libretalClienteActual || !grupoId || !supabaseClient || !currentUser?.id) return;
      try {
        var res = await supabaseClient.from('libreta_items')
          .select('*')
          .eq('user_id', currentUser.id)
          .eq('cliente_id', _libretalClienteActual.id)
          .eq('cobro_grupo_id', grupoId)
          .eq('pagado', true)
          .order('fecha_hora', { ascending: false });
        if (res.error) throw res.error;
        var rows = res.data || [];
        if (!rows.length) {
          if (typeof showScanToast === 'function') showScanToast('No hay datos de ese cobro', true);
          return;
        }
        var tot = rows.reduce(function (s, i) { return s + Number(i.monto || 0); }, 0);
        var msg = _libretaBuildMsgComprobanteDetalle(_libretalClienteActual, rows, tot);
        _libretaAbrirWhatsAppConTexto(_libretalClienteActual.telefono, msg);
      } catch (e) {
        console.error(e);
        if (typeof showScanToast === 'function') showScanToast('No se pudo armar el ticket', true);
      }
    };

    window._cerrarModalLibreta = function (id) {
      var m = document.getElementById(id);
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
      if (!state._restoringFromHistory && history.state && history.state.overlay === id) {
        var n = Object.assign({}, history.state);
        delete n.overlay;
        history.replaceState(n, '', location.href);
      }
    };

    // ── Prompt post-pago fiado ──────────────────────────────────
    window._mostrarFiadoPrompt = async function (itemsVenta, totalVenta, metodo) {
      _libretalDesdePago = { items: itemsVenta, total: totalVenta, tipo: metodo };
      var listEl = document.getElementById('libretalPromptClientesList');
      var nuevoFormEl = document.getElementById('libretalPromptNuevoForm');
      if (nuevoFormEl) nuevoFormEl.classList.add('hidden');
      if (listEl) {
        listEl.innerHTML = '<p class="text-white/40 text-sm text-center py-3">Cargando clientes...</p>';
      }
      var prompt = document.getElementById('libretalFiadoPrompt');
      if (prompt) { prompt.classList.remove('hidden'); prompt.style.display = 'flex'; }
      if (!state._restoringFromHistory) pushHistoryExtra({ overlay: 'libretalFiadoPrompt' });
      var result = await loadLibretaClientes();
      var clientes = (result && result.ok) ? result.data : [];
      if (listEl) {
        if (!result || !result.ok) {
          listEl.innerHTML = '<p class="text-amber-400 text-sm text-center py-2">⚠️ Ejecutá el SQL en Supabase primero.</p>';
        } else if (clientes.length === 0) {
          listEl.innerHTML = '<p class="text-white/40 text-sm text-center py-2">Sin clientes aún. Creá uno nuevo.</p>';
        } else {
          listEl.innerHTML = clientes.map(function (c) {
            return '<button onclick="window._elegirClienteDesdePrompt(\'' + c.id + '\')" class="w-full glass rounded-xl px-4 py-3 flex items-center gap-3 border border-white/10 hover:border-[#22c55e]/40 touch-target active:scale-[0.98] transition-all">' +
              '<div class="w-8 h-8 rounded-lg bg-[#22c55e]/20 flex items-center justify-center shrink-0"><i data-lucide="user" class="w-4 h-4 text-[#86efac]"></i></div>' +
              '<span class="text-sm font-medium flex-1 text-left">' + (c.nombre || '').replace(/</g,'&lt;') + '</span>' +
              '<i data-lucide="chevron-right" class="w-4 h-4 text-white/30 shrink-0"></i></button>';
          }).join('');
        }
      }
      lucide.createIcons();
    };

    window._cerrarFiadoPrompt = function () {
      var p = document.getElementById('libretalFiadoPrompt');
      if (p) { p.classList.add('hidden'); p.style.display = ''; }
      if (!state._restoringFromHistory && history.state && history.state.overlay === 'libretalFiadoPrompt') {
        var n = Object.assign({}, history.state);
        delete n.overlay;
        history.replaceState(n, '', location.href);
      }
    };

    window._omitirFiadoPrompt = function () {
      _libretalDesdePago = null;
      window._cerrarFiadoPrompt();
    };

    // ── Picker de cliente al cobrar con fiado ────────────────────
    async function _cargarClientesPickerPago(listElId, nameInputId, waInputId) {
      var listEl = document.getElementById(listElId);
      if (!listEl) return;
      listEl.innerHTML = '<p class="text-white/40 text-xs text-center py-2">Cargando...</p>';
      var result = await loadLibretaClientes();
      var clientes = (result && result.ok) ? result.data : [];
      _selectedLibretaClienteForPayment = null;
      if (clientes.length === 0) {
        listEl.innerHTML = '<p class="text-white/40 text-xs text-center py-2">Sin clientes en la libreta aún. Escribí el nombre abajo.</p>';
      } else {
        listEl.innerHTML = clientes.map(function (c) {
          var safeName = (c.nombre || '').replace(/\\/g, '\\\\').replace(/'/g, "\\'");
          var safeTel = (c.telefono || '').replace(/'/g, "\\'");
          return '<button type="button" id="clientePicker_' + c.id + '" ' +
            'onclick="window._elegirClienteParaPago(\'' + c.id + '\',\'' + safeName + '\',\'' + safeTel + '\',\'' + nameInputId + '\',\'' + waInputId + '\')" ' +
            'class="cliente-picker-btn w-full glass rounded-lg px-3 py-2 flex items-center gap-2 border border-white/10 hover:border-[#22c55e]/40 touch-target active:scale-[0.98] transition-all text-left">' +
            '<i data-lucide="user" class="w-3.5 h-3.5 text-[#86efac] shrink-0"></i>' +
            '<span class="text-sm flex-1 truncate">' + (c.nombre || '').replace(/</g, '&lt;') + '</span>' +
            (c.telefono ? '<span class="text-xs text-white/40 shrink-0">' + c.telefono + '</span>' : '') +
            '</button>';
        }).join('');
        lucide.createIcons();
      }
    }

    window._elegirClienteParaPago = function (clienteId, nombre, telefono, nameInputId, waInputId) {
      _selectedLibretaClienteForPayment = { id: clienteId, nombre: nombre, telefono: telefono };
      var nameEl = document.getElementById(nameInputId);
      if (nameEl) nameEl.value = nombre;
      var waEl = document.getElementById(waInputId);
      if (waEl && telefono) waEl.value = telefono;
      document.querySelectorAll('.cliente-picker-btn').forEach(function (b) {
        b.classList.remove('border-[#22c55e]', 'bg-[#22c55e]/10');
        b.classList.add('border-white/10');
      });
      var sel = document.getElementById('clientePicker_' + clienteId);
      if (sel) { sel.classList.remove('border-white/10'); sel.classList.add('border-[#22c55e]', 'bg-[#22c55e]/10'); }
    };

    window._confirmarPagoFiado = function () {
      var method = _pendingPaymentMethod;
      if (!method) return;
      var client = (document.getElementById('paymentClientName') && document.getElementById('paymentClientName').value) ? document.getElementById('paymentClientName').value.trim() : '';
      var whatsappRaw = (document.getElementById('paymentWhatsapp') && document.getElementById('paymentWhatsapp').value) ? document.getElementById('paymentWhatsapp').value.trim() : '';
      var errEl = document.getElementById('paymentWhatsappErr');
      if (errEl) errEl.classList.add('hidden');
      _pendingPaymentMethod = null;
      completeSaleWithMethod(method, client, whatsappRaw);
      if (document.getElementById('paymentClientName')) document.getElementById('paymentClientName').value = '';
      if (document.getElementById('paymentWhatsapp')) document.getElementById('paymentWhatsapp').value = '';
      if (document.getElementById('cartClientName')) document.getElementById('cartClientName').value = '';
    };

    window._confirmarCobroRapidoFiado = function () {
      var method = _pendingPaymentMethod;
      if (!method) return;
      var clientName = (document.getElementById('cobroRapidoCliente') && document.getElementById('cobroRapidoCliente').value) ? document.getElementById('cobroRapidoCliente').value.trim() : '';
      var whatsappRaw = (document.getElementById('cobroRapidoWhatsapp') && document.getElementById('cobroRapidoWhatsapp').value) ? document.getElementById('cobroRapidoWhatsapp').value.trim() : '';
      var errEl = document.getElementById('cobroRapidoWhatsappErr');
      if (errEl) errEl.classList.add('hidden');
      _pendingPaymentMethod = null;
      completeQuickSale(method, clientName, whatsappRaw).catch(function (err) {
        console.warn('Cobro rápido fiado:', err && err.message ? err.message : err);
      });
    };

    window._elegirClienteDesdePrompt = async function (clienteId) {
      window._cerrarFiadoPrompt();
      await _agregarItemsDesdePago(clienteId);
      if (typeof showPanel === 'function') showPanel('caja');
      await window._verClienteLibreta(clienteId);
      window._switchCajaTab('libreta-cliente');
    };

    window._abrirNuevoClienteDesdePrompt = function () {
      var formEl = document.getElementById('libretalPromptNuevoForm');
      var btnEl = document.getElementById('libretalPromptNuevoBtn');
      var nombreEl = document.getElementById('libretalPromptNombre');
      var telEl = document.getElementById('libretalPromptTel');
      var errEl = document.getElementById('libretalPromptErr');
      if (errEl) { errEl.textContent = ''; errEl.classList.add('hidden'); }
      if (nombreEl) nombreEl.value = '';
      if (telEl) telEl.value = '';
      if (formEl) formEl.classList.remove('hidden');
      if (btnEl) btnEl.classList.add('hidden');
      if (nombreEl) setTimeout(function () { nombreEl.focus(); }, 100);
    };

    window._cancelarNuevoClientePrompt = function () {
      var formEl = document.getElementById('libretalPromptNuevoForm');
      var btnEl = document.getElementById('libretalPromptNuevoBtn');
      if (formEl) formEl.classList.add('hidden');
      if (btnEl) btnEl.classList.remove('hidden');
    };

    window._guardarNuevoClienteDesdePrompt = async function () {
      var nombreEl = document.getElementById('libretalPromptNombre');
      var telEl = document.getElementById('libretalPromptTel');
      var errEl = document.getElementById('libretalPromptErr');
      var btnEl = document.getElementById('libretalPromptGuardarBtn');
      var nombre = (nombreEl ? nombreEl.value : '').trim();
      if (!nombre) { if (errEl) { errEl.textContent = 'Ingresá el nombre del cliente.'; errEl.classList.remove('hidden'); } return; }
      if (btnEl) { btnEl.disabled = true; btnEl.textContent = 'Guardando...'; }
      try {
        var res = await supabaseClient.from('libreta_clientes').insert({ user_id: currentUser.id, nombre: nombre, telefono: telEl ? telEl.value.trim() : '' }).select('id').single();
        if (res.error) throw res.error;
        var nuevoId = res.data.id;
        window._cerrarFiadoPrompt();
        await _agregarItemsDesdePago(nuevoId);
        if (typeof showPanel === 'function') showPanel('caja');
        await window._verClienteLibreta(nuevoId);
        window._switchCajaTab('libreta-cliente');
      } catch (e) {
        if (errEl) { errEl.textContent = 'Error: ' + (e.message || 'intente de nuevo.'); errEl.classList.remove('hidden'); }
        if (btnEl) { btnEl.disabled = false; btnEl.textContent = 'Crear y agregar'; }
      }
    };

    var _itemDetalleActual = null;

    window._abrirItemDetalle = async function (itemId) {
      if (!_libretalClienteActual) return;
      var items = await loadLibretaItems(_libretalClienteActual.id, false);
      var item = items.find(function (i) { return i.id === itemId; });
      if (!item) return;
      _itemDetalleActual = item;
      document.getElementById('itemDetalleId').value = item.id;
      document.getElementById('itemDetalleDesc').textContent = item.descripcion || '';
      var monto = Number(item.monto || 0);
      document.getElementById('itemDetalleMonto').textContent = '$' + Math.round(monto).toLocaleString('es-AR');
      var tipoLabel = item.tipo === 'transferencia_pendiente' ? 'Transferencia pendiente' : 'Fiado';
      document.getElementById('itemDetalleMeta').textContent = tipoLabel + (item.pagado ? ' · Cobrado' : ' · Pendiente');
      var fechaHora = item.fecha_hora ? new Date(item.fecha_hora) : null;
      if (fechaHora) {
        var fechaStr = fechaHora.toLocaleDateString('es-AR', { weekday: 'long', day: '2-digit', month: 'long', year: 'numeric' });
        var horaStr = fechaHora.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        document.getElementById('itemDetalleFechaHora').textContent = fechaStr + ' ' + horaStr;
      } else {
        document.getElementById('itemDetalleFechaHora').textContent = 'Sin fecha';
      }
      document.getElementById('itemDetalleComentario').value = item.comentario || '';
      var modal = document.getElementById('libretalItemDetalleModal');
      modal.classList.remove('hidden'); modal.classList.add('flex');
      if (!state._restoringFromHistory) pushHistoryExtra({ overlay: 'libretalItemDetalleModal' });
      lucide.createIcons();
    };

    window._cerrarItemDetalle = function () {
      var modal = document.getElementById('libretalItemDetalleModal');
      if (modal) { modal.classList.add('hidden'); modal.classList.remove('flex'); }
      if (!state._restoringFromHistory && history.state && history.state.overlay === 'libretalItemDetalleModal') {
        var n = Object.assign({}, history.state);
        delete n.overlay;
        history.replaceState(n, '', location.href);
      }
      _itemDetalleActual = null;
    };

    window._guardarComentarioItem = async function () {
      var itemId = document.getElementById('itemDetalleId').value;
      var comentario = (document.getElementById('itemDetalleComentario').value || '').trim();
      if (!itemId || !supabaseClient || !currentUser?.id) return;
      var btn = document.querySelector('#libretalItemDetalleModal .btn-glow');
      if (btn) { btn.disabled = true; btn.textContent = 'Guardando...'; }
      var res = await supabaseClient.from('libreta_items')
        .update({ comentario: comentario })
        .eq('id', itemId)
        .eq('user_id', currentUser.id);
      if (btn) { btn.disabled = false; btn.textContent = 'Guardar comentario'; }
      if (res.error) {
        console.error('guardarComentario error:', res.error);
        if (res.error.message && res.error.message.includes('comentario')) {
          alert('Para usar comentarios ejecutá este SQL en Supabase:\n\nALTER TABLE libreta_items ADD COLUMN IF NOT EXISTS comentario text DEFAULT \'\';');
        }
      } else {
        window._cerrarItemDetalle();
        if (_libretalClienteActual) renderLibretaItems(_libretalClienteActual.id);
        if (typeof showScanToast === 'function') showScanToast('Comentario guardado', false);
      }
    };

    async function _agregarItemsDesdePago(clienteId) {
      if (!clienteId) { console.warn('Libreta: clienteId vacío'); return; }
      if (!_libretalDesdePago) { console.warn('Libreta: _libretalDesdePago es null'); return; }
      if (!supabaseClient || !currentUser?.id) { console.warn('Libreta: sin conexión o usuario'); return; }
      var tipo = _libretalDesdePago.tipo || 'fiado';
      // Normalizar el tipo para que coincida con el CHECK de la tabla
      if (tipo !== 'fiado' && tipo !== 'transferencia_pendiente') tipo = 'fiado';
      var items = _libretalDesdePago.items || [];
      var fechaHora = new Date().toISOString();
      var errores = 0;
      for (var i = 0; i < items.length; i++) {
        var it = items[i];
        var desc = (it.nombre || 'Ítem') + (Number(it.cant) > 1 ? ' x' + it.cant : '');
        var monto = Number(it.precio || 0) * Number(it.cant || 1);
        if (monto <= 0) continue;
        var res = await supabaseClient.from('libreta_items').insert({
          user_id: currentUser.id,
          cliente_id: clienteId,
          descripcion: desc,
          monto: monto,
          tipo: tipo,
          fecha_hora: fechaHora
        });
        if (res.error) {
          console.error('Libreta insert error:', res.error);
          errores++;
        }
      }
      _libretalDesdePago = null;
      if (errores > 0 && typeof showScanToast === 'function') {
        showScanToast('Error al guardar en la libreta. Revisá el SQL en Supabase.', true);
      }
    }

    // ── Actualizar _switchCajaTab para libreta ──────────────────
    var _switchCajaTabOrig = window._switchCajaTab;
    window._switchCajaTab = function (tab) {
      var prevTab = state.cajaTab;
      state.cajaTab = tab;
      function maybePushCajaHistory() {
        if (!state._restoringFromHistory && !state._suppressCajaHistoryPush && state.currentPanel === 'caja' && prevTab !== tab) {
          history.pushState({ panel: 'caja', cajaTab: tab }, '', location.href);
        }
      }
      var libretalSubs = ['caja-sub-libreta', 'caja-sub-libreta-cliente'];
      libretalSubs.forEach(function (id) { var el = document.getElementById(id); if (el) el.classList.add('hidden'); });
      if (tab === 'libreta') {
        var hub = document.getElementById('caja-hub');
        var subs = ['cierre','proveedores','gastos'];
        if (hub) hub.classList.add('hidden');
        subs.forEach(function (s) { var el = document.getElementById('caja-sub-' + s); if (el) el.classList.add('hidden'); });
        var el = document.getElementById('caja-sub-libreta');
        if (el) el.classList.remove('hidden');
        renderLibretaClientes();
        lucide.createIcons();
        maybePushCajaHistory();
        return;
      }
      if (tab === 'libreta-cliente') {
        var hub = document.getElementById('caja-hub');
        var subs = ['cierre','proveedores','gastos'];
        if (hub) hub.classList.add('hidden');
        subs.forEach(function (s) { var el = document.getElementById('caja-sub-' + s); if (el) el.classList.add('hidden'); });
        document.getElementById('caja-sub-libreta').classList.add('hidden');
        var el = document.getElementById('caja-sub-libreta-cliente');
        if (el) el.classList.remove('hidden');
        lucide.createIcons();
        maybePushCajaHistory();
        return;
      }
      _switchCajaTabOrig(tab);
      maybePushCajaHistory();
    };
    // ============================================================

    document.getElementById('exportProductosCSVBtn').onclick = function () { exportProductosCSV(); lucide.createIcons(); };
    document.getElementById('exportVentasCSVBtn').onclick = function () { exportVentasCSV().then(function () { lucide.createIcons(); }); };
    document.getElementById('exportClientesCSVBtn').onclick = function () { exportClientesCSV().then(function () { lucide.createIcons(); }); };

    // WhatsApp Deudores (manual) — solo si existe el botón (bloque opcional)
    var sendWhatsAppEl = document.getElementById('sendWhatsApp');
    if (sendWhatsAppEl) {
      sendWhatsAppEl.onclick = function () {
        var tel = (document.getElementById('deudorTel') && document.getElementById('deudorTel').value || '').replace(/\D/g, '');
        var nombre = (document.getElementById('deudorNombre') && document.getElementById('deudorNombre').value) || 'Cliente';
        var monto = (document.getElementById('deudorMonto') && document.getElementById('deudorMonto').value) || '0';
        var template = (currentUser && currentUser.whatsappMessage) ? currentUser.whatsappMessage : DEFAULT_WHATSAPP;
        var msg = template.replace(/\{cliente\}/gi, nombre).replace(/\{monto\}/gi, monto);
        window.open('https://wa.me/' + tel + '?text=' + encodeURIComponent(msg), '_blank');
      };
    }

    // Modal producto
    document.getElementById('addProduct').onclick = () => {
      const d = getData();
      if (Object.keys(d.products || {}).length >= 100) {
        alert('Llegaste al límite de 100 productos. Eliminá alguno para agregar uno nuevo.');
        return;
      }
      document.getElementById('productModalTitle').textContent = 'Nuevo producto';
      document.getElementById('prodEditCodigo').value = '';
      document.getElementById('prodNombre').value = '';
      document.getElementById('prodCodigo').value = '';
      document.getElementById('prodPrecio').value = '';
      document.getElementById('prodCosto').value = '';
      document.getElementById('prodMargen').value = '';
      resetMargenRapidoBtns('');
      document.getElementById('prodStock').value = '10';
      document.getElementById('prodStockInicial').value = '';
      document.getElementById('prodStockInicialWrap').classList.add('hidden');
      document.getElementById('deleteProductInModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('hidden');
      document.getElementById('productModal').classList.add('flex');
      _userTouchedCost = false;
      if (typeof updateCostoCampoEstado === 'function') updateCostoCampoEstado();
      document.getElementById('prodMargenError').classList.add('hidden');
      lucide.createIcons();
    };
    document.getElementById('deleteProductInModal').onclick = () => {
      const codigo = document.getElementById('prodEditCodigo').value;
      if (!codigo) return;
      if (confirm('¿Eliminar este producto?')) {
        deleteProduct(codigo);
        document.getElementById('productModal').classList.add('hidden');
        document.getElementById('productModal').classList.remove('flex');
      }
    };
    function closeProductModal() {
      window._scanForProductCode = false;
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('flex');
    }
    document.getElementById('modalOverlay').onclick = closeProductModal;
    document.getElementById('productModalBack').onclick = closeProductModal;
    document.getElementById('prodEscanearCodigo').onclick = () => {
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('flex');
      window._scanForProductCode = true;
      goToPanel('scanner');
    };
    document.getElementById('addAnotherProduct').onclick = () => {
      closeCart();
    };
    var _updatingPrecioFromCosto = false;
    var _updatingCostoFromPrecio = false;
    var _userTouchedCost = false;
    function updatePrecioFromCostoMargen() {
      if (_updatingCostoFromPrecio) return;
      var costo = parseFloat(document.getElementById('prodCosto').value) || 0;
      var margen = parseFloat(document.getElementById('prodMargen').value) || 0;
      if (costo > 0 && margen >= 0) {
        _updatingPrecioFromCosto = true;
        document.getElementById('prodPrecio').value = roundToNearest100(costo * (1 + margen / 100));
        _updatingPrecioFromCosto = false;
      }
    }
    function updateCostoFromPrecioMargen() {
      if (_updatingPrecioFromCosto) return;
      var costoActual = parseFloat(document.getElementById('prodCosto').value) || 0;
      if (costoActual > 0 && _userTouchedCost) return;
      var precio = parseFloat(document.getElementById('prodPrecio').value) || 0;
      var margen = parseFloat(document.getElementById('prodMargen').value) || 0;
      if (precio > 0 && margen >= 0) {
        var costoCalc = Math.round(precio / (1 + margen / 100));
        _updatingCostoFromPrecio = true;
        document.getElementById('prodCosto').value = costoCalc;
        _updatingCostoFromPrecio = false;
      }
    }
    function updateCostoCampoEstado() {
      var costo = parseFloat(document.getElementById('prodCosto').value) || 0;
      var precioFocused = document.activeElement === document.getElementById('prodPrecio');
      var costoEl = document.getElementById('prodCosto');
      var hintEl = document.getElementById('prodCostoHint');
      var mostrarConflicto = costo > 0 && precioFocused;
      if (mostrarConflicto) {
        costoEl.classList.add('border-red-500/80');
        costoEl.classList.remove('border-white/20');
        if (hintEl) { hintEl.classList.remove('hidden'); }
      } else {
        costoEl.classList.remove('border-red-500/80');
        costoEl.classList.add('border-white/20');
        if (hintEl) { hintEl.classList.add('hidden'); }
      }
    }
    document.getElementById('prodCosto').addEventListener('focus', function () { _userTouchedCost = true; updateCostoCampoEstado(); });
    document.getElementById('prodCosto').addEventListener('input', function () { _userTouchedCost = true; updatePrecioFromCostoMargen(); updateCostoCampoEstado(); });
    document.getElementById('prodMargen').addEventListener('input', function () {
      updatePrecioFromCostoMargen(); updateCostoFromPrecioMargen(); updateCostoCampoEstado();
      var v = this.value.trim();
      document.querySelectorAll('.margen-rapido-btn').forEach(function(b) {
        b.classList.toggle('margen-rapido-active', b.dataset.margen === v);
      });
    });
    document.getElementById('prodPrecio').addEventListener('input', function () { updateCostoFromPrecioMargen(); updateCostoCampoEstado(); });
    document.getElementById('prodPrecio').addEventListener('focus', updateCostoCampoEstado);
    document.getElementById('prodPrecio').addEventListener('blur', updateCostoCampoEstado);
    window._setMargenRapido = function(margenVal) {
      var inputEl = document.getElementById('prodMargen');
      if (!inputEl) return;
      inputEl.value = margenVal;
      document.querySelectorAll('.margen-rapido-btn').forEach(function(b) {
        b.classList.toggle('margen-rapido-active', String(b.dataset.margen) === String(margenVal));
      });
      updatePrecioFromCostoMargen();
      updateCostoFromPrecioMargen();
      updateCostoCampoEstado();
    };
    function resetMargenRapidoBtns(margenVal) {
      var v = String(margenVal || '').trim();
      document.querySelectorAll('.margen-rapido-btn').forEach(function(b) {
        b.classList.toggle('margen-rapido-active', b.dataset.margen === v);
      });
    }
    document.getElementById('saveProduct').onclick = () => {
      var margenErr = document.getElementById('prodMargenError');
      var margenVal = document.getElementById('prodMargen').value.trim();
      if (margenVal === '' || isNaN(parseFloat(margenVal))) {
        margenErr.classList.remove('hidden');
        return;
      }
      margenErr.classList.add('hidden');
      const nombre = document.getElementById('prodNombre').value.trim();
      const codigoNuevo = document.getElementById('prodCodigo').value.trim() || Date.now().toString();
      const precio = parseInt(document.getElementById('prodPrecio').value) || 0;
      const costo = parseFloat(document.getElementById('prodCosto').value) || 0;
      const stock = parseInt(document.getElementById('prodStock').value) || 0;
      const stockInicialWrap = document.getElementById('prodStockInicialWrap');
      const stockInicialEl = document.getElementById('prodStockInicial');
      const stockInicial = stockInicialWrap.classList.contains('hidden') ? stock : (parseInt(stockInicialEl.value) || stock);
      const editCodigo = document.getElementById('prodEditCodigo').value.trim();
      const d = getData();
      d.products = d.products || {};
      const isNew = !editCodigo;
      if (isNew && Object.keys(d.products).length >= 100) {
        alert('Límite de 100 productos alcanzado.');
        return;
      }
      if (!nombre || precio <= 0) return;
      if (editCodigo) {
        const oldProduct = d.products[editCodigo];
        const stockInicialFinal = oldProduct && (stockInicialEl.value !== '' && !stockInicialWrap.classList.contains('hidden')) ? (parseInt(stockInicialEl.value) || oldProduct.stockInicial) : (oldProduct?.stockInicial ?? stock);
        if (editCodigo !== codigoNuevo) {
          delete d.products[editCodigo];
        }
        d.products[codigoNuevo] = { nombre, codigo: codigoNuevo, precio, stock, stockInicial: stockInicialFinal, costo };
        state.cart.forEach(item => {
          if (item.codigo === editCodigo || item.codigo === codigoNuevo) {
            item.codigo = codigoNuevo;
            item.nombre = nombre;
            item.precio = precio;
            item.costo = costo;
          }
        });
      } else {
        d.products[codigoNuevo] = { nombre, codigo: codigoNuevo, precio, stock, stockInicial: stockInicial || stock, costo };
      }
      setData(d);
      renderInventory();
      updateCartUI();
      document.getElementById('productModal').classList.add('hidden');
      document.getElementById('productModal').classList.remove('flex');
    };

  
    document.getElementById('searchInventory').addEventListener('input', renderInventory);

   // --- Login / Logout / SaaS ---
async function showApp() {
    const isSuper = currentUser && currentUser.role === 'super';
    const isPartner = currentUser && currentUser.role === 'partner';
    const isNetworkAdmin = isNetworkAdminRole(currentUser && currentUser.role);
    document.getElementById('loginScreen').classList.add('hidden');
    document.getElementById('appWrap').classList.remove('hidden');
    if (isSuper) {
      try {
        state.superUiMode = ferriolNormalizeSuperUiMode(sessionStorage.getItem('ferriol_super_ui'));
      } catch (_) {
        state.superUiMode = 'empresa';
      }
    } else {
      state.superUiMode = 'empresa';
    }
    applyAppShell();

    if (isSuper && state.superUiMode === 'negocio') {
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = setInterval(updateTrialCountdown, 1000);
      await loadAdminContact();
      await initData();
      renderInventory();
      updateCartUI();
      updateDashboard();
      state._restoringFromHistory = true;
      showPanel('dashboard');
      state._restoringFromHistory = false;
      history.replaceState({ panel: 'dashboard', root: true }, '', location.href);
      ferriolStartNotificationPolling();
      lucide.createIcons();
    } else if (isSuper) {
      ferriolStopNotificationPolling();
      goToPanel('super');
      lucide.createIcons();
    } else if (isPartner) {
      ferriolStopNotificationPolling();
      goToPanel('super');
      lucide.createIcons();
    } else {
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = setInterval(updateTrialCountdown, 1000);
      await loadAdminContact();
      await initData();
      renderInventory();
      updateCartUI();
      updateDashboard();
      state._restoringFromHistory = true;
      showPanel('dashboard');
      state._restoringFromHistory = false;
      history.replaceState({ panel: 'dashboard', root: true }, '', location.href);
      ferriolStartNotificationPolling();
      lucide.createIcons();
    }
}

    async function doLogin() {
      const email = document.getElementById('loginEmail').value.trim();
      const pass = document.getElementById('loginPassword').value;
      const errEl = document.getElementById('loginErr');
      errEl.classList.remove('show');
      document.getElementById('loginContactAdminWrap').classList.add('hidden');
      errEl.style.color = '#fca5a5';
      if (!supabaseClient) {
        errEl.textContent = (!window.supabase || typeof window.supabase.createClient !== 'function')
          ? 'No se cargó la librería de Supabase. Revisá la conexión o bloqueos del navegador (extensiones, firewall) y recargá la página.'
          : 'Configurá SUPABASE_URL y SUPABASE_ANON_KEY en kiosco-config.js.';
        errEl.classList.add('show');
        return;
      }
      if (!email) {
        errEl.textContent = 'Ingresá tu email.';
        errEl.classList.add('show');
        return;
      }
      if (!pass || pass.length === 0) {
        errEl.textContent = 'Ingresá tu contraseña.';
        errEl.classList.add('show');
        return;
      }
      try {
        const { data: authData, error: authErr } = await supabaseClient.auth.signInWithPassword({ email, password: pass });
        if (authErr) {
          let msg = authErr.message || authErr.error_description || 'Error de autenticación';
          const invalidCreds = (msg === 'Invalid login credentials') || (authErr.status === 400 && typeof msg === 'string' && msg.toLowerCase().includes('invalid'));
          if (invalidCreds) {
            msg = 'Email o contraseña incorrectos. Revisá los datos o usá "¿Olvidaste tu contraseña?" para restablecerla.';
          } else if (msg && (msg.includes('Email not confirmed') || msg.includes('email not confirmed'))) {
            msg = 'Confirmá tu email primero. Revisá tu bandeja (y spam) por el correo de Supabase.';
          } else if (authErr.status === 400) {
            msg = 'Error al iniciar sesión. Verificá en Supabase: Authentication → Providers → Email habilitado.';
          }
          if (!invalidCreds) console.error('Supabase auth error:', authErr);
          errEl.textContent = msg;
          errEl.classList.add('show');
          return;
        }
        const uid = authData.user.id;
        let { data: profile, error: profileErr } = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
        if (profileErr && profileErr.code !== 'PGRST116') {
          errEl.textContent = 'Error al leer perfil: ' + (profileErr.message || 'verificá RLS en la tabla profiles');
          errEl.classList.add('show');
          return;
        }
        if (!profile) {
          var trialDaysNew = await getTrialDurationDays();
          const trialEndsAt = new Date(Date.now() + trialDaysNew * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
          var sponsorNew = await getSponsorIdForNewKiosqueroProfile();
          const { error: insertErr } = await supabaseClient.from('profiles').insert({ id: uid, email: authData.user.email, role: 'kiosquero', active: true, trial_ends_at: trialEndsAt, sponsor_id: sponsorNew || null });
          if (insertErr) {
            errEl.textContent = 'Error al crear perfil: ' + (insertErr.message || 'creá la tabla profiles y sus políticas RLS');
            errEl.classList.add('show');
            return;
          }
          const r = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
          profile = r.data;
          if (!profile) {
            errEl.textContent = 'No se pudo obtener el perfil. Revisá RLS en Supabase (profiles).';
            errEl.classList.add('show');
            return;
          }
        } else if (supabaseClient && (profile.role === 'partner' || profile.role === 'super')) {
          await ensureUserReferralCode(uid);
          var r3 = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
          if (r3.data) profile = r3.data;
        }
        if ((profile.role === 'kiosquero' || profile.role === 'partner') && !profile.active) {
          try {
            const { data: setData } = await supabaseClient.from('app_settings').select('value').eq('key', 'admin_whatsapp').maybeSingle();
            window._adminWhatsappForContact = (setData && setData.value) ? setData.value : '';
          } catch (_) { window._adminWhatsappForContact = ''; }
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          errEl.textContent = 'Tu cuenta está desactivada. Contactá al administrador por WhatsApp para darte de alta.';
          errEl.classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            await loadAdminContact();
            fillLoginContactLinks('Hola, mi cuenta de Ferriol OS está desactivada y quiero darme de alta.');
            wrap.classList.remove('hidden');
          }
          return;
        }
        const trialEndsAt = profile.trial_ends_at || null;
        if (profile.role === 'kiosquero' && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          try {
            await supabaseClient.from('profiles').update({ active: false }).eq('id', uid);
            await loadAdminContact();
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          errEl.textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá por WhatsApp para renovar.';
          errEl.classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks('Hola, mi período de prueba de Ferriol OS terminó y quiero renovar.');
            wrap.classList.remove('hidden');
          }
          return;
        }
        var userCreatedAt = (authData && authData.user && authData.user.created_at) ? authData.user.created_at : null;
        currentUser = { id: profile.id, email: profile.email, role: profile.role, active: profile.active, kioscoName: profile.kiosco_name || '', whatsappMessage: profile.whatsapp_message || DEFAULT_WHATSAPP, trialEndsAt: trialEndsAt, created_at: userCreatedAt, referralCode: profile.referral_code || '', sponsorId: profile.sponsor_id || null };
        await showApp();
      } catch (err) {
        console.error('Error en login:', err);
        const msg = 'Error inesperado: ' + (err.message || String(err));
        errEl.textContent = msg;
        errEl.classList.add('show');
        alert(msg);
      }
    }
    document.getElementById('loginBtn').onclick = doLogin;
    document.getElementById('loginForm').onsubmit = (e) => { e.preventDefault(); doLogin(); };

    function setupPasswordToggle(checkboxId, inputId) {
      const checkbox = document.getElementById(checkboxId);
      const input = document.getElementById(inputId);
      const label = checkbox ? checkbox.closest('label') : null;
      const labelSpan = label ? label.querySelector('.pwd-label') : null;
      if (!checkbox || !input) return;
      function sync() {
        const show = checkbox.checked;
        input.type = show ? 'text' : 'password';
        if (labelSpan) labelSpan.textContent = show ? 'Ocultar' : 'Ver';
        if (label) label.title = show ? 'Ocultar contraseña' : 'Ver contraseña';
      }
      checkbox.addEventListener('change', sync);
    }
    setupPasswordToggle('showLoginPwd', 'loginPassword');
    setupPasswordToggle('showSignUpPwd', 'signUpPassword');
    setupPasswordToggle('showNewPwd', 'newPwdInput');

    document.getElementById('doSetNewPwd').onclick = async () => {
      const newPwd = document.getElementById('newPwdInput').value.trim();
      const errEl = document.getElementById('loginErr');
      errEl.classList.remove('show');
      errEl.style.color = '#fca5a5';
      if (!newPwd || newPwd.length < 6) {
        errEl.textContent = 'La contraseña debe tener al menos 6 caracteres.';
        errEl.classList.add('show');
        return;
      }
      if (!supabaseClient) return;
      const { error } = await supabaseClient.auth.updateUser({ password: newPwd });
      if (error) {
        errEl.textContent = error.message;
        errEl.classList.add('show');
        return;
      }
      errEl.textContent = 'Contraseña actualizada. Ya podés iniciar sesión con la nueva contraseña.';
      errEl.style.color = '#86efac';
      errEl.classList.add('show');
      document.getElementById('setNewPwdBox').classList.add('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
      history.replaceState(null, '', location.pathname + location.search);
    };

    document.getElementById('showSignUp').onclick = (e) => {
      e.preventDefault();
      document.getElementById('loginFormWrap').classList.add('hidden');
      document.getElementById('resetPwdBox').classList.add('hidden');
      document.getElementById('signUpBox').classList.remove('hidden');
      document.getElementById('signUpSuccessBox').classList.add('hidden');
      document.getElementById('signUpErr').classList.remove('show');
      var refIn = document.getElementById('signUpReferralCode');
      if (refIn) {
        try {
          var st = normalizeReferralCode(sessionStorage.getItem('ferriol_signup_ref') || '');
          refIn.value = st || '';
        } catch (_) { refIn.value = ''; }
      }
      var stN = getSignupNichoFromStorage();
      var rSoc = document.querySelector('input[name="signUpNicho"][value="socio"]');
      var rKio = document.querySelector('input[name="signUpNicho"][value="kiosco"]');
      if (stN === 'socio' && rSoc) rSoc.checked = true;
      else if (rKio) rKio.checked = true;
      syncSignUpNichoUI();
    };
    document.querySelectorAll('input[name="signUpNicho"]').forEach(function (inp) {
      inp.addEventListener('change', syncSignUpNichoUI);
    });
    document.getElementById('backToLogin').onclick = (e) => {
      e.preventDefault();
      document.getElementById('signUpBox').classList.add('hidden');
      document.getElementById('signUpSuccessBox').classList.add('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
    };
    document.getElementById('goToLoginBtn').onclick = () => {
      document.getElementById('signUpSuccessBox').classList.add('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
      if (window._lastSignUpEmail) {
        document.getElementById('loginEmail').value = window._lastSignUpEmail;
        window._lastSignUpEmail = '';
      }
    };
    document.getElementById('forgotPwd').onclick = (e) => {
      e.preventDefault();
      document.getElementById('signUpBox').classList.add('hidden');
      document.getElementById('resetPwdBox').classList.toggle('hidden');
      document.getElementById('resetPwdEmail').value = document.getElementById('loginEmail').value;
    };
    document.getElementById('doResetPwd').onclick = async () => {
      const email = document.getElementById('resetPwdEmail').value.trim();
      const errEl = document.getElementById('loginErr');
      errEl.classList.remove('show');
      errEl.style.color = '#fca5a5';
      if (!email) {
        errEl.textContent = 'Ingresá tu email.';
        errEl.classList.add('show');
        return;
      }
      if (!supabaseClient) {
        errEl.textContent = 'Supabase no está configurado.';
        errEl.classList.add('show');
        return;
      }
      const redirectUrl = (APP_URL && !APP_URL.includes('TU-USUARIO')) ? APP_URL : window.location.href;
      const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: redirectUrl });
      if (error) {
        errEl.textContent = error.message;
        errEl.classList.add('show');
        return;
      }
      errEl.textContent = 'Revisá tu email. Te enviamos un enlace para restablecer la contraseña.';
      errEl.style.color = '#86efac';
      errEl.classList.add('show');
      document.getElementById('resetPwdBox').classList.add('hidden');
    };
    (function () {
      var termsHtml = '<p><strong>1. ACEPTACIÓN.</strong> Al crear una cuenta en Ferriol OS (“el Servicio”) aceptás estos Términos y Condiciones y el Contrato de Servicio. Si no aceptás, no podés usar el Servicio.</p>' +
        '<p><strong>2. DESCRIPCIÓN DEL SERVICIO.</strong> Ferriol OS es un sistema de gestión para kioscos y comercios ofrecido “tal cual” (as is). No garantizamos disponibilidad ininterrumpida ni ausencia de errores.</p>' +
        '<p><strong>3. PÉRDIDA DE DATOS — EXENCIÓN DE RESPONSABILIDAD.</strong> Ferriol OS y sus titulares <strong>no se hacen responsables</strong> por ninguna pérdida, corrupción o indisponibilidad de datos (productos, ventas, deudores, configuraciones o cualquier otro dato cargado en el Servicio). El usuario es responsable de realizar copias de seguridad periódicas utilizando las herramientas que ofrece la aplicación. El Servicio no sustituye el respaldo propio de la información crítica del negocio.</p>' +
        '<p><strong>4. DATOS Y PROPIEDAD.</strong> Los datos que el usuario ingresa en el Servicio son de su negocio. Ferriol OS actúa como proveedor del software y de la plataforma. El usuario otorga a Ferriol OS la licencia necesaria para almacenar, procesar y mostrar dichos datos con el fin de prestar el Servicio. Ferriol OS no vende los datos personales o de negocio del usuario a terceros. Los datos generados o alojados en la plataforma están sujetos a la política de uso del Servicio y a la legislación aplicable.</p>' +
        '<p><strong>5. USO ACEPTABLE.</strong> El usuario se compromete a usar el Servicio de forma lícita. Queda prohibido usarlo para actividades ilegales, fraudulentas o que vulneren derechos de terceros. Ferriol OS se reserva el derecho de suspender o dar de baja cuentas que incumplan estos términos.</p>' +
        '<p><strong>6. LIMITACIÓN DE RESPONSABILIDAD.</strong> En la máxima medida permitida por la ley aplicable, Ferriol OS y sus titulares no serán responsables por daños indirectos, incidentales, especiales, consecuentes o punitivos (incluyendo pérdida de beneficios, datos, clientes o buena voluntad). La responsabilidad total no excederá el monto abonado por el usuario en los últimos 12 meses por el Servicio, o cero si el Servicio fue gratuito.</p>' +
        '<p><strong>7. EXENCIÓN DE GARANTÍAS.</strong> El Servicio se presta “tal cual” y “según disponibilidad”. No ofrecemos garantías de ningún tipo, expresas o implícitas (incluyendo comerciabilidad o idoneidad para un fin determinado).</p>' +
        '<p><strong>8. SUSCRIPCIÓN Y CANCELACIÓN.</strong> La suscripción o período de prueba pueden estar sujetos a condiciones adicionales. Ferriol OS puede modificar, suspender o discontinuar el Servicio o estas condiciones, notificando cuando sea razonable. El usuario puede cerrar su cuenta en cualquier momento.</p>' +
        '<p><strong>9. JURISDICCIÓN.</strong> Estos términos se rigen por las leyes de la República Argentina. Cualquier controversia será sometida a los tribunales competentes en la República Argentina.</p>' +
        '<p><strong>10. CONTACTO.</strong> Para consultas sobre estos términos: contactar a Ferriol OS por los canales oficiales indicados en la aplicación.</p>' +
        '<p class="text-white/60 text-xs mt-4">Última actualización: 2025. Ferriol OS.</p>';
      document.getElementById('openTermsModal').onclick = function () {
        document.getElementById('termsContent').innerHTML = termsHtml;
        document.getElementById('termsModal').classList.remove('hidden');
        document.getElementById('termsModal').classList.add('flex');
      };
      document.getElementById('closeTermsModal').onclick = function () {
        document.getElementById('termsModal').classList.add('hidden');
        document.getElementById('termsModal').classList.remove('flex');
      };
      document.getElementById('termsModal').onclick = function (e) {
        if (e.target === document.getElementById('termsModal')) {
          document.getElementById('termsModal').classList.add('hidden');
          document.getElementById('termsModal').classList.remove('flex');
        }
      };
    })();

    document.getElementById('doSignUp').onclick = async () => {
      const email = document.getElementById('signUpEmail').value.trim();
      const password = document.getElementById('signUpPassword').value;
      const kioscoName = document.getElementById('signUpKioscoName').value.trim();
      const phone = document.getElementById('signUpPhone').value.trim();
      const errEl = document.getElementById('signUpErr');
      errEl.classList.remove('show');
      if (!document.getElementById('signUpAcceptTerms').checked) {
        errEl.textContent = 'Debés aceptar los Términos y Condiciones para crear la cuenta.';
        errEl.classList.add('show');
        return;
      }
      if (!email || !password || password.length < 6) {
        errEl.textContent = 'Email y contraseña (mín. 6 caracteres) son obligatorios.';
        errEl.classList.add('show');
        return;
      }
      if (!supabaseClient) {
        errEl.textContent = 'Configurá Supabase en el código.';
        errEl.classList.add('show');
        return;
      }
      var sp = await resolveSponsorForSignup();
      if (sp.error) {
        errEl.textContent = sp.error;
        errEl.classList.add('show');
        return;
      }
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) {
        errEl.textContent = error.message;
        errEl.classList.add('show');
        return;
      }
      const newId = data?.user?.id;
      var trialDaysSign = await getTrialDurationDays();
      const trialEndsAt = new Date(Date.now() + trialDaysSign * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
      if (!newId) {
        errEl.textContent = 'Registro recibido. Si tu proyecto pide confirmar el email, abrí el enlace del correo (y spam) antes de iniciar sesión. Después usá el mismo email y contraseña.';
        errEl.classList.add('show');
        return;
      }
      if (sp.sponsorId === newId) sp.sponsorId = null;
      var signupNicho = getSelectedSignupNicho();
      var newRole = signupNicho === 'socio' ? 'partner' : 'kiosquero';
      var upProf = await supabaseClient.from('profiles').upsert({
        id: newId,
        email: email,
        role: newRole,
        active: true,
        kiosco_name: kioscoName || null,
        trial_ends_at: trialEndsAt,
        phone: phone || null,
        sponsor_id: sp.sponsorId || null
      }, { onConflict: 'id' });
      if (upProf.error) {
        errEl.textContent = 'Usuario registrado, pero el perfil no se guardó: ' + (upProf.error.message || '') + ' Usá «Volver al inicio de sesión» e intentá entrar con el mismo email y contraseña. Si no entrás, revisá en Supabase la tabla profiles (columna phone, políticas RLS).';
        errEl.classList.add('show');
        return;
      }
      if (newRole === 'partner') await ensureUserReferralCode(newId);
      try { sessionStorage.removeItem('ferriol_signup_ref'); sessionStorage.removeItem('ferriol_signup_nicho'); } catch (_) {}
      document.getElementById('signUpBox').classList.add('hidden');
      document.getElementById('signUpSuccessBox').classList.remove('hidden');
      window._lastSignUpEmail = email;
    };

    function doLogout() {
      if (supabaseClient) supabaseClient.auth.signOut();
      ferriolStopNotificationPolling();
      _ferriolNotifFetchBaselineDone = false;
      currentUser = null;
      state.superUiMode = 'empresa';
      try { sessionStorage.removeItem('ferriol_super_ui'); } catch (_) {}
      state.cart = [];
      state.transaccionesList = [];
      _dataCache = { products: {}, ventas: { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 }, transacciones: 0, deudores: [], lastCierreDate: null };
      document.getElementById('appWrap').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('loginPassword').value = '';
    }
    document.getElementById('logoutBtn').onclick = doLogout;
    var logoutConfigEl = document.getElementById('logoutBtnConfig');
    if (logoutConfigEl) logoutConfigEl.onclick = doLogout;
    window._superIrModoNegocio = async function () {
      if (!currentUser || currentUser.role !== 'super') return;
      state.superUiMode = 'negocio';
      try { sessionStorage.setItem('ferriol_super_ui', 'negocio'); } catch (_) {}
      applyAppShell();
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = setInterval(updateTrialCountdown, 1000);
      await initData();
      renderInventory();
      updateCartUI();
      updateDashboard();
      state._restoringFromHistory = true;
      showPanel('dashboard');
      state._restoringFromHistory = false;
      history.replaceState({ panel: 'dashboard', root: true }, '', location.href);
      ferriolStartNotificationPolling();
      applyAppShell();
      lucide.createIcons();
    };
    window._superIrModoAdmin = async function () {
      if (!currentUser || currentUser.role !== 'super') return;
      await ferriolSetSuperLens('empresa');
    };
    var headerSubBtn = document.getElementById('headerSub');
    if (headerSubBtn) {
      headerSubBtn.addEventListener('click', function () {
        if (!currentUser || currentUser.role !== 'super') return;
        if (isSuperKioscoPreviewMode()) {
          ferriolSetSuperLens('empresa');
          return;
        }
        if (state.superUiMode === 'empresa') {
          ferriolSetSuperLens('socio');
          return;
        }
        if (state.superUiMode === 'socio') {
          ferriolSetSuperLens('negocio');
        }
      });
    }

    function fillConfigForm() {
      if (!currentUser) return;
      var asNegocio = currentUser.role === 'kiosquero' || isSuperKioscoPreviewMode();
      if (!asNegocio) return;
      document.getElementById('configKioscoName').value = currentUser.kioscoName || '';
      document.getElementById('configWhatsappMsg').value = currentUser.whatsappMessage || DEFAULT_WHATSAPP;
      var ns = document.getElementById('configNotifSoundEnabled');
      if (ns) ns.checked = ferriolNotifSoundEnabled();
      loadKioscoLicensePaymentInfo();
    }
    (function setupNotifSoundCheckbox() {
      var el = document.getElementById('configNotifSoundEnabled');
      if (!el) return;
      el.addEventListener('change', function () {
        try { localStorage.setItem(FERRIOL_NOTIF_SOUND_KEY, el.checked ? '1' : '0'); } catch (_) {}
      });
    })();
    async function saveConfig() {
      if (!currentUser) return;
      var asNegocio = currentUser.role === 'kiosquero' || isSuperKioscoPreviewMode();
      if (!asNegocio) return;
      const kioscoName = document.getElementById('configKioscoName').value.trim();
      const whatsappMessage = document.getElementById('configWhatsappMsg').value.trim() || DEFAULT_WHATSAPP;
      if (supabaseClient) {
        await supabaseClient.from('profiles').update({ kiosco_name: kioscoName, whatsapp_message: whatsappMessage }).eq('id', currentUser.id);
      }
      currentUser.kioscoName = kioscoName;
      currentUser.whatsappMessage = whatsappMessage;
      document.getElementById('headerTitle').textContent = kioscoName || 'Ferriol OS';
    }
    document.getElementById('saveConfig').onclick = () => saveConfig();

    async function exportBackup() {
      if (!currentUser?.id) return;
      var d = getData();
      var clientesExport = [];
      if (supabaseClient && currentUser.id) {
        try {
          var res = await supabaseClient.from('clientes').select('id, nombre, telefono, email, direccion, notas').eq('user_id', currentUser.id);
          if (!res.error && res.data) clientesExport = res.data;
        } catch (_) {}
      }
      var backup = {
        version: 2,
        exportedAt: new Date().toISOString(),
        userId: currentUser.id,
        kioscoName: currentUser.kioscoName || '',
        products: d.products || {},
        ventas: d.ventas || { efectivo: 0, tarjeta: 0, transferencia: 0, fiado: 0, transferencia_pendiente: 0, cobro_libreta: 0 },
        transacciones: d.transacciones || 0,
        clientes: clientesExport,
        lastCierreDate: d.lastCierreDate || null,
        transaccionesList: (state && state.transaccionesList) ? state.transaccionesList : []
      };
      var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
      var a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = 'ferriol-respaldo-' + new Date().toISOString().slice(0, 10) + '.json';
      a.click();
      URL.revokeObjectURL(a.href);
      var msg = document.getElementById('backupMessage');
      if (msg) { msg.textContent = 'Copia exportada (productos, clientes, caja del día). Guardá el archivo en un lugar seguro.'; msg.classList.remove('hidden'); msg.className = 'text-sm mt-2 text-green-400'; setTimeout(function () { msg.classList.add('hidden'); }, 4000); }
      lucide.createIcons();
    }
    function importBackup(file) {
      if (!file || !currentUser?.id) return;
      var msgEl = document.getElementById('backupMessage');
      var reader = new FileReader();
      reader.onload = async function () {
        try {
          var backup = JSON.parse(reader.result);
          if (!backup || typeof backup !== 'object') throw new Error('Archivo no válido');
          if (backup.products && typeof backup.products === 'object') _dataCache.products = backup.products;
          if (backup.ventas && typeof backup.ventas === 'object') _dataCache.ventas = backup.ventas;
          if (backup.transacciones !== undefined) _dataCache.transacciones = backup.transacciones;
          if (backup.lastCierreDate !== undefined) _dataCache.lastCierreDate = backup.lastCierreDate;
          if (backup.transaccionesList && Array.isArray(backup.transaccionesList) && state) state.transaccionesList = backup.transaccionesList;
          if (backup.clientes && Array.isArray(backup.clientes) && supabaseClient && currentUser.id) {
            await supabaseClient.from('clientes').delete().eq('user_id', currentUser.id);
            var rows = backup.clientes.map(function (c) {
              return { user_id: currentUser.id, nombre: c.nombre || null, telefono: c.telefono || null, email: c.email || null, direccion: c.direccion || null, notas: c.notas || null };
            });
            if (rows.length) await supabaseClient.from('clientes').insert(rows);
            clientesCache = backup.clientes.map(function (c, i) { return { id: c.id || '', nombre: c.nombre, telefono: c.telefono, email: c.email, direccion: c.direccion, notas: c.notas }; });
          }
          saveToLocalStorage();
          setData({ products: _dataCache.products, ventas: _dataCache.ventas, transacciones: _dataCache.transacciones, lastCierreDate: _dataCache.lastCierreDate });
          if (msgEl) { msgEl.textContent = 'Datos restaurados (productos, clientes, caja). Recargá la página si no ves los cambios.'; msgEl.classList.remove('hidden'); msgEl.className = 'text-sm mt-2 text-green-400'; setTimeout(function () { msgEl.classList.add('hidden'); }, 5000); }
          renderInventory();
          updateDashboard();
          if (typeof loadClientes === 'function') loadClientes().then(function () { if (typeof renderClientes === 'function') renderClientes(); });
        } catch (e) {
          if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'archivo no válido'); msgEl.classList.remove('hidden'); msgEl.className = 'text-sm mt-2 text-red-400'; }
        }
      };
      reader.readAsText(file);
    }
    document.getElementById('btnExportBackup').onclick = exportBackup;
    document.getElementById('inputImportBackup').onchange = function (e) { var f = e.target.files[0]; if (f) importBackup(f); e.target.value = ''; };

    var adminContact = { whatsapp: '', whatsappList: [] };
    function getWhatsAppUrl(num, text) {
      var digits = (num || '').replace(/\D/g, '');
      if (!digits) return '';
      var url = 'https://wa.me/' + digits;
      if (text) url += '?text=' + encodeURIComponent(text);
      return url;
    }
    function parseTrialReminderConfigValue(val) {
      var def = { windowDays: 5, messages: {} };
      if (!val || typeof val !== 'string') return def;
      try {
        var j = JSON.parse(val);
        if (j && typeof j === 'object') {
          def.windowDays = Math.min(30, Math.max(1, parseInt(j.windowDays, 10) || 5));
          if (j.messages && typeof j.messages === 'object') def.messages = j.messages;
        }
      } catch (_) {}
      return def;
    }
    async function loadTrialReminderConfigFromSupabase() {
      window._trialReminderConfig = { windowDays: 5, messages: {} };
      if (!supabaseClient) return;
      try {
        var r = await supabaseClient.from('app_settings').select('value').eq('key', 'trial_reminder_config').maybeSingle();
        if (r.data && r.data.value) window._trialReminderConfig = parseTrialReminderConfigValue(r.data.value);
      } catch (_) {}
    }
    function getTrialReminderWindowDays() {
      var c = window._trialReminderConfig || {};
      return Math.min(30, Math.max(1, parseInt(c.windowDays, 10) || 5));
    }
    function defaultTrialReminderBody(dLeft) {
      if (dLeft === 1) return '¡Queda 1 día para renovar! Evitá quedarte sin acceso a Ferriol OS.';
      return 'Quedan ' + dLeft + ' días para renovar tu plan. Mantené tu negocio activo sin interrupciones.';
    }
    function applyTrialReminderTokens(text, dLeft, kioscoName) {
      var t = (text || '').trim();
      if (!t) t = defaultTrialReminderBody(dLeft);
      var nombre = (kioscoName || '').trim() || 'tu negocio';
      return t
        .replace(/\{dias\}/gi, String(dLeft))
        .replace(/\{dias_restantes\}/gi, String(dLeft))
        .replace(/\{nombre\}/gi, nombre)
        .replace(/\{negocio\}/gi, nombre);
    }
    function trialReminderAckStorageKey(userId, trialEndsAt, dLeft) {
      var norm = String(trialEndsAt || '').replace(/[^0-9a-zA-Z]/g, '').slice(0, 24);
      return 'ferriol_trial_remind_ack_' + userId + '_' + norm + '_' + dLeft;
    }
    function buildTrialReminderSyntheticNotification() {
      if (!currentUser || currentUser.role !== 'kiosquero' || !currentUser.trialEndsAt) return null;
      var endsAt = currentUser.trialEndsAt;
      var end = new Date(endsAt);
      var now = new Date();
      var msLeft = end - now;
      if (msLeft <= 0) return null;
      var dLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      var win = getTrialReminderWindowDays();
      if (dLeft < 1 || dLeft > win) return null;
      try {
        if (localStorage.getItem(trialReminderAckStorageKey(currentUser.id, endsAt, dLeft))) return null;
      } catch (_) {}
      var cfg = window._trialReminderConfig || { messages: {} };
      var custom = (cfg.messages && (cfg.messages[String(dLeft)] != null ? cfg.messages[String(dLeft)] : cfg.messages[dLeft])) || '';
      var body = applyTrialReminderTokens(custom, dLeft, currentUser.kioscoName);
      var head = dLeft === 1 ? 'Queda 1 día para renovar' : ('Quedan ' + dLeft + ' días para renovar');
      return {
        id: '__ferriol_trial_' + dLeft + '_' + String(endsAt).slice(0, 16),
        created_at: new Date().toISOString(),
        message: head + '\n' + body,
        _trialSynthetic: true,
        _trialDLeft: dLeft
      };
    }
    function markTrialReminderAcknowledged() {
      if (!currentUser || currentUser.role !== 'kiosquero' || !currentUser.trialEndsAt) return;
      var endsAt = currentUser.trialEndsAt;
      var end = new Date(endsAt);
      var msLeft = end - new Date();
      if (msLeft <= 0) return;
      var dLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      var win = getTrialReminderWindowDays();
      if (dLeft < 1 || dLeft > win) return;
      try {
        localStorage.setItem(trialReminderAckStorageKey(currentUser.id, endsAt, dLeft), '1');
      } catch (_) {}
    }
    function readTrialReminderMessagesFromDom() {
      var map = {};
      document.querySelectorAll('#trialReminderMsgsContainer textarea[data-trial-msg-day]').forEach(function (ta) {
        var k = ta.getAttribute('data-trial-msg-day');
        if (k) map[k] = ta.value;
      });
      return map;
    }
    function fillTrialReminderAdminFields(cfg, preservedMap) {
      var container = document.getElementById('trialReminderMsgsContainer');
      var winInput = document.getElementById('trialReminderWindowDays');
      if (!container || !winInput) return;
      var w = Math.min(30, Math.max(1, parseInt(winInput.value, 10) || (cfg && cfg.windowDays) || 5));
      winInput.value = String(w);
      var msgs = (cfg && cfg.messages) || {};
      var pres = preservedMap || {};
      container.innerHTML = '';
      for (var d = w; d >= 1; d--) {
        var sk = String(d);
        var wrap = document.createElement('div');
        wrap.className = 'mb-3';
        var lab = document.createElement('label');
        lab.className = 'block text-xs text-white/70 mb-1';
        lab.innerHTML = 'Mensaje si quedan <strong>' + d + '</strong> ' + (d === 1 ? 'día' : 'días') + ' <span class="text-white/40 font-normal">(opcional)</span>';
        var ta = document.createElement('textarea');
        ta.rows = 2;
        ta.setAttribute('data-trial-msg-day', sk);
        ta.className = 'w-full glass rounded-xl px-3 py-2 border border-white/20 text-white text-sm placeholder-white/35 focus:outline-none focus:ring-2 focus:ring-[#22c55e] resize-y min-h-[3.5rem]';
        ta.placeholder = 'Ej: Aprovechá hoy para renovar y seguir con stock, caja y libreta sin cortes.';
        var v = pres[sk] != null ? pres[sk] : (msgs[sk] != null ? msgs[sk] : (msgs[d] != null ? msgs[d] : ''));
        ta.value = typeof v === 'string' ? v : String(v || '');
        wrap.appendChild(lab);
        wrap.appendChild(ta);
        container.appendChild(wrap);
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    async function loadAdminContact() {
      if (!supabaseClient) return;
      try {
        var res = await supabaseClient.from('app_settings').select('key, value').in('key', ['admin_whatsapp', 'admin_whatsapp_2', 'admin_whatsapp_3', 'admin_whatsapp_4']);
        var list = [];
        if (res.data && res.data.length) {
          var order = { admin_whatsapp: 0, admin_whatsapp_2: 1, admin_whatsapp_3: 2, admin_whatsapp_4: 3 };
          res.data.sort(function (a, b) { return (order[a.key] || 9) - (order[b.key] || 9); });
          res.data.forEach(function (r) {
            var v = (r.value || '').trim().replace(/\D/g, '');
            if (v) list.push(v);
          });
        }
        adminContact.whatsappList = list;
        adminContact.whatsapp = list[0] || '';
      } catch (_) {}
      await loadTrialReminderConfigFromSupabase();
    }
    function fillRenovarWhatsAppLinks() {
      var container = document.getElementById('renovarWhatsAppLinks');
      if (!container) return;
      var list = adminContact.whatsappList && adminContact.whatsappList.length ? adminContact.whatsappList : (adminContact.whatsapp ? [adminContact.whatsapp] : []);
      var msg = 'Hola, necesito ayuda con mi cuenta de Ferriol OS.';
      if (list.length === 0) {
        container.innerHTML = '<p class="text-white/60 text-sm">El administrador aún no configuró su WhatsApp.</p>';
      } else {
        container.innerHTML = list.map(function (num, i) {
          var label = list.length > 1 ? 'Contactar por WhatsApp (' + (i + 1) + ')' : 'Contactar por WhatsApp';
          return '<a href="' + getWhatsAppUrl(num, msg) + '" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-medium touch-target"><i data-lucide="message-circle" class="w-5 h-5"></i> ' + label + '</a>';
        }).join('');
      }
      lucide.createIcons();
    }
    function fillLoginContactLinks(message) {
      var container = document.getElementById('loginContactWhatsAppLinks');
      if (!container) return;
      var list = adminContact.whatsappList && adminContact.whatsappList.length ? adminContact.whatsappList : (adminContact.whatsapp ? [adminContact.whatsapp] : []);
      var msg = message || 'Hola, necesito ayuda con mi cuenta de Ferriol OS.';
      if (list.length === 0) {
        container.innerHTML = '<a href="#" class="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-medium text-sm touch-target"><i data-lucide="message-circle" class="w-5 h-5"></i> Contactar por WhatsApp</a>';
      } else {
        container.innerHTML = list.map(function (num, i) {
          var label = list.length > 1 ? 'Contactar por WhatsApp (' + (i + 1) + ')' : 'Contactar por WhatsApp';
          return '<a href="' + getWhatsAppUrl(num, msg) + '" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-green-600 hover:bg-green-500 text-white font-medium text-sm touch-target"><i data-lucide="message-circle" class="w-5 h-5"></i> ' + label + '</a>';
        }).join('');
      }
      lucide.createIcons();
    }
    var superUserListCache = [];
    function trialLabel(endsAt) {
      if (!endsAt) return { text: '—', days: 0 };
      const end = new Date(endsAt);
      const now = new Date();
      const days = Math.ceil((end - now) / (24 * 60 * 60 * 1000));
      if (days <= 0) return { text: 'Vencida', days: 0 };
      return { text: days + ' días', days };
    }
    /** Cuenta regresiva completa: días, horas, minutos, segundos (para panel admin) */
    function trialLabelFull(endsAt) {
      if (!endsAt) return { text: '—', d: 0, h: 0, m: 0, s: 0, expired: true };
      const end = new Date(endsAt);
      const now = new Date();
      let ms = end - now;
      if (isNaN(ms) || ms <= 0) return { text: 'Vencida', d: 0, h: 0, m: 0, s: 0, expired: true };
      const s = Math.floor((ms / 1000) % 60);
      const m = Math.floor((ms / (1000 * 60)) % 60);
      const h = Math.floor((ms / (1000 * 60 * 60)) % 24);
      const d = Math.floor(ms / (1000 * 60 * 60 * 24));
      const text = d + 'd ' + h + 'h ' + m + 'm ' + s + 's';
      return { text, d, h, m, s, expired: false };
    }
    var superDetailCountdownInterval = null;
    var superListCountdownInterval = null;
    function updateSuperListCountdowns() {
      document.querySelectorAll('#panel-super .super-list-countdown').forEach(function (span) {
        var card = span.closest('.super-user-card');
        var endsAt = card && card.getAttribute('data-trial-ends-at');
        var t = trialLabelFull(endsAt);
        span.textContent = t.expired ? 'Vencida' : t.text;
        span.className = 'super-list-countdown px-2 py-1 rounded-lg text-xs ' + (t.expired ? 'bg-red-500/20 text-red-300' : 'bg-[#dc2626]/30 text-[#f87171]');
      });
    }
    function openSuperUserDetail(user) {
      if (superDetailCountdownInterval) clearInterval(superDetailCountdownInterval);
      superDetailCountdownInterval = null;
      const modal = document.getElementById('superUserDetailModal');
      const title = document.getElementById('superUserDetailTitle');
      const content = document.getElementById('superUserDetailContent');
      const name = (user.kiosco_name || user.email || 'Sin nombre').replace(/</g, '&lt;');
      const email = (user.email || '').replace(/</g, '&lt;');
      const trialFull = trialLabelFull(user.trial_ends_at);
      var pool = window._ferriolAllProfilesCache || superUserListCache;
      var sponsorLine = '—';
      if (user.sponsor_id) {
        if (currentUser && user.sponsor_id === currentUser.id) sponsorLine = 'Vos (referidor directo)';
        else {
          var spRow = pool.find(function (x) { return x.id === user.sponsor_id; });
          sponsorLine = spRow ? ((spRow.kiosco_name || spRow.email || '').replace(/</g, '&lt;')) : ('ID ' + String(user.sponsor_id).slice(0, 8) + '…');
        }
      }
      var refCodeEsc = (user.referral_code || '—').replace(/</g, '&lt;');
      var assignHtml = '';
      if (isEmpresaLensSuper()) {
        var poolFull = window._ferriolAllProfilesCache || [];
        var opts = ['<option value="">— Sin referidor / sin asignar —</option>'];
        var candidates = poolFull.filter(function (p) { return p.id !== user.id; }).slice().sort(function (a, b) {
          var ra = (a.role === 'super') ? 0 : (a.role === 'partner') ? 1 : 2;
          var rb = (b.role === 'super') ? 0 : (b.role === 'partner') ? 1 : 2;
          if (ra !== rb) return ra - rb;
          return (a.kiosco_name || a.email || '').localeCompare(b.kiosco_name || b.email || '');
        });
        candidates.forEach(function (p) {
          var lab = '[' + (p.role || 'kiosquero') + '] ' + (p.kiosco_name || p.email || '').slice(0, 36) + (p.email ? (' · ' + p.email) : '');
          var sel = (user.sponsor_id && p.id === user.sponsor_id) ? ' selected' : '';
          opts.push('<option value="' + p.id + '"' + sel + '>' + lab.replace(/</g, '&lt;') + '</option>');
        });
        assignHtml = `
        <div class="border-t border-white/10 pt-4 space-y-2">
          <p class="text-sm font-medium text-[#86efac] flex items-center gap-2"><i data-lucide="git-branch" class="w-4 h-4"></i> Asignar referidor / admin de la red</p>
          <p class="text-xs text-white/50">Elegí bajo qué cuenta queda este integrante (define equipo MLM y visibilidad para líderes). Los administradores <span class="text-violet-200">super</span> aparecen primero.</p>
          <select id="superDetailSponsorSelect" class="w-full glass rounded-xl px-3 py-2.5 border border-white/20 text-white text-sm bg-black/20">${opts.join('')}</select>
          <button type="button" class="super-detail-save-sponsor w-full py-2.5 rounded-xl text-sm bg-[#22c55e]/25 text-[#86efac] border border-[#22c55e]/50 touch-target font-medium">Guardar referidor</button>
        </div>`;
      }
      var sponsorIsPartner = false;
      if (user.sponsor_id && pool && pool.length) {
        var spRow0 = pool.find(function (x) { return x && x.id === user.sponsor_id; });
        sponsorIsPartner = !!(spRow0 && spRow0.role === 'partner');
      }
      var defSaleHtml = '';
      if (isEmpresaLensSuper() && user.role === 'kiosquero' && user.sponsor_id && sponsorIsPartner) {
        defSaleHtml = `
        <div class="border-t border-white/10 pt-4 space-y-2">
          <p class="text-sm font-medium text-cyan-200/95 flex items-center gap-2"><i data-lucide="percent" class="w-4 h-4"></i> Venta licencia kiosco (alta definitiva)</p>
          <p class="text-xs text-white/55">Cuando el negocio ya pasó la prueba y cerraste la venta con el socio vendedor, registrá una vez la operación: <strong class="text-white/75">20% empresa</strong> y <strong class="text-white/75">80% vendedor</strong> sobre el valor mensual del plan (ver <code class="text-cyan-200/80">mlm_plan_config</code>). El socio verá el 20% como saldo a pagar a la empresa y el 80% como comisión pendiente.</p>
          <button type="button" class="super-detail-definitive-sale w-full py-2.5 rounded-xl text-sm bg-cyan-500/20 text-cyan-100 border border-cyan-400/45 touch-target font-medium">Registrar venta (20% / 80%)</button>
        </div>`;
      }
      var quitarHtml = isPartnerLens() ? '' : `
            <button type="button" class="super-detail-quitar w-full py-2.5 rounded-xl text-sm bg-red-500/20 text-red-300 border border-red-500/40 touch-target flex items-center justify-center gap-2">
              <i data-lucide="user-minus" class="w-4 h-4"></i> Quitar negocio (pide contraseña admin)
            </button>`;
      title.textContent = name;
      content.innerHTML = `
        <div class="space-y-1 text-sm text-white/80">
          <p><span class="text-white/50">Email:</span> ${email || '—'}</p>
          <p><span class="text-white/50">Rol:</span> ${(user.role || 'kiosquero').replace(/</g, '&lt;')}</p>
          <p><span class="text-white/50">Estado:</span> <span class="${user.active ? 'text-green-300' : 'text-red-300'}">${user.active ? 'Activo' : 'Inactivo'}</span></p>
          <p><span class="text-white/50">Membresía:</span> <span id="superDetailCountdown" class="${trialFull.expired ? 'text-red-300' : 'text-[#f87171]'}">${trialFull.text}</span></p>
          <p><span class="text-white/50">Código de referido:</span> ${refCodeEsc}</p>
          <p><span class="text-white/50">Referido por:</span> ${sponsorLine}</p>
        </div>
        ${assignHtml}
        ${defSaleHtml}
        <div class="border-t border-white/10 pt-4 space-y-3">
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm text-white/70">Activar/Desactivar:</span>
            <button type="button" class="super-detail-toggle toggle-switch ${user.active ? 'active' : ''}" title="${user.active ? 'Desactivar' : 'Activar'}"></button>
          </div>
          <div class="flex flex-wrap items-center gap-2">
            <span class="text-sm text-white/70 w-full">Días de membresía:</span>
            <input type="number" min="1" max="365" value="30" class="super-detail-days-input w-16 px-2 py-2 rounded-lg text-sm bg-white/10 border border-white/20 text-white touch-target">
            <button type="button" class="super-detail-add-days px-3 py-2 rounded-lg text-sm bg-green-500/20 text-green-300 border border-green-500/40 touch-target">+ Agregar</button>
            <button type="button" class="super-detail-remove-days px-3 py-2 rounded-lg text-sm bg-red-500/20 text-red-300 border border-red-500/40 touch-target">− Quitar</button>
          </div>
          <div class="flex flex-col gap-2 pt-2">
            <button type="button" class="super-detail-reset w-full py-2.5 rounded-xl text-sm bg-amber-500/20 text-amber-300 border border-amber-500/40 touch-target flex items-center justify-center gap-2">
              <i data-lucide="key" class="w-4 h-4"></i> Enviar enlace para restablecer contraseña
            </button>
            <button type="button" class="super-detail-email w-full py-2.5 rounded-xl text-sm bg-[#dc2626]/30 text-[#f87171] border border-[#dc2626]/50 touch-target flex items-center justify-center gap-2">
              <i data-lucide="mail" class="w-4 h-4"></i> Cómo cambiar el email (Supabase)
            </button>
            ${quitarHtml}
          </div>
        </div>
      `;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      lucide.createIcons();
      var u = user;
      var defSaleBtn = content.querySelector('.super-detail-definitive-sale');
      if (defSaleBtn) {
        defSaleBtn.onclick = async function () {
          if (!supabaseClient) return;
          if (!confirm('Se registrará en el libro la venta de licencia kiosco para este negocio (20% empresa, 80% del socio vendedor referidor). Solo se puede una vez por kiosco. ¿Continuar?')) return;
          var rpc = await supabaseClient.rpc('ferriol_register_kiosco_definitive_sale', { p_kiosco_user_id: u.id });
          if (rpc.error) { alert('Error: ' + (rpc.error.message || '')); return; }
          var out = rpc.data;
          if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
          if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo registrar.'); return; }
          alert('Registrado. Empresa: 20% pendiente de cobro. Socio: 20% a pagar y 80% comisión pendiente (ver panel del socio).');
          if (state.superSection === 'cobros') renderSuperCobrosSection();
          openSuperUserDetail(u);
        };
      }
      content.querySelector('.super-detail-toggle').onclick = async () => {
        if (!supabaseClient) return;
        const newActive = !u.active;
        await supabaseClient.from('profiles').update({ active: newActive }).eq('id', u.id);
        u.active = newActive;
        openSuperUserDetail(u);
      };
      content.querySelector('.super-detail-add-days').onclick = async () => {
        if (!supabaseClient) return;
        const input = content.querySelector('.super-detail-days-input');
        const days = Math.max(1, Math.min(365, parseInt(input.value || 30, 10) || 30));
        const now = new Date();
        const currentEnd = u.trial_ends_at ? new Date(u.trial_ends_at) : null;
        const from = (currentEnd && currentEnd > now) ? currentEnd : now;
        const newEnd = new Date(from);
        newEnd.setDate(newEnd.getDate() + days);
        u.trial_ends_at = newEnd.toISOString().slice(0, 19) + 'Z';
        const { error } = await supabaseClient.from('profiles').update({ trial_ends_at: u.trial_ends_at, active: true }).eq('id', u.id);
        if (error) { alert('Error: ' + error.message); return; }
        u.active = true;
        openSuperUserDetail(u);
      };
      content.querySelector('.super-detail-remove-days').onclick = async () => {
        if (!supabaseClient) return;
        const input = content.querySelector('.super-detail-days-input');
        const days = Math.max(1, Math.min(365, parseInt(input.value || 30, 10) || 30));
        const currentEnd = u.trial_ends_at ? new Date(u.trial_ends_at) : new Date();
        const newEnd = new Date(currentEnd);
        newEnd.setDate(newEnd.getDate() - days);
        u.trial_ends_at = newEnd.toISOString().slice(0, 19) + 'Z';
        const { error } = await supabaseClient.from('profiles').update({ trial_ends_at: u.trial_ends_at }).eq('id', u.id);
        if (error) { alert('Error: ' + error.message); return; }
        openSuperUserDetail(u);
      };
      content.querySelector('.super-detail-reset').onclick = async () => {
        const email = u.email;
        if (!email) return;
        const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: (typeof APP_URL !== 'undefined' && APP_URL) ? APP_URL : window.location.href });
        if (error) alert('Error: ' + error.message);
        else alert('Se envió un correo a ' + email + ' para restablecer la contraseña.');
      };
      content.querySelector('.super-detail-email').onclick = () => {
        const m = (SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/);
        const projectRef = m ? m[1] : null;
        const supabaseAuthUrl = projectRef ? 'https://supabase.com/dashboard/project/' + projectRef + '/auth/users' : null;
        const msg = 'Para cambiar el email:\n\n1. Supabase → Authentication → Users\n2. Buscá: ' + u.email + '\n3. Edit → cambiá el email.\n\n¿Abrir Supabase?';
        if (supabaseAuthUrl && confirm(msg)) window.open(supabaseAuthUrl, '_blank');
        else alert(msg);
      };
      var saveSponsorBtn = content.querySelector('.super-detail-save-sponsor');
      if (saveSponsorBtn) saveSponsorBtn.onclick = async function () {
        if (!supabaseClient) return;
        var sel = content.querySelector('#superDetailSponsorSelect');
        var val = sel ? String(sel.value || '').trim() : '';
        var newSid = val || null;
        if (newSid === u.id) { alert('No puede ser su propio referidor.'); return; }
        var { error: errSp } = await supabaseClient.from('profiles').update({ sponsor_id: newSid }).eq('id', u.id);
        if (errSp) { alert('Error: ' + errSp.message); return; }
        u.sponsor_id = newSid;
        var idxAll = (window._ferriolAllProfilesCache || []).findIndex(function (r) { return r.id === u.id; });
        if (idxAll >= 0) window._ferriolAllProfilesCache[idxAll].sponsor_id = newSid;
        alert('Referidor actualizado.');
        openSuperUserDetail(u);
        renderSuper();
      };
      var quitarBtn = content.querySelector('.super-detail-quitar');
      if (quitarBtn) quitarBtn.onclick = async () => {
        var pwdInput = document.getElementById('adminDeletePassword');
        var storedPwd = (pwdInput && pwdInput.value) ? pwdInput.value : '';
        if (!storedPwd) { alert('Configurá primero la contraseña para quitar usuarios en Ajustes.'); return; }
        var entered = prompt('Ingresá la contraseña de admin para quitar este negocio:');
        if (entered === null) return;
        if (entered !== storedPwd) { alert('Contraseña incorrecta.'); return; }
        if (!confirm('¿Desactivar este negocio? Ya no podrá iniciar sesión.')) return;
        if (!supabaseClient) return;
        const { error } = await supabaseClient.from('profiles').update({ active: false }).eq('id', u.id);
        if (error) { alert('Error: ' + error.message); return; }
        document.getElementById('superUserDetailClose').click();
        renderSuper();
      };
      const countdownEl = content.querySelector('#superDetailCountdown');
      if (countdownEl) {
        superDetailCountdownInterval = setInterval(function () {
          const t = trialLabelFull(u.trial_ends_at);
          countdownEl.textContent = t.text;
          countdownEl.className = t.expired ? 'text-red-300' : 'text-[#f87171]';
        }, 1000);
      }
    }
    document.getElementById('superUserDetailClose').onclick = () => {
      if (superDetailCountdownInterval) clearInterval(superDetailCountdownInterval);
      superDetailCountdownInterval = null;
      document.getElementById('superUserDetailModal').classList.add('hidden');
      document.getElementById('superUserDetailModal').classList.remove('flex');
      renderSuper();
    };
    document.getElementById('superUserDetailOverlay').onclick = () => { if (superDetailCountdownInterval) clearInterval(superDetailCountdownInterval); superDetailCountdownInterval = null; document.getElementById('superUserDetailClose').click(); };

    var superFilterState = 'todos';
    async function renderSuper() {
      if (!supabaseClient) return;
      try {
        const { data: settingsRows } = await supabaseClient.from('app_settings').select('key, value').in('key', ['admin_whatsapp', 'admin_whatsapp_2', 'admin_whatsapp_3', 'admin_whatsapp_4', 'admin_delete_password', 'trial_reminder_config', 'ferriol_transfer_info', 'trial_duration_days']);
        var whatsappInput = document.getElementById('adminContactWhatsapp');
        var whatsapp2Input = document.getElementById('adminContactWhatsapp2');
        var whatsapp3Input = document.getElementById('adminContactWhatsapp3');
        var whatsapp4Input = document.getElementById('adminContactWhatsapp4');
        var deletePwdInput = document.getElementById('adminDeletePassword');
        var transferInfoTa = document.getElementById('adminTransferInfo');
        var trialDurInput = document.getElementById('adminTrialDurationDays');
        var trialCfgParsed = { windowDays: 5, messages: {} };
        if (settingsRows) {
          settingsRows.forEach(function (r) {
            if (r.key === 'admin_whatsapp' && whatsappInput) whatsappInput.value = r.value || '';
            if (r.key === 'admin_whatsapp_2' && whatsapp2Input) whatsapp2Input.value = r.value || '';
            if (r.key === 'admin_whatsapp_3' && whatsapp3Input) whatsapp3Input.value = r.value || '';
            if (r.key === 'admin_whatsapp_4' && whatsapp4Input) whatsapp4Input.value = r.value || '';
            if (r.key === 'admin_delete_password' && deletePwdInput) deletePwdInput.value = r.value || '';
            if (r.key === 'ferriol_transfer_info' && transferInfoTa) transferInfoTa.value = r.value || '';
            if (r.key === 'trial_duration_days' && trialDurInput) {
              var td = parseInt(r.value, 10);
              trialDurInput.value = (!isNaN(td) && td >= 1 && td <= 365) ? String(td) : '15';
            }
            if (r.key === 'trial_reminder_config') trialCfgParsed = parseTrialReminderConfigValue(r.value || '');
          });
        }
        window._superTrialReminderEditCache = trialCfgParsed;
        var winDaysInput = document.getElementById('trialReminderWindowDays');
        if (winDaysInput) winDaysInput.value = String(trialCfgParsed.windowDays);
        if (!isPartnerLens()) fillTrialReminderAdminFields(trialCfgParsed, null);
        if (superFilterState !== 'todos') {
          document.querySelectorAll('.super-filter-btn').forEach(function (b) {
            var active = b.dataset.filter === superFilterState;
            var mm = b.classList.contains('super-main-only') ? ' super-only super-main-only' : '';
            var visual = active ? 'border-[#dc2626]/50 bg-[#dc2626]/30' : (b.dataset.filter === 'sin_referidor' ? 'border-amber-500/40 glass' : 'border-white/20 glass');
            b.className = 'super-filter-btn px-3 py-1.5 rounded-lg text-sm font-medium border touch-target' + mm + ' ' + visual;
          });
        }
      } catch (_) {}
      const { data: allProfiles, error: errProfiles } = await supabaseClient.from('profiles').select('id, email, role, active, kiosco_name, trial_ends_at, sponsor_id, referral_code');
      window._ferriolAllProfilesCache = allProfiles || [];
      var list = (allProfiles || []).filter(u => u.id !== currentUser?.id);
      if (isPartnerLens()) {
        var downIds = getPartnerDownlineUserIdSet(allProfiles || [], currentUser.id);
        list = list.filter(function (u) { return downIds.has(u.id); });
      }
      if (superFilterState === 'activos') list = list.filter(u => u.active);
      else if (superFilterState === 'inactivos') list = list.filter(u => !u.active);
      else if (superFilterState === 'sin_referidor') list = list.filter(function (u) { return !u.sponsor_id; });
      superUserListCache = list.slice();
      var statsEl = document.getElementById('superDirectoryStats');
      if (statsEl && isEmpresaLensSuper()) {
        var totalN = (allProfiles || []).length;
        var sinRef = (allProfiles || []).filter(function (r) { return !r.sponsor_id; }).length;
        statsEl.textContent = 'Integrantes en el sistema: ' + totalN + ' · Sin referidor: ' + sinRef;
        statsEl.classList.remove('hidden');
      } else if (statsEl) { statsEl.classList.add('hidden'); statsEl.textContent = ''; }
      var searchEl = document.getElementById('superSearchEmail');
      var searchTerm = (searchEl && searchEl.value) ? searchEl.value.trim().toLowerCase() : '';
      if (searchTerm) list = list.filter(function (u) {
        var email = (u.email || '').toLowerCase();
        var name = (u.kiosco_name || '').toLowerCase();
        return email.indexOf(searchTerm) !== -1 || name.indexOf(searchTerm) !== -1;
      });
      list.sort((a, b) => {
        const na = (a.kiosco_name || '').toLowerCase().trim() || 'zzz';
        const nb = (b.kiosco_name || '').toLowerCase().trim() || 'zzz';
        return na.localeCompare(nb);
      });
      const listEl = document.getElementById('superUsersList');
      if (errProfiles) {
        listEl.innerHTML = '<p class="py-4 text-center text-red-300 text-sm">Error al cargar. Revisá las políticas RLS de la tabla profiles.</p>';
        lucide.createIcons();
        return;
      }
      if (list.length === 0 && (isEmpresaLensSuper() || isPartnerLens())) {
        var msg = searchTerm ? 'Ningún usuario coincide con la búsqueda.' : (isPartnerLens() ? 'No hay negocios en tu red todavía.' : (superFilterState === 'sin_referidor' ? 'No hay integrantes sin referidor. Todo el mundo tiene admin/referidor asignado.' : superFilterState === 'activos' ? 'No hay negocios activos.' : superFilterState === 'inactivos' ? 'No hay negocios inactivos.' : 'No hay otros negocios. Agregá uno con el botón de arriba.'));
        listEl.innerHTML = '<p class="py-6 text-center text-white/70 text-sm">' + msg + '</p>';
        lucide.createIcons();
        return;
      }
      listEl.innerHTML = list.map(u => {
        const name = (u.kiosco_name || u.email || 'Sin nombre').replace(/</g, '&lt;');
        const trialFull = trialLabelFull(u.trial_ends_at);
        const badge = trialFull.expired ? 'Vencida' : trialFull.text;
        const badgeClass = trialFull.expired ? 'bg-red-500/20 text-red-300' : 'bg-[#dc2626]/30 text-[#f87171]';
        const endIso = (u.trial_ends_at || '').replace(/"/g, '&quot;');
        var rolePill = (u.role === 'super') ? '<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-violet-500/30 text-violet-200 border border-violet-400/30 shrink-0">Root</span>' : ((u.role === 'partner') ? '<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-cyan-500/25 text-cyan-200 border border-cyan-400/25 shrink-0">Red</span>' : '');
        var sinRefPill = (!u.sponsor_id && isEmpresaLensSuper()) ? '<span class="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-200 border border-amber-400/35 shrink-0">Sin ref.</span>' : '';
        return `
          <button type="button" class="super-user-card w-full text-left glass rounded-xl p-4 flex items-center justify-between gap-3 border border-white/10 hover:border-[#dc2626]/40 active:scale-[0.99] transition-all touch-target" data-id="${u.id}" data-trial-ends-at="${endIso}">
            <div class="flex-1 min-w-0">
              <p class="font-semibold truncate flex items-center gap-2 flex-wrap">${name}${rolePill}${sinRefPill}</p>
              <p class="text-xs text-white/50 truncate mt-0.5">${(u.email || '').replace(/</g, '&lt;')}</p>
            </div>
            <div class="flex items-center gap-2 shrink-0">
              <span class="super-list-countdown px-2 py-1 rounded-lg text-xs ${badgeClass}">${badge}</span>
              <i data-lucide="chevron-right" class="w-5 h-5 text-white/40"></i>
            </div>
          </button>
        `;
      }).join('');
      listEl.querySelectorAll('.super-user-card').forEach(btn => {
        btn.onclick = () => {
          const id = btn.dataset.id;
          const user = list.find(u => u.id === id);
          if (user) openSuperUserDetail(user);
        };
      });
      var netInfoEl = document.getElementById('superPartnerNetInfo');
      if (netInfoEl) {
        if (isPartnerLens()) {
          function finishPartnerNetInfo(cc) {
            var c = cc || '';
            var cSafe = String(c || '—').replace(/</g, '&lt;').replace(/&/g, '&amp;');
            netInfoEl.innerHTML = '<p class="text-xs text-white/80 mb-2">Tu código de red: <span class="font-mono font-bold text-amber-200 tracking-wide">' + cSafe + '</span>. Un código, dos enlaces:</p>' +
              '<div class="space-y-2 text-xs">' +
              '<div><span class="text-white/55 block mb-1">Negocios (kioscos / almacenes)</span><div class="flex gap-2"><input type="text" id="partnerNetLinkK" readonly class="flex-1 glass rounded-lg px-2 py-1.5 border border-white/20 text-white min-w-0 text-[10px] sm:text-xs" /><button type="button" id="partnerNetBtnK" class="btn-glow shrink-0 px-2 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold touch-target">Copiar</button></div></div>' +
              '<div><span class="text-white/55 block mb-1">Vendedores (membresía)</span><div class="flex gap-2"><input type="text" id="partnerNetLinkS" readonly class="flex-1 glass rounded-lg px-2 py-1.5 border border-white/20 text-white min-w-0 text-[10px] sm:text-xs" /><button type="button" id="partnerNetBtnS" class="btn-glow shrink-0 px-2 py-1.5 rounded-lg text-[10px] sm:text-xs font-semibold touch-target">Copiar</button></div></div></div>';
            var ink = document.getElementById('partnerNetLinkK');
            var ins = document.getElementById('partnerNetLinkS');
            if (c && ink) ink.value = ferriolReferralInviteUrl(c, 'kiosco');
            if (c && ins) ins.value = ferriolReferralInviteUrl(c, 'socio');
            var bk = document.getElementById('partnerNetBtnK');
            var bs = document.getElementById('partnerNetBtnS');
            if (bk) bk.onclick = function () { copyTextToClipboard((document.getElementById('partnerNetLinkK') || {}).value, 'Enlace para negocios copiado.'); };
            if (bs) bs.onclick = function () { copyTextToClipboard((document.getElementById('partnerNetLinkS') || {}).value, 'Enlace para vendedores copiado.'); };
            netInfoEl.classList.remove('hidden');
          }
          var cShow = currentUser.referralCode;
          if (!cShow && supabaseClient) {
            ensureUserReferralCode(currentUser.id).then(function (cc) {
              if (cc) currentUser.referralCode = cc;
              finishPartnerNetInfo(cc);
            });
          } else finishPartnerNetInfo(cShow);
        } else {
          netInfoEl.classList.add('hidden');
          netInfoEl.textContent = '';
        }
      }
      await loadSuperMainFerriolResumenCard();
      await loadPartnerCommissionsCard();
      lucide.createIcons();
    }
    function renderSuperListFromSearch() {
      var listEl = document.getElementById('superUsersList');
      if (!listEl || !superUserListCache.length) return;
      var searchEl = document.getElementById('superSearchEmail');
      var searchTerm = (searchEl && searchEl.value) ? searchEl.value.trim().toLowerCase() : '';
      var list = superUserListCache.slice();
      if (superFilterState === 'activos') list = list.filter(function (u) { return u.active; });
      else if (superFilterState === 'inactivos') list = list.filter(function (u) { return !u.active; });
      else if (superFilterState === 'sin_referidor') list = list.filter(function (u) { return !u.sponsor_id; });
      if (searchTerm) list = list.filter(function (u) {
        var email = (u.email || '').toLowerCase();
        var name = (u.kiosco_name || '').toLowerCase();
        return email.indexOf(searchTerm) !== -1 || name.indexOf(searchTerm) !== -1;
      });
      list.sort((a, b) => {
        const na = (a.kiosco_name || '').toLowerCase().trim() || 'zzz';
        const nb = (b.kiosco_name || '').toLowerCase().trim() || 'zzz';
        return na.localeCompare(nb);
      });
      if (list.length === 0) {
        listEl.innerHTML = '<p class="py-6 text-center text-white/70 text-sm">Ningún usuario coincide con la búsqueda.</p>';
        lucide.createIcons();
        return;
      }
      listEl.innerHTML = list.map(function (u) {
        var name = (u.kiosco_name || u.email || 'Sin nombre').replace(/</g, '&lt;');
        var trialFull = trialLabelFull(u.trial_ends_at);
        var badge = trialFull.expired ? 'Vencida' : trialFull.text;
        var badgeClass = trialFull.expired ? 'bg-red-500/20 text-red-300' : 'bg-[#dc2626]/30 text-[#f87171]';
        var endIso = (u.trial_ends_at || '').replace(/"/g, '&quot;');
        var rolePill = (u.role === 'super') ? '<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-violet-500/30 text-violet-200 border border-violet-400/30 shrink-0">Root</span>' : ((u.role === 'partner') ? '<span class="text-[10px] uppercase tracking-wide px-1.5 py-0.5 rounded-md bg-cyan-500/25 text-cyan-200 border border-cyan-400/25 shrink-0">Red</span>' : '');
        var sinRefPill = (!u.sponsor_id && isEmpresaLensSuper()) ? '<span class="text-[10px] px-1.5 py-0.5 rounded-md bg-amber-500/20 text-amber-200 border border-amber-400/35 shrink-0">Sin ref.</span>' : '';
        return '<button type="button" class="super-user-card w-full text-left glass rounded-xl p-4 flex items-center justify-between gap-3 border border-white/10 hover:border-[#dc2626]/40 active:scale-[0.99] transition-all touch-target" data-id="' + u.id + '" data-trial-ends-at="' + endIso + '"><div class="flex-1 min-w-0"><p class="font-semibold truncate flex items-center gap-2 flex-wrap">' + name + rolePill + sinRefPill + '</p><p class="text-xs text-white/50 truncate mt-0.5">' + (u.email || '').replace(/</g, '&lt;') + '</p></div><div class="flex items-center gap-2 shrink-0"><span class="super-list-countdown px-2 py-1 rounded-lg text-xs ' + badgeClass + '">' + badge + '</span><i data-lucide="chevron-right" class="w-5 h-5 text-white/40"></i></div></button>';
      }).join('');
      listEl.querySelectorAll('.super-user-card').forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.dataset.id;
          var user = list.find(function (u) { return u.id === id; });
          if (user) openSuperUserDetail(user);
        };
      });
      lucide.createIcons();
    }
    var superSearchInput = document.getElementById('superSearchEmail');
    if (superSearchInput) superSearchInput.addEventListener('input', renderSuperListFromSearch);
    if (superSearchInput) superSearchInput.addEventListener('search', renderSuperListFromSearch);
    document.getElementById('saveAdminContact').onclick = async () => {
      if (isPartnerLens()) return;
      const whatsapp = (document.getElementById('adminContactWhatsapp').value || '').trim().replace(/\D/g, '');
      const whatsapp2 = (document.getElementById('adminContactWhatsapp2').value || '').trim().replace(/\D/g, '');
      const whatsapp3 = (document.getElementById('adminContactWhatsapp3').value || '').trim().replace(/\D/g, '');
      const whatsapp4 = (document.getElementById('adminContactWhatsapp4').value || '').trim().replace(/\D/g, '');
      const deletePwd = (document.getElementById('adminDeletePassword').value || '').trim();
      const msgEl = document.getElementById('adminContactMsg');
      if (!supabaseClient) return;
      try {
        var winEl = document.getElementById('trialReminderWindowDays');
        var winDays = Math.min(30, Math.max(1, parseInt(winEl && winEl.value, 10) || 5));
        var msgObj = {};
        for (var d = winDays; d >= 1; d--) {
          var ta = document.querySelector('#trialReminderMsgsContainer textarea[data-trial-msg-day="' + d + '"]');
          msgObj[String(d)] = ta ? String(ta.value || '').trim() : '';
        }
        var trialReminderJson = JSON.stringify({ windowDays: winDays, messages: msgObj });
        var transferInfo = (document.getElementById('adminTransferInfo') && document.getElementById('adminTransferInfo').value != null) ? String(document.getElementById('adminTransferInfo').value || '') : '';
        var trialDurEl = document.getElementById('adminTrialDurationDays');
        var trialDurSave = Math.min(365, Math.max(1, parseInt(trialDurEl && trialDurEl.value, 10) || 15));
        await supabaseClient.from('app_settings').upsert([
          { key: 'admin_whatsapp', value: whatsapp },
          { key: 'admin_whatsapp_2', value: whatsapp2 },
          { key: 'admin_whatsapp_3', value: whatsapp3 },
          { key: 'admin_whatsapp_4', value: whatsapp4 },
          { key: 'admin_delete_password', value: deletePwd },
          { key: 'ferriol_transfer_info', value: transferInfo },
          { key: 'trial_duration_days', value: String(trialDurSave) },
          { key: 'trial_reminder_config', value: trialReminderJson }
        ], { onConflict: 'key' });
        adminContact.whatsapp = whatsapp;
        adminContact.whatsappList = [whatsapp, whatsapp2, whatsapp3, whatsapp4].filter(Boolean);
        window._superTrialReminderEditCache = parseTrialReminderConfigValue(trialReminderJson);
        msgEl.textContent = 'Ajustes guardados.';
        msgEl.classList.remove('hidden');
        setTimeout(() => msgEl.classList.add('hidden'), 3000);
      } catch (e) {
        msgEl.textContent = 'Error: ' + (e.message || 'Revisá que exista la tabla app_settings.');
        msgEl.classList.remove('hidden');
      }
      lucide.createIcons();
    };
    (function setupTrialReminderWindowDaysListener() {
      var el = document.getElementById('trialReminderWindowDays');
      if (!el) return;
      el.addEventListener('change', function () {
        var preserved = readTrialReminderMessagesFromDom();
        var base = window._superTrialReminderEditCache || { windowDays: 5, messages: {} };
        fillTrialReminderAdminFields(base, preserved);
      });
    })();
    async function exportSuperDirectorioCSV() {
      if (!isEmpresaLensSuper() || !supabaseClient) return;
      try {
        var res = await supabaseClient.from('profiles').select('id, email, kiosco_name, role, active, referral_code, sponsor_id, trial_ends_at').order('email', { ascending: true });
        if (res.error) throw res.error;
        var rows = res.data || [];
        var byId = {};
        rows.forEach(function (r) { if (r && r.id) byId[r.id] = r; });
        var header = 'id;email;kiosco_nombre;rol;activo;codigo_referido;sponsor_id;sponsor_email;sponsor_kiosco;vence_prueba';
        var body = rows.map(function (r) {
          var sp = r.sponsor_id ? byId[r.sponsor_id] : null;
          return [
            r.id,
            r.email,
            r.kiosco_name,
            r.role,
            r.active ? 'si' : 'no',
            r.referral_code || '',
            r.sponsor_id || '',
            sp ? (sp.email || '') : '',
            sp ? (sp.kiosco_name || '') : '',
            r.trial_ends_at || ''
          ].map(function (cell) { return escapeCSV(cell == null ? '' : String(cell)); }).join(';');
        });
        var csv = header + '\r\n' + body.join('\r\n');
        downloadCSV('ferriol-directorio-' + new Date().toISOString().slice(0, 10) + '.csv', csv);
      } catch (e) {
        alert('No se pudo exportar el directorio: ' + (e.message || e));
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    async function exportAllUsersBackup() {
      if (!isEmpresaLensSuper() || !supabaseClient) return;
      var msgEl = document.getElementById('adminBackupAllMsg');
      var btn = document.getElementById('btnExportAllUsersBackup');
      if (msgEl) { msgEl.textContent = 'Exportando...'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-white/70'; }
      if (btn) btn.disabled = true;
      try {
        var profilesRes = await supabaseClient.from('profiles').select('id, email, kiosco_name').neq('id', currentUser.id);
        if (profilesRes.error) throw profilesRes.error;
        var users = (profilesRes.data || []).filter(function (p) { return p.id; });
        var backup = { version: 1, type: 'admin_full_backup', exportedAt: new Date().toISOString(), exportedBy: currentUser.id, users: [] };
        for (var i = 0; i < users.length; i++) {
          var u = users[i];
          var uid = u.id;
          var products = {};
          var clientes = [];
          try {
            var pRes = await supabaseClient.from('products').select('*').eq('user_id', uid);
            if (!pRes.error && pRes.data) pRes.data.forEach(function (p) { products[p.codigo] = { nombre: p.nombre, codigo: p.codigo, precio: p.precio, stock: p.stock, stockInicial: p.stock_inicial || p.stock, costo: p.costo != null ? Number(p.costo) : 0 }; });
          } catch (_) {}
          try {
            var cRes = await supabaseClient.from('clientes').select('id, nombre, telefono, email, direccion, notas').eq('user_id', uid);
            if (!cRes.error && cRes.data) clientes = cRes.data;
          } catch (_) {}
          backup.users.push({ userId: uid, email: u.email || '', kioscoName: u.kiosco_name || '', products: products, clientes: clientes });
        }
        var blob = new Blob([JSON.stringify(backup, null, 2)], { type: 'application/json' });
        var a = document.createElement('a');
        a.href = URL.createObjectURL(blob);
        a.download = 'ferriol-respaldo-todos-' + new Date().toISOString().slice(0, 10) + '.json';
        a.click();
        URL.revokeObjectURL(a.href);
        if (msgEl) { msgEl.textContent = 'Copia exportada: ' + backup.users.length + ' usuario(s). Guardá el archivo en un lugar seguro.'; msgEl.className = 'text-xs mt-2 text-green-400'; setTimeout(function () { msgEl.classList.add('hidden'); }, 6000); }
      } catch (e) {
        if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'No se pudo exportar. Revisá que las políticas RLS permitan al admin leer productos y clientes de otros usuarios.'); msgEl.className = 'text-xs mt-2 text-amber-300'; }
      }
      if (btn) btn.disabled = false;
      lucide.createIcons();
    }
    async function importAllUsersBackup(file) {
      if (!file || !isEmpresaLensSuper() || !supabaseClient) return;
      var msgEl = document.getElementById('adminBackupAllMsg');
      var btn = document.getElementById('inputImportAllUsersBackup');
      if (msgEl) { msgEl.textContent = 'Importando (complementando datos)...'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-white/70'; }
      var reader = new FileReader();
      reader.onload = async function () {
        try {
          var backup = JSON.parse(reader.result);
          if (!backup || backup.type !== 'admin_full_backup' || !Array.isArray(backup.users)) throw new Error('Archivo no válido. Tenés que usar el archivo que exportaste desde "Exportar copia".');
          var ok = 0, err = 0;
          for (var i = 0; i < backup.users.length; i++) {
            var u = backup.users[i];
            var uid = u.userId;
            if (!uid) continue;
            try {
              if (u.products && typeof u.products === 'object') {
                var existingP = await supabaseClient.from('products').select('codigo').eq('user_id', uid);
                var existingCodigos = (existingP.data || []).map(function (r) { return r.codigo; });
                var toInsert = Object.entries(u.products).filter(function (e) { return existingCodigos.indexOf(e[1].codigo || e[0]) === -1; }).map(function (e) {
                  var p = e[1];
                  var cod = p.codigo || e[0];
                  return { user_id: uid, codigo: cod, nombre: p.nombre, precio: p.precio || 0, stock: p.stock || 0, stock_inicial: p.stockInicial ?? p.stock ?? 0, costo: p.costo != null ? Number(p.costo) : 0 };
                });
                if (toInsert.length) await supabaseClient.from('products').insert(toInsert);
              }
              if (u.clientes && u.clientes.length) {
                var existingC = await supabaseClient.from('clientes').select('nombre, telefono').eq('user_id', uid);
                var existingPairs = (existingC.data || []).map(function (r) { return (r.nombre || '').toLowerCase().trim() + '|' + (r.telefono || '').trim(); });
                var cToInsert = u.clientes.filter(function (c) {
                  var key = (c.nombre || '').toLowerCase().trim() + '|' + (c.telefono || '').trim();
                  return existingPairs.indexOf(key) === -1;
                }).map(function (c) { return { user_id: uid, nombre: c.nombre || null, telefono: c.telefono || null, email: c.email || null, direccion: c.direccion || null, notas: c.notas || null }; });
                if (cToInsert.length) await supabaseClient.from('clientes').insert(cToInsert);
              }
              ok++;
            } catch (e) {
              err++;
              console.warn('Error complementando usuario ' + (u.email || uid) + ':', e);
            }
          }
          if (msgEl) {
            if (err > 0) msgEl.textContent = 'Complementados: ' + ok + ' usuario(s). Fallaron: ' + err + '.';
            else msgEl.textContent = 'Importación lista: se sumaron los datos del archivo a los existentes en ' + ok + ' usuario(s). No se reemplazó nada.';
            msgEl.className = 'text-xs mt-2 ' + (err > 0 ? 'text-amber-300' : 'text-green-400');
            setTimeout(function () { msgEl.classList.add('hidden'); }, 8000);
          }
        } catch (e) {
          if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'Archivo no válido'); msgEl.className = 'text-xs mt-2 text-red-400'; }
        }
        if (btn) btn.value = '';
        lucide.createIcons();
      };
      reader.readAsText(file);
    }
    document.getElementById('btnExportAllUsersBackup').onclick = exportAllUsersBackup;
    document.getElementById('inputImportAllUsersBackup').onchange = function (e) {
      var f = e.target.files[0];
      if (f) {
        if (!confirm('¿Importar y complementar datos? Se sumarán los productos, clientes y deudas del archivo a lo que ya tiene cada usuario (no se borra nada existente). Los usuarios pueden recargar la app para ver los cambios.')) { e.target.value = ''; return; }
        importAllUsersBackup(f);
      }
      e.target.value = '';
    };

    document.querySelectorAll('.super-filter-btn').forEach(function (btn) {
      btn.onclick = function () {
        superFilterState = btn.dataset.filter || 'todos';
        document.querySelectorAll('.super-filter-btn').forEach(function (b) {
          var active = b.dataset.filter === superFilterState;
          var mm = b.classList.contains('super-main-only') ? ' super-only super-main-only' : '';
          var visual = active ? 'border-[#dc2626]/50 bg-[#dc2626]/30' : (b.dataset.filter === 'sin_referidor' ? 'border-amber-500/40 glass' : 'border-white/20 glass');
          b.className = 'super-filter-btn px-3 py-1.5 rounded-lg text-sm font-medium border touch-target' + mm + ' ' + visual;
        });
        renderSuper();
      };
    });

    var notificationsCache = [];
    var _ferriolNotifFetchBaselineDone = false;
    var NOTIF_LAST_READ_KEY = 'ferriol_notif_last_read';
    function getNotifLastRead() {
      try {
        var key = (currentUser && currentUser.id) ? NOTIF_LAST_READ_KEY + '_' + currentUser.id : NOTIF_LAST_READ_KEY;
        var s = localStorage.getItem(key);
        return s ? new Date(s).getTime() : 0;
      } catch (_) { return 0; }
    }
    function setNotifLastRead() {
      try {
        var key = (currentUser && currentUser.id) ? NOTIF_LAST_READ_KEY + '_' + currentUser.id : NOTIF_LAST_READ_KEY;
        var latest = 0;
        (notificationsCache || []).forEach(function (n) {
          if (n.created_at) {
            var t = new Date(n.created_at).getTime();
            if (t > latest) latest = t;
          }
        });
        localStorage.setItem(key, latest ? new Date(latest).toISOString() : new Date().toISOString());
      } catch (_) {}
    }
    function renderNotificationsMerged() {
      var notifSince = (currentUser && currentUser.created_at) ? new Date(currentUser.created_at).getTime() : 0;
      var visible = (notificationsCache || []).filter(function (n) { return n.created_at && new Date(n.created_at).getTime() >= notifSince; });
      var trialSynth = buildTrialReminderSyntheticNotification();
      var rows = visible.slice();
      if (trialSynth) rows.unshift(trialSynth);
      var lastRead = getNotifLastRead();
      var unread = rows.filter(function (n) {
        if (n._trialSynthetic) return true;
        return new Date(n.created_at).getTime() > lastRead;
      });
      var listEl = document.getElementById('notifList');
      var emptyEl = document.getElementById('notifEmpty');
      var countEl = document.getElementById('notifCount');
      if (listEl) {
        if (rows.length === 0) {
          listEl.innerHTML = '';
          if (emptyEl) emptyEl.classList.remove('hidden');
        } else {
          if (emptyEl) emptyEl.classList.add('hidden');
          listEl.innerHTML = rows.map(function (n) {
            var fecha = n.created_at ? new Date(n.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : '';
            var extraClass = n._trialSynthetic ? ' trial-reminder-notif border-amber-400/45 bg-gradient-to-br from-amber-500/15 to-orange-500/08 shadow-[0_8px_28px_rgba(245,158,11,0.12)]' : '';
            var msgRaw = n.message || '';
            var inner;
            if (n._trialSynthetic) {
              var parts = msgRaw.split('\n');
              var head = parts.shift() || '';
              var body = parts.join('\n');
              var safeHead = head.replace(/</g, '&lt;').replace(/>/g, '&gt;');
              var safeBody = body.replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/\n/g, '<br>');
              inner = '<p class="text-white/95 text-sm leading-snug"><span class="font-bold text-amber-200">' + safeHead + '</span><br><span class="text-white/88">' + safeBody + '</span></p>';
            } else {
              inner = '<p class="text-white/90 text-sm">' + msgRaw.replace(/</g, '&lt;').replace(/\n/g, '<br>') + '</p>';
            }
            return '<div class="glass rounded-xl p-3 border border-white/10' + extraClass + '">' + inner + '<p class="text-white/50 text-xs mt-1">' + fecha + '</p></div>';
          }).join('');
        }
      }
      if (countEl) {
        if (unread.length > 0) { countEl.textContent = unread.length > 99 ? '99+' : unread.length; countEl.classList.remove('hidden'); }
        else countEl.classList.add('hidden');
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    async function loadNotifications() {
      if (!supabaseClient) return;
      try {
        var prevIds = new Set((notificationsCache || []).map(function (n) { return n.id; }).filter(Boolean));
        var res = await supabaseClient.from('notifications').select('id, created_at, message').order('created_at', { ascending: false }).limit(50);
        var data = res.data || [];
        var newRows = data.filter(function (n) { return n.id && !prevIds.has(n.id); });
        notificationsCache = data;
        if (_ferriolNotifFetchBaselineDone && newRows.length > 0 && ferriolKiosqueroNotifShell()) {
          ferriolPlayNotificationChime();
        }
        _ferriolNotifFetchBaselineDone = true;
        renderNotificationsMerged();
      } catch (_) {}
    }
    document.getElementById('sendNotificationBtn').onclick = async function () {
      var textarea = document.getElementById('adminNotificationMessage');
      var msgEl = document.getElementById('adminNotificationMsg');
      var msg = (textarea && textarea.value) ? textarea.value.trim() : '';
      if (!msg) { if (msgEl) { msgEl.textContent = 'Escribí un mensaje.'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-amber-300'; } return; }
      if (!supabaseClient || !isEmpresaLensSuper()) return;
      try {
        var err = (await supabaseClient.from('notifications').insert({ message: msg })).error;
        if (err) throw err;
        if (textarea) textarea.value = '';
        if (msgEl) { msgEl.textContent = 'Enviado a todos los negocios.'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-green-300'; setTimeout(function () { msgEl.classList.add('hidden'); }, 4000); }
      } catch (e) {
        if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'Creá la tabla notifications en Supabase (ver comentarios en el código).'); msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-red-300'; }
      }
      lucide.createIcons();
    };

    function openNewKiosqueroModal() {
      document.getElementById('newKiosqueroErr').classList.add('hidden');
      document.getElementById('createUserMsgModal').classList.add('hidden');
      document.getElementById('newKiosqueroEmail').value = '';
      document.getElementById('newKiosqueroPhone').value = '';
      document.getElementById('newKiosqueroPassword').value = '';
      document.getElementById('newKiosqueroKioscoName').value = '';
      document.getElementById('newKiosqueroModal').classList.remove('hidden');
      document.getElementById('newKiosqueroModal').classList.add('flex');
      lucide.createIcons();
    }
    function closeNewKiosqueroModal() {
      document.getElementById('newKiosqueroModal').classList.add('hidden');
      document.getElementById('newKiosqueroModal').classList.remove('flex');
      renderSuper();
      lucide.createIcons();
    }
    document.getElementById('btnOpenNewKiosqueroModal').onclick = openNewKiosqueroModal;
    var btnExportDir = document.getElementById('btnExportDirectorioCSV');
    if (btnExportDir) btnExportDir.onclick = function () { exportSuperDirectorioCSV(); };
    var ferriolPayTypeEl = document.getElementById('ferriolNewPayType');
    if (ferriolPayTypeEl) {
      ferriolPayTypeEl.addEventListener('change', ferriolSyncNewPaymentFormDefaults);
      ferriolSyncNewPaymentFormDefaults();
    }
    var ferriolBtnMonthly = document.getElementById('ferriolBtnRunMonthlyAccrual');
    if (ferriolBtnMonthly) {
      ferriolBtnMonthly.onclick = async function () {
        if (!supabaseClient || !isEmpresaLensSuper()) return;
        if (!confirm('¿Generar en el libro los cargos automáticos del mes calendario actual (Argentina)? No duplica si ya existen (idempotencia).')) return;
        var rpc = await supabaseClient.rpc('ferriol_accrue_monthly_billing', {});
        if (rpc.error) { alert('Error: ' + (rpc.error.message || '')); return; }
        var out = rpc.data;
        if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
        if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo ejecutar.'); return; }
        alert('Listo. Mes: ' + (out.period_month || '') + '. Kioscos nuevos: ' + (out.kiosco_months_new != null ? out.kiosco_months_new : '—') + '. Socios nuevos: ' + (out.partner_months_new != null ? out.partner_months_new : '—'));
        if (state.superSection === 'cobros') renderSuperCobrosSection();
        lucide.createIcons();
      };
    }
    var ferriolBtnDemo = document.getElementById('ferriolBtnDemoSeed');
    if (ferriolBtnDemo) {
      ferriolBtnDemo.onclick = async function () {
        if (!supabaseClient || !isEmpresaLensSuper()) return;
        if (!confirm('¿Insertar 3 movimientos de demostración en mlm_ledger? No duplica si ya existen.')) return;
        var rpc = await supabaseClient.rpc('ferriol_demo_seed_ledger', {});
        if (rpc.error) {
          alert('Error: ' + (rpc.error.message || '') + '\n\n¿Ejecutaste supabase-ferriol-demo-seed.sql en Supabase?');
          return;
        }
        var out = rpc.data;
        if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
        if (!out || out.ok !== true) {
          alert((out && out.error) ? out.error : 'No se pudo completar la demo.');
          return;
        }
        var n = out.inserted_rows != null ? out.inserted_rows : '—';
        alert('Listo. Filas nuevas: ' + n + '. Revisá Cobros (admin). Los kiosqueros solo ven la licencia en Inicio.');
        if (state.superSection === 'cobros') renderSuperCobrosSection();
        await loadKioscoLicensePaymentInfo();
        lucide.createIcons();
      };
    }
    var ferriolBtnDemoClear = document.getElementById('ferriolBtnDemoClear');
    if (ferriolBtnDemoClear) {
      ferriolBtnDemoClear.onclick = async function () {
        if (!supabaseClient || !isEmpresaLensSuper()) return;
        if (!confirm('¿Eliminar del libro solo las 3 filas de demostración (claves ferriol:demo:seed:*)? No afecta cargos reales.')) return;
        var rpc = await supabaseClient.rpc('ferriol_demo_clear_seed_ledger', {});
        if (rpc.error) {
          alert('Error: ' + (rpc.error.message || '') + '\n\nActualizá supabase-ferriol-demo-seed.sql en Supabase si falta la función.');
          return;
        }
        var out = rpc.data;
        if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
        if (!out || out.ok !== true) {
          alert((out && out.error) ? out.error : 'No se pudo quitar la demo.');
          return;
        }
        alert('Listo. Filas eliminadas: ' + (out.deleted_rows != null ? out.deleted_rows : '—') + '.');
        if (state.superSection === 'cobros') renderSuperCobrosSection();
        await loadKioscoLicensePaymentInfo();
        lucide.createIcons();
      };
    }
    var ferriolBtnCreate = document.getElementById('ferriolBtnCreatePayment');
    if (ferriolBtnCreate) ferriolBtnCreate.onclick = async function () {
      var errEl = document.getElementById('ferriolNewPayErr');
      if (errEl) { errEl.classList.add('hidden'); errEl.textContent = ''; }
      if (!supabaseClient || !isEmpresaLensSuper()) return;
      var type = (document.getElementById('ferriolNewPayType') || {}).value;
      var payerEm = (document.getElementById('ferriolNewPayPayerEmail') || {}).value || '';
      var sellerEm = (document.getElementById('ferriolNewPaySellerEmail') || {}).value || '';
      var amt = parseFloat(String((document.getElementById('ferriolNewPayAmount') || {}).value || ''), 10);
      var note = (document.getElementById('ferriolNewPayNote') || {}).value || '';
      if (!type || !payerEm || !amt || amt <= 0) {
        if (errEl) { errEl.textContent = 'Completá tipo, email de quien paga y monto.'; errEl.classList.remove('hidden'); }
        return;
      }
      var payerId = await ferriolResolveProfileIdByEmail(payerEm);
      if (!payerId) {
        if (errEl) { errEl.textContent = 'No hay perfil con ese email (debe existir y coincidir exacto en minúsculas si así está en Supabase).'; errEl.classList.remove('hidden'); }
        return;
      }
      var sellerId = null;
      if (type === 'kit_inicial' || type === 'kiosco_licencia') {
        sellerId = await ferriolResolveProfileIdByEmail(sellerEm);
        if (!sellerId) {
          if (errEl) { errEl.textContent = 'Indicá el email del vendedor ejecutor (perfil existente).'; errEl.classList.remove('hidden'); }
          return;
        }
      }
      var periodMonth = null;
      if (type === 'vendor_mantenimiento') {
        var m = (document.getElementById('ferriolNewPayPeriod') || {}).value;
        periodMonth = ferriolMonthInputToPeriodDate(m);
        if (!periodMonth) {
          if (errEl) { errEl.textContent = 'Elegí el mes de la cuota.'; errEl.classList.remove('hidden'); }
          return;
        }
      }
      var ins = await supabaseClient.from('ferriol_payments').insert({
        payment_type: type,
        amount: amt,
        payer_user_id: payerId,
        seller_user_id: sellerId,
        period_month: periodMonth,
        status: 'pending',
        external_note: note || null,
        created_by: currentUser.id
      });
      if (ins.error) {
        if (errEl) { errEl.textContent = ins.error.message || 'No se pudo registrar.'; errEl.classList.remove('hidden'); }
        return;
      }
      alert('Cobro pendiente registrado. Cuando acredite la transferencia, tocá Verificar.');
      if (state.superSection === 'cobros') renderSuperCobrosSection();
      lucide.createIcons();
    };
    document.getElementById('newKiosqueroModalClose').onclick = closeNewKiosqueroModal;
    document.getElementById('newKiosqueroModalOverlay').onclick = closeNewKiosqueroModal;
    setupPasswordToggle('showNewKiosqueroPwd', 'newKiosqueroPassword');
    try {
      if (typeof lucide !== 'undefined' && lucide && typeof lucide.createIcons === 'function') lucide.createIcons();
    } catch (_) {}
    document.getElementById('btnCreateUserInModal').onclick = async () => {
      const email = document.getElementById('newKiosqueroEmail').value.trim();
      const password = document.getElementById('newKiosqueroPassword').value;
      const kioscoName = document.getElementById('newKiosqueroKioscoName').value.trim();
      const errEl = document.getElementById('newKiosqueroErr');
      const msgEl = document.getElementById('createUserMsgModal');
      errEl.classList.add('hidden');
      msgEl.classList.add('hidden');
      if (!email) {
        errEl.textContent = 'El email es obligatorio.';
        errEl.classList.remove('hidden'); errEl.classList.add('show');
        return;
      }
      if (!password || password.length < 6) {
        errEl.textContent = 'La contraseña es obligatoria y debe tener al menos 6 caracteres.';
        errEl.classList.remove('hidden'); errEl.classList.add('show');
        return;
      }
      if (!supabaseClient) {
        errEl.textContent = 'Supabase no está configurado.';
        errEl.classList.remove('hidden'); errEl.classList.add('show');
        return;
      }
      const { data: signUpData, error: signUpErr } = await supabaseClient.auth.signUp({ email, password });
      if (signUpErr) {
        errEl.textContent = signUpErr.message.includes('already registered') ? 'Ya existe un usuario con ese email.' : signUpErr.message;
        errEl.classList.remove('hidden'); errEl.classList.add('show');
        return;
      }
      const newId = signUpData.user?.id;
      if (newId) {
        var patch = { kiosco_name: kioscoName || '' };
        if (isPartnerLens()) patch.sponsor_id = currentUser.id;
        await supabaseClient.from('profiles').update(patch).eq('id', newId);
      }
      msgEl.textContent = 'Kiosquero creado. Ya puede iniciar sesión con ese email y contraseña.';
      msgEl.classList.remove('hidden');
      document.getElementById('newKiosqueroEmail').value = '';
      document.getElementById('newKiosqueroPhone').value = '';
      document.getElementById('newKiosqueroPassword').value = '';
      document.getElementById('newKiosqueroKioscoName').value = '';
      renderSuper();
      lucide.createIcons();
      setTimeout(closeNewKiosqueroModal, 2000);
    };

    (async function init() {
      if (!supabaseClient) return;
      try {
        const hash = location.hash || '';
        const isRecovery = hash.includes('type=recovery');
        if (isRecovery) {
          document.getElementById('loginFormWrap').classList.add('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          document.getElementById('resetPwdBox').classList.add('hidden');
          document.getElementById('setNewPwdBox').classList.remove('hidden');
          document.getElementById('loginErr').classList.remove('show');
          return;
        }
        const { data: { session } } = await supabaseClient.auth.getSession();
        if (!session?.user) return;
        const uid = session.user.id;
        let { data: profile, error: profileErr } = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
        if (profileErr && profileErr.code !== 'PGRST116') {
          console.error('Error al leer profiles:', profileErr);
          var loginErrInit = document.getElementById('loginErr');
          if (loginErrInit) {
            loginErrInit.textContent = 'Error al leer tu perfil. Revisá conexión o políticas RLS en Supabase (tabla profiles).';
            loginErrInit.classList.add('show');
          }
          return;
        }
        if (!profile) {
          var trialEndsInit = new Date(Date.now() + 15 * 24 * 60 * 60 * 1000).toISOString().slice(0, 19) + 'Z';
          var sponsorInit = await getSponsorIdForNewKiosqueroProfile();
          var insProf = await supabaseClient.from('profiles').insert({
            id: uid,
            email: session.user.email,
            role: 'kiosquero',
            active: true,
            trial_ends_at: trialEndsInit,
            sponsor_id: sponsorInit || null
          });
          if (insProf.error) {
            console.error('Perfil ausente y no se pudo crear:', insProf.error);
            var loginErrIns = document.getElementById('loginErr');
            if (loginErrIns) {
              loginErrIns.textContent = 'Tu usuario existe pero falta el perfil. Revisá en Supabase la tabla profiles (RLS: permitir INSERT/SELECT propio id) o contactá al administrador.';
              loginErrIns.classList.add('show');
            }
            return;
          }
          var rProf = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
          profile = rProf.data;
          if (!profile) return;
        }
        if (profile && supabaseClient && (profile.role === 'partner' || profile.role === 'super')) {
          await ensureUserReferralCode(uid);
          var rEns = await supabaseClient.from('profiles').select('*').eq('id', uid).single();
          if (rEns.data) profile = rEns.data;
        }
        if ((profile.role === 'kiosquero' || profile.role === 'partner') && !profile.active) {
          try {
            await loadAdminContact();
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('loginErr').textContent = 'Tu cuenta está desactivada. Contactá por WhatsApp para darte de alta.';
          document.getElementById('loginErr').classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks('Hola, mi cuenta de Ferriol OS está desactivada y quiero darme de alta.');
            wrap.classList.remove('hidden');
          }
          document.getElementById('appWrap').classList.add('hidden');
          document.getElementById('loginScreen').classList.remove('hidden');
          return;
        }
        const trialEndsAt = profile.trial_ends_at || null;
        if (profile.role === 'kiosquero' && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          try {
            await supabaseClient.from('profiles').update({ active: false }).eq('id', profile.id);
            await loadAdminContact();
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('loginErr').textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá por WhatsApp para renovar.';
          document.getElementById('loginErr').classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks('Hola, mi período de prueba de Ferriol OS terminó y quiero renovar.');
            wrap.classList.remove('hidden');
          }
          document.getElementById('appWrap').classList.add('hidden');
          document.getElementById('loginScreen').classList.remove('hidden');
          return;
        }
        var userCreatedAt = (session && session.user && session.user.created_at) ? session.user.created_at : null;
        currentUser = { id: profile.id, email: profile.email, role: profile.role, active: profile.active, kioscoName: profile.kiosco_name || '', whatsappMessage: profile.whatsapp_message || DEFAULT_WHATSAPP, trialEndsAt: trialEndsAt, created_at: userCreatedAt, referralCode: profile.referral_code || '', sponsorId: profile.sponsor_id || null };
        await showApp();
      } catch (e) {
        console.error('Error en init:', e);
      }
    })();
