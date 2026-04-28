    // PWA: Service Worker solo en contexto seguro (https o localhost)
    var isSecure = location.protocol === 'https:' || location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if ('serviceWorker' in navigator && isSecure) {
      window.addEventListener('load', function () {
        navigator.serviceWorker.register('sw.js')
          .then(function (reg) { console.log('PWA: Service Worker registrado', reg.scope); })
          .catch(function (err) { console.warn('PWA: Error al registrar SW', err); });
      });
    }

    // Banner "Instalar app" — en móvil suele mostrarse al abrir; en PC solo cuando el navegador puede instalar (beforeinstallprompt).
    (function () {
      var PWA_DISMISS_KEY = 'ferriol_pwa_install_banner_dismissed';
      var banner = document.getElementById('pwaInstallBanner');
      var installBtn = document.getElementById('pwaInstallBtn');
      var installText = document.getElementById('pwaInstallText');
      var installHint = document.getElementById('pwaInstallHint');
      var needServer = document.getElementById('pwaNeedServer');
      var closeBtn = document.getElementById('pwaInstallClose');
      var deferredPrompt = null;

      if (!banner) return;

      if (window.matchMedia('(display-mode: standalone)').matches || window.navigator.standalone === true) {
        return;
      }

      function isBannerDismissed() {
        try {
          return localStorage.getItem(PWA_DISMISS_KEY) === '1' || sessionStorage.getItem('pwaBannerClosed') === '1';
        } catch (_) {
          return false;
        }
      }

      if (isBannerDismissed()) return;

      var ua = navigator.userAgent || '';
      var isPhoneTabletUA = /iPhone|iPad|iPod|Android/i.test(ua);

      function showInstallBanner() {
        if (isBannerDismissed()) return;
        banner.classList.add('show');
      }

      if (closeBtn) closeBtn.addEventListener('click', function () {
        banner.classList.remove('show');
        if (installHint) installHint.classList.remove('show');
        try {
          localStorage.setItem(PWA_DISMISS_KEY, '1');
          sessionStorage.setItem('pwaBannerClosed', '1');
        } catch (_) {}
      });

      function getInstallHint() {
        var ua = navigator.userAgent || '';
        if (/iPhone|iPad|iPod/i.test(ua)) return 'En el iPhone: tocá el botón Compartir (cuadrado con flecha abajo) y elegí "Añadir a pantalla de inicio".';
        if (/Android/i.test(ua)) {
          return 'En Android podés probar:\n' +
            '• En la barra de arriba (donde está la dirección), mirá si aparece un ícono de instalación (➕ o una pantalla con flecha) y tocá ahí.\n' +
            '• O tocá los 3 puntitos (⋮) del menú y buscá "Añadir a pantalla de inicio" o "Instalar aplicación".\n' +
            'Si no ves la opción, usá la página unos segundos y volvé a abrir el menú.';
        }
        return 'En Chrome o Edge: tocá los 3 puntitos (⋮) y buscá "Instalar Ferriol OS" o "Aplicaciones" → "Instalar esta aplicación".';
      }

      if (isSecure) {
        installBtn.style.display = '';
        needServer.style.display = 'none';
        window.addEventListener('beforeinstallprompt', function (e) {
          e.preventDefault();
          deferredPrompt = e;
          if (installHint) { installHint.classList.remove('show'); installHint.textContent = ''; }
          showInstallBanner();
        });
        if (isPhoneTabletUA) {
          showInstallBanner();
        }
        if (installBtn) installBtn.addEventListener('click', function () {
          if (deferredPrompt) {
            deferredPrompt.prompt();
            deferredPrompt.userChoice.then(function (choice) {
              if (choice.outcome === 'accepted') banner.classList.remove('show');
              deferredPrompt = null;
            });
          } else {
            if (installHint) { installHint.textContent = getInstallHint(); installHint.classList.add('show'); }
          }
        });
      } else {
        needServer.style.display = '';
        installBtn.style.display = 'none';
        installText.textContent = 'Para instalar la app no podés abrir el archivo directo.';
        if (installHint) installHint.style.display = 'none';
        showInstallBanner();
      }
    })();

    /** Pull-to-refresh en móvil: deslizar hacia abajo desde el tope y soltar (sustituto visual de F5). */
    (function () {
      var CAN_TOUCH = 'ontouchstart' in window || (typeof navigator !== 'undefined' && (navigator.maxTouchPoints || 0) > 0);
      if (!CAN_TOUCH) return;

      var MOBILE_MQ = window.matchMedia('(max-width: 768px)');
      var COARSE_MQ = window.matchMedia('(pointer: coarse)');

      function allowsPTR() {
        if (MOBILE_MQ.matches) return true;
        if (COARSE_MQ.matches) return true;
        try {
          if (navigator.maxTouchPoints > 0 && window.innerWidth <= 1200) return true;
        } catch (_) {}
        return false;
      }
      if (!allowsPTR()) return;

      var THRESH = 72;
      var tracking = false;
      var startY = 0;
      var startX = 0;
      var maxPull = 0;
      var ind = null;

      function loginVisible() {
        var el = document.getElementById('loginScreen');
        return el && !el.classList.contains('hidden');
      }

      function activePanel() {
        return document.querySelector('#mainContent section.panel:not(.hidden)');
      }

      function currentScrollTop() {
        if (loginVisible()) {
          var se = document.scrollingElement || document.documentElement;
          return (se && se.scrollTop) || window.pageYOffset || 0;
        }
        var p = activePanel();
        return p ? p.scrollTop : 999;
      }

      function atScrollTop() {
        return currentScrollTop() <= 12;
      }

      function blocksPTR(e) {
        if (!e.target) return true;
        if (e.target.closest('input, textarea, select, [contenteditable]')) return true;
        if (e.target.closest('.ferriol-bottom-nav')) return true;
        if (e.target.closest('#notifDropdown:not(.hidden)')) return true;
        var fixed = e.target.closest('.fixed.inset-0:not(.hidden)');
        if (fixed && fixed.id !== 'loginScreen') return true;
        return false;
      }

      function ensureIndicator() {
        if (ind) return ind;
        ind = document.createElement('div');
        ind.id = 'ferriolPullIndicator';
        ind.setAttribute('aria-hidden', 'true');
        ind.innerHTML = '<div class="ferriol-pull-inner"><span class="ferriol-pull-spinner" aria-hidden="true"></span><span class="ferriol-pull-text">Deslizá para actualizar</span></div>';
        document.body.appendChild(ind);
        return ind;
      }

      function hideIndicator() {
        if (!ind) return;
        ind.classList.remove('ferriol-pull-active');
        ind.style.opacity = '0';
      }

      function updateIndicator(ratio) {
        var el = ensureIndicator();
        var r = Math.min(Math.max(ratio, 0), 1);
        el.classList.add('ferriol-pull-active');
        el.style.opacity = String(Math.min(r * 0.95, 0.95));
        var tx = el.querySelector('.ferriol-pull-text');
        if (tx) {
          tx.textContent = r >= 0.95 ? 'Soltá para actualizar' : 'Deslizá para actualizar';
        }
      }

      document.addEventListener('touchstart', function (e) {
        if (!allowsPTR() || e.touches.length !== 1) return;
        if (blocksPTR(e)) {
          tracking = false;
          maxPull = 0;
          return;
        }
        if (!atScrollTop()) {
          tracking = false;
          maxPull = 0;
          return;
        }

        tracking = true;
        startY = e.touches[0].clientY;
        startX = e.touches[0].clientX;
        maxPull = 0;
      }, { passive: true });

      document.addEventListener('touchmove', function (e) {
        if (!tracking || !e.touches.length) return;
        if (blocksPTR(e)) {
          tracking = false;
          hideIndicator();
          return;
        }

        var y = e.touches[0].clientY;
        var x = e.touches[0].clientX;
        var dy = y - startY;
        var dx = Math.abs(x - startX);

        if (dx > Math.abs(dy) && dx > 22) {
          tracking = false;
          hideIndicator();
          return;
        }

        if (dy > 6) {
          maxPull = Math.max(maxPull, dy);
          updateIndicator(maxPull / THRESH);
        }

        if (dy < -10 && currentScrollTop() > 48) {
          tracking = false;
          hideIndicator();
        }
      }, { passive: true });

      function finalize() {
        var go = maxPull >= THRESH;
        tracking = false;
        hideIndicator();
        maxPull = 0;
        if (go) {
          window.location.reload();
        }
      }

      document.addEventListener('touchend', finalize, { passive: true });
      document.addEventListener('touchcancel', finalize, { passive: true });
    })();
