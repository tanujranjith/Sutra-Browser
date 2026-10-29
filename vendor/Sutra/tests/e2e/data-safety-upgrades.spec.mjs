import { expect, test } from '@playwright/test';

// Part 5 — Data-safety & Sync:
//  - Trash: deleting a page is recoverable (capture -> restore / purge)
//  - Focus session history + time-by-subject stats
// Persistence parity for the new `trash` / `focusSessions` collections is also
// checked in Node by scripts/round-trip-check.mjs.

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await page.evaluate(() => {
    try { if (typeof window.markStudentOnboardingCompleted === 'function') window.markStudentOnboardingCompleted(true); } catch (e) {}
    const o = document.getElementById('studentOnboardingOverlay');
    if (o) { o.classList.remove('active'); o.hidden = true; o.style.setProperty('display', 'none', 'important'); }
  });
  await page.waitForFunction(() => !!(window.__sutraPublicBetaTestHooks && window.__sutraPublicBetaTestHooks.getTrash));
}

test('deleting a page sends it to Trash and it can be restored', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const H = window.__sutraPublicBetaTestHooks;
    const note = H.createNoteInActiveSpace('Disposable note', '<p>bye</p>');
    H.forceDeletePageById(note.id);
    const gone = !H.pageExists(note.id);
    const inTrash = H.getTrash().some(t => t.kind === 'page' && t.title === 'Disposable note');
    const trashId = (H.getTrash().find(t => t.title === 'Disposable note') || {}).id;
    const restored = H.restoreTrashItem(trashId);
    const back = H.pageExists(note.id) || H.getTrash().every(t => t.title !== 'Disposable note');
    return { gone, inTrash, restored, back };
  });
  expect(r.gone).toBe(true);
  expect(r.inTrash).toBe(true);
  expect(r.restored).toBe(true);
  expect(r.back).toBe(true);
});

test('purging a trash item removes it permanently', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const H = window.__sutraPublicBetaTestHooks;
    const note = H.createNoteInActiveSpace('Purge me', '<p>x</p>');
    H.forceDeletePageById(note.id);
    const rec = H.getTrash().find(t => t.title === 'Purge me');
    H.purgeTrashItem(rec.id);
    return { stillThere: H.getTrash().some(t => t.id === rec.id), pageGone: !H.pageExists(note.id) };
  });
  expect(r.stillThere).toBe(false);
  expect(r.pageGone).toBe(true);
});

test('focus sessions record and aggregate by subject', async ({ page }) => {
  await openApp(page);
  const r = await page.evaluate(() => {
    const H = window.__sutraPublicBetaTestHooks;
    H.recordFocusSession({ minutes: 25, subject: 'Calculus' });
    H.recordFocusSession({ minutes: 15, subject: 'Calculus' });
    H.recordFocusSession({ minutes: 30, subject: 'Biology' });
    const stats = H.getFocusStatsBySubject(7);
    const calc = stats.subjects.find(s => s.subject === 'Calculus');
    return { total: stats.totalMinutes, count: stats.count, calcMin: calc ? calc.minutes : 0, topIsCalc: stats.subjects[0] && stats.subjects[0].subject === 'Calculus' };
  });
  expect(r.total).toBeGreaterThanOrEqual(70);
  expect(r.count).toBeGreaterThanOrEqual(3);
  expect(r.calcMin).toBe(40);
  expect(r.topIsCalc).toBe(true);
});

test('the Trash modal opens from the global hook', async ({ page }) => {
  await openApp(page);
  const opened = await page.evaluate(() => {
    if (typeof window.openTrashModal !== 'function') return false;
    window.openTrashModal();
    const m = document.getElementById('sutraTrashModal');
    return !!(m && m.classList.contains('active'));
  });
  expect(opened).toBe(true);
});
