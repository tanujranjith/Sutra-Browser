# Background reminders — Wave E

Sutra's reminders/digest fire while the app is open (OS notifications via the
Notification API; quiet-hours respected). This wave adds an honest, local-first
path to reminders **when the app is closed** — without any push server.

- **Periodic Background Sync.** When browser notifications are enabled and granted,
  Sutra registers a daily `sutra-daily-reminder` periodic sync. On supporting
  browsers (installed PWA on Chromium), the service worker posts a once-a-day,
  privacy-preserving nudge ("Open Sutra to check today’s plan") — no workspace
  data leaves the device and there is no server. Clicking it focuses/opens Sutra,
  which then shows the real in-app digest.
- **Graceful degradation.** Where Periodic Background Sync isn't available, this is
  a silent no-op; exact due-item OS notifications still fire while open, and the
  existing **`.ics` calendar handoff** remains the cross-device "remind me when
  closed" path.
- `notificationclick` focuses an existing Sutra tab or opens one.

Wiring: `SutraNotifications.registerBackgroundReminders()` (called on permission
grant / when browser notifications are enabled) + `periodicsync` /
`notificationclick` handlers in `sw.js`.

## Verification

`tests/e2e/background-reminders-wave-e.spec.mjs` asserts the registration helper
is exposed and safe, and that the service worker ships the `periodicsync` /
`notificationclick` / `showNotification` handlers with no push subscription.
