# CSS Mods Guide

This is the complete reference for **CSS Overrides** in Sutra — the power-user layer
that lets you restyle the workspace with your own CSS. It is written so that an
advanced user can customize Sutra safely **without reading the source code**.

Sutra is **local-first**: your CSS has no remote marketplace, and everything you
write here travels inside your own workspace backup. If you explicitly enable
encrypted Google Drive sync, CSS snippets can be included in the browser-encrypted
workspace snapshot; Sutra never uploads them as separate readable files.

> **Golden rule:** every example here can be undone in seconds. If anything looks
> wrong, you can disable a single snippet, flip the master switch off, or reload in
> **Safe Mode** — none of which deletes your work. See [Recovery](#recovery).

---

## 1. What CSS Overrides are

CSS Overrides are small blocks of CSS ("snippets") that Sutra injects **after** its
own built-in styles and after the active theme, so your rules win the cascade. They
let you nudge spacing, colors, corners, shadows, widths, and typography without
forking the app.

Each snippet is:

- **Named** (your label, shown on the snippet card).
- **Independently enabled or disabled** (a per-snippet switch).
- **Ordered** (later snippets win — see [the cascade](#3-the-cascade-order)).
- **Portable** — it lives in your workspace and rides along in backups.

Overrides are intentionally CSS-only. They cannot run JavaScript, fetch anything,
or read your data — that is what makes them safe to paste from a guide like this.

### Where to find them

**Settings ▸ Customization** → the **CSS Overrides** section.

Customization has two sections — **CSS Overrides** and **Safe Mode & Recovery** —
plus two master switches at the top: **Enable customization** and **Apply custom
CSS**. Turning **Apply custom CSS** off disables *all* snippets at once without
deleting any of them.

The CSS Overrides section opens with a **snippet gallery** — a small set of curated,
hand-vetted presets (Compact Sidebar, Bigger Editor Text, Minimal Today View, Softer
Cards, High Contrast, Calm Focus Mode). Each is CSS-only and reversible; clicking one
adds it as a new, editable snippet you can tweak or disable at any time.

> **Local Plugins** are a separate, **experimental developer feature** and are *not*
> part of the normal Customization screen. They live under **Settings ▸ Advanced ▸
> Developer / Experimental** (off by default) and are documented in
> [PLUGIN_SDK.md](PLUGIN_SDK.md). CSS Overrides never run code; plugins are the only
> place optional sandboxed code can run, which is why they're kept out of the way.

### CSS Overrides vs themes vs plugins

| | Themes | CSS Overrides | Plugins |
| --- | --- | --- | --- |
| What they are | Curated looks (Default, Dark, Retro, custom theme builder) | Your own raw CSS | Local `.sutra-plugin` / `.atelier-plugin` bundles |
| What they change | Color tokens + density via `body[data-theme]` and inline variables | Anything CSS can reach | Commands, sidebar items, templates, optional sandboxed code |
| Run code? | No | No | Optionally (sandboxed iframe only) |
| Win the cascade? | Base layer | **Yes** — injected after themes | A plugin's `styles` are attributed to the plugin and also injected as CSS |
| Skipped by Safe Mode? | No (themes still apply) | **Yes** | **Yes** |

The three layers are independent. Themes only toggle `body[data-theme]` attributes
and inline CSS variables; **they never touch your snippet `<style>` elements**, so
your overrides survive theme switches. Plugins are a separate system documented in
[PLUGIN_SDK.md](PLUGIN_SDK.md) and [MODS_AND_CUSTOMIZATION.md](MODS_AND_CUSTOMIZATION.md).

---

## 2. What's in backups (and what is not)

CSS snippets travel inside your workspace backup:

- They are included in **JSON backups** and in **`.sutra`** export/import (and the
  legacy **`.atelier`** format still imports). Internally they live under
  `settings.customization`.
- On import, your snippets and their enabled/disabled state come back exactly as
  they were.

What is **never** exported, from anywhere in Sutra:

- API keys, provider credentials, and tokens. These use **sessionStorage by
  default**; explicitly remembered Assistant keys and Cloud refresh tokens use
  the encrypted device-local credential vault and are stripped from every
  shared export.

Because CSS Overrides are pure CSS, importing them can never run code. And if an
imported snippet is broken or hostile, **Safe Mode** bypasses it so it can't lock
you out (see [Recovery](#recovery)).

---

## 3. The cascade order

Sutra layers styles in this exact order. **Later wins.**

```
built-in styles
  → active theme (body[data-theme] + inline variables)
    → Sutra custom-CSS anchor  (the empty <style> that marks "user CSS starts here")
      → enabled user snippet #0
        → enabled user snippet #1
          → enabled user snippet #2 …
```

Details that matter when you write overrides:

- Each enabled snippet is injected as its **own** `<style>` element, appended
  **after** the custom-CSS anchor, in order. Snippet element IDs are generated —
  **your snippet names are never used as DOM IDs**, so you can name snippets
  anything.
- **Disabled snippets are not injected at all** — they leave no `<style>` behind, so
  a disabled snippet has zero effect on the page.
- **Order controls precedence.** Use **Move ↑ / ↓** on a snippet card to reorder. If
  two snippets set the same property on the same selector, the one **lower in the
  list** wins.
- Overrides are kept **separate from theme definitions**, so they **survive theme
  switches and a full page refresh**, and they **survive a `.sutra` / `.atelier`
  import** (they come back with the workspace).
- **Safe Mode skips your snippets without deleting them** — the anchor and the
  snippet `<style>` elements simply are not injected for that session. Your snippets
  reappear next normal load.

### Winning the cascade without `!important`

Because your snippet is injected last, a selector of **equal specificity** to
Sutra's already wins. Reach for `!important` only when a built-in rule itself uses
`!important` (a few document-background and focus-mode rules do). Prefer matching
Sutra's own selector shape — e.g. scope to `#view-notes .editor` rather than a bare
`.editor` — so your rule is specific enough but still predictable across themes.

---

## 4. Design tokens (CSS variables)

Sutra is built on CSS custom properties defined on `:root` and re-defined per theme
(`body[data-theme="dark"]`, `[data-theme="retro"]`, custom themes, etc.). **Setting a
variable in a snippet is the safest possible override** because it flows through
every component that reads it, and it stays theme-consistent.

> **Inspect before you set.** Values drift between releases and differ per theme.
> Open your browser DevTools, select `:root` (or `body`), and read the *current*
> computed value before overriding it. Treat the values below as **illustrative
> defaults**, not guarantees.

| Token | Role | Illustrative default (light) |
| --- | --- | --- |
| `--bg-primary` | App background | `#ffffff` |
| `--bg-secondary` | Secondary background / gradient mid | `#fbfcfe` |
| `--bg-hover` | Hover background | `#f3f5f8` |
| `--bg-elevated` | Elevated background | `#ffffff` |
| `--editor-bg` | Note editor surface | `#ffffff` |
| `--surface-bg` / `--surface-bg-hover` / `--surface-bg-active` | Card / control surfaces | translucent dark tints |
| `--surface-border` / `--surface-border-strong` | Surface borders | translucent |
| `--border` | Hairline borders | `rgba(22,30,45,0.13)` |
| `--text-primary` | Main text | `#2a2621` |
| `--text-secondary` | Secondary text | `#5f6670` |
| `--text-muted` | Muted text | `#87909d` |
| `--accent` | Accent color | `#d8c4a1` |
| `--accent-rgb` | Accent as `r, g, b` (for `rgba()`) | `216, 196, 161` |
| `--accent-strong` | Stronger accent | `#b79a73` |
| `--accent-soft` | Soft accent wash | `rgba(216,196,161,0.12)` |
| `--radius` | Default corner radius | `18px` |
| `--radius-lg` | Large radius | `28px` |
| `--radius-pill` | Pill radius | `999px` |
| `--shadow-soft` / `--shadow-soft-lg` | Soft shadows | layered `box-shadow`s |
| `--glass-01` / `--glass-02` / `--glass-border` / `--glass-blur` | Glass surfaces | translucent + `22px` blur |
| `--sidebar-width` | Sidebar width | `300px` |
| `--sidebar-collapsed-width` | Collapsed sidebar width | `76px` |
| `--top-nav-height` / `--top-nav-height-mobile` | Top nav heights | `88px` / `64px` |
| `--transition-fast` / `--transition-base` | Motion timing | cubic-bezier easings |

There are also `--neumo-*` tokens (neumorphic surfaces), `--code-*` tokens (code
blocks), and split-view sticky tokens (`--notes-split-sticky-*`). When in doubt,
override the **token**, not the component, and keep your values close to the
originals so themes still read correctly.

> **Keep `--accent-rgb` in sync with `--accent`.** Several soft washes are built as
> `rgba(var(--accent-rgb), …)`. If you change `--accent`, change `--accent-rgb` to
> the same color's RGB triplet or the washes won't match.

---

## 5. Stable hooks & selectors

These selectors are reasonably stable anchor points for targeting. Internal code
identifiers that begin with `atelier-` (for example the custom-CSS anchor and the
Safe Mode banner) are retained for compatibility — they are *code identifiers*, not
brand text, and they are safe to reference.

### Brand marks & logo placements

These stable hooks let custom themes restyle the Sutra logo wherever it appears without brittle class chains:

| Target | Selector |
| --- | --- |
| Sidebar / landing brand mark | `[data-sutra-component="brand-mark"]` |
| Brand mark `<img>` | `[data-sutra-component="brand-mark"] img` |
| Startup loader logo | `[data-sutra-component="startup-loader"]` |
| Assistant launcher button | `[data-sutra-component="assistant-launcher"]` |
| Assistant panel root | `[data-sutra-component="assistant-header"]` |
| Intelligence badge | `[data-sutra-component="assistant-intelligence-badge"]` |

Example — reduce the sidebar logo brightness on a light theme:

```css
[data-sutra-component="brand-mark"] img {
  opacity: 0.82;
  /* or add a dark backplate for very light backgrounds */
  /* background: rgba(10,15,30,0.85); border-radius: 8px; */
}
```

### App shell & navigation

| Target | Selector |
| --- | --- |
| App shell main column | `.main-content` |
| Sidebar | `#sidebar` / `.sidebar` |
| Collapsed sidebar | `.sidebar.collapsed` |
| Top navigation | `.top-nav` |
| View tab buttons | `.view-tab[data-view="…"]` (e.g. `[data-view="today"]`, `notes`, `settings`) |
| Overflow "More" menu items | `.view-tab.view-more-item` |
| Active view container | `.view.active` |

Each major area renders into its own container: `#view-today`, `#view-timeline`,
`#view-notes`, `#view-homework`, `#view-apstudy` (Testing Hub), `#view-review`,
`#view-collegeapp` (College), `#view-life`, `#view-business` (Projects & Work),
`#view-courses`, `#view-alldue`, `#view-settings`. Scope a snippet to one area by
prefixing its selector with the view ID.

### Today

| Target | Selector |
| --- | --- |
| Today view | `#view-today` (also `.dashboard-today`) |
| Today hero header | `.today-hero-header` |
| Today panels (cards) | `#view-today .today-panel` |
| Individual task cards | `#view-today .task-card` |
| Mobile "essentials" shell | `#todayMobileShell` / `.today-mobile-shell` |

### Notes & editor

| Target | Selector |
| --- | --- |
| Notes view | `#view-notes` |
| Editor container | `#notesEditorContainer` / `.editor-container` |
| Primary note pane | `#notesPrimaryPane` / `.notes-pane.notes-pane-primary` |
| Main editable surface | `#editor` / `#view-notes .editor` |
| Toolbar | `#view-notes .toolbar` |
| Page title input | `.page-title-input` |

### Page Mode

| Target | Selector |
| --- | --- |
| Page-mode editor state | `.editor.page-mode-active` |
| Body flag when active | `body.notes-pages-mode` |
| A paginated page | `.page-mode-page` (`.size-letter` / `.size-a4`) |
| Page content / header / footer | `.page-mode-page-content` / `.page-mode-page-header` / `.page-mode-page-footer` |
| Page number / break | `.page-mode-page-number` / `.page-mode-page-break` |

### Split view

| Target | Selector |
| --- | --- |
| Body flag when split is open | `body.notes-split-active` |
| Secondary note pane | `#notesSecondaryPane` / `.notes-pane.notes-pane-secondary` |
| Split pane header / actions | `.split-pane-header` / `.split-pane-actions` |

### Sutra Assistant

| Target | Selector |
| --- | --- |
| Launcher button (mascot, bottom-right) | `#chatbotBtn` / `.chatbot-btn` |
| Assistant panel | `#chatbotPanel` / `.chatbot-panel` |
| Fullscreen panel state | `.chatbot-panel.fullscreen` |
| Mascot in panel header | `.chatbot-mascot` |
| **Powered by Sutra Intelligence badge** | `[data-sutra-component="assistant-intelligence-badge"]` (class `.sutra-intel-badge`) |
| Badge title / subtitle / info | `.sutra-intel-badge-title` / `.sutra-intel-badge-sub` / `.sutra-intel-badge-info` |

The badge sits directly under the panel header with the subtitle "Local signals from
your workspace." Prefer the **`data-sutra-component`** attribute when targeting it —
it is the documented stable hook.

### Document backgrounds (Notes)

| Target | Selector |
| --- | --- |
| Note pane carrying a background | `.notes-pane.has-doc-bg` |
| Background **image layer** | `[data-sutra-component="document-background-layer"]` (class `.sutra-doc-bg-layer`) |
| Dim **overlay** | `[data-sutra-component="document-background-overlay"]` (class `.sutra-doc-bg-overlay`) |
| Background modal **controls** | `[data-sutra-component="document-background-controls"]` (`#documentBackgroundModal`) |
| Blur amount (runtime variable) | `--sutra-docbg-blur` (set per pane) |

The overlay tints toward the editor surface color so text stays readable on any
theme; blur applies only to the image layer, never to your text. See
[HANDWRITING_AND_DRAWING.md](HANDWRITING_AND_DRAWING.md) for the broader Notes
editor and [MOBILE_AND_RESPONSIVE_BEHAVIOR.md](MOBILE_AND_RESPONSIVE_BEHAVIOR.md)
for how backgrounds behave on phones.

### Settings, Safe Mode banner, landing thread story

| Target | Selector |
| --- | --- |
| Settings view | `#view-settings` |
| Safe Mode banner | `#atelier-safe-mode-banner` / `.atelier-safe-mode-banner` (and `.safe-mode-banner-*` inner parts) |
| Landing thread-story section | `[data-sutra-component="thread-story"]` (stage: `"thread-stage"`, path: `"thread-path"`; nodes: `[data-sutra-thread-node="notes|assignments|timeline|radar|review|focus"]`) |

> The landing scrollytelling lives on the **landing page (`HomePage.html`)**, not
> inside the app workspace, so app CSS Overrides do not reach it. The hooks are
> listed here for completeness and may still be settling — reference them at a high
> level.

---

## 6. Safe copy-paste examples

Every example below is **CSS-only** and reversible. For each, paste it as a **new
snippet** under **Settings ▸ Customization ▸ CSS Overrides** (use **Add snippet**),
give it the suggested name, **Save**, and toggle its per-snippet switch on. To undo
any of them: **disable that snippet** (instant), or if something looks wrong, flip
**Apply custom CSS** off, or reload in **Safe Mode** — none of these delete the
snippet. The **Affects** column tells you whether the change is visible on desktop,
mobile, or both.

> "Safe" here means: it only changes appearance, targets documented selectors or
> design tokens, doesn't hide interactive controls, and can be disabled in one click.

### 6.1 Compact sidebar — `Compact sidebar`

```css
/* Narrower sidebar. Reads Sutra's own width token, so it stays consistent. */
:root { --sidebar-width: 248px; }
```

- **Changes:** sidebar width via the design token.
- **Why safe:** sets a documented variable; affects only layout width; no controls
  hidden.
- **Paste / disable / recover:** new snippet → Save → enable; disable the snippet to
  revert.
- **Affects:** desktop (the sidebar collapses to a menu on mobile, so width has no
  effect there).

### 6.2 Wider editor — `Wider editor`

```css
/* Give the note a roomier max width without touching layout machinery. */
#view-notes .editor { max-width: 980px; }
```

- **Changes:** maximum width of the writing surface.
- **Why safe:** scoped to the editor; only adjusts `max-width`.
- **Disable / recover:** turn the snippet off.
- **Affects:** both (capped by viewport on small screens, so phones are unaffected
  in practice).

### 6.3 Softer shadows — `Softer shadows`

```css
/* Gentler elevation everywhere shadows are derived from these tokens. */
:root {
  --shadow-soft: 0 8px 20px rgba(22, 30, 45, 0.05);
  --shadow-soft-lg: 0 16px 36px rgba(22, 30, 45, 0.08);
}
```

- **Changes:** the two soft-shadow tokens used across cards and panels.
- **Why safe:** token-only; reversible; theme-aware.
- **Disable / recover:** disable the snippet.
- **Affects:** both.

### 6.4 Sharper corners — `Sharper corners`

```css
/* Tighter radii for a crisper look. */
:root {
  --radius: 10px;
  --radius-lg: 16px;
}
```

- **Changes:** default and large corner radii.
- **Why safe:** token-only; does not affect pill controls (`--radius-pill` left
  alone).
- **Disable / recover:** disable the snippet.
- **Affects:** both.

### 6.5 Larger Today cards — `Larger Today cards`

```css
/* More breathing room inside Today's panels. */
#view-today .today-panel { padding: 22px; }
#view-today .today-panel .task-card { padding: 14px 16px; }
```

- **Changes:** internal padding of Today panels and task cards.
- **Why safe:** padding only; nothing hidden or repositioned.
- **Disable / recover:** disable the snippet.
- **Affects:** both (a separate mobile-only version is in 6.9).

### 6.6 Custom accent — `Custom accent`

```css
/* Recolor the accent. Keep --accent-rgb in sync with --accent. */
:root {
  --accent: #6c8cff;
  --accent-rgb: 108, 140, 255;
  --accent-strong: #4f6fe0;
  --accent-soft: rgba(108, 140, 255, 0.12);
}
```

- **Changes:** the accent color and its derived washes.
- **Why safe:** token-only; updating all four keeps washes consistent.
- **Disable / recover:** disable the snippet.
- **Affects:** both.

### 6.7 Document-background readability overlay — `Doc-bg readability`

```css
/* Strengthen the dim overlay floor when using busy background images. */
.notes-pane.has-doc-bg > [data-sutra-component="document-background-overlay"] {
  opacity: 0.55; /* your per-page Dim slider can still raise it further */
}
```

- **Changes:** minimum opacity of the document-background dim overlay.
- **Why safe:** targets the documented overlay hook; raising dim only improves text
  contrast; never touches the text layer.
- **Disable / recover:** disable the snippet (the per-page **Dim Background** slider
  remains the primary control).
- **Affects:** both.

### 6.8 Custom assistant badge treatment — `Assistant badge`

```css
/* Calmer "Powered by Sutra Intelligence" badge. */
[data-sutra-component="assistant-intelligence-badge"] {
  border-radius: 12px;
  background: var(--surface-bg);
  border: 1px solid var(--surface-border);
}
[data-sutra-component="assistant-intelligence-badge"] .sutra-intel-badge-title {
  letter-spacing: 0.06em;
}
```

- **Changes:** background, border, and title letter-spacing of the badge.
- **Why safe:** uses the documented stable hook and surface tokens; purely cosmetic;
  leaves the tooltip, text, and aria-label intact.
- **Disable / recover:** disable the snippet.
- **Affects:** both.

### 6.9 Mobile-only compact Today cards — `Mobile Today compact`

```css
/* Tighter Today cards on phones only. */
@media (max-width: 640px) {
  #view-today .today-panel { padding: 12px; }
  #view-today .task-card { padding: 10px 12px; }
}
```

- **Changes:** Today padding on small screens only.
- **Why safe:** wrapped in a `max-width` media query; desktop untouched.
- **Disable / recover:** disable the snippet.
- **Affects:** mobile only.

### 6.10 Mobile-only assistant spacing — `Mobile assistant spacing`

```css
/* A little more inset for the assistant panel on phones. */
@media (max-width: 560px) {
  .chatbot-panel { left: 12px; right: 12px; }
  [data-sutra-component="assistant-intelligence-badge"] { margin: 10px 12px 4px; }
}
```

- **Changes:** horizontal inset of the panel and badge margin on phones.
- **Why safe:** media-query-gated; keeps the composer and action cards fully usable;
  matches the panel's own mobile sizing approach.
- **Disable / recover:** disable the snippet.
- **Affects:** mobile only.

### 6.11 Mobile-safe larger tap targets — `Bigger tap targets`

```css
/* Honor the >=44px touch-target guidance on phones. */
@media (max-width: 768px) {
  .neumo-btn,
  .view-tab,
  .chatbot-btn {
    min-height: 44px;
    min-width: 44px;
  }
}
```

- **Changes:** minimum hit area of common buttons on small screens.
- **Why safe:** only enlarges targets (improves usability); media-query-gated; does
  not hide anything.
- **Disable / recover:** disable the snippet.
- **Affects:** mobile only.

### 6.12 High-contrast override — `High contrast`

```css
/* Push text and borders toward maximum contrast. Pair with the Dark theme. */
:root {
  --text-primary: #ffffff;
  --text-secondary: #e6e6e6;
  --text-muted: #c8c8c8;
  --border: rgba(255, 255, 255, 0.4);
  --surface-border: rgba(255, 255, 255, 0.4);
}
```

- **Changes:** text and border tokens for stronger contrast.
- **Why safe:** token-only; reversible. (These exact values suit dark themes — adjust
  for light themes, or scope under `body[data-theme="dark"]`.)
- **Disable / recover:** disable the snippet.
- **Affects:** both.

### 6.13 Reduce thread glow (landing) — `Reduce thread glow`

```css
/* If you self-host the landing page and find the thread animation too bright. */
[data-sutra-component="thread-path"] {
  filter: none;
  opacity: 0.7;
}
```

- **Changes:** softens the animated thread path on the landing page.
- **Why safe:** cosmetic; targets a documented hook; the final connected state
  remains visible.
- **Where to paste:** this targets the **landing page (`HomePage.html`)**, not the
  app. App CSS Overrides do not reach the landing page — apply it where you serve
  `HomePage.html`. Listed here for completeness.
- **Disable / recover:** remove the rule from wherever you injected it.
- **Affects:** both (landing page).

### 6.14 Quieter motion — `Quieter motion`

```css
/* Slow Sutra's standard easings slightly for a calmer feel. */
:root {
  --transition-fast: 220ms cubic-bezier(0.22, 1, 0.36, 1);
  --transition-base: 320ms cubic-bezier(0.22, 1, 0.36, 1);
}
```

- **Changes:** the shared transition timing tokens.
- **Why safe:** token-only; does not disable functionality. (For full reduction,
  prefer your OS "reduce motion" setting, which Sutra already respects.)
- **Disable / recover:** disable the snippet.
- **Affects:** both.

### 6.15 Roomier note line height — `Roomy line height`

```css
/* Easier-to-read body text in the editor. */
#view-notes .editor { line-height: 1.75; }
```

- **Changes:** line height of editor body text.
- **Why safe:** typography only; scoped to the editor.
- **Disable / recover:** disable the snippet.
- **Affects:** both.

### 6.16 Glassier panels — `Glassier panels`

```css
/* Slightly stronger blur on glass surfaces. */
:root { --glass-blur: 30px; }
```

- **Changes:** the glass blur token used by panels and the sidebar.
- **Why safe:** single token; visual only.
- **Disable / recover:** disable the snippet.
- **Affects:** both (blur is a progressive enhancement; harmless where unsupported).

### 6.17 Calmer accent washes — `Calmer washes`

```css
/* Lighten accent-tinted surfaces without changing the accent hue. */
:root { --accent-soft: rgba(var(--accent-rgb), 0.06); }
```

- **Changes:** the soft accent wash opacity, derived from the accent RGB.
- **Why safe:** token-only; automatically tracks your accent color.
- **Disable / recover:** disable the snippet.
- **Affects:** both.

### 6.18 Distinct split-view divider — `Split divider`

```css
/* Make the secondary split pane visually distinct. */
body.notes-split-active .notes-pane-secondary {
  border-left: 2px solid var(--accent-soft);
}
```

- **Changes:** adds a subtle accent border between split panes.
- **Why safe:** uses the `body.notes-split-active` flag (only applies while split is
  open) and an accent token; nothing hidden.
- **Disable / recover:** disable the snippet.
- **Affects:** desktop/tablet (split view is a wide-screen feature; on phones the
  secondary pane stacks or hides).

### 6.19 Stronger focus ring — `Stronger focus ring`

```css
/* More visible keyboard focus, for accessibility. */
:where(button, a, input, textarea, [tabindex]):focus-visible {
  outline: 3px solid var(--accent);
  outline-offset: 2px;
}
```

- **Changes:** strengthens the visible focus indicator.
- **Why safe:** `:focus-visible` only; improves accessibility; `:where()` keeps
  specificity at zero so it never fights real component styles.
- **Disable / recover:** disable the snippet.
- **Affects:** both.

---

## 7. Recovery

If a snippet hides part of the interface, or you just want to confirm whether a
problem is caused by your CSS, recover **without losing any data**. None of these
delete your snippets, plugins, or workspace.

1. **Master disable.** Turn **Apply custom CSS** off (top of **Settings ▸
   Customization**). All snippets stop applying immediately; they stay saved. There
   is also a **Disable all mods** master switch and a **Reset all CSS customization**
   (which *does* remove snippets — use only when you mean it; themes, notes, tasks,
   and plugins are untouched).
2. **Reload in Safe Mode.** Use **Reload in Safe Mode** in the **Safe Mode &
   Recovery** tab. Safe Mode **skips all custom CSS and plugins** for that session and
   **never deletes** anything.
3. **`?sutraSafeMode=1`.** Add this query parameter to the app URL to launch straight
   into Safe Mode (canonical).
4. **`?atelierSafeMode=1`.** The **legacy** parameter still works and does the same
   thing.
5. **Hold <kbd>Shift</kbd> while the app loads.** Also triggers Safe Mode — handy
   when you can't edit the URL.
6. **Reload normally** to exit. In Safe Mode a banner appears with **Disable all
   mods** and **Reload normally**; once the offending snippet is disabled, a normal
   reload restores everything else.

> Because Safe Mode only *skips* customization (it never deletes it), the safe
> routine is: enter Safe Mode → disable or fix the bad snippet → reload normally.

---

## 8. Mobile customization

You can ship CSS that only affects phones and tablets by wrapping rules in media
queries. Sutra's own responsive breakpoints cluster around these widths, so target
them for predictable results:

| Breakpoint | Typical meaning |
| --- | --- |
| `max-width: 1024px` | Tablet / narrow desktop |
| `max-width: 768px` | Primary mobile breakpoint (navigation collapses to the view menu) |
| `max-width: 640px` | Small tablet / large phone |
| `max-width: 560px` | Assistant badge switches to its compact layout |
| `max-width: 480px` | Phone |
| `max-width: 360px` | Small phone |

Guidance for mobile snippets:

- **Gate everything in a media query.** Use `@media (max-width: …)` so desktop is
  untouched (examples 6.9–6.11).
- **Respect touch targets.** Keep primary controls **≥44px** and constrained
  controls **≥40px** (example 6.11). Don't shrink buttons below this.
- **Don't fight the software keyboard.** The assistant composer and modals are
  already designed to stay usable with the on-screen keyboard open and to keep
  primary actions above mobile browser chrome — avoid `position: fixed` hacks that
  could cover them.
- **Let modals scroll internally.** Sutra's modals scroll their own content; don't
  force `overflow: visible` on them.
- **Test at multiple widths.** Use your browser's device toolbar across 768 → 320px,
  and confirm nothing overflows horizontally (the editor and drawings are already
  width-capped to avoid horizontal overflow on phones).
- **Sidebar width tokens don't apply on phones.** The sidebar becomes a menu under
  768px, so `--sidebar-width` overrides only affect wider screens.

For the full per-area behavior on small screens, see
[MOBILE_AND_RESPONSIVE_BEHAVIOR.md](MOBILE_AND_RESPONSIVE_BEHAVIOR.md). For the
broader customization system (master switches, plugins, backup/restore), see
[MODS_AND_CUSTOMIZATION.md](MODS_AND_CUSTOMIZATION.md).
