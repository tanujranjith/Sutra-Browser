import { expect, test } from '@playwright/test';
import { readFileSync } from 'node:fs';

// Opt-in, credential-safe live-project certification for conflict behaviour.
// The operator enters OTPs and vault passphrases only in headed browser
// windows. This test never reads or exports auth tokens or vault material.
//
// PowerShell:
//   $env:SUTRA_REAL_CONFLICT_CERTIFY='1'
//   $env:SUTRA_REAL_SUPABASE_URL='https://your-staging-ref.supabase.co'
//   $env:SUTRA_REAL_SUPABASE_ANON_KEY='<staging publishable or anon key>'
//   npx playwright test tests/e2e/real-supabase-conflict-certification.spec.mjs --project=chromium --workers=1 --headed

const RUN_REAL = process.env.SUTRA_REAL_CONFLICT_CERTIFY === '1';
const BASE_URL = process.env.SUTRA_REAL_BASE_URL || 'http://127.0.0.1:5173/Sutra.html';
const PRODUCTION_PROJECT_URL = 'https://blfsmdyvdlhabltiicgx.supabase.co';
const PROJECT_URL = String(process.env.SUTRA_REAL_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const PROJECT_ANON_KEY = String(process.env.SUTRA_REAL_SUPABASE_ANON_KEY || '').trim();
const AUTOMATED_ACCOUNT_EMAIL = String(process.env.SUTRA_REAL_ACCOUNT_A_EMAIL || '').trim();
const AUTOMATED_ACCOUNT_PASSWORD = String(process.env.SUTRA_REAL_ACCOUNT_A_PASSWORD || '');
const AUTOMATED_VAULT_PASSPHRASE = String(process.env.SUTRA_REAL_VAULT_PASSPHRASE || '');
const AUTOMATED_AUTH = !!(AUTOMATED_ACCOUNT_EMAIL && AUTOMATED_ACCOUNT_PASSWORD && AUTOMATED_VAULT_PASSPHRASE);
const SHELL_SOURCE = readFileSync(new URL('../../Sutra.html', import.meta.url), 'utf8');
const WORKER_SOURCE = readFileSync(new URL('../../sw.js', import.meta.url), 'utf8');
const MIGRATIONS_SOURCE = readFileSync(new URL('../../src/core/migrations.js', import.meta.url), 'utf8');
const EXPECTED_WORKSPACE_SCHEMA = Number((MIGRATIONS_SOURCE.match(/\bCURRENT_VERSION\s*=\s*(\d+)/) || [])[1]);

function currentScriptStamp(path) {
  const escaped = path.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const match = SHELL_SOURCE.match(new RegExp(`${escaped}\\?v=([^"']+)`));
  if (!match) throw new Error(`Could not resolve the current cache stamp for ${path}.`);
  return match[1];
}

const EXPECTED_STAMPS = {
  app: currentScriptStamp('src/core/app.js'),
  merge: currentScriptStamp('src/sync/sync-merge.js'),
  engine: currentScriptStamp('src/sync/sync-engine.js'),
  serviceWorker: (WORKER_SOURCE.match(/const CACHE_VERSION = `\$\{CACHE_FAMILY\}([^`]+)`/) || [])[1] || ''
};

test.skip(!RUN_REAL, 'Set SUTRA_REAL_CONFLICT_CERTIFY=1 for manual real-Supabase certification.');

if (RUN_REAL) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(PROJECT_URL)) {
    throw new Error('SUTRA_REAL_SUPABASE_URL must name the disposable staging Supabase project.');
  }
  if (!PROJECT_ANON_KEY) {
    throw new Error('SUTRA_REAL_SUPABASE_ANON_KEY must contain the staging publishable/anon key.');
  }
  if (PROJECT_URL.toLowerCase() === PRODUCTION_PROJECT_URL.toLowerCase()) {
    throw new Error('Live conflict certification refuses to target the production Supabase project.');
  }
  if (!EXPECTED_STAMPS.serviceWorker) {
    throw new Error('Could not resolve the current service-worker cache stamp.');
  }
  if (!Number.isInteger(EXPECTED_WORKSPACE_SCHEMA) || EXPECTED_WORKSPACE_SCHEMA < 1) {
    throw new Error('Could not resolve the current workspace schema version.');
  }
}

async function completeOnboarding(page) {
  await page.evaluate(() => {
    try { window.markStudentOnboardingCompleted(true); } catch (error) {}
    const overlay = document.getElementById('studentOnboardingOverlay');
    if (overlay) {
      overlay.classList.remove('active');
      overlay.hidden = true;
      overlay.style.setProperty('display', 'none', 'important');
    }
  });
}

async function installAutomatedPasswordSession(page) {
  const session = await page.evaluate(async ({ email, password, projectUrl, anonKey }) => {
    const response = await fetch(projectUrl + '/auth/v1/token?grant_type=password', {
      method: 'POST',
      headers: { apikey: anonKey, 'content-type': 'application/json' },
      body: JSON.stringify({ email, password })
    });
    const json = await response.json().catch(() => null);
    if (!response.ok || !json?.access_token || !json?.refresh_token || !json?.user?.id) {
      throw new Error('The automated staging password sign-in could not establish a session.');
    }
    return {
      accessToken: String(json.access_token),
      refreshToken: String(json.refresh_token),
      expiresAtMs: Date.now() + Math.max(0, Number(json.expires_in || 3600) * 1000 - 60000),
      user: { id: String(json.user.id), email: String(json.user.email || '') }
    };
  }, {
    email: AUTOMATED_ACCOUNT_EMAIL,
    password: AUTOMATED_ACCOUNT_PASSWORD,
    projectUrl: PROJECT_URL,
    anonKey: PROJECT_ANON_KEY
  });
  await page.evaluate(value => {
    sessionStorage.setItem('sutra:supabaseSession:v1', JSON.stringify(value));
  }, session);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await expect.poll(
    () => page.evaluate(() => window.SutraCloudSync?.isSignedIn() === true).catch(() => false),
    { timeout: 30000, intervals: [250, 500, 1000] }
  ).toBe(true);
}

async function enableAutomatedSync(page) {
  await page.evaluate(({ passphrase, endpoint }) => window.SutraSync.enable({ passphrase, endpoint }), {
    passphrase: AUTOMATED_VAULT_PASSPHRASE,
    endpoint: PROJECT_URL
  });
}

async function unlockAutomatedSync(page) {
  await expect.poll(
    () => page.evaluate(() => window.SutraSync.status().enabled === true).catch(() => false),
    { timeout: 30000, intervals: [250, 500, 1000] }
  ).toBe(true);
  await page.evaluate(passphrase => window.SutraSync.unlock(passphrase), AUTOMATED_VAULT_PASSPHRASE);
}

async function showBanner(page, label, message, openSync = true) {
  await page.evaluate(({ label, message, openSync }) => {
    let banner = document.getElementById('sutraRealConflictCertificationBanner');
    if (!banner) {
      banner = document.createElement('aside');
      banner.id = 'sutraRealConflictCertificationBanner';
      banner.setAttribute('role', 'status');
      Object.assign(banner.style, {
        position: 'fixed', top: '8px', left: '50%', transform: 'translateX(-50%)',
        zIndex: '2147483646', maxWidth: '760px', padding: '12px 16px',
        border: '2px solid #2563eb', borderRadius: '12px', background: '#eff6ff',
        color: '#111827', font: '600 14px/1.45 system-ui, sans-serif',
        boxShadow: '0 10px 30px rgba(0,0,0,.24)', pointerEvents: 'none'
      });
      document.body.appendChild(banner);
    }
    banner.textContent = label + ': ' + message;
    document.title = label + ' — Sutra live conflict certification';
    if (openSync && typeof window.openSutraSyncModal === 'function') {
      try { window.openSutraSyncModal(); } catch (error) {}
    }
  }, { label, message, openSync });
}

async function hideBanner(page) {
  await page.evaluate(automated => {
    document.getElementById('sutraRealConflictCertificationBanner')?.remove();
    if (automated && typeof window.closeSutraSyncModal === 'function') window.closeSutraSyncModal();
  }, AUTOMATED_AUTH);
}

async function openDevice(browser, label) {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  const blockedProductionRequests = [];
  await context.route(`${PRODUCTION_PROJECT_URL}/**`, route => {
    blockedProductionRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  await page.goto(BASE_URL, { waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  await page.evaluate(async ({ url, anonKey }) => {
    await window.SutraCloudSync.switchBackend({
      mode: 'custom',
      customSupabaseUrl: url,
      customSupabaseAnonKey: anonKey
    });
    const active = window.SutraCloudSync.getActiveConfig();
    if (active?.mode !== 'custom' || active?.url !== url || active?.configured !== true) {
      throw new Error('The live conflict browser did not bind to the staging Supabase project.');
    }
  }, { url: PROJECT_URL, anonKey: PROJECT_ANON_KEY });
  if (blockedProductionRequests.length) {
    throw new Error('The live conflict browser attempted to contact the production Supabase project.');
  }
  if (AUTOMATED_AUTH) await installAutomatedPasswordSession(page);
  await showBanner(page, label, 'Sign in with the shared test account, enable sync, and unlock the existing vault.');
  return { context, page, label, blockedProductionRequests };
}

async function syncReady(page) {
  return page.evaluate(() => {
    const status = window.SutraSync.status();
    const blocked = ['disabled', 'locked', 'paused', 'auth-expired', 'schema-mismatch', 'protocol-mismatch', 'encryption-error'];
    return window.SutraCloudSync.isSignedIn() === true && status.enabled === true && !blocked.includes(status.state);
  }).catch(() => false);
}

async function waitForSyncReady(page, timeout = 15 * 60 * 1000) {
  await expect.poll(() => syncReady(page), { timeout, intervals: [1000, 2000, 3000] }).toBe(true);
}

async function syncNow(page) {
  return page.evaluate(async () => {
    const result = await window.SutraSync.syncNow();
    return {
      pushed: Number(result?.pushed) || 0,
      pulled: Number(result?.pulled) || 0,
      conflicts: Number(result?.conflicts) || 0,
      error: result?.error ? String(result.error) : ''
    };
  });
}

async function settle(A, B, rounds = 4) {
  await Promise.all([
    A.page.evaluate(() => window.SutraSync.resume()),
    B.page.evaluate(() => window.SutraSync.resume())
  ]);
  for (let index = 0; index < rounds; index += 1) {
    const a = await syncNow(A.page);
    const b = await syncNow(B.page);
    expect(a.error).toBe('');
    expect(b.error).toBe('');
  }
}

async function runtimeIdentity(page) {
  return page.evaluate(async () => {
    const resources = performance.getEntriesByType('resource').map(row => row.name);
    const pick = pattern => resources.filter(url => pattern.test(url)).sort();
    const registration = await navigator.serviceWorker?.getRegistration().catch(() => null);
    const workerUrl = registration?.active?.scriptURL || '';
    const swText = workerUrl ? await fetch(workerUrl, { cache: 'no-store' }).then(row => row.text()).catch(() => '') : '';
    return {
      url: location.href,
      app: pick(/\/src\/core\/app\.js\?/),
      merge: pick(/\/src\/sync\/sync-merge\.js\?/),
      engine: pick(/\/src\/sync\/sync-engine\.js\?/),
      schema: Number(window.SutraMigrations?.CURRENT_VERSION) || 0,
      protocol: Number(window.SutraSyncProtocol?.PROTOCOL_VERSION) || 0,
      serviceWorker: workerUrl,
      // The worker deliberately composes CACHE_VERSION from CACHE_FAMILY so
      // cache-family invalidation and the exact version stamp remain visible.
      // Read that real declaration; CACHE_NAME has never been a worker API.
      serviceWorkerCache: (swText.match(/const CACHE_VERSION = `\$\{CACHE_FAMILY\}([^`]+)/) || [])[1] || ''
    };
  });
}

async function typeNoteBody(page, paragraphs) {
  const handle = await page.waitForFunction(() => {
    const v2 = document.querySelector('#editorV2Host .ProseMirror');
    const classic = document.getElementById('editor');
    const visible = node => !!node && getComputedStyle(node).display !== 'none'
      && getComputedStyle(node).visibility !== 'hidden' && node.getClientRects().length > 0;
    if (visible(v2) && v2.isContentEditable) return v2;
    if (visible(classic) && classic.isContentEditable) return classic;
    return null;
  }, null, { timeout: 10000 });
  const editor = handle.asElement();
  if (!editor || !(await editor.isEditable())) throw new Error('No visible editable Notes editor.');
  await editor.focus();
  await page.keyboard.press('Control+A');
  await page.keyboard.press('Backspace');
  for (let index = 0; index < paragraphs.length; index += 1) {
    if (index) await page.keyboard.press('Enter');
    await page.keyboard.insertText(paragraphs[index]);
  }
  await page.evaluate(async () => {
    window.savePage();
    await window.flowAtelier.flushAppSaveNow('real-conflict-certification-editor');
  });
}

async function openNotes(page) {
  if (!await page.evaluate(() => document.getElementById('view-notes')?.classList.contains('active'))) {
    await page.locator('button.view-tab[data-view="notes"]:visible').first().click();
    await page.waitForFunction(() => document.getElementById('view-notes')?.classList.contains('active'));
  }
}

async function createPage(page, title, paragraphs) {
  await openNotes(page);
  await page.locator('button.new-page-btn:visible').first().click();
  await page.fill('#newPageName', title);
  await page.click('#newPageModal button.btn-primary');
  await page.waitForFunction(expected => document.querySelector('#pageTitle')?.value === expected, title);
  await typeNoteBody(page, paragraphs);
  return page.evaluate(() => window.flowAtelier.currentPageId);
}

async function editPage(page, id, options) {
  await openNotes(page);
  if (await page.evaluate(() => window.flowAtelier.currentPageId) !== id) {
    await page.locator(`.page-item[data-page-id="${id}"]`).click();
    await page.waitForFunction(expected => window.flowAtelier.currentPageId === expected, id);
  }
  if (options.title !== undefined) {
    await page.fill('#pageTitle', options.title);
    await page.locator('#pageTitle').dispatchEvent('input');
  }
  if (options.paragraphs) await typeNoteBody(page, options.paragraphs);
  else {
    await page.evaluate(async () => {
      window.savePage();
      await window.flowAtelier.flushAppSaveNow('real-conflict-certification-title');
    });
  }
}

async function readPage(page, id) {
  return page.evaluate(pageId => {
    const workspace = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    return (workspace.pages || []).find(row => row.id === pageId) || null;
  }, id);
}

async function waitForPage(page, id, predicate, timeout = 90000) {
  await expect.poll(async () => {
    await syncNow(page);
    return predicate(await readPage(page, id));
  }, { timeout, intervals: [700, 1200, 2000] }).toBe(true);
}

async function cleanupSynthetic(A, B, ids) {
  for (const device of [A, B]) {
    if (!device || device.page.isClosed()) continue;
    await device.page.evaluate(async pageIds => {
      const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      payload.pages = (payload.pages || []).filter(row => !pageIds.includes(row?.id));
      if (payload.ordering?.pages) payload.ordering.pages = payload.ordering.pages.filter(id => !pageIds.includes(id));
      window.deserializeWorkspace(payload);
      await window.saveWorkspaceLocally();
    }, ids).catch(() => undefined);
  }
  if (A && B && !A.page.isClosed() && !B.page.isClosed()) await settle(A, B, 3).catch(() => undefined);
}

test('real Supabase Notes UI converges ordinary edits and creates one hidden conflict for overlap', async ({ browser }) => {
  test.setTimeout(45 * 60 * 1000);
  const marker = Date.now().toString(36);
  const A = await openDevice(browser, 'Device A');
  const B = await openDevice(browser, 'Device B');
  const ids = [];
  try {
    if (AUTOMATED_AUTH) {
      await enableAutomatedSync(A.page);
      await enableAutomatedSync(B.page);
    }
    await Promise.all([waitForSyncReady(A.page), waitForSyncReady(B.page)]);
    await Promise.all([hideBanner(A.page), hideBanner(B.page)]);

    const [runtimeA, runtimeB] = await Promise.all([runtimeIdentity(A.page), runtimeIdentity(B.page)]);
    expect(runtimeA).toEqual(runtimeB);
    expect(runtimeA.url).toContain('127.0.0.1:5173/Sutra.html');
    expect(runtimeA.app.join(' ')).toContain(EXPECTED_STAMPS.app);
    expect(runtimeA.merge.join(' ')).toContain(EXPECTED_STAMPS.merge);
    expect(runtimeA.engine.join(' ')).toContain(EXPECTED_STAMPS.engine);
    expect(runtimeA.serviceWorkerCache).toContain(EXPECTED_STAMPS.serviceWorker);
    expect(runtimeA.schema).toBe(EXPECTED_WORKSPACE_SCHEMA);
    expect(runtimeA.protocol).toBe(1);
    console.log('LIVE_RUNTIME_IDENTITY', JSON.stringify(runtimeA));

    await settle(A, B, 4);
    const idleBefore = await Promise.all([A.page, B.page].map(page => page.evaluate(async () => {
      const ws = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      return { pages: (ws.pages || []).map(row => row.id).sort(), conflicts: (await window.SutraSync.listConflicts()).map(row => row.id).sort() };
    })));
    await settle(A, B, 5);
    const idleAfter = await Promise.all([A.page, B.page].map(page => page.evaluate(async () => {
      const ws = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      return { pages: (ws.pages || []).map(row => row.id).sort(), conflicts: (await window.SutraSync.listConflicts()).map(row => row.id).sort() };
    })));
    expect(idleAfter).toEqual(idleBefore);

    const title = `SYNC-CONFLICT-CERT-${marker}`;
    const pageId = await createPage(A.page, title, ['paragraph one', 'paragraph two', 'paragraph three']);
    ids.push(pageId);
    await settle(A, B, 4);
    await waitForPage(B.page, pageId, row => !!row && row.title === title);

    // Different fields: random version-history checkpoints must not turn this
    // title/body pair into a page copy.
    await Promise.all([A.context.setOffline(true), B.context.setOffline(true)]);
    await editPage(A.page, pageId, { title: `${title}-RENAMED` });
    await editPage(B.page, pageId, { paragraphs: ['paragraph one', 'paragraph two from B', 'paragraph three'] });
    await Promise.all([A.context.setOffline(false), B.context.setOffline(false)]);
    await settle(A, B, 5);
    for (const device of [A, B]) {
      const row = await readPage(device.page, pageId);
      expect(row.title).toBe(`${title}-RENAMED`);
      expect(row.content).toContain('paragraph two from B');
    }

    // Different top-level blocks merge automatically.
    await Promise.all([A.context.setOffline(true), B.context.setOffline(true)]);
    await editPage(A.page, pageId, { paragraphs: ['paragraph one from A', 'paragraph two from B', 'paragraph three'] });
    await editPage(B.page, pageId, { paragraphs: ['paragraph one', 'paragraph two from B', 'paragraph three from B'] });
    await Promise.all([A.context.setOffline(false), B.context.setOffline(false)]);
    await settle(A, B, 5);
    for (const device of [A, B]) {
      const row = await readPage(device.page, pageId);
      expect(row.content).toContain('paragraph one from A');
      expect(row.content).toContain('paragraph three from B');
    }

    // Same-block overlap yields exactly one encrypted review item, never a
    // normal sidebar page, and replay does not multiply it.
    await Promise.all([A.context.setOffline(true), B.context.setOffline(true)]);
    await editPage(A.page, pageId, { paragraphs: ['paragraph one from A', 'overlap from A', 'paragraph three from B'] });
    await editPage(B.page, pageId, { paragraphs: ['paragraph one from A', 'overlap from B', 'paragraph three from B'] });
    await Promise.all([A.context.setOffline(false), B.context.setOffline(false)]);
    await settle(A, B, 6);
    const recordKey = `c/pages/${encodeURIComponent(pageId)}`;
    const review = await B.page.evaluate(async key => (await window.SutraSync.listConflicts()).filter(row => row.recordKey === key), recordKey);
    expect(review).toHaveLength(1);
    expect(review[0].type).toBe('page-content-conflict');
    for (const device of [A, B]) {
      const rows = await device.page.evaluate(() => window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).pages || []);
      expect(rows.filter(row => row.id === pageId)).toHaveLength(1);
      expect(rows.filter(row => /conflict copy/i.test(String(row.title)))).toHaveLength(0);
    }
    await settle(A, B, 5);
    const replayed = await B.page.evaluate(async key => (await window.SutraSync.listConflicts()).filter(row => row.recordKey === key), recordKey);
    expect(replayed).toHaveLength(1);

    await B.page.evaluate(id => window.SutraSync.resolveConflict(id, 'keep-merged'), review[0].id);
    await settle(A, B, 5);
    expect(await A.page.evaluate(async key => (await window.SutraSync.listConflicts()).filter(row => row.recordKey === key), recordKey)).toHaveLength(0);
    expect(await B.page.evaluate(async key => (await window.SutraSync.listConflicts()).filter(row => row.recordKey === key), recordKey)).toHaveLength(0);

    // Reload both local installations. Vault material is memory-only, so the
    // operator may need to unlock each page again; the banner never requests
    // the passphrase through the test runner.
    await Promise.all([A.page.reload({ waitUntil: 'domcontentloaded' }), B.page.reload({ waitUntil: 'domcontentloaded' })]);
    await Promise.all([
      A.page.waitForSelector('#fileInput', { state: 'attached' }),
      B.page.waitForSelector('#fileInput', { state: 'attached' })
    ]);
    await Promise.all([completeOnboarding(A.page), completeOnboarding(B.page)]);
    if (AUTOMATED_AUTH) {
      await Promise.all([unlockAutomatedSync(A.page), unlockAutomatedSync(B.page)]);
    }
    await Promise.all([
      showBanner(A.page, A.label, 'Unlock this vault after reload if prompted.'),
      showBanner(B.page, B.label, 'Unlock this vault after reload if prompted.')
    ]);
    await Promise.all([waitForSyncReady(A.page), waitForSyncReady(B.page)]);
    await Promise.all([hideBanner(A.page), hideBanner(B.page)]);
    await settle(A, B, 4);
    for (const device of [A, B]) {
      expect((await readPage(device.page, pageId))?.title).toBe(`${title}-RENAMED`);
      expect(await device.page.evaluate(async key => (await window.SutraSync.listConflicts()).filter(row => row.recordKey === key), recordKey)).toHaveLength(0);
    }
  } finally {
    await cleanupSynthetic(A, B, ids);
    await Promise.allSettled([A.context.close(), B.context.close()]);
  }
});
