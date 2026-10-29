# Codex Public-Beta Completion Checklist

Date: 2026-06-08
Scope: local Sutra working tree only.

## Security Audit

- [x] Stage 1 passwordless `.sutra` envelope audit completed before reading the disposable password.
- [x] Stage 1 report saved in `security-artifacts/`.
- [x] Disposable password file was read only for Stage 2 validation.
- [x] Stage 2 password validation completed against the real encrypted audit exports.
- [x] Wrong-password, tamper-rejection, import-flow, and no-mutation checks passed.
- [x] Disposable password file deleted after Stage 2.
- [x] `security-artifacts/` remains ignored locally.
- [x] Static secret-pattern scan completed excluding ignored/generated directories; hits were limited to e2e fixture files.

## Public-Beta Fixes Implemented

- [x] Assistant chat history is now locally managed, searchable/manageable, and sanitized before persistence.
- [x] Assistant chats are included in encrypted backups by default.
- [x] Assistant chats are excluded from plaintext recovery JSON by default.
- [x] Hidden assistant payloads/reasoning/action fences are stripped from stored chat history.
- [x] Assistant session/API-key behavior remains session-only.
- [x] Remote AI disclosure and in-app Assistant guide surfaces are available.
- [x] What’s New / release-notes surface added with local-only unread state.
- [x] Integration registry added with honest Google Drive/Docs gating when OAuth is absent.
- [x] Smart Import added as a reviewed local parser; AI/import output does not write directly without user approval.
- [x] Rich HTML paste into notes is sanitized before insertion.
- [x] `.sutra` calendar export filename stale branding fixed.
- [x] Startup chime default-on behavior preserved with returning-user opt-out.
- [x] Export and Homework modal focus restoration hardened under parallel browser load.
- [x] Responsive Playwright project coverage added for mobile, tablet, and narrow desktop.
- [x] Round-trip guard updated so intentionally device-local Drive/Calendar state is not treated as a workspace-default warning.

## Local Validation

- [x] `npm run check:all` passed cleanly.
- [x] `npm run build:deploy` passed locally.
- [x] `npm run check:deploy` passed locally.
- [x] Full Chromium e2e passed after final modal/focus changes: 79 passed.
- [x] Full Firefox e2e passed before the final Homework explicit return-focus patch: 79 passed.
- [x] Responsive project suite passed after scoping responsive-friendly specs: 39 passed, 3 desktop-only stress cases skipped.
- [x] Public-beta surface matrix passed across Chromium, Firefox, mobile Chromium, tablet Chromium, and narrow desktop: 20 passed.
- [x] `.sutra` Stage 2 browser validation passed.

## Remaining Validation Gaps

- [ ] WebKit local validation is blocked because Playwright WebKit download failed on local TLS certificate verification (`UNABLE_TO_VERIFY_LEAF_SIGNATURE`). No certificate checks were bypassed.
- [ ] Full Firefox was not rerun after the final Homework return-focus patch because the approval/usage limit blocked further elevated browser runs. The same full Firefox project passed earlier in this hardening pass, and the final patch was verified by targeted Chromium plus full Chromium.

## Local Handoff Status

- [x] No remote branch created.
- [x] No push, pull request, merge, deployment, or GitHub write action performed.
- [x] No external account modified.
- [x] Local working tree left ready for manual review with the validation caveats above.
