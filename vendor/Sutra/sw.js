/* ==========================================================================
   Sutra service worker — minimal, safe, offline-capable, no telemetry
   ==========================================================================
   Design constraints (see docs + CLAUDE.md):
     • Local-first: the SW only makes hosted use work offline. It NEVER runs
       under file:// (registration is protocol-gated in sw-register.js).
     • No telemetry, no tracking, no background sync.
     • Cross-origin requests (AI providers, Google Drive) are NEVER intercepted
       or cached — they pass straight through to the network.
     • Navigations are network-FIRST so a freshly deployed Sutra.html is never
       shadowed by a stale cached copy; the cache is only an offline fallback.
     • Sub-assets are versioned via ?v= query strings, so cache-first is safe:
       a new build is a new URL and bypasses the old cache entry.
     • User data exports (.sutra blobs) are downloads, not fetches — never cached.
   Bump CACHE_VERSION to invalidate old caches on the next activate.
   ========================================================================== */

importScripts('./src/config/asset-manifest.generated.js?v=20260930-focus-homework-assets2');

const CACHE_FAMILY = 'sutra-cache-';
const CACHE_VERSION = `${CACHE_FAMILY}v11-20260930-color-focus-homework`;
const ASSET_MANIFEST = self.SUTRA_ASSET_MANIFEST;
if (!ASSET_MANIFEST || !Array.isArray(ASSET_MANIFEST.critical) || !ASSET_MANIFEST.shell) {
    throw new Error('Sutra service worker asset manifest is missing or invalid.');
}
const CRITICAL_ASSETS = ASSET_MANIFEST.critical;
const OPTIONAL_ASSETS = Array.isArray(ASSET_MANIFEST.optional) ? ASSET_MANIFEST.optional : [];

const STATIC_ASSET_PATH = /\.(?:m?js|css|html|webmanifest|ico|png|svg|woff2?|ttf|pfb|bcmap)$/i;
const SHARE_DB_NAME = 'sutra_share_target_db';
const SHARE_DB_VERSION = 1;
const SHARE_STORE_NAME = 'pendingShares';
const SHARE_MAX_FILE_SIZE = 20 * 1024 * 1024;
const SHARE_MAX_TOTAL_SIZE = 30 * 1024 * 1024;
const SHARE_MAX_FILES = 8;
const SHARE_TTL_MS = 24 * 60 * 60 * 1000;
const SHARE_DEDUP_MS = 10 * 60 * 1000;
const SHARE_SUPPORTED_TYPES = new Set([
    'text/plain', 'text/html', 'text/markdown', 'text/csv', 'text/calendar',
    'application/pdf', 'image/png', 'image/jpeg', 'image/webp', 'image/gif',
    'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
    'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    'application/vnd.openxmlformats-officedocument.presentationml.presentation',
    'application/vnd.oasis.opendocument.text', 'application/rtf'
]);
const SHARE_SUPPORTED_EXTENSION = /\.(?:txt|md|markdown|html?|csv|ics|pdf|png|jpe?g|webp|gif|docx|xlsx|pptx|odt|rtf)$/i;

self.addEventListener('install', (event) => {
    event.waitUntil(
        caches.open(CACHE_VERSION).then(async (cache) => {
            // addAll is intentionally allowed to reject. A worker with a missing
            // script, stylesheet, or shell document must never install and take
            // control with a partially cached application runtime.
            await cache.addAll(CRITICAL_ASSETS);
            // Icons and other cosmetic assets can degrade without invalidating
            // the executable shell. Their failures remain isolated and visible
            // to diagnostics through the returned settled results.
            await Promise.allSettled(OPTIONAL_ASSETS.map((asset) => cache.add(asset)));
        })
    );
});

// Do not activate a new worker underneath an open workspace. The page offers a
// visible “reload safely” choice and sends this message only after the student
// accepts it.
self.addEventListener('message', (event) => {
    if (event && event.data && event.data.type === 'SUTRA_SKIP_WAITING') {
        self.skipWaiting();
    }
});

self.addEventListener('activate', (event) => {
    event.waitUntil(
        caches.keys()
            .then((keys) => Promise.all(keys
                .filter((key) => key.startsWith(CACHE_FAMILY) && key !== CACHE_VERSION)
                .map((key) => caches.delete(key))))
            .then(() => self.clients.claim())
    );
});

self.addEventListener('fetch', (event) => {
    const req = event.request;

    // Installed-PWA share receipt is a same-origin POST navigation. Parse it
    // locally, retain it temporarily in IndexedDB, then redirect to the app for
    // preview. The payload is never cached or sent to another origin.
    let requestUrl;
    try { requestUrl = new URL(req.url); } catch (error) { return; }
    if (req.method === 'POST' && requestUrl.origin === self.location.origin && /\/share-target\/?$/.test(requestUrl.pathname)) {
        event.respondWith(handleShareTargetRequest(req));
        return;
    }

    // Only ever touch same-origin GET requests. Everything else — POST/PUT,
    // AI provider calls, Google Drive, opaque cross-origin — passes through
    // untouched so nothing user-sensitive is ever cached or proxied.
    if (req.method !== 'GET') return;
    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (url.origin !== self.location.origin) return;

    const isNavigation = req.mode === 'navigate'
        || (req.headers.get('accept') || '').includes('text/html');

    if (isNavigation) {
        // Network-first: always prefer the freshly deployed document; fall back
        // to the cached shell only when offline.
        event.respondWith(
            fetch(req)
                .then((res) => {
                    cachePut(req, res);
                    return res.clone();
                })
                .catch(() => matchCurrentCache(req).then((hit) => hit || matchCurrentCache(ASSET_MANIFEST.shell)))
        );
        return;
    }

    // Never turn arbitrary same-origin requests into a cache of user content.
    // Sutra only caches versioned static application assets.
    if (!STATIC_ASSET_PATH.test(url.pathname)) return;

    if (url.search) {
        // Versioned assets are immutable cache-first entries. Matching is exact
        // (including the query string) and restricted to this worker's cache.
        event.respondWith(matchCurrentCache(req).then((hit) => hit || fetchAndCache(req)));
        return;
    }

    // Unversioned static assets are network-first to avoid keeping a stale path
    // alive after deployment. The exact current-cache entry is only an offline
    // fallback; old cache generations are never searched.
    event.respondWith(fetchAndCache(req).catch(() => matchCurrentCache(req)));
});

function fetchAndCache(req) {
    return fetch(req).then((res) => {
        cachePut(req, res);
        return res.clone();
    });
}

function cachePut(req, res) {
    // Cache only clean, same-origin, complete responses. Never cache opaque
    // (cross-origin) or partial/error responses.
    let url;
    try { url = new URL(req.url); } catch (e) { return; }
    if (!res || res.status !== 200 || res.type !== 'basic' || !STATIC_ASSET_PATH.test(url.pathname)) return;
    const copy = res.clone();
    caches.open(CACHE_VERSION).then((cache) => cache.put(req, copy)).catch(() => undefined);
}

function matchCurrentCache(req) {
    return caches.open(CACHE_VERSION).then((cache) => cache.match(req, { ignoreSearch: false }));
}

function openShareDb() {
    return new Promise((resolve, reject) => {
        const request = indexedDB.open(SHARE_DB_NAME, SHARE_DB_VERSION);
        request.onupgradeneeded = () => {
            const db = request.result;
            if (!db.objectStoreNames.contains(SHARE_STORE_NAME)) {
                const store = db.createObjectStore(SHARE_STORE_NAME, { keyPath: 'id' });
                store.createIndex('fingerprint', 'fingerprint', { unique: false });
                store.createIndex('createdAt', 'createdAt', { unique: false });
            }
        };
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Share storage is unavailable.'));
    });
}

function requestResult(request) {
    return new Promise((resolve, reject) => {
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error || new Error('Temporary share storage failed.'));
    });
}

function transactionDone(transaction) {
    return new Promise((resolve, reject) => {
        transaction.oncomplete = () => resolve();
        transaction.onabort = () => reject(transaction.error || new Error('Temporary share transaction was aborted.'));
        transaction.onerror = () => reject(transaction.error || new Error('Temporary share transaction failed.'));
    });
}

function shareFileSupported(file) {
    return !!file && (SHARE_SUPPORTED_TYPES.has(String(file.type || '').toLowerCase()) || SHARE_SUPPORTED_EXTENSION.test(String(file.name || '')));
}

function hex(buffer) {
    return Array.from(new Uint8Array(buffer)).map((byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function shareFingerprint(record) {
    const files = [];
    for (const file of record.files) {
        const digest = await crypto.subtle.digest('SHA-256', await file.arrayBuffer());
        files.push({ name: file.name || '', type: file.type || '', size: file.size || 0, digest: hex(digest) });
    }
    const stable = JSON.stringify({ title: record.title, text: record.text, url: record.url, files });
    return hex(await crypto.subtle.digest('SHA-256', new TextEncoder().encode(stable)));
}

async function cleanupExpiredShares(db) {
    let owned = false;
    if (!db) { db = await openShareDb(); owned = true; }
    try {
        const transaction = db.transaction(SHARE_STORE_NAME, 'readwrite');
        const store = transaction.objectStore(SHARE_STORE_NAME);
        const cutoff = Date.now() - SHARE_TTL_MS;
        await new Promise((resolve, reject) => {
            const cursorRequest = store.openCursor();
            cursorRequest.onsuccess = () => {
                const cursor = cursorRequest.result;
                if (!cursor) { resolve(); return; }
                if (Number(cursor.value && cursor.value.createdAt) < cutoff) cursor.delete();
                cursor.continue();
            };
            cursorRequest.onerror = () => reject(cursorRequest.error);
        });
        await transactionDone(transaction);
    } finally { if (owned) db.close(); }
}

async function storePendingShare(record) {
    const db = await openShareDb();
    try {
        await cleanupExpiredShares(db);
        const readTransaction = db.transaction(SHARE_STORE_NAME, 'readonly');
        const existing = await requestResult(readTransaction.objectStore(SHARE_STORE_NAME).index('fingerprint').getAll(record.fingerprint));
        const duplicate = (existing || []).find((entry) => Number(entry.createdAt) >= Date.now() - SHARE_DEDUP_MS);
        if (duplicate) return duplicate.id;
        const writeTransaction = db.transaction(SHARE_STORE_NAME, 'readwrite');
        writeTransaction.objectStore(SHARE_STORE_NAME).put(record);
        await transactionDone(writeTransaction);
        return record.id;
    } finally { db.close(); }
}

function shareRedirect(requestUrl, key, value) {
    const destination = new URL('./Sutra.html', requestUrl);
    destination.searchParams.set(key, value);
    return Response.redirect(destination.href, 303);
}

async function notifyShareClients(id) {
    const clientList = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    clientList.forEach((client) => {
        try { client.postMessage({ type: 'SUTRA_SHARE_READY', id }); } catch (error) { /* navigation still consumes it */ }
    });
}

async function handleShareTargetRequest(request) {
    try {
        const form = await request.formData();
        const files = form.getAll('files').filter((value) => value && typeof value.arrayBuffer === 'function' && (value.name || value.size));
        if (files.length > SHARE_MAX_FILES) return shareRedirect(request.url, 'share_error', 'too_many_files');
        let total = 0;
        for (const file of files) {
            if (!shareFileSupported(file)) return shareRedirect(request.url, 'share_error', 'unsupported_type');
            if (Number(file.size) > SHARE_MAX_FILE_SIZE) return shareRedirect(request.url, 'share_error', 'file_too_large');
            total += Number(file.size) || 0;
        }
        if (total > SHARE_MAX_TOTAL_SIZE) return shareRedirect(request.url, 'share_error', 'share_too_large');
        const rawTitle = String(form.get('title') || '');
        const rawText = String(form.get('text') || '');
        const rawUrl = String(form.get('url') || '');
        if (rawText.length > 80000) return shareRedirect(request.url, 'share_error', 'text_too_large');
        if (rawUrl.trim() && !/^https?:\/\//i.test(rawUrl.trim())) return shareRedirect(request.url, 'share_error', 'unsafe_url');
        const title = rawTitle.slice(0, 1000);
        const text = rawText;
        const url = rawUrl.slice(0, 8000);
        if (!title && !text && !url && !files.length) return shareRedirect(request.url, 'share_error', 'empty');
        const record = {
            id: crypto.randomUUID ? crypto.randomUUID() : `share_${Date.now()}_${Math.random().toString(36).slice(2)}`,
            title, text, url, files, createdAt: Date.now(), status: 'pending'
        };
        record.fingerprint = await shareFingerprint(record);
        const id = await storePendingShare(record);
        await notifyShareClients(id);
        return shareRedirect(request.url, 'share_pending', id);
    } catch (error) {
        return shareRedirect(request.url, 'share_error', 'temporary_storage_unavailable');
    }
}

/* Background reminders (local-first). Periodic Background Sync — where the
   browser supports it for an installed PWA — posts a once-a-day nudge to open
   Sutra and check today's plan. There is NO push server and NO workspace data in
   the notification: it is a generic, privacy-preserving nudge. Exact due-item
   notifications still fire in-app, and the .ics calendar handoff covers
   remind-me-when-closed across devices. */
self.addEventListener('periodicsync', (event) => {
    if (event.tag !== 'sutra-daily-reminder') return;
    event.waitUntil(
        self.registration.showNotification('Sutra', {
            body: 'Open Sutra to check today’s plan and anything due.',
            tag: 'sutra-daily-reminder',
            icon: './assets/brand/sutra/generated/favicon.ico',
            badge: './assets/brand/sutra/generated/favicon.ico'
        }).catch(() => undefined)
    );
});

self.addEventListener('notificationclick', (event) => {
    event.notification.close();
    event.waitUntil(
        self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((clientList) => {
            for (const client of clientList) {
                if (client.url.indexOf(self.location.origin) === 0 && 'focus' in client) return client.focus();
            }
            if (self.clients.openWindow) return self.clients.openWindow('./Sutra.html');
            return undefined;
        })
    );
});
