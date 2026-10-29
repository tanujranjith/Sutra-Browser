import { test, expect } from '@playwright/test';
import fs from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const source = await fs.readFile(path.join(repo, 'src/Browser.App/Views/MainWindow.ContentBlocking.cs'), 'utf8');
const pickerTemplate = source.match(/const string pickerScript = """\r?\n([\s\S]*?)\r?\n\s*""";/)?.[1];
if (!pickerTemplate) throw new Error('Could not find the production element picker script.');
const token = '0123456789abcdef0123456789abcdef';
const picker = pickerTemplate.replace('__SUTRA_PICKER_NONCE__', JSON.stringify(token));

async function openPicker(page) {
  await page.setContent('<style>#sponsor,#article{width:250px;height:100px;margin:20px}</style><aside id="sponsor">Sponsored panel</aside><article id="article">Article content</article>');
  await page.evaluate(() => {
    window.__messages = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = { postMessage: value => window.__messages.push(value) };
  });
  await page.evaluate(script => (0, eval)(script), picker);
}

test('picker requires a real click and produces a usable reversible hide selector', async ({ page }) => {
  await openPicker(page);
  await page.locator('#sponsor').dispatchEvent('click', { clientX: 50, clientY: 50 });
  expect(await page.evaluate(() => window.__messages)).toEqual([]);
  await page.locator('#sponsor').hover();
  await expect(page.locator('#sponsor')).toHaveCSS('outline-style', 'solid');
  await page.locator('#sponsor').click();
  const message = await page.evaluate(() => window.__messages[0]);
  expect(message).toEqual({ kind: 'element-picker-selected', token, selector: 'aside#sponsor' });
  await expect(page.locator('#__sutra_element_picker')).toHaveCount(0);
  await page.evaluate(selector => {
    const style = document.createElement('style'); style.id = '__sutra_content_filters';
    style.textContent = `${selector}{display:none!important}`; document.head.append(style);
  }, message.selector);
  await expect(page.locator('#sponsor')).toBeHidden();
  await expect(page.locator('#article')).toBeVisible();
  await page.evaluate(() => { document.getElementById('__sutra_content_filters').textContent = ''; });
  await expect(page.locator('#sponsor')).toBeVisible();
});

test('Escape cancels the picker and prevents a later click from saving a rule', async ({ page }) => {
  await openPicker(page);
  await page.keyboard.press('Escape');
  await page.locator('#sponsor').click();
  expect(await page.evaluate(() => window.__messages)).toEqual([{ kind: 'element-picker-cancelled', token }]);
  await expect(page.locator('#__sutra_element_picker')).toHaveCount(0);
});
