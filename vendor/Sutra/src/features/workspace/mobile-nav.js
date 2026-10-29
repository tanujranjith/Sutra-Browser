/*
 * mobile-nav.js — native-feel mobile navigation (window.SutraMobileNav).
 *
 * Adds, on small screens only:
 *   - a fixed bottom tab bar built from the existing top `.view-tab` buttons
 *     (so it always reflects the enabled views / Sutra Mode),
 *   - swipe left/right to move between adjacent views,
 *   - pull-to-refresh at the top of a view to re-render it,
 *   - light haptic feedback (navigator.vibrate) on tap.
 *
 * It is deliberately decoupled from app.js: taps and gestures dispatch a click
 * on the corresponding `.view-tab`, reusing the app's wired view-switch handler,
 * and it stays in sync via the `noteflow:view-changed` event app.js dispatches.
 * Zero dependencies; respects prefers-reduced-motion (no vibration then).
 */
(function () {
  'use strict';
  if (typeof document === 'undefined') return;

  var ICONS = {
    today: 'fa-house', timeline: 'fa-calendar-days', notes: 'fa-pen-to-square',
    homework: 'fa-book-open', apstudy: 'fa-graduation-cap', collegeapp: 'fa-university',
    college: 'fa-university', life: 'fa-seedling', business: 'fa-briefcase',
    courses: 'fa-book', alldue: 'fa-bell', assistantview: 'fa-robot',
    settings: 'fa-gear', progress: 'fa-chart-line', review: 'fa-layer-group'
  };
  var MAX_ITEMS = 5;
  var navEl = null;
  var moreOverlay = null;
  var morePanel = null;
  var moreActions = null;
  var moreList = null;
  var moreLastFocus = null;
  var moreHistoryActive = false;
  var moreCloseTimer = null;
  var morePendingCloseOptions = null;
  var notificationBadgeObserver = null;
  var sidebarReturnFocus = null;

  function reducedMotion() {
    try { return window.matchMedia && window.matchMedia('(prefers-reduced-motion: reduce)').matches; }
    catch (e) { return false; }
  }
  function isMobile() {
    try { return window.matchMedia && window.matchMedia('(max-width: 640px)').matches; }
    catch (e) { return false; }
  }
  function vibrate() {
    try { if (!reducedMotion() && navigator.vibrate) navigator.vibrate(8); } catch (e) { /* nc */ }
  }
  function activeView() { return (document.body && document.body.dataset.view) || 'today'; }

  function iconForTab(tab, view) {
    if (ICONS[view]) return ICONS[view];
    var sourceIcon = tab && tab.querySelector ? tab.querySelector('i') : null;
    var sourceClass = sourceIcon
      ? Array.prototype.find.call(sourceIcon.classList, function (name) { return name.indexOf('fa-') === 0; })
      : '';
    return sourceClass || 'fa-star';
  }

  function enabledTabs() {
    return Array.prototype.slice.call(document.querySelectorAll('.view-tab'))
      .filter(function (t) { return t && !t.hidden && t.getAttribute('aria-hidden') !== 'true'; });
  }
  function mobileTabs() {
    // The overflow menu contains duplicate .view-tab elements. Deduplicate and
    // put the student daily loop first so Homework never gets pushed behind
    // business/advanced views on a phone.
    var seen = {};
    var tabs = enabledTabs().filter(function (tab) {
      var view = tab.getAttribute('data-view');
      if (!view || seen[view]) return false;
      seen[view] = true;
      return true;
    });
    var order = ['today', 'homework', 'notes', 'timeline', 'apstudy', 'settings'];
    tabs.sort(function (a, b) {
      var ai = order.indexOf(a.getAttribute('data-view'));
      var bi = order.indexOf(b.getAttribute('data-view'));
      if (ai === -1) ai = order.length + 1;
      if (bi === -1) bi = order.length + 1;
      return ai - bi;
    });
    return tabs;
  }
  function shortLabel(tab) {
    var txt = (tab.textContent || '').replace(/\s+/g, ' ').trim();
    return txt.length > 9 ? txt.slice(0, 8).trim() : txt;
  }
  function clickTabForView(view) {
    var tab = document.querySelector('.view-tab[data-view="' + view + '"]');
    if (tab) { vibrate(); tab.click(); }
  }

  function unreadNotificationCount() {
    var badge = document.querySelector('#notifBellBtn .notif-bell-badge');
    return Math.max(0, Number(badge && badge.getAttribute('data-count')) || 0);
  }

  function syncNotificationBadges() {
    var unread = unreadNotificationCount();
    var label = unread > 99 ? '99+' : String(unread || '');
    var navMore = navEl && navEl.querySelector('[data-bn-view="__more"]');
    var navBadge = navMore && navMore.querySelector('.sutra-mobile-nav-badge');
    if (navBadge) {
      navBadge.textContent = label;
      navBadge.hidden = unread === 0;
    }
    if (navMore) {
      navMore.setAttribute('aria-label', unread
        ? 'More, ' + unread + ' unread notification' + (unread === 1 ? '' : 's')
        : 'More');
    }
    var action = moreActions && moreActions.querySelector('[data-mobile-more-action="notifications"]');
    var actionBadge = action && action.querySelector('.sutra-mobile-action-badge');
    if (actionBadge) {
      actionBadge.textContent = label;
      actionBadge.hidden = unread === 0;
    }
    if (action) {
      action.setAttribute('aria-label', unread
        ? 'Notifications, ' + unread + ' unread'
        : 'Notifications');
    }
  }

  function observeNotificationBadge() {
    if (notificationBadgeObserver) return;
    var badge = document.querySelector('#notifBellBtn .notif-bell-badge');
    if (!badge || typeof MutationObserver !== 'function') return;
    notificationBadgeObserver = new MutationObserver(syncNotificationBadges);
    notificationBadgeObserver.observe(badge, {
      attributes: true,
      attributeFilter: ['data-count'],
      childList: true,
      characterData: true,
      subtree: true
    });
    syncNotificationBadges();
  }

  function focusableWithin(root) {
    if (!root) return [];
    return Array.prototype.slice.call(root.querySelectorAll(
      'button:not([disabled]), a[href], input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )).filter(function (node) { return node.offsetParent !== null && !node.hidden; });
  }

  function renderMoreList() {
    if (!moreList) return;
    var current = activeView();
    moreList.replaceChildren();
    mobileTabs().forEach(function (tab) {
      var view = tab.getAttribute('data-view');
      var button = document.createElement('button');
      button.type = 'button';
      button.className = 'sutra-mobile-more-item' + (view === current ? ' active' : '');
      button.setAttribute('data-mobile-more-view', view);
      if (view === current) button.setAttribute('aria-current', 'page');
      var icon = document.createElement('i');
      icon.className = 'fas ' + iconForTab(tab, view);
      icon.setAttribute('aria-hidden', 'true');
      var label = document.createElement('span');
      label.textContent = (tab.textContent || view).replace(/\s+/g, ' ').trim();
      button.appendChild(icon);
      button.appendChild(label);
      moreList.appendChild(button);
    });
  }

  function utilityButton(action, iconName, labelText) {
    var button = document.createElement('button');
    button.type = 'button';
    button.className = 'sutra-mobile-more-action';
    button.setAttribute('data-mobile-more-action', action);
    var icon = document.createElement('i');
    icon.className = 'fas ' + iconName;
    icon.setAttribute('aria-hidden', 'true');
    var label = document.createElement('span');
    label.textContent = labelText;
    button.appendChild(icon);
    button.appendChild(label);
    if (action === 'notifications') {
      var badge = document.createElement('span');
      badge.className = 'sutra-mobile-action-badge';
      badge.hidden = true;
      badge.setAttribute('aria-hidden', 'true');
      button.appendChild(badge);
    }
    return button;
  }

  function renderMoreActions() {
    if (!moreActions) return;
    moreActions.replaceChildren();
    if (activeView() === 'notes') {
      moreActions.appendChild(utilityButton('pages', 'fa-bars', 'Pages'));
    }
    if (document.getElementById('customTabAddBtn')) {
      moreActions.appendChild(utilityButton('new-dashboard', 'fa-plus', 'New dashboard'));
    }
    moreActions.appendChild(utilityButton('notifications', 'fa-bell', 'Notifications'));
    syncNotificationBadges();
  }

  function runMoreAction(action) {
    closeMore({ restoreFocus: false, afterClose: function () {
      // History navigation can rerender the nav. Resolve the live trigger only
      // after the sheet is actually closed, not before a guessed delay.
      var moreTrigger = navEl && navEl.querySelector('[data-bn-view="__more"]');
      if (moreTrigger && typeof moreTrigger.focus === 'function') moreTrigger.focus();
      if (action === 'pages') {
        var sidebarToggle = document.getElementById('sidebarToggle');
        if (sidebarToggle) {
          sidebarReturnFocus = moreTrigger;
          sidebarToggle.click();
        }
      } else if (action === 'new-dashboard') {
        var addButton = document.getElementById('customTabAddBtn');
        if (addButton) addButton.click();
      } else if (action === 'notifications') {
        if (window.SutraNotifications && typeof window.SutraNotifications.openPanel === 'function') {
          window.SutraNotifications.openPanel();
        } else {
          var bell = document.getElementById('notifBellBtn');
          if (bell) bell.click();
        }
      }
    } });
  }

  function finishCloseMore(options) {
    if (!moreOverlay || moreOverlay.hidden) return;
    if (moreCloseTimer) window.clearTimeout(moreCloseTimer);
    moreOverlay.classList.remove('open');
    document.body.classList.remove('mobile-more-open');
    moreCloseTimer = window.setTimeout(function () {
      moreOverlay.hidden = true;
      moreOverlay.setAttribute('aria-hidden', 'true');
      moreCloseTimer = null;
      if (options && typeof options.afterClose === 'function') options.afterClose();
    }, reducedMotion() ? 0 : 180);
    if (!options || options.restoreFocus !== false) {
      var target = moreLastFocus;
      window.requestAnimationFrame(function () {
        if (!(target && document.contains(target))) {
          target = navEl && navEl.querySelector('[data-bn-view="__more"]');
        }
        if (target && typeof target.focus === 'function' && document.contains(target)) target.focus();
      });
    }
    moreLastFocus = null;
  }

  function closeMore(options) {
    if (!moreOverlay || moreOverlay.hidden) return;
    if (!options || options.fromHistory !== true) {
      if (moreHistoryActive && history.state && history.state.sutraMobileMore === true) {
        moreHistoryActive = false;
        morePendingCloseOptions = options || null;
        history.back();
        return;
      }
    }
    moreHistoryActive = false;
    if (options && options.fromHistory === true && morePendingCloseOptions) {
      options = morePendingCloseOptions;
    }
    morePendingCloseOptions = null;
    finishCloseMore(options);
  }

  function openMore(trigger) {
    if (!moreOverlay || !isMobile()) return;
    morePendingCloseOptions = null;
    if (moreCloseTimer) { window.clearTimeout(moreCloseTimer); moreCloseTimer = null; }
    moreLastFocus = trigger || document.activeElement;
    renderMoreActions();
    renderMoreList();
    moreOverlay.hidden = false;
    moreOverlay.setAttribute('aria-hidden', 'false');
    document.body.classList.add('mobile-more-open');
    window.requestAnimationFrame(function () {
      moreOverlay.classList.add('open');
      var active = moreList && moreList.querySelector('[aria-current="page"]');
      var first = active || (morePanel && morePanel.querySelector('button'));
      if (first) first.focus();
    });
    try {
      var state = Object.assign({}, history.state || {}, { sutraMobileMore: true });
      history.pushState(state, '', location.href);
      moreHistoryActive = true;
    } catch (e) { moreHistoryActive = false; }
  }

  function buildMoreSheet() {
    if (moreOverlay || !document.body) return;
    moreOverlay = document.createElement('div');
    moreOverlay.id = 'sutraMobileMoreOverlay';
    moreOverlay.className = 'sutra-mobile-more-overlay';
    moreOverlay.hidden = true;
    moreOverlay.setAttribute('aria-hidden', 'true');

    morePanel = document.createElement('section');
    morePanel.className = 'sutra-mobile-more-sheet';
    morePanel.setAttribute('role', 'dialog');
    morePanel.setAttribute('aria-modal', 'true');
    morePanel.setAttribute('aria-labelledby', 'sutraMobileMoreTitle');

    var header = document.createElement('header');
    header.className = 'sutra-mobile-more-header';
    var heading = document.createElement('h2');
    heading.id = 'sutraMobileMoreTitle';
    heading.textContent = 'All sections';
    var close = document.createElement('button');
    close.type = 'button';
    close.className = 'sutra-mobile-more-close';
    close.setAttribute('aria-label', 'Close all sections');
    close.textContent = '\u00d7';
    header.appendChild(heading);
    header.appendChild(close);

    moreList = document.createElement('div');
    moreList.className = 'sutra-mobile-more-list';
    moreList.setAttribute('role', 'navigation');
    moreList.setAttribute('aria-label', 'All Sutra sections');
    moreActions = document.createElement('div');
    moreActions.className = 'sutra-mobile-more-actions';
    moreActions.setAttribute('role', 'group');
    moreActions.setAttribute('aria-label', 'Workspace actions');
    morePanel.appendChild(header);
    morePanel.appendChild(moreActions);
    morePanel.appendChild(moreList);
    moreOverlay.appendChild(morePanel);
    document.body.appendChild(moreOverlay);

    close.addEventListener('click', function () { closeMore(); });
    moreOverlay.addEventListener('pointerdown', function (event) {
      if (event.target === moreOverlay) closeMore();
    });
    moreList.addEventListener('click', function (event) {
      var button = event.target.closest('[data-mobile-more-view]');
      if (!button) return;
      var view = button.getAttribute('data-mobile-more-view');
      if (moreHistoryActive && history.state && history.state.sutraMobileMore === true) {
        moreLastFocus = null;
        window.addEventListener('popstate', function navigateAfterSheetHistory() {
          clickTabForView(view);
        }, { once: true });
        closeMore({ restoreFocus: false });
        return;
      }
      clickTabForView(view);
      closeMore({ restoreFocus: false });
    });
    moreActions.addEventListener('click', function (event) {
      var button = event.target.closest('[data-mobile-more-action]');
      if (!button) return;
      vibrate();
      runMoreAction(button.getAttribute('data-mobile-more-action'));
    });
    morePanel.addEventListener('keydown', function (event) {
      if (event.key === 'Escape') {
        event.preventDefault();
        closeMore();
        return;
      }
      if (event.key !== 'Tab') return;
      var items = focusableWithin(morePanel);
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    });
    window.addEventListener('popstate', function () {
      if (moreOverlay && !moreOverlay.hidden) closeMore({ fromHistory: true, restoreFocus: true });
    });
  }

  function build() {
    if (navEl || !document.body) return;
    navEl = document.createElement('nav');
    navEl.id = 'sutraBottomNav';
    navEl.className = 'sutra-bottom-nav';
    navEl.setAttribute('aria-label', 'Primary navigation');
    document.body.appendChild(navEl);
    navEl.addEventListener('click', function (e) {
      var action = e.target.closest('[data-bn-action]');
      if (action && action.getAttribute('data-bn-action') === 'capture') {
        vibrate();
        try {
          if (window.SutraStudentLoopActions && typeof window.SutraStudentLoopActions.openCapture === 'function') window.SutraStudentLoopActions.openCapture();
          else if (typeof window.openQuickCaptureModal === 'function') window.openQuickCaptureModal('');
        } catch (err) { /* non-critical */ }
        return;
      }
      var btn = e.target.closest('[data-bn-view]');
      if (!btn) return;
      var v = btn.getAttribute('data-bn-view');
      if (v === '__more') {
        vibrate();
        openMore(btn);
      } else {
        clickTabForView(v);
      }
    });
    buildMoreSheet();
    render();
    observeNotificationBadge();
    window.addEventListener('noteflow:view-changed', render);
  }

  function setupBreakpointCleanup() {
    if (!window.matchMedia) return;
    var query = window.matchMedia('(max-width: 640px)');
    function syncBreakpoint(event) {
      if (event.matches || !moreOverlay || moreOverlay.hidden) return;
      // The sheet is a phone-only modal. Clear its DOM, body-scroll, and
      // history state when desktop navigation takes over so returning to a
      // narrow viewport cannot resurrect a stale dialog.
      closeMore();
    }
    if (typeof query.addEventListener === 'function') query.addEventListener('change', syncBreakpoint);
    else if (typeof query.addListener === 'function') query.addListener(syncBreakpoint);
  }

  function render() {
    if (!navEl) return;
    var tabs = mobileTabs();
    // Reserve one central, always-present slot for Quick Capture. Three views
    // plus More (when needed) keep every target comfortably tappable.
    var overflow = tabs.length > (MAX_ITEMS - 1);
    var items = overflow ? tabs.slice(0, MAX_ITEMS - 2) : tabs.slice(0, MAX_ITEMS - 1);
    var current = activeView();
    navEl.replaceChildren();
    items.forEach(function (tab) {
      var view = tab.getAttribute('data-view');
      var b = document.createElement('button');
      b.type = 'button';
      b.className = 'sutra-bn-item' + (view === current ? ' active' : '');
      b.setAttribute('data-bn-view', view);
      b.setAttribute('aria-label', (tab.textContent || view).trim());
      var i = document.createElement('i');
      i.className = 'fas ' + iconForTab(tab, view);
      i.setAttribute('aria-hidden', 'true');
      var span = document.createElement('span');
      span.textContent = shortLabel(tab);
      b.appendChild(i);
      b.appendChild(span);
      navEl.appendChild(b);
    });
    var capture = document.createElement('button');
    capture.type = 'button';
    capture.className = 'sutra-bn-capture';
    capture.setAttribute('data-bn-action', 'capture');
    capture.setAttribute('aria-label', 'Quick Capture');
    var ci = document.createElement('i');
    ci.className = 'fas fa-bolt';
    ci.setAttribute('aria-hidden', 'true');
    var cs = document.createElement('span');
    cs.textContent = 'Capture';
    capture.appendChild(ci);
    capture.appendChild(cs);
    // Keep the central action between the two most common student destinations.
    var insertBefore = navEl.children.length > 2 ? navEl.children[2] : null;
    if (insertBefore) navEl.insertBefore(capture, insertBefore);
    else navEl.appendChild(capture);
    if (overflow) {
      var more = document.createElement('button');
      more.type = 'button';
      more.className = 'sutra-bn-item' + (items.some(function (tab) { return tab.getAttribute('data-view') === current; }) ? '' : ' active');
      more.setAttribute('data-bn-view', '__more');
      more.setAttribute('aria-label', 'More views');
      var mi = document.createElement('i');
      mi.className = 'fas fa-ellipsis';
      mi.setAttribute('aria-hidden', 'true');
      var ms = document.createElement('span');
      ms.textContent = 'More';
      more.appendChild(mi);
      more.appendChild(ms);
      var badge = document.createElement('span');
      badge.className = 'sutra-mobile-nav-badge';
      badge.hidden = true;
      badge.setAttribute('aria-hidden', 'true');
      more.appendChild(badge);
      navEl.appendChild(more);
    }
    syncNotificationBadges();
    if (moreOverlay && !moreOverlay.hidden) {
      renderMoreActions();
      renderMoreList();
    }
  }

  function setupSidebarDrawer() {
    var sidebar = document.getElementById('sidebar');
    var toggle = document.getElementById('sidebarToggle');
    var overlay = document.getElementById('sidebarOverlay');
    if (!sidebar || !toggle) return;
    var wasOpen = false;
    var restoreFocus = false;

    toggle.setAttribute('aria-controls', 'sidebar');
    function open() { return isMobile() && !sidebar.classList.contains('collapsed'); }
    function sync() {
      var nowOpen = open();
      var toggleLabel = nowOpen ? 'Close notes list' : 'Open notes list';
      toggle.setAttribute('aria-expanded', nowOpen ? 'true' : 'false');
      toggle.setAttribute('aria-label', toggleLabel);
      toggle.setAttribute('title', toggleLabel);
      if (isMobile()) {
        sidebar.setAttribute('aria-hidden', nowOpen ? 'false' : 'true');
        sidebar.setAttribute('aria-modal', nowOpen ? 'true' : 'false');
        if (nowOpen) sidebar.setAttribute('role', 'dialog');
        else sidebar.removeAttribute('role');
      } else {
        sidebar.removeAttribute('aria-hidden');
        sidebar.removeAttribute('aria-modal');
        sidebar.removeAttribute('role');
      }
      if (nowOpen && !wasOpen) {
        window.requestAnimationFrame(function () {
          var items = focusableWithin(sidebar);
          if (items.length) items[0].focus();
        });
      } else if (!nowOpen && wasOpen && restoreFocus) {
        var focusTarget = sidebarReturnFocus || toggle;
        window.requestAnimationFrame(function () {
          if (!(focusTarget && document.contains(focusTarget))) {
            focusTarget = navEl && navEl.querySelector('[data-bn-view="__more"]');
          }
          if (focusTarget && typeof focusTarget.focus === 'function' && document.contains(focusTarget)) {
            focusTarget.focus();
          }
        });
      }
      if (!nowOpen) {
        restoreFocus = false;
        sidebarReturnFocus = null;
      }
      wasOpen = nowOpen;
    }

    toggle.addEventListener('pointerdown', function () {
      if (open()) {
        restoreFocus = true;
        if (!sidebarReturnFocus) sidebarReturnFocus = toggle;
      }
    }, true);
    if (overlay) overlay.addEventListener('pointerdown', function () {
      restoreFocus = true;
      if (!sidebarReturnFocus) sidebarReturnFocus = navEl && navEl.querySelector('[data-bn-view="__more"]');
    }, true);
    document.addEventListener('keydown', function (event) {
      if (!open()) return;
      if (event.key === 'Escape') {
        event.preventDefault();
        restoreFocus = true;
        toggle.click();
        return;
      }
      if (event.key !== 'Tab') return;
      var items = focusableWithin(sidebar);
      if (!items.length) return;
      var first = items[0];
      var last = items[items.length - 1];
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault(); last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault(); first.focus();
      }
    }, true);
    new MutationObserver(sync).observe(sidebar, { attributes: true, attributeFilter: ['class'] });
    window.addEventListener('resize', sync);
    sync();
  }

  function moveView(dir) {
    if (!isMobile()) return;
    var tabs = mobileTabs();
    var cur = activeView();
    var idx = tabs.findIndex(function (t) { return t.getAttribute('data-view') === cur; });
    if (idx === -1) return;
    var next = idx + dir;
    if (next < 0 || next >= tabs.length) return;
    clickTabForView(tabs[next].getAttribute('data-view'));
  }

  function refresh() {
    if (!isMobile()) return;
    vibrate();
    var tab = document.querySelector('.view-tab[data-view="' + activeView() + '"]');
    if (tab) tab.click(); // re-trigger the active view's render
    try { if (typeof window.showToast === 'function') window.showToast('Refreshed'); } catch (e) { /* nc */ }
  }

  function setupGestures() {
    var sx = 0; var sy = 0; var tracking = false; var pulling = false;
    function scroller() { return document.scrollingElement || document.documentElement; }
    document.addEventListener('touchstart', function (e) {
      if (!e.touches || e.touches.length !== 1) { tracking = false; return; }
      var t = e.target;
      // Don't hijack gestures inside editors, modals, inputs, or the nav itself.
      if (t.closest && t.closest('.modal, #editor, .canvas-editor, input, textarea, select, [contenteditable="true"], .sutra-bottom-nav, .review-bigcard')) { tracking = false; return; }
      sx = e.touches[0].clientX; sy = e.touches[0].clientY; tracking = true; pulling = false;
    }, { passive: true });
    document.addEventListener('touchmove', function (e) {
      if (!tracking || !e.touches || e.touches.length !== 1) return;
      var dx = e.touches[0].clientX - sx;
      var dy = e.touches[0].clientY - sy;
      if (dy > 70 && Math.abs(dy) > Math.abs(dx) * 2 && (scroller().scrollTop || 0) <= 0) pulling = true;
    }, { passive: true });
    document.addEventListener('touchend', function (e) {
      if (!tracking) return;
      tracking = false;
      var ch = (e.changedTouches && e.changedTouches[0]) || null;
      if (!ch) return;
      var dx = ch.clientX - sx;
      var dy = ch.clientY - sy;
      if (pulling) { pulling = false; refresh(); return; }
      if (Math.abs(dx) > 80 && Math.abs(dx) > Math.abs(dy) * 1.6) moveView(dx < 0 ? 1 : -1);
    }, { passive: true });
  }

  function init() {
    build();
    setupBreakpointCleanup();
    setupGestures();
    setupSidebarDrawer();
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();

  window.SutraMobileNav = { render: render };
})();
