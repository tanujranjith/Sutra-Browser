/*
 * primary-nav-visibility.js — keep enabled workspace destinations visible on
 * wide desktop screens while preserving the canonical app.js tab handlers.
 *
 * app.js still owns feature gating and the overflow menu. This small bridge
 * only removes the old progressive-nav presentation on wide desktop so the
 * existing tabs are available without an extra More click. If the row is too
 * wide, it becomes horizontally scrollable instead of hiding destinations.
 */
(function () {
  'use strict';

  if (typeof document === 'undefined') return;

  var WIDE_DESKTOP_MIN = 1441;
  var scheduled = false;

  function isWideDesktop() {
    return (window.innerWidth || document.documentElement.clientWidth || 0) >= WIDE_DESKTOP_MIN;
  }

  function restoreDefaultPresentation(row) {
    if (!row) return;
    row.style.removeProperty('overflow-x');
    row.style.removeProperty('overflow-y');
    row.style.removeProperty('justify-content');
  }

  function sync() {
    scheduled = false;
    var row = document.querySelector('.view-tabs');
    var wrapper = document.getElementById('moreViewsWrapper');
    if (!row) return;

    if (!isWideDesktop()) {
      restoreDefaultPresentation(row);
      return;
    }

    Array.prototype.forEach.call(row.children, function (tab) {
      if (!tab || !tab.classList || !tab.classList.contains('view-tab') || !tab.dataset.view) return;
      // Respect app.js feature and workspace-mode gating. Those paths use
      // hidden/aria-hidden; progressive overflow uses only inline display.
      if (tab.hidden || tab.getAttribute('aria-hidden') === 'true') return;
      if (tab.style.display === 'none') {
        tab.style.removeProperty('display');
        tab.dataset.overflowHidden = 'false';
      }
    });

    if (row.style.getPropertyValue('overflow-x') !== 'auto'
        || row.style.getPropertyPriority('overflow-x') !== 'important') {
      row.style.setProperty('overflow-x', 'auto', 'important');
    }
    if (row.style.getPropertyValue('overflow-y') !== 'hidden'
        || row.style.getPropertyPriority('overflow-y') !== 'important') {
      row.style.setProperty('overflow-y', 'hidden', 'important');
    }
    if (row.scrollWidth > row.clientWidth + 2) {
      if (row.style.getPropertyValue('justify-content') !== 'flex-start'
          || row.style.getPropertyPriority('justify-content') !== 'important') {
        row.style.setProperty('justify-content', 'flex-start', 'important');
      }
    } else {
      row.style.removeProperty('justify-content');
    }

    if (wrapper) {
      if (wrapper.classList.contains('open')) wrapper.classList.remove('open');
      if (!wrapper.hidden) wrapper.hidden = true;
      var menu = document.getElementById('moreViewsMenu');
      var toggle = document.getElementById('moreViewsToggle');
      if (menu && menu.classList.contains('open')) menu.classList.remove('open');
      if (toggle && toggle.getAttribute('aria-expanded') !== 'false') {
        toggle.setAttribute('aria-expanded', 'false');
      }
    }
  }

  function schedule() {
    if (scheduled) return;
    scheduled = true;
    window.requestAnimationFrame(sync);
  }

  function init() {
    sync();
    window.addEventListener('resize', schedule);
    window.addEventListener('noteflow:view-changed', schedule);
    window.addEventListener('load', schedule);

    // app.js and feature packs can refresh the row after their initial boot
    // pass. Reconcile those presentation-only changes without touching the
    // app's feature-gating attributes.
    var row = document.querySelector('.view-tabs');
    var wrapper = document.getElementById('moreViewsWrapper');
    if (row && typeof MutationObserver === 'function') {
      var observer = new MutationObserver(schedule);
      observer.observe(row, {
        attributes: true,
        attributeFilter: ['style', 'class', 'hidden', 'aria-hidden'],
        childList: true,
        subtree: true
      });
      if (wrapper) {
        observer.observe(wrapper, {
          attributes: true,
          attributeFilter: ['class', 'hidden', 'style', 'aria-expanded'],
          subtree: true
        });
      }
    }
    [0, 100, 500, 1000, 2000].forEach(function (delay) {
      window.setTimeout(schedule, delay);
    });
  }

  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
