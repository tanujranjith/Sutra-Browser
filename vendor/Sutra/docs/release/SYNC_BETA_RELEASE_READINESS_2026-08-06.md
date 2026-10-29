# Sutra Sync Beta release-readiness audit — 2026-08-06

## Decision

The local branch `codex/sync-beta-release` is safe to review and push as a new
remote branch. Its final pre-report runtime HEAD was `f0af2d7`, it was 25 commits
ahead of `origin/main`, and the final monolithic `npm run verify` exited 0.

Do not push the older local `main` or `codex/pre-cleanup-main-2026-08-05`
branches. They intentionally preserve the original unpublished checkpoint
history, including the accidental workspace archives, so no user work was
destroyed while the clean branch was reconstructed.

No deployment, GitHub release, remote push, production-backend mutation, or
published-history rewrite was performed.

## Starting state

- Branch: `main`
- HEAD: `578b9d3831bd02b420bc5017bdfc640212e485c8`
- Upstream: `origin/main` at `a484e87`
- Working tree: 49 tracked paths changed (1,875 insertions, 229 deletions) plus
  31 untracked paths; no staged paths, conflicts, or partially staged files.
- Total local delta including the existing unpublished commits: approximately
  150 paths and 25,565 insertions / 853 deletions. The final reviewed release
  branch is 148 paths and 27,022 insertions / 853 deletions ahead of upstream.
- The largest integrity hazard was the early unpublished checkpoint `a65f308`:
  it contained four workspace TAR files with embedded `.git` repositories,
  three source-package ZIPs, generated Playwright screenshots, a diagnosis
  script, and a private machine-specific visual-QA note.
- The malformed internal `refs/codex/turn-diffs/checkpoints/...` ref caused an
  optional geometric-repack warning after commits. Commit creation, object
  reachability, worktree operations, and verification remained valid; this was
  not treated as corruption of acceptance commit `578b9d3`.

## Change classification

1. **Cloud Sync implementation** — pure protocol, crypto, projection, diff,
   merge, store, transport, engine, app bridge, encrypted assets, conflicts,
   compaction, device controls, and revocation/wipe handling.
2. **Cloud-release tests and policy** — Supabase schema/migrations, exact
   Storage-path and table-grant checks, ciphertext boundary tests, account
   isolation, two-device Playwright coverage, deployment allowlist checks, and
   cloud/release documentation.
3. **Required supporting changes** — persistence/migration parity, core-runtime
   recovery guard, Help-page reconstruction, Assistant history portability,
   attachment handling, cache stamps, generated manifests, and Windows-safe
   core integration commands.
4. **Independent completed features** — Slides, native Timeline calendars,
   Timeline Push time, Homework/Canvas hardening, mobile Today/navigation and
   overlay fixes, responsive public/extension surfaces, and the canonical
   workspace entity registry. These were kept in separate inspectable commits.
5. **Incomplete or questionable work** — alternate landing-page prototypes and
   their image-based QA remained outside the release branch.
6. **Generated/disposable files** — `.deploy`, Playwright results, local pnpm
   cache, screenshots, archives, and diagnosis output are ignored or excluded.
7. **Local-only configuration** — `.claude/launch.json` was removed and
   `.claude/` plus `.pnpm-store/` are ignored.
8. **Secrets/sensitive content** — no private-key headers or real
   credential-shaped tokens were found. One synthetic `sk-...` fixture remains
   correctly confined to a unit test. Public Supabase publishable configuration
   is intentional; `service_role` strings in runtime are rejection guards.
9. **Formatting/churn** — `git diff --check` passed throughout; no unrelated
   whole-tree formatter rewrite was retained.
10. **Uncertain preserved work** — copies are under the ignored local directory
    `.tmp/release-cleanup-preserved/2026-08-05` and on the named safety branch.

## Excluded paths and history cleanup

The following paths are absent from both the final tree and every object
reachable from `codex/sync-beta-release`:

- `design-qa.md`
- `landingpage/index.html`
- `landingpage/sutra-landing-page-development.zip`
- `landingpage/sutra-student-landing-page (7).zip`
- `landingpage/sutra-student-landing-page (8).zip`
- `landingpage/workspace-2bf2c969-43df-4d66-b75d-b4ce39292be6.tar`
- `landingpage/workspace-3a1f42b9-a9e1-433e-ba08-dad54db181cb.tar`
- `landingpage/workspace-fac8fe6b-55e5-4850-aa79-be92778e7160 (1).tar`
- `landingpage/workspace-fac8fe6b-55e5-4850-aa79-be92778e7160.tar`
- `output/playwright/course-icon-picker-dark.png`
- `output/playwright/course-icons-comparison.png`
- `output/playwright/course-icons-dark.png`
- `output/playwright/diagnose-startup.mjs`
- `output/playwright/homework-actions-fixed.png`
- `output/playwright/homework-schedule-fixed.png`
- `output/playwright/homework-workspace.png`

The original unpublished history remains locally recoverable on `main` and the
safety branch. No published ref was rewritten.

## Defects found and fixed

- Account changes previously retained an enabled preference while merely
  reporting a blocked state. A different account now visibly starts with Sync
  off, remains quarantined from the former account's operational namespace,
  and cannot pull, push, unlock, or enable in that browser profile.
- `disableSutraSync()` returned after scheduling a 250 ms autosave. An immediate
  reload could revive the old enabled value. Disable now waits for the canonical
  verified readback flush (`sync-disable`) before resolving.
- An auth failure from an already-running request could overwrite an ordinary
  sign-out's intentional `paused` state with `auth-expired`. The pure engine now
  preserves the explicit pause and makes no follow-up request.
- The deployable in-memory transport contained a `mock-user-1` default. It now
  uses a neutral `memory-user`, and the deploy checker rejects future
  `mock-user-` marker leakage.
- The Playwright default port was occupied by an unrelated local app during the
  first focused attempt. All authoritative reruns used isolated ports with
  server reuse disabled under CI.

## Sutra Sync Beta behavior

- Fresh workspace default: `settings.preferences.sync.enabled === false`.
- Fresh account and sign-in: remain off; no Sync RPC/upload begins.
- Settings, notice acknowledgement, and restore/import: do not enable Sync.
- Import explicitly preserves the receiving device's local Sync preference.
- Existing explicit same-account opt-in survives reload.
- Explicit disable survives reload after a confirmed durable save.
- Account switching clears the opt-in and retains the separate-profile
  quarantine, preventing prior-account queues, vaults, cursors, assets,
  conflicts, or credentials from crossing accounts.
- One dismissible notification announces **Sutra Sync Beta is available**,
  states that it is optional and currently off, and opens the existing Sync
  setup. It is keyboard-operable, uses the established notification system,
  persists acknowledgement/dismissal through its existing portable model, and
  does not repeatedly nag.
- Settings and setup identify **Sutra Sync Beta**, say it is optional/off by
  default, recommend a recent encrypted `.sutra` backup, explain offline revoke
  timing, and avoid claiming universal browser/PWA/device certification.

## Tests added or strengthened

- Fresh device/workspace notice eligibility and zero Sync requests.
- Keyboard activation, settings discoverability, dismissal durability, and
  restore/import non-enablement.
- Fresh-account/sign-in non-enablement and cross-account quarantine.
- Explicit enable/disable persistence across reload.
- Unit assertions for account-scoped routing, opt-in reset, and the immediate
  disable flush.
- Pure-engine regression proving manual pause wins over an in-flight auth error.
- Two-account mock identities and runtime-artifact synthetic-marker rejection.

## Verification record

Focused and prescribed checks run during the audit:

- `node scripts/sutra-supabase-schema-check.mjs` — passed.
- `npm run check:runtime` — passed repeatedly; 27 core assertions plus
  corruption and static-server fallback self-tests.
- Focused unit files for Sync storage policy, backup permissions, schema,
  workspace entity registry, Timeline scheduling, workspace DB, projection,
  account isolation, engine, and transport — passed.
- Sync Beta opt-in Playwright describe — 3/3 passed on an isolated Chromium
  server before the final full suite.
- Disable durability regression — one CI pass plus 3/3 no-retry stress repeats.
- Ordinary sign-out regression — one CI pass plus 3/3 no-retry stress repeats.
- Guarded core integrations — passed `check:all`, 354 unit tests, and 11 focused
  startup/Today Chromium tests after the core fixes.
- Final `npm run verify` at `f0af2d7` — **exit 0**:
  - all static/runtime/migration/Supabase/persistence/round-trip/guardrail checks;
  - 355 unit tests passed;
  - deploy build and deploy-artifact check passed;
  - 61 Chromium smoke tests passed with no retry;
  - 20 complete Sync Chromium scenarios passed with no retry.

An earlier `npm run verify` correctly failed on the immediate-reload disable
race; a later full Sync rerun correctly exposed the sign-out status race. Both
failures were diagnosed and fixed rather than hidden or weakened.

## Deployment artifact

- Built from the exact final source with `npm run build:deploy`.
- `npm run check:deploy` passed.
- 200 allowlisted files, 17.21 MB in the final primary-worktree build.
- Top-level surface: `404.html`, `HomePage.html`, `LICENSE`, `Sutra.html`,
  `assets/`, `index.html`, `manifest.webmanifest`, `oauth-callback.html`,
  `robots.txt`, `sitemap.xml`, `src/`, `styles/`, `sw.js`.
- No docs, tests, scripts, package metadata, SQL, source maps, archives,
  screenshots, test identities, private-key headers, secret-shaped credentials,
  or synthetic acceptance markers were found in the artifact.
- The artifact is safe to deploy based on local automated checks, but no deploy
  was performed.

## Remaining manual checks and limitations

- No physical iPhone, broad physical-device matrix, or deployed-PWA validation
  was claimed or performed.
- The authenticated real-project Account A/B REST/RPC/Storage hostile checklist
  was not rerun because this task did not authorize backend or credential use;
  retain the recorded operator evidence and rerun it before a production Sync
  rollout if policy/schema state changes.
- Review the 25-commit branch/PR normally before merging. Do not force-push or
  push the preservation branches.
- The malformed internal Codex checkpoint ref may continue to print optional
  geometric-repack warnings until the local tool repairs/removes that internal
  ref; it did not affect the final branch's reachable objects or verification.

## Final commit sequence before this report

1. `07e94fa` — encrypted Sutra Sync foundation.
2. `bcf25f3` — Homework and Canvas workspace hardening.
3. `fa9e882` — responsive native Timeline calendar views.
4. `9a261f5` — responsive student workspace flows.
5. `887adb4` — responsive public and extension surfaces.
6. `361a2d6` — core runtime recovery and guarded edit workflow.
7. `819a432` — local-first Slides mode.
8. `7bd232d` — Slides/Sync release integration hardening.
9. `bcd331b` — failed Supabase backup-index rollback.
10. `3a56469` — Windows-safe core integration commands.
11. `59da5b5` — mobile Today command center.
12. `ae118cc` — notification/mobile-nav layering.
13. `346f721` — mobile overlay layering.
14. `47f1286` — unified mobile workspace navigation.
15. `02010f7` — stale Sync device-session recovery.
16. `4cd1132` — cloud Sync release acceptance record.
17. `2a744ad` — cloud policy, permission, and packaging hardening.
18. `44b9592` — canonical workspace entity registry.
19. `b233f76` — atomic Timeline Push time controls.
20. `ec43527` — connected workspace state-transition hardening.
21. `227bb3e` — local workspace artifact exclusions.
22. `a7733cc` — explicit opt-in Sync Beta and discovery experience.
23. `af5a47b` — durable Sync disable before reload.
24. `617512f` — intentional pause preserved on sign-out.
25. `f0af2d7` — synthetic runtime identity removal and deploy guard.

## Recommended human action

1. Inspect this report and `git log --reverse origin/main..codex/sync-beta-release`.
2. Review large commits with `git show --stat <hash>` and focused file diffs.
3. Push **only** `codex/sync-beta-release` as a new branch; do not force-push.
4. Open a pull request against `main` and let remote CI rerun the same gates.
5. Complete any desired real-device/deployed-PWA and authorized real-account
   acceptance checks before merging or deploying.
