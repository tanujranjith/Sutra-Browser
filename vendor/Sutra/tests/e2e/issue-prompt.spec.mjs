import { expect, test } from '@playwright/test';

/*
 * issue-prompt.spec.mjs — runtime "file an issue" nudge + self-checks.
 *
 * Verifies src/core/issue-prompt.js:
 *   - a reported error/critical surfaces a non-blocking prompt AND highlights
 *     the feedback ("issue") button (#feedbackFabBtn.issue-attention),
 *   - the Report button opens the feedback modal,
 *   - a failed self-check drives the same nudge,
 *   - benign (warning) and already-user-handled errors do NOT nudge.
 */

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
  await page.waitForFunction(() => !!window.SutraIssuePrompt && typeof window.SutraReportError === 'function');
}

test('a reported error shows the issue prompt and highlights the issue button', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => window.SutraReportError(new Error('e2e forced failure'), { where: 'e2e' }, 'error'));

  // Prompt becomes visible…
  await expect(page.locator('#sutraIssuePrompt.is-visible')).toBeVisible();
  // …with the expected actions.
  await expect(page.locator('.issue-prompt-report')).toBeVisible();
  await expect(page.locator('.issue-prompt-dismiss')).toBeVisible();

  // …and the issue button is highlighted.
  await expect(page.locator('#feedbackFabBtn')).toHaveClass(/issue-attention/);

  // Sanity on the public state hook.
  const state = await page.evaluate(() => window.SutraIssuePrompt.getState());
  expect(state.triggerCount).toBeGreaterThan(0);
  expect(state.visible).toBe(true);
});

test('clicking Report issue opens the feedback modal', async ({ page }) => {
  await openApp(page);
  await page.evaluate(() => window.SutraReportError(new Error('e2e forced failure'), { where: 'e2e' }, 'error'));
  await expect(page.locator('#sutraIssuePrompt.is-visible')).toBeVisible();

  await page.locator('.issue-prompt-report').click();

  // Feedback modal opened.
  const opened = await page.evaluate(() => {
    const m = document.getElementById('googleFeedbackModal');
    return !!m && m.hidden === false && m.getAttribute('aria-hidden') === 'false'
      && document.body.classList.contains('google-feedback-open');
  });
  expect(opened).toBe(true);

  // Acting on it clears the highlight and dismisses the banner.
  await expect(page.locator('#feedbackFabBtn')).not.toHaveClass(/issue-attention/);
});

test('a failed self-check triggers the nudge', async ({ page }) => {
  await openApp(page);

  // Healthy app: the battery passes.
  const healthy = await page.evaluate(() => window.SutraIssuePrompt.runSelfChecks({ silent: true }));
  expect(healthy.every((r) => r.ok)).toBe(true);

  // Force one check to fail deterministically by removing the feedback hook,
  // then run just that check (non-silent → it reports + nudges).
  await page.evaluate(() => {
    window.__savedOpenFeedback = window.openGoogleFeedbackModal;
    try { delete window.openGoogleFeedbackModal; } catch (e) { window.openGoogleFeedbackModal = undefined; }
    window.SutraIssuePrompt.runSelfChecks({ only: ['feedback-form'] });
  });

  await expect(page.locator('#sutraIssuePrompt.is-visible')).toBeVisible();
  await expect(page.locator('#feedbackFabBtn')).toHaveClass(/issue-attention/);

  // restore (so the fallback click path still works if needed)
  await page.evaluate(() => { window.openGoogleFeedbackModal = window.__savedOpenFeedback; });
});

test('warnings and already-handled errors do not nudge', async ({ page }) => {
  await openApp(page);

  await page.evaluate(() => {
    // a mere warning
    window.SutraReportError(new Error('just a warning'), { where: 'e2e' }, 'warning');
    // an error the app already surfaced to the user (graceful path)
    window.SutraReportError(new Error('handled'), { where: 'e2e', userMessage: 'Saved locally instead.' }, 'error');
  });

  // Give the listener a beat; nothing should appear.
  await page.waitForTimeout(300);
  const visible = await page.evaluate(() => window.SutraIssuePrompt.isVisible());
  expect(visible).toBe(false);
  await expect(page.locator('#feedbackFabBtn')).not.toHaveClass(/issue-attention/);
});

test('browser ResizeObserver layout notices do not appear as app failures', async ({ page }) => {
  await openApp(page);

  const result = await page.evaluate(() => {
    window.SutraDiagnostics.clear();
    [
      'ResizeObserver loop completed with undelivered notifications.',
      'ResizeObserver loop limit exceeded'
    ].forEach((message) => {
      window.dispatchEvent(new ErrorEvent('error', { message }));
    });
    return window.SutraDiagnostics.getEntries();
  });

  expect(result).toHaveLength(2);
  result.forEach((entry) => {
    expect(entry).toMatchObject({
      severity: 'debug',
      context: { where: 'window.onerror', benignBrowserLayoutNotice: true }
    });
  });
  await expect(page.locator('#sutraIssuePrompt')).toBeHidden();
  await expect(page.locator('#feedbackFabBtn')).not.toHaveClass(/issue-attention/);
});
