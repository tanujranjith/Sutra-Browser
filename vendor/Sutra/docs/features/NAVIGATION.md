# Workspace Navigation

Sutra uses one canonical set of `.view-tab[data-view]` controls for workspace routing. Desktop overflow, custom dashboards, and the phone navigation delegate to those controls; they must not maintain a competing destination registry.

## Desktop hierarchy

The desktop strip keeps the student daily loop directly visible when space permits:

- Home
- Homework
- Create
- Timeline
- Review & Tests
- Settings

Optional packs and secondary destinations use the grouped **More** menu. Groups appear only when they contain a visible destination:

- **Daily loop** and **Learning** appear when a narrow desktop moves a core destination into overflow.
- **Workspace** contains enabled College, Life, and Business packs.
- **My dashboards** contains custom dashboards that no longer fit in the strip.
- **Tools** contains enabled utilities such as Assistant and Settings when they overflow.

An active secondary destination is reflected in the More trigger label and `aria-label`, so location remains clear even when its direct tab is hidden. Home and Settings are protected from geometric overflow; optional chrome compacts before the daily loop is reduced.

Custom dashboard buttons remain direct while they fit. Overflow entries are generated from their canonical buttons after every custom-tab rebuild, and route through the existing custom-tab click bridge.

## Contextual workspace shell

The top navigation is the only permanent desktop navigation chrome. Secondary navigation is registered by section through `SutraContextualShell`:

- Create owns the contextual page tree and preserves its established collapsed/drawer state.
- Home, Homework, Timeline, Review & Tests, Courses, Settings, optional packs, and custom dashboards use the full workspace by default.
- A future section may add its own contextual sidebar only when the navigation is genuinely section-specific. It must register with the shell rather than reuse or arbitrarily hide the Create tree.

This keeps the hierarchy consistent: global navigation, then section controls, then primary content. Route-specific actions stay in their section toolbars; global utilities stay in the top shell.

## Keyboard behavior

- Left/Right moves across visible top-level navigation controls.
- Home/End moves to the first/last visible top-level control.
- Enter or Space opens More and moves focus to the current or first visible item.
- Up/Down and Home/End move within the More menu.
- Escape closes More and restores focus to its trigger.

## Phone behavior

At phone widths (up to 640px), the top strip is replaced by the existing unified bottom navigation and **All sections** sheet. The 641px tablet boundary keeps the adaptive top strip visible, so there is no navigation dead zone between the two surfaces. The sheet remains derived from enabled canonical view tabs, owns its modal focus/history behavior, and exposes contextual actions. **Pages** appears only while Create is active; New dashboard and Notifications remain global. See [MOBILE_NAV_UPGRADES.md](MOBILE_NAV_UPGRADES.md) for the detailed phone contract.

## Implementation map

- Markup and the grouped desktop menu: `Sutra.html`
- Canonical routing, adaptive overflow, active-state synchronization: `src/core/app.js`
- Contextual sidebar registration and Create toolbar progressive disclosure: `src/features/workspace/contextual-shell.js`
- Phone navigation and All sections sheet: `src/features/workspace/mobile-nav.js`
- Desktop styling: `styles/base/styles.css` and `styles/views/contextual-shell.css`
- Behavioral coverage: `tests/e2e/navigation-clarity.spec.mjs` and `tests/e2e/mobile-nav.spec.mjs`

Deep links and contextual actions must continue to call `setActiveView(...)` or dispatch the canonical tab click path. New top-level destinations should be exceptional and must define their progressive-disclosure behavior without duplicating navigation state.
