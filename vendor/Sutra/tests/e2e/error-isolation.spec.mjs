import { expect, test } from '@playwright/test';

// Architecture hardening — structured error handling (src/core/error-reporter.js)
// and feature-level runtime isolation (src/core/feature-guard.js).
// Proves: a broken feature degrades instead of white-screening the app; failures
// are funneled into exportable diagnostics; and global error/rejection nets work.

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForFunction(() => !!window.SutraFeatureGuard && !!window.SutraReportError, null, { timeout: 20000 });
}

test('a feature that throws during BOOT degrades but the app still boots', async ({ page }) => {
  // Force the AP Study boot hook (called through the guard) to throw, and keep
  // it throwing even after ap-study.js assigns the real implementation.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'hydrateApStudyWorkspaceState', {
      configurable: true,
      get() { return function () { throw new Error('forced ap-study boot failure'); }; },
      set() { /* swallow the real assignment so our throwing version stays */ }
    });
  });

  await page.goto('/Sutra.html');

  // The app still boots to a usable workspace despite the broken feature.
  await expect(page.locator('[data-sutra-component="brand-mark"]').first()).toBeVisible();

  // The failure was isolated, recorded, and surfaced as a degraded badge.
  await expect.poll(() => page.evaluate(() => window.SutraFeatureGuard.isDegraded('ap-study'))).toBe(true);
  await expect(page.locator('#sutraFeatureDegradedBadges')).toBeVisible();
  const reported = await page.evaluate(() =>
    window.SutraDiagnostics.getEntries().some((e) => e.context && e.context.feature === 'ap-study')
  );
  expect(reported).toBe(true);
});

test('SutraFeatureGuard.run isolates a throwing feature and returns the fallback', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(() => {
    const out = window.SutraFeatureGuard.run('unit-broken', () => { throw new Error('boom'); }, { fallback: 'safe', label: 'Unit Broken' });
    return {
      out,
      degraded: window.SutraFeatureGuard.isDegraded('unit-broken'),
      badge: !!document.getElementById('sutraFeatureDegradedBadges'),
      reported: window.SutraDiagnostics.getEntries().some((e) => e.context && e.context.feature === 'unit-broken')
    };
  });
  expect(res.out).toBe('safe');
  expect(res.degraded).toBe(true);
  expect(res.badge).toBe(true);
  expect(res.reported).toBe(true);
});

test('SutraFeatureGuard.run preserves the return value on success and catches async rejections', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(async () => {
    const sync = window.SutraFeatureGuard.run('unit-ok', () => 42);
    const okBefore = window.SutraFeatureGuard.isDegraded('unit-ok');
    // Async rejection should be caught (not surface as unhandledrejection) and degrade.
    window.SutraFeatureGuard.run('unit-async', () => Promise.reject(new Error('async boom')), { label: 'Async' });
    await new Promise((r) => setTimeout(r, 50));
    return { sync, okBefore, asyncDegraded: window.SutraFeatureGuard.isDegraded('unit-async') };
  });
  expect(res.sync).toBe(42);
  expect(res.okBefore).toBe(false);
  expect(res.asyncDegraded).toBe(true);
});

test('SutraFeatureGuard async contract: fallback settlement, no detached rejection, explicit rethrow', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(async () => {
    const unhandled = [];
    const onUnhandled = (event) => unhandled.push(String(event && event.reason && event.reason.message || event.reason));
    window.addEventListener('unhandledrejection', onUnhandled);

    let resolveSlow;
    const slow = window.SutraFeatureGuard.run('guard-slow', () => new Promise((resolve) => { resolveSlow = resolve; }), { fallback: 'fb', label: 'Slow' });
    let settledEarly = false;
    slow.then(() => { settledEarly = true; }, () => { settledEarly = true; });

    // Rejected async feature: the derived promise must settle with the
    // fallback (not reject), degrade the feature, and leave nothing detached.
    const degradedOutcome = await window.SutraFeatureGuard.run(
      'guard-reject',
      () => Promise.reject(new Error('isolated boom')),
      { fallback: 'safe', label: 'Rejecting' }
    );

    // Still pending immediately after the synchronous resolve() call — the
    // derived chain has not been observed to settle ahead of time.
    const settledBeforeMicrotasks = settledEarly;
    resolveSlow('late-value');
    const slowValue = await slow;

    // Explicit rethrow travels through the SAME returned promise and is
    // observable by an awaiting caller.
    let rethrownMessage = '';
    try {
      await window.SutraFeatureGuard.run(
        'guard-rethrow',
        () => Promise.reject(new Error('explicit rethrow')),
        { label: 'Rethrow', rethrow: true }
      );
    } catch (error) {
      rethrownMessage = error && error.message;
    }

    // An ignored rethrow-enabled rejection is the caller's choice; it must
    // still be observable as a rejection of the returned promise only.
    const ignored = window.SutraFeatureGuard.run(
      'guard-ignored-rethrow',
      () => Promise.reject(new Error('ignored on purpose')),
      { label: 'Ignored', rethrow: true }
    );
    const ignoredRejected = await ignored.then(() => false, (error) => error instanceof Error);

    await new Promise((r) => setTimeout(r, 50));
    window.removeEventListener('unhandledrejection', onUnhandled);
    return {
      degradedOutcome,
      slowValue,
      settledBeforeMicrotasks,
      rethrownMessage,
      ignoredRejected,
      unhandled,
      degradedFlags: {
        reject: window.SutraFeatureGuard.isDegraded('guard-reject'),
        rethrow: window.SutraFeatureGuard.isDegraded('guard-rethrow'),
        ignored: window.SutraFeatureGuard.isDegraded('guard-ignored-rethrow')
      }
    };
  });

  expect(res.degradedOutcome).toBe('safe');
  expect(res.slowValue).toBe('late-value');
  expect(res.settledBeforeMicrotasks).toBe(false);
  expect(res.rethrownMessage).toBe('explicit rethrow');
  expect(res.ignoredRejected).toBe(true);
  expect(res.degradedFlags).toEqual({ reject: true, rethrow: true, ignored: true });
  expect(res.unhandled).toEqual([]);
});

test('SutraFeatureGuard contains malformed thenables', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const getterFallback = window.SutraFeatureGuard.run('guard-then-getter', () => ({
      get then() { throw new Error('then getter failed'); }
    }), { fallback: 'getter-safe' });

    const callFallback = await window.SutraFeatureGuard.run('guard-then-call', () => ({
      then() { throw new Error('then call failed'); }
    }), { fallback: 'call-safe' });

    let rethrown = '';
    try {
      await window.SutraFeatureGuard.run('guard-then-rethrow', () => ({
        then() { throw new Error('then rethrow failed'); }
      }), { rethrow: true });
    } catch (error) {
      rethrown = error.message;
    }
    return {
      getterFallback,
      callFallback,
      rethrown,
      getterDegraded: window.SutraFeatureGuard.isDegraded('guard-then-getter'),
      callDegraded: window.SutraFeatureGuard.isDegraded('guard-then-call'),
      rethrowDegraded: window.SutraFeatureGuard.isDegraded('guard-then-rethrow')
    };
  });
  expect(result).toEqual({
    getterFallback: 'getter-safe',
    callFallback: 'call-safe',
    rethrown: 'then rethrow failed',
    getterDegraded: true,
    callDegraded: true,
    rethrowDegraded: true
  });
});

test('SutraReportError records structured, severity-tagged, de-duplicated diagnostics', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(() => {
    window.SutraDiagnostics.clear();
    window.SutraReportError(new Error('first'), { where: 'unit-test', detail: 'x' }, 'warning');
    window.SutraReportError(new Error('first'), { where: 'unit-test', detail: 'x' }, 'warning'); // duplicate burst -> deduped
    window.SutraReportError(new Error('second'), 'string-context', 'critical');
    const entries = window.SutraDiagnostics.getEntries();
    return {
      count: entries.length,
      first: entries[0],
      report: JSON.parse(window.SutraDiagnostics.exportText())
    };
  });
  expect(res.count).toBe(2); // duplicate within the dedupe window collapsed
  expect(res.first.severity).toBe('warning');
  expect(res.first.message).toBe('first');
  expect(res.first.context.where).toBe('unit-test');
  expect(res.report.schema).toBe('sutra-diagnostics@1');
  expect(Array.isArray(res.report.entries)).toBe(true);
});

test('global error and unhandledrejection nets funnel into diagnostics', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(async () => {
    window.SutraDiagnostics.clear();
    window.dispatchEvent(new ErrorEvent('error', { message: 'global-error-net', error: new Error('global-error-net') }));
    window.dispatchEvent(new PromiseRejectionEvent('unhandledrejection', {
      promise: Promise.reject('rej').catch(() => {}),
      reason: new Error('global-rejection-net')
    }));
    await new Promise((r) => setTimeout(r, 30));
    const msgs = window.SutraDiagnostics.getEntries().map((e) => e.message);
    return msgs;
  });
  expect(res.join('|')).toContain('global-error-net');
  expect(res.join('|')).toContain('global-rejection-net');
});

test('SutraReportError shows a non-blocking toast only when a userMessage is provided', async ({ page }) => {
  await openApp(page);
  const toastText = await page.evaluate(async () => {
    const calls = [];
    const real = window.showToast;
    window.showToast = (m) => { calls.push(m); };
    window.SutraReportError(new Error('silent'), { where: 'no-toast' }, 'error');           // no userMessage -> no toast
    window.SutraReportError(new Error('x'), { where: 'with-toast', userMessage: 'Could not save your note.' }, 'error');
    window.showToast = real;
    return calls;
  });
  expect(toastText).toEqual(['Could not save your note.']);
});

test('Sutra diagnostics do not replace the browser reportError platform API', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(() => ({
    nativeType: typeof window.reportError,
    sutraType: typeof window.SutraReportError,
    distinct: window.reportError !== window.SutraReportError
  }));
  expect(result.nativeType).toBe('function');
  expect(result.sutraType).toBe('function');
  expect(result.distinct).toBe(true);
});
