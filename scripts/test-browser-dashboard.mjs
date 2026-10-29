import { chromium } from 'playwright';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import fs from 'node:fs/promises';
import assert from 'node:assert/strict';

const browser = await chromium.launch({ channel: 'msedge', headless: true });
try {
  const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
  page.setDefaultTimeout(8000);
  const errors = [], remote = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (/^https?:/.test(request.url())) remote.push(request.url()); });
  await page.addInitScript(() => {
    window.__messages = [];
    window.chrome = window.chrome || {};
    window.chrome.webview = {
      postMessage: value => window.__messages.push(value),
      addEventListener: (kind, callback) => { if (kind === 'message') window.__receive = callback; }
    };
  });
  const dashboardUrl = pathToFileURL(path.resolve('Sutra Ultra/index.html')).href;
  await page.goto(dashboardUrl);
  const names = ['GitHub', 'Design library', 'YouTube', 'Writing desk', 'School', 'Books', 'Inbox', 'Community'];
  const favorites = names.map((title, index) => ({ title, url: `https://site${index}.example/path` }));
  const tabs = ['Project notes', 'A new perspective', 'Study resources', 'Weekend reading', 'Design references', 'Music for focus']
    .map((title, index) => ({ title, url: `https://open${index}.example/`, tabId: `00000000-0000-0000-0000-${String(index + 1).padStart(12, '0')}`, sleeping: index === 2 }));
  const context = { kind: 'sutra-context', theme: 'dark', accent: '#6252F5', profile: 'Default', privateWindow: false, favorites, tabs };
  const nativeSource = await fs.readFile('src/Browser.App/Views/MainWindow.Dashboard.cs', 'utf8');
  const template = nativeSource.match(/private const string NewTabDashboardScript = """\r?\n([\s\S]*?)\r?\n\s*""";/)?.[1];
  assert.ok(template);
  const delivery = data => template.replace('__SUTRA_DASHBOARD_URL__', JSON.stringify(dashboardUrl)).replace('__SUTRA_DASHBOARD_CONTEXT__', JSON.stringify(data));
  const send = async data => page.evaluate(script => (0, eval)(script), delivery(data));
  await send(context);
  assert.equal(await page.locator('.favorite-tile').count(), 8);
  assert.equal(await page.locator('.resume-card').count(), 6);
  assert.equal(await page.locator('#search-input').evaluate(input => document.activeElement === input), false);
  await page.getByRole('button', { name: /GitHub/ }).click();
  assert.deepEqual(await page.evaluate(() => window.__messages.pop()), { kind: 'open-url', url: favorites[0].url });
  await page.locator('.resume-card').first().click();
  assert.deepEqual(await page.evaluate(() => window.__messages.pop()), { kind: 'new-tab-switch', tabId: tabs[0].tabId });
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.locator('#show-favorites').uncheck();
  await page.getByRole('button', { name: 'Close', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#show-favorites').checked, null, { timeout: 5000 });
  assert.equal(await page.locator('#favorite-section').isVisible(), true, 'Cancel must discard unsaved customization');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.locator('#show-favorites').uncheck();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('#favorite-section').hidden, null, { timeout: 5000 });
  assert.equal(await page.locator('#favorite-section').isVisible(), false);
  await page.reload(); await send(context);
  assert.equal(await page.locator('#favorite-section').isVisible(), false, 'Customization must survive reload');
  await page.getByRole('button', { name: 'Customize', exact: true }).click();
  await page.locator('#reset-settings').click();
  await page.getByRole('button', { name: 'Done', exact: true }).click();
  assert.equal(await page.locator('#favorite-section').isVisible(), true);
  await page.waitForFunction(() => document.querySelector('#live').textContent === 'Customize settings saved', null, { timeout: 5000 });
  await page.waitForFunction(() => !document.querySelector('#live').textContent, null, { timeout: 5000 });

  for (const theme of ['dark', 'light']) {
    await send({ ...context, theme });
    await page.setViewportSize({ width: 1280, height: 900 });
    await page.screenshot({ path: `output/browser-upgrade-${theme}.png`, fullPage: true });
  }
  await send(context);
  await page.setViewportSize({ width: 1150, height: 620 });
  assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth));
  await page.screenshot({ path: 'output/browser-upgrade-compact.png', fullPage: true });
  for (const width of [1150, 900, 600, 360]) {
    await page.setViewportSize({ width, height: 800 });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), `No horizontal overflow at ${width}px`);
    await page.screenshot({ path: `output/browser-upgrade-${width}.png`, fullPage: true });
  }
  await page.setViewportSize({ width: 1150, height: 800 });
  await send({ ...context, favorites: [{ title: '<img src=x onerror="window.__unsafe=true">', url: 'https://safe.example/' }, { title: 'Bad protocol', url: 'javascript:alert(1)' }, { title: 'Credentials', url: 'https://name:secret@example.test/' }] });
  assert.equal(await page.locator('.favorite-tile').count(), 1);
  assert.equal(await page.locator('#favorite-grid img').count(), 0);
  assert.equal(await page.evaluate(() => window.__unsafe), undefined);
  await send({ ...context, privateWindow: true });
  assert.equal(await page.locator('.favorite-tile').count(), 0);
  assert.equal(await page.locator('.resume-card').count(), 0);
  assert.equal(await page.locator('#dashboard-grid').count(), 0);
  assert.equal(await page.locator('.dashboard-grid').isVisible(), false);
  assert.equal(await page.locator('#private-note').isVisible(), true);
  await page.screenshot({ path: 'output/browser-upgrade-private.png', fullPage: true });
  assert.deepEqual(errors, []);
  assert.deepEqual(remote, [], 'The dashboard must not fetch remote thumbnails, icons, fonts, or suggestions');
  const external = await browser.newPage();
  await external.route('https://external.example/**', route => route.fulfill({ contentType: 'text/html', body: '<p>External page</p>' }));
  await external.goto('https://external.example/');
  await external.evaluate(() => { window.__delivered = false; window.addEventListener('sutra-dashboard', () => window.__delivered = true); });
  await external.evaluate(script => (0, eval)(script), delivery(context));
  assert.equal(await external.evaluate(() => window.__delivered), false, 'A different document cannot receive dashboard records after navigation');
  console.log('PASS: bookmark/open-tab actions, customization/reset, reload persistence, dark/light, four widths, untrusted titles/URLs, private-data clearing, no remote requests, navigation-race delivery guard.');
} finally { await browser.close(); }
