import { expect, test } from '@playwright/test';

// Credential-safe live-project certification. Manual mode keeps OTPs and vault
// passphrases inside headed browser windows; optional automation reads them from
// process environment variables and passes them only to isolated page memory.
// The test never logs, exports, or writes credentials or auth tokens to disk.
//
// PowerShell:
//   $env:SUTRA_REAL_CERTIFY='1'
//   $env:SUTRA_REAL_SUPABASE_URL='https://your-staging-ref.supabase.co'
//   $env:SUTRA_REAL_SUPABASE_ANON_KEY='<staging publishable or anon key>'
//   npx playwright test tests/e2e/real-supabase-certification.spec.mjs --project=chromium --workers=1 --headed

const RUN_REAL = process.env.SUTRA_REAL_CERTIFY === '1';
const BASE_URL = process.env.SUTRA_REAL_BASE_URL || 'http://127.0.0.1:5173/Sutra.html';
const PRODUCTION_PROJECT_URL = 'https://blfsmdyvdlhabltiicgx.supabase.co';
const PROJECT_URL = String(process.env.SUTRA_REAL_SUPABASE_URL || '').trim().replace(/\/+$/, '');
const PROJECT_ANON_KEY = String(process.env.SUTRA_REAL_SUPABASE_ANON_KEY || '').trim();
const AUTOMATED_ACCOUNT_A_EMAIL = String(process.env.SUTRA_REAL_ACCOUNT_A_EMAIL || '').trim();
const AUTOMATED_ACCOUNT_A_PASSWORD = String(process.env.SUTRA_REAL_ACCOUNT_A_PASSWORD || '');
const AUTOMATED_ACCOUNT_B_EMAIL = String(process.env.SUTRA_REAL_ACCOUNT_B_EMAIL || '').trim();
const AUTOMATED_ACCOUNT_B_PASSWORD = String(process.env.SUTRA_REAL_ACCOUNT_B_PASSWORD || '');
const AUTOMATED_VAULT_PASSPHRASE = String(process.env.SUTRA_REAL_VAULT_PASSPHRASE || '');
const AUTOMATED_AUTH = !!(
  AUTOMATED_ACCOUNT_A_EMAIL && AUTOMATED_ACCOUNT_A_PASSWORD
  && AUTOMATED_ACCOUNT_B_EMAIL && AUTOMATED_ACCOUNT_B_PASSWORD
  && AUTOMATED_VAULT_PASSPHRASE
);
const REQUIRED_DATABASES = [
  'noteflow_atelier_db',
  'noteflow_attachments_db',
  'sutra_sync_db',
  'sutra-drive-sync-keys',
  'sutra-fs-config',
  'sutra_share_target_db'
];

test.skip(!RUN_REAL, 'Set SUTRA_REAL_CERTIFY=1 for manual real-Supabase certification.');

if (RUN_REAL) {
  if (!/^https:\/\/[a-z0-9-]+\.supabase\.co$/i.test(PROJECT_URL)) {
    throw new Error('SUTRA_REAL_SUPABASE_URL must name the disposable staging Supabase project.');
  }
  if (!PROJECT_ANON_KEY) {
    throw new Error('SUTRA_REAL_SUPABASE_ANON_KEY must contain the staging publishable/anon key.');
  }
  if (PROJECT_URL.toLowerCase() === PRODUCTION_PROJECT_URL.toLowerCase()) {
    throw new Error('Live certification refuses to target the production Supabase project.');
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

async function exchangeAutomatedPassword(page, email, password) {
  return page.evaluate(async ({ email, password, projectUrl, anonKey }) => {
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
    email,
    password,
    projectUrl: PROJECT_URL,
    anonKey: PROJECT_ANON_KEY
  });
}

async function installAutomatedSession(page, session) {
  await page.evaluate(value => {
    sessionStorage.setItem('sutra:supabaseSession:v1', JSON.stringify(value));
  }, session);
  await page.reload({ waitUntil: 'domcontentloaded' });
  await page.waitForSelector('#fileInput', { state: 'attached' });
  await completeOnboarding(page);
  const active = await page.evaluate(() => window.SutraCloudSync.getActiveConfig());
  if (active?.url !== PROJECT_URL || active?.configured !== true) {
    throw new Error('The automated staging session did not reload on the staging Supabase project.');
  }
  await expect.poll(
    () => page.evaluate(() => window.SutraCloudSync?.isSignedIn() === true).catch(() => false),
    { timeout: 30000, intervals: [250, 500, 1000] }
  ).toBe(true);
}

async function installAutomatedPasswordSession(page, email, password) {
  await installAutomatedSession(page, await exchangeAutomatedPassword(page, email, password));
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
    let banner = document.getElementById('sutraRealCertificationBanner');
    if (!banner) {
      banner = document.createElement('aside');
      banner.id = 'sutraRealCertificationBanner';
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
    document.title = label + ' — Sutra real certification';
    if (openSync && typeof window.openSutraSyncModal === 'function') {
      try { window.openSutraSyncModal(); } catch (error) {}
    }
  }, { label, message, openSync });
}

async function hideBanner(page) {
  await page.evaluate(automated => {
    document.getElementById('sutraRealCertificationBanner')?.remove();
    if (automated && typeof window.closeSutraSyncModal === 'function') {
      window.closeSutraSyncModal();
    }
  }, AUTOMATED_AUTH);
}

function logLivePhase(phase) {
  console.log('[live-cert]', phase);
}

async function openDevice(browser, label, automatedAccount = '') {
  const context = await browser.newContext({ viewport: { width: 1280, height: 900 }, acceptDownloads: true });
  await context.addInitScript(({ url, anonKey }) => {
    window.SUTRA_CONFIG = {
      ...(window.SUTRA_CONFIG || {}),
      supabaseUrl: url,
      supabaseAnonKey: anonKey
    };
  }, { url: PROJECT_URL, anonKey: PROJECT_ANON_KEY });
  const blockedProductionRequests = [];
  await context.route(`${PRODUCTION_PROJECT_URL}/**`, route => {
    blockedProductionRequests.push(route.request().url());
    return route.abort('blockedbyclient');
  });
  const page = await context.newPage();
  const pageUrl = AUTOMATED_AUTH && automatedAccount === 'a' && /Device B/.test(label)
    ? BASE_URL.replace('127.0.0.1', 'localhost')
    : BASE_URL;
  await page.goto(pageUrl, { waitUntil: 'domcontentloaded' });
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
      throw new Error('The live certification browser did not bind to the staging Supabase project.');
    }
  }, { url: PROJECT_URL, anonKey: PROJECT_ANON_KEY });
  if (blockedProductionRequests.length) {
    throw new Error('The live certification browser attempted to contact the production Supabase project.');
  }
  if (AUTOMATED_AUTH && automatedAccount === 'a') {
    await installAutomatedPasswordSession(page, AUTOMATED_ACCOUNT_A_EMAIL, AUTOMATED_ACCOUNT_A_PASSWORD);
  }
  if (AUTOMATED_AUTH && automatedAccount === 'b') {
    await installAutomatedPasswordSession(page, AUTOMATED_ACCOUNT_B_EMAIL, AUTOMATED_ACCOUNT_B_PASSWORD);
  }
  await showBanner(page, label, 'Preparing authentication controls…');
  return { context, page, label, pageUrl, blockedProductionRequests };
}

async function identityDigest(page) {
  return page.evaluate(async () => {
    const provider = window.SutraCloudSync.getActiveProvider();
    const identity = String(provider?.identity || '');
    if (!identity) return '';
    const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(identity.toLowerCase()));
    return Array.from(new Uint8Array(digest), value => value.toString(16).padStart(2, '0')).join('');
  });
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

async function waitForSignedIn(page, timeout = 15 * 60 * 1000) {
  await expect.poll(
    () => page.evaluate(() => window.SutraCloudSync.isSignedIn() === true).catch(() => false),
    { timeout, intervals: [1000, 2000, 3000] }
  ).toBe(true);
}

async function syncNow(page) {
  return page.evaluate(async () => {
    const outcome = await window.SutraSync.syncNow();
    return {
      applied: outcome?.applied === true,
      pushed: Number(outcome?.pushed) || 0,
      pulled: Number(outcome?.pulled) || 0,
      conflicts: Number(outcome?.conflicts) || 0,
      error: outcome?.error ? String(outcome.error) : '',
      skipped: outcome?.skipped === true,
      reason: String(outcome?.reason || '')
    };
  });
}

async function syncUntil(page, predicate, timeout = 60000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  let lastOutcome = null;
  while (Date.now() < deadline) {
    try {
      const outcome = await syncNow(page);
      lastOutcome = outcome;
      if (outcome.error) lastError = new Error(outcome.error);
      if (await predicate()) return true;
    } catch (error) { lastError = error; }
    await page.waitForTimeout(1200);
  }
  throw lastError || new Error('Timed out waiting for synchronized state. Last outcome: ' + JSON.stringify(lastOutcome));
}

async function readConvergenceState(page, ids, conversationId) {
  return page.evaluate(({ ids, conversationId }) => {
    const workspace = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const assistantChatHistory = window.__sutraPublicBetaTestHooks.syncParity.getAssistantChatHistory();
    const conversation = assistantChatHistory.conversations.find(row => row.id === conversationId);
    const status = window.SutraSync.status();
    return {
      note: workspace.pages.some(row => row.id === ids.note),
      task: workspace.tasks.some(row => row.id === ids.task),
      file: workspace.courseWorkspace.files.some(row => row.id === ids.file),
      conversation: !!conversation,
      conversationCount: assistantChatHistory.conversations.length,
      messageCount: conversation?.messages?.length || 0,
      syncState: status.state,
      syncError: status.lastError || ''
    };
  }, { ids, conversationId });
}

async function readAssistantSyncInternals(page, conversationId) {
  return page.evaluate(async conversationId => {
    const session = JSON.parse(sessionStorage.getItem('sutra:supabaseSession:v1') || 'null');
    const accountId = String(session?.user?.id || '');
    const recordKey = window.SutraSyncProtocol.collectionKey('assistantConversations', conversationId);
    const portable = await window.__sutraPublicBetaTestHooks.syncParity.getPortableSnapshot();
    const projection = window.SutraSyncProjection.buildProjection(portable);
    const store = window.SutraSyncStore.create({ scope: accountId ? ('supabase:' + accountId) : 'unbound' });
    try {
      const [baseline, outbox] = await Promise.all([store.getBaseline(), store.getOutbox()]);
      return {
        projectionHasConversation: Object.hasOwn(projection.records || {}, recordKey),
        baselineHasConversation: Object.hasOwn(baseline?.records || {}, recordKey),
        outboxHasConversation: (outbox || []).some(row => row?.recordKey === recordKey),
        baselineCursor: Number(baseline?.cursor) || 0,
        projectedRecordCount: Object.keys(projection.records || {}).length,
        baselineRecordCount: Object.keys(baseline?.records || {}).length,
        outboxCount: (outbox || []).length,
        syncState: window.SutraSync.status().state,
        syncCycles: Number(window.SutraSync.status().cycles) || 0
      };
    } finally { store.close(); }
  }, conversationId);
}

async function waitForAssistantPush(page, conversationId, timeout = 120000) {
  const deadline = Date.now() + timeout;
  let lastOutcome = null;
  let lastInternals = null;
  while (Date.now() < deadline) {
    lastOutcome = await syncNow(page);
    lastInternals = await readAssistantSyncInternals(page, conversationId);
    if (lastInternals.baselineHasConversation && !lastInternals.outboxHasConversation) {
      return { outcome: lastOutcome, internals: lastInternals };
    }
    await page.waitForTimeout(800);
  }
  throw new Error('Assistant record remained unacknowledged on its source device: ' + JSON.stringify({
    outcome: lastOutcome,
    internals: lastInternals
  }));
}

async function revokeDeviceEventually(page, targetDeviceId, timeout = 30000) {
  const deadline = Date.now() + timeout;
  let lastError = null;
  while (Date.now() < deadline) {
    try {
      const revoked = await page.evaluate(target => window.SutraSync.revokeDevice(target), targetDeviceId);
      if (revoked === true) return true;
      lastError = new Error('The staging revoke RPC returned false.');
    } catch (error) { lastError = error; }
    await page.waitForTimeout(1000);
  }
  throw lastError || new Error('Timed out revoking the staging test device.');
}

async function getDeviceId(page) {
  return page.evaluate(async () => {
    const session = JSON.parse(sessionStorage.getItem('sutra:supabaseSession:v1') || 'null');
    const accountId = String(session?.user?.id || '');
    const store = window.SutraSyncStore.create({
      scope: accountId ? ('supabase:' + accountId) : 'unbound'
    });
    try { return await store.getMeta('deviceId'); }
    finally { store.close(); }
  });
}

function installCipherAudit(context, sentinels) {
  const entries = [];
  const pending = [];
  const storagePaths = [];
  const relevant = url => /\/rest\/v1\/rpc\/sync_(push|pull|put_snapshot|get_snapshot|put_asset|get_vault_key)|\/storage\/v1\/object\/sync-assets\//.test(url);
  const inspect = (direction, url, text) => {
    entries.push({
      direction,
      path: new URL(url).pathname,
      leaks: sentinels.filter(value => value && String(text || '').includes(value))
    });
    if (url.includes('/storage/v1/object/sync-assets/')) {
      const path = new URL(url).pathname.split('/storage/v1/object/sync-assets/')[1] || '';
      if (path) storagePaths.push(path);
    }
  };
  context.on('request', request => {
    if (relevant(request.url())) inspect('request', request.url(), request.postData() || '');
  });
  context.on('response', response => {
    if (!relevant(response.url())) return;
    pending.push(response.body()
      .then(body => inspect('response', response.url(), body.toString('utf8')))
      .catch(() => undefined));
  });
  return { entries, storagePaths, async settle() { await Promise.allSettled(pending.splice(0)); } };
}

// Reuses an authenticated backup-list request entirely inside the page, then
// rewrites its destination. Authorization headers never leave browser memory.
async function authenticatedProbe(page, spec) {
  return page.evaluate(async probe => {
    const originalFetch = window.fetch.bind(window);
    let matched = false;
    let resolveResult;
    const resultPromise = new Promise(resolve => { resolveResult = resolve; });
    const timeout = setTimeout(() => resolveResult({ status: 0, text: 'probe-timeout' }), 15000);
    window.fetch = async function (input, init = {}) {
      const sourceUrl = typeof input === 'string' ? input : input.url;
      if (!matched && sourceUrl.includes('/rest/v1/backup_index')) {
        matched = true;
        const headers = new Headers(init.headers || {});
        if (probe.body !== undefined) headers.set('content-type', 'application/json');
        try {
          const response = await originalFetch(probe.url, {
            ...init,
            method: probe.method || 'GET',
            headers,
            body: probe.body === undefined ? undefined : JSON.stringify(probe.body)
          });
          resolveResult({ status: response.status, text: (await response.clone().text()).slice(0, 5000) });
          return response;
        } catch (error) {
          resolveResult({ status: 0, text: String(error?.message || error) });
          throw error;
        } finally { window.fetch = originalFetch; }
      }
      return originalFetch(input, init);
    };
    try { await window.SutraCloudSync.listBackups(); } catch (error) {}
    const result = await resultPromise;
    clearTimeout(timeout);
    window.fetch = originalFetch;
    return result;
  }, spec);
}

function parseJson(text) {
  try { return JSON.parse(text); } catch (error) { return null; }
}

async function storageAudit(page) {
  return page.evaluate(async () => ({
    localKeys: Object.keys(localStorage).sort(),
    sessionKeys: Object.keys(sessionStorage).sort(),
    databases: typeof indexedDB.databases === 'function'
      ? (await indexedDB.databases()).map(row => row.name).filter(Boolean).sort()
      : [],
    visibleText: document.body?.innerText.slice(0, 20000) || ''
  }));
}

async function cleanupCertificationData(page, ids, conversationId) {
  await page.evaluate(async ({ ids, conversationId }) => {
    const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
    const hooks = window.__sutraPublicBetaTestHooks;
    const assistantChatHistory = hooks.syncParity.getAssistantChatHistory();
    payload.pages = (payload.pages || []).filter(row => row?.id !== ids.note);
    payload.tasks = (payload.tasks || []).filter(row => row?.id !== ids.task);
    payload.taskOrder = (payload.taskOrder || []).filter(id => id !== ids.task);
    if (payload.courseWorkspace) {
      payload.courseWorkspace.courses = (payload.courseWorkspace.courses || []).filter(row => row?.id !== ids.course);
      payload.courseWorkspace.files = (payload.courseWorkspace.files || []).filter(row => row?.id !== ids.file);
    }
    assistantChatHistory.conversations = (assistantChatHistory.conversations || [])
      .filter(row => row?.id !== conversationId);
    if (assistantChatHistory.currentChatId === conversationId) assistantChatHistory.currentChatId = '';
    if (payload.assistantMemory) {
      payload.assistantMemory.items = (payload.assistantMemory.items || []).filter(row => row?.id !== ids.memory);
    }
    window.deserializeWorkspace(payload);
    hooks.syncParity.setAssistantChatHistory(assistantChatHistory);
    await window.saveWorkspaceLocally();
    await new Promise((resolve, reject) => {
      const request = indexedDB.open('noteflow_attachments_db', 1);
      request.onerror = () => reject(request.error || new Error('Could not open the attachment database for cleanup.'));
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('blobs')) request.result.createObjectStore('blobs');
      };
      request.onsuccess = () => {
        const db = request.result;
        const tx = db.transaction('blobs', 'readwrite');
        tx.objectStore('blobs').delete(ids.blob);
        tx.oncomplete = () => { db.close(); resolve(); };
        tx.onerror = () => { db.close(); reject(tx.error || new Error('Attachment cleanup failed.')); };
        tx.onabort = () => { db.close(); reject(tx.error || new Error('Attachment cleanup aborted.')); };
      };
    });
  }, { ids, conversationId });
}

test('real Supabase Assistant, RLS, payload, revocation, and wipe certification', async ({ browser }) => {
  test.setTimeout(30 * 60 * 1000);
  const runId = Date.now().toString(36);
  const ids = {
    note: 'real-cert-note-' + runId,
    task: 'real-cert-task-' + runId,
    course: 'real-cert-course-' + runId,
    file: 'real-cert-file-' + runId,
    blob: 'real-cert-blob-' + runId,
    memory: 'real-cert-memory-' + runId
  };
  const sentinels = {
    note: 'SUTRA_REAL_NOTE_' + runId,
    assistant: 'SUTRA_REAL_ASSISTANT_' + runId,
    attachment: 'SUTRA_REAL_ATTACHMENT_' + runId,
    fileName: 'real-certification-' + runId + '.txt'
  };
  const attachmentDataUrl = 'data:text/plain;base64,' + Buffer.from(sentinels.attachment, 'utf8').toString('base64');
  const inlinePixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=';

  const A1 = await openDevice(browser, 'Account A — Device A', 'a');
  const A2 = await openDevice(browser, 'Account A — Device B', 'a');
  const B = await openDevice(browser, 'Account B — hostile-isolation identity', 'b');
  let A2tab = null;
  let conversationId = '';
  let bDeviceId = '';
  let recordsSeeded = false;
  let cleanupComplete = false;

  try {
    logLivePhase('auth-and-sync-setup');
    if (AUTOMATED_AUTH) {
      await enableAutomatedSync(A1.page);
      await enableAutomatedSync(A2.page);
    }
    await Promise.all([
      showBanner(A1.page, A1.label, 'Sign in with Account A by email OTP, then unlock the existing sync vault.'),
      showBanner(A2.page, A2.label, 'Sign in with the SAME Account A by email OTP, then unlock the same sync vault.'),
      showBanner(B.page, B.label, 'Sign in with a DIFFERENT Account B by email OTP. Do not enable sync for this account.')
    ]);
    await Promise.all([waitForSyncReady(A1.page), waitForSyncReady(A2.page), waitForSignedIn(B.page)]);

    const [a1Identity, a2Identity, bIdentity] = await Promise.all([
      identityDigest(A1.page), identityDigest(A2.page), identityDigest(B.page)
    ]);
    expect(a1Identity).toBeTruthy();
    expect(a2Identity).toBe(a1Identity);
    expect(bIdentity).toBeTruthy();
    expect(bIdentity).not.toBe(a1Identity);
    await Promise.all([hideBanner(A1.page), hideBanner(A2.page), hideBanner(B.page)]);
    logLivePhase('identities-and-device-registration-verified');

    const config = await A1.page.evaluate(() => ({
      url: window.SUTRA_CONFIG.supabaseUrl,
      publishable: /^sb_publishable_/.test(String(window.SUTRA_CONFIG.supabaseAnonKey || '')),
      secretLike: /^sb_secret_/i.test(String(window.SUTRA_CONFIG.supabaseAnonKey || ''))
    }));
    expect(config).toEqual({ url: PROJECT_URL, publishable: true, secretLike: false });

    const a1DeviceId = await getDeviceId(A1.page);
    const a2DeviceId = await getDeviceId(A2.page);
    expect(a1DeviceId).toBeTruthy();
    expect(a2DeviceId).toBeTruthy();
    expect(a2DeviceId).not.toBe(a1DeviceId);
    const initialDevices = await A1.page.evaluate(() => window.SutraSync.listDevices());
    expect(initialDevices.some(row => row.deviceId === a1DeviceId)).toBe(true);
    expect(initialDevices.some(row => row.deviceId === a2DeviceId)).toBe(true);
    for (const row of initialDevices) {
      expect(Object.hasOwn(row, 'wipeRequired')).toBe(true);
      expect(Object.hasOwn(row, 'wipeAcknowledgedAt')).toBe(true);
    }

    const cipherAudit = installCipherAudit(A1.context, Object.values(sentinels));
    installCipherAudit(A2.context, Object.values(sentinels));
    await A1.page.evaluate(async ({ ids, sentinels, attachmentDataUrl, inlinePixel }) => {
      const base = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      const now = new Date().toISOString();
      const courseWorkspace = base.courseWorkspace || {};
      window.deserializeWorkspace({
        ...base,
        pages: [
          ...(base.pages || []).filter(row => row?.id !== ids.note),
          {
            id: ids.note, title: sentinels.note,
            content: '<p>' + sentinels.note + '</p><img alt="synthetic inline" src="' + inlinePixel + '">',
            blocks: [], icon: 'doc', collapsed: false, createdAt: now, updatedAt: now
          }
        ],
        tasks: [
          ...(base.tasks || []).filter(row => row?.id !== ids.task),
          { id: ids.task, title: sentinels.note + ' task', status: 'todo', priority: 'low', createdAt: now, updatedAt: now }
        ],
        taskOrder: [...(base.taskOrder || []).filter(id => id !== ids.task), ids.task],
        courseWorkspace: {
          ...courseWorkspace,
          courses: [
            ...(courseWorkspace.courses || []).filter(row => row?.id !== ids.course),
            { id: ids.course, name: 'Synthetic certification course', type: 'class', createdAt: now, updatedAt: now }
          ],
          files: [
            ...(courseWorkspace.files || []).filter(row => row?.id !== ids.file),
            {
              id: ids.file, courseId: ids.course, linkedEntityType: 'note', linkedEntityId: ids.note,
              name: sentinels.fileName, originalName: sentinels.fileName, mimeType: 'text/plain',
              sizeBytes: sentinels.attachment.length, kind: 'file', createdAt: now, updatedAt: now,
              source: 'upload', storageType: 'indexeddb', blobKey: ids.blob, url: ''
            }
          ]
        }
      });
      await window.__sutraPublicBetaTestHooks.seedCourseAttachmentBlob(ids.blob, attachmentDataUrl);
      await window.saveWorkspaceLocally();
    }, { ids, sentinels, attachmentDataUrl, inlinePixel });
    recordsSeeded = true;
    await syncNow(A1.page);
    logLivePhase('encrypted-workspace-seeded');

    await A1.page.locator('#chatbotBtn').click();
    await A1.page.locator('#chatInput').fill('search my notes for ' + sentinels.note + ' and include ' + sentinels.assistant);
    await A1.page.locator('#chatSendBtn').click();
    await expect(A1.page.locator('#chatbotPanel .assistant-sources')).toContainText(sentinels.note, { timeout: 30000 });
    const created = await A1.page.evaluate(() => window.SutraAssistantConversationController.getCurrent());
    conversationId = created.id;
    expect(created.messages.length).toBeGreaterThanOrEqual(2);
    expect(created.messages.every(message => message.id && message.createdAt)).toBe(true);
    expect(created.messages.at(-1).sources.length).toBeGreaterThan(0);
    expect(created.messages.at(-1).receipt.schema).toBe('sutra-assistant-receipt/1');

    await A1.page.evaluate(async ({ conversationId, ids, assistantMarker }) => {
      const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      const hooks = window.__sutraPublicBetaTestHooks;
      const assistantChatHistory = hooks.syncParity.getAssistantChatHistory();
      const conversation = assistantChatHistory.conversations.find(row => row.id === conversationId);
      const last = conversation.messages.at(-1);
      last.memoryUsedIds = [ids.memory];
      last.deepLinks = [{ type: 'note', id: ids.note }];
      conversation.title = assistantMarker;
      conversation.updatedAt = new Date().toISOString();
      payload.assistantMemory = payload.assistantMemory || { version: 1, enabled: true, items: [] };
      payload.assistantMemory.enabled = true;
      payload.assistantMemory.items = [
        ...(payload.assistantMemory.items || []).filter(row => row?.id !== ids.memory),
        { id: ids.memory, text: 'Synthetic certification memory', createdAt: new Date().toISOString(), updatedAt: new Date().toISOString() }
      ];
      window.deserializeWorkspace(payload);
      hooks.syncParity.setAssistantChatHistory(assistantChatHistory);
      await window.saveWorkspaceLocally();
    }, { conversationId, ids, assistantMarker: sentinels.assistant });
    const sourceConvergenceState = await readConvergenceState(A1.page, ids, conversationId);
    expect(sourceConvergenceState).toEqual(expect.objectContaining({
      note: true, task: true, file: true, conversation: true
    }));
    console.log('[live-cert] source-assistant-before-push', JSON.stringify(
      await readAssistantSyncInternals(A1.page, conversationId)
    ));
    console.log('[live-cert] source-push-acknowledged', JSON.stringify(
      await waitForAssistantPush(A1.page, conversationId)
    ));

    let convergenceChecks = 0;
    await syncUntil(A2.page, async () => {
      const state = await readConvergenceState(A2.page, ids, conversationId);
      const asset = await A2.page.evaluate(async ({ blobKey, expected }) => ({
        matches: (await window.__sutraPublicBetaTestHooks.readCourseAttachmentBlob(blobKey)) === expected,
        pending: Number(window.SutraSync.status().assetsPending) || 0
      }), { blobKey: ids.blob, expected: attachmentDataUrl });
      convergenceChecks += 1;
      if (convergenceChecks === 1 || convergenceChecks % 10 === 0) {
        console.log('[live-cert] convergence-state', JSON.stringify({ ...state, asset }));
        console.log('[live-cert] destination-assistant-state', JSON.stringify(
          await readAssistantSyncInternals(A2.page, conversationId)
        ));
      }
      return state.note && state.task && state.file && state.conversation
        && asset.matches && asset.pending === 0;
    }, 120000);

    const hydrated = await A2.page.evaluate(async ({ ids, conversationId, attachmentDataUrl, inlinePixel }) => {
      const workspace = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      const assistantChatHistory = window.__sutraPublicBetaTestHooks.syncParity.getAssistantChatHistory();
      const conversation = assistantChatHistory.conversations.find(row => row.id === conversationId);
      return {
        note: workspace.pages.find(row => row.id === ids.note),
        task: workspace.tasks.find(row => row.id === ids.task),
        file: workspace.courseWorkspace.files.find(row => row.id === ids.file),
        attachmentMatches: (await window.__sutraPublicBetaTestHooks.readCourseAttachmentBlob(ids.blob)) === attachmentDataUrl,
        inlineMatches: workspace.pages.find(row => row.id === ids.note).content.includes(inlinePixel),
        conversation,
        memory: (workspace.assistantMemory.items || []).find(row => row.id === ids.memory)
      };
    }, { ids, conversationId, attachmentDataUrl, inlinePixel });
    expect(hydrated.note).toBeTruthy();
    expect(hydrated.task).toBeTruthy();
    expect(hydrated.file).toBeTruthy();
    expect(hydrated.attachmentMatches).toBe(true);
    expect(hydrated.inlineMatches).toBe(true);
    expect(hydrated.conversation.title).toBe(sentinels.assistant);
    expect(hydrated.conversation.messages.at(-1).memoryUsedIds).toEqual([ids.memory]);
    expect(hydrated.memory).toBeTruthy();

    await A2.page.locator('#chatbotBtn').click();
    await A2.page.evaluate(id => window.SutraAssistantConversationController.select(id), conversationId);
    await expect(A2.page.locator('#chatbotPanel')).toContainText(sentinels.note);
    const beforeReverse = hydrated.conversation.messages.length;
    await A2.page.locator('#chatInput').fill('search my notes for ' + sentinels.note);
    await A2.page.locator('#chatSendBtn').click();
    await expect.poll(
      () => A2.page.evaluate(id => {
        const row = window.SutraAssistantConversationController.getState().conversations.find(item => item.id === id);
        return row?.messages.length || 0;
      }, conversationId),
      { timeout: 30000 }
    ).toBeGreaterThan(beforeReverse);
    await A2.page.evaluate(() => window.saveWorkspaceLocally());
    await syncNow(A2.page);
    await syncUntil(A1.page, () => A1.page.evaluate(({ id, count }) => {
      const row = window.SutraAssistantConversationController.getState().conversations.find(item => item.id === id);
      return !!row && row.messages.length > count;
    }, { id: conversationId, count: beforeReverse }));
    logLivePhase('two-device-round-trip-converged');

    const [aConversation, bConversation] = await Promise.all([
      A1.page.evaluate(id => window.SutraAssistantConversationController.getState().conversations.find(row => row.id === id), conversationId),
      A2.page.evaluate(id => window.SutraAssistantConversationController.getState().conversations.find(row => row.id === id), conversationId)
    ]);
    expect(bConversation.messages.map(row => row.id)).toEqual(aConversation.messages.map(row => row.id));
    expect(bConversation.messages.map(row => row.role)).toEqual(aConversation.messages.map(row => row.role));
    expect(bConversation.messages.map(row => row.content)).toEqual(aConversation.messages.map(row => row.content));
    expect(bConversation.messages.at(1).sources).toEqual(aConversation.messages.at(1).sources);
    expect(bConversation.messages.at(1).receipt).toEqual(aConversation.messages.at(1).receipt);

    await A2.page.evaluate(() => {
      localStorage.setItem('sutra:assistantChats:v1', JSON.stringify({ version: 1, currentChatId: '', conversations: [] }));
      localStorage.removeItem('sutra:assistantCurrentChatId:v1');
    });
    await A2.page.reload({ waitUntil: 'domcontentloaded' });
    await A2.page.waitForSelector('#fileInput', { state: 'attached' });
    await completeOnboarding(A2.page);
    if (AUTOMATED_AUTH) await unlockAutomatedSync(A2.page);
    await expect.poll(() => A2.page.evaluate(id =>
      !!window.SutraAssistantConversationController.getState().conversations.find(row => row.id === id),
    conversationId), { timeout: 30000, intervals: [300, 700, 1200] }).toBe(true);
    const afterReload = await A2.page.evaluate(id =>
      window.SutraAssistantConversationController.getState().conversations.find(row => row.id === id),
    conversationId);
    expect(afterReload.messages.map(row => row.id)).toEqual(aConversation.messages.map(row => row.id));

    // Public-key-only requests must not see sync rows or execute protected RPCs.
    const unauthenticated = await A1.page.evaluate(async ({ projectUrl }) => {
      const headers = { apikey: window.SUTRA_CONFIG.supabaseAnonKey, 'content-type': 'application/json' };
      const table = await fetch(projectUrl + '/rest/v1/sync_devices?select=device_id&limit=1', { headers });
      const rpc = await fetch(projectUrl + '/rest/v1/rpc/sync_get_device_status', {
        method: 'POST', headers, body: JSON.stringify({ deviceId: 'guessed-device' })
      });
      return {
        table: { status: table.status, text: (await table.text()).slice(0, 2000) },
        rpc: { status: rpc.status, text: (await rpc.text()).slice(0, 2000) }
      };
    }, { projectUrl: PROJECT_URL });
    expect([401, 403]).toContain(unauthenticated.table.status);
    expect([401, 403]).toContain(unauthenticated.rpc.status);
    expect(unauthenticated.rpc.text).not.toMatch(/could not find.*function|schema cache/i);
    logLivePhase('anonymous-denial-verified');

    // Account B registers only its own synthetic certification device. Every
    // direct request below reuses Account B's authenticated request in browser
    // memory; no bearer token is returned to the test runner.
    bDeviceId = 'real-cert-hostile-' + runId;
    const rpcUrl = name => PROJECT_URL + '/rest/v1/rpc/' + name;
    const bPing = await authenticatedProbe(B.page, {
      url: rpcUrl('sync_ping'), method: 'POST', body: { deviceId: bDeviceId }
    });
    expect(bPing.status).toBe(200);
    expect(parseJson(bPing.text)).toEqual(expect.objectContaining({ ok: true }));

    const bList = await authenticatedProbe(B.page, {
      url: rpcUrl('sync_list_devices'), method: 'POST', body: { deviceId: bDeviceId }
    });
    expect(bList.status).toBe(200);
    const bListJson = parseJson(bList.text);
    expect(bListJson.ok).toBe(true);
    expect(bListJson.devices.map(row => row.deviceId)).toContain(bDeviceId);
    expect(bListJson.devices.map(row => row.deviceId)).not.toContain(a1DeviceId);
    expect(bListJson.devices.map(row => row.deviceId)).not.toContain(a2DeviceId);

    const bRevokeA = await authenticatedProbe(B.page, {
      url: rpcUrl('sync_revoke_device'), method: 'POST',
      body: { targetDeviceId: a2DeviceId, deviceId: bDeviceId }
    });
    expect(bRevokeA.status).toBe(200);
    expect(parseJson(bRevokeA.text)).toEqual(expect.objectContaining({ ok: false, code: 'not-found' }));

    const bAcknowledgeA = await authenticatedProbe(B.page, {
      url: rpcUrl('sync_acknowledge_device_wipe'), method: 'POST',
      body: { deviceId: a2DeviceId, at: new Date().toISOString() }
    });
    expect(bAcknowledgeA.status).toBe(200);
    expect(parseJson(bAcknowledgeA.text)).toEqual(expect.objectContaining({ ok: false, code: 'not-found' }));

    const bStatusA = await authenticatedProbe(B.page, {
      url: rpcUrl('sync_get_device_status'), method: 'POST', body: { deviceId: a2DeviceId }
    });
    expect(bStatusA.status).toBe(200);
    expect(parseJson(bStatusA.text)).toEqual(expect.objectContaining({
      ok: false, code: 'DEVICE_UNKNOWN', contract: 'sutra-device-status-v1'
    }));

    const isolatedRpcSpecs = [
      ['sync_pull', { cursor: 0, deviceId: bDeviceId, max_rows: 1000 }],
      ['sync_get_vault_key', { deviceId: bDeviceId }],
      ['sync_get_snapshot', { deviceId: bDeviceId }],
      ['sync_list_assets', { deviceId: bDeviceId }]
    ];
    for (const [name, body] of isolatedRpcSpecs) {
      const result = await authenticatedProbe(B.page, { url: rpcUrl(name), method: 'POST', body });
      expect(result.status).toBe(200);
      expect(result.text).not.toContain(sentinels.note);
      expect(result.text).not.toContain(sentinels.assistant);
      expect(result.text).not.toContain(sentinels.attachment);
      const resultJson = parseJson(result.text);
      expect(resultJson?.ok).toBe(true);
      if (name === 'sync_get_vault_key') expect(resultJson.wrapped).toBeNull();
      if (name === 'sync_get_snapshot') expect(resultJson.snapshot).toBeNull();
      if (name === 'sync_list_assets') expect(resultJson.hashes).toEqual([]);
    }

    const directTableSpecs = [
      { url: PROJECT_URL + '/rest/v1/sync_devices?select=*', method: 'GET' },
      { url: PROJECT_URL + '/rest/v1/sync_ops?select=*', method: 'GET' },
      { url: PROJECT_URL + '/rest/v1/sync_vault_keys?select=*', method: 'GET' },
      { url: PROJECT_URL + '/rest/v1/sync_snapshots?select=*', method: 'GET' },
      { url: PROJECT_URL + '/rest/v1/sync_asset_index?select=*', method: 'GET' },
      {
        url: PROJECT_URL + '/rest/v1/sync_devices?device_id=eq.' + encodeURIComponent(a2DeviceId),
        method: 'DELETE'
      },
      {
        url: PROJECT_URL + '/rest/v1/sync_ops', method: 'POST',
        body: {
          op_id: 'guessed-' + runId, device_id: bDeviceId,
          envelope: { v: 1, alg: 'A256GCM', iv: 'guessed', ciphertext: 'guessed' }
        }
      }
    ];
    for (const spec of directTableSpecs) {
      const result = await authenticatedProbe(B.page, spec);
      expect([401, 403]).toContain(result.status);
      expect(result.text).not.toContain(sentinels.note);
      expect(result.text).not.toContain(sentinels.assistant);
      expect(result.text).not.toContain(sentinels.attachment);
    }
    logLivePhase('cross-account-and-direct-table-isolation-verified');

    await cipherAudit.settle();
    expect(cipherAudit.entries.length).toBeGreaterThan(0);
    expect(cipherAudit.entries.flatMap(row => row.leaks)).toEqual([]);
    expect(cipherAudit.storagePaths.some(path => path.includes(sentinels.fileName))).toBe(false);
    expect(cipherAudit.storagePaths.some(path => path.includes(sentinels.attachment))).toBe(false);
    const assetPath = cipherAudit.storagePaths.at(-1);
    expect(assetPath).toBeTruthy();
    const bAsset = await authenticatedProbe(B.page, {
      url: PROJECT_URL + '/storage/v1/object/sync-assets/' + assetPath,
      method: 'GET'
    });
    expect([400, 401, 403, 404]).toContain(bAsset.status);
    expect(bAsset.text).not.toContain(sentinels.attachment);
    logLivePhase('ciphertext-and-storage-isolation-verified');

    // Open a second tab from Device B's existing page so the browser clones its
    // tab session. Both tabs must show the local synthetic workspace before the
    // controlling device revokes it.
    const popupPromise = A2.page.waitForEvent('popup');
    await A2.page.evaluate(() => window.open(location.href, '_blank'));
    A2tab = await popupPromise;
    await A2tab.waitForSelector('#fileInput', { state: 'attached' });
    await completeOnboarding(A2tab);
    if (AUTOMATED_AUTH) {
      await unlockAutomatedSync(A2.page);
      await unlockAutomatedSync(A2tab);
    }
    await Promise.all([
      showBanner(A2.page, A2.label, 'Unlock the existing vault again after the reload. The test will then take this browser offline.'),
      showBanner(A2tab, A2.label + ' — second tab', 'Unlock the existing vault in this tab too. It will verify multi-tab wipe propagation.')
    ]);
    await Promise.all([waitForSyncReady(A2.page), waitForSyncReady(A2tab)]);
    await Promise.all([hideBanner(A2.page), hideBanner(A2tab)]);
    logLivePhase('offline-revocation-setup-ready');
    for (const page of [A2.page, A2tab]) {
      const visible = await page.evaluate(({ note, conversation }) => {
        const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
        const assistantChatHistory = window.__sutraPublicBetaTestHooks.syncParity.getAssistantChatHistory();
        return payload.pages.some(row => row.id === note)
          && assistantChatHistory.conversations.some(row => row.id === conversation);
      }, { note: ids.note, conversation: conversationId });
      expect(visible).toBe(true);
    }

    await A2.context.setOffline(true);
    const revoked = await revokeDeviceEventually(A1.page, a2DeviceId);
    expect(revoked).toBe(true);
    const pendingDevice = (await A1.page.evaluate(() => window.SutraSync.listDevices()))
      .find(row => row.deviceId === a2DeviceId);
    expect(pendingDevice).toEqual(expect.objectContaining({
      deviceId: a2DeviceId, wipeRequired: true, wipeAcknowledgedAt: null
    }));
    expect(pendingDevice.revokedAt).toBeTruthy();
    await expect(A2.page.locator('#sutraRevokedDeviceScreen')).toHaveCount(0);
    await expect(A2tab.locator('#sutraRevokedDeviceScreen')).toHaveCount(0);
    expect(await A2.page.evaluate(marker => JSON.stringify(
      window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false })
    ).includes(marker), sentinels.note)).toBe(true);

    await A2.context.setOffline(false);
    const preWipeStatus = await authenticatedProbe(A2.page, {
      url: rpcUrl('sync_get_device_status'), method: 'POST', body: { deviceId: a2DeviceId }
    });
    expect(preWipeStatus.status).toBe(200);
    expect(parseJson(preWipeStatus.text)).toEqual(expect.objectContaining({
      ok: false,
      code: 'DEVICE_REVOKED',
      contract: 'sutra-device-status-v1',
      deviceId: a2DeviceId,
      wipeRequired: true
    }));
    const deniedAfterRevoke = await authenticatedProbe(A2.page, {
      url: rpcUrl('sync_pull'), method: 'POST', body: { cursor: 0, deviceId: a2DeviceId, max_rows: 1 }
    });
    expect(deniedAfterRevoke.status).toBe(200);
    expect(parseJson(deniedAfterRevoke.text)).toEqual(expect.objectContaining({ ok: false, code: 'revoked' }));

    await expect.poll(async () => {
      if (await A2.page.locator('#sutraRevokedDeviceScreen').count()) return true;
      await A2.page.evaluate(() => window.SutraSync.syncNow()).catch(() => null);
      return (await A2.page.locator('#sutraRevokedDeviceScreen').count()) > 0;
    }, { timeout: 30000, intervals: [500, 1000, 1500] }).toBe(true);
    await expect(A2.page.locator('#sutraRevokedDeviceScreen')).toBeVisible();
    await expect(A2tab.locator('#sutraRevokedDeviceScreen')).toBeVisible({ timeout: 15000 });
    await expect(A2.page.locator('#sutraRevokedDeviceMessage')).toContainText('removed');
    await expect(A2tab.locator('#sutraRevokedDeviceMessage')).toContainText('removed');

    await expect.poll(async () => {
      const rows = await A1.page.evaluate(() => window.SutraSync.listDevices());
      return !!rows.find(row => row.deviceId === a2DeviceId)?.wipeAcknowledgedAt;
    }, { timeout: 30000, intervals: [700, 1200] }).toBe(true);
    logLivePhase('revocation-wipe-and-ack-verified');

    for (const page of [A2.page, A2tab]) {
      const audit = await storageAudit(page);
      expect(audit.localKeys).toEqual(['sutra:revocationWipeGuard:v1']);
      expect(audit.sessionKeys).toEqual([]);
      for (const name of REQUIRED_DATABASES) expect(audit.databases).not.toContain(name);
      expect(audit.visibleText).not.toContain(sentinels.note);
      expect(audit.visibleText).not.toContain(sentinels.assistant);
      expect(audit.visibleText).not.toContain(sentinels.attachment);
    }

    await Promise.all([A2.page.reload({ waitUntil: 'domcontentloaded' }), A2tab.reload({ waitUntil: 'domcontentloaded' })]);
    await Promise.all([
      A2.page.waitForSelector('#sutraRevokedDeviceScreen'),
      A2tab.waitForSelector('#sutraRevokedDeviceScreen')
    ]);
    for (const page of [A2.page, A2tab]) {
      const audit = await storageAudit(page);
      expect(audit.visibleText).not.toContain(sentinels.note);
      expect(audit.visibleText).not.toContain(sentinels.assistant);
      expect(audit.visibleText).not.toContain(sentinels.attachment);
      for (const name of REQUIRED_DATABASES) expect(audit.databases).not.toContain(name);
    }

    await A2.page.locator('#sutraRevokedDeviceReuse').click();
    await A2.page.waitForSelector('#fileInput', { state: 'attached' });
    await completeOnboarding(A2.page);
    await A2tab.close();
    A2tab = null;
    await A2.page.waitForFunction(() =>
      typeof window.SutraCloudSync?.isSignedIn === 'function'
      && typeof window.SutraSync?.status === 'function', null, { timeout: 30000 });
    expect(await A2.page.evaluate(() => window.SutraCloudSync.isSignedIn())).toBe(false);
    expect(await A2.page.evaluate(() => window.SutraSync.status().enabled)).toBe(false);
    await expect(A2.page.locator('#sutraRevokedDeviceScreen')).toHaveCount(0);
    await expect(A2.page.evaluate(() => window.SutraSync.syncNow()).catch(error => String(error?.message || error)))
      .resolves.toMatch(/not running|enable|unlock/i);

    await showBanner(
      A2.page,
      A2.label + ' — fresh registration',
      'Sign in again with Account A, enable sync, register this browser as a fresh device, unlock the vault, and explicitly bootstrap.'
    );
    if (AUTOMATED_AUTH) {
      await installAutomatedPasswordSession(A2.page, AUTOMATED_ACCOUNT_A_EMAIL, AUTOMATED_ACCOUNT_A_PASSWORD);
      await enableAutomatedSync(A2.page);
    }
    await waitForSyncReady(A2.page);
    await hideBanner(A2.page);
    const replacementDeviceId = await getDeviceId(A2.page);
    expect(replacementDeviceId).toBeTruthy();
    expect(replacementDeviceId).not.toBe(a2DeviceId);
    await syncUntil(A2.page, () => A2.page.evaluate(noteId =>
      window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false }).pages.some(row => row.id === noteId),
    ids.note), 120000);
    const finalDevices = await A1.page.evaluate(() => window.SutraSync.listDevices());
    expect(finalDevices.find(row => row.deviceId === a2DeviceId)).toEqual(expect.objectContaining({
      wipeRequired: true
    }));
    expect(finalDevices.find(row => row.deviceId === a2DeviceId).wipeAcknowledgedAt).toBeTruthy();
    expect(finalDevices.find(row => row.deviceId === replacementDeviceId)?.revokedAt).toBeFalsy();
    logLivePhase('fresh-device-bootstrap-verified');

    // Remove the synthetic Account B registration without touching Account A.
    const bDeleteOwnVault = await authenticatedProbe(B.page, {
      url: rpcUrl('sync_delete_vault'), method: 'POST', body: { deviceId: bDeviceId }
    });
    expect(bDeleteOwnVault.status).toBe(200);
    expect(parseJson(bDeleteOwnVault.text)).toEqual(expect.objectContaining({ ok: true }));
    expect((await A1.page.evaluate(() => window.SutraSync.listDevices())).some(row => row.deviceId === a1DeviceId)).toBe(true);

    // Clean only the synthetic records that this certification created.
    await cleanupCertificationData(A1.page, ids, conversationId);
    await syncNow(A1.page);
    await syncUntil(A2.page, () => A2.page.evaluate(({ note, conversation }) => {
      const payload = window.serializeWorkspace({ mode: 'json', includeSensitiveSettings: false });
      const assistantChatHistory = window.__sutraPublicBetaTestHooks.syncParity.getAssistantChatHistory();
      return !payload.pages.some(row => row.id === note)
        && !assistantChatHistory.conversations.some(row => row.id === conversation);
    }, { note: ids.note, conversation: conversationId }));
    cleanupComplete = true;
    logLivePhase('cleanup-complete');
  } finally {
    if (recordsSeeded && !cleanupComplete && !A1.page.isClosed()) {
      await cleanupCertificationData(A1.page, ids, conversationId).catch(() => undefined);
      await syncNow(A1.page).catch(() => undefined);
    }
    if (bDeviceId && !B.page.isClosed()) {
      await authenticatedProbe(B.page, {
        url: PROJECT_URL + '/rest/v1/rpc/sync_delete_vault', method: 'POST', body: { deviceId: bDeviceId }
      }).catch(() => undefined);
    }
    if (A2tab && !A2tab.isClosed()) await A2tab.close().catch(() => undefined);
    await Promise.allSettled([A1.context.close(), A2.context.close(), B.context.close()]);
  }
});
