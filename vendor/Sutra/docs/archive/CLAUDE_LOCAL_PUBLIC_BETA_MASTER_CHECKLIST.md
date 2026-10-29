# Sutra Local Public-Beta Master Checklist

**Owner:** local release-engineering pass (Claude). **Repo:** `D:\Desktop\coding\Sutra` · branch `main`.
**Last updated:** living document — updated continuously during this pass.

## How to read status

`pending` · `in progress` · `implemented` (code changed, not yet fully verified) ·
`verified` (code changed + test/exercise passing) · `safely feature-gated` ·
`deferred — <exact blocker>` · `already-correct (verified)` (no change needed; current
code already satisfies the requirement and this was confirmed).

## Engagement reframing (read first)

The prompt's central premise — a critical `.sutra` crypto vulnerability and broadly
"confirmed broken" functionality — was **not** borne out. The repository is a mature,
heavily-guarded codebase (14 static check scripts, 9 e2e specs, comprehensive CSP,
rebrand/compat/network/persistence guards). The `.sutra` format is sound authenticated
encryption and is already covered by a passing 7-test e2e suite. The two audit
artifacts are a **duplicated single export**, not nonce reuse. Effort is therefore
concentrated on (a) finishing + extending security validation, (b) the genuinely
reproduction-backed Tier-1 UI bugs, and (c) honest tracking/deferral of the very large
remaining feature backlog. No work is faked; deferred items carry exact blockers.

---

## VALIDATION & FINAL STATUS (this pass) — supersedes per-row "in progress" markers

**Implemented + verified with new automated tests (all passing per-spec/in-batch):**

| Item | Sections | Verified by |
|------|----------|-------------|
| Passwordless `.sutra` audit (no plaintext recoverable) | 5 | STAGE1 report + `stage1_analyze.py` |
| Password-path validation + 12-category tamper matrix | 6, 25 | `encrypted-backups.spec` 7/7 + `sutra-envelope-tamper.spec` 2/2 |
| Assistant response-boundary leak (Gemini `thought`, inline `<think>`) | 9 | `assistant-response-boundary.spec` t1,t2 |
| Safe thinking-state UI + reduced-motion | 10 | `assistant-response-boundary.spec` t4 |
| Message lifecycle (stale-notice clear, no orphaned user turn) | 11 | `assistant-response-boundary.spec` t3 |
| API-key same-tab reload + session-only + no-inherit | 12 | `api-key-session.spec` 2/2 |
| Theme Panel button fix + ghost-panel cleanup + solid surface | 8 | `settings-theme-panel.spec` t1,t2,t3 |
| Remote-AI consent modal contrast (theme-aware readable text) | 8 | `settings-theme-panel.spec` t4 |
| Plaintext-recovery labeling (`sutra_recovery_UNENCRYPTED_`) | 7, 16 | code + rebrand guard |
| "Flowy" residue removed + dead `docs/` link removed + guards | 16, 17, 29 | `check:rebrand` extended, passes |
| Startup chime default-ON for new users (returning preserved) | 19 | `startup-chime.spec` 2/2 |
| Static test-server crash-safety (aborted-request handling) | 28/30 infra | `export-filename.spec` smoke + batches |

**Static + integrated validation:** `npm run check:all` → exit 0 (14 checks). `npm run build:deploy` + `npm run check:deploy` → exit 0; fixes confirmed present in `.deploy/`, residue confirmed absent. All 14 e2e specs pass per-spec and in CI-style batches (note: the single-process *all-at-once* e2e run is unstable on this Windows host due to ephemeral-port/`TIME_WAIT` exhaustion from `no-store` × ~75 page loads — an environmental harness limit, not a product/test defect; batched/sharded runs are green).

**Already-correct (verified, no change needed):** core `.sutra` crypto (AES-256-GCM/PBKDF2-600k, fresh salt+IV, AAD, authenticate-before-mutate, no plaintext fallback), Drive encrypted-only path + needs-config gating, secrets excluded from exports, runtime plugins disabled after import.

**Deferred — large net-new features beyond a single safe pass (exact blockers):**

| Item | Section | Blocker / why deferred |
|------|---------|------------------------|
| Local Assistant chat-history **UI** (drawer, rename/pin/archive/search) + encrypted-backup inclusion | 13 | Net-new persistence surface + UI; visible transcript already persists in sessionStorage `chat_history`, but the full managed store/UI is multi-day and must integrate the canonical persistence inventory. No partial half-store shipped (avoids data-model split). |
| Smart Import wizard | 23 | Large multi-step feature requiring a strict structured-proposal parser, review UI, duplicate detection across 8 surfaces, and AI round-trip; must not mutate workspace directly. Out of safe single-pass scope. |
| Integrations Hub + registry | 24 | Requires OAuth client config absent locally; must be truthfully gated. Net-new registry consumed by 8 surfaces. |
| Curated default navigation | 20 | Broad UI/routing change across all views; high regression surface; needs design + onboarding rework. |
| What's New panel | 21 | Net-new modal/badge/version-state; self-contained but unbuilt this pass. |
| In-app Assistant help route | 17 | Dead `docs/` link removed + guard added; a full in-app help route remains. (Existing chat-info modal already gives setup guidance.) |
| AI disclaimer acknowledgement gate | 18 | Empty-state disclaimer + consent modal already exist; the explicit first-run acknowledgement + Settings reopener remains. |
| Mobile/tablet Playwright projects | 27 | Desktop chromium/firefox/webkit projects exist; mobile viewport projects not added. |
| Heavy-workspace perf benchmark expansion | 28 | `bench:heavy` harness exists; expanded fixture + measurements not run. |

---

## TIER 1 — Must fix before limited public beta

| ID | Section | Requirement | Status | Notes / evidence |
|----|---------|-------------|--------|------------------|
| S1-AUDIT | 5 | Passwordless `.sutra` black-box audit | **verified** | `security-artifacts/STAGE1-PASSWORDLESS-SUTRA-AUDIT.md`; no plaintext recovered |
| S1-TAMPER | 5 | Tampered artifacts + manifest | **verified** | 12 fixtures in `security-artifacts/tampered/` + manifest |
| S2-VALID | 6 | Password-based validation via production path | **verified** | `STAGE2-PASSWORD-VALIDATION.md`; e2e 7/7; artifact pw file empty (documented) |
| S2-EXTEND | 6/25 | Extended tamper matrix as committed test | in progress | `tests/e2e/sutra-envelope-tamper.spec.mjs` (12 categories) |
| SEC-CRYPTO | 7 | Authenticated enc, secure randomness, no static IV/salt, no plaintext fallback, authenticate-before-mutate | **already-correct (verified)** | AES-256-GCM/PBKDF2-600k, fresh salt+IV, AAD header, generic error; `app.js:38684-38795` |
| SEC-DRIVE-ENC | 7/15 | Drive uploads encrypted bytes only, fresh IV per upload | **already-correct (verified)** | shares canonical path; `app.js:38063,38150` |
| SEC-SECRET-EXPORT | 7/12 | Secrets excluded from exports/snapshots; keys session-only | **already-correct (verified)** | `ATELIER_SENSITIVE_SETTING_KEYS` strip `app.js:38843`; e2e leak assertions |
| BUG-ASSIST-LEAK | 9 | Stop internal planning/reasoning text leaking into transcript | in progress | investigation workflow running; screenshot evidence |
| BUG-APIKEY-RELOAD | 12 | API key survives same-tab reload (sessionStorage) | in progress | investigation workflow running |
| BUG-GHOST-PANELS | 8 | Settings ghost/duplicate panels removed; Theme Panel works; contrast | in progress | investigation workflow running |
| BUG-MODAL-CONTRAST | 8 | Remote-AI consent modal contrast | in progress | investigation workflow running |
| LABEL-RECOVERY | 7/16 | Plaintext recovery/snapshot clearly labeled + unambiguous filenames | in progress | legacy `noteflow_` prefix at `app.js:38490,42249` |
| NOTES-CORE | 14 | Notes editor reliability (Tier-1 daily workflow) | pending | needs reproduction pass |
| ONBOARD-BOOT | 22 | Onboarding works from empty storage | pending | e2e `completeOnboarding` exists; needs coherence pass |

## TIER 2 — Should fix before serious public marketing

| ID | Section | Requirement | Status | Notes |
|----|---------|-------------|--------|-------|
| ASSIST-THINKING | 10 | Safe thinking-state UI (logo + "Thinking…", reduced-motion) | pending | |
| ASSIST-LIFECYCLE | 11 | Dedup messages, stale-notice cleanup, abort/retry | pending | tied to BUG-ASSIST-LEAK |
| CHAT-HISTORY | 13 | Local Assistant chat history + encrypted backup inclusion | pending | large; persistence-model integration |
| DRIVE-GATING | 15 | Honest Drive gating when OAuth absent | needs-verify | `google-drive-sync.spec.mjs` exists; confirm gating copy |
| REBRAND | 16 | Remove user-visible Flow/Atelier/NoteFlow residue | in progress | guard `scripts/sutra-rebrand-check.mjs` exists |
| ASSIST-HELP | 17 | In-app Assistant help; drop visible `docs/` refs; deploy guard | pending | |
| AI-DISCLAIMER | 18 | AI quality disclaimer + acknowledgement | pending | |
| CHIME-DEFAULT | 19 | Startup chime default-on for new users + toggle/preview | in progress | investigation workflow |
| NAV-CURATED | 20 | Curated default student navigation | pending | risk: large UI surface |
| WHATSNEW | 21 | What's New panel + unread badge | pending | |
| MOBILE-A11Y | 27 | Mobile/tablet/a11y Playwright projects | partial | webkit/firefox projects exist; mobile viewports needed |

## TIER 3 — Can wait until after beta

| ID | Section | Requirement | Status | Notes |
|----|---------|-------------|--------|-------|
| SMART-IMPORT | 23 | Smart Import wizard (privacy-conscious, no direct mutation) | deferred — large feature; needs AI provider + review UI; will scaffold + gate | |
| INTEGRATIONS | 24 | Integrations Hub + canonical registry | deferred — large; OAuth config absent locally → must gate | |
| ICS | 24 | `.ics` import/export | needs-verify | code refs at `app.js:41079`; confirm |
| RESTORE-PARITY | 25 | Full populated restore-parity suite | partial | encrypted-backups spec covers core; broaden later |
| UNTRUSTED-AUDIT | 26 | General untrusted-content audit (XSS, prototype pollution, sandbox) | needs-verify | CSP + `storage-hardening.spec.mjs` exist |
| PERF | 28 | Heavy-workspace perf benchmark | partial | `playwright.bench.config.mjs` + `bench:heavy` exist |
| DEPLOY-GUARDS | 29 | Deploy-artifact guards (no docs/tests in artifact, no secrets, no stale brand) | needs-verify | `sutra-deploy-artifact-check.mjs` exists |
| TESTRUN | 30 | Run full applicable test suite | in progress | check:all=0; encrypted-backups 7/7 |

---

## Confirmed-correct security controls (verified this pass — no change needed)

- KDF PBKDF2-HMAC-SHA-256, 600k iters (clamped 600k–5M on import, anti-DoS).
- AES-256-GCM, random 16-byte salt + random 12-byte IV per export, 128-bit tag, header as AAD.
- Non-extractable derived key; passphrase min 12 chars; passphrase bytes zeroed after derive.
- Authenticate-before-parse and authenticate-before-mutate; pre-import safety snapshot.
- No plaintext fallback / silent downgrade on encrypt failure or missing attachments.
- Single canonical crypto path shared by manual backup + Drive sync.
- `Math.random` never used for key/IV/salt (IDs/UI/audio/shuffle only).
- API keys in `sessionStorage` only; stripped from exports/snapshots.

## Carried-forward honesty items

- OBS-1: plaintext recovery JSON + pre-import snapshot use legacy `noteflow_` filename
  prefix, not clearly labeled unencrypted → `LABEL-RECOVERY`.
- OBS-2: page lock is UI gating, not content encryption; PIN is fast unsalted-iteration
  SHA-256 over 4–8 digits → document honestly, do not market as encryption.
