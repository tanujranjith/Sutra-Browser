# Share Target and Timeline Scheduling

This document describes the progressive-capture and scheduling adapters that connect operating-system shares and workspace items to Sutra's canonical workflows.

## Web Share Target

Installed hosted PWAs accept a same-origin `POST` to `./share-target`. The service worker parses the multipart request locally and redirects to `Sutra.html` with an opaque pending-share ID. It does not cache the request, contact another origin, or add the content to the workspace.

Temporary payloads use the separate `sutra_share_target_db` IndexedDB database. They expire after 24 hours and are deduplicated by content fingerprint for 10 minutes so operating-system retries do not create repeated previews. The queue is not part of workspace state or any export.

The preview preserves the source title, text, URL, filenames, types, and file bytes. Students must review and may correct the destination before applying. Cancel, backdrop dismissal, and Escape delete the temporary record. A successful apply deletes it only after the canonical destination accepts the payload. A failed apply leaves it available for retry and reports the failure.

Supported intake is text, URL, PNG/JPEG/WebP/GIF images, PDF, plain/Markdown/HTML/CSV/calendar text, DOCX, XLSX, PPTX, ODT, and RTF. Limits are eight files, 20 MB per file, 30 MB combined, and 80,000 text characters. Text destinations route through Quick Capture or Smart Import. Binary document and image apply routes through `SutraDocumentImport.importSharedFiles`; if the runtime adapter is unavailable, the preview remains temporary and reports that the app must finish loading.

The feature is hosted-PWA only because service workers do not run under `file://`. Ordinary local-file startup remains unchanged.

## Timeline scheduling

`SutraTimelineDrag` provides one preview/apply primitive for pointer drag, keyboard/touch Schedule controls, and programmatic scheduling:

- `previewSchedule(item, slot)` normalizes canonical source metadata, finds an existing linked block by stable source ID, and reports conflicts without writing.
- `scheduleItemAt(item, slot)` creates or updates one linked block, awaits the persistence bridge, refreshes affected views, and restores the exact prior block list on failure.
- `rescheduleBlock(id, date, startMinutes)` moves an existing block only when the requested interval is open.
- `undoLastSchedule()` durably restores the previous grouped schedule state.

Blocks preserve source type, source ID/key, course, priority, due date, effort, category, and legacy Homework/task linkage fields. Unknown fields on existing blocks survive linked updates. Semantic title matching is never used for deduplication.

HTML drag-and-drop is enhanced with a real Schedule button for touch and keyboard use; `Alt+S` on an eligible source opens the same editable date/start/duration dialog. The dialog previews conflicts, traps focus, supports Escape, restores focus, and announces success or invalid drops through a live region.

The canonical Timeline array is read through `flowAtelier.timeBlocks`, not `window.timeBlocks`. Durable browser behavior also requires `flowAtelier.flushAppSaveNow` to return the underlying persistence promise.
