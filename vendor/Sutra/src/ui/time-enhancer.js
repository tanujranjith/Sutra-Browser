(function () {
    'use strict';

    const MARK = 'nfTimeEnhanced';
    const components = new WeakMap();
    let openComponent = null;
    let domObserver = null;

    function isTimeInput(el) {
        return el instanceof HTMLInputElement && el.type === 'time';
    }

    function shouldEnhance(input) {
        if (!isTimeInput(input)) return false;
        if (input.dataset.nativeTime === 'true') return false;
        if (input.classList.contains('no-custom-time')) return false;
        if (input.classList.contains('hw-paste-input')) return false;
        return true;
    }

    function parseNative(value) {
        if (!value) return null;
        const m = /^(\d{2}):(\d{2})$/.exec(value);
        if (!m) return null;
        const h24 = +m[1], min = +m[2];
        if (h24 > 23 || min > 59) return null;
        return { h12: h24 % 12 || 12, min, period: h24 >= 12 ? 'PM' : 'AM' };
    }

    function toNativeValue(h12, min, period) {
        const h24 = (h12 % 12) + (period === 'PM' ? 12 : 0);
        return String(h24).padStart(2, '0') + ':' + String(min).padStart(2, '0');
    }

    function formatLabel(h12, min, period) {
        return String(h12).padStart(2, '0') + ':' + String(min).padStart(2, '0') + ' ' + period;
    }

    function getPortalZ(trigger) {
        if (!(trigger instanceof Element)) return 14020;
        let maxZ = 0;
        let node = trigger;
        while (node && node !== document.documentElement) {
            const style = window.getComputedStyle(node);
            const z = style ? Number.parseInt(style.zIndex, 10) : NaN;
            if (Number.isFinite(z)) maxZ = Math.max(maxZ, z);
            node = node.parentElement;
        }
        const rootStyles = window.getComputedStyle(document.documentElement);
        const modalLayer = Number.parseInt(rootStyles.getPropertyValue('--z-modal'), 10);
        const baseLayer = Number.isFinite(modalLayer) ? modalLayer : 14000;
        return Math.max(baseLayer + 20, maxZ + 20);
    }

    function syncModalManager() {
        try {
            const manager = window.SutraModalManager;
            if (manager && typeof manager.sync === 'function') manager.sync();
            const dialog = openComponent && openComponent.input.closest('[aria-modal="true"]');
            if (dialog && openComponent.panel.classList.contains('is-open')) {
                // SutraModalManager isolates body-level portal branches while a
                // dialog is open. The active time panel is part of that dialog's
                // interaction surface, so release only its temporary isolation.
                const panel = openComponent.panel;
                panel.removeAttribute('aria-hidden');
                if ('inert' in panel) panel.inert = false;
            }
        } catch (error) {
            if (typeof window.SutraReportError === 'function') {
                window.SutraReportError(error, { where: 'time-enhancer.modal-sync' }, 'warning');
            }
        }
    }

    function positionPanel(c) {
        const panel = c.panel;
        const trigger = c.trigger;
        panel.style.zIndex = String(getPortalZ(trigger));
        const rect = trigger.getBoundingClientRect();
        const vw = window.innerWidth;
        const vh = window.innerHeight;
        const margin = 10, gap = 6;
        const pw = Math.min(248, Math.max(220, rect.width));
        const ph = panel.offsetHeight || 200;

        let left = rect.left;
        let top = rect.bottom + gap;
        if (vh - rect.bottom - margin < ph && rect.top - margin > vh - rect.bottom - margin) {
            top = rect.top - ph - gap;
        }
        if (left + pw > vw - margin) left = vw - pw - margin;
        if (left < margin) left = margin;
        if (top < margin) top = margin;

        panel.style.width = pw + 'px';
        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
    }

    function openPanel(c) {
        if (c.input.disabled || c.input.readOnly) return;
        if (openComponent && openComponent !== c) closePanel(openComponent);
        syncFromInput(c);
        c.wrapper.classList.add('open');
        c.trigger.setAttribute('aria-expanded', 'true');
        c.panel.classList.add('is-open');
        positionPanel(c);
        openComponent = c;
        syncModalManager();
        requestAnimationFrame(function () { positionPanel(c); });
    }

    function closePanel(c) {
        if (!c) return;
        c.wrapper.classList.remove('open');
        c.trigger.setAttribute('aria-expanded', 'false');
        c.panel.classList.remove('is-open');
        if (openComponent === c) {
            openComponent = null;
            syncModalManager();
        }
    }

    function updateTrigger(c) {
        if (c.state.hasValue) {
            c.labelEl.textContent = formatLabel(c.state.h12, c.state.min, c.state.period);
            c.wrapper.classList.remove('is-empty');
        } else {
            c.labelEl.textContent = c.placeholder;
            c.wrapper.classList.add('is-empty');
        }
    }

    function updateSpinners(c) {
        c.hourNum.textContent = String(c.state.h12).padStart(2, '0');
        c.minNum.textContent = String(c.state.min).padStart(2, '0');
        c.amOpt.classList.toggle('is-active', c.state.period === 'AM');
        c.pmOpt.classList.toggle('is-active', c.state.period === 'PM');
    }

    function syncFromInput(c) {
        const parsed = parseNative(c.input.value);
        if (parsed) {
            c.state = { hasValue: true, h12: parsed.h12, min: parsed.min, period: parsed.period };
        } else {
            c.state = { hasValue: false, h12: c.state.h12, min: c.state.min, period: c.state.period };
        }
        updateTrigger(c);
        updateSpinners(c);
    }

    function commitValue(c) {
        const nv = toNativeValue(c.state.h12, c.state.min, c.state.period);
        if (c.input.value !== nv) {
            c.input.value = nv;
            c.input.dispatchEvent(new Event('input', { bubbles: true }));
            c.input.dispatchEvent(new Event('change', { bubbles: true }));
        }
        c.state.hasValue = true;
        updateTrigger(c);
    }

    function stepHour(c, dir) {
        c.state.h12 = ((c.state.h12 - 1 + dir + 12) % 12) + 1;
        updateSpinners(c);
        commitValue(c);
    }

    function stepMinute(c, dir) {
        c.state.min = (c.state.min + dir + 60) % 60;
        updateSpinners(c);
        commitValue(c);
    }

    function makeBtn(cls, innerHTML, ariaLabel) {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = cls;
        btn.innerHTML = innerHTML;
        btn.setAttribute('aria-label', ariaLabel);
        return btn;
    }

    const CHEVRON_UP = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M2 9L6.5 4.5L11 9" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const CHEVRON_DOWN = '<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true"><path d="M2 4L6.5 8.5L11 4" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const CLOCK_ICON = '<svg width="14" height="14" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6.25" stroke="currentColor" stroke-width="1.5"/><path d="M8 5v3.25l2.25 1.5" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round"/></svg>';

    function enhanceTimeInput(input) {
        if (!shouldEnhance(input)) return null;
        if (input.dataset[MARK] === 'true') return components.get(input) || null;

        // Wrapper
        const wrapper = document.createElement('div');
        wrapper.className = 'nf-time is-empty';
        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
        input.classList.add('nf-time-native');
        input.dataset[MARK] = 'true';

        // Trigger button
        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'nf-time-trigger';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');

        const labelEl = document.createElement('span');
        labelEl.className = 'nf-time-label';

        const iconEl = document.createElement('span');
        iconEl.className = 'nf-time-icon';
        iconEl.innerHTML = CLOCK_ICON;

        trigger.appendChild(labelEl);
        trigger.appendChild(iconEl);
        wrapper.appendChild(trigger);

        // Panel (portal — appended to body)
        const panel = document.createElement('div');
        panel.className = 'nf-time-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Select time');

        // — Spinners row —
        const spinnersRow = document.createElement('div');
        spinnersRow.className = 'nf-time-spinners';

        function makeSpinner() {
            const wrap = document.createElement('div');
            wrap.className = 'nf-time-spinner';
            const up = makeBtn('nf-time-spin-btn', CHEVRON_UP, 'Increase');
            const num = document.createElement('div');
            num.className = 'nf-time-num';
            num.textContent = '00';
            const down = makeBtn('nf-time-spin-btn', CHEVRON_DOWN, 'Decrease');
            wrap.appendChild(up);
            wrap.appendChild(num);
            wrap.appendChild(down);
            return { wrap, up, num, down };
        }

        const hourSpinner = makeSpinner();
        const colonEl = document.createElement('div');
        colonEl.className = 'nf-time-colon';
        colonEl.textContent = ':';
        const minSpinner = makeSpinner();

        // AM/PM
        const periodGroup = document.createElement('div');
        periodGroup.className = 'nf-time-period-group';
        const amOpt = makeBtn('nf-time-period-opt', 'AM', 'AM');
        const pmOpt = makeBtn('nf-time-period-opt', 'PM', 'PM');
        periodGroup.appendChild(amOpt);
        periodGroup.appendChild(pmOpt);

        spinnersRow.appendChild(hourSpinner.wrap);
        spinnersRow.appendChild(colonEl);
        spinnersRow.appendChild(minSpinner.wrap);
        spinnersRow.appendChild(periodGroup);
        panel.appendChild(spinnersRow);

        // — Footer —
        const footer = document.createElement('div');
        footer.className = 'nf-time-footer';
        const clearBtn = makeBtn('nf-time-act', 'Clear', 'Clear time');
        const doneBtn = makeBtn('nf-time-act nf-time-act--done', 'Done', 'Confirm time');
        footer.appendChild(clearBtn);
        footer.appendChild(doneBtn);
        panel.appendChild(footer);

        document.body.appendChild(panel);

        // Component state
        const c = {
            input, wrapper, trigger, labelEl, panel,
            hourNum: hourSpinner.num,
            minNum: minSpinner.num,
            amOpt, pmOpt,
            placeholder: input.placeholder || 'Due time',
            state: { hasValue: false, h12: 11, min: 59, period: 'PM' }
        };
        components.set(input, c);

        // Wire up events
        trigger.addEventListener('click', function () {
            panel.classList.contains('is-open') ? closePanel(c) : openPanel(c);
        });

        hourSpinner.up.addEventListener('click', function () { stepHour(c, 1); });
        hourSpinner.down.addEventListener('click', function () { stepHour(c, -1); });
        minSpinner.up.addEventListener('click', function () { stepMinute(c, 1); });
        minSpinner.down.addEventListener('click', function () { stepMinute(c, -1); });

        // Scroll wheel on the number display
        hourSpinner.num.addEventListener('wheel', function (e) {
            e.preventDefault();
            stepHour(c, e.deltaY > 0 ? -1 : 1);
        }, { passive: false });
        minSpinner.num.addEventListener('wheel', function (e) {
            e.preventDefault();
            stepMinute(c, e.deltaY > 0 ? -1 : 1);
        }, { passive: false });

        amOpt.addEventListener('click', function () {
            c.state.period = 'AM';
            updateSpinners(c);
            commitValue(c);
        });
        pmOpt.addEventListener('click', function () {
            c.state.period = 'PM';
            updateSpinners(c);
            commitValue(c);
        });

        clearBtn.addEventListener('click', function () {
            c.state.hasValue = false;
            if (c.input.value !== '') {
                c.input.value = '';
                c.input.dispatchEvent(new Event('input', { bubbles: true }));
                c.input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            updateTrigger(c);
            closePanel(c);
            trigger.focus();
        });

        doneBtn.addEventListener('click', function () {
            commitValue(c);
            closePanel(c);
            trigger.focus();
        });

        panel.addEventListener('keydown', function (e) {
            if (e.key === 'Escape') { e.preventDefault(); closePanel(c); trigger.focus(); }
        });

        trigger.addEventListener('keydown', function (e) {
            if ((e.key === 'Enter' || e.key === ' ') && !panel.classList.contains('is-open')) {
                e.preventDefault(); openPanel(c);
            }
            if (e.key === 'Escape' && panel.classList.contains('is-open')) {
                e.preventDefault(); closePanel(c);
            }
        });

        input.addEventListener('change', function () { syncFromInput(c); });
        input.addEventListener('input', function () { syncFromInput(c); });

        syncFromInput(c);
        return c;
    }

    function refreshCustomTimes(root) {
        const scope = (root && root.querySelectorAll) ? root : document;
        const inputs = Array.from(scope.querySelectorAll('input[type="time"]'));
        if (root instanceof HTMLInputElement && root.type === 'time') inputs.unshift(root);
        inputs.forEach(function (input) {
            const comp = enhanceTimeInput(input);
            if (comp) syncFromInput(comp);
        });
    }

    function cleanupCustomTimes(root) {
        const scope = (root && root.querySelectorAll) ? root : document;
        const inputs = Array.from(scope.querySelectorAll('input[type="time"]'));
        if (root instanceof HTMLInputElement && root.type === 'time') inputs.unshift(root);
        inputs.forEach(function (input) {
            const c = components.get(input);
            if (!c) return;
            try { delete input.dataset[MARK]; } catch (_) {}
            input.classList.remove('nf-time-native');
            if (c.panel && c.panel.parentNode) c.panel.parentNode.removeChild(c.panel);
            components.delete(input);
        });
    }

    function initCustomTimes() {
        refreshCustomTimes(document);

        if (!domObserver && document.body) {
            domObserver = new MutationObserver(function (mutations) {
                try {
                    mutations.forEach(function (mutation) {
                        mutation.addedNodes.forEach(function (node) {
                            if (!(node instanceof Element)) return;
                            if (node.classList.contains('nf-time') || node.classList.contains('nf-time-panel')) return;
                            refreshCustomTimes(node);
                        });
                        mutation.removedNodes.forEach(function (node) {
                            if (!(node instanceof Element) || node.isConnected) return;
                            cleanupCustomTimes(node);
                        });
                    });
                } finally {
                    domObserver.takeRecords();
                }
            });
            domObserver.observe(document.body, { childList: true, subtree: true });
        }

        document.addEventListener('pointerdown', function (e) {
            if (!openComponent) return;
            const inside = openComponent.wrapper.contains(e.target) || openComponent.panel.contains(e.target);
            if (!inside) closePanel(openComponent);
        }, true);

        document.addEventListener('keydown', function (e) {
            if (e.key === 'Escape' && openComponent) {
                const t = openComponent.trigger;
                closePanel(openComponent);
                t.focus();
            }
        });

        window.addEventListener('resize', function () {
            if (openComponent) positionPanel(openComponent);
        });
        window.addEventListener('scroll', function () {
            if (openComponent) positionPanel(openComponent);
        }, true);
    }

    window.refreshCustomTimes = refreshCustomTimes;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCustomTimes, { once: true });
    } else {
        initCustomTimes();
    }
})();
