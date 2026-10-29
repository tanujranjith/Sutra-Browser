/* ============================================================================
   Sutra iOS install guide
   iOS Safari does not expose the Chromium beforeinstallprompt event. Give
   browser users the native Share -> Add to Home Screen path instead.
   ============================================================================ */
(function () {
    'use strict';

    var DISMISSED_KEY = 'sutra.ios-install-guide.dismissedAt.v1';
    var DISMISS_FOR_MS = 14 * 24 * 60 * 60 * 1000;

    function isIosDevice() {
        var ua = String((typeof navigator !== 'undefined' && navigator.userAgent) || '');
        var platform = String((typeof navigator !== 'undefined' && navigator.platform) || '');
        var touchMac = platform === 'MacIntel' && Number(navigator.maxTouchPoints || 0) > 1;
        return /iPhone|iPad|iPod/i.test(ua) || touchMac;
    }

    function isInstalled() {
        try {
            return navigator.standalone === true || window.matchMedia('(display-mode: standalone)').matches;
        } catch (error) {
            return navigator.standalone === true;
        }
    }

    function storageGet() {
        try {
            if (window.SutraSafeStorage && typeof window.SutraSafeStorage.get === 'function') {
                return window.SutraSafeStorage.get(DISMISSED_KEY, { parseJson: false, fallback: '' });
            }
        } catch (error) {
            /* The guide is optional; storage failures must never affect boot. */
        }
        return '';
    }

    function storageSet(value) {
        try {
            if (window.SutraSafeStorage && typeof window.SutraSafeStorage.set === 'function') {
                window.SutraSafeStorage.set(DISMISSED_KEY, String(value), { importance: 'optional', label: 'iOS install guide preference' });
            }
        } catch (error) {
            /* The guide is optional; storage failures must never affect boot. */
        }
    }

    function wasRecentlyDismissed() {
        var dismissedAt = Number(storageGet());
        return Number.isFinite(dismissedAt) && dismissedAt > 0 && Date.now() - dismissedAt < DISMISS_FOR_MS;
    }

    function makeText(tagName, className, text) {
        var element = document.createElement(tagName);
        if (className) element.className = className;
        element.textContent = text;
        return element;
    }

    function dismiss(guide) {
        storageSet(Date.now());
        guide.hidden = true;
        window.setTimeout(function () {
            if (guide && guide.parentNode) guide.parentNode.removeChild(guide);
        }, 180);
    }

    function showGuide() {
        if (!document.body || document.getElementById('sutraIosInstallGuide')) return;

        var guide = document.createElement('aside');
        guide.id = 'sutraIosInstallGuide';
        guide.className = 'sutra-ios-install-guide';
        guide.setAttribute('role', 'status');
        guide.setAttribute('aria-label', 'Install Sutra on this iPhone or iPad');

        var copy = document.createElement('div');
        copy.className = 'sutra-ios-install-guide-copy';
        copy.appendChild(makeText('strong', 'sutra-ios-install-guide-title', 'Install Sutra on your Home Screen'));
        copy.appendChild(makeText('span', 'sutra-ios-install-guide-text', 'Tap Share, then choose “Add to Home Screen” to keep Sutra available locally like an app.'));

        var actions = document.createElement('div');
        actions.className = 'sutra-ios-install-guide-actions';
        var dismissButton = makeText('button', 'sutra-ios-install-guide-dismiss', 'Got it');
        dismissButton.type = 'button';
        dismissButton.setAttribute('aria-label', 'Dismiss install instructions');
        dismissButton.addEventListener('click', function () { dismiss(guide); });
        actions.appendChild(dismissButton);

        guide.appendChild(copy);
        guide.appendChild(actions);
        document.body.appendChild(guide);
    }

    function init() {
        var protocol = String((typeof location !== 'undefined' && location.protocol) || '');
        if (protocol !== 'http:' && protocol !== 'https:') return;
        if (!isIosDevice() || isInstalled() || wasRecentlyDismissed()) return;
        window.setTimeout(showGuide, 700);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', init, { once: true });
    } else {
        init();
    }
}());
