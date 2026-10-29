import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const require = createRequire(import.meta.url);
const migrations = require('../../src/core/migrations.js');
const startupSource = readFileSync(new URL('../../src/core/startup-health.js', import.meta.url), 'utf8');

test('startup health checks the real migration registry API', () => {
  assert.equal(typeof migrations.migrateWorkspace, 'function');
  assert.match(startupSource, /SutraMigrations\.migrateWorkspace/);
  assert.doesNotMatch(startupSource, /SutraMigrations\.migrate\s*===/);
});
