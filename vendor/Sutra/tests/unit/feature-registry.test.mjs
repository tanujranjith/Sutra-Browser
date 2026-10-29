import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import test from 'node:test';

const require = createRequire(import.meta.url);
const singleton = require('../../src/features/feature-registry.js');

function harness() {
  const calls = [];
  const loader = {
    async script(src) { calls.push(['script', src]); },
    async style(href) { calls.push(['style', href]); },
    enableStyle(href) { calls.push(['enable-style', href]); },
    disableStyle(href) { calls.push(['disable-style', href]); }
  };
  const manifest = {
    base: { id: 'base', displayName: 'Base', pack: 'test', defaultEnabled: false, dependencies: [], scripts: ['base.js'], styles: ['base.css'], initialization: '', teardown: '', navigationEntries: ['base'], persistenceNamespace: 'baseData', assistantCapabilities: [], searchIntegration: [], commandIntegration: [] },
    heavy: { id: 'heavy', displayName: 'Heavy', pack: 'test', defaultEnabled: false, dependencies: ['base'], scripts: ['heavy-a.js', 'heavy-b.js'], styles: ['heavy.css'], initialization: '', teardown: '', navigationEntries: ['heavy'], persistenceNamespace: 'heavyData', assistantCapabilities: ['heavy'], searchIntegration: ['heavy'], commandIntegration: ['open-heavy'] }
  };
  return { registry: singleton.createFeatureRegistry(manifest, loader), calls };
}

test('disabled packs load no scripts, styles, listeners, or background initializers', async () => {
  const { registry, calls } = harness();
  const result = await registry.configure({ base: false, heavy: false });
  assert.deepEqual(calls, [['disable-style', 'base.css'], ['disable-style', 'heavy.css']]);
  assert.equal(result.every((row) => row.state.initialized === false), true);
  assert.equal(registry.getState('heavy').loaded, false);
});

test('dependencies load predictably and each asset initializes once', async () => {
  const { registry, calls } = harness();
  await Promise.all([registry.enable('heavy'), registry.enable('heavy')]);
  assert.deepEqual(calls, [
    ['style', 'base.css'], ['script', 'base.js'], ['enable-style', 'base.css'],
    ['style', 'heavy.css'], ['script', 'heavy-a.js'], ['script', 'heavy-b.js'], ['enable-style', 'heavy.css']
  ]);
  assert.equal(registry.getState('base').loaded, true);
  assert.equal(registry.getState('heavy').initialized, true);
  assert.ok(registry.getMetrics().heavy.durationMs >= 0);
});

test('disabling and re-enabling preserves the persistence namespace and does not reload assets', async () => {
  const { registry, calls } = harness();
  await registry.enable('heavy');
  await registry.disable('heavy');
  assert.ok(calls.some((row) => row[0] === 'disable-style' && row[1] === 'heavy.css'));
  assert.equal(registry.get('heavy').persistenceNamespace, 'heavyData');
  assert.equal(registry.getState('heavy').loaded, true);
  await registry.enable('heavy');
  assert.equal(calls.filter((row) => row[0] === 'script').length, 3);
  assert.equal(calls.filter((row) => row[0] === 'enable-style' && row[1] === 'heavy.css').length, 2);
});

test('feature definitions expose the full declarative contract', () => {
  const { registry } = harness();
  const feature = registry.get('heavy');
  for (const field of ['id', 'displayName', 'pack', 'defaultEnabled', 'dependencies', 'scripts', 'styles', 'initialization', 'teardown', 'navigationEntries', 'persistenceNamespace', 'assistantCapabilities', 'searchIntegration', 'commandIntegration']) {
    assert.equal(Object.prototype.hasOwnProperty.call(feature, field), true, field);
  }
});

test('recovery mode prevents optional assets and initializers from loading', async () => {
  globalThis.SutraRecoveryMode = { shouldLoadOptionalFeature: () => false };
  try {
    const { registry, calls } = harness();
    const result = await registry.enable('heavy');
    assert.equal(result.enabled, false);
    assert.equal(result.loaded, false);
    assert.match(result.error, /Recovery Mode/);
    assert.deepEqual(calls, []);
  } finally {
    delete globalThis.SutraRecoveryMode;
  }
});
