import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';

const bridgeSource = fs.readFileSync(new URL('../../src/core/credential-vault-bridge.js', import.meta.url), 'utf8');
const vaultSource = fs.readFileSync(new URL('../../src/core/credential-vault.js', import.meta.url), 'utf8');

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((done, fail) => {
    resolve = done;
    reject = fail;
  });
  return { promise, resolve, reject };
}

async function flushTasks(count = 4) {
  for (let i = 0; i < count; i += 1) {
    await new Promise(resolve => setImmediate(resolve));
  }
}

function createBridgeContext(options = {}) {
  const sessionWrites = [];
  const dispatched = [];
  const elements = new Map();
  const rememberListeners = new Map();
  const rememberInput = {
    checked: false,
    dataset: {},
    addEventListener(type, listener) { rememberListeners.set(type, listener); }
  };
  const providerInput = { value: '' };
  elements.set('assistantRememberKeysInput', rememberInput);
  elements.set('groqApiKeyInput', providerInput);

  const context = {
    console,
    Promise,
    Date,
    setTimeout,
    clearTimeout,
    CustomEvent: class CustomEvent {
      constructor(type, init) {
        this.type = type;
        this.detail = init && init.detail;
      }
    },
    document: {
      readyState: 'complete',
      getElementById(id) { return elements.get(id) || null; },
      addEventListener() {}
    },
    addEventListener() {},
    dispatchEvent(event) { dispatched.push(event); },
    SutraReportError() {},
    SutraRevocationWipe: {
      readGuard() { return options.isRevoked && options.isRevoked() ? { version: 1, status: 'cleaning' } : null; }
    },
    SutraCredentialVault: options.store,
    SutraSafeStorage: {
      sessionGet() { return null; },
      session(key, value) {
        sessionWrites.push({ key, value });
        return { ok: true };
      },
      get() { return null; }
    },
    CHAT_PROVIDER_CONFIG: { groq: { keyStorage: 'groq_api_key' } },
    SUTRA_CONFIG: { supabaseUrl: 'https://staging.example.invalid' }
  };
  context.window = context;
  vm.runInContext(bridgeSource, vm.createContext(context), {
    filename: 'src/core/credential-vault-bridge.js'
  });
  return { context, dispatched, elements, providerInput, rememberInput, rememberListeners, sessionWrites };
}

test('Assistant credential hydration stops when revocation begins across an await', async () => {
  const preference = deferred();
  let revoked = false;
  const store = {
    getPreference(name) {
      return name === 'assistantRemember' ? preference.promise : Promise.resolve(false);
    },
    get(name) { return Promise.resolve(name === 'assistant:groq' ? 'must-not-restore' : null); },
    remove() { return Promise.resolve(true); },
    removeGuarded() { return Promise.resolve(true); },
    set() { return Promise.resolve(true); },
    setPreference() { return Promise.resolve(true); },
    getWriteGuard() { return Promise.resolve({ blocked: false, generation: 1 }); }
  };
  const harness = createBridgeContext({ store, isRevoked: () => revoked });

  revoked = true;
  preference.resolve(true);
  await flushTasks();

  assert.equal(harness.rememberInput.checked, false);
  assert.equal(harness.providerInput.value, '');
  assert.deepEqual(harness.sessionWrites, []);
  assert.equal(harness.dispatched.some(event => event.type === 'sutra:assistant-credentials-restored'), false);
});

test('Assistant credential hydration still restores keys while the device is allowed', async () => {
  const store = {
    getPreference(name) { return Promise.resolve(name === 'assistantRemember'); },
    get(name) { return Promise.resolve(name === 'assistant:groq' ? 'allowed-key' : null); },
    remove() { return Promise.resolve(true); },
    removeGuarded() { return Promise.resolve(true); },
    set() { return Promise.resolve(true); },
    setPreference() { return Promise.resolve(true); },
    getWriteGuard() { return Promise.resolve({ blocked: false, generation: 1 }); }
  };
  const harness = createBridgeContext({ store, isRevoked: () => false });
  await flushTasks();

  assert.equal(harness.rememberInput.checked, true);
  assert.equal(harness.providerInput.value, 'allowed-key');
  assert.deepEqual(harness.sessionWrites, [{ key: 'groq_api_key', value: 'allowed-key' }]);
  assert.equal(harness.dispatched.some(event => event.type === 'sutra:assistant-credentials-restored'), true);
});

test('Assistant credential save stops after a revocation transition', async () => {
  const preferenceWrite = deferred();
  const preferenceWriteStarted = deferred();
  const credentialWrites = [];
  let revoked = false;
  const store = {
    getPreference() { return Promise.resolve(false); },
    get() { return Promise.resolve(null); },
    remove(name) {
      credentialWrites.push({ action: 'remove', name });
      return Promise.resolve(true);
    },
    removeGuarded() { return Promise.resolve(true); },
    set(name, value) {
      credentialWrites.push({ action: 'set', name, value });
      return Promise.resolve(true);
    },
    setPreference() {
      preferenceWriteStarted.resolve();
      return preferenceWrite.promise;
    },
    getWriteGuard() { return Promise.resolve({ blocked: false, generation: 1 }); }
  };
  const harness = createBridgeContext({ store, isRevoked: () => revoked });
  await flushTasks();
  harness.rememberInput.checked = true;
  harness.providerInput.value = 'must-not-persist';
  harness.rememberListeners.get('change')();

  await preferenceWriteStarted.promise;
  revoked = true;
  preferenceWrite.resolve(true);
  await flushTasks();

  assert.deepEqual(credentialWrites, []);
});

test('Cloud hydration rechecks the write generation before restoring a signed-out session', async () => {
  const savedRead = deferred();
  const savedReadStarted = deferred();
  let cloudGuard = { blocked: false, generation: 7 };
  const store = {
    getPreference(name) { return Promise.resolve(name === 'cloudRemember'); },
    getWriteGuard() { return Promise.resolve({ ...cloudGuard }); },
    get(name) {
      if (name === 'cloud:supabaseSession:v1') {
        savedReadStarted.resolve();
        return savedRead.promise;
      }
      return Promise.resolve(null);
    },
    remove() { return Promise.resolve(true); },
    removeGuarded() { return Promise.resolve(true); },
    set() { return Promise.resolve(true); },
    setPreference() { return Promise.resolve(true); }
  };
  const harness = createBridgeContext({ store, isRevoked: () => false });

  await savedReadStarted.promise;
  cloudGuard = { blocked: true, generation: 8 };
  savedRead.resolve({
    version: 1,
    backendUrl: 'https://staging.example.invalid',
    refreshToken: 'stale-refresh-token',
    user: { id: 'user-a', email: 'a@example.invalid' }
  });
  await flushTasks();

  assert.deepEqual(harness.sessionWrites, []);
});

test('stale invalid Cloud hydration cannot delete a session saved after reauthentication', async () => {
  const savedRead = deferred();
  const savedReadStarted = deferred();
  let cloudGuard = { blocked: false, generation: 11 };
  const removals = [];
  const store = {
    getPreference(name) { return Promise.resolve(name === 'cloudRemember'); },
    getWriteGuard() { return Promise.resolve({ ...cloudGuard }); },
    get(name) {
      if (name === 'cloud:supabaseSession:v1') {
        savedReadStarted.resolve();
        return savedRead.promise;
      }
      return Promise.resolve(null);
    },
    remove() {
      throw new Error('Cloud cleanup must not use an unguarded removal');
    },
    removeGuarded(name, expectedGeneration) {
      removals.push({ name, expectedGeneration, currentGeneration: cloudGuard.generation });
      return Promise.resolve(expectedGeneration === cloudGuard.generation);
    },
    set() { return Promise.resolve(true); },
    setPreference() { return Promise.resolve(true); }
  };
  createBridgeContext({ store, isRevoked: () => false });

  await savedReadStarted.promise;
  cloudGuard = { blocked: false, generation: 12 };
  savedRead.resolve({ version: 1, backendUrl: 'wrong-backend', refreshToken: '' });
  await flushTasks();

  assert.deepEqual(removals, [{
    name: 'cloud:supabaseSession:v1',
    expectedGeneration: 11,
    currentGeneration: 12
  }]);
});

test('Assistant rollback UI fails closed when revocation starts', async () => {
  const preferenceWrite = deferred();
  const preferenceWriteStarted = deferred();
  let revoked = false;
  const store = {
    getPreference() { return Promise.resolve(false); },
    get() { return Promise.resolve(null); },
    remove() { return Promise.resolve(true); },
    removeGuarded() { return Promise.resolve(true); },
    set() { return Promise.resolve(true); },
    setPreference() {
      preferenceWriteStarted.resolve();
      return preferenceWrite.promise;
    },
    getWriteGuard() { return Promise.resolve({ blocked: false, generation: 1 }); }
  };
  const harness = createBridgeContext({ store, isRevoked: () => revoked });
  await flushTasks();
  harness.rememberInput.checked = true;
  harness.rememberListeners.get('change')();
  await preferenceWriteStarted.promise;

  revoked = true;
  preferenceWrite.reject(new Error('revoked'));
  await flushTasks();

  assert.equal(harness.rememberInput.checked, false);
});

test('Credential vault does not reopen after revocation begins during key generation', async () => {
  const generatedKey = deferred();
  let revoked = false;
  let openCalls = 0;
  const context = {
    console,
    Promise,
    Uint8Array,
    TextEncoder,
    TextDecoder,
    btoa(value) { return Buffer.from(value, 'binary').toString('base64'); },
    atob(value) { return Buffer.from(value, 'base64').toString('binary'); },
    crypto: {
      subtle: {
        generateKey() { return generatedKey.promise; }
      },
      getRandomValues(value) { return value; }
    },
    indexedDB: {
      open() {
        openCalls += 1;
        throw new Error('IndexedDB must not reopen after revocation');
      }
    },
    SutraRevocationWipe: {
      readGuard() { return revoked ? { version: 1, status: 'cleaning' } : null; }
    },
    module: { exports: {} }
  };
  context.globalThis = context;
  vm.runInContext(vaultSource, vm.createContext(context), {
    filename: 'src/core/credential-vault.js'
  });

  const pending = context.module.exports.set('assistant:groq', 'must-not-persist');
  revoked = true;
  generatedKey.resolve({ type: 'secret' });

  await assert.rejects(pending, /revoked/i);
  assert.equal(openCalls, 0);
});
