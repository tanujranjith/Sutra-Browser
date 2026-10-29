# Customizable Home dashboard

Home composes existing canonical workspace cards; it does not copy task,
calendar, review, homework, habit, or backup data into a separate dashboard
store. `src/features/workspace/today-dashboard.js` owns only presentation
preferences and reorders the existing DOM nodes after their normal renderers run.

The durable preference lives at `settings.preferences.today.dashboard` and is
therefore included in ordinary workspace persistence, encrypted `.sutra`
backups, restore, and the existing atomic Settings Sync record. Its bounded
contract is:

- `version`: preference schema version.
- `preset`: `calm`, `study`, `everything`, or `custom`.
- `order`: every known widget ID exactly once after normalization.
- `hidden`: a deduplicated allowlist of hidden widget IDs.
- `sizes`: a bounded width choice per widget.

The calm preset keeps the daily loop's Next up, Upcoming Radar, quick task
capture, Priorities, and save-confidence surfaces visible on desktop. Duplicate
deadline and schedule snapshots, secondary signals, and advanced planners remain
available through the Study and Everything presets or Home customization; they
are not deleted. An older saved Calm snapshot migrates to the current
essentials-only composition, while custom layouts retain their explicit choices.
Desktop users can customize from the Home toolbar or More actions menu. The
dedicated phone Home shell remains the canonical compact mobile experience and
is not rearranged by desktop widget preferences.

Reordering uses visible buttons in addition to pointer controls, presets are
real buttons with pressed state, and the modal delegates focus containment,
Escape handling, scroll locking, and focus restoration to `SutraModalManager`.
