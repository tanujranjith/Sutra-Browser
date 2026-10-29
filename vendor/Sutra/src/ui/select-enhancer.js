(function () {
    'use strict';

    const ENHANCED_MARK = 'nfSelectEnhanced';
    const components = new WeakMap();
    let openComponent = null;
    let domObserver = null;
    let valuePatched = false;

    function shouldEnhance(select) {
        if (!(select instanceof HTMLSelectElement)) return false;
        if (select.dataset.nativeSelect === 'true' || select.classList.contains('no-custom-select')) return false;
        if (select.multiple) return false;
        if (Number(select.size || 0) > 1) return false;
        // Author opted the element out by hiding it inline (e.g. legacy
        // controls retained for automation but replaced visually). Wrapping
        // would resurrect it as a visible trigger button.
        if (select.style.display === 'none') return false;
        return true;
    }

    function shouldUsePortal(select) {
        // Default to portal rendering everywhere so menus are never clipped by
        // parent overflow/stacking contexts. Allow per-control opt-out.
        return select.dataset.inlineMenu !== 'true';
    }

    function syncModalManager() {
        try {
            const manager = window.SutraModalManager;
            if (manager && typeof manager.sync === 'function') manager.sync();
            const dialog = openComponent && openComponent.select.closest('[aria-modal="true"]');
            if (dialog && openComponent.usePortal && openComponent.menu.classList.contains('is-open')) {
                // SutraModalManager isolates body-level portal branches while a
                // dialog is open. The currently opened select is part of that
                // dialog's interaction surface, so release only its temporary
                // isolation after the manager has synchronized the rest of the
                // page. The manager marker remains in place for clean restore.
                const menu = openComponent.menu;
                if (menu.getAttribute('data-sutra-modal-inert') === '1') {
                    menu.removeAttribute('aria-hidden');
                    if ('inert' in menu) menu.inert = false;
                }
            }
        } catch (error) {
            if (typeof window.SutraReportError === 'function') {
                window.SutraReportError(error, { where: 'select-enhancer.modal-sync' }, 'warning');
            }
        }
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
        return Math.max(13000, maxZ + 20);
    }

    function copySizingStyles(select, wrapper) {
        const props = [
            'width', 'minWidth', 'maxWidth',
            'margin', 'marginTop', 'marginRight', 'marginBottom', 'marginLeft',
            'flex', 'flexGrow', 'flexShrink', 'flexBasis', 'alignSelf'
        ];
        props.forEach((prop) => {
            if (select.style[prop]) {
                wrapper.style[prop] = select.style[prop];
            }
        });
    }

    function closeOpenSelect() {
        if (!openComponent) return;
        const component = openComponent;
        openComponent = null;
        component.wrapper.classList.remove('open');
        component.trigger.setAttribute('aria-expanded', 'false');
        component.menu.classList.remove('is-open');
        component.menu.classList.remove('nf-select-menu--open-up');
        syncModalManager();
    }

    function getSelectedOption(select) {
        const selectedIndex = select.selectedIndex >= 0 ? select.selectedIndex : 0;
        return select.options[selectedIndex] || null;
    }

    function updateTriggerLabel(component) {
        const option = getSelectedOption(component.select);
        component.label.textContent = option ? option.textContent : '';
    }

    function buildMenu(component) {
        const select = component.select;
        const menu = component.menu;
        menu.innerHTML = '';

        let lastGroup = null;
        const options = Array.from(select.options);
        options.forEach((option, index) => {
            const group = option.parentElement instanceof HTMLOptGroupElement ? option.parentElement.label : null;
            if (group && group !== lastGroup) {
                const groupLabel = document.createElement('div');
                groupLabel.className = 'nf-select-group';
                groupLabel.textContent = group;
                menu.appendChild(groupLabel);
                lastGroup = group;
            }

            const item = document.createElement('button');
            item.type = 'button';
            item.className = 'nf-select-option';
            item.textContent = option.textContent;
            item.setAttribute('role', 'option');
            item.setAttribute('data-index', String(index));
            item.setAttribute('aria-selected', option.selected ? 'true' : 'false');
            if (option.selected) item.classList.add('is-selected');
            if (option.disabled) {
                item.classList.add('is-disabled');
                item.disabled = true;
                item.setAttribute('aria-disabled', 'true');
            }

            item.addEventListener('click', function () {
                if (option.disabled) return;
                if (select.selectedIndex !== index) {
                    select.selectedIndex = index;
                    select.dispatchEvent(new Event('input', { bubbles: true }));
                    select.dispatchEvent(new Event('change', { bubbles: true }));
                } else {
                    updateTriggerLabel(component);
                }
                closeOpenSelect();
                component.trigger.focus();
            });

            menu.appendChild(item);
        });
    }

    function syncComponent(component, rebuildMenu) {
        if (rebuildMenu) buildMenu(component);
        updateTriggerLabel(component);
        component.trigger.disabled = component.select.disabled;
        component.wrapper.classList.toggle('is-disabled', component.select.disabled);
    }

    function getEnabledOptions(component) {
        return Array.from(component.menu.querySelectorAll('.nf-select-option:not(.is-disabled)'));
    }

    function focusOption(component, direction) {
        const options = getEnabledOptions(component);
        if (!options.length) return;

        const current = document.activeElement;
        let index = options.indexOf(current);
        if (index < 0) {
            index = options.findIndex((item) => item.classList.contains('is-selected'));
        }
        if (index < 0) index = 0;
        index += direction;
        if (index < 0) index = options.length - 1;
        if (index >= options.length) index = 0;
        options[index].focus();
    }

    function openSelect(component, focusSelected) {
        if (component.select.disabled) return;
        if (openComponent && openComponent !== component) closeOpenSelect();
        syncComponent(component, true);
        component.wrapper.classList.add('open');
        component.trigger.setAttribute('aria-expanded', 'true');
        component.menu.classList.add('is-open');
        if (component.usePortal) positionPortalMenu(component);
        openComponent = component;
        syncModalManager();

        if (focusSelected) {
            const selected = component.menu.querySelector('.nf-select-option.is-selected:not(.is-disabled)');
            const fallback = component.menu.querySelector('.nf-select-option:not(.is-disabled)');
            const target = selected || fallback;
            if (target) target.focus();
        }
    }

    function positionPortalMenu(component) {
        if (!component || !component.usePortal) return;

        const margin = 10;
        const gap = 8;
        const triggerRect = component.trigger.getBoundingClientRect();
        const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
        const viewportHeight = window.innerHeight || document.documentElement.clientHeight;

        const menu = component.menu;
        menu.style.zIndex = String(getPortalLayer(component.trigger));
        menu.style.minWidth = '0px';
        menu.style.width = Math.max(triggerRect.width, 190) + 'px';

        const computed = window.getComputedStyle(menu);
        const maxHeight = Number.parseFloat(computed.maxHeight) || 260;
        const fullHeight = Math.min(menu.scrollHeight || maxHeight, maxHeight);
        const availableBelow = viewportHeight - triggerRect.bottom - margin;
        const availableAbove = triggerRect.top - margin;
        const openUp = availableBelow < Math.min(180, fullHeight) && availableAbove > availableBelow;

        let top = openUp
            ? triggerRect.top - fullHeight - gap
            : triggerRect.bottom + gap;
        let left = triggerRect.left;

        const width = Number.parseFloat(menu.style.width) || triggerRect.width;
        if (left + width > viewportWidth - margin) left = viewportWidth - width - margin;
        if (left < margin) left = margin;
        if (top < margin) top = margin;
        if (!openUp && top + fullHeight > viewportHeight - margin) {
            top = Math.max(margin, viewportHeight - fullHeight - margin);
        }

        menu.style.left = left + 'px';
        menu.style.top = top + 'px';
        menu.classList.toggle('nf-select-menu--open-up', openUp);
    }

    function setupSizingClasses(select, wrapper) {
        if (
            select.classList.contains('modal-input') ||
            select.classList.contains('neumo-input') ||
            select.closest('.modal-body') ||
            select.closest('.theme-panel') ||
            select.closest('#chatbotPanel')
        ) {
            wrapper.classList.add('nf-select--full');
        }
        if (select.closest('.filter-group') || select.closest('.todo-option-group')) {
            wrapper.classList.add('nf-select--flex');
        }
        if (select.closest('.font-input-item')) {
            wrapper.style.minWidth = '140px';
        }
        if (
            select.closest('.hw-task-control') ||
            select.closest('.hw-inline-add') ||
            select.closest('#toolbarTimeControls') ||
            select.closest('#toolbar')
        ) {
            wrapper.classList.add('nf-select--compact');
        }
    }

    function enhanceSelect(select) {
        if (!shouldEnhance(select)) return null;
        if (select.dataset[ENHANCED_MARK] === 'true') {
            const existing = components.get(select);
            if (existing) syncComponent(existing, true);
            return existing || null;
        }

        const wrapper = document.createElement('div');
        wrapper.className = 'nf-select';
        setupSizingClasses(select, wrapper);
        copySizingStyles(select, wrapper);
        if (!wrapper.style.width && wrapper.classList.contains('nf-select--full')) {
            wrapper.style.width = '100%';
        }

        select.parentNode.insertBefore(wrapper, select);
        wrapper.appendChild(select);
        select.classList.add('nf-select-native');
        select.dataset[ENHANCED_MARK] = 'true';

        const trigger = document.createElement('button');
        trigger.type = 'button';
        trigger.className = 'nf-select-trigger';
        trigger.setAttribute('aria-haspopup', 'listbox');
        trigger.setAttribute('aria-expanded', 'false');
        if (select.id) trigger.setAttribute('aria-controls', select.id + '-menu');

        const label = document.createElement('span');
        label.className = 'nf-select-label';
        trigger.appendChild(label);

        const chevron = document.createElement('span');
        chevron.className = 'nf-select-chevron';
        chevron.setAttribute('aria-hidden', 'true');
        trigger.appendChild(chevron);

        const menu = document.createElement('div');
        menu.className = 'nf-select-menu';
        menu.setAttribute('role', 'listbox');
        if (select.id) menu.id = select.id + '-menu';
        const usePortal = shouldUsePortal(select);
        if (usePortal) menu.classList.add('nf-select-menu--portal');
        menu.__sutraSelectOwner = select;

        wrapper.appendChild(trigger);
        if (usePortal) {
            document.body.appendChild(menu);
        } else {
            wrapper.appendChild(menu);
        }

        const component = {
            select,
            wrapper,
            trigger,
            label,
            menu,
            usePortal,
            selectObserver: null
        };

        components.set(select, component);
        syncComponent(component, true);

        trigger.addEventListener('click', function () {
            if (wrapper.classList.contains('open')) {
                closeOpenSelect();
                return;
            }
            openSelect(component, false);
        });

        trigger.addEventListener('keydown', function (event) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                if (!wrapper.classList.contains('open')) openSelect(component, true);
                else focusOption(component, 1);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                if (!wrapper.classList.contains('open')) openSelect(component, true);
                else focusOption(component, -1);
                return;
            }
            if (event.key === 'Enter' || event.key === ' ') {
                event.preventDefault();
                if (wrapper.classList.contains('open')) closeOpenSelect();
                else openSelect(component, true);
                return;
            }
            if (event.key === 'Escape' && wrapper.classList.contains('open')) {
                event.preventDefault();
                closeOpenSelect();
            }
        });

        menu.addEventListener('keydown', function (event) {
            if (event.key === 'ArrowDown') {
                event.preventDefault();
                focusOption(component, 1);
                return;
            }
            if (event.key === 'ArrowUp') {
                event.preventDefault();
                focusOption(component, -1);
                return;
            }
            if (event.key === 'Escape') {
                event.preventDefault();
                closeOpenSelect();
                trigger.focus();
                return;
            }
            if (event.key === 'Tab') {
                closeOpenSelect();
            }
        });

        select.addEventListener('change', function () {
            syncComponent(component, false);
        });
        select.addEventListener('input', function () {
            syncComponent(component, false);
        });

        const selectObserver = new MutationObserver(function () {
            syncComponent(component, true);
        });
        selectObserver.observe(select, {
            childList: true,
            subtree: true,
            attributes: true,
            attributeFilter: ['disabled', 'label', 'selected']
        });
        component.selectObserver = selectObserver;

        return component;
    }

    function getSelectsFromRoot(root) {
        if (!root) return [];
        if (root instanceof HTMLSelectElement) return [root];
        if (!(root instanceof Element) && root !== document) return [];

        const scope = root === document ? document : root;
        const list = Array.from(scope.querySelectorAll('select'));
        if (root instanceof Element && root.matches('select')) list.unshift(root);
        return list;
    }

    function destroySelectComponent(component) {
        if (!component) return;
        if (openComponent === component) closeOpenSelect();
        if (component.selectObserver) {
            try { component.selectObserver.disconnect(); } catch (error) { /* no-op */ }
            component.selectObserver = null;
        }
        if (component.select) {
            try { delete component.select.dataset[ENHANCED_MARK]; } catch (error) { /* no-op */ }
            component.select.classList.remove('nf-select-native');
        }
        if (component.menu && component.usePortal && component.menu.parentNode) {
            component.menu.parentNode.removeChild(component.menu);
        }
        if (component.select) {
            components.delete(component.select);
        }
    }

    function cleanupCustomSelects(root) {
        const selects = getSelectsFromRoot(root || document);
        selects.forEach((select) => {
            const component = components.get(select);
            if (component) destroySelectComponent(component);
        });
    }

    function refreshCustomSelects(root) {
        const selects = getSelectsFromRoot(root || document);
        selects.forEach((select) => {
            const component = enhanceSelect(select);
            if (component) syncComponent(component, true);
        });
    }

    function observeDom() {
        if (domObserver || !document.body) return;
        domObserver = new MutationObserver(function (mutations) {
            try {
                mutations.forEach((mutation) => {
                    mutation.addedNodes.forEach((node) => {
                        if (!(node instanceof Element)) return;
                        // Skip nodes created by this enhancer to avoid re-entrance
                        if (node.classList.contains('nf-select') || node.classList.contains('nf-select-menu')) return;
                        refreshCustomSelects(node);
                    });
                    mutation.removedNodes.forEach((node) => {
                        if (!(node instanceof Element)) return;
                        // Node was reparented (moved into wrapper), not truly removed
                        if (node.isConnected) return;
                        cleanupCustomSelects(node);
                    });
                });
            } finally {
                // Discard mutations triggered by our own DOM changes
                domObserver.takeRecords();
            }
        });
        domObserver.observe(document.body, { childList: true, subtree: true });
    }

    function patchSelectSetters() {
        if (valuePatched) return;
        valuePatched = true;
        // Intentionally no prototype patching.
        // Sync is handled by native events and mutation observers.
    }

    function initCustomSelects() {
        patchSelectSetters();
        refreshCustomSelects(document);
        observeDom();

        document.addEventListener('pointerdown', function (event) {
            if (!openComponent) return;
            const isInsideTrigger = openComponent.wrapper.contains(event.target);
            const isInsideMenu = openComponent.menu.contains(event.target);
            if (!isInsideTrigger && !isInsideMenu) {
                closeOpenSelect();
            }
        }, true);

        window.addEventListener('keydown', function (event) {
            if (event.key === 'Escape' && openComponent) {
                const trigger = openComponent.trigger;
                event.preventDefault();
                event.stopPropagation();
                closeOpenSelect();
                trigger.focus();
            }
        }, true);

        window.addEventListener('resize', closeOpenSelect);
        window.addEventListener('scroll', function () {
            if (!openComponent) return;
            if (openComponent.usePortal) {
                positionPortalMenu(openComponent);
            }
        }, true);
    }

    window.refreshCustomSelects = refreshCustomSelects;

    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', initCustomSelects, { once: true });
    } else {
        initCustomSelects();
    }
})();
