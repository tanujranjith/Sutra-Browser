# Sutra — Landing Page & Thread Scrollytelling

The landing page (`HomePage.html`) tells the Sutra story: scattered schoolwork is gradually **threaded together** into one calm workspace. The centerpiece is a scroll-linked "thread story" that evolves the page's problem section — a single continuous thread drawing through scattered workflow fragments as they settle, leading into the dashboard reveal.

This is **one** scrollytelling system, not two — the thread animation is layered onto the existing `#story` problem section rather than added as a separate section.

## Narrative sequence

```
Hero  →  Thread story (#story: fragments → continuous thread → settle)
      →  Solution reveal (dashboard image + annotation chips)
      →  Guided workspace tour  →  bento grid  →  Privacy  →  Founder  →  CTA
```

## Section structure

```html
<section id="story" class="problem-section" data-sutra-component="thread-story">
  <div class="problem-sticky">
    <div class="problem-grid container">
      <div class="problem-copy"> … eyebrow / heading / body … </div>
      <div class="problem-cluster" data-sutra-component="thread-stage">
        <svg class="sutra-thread-svg" viewBox="0 0 1200 760">
          <defs><linearGradient id="sutraThreadGradient">…</linearGradient></defs>
          <path class="sutra-thread-path" data-sutra-component="thread-path" data-thread-path d="…" />
        </svg>
        <span class="frag" data-sutra-component="thread-fragment" data-sutra-thread-node="notes">…</span>
        … assignments, timeline, tasks, ap-study, review, focus, radar …
      </div>
    </div>
  </div>
</section>
```

## How the animation works

A single CSS custom property, `--p` (0 → 1), drives the whole section. It is computed from the section's position in the viewport:

```js
function sectionProgress(section) {
  const rect = section.getBoundingClientRect();   // viewport-relative — scroller-agnostic
  const range = rect.height - window.innerHeight;
  if (range <= 0) return rect.top <= 0 ? 1 : 0;
  return Math.min(1, Math.max(0, -rect.top / range));
}
```

- **Fragments converge.** Each `.frag` is offset by `--fx/--fy/--fr` scaled by `--scatter: calc(1 - var(--p))`. At `--p = 0` the cards are scattered; at `--p = 1` they settle to center. As `--p` rises, each fragment also gains a node glow (`.frag::after`, opacity scales with `--p`).
- **The thread draws.** The continuous SVG path is revealed with `stroke-dasharray` / `stroke-dashoffset`, measured once with `getTotalLength()` and updated each frame:

  ```js
  const tp = Math.min(1, sectionProgress(problemSection) / 0.5); // thread leads the cards slightly
  threadPath.style.strokeDashoffset = (threadLen * (1 - tp)).toFixed(1);
  ```

- **Throttled with `requestAnimationFrame`.** Scroll/resize listeners schedule a single rAF; the body is the scroller, so listeners use `{ passive: true, capture: true }`.

### Phase reference (by `--p`)

| Progress | What happens |
|---|---|
| 0.00 → ~0.30 | Fragmentation — cards scattered, thread barely drawn |
| ~0.30 → ~0.70 | Connection — thread draws through the scene, cards begin settling + glowing |
| ~0.70 → 1.00 | Convergence — cards centered, thread fully drawn, glow at full |
| (next section) | Solution reveal — dashboard image clips/scales in, annotation chips fade |

## Stable CSS hooks

| Hook | Element |
|---|---|
| `data-sutra-component="thread-story"` | the `#story` section |
| `data-sutra-component="thread-stage"` | the fragment cluster |
| `data-sutra-component="thread-path"` / `data-thread-path` | the continuous SVG path |
| `data-sutra-component="thread-fragment"` | each workflow card |
| `data-sutra-thread-node="…"` | `notes`, `assignments`, `timeline`, `tasks`, `ap-study`, `review`, `focus`, `radar` |
| `#sutraThreadGradient` | the thread stroke gradient |
| `data-thread-eyebrow` / `data-thread-heading` / `data-thread-body` | the copy block |

## Desktop behavior

Full sticky sequence: thread draws progressively, cards settle and glow, then the solution section reveals the dashboard. Whitespace and copy stay readable; reverse scrolling re-animates smoothly; behavior is stable after resize (the path length is re-measured lazily).

## Tablet behavior

The sticky sequence still runs (tablets are above the mobile breakpoint). Reduced scatter distances and fewer overlaps keep cards readable in both orientations; no edge clipping or horizontal scroll.

## Mobile fallback (≤ 760px)

The desktop SVG weave is **hidden** (`.sutra-thread-svg { display: none }`). The cluster switches to a vertical column and a **simple vertical thread** (`.problem-cluster::before`, a gradient line) connects the stacked fragments top-to-bottom. The story reads in normal document flow — no pinned dead zones, no hover dependence, no scroll-jacking, no horizontal overflow, and far less GPU cost.

```
Notes │ Assignments │ Timeline │ Tasks │ AP Study │ Review │ Focus │ Deadline Radar
```

## Reduced-motion fallback

Under `@media (prefers-reduced-motion: reduce)` the tall pinned sections collapse (`.problem-section, .reveal-section { min-height: 0 }`) and the scroll-linked JS returns early. Users see the **final connected state**: fragments organized, thread fully drawn, dashboard revealed — no scroll-linked transforms, no dead scroll space.

## No-JavaScript fallback

Everything degrades to a readable end state without JS:
- `.problem-cluster` defaults to `--p: 1` (converged), so fragments are organized.
- The thread path has no `stroke-dasharray` set until JS runs, so it renders **fully drawn**.
- The dashboard reveal frame defaults to `--p: 1` (fully shown).

No blank scroll space, no fragments stranded offscreen, no hidden thread.

## Performance notes

- One sticky section, one SVG overlay, one continuous path.
- `getTotalLength()` is called once and cached; per-frame work is a single `strokeDashoffset` write plus a couple of `setProperty` calls.
- No external animation library (no GSAP / Locomotive). The ambient hero canvas pauses when the tab is hidden (`visibilitychange`).

## Testing checklist

- `node scripts/smoke-check.mjs` asserts the thread hooks, nodes, gradient, draw logic, and mobile fallback exist.
- Manually verify on desktop: thread draws on scroll, reverses smoothly, survives resize, no console errors, no horizontal scrollbar, `#story` anchor lands correctly.
- Verify phone portrait/landscape + narrow (320px): vertical thread shows, no overflow, natural touch scroll.
- Verify reduced-motion and JS-disabled: final connected state visible, no dead zones.

## Customizing

- Restyle fragments via `.frag` / `[data-sutra-thread-node]`.
- Tune the thread with `.sutra-thread-path` (`stroke-width`, the `drop-shadow` glow, or the `#sutraThreadGradient` stops).
- See `docs/CSS_MODS_GUIDE.md` for safe copy-paste examples (e.g., reducing the thread glow).
