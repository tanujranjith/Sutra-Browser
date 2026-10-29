/* Sutra theme identity + custom-theme compatibility layer.
 *
 * Preset appearance is still owned by app.js. This small post-load bridge fixes
 * the data-attribute mismatch that used to make dark brand presets fall back to
 * the generic dark stylesheet, and adds one canonical Heritage preset without
 * rewriting the large classic runtime.
 */
(function () {
    'use strict';

    var IDENTITY_THEMES = new Set([
        'windows11', 'chromeos', 'ubuntu', 'github', 'spotify', 'netflix', 'slack'
    ]);

    function normalizeTheme(value) {
        return String(value || '').trim().toLowerCase();
    }

    function repairPresetIdentity(themeName) {
        var key = normalizeTheme(themeName);
        if (!IDENTITY_THEMES.has(key) || !document.body) return;
        if (normalizeTheme(document.body.getAttribute('data-theme-key')) !== key) return;
        /* app.js used `dark` as the mode marker for these presets. The visual
         * identity styles key off the actual preset name, so restore it after
         * the shared dark-mode tokens have been applied. */
        document.body.setAttribute('data-theme', key);
    }

    function installPresetIdentityBridge() {
        if (typeof applyPresetThemeAppearance !== 'function' || applyPresetThemeAppearance.__sutraIdentityBridge) return;
        var original = applyPresetThemeAppearance;
        var bridged = function (themeName) {
            var result = original.apply(this, arguments);
            repairPresetIdentity(themeName);
            return result;
        };
        bridged.__sutraIdentityBridge = true;
        applyPresetThemeAppearance = bridged;
    }

    function installHeritagePreset() {
        if (typeof themes !== 'object' || !themes || themes.heritage) return;
        themes.heritage = {
            name: 'Peach',
            mode: 'light',
            accent: '#a96f3f',
            sidebar: '#e9dcc9',
            button: '#d9c0a3'
        };
    }

    function repairExistingIdentity() {
        if (!document.body) return;
        repairPresetIdentity(document.body.getAttribute('data-theme-key'));
    }

    installHeritagePreset();
    installPresetIdentityBridge();
    repairExistingIdentity();

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', repairExistingIdentity, { once: true });
    }
}());
