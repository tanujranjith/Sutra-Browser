#!/usr/bin/env node
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const require = createRequire(import.meta.url);
const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const migrations = require(resolve(repoRoot, 'src/core/migrations.js'));
const fixture = JSON.parse(readFileSync(resolve(repoRoot, 'tests/fixtures/workspace-v1.json'), 'utf8'));
const appSource = readFileSync(resolve(repoRoot, 'src/core/app.js'), 'utf8');
const recoverySource = readFileSync(resolve(repoRoot, 'src/boot/legacy-workspace-migration.js'), 'utf8');
const original = JSON.stringify(fixture);
const result = migrations.migrateWorkspace(fixture, { targetVersion: migrations.CURRENT_VERSION, now: '2026-07-09T12:00:00.000Z' });
const failures = [];

const CURRENT = migrations.CURRENT_VERSION;
const appSchemaVersionMatch = appSource.match(/const APP_SCHEMA_VERSION = (\d+);/);
const appSchemaVersion = appSchemaVersionMatch ? Number(appSchemaVersionMatch[1]) : 0;
const recoveryFallbackMatch = recoverySource.match(/SutraMigrations\.CURRENT_VERSION\) \|\| (\d+)/);
const recoveryFallbackVersion = recoveryFallbackMatch ? Number(recoveryFallbackMatch[1]) : 0;
const expectedApplied = Array.from({ length: CURRENT - 1 }, (_, i) => `v${i + 1}->v${i + 2}`).join(',');
if (appSchemaVersion !== CURRENT) failures.push(`app IndexedDB schema version ${appSchemaVersion || 'missing'} does not match migration registry version ${CURRENT}`);
if (!recoverySource.includes('version: CANONICAL_DB_VERSION')) failures.push('boot-time workspace recovery adapter does not use the canonical schema version');
if (recoveryFallbackVersion !== CURRENT) failures.push(`boot-time workspace recovery fallback version ${recoveryFallbackVersion || 'missing'} does not match migration registry version ${CURRENT}`);
if (JSON.stringify(fixture) !== original) failures.push('migration mutated the source fixture');
if (result.workspace.version !== CURRENT) failures.push(`v1 fixture did not reach current schema version ${CURRENT}`);
if (result.applied.join(',') !== expectedApplied) failures.push(`sequential migrations were not recorded (expected ${expectedApplied}, got ${result.applied.join(',')})`);
if (!result.workspace.streaks || result.workspace.streaks.taskStreaks['legacy-task-1'] !== 3) failures.push('legacy streak state was not migrated');
if (!result.workspace.pluginOwnedFutureField || result.workspace.pluginOwnedFutureField.preserve !== true) failures.push('unknown fields were not preserved');
if (!result.workspace.pages || result.workspace.pages[0].id !== 'legacy-page-1') failures.push('workspace content was not preserved');

const alreadyCurrent = migrations.migrateWorkspace(result.workspace, { targetVersion: migrations.CURRENT_VERSION });
if (alreadyCurrent.applied.length !== 0) failures.push('current workspace should not migrate twice');

const future = migrations.migrateWorkspace({ version: 9, custom: true }, { targetVersion: migrations.CURRENT_VERSION });
if (!future.futureVersion || future.workspace.version !== 9 || future.workspace.custom !== true) failures.push('future-version workspace was not preserved');

if (failures.length) {
  console.error('MIGRATION CHECK FAILED:');
  failures.forEach((failure) => console.error(' - ' + failure));
  process.exit(1);
}

console.log(`Migration registry check passed (v1 -> v${CURRENT} sequentially, validation, idempotence, future-version preservation).`);
