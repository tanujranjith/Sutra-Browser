import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractBalancedBlock } from '../helpers/extract-function.mjs';

const appSource = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');

function loadLocalDiscovery() {
  const block = extractBalancedBlock(appSource, 'discoverModels: async (provider) =>');
  assert.ok(block, 'discoverModels arrow method is present in app.js');
  const arrowStart = block.body.indexOf('async (provider) => {');
  assert.ok(arrowStart >= 0, 'discoverModels is an async arrow method');
  const run = new Function(
    'getWorkspacePreference',
    'getProviderApiKey',
    'fetch',
    'cacheModels',
    `return (${block.body.slice(arrowStart)});`
  );
  return run;
}

function okJson(payload) {
  return { ok: true, status: 200, json: async () => payload };
}

async function discoveryWith(run, { baseUrl = 'http://127.0.0.1:11434', key = '', status = 200, payload = null }) {
  const calls = [];
  const fetchStub = async (url, init) => {
    calls.push({ url, headers: (init && init.headers) || {} });
    if (status !== 200) {
      return { ok: false, status, json: async () => ({ error: { message: `HTTP ${status}` } }) };
    }
    return okJson(payload || { data: [{ id: 'llama3.1' }, { name: 'deepseek-r1' }] });
  };
  const cached = [];
  const local = run(
    () => ({ baseUrl }),
    () => key,
    fetchStub,
    (provider, models) => cached.push({ provider, models })
  );
  return { calls, cached, result: await local('local') };
}

test('local model discovery sends the session-held local_api_key as a Bearer token', async () => {
  const run = loadLocalDiscovery();
  const { calls, cached, result } = await discoveryWith(run, { key: 'session-key-abc' });
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, 'http://127.0.0.1:11434/models');
  assert.deepEqual(calls[0].headers, { Authorization: 'Bearer session-key-abc' });
  assert.deepEqual(result, ['llama3.1', 'deepseek-r1']);
  assert.deepEqual(cached, [{ provider: 'local', models: ['llama3.1', 'deepseek-r1'] }]);
});

test('local model discovery stays keyless when no local_api_key is held', async () => {
  const run = loadLocalDiscovery();
  const { calls, result } = await discoveryWith(run, { key: '' });
  assert.deepEqual(calls[0].headers, {}, 'open local servers must still work without a key');
  assert.deepEqual(result, ['llama3.1', 'deepseek-r1']);
});

test('local model discovery fails closed without a configured base URL', async () => {
  const run = loadLocalDiscovery();
  let fetched = false;
  const local = run(
    () => ({}),
    () => 'key',
    async () => { fetched = true; },
    () => {}
  );
  await assert.rejects(() => local('local'), /Configure the local endpoint base URL first\./);
  assert.equal(fetched, false, 'no request leaves the device without a base URL');
});

test('local model discovery surfaces upstream errors', async () => {
  const run = loadLocalDiscovery();
  const local = run(
    () => ({ baseUrl: 'http://127.0.0.1:11434' }),
    () => 'secret-key',
    async (url, init) => {
      assert.equal(init.headers.Authorization, 'Bearer secret-key');
      return { ok: false, status: 401, json: async () => ({ error: { message: 'unauthorized' } }) };
    },
    () => {}
  );
  await assert.rejects(() => local('local'), /unauthorized/);
});
