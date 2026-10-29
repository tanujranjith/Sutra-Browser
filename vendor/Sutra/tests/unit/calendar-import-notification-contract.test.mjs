import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const appSource = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
const notificationsSource = readFileSync(new URL('../../src/features/workspace/notifications.js', import.meta.url), 'utf8');

function deriveNotifications(deadlines) {
  const storage = new Map();
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const window = {
    document,
    addEventListener() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    SutraSafeStorage: {
      get(key) { return storage.get(key) || null; },
      set(key, value) { storage.set(key, value); }
    },
    flowAtelier: {
      collectWorkspaceDeadlines() { return deadlines; }
    }
  };
  window.window = window;
  vm.runInNewContext(notificationsSource, { window, document, console, Date, Map, Set, Math, JSON });
  window.SutraNotifications.importState({
    prefs: { enabled: true, categories: { timeline: true, release: false } }
  });
  return window.SutraNotifications.getNotifications();
}

function notificationWritesWithRevocationGuard(guarded) {
  let writes = 0;
  const safeStorage = {
    get() { return null; },
    set() { writes += 1; }
  };
  const document = {
    readyState: 'loading',
    addEventListener() {},
    getElementById() { return null; }
  };
  const window = {
    document,
    addEventListener() {},
    setTimeout() { return 0; },
    clearTimeout() {},
    setInterval() { return 0; },
    clearInterval() {},
    SutraSafeStorage: safeStorage,
    SutraRevocationWipe: {
      readGuard() { return guarded ? { state: 'locked' } : null; }
    }
  };
  window.window = window;
  vm.runInNewContext(notificationsSource, { window, document, console, Date, Map, Set, Math, JSON, SutraSafeStorage: safeStorage });
  window.SutraNotifications.importState({ prefs: { enabled: true } });
  return writes;
}

test('imported calendar blocks remain Timeline context without becoming overdue reminders', () => {
  const past = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const notifications = deriveNotifications([
    {
      id: 'block:old-ics', source: 'timeline', sourceId: 'old-ics', title: 'Historical imported class',
      due: past, overdue: true, notificationEligible: false
    },
    {
      id: 'block:manual', source: 'timeline', sourceId: 'manual', title: 'Manual Timeline block',
      due: past, overdue: true
    }
  ]);

  assert.deepEqual(Array.from(notifications, item => item.title), ['Manual Timeline block']);
});

test('the canonical deadline bridge marks ICS blocks non-notifying without changing Timeline storage', () => {
  const collector = extractFunction(appSource, 'collectWorkspaceDeadlines');
  assert.ok(collector, 'canonical deadline collector exists');
  assert.match(collector.body, /notificationEligible: block\.source !== 'calendar_ics'/);
  assert.match(collector.body, /source: 'timeline'/);
});

test('the canonical deadline bridge keeps only five recent local days of imported ICS history', () => {
  const collector = extractFunction(appSource, 'collectWorkspaceDeadlines');
  assert.ok(collector, 'canonical deadline collector exists');
  assert.match(collector.body, /importedCalendarHistoryCutoff\.setDate\(importedCalendarHistoryCutoff\.getDate\(\) - 5\)/);
  assert.match(collector.body, /block\.source === 'calendar_ics' && due < importedCalendarHistoryCutoff/);
});

test('notification persistence remains fail-closed while a revocation wipe guard exists', () => {
  assert.equal(notificationWritesWithRevocationGuard(true), 0);
  assert.equal(notificationWritesWithRevocationGuard(false), 1);
});
