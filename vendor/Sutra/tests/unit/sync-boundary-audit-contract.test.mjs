import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const inventory = JSON.parse(readFileSync(new URL('../../docs/architecture/persistence-inventory.json', import.meta.url), 'utf8'));
const protocol = readFileSync(new URL('../../docs/architecture/SYNC_PROTOCOL.md', import.meta.url), 'utf8');
const appSource = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
const mergeSource = readFileSync(new URL('../../src/sync/sync-merge.js', import.meta.url), 'utf8');

test('Sync audit preserves portable workspace contracts while excluding device state and credentials', () => {
  const text = JSON.stringify(inventory);
  assert.match(protocol, /deviceId.*Never appears in workspace exports/s);
  assert.match(protocol, /session keys, tokens,[\s\S]*provider configuration, sync state/i);
  assert.match(protocol, /settings\.preferences\.sync.*device-local/is);
  assert.match(text, /assistantChatHistory/);
  assert.match(text, /syncAuditLog/);
  assert.match(text, /privateDocuments/);
});

test('conflict resolution audit records carry only opaque refs, never raw opIds', () => {
  const writer = extractFunction(appSource, 'resolveSutraSyncConflict');
  assert.ok(writer, 'resolveSutraSyncConflict is a top-level declaration');
  const markerStart = writer.body.indexOf('sync_conflict_resolution');
  assert.ok(markerStart >= 0, 'resolution marker kind is written');
  const marker = writer.body.slice(markerStart);
  assert.ok(marker.includes('winnerAuditId'), 'audit record writes winnerAuditId');
  assert.ok(marker.includes('loserAuditId'), 'audit record writes loserAuditId');
  assert.ok(!marker.includes('winnerOpId'), 'audit record never writes raw winnerOpId');
  assert.ok(!marker.includes('loserOpId'), 'audit record never writes raw loserOpId');
});

test('merge derives audit refs from op content hashes so device ids never cross devices', () => {
  const decl = mergeSource.indexOf('async function auditRefFor(op) {');
  assert.ok(decl >= 0, 'auditRefFor is declared in the merge module');
  const declLineEnd = mergeSource.indexOf('\n', decl);
  const bodyLine = mergeSource.slice(declLineEnd + 1, mergeSource.indexOf('\n', declLineEnd + 1));
  assert.ok(bodyLine.includes('hashText'), 'audit refs use the protocol content hash');
  assert.ok(bodyLine.includes('op.opId'), 'audit refs hash the opId, not the deviceId');
  assert.ok(bodyLine.includes('null'), 'missing op produces a null ref');
  assert.ok(!bodyLine.includes('deviceId'), 'audit ref derivation never reads deviceId');
  assert.ok(mergeSource.includes('winnerAuditId'), 'conflict records expose the winner audit ref');
  assert.ok(mergeSource.includes('loserAuditId'), 'conflict records expose the loser audit ref');
});
