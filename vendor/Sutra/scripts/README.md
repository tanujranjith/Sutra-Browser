# `scripts/` — Node tooling (checks, build, probes)

All scripts are dependency-free Node (`.mjs`/`.js`) run from the **repo root**
(`npm run …`). They read source via repo-relative paths, so they assume the
working directory is the project root.

> **Why these are flat (not in `checks/ build/ probes/` subfolders).** ~50+
> run-instructions across the docs (`node scripts/<name>.mjs` in
> `docs/release/`, `docs/architecture/`, `docs/features/`) plus historical
> `docs/release/CHANGELOG.md` / `docs/archive/*` records reference these exact
> paths, and **no automated check guards prose run-instructions**. ~14 scripts
> also derive the repo root from their own location (`__dirname`). Physically
> subfoldering them would silently stale those instructions, force rewriting (or
> falsifying) historical records, and add path-depth fragility — the worst
> risk/reward of any folder in this repo, for files that are already uniformly
> named. This README provides the categorization instead. A staged plan to do
> the physical move safely lives in
> [`docs/architecture/SUTRA_ARCHITECTURE.md`](../docs/architecture/SUTRA_ARCHITECTURE.md).

## Categories

### Release-gate checks (run by `npm run check:all`)
`syntax-check` · `sutra-app-shell-check` · `sutra-migrations-check` ·
`sutra-supabase-schema-check` ·
`smoke-check` · `round-trip-check` · `version-history-check` ·
`sutra-rebrand-check` · `sutra-compat-check` · `sutra-csp-check` ·
`sutra-persistence-health-check` · `sutra-modal-a11y-check` ·
`sutra-network-check` · `sutra-encoding-check` · `sutra-responsive-check` ·
`sutra-brand-assets-check` · `sutra-docbg-check` · `sutra-academic-engines-check` ·
`sutra-sw-check` · `sutra-guardrails.selftest` · `sutra-guardrails-check` ·
**`check-links`** (repository-wide broken-link / stale-path audit — `npm run check:links`)

### Other checks (run individually / in the deploy gate)
`check-daily-lock-in-quotes` · `sutra-deploy-artifact-check` (`npm run check:deploy`) ·
`sutra-live-smoke-check` (`npm run check:live`, post-deploy)

### Build
`build-deploy-artifact` — stages the clean allowlisted GitHub Pages artifact
under `.deploy/` (`npm run build:deploy`).

### Library (shared, not run directly)
`lib/guardrail-scan.mjs` — pure scanners for `sutra-guardrails-check` (unit-tested
by `sutra-guardrails.selftest`).

### Server
`serve-static.mjs` — the local static server used by `npm run serve` and the
Playwright `webServer`.

### Probes & manual harnesses (not in CI)
`course-logic-probe` · `course-render-probe` · `mobile-audit` ·
`qa-assistant-screens` · `capture-final` · `demo-seed` ·
`sutra-persistence-qa.js` (paste into the browser console) ·
`generate-sutra-brand-assets.py` (regenerates brand assets, requires Pillow).

### Data
`guardrail-baseline.json` — per-file unsafe-sink/storage budgets + known globals
for `sutra-guardrails-check`. The check discovers all top-level HTML and every
first-party `src/**/*.js` file automatically, so a new runtime file begins with
a zero budget until reviewed. Regenerate with `npm run check:guardrails:update`.

## Adding a check
Add `check:<name>` to `package.json`, append it to the `check:all` chain, and
document it in [`docs/architecture/SUTRA_ARCHITECTURE.md`](../docs/architecture/SUTRA_ARCHITECTURE.md)
§ "Test scripts" and [`docs/release/TESTING_AND_RELEASE_CHECKLIST.md`](../docs/release/TESTING_AND_RELEASE_CHECKLIST.md).
