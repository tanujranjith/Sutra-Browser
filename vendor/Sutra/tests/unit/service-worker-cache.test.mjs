import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import test from 'node:test';
import vm from 'node:vm';

const ROOT = resolve(process.cwd());
const SW_SOURCE = readFileSync(resolve(ROOT, 'sw.js'), 'utf8');
const ORIGIN = 'https://sutra.test';

class MockResponse {
  constructor(body, { status = 200, type = 'basic' } = {}) {
    this.body = body;
    this.status = status;
    this.type = type;
  }
  clone() { return new MockResponse(this.body, { status: this.status, type: this.type }); }
}

class MockCache {
  constructor(storage, network) {
    this.storage = storage;
    this.network = network;
  }
  key(input) {
    const raw = typeof input === 'string' ? input : input.url;
    return new URL(raw, `${ORIGIN}/`).href;
  }
  async match(input) { return this.storage.get(this.key(input))?.clone(); }
  async put(input, response) { this.storage.set(this.key(input), response.clone()); }
  async add(input) {
    const response = await this.network(this.key(input));
    if (!response || response.status !== 200) throw new Error(`Precache failed: ${this.key(input)}`);
    await this.put(input, response);
  }
  async addAll(inputs) {
    const pending = await Promise.all(inputs.map(async (input) => {
      const response = await this.network(this.key(input));
      if (!response || response.status !== 200) throw new Error(`Critical precache failed: ${this.key(input)}`);
      return [input, response];
    }));
    for (const [input, response] of pending) await this.put(input, response);
  }
}

class MockCacheStorage {
  constructor(network) {
    this.network = network;
    this.stores = new Map();
  }
  async open(name) {
    if (!this.stores.has(name)) this.stores.set(name, new Map());
    return new MockCache(this.stores.get(name), this.network);
  }
  async keys() { return [...this.stores.keys()]; }
  async delete(name) { return this.stores.delete(name); }
}

function request(path, { navigate = false } = {}) {
  return {
    url: new URL(path, `${ORIGIN}/`).href,
    method: 'GET',
    mode: navigate ? 'navigate' : 'same-origin',
    headers: { get: (name) => navigate && name === 'accept' ? 'text/html' : '' }
  };
}

function createWorker({ version, manifest, cacheStorage, network }) {
  const listeners = new Map();
  const self = {
    location: { origin: ORIGIN },
    SUTRA_ASSET_MANIFEST: manifest,
    clients: {
      claim: async () => undefined,
      matchAll: async () => [],
      openWindow: async () => undefined
    },
    registration: { showNotification: async () => undefined },
    skipWaiting: async () => undefined,
    addEventListener(type, listener) { listeners.set(type, listener); }
  };
  const source = SW_SOURCE.replace(
    /const CACHE_VERSION = `\$\{CACHE_FAMILY\}[^`]+`;/,
    `const CACHE_VERSION = \`\${CACHE_FAMILY}${version}\`;`
  );
  vm.runInNewContext(source, {
    self,
    caches: cacheStorage,
    fetch: network,
    URL,
    Promise,
    importScripts() {}
  }, { filename: 'sw.js' });

  async function lifecycle(type) {
    let work;
    listeners.get(type)({ waitUntil(value) { work = Promise.resolve(value); } });
    return work;
  }
  async function fetchEvent(req) {
    let response;
    listeners.get('fetch')({ request: req, respondWith(value) { response = Promise.resolve(value); } });
    return response;
  }
  return { lifecycle, fetchEvent };
}

test('a version-B request never receives a version-A cached asset', async () => {
  let offline = false;
  const network = async (url) => {
    if (offline) throw new Error('offline');
    const parsed = new URL(url);
    return new MockResponse(`${parsed.pathname}${parsed.search}`);
  };
  const caches = new MockCacheStorage(network);
  const workerA = createWorker({
    version: 'v-test-a',
    manifest: { shell: './Sutra.html', critical: ['./Sutra.html', './file.js?v=a'], optional: [] },
    cacheStorage: caches,
    network
  });
  await workerA.lifecycle('install');

  const workerB = createWorker({
    version: 'v-test-b',
    manifest: { shell: './Sutra.html', critical: ['./Sutra.html', './file.js?v=b'], optional: [] },
    cacheStorage: caches,
    network
  });
  await workerB.lifecycle('install');
  offline = true;
  const response = await workerB.fetchEvent(request('/file.js?v=b'));
  assert.equal(response.body, '/file.js?v=b');
  assert.notEqual(response.body, '/file.js?v=a');
});

test('old cache generations are not searched and are removed on activation', async () => {
  const network = async () => { throw new Error('offline'); };
  const caches = new MockCacheStorage(network);
  const old = await caches.open('sutra-cache-v-test-a');
  await old.put('./file.js?v=a', new MockResponse('old-A'));
  const workerB = createWorker({
    version: 'v-test-b',
    manifest: { shell: './Sutra.html', critical: [], optional: [] },
    cacheStorage: caches,
    network
  });
  await assert.rejects(workerB.fetchEvent(request('/file.js?v=b')), /offline/);
  await workerB.lifecycle('activate');
  assert.deepEqual(await caches.keys(), ['sutra-cache-v-test-b']);
});

test('offline navigation starts from the exactly precached shell', async () => {
  let offline = false;
  const network = async (url) => {
    if (offline) throw new Error('offline');
    return new MockResponse(new URL(url).pathname === '/Sutra.html' ? 'shell-B' : 'asset-B');
  };
  const caches = new MockCacheStorage(network);
  const worker = createWorker({
    version: 'v-test-offline',
    manifest: { shell: './Sutra.html', critical: ['./Sutra.html', './app.js?v=b'], optional: [] },
    cacheStorage: caches,
    network
  });
  await worker.lifecycle('install');
  offline = true;
  const response = await worker.fetchEvent(request('/some/deep/link', { navigate: true }));
  assert.equal(response.body, 'shell-B');
});

test('a failed critical precache rejects installation without a partial shell', async () => {
  const network = async (url) => {
    if (url.includes('missing.js')) throw new Error('critical missing');
    return new MockResponse('ok');
  };
  const caches = new MockCacheStorage(network);
  const worker = createWorker({
    version: 'v-test-failure',
    manifest: { shell: './Sutra.html', critical: ['./Sutra.html', './missing.js?v=b'], optional: [] },
    cacheStorage: caches,
    network
  });
  await assert.rejects(worker.lifecycle('install'), /critical missing/);
  const cache = await caches.open('sutra-cache-v-test-failure');
  assert.equal(await cache.match('./Sutra.html'), undefined);
});

test('missing optional assets do not invalidate a complete critical shell', async () => {
  const network = async (url) => {
    if (url.includes('optional.png')) throw new Error('optional missing');
    return new MockResponse('ok');
  };
  const caches = new MockCacheStorage(network);
  const worker = createWorker({
    version: 'v-test-optional',
    manifest: { shell: './Sutra.html', critical: ['./Sutra.html'], optional: ['./optional.png'] },
    cacheStorage: caches,
    network
  });
  await worker.lifecycle('install');
  const cache = await caches.open('sutra-cache-v-test-optional');
  assert.equal((await cache.match('./Sutra.html')).body, 'ok');
});
