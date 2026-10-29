# `src/` — application source

Sutra is a **static, no-build, local-first** app. Everything here is a plain
classic `<script>` (no bundler, no ES-module graph, no TypeScript). Scripts are
loaded in a deliberate order by `Sutra.html` and share one global scope, so the
folders below are organized by **responsibility**, not by module boundaries.

> The exact load order and the rules for moving files live in
> [`docs/architecture/SUTRA_ARCHITECTURE.md`](../docs/architecture/SUTRA_ARCHITECTURE.md).
> Read the "Sutra.html load order" and "Path-coupling map" sections before
> moving or renaming anything here — several release-gate checks hardcode paths.

## Responsibility zones

| Folder | Owns | Notes |
|---|---|---|
| `boot/` | Startup orchestration loaded before the app: `startup-intro.js`, `sw-register.js`. | Runs first; keep DOM/storage touch minimal. |
| `core/` | The runtime + the cross-cutting safety layer. `app.js` is the large global runtime (state, persistence, export/import, notes, timeline, views, Drive sync). The safety layer (`safe-storage`, `error-reporter`, `dom-safety`, `feature-guard`, `migrations`) loads **before** everything else. | `app.js` is being decomposed incrementally — see `state/`. |
| `state/` | Pure workspace-state normalizers/defaults extracted from `app.js`. Loaded before `app.js`; stays global so existing call sites are unchanged. | The safe end of the app.js extraction seam. No DOM, no storage. |
| `config/` | Runtime configuration: `sutra-runtime-config.js` (`window.SUTRA_CONFIG`, Drive client id). | |
| `features/` | Self-contained feature areas, grouped by domain. See `features/README.md`. | Loaded as classic scripts; they talk to each other via `window` globals, never by import. |
| `ui/` | Reusable UI enhancers: `date-enhancer`, `time-enhancer`, `select-enhancer`. | Layered on top of the core. |
| `components/icons/` | Icon path data + the icon-fallback patcher. | |
| `data/` | Generated/static data modules: `daily-lock-in-quotes.js`, `emoji-keywords.generated.js`. | `*.generated.js` is produced, not hand-edited. |

## Where do I edit…?

| I want to change… | Go to |
|---|---|
| Boot sequence / service-worker registration | `boot/` |
| App data model, persistence, export/import, notes, timeline, most views | `core/app.js` |
| Workspace defaults / enabled-view + shortcut normalizers | `state/` (then `core/app.js` for the rest, still global-scoped) |
| Safe storage, error reporting, DOM sanitization, feature isolation, migrations | `core/` safety layer |
| A specific feature (assistant, academic, study, search, customization, workspace) | `features/<group>/` |
| A reusable input enhancer | `ui/` |
| Runtime config / OAuth client id | `config/sutra-runtime-config.js` |

## Rules of the road

- **Global scope is shared.** A top-level `function`/`var`/`const` in one script
  is visible to later scripts. Order matters; a file that *defines* a global must
  load before any file whose **top-level code** reads it (function bodies run
  later, so call-time references are fine).
- **Never break the bridge globals.** Canonical + legacy aliases
  (`sutraAssistant`/`flowAssistant`, `sutraIntelligence`/`flowIntelligence`, …)
  must keep pointing at the same objects.
- **Use the safety layer.** No raw `innerHTML =`/`localStorage.setItem` — route
  through `SutraDOMSafety` / `SutraSafeStorage`. New `window.*` globals must be
  registered (guardrail check).
- **Storage names are frozen.** `noteflow_atelier_db` and friends are legacy-named
  compatibility identifiers; renaming them loses user data.
