# Sutra Desktop design QA

Date: 2026-10-02

Scope: implement the three approved desktop mockups in the existing WinUI/WebView2 app: the unified Sutra header and Browser shell, a live website beside Sutra Notes, and homework/deadline capture. This report assesses that design work. Production signing and the broader release acceptance gates remain documented separately in `docs/SUTRA-DESKTOP-INTEGRATION.md`.

## Findings

No actionable P0, P1, or P2 visual findings remain in the reviewed states. The final comparison includes actual native Windows captures, not a replacement HTML shell or a mock screenshot presented as the app.

## Source visual truth

Approved images, each 1672 × 941 pixels:

- Browser: `C:/Users/tanuj/.codex/generated_images/01a0f974-8a7c-7e93-be2a-b35276d9b774/exec-0365c327-bb92-47b9-a3d5-79e856382566.png`
- Notes: `C:/Users/tanuj/.codex/generated_images/01a0f974-8a7c-7e93-be2a-b35276d9b774/exec-cbe0ed54-79f5-48bb-8b01-bba5123c84d5.png`
- Homework capture: `C:/Users/tanuj/.codex/generated_images/01a0f974-8a7c-7e93-be2a-b35276d9b774/exec-81b68b38-5331-4596-a11a-d41460a394be.png`

## Implementation evidence and normalization

The evidence from this dated review is stored locally under `output/design-qa/` on the authoring workstation. Generated screenshots and browser profiles are ignored by Git and are not included in a fresh checkout. The source-reference paths above are also local to that workstation; this report preserves the earlier review record rather than claiming a new native walkthrough.

| State | Native capture | Viewport / density |
| --- | --- | --- |
| Home after startup, including a previously captured task | `native-home.png` | 1672 × 941 outer window; captured drawable area 1658 × 934 |
| Browser with restored Stanford tab | `native-browser.png` | 1658 × 934 drawable pixels |
| Website beside the real Sutra editor | `native-notes.png` | 1658 × 934; test paragraph remains after switching Home → Browser → Notes |
| Corrected Notes More menu | `native-notes-menu.png` | 1658 × 934 |
| Add to Homework panel | `native-capture.png` | 1658 × 934 |
| Compact Browser | `native-browser-compact.png` | 1120 × 760 outer window; 1106 × 753 drawable pixels |
| Compact Notes after fixes | `native-notes-compact.png` | 1106 × 753; the typed paragraph also survived app restart |

Native screenshot logical dimensions match the returned image pixels; no 2× density conversion was needed. Native window borders account for the small difference from the requested outer size. The raster mockups have no CSS viewport metadata and are treated as 1× design references. Full comparison boards scale each full frame proportionally to at most 836 × 480 pixels; focused boards use original-pixel crops. They do not stretch the implementation to hide differences.

The headless Edge evidence (`notes-overlay.png`, `notes-menu-overlay.png`, `notes-compact-overlay.png`, `workspace-overlay.png`) renders the real vendored frontend plus Browser overlay, with simulated native message transport. Its CSS viewports are respectively 650 × 810, 650 × 810, 390 × 630, and 1650 × 860, at deviceScaleFactor 1. These captures supplement the native evidence; they are not full WinUI screenshots.

### Full comparisons opened and reviewed together

- `compare-browser.png`: approved Browser mockup beside the native Browser.
- `compare-notes.png`: approved Notes split beside the native split.
- `compare-capture.png`: approved homework panel beside the native panel.

### Focused comparisons opened and reviewed together

- `compare-notes-detail.png`: note title, formatting controls, and body content at readable scale.
- `compare-capture-detail.png`: source card, field labels, inputs, difficulty selection, and primary/secondary actions.
- `compare-compact-fix.png`: native compact layout before and after removing duplicate mobile navigation and the overlapping sidebar handle.

### State differences considered before comparison

- The live Stanford website now has different content and photography/video from the mockups. The implementation displays the actual website. It does not reproduce the mockup's website artwork.
- The isolated profile has one restored website tab and a real captured source note. Mockup example tabs, AGI notes, course data, and assignments were not injected into the product.
- Capture was checked while viewing a public page. Its title and host come from that page; the optional class/date/time are initially empty.
- Native Windows controls, the actual Sutra brand asset, and existing Sutra save/export controls are retained. Their differences are described below.

## Comparison history and fixes

| Severity | Earlier finding and evidence | Fix | Post-fix evidence |
| --- | --- | --- | --- |
| P1 | Initial native startup could remain at the loading screen while a detached WebView awaited initialization. | Initialize through a loaded, noninteractive staging host, with timeouts and close cancellation, then reparent to the final host. | Repeated successful native Home startups and restored Browser navigation; `native-home.png`. |
| P2 | The split editor retained full-width toolbar behavior and could hide controls; `native-note-before.png`. | Move the actual toolbar into the editor, keep primary tools visible, relocate secondary tools to the existing More menu, and restore original positions in full-workspace mode. | `native-notes.png`, `compare-notes-detail.png`; one row at the 650px test pane, wrapping at 390px. |
| P2 | Notes More menu extended beyond the left edge of the embedded pane; `native-notes-menu-before.png`. | Clamp its width, position, and available height to the WebView viewport; keep the menu scrollable. | `native-notes-menu.png`, `notes-menu-overlay.png`; automated bounds checks at 650px and 390px. |
| P2 | Hidden upstream navigation still reserved vertical space, and theme controls could inherit light styling. | Reset desktop navigation-height variables and select upstream-authored dark presentation selectors without altering saved settings. | `native-home.png`, `workspace-overlay.png`, dark Notes controls in `native-notes.png`. |
| P2 | Compact Notes displayed Sutra's mobile bottom navigation and a sidebar handle over the title; `native-notes-compact-before.png`. | Hide duplicate mobile navigation in the desktop overlay, strengthen the note-mode sidebar selector, and ellipsize long titles. | `native-notes-compact.png`, `compare-compact-fix.png`; automated hidden-navigation and menu-bounds assertions. |
| P3 | Capture source card lacked a page favicon. | Use the tab's existing cached favicon in the source card. | `native-capture.png`, `compare-capture-detail.png`. |

All visual fixes above were followed by new rendered evidence. The final compact correction affects narrow layouts; the prior wide captures remain representative and were also followed by a successful maximized native inspection.

## Required fidelity surfaces

### Fonts and typography

The Sutra wordmark and note title use a bold Georgia serif treatment, matching the mockups' serif hierarchy. Native labels use Segoe UI; the real editor retains upstream body typography. The final toolbar has legible labels and appropriately smaller icons without clipping. The compact title now truncates with an ellipsis instead of colliding with a drawer button. Native UI text is somewhat denser than the mockup; this is accepted for the existing Windows application. Exact raster-font matching is not claimed.

### Spacing and layout rhythm

The global header, separate 280px website sidebar, compact address toolbar, approximately balanced page/note split, and 400px capture panel follow the approved composition. The source mockup sidebar is slightly wider. Capture labels are stacked above native controls so the date/time pickers remain usable. Both save actions fit at the reference-sized window; the panel scrolls at shorter heights. At compact size, the header becomes one section picker and the note toolbar wraps while preserving access to More. These are intentional desktop/responsive adaptations.

### Colors and visual tokens

Dark navy surfaces, subtle blue-gray borders, pale text, and purple selected tabs/actions are consistent across the native shell and trusted Sutra view. Browser-owned overlay tokens include canvas `#081322`, secondary surface `#0d1b2e`, border `#243650`, and accent `#6252f5`. Purple focus/selection states were checked visually. This is a visual contrast check, not a completed accessibility audit.

### Image quality and asset fidelity

The application, startup surface, header, and installer use Sutra's existing upstream icon assets. They were not redrawn as SVG, CSS, text, or emoji. The authentic transparent S mark differs from the white tile in the generated mockups; using the real brand asset is intentional. Website favicons come from the existing WebView2 favicon cache. Stanford's favicon has limited source resolution and is slightly soft when enlarged in capture. Live website media is expected to change. No website imagery is used to impersonate a live page.

### Copy and app content

The header uses Home, Homework, Create, Timeline, Review & Tests, College, Life, Sutra Assistant, and Browser. Sidebar actions use Add to Notes, Create Homework, Add Deadline, Save Source, Open beside Note, and Sutra Assistant. Capture uses “Review the details before saving.” The mockup's hard-coded demo content and shortcut badges are not represented as supported bindings. Source URL/title capture and the real editor were checked. Sutra's existing save/import/export controls remain visible and functional rather than being replaced by decorative mock controls.

## Interaction and verification evidence

- Native Windows, isolated local test profile: Home startup; Browser tab restored after restart; section navigation; opening/closing Notes split; opening More; homework panel layout; compact section picker; note text entered with the keyboard and retained after navigation and restart.
- Debug x64 solution build: passed, zero errors. Release installer build: passed.
- .NET tests: 298 passed (220 Core, 54 Data, 15 AI, 9 Windows).
- Latest full headless Edge run: eight passed, including compact navigation suppression and overflow bounds. Capture, durable reload, origin isolation, PDF preservation, and element-picker checks also passed.
- The frontend test suite simulates WebView2 message transport; it does not prove every native IPC or installer path. No blanket “console clean” claim is made; this pass did not add a comprehensive upstream console-error audit.
- Root `SutraBrowserSetup.exe`: 111,669,474 bytes; SHA-256 `19D4E46126730D1FD2F3374E09561DA11EE6AE6FCC5ED4BBCCE8A9481B559537`. Authenticode status: `NotSigned`. Signed automatic updates remain disabled for this development build.
- No production release was published and no upstream Sutra file was changed during this design pass.

## Open questions and follow-up polish

- P3: a future native control-template pass could make input borders, class selection, and icon sizing even closer to the generated mockups.
- Keyboard-only navigation, screen readers, multiple DPI settings, full installation/upgrade/uninstall acceptance, missing WebView2 runtime behavior, and signed release/rollback verification remain separate release checks.
- Upstream `check:all` remains gated by the pinned source's existing runtime-size budget failure, as recorded in the integration document. No upstream budget was changed.

## Implementation checklist

- [x] Shared Sutra desktop navigation and distinct website-tab navigation.
- [x] Navy/purple shell, authentic Sutra branding, and compact Browser controls.
- [x] Live website beside the actual Sutra Notes editor.
- [x] Homework/deadline capture panel with source context and durable save acknowledgment.
- [x] Wide and compact layout corrections, with post-fix screenshots.
- [x] Automated regression checks and native edit-persistence smoke checks.
- [x] Rebuilt root installer and documented production limitations.

final result: passed
