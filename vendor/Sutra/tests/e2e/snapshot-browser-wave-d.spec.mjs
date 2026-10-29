import { expect, test } from '@playwright/test';
import { waitForAppReady } from './helpers/app-ready.mjs';

// Wave D — Whole-workspace snapshot browser + diff (#6).

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await waitForAppReady(page);
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => !!(window.openSnapshotBrowserModal && window.__sutraPublicBetaTestHooks && window.__sutraPublicBetaTestHooks.createWorkspaceSnapshot));
}

test('creating a snapshot stores it with a summary', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const H = window.__sutraPublicBetaTestHooks;
    const snap = H.createWorkspaceSnapshot('QA snapshot');
    const list = H.getWorkspaceSnapshots();
    return { ok: !!snap, count: list.length, hasSummary: !!(snap && snap.summary && typeof snap.summary.pages === 'number') };
  });
  expect(r.ok).toBe(true);
  expect(r.count).toBeGreaterThanOrEqual(1);
  expect(r.hasSummary).toBe(true);
});

test('diff reports collection deltas vs the current workspace', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const H = window.__sutraPublicBetaTestHooks;
    const snap = H.createWorkspaceSnapshot('Baseline');
    H.createNoteInActiveSpace('A brand new note', '<p>x</p>');
    const d = H.diffWorkspaceSnapshot(snap.id);
    const pageDelta = d.diffs.find(x => x.key === 'pages');
    return { hasDiff: !!(d && d.diffs.length), pageDelta: pageDelta ? pageDelta.delta : 0 };
  });
  expect(r.hasDiff).toBe(true);
  expect(r.pageDelta).toBeGreaterThanOrEqual(1);
});

test('the snapshot browser modal opens and offers create', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    window.openSnapshotBrowserModal();
    const m = document.getElementById('sutraSnapshotModal');
    return { active: !!(m && m.classList.contains('active')), hasCreate: !!(m && m.querySelector('[data-snap-create]')) };
  });
  expect(r.active).toBe(true);
  expect(r.hasCreate).toBe(true);
});

test('snapshots are capped (oldest dropped)', async ({ page }) => {
  await openApp(page);
  const count = await page.evaluate(() => {
    const H = window.__sutraPublicBetaTestHooks;
    for (let i = 0; i < 6; i++) H.createWorkspaceSnapshot('S' + i);
    return H.getWorkspaceSnapshots().length;
  });
  expect(count).toBeLessThanOrEqual(3);
});

test('restore refuses to replace the workspace when its safety checkpoint fails, then succeeds on retry', async ({ page }) => {
  await openApp(page);
  const result = await page.evaluate(async () => {
    const H = window.__sutraPublicBetaTestHooks;
    const pageB = H.createNoteInActiveSpace('Historical workspace B', '<p>historical B</p>');
    const snapshotB = H.createWorkspaceSnapshot('Historical B');
    H.renamePage(pageB.id, 'Current workspace A');

    const safeStorage = window.SutraSafeStorage;
    const originalSet = safeStorage.set;
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    safeStorage.set = (key, value, options) => {
      if (key === 'sutra:workspaceSnapshots:v1') return { ok: false, error: new Error('forced checkpoint failure') };
      return originalSet.call(safeStorage, key, value, options);
    };

    let refused;
    try {
      refused = await H.restoreWorkspaceSnapshot(snapshotB.id);
    } finally {
      safeStorage.set = originalSet;
    }

    const afterRefusal = H.getPagesForSpace(H.getActiveSpaceId()).find(item => item.id === pageB.id);
    const toastText = Array.from(document.querySelectorAll('.toast, #toast, [role="status"]'))
      .map(node => node.textContent || '')
      .join(' ');
    const restored = await H.restoreWorkspaceSnapshot(snapshotB.id);
    window.confirm = originalConfirm;
    const afterRetry = H.getPagesForSpace(H.getActiveSpaceId()).find(item => item.id === pageB.id);
    const beforeRestore = H.getWorkspaceSnapshots().find(item => item && item.label === 'Before restore');
    const checkpointPage = beforeRestore && beforeRestore.payload && Array.isArray(beforeRestore.payload.pages)
      ? beforeRestore.payload.pages.find(item => item && item.id === pageB.id)
      : null;

    return {
      refused,
      titleAfterRefusal: afterRefusal && afterRefusal.title,
      toastText,
      restored,
      titleAfterRetry: afterRetry && afterRetry.title,
      checkpointTitle: checkpointPage && checkpointPage.title
    };
  });

  expect(result.refused).toBe(false);
  expect(result.titleAfterRefusal).toBe('Current workspace A');
  expect(result.toastText).toContain('Restore canceled');
  expect(result.toastText).toContain('safety snapshot');
  expect(result.restored).toBe(true);
  expect(result.titleAfterRetry).toBe('Historical workspace B');
  expect(result.checkpointTitle).toBe('Current workspace A');
});
