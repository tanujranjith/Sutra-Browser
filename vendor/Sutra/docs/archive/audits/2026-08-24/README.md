# 2026-08-24 multi-model audit archive

These reports are historical review inputs, not current implementation instructions. They audited snapshots from around 2026-08-23/24, contain overlapping and sometimes conflicting recommendations, and may cite paths or line numbers that have since changed. Current decisions must follow `AGENTS.md`, the architecture documents, current code, and executable tests.

## Raw reports

- [ChatGPT Sol Pro](ChatGPT%20Sol%20Pro_2026-08-24.txt)
- [GLM 5.3](GLM%205.3_2026-08-24.txt)
- [GPT 5.6 Sol High Codex](GPT%205.6%20sol%20high%20codex_2026-08-24.txt)
- [Grok 4.5](Grok%204.5_2026-08-24.txt)
- [OX Alpha](OX%20Alpha_2026-08-24.txt)

## Consolidated assessment

The reports did not establish a confirmed critical vulnerability. Their shared conclusion was that Sutra's strongest foundations are its local-first persistence, encrypted backup and Sync design, safety boundaries, deterministic domain modules, offline posture, documentation, and artifact-based release verification. Their shared concern was that those strong subsystems are increasingly expensive to change because the central runtime, styling cascade, startup payload, and feature/navigation surface have accumulated too much responsibility.

Status legend:

- **Resolved**: implemented on `ox-alpha/audit-remediation` and covered by relevant tests.
- **Validated pending integration**: implemented and certified in the isolated `codex/audit-certification` worktree, but not yet integrated into the remediation branch.
- **Partial**: meaningful remediation landed, but the broader architectural finding remains.
- **Open**: still requires a separately scoped change or operator action.
- **Preserve**: a reviewed strength or compatibility boundary that should not be casually rewritten.

## Security, privacy, and data safety

- [x] **Resolved — Assistant private-context boundary.** Assistant context is deny-by-default for private documents and is rechecked after enrichment and immediately before outbound use. Relevant remediation commits include `9f9c02a`, `86df58a`, and `14ebc0d`.
- [x] **Resolved — Credential, redaction, and parse-failure visibility.** Credential-vault corruption, provider-key lookup, fail-closed activity redaction, and safe-storage parse semantics were tightened in `b7fe831`, `fb8ffbd`, and `4be1ef4`.
- [x] **Resolved — Remote Office parser supply chain.** DOCX/XLSX parsers are pinned, vendored, integrity-checked, available offline on first use, and no longer require runtime CDN script origins (`86f2dcd`, `1fcb2bb`, `d1e3b8d`, `8b774e5`, `82734ac`).
- [x] **Resolved — Modal background isolation.** Background content becomes inert for nested and stacked modal flows (`3ac985f`, `d3e853c`).
- [x] **Resolved — Restore and revoke/wipe fail-closed behavior.** Restore checkpoints, encrypted safety snapshots, database-removal verification, and revocation finalization no longer claim success when durability or cleanup cannot be verified (`21c0ff2`, `4acc236`, `42d22e8`, `66cee29`, `0dda75a`).
- [ ] **Validated pending integration — Revoked-screen concealment and post-wipe startup.** Live certification found and fixed stale mounted-workspace disclosure and unwanted database recreation after wipe. Focused browser tests and live staging revocation tests passed in `codex/audit-certification`.
- [ ] **Partial — CSP containment.** Runtime Office CDN dependencies were removed, but inline executable code/handlers and `script-src 'unsafe-inline'` remain a large migration. Continue with delegated listeners and external scripts in bounded increments; do not weaken the current sink guardrails meanwhile.
- [ ] **Partial — Stored credentials under same-origin compromise.** Vault and redaction boundaries are stronger, but a successful same-origin script injection remains high impact until CSP and unsafe DOM-sink debt are further reduced.
- [ ] **Open — Live production response headers.** Static response-header checks pass, but the production host must be verified after an authorized deployment and the actual hosting platform must enforce the intended policy.

## Sync and Supabase

- [x] **Resolved — Durable Sync acknowledgements and replay barrier.** Cursor acknowledgement occurs only after durable apply, and replay rejection is retained through pruning (`3d01749`, `fbc2669`).
- [x] **Resolved — Server-side op-log pruning design.** Snapshot/device-floor pruning was implemented on the remediation branch (`8f1fc47`).
- [ ] **Validated pending integration — Live pruning fixes.** Staging certification exposed and fixed an ambiguous `sync_put_asset` hash conflict and an invalid pruning-floor reference. The corrected schema/migrations passed live pruning, replay, convergence, bootstrap, revocation, account-isolation, Storage-isolation, and concurrency tests in `codex/audit-certification`.
- [x] **Validated — Staging authorization and ciphertext isolation.** Account A/B table, RPC, device, payload, and Storage isolation passed against the disposable non-production staging project. Production Supabase was not modified.
- [ ] **Open — Production migration.** Plan and approve the production Supabase migration separately, only after the certification changes are integrated and reviewed.

## Persistence and reliability

- [x] **Resolved — Persistence health extraction and safer lifecycle writes.** Persistence-state policy was extracted from `app.js`; same-tab lifecycle conflicts, rapid Homework changes, missing bridges, and malformed asynchronous feature initialization now fail visibly or safely (`2503a1e`, `4e641a4`, `0cfaaf5`, `2f157d8`, `f789318`, `e921453`).
- [x] **Resolved — Runtime budget no longer rewards monolith growth.** Minimum-size floors were replaced by an evidence-bearing maximum budget (`7d7a6cb`, `2e6f45a`, `6625abf`).
- [ ] **Pending local integration — Missing canonical-root recovery.** The current remediation worktree contains a coherent, tested checkpoint-hash change that distinguishes a fresh origin from unexpected IndexedDB root loss and allows recovery only from the exact independently confirmed in-memory base. Preserve and integrate the related `app.js`, persistence-state, unit, and E2E changes together.
- [ ] **Partial — One canonical mutation receipt.** Several save paths now honor durable completion and surface scheduling failures, but the product still lacks one universal command/receipt model spanning scheduled, committed, verified, conflicted, and failed mutations.
- [ ] **Open — Remaining silent-loss and bounded-history review.** Re-audit consequential catch paths, history/version caps, attachment failure paths, and recovery journals as those subsystems change.

## Architecture and maintainability

- [ ] **Partial — `src/core/app.js` concentration.** Persistence policy extraction and the maximum budget are concrete progress, but the central runtime remains the dominant ownership and regression boundary. Continue only through small behavior-tested seams; do not perform a framework or module-system rewrite.
- [ ] **Open — Source-text contracts versus behavior tests.** Replace weak regex/string-presence contracts with executable tests as functions are extracted. Preserve static checks where they genuinely enforce architecture or deployment invariants.
- [ ] **Open — Utility duplication.** Consolidate local HTML escapers, date-key formatters, dialog resolvers, timers, ranking entry points, and toast shims behind existing canonical helpers.
- [ ] **Open — Feature lifecycle and lazy loading.** Extend the existing registry/lifecycle approach to optional editors and advanced packs so hidden features do not pay full startup, polling, and DOM costs.
- [ ] **Open — Navigation and route state.** Continue toward one route snapshot and one user-facing taxonomy across desktop, mobile, contextual navigation, onboarding, settings, and commands.
- [ ] **Preserve — Static, local-first compatibility.** Do not rename frozen storage identifiers, replace the app with a required backend/framework runtime, weaken deterministic Sync/backup formats, or remove mature advanced capabilities solely to simplify the shell.

## Testing and release confidence

- [x] **Resolved — Named persistence chaos invariants.** Weak storage checks were replaced with precise durability/failure assertions, with additional missing-root tests currently awaiting integration (`2b60ec9` plus the local worktree changes).
- [x] **Validated — Certification gates.** The certification worktree passed 581 unit tests, Sync E2E 20/20, required Chromium 67/67, Pixel 7 52 passed with 3 intentional skips, Office Chromium/Firefox/WebKit 3/3, encrypted backup 8/8, live staging Sync/security/pruning suites, `check:all`, deployment build/check, syntax, and `git diff --check`.
- [ ] **Partial — Cross-browser release coverage.** Targeted cross-browser and mobile certification passed, but repository policy should define the risk-based Firefox/WebKit/mobile slice required on pull requests versus scheduled or release runs.
- [ ] **Open — Test quality and coverage measurement.** Reduce fixed sleeps and duplicated boot helpers, make accessibility assertions fail on serious defects, and add meaningful coverage signals for pure safety/domain/persistence/Sync modules without using a metric that rewards low-value tests.
- [ ] **Open — Performance budgets.** Track base transfer/parse size, critical cache size, startup time, long tasks, representative save time, and large-workspace behavior as enforceable release budgets.

## UI, accessibility, and product coherence

- [x] **Resolved — Specific keyboard/focus regressions.** Theme cards, modal isolation, mobile More-sheet routing/focus restoration, and Homework mobile navigation received targeted fixes and tests (`4611263`, `3ac985f`, `f517ed0`, `2831689`, `0552366`).
- [ ] **Open — Stylesheet and token consolidation.** The large ordered cascade, legacy layers, duplicate token families, raw values, and `!important` dependence remain long-term debt. Migrate component by component while preserving `Sutra.html` link-order semantics.
- [ ] **Open — Broad accessibility assurance.** Continue hard checks for names, keyboard completion, focus restoration, reflow/zoom, reduced motion, contrast, and 44-pixel touch targets across primary views and themes.
- [ ] **Open — Daily-loop information architecture.** Keep Home, Capture, Homework, Create, Timeline, Review, Focus, and Data/Backup as the default story while placing advanced systems behind deliberate entry points. Remove duplicate summaries and vocabulary rather than mature capabilities.
- [ ] **Optional — Automatic system theme.** `prefers-color-scheme` support was suggested, but it should follow token consolidation and remain compatible with explicit user theme choice.

## Repository and release operations

- [x] **Partial — Vendored dependency inventory.** A reviewed dependency inventory was added (`eada4c9`) and Office parser hashes are enforced, but it should remain current for every vendored runtime, license, checksum, modification, and advisory review.
- [ ] **Open — GitHub branch protection.** Require reviewed pull requests and required CI/deploy-artifact checks before `main` can publish production.
- [ ] **Open — Archive and root-file hygiene.** Keep historical reports under `docs/archive/`, generated artifacts ignored, and user/private media outside the deploy allowlist. Evaluate other legacy/root files separately rather than deleting compatibility material from an audit recommendation alone.

## Immediate release checklist

- [x] Preserve the raw audit reports in this dated archive.
- [ ] Integrate the current persistence-root worktree changes without losing their tests.
- [ ] Integrate the isolated certification changes into `ox-alpha/audit-remediation` and rerun focused sanity gates.
- [ ] Complete one final human spot check.
- [ ] Resolve the remaining unrelated worktree files deliberately.
- [ ] Merge the remediation branch into `main` only after review.
- [ ] Configure GitHub branch protection.
- [ ] Plan the production Supabase migration separately.
- [ ] Verify response headers against the live production deployment.
