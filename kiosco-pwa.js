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

    /** Pull-to-refresh en móvil: solo desde el tope del scroll; al soltar, solo si seguís “tirando abajo” lo suficiente (si volvés el dedo hacia arriba antes de soltar, no recarga). */
    (function () {
      // Usuario prefiere el pull-to-refresh nativo del navegador.
      // Dejamos desactivado el PTR personalizado.
      return;
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

      var THRESH = 64;
      var SCROLL_EPS = 6;
      var tracking = false;
      var refreshing = false;
      var startY = 0;
      var startX = 0;
      var lastDy = 0;
      var ind = null;

      function targetUnderFinger(clientX, clientY) {
        try {
          return document.elementFromPoint(clientX, clientY);
        } catch (_) {
          return null;
        }
      }

      /** Lista de elementos debajo del dedo (más robusto que un solo elemento en capas UI). */
      function stacksFromPoint(clientX, clientY) {
        try {
          return document.elementsFromPoint(clientX, clientY) || [];
        } catch (_) {
          return [];
        }
      }

      /** PTR solo dentro de la app (panel visible) o de la pantalla de login cuando está abierta; evita mezcla con otros nodos sobre la lista. */
      function hitInsideActiveScrollSurface(hitEl) {
        if (!hitEl || !hitEl.closest) return false;
        var ls = hitEl.closest('#loginScreen');
        if (ls && ls.classList && !ls.classList.contains('hidden')) return true;
        var pnl = hitEl.closest('#mainContent section.panel');
        return !!(pnl && pnl.classList && !pnl.classList.contains('hidden'));
      }

      function activeMainPanel() {
        return document.querySelector('#mainContent section.panel:not(.hidden)');
      }

      /**
       * Todo arriba: página + panel + cada ascendiente con scrollTop>0 desde elementsFromPoint (pile completa).
       */
      function scrollChainFullyAtTop(clientX, clientY) {
        var panel = activeMainPanel();
        if (panel && ((panel.scrollTop || 0) > SCROLL_EPS)) return false;

        var pageScroll = Math.max(
          typeof window.pageYOffset === 'number' ? window.pageYOffset : 0,
          document.documentElement ? document.documentElement.scrollTop || 0 : 0,
          document.body ? document.body.scrollTop || 0 : 0,
          (document.scrollingElement && document.scrollingElement.scrollTop) || 0
        );
        if (pageScroll > SCROLL_EPS) return false;

        var stack = stacksFromPoint(clientX, clientY);
        if (!stack.length) return false;

        var zi = void 0;
        var hasSurface = false;
        for (zi = 0; zi < stack.length && zi < 24; zi++) {
          if (stack[zi] && stack[zi].nodeType === 1 && hitInsideActiveScrollSurface(stack[zi])) {
            hasSurface = true;
            break;
          }
        }
        if (!hasSurface) return false;

        var i = void 0;
        var si = void 0;
        var leaf = void 0;
        var node = void 0;

        for (i = 0; i < stack.length && i < 24; i++) {
          leaf = stack[i];
          if (!leaf || leaf.nodeType !== 1 || !hitInsideActiveScrollSurface(leaf)) continue;
          node = leaf;
          while (node && node !== document.documentElement) {
            if (node.nodeType === 1) {
              try {
                si = Number(node.scrollTop) || 0;
                if (si > SCROLL_EPS) return false;
              } catch (_) {}
            }
            node = node.parentElement;
          }
        }

        return true;
      }

      function blocksFromEl(hit) {
        if (!hit || !hit.closest) return true;
        if (hit.closest('input, textarea, select, [contenteditable]')) return true;
        if (hit.closest('.ferriol-bottom-nav')) return true;
        if (hit.closest('#notifDropdown:not(.hidden)')) return true;
        var fixed = hit.closest('.fixed.inset-0:not(.hidden)');
        if (fixed && fixed.id !== 'loginScreen') return true;
        return false;
      }

      function ensureIndicator() {
        if (ind) return ind;
        ind = document.createElement('div');
        ind.id = 'ferriolPullIndicator';
        ind.setAttribute('aria-hidden', 'true');
        ind.innerHTML = '<div class="ferriol-pull-inner"><span class="ferriol-pull-arrow" aria-hidden="true">↻</span><span class="ferriol-pull-text">Deslizá para recargar</span></div>';
        document.body.appendChild(ind);
        return ind;
      }

      function hideIndicator() {
        if (!ind) return;
        ind.classList.remove('ferriol-pull-active');
        ind.classList.remove('ferriol-pull-ready');
        ind.classList.remove('ferriol-pull-loading');
        ind.style.opacity = '0';
      }

      function updateIndicator(dyPx) {
        var el = ensureIndicator();
        var r = Math.min(Math.max(dyPx, 0) / THRESH, 1);
        el.classList.add('ferriol-pull-active');
        el.classList.toggle('ferriol-pull-ready', r >= 1);
        el.style.opacity = String(Math.min(r * 0.95, 0.95));
        el.style.transform = 'translateX(-50%) translateY(' + Math.round(-16 + (16 * r)) + 'px)';
        var arrow = el.querySelector('.ferriol-pull-arrow');
        if (arrow && !el.classList.contains('ferriol-pull-loading')) {
          arrow.style.transform = 'rotate(' + Math.round(r * 220) + 'deg)';
        }
        var tx = el.querySelector('.ferriol-pull-text');
        if (tx) {
          tx.textContent = r >= 1 ? 'Soltá para recargar' : 'Deslizá para recargar';
        }
      }

      document.addEventListener('touchstart', function (e) {
        if (!allowsPTR() || e.touches.length !== 1) return;
        var x = e.touches[0].clientX;
        var y = e.touches[0].clientY;
        var hit = targetUnderFinger(x, y);
        if (blocksFromEl(hit)) {
          tracking = false;
          lastDy = 0;
          return;
        }
        if (!scrollChainFullyAtTop(x, y)) {
          tracking = false;
          lastDy = 0;
          return;
        }

        tracking = true;
        lastDy = 0;
        startY = y;
        startX = x;
      }, { passive: true });

      document.addEventListener('touchmove', function (e) {
        if (!tracking || !e.touches.length) return;
        var y = e.touches[0].clientY;
        var x = e.touches[0].clientX;
        var hit = targetUnderFinger(x, y);
        if (blocksFromEl(hit)) {
          tracking = false;
          lastDy = 0;
          hideIndicator();
          return;
        }
        if (!scrollChainFullyAtTop(x, y)) {
          tracking = false;
          lastDy = 0;
          hideIndicator();
          return;
        }

        var dy = y - startY;
        var dx = Math.abs(x - startX);

        if (dx > Math.abs(dy) && dx > 22) {
          tracking = false;
          lastDy = 0;
          hideIndicator();
          return;
        }

        lastDy = Math.max(0, dy);

        if (lastDy <= 6) {
          hideIndicator();
          return;
        }

        updateIndicator(lastDy);
      }, { passive: true });

      function finalize(e) {
        if (refreshing) return;
        var dyEnd = 0;
        var xEnd = 0;
        var yEnd = 0;
        if (e.changedTouches && e.changedTouches.length) {
          var ct = e.changedTouches[0];
          dyEnd = ct.clientY - startY;
          xEnd = ct.clientX;
          yEnd = ct.clientY;
        }

        /* Decisión: umbral vertical al soltar + scroll en cadena debe seguir arriba + no bloques bajo el dedo */
        var hitEnd = targetUnderFinger(xEnd, yEnd);
        var go = tracking &&
          dyEnd >= THRESH &&
          allowsPTR() &&
          scrollChainFullyAtTop(xEnd, yEnd) &&
          !blocksFromEl(hitEnd);

        tracking = false;
        lastDy = 0;

        if (go) {
          refreshing = true;
          var el = ensureIndicator();
          el.classList.add('ferriol-pull-active');
          el.classList.add('ferriol-pull-loading');
          el.style.opacity = '0.95';
          el.style.transform = 'translateX(-50%) translateY(0)';
          var tx = el.querySelector('.ferriol-pull-text');
          if (tx) tx.textContent = 'Actualizando…';
          setTimeout(function () {
          if (typeof window._ferriolHardReload === 'function') {
            window._ferriolHardReload();
          } else {
            window.location.reload();
          }
          }, 120);
          return;
        }
        hideIndicator();
      }

      document.addEventListener('touchend', finalize, { passive: true });
      document.addEventListener('touchcancel', finalize, { passive: true });
    })();
