# `styles/` — stylesheets, organized by cascade layer

Sutra has **no CSS build step**. Every stylesheet is a plain `<link>` in
`Sutra.html`, and the **cascade is determined by `<link>` order in the HTML**,
not by folder. Moving a file into a subfolder here does *not* change the cascade
as long as its `<link>` keeps the same position. Folders are an organizational
map only.

> ⚠️ **Cascade order is load-bearing.** Memory/precedent: `responsive/mobile.css`
> must stay near the end, and several `legacy/*` blocks use `!important` and beat
> earlier files. When you add or move a `<link>`, preserve its position relative
> to its neighbours and keep the `?v=` cache-busting query.

## Layers

| Folder | Files | What it is |
|---|---|---|
| `base/` | `styles.css` (the large core), `microinteractions.css` | Design tokens, components, layout, and interaction polish. The foundation everything else layers over. |
| `themes/` | `sutra-pro.css`, `glass.css`, `macos26-redesign.css`, `dune.css`, `signature-presets.css` | The "pro" surface plus authored glass, platform-inspired, cinematic, and signature preset theme layers. |
| `views/` | `focus-session.css`, `settings-redesign.css` | View-specific styling extracted from the app shell. |
| `features/` | `sutra-intelligence.css`, `customization.css`, `command-center.css`, `academic-command-center.css`, `academic-planning.css`, `notifications.css`, `pdf-workspace.css`, `startup-intro.css` | Per-feature styling, including the responsive contextual PDF canvas and sheets. |
| `responsive/` | `mobile.css` | Mobile / tablet overrides. Loads late on purpose. |
| `legacy/` | `app-shell-base.css`, `workspace-overrides.css`, `mobile-global.css`, `ui-refresh.css`, `refinement.css`, `responsive-hardening.css` | Large blocks **extracted from inline `<style>` in `Sutra.html`**. Loaded by a `<link>` at the same cascade position they occupied inline, so the result is identical. Split these down incrementally; do not grow them. |

## `legacy/` — why it exists

These six files were inline `<style data-sutra-inline-style-legacy="…">` blocks
inside `Sutra.html` (~2,900 lines, ~28% of the shell). They were externalized
1:1 so the shell is navigable and `npm run check:shell` keeps ratcheting inline
CSS down. They are *legacy* because they are large and not yet split by concern —
the goal is to migrate their rules into `base/`, `themes/`, `views/`, or
`features/` over time, shrinking each `legacy/*` file toward zero.

## Editing rules

- A handful of check scripts assert specific selectors live in specific files
  (`smoke-check`, `responsive-check`, `modal-a11y-check`). If you move CSS between
  files, update those assertions. `npm run check:all` + `npm run check:links`
  catch breakage.
- `npm run check:shell` blocks **new** large inline `<style>` blocks in
  `Sutra.html`. Add new styling as a file here with a `<link>`, not inline.
