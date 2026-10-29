/*
 * Sidebar page actions - desktop overflow menu.
 *
 * The core sidebar already renders the canonical action icons and owns their
 * handlers. This small DOM layer gives desktop the same compact overflow
 * affordance as mobile without duplicating page mutations outside app.js.
 */
(function () {
    'use strict';

    var menu = null;
    var activeToggle = null;

    function isDesktopOverflowMode() {
        return window.innerWidth > 768;
    }

    function closeMenu(options) {
        options = options || {};
        if (!menu) return;
        menu.classList.remove('open');
        menu.hidden = true;
        if (activeToggle) activeToggle.setAttribute('aria-expanded', 'false');
        var focusTarget = options.restoreFocus ? activeToggle : null;
        activeToggle = null;
        if (focusTarget && typeof focusTarget.focus === 'function') focusTarget.focus();
    }

    function ensureMenu() {
        if (menu) return menu;
        menu = document.createElement('div');
        menu.id = 'sidebarPageActionsMenu';
        menu.className = 'sidebar-page-actions-menu';
        menu.hidden = true;
        menu.setAttribute('role', 'menu');
        menu.setAttribute('aria-label', 'Page actions');
        document.body.appendChild(menu);
        return menu;
    }

    function positionMenu(toggle) {
        var toggleBox = toggle.getBoundingClientRect();
        var menuBox = menu.getBoundingClientRect();
        var gap = 8;
        var top = Math.max(gap, Math.min(toggleBox.top, window.innerHeight - menuBox.height - gap));
        var left = toggleBox.right + gap;
        if (left + menuBox.width > window.innerWidth - gap) {
            left = toggleBox.left - menuBox.width - gap;
        }
        left = Math.max(gap, Math.min(left, window.innerWidth - menuBox.width - gap));
        menu.style.top = Math.round(top) + 'px';
        menu.style.left = Math.round(left) + 'px';
    }

    function addActionButton(source) {
        var button = document.createElement('button');
        button.type = 'button';
        button.className = 'sidebar-page-actions-menu-item';
        button.setAttribute('role', 'menuitem');
        button.setAttribute('aria-label', source.title);

        var icon = document.createElement('i');
        icon.className = source.className;
        icon.setAttribute('aria-hidden', 'true');
        var label = document.createElement('span');
        label.textContent = source.title;
        button.append(icon, label);

        button.addEventListener('click', function (event) {
            event.preventDefault();
            event.stopPropagation();
            closeMenu();
            source.element.click();
        });
        menu.appendChild(button);
    }

    function openMenu(toggle) {
        var row = toggle.closest('.page-item');
        if (!row) return;
        if (activeToggle === toggle && menu && !menu.hidden) {
            closeMenu({ restoreFocus: true });
            return;
        }

        closeMenu();
        ensureMenu();
        menu.replaceChildren();
        Array.prototype.forEach.call(row.querySelectorAll('.page-item-icons > i[title]'), function (icon) {
            addActionButton({
                element: icon,
                className: icon.className,
                title: icon.title
            });
        });

        if (!menu.childElementCount) return;
        activeToggle = toggle;
        toggle.setAttribute('aria-expanded', 'true');
        toggle.setAttribute('aria-controls', menu.id);
        menu.hidden = false;
        menu.classList.add('open');
        positionMenu(toggle);
        var firstAction = menu.querySelector('button');
        if (firstAction) firstAction.focus();
    }

    document.addEventListener('click', function (event) {
        if (!isDesktopOverflowMode()) {
            closeMenu();
            return;
        }
        var toggle = event.target && event.target.closest ? event.target.closest('.page-item-actions-toggle') : null;
        if (toggle) {
            // app.js reserves this button for mobile. Take ownership only for
            // desktop, keeping its existing mobile sheet untouched.
            event.preventDefault();
            event.stopImmediatePropagation();
            openMenu(toggle);
            return;
        }
        if (menu && !menu.hidden && !(event.target && menu.contains(event.target))) closeMenu();
    }, true);

    document.addEventListener('keydown', function (event) {
        if (event.key === 'Escape' && menu && !menu.hidden) {
            event.preventDefault();
            closeMenu({ restoreFocus: true });
        }
    });

    window.addEventListener('resize', function () { closeMenu(); });
    window.addEventListener('scroll', function () { closeMenu(); }, true);
}());
