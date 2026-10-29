import { expect, test } from '@playwright/test';

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForSelector('#storageOptions', { state: 'attached' });
  await page.waitForFunction(() =>
    !!window.flowAtelier && typeof window.flowAtelier.flushAppSaveNow === 'function');
  await page.evaluate(() => window.flowAtelier.flushAppSaveNow('resizable-media-race-ready'));
}

test('a detached image mutation is ignored while connected images still become resizable', async ({ page }) => {
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await openApp(page);
  errors.length = 0;

  const result = await page.evaluate(async () => {
    const editor = document.getElementById('editor');
    const staleImage = document.createElement('img');
    staleImage.src = 'data:image/gif;base64,R0lGODlhAQABAAAAACH5BAEKAAEALAAAAAABAAEAAAICTAEAOw==';
    editor.appendChild(staleImage);
    staleImage.remove();

    const liveImage = document.createElement('img');
    liveImage.src = staleImage.src;
    editor.appendChild(liveImage);
    await new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(resolve)));

    return {
      staleDetached: !staleImage.isConnected,
      liveWrapped: liveImage.parentElement?.classList.contains('resizable-media') === true
    };
  });

  expect(result).toEqual({ staleDetached: true, liveWrapped: true });
  expect(errors).toEqual([]);
});
