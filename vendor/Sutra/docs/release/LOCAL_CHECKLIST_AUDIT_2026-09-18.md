# Local checklist audit — 2026-09-18

Preview: http://127.0.0.1:5175/Sutra.html
Branch: codex/integration-all-issues. Root main worktree is clean.

## Result

The expanded browser run passed 48 tests and initially exposed a timing-sensitive
Glass medium-width Notes layout collision. At 929 × 965, the measured title top
was 190px while the toolbar bottom was 208px in the failing state. The fix now
measures the rendered sticky toolbar during the responsive transition and adds
only the required editor clearance. The Glass test passes in five consecutive
fresh Chromium runs, including the phone assertions.

## Newly completed checks

- Class merging through the overflow menu retains both assignments and the
  chosen name. Removal works for populated and empty classes and extracurriculars,
  including dashboard and phone modal controls.
- Homework grouped/mobile layout and completion styling pass.
- Search opens ready for typing without the automatic focus ring.
- Glass tablet Notes keeps the document title below the toolbar through viewport
  changes and theme entrance transitions; five repeated browser runs pass.
- Cloud hub desktop and phone accessibility and local-only behavior pass.
- All nine Drive snapshot-sync tests pass, including restore conflicts and a
  local save during a remote pull.
- All 29 provider tests pass, including ciphertext-only backup/restore for
  Supabase, Drive, OneDrive and Dropbox, retention, failed-upload rollback,
  session persistence/sign-out races, and cross-tab scheduled-backup deduplication.
  These use simulated provider services, not production provider accounts.
- Added and passed an encrypted round-trip test for long note titles/body,
  HTML source and Homework title/notes, checking exact content before and after
  reload, encrypted export, restore and another reload. Restore includes the
  encrypted safety snapshot flow.
- Ten unit checks pass for backup preconditions and cadence, cross-tab locks,
  session passphrase separation, metadata migration, status separation and
  decryption-failure recovery guidance.
- Workflow static check passes for dependency caching and exact-artifact testing.
- git diff --check passes.

## Codex browser observations

- Existing staged workspace opens with Sync off and automatic backups off.
  Both capabilities appear inside the Cloud hub.
- Created a clearly named QA September 18 note through the editor with a
  1,197-character title and 115,020 characters of input including line breaks.
  Reload preserved the complete title and body text. Editor paragraphs represent
  the line breaks, so raw DOM textContent is not identical to the input string.
  The QA note remains in the preview for inspection.
- Extracurricular dashboard displays its removal button and no stray document
  labels at the page bottom. Browser error log was empty.

## Prior evidence, not rerun in this audit

The previous full npm run verify passed 625 unit tests, 70 smoke tests and
23 Sync tests, and built/validated the deploy artifact. Those Sync tests use
simulated backend responses; they cover automatic edits, reconnect, pause/lock,
sign-out, conflicts, two-tab single-flight, account boundaries, attachments,
revoke/wipe and decryption failures. The default verify command does not include
the separate Glass test that failed in this expanded audit.

## Remaining verification boundaries

- The Codex preview is signed out: no real-account two-device Sync or current
  production decryption recovery was established here.
- Production provider authentication, cross-account server authorization and
  physical-device revoke/wipe remain operator checks. No real vault was deleted.
- Daily cadence is covered by unit time-window checks; a real elapsed-day upload
  was not observed. The browser scheduling test exercises app-hidden mode;
  significant-change scheduling has not received a separate full browser run.
- Same-titled assignment handling, merge persistence after reload and keyboard
  Search navigation beyond opening focus need further dedicated coverage.
- Assistant light/dark visual checks were performed in the previous audit;
  authenticated AI error states were not exercised in this run.
- GitHub cache-hit evidence and CI remain pending a separately authorized push.

## Commands

With PLAYWRIGHT_PORT=5175:

```text
npx playwright test --project=chromium --workers=1 homework-course-removal homework-course-merging homework-ux global-search-focus glass-theme cloud-hub sutra-cloud-providers google-drive-sync
npx playwright test --project=chromium --workers=1 glass-theme
npx playwright test --project=chromium --workers=1 encrypted-backups -g "long authored"
node --test tests/unit/automatic-backup-contract.test.mjs tests/unit/cloud-coordinator.test.mjs tests/unit/sync-ux-guard.test.mjs
npm run check:workflows
git diff --check
```

The Glass responsive repair, its generated asset/cache metadata, the encrypted
round-trip test, and this audit report were changed during this audit. Remote
services and main were not changed.
