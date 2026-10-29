import test from 'node:test';
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';

// Browser-global shim sufficient for safe-storage.js (no DOM APIs touched on
// the get() paths under test when storage is unavailable).
const require = createRequire(import.meta.url);

function loadSafeStorage({ available = true } = {}) {
  const store = new Map();
  const storageStub = {
    getItem: (key) => (store.has(String(key)) ? store.get(String(key)) : null),
    setItem: (key, value) => { store.set(String(key), String(value)); },
    removeItem: (key) => { store.delete(String(key)); }
  };
  const warnings = [];
  const windowStub = {
    localStorage: available ? storageStub : undefined,
    sessionStorage: undefined,
    showToast: undefined,
    dispatchEvent: () => true,
    SutraSafeStorage: undefined
  };
  // The module is an IIFE over `window`; run it in a fresh VM context.
  const vm = require('node:vm');
  const fs = require('node:fs');
  const path = require('node:path');
  const source = fs.readFileSync(path.resolve('src/core/safe-storage.js'), 'utf8');
  vm.runInNewContext(source, { window: windowStub, document: { body: null }, console });
  const api = windowStub.SutraSafeStorage;
  return { api, store, warnings };
}

test('get() default contract parses JSON and round-trips plain strings', () => {
  const { api, store } = loadSafeStorage();
  api.set('structured', { items: [1, 2] });
  assert.equal(JSON.stringify(api.get('structured', { fallback: null })), JSON.stringify({ items: [1, 2] }));

  // set() stores plain strings verbatim; the default contract returns them
  // unchanged instead of treating them as corrupt JSON.
  api.set('plain', 'not json');
  assert.equal(api.get('plain', { fallback: 'FB' }), 'not json');

  // Missing keys return the fallback.
  assert.equal(api.get('missing', { fallback: 'FB' }), 'FB');
  assert.ok(store.has('plain'));
});

test("get({ expectJson: true }) treats unparseable content as corruption and returns the fallback", () => {
  const { api } = loadSafeStorage();
  api.set('corrupt', '{broken json');
  assert.equal(api.get('corrupt', { fallback: 'SAFE', expectJson: true }), 'SAFE');
  // Structured values still parse normally under the strict option.
  api.set('ok', { a: 1 });
  assert.equal(JSON.stringify(api.get('ok', { fallback: null, expectJson: true })), JSON.stringify({ a: 1 }));
});

test('strict parse corruption is classified as a read failure, not a write serialization failure', () => {
  const { api } = loadSafeStorage();
  api.set('corrupt', '{broken json');
  assert.equal(api.get('corrupt', {
    fallback: null,
    expectJson: true,
    importance: 'important',
    label: 'homework mirror'
  }), null);
  assert.equal(api.getDegraded().corrupt.classification, 'parse');
});

test("get({ parseJson: false }) keeps returning raw strings for legacy callers", () => {
  const { api } = loadSafeStorage();
  api.set('raw', '{"looks":"like json"}');
  assert.equal(api.get('raw', { fallback: '', parseJson: false }), '{"looks":"like json"}');
});
