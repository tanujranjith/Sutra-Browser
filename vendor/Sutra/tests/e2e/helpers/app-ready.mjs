// Static markup/globals precede canonical IndexedDB hydration. Wait for the
// startup gate to confirm the canonical workspace is loaded, without creating
// a write in a fixture that deliberately models a stale second tab.
export async function waitForAppHydrated(page) {
  await page.waitForFunction(() => {
    const state = document.body?.dataset?.sutraWorkspaceBoot;
    return state === 'ready' || state === 'error';
  });
  const state = await page.locator('body').getAttribute('data-sutra-workspace-boot');
  if (state !== 'ready') {
    const detail = await page.locator('#sutraWorkspaceStartupMessage').textContent().catch(() => '');
    throw new Error(`Sutra workspace startup failed before hydration.${detail ? ` ${detail.trim()}` : ''}`);
  }
}

// Ordinary fixtures then cross the public durability seam before changing
// preferences or seeding data.
export async function waitForAppReady(page) {
  await waitForAppHydrated(page);
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('e2e-app-ready'));
}
