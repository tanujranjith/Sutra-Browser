# Atelier icon system

A fully offline, vanilla-JS icon library for NoteFlow Atelier. No CDN, no font
files, no React dependency. Every glyph is a stroke-based 24×24 SVG drawn in a
shared Apple-leaning visual language.

## Files

- `icon-paths.js` — defines `window.AtelierIconRegistry`, the canonical icon
  catalog plus a Font Awesome → Atelier alias map.
- `index.js` — defines `window.AtelierIcons`, the runtime that hydrates any
  `<i class="fa-...">` element into an inline `<svg>` and watches for new
  ones via `MutationObserver`.

Both files load via `<script defer>` from `Sutra.html` so they
populate before the rest of the app boots.

## How it works

The codebase has thousands of legacy `<i class="fas fa-bolt"></i>` references
emitted via `innerHTML` templates. Rather than rewrite every call site, the
hydrator reads each `<i>`'s `fa-*` class and injects the matching local SVG.
Once an element is hydrated it's marked with `data-atelier-icon="1"`; the
observer reruns when classes change so toggling icons (e.g. `fa-play` ↔
`fa-pause`) keeps working.

## Adding a new icon

1. Open `icon-paths.js`. Add an entry to `ATELIER_ICON_PATHS` with a kebab-case
   key. The value is the inner markup of an SVG drawn on a 24×24 viewBox.
2. Stick to the visual rules:
   - Stroke-based, `fill="none"`. Use `fill="currentColor"` only for glyphs
     that are conceptually filled (star, medal pellet, etc.).
   - Round caps and joins are inherited from the wrapper, so don't repeat them.
   - Default stroke width is 1.75; only override per-element when needed.
   - Inherit color via `currentColor`. Never hardcode a color.
   - Keep weight comparable to the rest of the set; avoid micro-detail that
     vanishes below 16 px.
3. If the icon should map to a Font Awesome name used in the codebase, add a
   line to `FA_TO_ATELIER` so `<i class="fa-yourthing">` hydrates correctly.
4. (Optional) Expose a friendly factory in `index.js` `buildNamedFactories`
   if you want `AtelierIcons.MyThingIcon({ size: 18 })`.

## Using icons from JS

```js
// Inline SVG string for templates.
const html = AtelierIcons.getIconSvg('check-circle', { size: 18, ariaLabel: 'Done' });

// Live HTMLElement.
const el = AtelierIcons.HomeIcon({ size: 20, ariaLabel: 'Home' });
button.appendChild(el);

// Hydrate a chunk of newly-rendered HTML manually.
AtelierIcons.hydrate(container);
```

Decorative icons inside icon-only buttons should keep an `aria-label` on the
button itself; the SVG will be marked `aria-hidden`. Icons with semantic
meaning of their own can pass `ariaLabel`.

## Offline guarantee

There are zero network references in this folder. The hydrator never fetches
anything. Run the app with the network disabled — every icon still renders.
If you add a new icon, do not introduce remote URLs; paste the SVG path data
directly into `icon-paths.js`.
