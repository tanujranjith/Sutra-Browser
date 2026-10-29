/*
 * Canvas shape picker
 *
 * The Canvas workspace is initialized inside app.js, so this small bridge
 * deliberately calls its registered SutraCanvas API instead of reaching into
 * private runtime helpers. Keeping the menu in a body-level portal while it
 * is open prevents the horizontally scrollable toolbar from clipping it or
 * creating a document scrollbar.
 */
(function canvasShapePickerModule(global) {
    'use strict';

    var removeDismissHandlers = null;

    function getParts() {
        return {
            button: document.getElementById('canvasShapeBtn'),
            picker: document.getElementById('canvasShapePicker'),
            menu: document.getElementById('canvasShapeMenu')
        };
    }

    function closePicker(options) {
        var parts = getParts();
        if (parts.menu) {
            parts.menu.hidden = true;
            parts.menu.style.top = '';
            parts.menu.style.left = '';
            if (parts.picker && parts.menu.parentElement !== parts.picker) {
                parts.picker.appendChild(parts.menu);
            }
        }
        if (parts.button) {
            parts.button.setAttribute('aria-expanded', 'false');
            if (options && options.restoreFocus) parts.button.focus();
        }
        if (removeDismissHandlers) {
            removeDismissHandlers();
            removeDismissHandlers = null;
        }
    }

    function openPicker(event) {
        if (event) event.stopPropagation();
        var parts = getParts();
        if (!parts.button || !parts.menu) return;
        if (!parts.menu.hidden) {
            closePicker();
            return;
        }

        document.body.appendChild(parts.menu);
        parts.menu.hidden = false;
        var rect = parts.button.getBoundingClientRect();
        var menuWidth = parts.menu.getBoundingClientRect().width || 168;
        var left = Math.max(8, Math.min(Math.round(rect.left), global.innerWidth - menuWidth - 8));
        parts.menu.style.top = Math.round(rect.bottom + 8) + 'px';
        parts.menu.style.left = left + 'px';
        parts.button.setAttribute('aria-expanded', 'true');

        function dismissOnOutsideClick(outsideEvent) {
            if (parts.menu.contains(outsideEvent.target) || parts.button.contains(outsideEvent.target)) return;
            closePicker();
        }
        function dismissOnEscape(keyEvent) {
            if (keyEvent.key === 'Escape') closePicker({ restoreFocus: true });
        }
        document.addEventListener('click', dismissOnOutsideClick, true);
        document.addEventListener('keydown', dismissOnEscape);
        removeDismissHandlers = function () {
            document.removeEventListener('click', dismissOnOutsideClick, true);
            document.removeEventListener('keydown', dismissOnEscape);
        };
    }

    function chooseShape(event) {
        var item = event.target.closest('[data-canvas-shape]');
        if (!item) return;
        var shape = String(item.getAttribute('data-canvas-shape') || 'rounded');
        closePicker();
        if (global.SutraCanvas && typeof global.SutraCanvas.addShape === 'function') {
            global.SutraCanvas.addShape(shape, { text: '' });
        }
    }

    function bindPicker() {
        var parts = getParts();
        if (!parts.button || !parts.menu || parts.button.dataset.canvasShapePickerBound === 'true') return;
        parts.button.dataset.canvasShapePickerBound = 'true';
        parts.button.addEventListener('click', openPicker);
        parts.menu.addEventListener('click', chooseShape);
    }

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', bindPicker, { once: true });
    } else {
        bindPicker();
    }
}(typeof window !== 'undefined' ? window : globalThis));
