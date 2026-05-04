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
    // Si el kiosquero no ve datos del referidor por RLS: ejecutá supabase-ferriol-kiosquero-sponsor-display.sql (función ferriol_get_my_sponsor_display).
    // Notificaciones globales: las inserta solo role super (RLS: supabase-ferriol-notifications-rls.sql). Las leen kiosqueros y socios en la campana.
    // CREATE TABLE notifications ( id uuid PRIMARY KEY DEFAULT gen_random_uuid(), created_at timestamptz DEFAULT now(), message text NOT NULL );
    // ALTER TABLE notifications ENABLE ROW LEVEL SECURITY; políticas SELECT según tu proyecto + INSERT solo super en el SQL anterior.
    // Recordatorios de fin de prueba (mensajes por día + ventana): guardá en app_settings una fila key = 'trial_reminder_config', value = JSON, ej. {"windowDays":5,"messages":{"5":"...","4":"..."}}. Placeholders en textos: {dias}, {dias_restantes}, {nombre}, {negocio}.
    // Red de referidos: solo role 'partner' o 'super' tienen código y enlaces (kiosquero no refiere). SQL: supabase-referral-network.sql, supabase-mlm-foundation.sql, supabase-ferriol-payments.sql (cobros + RPC ferriol_verify_payment). Solicitudes de días (socio → empresa): supabase-ferriol-membership-day-requests.sql. Tabla ferriol_partner_provision_requests (SQL supabase-ferriol-partner-provision-requests.sql) puede seguir usándose desde panel fundador o flujos legacy; el alta vía formulario en Más fue retirado (altas por enlace de afiliación). Objeto FerriolMlm en este archivo.
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

    /** URL estable para registrarse (?ref=&nicho=). Nunca debe terminar en / después de .html — GitHub Pages da 404. */
    function ferriolNormalizeSignupEntryUrl(raw) {
      try {
        var s = String(raw || '').trim();
        if (!s) return '';
        s = s.split('#')[0].split('?')[0];
        var u = null;
        try {
          u = new URL(s);
        } catch (e1) {
          try {
            u = new URL(s, typeof window !== 'undefined' && window.location.href ? window.location.href : undefined);
          } catch (e2) {
            return '';
          }
        }
        var pathname = (u.pathname || '/').replace(/\/+$/, '');
        if (/kiosco\.html$/i.test(pathname)) {
          return u.origin + pathname;
        }
        /** Raíz del sitio sin archivo (p. ej. …/nombre-repo/) → entrada real kiosco.html */
        var withFile = pathname + '/kiosco.html';
        return u.origin + withFile;
      } catch (_) {
        return '';
      }
    }

    function ferriolPublicSignupBaseUrl() {
      try {
        if (typeof APP_URL !== 'undefined' && APP_URL && String(APP_URL).indexOf('TU-USUARIO') === -1) {
          return ferriolNormalizeSignupEntryUrl(APP_URL);
        }
      } catch (_) {}
      try {
        if (typeof window !== 'undefined' && window.location && window.location.href) {
          return ferriolNormalizeSignupEntryUrl(window.location.href.split('#')[0]);
        }
      } catch (_) {}
      return '';
    }
    function ferriolReferralInviteUrl(code, nicho) {
      var base = ferriolPublicSignupBaseUrl() || '';
      if (!base && typeof window !== 'undefined' && window.location && window.location.href) {
        base = ferriolNormalizeSignupEntryUrl(window.location.href.split('#')[0]);
      }
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
      var done = function () {
        if (typeof showScanToast === 'function') showScanToast(doneMsg || 'Copiado.', false);
        else alert(doneMsg || 'Copiado.');
      };
      if (navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(t).then(done).catch(function () { window.prompt('Copiá:', t); });
      } else window.prompt('Copiá:', t);
    }

    function isNetworkAdminRole(role) {
      return role === 'super' || role === 'partner';
    }
    function normalizeReferralCode(s) {
      if (s == null || s === '') return '';
      return String(s).trim().toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 32);
    }

    /** Abre el formulario de alta; definido acá para que funcione aunque falle código más abajo en este archivo.
     *  Si entraste por link de distribuidor (?ref=&nicho=socio), no pisamos ese nicho si tocás sin querer "Negocio". */
    function openSignUpFlow(nichoExplicit) {
      var keepSocioFromReferralLink = false;
      try {
        keepSocioFromReferralLink =
          sessionStorage.getItem('ferriol_signup_nicho') === 'socio' &&
          !!(sessionStorage.getItem('ferriol_signup_ref') || '').trim();
      } catch (_) {}
      var nicho = nichoExplicit === 'socio' ? 'socio' : 'kiosco';
      if (keepSocioFromReferralLink && nichoExplicit === 'kiosco') {
        nicho = 'socio';
      }
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
          if (!cc) {
            try {
              if (typeof showScanToast === 'function') showScanToast('No se pudo generar tu código de referido. Revisá la conexión o el permiso de actualización en Supabase (profiles).', true);
              else alert('No se pudo generar tu código de referido. Revisá la conexión o permisos en Supabase.');
            } catch (_) {}
          }
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

    /** Montos orientativos (alineados a mlm_plan_config compensation_v1 y PLAN-COMPENSACIONES-FERRIOL.md). Se pueden sobreescribir desde app_settings.ferriol_plan_amounts */
    var FERRIOL_PLAN_AMOUNTS = { kit: 60000, kioscoMonthly: 9900, vendorMonthly: 20000 };

    function ferriolMergePlanAmountsFromParsed(j) {
      if (!j || typeof j !== 'object') return;
      function pick(x, fb) {
        var n =
          typeof x === 'number' && !isNaN(x)
            ? x
            : parseFloat(String(x != null ? x : '').replace(/\s/g, '').replace(',', '.'), 10);
        if (!isFinite(n) || n < 0) return fb;
        return Math.round(n);
      }
      var fb = { kit: 60000, kioscoMonthly: 9900, vendorMonthly: 20000 };
      if (j.kit != null) FERRIOL_PLAN_AMOUNTS.kit = pick(j.kit, fb.kit);
      if (j.kioscoMonthly != null) FERRIOL_PLAN_AMOUNTS.kioscoMonthly = pick(j.kioscoMonthly, fb.kioscoMonthly);
      if (j.vendorMonthly != null) FERRIOL_PLAN_AMOUNTS.vendorMonthly = pick(j.vendorMonthly, fb.vendorMonthly);
    }
    async function ferriolLoadPlanAmountsFromSupabase() {
      if (!supabaseClient) return;
      try {
        var r = await supabaseClient.from('app_settings').select('value').eq('key', 'ferriol_plan_amounts').maybeSingle();
        var raw = r.data && r.data.value;
        if (raw == null || raw === '') return;
        var j = typeof raw === 'string' ? JSON.parse(raw) : raw;
        ferriolMergePlanAmountsFromParsed(j);
      } catch (_) {}
    }
    function ferriolPlanAmountsObjectFromSettingsForm() {
      function read(id, fb) {
        var el = document.getElementById(id);
        var n = el ? parseFloat(String(el.value || '').replace(/\s/g, '').replace(',', '.'), 10) : NaN;
        if (!isFinite(n) || n < 0) return fb;
        return Math.round(n);
      }
      var fb = { kit: 60000, kioscoMonthly: 9900, vendorMonthly: 20000 };
      return {
        kit: read('adminPlanAmountKit', fb.kit),
        kioscoMonthly: read('adminPlanAmountKioscoMonthly', fb.kioscoMonthly),
        vendorMonthly: read('adminPlanAmountVendorMonthly', fb.vendorMonthly)
      };
    }

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
    async function syncKiosqueroPartnerUpgradeUi() {
      var amd = document.getElementById('accountMenuDistribuidorWrap');
      var amb = document.getElementById('accountMenuBtnDistribuidor');
      if (!currentUser || currentUser.role !== 'kiosquero') {
        if (amd) amd.classList.add('hidden');
        return;
      }
      var pendingUpgrade = false;
      try {
        if (supabaseClient) {
          var r = await supabaseClient
            .from('ferriol_kiosquero_partner_upgrade_requests')
            .select('id,status')
            .eq('profile_id', currentUser.id)
            .eq('status', 'pending')
            .maybeSingle();
          pendingUpgrade = !r.error && !!r.data;
        }
      } catch (_) {}
      try {
        if (amd && amb) {
          amd.classList.remove('hidden');
          amb.disabled = pendingUpgrade;
          if (pendingUpgrade) {
            amb.className =
              'w-full rounded-xl py-3 px-3 text-xs sm:text-sm font-semibold flex items-center justify-center gap-2 touch-target border border-violet-400/40 bg-violet-950/65 text-white/90 opacity-85 cursor-not-allowed';
            amb.textContent = 'Solicitud de distribuidor pendiente';
          } else {
            amb.className =
              'w-full rounded-xl py-3 px-3 text-sm font-semibold flex items-center justify-center gap-2 touch-target text-white border border-violet-300/55 bg-gradient-to-br from-violet-600 via-violet-600 to-purple-700 shadow-md shadow-violet-600/30 ring-1 ring-white/10 hover:brightness-110 active:scale-[0.98]';
            amb.innerHTML =
              '<i data-lucide="badge-check" class="w-4 h-4 shrink-0"></i> Quiero ser distribuidor/a del sistema';
          }
        }
      } catch (_) {}
      try {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    }
    function openKiosqueroPartnerUpgradeModal() {
      var m = document.getElementById('kiosqueroPartnerUpgradeModal');
      var err = document.getElementById('kiosqueroPartnerUpgradeErr');
      var refIn = document.getElementById('kiosqueroPartnerUpgradeKitRefCode');
      var no = document.getElementById('kiosqueroPartnerUpgradeNote');
      if (!m) return;
      if (err) { err.textContent = ''; err.classList.add('hidden'); err.classList.remove('show'); }
      if (refIn) refIn.value = '';
      if (no) no.value = '';
      m.classList.remove('hidden');
      m.classList.add('flex');
      try {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    }
    function closeKiosqueroPartnerUpgradeModal() {
      var m = document.getElementById('kiosqueroPartnerUpgradeModal');
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
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
      if (t === 'kiosco_licencia') return 'Suscripción mensual · negocio';
      if (t === 'vendor_mantenimiento') return 'Cuota vendedor';
      return t ? String(t) : '—';
    }
    /** Tipo de ingreso en tabla Ingresos (partner): regalías vs comisión por venta verificada. */
    function ferriolIngresosLedgerTipoLabel(L, paymentType) {
      var ev = L && L.event_type;
      if (ev === 'renewal') {
        var sk = L.metadata && L.metadata.sale_kind;
        if (sk === 'partner_membership_auto') return 'Regalía · cuota socio';
        if (paymentType === 'vendor_mantenimiento') return 'Regalía · cuota socio';
        return 'Regalía';
      }
      return ferriolIngresosPaymentTypeLabel(paymentType);
    }
    /** Nivel MLM para la grilla: regalías por profundidad; ventas por tier/metadata. */
    function ferriolIngresosLedgerNivelLabel(L) {
      if (!L) return '—';
      if (L.event_type === 'renewal') {
        var d = L.depth != null && L.depth !== '' ? Number(L.depth) : NaN;
        if (isNaN(d) && L.metadata && L.metadata.depth != null) d = Number(L.metadata.depth);
        if (d === 1) return 'Referido nivel 1';
        if (d === 2) return 'Referido nivel 2';
        return '—';
      }
      if (L.event_type === 'sale_commission') {
        var tier = L.metadata && L.metadata.commission_tier ? String(L.metadata.commission_tier) : '';
        if (tier === 'intro') return 'Venta · inicial';
        if (tier === 'normal') return 'Venta · normal';
        var sk = L.metadata && L.metadata.sale_kind;
        if (sk === 'kiosco_monthly_auto') return 'Suscripción negocio · auto';
        return 'Venta directa';
      }
      return '—';
    }

    function syncPartnerProofInboxBadgeCount(n) {
      var badges = [
        document.getElementById('partnerProofInboxBtnBadge'),
        document.getElementById('partnerProofInboxBtnBadgeIngresos'),
      ].filter(Boolean);
      var txt = n > 99 ? '99+' : String(n);
      badges.forEach(function (badge) {
        if (n > 0) {
          badge.textContent = txt;
          badge.classList.remove('hidden');
        } else {
          badge.classList.add('hidden');
        }
      });
    }
    function ferriolPartnerProofSeenStorageKey() {
      return currentUser && currentUser.id ? 'ferriol_partner_proof_seen_v1:' + currentUser.id : '';
    }
    function ferriolPartnerProofLoadSeenSet() {
      try {
        var k = ferriolPartnerProofSeenStorageKey();
        if (!k) return new Set();
        var raw = localStorage.getItem(k);
        var arr = raw ? JSON.parse(raw) : [];
        if (!Array.isArray(arr)) return new Set();
        return new Set(arr.filter(Boolean).map(String));
      } catch (_) {
        return new Set();
      }
    }
    function ferriolPartnerProofSaveSeenSet(set) {
      try {
        var k = ferriolPartnerProofSeenStorageKey();
        if (!k) return;
        var arr = Array.from(set);
        if (arr.length > 500) arr = arr.slice(-500);
        localStorage.setItem(k, JSON.stringify(arr));
      } catch (_) {}
    }
    function ferriolPartnerProofMarkRowsSeen(ids) {
      var set = ferriolPartnerProofLoadSeenSet();
      (ids || []).forEach(function (id) {
        if (id) set.add(String(id));
      });
      ferriolPartnerProofSaveSeenSet(set);
    }
    function ferriolPartnerProofUnseenCount(rows) {
      var seen = ferriolPartnerProofLoadSeenSet();
      var n = 0;
      (rows || []).forEach(function (r) {
        if (r && r.id && !seen.has(String(r.id))) n++;
      });
      return n;
    }
    function ferriolSetPartnerProofScreenTab(which) {
      which = which === 'distribuidores' ? 'distribuidores' : 'comercios';
      var tc = document.getElementById('partnerProofScreenTabComercios');
      var td = document.getElementById('partnerProofScreenTabDistribuidores');
      var pc = document.getElementById('partnerProofScreenPaneComercios');
      var pd = document.getElementById('partnerProofScreenPaneDistribuidores');
      var isC = which === 'comercios';
      var activeCls =
        'partner-proof-screen-tab flex-1 py-2.5 rounded-lg text-sm font-semibold touch-target border border-[#22c55e]/50 bg-[#22c55e]/20 text-white transition-all';
      var idleCls =
        'partner-proof-screen-tab flex-1 py-2.5 rounded-lg text-sm font-semibold touch-target border border-transparent text-white/55 hover:text-white/80 transition-all';
      if (tc) {
        tc.setAttribute('aria-selected', isC ? 'true' : 'false');
        tc.className = isC ? activeCls : idleCls;
      }
      if (td) {
        td.setAttribute('aria-selected', !isC ? 'true' : 'false');
        td.className = !isC ? activeCls : idleCls;
      }
      if (pc) pc.classList.toggle('hidden', !isC);
      if (pd) pd.classList.toggle('hidden', isC);
    }
    function openPartnerComprobantesSection() {
      var ok = isPartnerLens() && !isEmpresaLensSuper() && !isPartnerKioscoPreviewMode();
      if (!ok) return;
      var cur = state.superSection;
      state._returnSuperSectionFromComprobantes = cur === 'partner-comprobantes' ? 'ingresos' : cur;
      switchSuperSection('partner-comprobantes');
    }
    function closePartnerComprobantesSection() {
      var back = state._returnSuperSectionFromComprobantes || 'ingresos';
      if (back === 'partner-comprobantes') back = 'ingresos';
      switchSuperSection(back);
    }
    function ferriolPartnerProofRowHtml(row, pmap) {
      var p = pmap[row.kiosco_user_id];
      var label = (p && (p.kiosco_name || p.email)) || '—';
      var d = row.created_at
        ? new Date(row.created_at).toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' })
        : '';
      var imgUrl = '';
      try {
        if (row.comprobante_path && supabaseClient) {
          var x = supabaseClient.storage.from('comprobantes-ferriol').getPublicUrl(String(row.comprobante_path).trim());
          imgUrl = x && x.data && x.data.publicUrl ? x.data.publicUrl : '';
        }
      } catch (_) {}
      var idEsc = ferriolEscapeHtmlLite(String(row.id || ''));
      var tipoLbl = ferriolIngresosPaymentTypeLabel(row.payment_type);
      return (
        '<div class="rounded-xl border border-white/12 bg-black/35 p-3 space-y-3">' +
        '<div class="flex flex-wrap gap-3 items-start">' +
        '<div class="min-w-0 flex-1">' +
        '<p class="font-medium text-white truncate">' +
        ferriolEscapeHtmlLite(label) +
        '</p>' +
        '<p class="text-xs text-white/55">' +
        ferriolEscapeHtmlLite(tipoLbl) +
        '</p>' +
        '<p class="text-xs text-white/45 tabular-nums">' +
        ferriolEscapeHtmlLite(d) +
        ' · $ ' +
        Number(row.amount_ars || 0).toLocaleString('es-AR') +
        '</p>' +
        '</div>' +
        (imgUrl
          ? '<div class="shrink-0 w-[132px] sm:w-[148px]">' +
            '<button type="button" class="ferriol-comp-view-trigger w-full rounded-xl border border-white/15 bg-black/25 overflow-hidden touch-target active:scale-[0.98]" data-comp-url="' +
            ferriolEscapeHtmlLite(imgUrl) +
            '">' +
            '<img src="' +
            ferriolEscapeHtmlLite(imgUrl) +
            '" alt="" class="w-full h-[7.25rem] object-cover object-center pointer-events-none bg-black/30" loading="lazy">' +
            '</button>' +
            '<p class="text-[10px] text-white/35 text-center mt-1 leading-tight">Tocá para ampliar</p>' +
            '</div>'
          : '<p class="text-[11px] text-white/35 shrink-0 self-center">Sin imagen</p>') +
        '</div>' +
        '<button type="button" class="partner-kiosk-proof-register-sale w-full py-2 rounded-lg bg-emerald-500/20 border border-emerald-400/40 text-emerald-100 text-sm font-medium touch-target active:scale-[0.99]" data-queue-id="' +
        idEsc +
        '">Registrar</button>' +
        '</div>'
      );
    }
    function ferriolRenderPartnerProofPanes(rows, pmap) {
      var listC = document.getElementById('partnerProofScreenPaneComercios');
      var listD = document.getElementById('partnerProofScreenPaneDistribuidores');
      if (!listC || !listD) return;
      var comRows = rows.filter(function (r) {
        return r.payment_type !== 'kit_inicial';
      });
      var distRows = rows.filter(function (r) {
        return r.payment_type === 'kit_inicial';
      });
      listC.innerHTML = comRows.length
        ? comRows.map(function (r) {
            return ferriolPartnerProofRowHtml(r, pmap);
          }).join('')
        : '<p class="text-white/40 text-sm py-6 text-center">Nada pendiente.</p>';
      listD.innerHTML = distRows.length
        ? distRows.map(function (r) {
            return ferriolPartnerProofRowHtml(r, pmap);
          }).join('')
        : '<p class="text-white/40 text-sm py-6 text-center">Nada pendiente.</p>';
      listC.querySelectorAll('.partner-kiosk-proof-register-sale').forEach(function (btn) {
        btn.addEventListener('click', ferriolPartnerProofRegisterSaleClick);
      });
      listD.querySelectorAll('.partner-kiosk-proof-register-sale').forEach(function (btn) {
        btn.addEventListener('click', ferriolPartnerProofRegisterSaleClick);
      });
    }
    async function ferriolPartnerProofRegisterSaleClick(ev) {
      var btn = ev.currentTarget;
      var qid = btn.getAttribute('data-queue-id');
      if (!qid || !supabaseClient) return;
      var msgEl = document.getElementById('partnerProofScreenMsg');
      if (msgEl) {
        msgEl.classList.add('hidden');
        msgEl.textContent = '';
      }
      if (!confirm('¿Registrar ante Ferriol?')) return;
      var rpc = await supabaseClient.rpc('ferriol_partner_register_sale_from_kiosk_proof', { p_queue_id: qid });
      if (rpc.error) {
        var em = rpc.error.message || String(rpc.error);
        if (msgEl) {
          msgEl.textContent = em;
          msgEl.className = 'text-xs mt-4 text-center px-1 text-red-300';
          msgEl.classList.remove('hidden');
        }
        alert(em);
        return;
      }
      var out = rpc.data;
      if (typeof out === 'string') {
        try {
          out = JSON.parse(out);
        } catch (_) {}
      }
      if (!out || out.ok !== true) {
        var em2 = out && out.error ? out.error : 'No se pudo registrar.';
        if (msgEl) {
          msgEl.textContent = em2;
          msgEl.className = 'text-xs mt-4 text-center px-1 text-red-300';
          msgEl.classList.remove('hidden');
        }
        alert(em2);
        return;
      }
      if (msgEl) {
        msgEl.textContent = 'Listo.';
        msgEl.className = 'text-xs mt-4 text-center px-1 text-emerald-300/95';
        msgEl.classList.remove('hidden');
        setTimeout(function () {
          msgEl.classList.add('hidden');
        }, 2500);
      }
      await loadPartnerKioskProofQueue(true);
      void loadSuperIngresosSection();
    }
    /** Cola comprobantes kiosco → partner. forceRepaint: repintar listas cuando está abierta la pantalla Comprobantes. */
    async function loadPartnerKioskProofQueue(forceRepaint) {
      var showShell = isPartnerLens() && !isEmpresaLensSuper() && !isPartnerKioscoPreviewMode();
      var detailOpen = forceRepaint === true || state.superSection === 'partner-comprobantes';
      var listC = document.getElementById('partnerProofScreenPaneComercios');
      var listD = document.getElementById('partnerProofScreenPaneDistribuidores');
      var msgEl = document.getElementById('partnerProofScreenMsg');
      if (!showShell) {
        syncPartnerProofInboxBadgeCount(0);
        return;
      }
      if (!supabaseClient || !currentUser) {
        syncPartnerProofInboxBadgeCount(0);
        if (detailOpen && listC && listD) {
          listC.innerHTML = listD.innerHTML = '<p class="text-white/45 text-xs py-4 text-center">Iniciá sesión.</p>';
        }
        return;
      }
      if (detailOpen && listC && listD) {
        listC.innerHTML = listD.innerHTML = '<p class="text-white/35 text-xs py-3 text-center">…</p>';
      }
      if (msgEl && detailOpen) {
        msgEl.classList.add('hidden');
        msgEl.textContent = '';
      }
      try {
        var r = await supabaseClient
          .from('ferriol_kiosk_partner_proof_queue')
          .select('id, created_at, kiosco_user_id, amount_ars, payment_type, comprobante_path, status')
          .eq('partner_id', currentUser.id)
          .eq('status', 'pending_sale')
          .order('created_at', { ascending: false })
          .limit(40);
        if (r.error) throw r.error;
        var rows = r.data || [];
        var kid = rows.map(function (x) {
          return x.kiosco_user_id;
        }).filter(Boolean);
        var pmap = {};
        if (kid.length) {
          var pr = await supabaseClient.from('profiles').select('id, email, kiosco_name').in('id', kid);
          if (!pr.error && pr.data) {
            pr.data.forEach(function (p) {
              if (p && p.id) pmap[p.id] = p;
            });
          }
        }
        if (detailOpen && listC && listD) {
          ferriolRenderPartnerProofPanes(rows, pmap);
          ferriolPartnerProofMarkRowsSeen(rows.map(function (x) {
            return x.id;
          }));
          try {
            if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
          } catch (_) {}
        }
        syncPartnerProofInboxBadgeCount(ferriolPartnerProofUnseenCount(rows));
      } catch (e) {
        syncPartnerProofInboxBadgeCount(0);
        if (detailOpen && listC && listD) {
          listC.innerHTML =
            '<p class="text-red-300 text-xs px-1">' +
            ferriolEscapeHtmlLite(String((e && e.message) || e)) +
            '</p>';
          listD.innerHTML = '';
        }
      }
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
        if (founder) {
          s.textContent =
            'Métricas globales: facturación verificada, reserva a favor de la empresa y comisiones liquidadas a la red (libro MLM). No reemplaza la contabilidad formal.';
          s.classList.remove('hidden');
        } else {
          s.textContent = '';
          s.classList.add('hidden');
        }
      }
      if (pRow) pRow.classList.toggle('hidden', founder);
      if (fRow) fRow.classList.toggle('hidden', !founder);
      if (ct) ct.textContent = founder ? 'Evolución diaria (empresa)' : 'Desempeño diario (tu comisión)';
      if (cl) {
        cl.textContent = founder
          ? 'Verde: facturación bruta · Cyan: reserva empresa · Violeta: comisiones a la red'
          : 'Leyenda: verde = comisión; rojo = rech. ($); azul = nº ventas (acred. + rech.) / día';
      }
    }
    function ferriolIngresosPinnedTipRemoveEl(chart) {
      if (!chart || !chart.canvas || !chart.canvas.parentElement) return;
      var t = chart.canvas.parentElement.querySelector('[data-ingresos-pinned-tip]');
      if (t && t.parentNode) t.parentNode.removeChild(t);
      chart._ferriolPinnedTipIdx = null;
    }
    function ferriolIngresosPinnedTipFormatVal(v, datasetLabel) {
      var n = Number(v);
      if (!Number.isFinite(n)) return '—';
      if (/Nº/i.test(datasetLabel || '')) return String(Math.round(n));
      return '$ ' + n.toLocaleString('es-AR', { minimumFractionDigits: 0, maximumFractionDigits: 2 });
    }
    function ferriolIngresosPinnedTipOnClick(evt, elements, chart) {
      if (!chart || !chart.canvas || !evt) return;
      var wrap = chart.canvas.parentElement;
      if (!wrap || !wrap.classList || !wrap.classList.contains('ingresos-chart-wrap')) return;
      var tip = wrap.querySelector('[data-ingresos-pinned-tip]');
      if (!elements.length) {
        if (tip) tip.style.opacity = '0';
        chart._ferriolPinnedTipIdx = null;
        return;
      }
      var idx = elements[0].index;
      if (tip && chart._ferriolPinnedTipIdx === idx && tip.style.opacity === '1') {
        tip.style.opacity = '0';
        chart._ferriolPinnedTipIdx = null;
        return;
      }
      if (!tip) {
        tip = document.createElement('div');
        tip.setAttribute('data-ingresos-pinned-tip', '1');
        tip.className = 'ferriol-ingresos-pinned-tip';
        tip.setAttribute('role', 'status');
        wrap.appendChild(tip);
      }
      var lbl = chart.data.labels && chart.data.labels[idx];
      var labelRaw = lbl != null ? String(lbl) : 'Día ' + (idx + 1);
      var rows = (chart.data.datasets || [])
        .map(function (ds) {
          var raw = ds.data[idx];
          var val = ferriolIngresosPinnedTipFormatVal(raw, ds.label);
          var lab = String(ds.label || '').replace(/</g, '&lt;').replace(/&/g, '&amp;');
          var vale = String(val).replace(/</g, '&lt;').replace(/&/g, '&amp;');
          return '<div class="ferriol-ingresos-pinned-tip-row"><span class="ferriol-ingresos-pinned-tip-lab">' + lab + '</span><span class="ferriol-ingresos-pinned-tip-val">' + vale + '</span></div>';
        })
        .join('');
      tip.innerHTML =
        '<div class="ferriol-ingresos-pinned-tip-date">' +
        labelRaw.replace(/</g, '&lt;').replace(/&/g, '&amp;') +
        '</div>' +
        rows;
      chart._ferriolPinnedTipIdx = idx;
      tip.style.opacity = '1';
      var native = evt.native != null ? evt.native : evt;
      var tcx;
      var tcy;
      var wr = wrap.getBoundingClientRect();
      if (native && native.changedTouches && native.changedTouches[0]) {
        tcx = native.changedTouches[0].clientX;
        tcy = native.changedTouches[0].clientY;
      } else if (native && native.clientX != null) {
        tcx = native.clientX;
        tcy = native.clientY;
      } else {
        tcx = wr.left + wr.width / 2;
        tcy = wr.top + wr.height / 2;
      }
      var nx = tcx - wr.left;
      var ny = tcy - wr.top;
      requestAnimationFrame(function () {
        if (!tip.parentNode) return;
        var tw = tip.offsetWidth || 160;
        var th = tip.offsetHeight || 90;
        var pad = 6;
        var lx = nx + 12;
        var ly = ny - th - 10;
        if (lx + tw > wrap.clientWidth - pad) lx = Math.max(pad, wrap.clientWidth - tw - pad);
        if (lx < pad) lx = pad;
        if (ly < pad) ly = ny + 14;
        if (ly + th > wrap.clientHeight - pad) ly = Math.max(pad, wrap.clientHeight - th - pad);
        tip.style.left = lx + 'px';
        tip.style.top = ly + 'px';
      });
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
            try { ferriolIngresosPinnedTipRemoveEl(window._ferriolIngresosChart); } catch (_) {}
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
                plugins: {
                  tooltip: { enabled: false },
                  legend: { position: 'top', labels: { color: 'rgba(255,255,255,0.75)', font: { size: 11 } } }
                },
                scales: {
                  x: { ticks: { color: 'rgba(255,255,255,0.45)', maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                  y: { position: 'left', ticks: { color: 'rgba(255,255,255,0.5)' }, grid: { color: 'rgba(255,255,255,0.08)' } }
                },
                onClick: ferriolIngresosPinnedTipOnClick
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
          try { ferriolIngresosPinnedTipRemoveEl(window._ferriolIngresosChart); } catch (_) {}
          try { window._ferriolIngresosChart.destroy(); } catch (_) {}
          window._ferriolIngresosChart = null;
        }
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function renderIngresosBienvenida() {
      var banner = document.getElementById('ingresosBienvenidaBanner');
      if (!banner) return;
      if (!currentUser || (currentUser.role !== 'partner' && currentUser.role !== 'super')) {
        banner.classList.add('hidden');
        return;
      }
      var title = document.getElementById('ingresosBienvenidaTitle');
      var sub = document.getElementById('ingresosBienvenidaSub');
      var statsBox = document.getElementById('ingresosBienvenidaStats');
      var nombre = (currentUser.kioscoName || '').trim() ||
                   (currentUser.email ? currentUser.email.split('@')[0] : '') ||
                   'equipo';
      if (title) title.textContent = 'Hola, ' + nombre + ', te damos la bienvenida.';
      if (sub) sub.textContent = currentUser.role === 'partner'
        ? 'Acá podés ver tus comisiones, ventas y un resumen de comercios y distribuidores en tu red.'
        : 'Panel de ingresos y operaciones de Ferriol OS.';
      var isPartner = currentUser.role === 'partner';
      if (statsBox) statsBox.classList.toggle('hidden', !isPartner);
      banner.classList.remove('hidden');
      if (!isPartner || !supabaseClient) return;
      var comerciosEl = document.getElementById('bienvenidaComerciosCount');
      var distribEl = document.getElementById('bienvenidaDistribuidoresCount');
      if (comerciosEl) comerciosEl.textContent = '…';
      if (distribEl) distribEl.textContent = '…';
      supabaseClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('sponsor_id', currentUser.id)
        .eq('role', 'kiosquero')
        .eq('active', true)
        .then(function (r) {
          if (comerciosEl) comerciosEl.textContent = r.count != null ? r.count : '—';
        })
        .catch(function () {
          if (comerciosEl) comerciosEl.textContent = '—';
        });
      supabaseClient
        .from('profiles')
        .select('id', { count: 'exact', head: true })
        .eq('sponsor_id', currentUser.id)
        .eq('role', 'partner')
        .eq('active', true)
        .then(function (r) {
          if (distribEl) distribEl.textContent = r.count != null ? r.count : '—';
        })
        .catch(function () {
          if (distribEl) distribEl.textContent = '—';
        });
    }

    async function loadSuperIngresosSection() {
      renderIngresosBienvenida();
      var kpiN = document.getElementById('ingresosKpiNet');
      var kpiC = document.getElementById('ingresosKpiCount');
      var kpiR = document.getElementById('ingresosKpiRej');
      var kpiPending = document.getElementById('ingresosKpiPending');
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
      try {
        await loadPartnerKioskProofQueue();
      } catch (_) {}
      var rangeSel = document.getElementById('ingresosRangeFilter');
      var rangeDays = rangeSel && rangeSel.value ? parseInt(rangeSel.value, 10) : 30;
      if (isNaN(rangeDays) || rangeDays < 1) rangeDays = 30;
      kpiN.textContent = kpiC.textContent = kpiR.textContent = '…';
      if (kpiPending) kpiPending.textContent = '…';
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
          .select('id, created_at, amount, status, metadata, event_type, depth, origin_user_id')
          .eq('beneficiary_user_id', uid)
          .in('event_type', ['sale_commission', 'renewal'])
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
          if (!byDay[dk]) byDay[dk] = { net: 0, rej: 0, n: 0, nRej: 0 };
          byDay[dk].net += a;
          byDay[dk].n += 1;
        });
        kpiN.textContent = '$ ' + sumCom.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ARS';
        var resPay = await supabaseClient
          .from('ferriol_payments')
          .select('id, created_at, payment_type, amount, status, payer_user_id, external_note, period_month')
          .eq('seller_user_id', uid)
          .gte('created_at', startIsoP)
          .lte('created_at', endIsoP)
          .order('created_at', { ascending: false })
          .limit(800);
        if (resPay.error) throw resPay.error;
        var resCsrRej = await supabaseClient
          .from('ferriol_client_sale_requests')
          .select('id, created_at, client_name, client_email, amount_ars, payment_type, period_month, reject_note, comprobante_path, ferriol_payment_id')
          .eq('partner_id', uid)
          .eq('status', 'rejected')
          .gte('created_at', startIsoP)
          .lte('created_at', endIsoP)
          .order('created_at', { ascending: false })
          .limit(200);
        if (resCsrRej.error) throw resCsrRej.error;
        var pRows = resPay.data || [];
        var csrRejRows = resCsrRej.data || [];
        var rejPayRows = pRows.filter(function (r) { return r.status === 'rejected'; });
        var sumRej = 0;
        rejPayRows.forEach(function (r) { sumRej += Number(r.amount || 0); });
        csrRejRows.forEach(function (r) { sumRej += Number(r.amount_ars || 0); });
        var nRej = rejPayRows.length + csrRejRows.length;
        var rejPayerIds = Array.from(new Set(rejPayRows.map(function (r) { return r.payer_user_id; }).filter(Boolean)));
        var rejPayMeta = {};
        if (rejPayerIds.length) {
          var prRej = await supabaseClient.from('profiles').select('id, email, kiosco_name').in('id', rejPayerIds);
          if (!prRej.error && prRej.data) {
            prRej.data.forEach(function (p) {
              if (p && p.id) {
                rejPayMeta[p.id] = {
                  label: ((p.kiosco_name || '').trim() || p.email || p.id),
                  email: (p.email || '').trim()
                };
              }
            });
          }
        }
        var enrichedRejPayments = rejPayRows.map(function (r) {
          var meta = r.payer_user_id ? rejPayMeta[r.payer_user_id] : null;
          return {
            id: r.id,
            created_at: r.created_at,
            payment_type: r.payment_type,
            amount: r.amount,
            period_month: r.period_month,
            external_note: r.external_note,
            payer_user_id: r.payer_user_id,
            payer_label: meta ? meta.label : '—',
            payer_email: meta ? meta.email : ''
          };
        });
        window._ferriolIngresosRejectedDetail = {
          payments: enrichedRejPayments,
          csrs: csrRejRows.slice()
        };
        rejPayRows.forEach(function (r) {
          var dk = ferriolIngresosDayKeyFromIso(r.created_at);
          if (!byDay[dk]) byDay[dk] = { net: 0, rej: 0, n: 0, nRej: 0 };
          byDay[dk].rej += Number(r.amount || 0);
          byDay[dk].nRej += 1;
        });
        csrRejRows.forEach(function (r) {
          var dk = ferriolIngresosDayKeyFromIso(r.created_at);
          if (!byDay[dk]) byDay[dk] = { net: 0, rej: 0, n: 0, nRej: 0 };
          byDay[dk].rej += Number(r.amount_ars || 0);
          byDay[dk].nRej += 1;
        });
        kpiC.textContent = String(ledOk.length + nRej);
        kpiR.textContent = String(nRej);
        if (kpiPending) {
          Promise.all([
            supabaseClient
              .from('ferriol_kiosquero_provision_requests')
              .select('id', { count: 'exact', head: true })
              .eq('requested_by', uid)
              .eq('status', 'pending'),
            supabaseClient
              .from('ferriol_partner_provision_requests')
              .select('id', { count: 'exact', head: true })
              .eq('requested_by', uid)
              .eq('status', 'pending'),
            supabaseClient
              .from('ferriol_client_sale_requests')
              .select('id', { count: 'exact', head: true })
              .eq('partner_id', uid)
              .eq('status', 'pending')
          ]).then(function (results) {
            var total = 0;
            results.forEach(function (r) {
              if (r && !r.error && r.count != null) total += r.count;
            });
            kpiPending.textContent = String(total);
          }).catch(function () {
            kpiPending.textContent = '—';
          });
        }
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
        var dataCnt = dayKeys.map(function (k) {
          var b = byDay[k];
          if (!b) return 0;
          return (b.n || 0) + (b.nRej || 0);
        });
        if (typeof window.Chart === 'undefined') {
          if (canvas) canvas.classList.add('hidden');
          if (fb) { fb.classList.remove('hidden'); fb.textContent = 'Gráfico no disponible (librería de gráficos). Revisá la conexión a internet.'; }
        } else {
          if (window._ferriolIngresosChart) {
            try { ferriolIngresosPinnedTipRemoveEl(window._ferriolIngresosChart); } catch (_) {}
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
                  { label: 'Nº ventas (acred. + rech.)', data: dataCnt, borderColor: 'rgb(56, 189, 248)', backgroundColor: 'rgba(56, 189, 248, 0.06)', tension: 0.2, fill: false, pointRadius: 0, yAxisID: 'y1' }
                ]
              },
              options: {
                responsive: true,
                maintainAspectRatio: false,
                interaction: { mode: 'index', intersect: false },
                plugins: {
                  tooltip: { enabled: false },
                  legend: { position: 'top', labels: { color: 'rgba(255,255,255,0.75)', font: { size: 11 } } }
                },
                scales: {
                  x: { ticks: { color: 'rgba(255,255,255,0.45)', maxRotation: 45, minRotation: 0, autoSkip: true, maxTicksLimit: 12 }, grid: { color: 'rgba(255,255,255,0.06)' } },
                  y: { position: 'left', ticks: { color: 'rgba(255,255,255,0.5)' }, grid: { color: 'rgba(255,255,255,0.08)' } },
                  y1: { position: 'right', min: 0, ticks: { color: 'rgba(56, 189, 248, 0.7)', stepSize: 1 }, grid: { drawOnChartArea: false } }
                },
                onClick: ferriolIngresosPinnedTipOnClick
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
          if (mid && payTypes[mid] && payTypes[mid].payer_user_id) return payTypes[mid].payer_user_id;
          return L.origin_user_id || null;
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
            var tipoLab = ferriolIngresosLedgerTipoLabel(L, ptyp);
            var nivelLab = ferriolIngresosLedgerNivelLabel(L);
            var pctV = (L.metadata && (L.metadata.sale_vendor_pct != null)) ? (Number(L.metadata.sale_vendor_pct) * 100).toFixed(1) + '%' : '—';
            var py = (mid && payTypes[mid]) ? payTypes[mid].payer_user_id : null;
            var origin = L.origin_user_id || null;
            var nmWho = py || origin;
            var nm = nmWho ? (nameBy[nmWho] || '…') : '—';
            return '<div class="grid grid-cols-12 gap-1 px-3 py-2.5 border-b border-white/[0.06] text-xs items-center"><div class="col-span-2 text-white/55 tabular-nums">' + d + '</div><div class="col-span-2 text-white/85 truncate" title="">' + String(tipoLab).replace(/</g, '&lt;') + '</div><div class="col-span-2 text-[#86efac] font-semibold tabular-nums">$ ' + Number(L.amount || 0).toLocaleString('es-AR') + '</div><div class="col-span-2 text-amber-200/80 truncate">' + String(nivelLab).replace(/</g, '&lt;') + '</div><div class="col-span-2 text-white/50 tabular-nums">' + pctV + '</div><div class="col-span-2 text-white/60 truncate">' + String(nm).replace(/</g, '&lt;') + '</div></div>';
          }).join('');
          wrap.innerHTML = head + body;
        }
      } catch (e) {
        kpiN.textContent = kpiC.textContent = kpiR.textContent = '—';
        window._ferriolIngresosRejectedDetail = { payments: [], csrs: [] };
        wrap.innerHTML = '<p class="text-red-300/90 text-sm py-4 px-2">No se pudieron cargar los ingresos. ' + (e && e.message ? String(e.message) : '') + ' ¿Ejecutaste <code class="text-white/80">supabase-ferriol-payments.sql</code> y las políticas RLS?</p>';
        if (typeof window !== 'undefined' && window.Chart && canvas && window._ferriolIngresosChart) {
          try { ferriolIngresosPinnedTipRemoveEl(window._ferriolIngresosChart); } catch (_) {}
          try { window._ferriolIngresosChart.destroy(); } catch (_) {}
          window._ferriolIngresosChart = null;
        }
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function superSolicitudNameOf(pool, id) {
      if (!id) return '—';
      var p = (pool || []).find(function (x) { return x.id === id; });
      return (p ? (p.kiosco_name || p.email || String(id)) : String(id)).replace(/</g, '&lt;');
    }
    function escHtmlCsr(s) {
      return String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/"/g, '&quot;');
    }
    function ferriolCsrComprobantePublicUrl(path) {
      if (!path || !supabaseClient) return '';
      try {
        var x = supabaseClient.storage.from('comprobantes-ferriol').getPublicUrl(path);
        return x && x.data && x.data.publicUrl ? x.data.publicUrl : '';
      } catch (_) {
        return '';
      }
    }
    function openFerriolComprobanteViewer(imageUrl) {
      var m = document.getElementById('ferriolComprobanteViewerModal');
      var img = document.getElementById('ferriolComprobanteViewerImg');
      var ext = document.getElementById('ferriolComprobanteViewerOpenExternal');
      if (!m || !img) return;
      img.src = imageUrl || '';
      img.alt = 'Comprobante';
      if (ext) {
        if (imageUrl) {
          ext.href = imageUrl;
          ext.classList.remove('hidden');
        } else {
          ext.href = '#';
          ext.classList.add('hidden');
        }
      }
      m.classList.remove('hidden');
      m.classList.add('flex');
      try { document.body.style.overflow = 'hidden'; } catch (_) {}
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closeFerriolComprobanteViewer() {
      var m = document.getElementById('ferriolComprobanteViewerModal');
      var img = document.getElementById('ferriolComprobanteViewerImg');
      if (img) {
        img.removeAttribute('src');
        img.alt = '';
      }
      if (!m) return;
      m.classList.add('hidden');
      m.classList.remove('flex');
      try { document.body.style.overflow = ''; } catch (_) {}
    }
    function ferriolInlineComprobantePreviewHtml(imgUrl, altText) {
      if (!imgUrl) return '';
      var u = escHtmlCsr(imgUrl);
      return (
        '<div class="mt-2">' +
        '<button type="button" class="ferriol-comp-view-trigger block w-full rounded-xl border border-white/20 bg-black/25 overflow-hidden touch-target active:scale-[0.98]" data-comp-url="' +
        u +
        '">' +
        '<img src="' +
        u +
        '" alt="' +
        escHtmlCsr(altText || 'Comprobante') +
        '" class="max-h-52 w-full object-contain bg-black/30 pointer-events-none" loading="lazy">' +
        '</button>' +
        '<p class="text-[10px] text-white/35 text-center mt-1">Tocá la imagen para verla en grande</p>' +
        '</div>'
      );
    }
    function closeIngresosRechazadasModal() {
      var m = document.getElementById('ingresosRechazadasModal');
      if (!m) return;
      m.classList.add('hidden');
      m.classList.remove('flex');
    }
    function ferriolRenderIngresosRechazadasModalBody() {
      var body = document.getElementById('ingresosRechazadasModalBody');
      if (!body) return;
      var data = window._ferriolIngresosRejectedDetail || { payments: [], csrs: [] };
      var pays = data.payments || [];
      var csrs = data.csrs || [];
      if (!pays.length && !csrs.length) {
        body.innerHTML = '<p class="text-white/50 text-sm py-4 text-center">No hay rechazos en el período seleccionado. Cambiá el rango arriba en Ingresos y volvé a intentar.</p>';
        return;
      }
      var blocks = [];
      csrs.forEach(function (row) {
        var d = String(row.created_at || '').slice(0, 16).replace('T', ' ');
        var reason = (row.reject_note && String(row.reject_note).trim()) ? escHtmlCsr(row.reject_note) : '<span class="text-white/45">Sin motivo detallado.</span>';
        var img = ferriolCsrComprobantePublicUrl(row.comprobante_path);
        blocks.push(
          '<div class="rounded-xl border border-red-400/25 bg-black/35 p-3 space-y-2">' +
          '<p class="text-[10px] text-white/45 uppercase tracking-wide">Solicitud con comprobante · ' + escHtmlCsr(d) + '</p>' +
          '<p class="text-white/90"><strong>Cliente:</strong> ' + escHtmlCsr(row.client_name) + '</p>' +
          '<p class="text-white/75 text-xs"><strong>Email:</strong> ' + escHtmlCsr(row.client_email) + '</p>' +
          '<p class="text-xs text-white/55">' + escHtmlCsr(ferriolIngresosPaymentTypeLabel(row.payment_type)) + (row.period_month ? ' · Mes: ' + escHtmlCsr(String(row.period_month).slice(0, 7)) : '') + ' · <strong class="text-red-200/90">$ ' + Number(row.amount_ars || 0).toLocaleString('es-AR') + '</strong></p>' +
          '<p class="text-xs text-amber-100/90"><strong>Motivo:</strong> ' + reason + '</p>' +
          (img ? ferriolInlineComprobantePreviewHtml(img, 'Comprobante enviado') : '') +
          '<button type="button" class="ferriol-rej-prefill-csr w-full mt-1 py-2 rounded-lg border border-emerald-400/35 text-emerald-200 text-xs font-semibold touch-target" data-csr-id="' + escHtmlCsr(row.id) + '">Corregir y reenviar (cargar formulario)</button>' +
          '</div>'
        );
      });
      pays.forEach(function (r) {
        var d = String(r.created_at || '').slice(0, 16).replace('T', ' ');
        var reason = (r.external_note && String(r.external_note).trim()) ? escHtmlCsr(r.external_note) : '<span class="text-white/45">Sin motivo detallado.</span>';
        blocks.push(
          '<div class="rounded-xl border border-red-400/25 bg-black/35 p-3 space-y-2">' +
          '<p class="text-[10px] text-white/45 uppercase tracking-wide">Cobro en cuenta · ' + escHtmlCsr(d) + '</p>' +
          '<p class="text-xs text-white/55">' + escHtmlCsr(ferriolIngresosPaymentTypeLabel(r.payment_type)) + (r.period_month ? ' · Mes: ' + escHtmlCsr(String(r.period_month).slice(0, 7)) : '') + ' · <strong class="text-red-200/90">$ ' + Number(r.amount || 0).toLocaleString('es-AR') + '</strong></p>' +
          '<p class="text-white/75 text-xs"><strong>Comprador:</strong> ' + escHtmlCsr(r.payer_label || '—') + (r.payer_email ? ' · ' + escHtmlCsr(r.payer_email) : '') + '</p>' +
          '<p class="text-xs text-amber-100/90"><strong>Motivo:</strong> ' + reason + '</p>' +
          '<button type="button" class="ferriol-rej-prefill-pay w-full mt-1 py-2 rounded-lg border border-emerald-400/35 text-emerald-200 text-xs font-semibold touch-target" data-pay-id="' + escHtmlCsr(r.id) + '">Nueva solicitud con estos datos</button>' +
          '</div>'
        );
      });
      body.innerHTML = blocks.join('');
      body.querySelectorAll('.ferriol-rej-prefill-csr').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-csr-id');
          var row = (window._ferriolIngresosRejectedDetail && window._ferriolIngresosRejectedDetail.csrs || []).find(function (x) { return String(x.id) === String(id); });
          if (!row) return;
          closeIngresosRechazadasModal();
          ferriolPrefillClientSaleFromRejectedCsr(row);
        });
      });
      body.querySelectorAll('.ferriol-rej-prefill-pay').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var id = btn.getAttribute('data-pay-id');
          var row = (window._ferriolIngresosRejectedDetail && window._ferriolIngresosRejectedDetail.payments || []).find(function (x) { return String(x.id) === String(id); });
          if (!row) return;
          closeIngresosRechazadasModal();
          ferriolPrefillClientSaleFromRejectedPayment(row);
        });
      });
    }
    function openIngresosRechazadasModal() {
      var m = document.getElementById('ingresosRechazadasModal');
      if (!m) return;
      ferriolRenderIngresosRechazadasModalBody();
      m.classList.remove('hidden');
      m.classList.add('flex');
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function ferriolPrefillClientSaleFromRejectedCsr(row) {
      switchSuperSection('mas');
      setTimeout(function () {
        try { superMasScrollTo('superMasBlockAdmin'); } catch (_) {}
      }, 120);
      var nm = document.getElementById('clientSaleClientName');
      var em = document.getElementById('clientSaleClientEmail');
      var pt = document.getElementById('clientSalePaymentType');
      var am = document.getElementById('clientSaleAmount');
      var vm = document.getElementById('clientSaleVendorMonth');
      var fi = document.getElementById('clientSaleComprobante');
      if (nm) nm.value = row.client_name || '';
      if (em) em.value = row.client_email || '';
      if (pt) pt.value = row.payment_type || 'kiosco_licencia';
      if (am) am.value = String(Number(row.amount_ars) || '');
      if (fi) fi.value = '';
      if (vm) {
        if (row.period_month) {
          var pm = String(row.period_month);
          if (pm.length >= 7) vm.value = pm.slice(0, 7);
        } else if (row.payment_type !== 'vendor_mantenimiento') {
          vm.value = '';
        }
      }
      syncClientSaleVendorMonthVisibility();
      openClientSaleRequestModal();
    }
    function ferriolPrefillClientSaleFromRejectedPayment(row) {
      switchSuperSection('mas');
      setTimeout(function () {
        try { superMasScrollTo('superMasBlockAdmin'); } catch (_) {}
      }, 120);
      var nm = document.getElementById('clientSaleClientName');
      var em = document.getElementById('clientSaleClientEmail');
      var pt = document.getElementById('clientSalePaymentType');
      var am = document.getElementById('clientSaleAmount');
      var vm = document.getElementById('clientSaleVendorMonth');
      var fi = document.getElementById('clientSaleComprobante');
      if (nm) nm.value = row.payer_label || '';
      if (em) em.value = row.payer_email || '';
      if (pt) pt.value = row.payment_type || 'kiosco_licencia';
      if (am) am.value = String(Number(row.amount) || '');
      if (fi) fi.value = '';
      if (vm) {
        if (row.period_month) {
          var pm = String(row.period_month);
          if (pm.length >= 7) vm.value = pm.slice(0, 7);
        } else if (row.payment_type === 'vendor_mantenimiento') {
          var d = new Date();
          vm.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
        } else {
          vm.value = '';
        }
      }
      syncClientSaleVendorMonthVisibility();
      openClientSaleRequestModal();
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
              ? ferriolInlineComprobantePreviewHtml(img, 'Comprobante')
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
          clBox.innerHTML = '<p class="text-white/50 text-sm py-4">Ninguna solicitud con comprobante. Los administradores envían desde <strong class="text-white/75">Ingresos</strong>: botón <strong class="text-white/75">Cargar venta</strong> junto al período.</p>';
        } else {
          clBox.innerHTML = (htmlPend || '<p class="text-amber-200/90 text-sm py-2">Nada pendiente de validar en este listado.</p>') + htmlHist;
        }
      } catch (e) {
        clBox.innerHTML = '<p class="text-red-300 text-sm">Error al cargar comprobantes. ¿Ejecutaste <code class="text-white/80">supabase-ferriol-client-sale-requests.sql</code>? ' + escHtmlCsr(String(e.message || e)) + '</p>';
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    async function loadFounderEmpresaPaymentProofPanel() {
      var clBox = document.getElementById('superEmpresaPaymentProofList');
      if (!clBox) return;
      if (!supabaseClient || !isEmpresaLensSuper()) {
        clBox.innerHTML = '';
        return;
      }
      clBox.innerHTML = '<p class="text-white/45 text-xs py-2">Cargando…</p>';
      try {
        var r = await supabaseClient.from('ferriol_empresa_payment_proof_requests').select('*').order('created_at', { ascending: false }).limit(40);
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
          return ferriolCsrComprobantePublicUrl(path);
        }
        var htmlPend = pending.map(function (row) {
          var img = pubUrl(row.comprobante_path);
          var pName = superSolicitudNameOf(pool, row.user_id);
          var spName = row.sponsor_resolved_id ? superSolicitudNameOf(pool, row.sponsor_resolved_id) : '—';
          var codeLbl = (row.sponsor_code_raw && String(row.sponsor_code_raw).trim())
            ? escHtmlCsr(row.sponsor_code_raw)
            : '<span class="text-white/35">(perfil / vacío)</span>';
          return (
            '<div class="rounded-xl border border-white/15 bg-black/30 p-3 space-y-2">' +
            '<div class="flex flex-wrap gap-2 justify-between text-xs text-white/55"><span>' + String(row.created_at).slice(0, 19).replace('T', ' ') + '</span><span>Pagador: ' + escHtmlCsr(pName) + '</span></div>' +
            '<p class="text-xs text-white/55">Tipo: ' + escHtmlCsr(ferriolIngresosPaymentTypeLabel(row.payment_type)) + (row.period_month ? ' · Mes: ' + escHtmlCsr(String(row.period_month).slice(0, 7)) : '') + '</p>' +
            '<p class="text-xs text-white/60">Código cargado: ' + codeLbl + ' · <strong class="text-white/75">Patrocinador resuelto:</strong> ' + escHtmlCsr(spName) + '</p>' +
            '<div class="flex flex-wrap items-center gap-2"><span class="text-xs text-white/50">Monto ARS</span>' +
            '<input type="number" id="ep-proof-amt-' + row.id + '" class="glass rounded-lg px-2 py-1 border border-white/20 text-white text-sm w-36" value="' + String(Number(row.amount_ars) || 0) + '"></div>' +
            (img
              ? ferriolInlineComprobantePreviewHtml(img, 'Comprobante')
              : '<p class="text-amber-200 text-xs">Sin URL pública al comprobante.</p>') +
            '<div class="flex flex-wrap gap-2 pt-1">' +
            '<button type="button" data-ep-proof-approve="' + row.id + '" class="btn-glow rounded-xl py-2 px-3 text-xs font-semibold">Aprobar y verificar cobro</button>' +
            '<button type="button" data-ep-proof-reject="' + row.id + '" class="rounded-xl py-2 px-3 text-xs font-semibold border border-red-400/50 text-red-200">Rechazar</button></div></div>'
          );
        }).join('');
        var htmlHist = other.length
          ? '<h4 class="text-xs font-medium text-white/40 mt-4 mb-2">Historial reciente</h4><div class="text-xs text-white/50 space-y-1.5 max-h-40 overflow-y-auto pr-1">' + other.slice(0, 12).map(function (row) {
            return (
              '<p class="border-b border-white/5 pb-1">' + String(row.created_at).slice(0, 10) + ' · ' + escHtmlCsr(ferriolIngresosPaymentTypeLabel(row.payment_type)) + ' · <span class="text-white/70">' + escHtmlCsr(row.status) + '</span>' +
              (row.ferriol_payment_id ? ' · pago' : '') + '</p>'
            );
          }).join('') + '</div>'
          : '';
        if (!rows.length) {
          clBox.innerHTML = '<p class="text-white/50 text-sm py-4">Nadie cargó un comprobante desde <strong class="text-white/75">Cuenta → Pagar … → Cargar y enviar comprobante</strong>.</p>';
        } else {
          clBox.innerHTML = (htmlPend || '<p class="text-amber-200/90 text-sm py-2">Nada pendiente.</p>') + htmlHist;
        }
      } catch (e) {
        clBox.innerHTML = '<p class="text-red-300 text-sm">Error al cargar. ¿Ejecutaste <code class="text-white/80">supabase-ferriol-empresa-payment-proof-requests.sql</code>? ' + escHtmlCsr(String(e.message || e)) + '</p>';
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    window._ferriolExecEmpresaProofApprove = async function (id, approves, rejectNote, amountOverride) {
      if (!supabaseClient || !isEmpresaLensSuper() || !id) return;
      if (
        !window.confirm(
          approves
            ? '¿Verificar cobro Ferriol y aplicar liquidación/compensaciones como en Cobros manuales?'
            : '¿Rechazar esta solicitud?'
        )
      )
        return;
      var msgEl = document.getElementById('superEmpresaPaymentProofMsg');
      if (msgEl) {
        msgEl.classList.add('hidden');
        msgEl.textContent = '';
      }
      try {
        var rpc = await supabaseClient.rpc('ferriol_approve_empresa_payment_proof_request', {
          p_request_id: id,
          p_approve: approves,
          p_reject_note: approves ? null : (rejectNote != null && rejectNote !== '' ? rejectNote : null),
          p_amount_override: approves && amountOverride != null && !isNaN(amountOverride) ? amountOverride : null
        });
        if (rpc.error) throw rpc.error;
        var out = rpc.data;
        if (typeof out === 'string') {
          try {
            out = JSON.parse(out);
          } catch (_) {}
        }
        if (!out || out.ok !== true) {
          alert((out && out.error) ? out.error : 'No se pudo completar la operación.');
          return;
        }
        if (msgEl) {
          msgEl.textContent = approves ? 'Aprobado. Cobro verificado.' : 'Solicitud rechazada.';
          msgEl.classList.remove('hidden');
        }
        await loadFounderEmpresaPaymentProofPanel();
        await loadFounderClientSaleRequestsPanel();
        scheduleRefreshFerriolSolicitudesBadges();
        if (state.superSection === 'sistema' || state.superSection === 'cobros') await renderSuperCobrosSection();
      } catch (e) {
        alert('Error: ' + (e && e.message ? e.message : e));
      }
    };
    (function setupFounderEmpresaProofDelegation() {
      var box = document.getElementById('superEmpresaPaymentProofBox');
      if (!box) return;
      box.addEventListener('click', function (e) {
        var a = e.target && e.target.closest && e.target.closest('[data-ep-proof-approve]');
        if (a) {
          e.preventDefault();
          var id = a.getAttribute('data-ep-proof-approve');
          var inp = id ? document.getElementById('ep-proof-amt-' + id) : null;
          var raw = inp ? String(inp.value || '').replace(/\./g, '').replace(',', '.') : '';
          var amt = parseFloat(raw, 10);
          if (isNaN(amt) || amt <= 0) {
            alert('Ingresá un monto ARS válido en el recuadro.');
            return;
          }
          void window._ferriolExecEmpresaProofApprove(id, true, null, amt);
          return;
        }
        var rj = e.target && e.target.closest && e.target.closest('[data-ep-proof-reject]');
        if (rj) {
          e.preventDefault();
          var id2 = rj.getAttribute('data-ep-proof-reject');
          var n = typeof window.prompt === 'function' ? window.prompt('Motivo de rechazo (opcional):', '') : '';
          void window._ferriolExecEmpresaProofApprove(id2, false, n || null, null);
        }
      });
    })();
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
        scheduleRefreshFerriolSolicitudesBadges();
        if (state.superSection === 'sistema' || state.superSection === 'cobros') await renderSuperCobrosSection();
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
    function openPartnerWithdrawModal() {
      var m = document.getElementById('partnerWithdrawModal');
      var err = document.getElementById('partnerWithdrawModalErr');
      var amt = document.getElementById('partnerWithdrawAmount');
      if (err) { err.classList.add('hidden'); err.textContent = ''; }
      if (amt) amt.value = '';
      if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closePartnerWithdrawModal() {
      var m = document.getElementById('partnerWithdrawModal');
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    }
    function openFounderWithdrawPayModal(reqId, summaryHtml) {
      var m = document.getElementById('founderWithdrawPayModal');
      var hid = document.getElementById('founderWithdrawPayRequestId');
      var sum = document.getElementById('founderWithdrawPayModalSummary');
      var err = document.getElementById('founderWithdrawPayModalErr');
      var tx = document.getElementById('founderWithdrawPayCongrats');
      var fi = document.getElementById('founderWithdrawPayFile');
      if (err) { err.classList.add('hidden'); err.textContent = ''; }
      if (tx) tx.value = '';
      if (fi) fi.value = '';
      if (hid) hid.value = reqId || '';
      if (sum) sum.innerHTML = summaryHtml || '';
      if (m) { m.classList.remove('hidden'); m.classList.add('flex'); }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function closeFounderWithdrawPayModal() {
      var m = document.getElementById('founderWithdrawPayModal');
      if (m) { m.classList.add('hidden'); m.classList.remove('flex'); }
    }
    function canUserRequestCommissionWithdrawal() {
      return !!(currentUser && (currentUser.role === 'partner' || currentUser.role === 'super') && !isEmpresaLensSuper());
    }
    (function setupPartnerWithdrawAndFounderPayModals() {
      var btnOpen = document.getElementById('btnPartnerWithdrawOpen');
      if (btnOpen) {
        btnOpen.addEventListener('click', function () {
          if (!canUserRequestCommissionWithdrawal()) {
            try { alert('No podés pedir retiro en esta vista. Usá la cuenta de administrador o la vista administración del fundador.'); } catch (_) {}
            return;
          }
          openPartnerWithdrawModal();
        });
      }
      var pwClose = document.getElementById('partnerWithdrawModalClose');
      var pwOv = document.getElementById('partnerWithdrawModalOverlay');
      if (pwClose) pwClose.addEventListener('click', closePartnerWithdrawModal);
      if (pwOv) pwOv.addEventListener('click', closePartnerWithdrawModal);
      var pwSub = document.getElementById('partnerWithdrawModalSubmit');
      if (pwSub) {
        pwSub.addEventListener('click', async function () {
          var err = document.getElementById('partnerWithdrawModalErr');
          var amtIn = document.getElementById('partnerWithdrawAmount');
          if (err) { err.classList.add('hidden'); err.textContent = ''; }
          if (!supabaseClient || !canUserRequestCommissionWithdrawal()) {
            if (err) { err.textContent = 'Solo podés pedir retiros como partner o fundador en vista administración (no en vista empresa).'; err.classList.remove('hidden'); }
            return;
          }
          var raw = amtIn ? String(amtIn.value || '').replace(/\./g, '').replace(',', '.') : '';
          var amt = parseFloat(raw, 10);
          if (isNaN(amt) || amt <= 0) {
            if (err) { err.textContent = 'Ingresá un monto válido en ARS.'; err.classList.remove('hidden'); }
            return;
          }
          pwSub.disabled = true;
          try {
            var rpc = await supabaseClient.rpc('ferriol_partner_create_withdrawal_request', { p_amount_ars: amt });
            if (rpc.error) throw rpc.error;
            var out = rpc.data;
            if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
            if (!out || out.ok !== true) {
              if (err) { err.textContent = (out && out.error) ? out.error : 'No se pudo crear la solicitud.'; err.classList.remove('hidden'); }
              return;
            }
            closePartnerWithdrawModal();
            await loadPartnerBilleteraSection();
            alert('Solicitud enviada. La empresa revisará que tengas fondos y te avisará.');
          } catch (e) {
            if (err) { err.textContent = String(e.message || e); err.classList.remove('hidden'); }
          } finally {
            pwSub.disabled = false;
          }
        });
      }
      var fpClose = document.getElementById('founderWithdrawPayModalClose');
      var fpOv = document.getElementById('founderWithdrawPayModalOverlay');
      if (fpClose) fpClose.addEventListener('click', closeFounderWithdrawPayModal);
      if (fpOv) fpOv.addEventListener('click', closeFounderWithdrawPayModal);
      var fpSub = document.getElementById('founderWithdrawPayModalSubmit');
      if (fpSub) {
        fpSub.addEventListener('click', async function () {
          var err = document.getElementById('founderWithdrawPayModalErr');
          var hid = document.getElementById('founderWithdrawPayRequestId');
          var fi = document.getElementById('founderWithdrawPayFile');
          var tx = document.getElementById('founderWithdrawPayCongrats');
          if (err) { err.classList.add('hidden'); err.textContent = ''; }
          if (!supabaseClient || !isEmpresaLensSuper()) {
            if (err) { err.textContent = 'Solo la cuenta fundador puede registrar el pago.'; err.classList.remove('hidden'); }
            return;
          }
          var reqId = hid ? String(hid.value || '').trim() : '';
          var file = fi && fi.files && fi.files[0];
          if (!reqId) {
            if (err) { err.textContent = 'Falta el identificador de la solicitud.'; err.classList.remove('hidden'); }
            return;
          }
          if (!file) {
            if (err) { err.textContent = 'Adjuntá el comprobante de transferencia.'; err.classList.remove('hidden'); }
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            if (err) { err.textContent = 'La imagen supera 5 MB.'; err.classList.remove('hidden'); }
            return;
          }
          var msg = tx ? String(tx.value || '').trim() : '';
          fpSub.disabled = true;
          try {
            var ext = (file.name && file.name.lastIndexOf('.') > 0) ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '.jpg';
            if (ext.length > 6) ext = '.jpg';
            var fileId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
            var path = 'withdrawal-proofs/' + reqId + '/' + fileId + ext;
            var up = await supabaseClient.storage.from('comprobantes-ferriol').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
            if (up.error) throw up.error;
            var rpc = await supabaseClient.rpc('ferriol_founder_mark_withdrawal_paid', {
              p_request_id: reqId,
              p_proof_path: path,
              p_congrats_message: msg || null
            });
            if (rpc.error) {
              try { await supabaseClient.storage.from('comprobantes-ferriol').remove([path]); } catch (_) {}
              throw rpc.error;
            }
            var out = rpc.data;
            if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
            if (!out || out.ok !== true) {
              try { await supabaseClient.storage.from('comprobantes-ferriol').remove([path]); } catch (_) {}
              if (err) { err.textContent = (out && out.error) ? out.error : 'No se pudo registrar el pago.'; err.classList.remove('hidden'); }
              return;
            }
            closeFounderWithdrawPayModal();
            await loadFounderPagosPendientesSection();
            scheduleRefreshFerriolSolicitudesBadges();
            alert('Pago registrado. El socio verá la solicitud como pagada y se actualizará su billetera.');
          } catch (e) {
            if (err) { err.textContent = String(e.message || e); err.classList.remove('hidden'); }
          } finally {
            fpSub.disabled = false;
          }
        });
      }
    })();
    async function loadPartnerBilleteraSection() {
      var av = document.getElementById('partnerWalletAvailable');
      var br = document.getElementById('partnerWalletBreakdown');
      var hist = document.getElementById('partnerWithdrawHistory');
      var btnW = document.getElementById('btnPartnerWithdrawOpen');
      if (!av || !hist) return;
      if (!supabaseClient || !currentUser || !isPartnerLens() || isEmpresaLensSuper()) {
        av.textContent = '—';
        if (br) br.textContent = '';
        if (btnW) { btnW.disabled = true; btnW.classList.add('opacity-50'); btnW.removeAttribute('title'); }
        if (hist) {
          hist.innerHTML = '<p class="text-white/45 text-xs py-2 text-center">—</p>';
        }
        return;
      }
      av.textContent = '…';
      if (br) br.textContent = '';
      hist.innerHTML = '<p class="text-white/45 text-xs py-2 text-center">Cargando…</p>';
      try {
        var balRpc = await supabaseClient.rpc('ferriol_partner_withdrawable_balance', { p_partner_id: currentUser.id });
        if (balRpc.error) throw balRpc.error;
        var bal = Number(balRpc.data != null ? balRpc.data : 0);
        av.textContent = '$ ' + bal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ARS';
        var led = await supabaseClient.from('mlm_ledger').select('amount').eq('beneficiary_user_id', currentUser.id).in('event_type', ['sale_commission', 'renewal']).in('status', ['approved', 'paid']);
        if (led.error) throw led.error;
        var ingresosTotal = 0;
        (led.data || []).forEach(function (L) { ingresosTotal += Number(L.amount || 0); });
        var rqTotals = await supabaseClient.from('ferriol_partner_withdrawal_requests').select('amount_ars, status').eq('partner_user_id', currentUser.id);
        if (rqTotals.error) throw rqTotals.error;
        var historialComprometido = 0;
        var paidSum = 0;
        (rqTotals.data || []).forEach(function (w) {
          var a = Number(w.amount_ars || 0);
          if (w.status !== 'rejected') historialComprometido += a;
          if (w.status === 'paid') paidSum += a;
        });
        if (br) {
          br.innerHTML =
            'Comisiones en libro (sale_commission + renewal, approved o paid, histórico): $ ' +
            ingresosTotal.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
            ' · Retiros en historial (pagados + en trámite, sin rechazados): $ ' +
            historialComprometido.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) +
            ' · Ya transferido a vos: $ ' +
            paidSum.toLocaleString('es-AR', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
        }
        var rq = await supabaseClient.from('ferriol_partner_withdrawal_requests').select('*').eq('partner_user_id', currentUser.id).order('created_at', { ascending: false }).limit(40);
        if (rq.error) throw rq.error;
        var rows = rq.data || [];
        if (btnW) {
          if (currentUser.role === 'partner' || currentUser.role === 'super') {
            btnW.disabled = false;
            btnW.classList.remove('opacity-50');
            btnW.removeAttribute('title');
          } else {
            btnW.disabled = true;
            btnW.classList.add('opacity-50');
            btnW.setAttribute('title', 'Solo cuentas partner o fundador (vista administración) pueden solicitar retiro.');
          }
        }
        if (currentUser.role === 'super' && isSuperSocioLens() && br) {
          br.innerHTML = '<p class="text-[10px] text-amber-200/90 mb-1.5">Cuenta fundador (vista administración): ves el saldo de tu usuario. Para pedir retiros a la empresa hace falta una cuenta con rol <strong class="text-amber-100/90">partner</strong>.</p>' + br.innerHTML;
        }
        if (currentUser.role === 'partner' && bal === 0 && ingresosTotal === 0 && br) {
          br.innerHTML += '<p class="text-[10px] text-white/35 mt-1.5">Si creés que deberías tener saldo: corré de nuevo <code class="text-white/50">supabase-ferriol-partner-withdrawals.sql</code> en Supabase (funciones) y revisá en <code class="text-white/50">mlm_ledger</code> que tu usuario sea <code class="text-white/50">beneficiary_user_id</code> con <code class="text-white/50">sale_commission</code> o <code class="text-white/50">renewal</code> y estado <code class="text-white/50">approved</code>/<code class="text-white/50">paid</code>. Forzá recarga del sitio (Ctrl+F5) por si el navegador usa un <code class="text-white/50">kiosco-app.js</code> viejo.</p>';
        }
        if (!rows.length) {
          hist.innerHTML = '<p class="text-xs text-white/45 py-3 text-center">Todavía no tenés solicitudes de retiro.</p>';
        } else {
          hist.innerHTML = '<div class="space-y-2 max-h-[40vh] overflow-y-auto">' + rows.map(function (w) {
            var st = w.status === 'paid' ? 'text-emerald-200' : w.status === 'rejected' ? 'text-red-200/90' : w.status === 'approved_pending_payout' ? 'text-cyan-200' : 'text-amber-200';
            var lab = w.status === 'pending_review' ? 'En revisión empresa' : w.status === 'approved_pending_payout' ? 'Aprobado · pendiente transferencia' : w.status === 'paid' ? 'Pagado' : 'Rechazado';
            var dt = String(w.created_at || '').slice(0, 16).replace('T', ' ');
            var extra = '';
            if (w.status === 'paid' && w.founder_congrats_message) extra = '<p class="text-[10px] text-emerald-100/80 mt-1">' + String(w.founder_congrats_message).replace(/</g, '&lt;') + '</p>';
            if (w.status === 'rejected' && w.reject_note) extra = '<p class="text-[10px] text-red-200/80 mt-1">Motivo: ' + String(w.reject_note).replace(/</g, '&lt;') + '</p>';
            return '<div class="rounded-lg border border-white/10 bg-black/25 px-3 py-2"><p class="text-xs"><span class="' + st + ' font-medium">' + lab + '</span> · ' + dt + '</p><p class="text-sm text-white/90 font-semibold">$ ' + Number(w.amount_ars || 0).toLocaleString('es-AR') + ' ARS</p>' + extra + '</div>';
          }).join('') + '</div>';
        }
      } catch (e) {
        av.textContent = '—';
        if (btnW && isPartnerLens() && !isEmpresaLensSuper()) {
          var canW = currentUser.role === 'partner' || currentUser.role === 'super';
          btnW.disabled = !canW;
          btnW.classList.toggle('opacity-50', !canW);
        }
        hist.innerHTML = '<p class="text-red-300/90 text-xs py-2">No se pudo cargar la billetera. ¿Ejecutaste <code class="text-white/80">supabase-ferriol-partner-withdrawals.sql</code>? ' + String(e.message || e) + '</p>';
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
      scheduleRefreshFerriolSolicitudesBadges();
    }
    async function loadFounderWithdrawalReviewList() {
      var box = document.getElementById('founderWithdrawalReviewBox');
      var list = document.getElementById('founderWithdrawalReviewList');
      if (!box || !list || !supabaseClient || !isEmpresaLensSuper()) return;
      list.innerHTML = '<p class="text-white/45 text-xs py-2">Cargando…</p>';
      try {
        var r = await supabaseClient.from('ferriol_partner_withdrawal_requests').select('*').eq('status', 'pending_review').order('created_at', { ascending: true }).limit(50);
        if (r.error) throw r.error;
        var rows = r.data || [];
        if (!rows.length) {
          list.innerHTML = '<p class="text-xs text-white/45 py-2">No hay retiros pendientes de revisión.</p>';
          return;
        }
        var pool = window._ferriolAllProfilesCache || [];
        function nameOf(id) {
          var p = pool.find(function (x) { return x.id === id; });
          return p ? ((p.kiosco_name || '').trim() || p.email || id) : id;
        }
        var parts = [];
        for (var i = 0; i < rows.length; i++) {
          var row = rows[i];
          var balRpc = await supabaseClient.rpc('ferriol_partner_withdrawable_balance', { p_partner_id: row.partner_user_id });
          var bal = (balRpc.error || balRpc.data == null) ? null : Number(balRpc.data);
          var nm = String(nameOf(row.partner_user_id)).replace(/</g, '&lt;');
          var dt = String(row.created_at || '').slice(0, 16).replace('T', ' ');
          var balStr = bal != null ? ('$ ' + bal.toLocaleString('es-AR', { minimumFractionDigits: 2 }) + ' ARS disponibles') : '—';
          parts.push(
            '<div class="rounded-xl border border-white/15 bg-black/30 p-3">' +
            '<p class="text-sm text-white/90 font-medium">' + nm + '</p>' +
            '<p class="text-xs text-white/55">' + dt + '</p>' +
            '<p class="text-lg font-bold text-amber-100 mt-1">$ ' + Number(row.amount_ars || 0).toLocaleString('es-AR') + ' ARS</p>' +
            '<p class="text-[10px] text-cyan-200/80 mt-1">Saldo retirable (estim.): ' + balStr + '</p>' +
            '<div class="flex flex-wrap gap-2 mt-2">' +
            '<button type="button" class="ferriol-wr-approve btn-glow rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target" data-wr-id="' + row.id + '">Aprobar (pasa a Pagos)</button>' +
            '<button type="button" class="ferriol-wr-reject rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target border border-red-400/50 text-red-200" data-wr-id="' + row.id + '">Rechazar</button>' +
            '</div></div>'
          );
        }
        list.innerHTML = parts.join('');
        list.querySelectorAll('.ferriol-wr-approve').forEach(function (btn) {
          btn.onclick = async function () {
            var id = btn.getAttribute('data-wr-id');
            if (!id || !confirm('¿Aprobar este retiro? Pasará a Pagos pendientes para transferir y adjuntar comprobante.')) return;
            var rpc = await supabaseClient.rpc('ferriol_founder_review_partner_withdrawal', { p_request_id: id, p_approve: true, p_reject_note: null });
            if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
            var out = rpc.data;
            if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
            if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo aprobar.'); return; }
            await loadFounderWithdrawalReviewList();
            await loadFounderPagosPendientesSection();
          };
        });
        list.querySelectorAll('.ferriol-wr-reject').forEach(function (btn) {
          btn.onclick = async function () {
            var id = btn.getAttribute('data-wr-id');
            if (!id) return;
            var note = (typeof window.prompt === 'function') ? window.prompt('Motivo del rechazo (opcional):', '') : '';
            if (note === null) return;
            var rpc = await supabaseClient.rpc('ferriol_founder_review_partner_withdrawal', { p_request_id: id, p_approve: false, p_reject_note: note || null });
            if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
            var out = rpc.data;
            if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
            if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo rechazar.'); return; }
            await loadFounderWithdrawalReviewList();
          };
        });
      } catch (e) {
        list.innerHTML = '<p class="text-red-300/90 text-xs py-2">' + String(e.message || e) + '</p>';
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
      scheduleRefreshFerriolSolicitudesBadges();
    }
    async function loadFounderPagosPendientesSection() {
      var wrap = document.getElementById('founderPagosPendientesList');
      if (!wrap || !supabaseClient || !isEmpresaLensSuper()) return;
      wrap.innerHTML = '<p class="text-white/45 text-xs py-4 text-center">Cargando…</p>';
      try {
        var r = await supabaseClient.from('ferriol_partner_withdrawal_requests').select('*').eq('status', 'approved_pending_payout').order('created_at', { ascending: true }).limit(80);
        if (r.error) throw r.error;
        var rows = r.data || [];
        if (!rows.length) {
          wrap.innerHTML = '<p class="text-xs text-white/45 py-6 text-center">No hay pagos pendientes. Los retiros aprobados en Solicitudes aparecen acá.</p>';
          return;
        }
        var ids = Array.from(new Set(rows.map(function (x) { return x.partner_user_id; }).filter(Boolean)));
        var pr = await supabaseClient.from('profiles').select('id, email, kiosco_name, partner_transfer_info').in('id', ids);
        var byId = {};
        (pr.data || []).forEach(function (p) { if (p && p.id) byId[p.id] = p; });
        wrap.innerHTML = rows.map(function (row) {
          var p = byId[row.partner_user_id] || {};
          var legal = ((p.kiosco_name || '').trim() || p.email || '—').replace(/</g, '&lt;');
          var bank = (p.partner_transfer_info != null && String(p.partner_transfer_info).trim()) ? String(p.partner_transfer_info).replace(/</g, '&lt;').replace(/\n/g, '<br>') : '<span class="text-amber-200/90">Sin datos bancarios cargados en Más · pedile al socio que los complete.</span>';
          var dt = String(row.created_at || '').slice(0, 16).replace('T', ' ');
          return '<div class="rounded-xl border border-cyan-500/35 bg-black/25 p-4 space-y-2">' +
            '<p class="text-sm font-semibold text-white/90">Socio: ' + legal + '</p>' +
            '<p class="text-xs text-white/50">' + (p.email ? String(p.email).replace(/</g, '&lt;') : '') + '</p>' +
            '<p class="text-lg font-bold text-[#86efac]">$ ' + Number(row.amount_ars || 0).toLocaleString('es-AR') + ' ARS</p>' +
            '<p class="text-[10px] text-amber-200/90">Verificá que el titular de la cuenta coincida con: <strong class="text-white/80">' + legal + '</strong></p>' +
            '<div class="text-xs text-white/75 bg-black/30 rounded-lg p-3 border border-white/10 max-h-40 overflow-y-auto">' + bank + '</div>' +
            '<p class="text-[10px] text-white/45">Solicitado: ' + dt + '</p>' +
            '<button type="button" class="ferriol-wr-pay w-full btn-glow rounded-xl py-2.5 text-sm font-semibold touch-target" data-wr-pay-id="' + row.id + '" data-wr-pay-name="' + legal.replace(/"/g, '&quot;') + '" data-wr-pay-amt="' + String(Number(row.amount_ars || 0)) + '">Registrar transferencia y comprobante</button>' +
            '</div>';
        }).join('');
        wrap.querySelectorAll('.ferriol-wr-pay').forEach(function (btn) {
          btn.addEventListener('click', function () {
            var id = btn.getAttribute('data-wr-pay-id');
            var nm = btn.getAttribute('data-wr-pay-name') || '';
            var am = btn.getAttribute('data-wr-pay-amt') || '';
            openFounderWithdrawPayModal(id, '<strong>Monto:</strong> $ ' + Number(am).toLocaleString('es-AR') + ' ARS<br><strong>Socio:</strong> ' + nm);
          });
        });
      } catch (e) {
        wrap.innerHTML = '<p class="text-red-300/90 text-sm py-4">' + String(e.message || e) + '</p>';
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    async function loadSuperSolicitudesSection() {
      try {
        var clBox = document.getElementById('superClientSaleRequestsList');
        var clWrap = document.getElementById('superClientSaleRequestsBox');
        if (!supabaseClient || !currentUser) {
          if (clBox) clBox.innerHTML = '';
          if (clWrap) clWrap.classList.add('hidden');
          var epBx0 = document.getElementById('superEmpresaPaymentProofBox');
          var epIn0 = document.getElementById('superEmpresaPaymentProofList');
          if (epIn0) epIn0.innerHTML = '';
          if (epBx0) epBx0.classList.add('hidden');
          syncFounderSolicitudesTabShell();
          syncPartnerSolicitudesTabShell();
          return;
        }
        if (isPartnerLens() && !isEmpresaLensSuper()) {
          void loadPartnerBilleteraSection();
        }
        if (isEmpresaLensSuper() && clWrap) {
          await loadFounderClientSaleRequestsPanel();
        } else {
          if (clBox) clBox.innerHTML = '';
          if (clWrap) clWrap.classList.add('hidden');
        }
        var epBox = document.getElementById('superEmpresaPaymentProofBox');
        var epInner = document.getElementById('superEmpresaPaymentProofList');
        if (isEmpresaLensSuper()) {
          await loadFounderEmpresaPaymentProofPanel();
        } else {
          if (epInner) epInner.innerHTML = '';
          if (epBox) epBox.classList.add('hidden');
        }
        if (!isEmpresaLensSuper()) {
          syncFounderSolicitudesTabShell();
          syncPartnerSolicitudesTabShell();
          return;
        }
        void loadFounderWithdrawalReviewList();
        try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
        syncFounderSolicitudesTabShell();
        syncPartnerSolicitudesTabShell();
      } finally {
        scheduleRefreshFerriolSolicitudesBadges();
      }
    }
    function switchFounderSolicitudesTab(tabId) {
      var valid = { retiros: 1, ventas: 1, empresa: 1, aprobaciones: 1 };
      var bar = document.getElementById('founderSolicitudesTabBar');
      if (!bar || !valid[tabId]) return;
      try { sessionStorage.setItem('ferriol_founder_solic_tab', tabId); } catch (_) {}
      bar.querySelectorAll('.founder-solic-tab').forEach(function (btn) {
        var on = btn.getAttribute('data-solicitud-tab') === tabId;
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) {
          btn.style.border = '1px solid rgba(34, 197, 94, 0.55)';
          btn.style.background = 'rgba(34, 197, 94, 0.22)';
          btn.style.color = '#ffffff';
        } else {
          btn.style.border = '1px solid transparent';
          btn.style.background = 'transparent';
          btn.style.color = 'rgba(255, 255, 255, 0.55)';
        }
      });
      document.querySelectorAll('#super-section-solicitudes .ferriol-solic-fundador-pane').forEach(function (pane) {
        var k = pane.getAttribute('data-solicitud-pane');
        var show = k === tabId;
        if (show) {
          pane.classList.remove('hidden');
          pane.style.removeProperty('display');
          if (pane.classList.contains('super-only')) {
            pane.style.display = pane.tagName === 'BUTTON' ? 'inline-flex' : 'block';
          }
        } else {
          pane.classList.add('hidden');
          pane.style.setProperty('display', 'none', 'important');
        }
      });
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function syncFounderSolicitudesTabShell() {
      var bar = document.getElementById('founderSolicitudesTabBar');
      if (!bar) return;
      if (!isEmpresaLensSuper()) {
        bar.classList.add('hidden');
        return;
      }
      bar.classList.remove('hidden');
      var pref = '';
      try { pref = sessionStorage.getItem('ferriol_founder_solic_tab') || ''; } catch (_) {}
      var valid = { retiros: 1, ventas: 1, empresa: 1, aprobaciones: 1 };
      if (!valid[pref]) pref = 'retiros';
      switchFounderSolicitudesTab(pref);
    }
    function switchPartnerSolicitudesTab(tabId) {
      var bar = document.getElementById('partnerSolicitudesTabBar');
      var bPan = document.getElementById('partnerSolicPaneBilletera');
      var tPan = document.getElementById('partnerSolicPaneTramites');
      if (!bar || !bPan || !tPan) return;
      if (tabId !== 'billetera' && tabId !== 'tramites') return;
      try { sessionStorage.setItem('ferriol_partner_solic_tab', tabId); } catch (_) {}
      bar.querySelectorAll('.partner-solic-tab').forEach(function (btn) {
        var on = btn.getAttribute('data-partner-solic-tab') === tabId;
        btn.setAttribute('aria-selected', on ? 'true' : 'false');
        if (on) {
          btn.style.border = '1px solid rgba(34, 197, 94, 0.55)';
          btn.style.background = 'rgba(34, 197, 94, 0.22)';
          btn.style.color = '#ffffff';
        } else {
          btn.style.border = '1px solid transparent';
          btn.style.background = 'transparent';
          btn.style.color = 'rgba(255, 255, 255, 0.55)';
        }
      });
      var showWallet = tabId === 'billetera';
      if (showWallet) {
        bPan.classList.remove('hidden');
        bPan.style.removeProperty('display');
        tPan.classList.add('hidden');
        tPan.style.setProperty('display', 'none', 'important');
      } else {
        bPan.classList.add('hidden');
        bPan.style.setProperty('display', 'none', 'important');
        tPan.classList.remove('hidden');
        tPan.style.removeProperty('display');
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }
    function syncPartnerSolicitudesTabShell() {
      var bar = document.getElementById('partnerSolicitudesTabBar');
      var pan = document.getElementById('partnerBilleteraPanel');
      if (!bar) return;
      if (!currentUser || !isPartnerLens() || isEmpresaLensSuper() || !isNetworkAdminRole(currentUser.role) || isAnyKioscoPreviewMode()) {
        bar.classList.add('hidden');
        return;
      }
      if (pan && pan.style.display === 'none') {
        bar.classList.add('hidden');
        return;
      }
      bar.classList.remove('hidden');
      var pref = '';
      try { pref = sessionStorage.getItem('ferriol_partner_solic_tab') || ''; } catch (_) {}
      if (pref !== 'tramites') pref = 'billetera';
      switchPartnerSolicitudesTab(pref);
    }
    (function wireSolicitudesSubTabs() {
      var fb = document.getElementById('founderSolicitudesTabBar');
      if (fb) {
        fb.addEventListener('click', function (e) {
          var t = e.target && e.target.closest && e.target.closest('[data-solicitud-tab]');
          if (!t || !fb.contains(t)) return;
          var id = t.getAttribute('data-solicitud-tab');
          if (id) switchFounderSolicitudesTab(id);
        });
      }
      var pb = document.getElementById('partnerSolicitudesTabBar');
      if (pb) {
        pb.addEventListener('click', function (e) {
          var t = e.target && e.target.closest && e.target.closest('[data-partner-solic-tab]');
          if (!t || !pb.contains(t)) return;
          var id = t.getAttribute('data-partner-solic-tab');
          if (id) switchPartnerSolicitudesTab(id);
        });
      }
    })();

    var _ferriolSolBadgeRealtimeCh = null;
    var _ferriolSolBadgeRealtimeUserId = null;
    var _ferriolSolicBadgeDebounceTimer = null;

    function ferriolSolicBadgeSet(el, n) {
      if (!el) return;
      var v = typeof n === 'number' ? n : parseInt(String(n || ''), 10);
      if (!isFinite(v) || v < 0) v = 0;
      if (v <= 0) {
        el.textContent = '';
        el.classList.add('hidden');
        el.setAttribute('aria-hidden', 'true');
        return;
      }
      el.textContent = v > 99 ? '99+' : String(v);
      el.classList.remove('hidden');
      el.setAttribute('aria-hidden', 'false');
    }

    function ferriolClearAllSolicitudesBadges() {
      ferriolSolicBadgeSet(document.getElementById('navSuperSolicitudesBadge'), 0);
      document.querySelectorAll('[data-founder-solic-badge]').forEach(function (b) { ferriolSolicBadgeSet(b, 0); });
      document.querySelectorAll('[data-partner-solic-badge]').forEach(function (b) { ferriolSolicBadgeSet(b, 0); });
    }

    function ferriolTearDownSolicitudesBadgeRealtime() {
      if (_ferriolSolBadgeRealtimeCh && supabaseClient) {
        try {
          supabaseClient.removeChannel(_ferriolSolBadgeRealtimeCh);
        } catch (_) {}
      }
      _ferriolSolBadgeRealtimeCh = null;
      _ferriolSolBadgeRealtimeUserId = null;
    }

    function scheduleRefreshFerriolSolicitudesBadges() {
      if (_ferriolSolicBadgeDebounceTimer) clearTimeout(_ferriolSolicBadgeDebounceTimer);
      _ferriolSolicBadgeDebounceTimer = setTimeout(function () {
        _ferriolSolicBadgeDebounceTimer = null;
        void refreshFerriolSolicitudesBadges();
      }, 380);
    }

    async function ferriolSolicBadgeCount(rowsPromise) {
      try {
        var r = await rowsPromise;
        if (r.error || typeof r.count !== 'number') return 0;
        return r.count;
      } catch (_) {
        return 0;
      }
    }

    function ferriolWireSolicitudesBadgeRealtimeIfNeeded() {
      if (!supabaseClient || !currentUser || !currentUser.id) return;
      if (!isNetworkAdminRole(currentUser.role) || isAnyKioscoPreviewMode()) return;
      if (_ferriolSolBadgeRealtimeUserId === currentUser.id && _ferriolSolBadgeRealtimeCh) return;
      ferriolTearDownSolicitudesBadgeRealtime();
      _ferriolSolBadgeRealtimeUserId = currentUser.id;
      var tables = [
        'ferriol_partner_withdrawal_requests',
        'ferriol_client_sale_requests',
        'ferriol_empresa_payment_proof_requests',
        'ferriol_membership_day_requests',
        'ferriol_partner_provision_requests',
        'ferriol_kiosquero_provision_requests',
        'ferriol_kiosquero_partner_upgrade_requests'
      ];
      var ch = supabaseClient.channel('ferriol-solic-badges:' + currentUser.id);
      tables.forEach(function (tbl) {
        ch.on('postgres_changes', { event: '*', schema: 'public', table: tbl }, function () {
          scheduleRefreshFerriolSolicitudesBadges();
        });
      });
      try {
        ch.subscribe();
      } catch (_) {}
      _ferriolSolBadgeRealtimeCh = ch;
    }

    async function refreshFerriolSolicitudesBadges() {
      var navBd = document.getElementById('navSuperSolicitudesBadge');
      if (!supabaseClient || !currentUser || !isNetworkAdminRole(currentUser.role) || isAnyKioscoPreviewMode()) {
        ferriolClearAllSolicitudesBadges();
        return;
      }
      if (isEmpresaLensSuper()) {
        var cW,
          cCs,
          cEp,
          cMd,
          cPp,
          cKp,
          cKu;
        try {
          var counts = await Promise.all([
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_partner_withdrawal_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending_review')),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_client_sale_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_empresa_payment_proof_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_membership_day_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_partner_provision_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_kiosquero_provision_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending')),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_kiosquero_partner_upgrade_requests').select('id', { count: 'exact', head: true }).eq('status', 'pending'))
          ]);
          cW = counts[0];
          cCs = counts[1];
          cEp = counts[2];
          cMd = counts[3];
          cPp = counts[4];
          cKp = counts[5];
          cKu = counts[6];
        } catch (_) {
          ferriolClearAllSolicitudesBadges();
          return;
        }
        var cApr = cMd + cPp + cKp + cKu;
        var total = cW + cCs + cEp + cApr;
        ferriolSolicBadgeSet(navBd, total);
        ferriolSolicBadgeSet(document.querySelector('[data-founder-solic-badge="retiros"]'), cW);
        ferriolSolicBadgeSet(document.querySelector('[data-founder-solic-badge="ventas"]'), cCs);
        ferriolSolicBadgeSet(document.querySelector('[data-founder-solic-badge="empresa"]'), cEp);
        ferriolSolicBadgeSet(document.querySelector('[data-founder-solic-badge="aprobaciones"]'), cApr);
        ferriolSolicBadgeSet(document.querySelector('[data-partner-solic-badge="billetera"]'), 0);
        ferriolSolicBadgeSet(document.querySelector('[data-partner-solic-badge="tramites"]'), 0);
        try {
          if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
        } catch (_) {}
        return;
      }
      if (isPartnerLens() && !isEmpresaLensSuper()) {
        var uid = currentUser.id;
        var b, t;
        try {
          var pCounts = await Promise.all([
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_partner_withdrawal_requests').select('id', { count: 'exact', head: true }).eq('partner_user_id', uid).in('status', ['pending_review', 'approved_pending_payout'])),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_membership_day_requests').select('id', { count: 'exact', head: true }).eq('requested_by', uid).eq('status', 'pending')),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_partner_provision_requests').select('id', { count: 'exact', head: true }).eq('requested_by', uid).eq('status', 'pending')),
            ferriolSolicBadgeCount(supabaseClient.from('ferriol_kiosquero_provision_requests').select('id', { count: 'exact', head: true }).eq('requested_by', uid).eq('status', 'pending'))
          ]);
          b = pCounts[0];
          t = pCounts[1] + pCounts[2] + pCounts[3];
        } catch (_) {
          ferriolClearAllSolicitudesBadges();
          return;
        }
        ferriolSolicBadgeSet(document.querySelector('[data-partner-solic-badge="billetera"]'), b);
        ferriolSolicBadgeSet(document.querySelector('[data-partner-solic-badge="tramites"]'), t);
        ferriolSolicBadgeSet(navBd, b + t);
        document.querySelectorAll('[data-founder-solic-badge]').forEach(function (el) { ferriolSolicBadgeSet(el, 0); });
        try {
          if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
        } catch (_) {}
        return;
      }
      ferriolClearAllSolicitudesBadges();
    }

    function ferriolKioscoSponsorHintHtml() {
      if (!currentUser || !currentUser.sponsorId) {
        return 'No figura referidor en tu perfil. Pedí en administración si hace falta.';
      }
      return null;
    }
    /** Lee datos de contacto del sponsor (nombre, mail, WhatsApp). Sin partner_transfer_info: los datos bancarios del socio no se muestran al referido. */
    async function ferriolResolveSponsorProfile(profile) {
      profile = profile || currentUser;
      if (!profile || !supabaseClient) return null;
      var sid = profile.sponsor_id != null ? profile.sponsor_id : profile.sponsorId;
      if (!sid) return null;
      var useRpc = !!(profile.id && currentUser && profile.id === currentUser.id && profile.role === 'kiosquero');
      if (useRpc) {
        try {
          var rpc = await supabaseClient.rpc('ferriol_get_my_sponsor_display');
          if (!rpc.error && rpc.data !== null && rpc.data !== undefined) {
            var row = Array.isArray(rpc.data) ? rpc.data[0] : rpc.data;
            if (row && typeof row === 'object') return row;
          }
        } catch (_) {}
      }
      try {
        var fq = await supabaseClient.from('profiles').select('kiosco_name, email, role, phone').eq('id', sid).maybeSingle();
        if (!fq.error && fq.data) return fq.data;
      } catch (_) {}
      return null;
    }
    async function ferriolFetchSponsorHintText() {
      var fallback = ferriolKioscoSponsorHintHtml();
      if (fallback !== null) return { html: fallback, ok: true, partnerTransferInfo: '' };
      if (!supabaseClient) return { html: 'Configurá Supabase para ver datos del referidor.', ok: false, partnerTransferInfo: '' };
      try {
        var d = await ferriolResolveSponsorProfile(currentUser);
        if (!d) return { html: 'Consultá con el administrador por el contacto de tu red.', ok: true, partnerTransferInfo: '' };
        var nm = (d.kiosco_name || '').trim() || (d.email ? String(d.email).split('@')[0] : '') || '—';
        var roleL = d.role === 'super' ? 'Administrador' : (d.role === 'partner' ? 'Socio vendedor' : 'Referidor');
        var em = d.email ? String(d.email).replace(/</g, '&lt;').replace(/&/g, '&amp;') : '';
        var nmEsc = String(nm).replace(/</g, '&lt;').replace(/&/g, '&amp;');
        var html = '<span class="text-white/50">Nombre en la red · </span><strong class="text-[#86efac]/95">' + nmEsc + '</strong>' + (em ? ' · <span class="text-white/55">' + em + '</span>' : '') + ' <span class="text-white/40">· ' + roleL + '</span>';
        return { html: html, ok: true, partnerTransferInfo: '' };
      } catch (_) {
        return { html: 'Consultá con el administrador quién es tu referidor.', ok: false, partnerTransferInfo: '' };
      }
    }
    function ferriolMercadoPagoUrlsDefault() {
      return { kit: '', kioscoMonthly: '', vendorMonthly: '' };
    }
    function ferriolNormalizeMercadoPagoUrl(raw) {
      var s = typeof raw === 'string' ? raw.trim() : String(raw || '').trim();
      if (!s) return '';
      var u = s;
      if (!/^https?:\/\//i.test(u) && /^[\w.-]+\.[a-z]{2,}(\/.*)?$/i.test(u.replace(/^\/*/, ''))) {
        u = 'https://' + u.replace(/^\/+/, '');
      }
      return /^https?:\/\//i.test(u) ? u : '';
    }
    function ferriolMergeMercadoPagoSettingsRows(rows) {
      var out = ferriolMercadoPagoUrlsDefault();
      var jsonRow = (rows || []).filter(function (r) {
        return r.key === 'ferriol_mercadopago_checkout_urls';
      })[0];
      var legacyRow = (rows || []).filter(function (r) {
        return r.key === 'ferriol_mercadopago_checkout_url';
      })[0];
      if (jsonRow && jsonRow.value != null && String(jsonRow.value).trim() !== '') {
        try {
          var p = typeof jsonRow.value === 'string' ? JSON.parse(jsonRow.value) : jsonRow.value;
          if (p && typeof p === 'object') {
            if (p.kit != null) out.kit = String(p.kit).trim();
            if (p.kioscoMonthly != null) out.kioscoMonthly = String(p.kioscoMonthly).trim();
            if (p.vendorMonthly != null) out.vendorMonthly = String(p.vendorMonthly).trim();
          }
        } catch (_) {}
      }
      if (legacyRow && legacyRow.value != null && String(legacyRow.value).trim() !== '') {
        var leg = String(legacyRow.value).trim();
        if (!out.kit) out.kit = leg;
        if (!out.kioscoMonthly) out.kioscoMonthly = leg;
        if (!out.vendorMonthly) out.vendorMonthly = leg;
      }
      return out;
    }
    function ferriolApplyMercadoPagoUrlsToWindow(parsedObj) {
      var src = parsedObj && typeof parsedObj === 'object' ? parsedObj : ferriolMercadoPagoUrlsDefault();
      window._ferriolMercadoPagoUrls = {
        kit: ferriolNormalizeMercadoPagoUrl(src.kit || ''),
        kioscoMonthly: ferriolNormalizeMercadoPagoUrl(src.kioscoMonthly || ''),
        vendorMonthly: ferriolNormalizeMercadoPagoUrl(src.vendorMonthly || '')
      };
      var d = window._ferriolMercadoPagoUrls;
      window._ferriolMercadoPagoCheckoutUrl = d.kioscoMonthly || d.kit || d.vendorMonthly || '';
    }
    function ferriolFillAdminMercadoPagoInputsFromMerged(rawMerged) {
      var o = rawMerged && typeof rawMerged === 'object' ? rawMerged : ferriolMercadoPagoUrlsDefault();
      var k = document.getElementById('adminMercadoPagoCheckoutUrlKit');
      var ko = document.getElementById('adminMercadoPagoCheckoutUrlKiosco');
      var v = document.getElementById('adminMercadoPagoCheckoutUrlVendor');
      if (k) k.value = o.kit || '';
      if (ko) ko.value = o.kioscoMonthly || '';
      if (v) v.value = o.vendorMonthly || '';
    }
    function syncMercadoPagoCheckoutUi() {
      var urls = window._ferriolMercadoPagoUrls && typeof window._ferriolMercadoPagoUrls === 'object'
        ? window._ferriolMercadoPagoUrls
        : ferriolMercadoPagoUrlsDefault();
      var map = {
        kit: urls.kit ? ferriolNormalizeMercadoPagoUrl(urls.kit) : '',
        kioscoMonthly: urls.kioscoMonthly ? ferriolNormalizeMercadoPagoUrl(urls.kioscoMonthly) : '',
        vendorMonthly: urls.vendorMonthly ? ferriolNormalizeMercadoPagoUrl(urls.vendorMonthly) : ''
      };
      var ck = typeof window._ferriolPlanCheckoutMode === 'string' ? window._ferriolPlanCheckoutMode : 'pay';
      var isPayPanel = ck === 'pay';
      var adminRole =
        typeof ferriolPlanPayModalMode === 'function' ? ferriolPlanPayModalMode() === 'admin' : false;
      var planProd = isPayPanel ? (adminRole ? 'vendorMonthly' : 'kioscoMonthly') : null;
      var roleBtn = document.getElementById('planCheckoutMpRoleBtn');
      var roleLbl = document.getElementById('planCheckoutMpRoleBtnLabel');
      if (roleBtn && planProd) {
        roleBtn.setAttribute('data-mp-product', planProd);
        if (roleLbl) {
          roleLbl.textContent = 'TARJETA / EFECTIVO';
        }
      }
      var subMp =
        typeof window._ferriolSubPayModalMpProduct === 'string'
          ? window._ferriolSubPayModalMpProduct
          : 'kioscoMonthly';
      if (
        subMp !== 'kioscoMonthly' &&
        subMp !== 'vendorMonthly' &&
        subMp !== 'kit'
      )
        subMp = 'kioscoMonthly';
      var modalMp = document.getElementById('kioscoSubPayModalMpBtn');
      var modalLbl = document.getElementById('kioscoSubPayModalMpLabel');
      if (modalMp) {
        modalMp.setAttribute('data-mp-product', subMp);
        if (modalLbl) {
          modalLbl.textContent = 'TARJETA / EFECTIVO';
        }
      }
      document.querySelectorAll('.ferriol-mp-pay-btn[data-mp-product]').forEach(function (btn) {
        var prod = btn.getAttribute('data-mp-product');
        var u = map[prod] || '';
        btn.disabled = !u;
        if (u) {
          btn.setAttribute('data-mp-url', u);
          btn.title = 'Abre Mercado Pago en una nueva pestaña.';
        } else {
          btn.removeAttribute('data-mp-url');
          btn.title = 'Sin link: cargalo en Más → Ajustes del sistema (Mercado Pago por producto).';
        }
      });
      var wrap = document.getElementById('planPanelMercadoPagoWrap');
      if (wrap) wrap.classList.remove('hidden');
      var planMiss = document.getElementById('planPanelMercadoPagoMissingHint');
      if (planMiss) {
        if (!isPayPanel) planMiss.classList.add('hidden');
        else planMiss.classList.toggle('hidden', !!(planProd && map[planProd]));
      }
      var distMiss = document.getElementById('planCheckoutDistribMercadoMissingHint');
      if (distMiss) distMiss.classList.toggle('hidden', !!map.kit);
      var modalMiss = document.getElementById('kioscoSubPayModalMpMissingHint');
      if (modalMiss)
        modalMiss.classList.toggle('hidden', !!(map[subMp]));
    }
    async function ferriolRefreshMercadoPagoCheckoutUrl() {
      if (!supabaseClient) {
        ferriolApplyMercadoPagoUrlsToWindow({ kit: '', kioscoMonthly: '', vendorMonthly: '' });
        syncMercadoPagoCheckoutUi();
        return;
      }
      try {
        var r = await supabaseClient.from('app_settings').select('key, value').in('key', ['ferriol_mercadopago_checkout_urls', 'ferriol_mercadopago_checkout_url']);
        if (r.error) throw r.error;
        ferriolApplyMercadoPagoUrlsToWindow(ferriolMergeMercadoPagoSettingsRows(r.data || []));
      } catch (_) {
        ferriolApplyMercadoPagoUrlsToWindow({ kit: '', kioscoMonthly: '', vendorMonthly: '' });
      }
      syncMercadoPagoCheckoutUi();
    }
    async function loadKioscoLicensePaymentInfo() {
      var block = document.getElementById('kioscoLicensePaymentBlock');
      var priceEl = document.getElementById('kioscoLicensePriceHint');
      var sponsorEl = document.getElementById('kioscoLicenseSponsorHint');
      var strip =
        document.getElementById('kioscoSubscriptionDaysStrip') ||
        document.querySelector('#kioscoSubscriptionDaysStrip');
      var stripNum =
        document.getElementById('kioscoSubscriptionDaysNumber');
      var stripSuf =
        document.getElementById('kioscoSubscriptionDaysSuffix');
      var stripEye =
        document.getElementById('kioscoSubscriptionDaysEyebrow');
      var stripLine =
        document.getElementById('kioscoSubscriptionDaysLine');
      function applyKioscoSubscriptionDaysStrip(te) {
        if (!strip) return;
        var baseClasses =
          'kiosco-sub-days-strip mb-3 rounded-xl p-3 sm:p-3.5 border shadow-md shadow-black/30 relative overflow-hidden';
        strip.classList.remove('animate-kiosco-days-pulse', 'animate-pulse');
        if (
          !stripNum ||
          !stripLine ||
          !stripEye
        )
          return;
        if (!te) {
          strip.classList.remove('hidden');
          stripNum.textContent = '—';
          if (stripSuf) stripSuf.classList.add('hidden');
          stripEye.textContent = 'Vigencia';
          stripLine.textContent =
            'Sin fecha de vigencia en tu perfil. Coordiná con el administrador.';
          stripEye.className =
            'text-[9px] font-medium uppercase tracking-wide text-white/45 mb-0.5';
          stripLine.className = 'text-sm sm:text-[0.9375rem] font-medium text-white/70 leading-snug';
          strip.className =
            baseClasses +
            ' border-white/12 bg-black/25';
          stripNum.className =
            'text-3xl sm:text-4xl font-bold tabular-nums leading-none text-white/40';
          return;
        }
        var end = new Date(te);
        var now = new Date();
        if (isNaN(end.getTime())) {
          strip.classList.remove('hidden');
          stripNum.textContent = '—';
          if (stripSuf) stripSuf.classList.add('hidden');
          stripEye.textContent = 'Vigencia';
          stripLine.textContent = 'La vigencia cargada no es válida. Consultá soporte.';
          stripEye.className =
            'text-[9px] font-medium uppercase tracking-wide text-white/45 mb-0.5';
          stripLine.className = 'text-sm sm:text-[0.9375rem] font-medium text-white/70 leading-snug';
          strip.className =
            baseClasses +
            ' border-amber-500/25 bg-amber-950/15';
          stripNum.className =
            'text-3xl sm:text-4xl font-bold tabular-nums leading-none text-amber-200/70';
          return;
        }
        var expired = end.getTime() <= now.getTime();
        var ms = end - now;
        var daysLeft = expired ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
        var urgentSoon = !expired && daysLeft >= 1 && daysLeft <= 7;
        strip.classList.remove('hidden');
        if (expired) {
          if (stripSuf) stripSuf.classList.add('hidden');
          stripNum.textContent = '!';
          stripEye.textContent = 'Vencido';
          stripEye.className =
            'text-[9px] font-medium uppercase tracking-wide text-red-400/85 mb-0.5';
          stripLine.textContent =
            'Suscripción vencida. Renovala para mantener Ferriol OS activo en tu negocio.';
          stripLine.className = 'text-sm sm:text-[0.9375rem] font-medium text-red-100/85 leading-snug';
          strip.className =
            baseClasses +
            ' border-red-400/35 bg-red-950/20';
          stripNum.className =
            'text-3xl sm:text-4xl font-bold tabular-nums leading-none text-red-300/90';
        } else if (daysLeft >= 1) {
          if (stripSuf) {
            stripSuf.classList.remove('hidden');
            stripSuf.textContent = 'días';
          }
          stripNum.textContent = String(daysLeft);
          stripEye.textContent =
            daysLeft === 1 ? 'Último día' : urgentSoon ? 'Pronto vence' : 'Vigencia';
          stripEye.className =
            'text-[9px] font-medium uppercase tracking-wide mb-0.5 ' +
            (urgentSoon ? 'text-amber-200/80' : 'text-emerald-200/65');
          stripLine.textContent =
            daysLeft === 1 ?
              'Te queda 1 día de suscripción antes del vencimiento.' :
              'Te quedan ' +
                daysLeft +
                ' días de suscripción antes del vencimiento.';
          stripLine.className =
            'text-sm sm:text-[0.9375rem] font-medium leading-snug ' +
            (urgentSoon ? 'text-amber-100/85' : 'text-white/78');
          strip.className =
            baseClasses +
            ' ' +
            (urgentSoon ?
              'border-amber-400/35 bg-amber-950/18' :
              'border-emerald-400/22 bg-emerald-950/12');
          stripNum.className =
            'text-3xl sm:text-4xl font-bold tabular-nums leading-none ' +
            (urgentSoon ? 'text-amber-100/95' : 'text-emerald-100/90');
          strip.classList.remove('animate-kiosco-days-pulse');
        } else {
          if (stripSuf) stripSuf.classList.add('hidden');
          stripNum.textContent = '·';
          stripEye.textContent = 'Últimas horas';
          stripEye.className =
            'text-[9px] font-medium uppercase tracking-wide text-orange-200/75 mb-0.5';
          stripLine.textContent =
            'La suscripción vence pronto. Abonala si aún no lo hiciste.';
          stripLine.className =
            'text-sm sm:text-[0.9375rem] font-medium text-orange-50/85 leading-snug';
          strip.className =
            baseClasses +
            ' border-orange-400/35 bg-orange-950/18';
          stripNum.className =
            'text-3xl sm:text-4xl font-bold tabular-nums leading-none text-orange-200/95';
          strip.classList.remove('animate-kiosco-days-pulse');
        }
      }
      if (!currentUser) return;
      try {
        if (supabaseClient) await ferriolRefreshMercadoPagoCheckoutUrl();
        else {
          ferriolApplyMercadoPagoUrlsToWindow({ kit: '', kioscoMonthly: '', vendorMonthly: '' });
          syncMercadoPagoCheckoutUi();
        }
      } catch (_) {
        ferriolApplyMercadoPagoUrlsToWindow({ kit: '', kioscoMonthly: '', vendorMonthly: '' });
        syncMercadoPagoCheckoutUi();
      }
      var show = currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode();
      if (block) block.style.display = show ? '' : 'none';
      if (!show) return;
      if (
        strip &&
        show &&
        !isSuperKioscoPreviewMode() &&
        (currentUser.role === 'kiosquero' || isPartnerKioscoPreviewMode())
      )
        applyKioscoSubscriptionDaysStrip(currentUser.trialEndsAt || null);
      else if (strip) {
        strip.classList.add('hidden');
        if (stripLine) stripLine.textContent = '';
        if (stripNum) stripNum.textContent = '—';
      }
      var amt = FERRIOL_PLAN_AMOUNTS.kioscoMonthly;
      var amtStr = amt.toLocaleString('es-AR');
      if (priceEl) {
        priceEl.innerHTML = 'Referencia mensual <strong class="text-[#86efac]">$ ' + amtStr + ' ARS</strong>';
      }
      var transferBody = 'Falta cargar en Ajustes (fundador) los datos oficiales de la cuenta de Ferriol (empresa) a la que se transfiere la suscripción mensual de todos los negocios.';
      if (!supabaseClient) {
        transferBody = 'Configurá Supabase para ver datos de pago.';
        ferriolApplyMercadoPagoUrlsToWindow({ kit: '', kioscoMonthly: '', vendorMonthly: '' });
        syncMercadoPagoCheckoutUi();
      } else {
        try {
          var rSettings = await supabaseClient.from('app_settings').select('key, value').in('key', ['ferriol_transfer_info']);
          var srows = rSettings.data || [];
          var tiRow = srows.filter(function (x) { return x.key === 'ferriol_transfer_info'; })[0];
          transferBody = (tiRow && tiRow.value) ? String(tiRow.value) : transferBody;
        } catch (_) {
          transferBody = 'No se pudieron cargar los datos de transferencia.';
        }
      }
      if (typeof window._populateKioscoSubscriptionPayModal === 'function') window._populateKioscoSubscriptionPayModal(transferBody);
      var spHint = await ferriolFetchSponsorHintText();
      if (sponsorEl) sponsorEl.innerHTML = spHint.html;
      var waWrap = document.getElementById('kioscoLicenseReferidorWhatsApp');
      if (waWrap && currentUser && currentUser.role === 'kiosquero') {
        await refreshViewerHelpWhatsApp(currentUser);
        var waNum = viewerHelpWhatsApp.list && viewerHelpWhatsApp.list[0];
        if (waNum) {
          var disp = ferriolFormatPhoneForDisplay(waNum);
          var txtComp = 'Hola, te envío el comprobante del pago de la suscripción Ferriol OS de mi negocio.';
          var waUrl = getWhatsAppUrl(waNum, txtComp);
          waWrap.innerHTML = '<p class="text-[10px] font-semibold uppercase tracking-wide text-white/45 mb-1.5">WhatsApp para el comprobante</p>' +
            '<p class="text-lg font-semibold font-mono text-[#86efac] mb-3 tracking-wide select-all">' + String(disp).replace(/</g, '&lt;') + '</p>' +
            '<div class="flex flex-col sm:flex-row gap-2">' +
            '<a href="' + waUrl.replace(/"/g, '&quot;') + '" target="_blank" rel="noopener" class="flex-1 inline-flex items-center justify-center gap-2 rounded-xl py-3 px-4 bg-[#22c55e]/25 hover:bg-[#22c55e]/38 border border-[#22c55e]/45 text-sm font-semibold text-[#86efac] touch-target active:scale-[0.98]">' +
            '<i data-lucide="message-circle" class="w-5 h-5 shrink-0"></i> Abrir WhatsApp · comprobante</a>' +
            '<button type="button" id="btnKioscoCopyWaComprobante" class="rounded-xl py-3 px-4 border border-white/20 bg-white/[0.08] hover:bg-white/15 text-sm font-semibold touch-target active:scale-[0.98]">Copiar número</button>' +
            '</div>';
          waWrap.classList.remove('hidden');
          var btnCopyWa = document.getElementById('btnKioscoCopyWaComprobante');
          if (btnCopyWa) {
            btnCopyWa.onclick = function () {
              copyTextToClipboard(waNum, 'Número copiado (solo dígitos para pegar donde haga falta).');
            };
          }
          try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
        } else if (viewerHelpWhatsApp.note === 'sponsor_no_phone' && viewerHelpWhatsApp.sponsorEmail) {
          var rm = String(viewerHelpWhatsApp.sponsorEmail).trim();
          var subj = encodeURIComponent('Comprobante suscripción Ferriol OS');
          var bod = encodeURIComponent('Hola, adjunto el comprobante del pago de la suscripción de mi negocio.\n\nSaludos.');
          waWrap.innerHTML = '<p class="text-[10px] font-semibold uppercase tracking-wide text-white/45 mb-1.5">Email para el comprobante</p>' +
            '<p class="text-sm font-mono text-white/85 mb-3 break-all">' + rm.replace(/</g, '&lt;') + '</p>' +
            '<a href="mailto:' + rm.replace(/"/g, '').replace(/\?/g, '%3F') + '?subject=' + subj + '&body=' + bod + '" class="inline-flex w-full items-center justify-center gap-2 rounded-xl py-3 px-4 bg-white/[0.12] hover:bg-white/18 border border-white/25 text-sm font-semibold touch-target">' +
            '<i data-lucide="mail" class="w-5 h-5"></i> Redactar correo · comprobante</a>';
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
      var header = 'Código;Nombre;Precio;Costo;Ganancia unitaria;Stock;Vencimiento (YYYY-MM-DD)';
      var rows = Object.entries(prods).map(function (_ref) {
        var codigo = _ref[0];
        var p = _ref[1];
        var precio = Number(p.precio) || 0;
        var costo = Number(p.costo) || 0;
        var ganancia = precio - costo;
        var fv = (p.fechaVencimiento || p.fecha_vencimiento) ? String(p.fechaVencimiento || p.fecha_vencimiento).slice(0, 10) : '';
        return escapeCSV(codigo) + ';' + escapeCSV(p.nombre || '') + ';' + precio + ';' + costo + ';' + ganancia + ';' + (p.stock != null ? p.stock : '') + ';' + escapeCSV(fv);
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
    try {
      window._ferriolPartnerKitGateNeedsProof = false;
    } catch (_) {}
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
            products[p.codigo] = {
              nombre: p.nombre,
              codigo: p.codigo,
              precio: p.precio,
              stock: p.stock,
              stockInicial: p.stock_inicial || p.stock,
              costo: p.costo != null ? Number(p.costo) : 0,
              fechaVencimiento: p.fecha_vencimiento != null ? String(p.fecha_vencimiento).trim().slice(0, 10) : null
            };
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
                costo: (function () { var c = Number(p.costo); return Number.isFinite(c) ? c : 0; })(),
                fecha_vencimiento: (function () {
                  var fv = (p && p.fechaVencimiento != null) ? String(p.fechaVencimiento).trim().slice(0, 10) : '';
                  return (/^\d{4}-\d{2}-\d{2}$/.test(fv)) ? fv : null;
                })()
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
      superSection: 'ingresos',  // afiliados | ingresos | sistema | ajustes | solicitudes | pagos-pendientes | mas | partner-comprobantes
      _returnSuperSectionFromComprobantes: 'ingresos',
      afiliadosSubTab: 'usuarios',  // usuarios (kiosquero) | distribuidores (partner)
      superUiMode: 'empresa',  // empresa | socio | negocio — solo si role === 'super'
      partnerUiMode: 'red'  // red (panel socio) | negocio (misma UI que kiosquero) — solo si role === 'partner'
    };

    /** true si la empresa aprobó upgrade kiosquero→partner (tabla ferriol_kiosquero_partner_upgrade_requests). Solo esos socios pueden usar la vista negocio en la misma cuenta. */
    async function ferriolFetchPartnerKiosqueroUpgradeEligible(uid) {
      if (!supabaseClient || !uid) return false;
      try {
        var q = await supabaseClient.from('ferriol_kiosquero_partner_upgrade_requests').select('id').eq('profile_id', uid).eq('status', 'approved').limit(1);
        if (q.error || !q.data || q.data.length === 0) return false;
        return true;
      } catch (_) {
        return false;
      }
    }

    /** Socio nuevo con sponsor (no upgrade desde kiosco): falta enviar comprobante de kit a la cola del distribuidor. */
    async function ferriolPartnerNeedsInitialKitProofGate() {
      if (!supabaseClient || !currentUser || currentUser.role !== 'partner') return false;
      if (currentUser.partnerFromKiosqueroUpgrade) return false;
      if (!currentUser.sponsorId) return false;
      try {
        var r = await supabaseClient
          .from('ferriol_kiosk_partner_proof_queue')
          .select('id')
          .eq('kiosco_user_id', currentUser.id)
          .eq('payment_type', 'kit_inicial')
          .in('status', ['pending_sale', 'sale_registered'])
          .limit(1)
          .maybeSingle();
        if (r.error) return false;
        return !r.data;
      } catch (_) {
        return false;
      }
    }

    async function ferriolRefreshPartnerKitGateFlag() {
      try {
        window._ferriolPartnerKitGateNeedsProof = await ferriolPartnerNeedsInitialKitProofGate();
      } catch (_) {
        window._ferriolPartnerKitGateNeedsProof = false;
      }
    }

    function ferriolNormalizeSuperUiMode(raw) {
      if (raw === 'negocio') return 'negocio';
      if (raw === 'socio') return 'socio';
      return 'empresa';
    }
    function isSuperKioscoPreviewMode() {
      return !!(currentUser && currentUser.role === 'super' && state.superUiMode === 'negocio');
    }
    function ferriolNormalizePartnerUiMode(raw) {
      return raw === 'negocio' ? 'negocio' : 'red';
    }
    /** Vista “como kiosco” solo si el socio completó upgrade aprobado (no alta solo por kit / otro camino). */
    function isPartnerKioscoPreviewMode() {
      return !!(currentUser && currentUser.role === 'partner' && currentUser.partnerFromKiosqueroUpgrade && state.partnerUiMode === 'negocio');
    }
    function isAnyKioscoPreviewMode() {
      return isSuperKioscoPreviewMode() || isPartnerKioscoPreviewMode();
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
    /** Enlaces copiables para ref: socios sí; fundador en empresa o modo socio (no en “negocio”, que simula kiosco). */
    function shouldShowPartnerAffiliateLinksUi() {
      if (!currentUser) return false;
      if (currentUser.role === 'partner') return !isPartnerKioscoPreviewMode();
      if (currentUser.role === 'super') return state.superUiMode === 'empresa' || state.superUiMode === 'socio';
      return false;
    }
    async function loadSuperMasBankingSection() {
      if (!currentUser || !supabaseClient) return;
      if (currentUser.role === 'partner') {
        try {
          var pr = await supabaseClient.from('profiles').select('partner_transfer_info').eq('id', currentUser.id).maybeSingle();
          if (!pr.error && pr.data) {
            currentUser.partnerTransferInfo = pr.data.partner_transfer_info != null ? String(pr.data.partner_transfer_info) : '';
          }
        } catch (_) {}
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
      return !!(currentUser && (currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode()));
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
      window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
      await loadTrialReminderConfigFromSupabase();
      ferriolTickCountdowns();
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

    async function ferriolSetPartnerLens(lens) {
      if (!currentUser || currentUser.role !== 'partner') return;
      if (lens === 'negocio' && !currentUser.partnerFromKiosqueroUpgrade) return;
      if (lens !== 'red' && lens !== 'negocio') return;
      if (lens === 'negocio') {
        await window._partnerIrModoNegocio();
        return;
      }
      try { sessionStorage.setItem('ferriol_partner_ui', 'red'); } catch (_) {}
      state.partnerUiMode = 'red';
      if (window._trialCountdownInterval) { clearInterval(window._trialCountdownInterval); window._trialCountdownInterval = null; }
      if (currentUser.partnerLicensePending) {
        window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
        ferriolTickCountdowns();
      }
      applyAppShell();
      state._restoringFromHistory = true;
      showPanel('super');
      state._restoringFromHistory = false;
      await renderSuper();
      ferriolStartNotificationPolling();
      loadNotifications();
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

    function ferriolParseYmdLocal(ymd) {
      if (!ymd || typeof ymd !== 'string') return null;
      var m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(ymd).trim().slice(0, 10));
      if (!m) return null;
      var d = new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
      return isNaN(d.getTime()) ? null : d;
    }
    /** Días hasta la fecha calendaria (hora local): 0 = hoy coincide con vencimiento; negativo = ya pasó. */
    function ferriolDaysUntilExpiryYmd(ymd) {
      var target = ferriolParseYmdLocal(ymd);
      if (!target) return null;
      var today = new Date();
      var start = new Date(today.getFullYear(), today.getMonth(), today.getDate());
      return Math.round((target.getTime() - start.getTime()) / 86400000);
    }
    function ferriolVencimientoAvisoDias() {
      var n = currentUser && currentUser.vencimientoAvisoDias != null ? Number(currentUser.vencimientoAvisoDias) : NaN;
      if (!Number.isFinite(n) || n < 0) return 7;
      return Math.min(365, Math.max(0, Math.floor(n)));
    }
    /**
     * @returns {{ kind: 'soon' | 'expired' | null, label: string, days: number | null }}
     */
    function ferriolProductExpiryUrgency(p) {
      var stock = Math.max(0, Number(p && p.stock) || 0);
      var raw = p && (p.fechaVencimiento || p.fecha_vencimiento);
      var fv = raw != null && String(raw).trim() !== '' ? String(raw).trim().slice(0, 10) : '';
      if (!fv || stock <= 0) return { kind: null, label: '', days: null };
      var days = ferriolDaysUntilExpiryYmd(fv);
      if (days === null) return { kind: null, label: '', days: null };
      var aviso = ferriolVencimientoAvisoDias();
      if (days < 0) return { kind: 'expired', label: 'VENCE PRONTO', days: days };
      if (days <= aviso) return { kind: 'soon', label: 'VENCE PRONTO', days: days };
      return { kind: null, label: '', days: days };
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
        var urg = ferriolProductExpiryUrgency(p);
        var badgeRow = urg.kind
          ? '<span class="text-[10px] font-bold uppercase tracking-tight text-red-500 leading-tight">' + String(urg.label).replace(/</g, '&lt;') + '</span>'
          : '';
        return `
          <div class="inventory-item" data-codigo="${p.codigo}" role="button" tabindex="0">
            <div class="inv-item-info">
              <div class="flex flex-col flex-1 min-w-0 gap-0.5">
                <span class="inv-item-name">${(p.nombre || '').replace(/</g, '&lt;')}</span>
                ${badgeRow}
              </div>
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
      var urgDet = ferriolProductExpiryUrgency(p);
      var fvStr = (p.fechaVencimiento || p.fecha_vencimiento) ? String(p.fechaVencimiento || p.fecha_vencimiento).slice(0, 10) : '';
      var fvRow = document.getElementById('productDetailVencRow');
      var fvEl = document.getElementById('productDetailVenc');
      var ban = document.getElementById('productDetailExpiryBanner');
      if (fvRow && fvEl) {
        if (fvStr && /^\d{4}-\d{2}-\d{2}$/.test(fvStr)) {
          fvRow.classList.remove('hidden');
          try {
            var dPv = ferriolParseYmdLocal(fvStr);
            fvEl.textContent = dPv ? dPv.toLocaleDateString('es-AR', { day: 'numeric', month: 'short', year: 'numeric' }) : fvStr;
          } catch (_) { fvEl.textContent = fvStr; }
        } else {
          fvRow.classList.add('hidden');
        }
      }
      if (ban) {
        if (urgDet.kind === 'soon' || urgDet.kind === 'expired') {
          ban.textContent = urgDet.label;
          ban.classList.remove('hidden');
          ban.classList.toggle('text-red-500', true);
        } else {
          ban.classList.add('hidden');
          ban.textContent = '';
        }
      }
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
      var pvFc = p.fechaVencimiento || p.fecha_vencimiento;
      var fvIn = document.getElementById('prodFechaVencimiento');
      if (fvIn) fvIn.value = (pvFc && /^\d{4}-\d{2}-\d{2}$/.test(String(pvFc).trim().slice(0, 10))) ? String(pvFc).trim().slice(0, 10) : '';
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
        supabaseClient.from('profiles').select('partner_license_pending, trial_ends_at, partner_kit_review_until').eq('id', currentUser.id).maybeSingle().then(function (r) {
          if (r && r.data && currentUser) {
            currentUser.partnerKitReviewUntil = r.data.partner_kit_review_until || null;
            try {
              syncHeaderProfileAvatar();
            } catch (_) {}
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
      updateTrialCountdownSuperFundador();
      try {
        if (currentUser && currentUser.role === 'partner' && currentUser.partnerKitReviewUntil) syncHeaderProfileAvatar();
      } catch (_) {}
    }

    function showLoginScreenTrialEndedFundador() {
      document.getElementById('appWrap').classList.add('hidden');
      document.getElementById('loginScreen').classList.remove('hidden');
      document.getElementById('loginFormWrap').classList.remove('hidden');
      document.getElementById('signUpBox').classList.add('hidden');
      var errEl = document.getElementById('loginErr');
      errEl.textContent = 'Venció la vigencia de tu cuenta como administrador (fundador). La cuenta fue bloqueada. Coordiná renovación con el otro administrador empresa o pedí que actualicen la fecha de vigencia en el sistema.';
      errEl.classList.add('show');
      var wrap = document.getElementById('loginContactAdminWrap');
      if (wrap) {
        fillLoginContactLinks('Hola, venció mi vigencia de administrador empresa en Ferriol OS y necesito coordinar.');
        wrap.classList.remove('hidden');
      }
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
      if (!banner || !currentUser || currentUser.role !== 'kiosquero') return;
      /** Los días restantes se muestran en Caja → Proveedores (tarjeta «Pagar suscripción mensual»), no repetimos en el inicio. */
      banner.classList.add('hidden');
      banner.classList.remove('trial-countdown-banner--urgent');
      var stClr = document.getElementById('trialCountdownSubtext');
      if (stClr) {
        stClr.textContent = '';
        stClr.classList.add('hidden');
      }
      const endsAt = currentUser.trialEndsAt;
      if (!endsAt) {
        var subEl = document.getElementById('headerSub');
        if (subEl && currentUser.role === 'kiosquero') subEl.textContent = 'Sistema Premium';
        return;
      }
      const end = new Date(endsAt);
      const now = new Date();
      const msLeft = end - now;
      if (msLeft <= 0) {
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
      var subHd = document.getElementById('headerSub');
      if (subHd) subHd.textContent = 'Sistema de prueba';
    }
    /** Vigencia administrador empresa (fundador, role super): mismo criterio que kioscos (trial_ends_at). Al vencer: active=false y cierre de sesión. El banner solo se muestra en vista empresa. */
    function updateTrialCountdownSuperFundador() {
      var banner = document.getElementById('trialCountdownBannerSuper');
      var textEl = document.getElementById('trialCountdownTextSuper');
      var daysEl = document.getElementById('trialCountdownDaysSuper');
      if (!currentUser || currentUser.role !== 'super') {
        if (banner) banner.classList.add('hidden');
        return;
      }
      var endsAt = currentUser.trialEndsAt;
      if (!endsAt) {
        if (banner) banner.classList.add('hidden');
        return;
      }
      var end = new Date(endsAt);
      var now = new Date();
      var msLeft = end - now;
      if (msLeft <= 0) {
        if (banner) banner.classList.add('hidden');
        if (supabaseClient && currentUser.id && !currentUser._fundadorTrialBlockTriggered) {
          currentUser._fundadorTrialBlockTriggered = true;
          supabaseClient.from('profiles').update({ active: false }).eq('id', currentUser.id).then(function () {
            supabaseClient.auth.signOut().then(showLoginScreenTrialEndedFundador);
          });
        }
        return;
      }
      if (!isEmpresaLensSuper() || !banner || !textEl || !daysEl) {
        if (banner) banner.classList.add('hidden');
        return;
      }
      var daysLeft = Math.ceil(msLeft / (24 * 60 * 60 * 1000));
      var win = getTrialReminderWindowDays();
      var inReminderWindow = daysLeft >= 1 && daysLeft <= win;
      banner.classList.remove('hidden');
      banner.classList.toggle('trial-countdown-banner--urgent', inReminderWindow);
      daysEl.textContent = daysLeft;
      textEl.textContent = daysLeft === 1 ? 'Último día · administración empresa' : (daysLeft + ' días de vigencia (admin empresa)');
      var subTxt = document.getElementById('trialCountdownSubtextSuper');
      if (subTxt) {
        if (inReminderWindow) {
          var cfg = window._trialReminderConfig || { messages: {} };
          var custom = (cfg.messages && (cfg.messages[String(daysLeft)] != null ? cfg.messages[String(daysLeft)] : cfg.messages[daysLeft])) || '';
          var line = applyTrialReminderTokens(custom, daysLeft, '') || '';
          subTxt.textContent = line || 'Tu acceso como fundador tiene fecha de renovación registrada.';
          subTxt.classList.remove('hidden');
        } else {
          subTxt.textContent = '';
          subTxt.classList.add('hidden');
        }
      }
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
    document.getElementById('trialRenovarBtnSuper') && document.getElementById('trialRenovarBtnSuper').addEventListener('click', function () {
      if (!currentUser || currentUser.role !== 'super') return;
      refreshViewerHelpWhatsApp(currentUser).then(function () {
        fillRenovarWhatsAppLinks();
        var hasWa = viewerHelpWhatsApp.list && viewerHelpWhatsApp.list.length > 0;
        var hasMail = viewerHelpWhatsApp.note === 'sponsor_no_phone' && viewerHelpWhatsApp.sponsorEmail;
        if (!hasWa && !hasMail) {
          alert('Configurá en Ajustes del sistema los números empresa (WhatsApp) para coordinar renovación entre administradores.');
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
      if (typeof closeAccountPlanSheet === 'function') {
        try {
          closeAccountPlanSheet();
        } catch (_) {}
      }
      if (typeof closeProductDetail === 'function') closeProductDetail();
      var pm = document.getElementById('productModal');
      if (pm) { pm.classList.add('hidden'); pm.classList.remove('flex'); }
      var cm = document.getElementById('clienteModal');
      if (cm) { cm.classList.add('hidden'); cm.classList.remove('flex'); }
      var kpr = document.getElementById('kiosqueroProvisionRequestModal');
      if (kpr) { kpr.classList.add('hidden'); kpr.classList.remove('flex'); }
      var kpc = document.getElementById('kiosqueroProvisionCompleteModal');
      if (kpc) { kpc.classList.add('hidden'); kpc.classList.remove('flex'); }
      var kpur = document.getElementById('kiosqueroPartnerUpgradeModal');
      if (kpur) { kpur.classList.add('hidden'); kpur.classList.remove('flex'); }
      var pal = document.getElementById('partnerAffiliateLinksModal');
      var pti = document.getElementById('partnerTransferInfoModal');
      if (pti) { pti.classList.add('hidden'); pti.classList.remove('flex'); }
      var amd = document.getElementById('accountMenuDrawer');
      if (amd && !amd.classList.contains('hidden')) closeAccountMenuDrawer(true);
      var apm = document.getElementById('accountProfileModal');
      if (apm && !apm.classList.contains('hidden')) {
        apm.classList.add('hidden');
        apm.setAttribute('aria-hidden', 'true');
        try { document.body.style.overflow = _accountProfileBodyOverflow || ''; } catch (_) {}
      }
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

    function syncPartnerBilleteraShell() {
      var pan = document.getElementById('partnerBilleteraPanel');
      if (pan) {
        if (!currentUser || !isNetworkAdminRole(currentUser.role)) {
          pan.style.display = 'none';
        } else if (isAnyKioscoPreviewMode()) {
          pan.style.display = 'none';
        } else {
          pan.style.display = (isPartnerLens() && !isEmpresaLensSuper()) ? 'block' : 'none';
        }
      }
      var navLbl = document.getElementById('navSuperWalletOrSolicitudesLabel');
      var navBtn = document.getElementById('navSuperWalletOrSolicitudesBtn');
      var navIcon = document.getElementById('navSuperWalletOrSolicitudesIcon');
      if (navLbl && navBtn && currentUser && isNetworkAdminRole(currentUser.role) && !isAnyKioscoPreviewMode()) {
        if (isEmpresaLensSuper()) {
          navLbl.textContent = 'Solicitudes';
          navBtn.title = 'Solicitudes · retiros, ventas y comprobantes';
          if (navIcon) navIcon.setAttribute('data-lucide', 'clipboard-list');
        } else if (isPartnerLens()) {
          navLbl.textContent = 'Billetera';
          navBtn.title = 'Billetera · comisiones';
          if (navIcon) navIcon.setAttribute('data-lucide', 'wallet');
        }
      }
      syncPartnerSolicitudesTabShell();
    }

    function ferriolHeaderProfileInitials(kioscoName, email) {
      var s = (kioscoName || '').trim();
      if (s) {
        var parts = s.split(/\s+/).filter(Boolean);
        if (parts.length >= 2 && parts[0][0] && parts[1][0]) return (parts[0][0] + parts[1][0]).toUpperCase();
        return s.slice(0, 2).toUpperCase();
      }
      var e = (email || '').trim();
      return e.length >= 2 ? e.slice(0, 2).toUpperCase() : '?';
    }
    function ferriolAccountProfileRoleLabel(role) {
      if (role === 'super') return 'Fundador / empresa';
      if (role === 'partner') return 'Administrador de red';
      if (role === 'kiosquero') return 'Kiosquero / negocio';
      return role || '—';
    }
    function ferriolPartnerKitReviewUntilActive() {
      if (!currentUser || currentUser.role !== 'partner') return false;
      var u = currentUser.partnerKitReviewUntil;
      return !!(u && new Date(u) > new Date());
    }
    function ferriolAccountMenuDrawerIsOpen() {
      var r = document.getElementById('accountMenuDrawer');
      return !!(r && !r.classList.contains('hidden'));
    }
    var _accountProfileRemoveAvatarFlag = false;
    var _accountProfileModalMode = 'personal';
    var _accountProfileBodyOverflow = '';
    var _accountMenuDrawerBodyOverflow = '';
    function syncHeaderProfileAvatar() {
      var btn = document.getElementById('headerProfileBtn');
      var img = document.getElementById('headerProfileImg');
      var ini = document.getElementById('headerProfileInitials');
      if (!btn || !img || !ini) return;
      if (!currentUser) {
        btn.classList.add('hidden');
        return;
      }
      btn.classList.remove('hidden');
      var url = (currentUser.avatarUrl || '').trim();
      if (url) {
        img.onerror = function () {
          img.classList.add('hidden');
          img.removeAttribute('src');
          ini.classList.remove('hidden');
          ini.textContent = ferriolHeaderProfileInitials(currentUser.kioscoName, currentUser.email);
        };
        img.onload = function () { img.classList.remove('hidden'); ini.classList.add('hidden'); };
        if (img.getAttribute('src') !== url) img.src = url;
        else { img.classList.remove('hidden'); ini.classList.add('hidden'); }
      } else {
        img.classList.add('hidden');
        img.removeAttribute('src');
        ini.classList.remove('hidden');
        ini.textContent = ferriolHeaderProfileInitials(currentUser.kioscoName, currentUser.email);
      }
      var dot = document.getElementById('headerProfileKitReviewDot');
      var kit = ferriolPartnerKitReviewUntilActive();
      if (dot) dot.classList.toggle('hidden', !kit);
      if (btn && !ferriolAccountMenuDrawerIsOpen()) {
        btn.classList.remove('ring-gray-900/85');
        if (kit) {
          btn.classList.add('ring-2', 'ring-amber-400');
        } else {
          btn.classList.remove('ring-2', 'ring-amber-400');
        }
      }
      if (btn) {
        btn.title = kit ? (window._ferriolPartnerKitReviewTooltip || 'Estás en período de aprobación. Esto puede tardar entre 12hs y 24hs hábiles.') : 'Mi cuenta';
      }
      syncAccountMenuDrawerUserBlock();
    }
    function syncAccountMenuDrawerUserBlock() {
      if (!currentUser) return;
      var dImg = document.getElementById('accountMenuDrawerAvatarImg');
      var dIni = document.getElementById('accountMenuDrawerInitials');
      var nameEl = document.getElementById('accountMenuDrawerDisplayName');
      var emailEl = document.getElementById('accountMenuDrawerEmail');
      if (nameEl) {
        var disp = (currentUser.kioscoName || '').trim();
        nameEl.textContent = disp || ferriolAccountProfileRoleLabel(currentUser.role) || '—';
      }
      if (emailEl) emailEl.textContent = currentUser.email || '';
      if (dImg && dIni) {
        var dUrl = (currentUser.avatarUrl || '').trim();
        if (dUrl) {
          dImg.onerror = function () {
            dImg.classList.add('hidden');
            dImg.removeAttribute('src');
            dIni.classList.remove('hidden');
            dIni.textContent = ferriolHeaderProfileInitials(currentUser.kioscoName, currentUser.email);
          };
          dImg.onload = function () { dImg.classList.remove('hidden'); dIni.classList.add('hidden'); };
          if (dImg.getAttribute('src') !== dUrl) dImg.src = dUrl;
          else { dImg.classList.remove('hidden'); dIni.classList.add('hidden'); }
        } else {
          dImg.classList.add('hidden');
          dImg.removeAttribute('src');
          dIni.classList.remove('hidden');
          dIni.textContent = ferriolHeaderProfileInitials(currentUser.kioscoName, currentUser.email);
        }
      }
      var dDot = document.getElementById('accountMenuDrawerKitReviewDot');
      var note = document.getElementById('accountMenuDrawerKitReviewNote');
      var kit = ferriolPartnerKitReviewUntilActive();
      if (dDot) dDot.classList.toggle('hidden', !kit);
      if (note) {
        note.classList.toggle('hidden', !kit);
        if (kit) note.textContent = window._ferriolPartnerKitReviewTooltip || 'Estás en período de aprobación. Esto puede tardar entre 12hs y 24hs hábiles.';
      }
    }
    function positionAccountMenuDrawerPanel() {
      var btn = document.getElementById('headerProfileBtn');
      var panel = document.getElementById('accountMenuDrawerPanel');
      if (!btn || !panel) return;
      var r = btn.getBoundingClientRect();
      var gap = 8;
      var topPx = r.bottom + gap;
      var rightPx = Math.max(12, window.innerWidth - r.right);
      var bottomPad = 16;
      var maxH = Math.max(200, window.innerHeight - topPx - bottomPad);
      panel.style.top = topPx + 'px';
      panel.style.right = rightPx + 'px';
      panel.style.left = 'auto';
      panel.style.bottom = 'auto';
      panel.style.maxHeight = Math.min(512, maxH) + 'px';
    }
    function syncAccountProfileModalPreview(urlOverride) {
      var img = document.getElementById('accountProfilePreviewImg');
      var ini = document.getElementById('accountProfilePreviewInitials');
      if (!img || !ini || !currentUser) return;
      var url = urlOverride != null ? String(urlOverride).trim() : (currentUser.avatarUrl || '').trim();
      if (_accountProfileRemoveAvatarFlag) url = '';
      if (url) {
        img.onerror = function () {
          img.classList.add('hidden');
          ini.classList.remove('hidden');
          ini.textContent = ferriolHeaderProfileInitials(
            document.getElementById('accountProfileKioscoName') && document.getElementById('accountProfileKioscoName').value,
            currentUser.email
          );
        };
        img.onload = function () { img.classList.remove('hidden'); ini.classList.add('hidden'); };
        img.src = url;
      } else {
        img.classList.add('hidden');
        img.removeAttribute('src');
        ini.classList.remove('hidden');
        var kn = document.getElementById('accountProfileKioscoName');
        ini.textContent = ferriolHeaderProfileInitials(kn ? kn.value : currentUser.kioscoName, currentUser.email);
      }
    }
    function closeAccountProfileModal() {
      _accountProfileModalMode = 'personal';
      var saveBtn = document.getElementById('accountProfileSaveBtn');
      if (saveBtn) saveBtn.textContent = 'Guardar cambios';
      var m = document.getElementById('accountProfileModal');
      if (m) {
        m.classList.add('hidden');
        m.setAttribute('aria-hidden', 'true');
      }
      try {
        document.body.style.overflow = _accountProfileBodyOverflow || '';
      } catch (_) {}
    }
    function syncAccountMenuDrawerShell() {
      var bankBtn = document.getElementById('accountMenuBtnBank');
      if (!bankBtn) return;
      var show = !!(currentUser && isNetworkAdminRole(currentUser.role) && !isAnyKioscoPreviewMode());
      bankBtn.classList.toggle('hidden', !show);
    }
    /** Carga ferriol_support_phone y muestra/oculta el botón Ayuda en el menú del avatar. */
    async function ferriolRefreshAccountMenuHelpButton() {
      var btn = document.getElementById('accountMenuBtnHelp');
      var sub = document.getElementById('accountMenuHelpPhoneSub');
      if (!btn || !sub) return;
      if (!supabaseClient || !currentUser) {
        btn.classList.add('hidden');
        return;
      }
      try {
        var r = await supabaseClient.from('app_settings').select('value').eq('key', 'ferriol_support_phone').maybeSingle();
        var v = (r && r.data && r.data.value != null) ? String(r.data.value).trim() : '';
        window._ferriolSupportPhoneCached = v;
        if (!v) {
          btn.classList.add('hidden');
          sub.textContent = '—';
          return;
        }
        sub.textContent = v;
        btn.classList.remove('hidden');
        try {
          if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
        } catch (_) {}
      } catch (_) {
        btn.classList.add('hidden');
      }
    }
    /** Panel “Más” (tuerca): socio partner o fundador en Empresa / Administración (no modo negocio simulado). */
    function ferriolAccountMenuNetworkMasEligible() {
      if (!currentUser) return false;
      if (currentUser.role === 'partner') return !isPartnerKioscoPreviewMode();
      if (currentUser.role === 'super') {
        if (isSuperKioscoPreviewMode()) return false;
        return state.superUiMode === 'empresa' || state.superUiMode === 'socio';
      }
      return false;
    }

    /** Fundador + vista socio (Administración) + partner: una entrada “Ajustes” en el menú del avatar. */
    function syncAccountMenuAdminTools() {
      var masBtn = document.getElementById('accountMenuBtnNetworkMas');
      var icon = document.getElementById('accountMenuNetworkMasIcon');
      var subEl = document.getElementById('accountMenuNetworkMasSub');
      var show = ferriolAccountMenuNetworkMasEligible();
      if (masBtn) masBtn.classList.toggle('hidden', !show);
      if (show && icon && subEl) {
        if (currentUser.role === 'super' && isEmpresaLensSuper()) {
          icon.classList.remove('text-emerald-600');
          icon.classList.add('text-violet-600');
          subEl.textContent = 'Hub empresa: sistema, exportaciones, avisos globales…';
        } else {
          icon.classList.remove('text-violet-600');
          icon.classList.add('text-emerald-600');
          subEl.textContent = 'Retiros, texto para transferencias, exportar…';
        }
      }
      var navMas = document.getElementById('navSuperBottomMasBtn');
      if (navMas) navMas.classList.toggle('hidden', show);
    }

    /** Kiosquero (y vista negocio simulada): Configuración en menú del avatar; se oculta el tile en Más. */
    function syncAccountMenuKiosqueroConfigPlacement() {
      var cfgBtn = document.getElementById('accountMenuBtnConfig');
      var masTile = document.querySelector('.kiosco-mas-config-entry');
      var showInProfile =
        !!(
          currentUser &&
          (currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode())
        );
      if (cfgBtn) cfgBtn.classList.toggle('hidden', !showInProfile);
      if (masTile) masTile.classList.toggle('hidden', showInProfile);
    }

    /** Panel “Mi plan” (action sheet · opciones sobre el menú cuenta) */
    function closeAccountPlanSheet() {
      var m = document.getElementById('accountPlanSheetModal');
      var opener = document.getElementById('accountMenuBtnOpenPlanSheet');
      if (!m) return;
      m.classList.add('hidden');
      m.classList.remove('flex');
      m.setAttribute('aria-hidden', 'true');
      if (opener) opener.setAttribute('aria-expanded', 'false');
      try {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    }
    function openAccountPlanSheet() {
      var m = document.getElementById('accountPlanSheetModal');
      var opener = document.getElementById('accountMenuBtnOpenPlanSheet');
      if (!m) return;
      try {
        syncPlanRolePayLabels();
      } catch (_) {}
      try {
        ferriolRefreshMercadoPagoCheckoutUrl().catch(function () {});
      } catch (_) {}
      try {
        if (typeof syncKiosqueroPartnerUpgradeUi === 'function') syncKiosqueroPartnerUpgradeUi().catch(function () {});
      } catch (_) {}
      m.classList.remove('hidden');
      m.classList.add('flex');
      m.setAttribute('aria-hidden', 'false');
      if (opener) opener.setAttribute('aria-expanded', 'true');
      try {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    }

    function closeAccountMenuDrawer(instant) {
      try {
        closeAccountPlanSheet();
      } catch (_) {}
      var root = document.getElementById('accountMenuDrawer');
      var panel = document.getElementById('accountMenuDrawerPanel');
      var hdrBtn = document.getElementById('headerProfileBtn');
      if (hdrBtn) hdrBtn.classList.remove('ring-2', 'ring-gray-900/85', 'ring-amber-400');
      if (!root || !panel) return;
      panel.classList.remove('opacity-100', 'scale-100', 'translate-y-0');
      panel.classList.add('opacity-0', 'scale-[0.98]', 'translate-y-1');
      function finish() {
        root.classList.add('hidden');
        root.setAttribute('aria-hidden', 'true');
        try {
          document.body.style.overflow = _accountMenuDrawerBodyOverflow || '';
        } catch (_) {}
        try {
          syncHeaderProfileAvatar();
        } catch (_) {}
      }
      if (instant) finish();
      else setTimeout(finish, 200);
    }
    function openAccountMenuDrawer() {
      if (!currentUser) {
        try {
          console.warn('Ferriol: menú cuenta no disponible (sesión no cargada).');
        } catch (_) {}
        return;
      }
      try {
        if (typeof closeNotifDropdown === 'function') closeNotifDropdown();
      } catch (_) {}
      var root = document.getElementById('accountMenuDrawer');
      var panel = document.getElementById('accountMenuDrawerPanel');
      if (!root || !panel) return;
      syncAccountMenuDrawerUserBlock();
      syncAccountMenuDrawerShell();
      syncAccountMenuAdminTools();
      syncPlanRolePayLabels();
      ferriolRefreshAccountMenuHelpButton().catch(function () {});
      positionAccountMenuDrawerPanel();
      var hdrBtn = document.getElementById('headerProfileBtn');
      if (hdrBtn) {
        hdrBtn.classList.remove('ring-2', 'ring-gray-900/85', 'ring-amber-400');
        hdrBtn.classList.add('ring-2', 'ring-gray-900/85');
      }
      root.classList.remove('hidden');
      root.setAttribute('aria-hidden', 'false');
      try {
        _accountMenuDrawerBodyOverflow = document.body.style.overflow;
        document.body.style.overflow = 'hidden';
      } catch (_) {}
      if (!window._ferriolAccountMenuPositionBound) {
        window._ferriolAccountMenuPositionBound = true;
        var repos = function () {
          var r = document.getElementById('accountMenuDrawer');
          if (r && !r.classList.contains('hidden')) positionAccountMenuDrawerPanel();
        };
        window.addEventListener('resize', repos);
        window.addEventListener('scroll', repos, true);
      }
      requestAnimationFrame(function () {
        positionAccountMenuDrawerPanel();
        panel.classList.remove('opacity-0', 'scale-[0.98]', 'translate-y-1');
        panel.classList.add('opacity-100', 'scale-100', 'translate-y-0');
      });
      try {
        if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    }
    function ferriolEscapeHtmlLite(s) {
      return String(s != null ? s : '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;');
    }

    /** app_settings.ferriol_checkout_copy — textos páginas de cierre (plan + opcional modal) */
    function ferriolDefaultCheckoutCopy() {
      return {
        kiosco: [
          'Resumen antes de abonar la suscripción mensual a la empresa (Ferriol).',
          'Caja y movimientos de tu ferretería organizados desde un solo lugar.'
        ],
        admin: [
          'Referencia de cuota de distribuidor antes de datos bancarios.',
          'Comisiones y liquidaciones según política empresa / red Ferriol.'
        ],
        distrib: [
          'Ventas del kit y soporte oficial según reglas empresa.',
          'Ferriol revisa la solicitud y te indica siguiente pasos.'
        ],
        products: [
          'Software de gestión pensado para kioscos y ferreterías.',
          'Canal oficial y actualizaciones coordinadas desde la empresa.'
        ],
        distrib_eyebrow: 'KIT + LICENCIA DE DISTRIBUIDOR',
        distrib_sales_headline: 'Hacete distribuidor del sistema y ganá hasta el 50% mensual',
        distrib_beneficios_title: 'Beneficios',
        distrib_intro: '',
        modal_kiosco: '',
        modal_admin: '',
        modal_distrib_kit: '',
        pay_kiosco_eyebrow: 'SUSCRIPCIÓN MENSUAL · NEGOCIO',
        pay_kiosco_headline: 'Tu abono mensual a Ferriol para usar Ferriol OS en tu comercio',
        pay_kiosco_lead: '',
        pay_admin_eyebrow: 'CUOTA MENSUAL · DISTRIBUIDOR',
        pay_admin_headline:
          'Mantenete activo para no perder las comisiones de tus afiliados',
        pay_admin_lead: '',
        pay_kiosco_benefits_title: 'Beneficios incluidos con tu suscripción',
        pay_kiosco_products_title: 'Propuesta Ferriol',
        pay_admin_benefits_title: 'Beneficios de esta cuota',
        pay_admin_products_title: 'Propuesta Ferriol'
      };
    }
    function ferriolLinesToArray(txt) {
      return String(txt || '')
        .split(/\r?\n/)
        .map(function (line) {
          return line.trim();
        })
        .filter(Boolean);
    }
    function ferriolParseCheckoutCopyValue(raw) {
      var d = ferriolDefaultCheckoutCopy();
      if (raw == null || raw === '') return d;
      var j = null;
      try {
        j = typeof raw === 'string' ? JSON.parse(raw) : raw;
      } catch (_) {
        return d;
      }
      if (!j || typeof j !== 'object') return d;
      function arrOrDef(key) {
        var a = j[key];
        if (!Array.isArray(a)) return d[key];
        var lines = a.map(function (x) {
          return String(x != null ? x : '').trim();
        }).filter(Boolean);
        return lines.length ? lines : d[key];
      }
      var intro =
        typeof j.distrib_intro === 'string' && String(j.distrib_intro).trim()
          ? String(j.distrib_intro).trim()
          : d.distrib_intro;
      return {
        kiosco: arrOrDef('kiosco'),
        admin: arrOrDef('admin'),
        distrib: arrOrDef('distrib'),
        products: arrOrDef('products'),
        distrib_eyebrow:
          typeof j.distrib_eyebrow === 'string' && String(j.distrib_eyebrow).trim()
            ? String(j.distrib_eyebrow).trim()
            : d.distrib_eyebrow,
        distrib_sales_headline:
          typeof j.distrib_sales_headline === 'string' && String(j.distrib_sales_headline).trim()
            ? String(j.distrib_sales_headline).trim()
            : d.distrib_sales_headline,
        distrib_beneficios_title:
          typeof j.distrib_beneficios_title === 'string' && String(j.distrib_beneficios_title).trim()
            ? String(j.distrib_beneficios_title).trim()
            : d.distrib_beneficios_title,
        distrib_intro: intro,
        modal_kiosco: typeof j.modal_kiosco === 'string' ? String(j.modal_kiosco).trim() : d.modal_kiosco,
        modal_admin: typeof j.modal_admin === 'string' ? String(j.modal_admin).trim() : d.modal_admin,
        modal_distrib_kit:
          typeof j.modal_distrib_kit === 'string' ? String(j.modal_distrib_kit).trim() : d.modal_distrib_kit,
        pay_kiosco_eyebrow:
          typeof j.pay_kiosco_eyebrow === 'string' && String(j.pay_kiosco_eyebrow).trim()
            ? String(j.pay_kiosco_eyebrow).trim()
            : d.pay_kiosco_eyebrow,
        pay_kiosco_headline:
          typeof j.pay_kiosco_headline === 'string' && String(j.pay_kiosco_headline).trim()
            ? String(j.pay_kiosco_headline).trim()
            : d.pay_kiosco_headline,
        pay_kiosco_lead: typeof j.pay_kiosco_lead === 'string' ? String(j.pay_kiosco_lead).trim() : d.pay_kiosco_lead,
        pay_admin_eyebrow:
          typeof j.pay_admin_eyebrow === 'string' && String(j.pay_admin_eyebrow).trim()
            ? String(j.pay_admin_eyebrow).trim()
            : d.pay_admin_eyebrow,
        pay_admin_headline:
          typeof j.pay_admin_headline === 'string' && String(j.pay_admin_headline).trim()
            ? String(j.pay_admin_headline).trim()
            : d.pay_admin_headline,
        pay_admin_lead: typeof j.pay_admin_lead === 'string' ? String(j.pay_admin_lead).trim() : d.pay_admin_lead,
        pay_kiosco_benefits_title:
          typeof j.pay_kiosco_benefits_title === 'string' && String(j.pay_kiosco_benefits_title).trim()
            ? String(j.pay_kiosco_benefits_title).trim()
            : d.pay_kiosco_benefits_title,
        pay_kiosco_products_title:
          typeof j.pay_kiosco_products_title === 'string' && String(j.pay_kiosco_products_title).trim()
            ? String(j.pay_kiosco_products_title).trim()
            : d.pay_kiosco_products_title,
        pay_admin_benefits_title:
          typeof j.pay_admin_benefits_title === 'string' && String(j.pay_admin_benefits_title).trim()
            ? String(j.pay_admin_benefits_title).trim()
            : d.pay_admin_benefits_title,
        pay_admin_products_title:
          typeof j.pay_admin_products_title === 'string' && String(j.pay_admin_products_title).trim()
            ? String(j.pay_admin_products_title).trim()
            : d.pay_admin_products_title
      };
    }
    function ferriolRenderCheckoutBenefitUl(ulEl, lines, variant) {
      if (!ulEl) return;
      var color =
        variant === 'cyan'
          ? 'text-cyan-400'
          : variant === 'violet'
          ? 'text-violet-400'
          : 'text-emerald-400';
      var sym = variant === 'violet' ? '★' : '✓';
      ulEl.innerHTML = (lines || []).map(function (t) {
        return (
          '<li class="flex gap-2.5 items-start"><span class="' +
          color +
          ' font-black shrink-0 mt-0.5">' +
          ferriolEscapeHtmlLite(sym) +
          '</span><span class="text-white/90">' +
          ferriolEscapeHtmlLite(String(t)) +
          '</span></li>'
        );
      }).join('');
    }
    function ferriolFormatDistribIntroHtml(text) {
      var t = String(text != null ? text : '');
      return ferriolEscapeHtmlLite(t).replace(/\r?\n/g, '<br>');
    }
    function ferriolApplyCheckoutBenefitsToPanels(copy) {
      copy = copy || window._ferriolCheckoutCopyParsed || ferriolDefaultCheckoutCopy();
      var deb = document.getElementById('planCheckoutDistribEyebrow');
      if (deb) deb.textContent = copy.distrib_eyebrow || ferriolDefaultCheckoutCopy().distrib_eyebrow;
      var dsl = document.getElementById('planCheckoutDistribSalesHeadline');
      if (dsl)
        dsl.textContent = copy.distrib_sales_headline || ferriolDefaultCheckoutCopy().distrib_sales_headline;
      var dk = document.getElementById('planCheckoutDistribLead');
      if (dk) {
        var introTxt = String(copy.distrib_intro != null ? copy.distrib_intro : '').trim();
        dk.innerHTML = introTxt ? ferriolFormatDistribIntroHtml(copy.distrib_intro) : '';
        dk.classList.toggle('hidden', !introTxt);
      }
      var dbt = document.getElementById('planCheckoutDistribBenefitsEyebrow');
      if (dbt) dbt.textContent = copy.distrib_beneficios_title || 'Beneficios';
      ferriolRenderCheckoutBenefitUl(
        document.getElementById('planCheckoutBenefitsKioscoList'),
        copy.kiosco,
        'emerald'
      );
      ferriolRenderCheckoutBenefitUl(
        document.getElementById('planCheckoutBenefitsProductsListKiosco'),
        copy.products,
        'emerald'
      );
      ferriolRenderCheckoutBenefitUl(
        document.getElementById('planCheckoutBenefitsAdminList'),
        copy.admin,
        'cyan'
      );
      ferriolRenderCheckoutBenefitUl(
        document.getElementById('planCheckoutBenefitsProductsListAdmin'),
        copy.products,
        'cyan'
      );
      ferriolRenderCheckoutBenefitUl(document.getElementById('planCheckoutBenefitsDistribList'), copy.distrib, 'violet');
      try {
        syncPlanCheckoutPayTextsFromCopy(copy);
      } catch (_) {}
    }
    function syncPlanCheckoutPayTextsFromCopy(copy) {
      copy = copy || window._ferriolCheckoutCopyParsed || ferriolDefaultCheckoutCopy();
      var ck = typeof window._ferriolPlanCheckoutMode === 'string' ? window._ferriolPlanCheckoutMode : 'pay';
      if (ck !== 'pay' || !currentUser) return;
      var admin = ferriolPlanPayModalMode() === 'admin';
      var eb = document.getElementById('planCheckoutPayEyebrow');
      var hl = document.getElementById('planCheckoutPaySalesHeadline');
      var ld = document.getElementById('planCheckoutPayLead');
      if (eb)
        eb.textContent = admin ? copy.pay_admin_eyebrow || '' : copy.pay_kiosco_eyebrow || '';
      if (hl)
        hl.textContent = admin ? copy.pay_admin_headline || '' : copy.pay_kiosco_headline || '';
      if (ld) {
        var leadRaw = admin ? copy.pay_admin_lead : copy.pay_kiosco_lead;
        var leadTxt = String(leadRaw != null ? leadRaw : '').trim();
        ld.innerHTML = leadTxt ? ferriolFormatDistribIntroHtml(leadRaw) : '';
        ld.classList.toggle('hidden', !leadTxt);
      }
      var lbKmain = document.getElementById('planCheckoutPayKioscoBenefMainLabel');
      var lbKprod = document.getElementById('planCheckoutPayKioscoProductsLabel');
      var lbAmain = document.getElementById('planCheckoutPayAdminBenefMainLabel');
      var lbAprod = document.getElementById('planCheckoutPayAdminProductsLabel');
      if (lbKmain) lbKmain.textContent = copy.pay_kiosco_benefits_title || 'Beneficios';
      if (lbKprod) lbKprod.textContent = copy.pay_kiosco_products_title || 'Propuesta Ferriol';
      if (lbAmain) lbAmain.textContent = copy.pay_admin_benefits_title || 'Beneficios';
      if (lbAprod) lbAprod.textContent = copy.pay_admin_products_title || 'Propuesta Ferriol';
      var tr = document.getElementById('planCheckoutPayTransferHint');
      var mp = document.getElementById('planCheckoutPayMpHint');
      if (tr) {
        tr.textContent = '';
        tr.classList.add('hidden');
        tr.classList.remove('mb-3');
      }
      if (mp) {
        mp.innerHTML = '';
        mp.classList.add('hidden');
        mp.classList.remove('mb-3');
      }
    }
    window.ferriolFetchCheckoutCopy = function (force) {
      return new Promise(function (resolve) {
        if (window._ferriolCheckoutCopyParsed && !force) {
          resolve(window._ferriolCheckoutCopyParsed);
          return;
        }
        if (!supabaseClient) {
          window._ferriolCheckoutCopyParsed = ferriolDefaultCheckoutCopy();
          resolve(window._ferriolCheckoutCopyParsed);
          return;
        }
        supabaseClient
          .from('app_settings')
          .select('value')
          .eq('key', 'ferriol_checkout_copy')
          .maybeSingle()
          .then(function (r) {
            var raw = r.data && r.data.value;
            window._ferriolCheckoutCopyParsed = ferriolParseCheckoutCopyValue(raw);
            resolve(window._ferriolCheckoutCopyParsed);
          })
          .catch(function () {
            window._ferriolCheckoutCopyParsed = ferriolDefaultCheckoutCopy();
            resolve(window._ferriolCheckoutCopyParsed);
          });
      });
    };
    function ferriolBuildCheckoutCopyObjectFromSettingsForm() {
      var g = function (id) {
        var el = document.getElementById(id);
        return el ? ferriolLinesToArray(el.value) : [];
      };
      var gs = function (id) {
        var el = document.getElementById(id);
        return el ? String(el.value || '').trim() : '';
      };
      return {
        kiosco: g('adminCheckoutCopyKiosco'),
        admin: g('adminCheckoutCopyAdmin'),
        distrib: g('adminCheckoutCopyDistrib'),
        products: g('adminCheckoutCopyProducts'),
        distrib_eyebrow: gs('adminCheckoutDistribEyebrow'),
        distrib_sales_headline: gs('adminCheckoutDistribSalesHeadline'),
        distrib_beneficios_title: gs('adminCheckoutDistribBeneficiosTitle'),
        distrib_intro: gs('adminCheckoutCopyDistribIntro'),
        modal_kiosco: gs('adminCheckoutCopyModalKiosco'),
        modal_admin: gs('adminCheckoutCopyModalAdmin'),
        modal_distrib_kit: gs('adminCheckoutModalDistribKit'),
        pay_kiosco_eyebrow: gs('adminCheckoutPayKioscoEyebrow'),
        pay_kiosco_headline: gs('adminCheckoutPayKioscoHeadline'),
        pay_kiosco_lead: gs('adminCheckoutPayKioscoLead'),
        pay_admin_eyebrow: gs('adminCheckoutPayAdminEyebrow'),
        pay_admin_headline: gs('adminCheckoutPayAdminHeadline'),
        pay_admin_lead: gs('adminCheckoutPayAdminLead'),
        pay_kiosco_benefits_title: gs('adminCheckoutPayKioscoBenefitsTitle'),
        pay_kiosco_products_title: gs('adminCheckoutPayKioscoProductsTitle'),
        pay_admin_benefits_title: gs('adminCheckoutPayAdminBenefitsTitle'),
        pay_admin_products_title: gs('adminCheckoutPayAdminProductsTitle')
      };
    }

    /** Quita una envoltura [ ... ] típica de plantillas (ej. [COMPLETAR]) para copiar solo el contenido útil */
    function ferriolStripOuterSquareBrackets(val) {
      var t = String(val != null ? val : '').trim();
      while (t.length >= 2 && t.charAt(0) === '[' && t.charAt(t.length - 1) === ']') {
        t = t.slice(1, -1).trim();
      }
      return t;
    }

    /** Datos públicos empresa (cuenta donde abona mensualidad el kiosco) — mismo formato que partner_transfer_info si es posible */
    function ferriolParseEmpresaTransferInfo(raw) {
      var s = raw != null ? String(raw).trim() : '';
      var p = ferriolParsePartnerBankingInfo(raw);
      if (!p.cbu && s) {
        var compact = s.replace(/\s/g, '');
        var m = compact.match(/\d{22}/);
        if (m) p.cbu = m[0];
      }
      if (p.titular) p.titular = ferriolStripOuterSquareBrackets(p.titular);
      if (p.banco) p.banco = ferriolStripOuterSquareBrackets(p.banco);
      if (p.alias) p.alias = ferriolStripOuterSquareBrackets(p.alias);
      if (p.cbu) p.cbu = ferriolStripOuterSquareBrackets(p.cbu).replace(/\s/g, '');
      return p;
    }

    /** Rellena el modal de pago (suscripción / cuota) desde app_settings */
    window._populateKioscoSubscriptionPayModal = function (raw) {
      window._ferriolKioscoEmpresaTransferRaw = raw != null ? String(raw) : '';
      var container = document.getElementById('kioscoSubPayBankFields');
      if (!container) return;
      var txt = window._ferriolKioscoEmpresaTransferRaw;
      var p = ferriolParseEmpresaTransferInfo(txt);
      var html = '';

      function rowCopiable(label, slot, value) {
        if (!value) return '';
        var vEsc = ferriolEscapeHtmlLite(value).replace(/\r?\n/g, '<br>');
        return '<div class="rounded-xl border border-emerald-500/35 bg-black/35 p-3 mb-3">' +
          '<div class="flex items-start justify-between gap-2">' +
          '<div class="min-w-0 flex-1">' +
          '<p class="text-[10px] uppercase tracking-wide text-emerald-200/85 font-semibold mb-1">' + ferriolEscapeHtmlLite(label) + '</p>' +
          '<p class="text-sm text-white font-mono break-all leading-snug">' + vEsc + '</p></div>' +
          '<button type="button" class="kiosco-subpay-copy-trigger shrink-0 rounded-lg px-3 py-2 text-xs font-semibold bg-emerald-500/25 hover:bg-emerald-500/40 border border-emerald-400/50 text-emerald-100 touch-target active:scale-95"' +
          ' data-kcopy-slot="' + slot + '">' +
          '<i data-lucide="copy" class="inline w-4 h-4 mr-1 align-text-bottom"></i>Copiar</button></div></div>';
      }

      if (p.titular) {
        html += '<div class="rounded-xl border border-white/15 bg-black/25 p-3 mb-3"><p class="text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">Titular cuenta</p><p class="text-sm text-white/90">' + ferriolEscapeHtmlLite(p.titular) + '</p></div>';
      }
      if (p.banco) {
        html += '<div class="rounded-xl border border-white/15 bg-black/25 p-3 mb-3"><p class="text-[10px] uppercase tracking-wide text-white/50 font-semibold mb-1">Banco</p><p class="text-sm text-white/85">' + ferriolEscapeHtmlLite(p.banco) + '</p></div>';
      }
      html += rowCopiable('CBU / CVU', 'cbu', p.cbu);
      html += rowCopiable('Alias', 'alias', p.alias);

      container.innerHTML = html;

      container.onclick = function (ev) {
        var btn = ev.target.closest('.kiosco-subpay-copy-trigger');
        if (!btn) return;
        var slot = btn.getAttribute('data-kcopy-slot');
        var val = slot === 'cbu' ? p.cbu : slot === 'alias' ? p.alias : '';
        if (!val) return;
        var plain = slot === 'cbu' ? String(val).replace(/\s/g, '') : String(val);
        var msg = slot === 'cbu' ? 'CBU copiado.' : slot === 'alias' ? 'Alias copiado.' : 'Copiado.';
        copyTextToClipboard(plain, msg);
      };

      try {
        if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    };

    function ferriolPlanPayModalMode() {
      if (!currentUser) return 'admin';
      if (currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode()) return 'kiosco';
      return 'admin';
    }

    function syncPlanCheckoutReferenciasMontos() {
      var ul = document.getElementById('planCheckoutReferenciasList');
      var box = document.getElementById('planCheckoutReferenciasBox');
      if (!ul || !box) return;
    }

    function syncPlanCheckoutPurchaseIntro() {
      var metodos = document.getElementById('planCheckoutMetodosPago');
      var ck = typeof window._ferriolPlanCheckoutMode === 'string' ? window._ferriolPlanCheckoutMode : 'pay';
      if (metodos) metodos.classList.toggle('hidden', ck !== 'pay');
      if (ck !== 'pay' || !currentUser) return;
      try {
        syncPlanCheckoutPayTextsFromCopy();
      } catch (_) {}
    }

    /** Textos Plan / cuenta según rol: kiosco = suscripción mensual; fundador/socio/partner sin preview = cuota distribuidor */
    function syncPlanRolePayLabels() {
      if (!currentUser) return;
      var admin = ferriolPlanPayModalMode() === 'admin';
      var lead = document.getElementById('planPanelLead');
      if (lead) {
        lead.innerHTML = '';
        lead.classList.add('hidden');
      }
      var benefitsKiosco = document.getElementById('planCheckoutBenefitsBlocksKiosco');
      var benefitsAdmin = document.getElementById('planCheckoutBenefitsBlocksAdmin');
      if (benefitsKiosco && benefitsAdmin) {
        benefitsKiosco.classList.toggle('hidden', admin);
        benefitsAdmin.classList.toggle('hidden', !admin);
      }
      var prim = document.getElementById('planPanelPayBtnPrimary');
      if (prim) prim.textContent = admin ? 'Ver datos para transferir (cuota)' : 'Ver datos para transferir (suscripción)';
      var sub = document.getElementById('planPanelPayBtnSubtitle');
      if (sub) {
        sub.textContent = admin ? ' · cuenta Ferriol' : ' · cuenta Ferriol';
      }
      var foot = document.getElementById('planPanelFooterHint');
      if (foot) {
        foot.innerHTML = '';
        foot.classList.add('hidden');
      }
      var aml = document.getElementById('accountMenuPlanAbonarLabel');
      if (aml) aml.textContent = admin ? 'Pagar cuota mensual' : 'Pagar suscripción mensual';
      try {
        syncPlanCheckoutPurchaseIntro();
      } catch (_) {}
      try {
        syncPlanCheckoutReferenciasMontos();
      } catch (_) {}
      try {
        syncPlanCheckoutPrices();
      } catch (_) {}
      try {
        syncMercadoPagoCheckoutUi();
      } catch (_) {}
      void (
        typeof window.ferriolFetchCheckoutCopy === 'function'
          ? window.ferriolFetchCheckoutCopy(false)
          : Promise.resolve(window._ferriolCheckoutCopyParsed || ferriolDefaultCheckoutCopy())
      ).then(function () {
        try {
          ferriolApplyCheckoutBenefitsToPanels();
        } catch (_) {}
      });
    }

    function syncPlanCheckoutPrices() {
      var label = document.getElementById('planCheckoutPriceLabel');
      var big = document.getElementById('planCheckoutPriceBig');
      var ex = document.getElementById('planCheckoutPriceExplain');
      var box = document.getElementById('planCheckoutPriceBox');
      if (!currentUser) {
        if (big) big.textContent = '—';
        if (ex) {
          ex.textContent = '';
          ex.classList.add('hidden');
        }
        return;
      }
      var admin = ferriolPlanPayModalMode() === 'admin';
      var n = admin ? FERRIOL_PLAN_AMOUNTS.vendorMonthly : FERRIOL_PLAN_AMOUNTS.kioscoMonthly;
      var nf = '$ ' + Number(n).toLocaleString('es-AR') + ' ARS';
      if (big) big.textContent = nf;
      if (label) {
        label.textContent = admin ? 'Cuota mensual · distribuidor' : 'Suscripción mensual · negocio';
      }
      if (ex) {
        ex.textContent = '';
        ex.classList.add('hidden');
      }
      if (box) {
        box.className = admin
          ? 'rounded-2xl border border-cyan-500/45 bg-gradient-to-b from-cyan-950/50 to-black/45 py-6 px-4 mb-6 text-center ring-1 ring-cyan-400/25 shadow-xl shadow-black/30'
          : 'rounded-2xl border border-emerald-500/45 bg-gradient-to-b from-emerald-950/40 to-black/45 py-6 px-4 mb-6 text-center ring-1 ring-emerald-400/25 shadow-xl shadow-black/30';
      }
      if (big) {
        big.className = admin
          ? 'text-[2.35rem] sm:text-5xl font-black tabular-nums text-cyan-50 tracking-tight leading-none drop-shadow-lg'
          : 'text-[2.35rem] sm:text-5xl font-black tabular-nums text-emerald-50 tracking-tight leading-none drop-shadow-lg';
      }
      var dpb = document.getElementById('planCheckoutDistribPriceBig');
      if (dpb) {
        var kitAmt = Number(FERRIOL_PLAN_AMOUNTS.kit) || 0;
        dpb.textContent = '$ ' + kitAmt.toLocaleString('es-AR');
      }
      try {
        syncPlanCheckoutReferenciasMontos();
      } catch (_) {}
    }

    function syncPlanPanelTrialSummary() {
      var el = document.getElementById('planTrialSummary');
      if (!el || !currentUser) return;
      var te = currentUser.trialEndsAt || null;
      if (!te) {
        el.classList.add('hidden');
        el.textContent = '';
        return;
      }
      var end = new Date(te);
      if (isNaN(end.getTime())) {
        el.classList.add('hidden');
        return;
      }
      var now = new Date();
      var ms = end.getTime() - now.getTime();
      var expired = ms <= 0;
      var daysLeft = expired ? 0 : Math.ceil(ms / (24 * 60 * 60 * 1000));
      var fechaStr = '';
      try {
        fechaStr = end.toLocaleString('es-AR', { day: '2-digit', month: 'short', year: 'numeric' });
      } catch (_) {
        fechaStr = String(te).slice(0, 10);
      }
      if (expired) {
        el.innerHTML = '<span class="font-semibold text-red-300/95">Suscripción / vigencia:</span> vencida (<time>' + ferriolEscapeHtmlLite(fechaStr) + '</time>). Regularizá con el pago a Ferriol.';
      } else {
        el.innerHTML = '<span class="font-semibold text-emerald-200/95">Tu vigencia en el sistema:</span> hasta <strong class="text-white/90">' + ferriolEscapeHtmlLite(fechaStr) + '</strong> · quedan <strong class="tabular-nums">' + String(daysLeft) + '</strong> día(s).';
      }
      el.classList.remove('hidden');
    }

    /** Ir a pantalla Plan / resumen antes de pagar o antes de solicitar distribuidor · partner_kit = cierre kit socio nuevo */
    window._ferriolGoToPlanCheckout = function (mode, explicitReturnPanel) {
      try {
        var m = String(mode || '').toLowerCase();
        if (m === 'distribuidor') window._ferriolPlanCheckoutMode = 'distribuidor';
        else if (m === 'partner_kit') window._ferriolPlanCheckoutMode = 'partner_kit';
        else window._ferriolPlanCheckoutMode = 'pay';
      } catch (_) {
        window._ferriolPlanCheckoutMode = 'pay';
      }
      if (typeof window._ferriolGoToPlanPanel === 'function') {
        window._ferriolGoToPlanPanel(explicitReturnPanel);
      } else goToPanel('plan');
    };

    function syncPlanCheckoutLayout() {
      var raw = typeof window._ferriolPlanCheckoutMode === 'string' ? window._ferriolPlanCheckoutMode : 'pay';
      var mode = raw === 'distribuidor' || raw === 'partner_kit' ? raw : 'pay';
      if (mode === 'distribuidor' && (!currentUser || currentUser.role !== 'kiosquero')) {
        mode = 'pay';
      }
      if (mode === 'partner_kit' && (!currentUser || currentUser.role !== 'partner')) {
        mode = 'pay';
      }
      window._ferriolPlanCheckoutMode = mode;
      var payW = document.getElementById('planCheckoutPayWrap');
      var distW = document.getElementById('planCheckoutDistribWrap');
      var showDistribUi = mode === 'distribuidor' || mode === 'partner_kit';
      if (payW) payW.classList.toggle('hidden', showDistribUi);
      if (distW) distW.classList.toggle('hidden', !showDistribUi);
    }

    /** Textos específicos del checkout kit cuando el usuario ya es partner (alta por referidos). */
    function syncPartnerKitCheckoutDistribLabels() {
      if (
        typeof window._ferriolPlanCheckoutMode !== 'string' ||
        window._ferriolPlanCheckoutMode !== 'partner_kit' ||
        !currentUser ||
        currentUser.role !== 'partner'
      ) {
        return;
      }
      var deb = document.getElementById('planCheckoutDistribEyebrow');
      var dsl = document.getElementById('planCheckoutDistribSalesHeadline');
      var dk = document.getElementById('planCheckoutDistribLead');
      if (deb) deb.textContent = 'Tu alta como distribuidor';
      if (dsl) dsl.textContent = 'Kit inicial + licencia';
      if (dk) {
        dk.innerHTML = ferriolFormatDistribIntroHtml(
          'Pagás el kit únicamente a la cuenta empresa Ferriol indicada abajo. Luego adjuntás el comprobante: llega a tu distribuidor para validarlo y cargar la venta ante Ferriol.'
        );
        dk.classList.remove('hidden');
      }
    }

    /** Navegar a pantalla Plan; al volver, restaurar panel guardado en _ferriolPlanPanelReturn. */
    window._ferriolGoToPlanPanel = function (explicitReturnPanel) {
      try {
        window._ferriolPlanPanelReturn = explicitReturnPanel != null && explicitReturnPanel !== ''
          ? explicitReturnPanel
          : (state && state.currentPanel ? state.currentPanel : 'dashboard');
      } catch (_) {
        window._ferriolPlanPanelReturn = 'dashboard';
      }
      goToPanel('plan');
    };

    window.ferriolOpenEmpresaSubscriptionModal = async function (mode) {
      mode = mode || 'kiosco';
      try {
        window._ferriolSubPayModalMode = mode;
      } catch (_) {}
      if (mode === 'kit') window._ferriolSubPayModalMpProduct = 'kit';
      else window._ferriolSubPayModalMpProduct = mode === 'admin' ? 'vendorMonthly' : 'kioscoMonthly';
      try {
        syncMercadoPagoCheckoutUi();
      } catch (_) {}
      var copy =
        typeof window.ferriolFetchCheckoutCopy === 'function'
          ? await window.ferriolFetchCheckoutCopy(false)
          : ferriolDefaultCheckoutCopy();
      var tit = document.getElementById('kioscoSubPayModalTitle');
      var intro = document.getElementById('kioscoSubPayModalIntro');
      if (mode === 'kit') {
        if (tit) tit.textContent = 'Kit + licencia de distribuidor · cuenta Ferriol';
        if (intro) {
          intro.classList.remove('hidden');
          var kt = (copy.modal_distrib_kit || '').trim();
          intro.innerHTML = kt
            ? ferriolEscapeHtmlLite(kt).replace(/\r?\n/g, '<br>')
            : 'Abonás el <strong class="text-white/88">kit inicial y la licencia de distribuidor</strong> únicamente a la <strong class="text-[#86efac]/95">cuenta empresa Ferriol</strong>. Usá los datos de abajo y enviá el comprobante cuando la empresa lo indique.';
        }
      } else {
        if (tit) {
          tit.textContent =
            mode === 'admin' ? 'Pagar cuota mensual' : 'Pagar suscripción mensual';
        }
        if (intro) {
          intro.innerHTML = '';
          intro.classList.add('hidden');
        }
      }
      var saleStrip = document.getElementById('kioscoSubPaySalesStrip');
      if (saleStrip) {
        if (mode === 'kit') {
          saleStrip.classList.add('hidden');
          saleStrip.innerHTML = '';
        } else {
          var line = mode === 'admin' ? copy.modal_admin : copy.modal_kiosco;
          if (line && String(line).trim()) {
            saleStrip.classList.remove('hidden');
            saleStrip.innerHTML =
              '<p class="text-sm text-white/88 leading-snug">' +
              ferriolEscapeHtmlLite(String(line).trim()).replace(/\r?\n/g, '<br>') +
              '</p>';
          } else {
            saleStrip.classList.add('hidden');
            saleStrip.innerHTML = '';
          }
        }
      }
      var raw = '';
      if (supabaseClient) {
        try {
          var r = await supabaseClient.from('app_settings').select('value').eq('key', 'ferriol_transfer_info').maybeSingle();
          raw = r.data && r.data.value ? String(r.data.value) : '';
        } catch (_) {}
      }
      window._ferriolKioscoEmpresaTransferRaw = raw;
      if (typeof window._populateKioscoSubscriptionPayModal === 'function') {
        window._populateKioscoSubscriptionPayModal(raw);
      }
      try {
        syncMercadoPagoCheckoutUi();
      } catch (_) {}
      var m = document.getElementById('kioscoSubscriptionPayModal');
      if (m) {
        m.classList.remove('hidden');
        try { document.body.style.overflow = 'hidden'; } catch (_) {}
      }
      try {
        if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    };
    function ferriolParsePartnerBankingInfo(raw) {
      var s = raw != null ? String(raw).trim() : '';
      var out = { titular: '', banco: '', cbu: '', alias: '' };
      if (!s) return out;
      var lines = s.split(/\r?\n/);
      lines.forEach(function (line) {
        var t = line.trim();
        if (!t) return;
        var m = t.match(/^([^:]+):\s*(.*)$/);
        if (m) {
          var label = m[1].trim().toLowerCase();
          var val = m[2].trim();
          if (label === 'titular') out.titular = val;
          else if (label === 'banco') out.banco = val;
          else if (label === 'cbu/cvu' || label === 'cbu') out.cbu = val;
          else if (label === 'alias') out.alias = val;
        }
      });
      return out;
    }
    function ferriolBuildPartnerBankingInfo(fields) {
      var lines = [];
      if (fields.titular) lines.push('Titular: ' + String(fields.titular).trim());
      if (fields.banco) lines.push('Banco: ' + String(fields.banco).trim());
      if (fields.cbu) lines.push('CBU/CVU: ' + String(fields.cbu).replace(/\s/g, ''));
      if (fields.alias) lines.push('Alias: ' + String(fields.alias).trim());
      return lines.join('\n');
    }
    function ferriolFillAccountProfileBankForm(parsed) {
      var set = function (id, v) {
        var el = document.getElementById(id);
        if (el) el.value = v != null ? String(v) : '';
      };
      set('accountProfileBankTitular', parsed.titular);
      set('accountProfileBankBanco', parsed.banco);
      set('accountProfileBankCbu', parsed.cbu);
      set('accountProfileBankAlias', parsed.alias);
    }
    function openAccountProfileModal(modeOpt) {
      if (!currentUser) {
        try {
          console.warn('Ferriol: perfil no disponible (sesión no cargada).');
        } catch (_) {}
        return;
      }
      var mode = 'personal';
      if (modeOpt === 'bank' || modeOpt === true) mode = 'bank';
      var showBank = isNetworkAdminRole(currentUser.role) && !isAnyKioscoPreviewMode();
      if (mode === 'bank' && !showBank) mode = 'personal';
      _accountProfileModalMode = mode;

      var m = document.getElementById('accountProfileModal');
      var msg = document.getElementById('accountProfileMsg');
      if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }
      _accountProfileRemoveAvatarFlag = false;
      var fi = document.getElementById('accountProfileAvatarInput');
      if (fi) fi.value = '';
      var pBlock = document.getElementById('accountProfilePersonalBlock');
      var bWrap = document.getElementById('accountProfileBankWrap');
      var titleEl = document.getElementById('accountProfileTitle');
      var emailHint = document.getElementById('accountProfileBankEmailHint');
      var saveBtn = document.getElementById('accountProfileSaveBtn');

      if (mode === 'bank') {
        if (pBlock) pBlock.classList.add('hidden');
        if (bWrap) bWrap.classList.remove('hidden');
        if (emailHint) {
          emailHint.textContent = 'Sesión: ' + (currentUser.email || '—');
          emailHint.classList.remove('hidden');
        }
        if (titleEl) titleEl.innerHTML = '<i data-lucide="landmark" class="w-5 h-5 text-amber-200"></i> Mis datos bancarios';
        if (saveBtn) saveBtn.textContent = 'Guardar mis datos bancarios';
        var bankParsedBk = ferriolParsePartnerBankingInfo(currentUser.partnerTransferInfo);
        ferriolFillAccountProfileBankForm(bankParsedBk);
      } else {
        if (pBlock) pBlock.classList.remove('hidden');
        if (bWrap) bWrap.classList.add('hidden');
        if (emailHint) emailHint.classList.add('hidden');
        if (titleEl) titleEl.innerHTML = '<i data-lucide="user-circle" class="w-5 h-5 text-emerald-300"></i> Mis datos personales';
        if (saveBtn) saveBtn.textContent = 'Guardar cambios';
        var em = document.getElementById('accountProfileEmail');
        if (em) em.value = currentUser.email || '';
        var rl = document.getElementById('accountProfileRole');
        if (rl) rl.value = ferriolAccountProfileRoleLabel(currentUser.role);
        var kn = document.getElementById('accountProfileKioscoName');
        if (kn) kn.value = currentUser.kioscoName || '';
        var ph = document.getElementById('accountProfilePhone');
        if (ph) ph.value = currentUser.phone != null ? String(currentUser.phone) : '';
        var wWrap = document.getElementById('accountProfileWhatsappWrap');
        var wTa = document.getElementById('accountProfileWhatsappMsg');
        var showWa = currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode();
        if (wWrap) wWrap.classList.toggle('hidden', !showWa);
        if (wTa && showWa) wTa.value = currentUser.whatsappMessage || DEFAULT_WHATSAPP;
        if (showBank) {
          var bankParsedPr = ferriolParsePartnerBankingInfo(currentUser.partnerTransferInfo);
          ferriolFillAccountProfileBankForm(bankParsedPr);
        }
        syncAccountProfileModalPreview();
      }

      if (m) {
        m.classList.remove('hidden');
        m.setAttribute('aria-hidden', 'false');
        try {
          _accountProfileBodyOverflow = document.body.style.overflow;
          document.body.style.overflow = 'hidden';
        } catch (_) {}
      }
      if (mode === 'bank' && bWrap) {
        setTimeout(function () {
          try { bWrap.scrollIntoView({ behavior: 'smooth', block: 'start' }); } catch (_) { bWrap.scrollIntoView(true); }
          var bt = document.getElementById('accountProfileBankTitular');
          if (bt) try { bt.focus(); } catch (_) {}
        }, 200);
      }
      try { if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons(); } catch (_) {}
    }

    function applyAppShell() {
      if (!currentUser) return;
      var isSuper = currentUser.role === 'super';
      var isPartner = currentUser.role === 'partner';
      var isNetworkAdmin = isNetworkAdminRole(currentUser.role);
      var uiNegocio = isAnyKioscoPreviewMode();
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
        } else if (isPartner && uiNegocio) {
          ht.textContent = currentUser.kioscoName || 'Ferriol OS';
          if (subEl) {
            subEl.textContent = 'Vista negocio';
            subEl.classList.add('header-sub--toggle');
            subEl.title = 'Tocá para volver a tu red · ingresos y afiliados';
            subEl.setAttribute('aria-label', 'Volver al panel de socio');
          }
        } else if (isPartner) {
          ht.textContent = 'FERRIOL OS';
          if (subEl) {
            subEl.textContent = 'Tu red · Ferriol';
            if (currentUser.partnerFromKiosqueroUpgrade) {
              subEl.classList.add('header-sub--toggle');
              subEl.title = 'Tocá para abrir la vista de tu negocio (caja, productos, ventas)';
              subEl.setAttribute('aria-label', 'Abrir vista negocio');
            } else {
              subEl.classList.remove('header-sub--toggle');
              subEl.removeAttribute('title');
              subEl.removeAttribute('aria-label');
            }
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
      if (currentUser && (currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode())) {
        loadKioscoLicensePaymentInfo();
      } else if (currentUser && supabaseClient) {
        try {
          ferriolRefreshMercadoPagoCheckoutUrl().catch(function () {});
        } catch (_) {}
      }
      syncHeaderProfileAvatar();
      syncAccountMenuDrawerShell();
      try {
        syncAccountMenuAdminTools();
      } catch (_) {}
      syncAccountMenuKiosqueroConfigPlacement();
      try {
        if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
      var clientSaleWrap = document.querySelector('.ferriol-partner-client-sale-wrap');
      if (clientSaleWrap) clientSaleWrap.classList.toggle('hidden', !(isPartnerLens() && !isEmpresaLensSuper() && !isPartnerKioscoPreviewMode()));
      var showPartnerProofUi = isPartnerLens() && !isEmpresaLensSuper() && !isPartnerKioscoPreviewMode();
      document.querySelectorAll('.ferriol-partner-kiosk-proof-btn-wrap').forEach(function (w) {
        w.classList.toggle('hidden', !showPartnerProofUi);
      });
      if (showPartnerProofUi) {
        void loadPartnerKioskProofQueue(false);
      } else {
        syncPartnerProofInboxBadgeCount(0);
      }
      var affWrap = document.querySelector('.ferriol-partner-affiliate-links-wrap');
      if (affWrap) affWrap.classList.toggle('hidden', !shouldShowPartnerAffiliateLinksUi());
      var ingNav = document.getElementById('navSuperIngresosBtn');
      if (ingNav) {
        if (!isNetworkAdmin || uiNegocio) {
          ingNav.style.display = 'none';
        } else {
          ingNav.style.display = '';
        }
      }
      syncPartnerBilleteraShell();
      if (isNetworkAdmin && !uiNegocio) {
        ferriolWireSolicitudesBadgeRealtimeIfNeeded();
        scheduleRefreshFerriolSolicitudesBadges();
      } else {
        ferriolTearDownSolicitudesBadgeRealtime();
        ferriolClearAllSolicitudesBadges();
      }
      try { syncPlanRolePayLabels(); } catch (_) {}
    }

    function showPanel(name, cajaTabOverride) {
      if (
        currentUser &&
        currentUser.role === 'partner' &&
        window._ferriolPartnerKitGateNeedsProof === true &&
        name !== 'plan'
      ) {
        try {
          window._ferriolPlanCheckoutMode = 'partner_kit';
          window._ferriolPlanPanelReturn = 'super';
        } catch (_) {}
        name = 'plan';
      }
      if (name === 'super' && currentUser && currentUser.role === 'super' && state.superUiMode === 'negocio') {
        state.superUiMode = 'empresa';
        try { sessionStorage.setItem('ferriol_super_ui', 'empresa'); } catch (_) {}
        applyAppShell();
      }
      if (name === 'super' && currentUser && currentUser.role === 'partner' && state.partnerUiMode === 'negocio') {
        state.partnerUiMode = 'red';
        try { sessionStorage.setItem('ferriol_partner_ui', 'red'); } catch (_) {}
        applyAppShell();
      }
      if (name === 'super' && currentUser && currentUser.role === 'partner' && state.superSection && state.superSection !== 'afiliados' && state.superSection !== 'ingresos' && state.superSection !== 'partner-comprobantes' && state.superSection !== 'solicitudes' && state.superSection !== 'pagos-pendientes' && state.superSection !== 'mas') {
        switchSuperSection('ingresos');
      }
      if (name !== 'scanner') window._scanForProductCode = false;
      state.currentPanel = name;
      document.body.setAttribute('data-panel', name);
      const navKey = (name === 'config' || name === 'historial' || name === 'clientes' || name === 'plan') ? 'mas' : name;
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
        renderIngresosBienvenida();
        var landSuper = state.superSection || 'ingresos';
        if (landSuper === 'balance') landSuper = 'ingresos';
        if (currentUser && currentUser.role === 'partner' && landSuper !== 'afiliados' && landSuper !== 'ingresos' && landSuper !== 'solicitudes' && landSuper !== 'pagos-pendientes' && landSuper !== 'mas') landSuper = 'ingresos';
        if (currentUser && currentUser.role === 'partner' && landSuper === 'pagos-pendientes') landSuper = 'ingresos';
        switchSuperSection(landSuper);
      } else {
        if (superListCountdownInterval) { clearInterval(superListCountdownInterval); superListCountdownInterval = null; }
        var navSuperBottom = document.getElementById('navSuperBottom');
        if (navSuperBottom) navSuperBottom.classList.add('hidden');
      }
      if (name === 'plan') {
        syncPlanRolePayLabels();
        try {
          syncPlanCheckoutLayout();
        } catch (_) {}
        try {
          syncPartnerKitCheckoutDistribLabels();
        } catch (_) {}
        try {
          syncPlanCheckoutReferenciasMontos();
        } catch (_) {}
        try {
          syncPlanCheckoutPurchaseIntro();
        } catch (_) {}
        syncPlanPanelTrialSummary();
        try {
          ferriolRefreshMercadoPagoCheckoutUrl().catch(function () {});
        } catch (_) {}
        try {
          if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
        } catch (_) {}
        try {
          if (
            window._ferriolPlanCheckoutMode === 'distribuidor' &&
            typeof syncKiosqueroPartnerUpgradeUi === 'function'
          ) {
            syncKiosqueroPartnerUpgradeUi().catch(function () {});
          }
        } catch (_) {}
      }
      if (name === 'dashboard') {
        updateTrialCountdown();
        updateDashboard();
        if (currentUser && (currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode())) {
          if (typeof loadKioscoLicensePaymentInfo === 'function') loadKioscoLicensePaymentInfo().catch(function () {});
        }
        if (currentUser && currentUser.role === 'kiosquero') {
          if (typeof syncKiosqueroPartnerUpgradeUi === 'function') syncKiosqueroPartnerUpgradeUi().catch(function () {});
        }
        if (ferriolKiosqueroNotifShell()) {
          loadTrialReminderConfigFromSupabase();
          if (currentUser) refreshViewerHelpWhatsApp(currentUser);
        }
        if (ferriolNotificationRecipientShell()) loadNotifications();
      }
      if (name === 'scanner') {
        if (typeof window._ferriolFlushUsbBarcode === 'function') window._ferriolFlushUsbBarcode();
        if (typeof window._startScannerCamera === 'function') window._startScannerCamera();
        if (typeof window._stopScannerInterval === 'function') window._stopScannerInterval();
        var ps = document.getElementById('panel-scanner');
        if (ps) {
          try {
            ps.focus({ preventScroll: true });
          } catch (_) {
            try { ps.focus(); } catch (_) {}
          }
        }
      } else {
        if (typeof window._ferriolFlushUsbBarcode === 'function') window._ferriolFlushUsbBarcode();
        if (typeof window._stopScannerInterval === 'function') window._stopScannerInterval();
      }
      if (name === 'caja') {
        state._suppressCajaHistoryPush = true;
        var ctab = cajaTabOverride != null && cajaTabOverride !== '' ? cajaTabOverride : 'hub';
        if (ctab === 'sistema') ctab = 'hub';
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
      var sn = sectionName || 'ingresos';
      if (sn === 'balance') sn = 'ingresos';
      if (sn === 'cobros') sn = 'sistema';
      if (sn === 'pagos-pendientes' && !isEmpresaLensSuper()) sn = 'ingresos';
      if (sn === 'partner-comprobantes') {
        var allowPc = isPartnerLens() && !isEmpresaLensSuper() && !isPartnerKioscoPreviewMode();
        if (!allowPc) sn = 'ingresos';
      }
      state.superSection = sn;
      var reqSuper = state.superSection === 'sistema';
      if (reqSuper && currentUser && (currentUser.role !== 'super' || !isEmpresaLensSuper())) {
        state.superSection = 'ingresos';
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
      if (navHighlight === 'partner-comprobantes') {
        navHighlight = state._returnSuperSectionFromComprobantes || 'ingresos';
        if (navHighlight === 'partner-comprobantes') navHighlight = 'ingresos';
      }
      document.querySelectorAll('.super-nav-btn').forEach(function (btn) {
        btn.classList.toggle('active', btn.dataset.superSection === navHighlight);
      });
      if (state.superSection === 'partner-comprobantes') {
        ferriolSetPartnerProofScreenTab('comercios');
      }
      if ((state.superSection === 'sistema' || state.superSection === 'cobros') && isEmpresaLensSuper()) renderSuperCobrosSection();
      if (state.superSection === 'ingresos') void loadSuperIngresosSection();
      if (state.superSection === 'partner-comprobantes') {
        void loadPartnerKioskProofQueue(true);
      } else if (state.superSection === 'afiliados' || state.superSection === 'ingresos') {
        void loadPartnerKioskProofQueue(false);
      }
      if (state.superSection === 'solicitudes') {
        void renderSuperMembershipDayRequestBanners();
        void loadSuperSolicitudesSection();
      }
      if (state.superSection === 'pagos-pendientes' && isEmpresaLensSuper()) {
        void loadFounderPagosPendientesSection();
      }
      if (state.superSection === 'mas') {
        void loadSuperMasBankingSection();
      }
      lucide.createIcons();
      if (state.superSection === 'sistema' && typeof window._ferriolSistemaSwitchTab === 'function') {
        var reopen = window._ferriolSistemaMlmActiveTab || 'flujo';
        requestAnimationFrame(function () {
          try { window._ferriolSistemaSwitchTab(reopen); } catch (_) {}
        });
      }
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
    var btnSuperMasGoSolicitudesVentas = document.getElementById('btnSuperMasGoSolicitudesVentas');
    if (btnSuperMasGoSolicitudesVentas) {
      btnSuperMasGoSolicitudesVentas.addEventListener('click', function () {
        try { sessionStorage.setItem('ferriol_founder_solic_tab', 'ventas'); } catch (_) {}
        switchSuperSection('solicitudes');
      });
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
      openAccountProfileModal('bank');
    }
    function closePartnerTransferInfoModal() {
      var m = document.getElementById('partnerTransferInfoModal');
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
      }
    }
    var _ferriolProfileHeaderOpenedAt = 0;
    function ferriolOpenAccountProfileFromHeader(e) {
      if (e) {
        e.preventDefault();
        e.stopPropagation();
      }
      var now = Date.now();
      if (now - _ferriolProfileHeaderOpenedAt < 450) return;
      _ferriolProfileHeaderOpenedAt = now;
      openAccountMenuDrawer();
    }
    var headerProfileBtn = document.getElementById('headerProfileBtn');
    var mainHeaderEl = document.getElementById('mainHeader');
    if (mainHeaderEl) {
      mainHeaderEl.addEventListener('click', function (e) {
        var t = e.target && e.target.closest && e.target.closest('#headerProfileBtn');
        if (!t) return;
        ferriolOpenAccountProfileFromHeader(e);
      });
      mainHeaderEl.addEventListener('touchend', function (e) {
        var t = e.target && e.target.closest && e.target.closest('#headerProfileBtn');
        if (!t) return;
        ferriolOpenAccountProfileFromHeader(e);
      }, { passive: false });
    } else if (headerProfileBtn) {
      headerProfileBtn.addEventListener('click', ferriolOpenAccountProfileFromHeader);
      headerProfileBtn.addEventListener('touchend', ferriolOpenAccountProfileFromHeader, { passive: false });
    }
    var accountMenuDrawerClose = document.getElementById('accountMenuDrawerClose');
    var accountMenuDrawerOverlay = document.getElementById('accountMenuDrawerOverlay');
    if (accountMenuDrawerClose) accountMenuDrawerClose.addEventListener('click', function () { closeAccountMenuDrawer(false); });
    if (accountMenuDrawerOverlay) accountMenuDrawerOverlay.addEventListener('click', function () { closeAccountMenuDrawer(false); });
    var accountMenuBtnPersonal = document.getElementById('accountMenuBtnPersonal');
    if (accountMenuBtnPersonal) {
      accountMenuBtnPersonal.addEventListener('click', function () {
        closeAccountMenuDrawer(true);
        openAccountProfileModal('personal');
      });
    }
    var accountMenuBtnHelp = document.getElementById('accountMenuBtnHelp');
    if (accountMenuBtnHelp) {
      accountMenuBtnHelp.addEventListener('click', function () {
        var sub = document.getElementById('accountMenuHelpPhoneSub');
        var display = (sub && sub.textContent) ? String(sub.textContent).trim() : String(window._ferriolSupportPhoneCached || '').trim();
        var digits = display.replace(/\D/g, '');
        if (digits.length >= 8) {
          try {
            window.open('https://wa.me/' + digits, '_blank', 'noopener,noreferrer');
          } catch (_) {}
        } else if (display.length > 0) {
          var tel = display.replace(/[^\d+]/g, '');
          try {
            window.location.href = 'tel:' + tel;
          } catch (_) {}
        }
      });
    }
    var accountMenuBtnConfig = document.getElementById('accountMenuBtnConfig');
    if (accountMenuBtnConfig) {
      accountMenuBtnConfig.addEventListener('click', function () {
        closeAccountMenuDrawer(true);
        goToPanel('config');
      });
    }
    var accountMenuBtnOpenPlanSheet = document.getElementById('accountMenuBtnOpenPlanSheet');
    if (accountMenuBtnOpenPlanSheet) {
      accountMenuBtnOpenPlanSheet.addEventListener('click', function (ev) {
        ev.stopPropagation();
        if (typeof openAccountPlanSheet === 'function') openAccountPlanSheet();
      });
    }
    var accountPlanSheetModalOverlay = document.getElementById('accountPlanSheetModalOverlay');
    if (accountPlanSheetModalOverlay) {
      accountPlanSheetModalOverlay.addEventListener('click', function () {
        if (typeof closeAccountPlanSheet === 'function') closeAccountPlanSheet();
      });
    }
    var accountPlanSheetModalClose = document.getElementById('accountPlanSheetModalClose');
    if (accountPlanSheetModalClose) {
      accountPlanSheetModalClose.addEventListener('click', function () {
        if (typeof closeAccountPlanSheet === 'function') closeAccountPlanSheet();
      });
    }
    var accountMenuBtnAbonar = document.getElementById('accountMenuBtnAbonar');
    if (accountMenuBtnAbonar) {
      accountMenuBtnAbonar.addEventListener('click', function () {
        if (typeof closeAccountPlanSheet === 'function') closeAccountPlanSheet();
        closeAccountMenuDrawer(true);
        try {
          if (typeof window._ferriolGoToPlanCheckout === 'function') window._ferriolGoToPlanCheckout('pay');
          else goToPanel('plan');
        } catch (_) {}
      });
    }
    document.addEventListener(
      'click',
      function (ev) {
        var tgt = ev.target;
        var btn = tgt && tgt.closest ? tgt.closest('.ferriol-mp-pay-btn[data-mp-product]') : null;
        if (!btn || btn.disabled) return;
        var u = btn.getAttribute('data-mp-url');
        if (!u || !/^https?:\/\//i.test(u)) return;
        try {
          window.open(u, '_blank', 'noopener,noreferrer');
        } catch (_) {}
      },
      false
    );
    var planCheckoutMpYaPagueBtn = document.getElementById('planCheckoutMpYaPagueBtn');
    if (planCheckoutMpYaPagueBtn) {
      planCheckoutMpYaPagueBtn.addEventListener('click', function () {
        var mode =
          typeof ferriolPlanPayModalMode === 'function' && ferriolPlanPayModalMode() === 'admin' ? 'admin' : 'kiosco';
        if (typeof window.ferriolOpenEmpresaPaymentProofModal === 'function') window.ferriolOpenEmpresaPaymentProofModal(mode);
      });
    }
    var planCheckoutDistribMpYaPagueBtn = document.getElementById('planCheckoutDistribMpYaPagueBtn');
    if (planCheckoutDistribMpYaPagueBtn) {
      planCheckoutDistribMpYaPagueBtn.addEventListener('click', function () {
        if (typeof window.ferriolOpenEmpresaPaymentProofModal === 'function') window.ferriolOpenEmpresaPaymentProofModal('kit');
      });
    }
    var accountMenuBtnDistribuidor = document.getElementById('accountMenuBtnDistribuidor');
    if (accountMenuBtnDistribuidor) {
      accountMenuBtnDistribuidor.addEventListener('click', function () {
        if (accountMenuBtnDistribuidor.disabled) return;
        if (typeof closeAccountPlanSheet === 'function') closeAccountPlanSheet();
        closeAccountMenuDrawer(true);
        try {
          if (typeof window._ferriolGoToPlanCheckout === 'function') window._ferriolGoToPlanCheckout('distribuidor');
          else goToPanel('plan');
        } catch (_) {}
      });
    }
    var accountMenuBtnBank = document.getElementById('accountMenuBtnBank');
    if (accountMenuBtnBank) {
      accountMenuBtnBank.addEventListener('click', function () {
        if (!currentUser || !isNetworkAdminRole(currentUser.role) || isAnyKioscoPreviewMode()) return;
        closeAccountMenuDrawer(true);
        openAccountProfileModal('bank');
      });
    }
    var accountMenuBtnNetworkMas = document.getElementById('accountMenuBtnNetworkMas');
    if (accountMenuBtnNetworkMas) {
      accountMenuBtnNetworkMas.addEventListener('click', function () {
        if (!ferriolAccountMenuNetworkMasEligible()) return;
        closeAccountMenuDrawer(true);
        state.superSection = 'mas';
        goToPanel('super');
      });
    }
    var accountMenuBtnLogout = document.getElementById('accountMenuBtnLogout');
    if (accountMenuBtnLogout) {
      accountMenuBtnLogout.addEventListener('click', function () {
        closeAccountMenuDrawer(true);
        doLogout();
      });
    }
    var accountProfileModalClose = document.getElementById('accountProfileModalClose');
    var accountProfileModalOverlay = document.getElementById('accountProfileModalOverlay');
    if (accountProfileModalClose) accountProfileModalClose.addEventListener('click', closeAccountProfileModal);
    if (accountProfileModalOverlay) accountProfileModalOverlay.addEventListener('click', closeAccountProfileModal);
    var accountProfileAvatarInput = document.getElementById('accountProfileAvatarInput');
    if (accountProfileAvatarInput) {
      accountProfileAvatarInput.addEventListener('change', function () {
        var f = accountProfileAvatarInput.files && accountProfileAvatarInput.files[0];
        _accountProfileRemoveAvatarFlag = false;
        if (!f) {
          syncAccountProfileModalPreview();
          return;
        }
        try {
          var u = URL.createObjectURL(f);
          syncAccountProfileModalPreview(u);
        } catch (_) {
          syncAccountProfileModalPreview();
        }
      });
    }
    var accountProfileRemovePhoto = document.getElementById('accountProfileRemovePhoto');
    if (accountProfileRemovePhoto) {
      accountProfileRemovePhoto.addEventListener('click', function () {
        _accountProfileRemoveAvatarFlag = true;
        if (accountProfileAvatarInput) accountProfileAvatarInput.value = '';
        syncAccountProfileModalPreview('');
      });
    }
    var accountProfileKioscoNameEl = document.getElementById('accountProfileKioscoName');
    if (accountProfileKioscoNameEl) {
      accountProfileKioscoNameEl.addEventListener('input', function () {
        if (!document.getElementById('accountProfileAvatarInput') || !document.getElementById('accountProfileAvatarInput').files || !document.getElementById('accountProfileAvatarInput').files[0]) {
          syncAccountProfileModalPreview(_accountProfileRemoveAvatarFlag ? '' : null);
        }
      });
    }
    var accountProfileSaveBtn = document.getElementById('accountProfileSaveBtn');
    if (accountProfileSaveBtn) {
      accountProfileSaveBtn.addEventListener('click', async function () {
        var msg = document.getElementById('accountProfileMsg');
        if (!supabaseClient || !currentUser) return;
        if (msg) { msg.classList.add('hidden'); msg.textContent = ''; }

        if (_accountProfileModalMode === 'bank') {
          var showBankOnly = isNetworkAdminRole(currentUser.role) && !isAnyKioscoPreviewMode();
          if (!showBankOnly) return;
          var bankTitB = (document.getElementById('accountProfileBankTitular') && document.getElementById('accountProfileBankTitular').value || '').trim();
          var bankBcoB = (document.getElementById('accountProfileBankBanco') && document.getElementById('accountProfileBankBanco').value || '').trim();
          var bankCbuB = (document.getElementById('accountProfileBankCbu') && document.getElementById('accountProfileBankCbu').value || '').replace(/\s/g, '');
          var bankAliasB = (document.getElementById('accountProfileBankAlias') && document.getElementById('accountProfileBankAlias').value || '').trim();
          if (!bankTitB || !bankBcoB || (!bankCbuB && !bankAliasB)) {
            if (msg) {
              msg.textContent = 'Completá titular, banco y CBU/CVU o alias.';
              msg.classList.remove('hidden', 'text-emerald-300');
              msg.classList.add('text-red-300');
            }
            return;
          }
          if (bankCbuB && !/^\d+$/.test(bankCbuB)) {
            if (msg) {
              msg.textContent = 'El CBU/CVU solo debe contener números (sin guiones).';
              msg.classList.remove('hidden', 'text-emerald-300');
              msg.classList.add('text-red-300');
            }
            return;
          }
          var bankPayload = {
            partner_transfer_info: ferriolBuildPartnerBankingInfo({
              titular: bankTitB,
              banco: bankBcoB,
              cbu: bankCbuB,
              alias: bankAliasB
            })
          };
          accountProfileSaveBtn.disabled = true;
          try {
            var upBank = await supabaseClient.from('profiles').update(bankPayload).eq('id', currentUser.id);
            if (upBank.error) throw upBank.error;
            currentUser.partnerTransferInfo = bankPayload.partner_transfer_info != null ? String(bankPayload.partner_transfer_info) : '';
            applyAppShell();
            await loadSuperMasBankingSection();
            if (msg) {
          msg.textContent = 'Mis datos bancarios guardados.';
              msg.classList.remove('hidden', 'text-red-300');
              msg.classList.add('text-emerald-300');
            }
            closeAccountProfileModal();
          } catch (eB) {
            if (msg) {
              msg.textContent = String(eB.message || eB);
              msg.classList.remove('hidden', 'text-emerald-300');
              msg.classList.add('text-red-300');
            }
          } finally {
            accountProfileSaveBtn.disabled = false;
          }
          return;
        }

        var kioscoName = (document.getElementById('accountProfileKioscoName') && document.getElementById('accountProfileKioscoName').value || '').trim();
        var phoneVal = (document.getElementById('accountProfilePhone') && document.getElementById('accountProfilePhone').value || '').trim();
        var payload = { kiosco_name: kioscoName || null, phone: phoneVal || null };
        var showWa = currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode();
        if (showWa) {
          var wa = (document.getElementById('accountProfileWhatsappMsg') && document.getElementById('accountProfileWhatsappMsg').value || '').trim() || DEFAULT_WHATSAPP;
          payload.whatsapp_message = wa;
        }
        var fileIn = document.getElementById('accountProfileAvatarInput');
        var file = fileIn && fileIn.files && fileIn.files[0];
        if (_accountProfileRemoveAvatarFlag) {
          payload.avatar_url = null;
        }
        if (file) {
          if (file.size > 3 * 1024 * 1024) {
            if (msg) {
              msg.textContent = 'La imagen supera 3 MB. Elegí un archivo más liviano.';
              msg.classList.remove('hidden', 'text-emerald-300'); msg.classList.add('text-red-300');
            }
            return;
          }
          var ext = (file.name && file.name.lastIndexOf('.') > 0) ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '.jpg';
          if (ext.length > 6) ext = '.jpg';
          var fileId = (typeof crypto !== 'undefined' && crypto.randomUUID) ? crypto.randomUUID() : String(Date.now());
          var path = currentUser.id + '/profile-avatar/' + fileId + ext;
          try {
            var up = await supabaseClient.storage.from('comprobantes-ferriol').upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
            if (up.error) throw up.error;
            var pub = supabaseClient.storage.from('comprobantes-ferriol').getPublicUrl(path);
            payload.avatar_url = (pub && pub.data && pub.data.publicUrl) ? pub.data.publicUrl : path;
          } catch (e) {
            if (msg) {
              msg.textContent = 'No se pudo subir la foto: ' + String(e.message || e);
              msg.classList.remove('hidden', 'text-emerald-300'); msg.classList.add('text-red-300');
            }
            return;
          }
        }
        accountProfileSaveBtn.disabled = true;
        try {
          var upProf = await supabaseClient.from('profiles').update(payload).eq('id', currentUser.id);
          if (upProf.error) throw upProf.error;
          currentUser.kioscoName = kioscoName;
          currentUser.phone = phoneVal;
          if (showWa) currentUser.whatsappMessage = payload.whatsapp_message;
          if (payload.avatar_url !== undefined) currentUser.avatarUrl = payload.avatar_url ? String(payload.avatar_url).trim() : '';
          if (fileIn) fileIn.value = '';
          _accountProfileRemoveAvatarFlag = false;
          applyAppShell();
          fillConfigForm();
          await loadSuperMasBankingSection();
          if (msg) {
            msg.textContent = 'Cambios guardados.';
            msg.classList.remove('hidden', 'text-red-300'); msg.classList.add('text-emerald-300');
          }
          closeAccountProfileModal();
        } catch (e2) {
          if (msg) {
            msg.textContent = String(e2.message || e2);
            msg.classList.remove('hidden', 'text-emerald-300'); msg.classList.add('text-red-300');
          }
        } finally {
          accountProfileSaveBtn.disabled = false;
        }
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
        if (!supabaseClient || !currentUser || !isNetworkAdminRole(currentUser.role) || isAnyKioscoPreviewMode()) {
          if (msg) {
            msg.textContent = 'Solo un administrador (partner o fundador, sin modo tienda) puede guardar esto.';
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
          msg.textContent = 'Listo. Guardado en tu perfil (no visible para el negocio referido).';
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

    function applyDetectedBarcode(rawCode) {
      const norm = normalizeBarcode(rawCode);
      if (!norm) return;
      const now = Date.now();
      if (norm === normalizeBarcode(lastScannedCode) && now - lastScanTime < SCAN_COOLDOWN_MS) return;
      if (window._scanForProductCode) {
        lastScannedCode = norm;
        lastScanTime = now;
        var prodCodigoEl = document.getElementById('prodCodigo');
        if (prodCodigoEl) prodCodigoEl.value = norm;
        window._scanForProductCode = false;
        goToPanel('inventory');
        document.getElementById('productModal').classList.remove('hidden');
        document.getElementById('productModal').classList.add('flex');
        lucide.createIcons();
        return;
      }
      const data = getData();
      const found = findProductByCode(data.products, norm);
      if (found && found.product.stock > 0) {
        lastScannedCode = norm;
        lastScanTime = now;
        addToCart(found.codigo);
        playBeep();
        showScanToast('Agregado: ' + found.product.nombre, false);
      } else if (found && found.product.stock <= 0) {
        lastScannedCode = norm;
        lastScanTime = now;
        showScanToast('Sin stock: ' + found.product.nombre, true);
      } else {
        lastScannedCode = norm;
        lastScanTime = now;
        showScanToast('Producto no encontrado (código: ' + norm + ')', true);
      }
    }

    async function scanFrame() {
      if (!scannerStream || video.readyState !== 4) return;
      if (typeof BarcodeDetector === 'undefined') return;
      canvas.width = video.videoWidth;
      canvas.height = video.videoHeight;
      ctx.drawImage(video, 0, 0);
      try {
        const codes = await new BarcodeDetector().detect(canvas);
        if (codes.length) applyDetectedBarcode(codes[0].rawValue);
      } catch (_) {}
    }

    function stopScanInterval() {
      if (scanInterval) { clearInterval(scanInterval); scanInterval = null; }
    }
    window._stopScannerInterval = stopScanInterval;

    /* Lector USB (HID modo teclado): acumula tecleo rápido y cierra con Enter o Tab — misma lógica que la cámara */
    var usbWedgeBuffer = '';
    var usbWedgeTimer = null;
    var USB_WEDGE_IDLE_MS = 220;
    var USB_WEDGE_MAX_LEN = 64;
    function flushUsbWedgeBuffer() {
      usbWedgeBuffer = '';
      if (usbWedgeTimer) {
        clearTimeout(usbWedgeTimer);
        usbWedgeTimer = null;
      }
    }
    window._ferriolFlushUsbBarcode = flushUsbWedgeBuffer;
    function ferriolUsbWedgeIgnoreTarget(target) {
      if (!target) return false;
      /** Texto dentro de contenteditable da nodeType 3; si no lo tratamos, el wedge cancela la pulsación y queda cursor sin escribir. */
      var el = target.nodeType === 3 ? target.parentElement : target;
      if (!el || el.nodeType !== 1) return false;
      if (el.id === 'manualCode') return true;
      var cart = document.getElementById('cartPanel');
      if (cart && cart.classList.contains('translate-x-0')) return true;
      var tag = (el.tagName || '').toLowerCase();
      if (tag === 'textarea' || tag === 'select') return true;
      if (el.isContentEditable || el.closest && el.closest('[contenteditable="true"]')) return true;
      if (tag === 'input') {
        var typ = (el.type || '').toLowerCase();
        if (typ === 'button' || typ === 'submit' || typ === 'checkbox' || typ === 'radio' || typ === 'hidden') return false;
        return true;
      }
      return false;
    }

    /** Lector USB (modo teclado): en pantalla Escáner, o —en PC/ancho carril— en paneles típicos del kiosco sin pasar por la cámara. */
    function ferriolUsbWedgePanelsActive() {
      var p = document.body.getAttribute('data-panel') || '';
      if (p === 'scanner') return true;
      try {
        if (typeof window.matchMedia === 'function' && window.matchMedia('(min-width: 768px)').matches) {
          var kioscoPanels = ['dashboard', 'inventory', 'caja', 'mas', 'historial', 'clientes', 'config'];
          return kioscoPanels.indexOf(p) !== -1;
        }
      } catch (e) {}
      return false;
    }

    function onUsbWedgeKeydown(ev) {
      if (!ferriolUsbWedgePanelsActive()) return;
      if (ferriolUsbWedgeIgnoreTarget(ev.target)) return;
      if (ev.key === 'Escape') {
        flushUsbWedgeBuffer();
        return;
      }
      if (ev.key === 'Enter' || ev.key === 'Tab') {
        var code = normalizeBarcode(usbWedgeBuffer);
        flushUsbWedgeBuffer();
        if (code.length < 1) return;
        ev.preventDefault();
        ev.stopPropagation();
        applyDetectedBarcode(code);
        return;
      }
      if (ev.key === 'Backspace') {
        if (usbWedgeBuffer.length) {
          usbWedgeBuffer = usbWedgeBuffer.slice(0, -1);
          if (usbWedgeTimer) clearTimeout(usbWedgeTimer);
          usbWedgeTimer = setTimeout(flushUsbWedgeBuffer, USB_WEDGE_IDLE_MS);
          ev.preventDefault();
          ev.stopPropagation();
        }
        return;
      }
      if (ev.key === ' ') return;
      if (ev.key.length === 1 && !ev.ctrlKey && !ev.metaKey && !ev.altKey) {
        if (usbWedgeBuffer.length >= USB_WEDGE_MAX_LEN) usbWedgeBuffer = '';
        usbWedgeBuffer += ev.key;
        if (usbWedgeTimer) clearTimeout(usbWedgeTimer);
        usbWedgeTimer = setTimeout(flushUsbWedgeBuffer, USB_WEDGE_IDLE_MS);
        ev.preventDefault();
        ev.stopPropagation();
      }
    }
    window.addEventListener('keydown', onUsbWedgeKeydown, true);

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
        var subs = ['cierre', 'proveedores', 'gastos'];
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
        var subs = ['cierre', 'proveedores', 'gastos'];
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
      var fvInNew = document.getElementById('prodFechaVencimiento');
      if (fvInNew) fvInNew.value = '';
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
      var fvEl = document.getElementById('prodFechaVencimiento');
      var fvRaw = fvEl && fvEl.value ? String(fvEl.value).trim().slice(0, 10) : '';
      var fechaVencimiento = /^\d{4}-\d{2}-\d{2}$/.test(fvRaw) ? fvRaw : null;
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
        d.products[codigoNuevo] = { nombre, codigo: codigoNuevo, precio, stock, stockInicial: stockInicialFinal, costo, fechaVencimiento };
        state.cart.forEach(item => {
          if (item.codigo === editCodigo || item.codigo === codigoNuevo) {
            item.codigo = codigoNuevo;
            item.nombre = nombre;
            item.precio = precio;
            item.costo = costo;
          }
        });
      } else {
        d.products[codigoNuevo] = { nombre, codigo: codigoNuevo, precio, stock, stockInicial: stockInicial || stock, costo, fechaVencimiento };
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
    if (isPartner) {
      try {
        state.partnerUiMode = ferriolNormalizePartnerUiMode(sessionStorage.getItem('ferriol_partner_ui'));
      } catch (_) {
        state.partnerUiMode = 'red';
      }
      if (!currentUser.partnerFromKiosqueroUpgrade) {
        state.partnerUiMode = 'red';
        try { sessionStorage.removeItem('ferriol_partner_ui'); } catch (_) {}
      }
    } else if (currentUser) {
      state.partnerUiMode = 'red';
    }
    applyAppShell();
    await ferriolLoadPlanAmountsFromSupabase();
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
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
      await Promise.all([loadTrialReminderConfigFromSupabase(), refreshViewerHelpWhatsApp(currentUser)]);
      if (state.superUiMode === 'socio') ferriolStartNotificationPolling();
      else ferriolStopNotificationPolling();
      goToPanel('super');
      if (ferriolNotificationRecipientShell()) loadNotifications();
      ferriolTickCountdowns();
      lucide.createIcons();
    } else if (isPartner) {
      ferriolStartNotificationPolling();
      await ferriolRefreshPartnerKitGateFlag();
      if (window._ferriolPartnerKitGateNeedsProof === true) {
        window._ferriolGoToPlanCheckout('partner_kit', 'super');
        if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
        window._trialCountdownInterval = null;
        if (currentUser && currentUser.partnerLicensePending) {
          window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
          ferriolTickCountdowns();
        }
        applyAppShell();
        goToPanel('plan');
      } else if (state.partnerUiMode === 'negocio') {
        await window._partnerIrModoNegocio();
      } else {
        if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
        window._trialCountdownInterval = null;
        if (currentUser && currentUser.partnerLicensePending) {
          window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
          ferriolTickCountdowns();
        }
        goToPanel('super');
      }
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
      await syncKiosqueroPartnerUpgradeUi();
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
        if ((profile.role === 'kiosquero' || profile.role === 'partner' || profile.role === 'super') && !profile.active) {
          try {
            await refreshViewerHelpWhatsApp(profile);
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          errEl.textContent = profile.role === 'kiosquero'
            ? 'Tu cuenta está desactivada. Contactá a tu referidor por WhatsApp para regularizar.'
            : (profile.role === 'super'
              ? 'Tu cuenta administrador está desactivada. Coordiná con el otro administrador empresa o la renovación en el sistema.'
              : 'Tu cuenta está desactivada. Contactá por WhatsApp a los números que configuró la empresa (fundadores).');
          errEl.classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks(profile.role === 'super'
              ? 'Hola, mi cuenta administrador Ferriol OS está desactivada y necesito coordinar renovación.'
              : 'Hola, mi cuenta de Ferriol OS está desactivada y quiero darme de alta.');
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
        if (profile.role === 'super' && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          try {
            await supabaseClient.from('profiles').update({ active: false }).eq('id', uid);
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('signUpBox').classList.add('hidden');
          errEl.textContent = 'Venció la vigencia de tu cuenta como administrador (fundador). La cuenta se desactivó. Coordiná renovación con el otro administrador empresa.';
          errEl.classList.add('show');
          var wrapSu = document.getElementById('loginContactAdminWrap');
          if (wrapSu) {
            fillLoginContactLinks('Hola, venció la vigencia de mi cuenta administrador Ferriol OS y necesito coordinar.');
            wrapSu.classList.remove('hidden');
          }
          return;
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
        var partnerFromKUp = false;
        if (profile.role === 'partner') {
          partnerFromKUp = await ferriolFetchPartnerKiosqueroUpgradeEligible(uid);
        }
        currentUser = { id: profile.id, email: profile.email, role: profile.role, active: profile.active, kioscoName: profile.kiosco_name || '', whatsappMessage: profile.whatsapp_message || DEFAULT_WHATSAPP, trialEndsAt: trialEndsAt, created_at: userCreatedAt, referralCode: profile.referral_code || '', sponsorId: profile.sponsor_id || null, partnerSponsorId: profile.partner_sponsor_id || null, partnerLicensePending: !!profile.partner_license_pending, partnerKitReviewUntil: profile.partner_kit_review_until || null, partnerTransferInfo: profile.partner_transfer_info != null ? String(profile.partner_transfer_info) : '', phone: profile.phone != null ? String(profile.phone) : '', avatarUrl: profile.avatar_url != null ? String(profile.avatar_url).trim() : '', partnerFromKiosqueroUpgrade: partnerFromKUp, vencimientoAvisoDias: (function () { var x = Number(profile.vencimiento_aviso_dias); return Number.isFinite(x) ? Math.min(365, Math.max(0, Math.floor(x))) : null; })() };
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
        '<p><strong>9. CUENTAS DE NEGOCIO (KIOSQUEROS) Y REFERIDOR O DISTRIBUIDOR EN MORA.</strong> Si tu cuenta es de <strong>negocio</strong> que usa el sistema en el local (kiosquero u similar), <strong>no perdés tu cuenta ni tus datos de gestión</strong> solo porque tu referidor o distribuidor deje de pagar su membresía u obligaciones frente a Ferriol OS. La empresa tomará conocimiento del incumplimiento y podrá: <strong>hacerse cargo</strong> de la relación comercial contigo, <strong>reasignarte</strong> otro distribuidor o administrador de red, y aplicar la política operativa vigente. En tu sesión de la aplicación podrán <strong>actualizarse</strong> los datos de referencia y las <strong>instrucciones de pago</strong> correspondientes al <strong>nuevo referidor o administrador</strong> asignado, para que sigas abonando la suscripción mensual con claridad. Esto no impide medidas por otras causas (fraude, impago tuyo propio, pedido judicial, etc.).</p>' +
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
      } else {
        /** Alta negocio (kiosco) desde ?ref=: también debe guardarse sponsor_id (antes quedaba null). */
        var sidNk = await getSponsorIdForNewKiosqueroProfile();
        sp = { sponsorId: sidNk || null, error: null };
      }
      const { data, error } = await supabaseClient.auth.signUp({ email, password });
      if (error) {
        var emRaw = String(error.message || '').toLowerCase();
        var isDuplicateEmail =
          emRaw.indexOf('already registered') !== -1 ||
          emRaw.indexOf('already been registered') !== -1 ||
          emRaw.indexOf('user already') !== -1 ||
          emRaw.indexOf('already exists') !== -1 ||
          emRaw.indexOf('email address is already') !== -1;
        if (signupNicho === 'socio' && isDuplicateEmail) {
          errEl.textContent =
            'Ese correo ya tiene cuenta en Ferriol (p. ej. como negocio kiosco). No se puede crear un segundo usuario con el mismo email. Iniciá sesión con ese correo y en el inicio tocá «Quiero ser distribuidor» para pedir el upgrade con la misma cuenta; después Ferriol lo aprueba en Solicitudes.';
        } else {
          errEl.textContent = error.message;
        }
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
        var em = String(upProf.error.message || '');
        var sqlHint =
          em.indexOf('profiles_role_check') !== -1 || em.toLowerCase().indexOf('role_check') !== -1
            ? ' Abrí Supabase → SQL Editor y ejecutá el archivo «supabase-profiles-allow-role-partner.sql» del proyecto (permite crear cuentas de distribuidor). Después borrá la fila órfana si hace falta y registrate de nuevo, o cambiá el role a partner manualmente desde Supabase.'
            : '';
        errEl.textContent =
          'Usuario registrado, pero el perfil no se guardó: ' + em + sqlHint +
          ' Podés usar «Volver al inicio de sesión»: si entrás igual, revisá tabla profiles en Supabase (RLS / columna phone).';
        errEl.classList.add('show');
        return;
      }
      if (newRole === 'partner') await ensureUserReferralCode(newId);
      if (newRole === 'partner' && newId) {
        try {
          var linkRpc = await supabaseClient.rpc('ferriol_link_partner_pending_kit', { p_profile_id: newId });
          if (linkRpc.error) {
            console.warn('ferriol_link_partner_pending_kit:', linkRpc.error);
            var kitFallback = await supabaseClient.rpc('ferriol_partner_apply_kit_review_window');
            if (kitFallback.error) console.warn('ferriol_partner_apply_kit_review_window:', kitFallback.error);
          } else {
            var linkOut = linkRpc.data;
            if (typeof linkOut === 'string') { try { linkOut = JSON.parse(linkOut); } catch (_) {} }
            if (linkOut && linkOut.linked === true && linkOut.grace_hours != null) {
              window._ferriolLastSignupKitGraceHours = linkOut.grace_hours;
            }
            if (!linkOut || linkOut.linked !== true) {
              var kitRpc = await supabaseClient.rpc('ferriol_partner_apply_kit_review_window');
              if (kitRpc.error) console.warn('ferriol_partner_apply_kit_review_window:', kitRpc.error);
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
      try {
        closeAccountMenuDrawer(true);
      } catch (_) {}
      if (window._trialCountdownInterval) { clearInterval(window._trialCountdownInterval); window._trialCountdownInterval = null; }
      if (supabaseClient) supabaseClient.auth.signOut();
      ferriolStopNotificationPolling();
      _ferriolNotifFetchBaselineDone = false;
      ferriolTearDownSolicitudesBadgeRealtime();
      ferriolClearAllSolicitudesBadges();
      currentUser = null;
      state.superUiMode = 'empresa';
      state.partnerUiMode = 'red';
      try { sessionStorage.removeItem('ferriol_super_ui'); } catch (_) {}
      try { sessionStorage.removeItem('ferriol_partner_ui'); } catch (_) {}
      try {
        window._ferriolPartnerKitGateNeedsProof = false;
      } catch (_) {}
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

    var logoutHdr = document.getElementById('logoutBtn');
    if (logoutHdr) logoutHdr.onclick = doLogout;
    var logoutConfigEl = document.getElementById('logoutBtnConfig');
    if (logoutConfigEl) logoutConfigEl.onclick = doLogout;
    window._superIrModoNegocio = async function () {
      if (!currentUser || currentUser.role !== 'super') return;
      state.superUiMode = 'negocio';
      try { sessionStorage.setItem('ferriol_super_ui', 'negocio'); } catch (_) {}
      applyAppShell();
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
      await loadTrialReminderConfigFromSupabase();
      ferriolTickCountdowns();
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
    window._partnerIrModoNegocio = async function () {
      if (!currentUser || currentUser.role !== 'partner' || !currentUser.partnerFromKiosqueroUpgrade) return;
      state.partnerUiMode = 'negocio';
      try { sessionStorage.setItem('ferriol_partner_ui', 'negocio'); } catch (_) {}
      applyAppShell();
      if (window._trialCountdownInterval) clearInterval(window._trialCountdownInterval);
      window._trialCountdownInterval = setInterval(ferriolTickCountdowns, 1000);
      await loadTrialReminderConfigFromSupabase();
      ferriolTickCountdowns();
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
    var headerSubBtn = document.getElementById('headerSub');
    if (headerSubBtn) {
      headerSubBtn.addEventListener('click', function () {
        if (!currentUser) return;
        if (currentUser.role === 'partner') {
          if (!currentUser.partnerFromKiosqueroUpgrade) return;
          if (isPartnerKioscoPreviewMode()) {
            ferriolSetPartnerLens('red');
          } else {
            ferriolSetPartnerLens('negocio');
          }
          return;
        }
        if (currentUser.role !== 'super') return;
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
      var asNegocio = currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode();
      if (!asNegocio) return;
      document.getElementById('configKioscoName').value = currentUser.kioscoName || '';
      document.getElementById('configWhatsappMsg').value = currentUser.whatsappMessage || DEFAULT_WHATSAPP;
      var vAdv = document.getElementById('configVencimientoAvisoDias');
      if (vAdv) vAdv.value = String(ferriolVencimientoAvisoDias());
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
      var asNegocio = currentUser.role === 'kiosquero' || isAnyKioscoPreviewMode();
      if (!asNegocio) return;
      const kioscoName = document.getElementById('configKioscoName').value.trim();
      const whatsappMessage = document.getElementById('configWhatsappMsg').value.trim() || DEFAULT_WHATSAPP;
      var vAdvDays = parseInt(document.getElementById('configVencimientoAvisoDias') && document.getElementById('configVencimientoAvisoDias').value, 10);
      if (!Number.isFinite(vAdvDays) || vAdvDays < 0) vAdvDays = 7;
      vAdvDays = Math.min(365, Math.max(0, Math.floor(vAdvDays)));
      if (supabaseClient) {
        await supabaseClient.from('profiles').update({ kiosco_name: kioscoName, whatsapp_message: whatsappMessage, vencimiento_aviso_dias: vAdvDays }).eq('id', currentUser.id);
      }
      currentUser.kioscoName = kioscoName;
      currentUser.whatsappMessage = whatsappMessage;
      currentUser.vencimientoAvisoDias = vAdvDays;
      document.getElementById('headerTitle').textContent = kioscoName || 'Ferriol OS';
      try { renderInventory(); } catch (_) {}
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
        var d = await ferriolResolveSponsorProfile(profile);
        if (!d) {
          viewerHelpWhatsApp.note = 'sponsor_not_found';
          return;
        }
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

    /** WhatsApp en tarjeta kiosquero: legible en pantalla (sin copiar mal el +) */
    function ferriolFormatPhoneForDisplay(digitsOnly) {
      var d = String(digitsOnly || '').replace(/\D/g, '');
      if (!d) return '—';
      if (d.length >= 10 && d.slice(0, 2) === '54') {
        var rest = d.slice(2);
        var chunks = [];
        chunks.push(rest.slice(0, 2));
        if (rest.length > 2) chunks.push(rest.slice(2, 6));
        if (rest.length > 6) chunks.push(rest.slice(6));
        return '+54 ' + chunks.filter(Boolean).join(' ');
      }
      var out = '';
      for (var j = 0; j < d.length; j += 4) out += (out ? ' ' : '') + d.slice(j, j + 4);
      return out;
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

    /** Lista Afiliados: si el socio está en ventana de aprobación kit, ese plazo — no trial_ends_at (ej. 15 días de prueba). */
    function ferriolProfileListCountdownEndsAt(u) {
      if (!u) return null;
      if (
        u.role === 'partner' &&
        u.partner_kit_review_until &&
        new Date(u.partner_kit_review_until) > new Date()
      ) {
        return u.partner_kit_review_until;
      }
      return u.trial_ends_at || null;
    }
    function ferriolProfileListCountdownIsKitReview(u) {
      return !!(
        u &&
        u.role === 'partner' &&
        u.partner_kit_review_until &&
        new Date(u.partner_kit_review_until) > new Date()
      );
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
        var isKit = row && row.getAttribute('data-countdown-kit-review') === '1';
        span.textContent = t.expired ? 'Vencida' : t.text;
        span.className =
          'inv-item-price super-list-countdown ' +
          (t.expired ? 'text-red-300' : isKit ? 'text-amber-200/95' : 'text-[#86efac]');
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
      var endsForList = ferriolProfileListCountdownEndsAt(u);
      var trialFull = trialLabelFull(endsForList);
      var badge = trialFull.expired ? 'Vencida' : trialFull.text;
      var endIso = (endsForList || '').replace(/"/g, '&quot;');
      var kitReviewRow = ferriolProfileListCountdownIsKitReview(u);
      var email = (u.email || '').replace(/</g, '&lt;');
      var stockClass = u.active ? 'text-white/45' : 'text-red-400/90';
      var sinRef = (!u.sponsor_id && isEmpresaLensSuper()) ? '<span class="text-amber-200/80 text-[10px] font-normal"> · sin ref.</span>' : '';
      var priceClass = trialFull.expired ? 'text-red-300' : kitReviewRow ? 'text-amber-200/95' : 'text-[#86efac]';
      var kitRev = '';
      if (kitReviewRow) {
        kitRev = ' <span class="ml-1 inline-block text-[9px] font-bold uppercase tracking-wide text-amber-200 bg-amber-500/25 border border-amber-400/40 rounded px-1 py-0.5 align-middle">Kit</span>';
      }
      return (
        '<button type="button" class="inventory-item super-afiliado-row w-full text-left border-x-0 rounded-none" data-id="' +
        u.id +
        '" data-trial-ends-at="' +
        endIso +
        '" data-countdown-kit-review="' +
        (kitReviewRow ? '1' : '0') +
        '">' +
        '<div class="inv-item-info">' +
        '<span class="inv-item-name"><span class="block truncate">' + name + sinRef + kitRev + '</span></span>' +
        '<span class="inv-item-price super-list-countdown ' + priceClass + '">' + badge + '</span>' +
        '<span class="inv-item-stock ' + stockClass + ' max-w-[32vw] sm:max-w-[40%] truncate" title="' + email + '">' + email + '</span>' +
        '</div>' +
        '<i data-lucide="chevron-right" class="w-5 h-5 text-white/35 shrink-0"></i>' +
        '</button>'
      );
    }
    function closeSuperMdrSumModal() {
      var m = document.getElementById('superUserMdrSumModal');
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
      }
      var c = document.getElementById('superUserMdrSumContent');
      if (c) c.innerHTML = '';
    }
    function closeSuperMdrRemModal() {
      var m = document.getElementById('superUserMdrRemModal');
      if (m) {
        m.classList.add('hidden');
        m.classList.remove('flex');
      }
      var c = document.getElementById('superUserMdrRemContent');
      if (c) c.innerHTML = '';
    }
    function closeAllSuperUserMdrSubmodals() {
      closeSuperMdrSumModal();
      closeSuperMdrRemModal();
    }
    function wireMdrSumForm(rootEl, u) {
      var payInEl = rootEl.querySelector('.super-detail-req-client-payment');
      var pctDispEl = rootEl.querySelector('.super-detail-req-company-pct');
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
      var reqBtn = rootEl.querySelector('.super-detail-req-submit-add');
      if (reqBtn) {
        reqBtn.onclick = async function () {
          if (!supabaseClient || !currentUser) return;
          var daysIn = rootEl.querySelector('.super-detail-req-add-days');
          var days = Math.max(1, Math.min(365, parseInt(daysIn && daysIn.value ? daysIn.value : 30, 10) || 30));
          var pay = parseFloat(String((payInEl && payInEl.value) || '').replace(',', '.'), 10);
          if (isNaN(pay) || pay <= 0) { alert('Indicá el monto cobrado al cliente o socio.'); return; }
          var share = Math.round(pay * 0.2 * 100) / 100;
          var noteEl = rootEl.querySelector('.super-detail-req-company-note');
          var note = noteEl ? String(noteEl.value || '').trim() : '';
          var who = u.role === 'partner' ? 'este socio' : 'este negocio';
          if (!confirm('Se enviará la solicitud de +' + days + ' días para ' + who + '. La empresa debe aprobar antes de cambiar el contador. ¿Continuar?')) return;
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
          alert('Solicitud enviada.');
          renderSuper();
          closeSuperMdrSumModal();
        };
      }
    }
    function wireMdrRemForm(rootEl, u) {
      var reqRemBtn = rootEl.querySelector('.super-detail-req-submit-remove');
      if (reqRemBtn) {
        reqRemBtn.onclick = async function () {
          if (!supabaseClient || !currentUser) return;
          var dIn = rootEl.querySelector('.super-detail-req-remove-days');
          var daysRm = Math.max(1, Math.min(365, parseInt(dIn && dIn.value ? dIn.value : 1, 10) || 1));
          var reasonEl = rootEl.querySelector('.super-detail-req-remove-reason');
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
          closeSuperMdrRemModal();
        };
      }
    }
    function buildSuperMdrSumInnerHtml(user) {
      var isPartner = user.role === 'partner';
      var amtDef = isPartner ? FERRIOL_PLAN_AMOUNTS.vendorMonthly : FERRIOL_PLAN_AMOUNTS.kioscoMonthly;
      var shell = isPartner ? 'rounded-xl border border-violet-500/35 bg-violet-500/08 p-4 space-y-3' : 'rounded-xl border border-emerald-500/35 bg-emerald-500/08 p-4 space-y-3';
      var intro = isPartner
        ? '<p class="text-xs text-white/65 leading-relaxed">Cuando el socio ya te pagó la cuota, indicá monto y 20% a Ferriol. La empresa aprueba y recién ahí se actualiza la vigencia de la membresía.</p>'
        : '<p class="text-xs text-white/65 leading-relaxed">Ej. suscripción mensual <strong class="text-white/80">$ ' + FERRIOL_PLAN_AMOUNTS.kioscoMonthly.toLocaleString('es-AR') + '</strong>. Completás el 20% a la empresa en la solicitud; Ferriol aprueba y recién ahí cambia el contador del negocio.</p>';
      return (
        intro +
        '<div class="' +
        shell +
        '">' +
        '<div class="flex flex-wrap items-end gap-2">' +
        '<label class="text-[11px] text-white/55 block w-full">Días a sumar</label>' +
        '<input type="number" min="1" max="365" value="30" class="super-detail-req-add-days w-24 px-2 py-2.5 rounded-lg text-sm bg-white/10 border border-white/20 text-white touch-target">' +
        '</div>' +
        '<div>' +
        '<label class="text-[11px] text-white/55">' +
        (isPartner ? 'Monto cobrado al socio / cuota (ARS)' : 'Monto cobrado al cliente (ARS)') +
        '</label>' +
        '<input type="number" min="1" step="1" class="super-detail-req-client-payment w-full glass rounded-lg px-3 py-2.5 border border-white/20 text-white text-sm mt-1" value="' +
        amtDef +
        '">' +
        '</div>' +
        '<p class="text-[11px] text-white/50">20% empresa: <strong class="text-cyan-200/90 super-detail-req-company-pct">—</strong> ARS</p>' +
        '<div>' +
        '<label class="text-[11px] text-white/55">Ref. del pago del 20% a empresa (opcional)</label>' +
        '<input type="text" class="super-detail-req-company-note w-full glass rounded-lg px-3 py-2.5 border border-white/20 text-white text-sm mt-1" placeholder="Ej. transferencia, fecha, banco">' +
        '</div>' +
        '<button type="button" class="super-detail-req-submit-add w-full py-3 rounded-xl text-sm touch-target font-medium ' +
        (isPartner ? 'bg-violet-500/25 text-violet-50 border border-violet-400/45' : 'bg-emerald-500/25 text-emerald-100 border border-green-500/45') +
        '">Enviar solicitud</button>' +
        '</div>'
      );
    }
    function buildSuperMdrRemInnerHtml(user) {
      var isPartner = user.role === 'partner';
      var shell = isPartner ? 'rounded-xl border border-red-500/35 bg-red-500/06 p-4 space-y-3' : 'rounded-xl border border-red-500/35 bg-red-500/08 p-4 space-y-3';
      var intro = isPartner
        ? '<p class="text-[11px] text-white/65 leading-relaxed">Motivo obligatorio. La empresa debe aprobar antes de descontar días de la licencia de socio.</p>'
        : '<p class="text-[11px] text-white/65 leading-relaxed">Indicá el motivo. La empresa debe aprobar antes de restar días del negocio.</p>';
      return (
        intro +
        '<div class="' +
        shell +
        '">' +
        '<div class="flex flex-wrap items-end gap-2">' +
        '<label class="text-[11px] text-white/55 block w-full">Días a quitar</label>' +
        '<input type="number" min="1" max="365" value="1" class="super-detail-req-remove-days w-24 px-2 py-2.5 rounded-lg text-sm bg-white/10 border border-white/20 text-white touch-target">' +
        '</div>' +
        '<div>' +
        '<label class="text-[11px] text-white/55">Motivo obligatorio</label>' +
        '<textarea class="super-detail-req-remove-reason w-full glass rounded-lg px-3 py-2.5 border border-white/20 text-white text-sm min-h-[5rem] mt-1" placeholder="' +
        (isPartner ? 'Motivo (licencia distribuidor)…' : 'Por qué deben descontarse días en este negocio.') +
        '"></textarea>' +
        '</div>' +
        '<button type="button" class="super-detail-req-submit-remove w-full py-3 rounded-xl text-sm bg-red-600/25 text-red-100 border border-red-500/45 touch-target font-medium">Enviar solicitud de quita</button>' +
        '</div>'
      );
    }
    function openSuperMdrSumModal(subjectUser) {
      var ttl = document.getElementById('superUserMdrSumTitle');
      var modal = document.getElementById('superUserMdrSumModal');
      var cnt = document.getElementById('superUserMdrSumContent');
      if (!modal || !cnt) return;
      if (ttl) {
        ttl.textContent =
          subjectUser.role === 'partner' ? 'Solicitar suma de días (licencia socio)' : 'Solicitar suma de días';
        ttl.className =
          subjectUser.role === 'partner'
            ? 'font-bold text-lg text-violet-100 pr-6'
            : 'font-bold text-lg text-emerald-100 pr-6';
      }
      cnt.innerHTML = buildSuperMdrSumInnerHtml(subjectUser);
      wireMdrSumForm(cnt, subjectUser);
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      try {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
    }
    function openSuperMdrRemModal(subjectUser) {
      var ttl = document.getElementById('superUserMdrRemTitle');
      var modal = document.getElementById('superUserMdrRemModal');
      var cnt = document.getElementById('superUserMdrRemContent');
      if (!modal || !cnt) return;
      if (ttl) {
        ttl.textContent =
          subjectUser.role === 'partner' ? 'Solicitar quita de días (licencia socio)' : 'Solicitar quita de días';
      }
      cnt.innerHTML = buildSuperMdrRemInnerHtml(subjectUser);
      wireMdrRemForm(cnt, subjectUser);
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      try {
        if (typeof lucide !== 'undefined' && lucide.createIcons) lucide.createIcons();
      } catch (_) {}
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
      var detailEndsAt = ferriolProfileListCountdownEndsAt(user);
      var kitRevLive = ferriolProfileListCountdownIsKitReview(user);
      const trialFull = trialLabelFull(detailEndsAt);
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
        var candidates = poolFull.filter(function (p) {
          if (!p || p.id === user.id) return false;
          return p.role === 'super' || p.role === 'partner';
        }).slice().sort(function (a, b) {
          var ra = (a.role === 'super') ? 0 : (a.role === 'partner') ? 1 : 2;
          var rb = (b.role === 'super') ? 0 : (b.role === 'partner') ? 1 : 2;
          if (ra !== rb) return ra - rb;
          return (a.kiosco_name || a.email || '').localeCompare(b.kiosco_name || b.email || '');
        });
        var hasCurrentSponsorInList =
          !!(user.sponsor_id && candidates.some(function (p) { return p.id === user.sponsor_id; }));
        var leg = null;
        if (user.sponsor_id && !hasCurrentSponsorInList) {
          leg = poolFull.find(function (p) { return p && p.id === user.sponsor_id; });
          if (leg) {
            var labLeg =
              '[actual: ' + (leg.role || '?') + '] ' +
              (leg.kiosco_name || leg.email || '').slice(0, 36) +
              (leg.email ? ' · ' + leg.email : '');
            opts.push(
              '<option value="' +
                leg.id +
                '" selected title="Solo super o partner pueden patrocinar. Reasigná a un distribuidor o fundador.">' +
                labLeg.replace(/</g, '&lt;') +
                '</option>'
            );
          }
        }
        var superListCand = candidates.filter(function (p) { return p.role === 'super'; });
        var partnerListCand = candidates.filter(function (p) { return p.role === 'partner'; });
        function pushSponsorCandOpts(list) {
          list.forEach(function (p) {
            var lab =
              '[' + (p.role || '?') + '] ' +
              (p.kiosco_name || p.email || '').slice(0, 36) +
              (p.email ? ' · ' + p.email : '');
            var sel = user.sponsor_id && p.id === user.sponsor_id ? ' selected' : '';
            opts.push('<option value="' + p.id + '"' + sel + '>' + lab.replace(/</g, '&lt;') + '</option>');
          });
        }
        if (superListCand.length) {
          opts.push('<optgroup label="Fundadores (super)">');
          pushSponsorCandOpts(superListCand);
          opts.push('</optgroup>');
        }
        if (partnerListCand.length) {
          opts.push('<optgroup label="Distribuidores (partner)">');
          pushSponsorCandOpts(partnerListCand);
          opts.push('</optgroup>');
        }
        assignHtml = `
        <div class="border-t border-white/10 pt-4 space-y-2">
          <p class="text-sm font-medium text-[#86efac] flex items-center gap-2"><i data-lucide="git-branch" class="w-4 h-4"></i> Asignar referidor / admin de la red</p>
          <p class="text-xs text-white/50">Solo cuentas <span class="text-[#86efac]">super</span> (fundadores) y <span class="text-violet-300/95">partner</span> (distribuidores) pueden patrocinar suscriptores.</p>
          <div class="relative">
            <select id="superDetailSponsorSelect" class="ferriol-sponsor-select w-full rounded-xl pl-3 pr-10 py-3 text-sm appearance-none cursor-pointer min-h-[3rem]">${opts.join('')}</select>
            <i data-lucide="chevron-down" class="ferriol-sponsor-select-chevron pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#86efac]/70"></i>
          </div>
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
          <p class="text-sm font-medium text-cyan-200/95 flex items-center gap-2"><i data-lucide="percent" class="w-4 h-4"></i> Venta suscripción mensual negocio (alta definitiva)</p>
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
        var bulkCandidates = poolNet.filter(function (p) {
          if (!p || p.id === user.id) return false;
          return p.role === 'super' || p.role === 'partner';
        }).slice().sort(function (a, b) {
          var ra = (a.role === 'super') ? 0 : (a.role === 'partner') ? 1 : 2;
          var rb = (b.role === 'super') ? 0 : (b.role === 'partner') ? 1 : 2;
          if (ra !== rb) return ra - rb;
          return (a.kiosco_name || a.email || '').localeCompare(b.kiosco_name || b.email || '');
        });
        var bulkSuper = bulkCandidates.filter(function (p) { return p.role === 'super'; });
        var bulkPartner = bulkCandidates.filter(function (p) { return p.role === 'partner'; });
        function pushBulkCandOpts(list) {
          list.forEach(function (p) {
            var lab = '[' + (p.role || '?') + '] ' + (p.kiosco_name || p.email || '').slice(0, 36) + (p.email ? (' · ' + p.email) : '');
            optsBulk.push('<option value="' + p.id + '">' + lab.replace(/</g, '&lt;') + '</option>');
          });
        }
        if (bulkSuper.length) {
          optsBulk.push('<optgroup label="Fundadores (super)">');
          pushBulkCandOpts(bulkSuper);
          optsBulk.push('</optgroup>');
        }
        if (bulkPartner.length) {
          optsBulk.push('<optgroup label="Distribuidores (partner)">');
          pushBulkCandOpts(bulkPartner);
          optsBulk.push('</optgroup>');
        }
        partnerNetworkControlHtml = `
        <div class="border-t border-white/10 pt-4 space-y-3 super-partner-network-control">
          <p class="text-sm font-medium text-amber-200 flex items-center gap-2"><i data-lucide="git-branch" class="w-4 h-4"></i> Fundador — control de red y penalidades</p>
          <p class="text-xs text-white/55">Solo el perfil <strong class="text-amber-100/90">fundador</strong> (administrador raíz en vista empresa). Referidos <strong>directos</strong> de este socio: <strong class="text-white/80">${directKios.length}</strong> negocio(s) (kiosquero) y <strong class="text-white/80">${directSoc.length}</strong> socio(s). Los negocios <strong>no se borran</strong> al sancionar al socio: reasignalos a otro admin o a vos.</p>
          <label class="flex items-center gap-2 text-xs text-white/70 cursor-pointer touch-target py-1">
            <input type="checkbox" id="superBulkReassignIncludePartners" class="rounded border-white/30 bg-white/10 text-amber-500 shrink-0">
            <span>Incluir socios directos en la reasignación (además de kiosqueros)</span>
          </label>
          <div class="relative">
            <select id="superBulkReassignSponsorSelect" class="ferriol-sponsor-select w-full rounded-xl pl-3 pr-10 py-3 text-sm appearance-none cursor-pointer min-h-[3rem]">${optsBulk.join('')}</select>
            <i data-lucide="chevron-down" class="ferriol-sponsor-select-chevron pointer-events-none absolute right-3 top-1/2 -translate-y-1/2 w-5 h-5 text-[#86efac]/70"></i>
          </div>
          <button type="button" class="super-detail-bulk-reassign w-full py-2.5 rounded-xl text-sm bg-amber-500/20 text-amber-100 border border-amber-400/45 touch-target font-medium">Reasignar toda la línea directa</button>
          <button type="button" class="super-detail-partner-penalty w-full py-2.5 rounded-xl text-sm bg-red-600/25 text-red-200 border border-red-500/50 touch-target font-medium ${user.active ? '' : 'opacity-50 pointer-events-none'}" ${user.active ? '' : 'disabled'}>Penalidad: desactivar acceso del socio</button>
          <p class="text-[10px] text-white/40">El socio inactivo no puede entrar a la app. Comisiones/libro: gestioná aparte según política. Evitá dejar kiosqueros sin referidor si querés que sigan pagando a alguien de la red.</p>
        </div>`;
      }
      var kitRevDetailHtml = '';
      if (isFounderEmpresa && user.role === 'partner' && user.partner_kit_review_until) {
        var kIso = user.partner_kit_review_until;
        var kDt = new Date(kIso);
        var kLab = !isNaN(kDt.getTime()) ? kDt.toLocaleString('es-AR', { dateStyle: 'short', timeStyle: 'short' }) : String(kIso).replace(/</g, '&lt;');
        var kActive = !isNaN(kDt.getTime()) && kDt > new Date();
        kitRevDetailHtml =
          '<div class="border-t border-white/10 pt-4 space-y-2 super-detail-kit-review">' +
          '<p class="text-sm font-medium text-amber-200 flex items-center gap-2"><i data-lucide="package" class="w-4 h-4"></i> Aprobación kit inicial</p>' +
          '<p class="text-xs text-white/55">' +
          (kActive ? 'El socio ve un aviso en el avatar hasta:' : 'La ventana ya pasó; podés limpiar el aviso si sigue figurando:') +
          ' <strong class="text-amber-100/90">' +
          kLab +
          '</strong></p>' +
          '<button type="button" class="super-detail-clear-kit-review w-full py-2.5 rounded-xl text-sm bg-emerald-600/22 text-emerald-100 border border-emerald-400/45 touch-target font-medium">Confirmé el cobro del kit — quitar aviso del perfil</button>' +
          '</div>';
      }
      var quitarHtml = isSocioLens ? '' : `
            <button type="button" class="super-detail-quitar w-full py-2.5 rounded-xl text-sm bg-red-500/20 text-red-300 border border-red-500/40 touch-target flex items-center justify-center gap-2">
              <i data-lucide="user-minus" class="w-4 h-4"></i> Quitar negocio (pide contraseña admin)
            </button>`;
      var founderActionsHtml = `
        <div class="border-t border-white/10 pt-4 space-y-3 super-detail-actions-founder">
          <p class="text-xs text-white/55 leading-relaxed">Los <strong class="text-[#86efac]/90">días de vigencia</strong> (kiosco o socio) no se cargan a mano acá: solo desde la <strong class="text-white/75">cola de aprobaciones</strong> en Negocios, después de verificar el cobro y el pago a Ferriol.</p>
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
        <div class="border-t border-white/10 pt-5 space-y-4 super-detail-actions-socio-kiosquero">
          <p class="text-xs text-white/55 leading-relaxed">Los administradores de red no modifican los días a mano: cada acción abre su propia pantalla. La empresa aprueba antes de aplicar cambios al contador (suscripción mensual ejemplo <strong class="text-white/70">$ ${FERRIOL_PLAN_AMOUNTS.kioscoMonthly.toLocaleString('es-AR')}</strong>).</p>
          <div class="flex flex-col gap-4">
            <button type="button" class="super-detail-open-mdr-sum w-full py-3.5 rounded-xl text-sm bg-emerald-500/20 text-emerald-100 border border-emerald-500/45 touch-target font-medium shadow-sm shadow-black/15">Solicitar suma de días</button>
            <button type="button" class="super-detail-open-mdr-rem w-full py-3.5 rounded-xl text-sm bg-red-600/22 text-red-100 border border-red-500/45 touch-target font-medium shadow-sm shadow-black/15">Solicitar quita de días</button>
            <button type="button" class="super-detail-reset w-full py-3.5 rounded-xl text-sm bg-amber-500/20 text-amber-300 border border-amber-500/40 touch-target flex items-center justify-center gap-2 shadow-sm shadow-black/15">
              <i data-lucide="key" class="w-4 h-4"></i> Recuperar contraseña
            </button>
          </div>
        </div>`;
      var socioPartnerLicenseHtml = `
        <div class="border-t border-white/10 pt-5 space-y-4 super-detail-actions-socio-partner-license">
          <p class="text-xs text-white/55 leading-relaxed"><strong class="text-violet-200/95">Licencia de distribución</strong>: sumá o quitá días solo por solicitud; la empresa debe aprobar. Usá cada botón para abrir el formulario.</p>
          <div class="flex flex-col gap-4">
            <button type="button" class="super-detail-open-mdr-sum w-full py-3.5 rounded-xl text-sm bg-violet-500/22 text-violet-100 border border-violet-500/45 touch-target font-medium shadow-sm shadow-black/15">Solicitar suma de días</button>
            <button type="button" class="super-detail-open-mdr-rem w-full py-3.5 rounded-xl text-sm bg-red-600/22 text-red-100 border border-red-500/45 touch-target font-medium shadow-sm shadow-black/15">Solicitar quita de días</button>
            <button type="button" class="super-detail-reset w-full py-3.5 rounded-xl text-sm bg-amber-500/20 text-amber-300 border border-amber-500/40 touch-target flex items-center justify-center gap-2 shadow-sm shadow-black/15">
              <i data-lucide="key" class="w-4 h-4"></i> Recuperar contraseña
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
          <p><span class="text-white/50">${kitRevLive ? 'Aprobación kit (cuenta atrás):' : 'Membresía:'}</span> <span id="superDetailCountdown" class="${trialFull.expired ? 'text-red-300' : kitRevLive ? 'text-amber-200' : 'text-[#f87171]'}">${trialFull.text}</span></p>
          <p><span class="text-white/50">Código de referido:</span> ${refCodeEsc}</p>
          <p><span class="text-white/50">Referido por:</span> ${sponsorLine}</p>
        </div>
        ${assignHtml}
        ${defSaleHtml}
        ${partnerNetworkControlHtml}
        ${kitRevDetailHtml}
        ${adminActionsHtml}
      `;
      modal.classList.remove('hidden');
      modal.classList.add('flex');
      lucide.createIcons();
      var u = user;
      var openSumBtn = content.querySelector('.super-detail-open-mdr-sum');
      if (openSumBtn) openSumBtn.onclick = function () { openSuperMdrSumModal(u); };
      var openRemBtn = content.querySelector('.super-detail-open-mdr-rem');
      if (openRemBtn) openRemBtn.onclick = function () { openSuperMdrRemModal(u); };
      var defSaleBtn = content.querySelector('.super-detail-definitive-sale');
      if (defSaleBtn) {
        defSaleBtn.onclick = async function () {
          if (!supabaseClient) return;
          if (!confirm('Se registrará en el libro la venta de suscripción mensual de este negocio (20% empresa, 80% del socio vendedor referidor). Solo se puede una vez por kiosco. ¿Continuar?')) return;
          var rpc = await supabaseClient.rpc('ferriol_register_kiosco_definitive_sale', { p_kiosco_user_id: u.id });
          if (rpc.error) { alert('Error: ' + (rpc.error.message || '')); return; }
          var out = rpc.data;
          if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
          if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo registrar.'); return; }
          alert('Registrado. Empresa: 20% pendiente de cobro. Socio: 20% a pagar y 80% comisión pendiente (ver panel del socio).');
          if (state.superSection === 'sistema' || state.superSection === 'cobros') renderSuperCobrosSection();
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
      var clrKitBtn = content.querySelector('.super-detail-clear-kit-review');
      if (clrKitBtn) {
        clrKitBtn.onclick = async function () {
          if (!supabaseClient) return;
          var rpc = await supabaseClient.rpc('ferriol_founder_clear_partner_kit_review', { p_profile_id: u.id });
          if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
          var out = rpc.data;
          if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
          if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo actualizar.'); return; }
          u.partner_kit_review_until = null;
          var ixk = (window._ferriolAllProfilesCache || []).findIndex(function (r) { return r.id === u.id; });
          if (ixk >= 0) window._ferriolAllProfilesCache[ixk].partner_kit_review_until = null;
          alert('Listo: aviso de kit quitado.');
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
          const t = trialLabelFull(detailEndsAt);
          countdownEl.textContent = t.text;
          countdownEl.className = t.expired ? 'text-red-300' : kitRevLive ? 'text-amber-200' : 'text-[#f87171]';
        }, 1000);
      }
    }
    document.getElementById('superUserDetailClose').onclick = () => {
      if (superDetailCountdownInterval) clearInterval(superDetailCountdownInterval);
      superDetailCountdownInterval = null;
      closeAllSuperUserMdrSubmodals();
      document.getElementById('superUserDetailModal').classList.add('hidden');
      document.getElementById('superUserDetailModal').classList.remove('flex');
      renderSuper();
    };
    document.getElementById('superUserDetailOverlay').onclick = () => { if (superDetailCountdownInterval) clearInterval(superDetailCountdownInterval); superDetailCountdownInterval = null; document.getElementById('superUserDetailClose').click(); };

    var _sumMdrClose = document.getElementById('superUserMdrSumClose');
    if (_sumMdrClose) _sumMdrClose.onclick = closeSuperMdrSumModal;
    var _sumMdrOv = document.getElementById('superUserMdrSumOverlay');
    if (_sumMdrOv) _sumMdrOv.onclick = closeSuperMdrSumModal;
    var _remMdrClose = document.getElementById('superUserMdrRemClose');
    if (_remMdrClose) _remMdrClose.onclick = closeSuperMdrRemModal;
    var _remMdrOv = document.getElementById('superUserMdrRemOverlay');
    if (_remMdrOv) _remMdrOv.onclick = closeSuperMdrRemModal;

    var superFilterState = 'todos';

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
      if (!supabaseClient || !currentUser) {
        if (state.superSection === 'solicitudes') {
          syncFounderSolicitudesTabShell();
          syncPartnerSolicitudesTabShell();
        }
        return;
      }
      try {
        if (isEmpresaLensSuper() && founderBox) {
          var r = await supabaseClient.from('ferriol_membership_day_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50);
          var rProv = await supabaseClient.from('ferriol_partner_provision_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50);
          var rKpr = await supabaseClient.from('ferriol_kiosquero_provision_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50);
          var rKpur = await supabaseClient.from('ferriol_kiosquero_partner_upgrade_requests').select('*').eq('status', 'pending').order('created_at', { ascending: false }).limit(50);
          var dayErr = r.error;
          var provErr = rProv.error;
          var kprErr = rKpr.error;
          var kpurErr = rKpur.error;
          var rows = dayErr ? [] : (r.data || []);
          var provRows = provErr ? [] : (rProv.data || []);
          var kprRows = kprErr ? [] : (rKpr.data || []);
          var kpurRows = kpurErr ? [] : (rKpur.data || []);
          if (dayErr && provErr && kprErr && kpurErr) {
            founderBox.innerHTML = '<p class="text-xs text-amber-200/90 font-medium mb-1">Aprobaciones pendientes</p><p class="text-xs text-white/55">No se pudieron cargar las colas. Ejecutá los SQL del proyecto (membresía, partner-provision, kiosquero-provision, <strong class="text-white/70">supabase-ferriol-kiosquero-partner-upgrade-requests.sql</strong>, mdr-partner-target). ' + String(dayErr.message || provErr.message || kprErr.message || kpurErr.message || '') + '</p>';
            lucide.createIcons();
            return;
          }
          if (rows.length === 0 && provRows.length === 0 && kprRows.length === 0 && kpurRows.length === 0) {
            founderBox.innerHTML = '<p class="text-xs text-amber-200/90 font-medium mb-1 flex items-center gap-2"><i data-lucide="inbox" class="w-4 h-4"></i> Aprobaciones (empresa)</p><p class="text-xs text-white/55">No hay pendientes: días de vigencia, altas de socios, altas de negocios ni upgrades kiosco→socio.</p>';
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
          if (kpurErr) {
            html += '<p class="text-[10px] text-red-300 mb-2">Upgrade kiosco → socio: error. ' + String(kpurErr.message || '') + '</p>';
          } else if (kpurRows.length > 0) {
            html += '<p class="text-[11px] font-medium text-blue-300/95 mb-1">Kiosquero solicita pasar a distribuidor</p><div class="space-y-2 max-h-[26vh] overflow-y-auto pr-1">';
            kpurRows.forEach(function (row) {
              var kn = String(nameOf(row.profile_id)).replace(/</g, '&lt;');
              var pe = pool.find(function (x) { return x && x.id === row.profile_id; });
              var em = pe && pe.email ? String(pe.email).replace(/</g, '&lt;') : '';
              var kitLine = row.partner_kit_sponsor_id ? '<p class="text-[10px] text-violet-200/90">Socio del kit: ' + String(nameOf(row.partner_kit_sponsor_id)).replace(/</g, '&lt;') + '</p>' : '<p class="text-[10px] text-white/45">Socio del kit: misma línea que el negocio (sponsor)</p>';
              var noteLine = row.applicant_note ? '<p class="text-[10px] text-cyan-100/80">Nota: ' + String(row.applicant_note).replace(/</g, '&lt;') + '</p>' : '';
              html += '<div class="rounded-lg border border-blue-500/30 bg-blue-950/20 p-2 text-xs">' +
                '<p class="font-medium text-white/90">' + kn + '</p><p class="text-[10px] text-white/55">' + em + '</p>' + kitLine + noteLine +
                '<div class="flex flex-wrap gap-2 mt-2">' +
                '<button type="button" class="ferriol-kpur-approve btn-glow rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target" data-kpur-id="' + row.id + '">Aprobar upgrade</button>' +
                '<button type="button" class="ferriol-kpur-reject rounded-lg py-1.5 px-3 text-[11px] font-semibold touch-target border border-red-400/50 bg-red-500/15 text-red-200" data-kpur-id="' + row.id + '">Rechazar</button>' +
                '</div></div>';
            });
            html += '</div>';
          }
          founderBox.innerHTML = html;
          founderBox.querySelectorAll('.ferriol-mdr-approve').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-id');
              if (!id || !confirm('¿Aprobar y aplicar los días de vigencia en la cuenta (kiosco o socio)?')) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_membership_day_request', { p_request_id: id, p_approve: true, p_reject_note: null });
              if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo aprobar.'); return; }
              alert('Listo: los días ya figuran en la vigencia de la cuenta.');
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
          founderBox.querySelectorAll('.ferriol-kpur-approve').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-kpur-id');
              if (!id || !confirm('¿Aprobar el pasaje a distribuidor? Se actualizará la misma cuenta y la licencia según app_settings.')) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_kiosquero_partner_upgrade', { p_request_id: id, p_approve: true, p_reject_note: null });
              if (rpc.error) { alert('Error: ' + rpc.error.message); return; }
              var out = rpc.data;
              if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
              if (!out || out.ok !== true) { alert((out && out.error) ? out.error : 'No se pudo aprobar.'); return; }
              alert('Upgrade aplicado. El usuario debe cerrar sesión y volver a entrar para ver el panel de socio.');
              renderSuper();
            };
          });
          founderBox.querySelectorAll('.ferriol-kpur-reject').forEach(function (btn) {
            btn.onclick = async function () {
              var id = btn.getAttribute('data-kpur-id');
              if (!id) return;
              var note = prompt('Motivo del rechazo (opcional):');
              if (note === null) return;
              var rpc = await supabaseClient.rpc('ferriol_approve_kiosquero_partner_upgrade', { p_request_id: id, p_approve: false, p_reject_note: note || null });
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
              h2 += '<p class="text-[10px] text-white/50">Las solicitudes las cargan los partners desde el panel correspondiente; la empresa aprueba antes de crear el usuario.</p>';
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
          partnerBox.classList.remove('hidden');
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
          founderBox.innerHTML = '<p class="text-xs text-white/60">Aprobaciones: error al cargar.</p>';
        }
      } finally {
        if (state.superSection === 'solicitudes') {
          syncFounderSolicitudesTabShell();
          syncPartnerSolicitudesTabShell();
        }
        scheduleRefreshFerriolSolicitudesBadges();
      }
    }

    async function renderSuper() {
      if (!supabaseClient) return;
      try {
        const { data: settingsRows } = await supabaseClient.from('app_settings').select('key, value').in('key', ['admin_whatsapp', 'admin_whatsapp_2', 'admin_whatsapp_3', 'admin_whatsapp_4', 'admin_delete_password', 'trial_reminder_config', 'ferriol_transfer_info', 'trial_duration_days', 'partner_kit_review_hours', 'partner_kit_review_message', 'ferriol_support_phone', 'ferriol_checkout_copy', 'ferriol_plan_amounts', 'ferriol_mercadopago_checkout_urls', 'ferriol_mercadopago_checkout_url']);
        var whatsappInput = document.getElementById('adminContactWhatsapp');
        var whatsapp2Input = document.getElementById('adminContactWhatsapp2');
        var whatsapp3Input = document.getElementById('adminContactWhatsapp3');
        var whatsapp4Input = document.getElementById('adminContactWhatsapp4');
        var deletePwdInput = document.getElementById('adminDeletePassword');
        var transferInfoTa = document.getElementById('adminTransferInfo');
        var trialDurInput = document.getElementById('adminTrialDurationDays');
        var kitRevHoursInput = document.getElementById('adminPartnerKitReviewHours');
        var kitRevMsgTa = document.getElementById('adminPartnerKitReviewMessage');
        var adminSupportPhoneEl = document.getElementById('adminSupportPhone');
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
            if (r.key === 'partner_kit_review_hours' && kitRevHoursInput) {
              var kh = parseInt(r.value, 10);
              kitRevHoursInput.value = (!isNaN(kh) && kh >= 1 && kh <= 168) ? String(kh) : '24';
            }
            if (r.key === 'partner_kit_review_message' && kitRevMsgTa) {
              kitRevMsgTa.value = r.value != null ? String(r.value) : '';
              window._ferriolPartnerKitReviewTooltip = kitRevMsgTa.value.trim() || window._ferriolPartnerKitReviewTooltip;
            }
            if (r.key === 'ferriol_support_phone' && adminSupportPhoneEl) {
              adminSupportPhoneEl.value = r.value != null ? String(r.value) : '';
            }
            if (r.key === 'trial_reminder_config') trialCfgParsed = parseTrialReminderConfigValue(r.value || '');
          });
        }
        var mpMergedLoad = ferriolMergeMercadoPagoSettingsRows(settingsRows || []);
        ferriolFillAdminMercadoPagoInputsFromMerged(mpMergedLoad);
        ferriolApplyMercadoPagoUrlsToWindow(mpMergedLoad);
        try { syncMercadoPagoCheckoutUi(); } catch (_) {}
        var paRow = (settingsRows || []).filter(function (rx) {
          return rx.key === 'ferriol_plan_amounts';
        })[0];
        if (paRow && paRow.value != null && paRow.value !== '') {
          try {
            var pav = typeof paRow.value === 'string' ? JSON.parse(paRow.value) : paRow.value;
            ferriolMergePlanAmountsFromParsed(pav);
          } catch (_) {}
        }
        var ccRow = (settingsRows || []).filter(function (rx) {
          return rx.key === 'ferriol_checkout_copy';
        })[0];
        var copyForUi = ferriolParseCheckoutCopyValue(ccRow ? ccRow.value : null);
        window._ferriolCheckoutCopyParsed = copyForUi;
        if (isEmpresaLensSuper()) {
          var fk = document.getElementById('adminCheckoutCopyKiosco');
          var fa = document.getElementById('adminCheckoutCopyAdmin');
          var fd = document.getElementById('adminCheckoutCopyDistrib');
          var fp = document.getElementById('adminCheckoutCopyProducts');
          var fdi = document.getElementById('adminCheckoutCopyDistribIntro');
          var fmk = document.getElementById('adminCheckoutCopyModalKiosco');
          var fma = document.getElementById('adminCheckoutCopyModalAdmin');
          var fey = document.getElementById('adminCheckoutDistribEyebrow');
          var fhl = document.getElementById('adminCheckoutDistribSalesHeadline');
          var fben = document.getElementById('adminCheckoutDistribBeneficiosTitle');
          var fkit = document.getElementById('adminCheckoutModalDistribKit');
          if (fk) fk.value = copyForUi.kiosco.join('\n');
          if (fa) fa.value = copyForUi.admin.join('\n');
          if (fd) fd.value = copyForUi.distrib.join('\n');
          if (fp) fp.value = copyForUi.products.join('\n');
          if (fdi) fdi.value = copyForUi.distrib_intro || '';
          if (fmk) fmk.value = copyForUi.modal_kiosco || '';
          if (fma) fma.value = copyForUi.modal_admin || '';
          if (fey) fey.value = copyForUi.distrib_eyebrow || '';
          if (fhl) fhl.value = copyForUi.distrib_sales_headline || '';
          if (fben) fben.value = copyForUi.distrib_beneficios_title || '';
          if (fkit) fkit.value = copyForUi.modal_distrib_kit || '';
          var pke = document.getElementById('adminCheckoutPayKioscoEyebrow');
          var pkh = document.getElementById('adminCheckoutPayKioscoHeadline');
          var pkld = document.getElementById('adminCheckoutPayKioscoLead');
          var pkb = document.getElementById('adminCheckoutPayKioscoBenefitsTitle');
          var pkp = document.getElementById('adminCheckoutPayKioscoProductsTitle');
          var pae = document.getElementById('adminCheckoutPayAdminEyebrow');
          var pah = document.getElementById('adminCheckoutPayAdminHeadline');
          var pal = document.getElementById('adminCheckoutPayAdminLead');
          var pab = document.getElementById('adminCheckoutPayAdminBenefitsTitle');
          var pap = document.getElementById('adminCheckoutPayAdminProductsTitle');
          if (pke) pke.value = copyForUi.pay_kiosco_eyebrow || '';
          if (pkh) pkh.value = copyForUi.pay_kiosco_headline || '';
          if (pkld) pkld.value = copyForUi.pay_kiosco_lead || '';
          if (pkb) pkb.value = copyForUi.pay_kiosco_benefits_title || '';
          if (pkp) pkp.value = copyForUi.pay_kiosco_products_title || '';
          if (pae) pae.value = copyForUi.pay_admin_eyebrow || '';
          if (pah) pah.value = copyForUi.pay_admin_headline || '';
          if (pal) pal.value = copyForUi.pay_admin_lead || '';
          if (pab) pab.value = copyForUi.pay_admin_benefits_title || '';
          if (pap) pap.value = copyForUi.pay_admin_products_title || '';
        }
        if (isEmpresaLensSuper()) {
          var elk = document.getElementById('adminPlanAmountKit');
          var elko = document.getElementById('adminPlanAmountKioscoMonthly');
          var elv = document.getElementById('adminPlanAmountVendorMonthly');
          if (elk) elk.value = String(FERRIOL_PLAN_AMOUNTS.kit);
          if (elko) elko.value = String(FERRIOL_PLAN_AMOUNTS.kioscoMonthly);
          if (elv) elv.value = String(FERRIOL_PLAN_AMOUNTS.vendorMonthly);
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
      const { data: allProfiles, error: errProfiles } = await supabaseClient.from('profiles').select('id, email, role, active, kiosco_name, trial_ends_at, sponsor_id, referral_code, partner_kit_review_until');
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
        scheduleRefreshFerriolSolicitudesBadges();
        return;
      }
      if (displayList.length === 0 && (isEmpresaLensSuper() || isPartnerLens())) {
        var msg;
        if (list.length === 0) {
          msg = searchTerm ? 'Ningún perfil coincide con la búsqueda.' : (isPartnerLens() ? (superFilterState === 'vencida' ? 'Nadie en tu red tiene la fecha de membresía vencida con estos filtros.' : 'No hay afiliados en tu red todavía.') : (superFilterState === 'sin_referidor' ? 'No hay integrantes sin referidor. Todo el mundo tiene admin/referidor asignado.' : superFilterState === 'activos' ? 'No hay perfiles activos con estos filtros.' : superFilterState === 'inactivos' ? 'No hay perfiles inactivos con estos filtros.' : superFilterState === 'vencida' ? 'No hay perfiles con membresía vencida (fecha de fin ya pasada) con estos filtros.' : 'No hay otros perfiles. Agregá uno con los botones de arriba.'));
        } else {
          msg = searchTerm ? 'Ningún ' + (state.afiliadosSubTab === 'distribuidores' ? 'distribuidor' : 'comercio') + ' coincide con la búsqueda.' : (state.afiliadosSubTab === 'distribuidores' ? 'No hay distribuidores en esta vista. Probá la pestaña Comercios o relajá los filtros.' : 'No hay comercios en esta vista. Probá Distribuidores o relajá los filtros.');
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
      scheduleRefreshFerriolSolicitudesBadges();
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
        var msgEmpty = list.length === 0 ? 'Ningún perfil coincide con la búsqueda o filtros.' : ('No hay ' + (state.afiliadosSubTab === 'distribuidores' ? 'distribuidores' : 'comercios') + ' que coincidan.');
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
    var ingresosKpiRejCard = document.getElementById('ingresosKpiRejCard');
    if (ingresosKpiRejCard) {
      ingresosKpiRejCard.addEventListener('click', function () {
        openIngresosRechazadasModal();
      });
      ingresosKpiRejCard.addEventListener('keydown', function (e) {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          openIngresosRechazadasModal();
        }
      });
    }
    var ingresosRechazadasModalClose = document.getElementById('ingresosRechazadasModalClose');
    if (ingresosRechazadasModalClose) ingresosRechazadasModalClose.addEventListener('click', closeIngresosRechazadasModal);
    var ingresosRechazadasModalOverlay = document.getElementById('ingresosRechazadasModalOverlay');
    if (ingresosRechazadasModalOverlay) ingresosRechazadasModalOverlay.addEventListener('click', closeIngresosRechazadasModal);
    var ingresosRechazadasModalNewSale = document.getElementById('ingresosRechazadasModalNewSale');
    if (ingresosRechazadasModalNewSale) {
      ingresosRechazadasModalNewSale.addEventListener('click', function () {
        closeIngresosRechazadasModal();
        switchSuperSection('mas');
        setTimeout(function () {
          try { superMasScrollTo('superMasBlockAdmin'); } catch (_) {}
          openClientSaleRequestModal();
        }, 120);
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
        var rowsUpsert = [
          { key: 'admin_whatsapp', value: whatsapp },
          { key: 'admin_whatsapp_2', value: whatsapp2 },
          { key: 'admin_whatsapp_3', value: whatsapp3 },
          { key: 'admin_whatsapp_4', value: whatsapp4 },
          { key: 'admin_delete_password', value: deletePwd },
          { key: 'ferriol_transfer_info', value: transferInfo },
          { key: 'trial_duration_days', value: String(trialDurSave) },
          { key: 'trial_reminder_config', value: trialReminderJson }
        ];
        var supPhoneEl = document.getElementById('adminSupportPhone');
        if (supPhoneEl) {
          rowsUpsert.push({ key: 'ferriol_support_phone', value: String(supPhoneEl.value || '').trim().slice(0, 80) });
        }
        if (isEmpresaLensSuper()) {
          var khEl = document.getElementById('adminPartnerKitReviewHours');
          var kmEl = document.getElementById('adminPartnerKitReviewMessage');
          if (khEl) {
            var khSave = Math.min(168, Math.max(1, parseInt(khEl.value, 10) || 24));
            rowsUpsert.push({ key: 'partner_kit_review_hours', value: String(khSave) });
          }
          if (kmEl) {
            var kmSave = String(kmEl.value || '').trim().slice(0, 600);
            rowsUpsert.push({ key: 'partner_kit_review_message', value: kmSave });
            window._ferriolPartnerKitReviewTooltip = kmSave || undefined;
          }
        }
        var checkoutSaved = null;
        if (isEmpresaLensSuper() && document.getElementById('adminCheckoutCopyKiosco')) {
          checkoutSaved = ferriolBuildCheckoutCopyObjectFromSettingsForm();
          rowsUpsert.push({ key: 'ferriol_checkout_copy', value: JSON.stringify(checkoutSaved) });
        }
        var planAmtSaved = null;
        if (isEmpresaLensSuper() && document.getElementById('adminPlanAmountKit')) {
          planAmtSaved = ferriolPlanAmountsObjectFromSettingsForm();
          rowsUpsert.push({ key: 'ferriol_plan_amounts', value: JSON.stringify(planAmtSaved) });
        }
        if (isEmpresaLensSuper() && document.getElementById('adminMercadoPagoCheckoutUrlKit')) {
          var mk = document.getElementById('adminMercadoPagoCheckoutUrlKit');
          var mko = document.getElementById('adminMercadoPagoCheckoutUrlKiosco');
          var mv = document.getElementById('adminMercadoPagoCheckoutUrlVendor');
          var kitV = mk ? String(mk.value || '').trim() : '';
          var kioscoV = mko ? String(mko.value || '').trim() : '';
          var vendV = mv ? String(mv.value || '').trim() : '';
          rowsUpsert.push({
            key: 'ferriol_mercadopago_checkout_urls',
            value: JSON.stringify({ kit: kitV, kioscoMonthly: kioscoV, vendorMonthly: vendV })
          });
          rowsUpsert.push({
            key: 'ferriol_mercadopago_checkout_url',
            value: kioscoV || kitV || vendV || ''
          });
        }
        await supabaseClient.from('app_settings').upsert(rowsUpsert, { onConflict: 'key' });
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
        if (checkoutSaved) {
          window._ferriolCheckoutCopyParsed = ferriolParseCheckoutCopyValue(JSON.stringify(checkoutSaved));
          try {
            ferriolApplyCheckoutBenefitsToPanels();
          } catch (_) {}
        }
        if (planAmtSaved) {
          ferriolMergePlanAmountsFromParsed(planAmtSaved);
          try {
            syncPlanCheckoutPrices();
          } catch (_) {}
        }
        var mkSv = document.getElementById('adminMercadoPagoCheckoutUrlKit');
        var mkoSv = document.getElementById('adminMercadoPagoCheckoutUrlKiosco');
        var mvSv = document.getElementById('adminMercadoPagoCheckoutUrlVendor');
        if (isEmpresaLensSuper() && (mkSv || mkoSv || mvSv)) {
          ferriolApplyMercadoPagoUrlsToWindow({
            kit: mkSv ? String(mkSv.value || '').trim() : '',
            kioscoMonthly: mkoSv ? String(mkoSv.value || '').trim() : '',
            vendorMonthly: mvSv ? String(mvSv.value || '').trim() : ''
          });
          try { syncMercadoPagoCheckoutUi(); } catch (_) {}
        }
        msgEl.textContent = 'Ajustes guardados.';
        msgEl.classList.remove('hidden');
        setTimeout(() => msgEl.classList.add('hidden'), 3000);
        try {
          ferriolRefreshAccountMenuHelpButton().catch(function () {});
        } catch (_) {}
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
            if (!pRes.error && pRes.data) pRes.data.forEach(function (p) { products[p.codigo] = { nombre: p.nombre, codigo: p.codigo, precio: p.precio, stock: p.stock, stockInicial: p.stock_inicial || p.stock, costo: p.costo != null ? Number(p.costo) : 0, fechaVencimiento: p.fecha_vencimiento != null ? String(p.fecha_vencimiento).trim().slice(0, 10) : null }; });
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
                  var fv = (p && p.fechaVencimiento != null) ? String(p.fechaVencimiento).trim().slice(0, 10) : '';
                  return {
                    user_id: uid,
                    codigo: cod,
                    nombre: p.nombre,
                    precio: p.precio || 0,
                    stock: p.stock || 0,
                    stock_inicial: p.stockInicial ?? p.stock ?? 0,
                    costo: p.costo != null ? Number(p.costo) : 0,
                    fecha_vencimiento: /^\d{4}-\d{2}-\d{2}$/.test(fv) ? fv : null
                  };
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
        if (state.superSection === 'sistema' || state.superSection === 'cobros') renderSuperCobrosSection();
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
        alert('Listo. Filas nuevas: ' + n + '. Revisá Sistema → Cobros (admin). Los kiosqueros ven la suscripción en Caja.');
        if (state.superSection === 'sistema' || state.superSection === 'cobros') renderSuperCobrosSection();
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
        if (state.superSection === 'sistema' || state.superSection === 'cobros') renderSuperCobrosSection();
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
      if (state.superSection === 'sistema' || state.superSection === 'cobros') renderSuperCobrosSection();
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
    var btnOpenProofInbox = document.getElementById('btnOpenPartnerProofInbox');
    if (btnOpenProofInbox) btnOpenProofInbox.addEventListener('click', openPartnerComprobantesSection);
    var btnOpenProofInboxIng = document.getElementById('btnOpenPartnerProofInboxIngresos');
    if (btnOpenProofInboxIng) btnOpenProofInboxIng.addEventListener('click', openPartnerComprobantesSection);
    var btnPartnerProofScreenBack = document.getElementById('btnPartnerProofScreenBack');
    if (btnPartnerProofScreenBack) btnPartnerProofScreenBack.addEventListener('click', closePartnerComprobantesSection);
    var partnerProofScreenTabC = document.getElementById('partnerProofScreenTabComercios');
    var partnerProofScreenTabD = document.getElementById('partnerProofScreenTabDistribuidores');
    if (partnerProofScreenTabC) partnerProofScreenTabC.addEventListener('click', function () { ferriolSetPartnerProofScreenTab('comercios'); });
    if (partnerProofScreenTabD) partnerProofScreenTabD.addEventListener('click', function () { ferriolSetPartnerProofScreenTab('distribuidores'); });
    var ferriolCompViewClose = document.getElementById('ferriolComprobanteViewerClose');
    if (ferriolCompViewClose) ferriolCompViewClose.addEventListener('click', closeFerriolComprobanteViewer);
    document.addEventListener('keydown', function (ev) {
      if (ev.key !== 'Escape') return;
      var mv = document.getElementById('ferriolComprobanteViewerModal');
      if (mv && !mv.classList.contains('hidden')) closeFerriolComprobanteViewer();
    });
    document.body.addEventListener('click', function (ev) {
      var trig = ev.target && ev.target.closest && ev.target.closest('.ferriol-comp-view-trigger');
      if (!trig) return;
      var u = trig.getAttribute('data-comp-url');
      if (!u) return;
      ev.preventDefault();
      openFerriolComprobanteViewer(u);
    });
    var btnAffClose = document.getElementById('partnerAffiliateLinksModalClose');
    if (btnAffClose) btnAffClose.onclick = closePartnerAffiliateLinksModal;
    var btnAffDone = document.getElementById('partnerAffiliateLinksModalDone');
    if (btnAffDone) btnAffDone.onclick = closePartnerAffiliateLinksModal;
    var btnAffOv = document.getElementById('partnerAffiliateLinksModalOverlay');
    if (btnAffOv) btnAffOv.onclick = closePartnerAffiliateLinksModal;
    var kpuClose = document.getElementById('kiosqueroPartnerUpgradeModalClose');
    if (kpuClose) kpuClose.onclick = closeKiosqueroPartnerUpgradeModal;
    var kpuOv = document.getElementById('kiosqueroPartnerUpgradeModalOverlay');
    if (kpuOv) kpuOv.onclick = closeKiosqueroPartnerUpgradeModal;
    var kpuSub = document.getElementById('kiosqueroPartnerUpgradeSubmit');
    if (kpuSub) {
      kpuSub.onclick = async function () {
        var errBox = document.getElementById('kiosqueroPartnerUpgradeErr');
        if (errBox) { errBox.textContent = ''; errBox.classList.add('hidden'); errBox.classList.remove('show'); }
        if (!supabaseClient || !currentUser || currentUser.role !== 'kiosquero') return;
        var kitCodeRaw =
          document.getElementById('kiosqueroPartnerUpgradeKitRefCode') &&
          document.getElementById('kiosqueroPartnerUpgradeKitRefCode').value
            ? document.getElementById('kiosqueroPartnerUpgradeKitRefCode').value
            : '';
        var kitCode = normalizeReferralCode(kitCodeRaw);
        var note = (document.getElementById('kiosqueroPartnerUpgradeNote') && document.getElementById('kiosqueroPartnerUpgradeNote').value || '').trim();
        var kitSponsorId = null;
        if (kitCode) {
          kitSponsorId = await resolveReferralCodeToSponsorId(kitCode);
          if (!kitSponsorId) {
            if (errBox) {
              errBox.textContent =
                'El código de afiliación no es válido o no existe. Revisalo o dejalo vacío para usar el referidor de tu negocio.';
              errBox.classList.remove('hidden');
              errBox.classList.add('show');
            }
            return;
          }
          if (kitSponsorId === currentUser.id) {
            if (errBox) {
              errBox.textContent = 'No podés usar tu propio código de afiliación.';
              errBox.classList.remove('hidden');
              errBox.classList.add('show');
            }
            return;
          }
          var pr = await supabaseClient.from('profiles').select('id,role').eq('id', kitSponsorId).maybeSingle();
          if (!pr.error && pr.data && pr.data.role !== 'partner' && pr.data.role !== 'super') {
            if (errBox) {
              errBox.textContent = 'Ese código pertenece a un perfil que no es socio distribuidor ni empresa.';
              errBox.classList.remove('hidden');
              errBox.classList.add('show');
            }
            return;
          }
        }
        var rpc = await supabaseClient.rpc('ferriol_request_kiosquero_partner_upgrade', {
          p_partner_kit_sponsor_id: kitSponsorId,
          p_note: note || null
        });
        if (rpc.error) {
          if (errBox) { errBox.textContent = rpc.error.message || 'No se pudo enviar.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
          return;
        }
        var out = rpc.data;
        if (typeof out === 'string') { try { out = JSON.parse(out); } catch (_) {} }
        if (!out || out.ok !== true) {
          if (errBox) { errBox.textContent = (out && out.error) ? out.error : 'No se pudo enviar.'; errBox.classList.remove('hidden'); errBox.classList.add('show'); }
          return;
        }
        closeKiosqueroPartnerUpgradeModal();
        alert('Solicitud enviada. Cuando Ferriol la apruebe, cerrá sesión y volvé a entrar para ver el panel de socio.');
        await syncKiosqueroPartnerUpgradeUi();
      };
    }
    (function bindKioscoSubscriptionPayModal() {
      var m = document.getElementById('kioscoSubscriptionPayModal');
      function closeModal() {
        if (m) {
          m.classList.add('hidden');
          try {
            document.body.style.overflow = '';
          } catch (_) {}
        }
      }
      function openModal() {
        if (typeof window.ferriolOpenEmpresaSubscriptionModal === 'function') {
          window.ferriolOpenEmpresaSubscriptionModal(typeof ferriolPlanPayModalMode === 'function' ? ferriolPlanPayModalMode() : 'kiosco');
          return;
        }
        if (typeof window._populateKioscoSubscriptionPayModal === 'function') {
          window._populateKioscoSubscriptionPayModal(window._ferriolKioscoEmpresaTransferRaw != null ? window._ferriolKioscoEmpresaTransferRaw : '');
        }
        if (m) {
          m.classList.remove('hidden');
          try {
            document.body.style.overflow = 'hidden';
          } catch (_) {}
        }
        try {
          if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
        } catch (_) {}
      }
      var op = document.getElementById('btnOpenKioscoSubscriptionModal');
      if (op) op.addEventListener('click', openModal);
      var opAdm = document.getElementById('btnOpenEmpresaSubscriptionAdmin');
      if (opAdm) opAdm.addEventListener('click', function () {
        if (typeof window.ferriolOpenEmpresaSubscriptionModal === 'function') {
          window.ferriolOpenEmpresaSubscriptionModal(typeof ferriolPlanPayModalMode === 'function' ? ferriolPlanPayModalMode() : 'admin');
        }
      });
      var ov = document.getElementById('kioscoSubscriptionPayModalOverlay');
      if (ov) ov.addEventListener('click', closeModal);
      var cl = document.getElementById('kioscoSubscriptionPayModalClose');
      if (cl) cl.addEventListener('click', closeModal);
      var dn = document.getElementById('kioscoSubscriptionPayModalDone');
      if (dn) dn.addEventListener('click', closeModal);
    })();
    (function bindKioscoEmpresaPaymentProofModalEl() {
      async function hydrateEmpresaPaymentProofSponsorField() {
        var sp = document.getElementById('kioscoEmpresaPaymentProofSponsor');
        if (!sp || !supabaseClient || !currentUser) return;
        var mode = window._ferriolSubPayModalMode || 'kiosco';
        var patronId =
          mode === 'kit' ? currentUser.partnerSponsorId || currentUser.sponsorId : currentUser.sponsorId || null;
        if (!patronId) {
          sp.value = '';
          return;
        }
        try {
          var r = await supabaseClient.from('profiles').select('referral_code').eq('id', patronId).maybeSingle();
          var code =
            r && r.data && r.data.referral_code != null ? String(r.data.referral_code).trim() : '';
          sp.value = code;
        } catch (_) {
          sp.value = '';
        }
      }
      function syncEmpresaProofFormFromPayModal() {
        var mode = window._ferriolSubPayModalMode || 'kiosco';
        var titSp = document.getElementById('kioscoEmpresaPaymentProofTitleSpan');
        var intro = document.getElementById('kioscoEmpresaPaymentProofIntro');
        var vw = document.getElementById('kioscoEmpresaPaymentProofVendorMonthWrap');
        var vmi = document.getElementById('kioscoEmpresaPaymentProofVendorMonth');
        var amt = document.getElementById('kioscoEmpresaPaymentProofAmount');
        var sp = document.getElementById('kioscoEmpresaPaymentProofSponsor');
        if (sp) sp.value = '';
        if (mode === 'kit') {
          if (titSp) titSp.textContent = 'Kit + licencia · comprobante';
          if (intro) {
            intro.textContent =
              currentUser && currentUser.role === 'partner'
                ? 'Subí el comprobante del kit inicial: llega al distribuidor que te referenció para que lo valide y cargue la venta ante Ferriol.'
                : 'Subí el comprobante: se envía a tu distribuidor directo para que registre la venta ante Ferriol y quede vinculado el cobro.';
          }
          if (vw) vw.classList.add('hidden');
          if (amt) amt.value = String(FERRIOL_PLAN_AMOUNTS.kit);
        } else if (mode === 'admin') {
          if (titSp) titSp.textContent = 'Cuota distribuidor · comprobante';
          if (intro)
            intro.textContent =
              'Elegí el mes de la cuota y el monto transferido. Adjuntá la imagen del comprobante.';
          if (vw) vw.classList.remove('hidden');
          if (vmi && !vmi.value) {
            var d = new Date();
            vmi.value = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
          }
          if (amt) amt.value = String(FERRIOL_PLAN_AMOUNTS.vendorMonthly);
        } else {
          if (titSp) titSp.textContent = 'Suscripción negocio · comprobante';
          if (intro)
            intro.textContent =
              'Indicá el monto y cargá el comprobante. Se envía a tu distribuidor (socio que te refirió) para que cargue la venta ante Ferriol; así queda su comisión garantizada ante la empresa.';
          if (vw) vw.classList.add('hidden');
          if (amt) amt.value = String(FERRIOL_PLAN_AMOUNTS.kioscoMonthly);
        }
      }
      function openProofModal() {
        var err = document.getElementById('kioscoEmpresaPaymentProofErr');
        var fi = document.getElementById('kioscoEmpresaPaymentProofFile');
        if (err) {
          err.textContent = '';
          err.classList.add('hidden');
        }
        if (fi) fi.value = '';
        syncEmpresaProofFormFromPayModal();
        hydrateEmpresaPaymentProofSponsorField().catch(function () {});
        var pm = document.getElementById('kioscoEmpresaPaymentProofModal');
        if (pm) {
          pm.classList.remove('hidden');
          pm.classList.add('flex');
        }
        try {
          if (typeof lucide !== 'undefined' && lucide && lucide.createIcons) lucide.createIcons();
        } catch (_) {}
      }
      /** modeOpt: 'kiosco' | 'admin' | 'kit' para el formulario de comprobante (desde Mi plan · Mercado Pago). */
      window.ferriolOpenEmpresaPaymentProofModal = function (modeOpt) {
        if (modeOpt === 'kit' || modeOpt === 'admin' || modeOpt === 'kiosco') window._ferriolSubPayModalMode = modeOpt;
        openProofModal();
      };
      function closeProofModal() {
        var pm = document.getElementById('kioscoEmpresaPaymentProofModal');
        if (pm) {
          pm.classList.add('hidden');
          pm.classList.remove('flex');
        }
      }
      var btnOp = document.getElementById('btnOpenKioscoEmpresaPaymentProofModal');
      if (btnOp) btnOp.addEventListener('click', function () {
        openProofModal();
      });
      var ov = document.getElementById('kioscoEmpresaPaymentProofModalOverlay');
      if (ov) ov.addEventListener('click', closeProofModal);
      var cl = document.getElementById('kioscoEmpresaPaymentProofModalClose');
      if (cl) cl.addEventListener('click', closeProofModal);
      var sb = document.getElementById('kioscoEmpresaPaymentProofSubmit');
      if (sb) {
        sb.addEventListener('click', async function () {
          var err = document.getElementById('kioscoEmpresaPaymentProofErr');
          if (err) {
            err.textContent = '';
            err.classList.add('hidden');
          }
          if (!supabaseClient || !currentUser) {
            if (err) {
              err.textContent = 'Sesión no disponible.';
              err.classList.remove('hidden');
            }
            return;
          }
          var mode = window._ferriolSubPayModalMode || 'kiosco';
          var paymentType = mode === 'kit' ? 'kit_inicial' : mode === 'admin' ? 'vendor_mantenimiento' : 'kiosco_licencia';
          var rawAmt = (document.getElementById('kioscoEmpresaPaymentProofAmount') && document.getElementById('kioscoEmpresaPaymentProofAmount').value) || '';
          var amt = parseFloat(String(rawAmt).replace(/\./g, '').replace(',', '.'), 10);
          var fileIn = document.getElementById('kioscoEmpresaPaymentProofFile');
          var file = fileIn && fileIn.files && fileIn.files[0];
          var sponsorIn = (document.getElementById('kioscoEmpresaPaymentProofSponsor') && document.getElementById('kioscoEmpresaPaymentProofSponsor').value) || '';
          var sponsorCode = String(sponsorIn).trim();
          if (isNaN(amt) || amt <= 0) {
            if (err) {
              err.textContent = 'Indicá un monto válido en ARS.';
              err.classList.remove('hidden');
            }
            return;
          }
          if (!file) {
            if (err) {
              err.textContent = 'Adjuntá la imagen del comprobante.';
              err.classList.remove('hidden');
            }
            return;
          }
          if (file.size > 5 * 1024 * 1024) {
            if (err) {
              err.textContent = 'La imagen supera 5 MB.';
              err.classList.remove('hidden');
            }
            return;
          }
          var periodMonth = null;
          if (paymentType === 'vendor_mantenimiento') {
            var mval =
              (document.getElementById('kioscoEmpresaPaymentProofVendorMonth') &&
                document.getElementById('kioscoEmpresaPaymentProofVendorMonth').value) ||
              '';
            periodMonth = ferriolMonthInputToPeriodDate(mval);
            if (!periodMonth) {
              if (err) {
                err.textContent = 'Elegí el mes de la cuota.';
                err.classList.remove('hidden');
              }
              return;
            }
          }
          var sponsorResolved = null;
          if (sponsorCode) {
            sponsorResolved = await resolveReferralCodeToSponsorId(sponsorCode);
            if (!sponsorResolved) {
              if (err) {
                err.textContent = 'El código de patrocinador no es válido.';
                err.classList.remove('hidden');
              }
              return;
            }
          } else if (paymentType === 'kit_inicial') {
            sponsorResolved = currentUser.partnerSponsorId || currentUser.sponsorId || null;
          } else if (currentUser.sponsorId) {
            sponsorResolved = currentUser.sponsorId;
          }
          if (paymentType !== 'vendor_mantenimiento' && !sponsorResolved) {
            if (err) {
              err.textContent =
                'Para este tipo de pago hace falta un patrocinador: cargá el código del socio o pedí en administración que figure tu referidor en el perfil.';
              err.classList.remove('hidden');
            }
            return;
          }
          var routeKioskToPartnerQueue =
            currentUser &&
            sponsorResolved &&
            ((currentUser.role === 'kiosquero' &&
              (paymentType === 'kiosco_licencia' || paymentType === 'kit_inicial')) ||
              (currentUser.role === 'partner' && paymentType === 'kit_inicial'));
          var reqId =
            typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : String(Date.now()) + '-epp';
          var ext =
            file.name && file.name.lastIndexOf('.') > 0 ? file.name.slice(file.name.lastIndexOf('.')).toLowerCase() : '.jpg';
          if (ext.length > 6) ext = '.jpg';
          var path = routeKioskToPartnerQueue
            ? String(sponsorResolved) + '/' + currentUser.id + '/' + reqId + '/comprobante' + ext
            : currentUser.id + '/' + reqId + '/comprobante' + ext;
          var up = await supabaseClient.storage
            .from('comprobantes-ferriol')
            .upload(path, file, { contentType: file.type || 'image/jpeg', upsert: false });
          if (up.error) {
            if (err) {
              err.textContent =
                'No se pudo subir el archivo. ¿Bucket comprobantes-ferriol y políticas de storage nuevas?' +
                ' ' +
                (up.error.message || '');
              err.classList.remove('hidden');
            }
            return;
          }
          if (routeKioskToPartnerQueue) {
            var insK = await supabaseClient.from('ferriol_kiosk_partner_proof_queue').insert({
              id: reqId,
              kiosco_user_id: currentUser.id,
              partner_id: sponsorResolved,
              payment_type: paymentType,
              amount_ars: amt,
              comprobante_path: path,
              sponsor_code_raw: sponsorCode || null,
              period_month: periodMonth
            });
            if (insK.error) {
              try {
                await supabaseClient.storage.from('comprobantes-ferriol').remove([path]);
              } catch (_) {}
              if (err) {
                err.textContent =
                  insK.error.message +
                  ' · Revisá tabla ferriol_kiosk_partner_proof_queue y el SQL «supabase-ferriol-kiosk-proofs-partner-queue».';
                err.classList.remove('hidden');
              }
              return;
            }
          } else {
            var insertRow = {
              id: reqId,
              user_id: currentUser.id,
              payment_type: paymentType,
              amount_ars: amt,
              comprobante_path: path,
              sponsor_code_raw: sponsorCode || null,
              sponsor_resolved_id: sponsorResolved || null,
              period_month: periodMonth
            };
            var ins = await supabaseClient.from('ferriol_empresa_payment_proof_requests').insert(insertRow);
            if (ins.error) {
              try {
                await supabaseClient.storage.from('comprobantes-ferriol').remove([path]);
              } catch (_) {}
              if (err) {
                err.textContent = ins.error.message + ' · Revisá la tabla ferriol_empresa_payment_proof_requests.';
                err.classList.remove('hidden');
              }
              return;
            }
          }
          closeProofModal();
          if (fileIn) fileIn.value = '';
          void ferriolRefreshPartnerKitGateFlag();
          alert(
            routeKioskToPartnerQueue
              ? currentUser.role === 'partner'
                ? 'Enviado a tu distribuidor directo. Va a revisar el comprobante y cargará la venta ante Ferriol cuando corresponda.'
                : 'Enviado a tu distribuidor directo. Él cargará la venta ante Ferriol desde «Ingresos» para registrar tu pago con su comisión.'
              : 'Enviado. La empresa lo revisa en Solicitudes y aplica el cobro al aprobar.'
          );
        });
      }
    })();
    (function bindPlanPanel() {
      var back = document.getElementById('planPanelBackBtn');
      if (back)
        back.addEventListener('click', async function () {
          if (window._ferriolPlanCheckoutMode === 'partner_kit') {
            var stillNeed = await ferriolPartnerNeedsInitialKitProofGate();
            if (stillNeed) {
              alert(
                'Primero cargá el comprobante del kit inicial ante tu distribuidor directo (datos de pago abajo → «Ya pagué» / Mercado Pago y adjuntá la imagen).'
              );
              return;
            }
            try {
              window._ferriolPartnerKitGateNeedsProof = false;
            } catch (_) {}
          }
          var ret = window._ferriolPlanPanelReturn;
          window._ferriolPlanPanelReturn = null;
          if (typeof ret === 'string' && ret.length > 0 && ret !== 'plan') {
            goToPanel(ret);
            return;
          }
          if (currentUser && isNetworkAdminRole(currentUser && currentUser.role) && !isAnyKioscoPreviewMode()) {
            goToPanel('super');
          } else {
            goToPanel('dashboard');
          }
        });
      var bp = document.getElementById('btnPlanOpenEmpresaSubscription');
      if (bp) {
        bp.addEventListener('click', function () {
          if (typeof window.ferriolOpenEmpresaSubscriptionModal === 'function') {
            window.ferriolOpenEmpresaSubscriptionModal(typeof ferriolPlanPayModalMode === 'function' ? ferriolPlanPayModalMode() : 'admin');
          }
        });
      }
      var bdt = document.getElementById('btnPlanDistribOpenTransferModal');
      if (bdt) {
        bdt.addEventListener('click', function () {
          if (typeof window.ferriolOpenEmpresaSubscriptionModal === 'function') {
            window.ferriolOpenEmpresaSubscriptionModal('kit');
          }
        });
      }
    })();
    var btnOpenClientSale = document.getElementById('btnOpenClientSaleRequestModal');
    if (btnOpenClientSale) btnOpenClientSale.onclick = function () { openClientSaleRequestModal(); };

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
        if ((profile.role === 'kiosquero' || profile.role === 'partner' || profile.role === 'super') && !profile.active) {
          try {
            await refreshViewerHelpWhatsApp(profile);
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('loginErr').textContent = profile.role === 'kiosquero'
            ? 'Tu cuenta está desactivada. Contactá a tu referidor por WhatsApp para regularizar.'
            : (profile.role === 'super'
              ? 'Tu cuenta administrador está desactivada. Coordiná con el otro administrador empresa o la renovación en el sistema.'
              : 'Tu cuenta está desactivada. Contactá por WhatsApp a los números que configuró la empresa (fundadores).');
          document.getElementById('loginErr').classList.add('show');
          var wrap = document.getElementById('loginContactAdminWrap');
          if (wrap) {
            fillLoginContactLinks(profile.role === 'super'
              ? 'Hola, mi cuenta administrador Ferriol OS está desactivada y necesito coordinar renovación.'
              : 'Hola, mi cuenta de Ferriol OS está desactivada y quiero darme de alta.');
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
        if (profile.role === 'super' && trialEndsAt && new Date(trialEndsAt) < new Date()) {
          try {
            await supabaseClient.from('profiles').update({ active: false }).eq('id', uid);
          } catch (_) {}
          await supabaseClient.auth.signOut();
          document.getElementById('loginFormWrap').classList.remove('hidden');
          document.getElementById('loginErr').textContent = 'Venció la vigencia de tu cuenta como administrador (fundador). La cuenta se desactivó. Coordiná renovación con el otro administrador empresa.';
          document.getElementById('loginErr').classList.add('show');
          var wrapS2 = document.getElementById('loginContactAdminWrap');
          if (wrapS2) {
            fillLoginContactLinks('Hola, venció la vigencia de mi cuenta administrador Ferriol OS y necesito coordinar.');
            wrapS2.classList.remove('hidden');
          }
          document.getElementById('appWrap').classList.add('hidden');
          document.getElementById('loginScreen').classList.remove('hidden');
          return;
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
        var partnerFromKUpInit = false;
        if (profile.role === 'partner') {
          partnerFromKUpInit = await ferriolFetchPartnerKiosqueroUpgradeEligible(uid);
        }
        currentUser = { id: profile.id, email: profile.email, role: profile.role, active: profile.active, kioscoName: profile.kiosco_name || '', whatsappMessage: profile.whatsapp_message || DEFAULT_WHATSAPP, trialEndsAt: trialEndsAt, created_at: userCreatedAt, referralCode: profile.referral_code || '', sponsorId: profile.sponsor_id || null, partnerSponsorId: profile.partner_sponsor_id || null, partnerLicensePending: !!profile.partner_license_pending, partnerKitReviewUntil: profile.partner_kit_review_until || null, partnerTransferInfo: profile.partner_transfer_info != null ? String(profile.partner_transfer_info) : '', phone: profile.phone != null ? String(profile.phone) : '', avatarUrl: profile.avatar_url != null ? String(profile.avatar_url).trim() : '', partnerFromKiosqueroUpgrade: partnerFromKUpInit, vencimientoAvisoDias: (function () { var x = Number(profile.vencimiento_aviso_dias); return Number.isFinite(x) ? Math.min(365, Math.max(0, Math.floor(x))) : null; })() };
        await showApp();
      } catch (e) {
        console.error('Error en init:', e);
      }
    })();

    /* ══════════════════════════════════════════════════════════
       TABLERO SISTEMA: edición local del flujograma (solo lectura en UI).
       Las pestañas Proceso/Dinero/Estructura/Notas: kiosco-sistema-mlm-tabs.js
       ══════════════════════════════════════════════════════════ */
    (function () {
      var FLUJO_KEY = 'ferriol_flujo_edits_v1';

      /* ── Textos del flujograma (solo lectura; opcional carga desde localStorage) ── */
      function flujoLoadEdits() {
        try {
          var saved = JSON.parse(localStorage.getItem(FLUJO_KEY) || '{}');
          document.querySelectorAll('#flujoProcesoBoard .flujo-title, #flujoProcesoBoard .flujo-desc').forEach(function (el) {
            var stepEl = el.closest('[data-step]');
            if (!stepEl) return;
            var step = stepEl.dataset.step;
            var type = el.classList.contains('flujo-title') ? 't' : 'd';
            var key = step + '_' + type;
            if (saved[key] !== undefined) el.textContent = saved[key];
          });
        } catch (_) {}
      }

      flujoLoadEdits();
    })();

    /* ══════════════════════════════════════════════════════════
       NOTAS DEL SISTEMA
       ══════════════════════════════════════════════════════════ */
    (function () {
      var NOTAS_KEY = 'ferriol_sistema_notas_v1';

      function notasLoad() {
        try { return JSON.parse(localStorage.getItem(NOTAS_KEY) || '[]'); } catch (_) { return []; }
      }
      function notasSave(arr) {
        try { localStorage.setItem(NOTAS_KEY, JSON.stringify(arr)); } catch (_) {}
      }
      function notasShowStatus(msg) {
        var el = document.getElementById('notasStatus');
        if (!el) return;
        el.textContent = msg;
        el.style.opacity = '1';
        setTimeout(function () { el.style.opacity = '0'; }, 1800);
      }

      function notasMakeCard(nota, idx, arr) {
        var card = document.createElement('div');
        card.className = 'nota-card';

        var top = document.createElement('div');
        top.className = 'nota-card-top';

        var ts = document.createElement('span');
        ts.className = 'nota-ts';
        ts.textContent = nota.ts;
        top.appendChild(ts);

        var delBtn = document.createElement('button');
        delBtn.type = 'button';
        delBtn.className = 'nota-del-btn touch-target';
        delBtn.title = 'Eliminar nota';
        delBtn.textContent = '✕';
        delBtn.addEventListener('click', function () {
          if (!confirm('¿Eliminar esta nota?')) return;
          arr.splice(idx, 1);
          notasSave(arr);
          card.parentNode && card.parentNode.removeChild(card);
          notasCheckEmpty();
        });
        top.appendChild(delBtn);
        card.appendChild(top);

        var textarea = document.createElement('textarea');
        textarea.className = 'nota-body';
        textarea.placeholder = 'Escribí tu nota acá...';
        textarea.spellcheck = true;
        textarea.value = nota.text || '';
        textarea.rows = 4;

        var saveTimer = null;
        textarea.addEventListener('input', function () {
          arr[idx].text = textarea.value;
          clearTimeout(saveTimer);
          saveTimer = setTimeout(function () {
            notasSave(arr);
            notasShowStatus('Guardado ✓');
          }, 500);
          var charEl = footer.querySelector('.nota-chars');
          if (charEl) charEl.textContent = textarea.value.length + ' car.';
        });

        textarea.addEventListener('keydown', function (e) {
          if (e.key === 'Tab') {
            e.preventDefault();
            var s = textarea.selectionStart;
            textarea.value = textarea.value.slice(0, s) + '    ' + textarea.value.slice(textarea.selectionEnd);
            textarea.selectionStart = textarea.selectionEnd = s + 4;
          }
        });

        card.appendChild(textarea);

        var footer = document.createElement('div');
        footer.className = 'nota-footer';
        var chars = document.createElement('span');
        chars.className = 'nota-chars';
        chars.textContent = (nota.text || '').length + ' car.';
        footer.appendChild(chars);
        card.appendChild(footer);

        return card;
      }

      function notasCheckEmpty() {
        var container = document.getElementById('notasList');
        if (!container) return;
        var addBtn = document.getElementById('notasAddBtn');
        if (container.children.length === 0 && addBtn) {
          addBtn.style.borderStyle = 'dashed';
        }
      }

      function notasRender() {
        var container = document.getElementById('notasList');
        if (!container) return;
        while (container.firstChild) container.removeChild(container.firstChild);
        var arr = notasLoad();
        arr.forEach(function (nota, idx) {
          container.appendChild(notasMakeCard(nota, idx, arr));
        });
        notasCheckEmpty();
      }

      function notasAdd() {
        var container = document.getElementById('notasList');
        if (!container) return;
        var arr = notasLoad();
        var now = new Date();
        var ts = now.toLocaleDateString('es-AR', { day: '2-digit', month: '2-digit', year: '2-digit' }) +
                 ' ' + now.toLocaleTimeString('es-AR', { hour: '2-digit', minute: '2-digit' });
        var nota = { id: Date.now(), ts: ts, text: '' };
        arr.unshift(nota);
        notasSave(arr);
        var card = notasMakeCard(nota, 0, arr);
        container.insertBefore(card, container.firstChild);
        var ta = card.querySelector('textarea');
        if (ta) { ta.focus(); }
        var addBtn = document.getElementById('notasAddBtn');
        if (addBtn) addBtn.style.borderStyle = 'solid';
      }

      var addBtn = document.getElementById('notasAddBtn');
      if (addBtn) {
        addBtn.addEventListener('click', notasAdd);
      }

      notasRender();
    })();
