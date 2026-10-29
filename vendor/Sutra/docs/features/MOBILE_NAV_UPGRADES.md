# Mobile navigation upgrades

Native-feel navigation on phones (≤ 640px), layered on top of the existing
responsive design. Implemented as a self-contained module
(`src/features/workspace/mobile-nav.js`, `window.SutraMobileNav`) that reuses the
app's existing view-switch handlers — no changes to the core view router.

## Bottom tab bar

A fixed bottom navigation bar appears on phones, built from the enabled top
`.view-tab` buttons (so it always reflects the active Sutra Mode). Up to 5 items;
if more views are enabled, the last slot becomes **More**, which opens the
existing mobile view dropdown. Tapping an item switches the view (and the active
item tracks the current view via the `noteflow:view-changed` event). The central
Capture action uses the same canonical Quick Capture flow. On the dedicated mobile
Today shell, the bar becomes an even five-slot dock and the advanced Assistant
launcher moves out of the reading path; Assistant remains available from **More**.

## Swipe between views

A horizontal swipe on the page moves to the adjacent enabled view (left = next,
right = previous). Gestures starting inside the editor, canvas, inputs, modals,
review cards, or the nav itself are ignored so they don't fight real scrolling or
text selection.

## Pull-to-refresh

Pulling down at the top of a view re-renders the current view. Useful after data
changes elsewhere.

## Haptics & accessibility

Taps and gestures trigger a light `navigator.vibrate(8)` where supported, and
vibration is suppressed under `prefers-reduced-motion`. The bar is desktop-hidden,
uses 44px minimum touch targets, and respects `env(safe-area-inset-bottom)`.

## Verification

`tests/e2e/mobile-nav.spec.mjs` checks the bar is visible with items on a phone
viewport, that tapping an item switches the active view, that the active item
tracks the current view, and that the bar is hidden on desktop.
