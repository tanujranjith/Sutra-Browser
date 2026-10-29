import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
const projectionApi = require('../../src/sync/sync-projection.js');
const protocol = require('../../src/sync/sync-protocol.js');

function clone(value) {
  return value === undefined ? undefined : JSON.parse(JSON.stringify(value));
}

function canonicalRecord(recordKey, value) {
  const out = clone(value);
  const parsed = protocol.parseRecordKey(recordKey);
  const policies = protocol.CLASSIFICATION.recordFieldPolicies || {};
  const policy = policies[recordKey]
    || (parsed && parsed.type === 'collection' ? policies['c/' + parsed.collection] : null)
    || null;
  if (out && typeof out === 'object' && !Array.isArray(out) && policy && Array.isArray(policy.hashVolatile)) {
    policy.hashVolatile.forEach(field => { delete out[field]; });
  }
  return out;
}

export function canonicalSyncRecords(workspace) {
  const records = projectionApi.buildProjection(workspace).records;
  return Object.fromEntries(Object.keys(records).sort().map(key => [key, canonicalRecord(key, records[key])]));
}

export function fieldDiff(expected, actual, path = '$') {
  if (protocol.stableStringify(expected) === protocol.stableStringify(actual)) return [];
  const expectedArray = Array.isArray(expected);
  const actualArray = Array.isArray(actual);
  if (expectedArray || actualArray) {
    if (!expectedArray || !actualArray) return [{ path, expected, actual, reason: 'type' }];
    const out = [];
    const size = Math.max(expected.length, actual.length);
    for (let i = 0; i < size; i += 1) out.push(...fieldDiff(expected[i], actual[i], path + '[' + i + ']'));
    return out;
  }
  const expectedObject = expected !== null && typeof expected === 'object';
  const actualObject = actual !== null && typeof actual === 'object';
  if (expectedObject || actualObject) {
    if (!expectedObject || !actualObject) return [{ path, expected, actual, reason: 'type' }];
    const keys = new Set([...Object.keys(expected), ...Object.keys(actual)]);
    const out = [];
    [...keys].sort().forEach(key => {
      if (!Object.prototype.hasOwnProperty.call(expected, key)) out.push({ path: path + '.' + key, expected: undefined, actual: actual[key], reason: 'unexpected' });
      else if (!Object.prototype.hasOwnProperty.call(actual, key)) out.push({ path: path + '.' + key, expected: expected[key], actual: undefined, reason: 'missing' });
      else out.push(...fieldDiff(expected[key], actual[key], path + '.' + key));
    });
    return out;
  }
  return [{ path, expected, actual, reason: 'value' }];
}

export function comparePortableWorkspaces(expectedWorkspace, actualWorkspace) {
  const expected = canonicalSyncRecords(expectedWorkspace);
  const actual = canonicalSyncRecords(actualWorkspace);
  return { expected, actual, differences: fieldDiff(expected, actual) };
}

export function compareAssetManifests(expected, actual) {
  const normalize = list => (Array.isArray(list) ? list : [])
    .map(row => ({
      hash: String(row && row.hash || ''),
      blobKey: String(row && row.blobKey || ''),
      present: row && row.present === true
    }))
    .sort((a, b) => (a.blobKey + ':' + a.hash).localeCompare(b.blobKey + ':' + b.hash));
  const left = normalize(expected);
  const right = normalize(actual);
  return { expected: left, actual: right, differences: fieldDiff(left, right, '$assets') };
}
