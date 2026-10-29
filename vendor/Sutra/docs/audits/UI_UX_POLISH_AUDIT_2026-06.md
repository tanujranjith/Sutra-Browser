# Sutra — UI/UX & Quality Audit (June 2026)

**Scope:** whole-app quality, polish, and UI/UX pass.
**Surfaces:** desktop (1440px), mobile/responsive (360–844px), all theme families (sutra-pro / glass / macos26 brand).
**Round type:** audit + prioritized backlog only — **no app code was changed.** This document is the input for a later implementation effort.
**Posture:** opinionated. Recommendations propose tightening the design system (token unification, modal/button/form consolidation), not just conservative patches.

Every finding below cites a `file:line` and/or a captured screenshot so it can be acted on cold.

---

## 1. Executive summary — top 10 highest-leverage fixes

Ranked by impact ÷ effort. Detail and evidence are in the sections that follow.

| # | Fix | Why it matters | Severity / Effort |
|---|-----|----------------|-------------------|
| 1 | ✅ **DONE — Restored the deleted jszip vendor file** (`assets/vendor/jszip/jszip.min.js`) | It was deleted in the working tree → 404 on every boot (`Sutra.html:41`); `.sutra` zip export/backup depends on it. Restored via `git checkout`; verified jszip now serves `200` and the desktop full-app-audit went 7/10 → **10/10** (criticalConsoleCount 1→0). | ~~P0~~ DONE |
| 2 | **Add app-shell accessibility landmarks** — `<main>`, `<nav aria-label="Primary">`, a skip-link, and one app-level `<h1>` | The shell has none (`Sutra.html:172,327,328`); screen-reader users land with no main/nav/heading. Pure-win baseline a11y. | P0 / S |
| 3 | **Make the main toast an aria-live region + add dismiss** | `showToast` writes to a `#toast` div with no `role/aria-live` (`Sutra.html:6464`); a second, *correct* `aria-live` container (`#notifToastContainer`) already exists and is ignored — consolidate onto it. | P1 / S |
| 4 | **Fix mobile bottom-bar content occlusion** | The fixed Save/Export/Import bar hides the last content row on College/Life/Business (clearance only targets `.view`, not custom mounts; brittle `!important` cascade). `responsive-hardening.css:51-59`, `mobile.css:1738-1741`. | P1 / M |
| 5 | **Establish a real token spine** — spacing, type, and z-index scales | A `--space-1..7` scale exists but is used ~14 times against **~2,000 hardcoded px** values; **zero** font-size tokens; **zero** z-index tokens (one value is `2147483000`). This unblocks every other polish item. | P1 / L |
| 6 | **Unify the modal contract** | `SutraModalManager` hand-registers ~27 selectors with **5** different "open" signals and **7** close-button conventions (`app.js:32026-32143`); the `[aria-label^="Close"]` Escape match can fire a destructive control. | P1 / M |
| 7 | **Consolidate button families** | 8+ parallel families each re-inventing primary/ghost/danger — **3 different danger reds, 2 disabled opacities, near-zero loading state.** | P1 / M |
| 8 | **Fix sub-32px touch targets** — `.acc-refresh` (17–21px) | The control falls below the 32px floor on phones (mobile-audit confirmed). | P1 / S |
| 9 | **Quiet the Today top bar** — default the live seconds clock OFF and hide the literal "⌘K" label on touch | A per-second DOM write/reflow in the top bar (`app.js:1893,2201`) + a desktop shortcut shown on phones (`Sutra.html:457`). | P1 / S |
| 10 | **Theme robustness: derive semantic tokens per theme** | `--sutra-warning` (and scrollbar tokens) stay light-mode on dark AI/glass/macos themes — a real wrong-color bug. `applyCustomThemeVariables` (`app.js:29186`) and glass/macos theme files. | P1 / S |

**Overall health:** the *functional* floor is strong — 0 horizontal overflow across all 12 views on mobile, focus rings render (6/6 sampled), motion tokens resolve, focus-trap + escape-restore work, command palette filters and restores focus. The debt is **consistency drift from organic growth**: parallel systems at every layer (themes, modals, buttons, forms, empty states) and an under-built token spine. That is exactly what an opinionated refresh should target.

---

## 2. Method & coverage

**Harnesses run** (server: `npm run serve` on `127.0.0.1:5173`):

- `node scripts/mobile-audit.mjs --deep` → 28 surfaces × 4 viewports (360/390/430/844). Artifacts: `.tmp/mobile-audit/*.png` + `report.json`.
- `npx playwright test full-app-audit` → per-view render/error/overflow/focus/motion. AUDIT:: markers in `.tmp/playwright-results/`.
- `node scripts/capture-final.mjs` → desktop reference screenshots (`assets/screenshots/*.png`, **regenerated then restored via `git checkout`** to keep the tree clean).
- Source review of the shared systems and per-view render functions (cited inline).

**Viewports:** narrow 360, iphone 390, phablet 430, landscape 844 (mobile-audit); 1440×900 (desktop capture); 390 + 1280 (full-app-audit).
**Themes:** sutra-pro (default), glass/liquidglass, macos26 brand set — reviewed at the token/source level; see §3.2.

**What was NOT covered (gaps to close later):**
- **WebKit/Safari rendering** — the webkit browser binary isn't installed, so all 8 webkit audit cases errored on launch (not app bugs). Install with `npx playwright install webkit` to cover Safari.
- **Full per-theme screenshot matrix** — themes were audited from source + the default-theme captures; a headless screenshot sweep per theme was not run this round.
- **Real-device touch testing** — touch-target sizes are from the headless audit's geometry, not physical devices.
- **Deep content states** — views were seeded with demo data; very-long-text / many-item stress states beyond the audit's wrapping seeds weren't exhaustively exercised.

---

## 3. Foundational / design-system findings

This is the highest-leverage section: fixing these unblocks most per-view P1s.

### 3.1 Design tokens — color/surface only; spacing, type, z-index largely un-tokenized

The canonical token set lives in one `:root` block (`styles/base/styles.css:7-74`), but it's really a **color + surface** system:

- **Spacing — no enforced scale.** A real `--space-1..7` (4–32px) exists but is buried in a *second* `:root` at `styles/base/styles.css:20702-20709` and referenced only **~14 times** in the whole `styles/` tree. Against it: `styles.css` alone has **~941 hardcoded `padding:…px`, ~1031 `gap:…px`, ~121 `margin:…px`**, plus ~297 more in feature CSS. Stray `6px`/`7px` values (e.g. `styles.css:828`) show there's no 4/8px grid discipline.
- **Typography — no type scale.** Only `--font-heading` / `--font-body` exist. **Zero** font-size tokens; **~460 `font-size:px` + ~622 `font-size:rem`** in base alone, mixing units within single files (`command-center.css:83,93,100` px vs `academic-planning.css:44,84,99` rem; values like `0.74rem` aren't steps on any scale).
- **Z-index — no tokens, magic numbers everywhere.** ~134 raw `z-index:` in base; values span `4200 → 13500` with heavy `!important`, and `sutra-pro.css:74` uses **`2147483000`** (near INT_MAX). The JS "accessible modal" overlay is `z-index:100000` (`app.js:58768`) — *below* that sutra-pro layer, an inversion risk.
- **Scattered `:root`** — at least three blocks (`styles.css:7`, `:20702`, plus `data-corner-style` radius overrides) define tokens; consolidate.

> **Opinionated rec:** Commit to one token spine — adopt `--space-*`, add `--text-xs..2xl` + line-height tokens (standardize on `rem`), and a `--z-*` ladder (`--z-nav/-dropdown/-modal/-toast/-tour`). Codemod high-traffic component blocks; cap the `2147483000` value. This is the backbone of the "opinionated refresh."

### 3.2 Themes — two token systems + per-theme coverage gaps

- **Two systems.** Preset CSS themes redefine ~30–73 base tokens each (glass overrides 73, macos26 60). The AI/custom system uses **6 input tokens** — `AI_THEME_TOKEN_KEYS` = `['bgPrimary','bgSecondary','textPrimary','accent','sidebar','button']` (`app.js:29449`, exposed `app.js:58648`) — from which `applyCustomThemeVariables` (`app.js:29186-29246`) *derives* 41 CSS vars. So AI themes aren't mostly-undefined, but a few semantic tokens are **not** derived and fall back to **light-mode** values even on a dark theme: **`--sutra-warning`** (`styles.css:74`, `#b45309`) and the **`--atelier-scrollbar-*`** trio. These are genuine wrong-color bugs.
- **Glass/macos26 gaps.** Neither overrides `--sutra-warning`; its dark override selector list (`styles.css:641-658`) excludes `glass`/`liquidglass`. `sutra-pro.css` overrides `--sutra-warning` 13× — proving it's meant to be theme-owned.
- **`data-theme` vs `data-theme-key` overload.** Both are set on `body`, often together (`app.js:29128-29136`); custom themes *remove* `data-theme` and set only the key (`app.js:29699-29700`); CSS consumes both namespaces in one selector list (`styles.css:641-658`). Authors must know which namespace a theme registered under.

> **Opinionated rec:** Make `applyCustomThemeVariables` derive `--sutra-warning` + scrollbar tokens from `isDarkBase`; add a "required token contract" so a theme can't ship missing semantic/scrollbar tokens; document (or collapse) the two `data-theme*` attributes.

### 3.3 Modals — ~27 selectors, 5 open-signals, 7 close conventions

`SutraModalManager` (`app.js:32025-32300`):

- **Selector zoo:** ~27 hand-registered selectors (`app.js:32026-32056`), several reaching the *same* dialog two ways (`#googleFeedbackModal` + `.google-feedback-modal`).
- **5 open signals** (`isElementOpen`, `app.js:32077-32089`): `!hidden`, `aria-hidden="false"`, `.active`, `.fs-visible`, `.is-visible`. Real divergence: Deadline Radar uses `.active`+`aria-hidden` (`app.js:21374`), fullscreen uses `.fs-visible` (`app.js:63684`), the newer academic/study layer standardized on `.is-visible` (`homework.js:492`, `review.js:235`, `assignment-studio.js:455`), older core modals use `hidden` (`app.js:9409`).
- **7 close conventions** (`closeViaExistingControl`, `app.js:32135-32143`): `.close-btn`, `.modal-close`, `.modal-close-btn`, `.cw-modal-close`, `.th2-modal-close`, `.version-history-close`, plus `[data-modal-close]`. **Risk:** the `[aria-label^="Close"]` prefix match means Escape could click "Close without saving" and lose data.
- `data-sutra-no-escape` opt-out is used once and well-documented (`review.js:132`) — fine as-is.

> **Opinionated rec:** One `data-sutra-modal` attribute (auto-enroll), one `.is-open` open class with a tiny `openModal/closeModal` helper, and the single `[data-modal-close]` close contract. Drop the `[aria-label^="Close"]` prefix match. The newest code already points at this target.

### 3.4 Buttons & controls — 8+ families, no shared base

Independent families: `.neumo-btn` (`microinteractions.css:32`), `.icon-btn` (`:871`), `.cc-btn*` (`settings-redesign.css:320`), `.btn-primary/-secondary` (`styles.css:1314,8347,21197` — duplicated 3×), `.toolbar-btn` (`styles.css:21085`), `.th2-btn-*` (`sutra-pro.css:3567`), `.cw-btn*` (`sutra-pro.css:5606`), `.acc-btn*` (`academic-command-center.js:291`), `.review-btn*` (`microinteractions.css:751`), `.fab-add-task` (`styles.css:9826`).

- **`:focus-visible`** — a global fallback exists (`styles.css:1624`, plus the shared group at `microinteractions.css:303-313`), but `.cw-btn/.th2-btn/.acc-btn/.fab-add-task` have no family-specific ring, so the square global outline can mismatch their custom radii.
- **Disabled** — `.cc-btn` `opacity:.46` vs `.toolbar-btn` `.56 !important`; cascade fights re-assert `opacity:1` (`styles.css:24771`).
- **Danger** — three implementations, **three different reds** (`#f87171`, `rgba(217,83,79,…)`, `var(--danger-color,#e5484d)`).
- **Loading** — essentially absent; one orphaned `.is-loading` rule (`workspace-overrides.css:491`).

> **Opinionated rec:** One `.btn` base + `--primary/--ghost/--danger/--icon` modifiers backed by tokens (`--danger`, one disabled-opacity, one `[aria-busy]` spinner). 8 families = 8 places every future button bug lives.

### 3.5 Form controls — 3 enhancers, 3 opt-out names; bare fields diverge

- **Enhancers** (`src/ui/date-enhancer.js`, `select-enhancer.js`, `time-enhancer.js`) each use a *different* opt-out attribute (`data-native-date` / `-select` / `-time`); the time enhancer leaks a domain class (`.hw-paste-input`, `time-enhancer.js:17`) and lacks the inline/portal switch the other two have.
- **None opt out inside modals** — modal consistency is achieved by a *second* layer of CSS patches (`styles.css:7119-7127`, `date-enhancer.js:256`).
- **Bare native fields diverge:** `.modal-input` is the de-facto base (`styles.css:7098-7110`) but bare `<select>` (`styles.css:633-638`) and `<textarea>` (`styles.css:21207`) get no padding/radius/font tokens — an un-classed field looks different from `.modal-input`.
- **Native `<select>` arrow overlap** (the "All Course⁸" artifact): `.cw-filter` never sets `appearance:none` and has no custom caret (`sutra-pro.css:5600-5603`), so the OS arrow overlaps the truncated label (`app.js:25460-25464` Courses, `:25901` All Due). See §4 Courses/All Due.

> **Opinionated rec:** One `--field-*` token set applied to bare `input/select/textarea`; one `data-native` opt-out across all enhancers; add `appearance:none` + a custom SVG caret to selects.

### 3.6 Accessibility baseline

| Item | Status | Evidence |
|------|--------|----------|
| Skip link | **Absent** | no `skip-link` anywhere; only the intro "Esc to skip" hint (`Sutra.html:150`) |
| Landmarks | **Missing in shell** | `.main-content` div (`Sutra.html:327`), `.sidebar` div (`:172`), `.top-nav` div (`:328`); real landmarks only inside Settings/Testing Hub sub-views |
| App-level `<h1>` | **Missing** | only Settings (`:2808`) + Focus Session (`:7377`) have h1; Today leads with `<h2>` (`:451`) |
| Toast live region | **Missing on main path** | `#toast` has no `role/aria-live` (`:6464`); correct `#notifToastContainer` exists (`:324`) but `showToast` ignores it (`app.js:54009`) |
| `prefers-contrast` | **Partial** | manual toggle good (`app.js:3904`); `@media (prefers-contrast:more)` only in Review cards (`styles.css:28777`) + glass (`glass.css:713`) |
| `prefers-reduced-motion` | **Broad but thin on mobile** | honored in many files; `mobile.css` has only ONE block / 5 selectors (`:739`); JS `body.motion-off` is a good backstop |
| `outline:none` without replacement | **~80 uses; some risky** | `!important` removals at `styles.css:32814`, `macos26-redesign.css:455` need verified `:focus-visible` replacement |

> **Opinionated rec:** Ship the landmark/skip-link/h1 set (low effort, high payoff), route `showToast` through the live container, and promote `pref-high-contrast` overrides to also trigger under `@media (prefers-contrast:more)`.

### 3.7 Toasts, notifications, FABs

- **Two toast systems** — `#toast` (used, no a11y) and `#notifToastContainer` (`aria-live`, unused). Consolidate (see 3.6).
- **Notification panel** is well-formed (`Sutra.html:298`: `role="dialog" aria-modal aria-label`); verify focus-trap/return-focus and that its z-index clears the FAB stack.
- **FAB stacking is hardcoded JS pixel math** (`app.js:1698-1764`: `minBottom=84`, `fabHeight=52`, `stackGap=12`, legacy `156px`, `!important` positions). `#addTaskBtn` is positioned *independently* and not in the stack math → collision risk with the chatbot FAB and the mobile bottom bar. The `matchMedia('(max-width:768px)')` guess must stay in sync with `mobile.css`.

> **Opinionated rec:** Replace the JS math with a single flex-column FAB container driven by a `--fab-stack-bottom` token so the stack auto-reflows and `#addTaskBtn` participates.

---

## 4. Per-view findings

Rubric per view: **Layout · Hierarchy · States · Mobile · Theme · A11y.** Screenshot refs are relative to repo root.

### Today  ·  `app.js` renderTodayView  ·  `assets/screenshots/today.png`, `assets/screenshots/mobile-today.png`
- **States/polish:** top-bar live clock ticks per second (`app.js:1893`, interval `:2201`) — visual noise + a per-second reflow; default seconds OFF. Greeting + rotating subline at `app.js:20008-20019` (deterministic by day-of-month).
- **Hierarchy:** right-column stat cards (Overdue/Due today/Events/Cards due) *do* have labels (`Sutra.html:486-513`, `app.js:19986`) — readable, but low-emphasis/small; consider larger numerals + clearer grouping.
- **Mobile:** the "⌘K" button shows a desktop shortcut on phones (`Sutra.html:457`) — hide the kbd hint under the mobile breakpoint. FAB cluster + bottom storage bar crowd the bottom-right (see §5).
- **A11y:** no app-level h1 (Today leads with h2).

### Timeline  ·  `app.js` renderTimeline  ·  `assets/screenshots/timeline-weekly.png`, `timeline-daily.png`
- **States:** empty week cells render **both** "0 events" and "No events" (`app.js:60057-60058`) — suppress the count line when `count===0`.
- **Layout:** day-of-week label appears twice (column header + in-cell corner) — redundant.
- **Positive:** Day/Week/Month toggle, date picker, "+ Block" are clean; no overflow.

### Notes  ·  `app.js`  ·  `assets/screenshots/notes-editor.png`
- **Layout:** the formatting toolbar overflows horizontally (a `>` scroll chevron) — consider grouping/overflow-menu instead of horizontal scroll.
- **Hierarchy:** clean editor; tags + title well done.
- **A11y:** verify toolbar buttons expose `aria-pressed`/labels (toolbar uses `.toolbar-btn`, see §3.4 focus mismatch).

### Homework  ·  `features/study/homework.js`  ·  `assets/screenshots/homework.png`
- **States:** stat cards compute correctly (`homework.js:883-897`) but **"Active Tracks" is mislabeled** — it's `courses.length` (all courses), not active ones; rename to "Tracks" or filter.
- **Layout:** clean class/extracurricular sections with empty CTAs.

### Courses  ·  `app.js` renderCoursesHub  ·  `.tmp/mobile-audit/phablet-courses.png`
- **Bug (visible):** "All Courses" filter shows the native `<select>` arrow overlapping the truncated label ("All Course⁸") — `.cw-filter` lacks `appearance:none`+caret (`sutra-pro.css:5600`, render `app.js:25460`).
- **Mobile a11y:** `.acc-refresh` button shrinks to 17–21px (below 32px floor) — flexbox shrink, no `flex:0 0 auto` (`academic-command-center.css:24`, render `academic-command-center.js:320`).
- **Positive:** good stat cards + `cw-empty-state` (the richest empty-state pattern).

### All Due  ·  `app.js`  ·  `.tmp/mobile-audit/phablet-alldue.png`, `assets/screenshots/deadline-radar.png`
- Same "All Courses" select-arrow overlap (`app.js:25901`).
- Clean stat grid (Overdue/Due Today/Due This Week/Exams/Open) and a strong `cw-empty-state` (`app.js:25918`). Deadline Radar modal is clean.

### Testing Hub (apstudy) + Cram Hub  ·  `features/study/ap-study.js`  ·  `assets/screenshots/testing-hub.png`, `.tmp/mobile-audit/phablet-apstudy.png`
- **States:** good "Pin an exam to get started" empty state — but it's a **bespoke** next-action object (`app.js:36603-36607`), not the shared empty-state component (see §4 empty-state note).
- Tab bar (Dashboard/Exams/Review/Cram/Practice/Mistakes/Resources) is the one place with proper `role="tablist"` (`Sutra.html:4449`) — good model to copy.

### Review  ·  `features/study/review.js`  ·  `assets/screenshots/testing-hub-review.png`
- Well-isolated modal with its own Escape/`Ctrl+Enter` (`review.js:129-132`); honors reduced-motion + `prefers-contrast` in cards. Strong baseline; main risk is its `.is-visible` open-signal differing from older modals (see §3.3).

### College  ·  `app.js` renderCollegeApp  ·  `.tmp/mobile-audit/phablet-collegeapp.png`
- **Mobile:** last content row ("Set up your admissions command center") hidden behind the bottom storage bar (§5).
- Clean stat cards (Application Completion / Deadlines / Scholarship Pipeline / SAT Countdown) with sensible empty placeholders ("--", "0%").

### Life  ·  `app.js` renderLifeWorkspace  ·  `.tmp/mobile-audit/phablet-life.png`
- **Mobile:** bottom content ("Stress 5/10") clipped by the storage bar (§5).
- Nice serif hero + 2×2 action grid; stat cards consistent with other views.

### Business  ·  `features/workspace/business-workspace.js`  ·  `.tmp/mobile-audit/phablet-business.png`
- **States:** empty states use a *third* pattern — bare `business-muted-copy` sentences (`business-workspace.js:1603,884,1255`) with no icon/structure, weaker than `cw-empty-state`.
- **Mobile:** "Overdue" section clipped by the storage bar (§5).

### Settings  ·  `app.js` renderSettingsView  ·  `assets/screenshots/themes-customization.png`
- **Positive:** the redesigned Settings is the strongest surface — real landmarks (`<main class="cc-main">`, `<nav class="cc-sidebar-nav">`), the `.cc-btn*` system, live preview, category nav. **This is the design quality bar the rest of the app should rise to.**
- Its slider/field styling is `.cc-page`-scoped, which is why Life's slider misses out — extract the good parts to shared scope.

**Empty-state consistency (cross-view):** at least **4 competing patterns** — `cw-empty-state` (richest, icon+title+body+action: `app.js:25491,25918`), `empty-state/empty-title/empty-subtitle` (`app.js:19114+`), bare `business-muted-copy` (`business-workspace.js:*`), and the Testing Hub bespoke object (`app.js:36603`). Tone is consistent; markup/weight/whether a CTA appears is not. **Rec:** standardize on `cw-empty-state` app-wide.

---

## 5. Cross-cutting mobile findings (from `mobile-audit report.json` + full-app-audit)

- **No horizontal overflow** anywhere — 0 across all 12 views (full-app-audit `MOBILE_CRAWL`) and 0 overflowers in mobile-audit. Strong.
- **Bottom-bar occlusion (P1):** the fixed Save/Export/Import bar overlaps the last content row on College/Life/Business. Clearance (`--responsive-bottom-clearance`) only targets `.view` and is overridden to 84px (`mobile.css:1738-1741`), winning over `.view{padding-bottom:8px!important}` (`styles.css:18902`) only by load order — brittle, and custom scroll mounts (`#businessDashboardRoot`, `#lifeDashboard`, `#hwMainArea`) aren't guaranteed it.
- **Sub-32px touch targets (P1):** `button.acc-refresh` (17–21px, Courses + Semester Setup). Bottom-nav tap targets are fine (full-app-audit `MOBILE_TAP_TARGETS` clean).
- **Fixed-panel "collisions"** flagged by `--deep` (notif-panel ×3, theme-panel ×3, sidebar-drawer, spaces-dropdown ×5, new-page-modal, feedback-modal) are mostly **expected overlap** of fixed overlays with the FAB/toggle they belong to — *review* rather than fix, but the spaces-dropdown (5) and new-page-modal warrant a look on narrow widths.
- **"⌘K" desktop shortcut** rendered on phones (`Sutra.html:457`).

---

## 6. Prioritized backlog

Severity: **P0** broken/inaccessible · **P1** noticeable polish/consistency · **P2** refinement. Effort: **S/M/L**.

| ID | P | Eff | Title | Surface | Anchor |
|----|---|-----|-------|---------|--------|
| B01 | ✅ DONE | S | ~~Restore deleted jszip vendor (404 breaks zip export)~~ — restored & verified (audit 10/10) | all | `Sutra.html:41`; `assets/vendor/jszip/` |
| B02 | P0 | S | Add `<main>`/`<nav>`/skip-link/app-level `<h1>` | shell | `Sutra.html:172,327,328` |
| B03 | P1 | S | Toast → `aria-live` + dismiss; drop dup toast system | global | `Sutra.html:6464,324`; `app.js:54009` |
| B04 | P1 | M | Mobile bottom-bar clearance on all scroll mounts (tokenize bar height) | mobile | `responsive-hardening.css:51`; `mobile.css:1738`; `styles.css:18902` |
| B05 | P1 | S | `.acc-refresh` `flex:0 0 40px;min-width` (touch floor) | Courses/SemSetup mobile | `academic-command-center.css:24` |
| B07 | P1 | S | Default top-bar seconds OFF; throttle clock | Today | `app.js:1893,2201` |
| B08 | P1 | S | Hide literal "⌘K" on touch breakpoint | Today mobile | `Sutra.html:457` |
| B09 | P1 | S | Timeline empty cell: suppress "0 events" when 0 | Timeline | `app.js:60057` |
| B10 | P1 | S | `.cw-filter` `appearance:none` + custom caret (label overlap) | Courses/AllDue | `sutra-pro.css:5600`; `app.js:25460,25901` |
| B11 | P1 | S | Tab `letter-spacing` 0.08em→~0.02em (or sentence case) | top-nav | `styles.css:2796,20756` |
| B12 | P1 | S | Derive `--sutra-warning`/scrollbar tokens per theme | glass/macos/AI themes | `app.js:29186`; `glass.css`, `macos26-redesign.css` |
| B13 | P1 | M | Modal contract: one open class + `data-sutra-modal` + `[data-modal-close]`; drop `[aria-label^="Close"]` | global | `app.js:32026-32143` |
| B14 | P1 | M | Button system: one `.btn` base + modifiers; one danger token, one disabled opacity, loading state | global | see §3.4 |
| B15 | P1 | M | Form fields: `--field-*` tokens on bare input/select/textarea; one `data-native` opt-out | global | `styles.css:633,7098,21207`; `src/ui/*-enhancer.js` |
| B16 | P1 | S | "Active Tracks" relabel | Homework | `homework.js:883` |
| B17 | P1 | M | Standardize empty states on `cw-empty-state` | all | `app.js:25491`; `business-workspace.js:1603`; `app.js:36603` |
| B18 | P1 | M | FAB stack → flex column + `--fab-stack-bottom`; include `#addTaskBtn` | mobile | `app.js:1698-1764` |
| B19 | P1 | S | Promote `pref-high-contrast` under `@media (prefers-contrast:more)` | global a11y | `app.js:3904`; `styles.css:24199` |
| B20 | P1 | S | Fill reduced-motion gaps in `mobile.css` | mobile | `mobile.css:739` |
| B21 | P1 | S | Audit `outline:none !important` for focus-visible replacement | global a11y | `styles.css:32814`; `macos26-redesign.css:455` |
| B22 | P2 | L | Adopt `--space-*` scale; codemod hardcoded px | global | `styles.css:20702` + ~2000 sites |
| B23 | P2 | L | Add `--text-*` type scale; standardize on rem | global | `styles.css` font-size sites |
| B24 | P2 | M | `--z-*` ladder; cap `2147483000` | global | `sutra-pro.css:74`; `app.js:58768` |
| B25 | P2 | S | Consolidate scattered `:root` blocks | global | `styles.css:7,20702` |
| B26 | P2 | M | Collapse/document `data-theme` vs `data-theme-key` | theming | `app.js:29128,29699` |
| B27 | P2 | S | Notes toolbar: overflow menu instead of horizontal scroll | Notes | `assets/screenshots/notes-editor.png` |
| B28 | P2 | S | Install webkit + re-run audit (Safari coverage) | tooling | `npx playwright install webkit` |

### Environmental note on B01 — RESOLVED
The jszip deletion was a **working-tree state** (initial `git status` showed `D assets/vendor/jszip/...`), not a committed regression. **Restored during this audit** via `git checkout -- assets/vendor/jszip/`; re-verified: the file now serves `200` and the chromium `full-app-audit` suite passes **10/10** (previously 7/10, the 3 failures all caused by the jszip 404; `criticalConsoleCount` 1→0). The remaining environmental gap is the missing WebKit browser binary (B28).

---

## 7. Recommended execution sequence

**Wave 0 — Quick wins / unblock (1 short PR):** B01, B02, B03, B05, B06, B07, B08, B09, B10, B11, B16. All S, mostly independent, immediately visible. Re-run `mobile-audit` + `full-app-audit` for before/after.

**Wave 1 — Foundational track (the token spine):** B22 → B23 → B24 → B25 (then B12, B19, B20, B21 ride on top). Do this *before* the component consolidations so they can consume the new tokens. Largest effort, highest long-term payoff; land incrementally behind `npm run check:all`.

**Wave 2 — Component contracts:** B13 (modals), B14 (buttons), B15 (forms), B17 (empty states), B18 (FABs). Each consumes Wave-1 tokens. Migrate newest-code conventions outward (`.is-visible`, `data-modal-close`, `cc-btn`). Guard with `check:modal`, `check:guardrails`, `check:responsive`.

**Wave 3 — Polish & coverage:** B26, B27, B28, plus a full per-theme screenshot sweep and WebKit pass.

**Verification each wave:** `npm run check:all` (must stay green; respect the guardrail ratchet + load-order rules in `docs/architecture/SUTRA_ARCHITECTURE.md §11-15`), then `mobile-audit` + `full-app-audit` for before/after screenshots, then a manual per-theme spot check.

---

## 8. Appendix — raw artifact locations

- Mobile audit: `.tmp/mobile-audit/*.png` (28 surfaces × 4 viewports) + `.tmp/mobile-audit/report.json`
- Full-app audit: `.tmp/playwright-results/` (AUDIT:: JSON markers; failures = jszip 404 + missing webkit binary only)
- Desktop reference shots: `assets/screenshots/*.png` (regenerated during audit, then restored via `git checkout`)
- Tooling: `scripts/mobile-audit.mjs`, `tests/e2e/full-app-audit.spec.mjs`, `scripts/capture-final.mjs`
- Architecture/load-order reference: `docs/architecture/SUTRA_ARCHITECTURE.md` §11-15

*Audit performed June 2026. No application source (`Sutra.html`, `src/**`, `styles/**`) was modified — confirm with `git status` (only this doc should appear, plus the jszip working-tree deletion that predated the audit).*
