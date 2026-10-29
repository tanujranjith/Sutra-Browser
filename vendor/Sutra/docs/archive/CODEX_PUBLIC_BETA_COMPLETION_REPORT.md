# Codex Public-Beta Completion Report

Date: 2026-06-08
Workspace: `D:\Desktop\coding\Sutra`

## Verdict

Sutra is ready for local manual review for public-beta hardening. The confirmed product/security issues found during the pass were patched locally and the primary Chromium suite is green after the final changes. WebKit validation remains environment-blocked by local TLS trust during browser download, and a post-final-patch full Firefox rerun was blocked by the app approval/usage limit.

## Audit Results

Stage 1 was completed before reading the disposable password. The encrypted exports were confirmed to be encrypted envelopes with no plaintext JSON, ZIP, decompressed, Base64, or sensitive-token exposure in the passwordless inspection path. The Stage 1 report is saved in `security-artifacts/`.

Stage 2 used the disposable local password only for validation. Correct-password decrypt/import succeeded, wrong-password import was rejected without mutation, tampered envelopes were rejected, and plaintext downloads created by the validator were removed. The disposable password file was deleted afterward and both possible password-file paths now return absent. The Stage 2 report is saved in `security-artifacts/`.

`security-artifacts/` is ignored by both `.gitignore` and `.git/info/exclude`.

## Changes Made

- Added local What’s New release notes with unread state and no remote fetch.
- Added a truthful integration registry with Google Drive/Docs gated unless OAuth config exists.
- Added reviewed Smart Import for local text-like documents with injection rejection, duplicate/needs-review handling, approval-only writes, and undo.
- Added Assistant chat history management, local persistence, encrypted-backup inclusion, plaintext-backup exclusion by default, and sanitization of hidden reasoning/action payloads.
- Added Assistant history/settings/disclosure/guide controls.
- Sanitized rich HTML paste into notes before insertion.
- Hardened modal focus restoration with explicit return-focus support for export and Homework modals.
- Fixed stale Sutra calendar export branding.
- Added responsive Playwright projects and scoped them to responsive-friendly specs.
- Updated static guards for rebrand and round-trip behavior.

## Validation Evidence

- `npm run check:all`: passed cleanly after guard update.
- `npm run build:deploy`: passed; local `.deploy/` artifact staged.
- `npm run check:deploy`: passed.
- `npx playwright test --project=chromium`: 79 passed after final modal/focus changes.
- `npx playwright test --project=firefox`: 79 passed before the final Homework return-focus patch.
- `npx playwright test --project=mobile-chromium --project=tablet --project=narrow-desktop`: 39 passed, 3 desktop-only stress tests skipped.
- Public-beta surface matrix across installed desktop/responsive projects: 20 passed.
- Stage 2 `.sutra` validator: verified correct password, wrong password rejection, tamper rejection, import flow, and no-mutation behavior.

## Blockers / Caveats

WebKit could not be installed locally because Playwright’s WebKit download failed TLS certificate verification. I did not bypass certificate verification. Desktop WebKit remains configured for environments with the browser binary available.

The approval/usage limit blocked the final full Firefox rerun after the last Homework modal return-focus patch. The final patch was validated by the targeted Chromium modal regression and the full Chromium suite; Firefox full-suite evidence exists from earlier in the same hardening pass.

## Working Tree Notes

No GitHub write actions, branch creation, push, pull request, merge, deployment, or external-account changes were performed. Existing local untracked Claude reports remain untracked. New Codex reports are in `docs/` for local review.
