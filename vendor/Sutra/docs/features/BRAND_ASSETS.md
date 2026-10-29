# Sutra — Brand Assets

This document is the canonical reference for all Sutra brand assets: what they are, where they live, how to use them, and how to regenerate them.

---

## Contents

1. [Master logos](#master-logos)
2. [Generated derivatives](#generated-derivatives)
3. [Favicon usage](#favicon-usage)
4. [App-shell usage](#app-shell-usage)
5. [Loading-state usage](#loading-state-usage)
6. [Sutra Assistant usage](#sutra-assistant-usage)
7. [Mobile usage](#mobile-usage)
8. [Accessibility rules](#accessibility-rules)
9. [Reduced-motion rules](#reduced-motion-rules)
10. [Custom-theme behavior](#custom-theme-behavior)
11. [CSS hooks](#css-hooks)
12. [Asset-generation script](#asset-generation-script)
13. [Regeneration instructions](#regeneration-instructions)
14. [Stale-brand verification](#stale-brand-verification)
15. [Intentional legacy references](#intentional-legacy-references)

---

## Master logos

Two approved master PNGs are the canonical source of truth. **Never** regenerate them as SVG, redraw them, or alter their geometry, colors, or transparency.

2026 update: the approved source lockups remain preserved in `assets/logos/`:

- `assets/logos/sutra.png` - source main Sutra lockup.
- `assets/logos/sutra-assistant.png` - source Sutra Assistant lockup.

Production derivatives now include transparent emblem masters:

- `assets/brand/sutra/sutra-app-icon-master.png` - main Sutra transparent mark for app icons, favicon, Apple touch icon, PWA icons, startup, app shell, and product branding.
- `assets/brand/sutra/sutra-full-lockup.png` - full main Sutra lockup for documentation and marketing surfaces.
- `assets/brand/sutra/sutra-assistant-icon-master.png` - Sutra Assistant transparent mark for assistant-only surfaces.
- `assets/brand/sutra-assistant/` - assistant-specific master, lockup, and generated aliases.

The manifest uses `assets/brand/sutra/generated/sutra-icon-maskable-512.png` for the maskable PWA icon and keeps the assistant logo out of product app-icon declarations.

| Asset | Path | Use for |
|---|---|---|
| Main Sutra logo | `assets/brand/sutra/sutra-app-icon-master.png` | Product icon — everything except assistant surfaces |
| Sutra Assistant logo | `assets/brand/sutra/sutra-assistant-icon-master.png` | Assistant surfaces only |

### Main Sutra logo

- Dark navy background with rounded corners
- White-to-blue S-curve with endpoint nodes and a central crossover node
- White upper half, blue lower half, four-pointed star accent
- Used for: favicon, app icon, landing page, app shell, sidebar, startup loader, onboarding, Settings About, Help & Docs, Safe Mode, empty states, PWA icons

### Sutra Assistant logo

- Same rounded-corner dark background
- Clean S-curve with a speech-bubble / three-dots element in the lower loop
- Used for: assistant launcher button, assistant panel header, mobile assistant launcher, assistant empty state, assistant settings, assistant documentation

**Do not use the assistant logo as the main product logo and do not use the main logo on assistant-specific surfaces.**

---

## Generated derivatives

All derivatives live in `assets/brand/sutra/generated/`. They are produced by `scripts/generate-sutra-brand-assets.py` from the two masters.

### Main Sutra icon sizes

| File | Size | Use |
|---|---|---|
| `sutra-icon-16.png` | 16 × 16 | Favicon (embedded in ICO) |
| `sutra-icon-32.png` | 32 × 32 | Favicon `<link>`, browser tab |
| `sutra-icon-48.png` | 48 × 48 | Favicon (embedded in ICO) |
| `sutra-icon-64.png` | 64 × 64 | Sidebar brand mark, landing navbar |
| `sutra-icon-96.png` | 96 × 96 | General use |
| `sutra-icon-128.png` | 128 × 128 | General use |
| `sutra-icon-180.png` | 180 × 180 | Apple touch icon |
| `sutra-icon-192.png` | 192 × 192 | PWA manifest icon |
| `sutra-icon-256.png` | 256 × 256 | Startup loader, onboarding |
| `sutra-icon-512.png` | 512 × 512 | PWA manifest icon (maskable) |
| `sutra-icon-1024.png` | 1024 × 1024 | App store / high-DPI |
| `favicon.ico` | Multi-res 16/32/48/64 | Browser favicon fallback |

### Sutra Assistant icon sizes

| File | Size | Use |
|---|---|---|
| `sutra-assistant-icon-32.png` | 32 × 32 | Small assistant surfaces |
| `sutra-assistant-icon-44.png` | 44 × 44 | Assistant launcher button (min touch target) |
| `sutra-assistant-icon-64.png` | 64 × 64 | Assistant panel header |
| `sutra-assistant-icon-96.png` | 96 × 96 | General assistant use |
| `sutra-assistant-icon-128.png` | 128 × 128 | Assistant settings, onboarding |
| `sutra-assistant-icon-192.png` | 192 × 192 | Large assistant surfaces |
| `sutra-assistant-icon-256.png` | 256 × 256 | Assistant empty state |
| `sutra-assistant-icon-512.png` | 512 × 512 | High-DPI assistant surfaces |

---

## Favicon usage

The generated directory also contains `social-preview.png` (1200 by 630) for
Open Graph and Twitter summary-card metadata. It is built from the approved main
Sutra master PNG and existing brand colors; do not replace it with unapproved
artwork.

Add these `<link>` elements to every HTML entry point (`index.html`, `HomePage.html`, `Sutra.html`):

```html
<link rel="icon" type="image/png" sizes="32x32" href="assets/brand/sutra/generated/sutra-icon-32.png">
<link rel="icon" type="image/png" sizes="16x16" href="assets/brand/sutra/generated/sutra-icon-16.png">
<link rel="shortcut icon" href="assets/brand/sutra/generated/favicon.ico">
<link rel="apple-touch-icon" sizes="180x180" href="assets/brand/sutra/generated/sutra-icon-180.png">
```

Also add these `<meta>` elements:

```html
<meta name="application-name" content="Sutra">
<meta name="apple-mobile-web-app-title" content="Sutra">
<meta name="theme-color" content="#07111f">
```

The old `assets/sutra-favicon.svg` has been removed. Do not reference it.

---

## App-shell usage

### Expanded sidebar brand mark

```html
<div class="app-title" data-sutra-component="brand-mark">
  <img class="app-title-icon app-title-mark"
       src="assets/brand/sutra/generated/sutra-icon-64.png"
       alt=""
       aria-hidden="true"
       width="26" height="26"
       style="border-radius:8px;flex:0 0 auto;display:block;">
  <span class="app-title-wordmark">Sutra</span>
</div>
```

### Landing-page navbar

```html
<a href="#" class="brand" data-sutra-component="brand-mark" aria-label="Sutra home">
  <img src="assets/brand/sutra/generated/sutra-icon-64.png"
       alt="" aria-hidden="true"
       class="brand-logo" width="36" height="36">
  <span class="brand-text">Sutra</span>
</a>
```

### Settings About section

Show the `sutra-icon-128.png` or `sutra-icon-256.png` alongside:

```
Sutra
Your academic life, woven into one private workspace.
```

---

## Loading-state usage

The startup loader in `Sutra.html` uses `sutra-icon-256.png`:

```html
<div id="sutraStartupIntro" role="presentation" aria-hidden="false" aria-label="Sutra is loading">
  <div class="intro-glow" aria-hidden="true"></div>
  <div class="intro-logo-wrap">
    <img class="intro-logo-mark"
         src="assets/brand/sutra/generated/sutra-icon-256.png"
         alt="Sutra"
         width="96" height="96"
         draggable="false"
         fetchpriority="high"
         data-sutra-component="startup-loader">
    <div class="intro-wordmark" aria-hidden="true">Sutra</div>
    <div class="intro-tagline" aria-hidden="true">Powered by Sutra Intelligence</div>
  </div>
  <div class="intro-skip-hint" aria-hidden="true">Click or press Esc to skip</div>
</div>
```

The loader respects `prefers-reduced-motion` via `styles/features/startup-intro.css`.

---

## Sutra Assistant usage

### Launcher button

```html
<button class="chatbot-btn" id="chatbotBtn"
        title="Open Sutra Assistant"
        aria-label="Open Sutra Assistant"
        data-sutra-component="assistant-launcher">
  <img src="assets/brand/sutra/generated/sutra-assistant-icon-44.png"
       alt="" aria-hidden="true" />
</button>
```

The button uses a `28%` border-radius to echo the icon's own corner geometry without over-clipping.

### Panel header

```html
<div class="chatbot-panel" id="chatbotPanel"
     aria-hidden="true" role="dialog" aria-label="Sutra Assistant"
     data-sutra-component="assistant-header">
  <header class="chatbot-header">
    <img src="assets/brand/sutra/generated/sutra-assistant-icon-64.png"
         alt="" class="chatbot-mascot" aria-hidden="true" />
    <div class="chatbot-title-group">
      <div class="chatbot-title">Sutra Assistant</div>
      <span class="chatbot-powered-by">✦ Powered by Sutra Intelligence</span>
      ...
    </div>
  </header>
</div>
```

### Powered by Sutra Intelligence badge

```html
<div class="sutra-intel-badge"
     data-sutra-component="assistant-intelligence-badge"
     role="note" tabindex="0"
     aria-label="Powered by Sutra Intelligence. Sutra Intelligence analyzes local workspace signals such as overdue work, workload, schedule conflicts, weak areas, review backlog, and next steps. AI requests are sent only to the provider you choose.">
  ...
</div>
```

---

## Mobile usage

| Surface | Asset | Max display size |
|---|---|---|
| Landing navbar | `sutra-icon-64.png` at 22–28 px CSS | 28 × 28 px CSS |
| App header | `sutra-icon-64.png` at 26 px CSS | 26 × 26 px CSS |
| Startup loader | `sutra-icon-256.png` at 96 px CSS | ~140 px on narrow phones |
| Assistant launcher | `sutra-assistant-icon-44.png` at 48 px CSS | 48 × 48 px CSS |
| Assistant panel header | `sutra-assistant-icon-64.png` at 30 px CSS (mobile) | 30 × 30 px CSS |

Never scale below the source resolution. The 44 px assistant icon is the minimum touch-target size.

---

## Accessibility rules

| Context | Requirement |
|---|---|
| Main logo as a link | `aria-label="Sutra home"` on the anchor; `alt=""` and `aria-hidden="true"` on the `<img>` |
| Decorative main logo | `alt=""` and `aria-hidden="true"` |
| Startup loader | `aria-label="Sutra is loading"` on the container |
| Assistant launcher | `aria-label="Open Sutra Assistant"` on the `<button>` |
| Assistant header icon | `alt=""` and `aria-hidden="true"` (title text carries the meaning) |
| Intelligence badge | `aria-label="Powered by Sutra Intelligence. ..."` explaining the tooltip |

---

## Reduced-motion rules

The startup loader CSS (`styles/features/startup-intro.css`) must include:

```css
@media (prefers-reduced-motion: reduce) {
  .intro-logo-mark { animation: none; }
  .intro-glow      { animation: none; opacity: 0.3; }
  #sutraStartupIntro { transition: opacity 0.15s linear; }
}
```

The scroll-linked landing page animations (problem-section, reveal-section, guided tour) also respect `prefers-reduced-motion` — see `docs/SCROLLYTELLING_AND_LANDING_PAGE.md`.

---

## Custom-theme behavior

The logo images use RGBA transparency. They are designed for the dark navy (`#07111f`) background of the default Sutra theme. On light themes:

- Add a subtle dark backplate behind the logo if the theme background is lighter than `#3a3a3a`.
- Example CSS: `.app-title-mark { background: rgba(10,15,30,0.85); border-radius: 8px; }`

The `data-sutra-component` hooks described below allow custom CSS themes to target logo placements precisely.

---

## CSS hooks

Every logo placement carries a `data-sutra-component` attribute so custom CSS themes can target it without relying on fragile class chains:

| Attribute value | Element | Purpose |
|---|---|---|
| `brand-mark` | Sidebar header, landing navbar link | Main product logo placement |
| `startup-loader` | Startup intro `<img>` | Startup logo |
| `assistant-launcher` | `#chatbotBtn` | Assistant launcher button |
| `assistant-header` | `#chatbotPanel` | Assistant panel root |
| `assistant-intelligence-badge` | `.sutra-intel-badge` | Powered by Sutra Intelligence badge |

Example custom CSS:

```css
/* Reduce logo opacity in high-brightness themes */
[data-sutra-component="brand-mark"] img {
  opacity: 0.85;
}
```

---

## Asset-generation script

```
scripts/generate-sutra-brand-assets.py
```

**Prerequisites:** `pip install Pillow`

**Run:**

```bash
python scripts/generate-sutra-brand-assets.py
```

The script:
- Reads only the two canonical master PNGs
- Preserves 1:1 aspect ratio (no stretching or cropping)
- Preserves rounded corners and glow via RGBA transparency
- Uses LANCZOS resampling (highest quality)
- Generates all PNG derivatives and `favicon.ico`
- Fails clearly if either master is missing
- Prints a complete generated-assets report
- Is safe to rerun (overwrites existing derivatives)

---

## Regeneration instructions

If the master PNGs are ever updated with approved replacements:

1. Replace `assets/brand/sutra/sutra-app-icon-master.png` and/or `assets/brand/sutra/sutra-assistant-icon-master.png` with the new approved files.
2. Run: `python scripts/generate-sutra-brand-assets.py`
3. Run: `node scripts/sutra-brand-assets-check.mjs`
4. Run: `node scripts/smoke-check.mjs`
5. Run: `node scripts/sutra-rebrand-check.mjs`
6. Verify visually at the breakpoints documented in `docs/MOBILE_AND_RESPONSIVE_BEHAVIOR.md`.
7. Commit the new masters and all regenerated derivatives together.

---

## Stale-brand verification

Run `node scripts/sutra-rebrand-check.mjs` to check that:

- No public-facing UI copy still says "NoteFlow Atelier", "Flow Assistant", "Flow Intelligence", "Ask Flow", "Daily Brief", "Plan My Day", "Next Best Action", or "Workspace Modes"
- The Sutra identity (`Sutra`, `Sutra Assistant`, `Powered by Sutra Intelligence`) is present in the expected places

Run `node scripts/sutra-brand-assets-check.mjs` to verify:

- Both canonical masters exist
- All generated derivatives exist
- `favicon.ico` exists
- HTML entry points reference the PNG favicon (not the old SVG)
- No old `assets/sutra-favicon.svg` reference survives

---

## Intentional legacy references

The following identifiers are **intentionally retained** for backwards compatibility. Do not remove them:

| Identifier | Type | Reason |
|---|---|---|
| `noteflow_atelier_db` | IndexedDB name | Legacy-named compatibility — browser data uses this key |
| `noteflow_attachments_db` | IndexedDB name | Same |
| `noteflow_atelier_project` | Export manifest format | Accepted on `.atelier` import |
| `noteflow_atelier_css` | CSS export format | Accepted on CSS snippet import |
| `window.flowAssistant` | JS global alias | Legacy plugins and scripts |
| `window.flowIntelligence` | JS global alias | Same |
| `window.flowAtelier` | JS global alias | Same |
| `?atelierSafeMode=1` | URL param | Legacy Safe Mode link support |
| `.atelier` import | File extension | All old backups must still import |
| `NoteFlow Classic` | Product name | Separate legacy app — not affected by rebrand |

These are described in full in `docs/REBRAND_AND_COMPATIBILITY.md`.
