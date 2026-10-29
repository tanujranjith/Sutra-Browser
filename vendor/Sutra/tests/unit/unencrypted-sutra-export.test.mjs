import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const app = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
const shell = readFileSync(new URL('../../Sutra.html', import.meta.url), 'utf8');

test('the unencrypted .sutra export stays explicit, complete, and safely exposed', () => {
  const exportFn = extractFunction(app, 'exportUnencryptedSutraPackage');
  assert.ok(exportFn, 'exportUnencryptedSutraPackage exists');
  // The readable file keeps the complete-attachment preflight and the
  // explicit "not encrypted" warning.
  assert.match(exportFn.body, /window\.confirm\('This \.sutra backup will NOT be encrypted\./);
  assert.match(exportFn.body, /requireCompleteAttachments: true/);
  assert.match(exportFn.body, /recordPersistenceFailure\(error, \{ reason: 'unencrypted-sutra-export'/);
  assert.match(app, /exportUnencryptedPackage: exportUnencryptedSutraPackage/);
  assert.match(shell, /onclick="window\.SutraEncryptedBackups\.exportUnencryptedPackage\(\)"/);
  assert.match(shell, /optional compatibility export[\s\S]*readable by anyone/i);
});

test('the unencrypted .sutra export labels its package plaintext so private chats are excluded by default', () => {
  const exportFn = extractFunction(app, 'exportUnencryptedSutraPackage');
  assert.ok(exportFn, 'exportUnencryptedSutraPackage exists');
  // A readable package must be flagged plaintext: without this, chat history
  // would ride along under the encrypted-backup inclusion preference.
  assert.match(exportFn.body, /plaintextChatPrivacy: true/);
});

test('the package builder forwards the plaintext label into the payload builder', () => {
  const builder = extractFunction(app, 'buildCanonicalSutraPackageBytes');
  assert.ok(builder, 'buildCanonicalSutraPackageBytes exists');
  assert.match(builder.body, /plaintextChatPrivacy: options\.plaintextChatPrivacy === true/);
  assert.match(builder.body, /mode: 'full'/);
  assert.match(builder.body, /includeSensitiveSettings: false/);
});

test('encrypted backup packaging never passes the plaintext label', () => {
  const encrypted = extractFunction(app, 'createEncryptedSutraBackupBlob');
  assert.ok(encrypted, 'createEncryptedSutraBackupBlob exists');
  assert.ok(!encrypted.body.includes('plaintextChatPrivacy'),
    'encrypted backups must keep using the encrypted-backup chat preference');
});

test('the payload builder treats labeled-plaintext packages like JSON recovery for chat inclusion', () => {
  const payload = extractFunction(app, 'buildWorkspaceExportPayload');
  assert.ok(payload, 'buildWorkspaceExportPayload exists');
  assert.match(payload.body, /collectAssistantChatBackupSnapshot\(\{ plaintext: options\.plaintextChatPrivacy === true \|\| mode === 'json' \}\)/);
});

test('chat backup collection gates plaintext inclusion on the explicit recovery preference', () => {
  const snapshot = extractFunction(app, 'collectAssistantChatBackupSnapshot');
  assert.ok(snapshot, 'collectAssistantChatBackupSnapshot exists');
  // Plaintext path: only when the user explicitly opted in (default false).
  assert.match(snapshot.body, /getWorkspacePreference\('assistant\.includeChatsInPlaintextRecovery', false\) === true/);
  // Encrypted path: default true, honored unless explicitly disabled.
  assert.match(snapshot.body, /getWorkspacePreference\('assistant\.includeChatsInEncryptedBackups', true\) !== false/);
});
