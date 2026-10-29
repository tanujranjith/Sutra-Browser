import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const appRuntime = readFileSync(new URL('../../src/core/app.js', import.meta.url), 'utf8');
const studentLoopActions = readFileSync(new URL('../../src/ui/student-loop-actions.js', import.meta.url), 'utf8');

test('Focus Session uses the canonical timer bridge instead of a second interval', () => {
  assert.match(appRuntime, /function bindFocusTimerBridge\(\)[\s\S]*?sutra:focus-timer-command/);
  assert.match(appRuntime, /function _fsTimerCommand\(action, seconds\)[\s\S]*?sutra:focus-timer-command/);
  assert.match(appRuntime, /function _fsStartTimer\(\)[\s\S]*?_fsTimerCommand\('start'\)/);
  assert.match(appRuntime, /function _fsPauseTimer\(\)[\s\S]*?_fsTimerCommand\('pause'\)/);
  assert.match(appRuntime, /function fsReset\(\)[\s\S]*?_fsTimerCommand\('reset'\)/);
  assert.doesNotMatch(appRuntime, /_fsIntervalId\s*=\s*setInterval\(/);
});

test('Focus Session mirrors timer duration and state when opening or receiving timer updates', () => {
  assert.match(appRuntime, /function _fsOpenOverlay\(\)[\s\S]*?_fsSyncFromCanonicalTimer\(\)/);
  assert.match(appRuntime, /function _fsApplyTimerSnapshot\(snapshot\)[\s\S]*?plannedDurationSeconds = duration[\s\S]*?elapsedSeconds = Math\.max\(0, duration - remaining\)[\s\S]*?running = !!snapshot\.running/);
  assert.match(appRuntime, /document\.addEventListener\('sutra:focus-timer-updated',[\s\S]*?_fsApplyTimerSnapshot/);
  assert.match(appRuntime, /function _fsCloseOverlay\(reason\)[\s\S]*?Closing the full-screen view must not alter the canonical sidebar timer/);
});

test('Today starts the requested 50-minute session through the same timer', () => {
  assert.match(studentLoopActions, /plannedDurationSeconds:\s*50 \* 60/);
  assert.match(studentLoopActions, /autostart:\s*true/);
  assert.match(appRuntime, /if \(hasRequestedDuration\) \{[\s\S]*?_fsTimerCommand\('set-duration', Math\.floor\(requestedDuration\)\)/);
});

test('mobile Today passes the duration shown on its focus button into the canonical timer', () => {
  assert.match(appRuntime, /data-rn-focus-seconds="\$\{Math\.round\(focusMinutes \* 60\)\}"/);
  assert.match(appRuntime, /const seconds = Math\.max\(60, Math\.floor\(Number\(btn\.getAttribute\('data-rn-focus-seconds'\)\) \|\| 0\)\)/);
  assert.match(appRuntime, /const options = \{ plannedDurationSeconds: seconds, autostart: true, title \}/);
  assert.match(appRuntime, /startFocusSession\(sid, options\)[\s\S]*?startFocusSession\(null, options\)/);
});
