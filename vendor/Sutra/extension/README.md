# Sutra LMS Capture (browser extension)

Captures assignments from Canvas (or any LMS page with assignment links) and
hands them to Sutra's existing review-and-import modal. Chrome/Edge, Manifest V3.

## What it does

1. You open your LMS and click the extension → **Capture assignments from this page**.
   - On **Canvas** (any `*.instructure.com` or school Canvas domain), it calls
     Canvas's own `/api/v1` endpoints with your existing session — active
     courses, then upcoming/overdue/undated assignments per course. No scraping
     fragility, real due timestamps, and a link back to every assignment.
   - On anything else, it falls back to scanning visible assignment links
     (same heuristic as Sutra's bookmarklet).
2. **Send to Sutra** opens/focuses your Sutra tab; the payload is posted into
   the page and Sutra opens the normal import preview — dedupe, due-date
   change detection ("Due changed — will update"), class mapping, skip
   checkboxes. Nothing is written until you click Import.
3. **Copy** is the fallback for a Sutra hosted at a custom address: paste into
   Command palette → *Import homework (paste)…*.

## Privacy

- Runs only when clicked (`activeTab`) — no standing access to your LMS.
- No network calls of its own; the Canvas API calls go from your LMS tab to
  your LMS, with your session, like the page itself does.
- The captured text moves LMS tab → extension storage → Sutra tab on this
  device, then is deleted (or expires after 10 minutes).

## Install (unpacked)

1. Chrome/Edge → `chrome://extensions` → enable **Developer mode**.
2. **Load unpacked** → select this `extension/` folder.
3. Optional: extension Options → set your Sutra address
   (defaults to `https://tanujranjith.github.io/Sutra/Sutra.html`).

## Files

- `manifest.json` — MV3; `activeTab`+`scripting` for capture, content script
  only on Sutra origins (official site + localhost).
- `popup.html/js` — capture UI; injects `capturePageAssignments()` into the
  active tab; builds the `#sutra-import` pipe format Sutra already parses.
- `sutra-bridge.js` — content script on Sutra origins; delivers the pending
  payload via `window.postMessage`, retries until the app acks, then clears it.
- `options.html/js` — Sutra address for "Send to Sutra".

Sutra-side counterpart: `initSutraLmsCaptureBridge` in `src/core/app.js`
(same-window, same-origin, `#sutra-import`-prefixed text only).
