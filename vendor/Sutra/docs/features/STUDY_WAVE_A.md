# Study upgrades — Wave A

## Automated exam-readiness predictor (AP Study)

AP Study's "% ready" was a manual slider. It now shows a **computed suggestion**
(`computeSuggestedReadiness`) derived deterministically from local data:

- unit **review progress** (`calculateSubjectProgress`),
- recent **practice scores** (avg of the last 5 logs),
- self-rated **confidence**, and
- a **weak-area** penalty.

The Readiness panel shows "Suggested: N%" with a one-click **Use N%** button and a
breakdown tooltip. The slider stays user-overridable. Exposed for tests as
`window.computeSuggestedExamReadiness(subjectId)`.

## Image cards + image occlusion

The review card editor now supports **images**:

- **Upload** (file picker) or **paste** an image directly into the card form;
  images are downscaled to ≤1200px JPEG data URLs so cards stay backup-friendly.
- **Hide until flip** (image occlusion): when enabled, the image is blurred and
  covered on the card front and revealed on the back — ideal for labelling
  diagrams, maps, and anatomy.

New card fields `imageUrl` / `occludeImage` round-trip with the rest of the deck.
(Region-level occlusion masks are a possible future enhancement; this ships
whole-image occlusion.)

## Verification

`tests/e2e/study-wave-a.spec.mjs` checks the predictor is wired + null-safe, that
cards persist an image + occlude flag, and that the editor ships the image
controls.
