import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';
import { extractFunction } from '../helpers/extract-function.mjs';

const app = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
const styles = readFileSync(new URL('../../styles/base/styles.css', import.meta.url), 'utf8');

test('onboarding defaults are local-first, skippable, and start at welcome', () => {
  const extract = extractFunction(app, 'getDefaultAppData');
  assert.ok(extract, 'getDefaultAppData is a top-level declaration');
  const start = extract.body.indexOf('onboarding: {');
  const end = extract.body.indexOf('temporaryPages: {', start);
  assert.ok(start >= 0 && end > start, 'the onboarding defaults live inside getDefaultAppData');
  const onboarding = extract.body.slice(start, end);
  assert.ok(onboarding.includes('completed: false'), 'onboarding starts incomplete');
  assert.ok(onboarding.includes('skipped: false'), 'onboarding starts unskipped');
  assert.ok(onboarding.includes("currentStep: 'welcome'"), 'onboarding starts at the welcome step');
  assert.ok(onboarding.includes("aiSetup: { provider: 'local'"), 'the default AI setup is the local provider');
  assert.ok(onboarding.includes('backupAcknowledged: false'), 'backup acknowledgement is never assumed');
  assert.ok(onboarding.includes('migratedFromLegacy: false'), 'legacy migration is never assumed');
});

test('onboarding opens through the unified controller and can be re-run', () => {
  const show = extractFunction(app, 'showStudentOnboarding');
  assert.ok(show, 'showStudentOnboarding is a top-level declaration');
  assert.ok(show.body.includes('AtelierOnboardingController.show()'), 'the wrapper delegates to the unified controller');
  const setup = extractFunction(app, 'showUserModeSetup');
  assert.ok(setup, 'showUserModeSetup is a top-level declaration');
  assert.ok(setup.body.includes("jumpTo: 'welcome'"), 're-running setup returns to the welcome step');
});

test('onboarding normalization completes its migration boundary', () => {
  const normalize = extractFunction(app, 'normalizeOnboardingState');
  assert.ok(normalize, 'normalizeOnboardingState is a top-level declaration');
  assert.match(
    normalize.body,
    /out\.migratedFromLegacy\s*=\s*true;[\s\S]*return out;/,
    'normalized onboarding state must be marked migrated so repeated reads keep object identity'
  );
});

test('onboarding screens offer deferral and point students at the daily loop', () => {
  const protect = extractFunction(app, 'renderProtectStep');
  assert.ok(protect, 'renderProtectStep is a top-level declaration');
  assert.ok(protect.body.includes('Remind me later'), 'backup deferral is available');
  const finish = extractFunction(app, 'renderFinishStep');
  assert.ok(finish, 'renderFinishStep is a top-level declaration');
  assert.ok(finish.body.includes('Capture your first assignment'), 'finish step hands off to the daily loop');
  const mode = extractFunction(app, 'renderModeStep');
  assert.ok(mode, 'renderModeStep is a top-level declaration');
  assert.match(mode.body, /Advanced features[\s\S]*available in Settings/);
});

test('welcome onboarding does not render an unsupported decorative icon glyph', () => {
  assert.match(app, /Your academic life, woven into one private workspace/);
  assert.doesNotMatch(app, /fa-arrows-spin/);
});

test('onboarding auxiliary dialogs return to the step that launched them', () => {
  const launch = extractFunction(app, 'launchAuxiliaryModal');
  assert.ok(launch, 'launchAuxiliaryModal is an onboarding helper');
  assert.match(launch.body, /commitDraftToState\(\)/, 'the draft is retained before the auxiliary dialog opens');
  assert.match(launch.body, /show\(\{ jumpTo: step \}\)/, 'closing the auxiliary dialog resumes the same onboarding step');

  const bind = extractFunction(app, 'bindMain');
  assert.ok(bind, 'bindMain is an onboarding helper');
  assert.match(bind.body, /openStarterPacks\(\{ onClose \}\)/, 'starter packs receive a resume callback');
  assert.match(bind.body, /openHomeworkPasteImport\('', \{ onClose \}\)/, 'paste import receives a resume callback');

  const finishWithImport = extractFunction(app, 'finishWithImport');
  assert.ok(finishWithImport, 'finishWithImport is an onboarding helper');
  assert.match(finishWithImport.body, /onCancel/, 'final import cancellation returns to onboarding');
  assert.match(finishWithImport.body, /onImported/, 'only a successful import completes onboarding');
});

test('onboarding classes use Homework’s canonical API and can be selected as pages', () => {
  const sync = extractFunction(app, 'syncOnboardingClassesToHomework');
  assert.ok(sync, 'syncOnboardingClassesToHomework is an onboarding helper');
  assert.match(sync.body, /window\.SutraHomework\.addCourse/, 'classes are added through Homework’s registered API');
  assert.match(sync.body, /SutraHomeworkStore/, 'the canonical store is a fallback before the Homework UI is ready');
  assert.doesNotMatch(sync.body, /localStorage\.setItem/, 'onboarding does not directly write legacy storage');

  const continueStep = extractFunction(app, 'goContinue');
  assert.ok(continueStep, 'goContinue is an onboarding helper');
  assert.match(continueStep.body, /commitPendingOnboardingClassInput\(\)/, 'Continue retains a class that was typed but not submitted with Enter');

  const mode = extractFunction(app, 'renderModeStep');
  assert.ok(mode, 'renderModeStep is an onboarding helper');
  assert.match(mode.body, /Choose the pages you want/, 'the mode step has an explicit page chooser');
  assert.match(mode.body, /renderSpaceTiles\(draftRef\)/, 'the page chooser renders the existing selectable page tiles');
});

test('an enabled clock remains legible when navigation is compacted', () => {
  const severeClockRule = styles.match(/\.top-nav \.tabs-shell\.tabs-shell-overflow-severe \.toolbar-time-widget\s*\{([\s\S]*?)\n\}/);
  assert.ok(severeClockRule, 'severe navigation compaction has a clock rule');
  assert.match(severeClockRule[1], /display:\s*inline/, 'the clock text is not hidden during severe compaction');
  assert.match(severeClockRule[1], /white-space:\s*nowrap/, 'the compact clock remains readable as one time value');
});
