# Dashboards — Wave C

## Focus stats dashboard

The focus-session history (recorded automatically when a focus timer completes)
now has a visual home. Open via **Ctrl/⌘+Shift+P → Focus stats** (or
`window.openFocusStatsModal()`):

- **This week / Sessions / Avg session** stat cards.
- **Daily focus — last 14 days** inline-SVG bar chart (`buildSutraBarSvg`).
- **Time by subject — this week** list (from `getFocusStatsBySubject`).

## Grade trends

Each course's grade is plotted **over time** from its dated score entries. Open via
**Ctrl/⌘+Shift+P → Grade trends** (or `window.openGradeTrendsModal()`):

- Per-course cumulative-grade line chart (`buildSutraLineSvg`) with current % and a
  ▲/▼ delta since the first dated entry.
- Computed by `SutraGradePlanner.computeGradeTrend(courseId)` — runs the existing
  deterministic grade engine over each dated-entry prefix, so trends always match
  the planner's own grade math.

Both dashboards render developer-authored inline SVG through `SutraDOMSafety`
(no chart-library dependency).

## Verification

`tests/e2e/dashboards-wave-c.spec.mjs` covers the focus modal (content + chart),
the grade-trend function (null-safe + exposed), the grade-trends modal, and a real
multi-point trend from dated course scores.
