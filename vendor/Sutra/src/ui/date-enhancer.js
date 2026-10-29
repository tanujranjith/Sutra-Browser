(function () {
    'use strict';

    const ENHANCED_MARK = 'nfDateEnhanced';
    const WEEKDAYS = ['Su', 'Mo', 'Tu', 'We', 'Th', 'Fr', 'Sa'];
    const components = new WeakMap();
    let openComponent = null;
    let domObserver = null;
    let valuePatched = false;

    function isDateInput(input) {
        return input instanceof HTMLInputElement && input.type === 'date';
    }

    function shouldEnhance(input) {
        if (!isDateInput(input)) return false;
        if (input.dataset.nativeDate === 'true' || input.classList.contains('no-custom-date')) return false;
        return true;
    }

    function shouldUsePortal(input) {
        // Default to portal rendering everywhere so panels are never clipped by
        // parent overflow/stacking contexts. Allow per-control opt-out.
        return input.dataset.inlineMenu !== 'true';
    }

    function getPortalLayer(trigger) {
        if (!(trigger instanceof Element)) return 13000;
        let maxZ = 0;
        let node = trigger;
        while (node && node !== document.documentElement) {
            const style = window.getComputedStyle(node);
            const raw = style ? Number.parseInt(style.zIndex, 10) : NaN;
            if (Number.isFinite(raw)) maxZ = Math.max(maxZ, raw);
            node = node.parentElement;
        }
        // Portaled date panels can be opened from inside a modal. Keep them
        // above the modal's backdrop/card, while still allowing a more deeply
        // nested high-z-index surface to win when one exists.
        const rootStyles = window.getComputedStyle(document.documentElement);
        const modalLayer = Number.parseInt(rootStyles.getPropertyValue('--z-modal'), 10);
        const baseLayer = Number.isFinite(modalLayer) ? modalLayer : 14000;
        return Math.max(baseLayer + 20, maxZ + 20);
    }

    function parseDateValue(value) {
        if (!value || typeof value !== 'string') return null;
        const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
        if (!m) return null;
        const year = Number(m[1]);
        const month = Number(m[2]) - 1;
        const day = Number(m[3]);
        const d = new Date(year, month, day);
        if (d.getFullYear() !== year || d.getMonth() !== month || d.getDate() !== day) return null;
        return d;
    }

    function formatIsoDate(date) {
        const y = date.getFullYear();
        const m = String(date.getMonth() + 1).padStart(2, '0');
        const d = String(date.getDate()).padStart(2, '0');
        return y + '-' + m + '-' + d;
    }

    function formatDisplayDate(value) {
        const date = parseDateValue(value);
        if (!date) return '';
        try {
            return new Intl.DateTimeFormat('en-US', {
                year: 'numeric',
                month: '2-digit',
                day: '2-digit'
            }).format(date);
        } catch (e) {
            const month = String(date.getMonth() + 1).padStart(2, '0');
            const day = String(date.getDate()).padStart(2, '0');
            return month + '/' + day + '/' + date.getFullYear();
        }
    }

    function copySizingStyles(input, wrapper) {
        const props = [
            'width', 'minWidth', 'maxWidth',
            'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
            'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf'
        ];
        props.forEach(function (prop) {
            if (input.style[prop]) wrapper.style[prop] = input.style[prop];
        });
    }

    function setPanelDirection(component) {
        component.wrapper.classList.remove('drop-up');
        component.panel.classList.remove('nf-date-panel--open-up');
        const rect = component.trigger.getBoundingClientRect();
        const panelHeight = component.panel.offsetHeight || 340;
        const spaceBelow = window.innerHeight - rect.bottom;
        const spaceAbove = rect.top;
        const openUp = spaceBelow < panelHeight + 16 && spaceAbove > spaceBelow;
        if (component.usePortal) {
            component.panel.classList.toggle('nf-date-panel--open-up', openUp);
            return;
        }
        if (openUp) {
            component.wrapper.classList.add('drop-up');
        }
    }

    function positionPortalPanel(component) {
        if (!component || !component.usePortal) return;
        const panel = component.panel;
        panel.style.zIndex = String(getPortalLayer(component.trigger));
        const triggerRect = component.trigger.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
        const margin = 10;
        const gap = 8;

        const width = Math.max(220, Math.min(Math.max(triggerRect.width, 280), viewportWidth - (margin * 2)));
        panel.style.minWidth = '0px';
        panel.style.width = width + 'px';

        const panelHeight = panel.offsetHeight || 340;
        const spaceBelow = viewportHeight - triggerRect.bottom - margin;
        const spaceAbove = triggerRect.top - margin;
        const openUp = spaceBelow < Math.min(panelHeight, 320) && spaceAbove > spaceBelow;

        let left = triggerRect.left;
        let top = openUp
            ? triggerRect.top - panelHeight - gap
            : triggerRect.bottom + gap;

        if (left + width > viewportWidth - margin) left = viewportWidth - width - margin;
        if (left < margin) left = margin;
        if (top < margin) top = margin;
        if (!openUp && top + panelHeight > viewportHeight - margin) {
            top = Math.max(margin, viewportHeight - panelHeight - margin);
        }

        panel.style.left = left + 'px';
        panel.style.top = top + 'px';
        panel.classList.toggle('nf-date-panel--open-up', openUp);
    }

    function closeOpenDate() {
        if (!openComponent) return;
        const component = openComponent;
        openComponent = null;
        component.wrapper.classList.remove('open');
        component.trigger.setAttribute('aria-expanded', 'false');
        component.panel.classList.remove('is-open');
        component.panel.classList.remove('nf-date-panel--open-up');
        syncModalManager();
    }

    function syncModalManager() {
        try {
            const manager = window.SutraModalManager;
            if (manager && typeof manager.sync === 'function') manager.sync();
            const dialog = openComponent && openComponent.input.closest('[aria-modal="true"]');
            if (dialog && openComponent.usePortal && openComponent.panel.classList.contains('is-open')) {
                // SutraModalManager isolates body-level portal branches while a
                // dialog is open. The active date panel is part of that dialog's
                // interaction surface, so release only its temporary isolation.
                const panel = openComponent.panel;
                if (panel.getAttribute('data-sutra-modal-inert') === '1') {
                    panel.removeAttribute('aria-hidden');
                    if ('inert' in panel) panel.inert = false;
                }
            }
        } catch (error) {
            if (typeof window.SutraReportError === 'function') {
                window.SutraReportError(error, { where: 'date-enhancer.modal-sync' }, 'warning');
            }
        }
    }

    function isDateAllowed(component, date) {
        const iso = formatIsoDate(date);
        if (component.min && iso < component.min) return false;
        if (component.max && iso > component.max) return false;
        return true;
    }

    function updateLabel(component) {
        const display = formatDisplayDate(component.input.value);
        component.label.textContent = display || component.placeholder;
        component.wrapper.classList.toggle('is-empty', !display);
    }

    function syncFromInput(component) {
        const selected = parseDateValue(component.input.value);
        const base = selected || new Date();
        component.viewDate = new Date(base.getFullYear(), base.getMonth(), 1);
        component.min = component.input.min || '';
        component.max = component.input.max || '';
        updateLabel(component);
        renderCalendar(component);
    }

    function renderCalendar(component) {
        const view = component.viewDate;
        const year = view.getFullYear();
        const month = view.getMonth();
        component.title.textContent = view.toLocaleString(undefined, { month: 'long', year: 'numeric' });

        const firstOfMonth = new Date(year, month, 1);
        const startDay = firstOfMonth.getDay();
        const startDate = new Date(year, month, 1 - startDay);
        const todayIso = formatIsoDate(new Date());
        const selectedIso = component.input.value;

        component.days.innerHTML = '';
        for (let i = 0; i < 42; i += 1) {
            const date = new Date(startDate.getFullYear(), startDate.getMonth(), startDate.getDate() + i);
            const iso = formatIsoDate(date);
            const isOther = date.getMonth() !== month;
            const isToday = iso === todayIso;
            const isSelected = iso === selectedIso;
            const allowed = isDateAllowed(component, date);

            const btn = document.createElement('button');
            btn.type = 'button';
            btn.className = 'nf-date-day';
            btn.textContent = String(date.getDate());
            btn.setAttribute('data-date', iso);
            if (isOther) btn.classList.add('is-other');
            if (isToday) btn.classList.add('is-today');
            if (isSelected) btn.classList.add('is-selected');
            if (!allowed) btn.disabled = true;

            btn.addEventListener('click', function () {
                if (btn.disabled) return;
                if (component.input.value !== iso) {
                    component.input.value = iso;
                    component.input.dispatchEvent(new Event('input', { bubbles: true }));
                    component.input.dispatchEvent(new Event('change', { bubbles: true }));
                }
                syncFromInput(component);
                closeOpenDate();
                component.trigger.focus();
            });

            component.days.appendChild(btn);
        }
    }

    function openDate(component) {
        if (component.input.disabled || component.input.readOnly) return;
        if (openComponent && openComponent !== component) closeOpenDate();
        syncFromInput(component);
        component.wrapper.classList.add('open');
        component.trigger.setAttribute('aria-expanded', 'true');
        component.panel.classList.add('is-open');
        if (component.usePortal) {
            positionPortalPanel(component);
        } else {
            setPanelDirection(component);
        }
        openComponent = component;
        syncModalManager();
        window.requestAnimationFrame(function () {
            if (component.usePortal) {
                positionPortalPanel(component);
            } else {
                setPanelDirection(component);
            }
        });
    }

    function buildWeekdays(container) {
        WEEKDAYS.forEach(function (name) {
            const el = document.createElement('div');
            el.className = 'nf-date-weekday';
            el.textContent = name;
            container.appendChild(el);
        });
    }

    function enhanceDateInput(input) {
        if (!shouldEnhance(input)) return null;
        if (input.dataset[ENHANCED_MARK] === 'true') return components.get(input) || null;

        const wrapper = document.createElement('div');
        wrapper.className = 'nf-date';
        if (
            input.classList.contains('modal-input') ||
            input.closest('.modal-body') ||
            input.closest('.hw-inline-add') ||
            input.closest('.hw-controls')
        ) {
            wrapper.classList.add('nf-date--full');
        }
        copySizingStyles(input, wrapper);
        if (!wrapper.style.width && wrapper.classList.contains('nf-date--full')) {
            wrapper.style.width = '100%';
        }

        input.parentNode.insertBefore(wrapper, input);
        wrapper.appendChild(input);
        input.classList.add('nf-date-native');
        input.dataset[ENHANCED_MARK] = 'true';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'nf-date-trigger';
        trigger.setAttribute('aria-haspopup', 'dialog');
        trigger.setAttribute('aria-expanded', 'false');

        const label = document.createElement('span');
        label.className = 'nf-date-label';
        trigger.appendChild(label);

        const icon = document.createElement('span');
        icon.className = 'nf-date-icon';
        icon.setAttribute('aria-hidden', 'true');
        trigger.appendChild(icon);

        const panel = document.createElement('div');
        panel.className = 'nf-date-panel';
        panel.setAttribute('role', 'dialog');
        panel.setAttribute('aria-label', 'Calendar');
        const usePortal = shouldUsePortal(input);
        if (usePortal) panel.classList.add('nf-date-panel--portal');

        const header = document.createElement('div');
        header.className = 'nf-date-header';

        const prevBtn = document.createElement('button');
        prevBtn.type = 'button';
        prevBtn.className = 'nf-date-nav';
        prevBtn.textContent = '<';

        const title = document.createElement('div');
        title.className = 'nf-date-title';

        const nextBtn = document.createElement('button');
        nextBtn.type = 'button';
        nextBtn.className = 'nf-date-nav';
        nextBtn.textContent = '>';

        header.appendChild(prevBtn);
        header.appendChild(title);
        header.appendChild(nextBtn);

        const weekdays = document.createElement('div');
        weekdays.className = 'nf-date-weekdays';
        buildWeekdays(weekdays);

        const days = document.createElement('div');
        days.className = 'nf-date-days';

        const footer = document.createElement('div');
        footer.className = 'nf-date-footer';
        const clearBtn = document.createElement('button');
        clearBtn.type = 'button';
        clearBtn.className = 'nf-date-action';
        clearBtn.textContent = 'Clear';
        const todayBtn = document.createElement('button');
        todayBtn.type = 'button';
        todayBtn.className = 'nf-date-action';
        todayBtn.textContent = 'Today';
        footer.appendChild(clearBtn);
        footer.appendChild(todayBtn);

        panel.appendChild(header);
        panel.appendChild(weekdays);
        panel.appendChild(days);
        panel.appendChild(footer);
        wrapper.appendChild(trigger);
        if (usePortal) {
            document.body.appendChild(panel);
        } else {
            wrapper.appendChild(panel);
        }

        const component = {
            input: input,
            wrapper: wrapper,
            trigger: trigger,
            label: label,
            panel: panel,
            title: title,
            days: days,
            viewDate: new Date(),
            placeholder: input.placeholder || 'Select date',
            min: input.min || '',
            max: input.max || '',
            usePortal: usePortal
        };
        components.set(input, component);
        syncFromInput(component);

        trigger.addEventListener('click', function () {
            if (wrapper.classList.contains('open')) {
                closeOpenDate();
            } else {
                openDate(component);
            }
        });

        trigger.addEventListener('keydown', function (event) {
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (wrapper.classList.contains('open')) closeOpenDate();
                else openDate(component);
            }
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                openDate(component);
            }
            if (event.key === 'Escape' && wrapper.classList.contains('open')) {
                event.preventDefault();
                closeOpenDate();
            }
        });

        prevBtn.addEventListener('click', function () {
            component.viewDate = new Date(component.viewDate.getFullYear(), component.viewDate.getMonth() - 1, 1);
            renderCalendar(component);
        });
        nextBtn.addEventListener('click', function () {
            component.viewDate = new Date(component.viewDate.getFullYear(), component.viewDate.getMonth() + 1, 1);
            renderCalendar(component);
        });
        clearBtn.addEventListener('click', function () {
            if (component.input.value) {
                component.input.value = '';
                component.input.dispatchEvent(new Event('input', { bubbles: true }));
                component.input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            syncFromInput(component);
            closeOpenDate();
            trigger.focus();
        });
        todayBtn.addEventListener('click', function () {
            const today = new Date();
            if (!isDateAllowed(component, today)) return;
            const iso = formatIsoDate(today);
            if (component.input.value !== iso) {
                component.input.value = iso;
                component.input.dispatchEvent(new Event('input', { bubbles: true }));
                component.input.dispatchEvent(new Event('change', { bubbles: true }));
            }
            syncFromInput(component);
            closeOpenDate();
            trigger.focus();
        });

        panel.addEventListener('keydown', function (event) {
            if (event.key === 'Escape') {
                event.preventDefault();
                closeOpenDate();
                trigger.focus();
            }
        });

        input.addEventListener('change', function () {
            syncFromInput(component);
        });
        input.addEventListener('input', function () {
            syncFromInput(component);
        });

        return component;
    }

    function refreshCustomDates(root) {
        const scope = root && root.querySelectorAll ? root : document;
        const inputs = Array.from(scope.querySelectorAll('input[type="date"]'));
        if (root instanceof HTMLInputElement && root.type === 'date') {
            inputs.unshift(root);
        }
        inputs.forEach(function (input) {
            const component = enhanceDateInput(input);
            if (component) syncFromInput(component);
        });
    }

    function getDateInputsFromRoot(root) {
        if (!root) return [];
        if (root instanceof HTMLInputElement && root.type === 'date') return [root];
        if (!(root instanceof Element) && root !== document) return [];
        const scope = root === document ? document : root;
        const inputs = Array.from(scope.querySelectorAll('input[type="date"]'));
        if (root instanceof Element && root.matches('input[type="date"]')) inputs.unshift(root);
        return inputs;
    }

    function destroyDateComponent(component) {
        if (!component) return;
        if (openComponent === component) closeOpenDate();
        if (component.input) {
            try { delete component.input.dataset[ENHANCED_MARK]; } catch (e) { /* no-op */ }
            component.input.classList.remove('nf-date-native');
        }
        if (component.panel && component.usePortal && component.panel.parentNode) {
            component.panel.parentNode.removeChild(component.panel);
        }
        if (component.input) components.delete(component.input);
    }

    function cleanupCustomDates(root) {
        const inputs = getDateInputsFromRoot(root || document);
        inputs.forEach(function (input) {
            const component = components.get(input);
            if (component) destroyDateComponent(component);
        });
    }

    function patchInputValueSetter() {
        if (valuePatched) return;
        valuePatched = true;
        // Intentionally no prototype patching.
        // Sync is handled by native events and mutation observers.
    }

    function initCustomDates() {
        patchInputValueSetter();
        refreshCustomDates(document);

        if (!domObserver && document.body) {
            domObserver = new MutationObserver(function (mutations) {
                try {
                    mutations.forEach(function (mutation) {
                        mutation.addedNodes.forEach(function (node) {
                            if (!(node instanceof Element)) return;
                            // Skip nodes created by this enhancer to avoid re-entrance
                            if (node.classList.contains('nf-date') || node.classList.contains('nf-date-panel')) return;
                            refreshCustomDates(node);
                        });
                        mutation.removedNodes.forEach(function (node) {
                            if (!(node instanceof Element)) return;
                            // Node was reparented (moved into wrapper), not truly removed
                            if (node.isConnected) return;
                            cleanupCustomDates(node);
                        });
                    });
                } finally {
                    // Discard mutations triggered by our own DOM changes
                    domObserver.takeRecords();
                }
            });
            domObserver.observe(document.body, { childList: true, subtree: true });
        }

        document.addEventListener('pointerdown', function (event) {
            if (!openComponent) return;
            const insideTrigger = openComponent.wrapper.contains(event.target);
            const insidePanel = openComponent.panel.contains(event.target);
            if (!insideTrigger && !insidePanel) {
                closeOpenDate();
            }
        }, true);

        document.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && openComponent) {
                const trigger = openComponent.trigger;
                closeOpenDate();
                trigger.focus();
            }
        });

        window.addEventListener('resize', function () {
            if (openComponent) {
                if (openComponent.usePortal) {
                    positionPortalPanel(openComponent);
                } else {
                    setPanelDirection(openComponent);
                }
            }
        });
        window.addEventListener('scroll', function () {
            if (!openComponent || !openComponent.usePortal) return;
            positionPortalPanel(openComponent);
        }, true);
    }

    window.refreshCustomDates = refreshCustomDates;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCustomDates, { once: true });
    } else {
        initCustomDates();
    }
})();
