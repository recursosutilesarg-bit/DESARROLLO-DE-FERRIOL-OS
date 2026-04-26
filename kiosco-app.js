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
    // Notificaciones globales: las inserta solo role super (RLS: supabase-ferriol-notifications-rls.sql). Las leen kiosqueros y socios en la campana.
    // CREATE TABLE notifications ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), message text NOT NULL );
    // ALTER TABLE notifications ENABLE ROW LEVEL SECURITY; políticas SELECT según tu proyecto + INSERT solo super en el SQL anterior.
    // Recordatorios de fin de prueba (mensajes por día + ventana): guardá en app_settings una fila key = 'trial_reminder_config', value = JSON, ej. {"windowDays":5,"messages":{"5":"...","4":"..."}}. Placeholders en textos: {dias}, {dias_restantes}, {nombre}, {negocio}.
    // Red de referidos: solo role 'partner' o 'super' tienen código y enlaces (kiosquero no refiere). SQL: supabase-referral-network.sql, supabase-mlm-foundation.sql, supabase-ferriol-payments.sql (cobros + RPC ferriol_verify_payment). Solicitudes de días (socio → empresa): supabase-ferriol-membership-day-requests.sql. Alta de otro socio/admin: supabase-ferriol-partner-provision-requests.sql. Objeto FerriolMlm en este archivo.
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
      return getSignupNichoFromStorage();
    }
    function syncSignUpNichoUI() {
      var n = getSignupNichoFromStorage();
      try { sessionStorage.setItem('ferriol_signup_nicho', n === 'socio' ? 'socio' : 'kiosco'); } catch (_) {}
      var sub = document.getElementById('signUpLeadLine');
      var wrapN = document.getElementById('signUpWrapNegocio');
      var wrapD = document.getElementById('signUpWrapDistribuidor');
      if (sub) sub.textContent = n === 'socio' ? 'Quiero ser distribuidor del sistema' : 'Quiero probar el sistema';
      if (wrapN) wrapN.classList.toggle('hidden', n !== 'kiosco');
      if (wrapD) wrapD.classList.toggle('hidden', n !== 'socio');
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

    /** Abre el formulario de alta; definido acá para que funcione aunque falle código más abajo en este archivo. */
    function openSignUpFlow(nichoExplicit) {
      var nicho = nichoExplicit === 'socio' ? 'socio' : 'kiosco';
      try { sessionStorage.setItem('ferriol_signup_nicho', nicho); } catch (_) {}
      var loginFormWrap = document.getElementById('loginFormWrap');
      var resetPwdBox = document.getElementById('resetPwdBox');
      var setNewPwdBox = document.getElementById('setNewPwdBox');
      var signUpBox = document.getElementById('signUpBox');
      var signUpSuccessBox = document.getElementById('signUpSuccessBox');
      var signUpErr = document.getElementById('signUpErr');
      if (loginFormWrap) loginFormWrap.classList.add('hidden');
      if (resetPwdBox) resetPwdBox.classList.add('hidden');
      if (setNewPwdBox) setNewPwdBox.classList.add('hidden');
      if (signUpBox) signUpBox.classList.remove('hidden');
      if (signUpSuccessBox) signUpSuccessBox.classList.add('hidden');
      if (signUpErr) signUpErr.classList.remove('show');
      var refIn = document.getElementById('signUpReferralCode');
      if (refIn) {
        if (nicho === 'socio') {
          try {
            var st = normalizeReferralCode(sessionStorage.getItem('ferriol_signup_ref') || '');
            refIn.value = st || '';
          } catch (_) { refIn.value = ''; }
        } else {
          refIn.value = '';
        }
      }
      var kn = document.getElementById('signUpKioscoName');
      var na = document.getElementById('signUpNombreApellido');
      if (nicho === 'kiosco' && na) na.value = '';
      if (nicho === 'socio' && kn) kn.value = '';
      syncSignUpNichoUI();
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    try { window._openSignUpWithNicho = openSignUpFlow; } catch (_) {}
    (function ferriolWirePublicSignupButtons() {
      var b1 = document.getElementById('signUpBtnNegocio');
      if (b1) b1.addEventListener('click', function (e) { e.preventDefault(); openSignUpFlow('kiosco'); });
      var b2 = document.getElementById('signUpBtnSocio');
      if (b2) b2.addEventListener('click', function (e) { e.preventDefault(); openSignUpFlow('socio'); });
    })();

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
    function closePartnerAffiliateLinksModal() {
      var m = document.getElementById('partnerAffiliateLinksModal');
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    }
    function openPartnerAffiliateLinksModal() {
      var m = document.getElementById('partnerAffiliateLinksModal');
      if (!m || !currentUser) return;
      function bindCopyAndShow(c) {
        var code = c || '';
        var codeEl = document.getElementById('partnerAffiliateCodeDisplay');
        if (codeEl) codeEl.textContent = code || '—';
        var ink = document.getElementById('partnerNetLinkK');
        var ins = document.getElementById('partnerNetLinkS');
        if (ink) ink.value = code ? ferriolReferralInviteUrl(code, 'kiosco') : '';
        if (ins) ins.value = code ? ferriolReferralInviteUrl(code, 'socio') : '';
        var bk = document.getElementById('partnerNetBtnK');
        var bs = document.getElementById('partnerNetBtnS');
        if (bk) bk.onclick = function () { copyTextToClipboard((document.getElementById('partnerNetLinkK') || {}).value, 'Enlace para negocios copiado.'); };
        if (bs) bs.onclick = function () { copyTextToClipboard((document.getElementById('partnerNetLinkS') || {}).value, 'Enlace para vendedores copiado.'); };
        m.classList.remove('hidden');
        m.classList.add('flex');
        try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
      }
      var cShow = currentUser.referralCode;
      if (!cShow && supabaseClient) {
        ensureUserReferralCode(currentUser.id).then(function (cc) {
          if (cc) currentUser.referralCode = cc;
          bindCopyAndShow(cc);
        });
      } else bindCopyAndShow(cShow);
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

    /** Si app_settings.ferriol_public_signup es closed o company_only, bloquea el registro desde la pantalla pública. */
    async function ferriolIsPublicSignupClosed() {
      if (!supabaseClient) return null;
      try {
        var r = await supabaseClient.from('app_settings').select('value').eq('key', 'ferriol_public_signup').maybeSingle();
        var v = String((r.data && r.data.value) || '').trim().toLowerCase();
        if (v === 'closed' || v === 'company_only') {
          return 'El registro público está deshabilitado. El alta es solo con aprobación de Ferriol (solicitud de socio o de negocio).';
        }
      } catch (_) {}
      return null;
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
    function ferriolIngresosPaymentTypeLabel(t) {
      if (t === 'kit_inicial') return 'Kit vendedor';
      if (t === 'kiosco_licencia') return 'Licencia kiosco';
      if (t === 'vendor_mantenimiento') return 'Cuota vendedor';
      return t ? String(t) : '—';
    }
    function ferriolIngresosDayKeyFromIso(iso) {
      if (!iso) return '';
      var d = new Date(iso);
      if (isNaN(d.getTime())) return '';
      var y = d.getFullYear();
      var m = String(d.getMonth() + 1).padStart(2, '0');
      var day = String(d.getDate()).padStart(2, '0');
      return y + '-' + m + '-' + day;
    }
    function setSuperIngresosSectionMode(founder) {
      var t = document.getElementById('ingresosSectionTitle');
      var s = document.getElementById('ingresosSectionSubtitle');
      var pRow = document.getElementById('ingresosKpiPartnerRow');
      var fRow = document.getElementById('ingresosKpiFounderRow');
      var ct = document.getElementById('ingresosChartTitle');
      var cl = document.getElementById('ingresosChartLegend');
      if (t) t.textContent = founder ? 'Ingresos (vista empresa)' : 'Gestión de ventas';
      if (s) {
        s.textContent = founder
          ? 'Métricas globales: facturación verificada, reserva a favor de la empresa y comisiones liquidadas a la red (libro MLM). No reemplaza la contabilidad formal.'
          : 'Tu comisión acreditada proviene del libro MLM cuando la empresa verificó el cobro con vos como vendedor. No es el monto bruto que pagó el cliente (ese flujo va siempre a Ferriol).';
      }
      if (pRow) pRow.classList.toggle('hidden', founder);
      if (fRow) fRow.classList.toggle('hidden', !founder);
      if (ct) ct.textContent = founder ? 'Evolución diaria (empresa)' : 'Desempeño diario (tu comisión)';
      if (cl) {
        cl.textContent = founder
          ? 'Verde: facturación bruta · Cyan: reserva empresa · Violeta: comisiones a la red'
          : 'Leyenda: verde = comisión; rojo = rech.; azul = nº acreditaciones / día';
      }
    }
    async function loadSuperIngresosFounderSection() {
      var kpiG = document.getElementById('ingresosKpiGross');
      var kpiCo = document.getElementById('ingresosKpiCompany');
      var kpiPo = document.getElementById('ingresosKpiPayout');
      var kpiRj = document.getElementById('ingresosKpiRejFounder');
      var wrap = document.getElementById('ingresosTableWrap');
      var canvas = document.getElementById('ingresosChartCanvas');
      var fb = document.getElementById('ingresosChartFallback');
      if (!kpiG || !wrap) return;
      if (!isEmpresaLensSuper() || !supabaseClient || !currentUser) {
        wrap.innerHTML = '<p class="text-amber-200/90 text-sm py-4 text-center">Solo disponible en vista fundador (Empresa).</p>';
        return;
      }
      setSuperIngresosSectionMode(true);
      var rangeSel = document.getElementById('ingresosRangeFilter');
      var rangeDays = rangeSel && rangeSel.value ? parseInt(rangeSel.value, 10) : 30;
      if (isNaN(rangeDays) || rangeDays < 1) rangeDays = 30;
      kpiG.textContent = kpiCo.textContent = kpiPo.textContent = kpiRj.textContent = '…';
      wrap.innerHTML = '<p class="text-white/45 text-xs py-5 text-center">Cargando…</p>';
      if (fb) { fb.classList.add('hidden'); if (canvas) canvas.classList.remove('hidden'); }
      var endD = new Date();
      endD.setHours(23, 59, 59, 999);
      var startD = new Date();
      startD.setHours(0, 0, 0, 0);
      startD.setDate(startD.getDate() - (rangeDays - 1));
      function inRange(iso) {
        if (!iso) return false;
        var t = new Date(iso).getTime();
        return t >= startD.getTime() && t <= endD.getTime();
      }
      var startIsoR = startD.toISOString();
      var endIsoR = endD.toISOString();
      try {
        var payRes = await supabaseClient
          .from('ferriol_payments')
          .select('id, created_at, payment_type, amount, status, payer_user_id, seller_user_id')
          .gte('created_at', startIsoR)
          .lte('created_at', endIsoR)
          .order('created_at', { ascending: false })
          .limit(1200);
        if (payRes.error) throw payRes.error;
        var payAll = payRes.data || [];
        var sumGross = 0;
        var sumRej = 0;
        var byDayGross = {};
        var byDayRej = {};
        payAll.forEach(function (r) {
          var dk = ferriolIngresosDayKeyFromIso(r.created_at);
          var a = Number(r.amount || 0);
          if (r.status === 'verified') {
            sumGross += a;
            if (!byDayGross[dk]) byDayGross[dk] = 0;
            byDayGross[dk] += a;
          } else if (r.status === 'rejected') {
            sumRej += a;
            if (!byDayRej[dk]) byDayRej[dk] = 0;
            byDayRej[dk] += a;
          }
        });
        var ledRes = await supabaseClient
          .from('mlm_ledger')
          .select('id, created_at, event_type, status, amount, metadata, beneficiary_user_id')
          .in('status', ['approved', 'paid'])
          .gte('created_at', startIsoR)
          .lte('created_at', endIsoR)
          .order('created_at', { ascending: false })
          .limit(2000);
        if (ledRes.error) throw ledRes.error;
        var ledRows = ledRes.data || [];
        var sumComp = 0;
        var sumPayout = 0;
        var byDayComp = {};
        var byDayPay = {};
        ledRows.forEach(function (L) {
          var ev = L.event_type;
          var a = Number(L.amount || 0);
          var dk = ferriolIngresosDayKeyFromIso(L.created_at);
          if (ev === 'company_reserve') {
            sumComp += a;
            if (!byDayComp[dk]) byDayComp[dk] = 0;
            byDayComp[dk] += a;
          } else if ((ev === 'sale_commission' || ev === 'renewal') && L.beneficiary_user_id) {
            sumPayout += a;
            if (!byDayPay[dk]) byDayPay[dk] = 0;
            byDayPay[dk] += a;
          }
        });
        kpiG.textContent = '$ ' + sumGross.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ARS';
        kpiCo.textContent = '$ ' + sumComp.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ARS';
        kpiPo.textContent = '$ ' + sumPayout.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ARS';
        kpiRj.textContent = sumRej > 0
          ? ('$ ' + sumRej.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ARS')
          : '$ 0,00 ARS';
        var dayKeys = [];
        var cur = new Date(startD);
        while (cur.getTime() <= endD.getTime()) {
          dayKeys.push(ferriolIngresosDayKeyFromIso(cur.toISOString()));
          cur.setDate(cur.getDate() + 1);
        }
        var labels = dayKeys.map(function (k) {
          var p = k.split('-');
          var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
          return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
        });
        var dG = dayKeys.map(function (k) { return byDayGross[k] || 0; });
        var dC = dayKeys.map(function (k) { return byDayComp[k] || 0; });
        var dP = dayKeys.map(function (k) { return byDayPay[k] || 0; });
        if (typeof window.Chart === 'undefined') {
          if (canvas) canvas.classList.add('hidden');
          if (fb) { fb.classList.remove('hidden'); fb.textContent = 'Gráfico no disponible (librería de gráficos). Revisá la conexión a internet.'; }
        } else {
          if (window._ferriolIngresosChart) {
            try { window._ferriolIngresosChart.destroy(); } catch (_) {}
            window._ferriolIngresosChart = null;
          }
          if (canvas) {
            var ctx = canvas.getContext('2d');
            window._ferriolIngresosChart = new window.Chart(ctx, {
              type: 'line',
              data: {
                labels: labels,
                datasets: [
                  { label: 'Facturación bruta (verif.)', data: dG, borderColor: 'rgb(134, 239, 172)', backgroundColor: 'rgba(134, 239, 172, 0.1)', tension: 0.25, fill: true, pointRadius: 0, yAxisID: 'y' },
                  { label: 'Reserva empresa', data: dC, borderColor: 'rgb(34, 211, 238)', backgroundColor: 'rgba(34, 211, 238, 0.08)', tension: 0.25, fill: true, pointRadius: 0, yAxisID: 'y' },
                  { label: 'Comisiones a la red', data: dP, borderColor: 'rgb(167, 139, 250)', backgroundColor: 'rgba(167, 139, 250, 0.08)', tension: 0.25, fill: true, pointRadius: 0, yAxisID: 'y' }
                ]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: { legend: { position: 'top', labels: { color: 'rgba(255,255,255,0.75)', font: { size: 11 } } } },
                scales: {
                  x: { ticks: { color: 'rgba(255,255,255,0.45)', maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                  y: { position: 'left', ticks: { color: 'rgba(255,255,255,0.5)' }, grid: { color: 'rgba(255,255,255,0.08)' } }
                }
              }
            });
          }
        }
        var recent = payAll.filter(function (r) { return r.status === 'verified'; }).slice(0, 20);
        var pidSet = {};
        recent.forEach(function (r) { if (r && r.id) pidSet[r.id] = true; });
        var ledByPay = {};
        ledRows.forEach(function (L) {
          var mid = L.metadata && (L.metadata.payment_id || L.metadata.paymentId);
          if (mid && pidSet[mid]) {
            if (!ledByPay[mid]) ledByPay[mid] = { company: 0, payout: 0 };
            if (L.event_type === 'company_reserve') ledByPay[mid].company += Number(L.amount || 0);
            if (L.event_type === 'sale_commission' && L.beneficiary_user_id) ledByPay[mid].payout += Number(L.amount || 0);
          }
        });
        var payerIds = recent.map(function (r) { return r.payer_user_id; }).filter(Boolean);
        var nameBy = {};
        if (payerIds.length) {
          var uq = Array.from(new Set(payerIds));
          var pr = await supabaseClient.from('profiles').select('id, email, kiosco_name').in('id', uq);
          if (!pr.error && pr.data) {
            pr.data.forEach(function (p) {
              if (p && p.id) nameBy[p.id] = (p.kiosco_name || '').trim() || p.email || p.id;
            });
          }
        }
        if (!recent.length) {
          wrap.innerHTML = '<p class="text-white/50 text-sm py-8 text-center px-3">Aún no hay cobros verificados en el período. Revisá <strong class="text-white/70">Cobros</strong> o ampliá el rango de fechas.</p>';
        } else {
          var headF = '<div class="grid grid-cols-12 gap-1 px-3 py-2 border-b border-white/10 text-[10px] text-white/45 font-medium uppercase tracking-wide"><div class="col-span-2">Fecha</div><div class="col-span-2">Tipo</div><div class="col-span-2">Bruto</div><div class="col-span-2">A empresa</div><div class="col-span-2">A red</div><div class="col-span-2">Paga</div></div>';
          var bodyF = recent.map(function (r) {
            var d = String(r.created_at || '').slice(0, 10);
            var br = Number(r.amount || 0);
            var lb = ledByPay[r.id] || { company: 0, payout: 0 };
            var nm = nameBy[r.payer_user_id] || '—';
            return '<div class="grid grid-cols-12 gap-1 px-3 py-2.5 border-b border-white/[0.06] text-xs items-center"><div class="col-span-2 text-white/55 tabular-nums">' + d + '</div><div class="col-span-2 text-white/85 truncate" title="">' + String(ferriolIngresosPaymentTypeLabel(r.payment_type)).replace(/</g, '&lt;') + '</div><div class="col-span-2 text-[#86efac] font-semibold tabular-nums">$ ' + br.toLocaleString('es-AR') + '</div><div class="col-span-2 text-cyan-200/90 tabular-nums">$ ' + Number(lb.company).toLocaleString('es-AR') + '</div><div class="col-span-2 text-violet-200/90 tabular-nums">$ ' + Number(lb.payout).toLocaleString('es-AR') + '</div><div class="col-span-2 text-white/55 truncate">' + String(nm).replace(/</g, '&lt;') + '</div></div>';
          }).join('');
          wrap.innerHTML = headF + bodyF;
        }
      } catch (e) {
        kpiG.textContent = kpiCo.textContent = kpiPo.textContent = kpiRj.textContent = '—';
        wrap.innerHTML = '<p class="text-red-300/90 text-sm py-4 px-2">No se pudieron cargar ingresos (empresa). ' + (e && e.message ? String(e.message) : '') + '</p>';
        if (typeof window !== 'undefined' && window.Chart && canvas && window._ferriolIngresosChart) {
          try { window._ferriolIngresosChart.destroy(); } catch (_) {}
          window._ferriolIngresosChart = null;
        }
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    async function loadSuperIngresosSection() {
      var kpiN = document.getElementById('ingresosKpiNet');
      var kpiC = document.getElementById('ingresosKpiCount');
      var kpiR = document.getElementById('ingresosKpiRej');
      var wrap = document.getElementById('ingresosTableWrap');
      var canvas = document.getElementById('ingresosChartCanvas');
      var fb = document.getElementById('ingresosChartFallback');
      if (!wrap) return;
      if (!supabaseClient || !currentUser) {
        wrap.innerHTML = '<p class="text-amber-200/90 text-sm py-4 text-center">Iniciá sesión para ver Ingresos.</p>';
        return;
      }
      if (isEmpresaLensSuper()) {
        return loadSuperIngresosFounderSection();
      }
      if (!kpiN || !kpiC || !kpiR) return;
      if (!isPartnerLens()) {
        wrap.innerHTML = '<p class="text-amber-200/90 text-sm py-4 text-center">Esta sección es para administradores de red o fundador (vista empresa).</p>';
        return;
      }
      setSuperIngresosSectionMode(false);
      var rangeSel = document.getElementById('ingresosRangeFilter');
      var rangeDays = rangeSel && rangeSel.value ? parseInt(rangeSel.value, 10) : 30;
      if (isNaN(rangeDays) || rangeDays < 1) rangeDays = 30;
      kpiN.textContent = kpiC.textContent = kpiR.textContent = '…';
      wrap.innerHTML = '<p class="text-white/45 text-xs py-5 text-center">Cargando…</p>';
      if (fb) { fb.classList.add('hidden'); if (canvas) canvas.classList.remove('hidden'); }
      var uid = currentUser.id;
      var endD = new Date();
      endD.setHours(23, 59, 59, 999);
      var startD = new Date();
      startD.setHours(0, 0, 0, 0);
      startD.setDate(startD.getDate() - (rangeDays - 1));
      var startIsoP = startD.toISOString();
      var endIsoP = endD.toISOString();
      try {
        var resLed = await supabaseClient
          .from('mlm_ledger')
          .select('id, created_at, amount, status, metadata, event_type')
          .eq('beneficiary_user_id', uid)
          .eq('event_type', 'sale_commission')
          .eq('status', 'approved')
          .gte('created_at', startIsoP)
          .lte('created_at', endIsoP)
          .order('created_at', { ascending: false })
          .limit(1000);
        if (resLed.error) throw resLed.error;
        var ledOk = resLed.data || [];
        var sumCom = 0;
        var byDay = {};
        ledOk.forEach(function (L) {
          var a = Number(L.amount || 0);
          sumCom += a;
          var dk = ferriolIngresosDayKeyFromIso(L.created_at);
          if (!byDay[dk]) byDay[dk] = { net: 0, rej: 0, n: 0 };
          byDay[dk].net += a;
          byDay[dk].n += 1;
        });
        kpiN.textContent = '$ ' + sumCom.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ARS';
        kpiC.textContent = String(ledOk.length);
        var resPay = await supabaseClient
          .from('ferriol_payments')
          .select('id, created_at, payment_type, amount, status, payer_user_id')
          .eq('seller_user_id', uid)
          .gte('created_at', startIsoP)
          .lte('created_at', endIsoP)
          .order('created_at', { ascending: false })
          .limit(800);
        if (resPay.error) throw resPay.error;
        var pRows = resPay.data || [];
        var sumRej = 0;
        var nRej = 0;
        pRows.forEach(function (r) {
          if (r.status === 'rejected') {
            sumRej += Number(r.amount || 0);
            nRej += 1;
            var dk = ferriolIngresosDayKeyFromIso(r.created_at);
            if (!byDay[dk]) byDay[dk] = { net: 0, rej: 0, n: 0 };
            byDay[dk].rej += Number(r.amount || 0);
          }
        });
        kpiR.textContent = nRej > 0
          ? ('$ ' + sumRej.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ARS')
          : '$ 0,00 ARS';
        var dayKeys = [];
        var cur = new Date(startD);
        while (cur.getTime() <= endD.getTime()) {
          dayKeys.push(ferriolIngresosDayKeyFromIso(cur.toISOString()));
          cur.setDate(cur.getDate() + 1);
        }
        var labels = dayKeys.map(function (k) {
          var p = k.split('-');
          var d = new Date(parseInt(p[0], 10), parseInt(p[1], 10) - 1, parseInt(p[2], 10));
          return d.toLocaleDateString('es-AR', { day: 'numeric', month: 'short' });
        });
        var dataNet = dayKeys.map(function (k) { return byDay[k] ? byDay[k].net : 0; });
        var dataRej = dayKeys.map(function (k) { return byDay[k] ? byDay[k].rej : 0; });
        var dataCnt = dayKeys.map(function (k) { return byDay[k] ? byDay[k].n : 0; });
        if (typeof window.Chart === 'undefined') {
          if (canvas) canvas.classList.add('hidden');
          if (fb) { fb.classList.remove('hidden'); fb.textContent = 'Gráfico no disponible (librería de gráficos). Revisá la conexión a internet.'; }
        } else {
          if (window._ferriolIngresosChart) {
            try { window._ferriolIngresosChart.destroy(); } catch (_) {}
            window._ferriolIngresosChart = null;
          }
          if (canvas) {
            var ctx = canvas.getContext('2d');
            window._ferriolIngresosChart = new window.Chart(ctx, {
              type: 'line',
              data: {
                labels: labels,
                datasets: [
                  { label: 'Tu comisión (verif.)', data: dataNet, borderColor: 'rgb(134, 239, 172)', backgroundColor: 'rgba(134, 239, 172, 0.12)', tension: 0.25, fill: true, pointRadius: 0, yAxisID: 'y' },
                  { label: 'Cobros rechazados (bruto)', data: dataRej, borderColor: 'rgb(248, 113, 113)', backgroundColor: 'rgba(248, 113, 113, 0.08)', tension: 0.25, fill: true, pointRadius: 0, yAxisID: 'y' },
                  { label: 'Nº acreditaciones', data: dataCnt, borderColor: 'rgb(56, 189, 248)', backgroundColor: 'rgba(56, 189, 248, 0.06)', tension: 0.2, fill: false, pointRadius: 0, yAxisID: 'y1' }
                ]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                  legend: { position: 'top', labels: { color: 'rgba(255,255,255,0.75)', font: { size: 11 } } }
                },
                scales: {
                  x: { ticks: { color: 'rgba(255,255,255,0.45)', maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                  y: { position: 'left', ticks: { color: 'rgba(255,255,255,0.5)' }, grid: { color: 'rgba(255,255,255,0.08)' } },
                  y1: { position: 'right', min: 0, ticks: { color: 'rgba(56, 189, 248, 0.7)', stepSize: 1 }, grid: { drawOnChartArea: false } }
                }
              }
            });
          }
        }
        var recentLed = (resLed.data || []).slice(0, 22);
        var payIds = [];
        recentLed.forEach(function (L) {
          var mid = L.metadata && (L.metadata.payment_id || L.metadata.paymentId);
          if (mid) payIds.push(mid);
        });
        var payTypes = {};
        if (payIds.length) {
          var uq = Array.from(new Set(payIds));
          var pr2 = await supabaseClient.from('ferriol_payments').select('id, payment_type, amount, payer_user_id').in('id', uq);
          if (!pr2.error && pr2.data) {
            pr2.data.forEach(function (p) { if (p && p.id) payTypes[p.id] = p; });
          }
        }
        var allPayer = Array.from(new Set(recentLed.map(function (L) {
          var mid = L.metadata && (L.metadata.payment_id || L.metadata.paymentId);
          if (!mid || !payTypes[mid]) return null;
          return payTypes[mid].payer_user_id;
        }).filter(Boolean)));
        var nameBy = {};
        if (allPayer.length) {
          var pr3 = await supabaseClient.from('profiles').select('id, email, kiosco_name').in('id', allPayer);
          if (!pr3.error && pr3.data) {
            pr3.data.forEach(function (p) {
              if (p && p.id) nameBy[p.id] = (p.kiosco_name || '').trim() || p.email || p.id;
            });
          }
        }
        if (!recentLed.length) {
          wrap.innerHTML = '<p class="text-white/50 text-sm py-8 text-center px-3">Aún no tenés comisiones acreditadas en el libro. La empresa carga y verifica en <strong class="text-white/70">Cobros</strong> poniendote como vendedor; el monto de <strong class="text-white/70">Ingresos</strong> es tu comisión, no el bruto de la operación.</p>';
        } else {
          var head = '<div class="grid grid-cols-12 gap-1 px-3 py-2 border-b border-white/10 text-[10px] text-white/45 font-medium uppercase tracking-wide"><div class="col-span-2">Fecha</div><div class="col-span-2">Tipo</div><div class="col-span-2">Comisión</div><div class="col-span-2">Nivel</div><div class="col-span-2">% aplicado</div><div class="col-span-2">Comprador</div></div>';
          var body = recentLed.map(function (L) {
            var d = String(L.created_at || '').slice(0, 10);
            var mid = L.metadata && (L.metadata.payment_id || L.metadata.paymentId);
            var ptyp = (mid && payTypes[mid]) ? payTypes[mid].payment_type : '';
            var tier = (L.metadata && L.metadata.commission_tier) ? String(L.metadata.commission_tier) : '—';
            var pctV = (L.metadata && (L.metadata.sale_vendor_pct != null)) ? (Number(L.metadata.sale_vendor_pct) * 100).toFixed(1) + '%' : '—';
            var py = (mid && payTypes[mid]) ? payTypes[mid].payer_user_id : null;
            var nm = py ? (nameBy[py] || '…') : '—';
            return '<div class="grid grid-cols-12 gap-1 px-3 py-2.5 border-b border-white/[0.06] text-xs items-center"><div class="col-span-2 text-white/55 tabular-nums">' + d + '</div><div class="col-span-2 text-white/85 truncate">' + String(ferriolIngresosPaymentTypeLabel(ptyp)).replace(/</g, '&lt;') + '</div><div class="col-span-2 text-[#86efac] font-semibold tabular-nums">$ ' + Number(L.amount || 0).toLocaleString('es-AR') + '</div><div class="col-span-2 text-amber-200/80">' + String(tier).replace(/</g, '&lt;') + '</div><div class="col-span-2 text-white/50 tabular-nums">' + pctV + '</div><div class="col-span-2 text-white/60 truncate">' + String(nm).replace(/</g, '&lt;') + '</div></div>';
          }).join('');
          wrap.innerHTML = head + body;
        }
      } catch (e) {
        kpiN.textContent = kpiC.textContent = kpiR.textContent = '—';
        wrap.innerHTML = '<p class="text-red-300/90 text-sm py-4 px-2">No se pudieron cargar los ingresos. ' + (e && e.message ? String(e.message) : '') + ' ¿Ejecutaste <code class="text-white/80">supabase-ferriol-payments.sql</code> y las políticas RLS?</p>';
        if (typeof window !== 'undefined' && window.Chart && canvas && window._ferriolIngresosChart) {
          try { window._ferriolIngresosChart.destroy(); } catch (_) {}
          window._ferriolIngresosChart = null;
        }
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function superSolicitudRowHtml(title, mid, right) {
      return '<div class="inventory-item border-x-0 rounded-none cursor-default"><div class="inv-item-info"><span class="inv-item-name"><span class="block truncate">' + title + '</span></span><span class="inv-item-price text-[#86efac]">' + mid + '</span><span class="inv-item-stock text-white/45 truncate max-w-[38vw] text-[11px]">' + right + '</span></div></div>';
    }
    function superSolicitudNameOf(pool, id) {
      if (!id) return '—';
      var p = (pool || []).find(function (x) { return x.id === id; });
      return (p ? (p.kiosco_name || p.email || String(id)) : String(id)).replace(/</g, '&lt;');
    }
    function escHtmlCsr(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }
    async function loadFounderClientSaleRequestsPanel() {
      var clBox = document.getElementById('superClientSaleRequestsList');
      if (!clBox) return;
      if (!supabaseClient || !isEmpresaLensSuper()) {
        clBox.innerHTML = '';
        return;
      }
      clBox.innerHTML = '<p class="text-white/45 text-xs py-2">Cargando comprobantes…</p>';
      try {
        var r = await supabaseClient.from('ferriol_client_sale_requests').select('*').order('created_at', { ascending: false }).limit(40);
        if (r.error) throw r.error;
        var rows = r.data || [];
        var pool = window._ferriolAllProfilesCache || [];
        if (!pool.length) {
          var prP = await supabaseClient.from('profiles').select('id, email, kiosco_name').limit(800);
          if (!prP.error && prP.data) {
            window._ferriolAllProfilesCache = prP.data;
            pool = prP.data;
          }
        }
        var pending = rows.filter(function (x) { return x.status === 'pending'; });
        var other = rows.filter(function (x) { return x.status !== 'pending'; });
        function pubUrl(path) {
          if (!path) return '';
          var x = supabaseClient.storage.from('comprobantes-ferriol').getPublicUrl(path);
          return x && x.data && x.data.publicUrl ? x.data.publicUrl : '';
        }
        var htmlPend = pending.map(function (row) {
          var img = pubUrl(row.comprobante_path);
          var pName = superSolicitudNameOf(pool, row.partner_id);
          return (
            '<div class="rounded-xl border border-white/15 bg-black/30 p-3 space-y-2">' +
            '<div class="flex flex-wrap gap-2 justify-between text-xs text-white/55"><span>' + String(row.created_at).slice(0, 19).replace('T', ' ') + '</span><span>Admin: ' + escHtmlCsr(pName) + '</span></div>' +
            '<p class="text-sm text-white/90"><strong>Cliente:</strong> ' + escHtmlCsr(row.client_name) + '</p>' +
            '<p class="text-sm text-white/80"><strong>Email:</strong> ' + escHtmlCsr(row.client_email) + '</p>' +
            '<p class="text-xs text-white/55">Tipo: ' + escHtmlCsr(ferriolIngresosPaymentTypeLabel(row.payment_type)) + (row.period_month ? ' · Mes: ' + String(row.period_month).slice(0, 7) : '') + '</p>' +
            '<div class="flex flex-wrap items-center gap-2"><span class="text-xs text-white/50">Monto ARS</span>' +
            '<input type="number" id="csr-amount-' + row.id + '" class="glass rounded-lg px-2 py-1 border border-white/20 text-white text-sm w-36" value="' + String(Number(row.amount_ars) || 0) + '"></div>' +
            (img
              ? '<a href="' + escHtmlCsr(img) + '" target="_blank" rel="noopener" class="block touch-target"><img src="' + escHtmlCsr(img) + '" alt="Comprobante" class="max-h-48 w-auto max-w-full rounded-lg border border-white/20 object-contain bg-black/20"></a>'
              : '<p class="text-amber-200 text-xs">No se pudo generar enlace a la imagen. Revisá el bucket y políticas de Storage.</p>') +
            '<div class="flex flex-wrap gap-2 pt-1">' +
            '<button type="button" data-csr-approve="' + row.id + '" class="btn-glow rounded-xl py-2 px-3 text-xs font-semibold">Aprobar y acreditar comisión</button>' +
            '<button type="button" data-csr-reject="' + row.id + '" class="rounded-xl py-2 px-3 text-xs font-semibold border border-red-400/50 text-red-200">Rechazar</button></div></div>'
          );
        }).join('');
        var htmlHist = other.length
          ? '<h4 class="text-xs font-medium text-white/40 mt-4 mb-2">Historial reciente</h4><div class="text-xs text-white/50 space-y-1.5 max-h-40 overflow-y-auto pr-1">' + other.slice(0, 12).map(function (row) {
            return (
              '<p class="border-b border-white/5 pb-1">' + String(row.created_at).slice(0, 10) + ' · ' + escHtmlCsr(row.client_email) + ' · <span class="text-white/70">' + row.status + '</span>' +
              (row.ferriol_payment_id ? ' · pago' : '') + '</p>'
            );
          }).join('') + '</div>'
          : '';
        if (!rows.length) {
          clBox.innerHTML = '<p class="text-white/50 text-sm py-4">Ninguna solicitud con comprobante. Los administradores de red envían desde <strong class="text-white/75">Afiliados</strong> → <strong class="text-white/75">Enviar venta con comprobante</strong>.</p>';
        } else {
          clBox.innerHTML = (htmlPend || '<p class="text-amber-200/90 text-sm py-2">Nada pendiente de validar en este listado.</p>') + htmlHist;
        }
      } catch (e) {
        clBox.innerHTML = '<p class="text-red-300 text-sm">Error al cargar comprobantes. ¿Ejecutaste <code class="text-white/80">supabase-ferriol-client-sale-requests.sql</code>? ' + escHtmlCsr(String(e.message || e)) + '</p>';
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    window._ferriolExecCsrApprove = async function (id, approves, rejectNote, amountOverride) {
      if (!supabaseClient || !isEmpresaLensSuper() || !id) return;
      if (!window.confirm(approves ? '¿Aprobar esta venta, verificar pago y acreditar comisiones (libro + Ingresos del socio)?' : '¿Rechazar esta solicitud?')) return;
      var msgEl = document.getElementById('superClientSaleRequestsMsg');
      if (msgEl) { msgEl.classList.add('hidden'); msgEl.textContent = ''; }
      try {
        var rpc = await supabaseClient.rpc('ferriol_approve_client_sale_request', {
          p_request_id: id,
          p_approve: approves,
          p_reject_note: approves ? null : (rejectNote != null && rejectNote !== '' ? rejectNote : null),
          p_amount_override: approves && amountOverride != null && !isNaN(amountOverride) ? amountOverride : null
        });
        if (rpc.error) throw rpc.error;
        var out = rpc.data;
        if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
        if (!out || out.ok !== true) {
          alert((out && out.error) ? out.error : 'No se pudo completar la operación.');
          return;
        }
        if (msgEl) {
          msgEl.textContent = approves ? 'Aprobado. Pago verificado y comisiones acreditadas.' : 'Solicitud rechazada.';
          msgEl.classList.remove('hidden');
        }
        await loadFounderClientSaleRequestsPanel();
        if (state.superSection === 'cobros') await renderSuperCobrosSection();
      } catch (e) {
        alert('Error: ' + (e && e.message ? e.message : e));
      }
    };
    (function setupFounderClientSaleDelegation() {
      var box = document.getElementById('superClientSaleRequestsBox');
      if (!box) return;
      box.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('[data-csr-approve]');
        if (a) {
          e.preventDefault();
          var id = a.getAttribute('data-csr-approve');
          var inp = id ? document.getElementById('csr-amount-' + id) : null;
          var raw = inp ? String(inp.value || '').replace(/\./g, '').replace(',', '.') : '';
          var amt = parseFloat(raw, 10);
          if (isNaN(amt) || amt <= 0) {
            alert('Ingresá un monto ARS válido en el recuadro.');
            return;
          }
          void window._ferriolExecCsrApprove(id, true, null, amt);
          return;
        }
        var rj = e.target && e.target.closest && e.target.closest('[data-csr-reject]');
        if (rj) {
          e.preventDefault();
          var id2 = rj.getAttribute('data-csr-reject');
          var n = (typeof window.prompt === 'function') ? window.prompt('Motivo de rechazo (opcional):', '') : '';
          void window._ferriolExecCsrApprove(id2, false, n || null, null);
        }
      });
    })();
    async function loadSuperSolicitudesSection() {
      var elP = document.getElementById('superSolicitudesPendientes');
      var elA = document.getElementById('superSolicitudesAprobadas');
      var elR = document.getElementById('superSolicitudesRechazadas');
      var clBox = document.getElementById('superClientSaleRequestsList');
      var clWrap = document.getElementById('superClientSaleRequestsBox');
      if (!elP || !elA || !elR) return;
      if (!supabaseClient || !currentUser) {
        elP.innerHTML = elA.innerHTML = elR.innerHTML = '';
        if (clBox) clBox.innerHTML = '';
        if (clWrap) clWrap.classList.add('hidden');
        return;
      }
      if (isEmpresaLensSuper() && clWrap) {
        clWrap.classList.remove('hidden');
        await loadFounderClientSaleRequestsPanel();
      } else {
        if (clBox) clBox.innerHTML = '';
        if (clWrap) clWrap.classList.add('hidden');
      }
      if (!isEmpresaLensSuper()) {
        elP.innerHTML = elA.innerHTML = elR.innerHTML = '';
        return;
      }
      var loading = '<p class="text-white/45 text-xs py-3 text-center">Cargando…</p>';
      elP.innerHTML = elA.innerHTML = elR.innerHTML = loading;
      var pool = window._ferriolAllProfilesCache || [];
      if (!pool.length) {
        try {
          var prPool = await supabaseClient.from('profiles').select('id, email, kiosco_name').limit(800);
          if (!prPool.error && prPool.data) {
            window._ferriolAllProfilesCache = prPool.data;
            pool = prPool.data;
          }
        } catch (_) {}
      }
      var pend = [];
      var apr = [];
      var rech = [];
      function pushBucket(row, type) {
        var st = row.status;
        var b;
        if (st === 'pending') b = pend;
        else if (st === 'rejected') b = rech;
        else b = apr;
        var ts = row.created_at || '';
        var title;
        var mid;
        var right;
        var d = String(ts).slice(0, 10);
        if (type === 'mdr') {
          title = 'Membresía · ' + superSolicitudNameOf(pool, row.kiosquero_user_id);
          mid = (row.days_delta > 0 ? '+' : '') + row.days_delta + ' d';
          right = d + ' · ' + superSolicitudNameOf(pool, row.requested_by);
          if (row.reject_note && st === 'rejected') right += ' · ' + String(row.reject_note).replace(/</g, '&lt;').slice(0, 40);
        } else if (type === 'ppr') {
          title = 'Alta socio · ' + String(row.target_email || '').replace(/</g, '&lt;');
          mid = row.client_payment_ars != null ? ('$ ' + Number(row.client_payment_ars).toLocaleString('es-AR')) : '—';
          right = d + ' · ' + superSolicitudNameOf(pool, row.requested_by);
          if (row.display_name) right += ' · ' + String(row.display_name).replace(/</g, '&lt;');
          if (row.reject_note && st === 'rejected') right += ' · ' + String(row.reject_note).replace(/</g, '&lt;').slice(0, 32);
        } else {
          title = 'Alta kiosco · ' + String(row.kiosco_name || '').replace(/</g, '&lt;');
          mid = String(row.target_email || '').replace(/</g, '&lt;');
          right = d + ' · ' + superSolicitudNameOf(pool, row.requested_by);
          if (row.reject_note && st === 'rejected') right += ' · ' + String(row.reject_note).replace(/</g, '&lt;').slice(0, 32);
        }
        if ((st === 'approved' || st === 'completed') && row.reviewed_at) {
          right += ' · Rev. ' + String(row.reviewed_at).slice(0, 10);
        }
        b.push({ ts: ts, html: superSolicitudRowHtml(title, mid, right) });
      }
      try {
        var lim = 200;
        var qM = await supabaseClient.from('ferriol_membership_day_requests').select('*').order('created_at', { ascending: false }).limit(lim);
        var qP = await supabaseClient.from('ferriol_partner_provision_requests').select('*').order('created_at', { ascending: false }).limit(lim);
        var qK = await supabaseClient.from('ferriol_kiosquero_provision_requests').select('*').order('created_at', { ascending: false }).limit(lim);
        if (qM.error && qP.error && qK.error) throw qM.error || qP.error || qK.error;
        (qM.data || []).forEach(function (r) { pushBucket(r, 'mdr'); });
        (qP.data || []).forEach(function (r) { pushBucket(r, 'ppr'); });
        (qK.data || []).forEach(function (r) { pushBucket(r, 'kpr'); });
        function sortDesc(a, b) { return String(b.ts).localeCompare(String(a.ts)); }
        pend.sort(sortDesc);
        apr.sort(sortDesc);
        rech.sort(sortDesc);
        function renderCol(arr, emptyMsg) {
          if (!arr.length) return '<p class="text-xs text-white/45 py-4 text-center px-2">' + emptyMsg + '</p>';
          return '<div class="rounded-xl border border-white/10 bg-black/15 overflow-hidden">' + arr.map(function (x) { return x.html; }).join('') + '</div>';
        }
        elP.innerHTML = renderCol(pend, 'No hay solicitudes pendientes.');
        elA.innerHTML = renderCol(apr, 'No hay solicitudes aprobadas o completadas en el historial reciente.');
        elR.innerHTML = renderCol(rech, 'No hay solicitudes rechazadas.');
        var warn = [];
        if (qM.error) warn.push('membresía');
        if (qP.error) warn.push('socios');
        if (qK.error) warn.push('kioscos');
        if (warn.length) {
          elP.innerHTML = '<p class="text-[10px] text-amber-200/90 px-2 py-1 mb-2">No se cargó: ' + warn.join(', ') + '. Revisá RLS o tablas SQL.</p>' + elP.innerHTML;
        }
      } catch (e) {
        var em = '<p class="text-red-300/90 text-sm py-4 px-2">No se pudieron cargar las solicitudes. ' + String(e.message || e) + '</p>';
        elP.innerHTML = elA.innerHTML = elR.innerHTML = em;
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function ferriolKioscoSponsorHintHtml() {
      if (!currentUser || !currentUser.sponsorId) {
        return 'No figura referidor en tu perfil. Si entraste por invitación, pedí que lo carguen en administración. <span class="text-white/60">El pago de la licencia sigue yendo a <strong class="text-white/75">Ferriol (empresa)</strong> con los datos oficiales de arriba.</span>';
      }
      return null;
    }
    async function ferriolFetchSponsorHintText() {
      var fallback = ferriolKioscoSponsorHintHtml();
      if (fallback !== null) return { html: fallback, ok: true, partnerTransferInfo: '' };
      if (!supabaseClient) return { html: 'Configurá Supabase para ver datos del referidor.', ok: false, partnerTransferInfo: '' };
      try {
        var sp = await supabaseClient.from('profiles').select('kiosco_name, email, role, partner_transfer_info').eq('id', currentUser.sponsorId).maybeSingle();
        if (sp.error || !sp.data) return { html: 'Tenés referidor asignado. Si no sabés quién es, consultá con el administrador. <span class="text-white/60">El pago de la licencia es <strong class="text-white/75">siempre a Ferriol</strong> (datos oficiales arriba).</span>', ok: true, partnerTransferInfo: '' };
        var d = sp.data;
        var partnerTI = d.partner_transfer_info != null && String(d.partner_transfer_info).trim() ? String(d.partner_transfer_info).trim() : '';
        var nm = (d.kiosco_name || '').trim() || (d.email ? String(d.email).split('@')[0] : '') || '—';
        var roleL = d.role === 'super' ? 'Administrador' : (d.role === 'partner' ? 'Socio vendedor' : 'Referidor');
        var em = d.email ? String(d.email).replace(/</g, '&lt;').replace(/&/g, '&amp;') : '';
        var nmEsc = String(nm).replace(/</g, '&lt;').replace(/&/g, '&amp;');
        var html = 'Contacto de tu red: <strong class="text-[#86efac]/95">' + nmEsc + '</strong>' + (em ? ' · ' + em : '') + ' <span class="text-white/45">(' + roleL + ')</span>. <span class="text-white/60">Dudas y seguimiento. El pago de la <strong class="text-white/75">licencia a Ferriol</strong> hacelo con los <strong class="text-cyan-200/80">datos oficiales de la empresa</strong> (arriba en esta misma tarjeta).</span>';
        return { html: html, ok: true, partnerTransferInfo: partnerTI };
      } catch (_) {
        return { html: 'Consultá con el administrador quién es tu referidor.', ok: false, partnerTransferInfo: '' };
      }
    }
    async function loadKioscoLicensePaymentInfo() {
      var block = document.getElementById('kioscoLicensePaymentBlock');
      var pre = document.getElementById('kioscoTransferInfoText');
      var priceEl = document.getElementById('kioscoLicensePriceHint');
      var sponsorEl = document.getElementById('kioscoLicenseSponsorHint');
      if (!currentUser) return;
      var show = currentUser.role === 'kiosquero' || isSuperKioscoPreviewMode();
      if (block) block.style.display = show ? '' : 'none';
      if (!show) return;
      var amt = FERRIOL_PLAN_AMOUNTS.kioscoMonthly;
      var amtStr = amt.toLocaleString('es-AR');
      if (priceEl) {
        priceEl.innerHTML = 'Cuota orientativa: <strong class="text-[#86efac]">$ ' + amtStr + ' ARS</strong> por mes. <strong class="text-white/90">Ese pago</strong> (licencia) va a <strong class="text-cyan-200/90">Ferriol (empresa)</strong> con los datos oficiales. Monto y comprobante: acordalos con tu <strong class="text-white/80">referidor o administración</strong> si hace falta.';
      }
      var transferBody = 'Falta cargar en Ajustes (fundador) los datos oficiales de la cuenta de Ferriol (empresa) a la que se transfiere la licencia de todos los negocios.';
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
      var ptw = document.getElementById('kioscoPartnerTransferWrap');
      var ptx = document.getElementById('kioscoPartnerTransferText');
      if (ptw && ptx) {
        var pti = (spHint && spHint.partnerTransferInfo) ? String(spHint.partnerTransferInfo).trim() : '';
        if (pti) {
          ptx.textContent = pti;
          ptw.classList.remove('hidden');
        } else {
          ptx.textContent = '';
          ptw.classList.add('hidden');
        }
      }
      var waWrap = document.getElementById('kioscoLicenseReferidorWhatsApp');
      if (waWrap && currentUser && currentUser.role === 'kiosquero') {
        await refreshViewerHelpWhatsApp(currentUser);
        var waNum = viewerHelpWhatsApp.list && viewerHelpWhatsApp.list[0];
        if (waNum) {
          var waUrl = getWhatsAppUrl(waNum, 'Hola, consulto por el pago de la licencia de mi negocio en Ferriol OS.');
          waWrap.innerHTML = '<a href="' + waUrl + '" target="_blank" rel="noopener" class="inline-flex items-center gap-2 text-sm font-semibold text-[#86efac] touch-target py-1"><i data-lucide="message-circle" class="w-4 h-4"></i> WhatsApp de tu referidor</a>';
          waWrap.classList.remove('hidden');
          try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
        } else if (viewerHelpWhatsApp.note === 'sponsor_no_phone' && viewerHelpWhatsApp.sponsorEmail) {
          var rm = String(viewerHelpWhatsApp.sponsorEmail).trim();
          waWrap.innerHTML = '<a href="mailto:' + rm.replace(/"/g, '') + '" class="inline-flex items-center gap-2 text-sm font-medium text-white/80 touch-target py-1"><i data-lucide="mail" class="w-4 h-4"></i> Email del referidor (sin WhatsApp cargado)</a>';
          waWrap.classList.remove('hidden');
          try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
        } else {
          waWrap.innerHTML = '';
          waWrap.classList.add('hidden');
        }
      } else if (waWrap) {
        waWrap.innerHTML = '';
        waWrap.classList.add('hidden');
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
      superSection: 'afiliados',  // afiliados | ingresos | cobros | ajustes | solicitudes | mas
      afiliadosSubTab: 'usuarios',  // usuarios (kiosquero) | distribuidores (partner)
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
    /** Tarjeta “Pagar a Ferriol” en Más: socios; fundador en vista Empresa la oculta (usa Ajustes). */
    function shouldShowFerriolCompanyCardInMas() {
      if (!currentUser) return false;
      if (currentUser.role === 'partner') return true;
      if (currentUser.role === 'super' && isSuperSocioLens()) return true;
      return false;
    }
    function updateSuperMasBankingShell() {
      var cF = document.getElementById('superMasFerriolBankingCard');
      var cP = document.getElementById('superMasPartnerBankingCard');
      if (cF) cF.classList.toggle('hidden', !shouldShowFerriolCompanyCardInMas());
      if (cP) cP.classList.toggle('hidden', !(currentUser && currentUser.role === 'partner'));
    }
    async function loadSuperMasBankingSection() {
      if (!currentUser) return;
      updateSuperMasBankingShell();
      var preF = document.getElementById('superMasFerriolTransferText');
      if (preF && shouldShowFerriolCompanyCardInMas() && supabaseClient) {
        try {
          var r = await supabaseClient.from('app_settings').select('value').eq('key', 'ferriol_transfer_info').maybeSingle();
          preF.textContent = (r.data && r.data.value) ? String(r.data.value) : 'Aún no hay datos de cuenta cargados. Pedí a la empresa que completen Ajustes (fundador) o contactá a soporte.';
        } catch (_) {
          preF.textContent = 'No se pudieron cargar los datos de la empresa.';
        }
      } else if (preF) preF.textContent = '—';
      if (currentUser.role === 'partner' && supabaseClient) {
        try {
          var pr = await supabaseClient.from('profiles').select('partner_transfer_info').eq('id', currentUser.id).maybeSingle();
          if (!pr.error && pr.data) {
            currentUser.partnerTransferInfo = pr.data.partner_transfer_info != null ? String(pr.data.partner_transfer_info) : '';
          }
        } catch (_) {}
      }
      var prev = document.getElementById('superMasPartnerTransferPreview');
      if (prev) {
        var t = (currentUser && currentUser.partnerTransferInfo) ? String(currentUser.partnerTransferInfo).trim() : '';
        if (t) {
          var short = t.length > 200 ? t.slice(0, 200) + '…' : t;
          prev.textContent = 'Guardado: ' + short;
          prev.classList.remove('hidden', 'text-amber-200/70');
        } else {
          prev.textContent = 'Todavía no cargaste datos. Tus referidos solo verán los datos de la empresa en Caja.';
          prev.classList.add('text-amber-200/70');
          prev.classList.remove('hidden');
        }
      }
      var ta = document.getElementById('partnerTransferInfoTextarea');
      if (ta && currentUser && currentUser.role === 'partner') {
        ta.value = currentUser.partnerTransferInfo != null ? String(currentUser.partnerTransferInfo) : '';
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
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
    /** Quién debe ver la campana y recibir avisos globales de la empresa (solo lectura salvo vista fundador). */
    function ferriolNotificationRecipientShell() {
      if (!currentUser) return false;
      if (currentUser.role === 'kiosquero') return true;
      if (isSuperKioscoPreviewMode()) return true;
      if (currentUser.role === 'partner') return true;
      if (currentUser.role === 'super' && isSuperSocioLens()) return true;
      return false;
    }
    function ferriolStartNotificationPolling() {
      if (window._ferriolNotifPollInterval) clearInterval(window._ferriolNotifPollInterval);
      window._ferriolNotifPollInterval = setInterval(function () {
        if (document.hidden || !supabaseClient) return;
        if (!ferriolNotificationRecipientShell()) return;
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
      if (lens === 'socio') {
        ferriolStartNotificationPolling();
        loadNotifications();
      }
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
            <button type="button" class="add-to-cart-btn inv-item-btn" data-codigo="${p.codigo}" title="Elegir cantidad y agregar al carrito">
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
        btn.onclick = (e) => { e.stopPropagation(); openAddToCartQtyModal(btn.dataset.codigo); };
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
      var stockN = Math.max(0, Number(p.stock) || 0);
      var existingLine = state.cart.find(i => i.codigo === codigo);
      var inCartLine = existingLine ? existingLine.cant : 0;
      var maxAddDetail = Math.max(0, stockN - inCartLine);
      var qtyEl = document.getElementById('productDetailQty');
      var hintDetail = document.getElementById('productDetailQtyHint');
      var addCartBtn = document.getElementById('productDetailAddCart');
      if (qtyEl) {
        qtyEl.value = '1';
        qtyEl.min = '1';
        qtyEl.max = String(Math.max(1, maxAddDetail));
        qtyEl.disabled = maxAddDetail <= 0;
      }
      if (hintDetail) {
        hintDetail.textContent = maxAddDetail <= 0 ? 'Sin unidades para agregar (revisá stock o el carrito).' : ('Hasta ' + maxAddDetail + ' u. en este paso.');
      }
      if (addCartBtn) {
        addCartBtn.disabled = maxAddDetail <= 0;
        addCartBtn.classList.toggle('opacity-50', maxAddDetail <= 0);
        addCartBtn.classList.toggle('pointer-events-none', maxAddDetail <= 0);
        addCartBtn.onclick = function () {
          if (maxAddDetail <= 0) return;
          var q = parseInt(qtyEl && qtyEl.value, 10) || 1;
          addToCart(codigo, q);
          closeProductDetail();
        };
      }
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

    function addToCart(codigo, qtyOpt) {
      const d = getData();
      const p = (d.products || {})[codigo];
      if (!p) return;
      const stockAvail = Math.max(0, Number(p.stock) || 0);
      if (stockAvail <= 0) {
        if (typeof showScanToast === 'function') showScanToast('Sin stock: ' + (p.nombre || ''), true);
        return;
      }
      const existing = state.cart.find(i => i.codigo === codigo);
      const inCart = existing ? existing.cant : 0;
      const maxAdd = stockAvail - inCart;
      if (maxAdd <= 0) {
        if (typeof showScanToast === 'function') showScanToast('No quedan unidades para agregar (revisá el carrito).', true);
        return;
      }
      let requested = qtyOpt != null && qtyOpt !== '' ? Math.floor(Number(qtyOpt)) : 1;
      if (isNaN(requested) || requested < 1) requested = 1;
      const addN = Math.min(requested, maxAdd);
      if (requested > maxAdd && typeof showScanToast === 'function') {
        showScanToast('Solo se agregaron ' + addN + ' u. (máx. disponible: ' + maxAdd + ').', false);
      }
      const costo = p.costo != null ? Number(p.costo) : 0;
      if (existing) existing.cant += addN;
      else state.cart.push({ ...p, cant: addN, costo });
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

    function closeAddToCartQtyModal() {
      state._pendingAddToCartCodigo = null;
      var m = document.getElementById('addToCartQtyModal');
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    }

    function openAddToCartQtyModal(codigo) {
      if (!codigo) return;
      const d = getData();
      const p = (d.products || {})[codigo];
      if (!p) return;
      const stockAvail = Math.max(0, Number(p.stock) || 0);
      if (stockAvail <= 0) {
        if (typeof showScanToast === 'function') showScanToast('Sin stock: ' + (p.nombre || ''), true);
        return;
      }
      const existing = state.cart.find(i => i.codigo === codigo);
      const inCart = existing ? existing.cant : 0;
      const maxAdd = stockAvail - inCart;
      if (maxAdd <= 0) {
        if (typeof showScanToast === 'function') showScanToast('No hay unidades disponibles (ya están en el carrito).', true);
        return;
      }
      state._pendingAddToCartCodigo = codigo;
      var titleEl = document.getElementById('addToCartQtyTitle');
      var subEl = document.getElementById('addToCartQtySubtitle');
      var inp = document.getElementById('addToCartQtyInput');
      var hint = document.getElementById('addToCartQtyHint');
      if (titleEl) titleEl.textContent = p.nombre || 'Producto';
      if (subEl) {
        subEl.textContent = '$' + (p.precio ?? 0).toLocaleString('es-AR') + ' · Stock: ' + stockAvail + (inCart ? ' · Ya en carrito: ' + inCart : '');
      }
      if (inp) {
        inp.value = '1';
        inp.min = '1';
        inp.max = String(maxAdd);
      }
      if (hint) hint.textContent = 'Podés agregar hasta ' + maxAdd + ' u. en este paso.';
      var m = document.getElementById('addToCartQtyModal');
      if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
      setTimeout(function () {
        if (inp) {
          inp.focus();
          try { inp.select(); } catch (_) {}
        }
      }, 80);
    }

    function removeFromCart(idx) {
      state.cart.splice(idx, 1);
      updateCartUI();
    }

    function maxQtyAllowedInCart(codigo) {
      var d = getData();
      var p = (d.products || {})[codigo];
      return p ? Math.max(0, Number(p.stock) || 0) : 0;
    }

    function changeCartItemQty(idx, delta) {
      var item = state.cart[idx];
      if (!item) return;
      var codigo = item.codigo;
      var maxAllowed = maxQtyAllowedInCart(codigo, item.cant);
      if (delta > 0) {
        if (item.cant >= maxAllowed) {
          if (typeof showScanToast === 'function') showScanToast('No hay más stock de este producto.', true);
          return;
        }
        item.cant += 1;
      } else {
        if (item.cant <= 1) {
          state.cart.splice(idx, 1);
        } else {
          item.cant -= 1;
        }
      }
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
            <p class="text-sm text-white/50 mb-4">Agregá desde Productos (elegís la cantidad), desde Inicio o con el escáner.</p>
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
        itemsEl.innerHTML = state.cart.map((item, idx) => {
          var nm = (item.nombre || '').replace(/</g, '&lt;');
          var sub = (item.precio * item.cant).toLocaleString('es-AR');
          var unit = (item.precio != null ? Number(item.precio) : 0).toLocaleString('es-AR');
          return `
          <div class="flex items-center gap-2 sm:gap-3 glass rounded-xl p-3">
            <div class="w-9 h-9 sm:w-10 sm:h-10 rounded-lg bg-[#dc2626]/30 flex items-center justify-center shrink-0">
              <i data-lucide="package" class="w-4 h-4 sm:w-5 sm:h-5 text-[#f87171]"></i>
            </div>
            <div class="flex-1 min-w-0">
              <p class="font-medium truncate">${nm}</p>
              <p class="text-sm text-white/60">$${unit} c/u</p>
            </div>
            <div class="flex items-center gap-0.5 shrink-0">
              <button type="button" class="cart-qty-btn w-9 h-9 flex items-center justify-center rounded-lg border border-white/20 text-white/90 hover:bg-white/10 touch-target" data-idx="${idx}" data-delta="-1" aria-label="Quitar una unidad">
                <i data-lucide="minus" class="w-4 h-4"></i>
              </button>
              <span class="min-w-[2rem] text-center text-sm font-semibold tabular-nums text-white/95">${item.cant}</span>
              <button type="button" class="cart-qty-btn w-9 h-9 flex items-center justify-center rounded-lg border border-white/20 text-white/90 hover:bg-white/10 touch-target" data-idx="${idx}" data-delta="1" aria-label="Agregar una unidad">
                <i data-lucide="plus" class="w-4 h-4"></i>
              </button>
            </div>
            <p class="font-semibold text-sm sm:text-base shrink-0 min-w-[4.5rem] text-right">$${sub}</p>
            <button type="button" class="remove-cart text-red-400/90 p-2 touch-target rounded-lg hover:bg-red-500/20 shrink-0" data-idx="${idx}" aria-label="Quitar del carrito">
              <i data-lucide="trash-2" class="w-4 h-4"></i>
            </button>
          </div>`;
        }).join('');
        lucide.createIcons();
        itemsEl.querySelectorAll('.cart-qty-btn').forEach(function (btn) {
          btn.onclick = function () {
            var i = parseInt(btn.dataset.idx, 10);
            var d = parseInt(btn.dataset.delta, 10);
            if (!isNaN(i) && (d === 1 || d === -1)) changeCartItemQty(i, d);
          };
        });
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
        return '<button type="button" class="freq-product-btn flex-shrink-0 glass rounded-xl px-4 py-3 border border-white/10 hover:border-[#22c55e]/50 active:opacity-90 touch-target text-left min-w-0 max-w-[140px]' + disabled + '" data-codigo="' + (p.codigo || '').replace(/"/g, '&quot;') + '" title="Elegir cantidad y agregar"><p class="font-medium truncate text-sm leading-snug">' + (nombre || '').replace(/</g, '&lt;') + '</p><p class="text-[#86efac] text-xs mt-1 leading-none tabular-nums">$' + (precio || 0).toLocaleString('es-AR') + '</p></button>';
      }).join('');
      cont.querySelectorAll('.freq-product-btn').forEach(function (btn) {
        btn.onclick = function () {
          var codigo = btn.dataset.codigo;
          if (codigo) openAddToCartQtyModal(codigo);
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
    function ferriolFormatCountdownHMS(msLeft) {
      if (msLeft < 0) msLeft = 0;
      var sec = Math.floor(msLeft / 1000);
      var h = Math.floor(sec / 3600);
      var m = Math.floor((sec % 3600) / 60);
      var s = sec % 60;
      function z(n) { return n < 10 ? '0' + n : String(n); }
      return z(h) + ':' + z(m) + ':' + z(s);
    }

    var _partnerPendingBannerSyncTicker = 0;
    function updatePartnerLicensePendingBanner() {
      var banner = document.getElementById('partnerLicensePendingBanner');
      var clockEl = document.getElementById('partnerLicensePendingClock');
      if (!banner || !clockEl) return;
      if (!currentUser || currentUser.role !== 'partner' || !currentUser.partnerLicensePending) {
        _partnerPendingBannerSyncTicker = 0;
        banner.classList.add('hidden');
        return;
      }
      var endsAt = currentUser.trialEndsAt;
      if (!endsAt) {
        _partnerPendingBannerSyncTicker = 0;
        banner.classList.add('hidden');
        return;
      }
      var end = new Date(endsAt);
      var now = new Date();
      var msLeft = end - now;
      if (msLeft <= 0) {
        _partnerPendingBannerSyncTicker = 0;
        banner.classList.add('hidden');
        if (supabaseClient && currentUser && currentUser.id && !currentUser._partnerPendingBlockTriggered) {
          currentUser._partnerPendingBlockTriggered = true;
          supabaseClient.from('profiles').update({ active: false, partner_license_pending: false }).eq('id', currentUser.id).then(function () {
            supabaseClient.auth.signOut().then(function () {
              document.getElementById('appWrap').classList.add('hidden');
              document.getElementById('loginScreen').classList.remove('hidden');
              var errEl = document.getElementById('loginErr');
              if (errEl) {
                errEl.textContent = 'Venció el plazo sin confirmar tu licencia de distribuidor. Contactá a tu patrocinador o a la empresa.';
                errEl.classList.add('show');
              }
            });
          });
        }
        return;
      }
      banner.classList.remove('hidden');
      clockEl.textContent = ferriolFormatCountdownHMS(msLeft);
      _partnerPendingBannerSyncTicker++;
      if (_partnerPendingBannerSyncTicker >= 20 && supabaseClient && currentUser) {
        _partnerPendingBannerSyncTicker = 0;
        supabaseClient.from('profiles').select('partner_license_pending, trial_ends_at').eq('id', currentUser.id).maybeSingle().then(function (r) {
          if (r && r.data && currentUser) {
            if (!r.data.partner_license_pending) {
              currentUser.partnerLicensePending = false;
              if (r.data.trial_ends_at) currentUser.trialEndsAt = r.data.trial_ends_at;
              var b = document.getElementById('partnerLicensePendingBanner');
              if (b) b.classList.add('hidden');
            }
          }
        });
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }

    function ferriolTickCountdowns() {
      updatePartnerLicensePendingBanner();
      updateTrialCountdown();
    }

    function showLoginScreenTrialEnded() {
      document.getElementById('appWrap').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
      document.getElementById('signUpBox').classList.add('hidden');
      var errEl = document.getElementById('loginErr');
      errEl.textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá a tu referidor por WhatsApp para renovar.';
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
            refreshViewerHelpWhatsApp(currentUser).then(function () {
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
    document.getElementById('trialRenovarBtn') && document.getElementById('trialRenovarBtn').addEventListener('click', function () {
      if (!currentUser) return;
      refreshViewerHelpWhatsApp(currentUser).then(function () {
        fillRenovarWhatsAppLinks();
        var hasWa = viewerHelpWhatsApp.list && viewerHelpWhatsApp.list.length > 0;
        var hasMail = viewerHelpWhatsApp.note === 'sponsor_no_phone' && viewerHelpWhatsApp.sponsorEmail;
        if (!hasWa && !hasMail) {
          alert(currentUser.role === 'kiosquero' ? 'No hay WhatsApp de tu referidor cargado. Pedile que actualice su perfil o contactá al soporte.' : 'La empresa aún no configuró números de contacto para administradores.');
          return;
        }
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
      var kpr = document.getElementById('kiosqueroProvisionRequestModal');
      if (kpr) { kpr.classList.add('hidden'); kpr.classList.remove('flex'); }
      var kpc = document.getElementById('kiosqueroProvisionCompleteModal');
      if (kpc) { kpc.classList.add('hidden'); kpc.classList.remove('flex'); }
      var pal = document.getElementById('partnerAffiliateLinksModal');
      if (pal) { pal.classList.add('hidden'); pal.classList.remove('flex'); }
      var pti = document.getElementById('partnerTransferInfoModal');
      if (pti) { pti.classList.add('hidden'); pti.classList.remove('flex'); }
      var csrM = document.getElementById('clientSaleRequestModal');
      if (csrM) { csrM.classList.add('hidden'); csrM.classList.remove('flex'); }
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
      var notifHdr = document.getElementById('ferriolNotifHeaderWrap');
      if (notifHdr) {
        notifHdr.style.display = ferriolNotificationRecipientShell() ? '' : 'none';
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
      try {
        if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
      var provWrap = document.querySelector('.ferriol-partner-provision-btn-wrap');
      if (provWrap) provWrap.classList.toggle('hidden', !(isPartnerLens() && !isEmpresaLensSuper()));
      var clientSaleWrap = document.querySelector('.ferriol-partner-client-sale-wrap');
      if (clientSaleWrap) clientSaleWrap.classList.toggle('hidden', !(isPartnerLens() && !isEmpresaLensSuper()));
      var affWrap = document.querySelector('.ferriol-partner-affiliate-links-wrap');
      if (affWrap) affWrap.classList.toggle('hidden', !(isPartnerLens() && !isEmpresaLensSuper()));
      var ingNav = document.getElementById('navSuperIngresosBtn');
      if (ingNav) {
        if (!isNetworkAdmin || uiNegocio) {
          ingNav.style.display = 'none';
        } else {
          ingNav.style.display = '';
        }
      }
      updateSuperMasBankingShell();
    }

    function showPanel(name, cajaTabOverride) {
      if (name === 'super' && currentUser && currentUser.role === 'super' && state.superUiMode === 'negocio') {
        state.superUiMode = 'empresa';
        try { sessionStorage.setItem('ferriol_super_ui', 'empresa'); } catch (_) {}
        applyAppShell();
      }
      if (name === 'super' && currentUser && currentUser.role === 'partner' && state.superSection && state.superSection !== 'afiliados' && state.superSection !== 'ingresos' && state.superSection !== 'solicitudes' && state.superSection !== 'mas') {
        switchSuperSection('afiliados');
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
        var landSuper = state.superSection || 'afiliados';
        if (landSuper === 'balance') landSuper = 'ingresos';
        if (currentUser && currentUser.role === 'partner' && landSuper !== 'afiliados' && landSuper !== 'ingresos' && landSuper !== 'solicitudes' && landSuper !== 'mas') landSuper = 'afiliados';
        switchSuperSection(landSuper);
      } else {
        if (superListCountdownInterval) { clearInterval(superListCountdownInterval); superListCountdownInterval = null; }
        var navSuperBottom = document.getElementById('navSuperBottom');
        if (navSuperBottom) navSuperBottom.classList.add('hidden');
      }
      if (name === 'dashboard') {
        updateTrialCountdown();
        updateDashboard();
        if (ferriolKiosqueroNotifShell()) {
          loadTrialReminderConfigFromSupabase();
          if (currentUser) refreshViewerHelpWhatsApp(currentUser);
        }
        if (ferriolNotificationRecipientShell()) loadNotifications();
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
        if (ferriolKiosqueroNotifShell()) loadKioscoLicensePaymentInfo();
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
      var sn = sectionName || 'afiliados';
      if (sn === 'balance') sn = 'ingresos';
      state.superSection = sn;
      var reqSuper = state.superSection === 'cobros';
      if (reqSuper && currentUser && (currentUser.role !== 'super' || !isEmpresaLensSuper())) {
        state.superSection = 'afiliados';
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
      var navHighlight = state.superSection;
      if (navHighlight === 'ajustes') navHighlight = 'mas';
      document.querySelectorAll('.super-nav-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.superSection === navHighlight);
      });
      if (state.superSection === 'cobros' && isEmpresaLensSuper()) renderSuperCobrosSection();
      if (state.superSection === 'ingresos') void loadSuperIngresosSection();
      if (state.superSection === 'solicitudes') {
        void renderSuperMembershipDayRequestBanners();
        if (isEmpresaLensSuper()) loadSuperSolicitudesSection();
      }
      if (state.superSection === 'mas') {
        void loadSuperMasBankingSection();
      }
      lucide.createIcons();
    }
    function superMasScrollTo(elId) {
      var el = document.getElementById(elId);
      if (!el) return;
      try {
        el.scrollIntoView({ behavior: 'smooth', block: 'start' });
      } catch (_) {
        el.scrollIntoView(true);
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    var btnSuperMasOpenAjustes = document.getElementById('btnSuperMasOpenAjustes');
    if (btnSuperMasOpenAjustes) btnSuperMasOpenAjustes.addEventListener('click', function () { switchSuperSection('ajustes'); });
    var btnSuperMasScrollAviso = document.getElementById('btnSuperMasScrollAviso');
    if (btnSuperMasScrollAviso) btnSuperMasScrollAviso.addEventListener('click', function () { superMasScrollTo('superMasBlockAviso'); });
    var btnSuperMasScrollAdmin = document.getElementById('btnSuperMasScrollAdmin');
    if (btnSuperMasScrollAdmin) btnSuperMasScrollAdmin.addEventListener('click', function () { superMasScrollTo('superMasBlockAdmin'); });
    var btnSuperAjustesVolverMas = document.getElementById('btnSuperAjustesVolverMas');
    if (btnSuperAjustesVolverMas) btnSuperAjustesVolverMas.addEventListener('click', function () { switchSuperSection('mas'); });
    function openPartnerTransferInfoModal() {
      var m = document.getElementById('partnerTransferInfoModal');
      var ta = document.getElementById('partnerTransferInfoTextarea');
      var msg = document.getElementById('partnerTransferInfoMsg');
      if (msg) {
        msg.classList.add('hidden');
        msg.textContent = '';
        msg.classList.remove('text-red-300', 'text-emerald-300');
      }
      if (ta && currentUser) ta.value = currentUser.partnerTransferInfo != null ? String(currentUser.partnerTransferInfo) : '';
      if (m) {
        m.classList.remove('hidden');
        m.classList.add('flex');
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closePartnerTransferInfoModal() {
      var m = document.getElementById('partnerTransferInfoModal');
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
      }
    }
    var btnOpenPartnerTransferModal = document.getElementById('btnOpenPartnerTransferModal');
    if (btnOpenPartnerTransferModal) {
      btnOpenPartnerTransferModal.addEventListener('click', function () {
        if (currentUser && currentUser.role === 'partner') openPartnerTransferInfoModal();
      });
    }
    var partnerTransferInfoModalClose = document.getElementById('partnerTransferInfoModalClose');
    if (partnerTransferInfoModalClose) partnerTransferInfoModalClose.addEventListener('click', closePartnerTransferInfoModal);
    var partnerTransferInfoModalOverlay = document.getElementById('partnerTransferInfoModalOverlay');
    if (partnerTransferInfoModalOverlay) partnerTransferInfoModalOverlay.addEventListener('click', closePartnerTransferInfoModal);
    var partnerTransferInfoSave = document.getElementById('partnerTransferInfoSave');
    if (partnerTransferInfoSave) {
      partnerTransferInfoSave.addEventListener('click', async function () {
        var msg = document.getElementById('partnerTransferInfoMsg');
        var ta = document.getElementById('partnerTransferInfoTextarea');
        if (!supabaseClient || !currentUser || currentUser.role !== 'partner') {
          if (msg) {
            msg.textContent = 'Solo un administrador de red (socio) puede guardar esto.';
            msg.classList.remove('hidden', 'text-emerald-300');
            msg.classList.add('text-red-300');
          }
          return;
        }
        var val = ta ? String(ta.value) : '';
        if (msg) {
          msg.classList.add('hidden');
          msg.textContent = '';
        }
        var up = await supabaseClient.from('profiles').update({ partner_transfer_info: val }).eq('id', currentUser.id);
        if (up.error) {
          if (msg) {
            msg.textContent = 'No se pudo guardar. ¿Ejecutaste el SQL de partner_transfer_info y las políticas RLS? ' + (up.error.message || '');
            msg.classList.remove('hidden', 'text-emerald-300');
            msg.classList.add('text-red-300');
          }
          return;
        }
        currentUser.partnerTransferInfo = val;
        if (msg) {
          msg.textContent = 'Listo. Tus referidos lo verán en Caja.';
          msg.classList.remove('hidden', 'text-red-300');
          msg.classList.add('text-emerald-300');
        }
        await loadSuperMasBankingSection();
        closePartnerTransferInfoModal();
      });
    }
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

    (function initAddToCartQtyModal() {
      var ov = document.getElementById('addToCartQtyModalOverlay');
      var cancel = document.getElementById('addToCartQtyCancel');
      var confirmBtn = document.getElementById('addToCartQtyConfirm');
      var inp = document.getElementById('addToCartQtyInput');
      if (cancel) cancel.onclick = function () { closeAddToCartQtyModal(); };
      if (ov) ov.onclick = function () { closeAddToCartQtyModal(); };
      if (confirmBtn) confirmBtn.onclick = function () {
        var c = state._pendingAddToCartCodigo;
        if (!c) { closeAddToCartQtyModal(); return; }
        var q = parseInt(inp && inp.value, 10) || 1;
        addToCart(c, q);
        closeAddToCartQtyModal();
      };
      if (inp) inp.addEventListener('keydown', function (e) {
        if (e.key === 'Enter') { e.preventDefault(); if (confirmBtn) confirmBtn.click(); }
      });
    })();

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
        openAddToCartQtyModal(found.codigo);
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

   // --- Login / Logout ---
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
      window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
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
      if (state.superUiMode === 'socio') ferriolStartNotificationPolling();
      else ferriolStopNotificationPolling();
      goToPanel('super');
      if (ferriolNotificationRecipientShell()) loadNotifications();
      lucide.createIcons();
    } else if (isPartner) {
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = null;
      if (currentUser && currentUser.partnerLicensePending) {
        window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
        ferriolTickCountdowns();
      }
      ferriolStartNotificationPolling();
      goToPanel('super');
      loadNotifications();
      lucide.createIcons();
    } else {
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
      await loadTrialReminderConfigFromSupabase();
      await refreshViewerHelpWhatsApp(currentUser);
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
            await refreshViewerHelpWhatsApp(profile);
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          errEl.textContent = profile.role === 'kiosquero'
            ? 'Tu cuenta está desactivada. Contactá a tu referidor por WhatsApp para regularizar.'
            : 'Tu cuenta está desactivada. Contactá por WhatsApp a los números que configuró la empresa (fundadores).';
          errEl.classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks('Hola, mi cuenta de Ferriol OS está desactivada y quiero darme de alta.');
            wrap.classList.remove('hidden');
          }
          return;
        }
        const trialEndsAt = profile.trial_ends_at || null;
        if (profile.role === 'partner' && profile.partner_license_pending && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          var pendKitLogin = await supabaseClient.from('ferriol_partner_provision_requests').select('id').eq('registered_user_id', uid).eq('status', 'pending').maybeSingle();
          if (!pendKitLogin.error && pendKitLogin.data && pendKitLogin.data.id) {
            try {
              await supabaseClient.from('profiles').update({ active: false, partner_license_pending: false }).eq('id', uid);
            } catch (_) {}
            await supabaseClient.auth.signOut();
            document.getElementById('loginFormWrap').classList.remove('hidden');
            document.getElementById('signUpBox').classList.add('hidden');
            errEl.textContent = 'Pasó el plazo sin que Ferriol aprobara tu alta de distribuidor. Contactá a tu referidor o a la empresa.';
            errEl.classList.add('show');
            return;
          }
        }
        if (profile.role === 'kiosquero' && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          try {
            await supabaseClient.from('profiles').update({ active: false }).eq('id', uid);
            await refreshViewerHelpWhatsApp(profile);
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          errEl.textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá a tu referidor por WhatsApp para renovar.';
          errEl.classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks('Hola, mi período de prueba de Ferriol OS terminó y quiero renovar.');
            wrap.classList.remove('hidden');
          }
          return;
        }
        var userCreatedAt = (authData && authData.user && authData.user.created_at) ? authData.user.created_at : null;
        currentUser = { id: profile.id, email: profile.email, role: profile.role, active: profile.active, kioscoName: profile.kiosco_name || '', whatsappMessage: profile.whatsapp_message || DEFAULT_WHATSAPP, trialEndsAt: trialEndsAt, created_at: userCreatedAt, referralCode: profile.referral_code || '', sponsorId: profile.sponsor_id || null, partnerLicensePending: !!profile.partner_license_pending, partnerTransferInfo: profile.partner_transfer_info != null ? String(profile.partner_transfer_info) : '' };
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
      var termsParteI = '<p class="text-white/55 text-xs font-semibold uppercase tracking-wide mb-2">Parte I — Todos los usuarios</p>' +
        '<p><strong>1. ACEPTACIÓN.</strong> Al crear una cuenta en Ferriol OS (“el Servicio”) aceptás estos Términos y Condiciones y el Contrato de Servicio. Si no aceptás, no podés usar el Servicio.</p>' +
        '<p><strong>2. DESCRIPCIÓN DEL SERVICIO.</strong> Ferriol OS es un sistema de gestión para kioscos y comercios ofrecido “tal cual” (as is). No garantizamos disponibilidad ininterrumpida ni ausencia de errores.</p>' +
        '<p><strong>3. PÉRDIDA DE DATOS — EXENCIÓN DE RESPONSABILIDAD.</strong> Ferriol OS y sus titulares <strong>no se hacen responsables</strong> por ninguna pérdida, corrupción o indisponibilidad de datos (productos, ventas, deudores, configuraciones o cualquier otro dato cargado en el Servicio). El usuario es responsable de realizar copias de seguridad periódicas utilizando las herramientas que ofrece la aplicación. El Servicio no sustituye el respaldo propio de la información crítica del negocio.</p>' +
        '<p><strong>4. DATOS Y PROPIEDAD.</strong> Los datos que el usuario ingresa en el Servicio son de su negocio. Ferriol OS actúa como proveedor del software y de la plataforma. El usuario otorga a Ferriol OS la licencia necesaria para almacenar, procesar y mostrar dichos datos con el fin de prestar el Servicio. Ferriol OS no vende los datos personales o de negocio del usuario a terceros. Los datos generados o alojados en la plataforma están sujetos a la política de uso del Servicio y a la legislación aplicable.</p>' +
        '<p><strong>5. USO ACEPTABLE.</strong> El usuario se compromete a usar el Servicio de forma lícita. Queda prohibido usarlo para actividades ilegales, fraudulentas o que vulneren derechos de terceros. Ferriol OS se reserva el derecho de suspender o dar de baja cuentas que incumplan estos términos.</p>' +
        '<p><strong>6. LIMITACIÓN DE RESPONSABILIDAD.</strong> En la máxima medida permitida por la ley aplicable, Ferriol OS y sus titulares no serán responsables por daños indirectos, incidentales, especiales, consecuentes o punitivos (incluyendo pérdida de beneficios, datos, clientes o buena voluntad). La responsabilidad total no excederá el monto abonado por el usuario en los últimos 12 meses por el Servicio, o cero si el Servicio fue gratuito.</p>' +
        '<p><strong>7. EXENCIÓN DE GARANTÍAS.</strong> El Servicio se presta “tal cual” y “según disponibilidad”. No ofrecemos garantías de ningún tipo, expresas o implícitas (incluyendo comerciabilidad o idoneidad para un fin determinado).</p>' +
        '<p><strong>8. SUSCRIPCIÓN Y CANCELACIÓN.</strong> La suscripción o período de prueba pueden estar sujetos a condiciones adicionales. Ferriol OS puede modificar, suspender o discontinuar el Servicio o estas condiciones, notificando cuando sea razonable. El usuario puede cerrar su cuenta en cualquier momento.</p>' +
        '<p><strong>9. CUENTAS DE NEGOCIO (KIOSQUEROS) Y REFERIDOR O DISTRIBUIDOR EN MORA.</strong> Si tu cuenta es de <strong>negocio</strong> que usa el sistema en el local (kiosquero u similar), <strong>no perdés tu cuenta ni tus datos de gestión</strong> solo porque tu referidor o distribuidor deje de pagar su membresía u obligaciones frente a Ferriol OS. La empresa tomará conocimiento del incumplimiento y podrá: <strong>hacerse cargo</strong> de la relación comercial contigo, <strong>reasignarte</strong> otro distribuidor o administrador de red, y aplicar la política operativa vigente. En tu sesión de la aplicación podrán <strong>actualizarse</strong> los datos de referencia y las <strong>instrucciones de pago</strong> correspondientes al <strong>nuevo referidor o administrador</strong> asignado, para que sigas abonando la licencia con claridad. Esto no impide medidas por otras causas (fraude, impago tuyo propio, pedido judicial, etc.).</p>' +
        '<p><strong>10. JURISDICCIÓN.</strong> Estos términos se rigen por las leyes de la República Argentina. Cualquier controversia será sometida a los tribunales competentes en la República Argentina.</p>' +
        '<p><strong>11. CONTACTO.</strong> Para consultas sobre estos términos: contactar a Ferriol OS por los canales oficiales indicados en la aplicación.</p>';
      var termsParteIIDistribuidor = '<p class="text-white/55 text-xs font-semibold uppercase tracking-wide mt-5 mb-2 pt-4 border-t border-white/15">Parte II — Distribuidores / red comercial (membresía y comisiones)</p>' +
        '<p class="text-white/70 text-xs mb-3">La siguiente parte aplica si tu cuenta tiene rol de <strong>distribuidor, socio comercial o similar</strong> en la red Ferriol OS (incluye comercialización del sistema, referidos y plan de compensaciones). Los montos, plazos y porcentajes concretos se detallan en el <strong>plan de compensaciones</strong>, <strong>tabla de membresía</strong> y comunicaciones oficiales; estos términos describen el marco general.</p>' +
        '<p><strong>11. MEMBRESÍA, MORA, PAUSA Y BAJA DEL DISTRIBUIDOR.</strong> La membresía u otros cargos de la red son <strong>obligatorios</strong> mientras mantengas activo el rol de distribuidor. Si no abonás en término: (a) ingresás en <strong>mora</strong> y Ferriol OS queda notificada; (b) podrá colocarte en estado de <strong>pausa</strong> (cuenta de distribuidor limitada o suspendida para operar la red: sin nuevos referidos, sin cobro de comisiones pendientes de regularizar, u otras restricciones que defina la política); (c) podrá <strong>retener o congelar</strong> comisiones o créditos a tu favor hasta la regularización; (d) tras el <strong>plazo</strong> que indiquen el plan, el anexo tarifario o una notificación fehaciente, podrá darse por <strong>rescindida</strong> tu participación como distribuidor y darse de <strong>baja</strong> ese rol, <strong>sin perjuicio</strong> de montos adeudados. Luego de la baja, Ferriol OS podrá <strong>reasignar</strong> a los usuarios o afiliados que dependían de vos a <strong>otro distribuidor o a la empresa</strong>, conforme la política publicada.</p>' +
        '<p><strong>12. NEGOCIOS FINALES (KIOSQUEROS) — CONTINUIDAD Y DATOS DE PAGO.</strong> Las cuentas de negocio que usan el sistema en el local <strong>no se dan de baja</strong> automáticamente porque vos, como distribuidor, estés en mora o pausa (véase también la cláusula 9 de la Parte I). Ferriol OS podrá <strong>asumir</strong> la relación con ese negocio o <strong>reasignarle</strong> otro administrador o distribuidor. Una vez producida la reasignación, en la cuenta del kiosquero podrán mostrarse los <strong>datos de referencia y las instrucciones de pago</strong> del <strong>nuevo</strong> referidor o administrador (nombre, contacto y canal de pago que la plataforma y la política habiliten). Vos podés <strong>perder</strong> derecho a comisiones futuras, visibilidad de la línea y el estatus de patrocinador activo. Ferriol OS no está obligada a mantener beneficios comerciales a tu favor si no regularizás.</p>' +
        '<p><strong>13. VENTAS, COMISIONES Y LO QUE DEBÉS A LA EMPRESA.</strong> Sobre las ventas de membresías, kits, renovaciones u otros conceptos del plan, podés deber a Ferriol OS <strong>comisiones, fee, retenciones o ajustes</strong> según el plan aprobado. Si no transferís o no acreditás esos importes en plazo: (a) los montos siguen siendo <strong>exigibles</strong>; (b) Ferriol OS podrá <strong>compensar</strong> (saldo neto) con créditos o comisiones a tu favor que figuren en la plataforma; (c) podrá aplicar <strong>intereses moratorios, cargos administrativos o gastos de gestión de cobranza</strong> si así lo prevé el plan o un anexo tarifario; (d) podrá suspender pagos de comisiones hasta regularizar. La falta de pago <strong>no autoriza</strong> retener fondos de terceros que no te pertenezcan; las compensaciones se limitan a <strong>tu relación contractual</strong> con Ferriol OS.</p>' +
        '<p><strong>14. INTEGRIDAD, FRAUDE Y PENALIDADES.</strong> Está prohibido manipular precios, referidos ficticios, identidades falsas, lavado de operaciones o cualquier conducta que defraudare al sistema o a terceros. Las sanciones pueden incluir, según gravedad: <strong>apercibimiento</strong>; <strong>suspensión temporal</strong> del rol de distribuidor; <strong>baja definitiva</strong> del rol; <strong>descuento o reversión</strong> de comisiones obtenidas indebidamente; <strong>multa o penalidad económica</strong> prevista en el plan; e <strong>inhabilitación</strong> para volver a registrarte como distribuidor. Ferriol OS podrá dar intervención a asesoría legal o organismos competentes ante ilícitos.</p>' +
        '<p><strong>15. ACEPTACIÓN EXPRESA DE LA PARTE II.</strong> Al registrarte como distribuidor declarás haber leído la Parte II y el plan de compensaciones aplicable. Si no estás de acuerdo, no debés completar el alta con ese rol.</p>';
      function ferriolTermsHtmlInscribirseEsDistribuidor() {
        var wrapD = document.getElementById('signUpWrapDistribuidor');
        var visibleD = wrapD && !wrapD.classList.contains('hidden');
        var nichoSocio = false;
        try { nichoSocio = getSignupNichoFromStorage() === 'socio'; } catch (_) {}
        return visibleD || nichoSocio;
      }
      function ferriolBuildTermsHtml() {
        var footer = '<p class="text-white/60 text-xs mt-4">Última actualización: abril 2026. Ferriol OS. <span class="text-white/45">Revisión legal recomendada antes de publicar en producción.</span></p>';
        if (ferriolTermsHtmlInscribirseEsDistribuidor()) return termsParteI + termsParteIIDistribuidor + footer;
        return termsParteI + footer;
      }
      document.getElementById('openTermsModal').onclick = function () {
        document.getElementById('termsContent').innerHTML = ferriolBuildTermsHtml();
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
      const phone = document.getElementById('signUpPhone').value.trim();
      const errEl = document.getElementById('signUpErr');
      errEl.classList.remove('show');
      var signupNicho = getSelectedSignupNicho();
      var kioscoName = '';
      if (signupNicho === 'socio') {
        kioscoName = (document.getElementById('signUpNombreApellido') && document.getElementById('signUpNombreApellido').value.trim()) || '';
        if (!kioscoName) {
          errEl.textContent = 'Ingresá tu nombre y apellido.';
          errEl.classList.add('show');
          return;
        }
      } else {
        kioscoName = (document.getElementById('signUpKioscoName') && document.getElementById('signUpKioscoName').value.trim()) || '';
        if (!kioscoName) {
          errEl.textContent = 'Ingresá el nombre del negocio.';
          errEl.classList.add('show');
          return;
        }
      }
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
      var signupBlocked = await ferriolIsPublicSignupClosed();
      if (signupBlocked) {
        errEl.textContent = signupBlocked;
        errEl.classList.add('show');
        return;
      }
      var sp = { sponsorId: null, error: null };
      if (signupNicho === 'socio') {
        sp = await resolveSponsorForSignup();
        if (sp.error) {
          errEl.textContent = sp.error;
          errEl.classList.add('show');
          return;
        }
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
      if (newRole === 'partner' && newId) {
        try {
          var linkRpc = await supabaseClient.rpc('ferriol_link_partner_pending_kit', { p_profile_id: newId });
          if (linkRpc.error) console.warn('ferriol_link_partner_pending_kit:', linkRpc.error);
          else {
            var linkOut = linkRpc.data;
            if (typeof linkOut === 'string') { try { linkOut = JSON.parse(linkOut); } catch (_) {} }
            if (linkOut && linkOut.linked === true && linkOut.grace_hours != null) {
              window._ferriolLastSignupKitGraceHours = linkOut.grace_hours;
            }
          }
        } catch (e) { console.warn(e); }
      }
      try { sessionStorage.removeItem('ferriol_signup_ref'); sessionStorage.removeItem('ferriol_signup_nicho'); } catch (_) {}
      document.getElementById('signUpBox').classList.add('hidden');
      document.getElementById('signUpSuccessBox').classList.remove('hidden');
      window._lastSignUpEmail = email;
    };

    function doLogout() {
      if (window._trialCountdownInterval) { clearInterval(window._trialCountdownInterval); window._trialCountdownInterval = null; }
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
    function ferriolReloadAppForUpdate() {
      var reload = function () { window.location.reload(); };
      if (!('serviceWorker' in navigator)) {
        reload();
        return;
      }
      navigator.serviceWorker.getRegistration().then(function (reg) {
        if (reg) return reg.update();
      }).catch(function () {}).then(reload, reload);
    }
    var appReloadBtn = document.getElementById('appReloadBtn');
    if (appReloadBtn) appReloadBtn.onclick = function () { ferriolReloadAppForUpdate(); };

    document.getElementById('logoutBtn').onclick = doLogout;
    var logoutConfigEl = document.getElementById('logoutBtnConfig');
    if (logoutConfigEl) logoutConfigEl.onclick = doLogout;
    window._superIrModoNegocio = async function () {
      if (!currentUser || currentUser.role !== 'super') return;
      state.superUiMode = 'negocio';
      try { sessionStorage.setItem('ferriol_super_ui', 'negocio'); } catch (_) {}
      applyAppShell();
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
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
    /** WhatsApp mostrado al usuario en login / renovar: fundador (socios) o referidor (kioscos). */
    var viewerHelpWhatsApp = { list: [], note: '', sponsorEmail: '', sponsorName: '', sourceRole: '' };

    async function refreshViewerHelpWhatsApp(profile) {
      viewerHelpWhatsApp = { list: [], note: '', sponsorEmail: '', sponsorName: '', sourceRole: '' };
      if (!profile) return;
      var role = profile.role;
      viewerHelpWhatsApp.sourceRole = role || '';
      var sid = profile.sponsor_id != null ? profile.sponsor_id : profile.sponsorId;
      if (role === 'partner' || role === 'super') {
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
          viewerHelpWhatsApp.list = list;
        } catch (_) {}
        return;
      }
      if (role !== 'kiosquero') return;
      if (!supabaseClient || !sid) {
        viewerHelpWhatsApp.note = 'no_sponsor';
        return;
      }
      try {
        var sp = await supabaseClient.from('profiles').select('phone, email, kiosco_name').eq('id', sid).maybeSingle();
        if (sp.error || !sp.data) {
          viewerHelpWhatsApp.note = 'sponsor_not_found';
          return;
        }
        var d = sp.data;
        var digits = String(d.phone || '').replace(/\D/g, '');
        if (digits) {
          viewerHelpWhatsApp.list = [digits];
          return;
        }
        viewerHelpWhatsApp.note = 'sponsor_no_phone';
        viewerHelpWhatsApp.sponsorEmail = d.email || '';
        viewerHelpWhatsApp.sponsorName = (d.kiosco_name || '').trim() || '';
      } catch (_) {
        viewerHelpWhatsApp.note = 'error';
      }
    }

    function viewerHelpWhatsAppEmptyHtml() {
      var note = viewerHelpWhatsApp.note;
      var sr = viewerHelpWhatsApp.sourceRole;
      var isAdminRole = sr === 'partner' || sr === 'super';
      var nm = (viewerHelpWhatsApp.sponsorName || '').replace(/</g, '&lt;');
      if (note === 'sponsor_no_phone' && viewerHelpWhatsApp.sponsorEmail) {
        var rawMail = String(viewerHelpWhatsApp.sponsorEmail || '').trim();
        var mailHref = 'mailto:' + rawMail.replace(/"/g, '');
        return '<p class="text-white/65 text-sm mb-2">Tu referidor <strong class="text-white/80">' + (nm || '—') + '</strong> no cargó WhatsApp en el sistema.</p>' +
          '<a href="' + mailHref.replace(/"/g, '&quot;') + '" class="inline-flex items-center justify-center gap-2 w-full py-2.5 rounded-xl bg-white/15 hover:bg-white/20 text-white font-medium text-sm touch-target border border-white/20"><i data-lucide="mail" class="w-4 h-4"></i> Escribir por email</a>';
      }
      if (note === 'no_sponsor') {
        return '<p class="text-white/60 text-sm">No figura referidor en tu perfil. Contactá a quien te dio de alta en el sistema.</p>';
      }
      if (note === 'sponsor_not_found' || note === 'error') {
        return '<p class="text-white/60 text-sm">No se pudo obtener el contacto de tu referidor. Probá más tarde o escribí al soporte.</p>';
      }
      if (isAdminRole) {
        return '<p class="text-white/60 text-sm">La empresa aún no configuró números de WhatsApp para administradores.</p>';
      }
      return '<p class="text-white/60 text-sm">Tu referidor no cargó un número de WhatsApp en el sistema.</p>';
    }
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
      var list = viewerHelpWhatsApp.list && viewerHelpWhatsApp.list.length ? viewerHelpWhatsApp.list : [];
      var msg = 'Hola, necesito ayuda con mi cuenta de Ferriol OS.';
      if (list.length === 0) {
        container.innerHTML = viewerHelpWhatsAppEmptyHtml();
      } else {
        var sub = (viewerHelpWhatsApp.sourceRole === 'kiosquero') ? '<p class="text-[11px] text-white/45 mb-2">Contacto de tu referidor / patrocinador.</p>' : '<p class="text-[11px] text-white/45 mb-2">Contacto configurado por la empresa (fundadores).</p>';
        container.innerHTML = sub + list.map(function (num, i) {
          var label = list.length > 1 ? 'WhatsApp (' + (i + 1) + ')' : 'Escribir por WhatsApp';
          return '<a href="' + getWhatsAppUrl(num, msg) + '" target="_blank" rel="noopener" class="inline-flex items-center justify-center gap-2 w-full py-3 rounded-xl bg-green-600 hover:bg-green-500 text-white font-medium touch-target"><i data-lucide="message-circle" class="w-5 h-5"></i> ' + label + '</a>';
        }).join('');
      }
      lucide.createIcons();
    }
    function fillLoginContactLinks(message) {
      var container = document.getElementById('loginContactWhatsAppLinks');
      if (!container) return;
      var list = viewerHelpWhatsApp.list && viewerHelpWhatsApp.list.length ? viewerHelpWhatsApp.list : [];
      var msg = message || 'Hola, necesito ayuda con mi cuenta de Ferriol OS.';
      if (list.length === 0) {
        container.innerHTML = viewerHelpWhatsAppEmptyHtml();
      } else {
        container.innerHTML = list.map(function (num, i) {
          var label = list.length > 1 ? 'WhatsApp (' + (i + 1) + ')' : 'Escribir por WhatsApp';
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
    /** true solo si hay fecha de fin válida y ya pasó (no cuenta perfiles sin trial_ends_at). */
    function isProfileMembershipDateExpired(u) {
      var raw = u && u.trial_ends_at;
      if (!raw) return false;
      var end = new Date(raw);
      if (isNaN(end.getTime())) return false;
      return end.getTime() <= Date.now();
    }
    var superDetailCountdownInterval = null;
    var superListCountdownInterval = null;
    function updateSuperListCountdowns() {
      document.querySelectorAll('#panel-super .super-list-countdown').forEach(function (span) {
        var row = span.closest('.super-afiliado-row') || span.closest('.super-user-card');
        var endsAt = row && row.getAttribute('data-trial-ends-at');
        var t = trialLabelFull(endsAt);
        span.textContent = t.expired ? 'Vencida' : t.text;
        span.className = 'inv-item-price super-list-countdown ' + (t.expired ? 'text-red-300' : 'text-[#86efac]');
      });
    }
    function superAfiliadosFilterBySubTab(list) {
      var sub = state.afiliadosSubTab || 'usuarios';
      if (sub === 'distribuidores') return list.filter(function (u) { return u.role === 'partner'; });
      return list.filter(function (u) { return u.role === 'kiosquero'; });
    }
    function syncAfiliadosSubTabButtons() {
      var u = document.getElementById('superAfiliadosTabUsuarios');
      var d = document.getElementById('superAfiliadosTabDistribuidores');
      if (!u || !d) return;
      var isU = state.afiliadosSubTab !== 'distribuidores';
      u.setAttribute('aria-selected', isU ? 'true' : 'false');
      d.setAttribute('aria-selected', !isU ? 'true' : 'false');
      u.className = 'super-afiliados-tab flex-1 py-2.5 rounded-lg text-sm font-semibold touch-target border transition-all ' + (isU ? 'border-[#22c55e]/50 bg-[#22c55e]/20 text-white' : 'border-transparent text-white/55 hover:text-white/80');
      d.className = 'super-afiliados-tab flex-1 py-2.5 rounded-lg text-sm font-semibold touch-target border transition-all ' + (!isU ? 'border-[#22c55e]/50 bg-[#22c55e]/20 text-white' : 'border-transparent text-white/55 hover:text-white/80');
    }
    function buildSuperAfiliadoRowHtml(u) {
      var name = (u.kiosco_name || u.email || 'Sin nombre').replace(/</g, '&lt;');
      var trialFull = trialLabelFull(u.trial_ends_at);
      var badge = trialFull.expired ? 'Vencida' : trialFull.text;
      var endIso = (u.trial_ends_at || '').replace(/"/g, '&quot;');
      var email = (u.email || '').replace(/</g, '&lt;');
      var stockClass = u.active ? 'text-white/45' : 'text-red-400/90';
      var sinRef = (!u.sponsor_id && isEmpresaLensSuper()) ? '<span class="text-amber-200/80 text-[10px] font-normal"> · sin ref.</span>' : '';
      var priceClass = trialFull.expired ? 'text-red-300' : 'text-[#86efac]';
      return '<button type="button" class="inventory-item super-afiliado-row w-full text-left border-x-0 rounded-none" data-id="' + u.id + '" data-trial-ends-at="' + endIso + '">' +
        '<div class="inv-item-info">' +
        '<span class="inv-item-name"><span class="block truncate">' + name + sinRef + '</span></span>' +
        '<span class="inv-item-price super-list-countdown ' + priceClass + '">' + badge + '</span>' +
        '<span class="inv-item-stock ' + stockClass + ' max-w-[32vw] sm:max-w-[40%] truncate" title="' + email + '">' + email + '</span>' +
        '</div>' +
        '<i data-lucide="chevron-right" class="w-5 h-5 text-white/35 shrink-0"></i>' +
        '</button>';
    }
    function bindSuperAfiliadoRowClicks(listEl, list) {
      listEl.querySelectorAll('.super-afiliado-row').forEach(function (btn) {
        btn.onclick = function () {
          var id = btn.getAttribute('data-id');
          var user = list.find(function (u) { return u.id === id; });
          if (user) openSuperUserDetail(user);
        };
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
      var isFounderEmpresa = isEmpresaLensSuper();
      var isSocioLens = isPartnerLens();
      var assignHtml = '';
      if (isFounderEmpresa) {
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
      if (isFounderEmpresa && user.role === 'kiosquero' && user.sponsor_id && sponsorIsPartner) {
        defSaleHtml = `
        <div class="border-t border-white/10 pt-4 space-y-2">
          <p class="text-sm font-medium text-cyan-200/95 flex items-center gap-2"><i data-lucide="percent" class="w-4 h-4"></i> Venta licencia kiosco (alta definitiva)</p>
          <p class="text-xs text-white/55">Cuando el negocio ya pasó la prueba y cerraste la venta con el socio vendedor, registrá una vez la operación: <strong class="text-white/75">20% empresa</strong> y <strong class="text-white/75">80% vendedor</strong> sobre el valor mensual del plan (ver <code class="text-cyan-200/80">mlm_plan_config</code>). El socio verá el 20% como saldo a pagar a la empresa y el 80% como comisión pendiente.</p>
          <button type="button" class="super-detail-definitive-sale w-full py-2.5 rounded-xl text-sm bg-cyan-500/20 text-cyan-100 border border-cyan-400/45 touch-target font-medium">Registrar venta (20% / 80%)</button>
        </div>`;
      }
      var partnerNetworkControlHtml = '';
      if (isFounderEmpresa && user.role === 'partner') {
        var poolNet = window._ferriolAllProfilesCache || [];
        var directKios = poolNet.filter(function (p) { return p && p.sponsor_id === user.id && p.role === 'kiosquero'; });
        var directSoc = poolNet.filter(function (p) { return p && p.sponsor_id === user.id && p.role === 'partner'; });
        var optsBulk = ['<option value="">— Elegí el nuevo referidor / admin —</option>'];
        poolNet.filter(function (p) { return p && p.id !== user.id; }).slice().sort(function (a, b) {
          var ra = (a.role === 'super') ? 0 : (a.role === 'partner') ? 1 : 2;
          var rb = (b.role === 'super') ? 0 : (b.role === 'partner') ? 1 : 2;
          if (ra !== rb) return ra - rb;
          return (a.kiosco_name || a.email || '').localeCompare(b.kiosco_name || b.email || '');
        }).forEach(function (p) {
          var lab = '[' + (p.role || 'kiosquero') + '] ' + (p.kiosco_name || p.email || '').slice(0, 36) + (p.email ? (' · ' + p.email) : '');
          optsBulk.push('<option value="' + p.id + '">' + lab.replace(/</g, '&lt;') + '</option>');
        });
        partnerNetworkControlHtml = `
        <div class="border-t border-white/10 pt-4 space-y-3 super-partner-network-control">
          <p class="text-sm font-medium text-amber-200 flex items-center gap-2"><i data-lucide="git-branch" class="w-4 h-4"></i> Fundador — control de red y penalidades</p>
          <p class="text-xs text-white/55">Solo el perfil <strong class="text-amber-100/90">fundador</strong> (administrador raíz en vista empresa). Referidos <strong>directos</strong> de este socio: <strong class="text-white/80">${directKios.length}</strong> negocio(s) (kiosquero) y <strong class="text-white/80">${directSoc.length}</strong> socio(s). Los negocios <strong>no se borran</strong> al sancionar al socio: reasignalos a otro admin o a vos.</p>
          <label class="flex items-center gap-2 text-xs text-white/70 cursor-pointer touch-target py-1">
            <input type="checkbox" id="superBulkReassignIncludePartners" class="rounded border-white/30 bg-white/10 text-amber-500 shrink-0">
            <span>Incluir socios directos en la reasignación (además de kiosqueros)</span>
          </label>
          <select id="superBulkReassignSponsorSelect" class="w-full glass rounded-xl px-3 py-2.5 border border-white/20 text-white text-sm bg-black/20">${optsBulk.join('')}</select>
          <button type="button" class="super-detail-bulk-reassign w-full py-2.5 rounded-xl text-sm bg-amber-500/20 text-amber-100 border border-amber-400/45 touch-target font-medium">Reasignar toda la línea directa</button>
          <button type="button" class="super-detail-partner-penalty w-full py-2.5 rounded-xl text-sm bg-red-600/25 text-red-200 border border-red-500/50 touch-target font-medium ${user.active ? '' : 'opacity-50 pointer-events-none'}" ${user.active ? '' : 'disabled'}>Penalidad: desactivar acceso del socio</button>
          <p class="text-[10px] text-white/40">El socio inactivo no puede entrar a la app. Comisiones/libro: gestioná aparte según política. Evitá dejar kiosqueros sin referidor si querés que sigan pagando a alguien de la red.</p>
        </div>`;
      }
      var quitarHtml = isSocioLens ? '' : `
            <button type="button" class="super-detail-quitar w-full py-2.5 rounded-xl text-sm bg-red-500/20 text-red-300 border border-red-500/40 touch-target flex items-center justify-center gap-2">
              <i data-lucide="user-minus" class="w-4 h-4"></i> Quitar negocio (pide contraseña admin)
            </button>`;
      var founderActionsHtml = `
        <div class="border-t border-white/10 pt-4 space-y-3 super-detail-actions-founder">
          <p class="text-xs text-white/55 leading-relaxed">Los <strong class="text-[#86efac]/90">días de licencia</strong> (kiosco o socio) no se cargan a mano acá: solo desde la <strong class="text-white/75">cola de aprobaciones</strong> en Negocios, después de verificar el cobro y el pago a Ferriol.</p>
          <div class="flex items-center gap-2 flex-wrap">
            <span class="text-sm text-white/70">Activar/Desactivar:</span>
            <button type="button" class="super-detail-toggle toggle-switch ${user.active ? 'active' : ''}" title="${user.active ? 'Desactivar' : 'Activar'}"></button>
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
        </div>`;
      var socioKiosqueroActionsHtml = `
        <div class="border-t border-white/10 pt-4 space-y-3 super-detail-actions-socio-kiosquero">
          <p class="text-xs text-white/60 leading-relaxed">Los <strong class="text-white/75">administradores de red</strong> no modifican los días de membresía a mano: enviás una <strong class="text-[#86efac]/90">solicitud a la empresa</strong>. Cuando el cliente te paga (ej. licencia <strong class="text-white/75">$ ${FERRIOL_PLAN_AMOUNTS.kioscoMonthly.toLocaleString('es-AR')}</strong>), abonás el <strong class="text-white/75">20%</strong> a Ferriol, completás el formulario y la empresa <strong>aprueba</strong> la carga. Hasta entonces el contador del kiosco no cambia.</p>
          <div class="rounded-xl border border-emerald-500/35 bg-emerald-500/08 p-3 space-y-2">
            <p class="text-sm font-medium text-emerald-100/95">Solicitar suma de días</p>
            <div class="flex flex-wrap items-end gap-2">
              <label class="text-[10px] text-white/55 block w-full">Días a sumar</label>
              <input type="number" min="1" max="365" value="30" class="super-detail-req-add-days w-20 px-2 py-2 rounded-lg text-sm bg-white/10 border border-white/20 text-white touch-target">
            </div>
            <div>
              <label class="text-[10px] text-white/55">Monto cobrado al cliente (ARS)</label>
              <input type="number" min="1" step="1" class="super-detail-req-client-payment w-full glass rounded-lg px-3 py-2 border border-white/20 text-white text-sm" value="${FERRIOL_PLAN_AMOUNTS.kioscoMonthly}">
            </div>
            <p class="text-[10px] text-white/50">20% para la empresa: <strong class="text-cyan-200/90 super-detail-req-company-pct">—</strong> ARS (se guarda en la solicitud).</p>
            <div>
              <label class="text-[10px] text-white/55">Referencia del pago del 20% a empresa (opcional)</label>
              <input type="text" class="super-detail-req-company-note w-full glass rounded-lg px-3 py-2 border border-white/20 text-white text-sm" placeholder="Ej. transferencia, fecha, banco">
            </div>
            <button type="button" class="super-detail-req-submit-add w-full py-2.5 rounded-xl text-sm bg-green-500/25 text-green-200 border border-green-500/45 touch-target font-medium">Enviar solicitud de suma</button>
          </div>
          <div class="rounded-xl border border-red-500/35 bg-red-500/08 p-3 space-y-2">
            <p class="text-sm font-medium text-red-200/95">Solicitar quita de días</p>
            <p class="text-[10px] text-white/50">Si hubo un error u otra causa, indicá el motivo. La empresa debe aprobar antes de descontar.</p>
            <div class="flex flex-wrap items-end gap-2">
              <label class="text-[10px] text-white/55 block w-full">Días a quitar</label>
              <input type="number" min="1" max="365" value="1" class="super-detail-req-remove-days w-20 px-2 py-2 rounded-lg text-sm bg-white/10 border border-white/20 text-white touch-target">
            </div>
            <div>
              <label class="text-[10px] text-white/55">Motivo obligatorio</label>
              <textarea class="super-detail-req-remove-reason w-full glass rounded-lg px-3 py-2 border border-white/20 text-white text-sm min-h-[4rem]" placeholder="Explicá por qué deben descontarse días en este kiosco."></textarea>
            </div>
            <button type="button" class="super-detail-req-submit-remove w-full py-2.5 rounded-xl text-sm bg-red-600/25 text-red-200 border border-red-500/45 touch-target font-medium">Enviar solicitud de quita</button>
          </div>
          <div class="flex flex-col gap-2 pt-2">
            <button type="button" class="super-detail-reset w-full py-2.5 rounded-xl text-sm bg-amber-500/20 text-amber-300 border border-amber-500/40 touch-target flex items-center justify-center gap-2">
              <i data-lucide="key" class="w-4 h-4"></i> Enviar enlace para restablecer contraseña
            </button>
          </div>
        </div>`;
      var socioPartnerLicenseHtml = `
        <div class="border-t border-white/10 pt-4 space-y-3 super-detail-actions-socio-partner-license">
          <p class="text-xs text-white/60 leading-relaxed">Para la <strong class="text-violet-200/95">licencia de distribución</strong> de este socio: no sumás días a mano. Enviás solicitud a la empresa con el cobro y el <strong class="text-white/75">20%</strong> a Ferriol; cuando aprueben, se actualiza el vencimiento de su membresía.</p>
          <div class="rounded-xl border border-violet-500/35 bg-violet-500/08 p-3 space-y-2">
            <p class="text-sm font-medium text-violet-100/95">Solicitar suma de días (licencia socio)</p>
            <div class="flex flex-wrap items-end gap-2">
              <label class="text-[10px] text-white/55 block w-full">Días a sumar</label>
              <input type="number" min="1" max="365" value="30" class="super-detail-req-add-days w-20 px-2 py-2 rounded-lg text-sm bg-white/10 border border-white/20 text-white touch-target">
            </div>
            <div>
              <label class="text-[10px] text-white/55">Monto cobrado al socio / cuota (ARS)</label>
              <input type="number" min="1" step="1" class="super-detail-req-client-payment w-full glass rounded-lg px-3 py-2 border border-white/20 text-white text-sm" value="${FERRIOL_PLAN_AMOUNTS.vendorMonthly}">
            </div>
            <p class="text-[10px] text-white/50">20% para la empresa: <strong class="text-cyan-200/90 super-detail-req-company-pct">—</strong> ARS</p>
            <div>
              <label class="text-[10px] text-white/55">Referencia del pago del 20% a empresa (opcional)</label>
              <input type="text" class="super-detail-req-company-note w-full glass rounded-lg px-3 py-2 border border-white/20 text-white text-sm" placeholder="Ej. transferencia, fecha, banco">
            </div>
            <button type="button" class="super-detail-req-submit-add w-full py-2.5 rounded-xl text-sm bg-violet-500/25 text-violet-100 border border-violet-500/45 touch-target font-medium">Enviar solicitud de suma</button>
          </div>
          <div class="rounded-xl border border-red-500/35 bg-red-500/08 p-3 space-y-2">
            <p class="text-sm font-medium text-red-200/95">Solicitar quita de días (licencia socio)</p>
            <p class="text-[10px] text-white/50">Motivo obligatorio. La empresa debe aprobar.</p>
            <div class="flex flex-wrap items-end gap-2">
              <label class="text-[10px] text-white/55 block w-full">Días a quitar</label>
              <input type="number" min="1" max="365" value="1" class="super-detail-req-remove-days w-20 px-2 py-2 rounded-lg text-sm bg-white/10 border border-white/20 text-white touch-target">
            </div>
            <div>
              <label class="text-[10px] text-white/55">Motivo obligatorio</label>
              <textarea class="super-detail-req-remove-reason w-full glass rounded-lg px-3 py-2 border border-white/20 text-white text-sm min-h-[4rem]" placeholder="Motivo de la quita de días de licencia."></textarea>
            </div>
            <button type="button" class="super-detail-req-submit-remove w-full py-2.5 rounded-xl text-sm bg-red-600/25 text-red-200 border border-red-500/45 touch-target font-medium">Enviar solicitud de quita</button>
          </div>
          <div class="flex flex-col gap-2 pt-2">
            <button type="button" class="super-detail-reset w-full py-2.5 rounded-xl text-sm bg-amber-500/20 text-amber-300 border border-amber-500/40 touch-target flex items-center justify-center gap-2">
              <i data-lucide="key" class="w-4 h-4"></i> Enviar enlace para restablecer contraseña
            </button>
          </div>
        </div>`;
      var adminActionsHtml = '';
      if (isFounderEmpresa) {
        adminActionsHtml = founderActionsHtml;
      } else if (isSocioLens && user.role === 'kiosquero') {
        adminActionsHtml = socioKiosqueroActionsHtml;
      } else if (isSocioLens && user.role === 'partner') {
        adminActionsHtml = socioPartnerLicenseHtml;
      } else if (isSocioLens) {
        adminActionsHtml = socioKiosqueroActionsHtml;
      }
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
        ${partnerNetworkControlHtml}
        ${adminActionsHtml}
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
      var togglerEl = content.querySelector('.super-detail-toggle');
      if (togglerEl) {
        togglerEl.onclick = async function () {
          if (!supabaseClient) return;
          const newActive = !u.active;
          await supabaseClient.from('profiles').update({ active: newActive }).eq('id', u.id);
          u.active = newActive;
          openSuperUserDetail(u);
        };
      }
      var payInEl = content.querySelector('.super-detail-req-client-payment');
      var pctDispEl = content.querySelector('.super-detail-req-company-pct');
      function syncMdrCompanyShare() {
        if (!payInEl || !pctDispEl) return;
        var n = parseFloat(String(payInEl.value || '').replace(',', '.'), 10);
        if (isNaN(n) || n <= 0) { pctDispEl.textContent = '—'; return; }
        pctDispEl.textContent = String(Math.round(n * 0.2 * 100) / 100);
      }
      if (payInEl) {
        payInEl.addEventListener('input', syncMdrCompanyShare);
        payInEl.addEventListener('change', syncMdrCompanyShare);
        syncMdrCompanyShare();
      }
      var reqAddBtn = content.querySelector('.super-detail-req-submit-add');
      if (reqAddBtn) {
        reqAddBtn.onclick = async function () {
          if (!supabaseClient || !currentUser) return;
          var daysIn = content.querySelector('.super-detail-req-add-days');
          var days = Math.max(1, Math.min(365, parseInt(daysIn && daysIn.value ? daysIn.value : 30, 10) || 30));
          var pay = parseFloat(String((payInEl && payInEl.value) || '').replace(',', '.'), 10);
          if (isNaN(pay) || pay <= 0) { alert('Indicá el monto cobrado al cliente.'); return; }
          var share = Math.round(pay * 0.2 * 100) / 100;
          var noteEl = content.querySelector('.super-detail-req-company-note');
          var note = noteEl ? String(noteEl.value || '').trim() : '';
          if (!confirm('Se enviará la solicitud de +' + days + ' días. La empresa debe aprobarla antes de que cambie el contador del kiosco. ¿Continuar?')) return;
          var ins = await supabaseClient.from('ferriol_membership_day_requests').insert({
            requested_by: currentUser.id,
            kiosquero_user_id: u.id,
            days_delta: days,
            client_payment_ars: pay,
            company_share_ars: share,
            company_transfer_note: note || null,
            reason: null
          });
          if (ins.error) { alert('Error: ' + ins.error.message + '\n\nSi la tabla no existe, ejecutá supabase-ferriol-membership-day-requests.sql en Supabase.'); return; }
          alert('Solicitud enviada. Cuando la empresa la apruebe, el kiosquero verá los días actualizados.');
          renderSuper();
          document.getElementById('superUserDetailClose').click();
        };
      }
      var reqRemBtn = content.querySelector('.super-detail-req-submit-remove');
      if (reqRemBtn) {
        reqRemBtn.onclick = async function () {
          if (!supabaseClient || !currentUser) return;
          var dIn = content.querySelector('.super-detail-req-remove-days');
          var daysRm = Math.max(1, Math.min(365, parseInt(dIn && dIn.value ? dIn.value : 1, 10) || 1));
          var reasonEl = content.querySelector('.super-detail-req-remove-reason');
          var reason = reasonEl ? String(reasonEl.value || '').trim() : '';
          if (reason.length < 5) { alert('El motivo es obligatorio (mínimo 5 caracteres).'); return; }
          if (!confirm('Se enviará la solicitud de quitar ' + daysRm + ' días. La empresa debe aprobarla. ¿Continuar?')) return;
          var ins = await supabaseClient.from('ferriol_membership_day_requests').insert({
            requested_by: currentUser.id,
            kiosquero_user_id: u.id,
            days_delta: -daysRm,
            client_payment_ars: null,
            company_share_ars: null,
            company_transfer_note: null,
            reason: reason
          });
          if (ins.error) { alert('Error: ' + ins.error.message + '\n\nSi la tabla no existe, ejecutá supabase-ferriol-membership-day-requests.sql en Supabase.'); return; }
          alert('Solicitud de quita enviada.');
          renderSuper();
          document.getElementById('superUserDetailClose').click();
        };
      }
      var resetPwdBtn = content.querySelector('.super-detail-reset');
      if (resetPwdBtn) {
        resetPwdBtn.onclick = async function () {
          const email = u.email;
          if (!email) return;
          const { error } = await supabaseClient.auth.resetPasswordForEmail(email, { redirectTo: (typeof APP_URL !== 'undefined' && APP_URL) ? APP_URL : window.location.href });
          if (error) alert('Error: ' + error.message);
          else alert('Se envió un correo a ' + email + ' para restablecer la contraseña.');
        };
      }
      var emailHelpBtn = content.querySelector('.super-detail-email');
      if (emailHelpBtn) {
        emailHelpBtn.onclick = function () {
          const m = (SUPABASE_URL || '').match(/https:\/\/([^.]+)\.supabase\.co/);
          const projectRef = m ? m[1] : null;
          const supabaseAuthUrl = projectRef ? 'https://supabase.com/dashboard/project/' + projectRef + '/auth/users' : null;
          const msg = 'Para cambiar el email:\n\n1. Supabase → Authentication → Users\n2. Buscá: ' + u.email + '\n3. Edit → cambiá el email.\n\n¿Abrir Supabase?';
          if (supabaseAuthUrl && confirm(msg)) window.open(supabaseAuthUrl, '_blank');
          else alert(msg);
        };
      }
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
      var bulkReassignBtn = content.querySelector('.super-detail-bulk-reassign');
      if (bulkReassignBtn) {
        bulkReassignBtn.onclick = async function () {
          if (!supabaseClient) return;
          if (u.role !== 'partner') return;
          var sel = content.querySelector('#superBulkReassignSponsorSelect');
          var newSid = sel ? String(sel.value || '').trim() : '';
          if (!newSid) { alert('Elegí el nuevo referidor o administrador de la red.'); return; }
          if (newSid === u.id) { alert('El nuevo referidor no puede ser el mismo socio.'); return; }
          var incP = content.querySelector('#superBulkReassignIncludePartners');
          var poolNet = window._ferriolAllProfilesCache || [];
          var ids = [];
          poolNet.forEach(function (p) {
            if (!p || p.sponsor_id !== u.id) return;
            if (p.role === 'kiosquero') ids.push(p.id);
            if (incP && incP.checked && p.role === 'partner') ids.push(p.id);
          });
          if (ids.length === 0) {
            alert('No hay referidos directos para reasignar (revisá el tilde «Incluir socios» si correspondía).');
            return;
          }
          if (!confirm('Se reasignarán ' + ids.length + ' cuenta(s) al nuevo patrocinador. El socio actual conserva su usuario pero ya no figura como referidor de esas cuentas. ¿Continuar?')) return;
          var { error: errUp } = await supabaseClient.from('profiles').update({ sponsor_id: newSid }).in('id', ids);
          if (errUp) { alert('Error: ' + errUp.message); return; }
          ids.forEach(function (id) {
            var ix = (window._ferriolAllProfilesCache || []).findIndex(function (r) { return r.id === id; });
            if (ix >= 0) window._ferriolAllProfilesCache[ix].sponsor_id = newSid;
          });
          alert('Listo: ' + ids.length + ' cuenta(s) reasignadas.');
          renderSuper();
          openSuperUserDetail(u);
        };
      }
      var penaltyPartnerBtn = content.querySelector('.super-detail-partner-penalty');
      if (penaltyPartnerBtn && u.active) {
        penaltyPartnerBtn.onclick = async function () {
          if (!supabaseClient) return;
          if (!confirm('Penalidad por incumplimiento: ¿desactivar el acceso de este socio?\n\nNo podrá iniciar sesión. Los negocios referidos no se borran: antes o después usá «Reasignar toda la línea directa» si querés otro referidor.')) return;
          var { error: errPen } = await supabaseClient.from('profiles').update({ active: false }).eq('id', u.id);
          if (errPen) { alert('Error: ' + errPen.message); return; }
          u.active = false;
          var idxP = (window._ferriolAllProfilesCache || []).findIndex(function (r) { return r.id === u.id; });
          if (idxP >= 0) window._ferriolAllProfilesCache[idxP].active = false;
          alert('Socio desactivado (penalidad).');
          renderSuper();
          openSuperUserDetail(u);
        };
      }
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

    function openPartnerProvisionRequestModal() {
      var m = document.getElementById('partnerProvisionRequestModal');
      if (!m) return;
      var err = document.getElementById('partnerProvisionRequestErr');
      if (err) err.classList.add('hidden');
      m.classList.remove('hidden');
      m.classList.add('flex');
      var pay = document.getElementById('partnerProvisionClientPay');
      if (pay) pay.dispatchEvent(new Event('input', { bubbles: true }));
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closePartnerProvisionRequestModal() {
      var m = document.getElementById('partnerProvisionRequestModal');
      if (!m) return;
      m.classList.add('hidden');
      m.classList.remove('flex');
    }
    function openClientSaleRequestModal() {
      var m = document.getElementById('clientSaleRequestModal');
      if (!m) return;
      var err = document.getElementById('clientSaleRequestErr');
      if (err) { err.classList.add('hidden'); err.textContent = ''; }
      m.classList.remove('hidden');
      m.classList.add('flex');
      syncClientSaleVendorMonthVisibility();
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closeClientSaleRequestModal() {
      var m = document.getElementById('clientSaleRequestModal');
      if (!m) return;
      m.classList.add('hidden');
      m.classList.remove('flex');
    }
    function syncClientSaleVendorMonthVisibility() {
      var sel = document.getElementById('clientSalePaymentType');
      var w = document.getElementById('clientSaleVendorMonthWrap');
      if (!sel || !w) return;
      w.classList.toggle('hidden', sel.value !== 'vendor_mantenimiento');
    }
    function openPartnerProvisionCompleteModal(token, email) {
      var m = document.getElementById('partnerProvisionCompleteModal');
      if (!m) return;
      var tEl = document.getElementById('partnerProvisionCompleteToken');
      var eEl = document.getElementById('partnerProvisionCompleteEmail');
      var pEl = document.getElementById('partnerProvisionCompletePassword');
      var err = document.getElementById('partnerProvisionCompleteErr');
      if (tEl) tEl.value = token || '';
      if (eEl) eEl.value = email || '';
      if (pEl) pEl.value = '';
      if (err) err.classList.add('hidden');
      m.classList.remove('hidden');
      m.classList.add('flex');
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closePartnerProvisionCompleteModal() {
      var m = document.getElementById('partnerProvisionCompleteModal');
      if (!m) return;
      m.classList.add('hidden');
      m.classList.remove('flex');
    }

    function openKiosqueroProvisionRequestModal() {
      var m = document.getElementById('kiosqueroProvisionRequestModal');
      if (!m) return;
      var err = document.getElementById('kiosqueroProvisionRequestErr');
      if (err) { err.classList.add('hidden'); err.classList.remove('show'); }
      m.classList.remove('hidden');
      m.classList.add('flex');
      var pay = document.getElementById('kiosqueroProvisionClientPay');
      if (pay) pay.dispatchEvent(new Event('input', { bubbles: true }));
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closeKiosqueroProvisionRequestModal() {
      var m = document.getElementById('kiosqueroProvisionRequestModal');
      if (!m) return;
      m.classList.add('hidden');
      m.classList.remove('flex');
    }
    function openKiosqueroProvisionCompleteModal(token, email) {
      var m = document.getElementById('kiosqueroProvisionCompleteModal');
      if (!m) return;
      var tEl = document.getElementById('kiosqueroProvisionCompleteToken');
      var eEl = document.getElementById('kiosqueroProvisionCompleteEmail');
      var pEl = document.getElementById('kiosqueroProvisionCompletePassword');
      var err = document.getElementById('kiosqueroProvisionCompleteErr');
      if (tEl) tEl.value = token || '';
      if (eEl) eEl.value = email || '';
      if (pEl) pEl.value = '';
      if (err) { err.classList.add('hidden'); err.classList.remove('show'); }
      m.classList.remove('hidden');
      m.classList.add('flex');
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closeKiosqueroProvisionCompleteModal() {
      var m = document.getElementById('kiosqueroProvisionCompleteModal');
      if (!m) return;
      m.classList.add('hidden');
      m.classList.remove('flex');
    }

    async function renderSuperMembershipDayRequestBanners() {
      var founderBox = document.getElementById('superDayRequestsFounderBox');
      var partnerBox = document.getElementById('superDayRequestsPartnerBox');
      if (founderBox) {
        founderBox.classList.add('hidden');
        founderBox.innerHTML = '';
      }
      if (partnerBox) {
        partnerBox.classList.add('hidden');
        partnerBox.innerHTML = '';
      }
      if (!supabaseClient || !currentUser) return;
      try {
        if (isEmpresaLensSuper() && founderBox) {
          var r = await supabaseClient.from('ferriol_membership_day_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50);
          var rProv = await supabaseClient.from('ferriol_partner_provision_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50);
          var rKpr = await supabaseClient.from('ferriol_kiosquero_provision_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50);
          var dayErr = r.error;
          var provErr = rProv.error;
          var kprErr = rKpr.error;
          var rows = dayErr ? [] : (r.data || []);
          var provRows = provErr ? [] : (rProv.data || []);
          var kprRows = kprErr ? [] : (rKpr.data || []);
          founderBox.classList.remove('hidden');
          if (dayErr && provErr && kprErr) {
            founderBox.innerHTML = '<p class="text-xs text-amber-200/90 font-medium mb-1">Aprobaciones pendientes</p><p class="text-xs text-white/55">No se pudieron cargar las colas. Ejecutá los SQL: membresía, partner-provision, kiosquero-provision, mdr-partner-target. ' + String(dayErr.message || provErr.message || kprErr.message || '') + '</p>';
            lucide.createIcons();
            return;
          }
          if (rows.length === 0 && provRows.length === 0 && kprRows.length === 0) {
            founderBox.innerHTML = '<p class="text-xs text-amber-200/90 font-medium mb-1 flex items-center gap-2"><i data-lucide="inbox" class="w-4 h-4"></i> Aprobaciones (empresa)</p><p class="text-xs text-white/55">No hay pendientes: días de licencia, altas de socios ni altas de negocios (kioscos).</p>';
            lucide.createIcons();
            return;
          }
          var pool = window._ferriolAllProfilesCache || [];
          function nameOf(id) {
            var p = pool.find(function (x) { return x.id === id; });
            return p ? (p.kiosco_name || p.email || id) : id;
          }
          var html = '<p class="text-xs text-amber-200/90 font-medium mb-2 flex items-center gap-2"><i data-lucide="clipboard-list" class="w-4 h-4"></i> Pendientes de aprobación</p><p class="text-[10px] text-white/45 mb-2">Verificá el pago del <strong class="text-white/60">20%</strong> a Ferriol antes de aprobar.</p>';
          if (dayErr) {
            html += '<p class="text-[10px] text-red-300 mb-2">Días: error al cargar. ' + String(dayErr.message || '') + '</p>';
          } else if (rows.length > 0) {
            html += '<p class="text-[11px] font-medium text-amber-100/90 mb-1">Membresía · días</p><div class="space-y-2 max-h-[32vh] overflow-y-auto pr-1 mb-3">';
            rows.forEach(function (row) {
              var targProf = pool.find(function (x) { return x.id === row.kiosquero_user_id; });
              var kindLab = targProf && targProf.role === 'partner' ? '<span class="text-violet-300/90 text-[10px]">Socio · </span>' : '<span class="text-emerald-300/90 text-[10px]">Kiosco · </span>';
              var kname = kindLab + String(nameOf(row.kiosquero_user_id)).replace(/</g, '&lt;');
              var reqname = String(nameOf(row.requested_by)).replace(/</g, '&lt;');
              var sign = row.days_delta > 0 ? '+' : '';
              var payLine = row.days_delta > 0 && row.client_payment_ars != null ? '<p class="text-[10px] text-white/50">Cobro cliente ARS: ' + row.client_payment_ars + ' · 20% empresa: ' + (row.company_share_ars != null ? row.company_share_ars : '—') + '</p>' : '';
              var noteLine = row.company_transfer_note ? '<p class="text-[10px] text-cyan-100/80">Ref. pago empresa: ' + String(row.company_transfer_note).replace(/</g, '&lt;') + '</p>' : '';
              var reasonLine = row.reason ? '<p class="text-[10px] text-red-200/90">Motivo quita: ' + String(row.reason).replace(/</g, '&lt;') + '</p>' : '';
              html += '<div class="rounded-lg border border-white/15 bg-black/25 p-2 text-xs">' +
                '<p class="font-medium text-white/90">' + kname + ' <span class="text-white/50">←</span> ' + reqname + '</p>' +
                '<p class="text-amber-100/90">' + sign + row.days_delta + ' días</p>' + payLine + noteLine + reasonLine +
                '<div class="flex flex-wrap gap-2 mt-2">' +
                '<button type="button" class="ferriol-mdr-approve btn-glow rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target" data-id="' + row.id + '">Aprobar</button>' +
                '<button type="button" class="ferriol-mdr-reject rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target border border-red-400/50 bg-red-500/15 text-red-200" data-id="' + row.id + '">Rechazar</button>' +
                '</div></div>';
            });
            html += '</div>';
          }
          if (provErr) {
            html += '<p class="text-[10px] text-red-300 mb-2">Altas de administradores: error. ' + String(provErr.message || '') + '</p>';
          } else if (provRows.length > 0) {
            html += '<p class="text-[11px] font-medium text-violet-200/95 mb-1">Nuevo administrador de red (socio)</p><div class="space-y-2 max-h-[32vh] overflow-y-auto pr-1">';
            provRows.forEach(function (row) {
              var reqname = String(nameOf(row.requested_by)).replace(/</g, '&lt;');
              var em = String(row.target_email || '').replace(/</g, '&lt;');
              var dn = row.display_name ? String(row.display_name).replace(/</g, '&lt;') : '—';
              var payLine = row.client_payment_ars != null ? '<p class="text-[10px] text-white/50">Cobro socio ARS: ' + row.client_payment_ars + ' · 20% empresa: ' + (row.company_share_ars != null ? row.company_share_ars : '—') + '</p>' : '';
              var noteLine = row.company_transfer_note ? '<p class="text-[10px] text-cyan-100/80">Ref.: ' + String(row.company_transfer_note).replace(/</g, '&lt;') + '</p>' : '';
              html += '<div class="rounded-lg border border-violet-500/25 bg-violet-950/20 p-2 text-xs">' +
                '<p class="font-medium text-white/90">' + em + '</p><p class="text-[10px] text-white/55">Nombre: ' + dn + ' · Solicita: ' + reqname + '</p>' + payLine + noteLine +
                '<div class="flex flex-wrap gap-2 mt-2">' +
                '<button type="button" class="ferriol-ppr-approve btn-glow rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target" data-ppr-id="' + row.id + '">Aprobar alta</button>' +
                '<button type="button" class="ferriol-ppr-reject rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target border border-red-400/50 bg-red-500/15 text-red-200" data-ppr-id="' + row.id + '">Rechazar</button>' +
                '</div></div>';
            });
            html += '</div>';
          }
          if (kprErr) {
            html += '<p class="text-[10px] text-red-300 mb-2">Altas de negocios (kioscos): error. ' + String(kprErr.message || '') + '</p>';
          } else if (kprRows.length > 0) {
            html += '<p class="text-[11px] font-medium text-emerald-200/95 mb-1">Nuevo negocio (kiosco · gestión)</p><div class="space-y-2 max-h-[28vh] overflow-y-auto pr-1">';
            kprRows.forEach(function (row) {
              var reqname = String(nameOf(row.requested_by)).replace(/</g, '&lt;');
              var em = String(row.target_email || '').replace(/</g, '&lt;');
              var kn = String(row.kiosco_name || '').replace(/</g, '&lt;');
              var payLine = row.client_payment_ars != null ? '<p class="text-[10px] text-white/50">Cobro ARS: ' + row.client_payment_ars + ' · 20% empresa: ' + (row.company_share_ars != null ? row.company_share_ars : '—') + '</p>' : '';
              var noteLine = row.company_transfer_note ? '<p class="text-[10px] text-cyan-100/80">Ref.: ' + String(row.company_transfer_note).replace(/</g, '&lt;') + '</p>' : '';
              html += '<div class="rounded-lg border border-emerald-500/30 bg-emerald-950/15 p-2 text-xs">' +
                '<p class="font-medium text-white/90">' + kn + '</p><p class="text-[10px] text-white/55">' + em + ' · Solicita: ' + reqname + '</p>' + payLine + noteLine +
                '<div class="flex flex-wrap gap-2 mt-2">' +
                '<button type="button" class="ferriol-kpr-approve btn-glow rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target" data-kpr-id="' + row.id + '">Aprobar alta kiosco</button>' +
                '<button type="button" class="ferriol-kpr-reject rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target border border-red-400/50 bg-red-500/15 text-red-200" data-kpr-id="' + row.id + '">Rechazar</button>' +
                '</div></div>';
            });
            html += '</div>';
          }
          founderBox.innerHTML = html;
          founderBox.querySelectorAll('.ferriol-mdr-approve').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-id');
              if (!id || !confirm('¿Aprobar y aplicar los días de licencia en la cuenta (kiosco o socio)?')) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_membership_day_request', { p_request_id: id, p_approve: true, p_reject_note: null });
              if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo aprobar.'); return; }
              alert('Listo: los días ya figuran en la licencia.');
              renderSuper();
            };
          });
          founderBox.querySelectorAll('.ferriol-mdr-reject').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-id');
              if (!id) return;
              var note = prompt('Motivo del rechazo (opcional):');
              if (note === null) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_membership_day_request', { p_request_id: id, p_approve: false, p_reject_note: note || null });
              if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo rechazar.'); return; }
              renderSuper();
            };
          });
          founderBox.querySelectorAll('.ferriol-ppr-approve').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-ppr-id');
              if (!id || !confirm('¿Aprobar el alta de distribuidor? Verificá el 20 % a Ferriol. Si el socio ya creó cuenta, se acreditarán los días de licencia.')) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_partner_provision_request', { p_request_id: id, p_approve: true, p_reject_note: null });
              if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo aprobar.'); return; }
              if (out.action === 'approved_completed') {
                alert('Listo: el socio ya tenía cuenta. Licencia de distribuidor acreditada (' + (out.license_days != null ? out.license_days + ' días' : 'revisá app_settings.partner_distribution_license_days') + ').');
              } else {
                alert('Alta aprobada. Si el socio aún no se registró, el referidor verá el botón para definir la contraseña.');
              }
              renderSuper();
            };
          });
          founderBox.querySelectorAll('.ferriol-ppr-reject').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-ppr-id');
              if (!id) return;
              var note = prompt('Motivo del rechazo (opcional):');
              if (note === null) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_partner_provision_request', { p_request_id: id, p_approve: false, p_reject_note: note || null });
              if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo rechazar.'); return; }
              renderSuper();
            };
          });
          founderBox.querySelectorAll('.ferriol-kpr-approve').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-kpr-id');
              if (!id || !confirm('¿Aprobar el alta del negocio? El referidor podrá definir la contraseña del kiosco.')) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_kiosquero_provision_request', { p_request_id: id, p_approve: true, p_reject_note: null });
              if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo aprobar.'); return; }
              alert('Alta de kiosco aprobada.');
              renderSuper();
            };
          });
          founderBox.querySelectorAll('.ferriol-kpr-reject').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-kpr-id');
              if (!id) return;
              var note = prompt('Motivo del rechazo (opcional):');
              if (note === null) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_kiosquero_provision_request', { p_request_id: id, p_approve: false, p_reject_note: note || null });
              if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo rechazar.'); return; }
              renderSuper();
            };
          });
          lucide.createIcons();
        }
        if (isPartnerLens() && !isEmpresaLensSuper() && partnerBox) {
          var r2 = await supabaseClient.from('ferriol_membership_day_requests').select('*').eq('requested_by', currentUser.id).order('created_at', { ascending: false }).limit(20);
          var r2p = await supabaseClient.from('ferriol_partner_provision_requests').select('*').eq('requested_by', currentUser.id).order('created_at', { ascending: false }).limit(25);
          var r2k = await supabaseClient.from('ferriol_kiosquero_provision_requests').select('*').eq('requested_by', currentUser.id).order('created_at', { ascending: false }).limit(25);
          partnerBox.classList.remove('hidden');
          var pool2 = window._ferriolAllProfilesCache || [];
          function nameOf2(id) {
            var p = pool2.find(function (x) { return x.id === id; });
            return p ? (p.kiosco_name || p.email || '') : '';
          }
          var h2 = '';
          if (r2.error) {
            h2 += '<p class="text-xs text-cyan-100/90 font-medium mb-1">Solicitudes de días</p><p class="text-[10px] text-red-300/90 mb-3">' + String(r2.error.message || '') + '</p>';
          } else {
            var rows2 = r2.data || [];
            h2 += '<p class="text-xs text-cyan-100/90 font-medium mb-2">Solicitudes de días (kioscos y socios en tu red)</p>';
            if (rows2.length === 0) {
              h2 += '<p class="text-[10px] text-white/50 mb-3">Desde el detalle de cada integrante pedí suma o quita; Ferriol aprueba antes de aplicar.</p>';
            } else {
              h2 += '<div class="space-y-1.5 max-h-[22vh] overflow-y-auto text-[11px] mb-3">';
              rows2.forEach(function (row) {
                var st = row.status === 'pending' ? 'text-amber-200' : row.status === 'approved' ? 'text-emerald-200' : 'text-red-200/80';
                var kn = String(nameOf2(row.kiosquero_user_id)).replace(/</g, '&lt;');
                var dt = row.created_at ? String(row.created_at).slice(0, 10) : '';
                h2 += '<div class="rounded-lg border border-white/10 bg-black/20 px-2 py-1.5"><span class="' + st + '">' + row.status + '</span> · ' + kn + ' · ' + (row.days_delta > 0 ? '+' : '') + row.days_delta + ' d · ' + dt + '</div>';
              });
              h2 += '</div>';
            }
          }
          if (r2p.error) {
            h2 += '<p class="text-xs text-violet-200/90 font-medium mb-1">Altas de administradores</p><p class="text-[10px] text-red-300/90">' + String(r2p.error.message || '') + '</p>';
          } else {
            var prow = r2p.data || [];
            h2 += '<p class="text-xs text-violet-200/90 font-medium mb-2">Altas de administradores de red</p>';
            if (prow.length === 0) {
              h2 += '<p class="text-[10px] text-white/50">Sin solicitudes. Usá el botón violeta arriba; la empresa debe aprobar antes de crear el usuario.</p>';
            } else {
              h2 += '<div class="space-y-1.5 max-h-[22vh] overflow-y-auto text-[11px]">';
              prow.forEach(function (pr) {
                var st = pr.status === 'pending' ? 'text-amber-200' : pr.status === 'approved' ? 'text-emerald-200' : pr.status === 'completed' ? 'text-white/55' : 'text-red-200/80';
                var em = String(pr.target_email || '').replace(/</g, '&lt;');
                var dt = pr.created_at ? String(pr.created_at).slice(0, 10) : '';
                var btnC = '';
                if (pr.status === 'approved' && pr.completion_token) {
                  btnC = '<button type="button" class="ferriol-ppr-complete mt-1 w-full btn-glow rounded-lg py-1.5 text-[10px] font-semibold touch-target" data-token="' + String(pr.completion_token) + '" data-email-enc="' + encodeURIComponent(pr.target_email || '') + '">Definir contraseña y crear cuenta</button>';
                }
                h2 += '<div class="rounded-lg border border-violet-500/25 bg-black/20 px-2 py-1.5"><span class="' + st + '">' + pr.status + '</span> · ' + em + ' · ' + dt + btnC + '</div>';
              });
              h2 += '</div>';
            }
          }
          if (r2k.error) {
            h2 += '<p class="text-xs text-emerald-200/90 font-medium mb-1 mt-2">Altas de negocios (kioscos)</p><p class="text-[10px] text-red-300/90">' + String(r2k.error.message || '') + '</p>';
          } else {
            var krows = r2k.data || [];
            h2 += '<p class="text-xs text-emerald-200/90 font-medium mb-2 mt-2">Altas de negocios (kioscos)</p>';
            if (krows.length === 0) {
              h2 += '<p class="text-[10px] text-white/50">Usá el botón verde «Solicitar alta de negocio»; la empresa debe aprobar antes de crear el usuario.</p>';
            } else {
              h2 += '<div class="space-y-1.5 max-h-[22vh] overflow-y-auto text-[11px]">';
              krows.forEach(function (kr) {
                var st = kr.status === 'pending' ? 'text-amber-200' : kr.status === 'approved' ? 'text-emerald-200' : kr.status === 'completed' ? 'text-white/55' : 'text-red-200/80';
                var em = String(kr.target_email || '').replace(/</g, '&lt;');
                var kn = String(kr.kiosco_name || '').replace(/</g, '&lt;');
                var dt = kr.created_at ? String(kr.created_at).slice(0, 10) : '';
                var btnK = '';
                if (kr.status === 'approved' && kr.completion_token) {
                  btnK = '<button type="button" class="ferriol-kpr-complete mt-1 w-full btn-glow rounded-lg py-1.5 text-[10px] font-semibold touch-target" data-token="' + String(kr.completion_token) + '" data-email-enc="' + encodeURIComponent(kr.target_email || '') + '">Definir contraseña del kiosco</button>';
                }
                h2 += '<div class="rounded-lg border border-emerald-500/25 bg-black/20 px-2 py-1.5"><span class="' + st + '">' + kr.status + '</span> · ' + kn + ' · ' + em + ' · ' + dt + btnK + '</div>';
              });
              h2 += '</div>';
            }
          }
          partnerBox.innerHTML = h2;
          partnerBox.querySelectorAll('.ferriol-ppr-complete').forEach(function (btn) {
            btn.onclick = function () {
              var tok = btn.getAttribute('data-token');
              var enc = btn.getAttribute('data-email-enc') || '';
              var em = '';
              try { em = decodeURIComponent(enc); } catch (_) { em = ''; }
              openPartnerProvisionCompleteModal(tok, em);
            };
          });
          partnerBox.querySelectorAll('.ferriol-kpr-complete').forEach(function (btn) {
            btn.onclick = function () {
              var tok = btn.getAttribute('data-token');
              var enc = btn.getAttribute('data-email-enc') || '';
              var em = '';
              try { em = decodeURIComponent(enc); } catch (_) { em = ''; }
              openKiosqueroProvisionCompleteModal(tok, em);
            };
          });
        }
      } catch (_) {
        if (founderBox && isEmpresaLensSuper()) {
          founderBox.classList.remove('hidden');
          founderBox.innerHTML = '<p class="text-xs text-white/60">Aprobaciones: error al cargar.</p>';
        }
      }
    }

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
        if (isEmpresaLensSuper()) {
          try {
            var pl = await supabaseClient.from('mlm_plan_config').select('value').eq('key', 'compensation_v1').maybeSingle();
            var pv = (pl.data && pl.data.value) || {};
            if (typeof pv === 'string') { try { pv = JSON.parse(pv); } catch (_) { pv = {}; } }
            var im = parseInt(pv.partner_intro_months, 10);
            var pIntro = pv.sale_vendor_pct_intro != null ? Number(pv.sale_vendor_pct_intro) * 100 : 80;
            var pNorm = pv.sale_vendor_pct_normal != null ? Number(pv.sale_vendor_pct_normal) * 100 : (pv.sale_vendor_pct != null ? Number(pv.sale_vendor_pct) * 100 : 50);
            var elM = document.getElementById('adminPartnerIntroMonths');
            var elI = document.getElementById('adminPartnerPctIntro');
            var elN = document.getElementById('adminPartnerPctNormal');
            if (elM) elM.value = (!isNaN(im) && im >= 0) ? String(Math.min(36, im)) : '1';
            if (elI) elI.value = String(Math.min(100, Math.max(0, Math.round(pIntro * 10) / 10)));
            if (elN) elN.value = String(Math.min(100, Math.max(0, Math.round(pNorm * 10) / 10)));
            var li = document.getElementById('adminCompanyPctIntroLabel');
            var ln = document.getElementById('adminCompanyPctNormalLabel');
            if (elI && li) {
              var vi = Math.min(100, Math.max(0, parseFloat(String(elI.value).replace(',', '.'), 10) || 0));
              li.textContent = String(Math.round((100 - vi) * 10) / 10);
            }
            if (elN && ln) {
              var vn = Math.min(100, Math.max(0, parseFloat(String(elN.value).replace(',', '.'), 10) || 0));
              ln.textContent = String(Math.round((100 - vn) * 10) / 10);
            }
          } catch (_) {}
        }
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
      else if (superFilterState === 'vencida') list = list.filter(function (u) { return isProfileMembershipDateExpired(u); });
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
      syncAfiliadosSubTabButtons();
      var displayList = superAfiliadosFilterBySubTab(list);
      const listEl = document.getElementById('superUsersList');
      if (errProfiles) {
        listEl.innerHTML = '<p class="py-4 text-center text-red-300 text-sm">Error al cargar. Revisá las políticas RLS de la tabla profiles.</p>';
        lucide.createIcons();
        return;
      }
      if (displayList.length === 0 && (isEmpresaLensSuper() || isPartnerLens())) {
        var msg;
        if (list.length === 0) {
          msg = searchTerm ? 'Ningún perfil coincide con la búsqueda.' : (isPartnerLens() ? (superFilterState === 'vencida' ? 'Nadie en tu red tiene la fecha de membresía vencida con estos filtros.' : 'No hay afiliados en tu red todavía.') : (superFilterState === 'sin_referidor' ? 'No hay integrantes sin referidor. Todo el mundo tiene admin/referidor asignado.' : superFilterState === 'activos' ? 'No hay perfiles activos con estos filtros.' : superFilterState === 'inactivos' ? 'No hay perfiles inactivos con estos filtros.' : superFilterState === 'vencida' ? 'No hay perfiles con membresía vencida (fecha de fin ya pasada) con estos filtros.' : 'No hay otros perfiles. Agregá uno con los botones de arriba.'));
        } else {
          msg = searchTerm ? 'Ningún ' + (state.afiliadosSubTab === 'distribuidores' ? 'distribuidor' : 'usuario (kiosco)') + ' coincide con la búsqueda.' : (state.afiliadosSubTab === 'distribuidores' ? 'No hay distribuidores en esta vista. Probá la pestaña Usuarios o relajá los filtros.' : 'No hay usuarios (kioscos) en esta vista. Probá Distribuidores o relajá los filtros.');
        }
        listEl.innerHTML = '<p class="py-6 text-center text-white/70 text-sm px-2">' + msg + '</p>';
        lucide.createIcons();
        await renderSuperMembershipDayRequestBanners();
        return;
      }
      listEl.innerHTML = displayList.map(function (u) { return buildSuperAfiliadoRowHtml(u); }).join('');
      bindSuperAfiliadoRowClicks(listEl, displayList);
      if (isPartnerLens() && supabaseClient && currentUser && !currentUser.referralCode) {
        ensureUserReferralCode(currentUser.id).then(function (cc) { if (cc) currentUser.referralCode = cc; });
      }
      await renderSuperMembershipDayRequestBanners();
      if (state.superSection === 'solicitudes' && isEmpresaLensSuper()) loadSuperSolicitudesSection();
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
      else if (superFilterState === 'vencida') list = list.filter(function (u) { return isProfileMembershipDateExpired(u); });
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
      syncAfiliadosSubTabButtons();
      var displayList = superAfiliadosFilterBySubTab(list);
      if (displayList.length === 0) {
        var msgEmpty = list.length === 0 ? 'Ningún perfil coincide con la búsqueda o filtros.' : ('No hay ' + (state.afiliadosSubTab === 'distribuidores' ? 'distribuidores' : 'usuarios (kioscos)') + ' que coincidan.');
        listEl.innerHTML = '<p class="py-6 text-center text-white/70 text-sm px-2">' + msgEmpty + '</p>';
        lucide.createIcons();
        return;
      }
      listEl.innerHTML = displayList.map(function (u) { return buildSuperAfiliadoRowHtml(u); }).join('');
      bindSuperAfiliadoRowClicks(listEl, displayList);
      lucide.createIcons();
    }
    var superSearchInput = document.getElementById('superSearchEmail');
    if (superSearchInput) superSearchInput.addEventListener('input', renderSuperListFromSearch);
    if (superSearchInput) superSearchInput.addEventListener('search', renderSuperListFromSearch);
    var superAfiliadosTabU = document.getElementById('superAfiliadosTabUsuarios');
    var superAfiliadosTabD = document.getElementById('superAfiliadosTabDistribuidores');
    if (superAfiliadosTabU) superAfiliadosTabU.addEventListener('click', function () {
      state.afiliadosSubTab = 'usuarios';
      syncAfiliadosSubTabButtons();
      if (superUserListCache.length) renderSuperListFromSearch();
      else if (state.currentPanel === 'super') renderSuper();
    });
    if (superAfiliadosTabD) superAfiliadosTabD.addEventListener('click', function () {
      state.afiliadosSubTab = 'distribuidores';
      syncAfiliadosSubTabButtons();
      if (superUserListCache.length) renderSuperListFromSearch();
      else if (state.currentPanel === 'super') renderSuper();
    });
    var ingresosRangeFilter = document.getElementById('ingresosRangeFilter');
    if (ingresosRangeFilter) {
      ingresosRangeFilter.addEventListener('change', function () {
        if (state.superSection === 'ingresos') loadSuperIngresosSection();
      });
    }
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
        if (isEmpresaLensSuper()) {
          var pl = await supabaseClient.from('mlm_plan_config').select('value').eq('key', 'compensation_v1').maybeSingle();
          var base = (pl.data && pl.data.value) || {};
          if (typeof base === 'string') { try { base = JSON.parse(base); } catch (_) { base = {}; } }
          var imEl = document.getElementById('adminPartnerIntroMonths');
          var pIntroEl = document.getElementById('adminPartnerPctIntro');
          var pNormEl = document.getElementById('adminPartnerPctNormal');
          var im = Math.min(36, Math.max(0, parseInt(imEl && imEl.value, 10) || 0));
          var pin = Math.min(100, Math.max(0, parseFloat(String((pIntroEl && pIntroEl.value) || '80').replace(',', '.'), 10) || 0));
          var pno = Math.min(100, Math.max(0, parseFloat(String((pNormEl && pNormEl.value) || '50').replace(',', '.'), 10) || 0));
          var vInt = pin / 100;
          var cInt = (100 - pin) / 100;
          var vNorm = pno / 100;
          var cNorm = (100 - pno) / 100;
          var merged = Object.assign({}, base, {
            partner_intro_months: im,
            sale_vendor_pct_intro: vInt,
            sale_company_pct_intro: cInt,
            sale_vendor_pct_normal: vNorm,
            sale_company_pct_normal: cNorm,
            sale_vendor_pct: vNorm,
            sale_company_pct: cNorm
          });
          var upP = await supabaseClient.from('mlm_plan_config').upsert({ key: 'compensation_v1', value: merged, updated_at: new Date().toISOString() }, { onConflict: 'key' });
          if (upP.error) throw upP.error;
        }
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
    (function setupAdminPartnerPctLabels() {
      function upd(inpId, labelId) {
        var inp = document.getElementById(inpId);
        var lab = document.getElementById(labelId);
        if (!inp || !lab) return;
        var v = Math.min(100, Math.max(0, parseFloat(String(inp.value || '0').replace(',', '.'), 10) || 0));
        lab.textContent = String(Math.round((100 - v) * 10) / 10);
      }
      var i1 = document.getElementById('adminPartnerPctIntro');
      var i2 = document.getElementById('adminPartnerPctNormal');
      if (i1) { i1.addEventListener('input', function () { upd('adminPartnerPctIntro', 'adminCompanyPctIntroLabel'); }); i1.addEventListener('change', function () { upd('adminPartnerPctIntro', 'adminCompanyPctIntroLabel'); }); }
      if (i2) { i2.addEventListener('input', function () { upd('adminPartnerPctNormal', 'adminCompanyPctNormalLabel'); }); i2.addEventListener('change', function () { upd('adminPartnerPctNormal', 'adminCompanyPctNormalLabel'); }); }
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
          var visual = active ? 'border-[#dc2626]/50 bg-[#dc2626]/30' : (b.dataset.filter === 'sin_referidor' ? 'border-amber-500/40 glass' : b.dataset.filter === 'vencida' ? 'border-red-500/40 glass' : 'border-white/20 glass');
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
        if (_ferriolNotifFetchBaselineDone && newRows.length > 0 && ferriolNotificationRecipientShell()) {
          ferriolPlayNotificationChime();
        }
        _ferriolNotifFetchBaselineDone = true;
        renderNotificationsMerged();
      } catch (_) {}
    }
    var sendNotificationBtnEl = document.getElementById('sendNotificationBtn');
    if (sendNotificationBtnEl) sendNotificationBtnEl.onclick = async function () {
      var textarea = document.getElementById('adminNotificationMessage');
      var msgEl = document.getElementById('adminNotificationMsg');
      var msg = (textarea && textarea.value) ? textarea.value.trim() : '';
      if (!msg) { if (msgEl) { msgEl.textContent = 'Escribí un mensaje.'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-amber-300'; } return; }
      if (!supabaseClient || !isEmpresaLensSuper()) return;
      try {
        var err = (await supabaseClient.from('notifications').insert({ message: msg })).error;
        if (err) throw err;
        if (textarea) textarea.value = '';
        if (msgEl) { msgEl.textContent = 'Enviado: lo verán los kiosqueros y los administradores de red en la campana.'; msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-green-300'; setTimeout(function () { msgEl.classList.add('hidden'); }, 4000); }
      } catch (e) {
        if (msgEl) { msgEl.textContent = 'Error: ' + (e.message || 'Creá la tabla notifications en Supabase (ver comentarios en el código).'); msgEl.classList.remove('hidden'); msgEl.className = 'text-xs mt-2 text-red-300'; }
      }
      lucide.createIcons();
    };

    var btnOpenKiosqueroProv = document.getElementById('btnOpenNewKiosqueroModal');
    if (btnOpenKiosqueroProv) btnOpenKiosqueroProv.onclick = function () { openKiosqueroProvisionRequestModal(); };
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
        alert('Listo. Filas nuevas: ' + n + '. Revisá Cobros (admin). Los kiosqueros ven la licencia en Caja.');
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
    var kprReqClose = document.getElementById('kiosqueroProvisionRequestModalClose');
    if (kprReqClose) kprReqClose.onclick = closeKiosqueroProvisionRequestModal;
    var kprReqOv = document.getElementById('kiosqueroProvisionRequestModalOverlay');
    if (kprReqOv) kprReqOv.onclick = closeKiosqueroProvisionRequestModal;
    var kprPayEl = document.getElementById('kiosqueroProvisionClientPay');
    var kprPctEl = document.getElementById('kiosqueroProvisionCompanyPct');
    function syncKiosqueroProvisionPct() {
      if (!kprPayEl || !kprPctEl) return;
      var n = parseFloat(String(kprPayEl.value || '').replace(',', '.'), 10);
      if (isNaN(n) || n <= 0) { kprPctEl.textContent = '—'; return; }
      kprPctEl.textContent = String(Math.round(n * 0.2 * 100) / 100);
    }
    if (kprPayEl) {
      kprPayEl.addEventListener('input', syncKiosqueroProvisionPct);
      kprPayEl.addEventListener('change', syncKiosqueroProvisionPct);
    }
    var kprSubmitBtn = document.getElementById('kiosqueroProvisionSubmitRequest');
    if (kprSubmitBtn) kprSubmitBtn.onclick = async function () {
      var errBox = document.getElementById('kiosqueroProvisionRequestErr');
      if (errBox) { errBox.classList.add('hidden'); errBox.classList.remove('show'); }
      if (!supabaseClient || !currentUser) return;
      if (!isPartnerLens() && !isEmpresaLensSuper()) return;
      var email = (document.getElementById('kiosqueroProvisionEmail') && document.getElementById('kiosqueroProvisionEmail').value || '').trim().toLowerCase();
      var kname = (document.getElementById('kiosqueroProvisionKioscoName') && document.getElementById('kiosqueroProvisionKioscoName').value || '').trim();
      var phone = (document.getElementById('kiosqueroProvisionPhone') && document.getElementById('kiosqueroProvisionPhone').value || '').trim();
      var pay = parseFloat(String((kprPayEl && kprPayEl.value) || '').replace(',', '.'), 10);
      var note = (document.getElementById('kiosqueroProvisionCompanyNote') && document.getElementById('kiosqueroProvisionCompanyNote').value || '').trim();
      if (!email || email.indexOf('@') < 1) {
        if (errBox) { errBox.textContent = 'Email válido obligatorio.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      if (!kname) {
        if (errBox) { errBox.textContent = 'Nombre del negocio obligatorio.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      if (isNaN(pay) || pay <= 0) {
        if (errBox) { errBox.textContent = 'Indicá el monto cobrado al cliente / negocio.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var ex = await ferriolResolveProfileIdByEmail(email);
      if (ex) {
        if (errBox) { errBox.textContent = 'Ya existe una cuenta con ese email.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      if (email === String(currentUser.email || '').toLowerCase()) {
        if (errBox) { errBox.textContent = 'No podés usar tu propio email como negocio.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var share = Math.round(pay * 0.2 * 100) / 100;
      if (!confirm('Se enviará la solicitud de alta del negocio a la empresa. Hasta la aprobación no podés crear el usuario. ¿Continuar?')) return;
      var ins = await supabaseClient.from('ferriol_kiosquero_provision_requests').insert({
        requested_by: currentUser.id,
        target_email: email,
        kiosco_name: kname,
        phone: phone || null,
        client_payment_ars: pay,
        company_share_ars: share,
        company_transfer_note: note || null
      });
      if (ins.error) {
        if (errBox) {
          errBox.textContent = ins.error.message + (String(ins.error.message || '').indexOf('ferriol_kiosquero') !== -1 ? '' : ' · Ejecutá supabase-ferriol-kiosquero-provision-requests.sql');
          errBox.classList.remove('hidden');
          errBox.classList.add('show');
        }
        return;
      }
      closeKiosqueroProvisionRequestModal();
      alert('Solicitud enviada. Cuando Ferriol apruebe, aparecerá el botón para definir la contraseña del kiosco.');
      renderSuper();
    };
    var kprCompClose = document.getElementById('kiosqueroProvisionCompleteModalClose');
    if (kprCompClose) kprCompClose.onclick = closeKiosqueroProvisionCompleteModal;
    var kprCompOv = document.getElementById('kiosqueroProvisionCompleteModalOverlay');
    if (kprCompOv) kprCompOv.onclick = closeKiosqueroProvisionCompleteModal;
    var kprCompSubmit = document.getElementById('kiosqueroProvisionCompleteSubmit');
    if (kprCompSubmit) kprCompSubmit.onclick = async function () {
      var errBox = document.getElementById('kiosqueroProvisionCompleteErr');
      if (errBox) { errBox.classList.add('hidden'); errBox.classList.remove('show'); }
      if (!supabaseClient) return;
      var tokenStr = (document.getElementById('kiosqueroProvisionCompleteToken') && document.getElementById('kiosqueroProvisionCompleteToken').value || '').trim();
      var email = (document.getElementById('kiosqueroProvisionCompleteEmail') && document.getElementById('kiosqueroProvisionCompleteEmail').value || '').trim().toLowerCase();
      var password = (document.getElementById('kiosqueroProvisionCompletePassword') && document.getElementById('kiosqueroProvisionCompletePassword').value || '');
      if (!tokenStr || !email || !password || password.length < 6) {
        if (errBox) { errBox.textContent = 'Completá email, token y contraseña (mín. 6).'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var tokenUuid = tokenStr;
      var signUpRes = await supabaseClient.auth.signUp({ email: email, password: password });
      if (signUpRes.error) {
        if (errBox) { errBox.textContent = signUpRes.error.message || 'Error al registrar'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var newId = signUpRes.data && signUpRes.data.user && signUpRes.data.user.id;
      if (!newId) {
        if (errBox) {
          errBox.textContent = 'Registro recibido. Si tu proyecto pide confirmar el email, abrí el enlace y luego iniciá sesión una vez; después reintentá o pedí ayuda a la empresa.';
          errBox.classList.remove('hidden');
          errBox.classList.add('show');
        }
        return;
      }
      var rpc = await supabaseClient.rpc('ferriol_finalize_kiosquero_provision', { p_token: tokenUuid, p_new_profile_id: newId });
      if (rpc.error) {
        if (errBox) { errBox.textContent = rpc.error.message; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var out = rpc.data;
      if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
      if (!out || out.ok !== true) {
        if (errBox) { errBox.textContent = (out && out.error) ? out.error : 'No se pudo activar el kiosco.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      closeKiosqueroProvisionCompleteModal();
      alert('Listo: el negocio ya puede iniciar sesión como kiosquero.');
      renderSuper();
    };

    var btnOpenAff = document.getElementById('btnOpenPartnerAffiliateLinks');
    if (btnOpenAff) btnOpenAff.onclick = function () { openPartnerAffiliateLinksModal(); };
    var btnAffClose = document.getElementById('partnerAffiliateLinksModalClose');
    if (btnAffClose) btnAffClose.onclick = closePartnerAffiliateLinksModal;
    var btnAffDone = document.getElementById('partnerAffiliateLinksModalDone');
    if (btnAffDone) btnAffDone.onclick = closePartnerAffiliateLinksModal;
    var btnAffOv = document.getElementById('partnerAffiliateLinksModalOverlay');
    if (btnAffOv) btnAffOv.onclick = closePartnerAffiliateLinksModal;
    var btnOpenClientSale = document.getElementById('btnOpenClientSaleRequestModal');
    if (btnOpenClientSale) btnOpenClientSale.onclick = function () { openClientSaleRequestModal(); };
    var clientSaleClose = document.getElementById('clientSaleRequestModalClose');
    if (clientSaleClose) clientSaleClose.onclick = closeClientSaleRequestModal;
    var clientSaleOv = document.getElementById('clientSaleRequestModalOverlay');
    if (clientSaleOv) clientSaleOv.onclick = closeClientSaleRequestModal;
    var clientSaleType = document.getElementById('clientSalePaymentType');
    if (clientSaleType) clientSaleType.addEventListener('change', syncClientSaleVendorMonthVisibility);
    var clientSaleSubmit = document.getElementById('clientSaleRequestSubmit');
    if (clientSaleSubmit) {
      clientSaleSubmit.onclick = async function () {
        var err = document.getElementById('clientSaleRequestErr');
        if (err) { err.classList.add('hidden'); err.textContent = ''; }
        if (!supabaseClient || !currentUser) return;
        if (!isPartnerLens() || isEmpresaLensSuper()) return;
        var nm = (document.getElementById('clientSaleClientName') && document.getElementById('clientSaleClientName').value || '').trim();
        var email = (document.getElementById('clientSaleClientEmail') && document.getElementById('clientSaleClientEmail').value || '').trim().toLowerCase();
        var ptype = (document.getElementById('clientSalePaymentType') && document.getElementById('clientSalePaymentType').value) || 'kiosco_licencia';
        var amt = parseFloat(String((document.getElementById('clientSaleAmount') && document.getElementById('clientSaleAmount').value) || '').replace(/\./g, '').replace(',', '.'), 10);
        var fileIn = document.getElementById('clientSaleComprobante');
        var file = fileIn && fileIn.files && fileIn.files[0];
        if (!nm || nm.length < 2) {
          if (err) { err.textContent = 'Completá el nombre del cliente.'; err.classList.remove('hidden'); }
          return;
        }
        if (!email || email.indexOf('@') < 1) {
          if (err) { err.textContent = 'Email válido obligatorio.'; err.classList.remove('hidden'); }
          return;
        }
        if (isNaN(amt) || amt <= 0) {
          if (err) { err.textContent = 'Indicá el monto en ARS.'; err.classList.remove('hidden'); }
          return;
        }
        if (!file) {
          if (err) { err.textContent = 'Adjuntá la imagen del comprobante.'; err.classList.remove('hidden'); }
          return;
        }
        if (file.size > 5 * 1024 * 1024) {
          if (err) { err.textContent = 'La imagen supera 5 MB. Elegí un archivo más liviano.'; err.classList.remove('hidden'); }
          return;
        }
        var payerId = await ferriolResolveProfileIdByEmail(email);
        if (!payerId) {
          if (err) { err.textContent = 'No hay usuario con ese email. El cliente debe registrarse en Ferriol primero (mismo email).'; err.classList.remove('hidden'); }
          return;
        }
        var periodMonth = null;
        if (ptype === 'vendor_mantenimiento') {
          var mval = (document.getElementById('clientSaleVendorMonth') && document.getElementById('clientSaleVendorMonth').value) || '';
          periodMonth = ferriolMonthInputToPeriodDate(mval);
          if (!periodMonth) {
            if (err) { err.textContent = 'Elegí el mes de la cuota (mantenimiento vendedor).'; err.classList.remove('hidden'); }
            return;
          }
        }
        var reqId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now()) + '-csr';
        var ext = (file.name && file.name.lastIndexOf('.') > 0) ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '.jpg';
        if (ext.length > 6) ext = '.jpg';
        var path = currentUser.id + '/' + reqId + '/comprobante' + ext;
        var up = await supabaseClient.storage.from('comprobantes-ferriol').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
        if (up.error) {
          if (err) { err.textContent = 'No se pudo subir el archivo. ¿Ejecutaste el SQL del bucket? ' + (up.error.message || ''); err.classList.remove('hidden'); }
          return;
        }
        var ins = await supabaseClient.from('ferriol_client_sale_requests').insert({
          id: reqId,
          partner_id: currentUser.id,
          client_name: nm,
          client_email: email,
          comprobante_path: path,
          amount_ars: amt,
          payment_type: ptype,
          period_month: periodMonth
        });
        if (ins.error) {
          try { await supabaseClient.storage.from('comprobantes-ferriol').remove([path]); } catch (_) {}
          if (err) { err.textContent = ins.error.message + ' · Revisá supabase-ferriol-client-sale-requests.sql'; err.classList.remove('hidden'); }
          return;
        }
        closeClientSaleRequestModal();
        if (fileIn) fileIn.value = '';
        alert('Enviado. La empresa lo revisa en Solicitudes. Cuando apruebe, verás la comisión en Ingresos.');
      };
    }
    var btnOpenProv = document.getElementById('btnOpenPartnerProvisionModal');
    if (btnOpenProv) btnOpenProv.onclick = function () { openPartnerProvisionRequestModal(); };
    var provReqClose = document.getElementById('partnerProvisionRequestModalClose');
    if (provReqClose) provReqClose.onclick = closePartnerProvisionRequestModal;
    var provReqOv = document.getElementById('partnerProvisionRequestModalOverlay');
    if (provReqOv) provReqOv.onclick = closePartnerProvisionRequestModal;
    var provPayEl = document.getElementById('partnerProvisionClientPay');
    var provPctEl = document.getElementById('partnerProvisionCompanyPct');
    function syncPartnerProvisionPct() {
      if (!provPayEl || !provPctEl) return;
      var n = parseFloat(String(provPayEl.value || '').replace(',', '.'), 10);
      if (isNaN(n) || n <= 0) { provPctEl.textContent = '—'; return; }
      provPctEl.textContent = String(Math.round(n * 0.2 * 100) / 100);
    }
    if (provPayEl) {
      provPayEl.addEventListener('input', syncPartnerProvisionPct);
      provPayEl.addEventListener('change', syncPartnerProvisionPct);
    }
    var provSubmitBtn = document.getElementById('partnerProvisionSubmitRequest');
    if (provSubmitBtn) provSubmitBtn.onclick = async function () {
      var errBox = document.getElementById('partnerProvisionRequestErr');
      if (errBox) { errBox.classList.add('hidden'); errBox.classList.remove('show'); }
      if (!supabaseClient || !currentUser) return;
      if (!isPartnerLens() || isEmpresaLensSuper()) return;
      var email = (document.getElementById('partnerProvisionEmail') && document.getElementById('partnerProvisionEmail').value || '').trim().toLowerCase();
      var dname = (document.getElementById('partnerProvisionDisplayName') && document.getElementById('partnerProvisionDisplayName').value || '').trim();
      var phone = (document.getElementById('partnerProvisionPhone') && document.getElementById('partnerProvisionPhone').value || '').trim();
      var pay = parseFloat(String((provPayEl && provPayEl.value) || '').replace(',', '.'), 10);
      var note = (document.getElementById('partnerProvisionCompanyNote') && document.getElementById('partnerProvisionCompanyNote').value || '').trim();
      if (!email || email.indexOf('@') < 1) {
        if (errBox) { errBox.textContent = 'Email válido obligatorio.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      if (!dname) {
        if (errBox) { errBox.textContent = 'Nombre para mostrar obligatorio.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      if (isNaN(pay) || pay <= 0) {
        if (errBox) { errBox.textContent = 'Indicá el monto cobrado al nuevo socio.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var ex = await ferriolResolveProfileIdByEmail(email);
      if (ex) {
        if (errBox) { errBox.textContent = 'Ya existe una cuenta con ese email.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      if (email === String(currentUser.email || '').toLowerCase()) {
        if (errBox) { errBox.textContent = 'No podés usar tu propio email.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var share = Math.round(pay * 0.2 * 100) / 100;
      if (!confirm('Se enviará la solicitud de alta a la empresa. Hasta la aprobación no podés crear el usuario. ¿Continuar?')) return;
      var ins = await supabaseClient.from('ferriol_partner_provision_requests').insert({
        requested_by: currentUser.id,
        target_email: email,
        display_name: dname,
        phone: phone || null,
        client_payment_ars: pay,
        company_share_ars: share,
        company_transfer_note: note || null
      });
      if (ins.error) {
        if (errBox) {
          errBox.textContent = ins.error.message + (String(ins.error.message || '').indexOf('ferriol_partner') !== -1 ? '' : ' · Ejecutá supabase-ferriol-partner-provision-requests.sql');
          errBox.classList.remove('hidden');
          errBox.classList.add('show');
        }
        return;
      }
      closePartnerProvisionRequestModal();
      alert('Solicitud enviada. Cuando Ferriol apruebe, aparecerá el botón para definir la contraseña del nuevo socio.');
      renderSuper();
    };
    var provCompClose = document.getElementById('partnerProvisionCompleteModalClose');
    if (provCompClose) provCompClose.onclick = closePartnerProvisionCompleteModal;
    var provCompOv = document.getElementById('partnerProvisionCompleteModalOverlay');
    if (provCompOv) provCompOv.onclick = closePartnerProvisionCompleteModal;
    var provCompSubmit = document.getElementById('partnerProvisionCompleteSubmit');
    if (provCompSubmit) provCompSubmit.onclick = async function () {
      var errBox = document.getElementById('partnerProvisionCompleteErr');
      if (errBox) { errBox.classList.add('hidden'); errBox.classList.remove('show'); }
      if (!supabaseClient) return;
      var tokenStr = (document.getElementById('partnerProvisionCompleteToken') && document.getElementById('partnerProvisionCompleteToken').value || '').trim();
      var email = (document.getElementById('partnerProvisionCompleteEmail') && document.getElementById('partnerProvisionCompleteEmail').value || '').trim().toLowerCase();
      var password = (document.getElementById('partnerProvisionCompletePassword') && document.getElementById('partnerProvisionCompletePassword').value || '');
      if (!tokenStr || !email || !password || password.length < 6) {
        if (errBox) { errBox.textContent = 'Completá email, token y contraseña (mín. 6).'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var tokenUuid = tokenStr;
      var signUpRes = await supabaseClient.auth.signUp({ email: email, password: password });
      if (signUpRes.error) {
        if (errBox) { errBox.textContent = signUpRes.error.message || 'Error al registrar'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var newId = signUpRes.data && signUpRes.data.user && signUpRes.data.user.id;
      if (!newId) {
        if (errBox) {
          errBox.textContent = 'Registro recibido. Si tu proyecto pide confirmar el email, abrí el enlace y luego iniciá sesión una vez; después reintentá «Definir contraseña» o pedí ayuda a la empresa.';
          errBox.classList.remove('hidden');
          errBox.classList.add('show');
        }
        return;
      }
      var rpc = await supabaseClient.rpc('ferriol_finalize_partner_provision', { p_token: tokenUuid, p_new_profile_id: newId });
      if (rpc.error) {
        if (errBox) { errBox.textContent = rpc.error.message; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      var out = rpc.data;
      if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
      if (!out || out.ok !== true) {
        if (errBox) { errBox.textContent = (out && out.error) ? out.error : 'No se pudo activar el socio.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
        return;
      }
      closePartnerProvisionCompleteModal();
      alert('Listo: el nuevo administrador de red ya puede iniciar sesión como socio.');
      renderSuper();
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
            await refreshViewerHelpWhatsApp(profile);
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('loginErr').textContent = profile.role === 'kiosquero'
            ? 'Tu cuenta está desactivada. Contactá a tu referidor por WhatsApp para regularizar.'
            : 'Tu cuenta está desactivada. Contactá por WhatsApp a los números que configuró la empresa (fundadores).';
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
        if (profile.role === 'partner' && profile.partner_license_pending && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          var pendKit2 = await supabaseClient.from('ferriol_partner_provision_requests').select('id').eq('registered_user_id', uid).eq('status', 'pending').maybeSingle();
          if (!pendKit2.error && pendKit2.data && pendKit2.data.id) {
            try {
              await supabaseClient.from('profiles').update({ active: false, partner_license_pending: false }).eq('id', uid);
            } catch (_) {}
            await supabaseClient.auth.signOut();
            document.getElementById('loginFormWrap').classList.remove('hidden');
            document.getElementById('loginErr').textContent = 'Pasó el plazo sin que Ferriol aprobara tu alta de distribuidor. Contactá a tu referidor o a la empresa.';
            document.getElementById('loginErr').classList.add('show');
            document.getElementById('appWrap').classList.add('hidden');
            document.getElementById('loginScreen').classList.remove('hidden');
            return;
          }
        }
        if (profile.role === 'kiosquero' && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          try {
            await supabaseClient.from('profiles').update({ active: false }).eq('id', profile.id);
            await refreshViewerHelpWhatsApp(profile);
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('loginErr').textContent = 'Tu período de prueba terminó. La cuenta se desactivó. Contactá a tu referidor por WhatsApp para renovar.';
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
        currentUser = { id: profile.id, email: profile.email, role: profile.role, active: profile.active, kioscoName: profile.kiosco_name || '', whatsappMessage: profile.whatsapp_message || DEFAULT_WHATSAPP, trialEndsAt: trialEndsAt, created_at: userCreatedAt, referralCode: profile.referral_code || '', sponsorId: profile.sponsor_id || null, partnerLicensePending: !!profile.partner_license_pending, partnerTransferInfo: profile.partner_transfer_info != null ? String(profile.partner_transfer_info) : '' };
        await showApp();
      } catch (e) {
        console.error('Error en init:', e);
      }
    })();
