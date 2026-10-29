/* ==========================================================================
   Sutra service worker registration + offline indicator
   ==========================================================================
   Registration is PROTOCOL-GATED: the SW is only registered over http(s).
   Under file:// (the common "just open the file" path) service workers are
   unavailable/disallowed, so we skip silently and Sutra keeps working exactly
   as before. No telemetry; failures are swallowed.
   ========================================================================== */

(function () {
    'use strict';

    var proto = (typeof location !== 'undefined' && location.protocol) || '';
    var canRegister = typeof navigator !== 'undefined'
        && 'serviceWorker' in navigator
        && (proto === 'http:' || proto === 'https:');
    var refreshingForUpdate = false;

    function hideUpdateBanner() {
        var existing = document.getElementById('sutraUpdateBanner');
        if (existing) existing.hidden = true;
    }

    function requestSafeReload(registration) {
        var waiting = registration && registration.waiting;
        if (!waiting) return;
        refreshingForUpdate = true;
        var button = document.getElementById('sutraUpdateReloadBtn');
        if (button) { button.disabled = true; button.textContent = 'Reloading…'; }
        try { waiting.postMessage({ type: 'SUTRA_SKIP_WAITING' }); } catch (e) { refreshingForUpdate = false; }
    }

    function showUpdateBanner(registration) {
        if (!registration || !registration.waiting || !document.body) return;
        var banner = document.getElementById('sutraUpdateBanner');
        if (!banner) {
            banner = document.createElement('div');
            banner.id = 'sutraUpdateBanner';
            banner.className = 'sutra-update-banner';
            banner.setAttribute('role', 'status');
            banner.setAttribute('aria-live', 'polite');
            var message = document.createElement('span');
            message.className = 'sutra-update-message';
            message.textContent = 'A new Sutra version is ready. Your workspace stays saved locally.';
            var reload = document.createElement('button');
            reload.id = 'sutraUpdateReloadBtn';
            reload.type = 'button';
            reload.className = 'sutra-update-primary';
            reload.textContent = 'Reload safely';
            reload.addEventListener('click', function () { requestSafeReload(registration); });
            var later = document.createElement('button');
            later.type = 'button';
            later.className = 'sutra-update-dismiss';
            later.textContent = 'Later';
            later.addEventListener('click', hideUpdateBanner);
            banner.appendChild(message);
            banner.appendChild(reload);
            banner.appendChild(later);
            document.body.appendChild(banner);
        }
        banner.hidden = false;
    }

    function watchRegistration(registration) {
        if (!registration) return;
        if (registration.waiting) showUpdateBanner(registration);
        registration.addEventListener('updatefound', function () {
            var worker = registration.installing;
            if (!worker) return;
            worker.addEventListener('statechange', function () {
                if (worker.state === 'installed' && navigator.serviceWorker.controller) showUpdateBanner(registration);
            });
        });
    }

    if (canRegister) {
        window.addEventListener('load', function () {
            try {
                navigator.serviceWorker.register('./sw.js')
                    .then(watchRegistration)
                    .catch(function () { /* offline support is best-effort */ });
            } catch (e) { /* never block boot on SW issues */ }
        });
        navigator.serviceWorker.addEventListener('controllerchange', function () {
            if (refreshingForUpdate) window.location.reload();
        });
    }

    // Lightweight, theme-respecting offline indicator. In-app only, no network.
    function setOffline(isOffline) {
        var id = 'sutraOfflineIndicator';
        var el = document.getElementById(id);
        if (isOffline) {
            if (!el) {
                el = document.createElement('div');
                el.id = id;
                el.setAttribute('role', 'status');
                el.setAttribute('aria-live', 'polite');
                el.textContent = 'Offline — your work is saved locally and will keep working.';
                document.body.appendChild(el);
            }
            el.hidden = false;
        } else if (el) {
            el.hidden = true;
        }
    }

    if (typeof window !== 'undefined') {
        window.addEventListener('online', function () { setOffline(false); });
        window.addEventListener('offline', function () { setOffline(true); });
        // Reflect initial state once the DOM is ready.
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', function () { if (!navigator.onLine) setOffline(true); });
        } else if (!navigator.onLine) {
            setOffline(true);
        }
    }
}());
