#!/usr/bin/env node
import { readFileSync } from 'node:fs';

const app = readFileSync('src/core/app.js', 'utf8');
const html = readFileSync('Sutra.html', 'utf8');

const mustHave = [
  ['commitAppDataWithHealth', 'centralized save pipeline'],
  ['recordPersistenceFailure', 'failure recorder'],
  ['recordPersistenceSuccess', 'success recorder'],
  ['SUTRA_PERSISTENCE_HEALTH_KEY', 'banner persistence key'],
  ['buildPersistenceSummary', 'size/localStorage/attachment summary'],
  ['findMissingCourseExportBlobs', 'missing attachment refusal'],
  ['warmCourseAttachmentCache({ strict: options.requireCompleteAttachments === true })', 'strict cache warm-up on .sutra export'],
  ['PartialWriteError', 'readback partial-write detection'],
  ['QuotaExceededError', 'quota classification path'],
  ['window.SutraPersistenceHealth', 'browser health API'],
  ['window.__sutraPublicBetaTestHooks', 'failure-mode test hooks'],
  ['retrySutraPersistenceSave', 'retry path'],
  ['exportEmergencySutraBackup', 'emergency .sutra export path'],
  ['saveWorkspaceLocally', 'canonical wrapper still exported']
];

const htmlNeedles = [
  ['sutraSaveFailureBanner', 'non-dismissible failure banner'],
  ['sutraSaveRetryBtn', 'retry button'],
  ['sutraEmergencyExportBtn', 'emergency export button'],
  ['sutraSaveFailureDetails', 'technical details'],
  ['sutraHealthWorkspaceSize', 'workspace size'],
  ['sutraHealthAttachmentTotals', 'attachment totals'],
  ['sutraHealthBackupState', 'backup state']
];

let failures = 0;
for (const [needle, label] of mustHave) {
  if (!app.includes(needle)) {
    console.error(`FAIL app.js missing ${label}: ${needle}`);
    failures += 1;
  }
}
for (const [needle, label] of htmlNeedles) {
  if (!html.includes(needle)) {
    console.error(`FAIL Sutra.html missing ${label}: ${needle}`);
    failures += 1;
  }
}
if (!/scheduleAppSave\(\)[\s\S]*commitAppDataWithHealth\('autosave'/.test(app)) {
  console.error('FAIL autosave does not route through commitAppDataWithHealth');
  failures += 1;
}
if (!/flushAppSaveNow\(reason = 'manual'(?:, options = \{\})?\)[\s\S]*commitAppDataWithHealth\(reason/.test(app)) {
  console.error('FAIL manual/lifecycle flush does not route through commitAppDataWithHealth');
  failures += 1;
}

if (failures) {
  console.error(`Persistence health check FAILED (${failures} issue${failures === 1 ? '' : 's'}).`);
  process.exit(1);
}
console.log('Persistence health check passed.');
