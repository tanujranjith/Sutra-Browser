# Sutra Plugin SDK

> **Status: experimental / developer feature.** Local Plugins are intentionally
> de-emphasized in Sutra and are **off by default**. They are *not* part of the
> normal Customization screen — a user must opt in under **Settings ▸ Advanced ▸
> Developer / Experimental → Local Plugins (Experimental)** to reveal the controls,
> and the surface is never shown during onboarding. This document is developer /
> experimental reference material. For the user-facing appearance layer, see the
> [CSS Mods Guide](CSS_MODS_GUIDE.md) instead — CSS Overrides never run code.

Sutra plugins are **portable, local JSON files** — exported with the **`.sutra-plugin`**
extension (the legacy **`.atelier-plugin`** extension still imports). There is no
build step, no npm, no remote loader, and no marketplace — a plugin is a single JSON
document you can author by hand and share as a file.

This document is the reference for the bundle format, the permission model, the
sandboxed runtime, and the lifecycle.

> The runtime host API object is named `atelier` for compatibility — it is a code
> identifier, not brand text, and existing plugins keep working unchanged.

## File format

A `.sutra-plugin` (or legacy `.atelier-plugin`) file is a JSON object:

```json
{
  "schemaVersion": 1,
  "id": "example.study-helper",
  "name": "Study Helper",
  "version": "1.0.0",
  "description": "Adds study-related commands and templates.",
  "author": "Example Author",
  "homepage": "",
  "permissions": ["ui.commands", "notes.create"],
  "contributions": {
    "commands": [],
    "sidebarItems": [],
    "tabItems": [],
    "quickActions": [],
    "noteTemplates": [],
    "settings": [],
    "styles": ""
  },
  "runtime": { "type": "none", "code": "" }
}
```

### Required fields

| Field | Rules |
| --- | --- |
| `schemaVersion` | Must be `1`. Newer versions are rejected by older Sutra builds. |
| `id` | `^[a-z0-9]([a-z0-9._-]{1,62})[a-z0-9]$` (e.g. `example.study-helper`). |
| `name` | Non-empty; HTML-significant characters are stripped on load. |
| `version` | Semver-like, e.g. `1.0.0`. |

Bundles are capped at **512 KB** (runtime code at **256 KB**). Labels and URLs are
sanitized; `javascript:`/`data:` URLs are rejected.

## Declarative contributions

Prefer declarative contributions — they need **no runtime code** and are the safest,
most portable way to extend Sutra.

| Contribution | Permission | Notes |
| --- | --- | --- |
| `commands[]` | `ui.commands` | `{ id, label, hint, action }` — appear in the Command Palette. |
| `sidebarItems[]` | `ui.sidebar` | `{ id, label, icon, action }`. |
| `tabItems[]` | `ui.tabs` | `{ id, label, action }`. |
| `quickActions[]` | `ui.quickActions` | `{ id, label, action }`. |
| `noteTemplates[]` | — | `{ id, name, icon, content }` (sanitized HTML). |
| `styles` | `ui.styles` | A CSS string, injected and attributed to the plugin. |
| `settings[]` | — | `{ key, label, type }` constrained fields. |

### Command `action` verbs (no runtime needed)

A command/quick action's `action` string maps to a safe built-in:

- `navigate:<view>` — switch views (e.g. `navigate:today`, `navigate:cramhub`).
- `newNote` — open the new-note flow.
- `template:<templateId>` — new note from a template.
- `addTask` — open the task modal.

The bundled example, [`examples/plugins/study-helper.atelier-plugin`](../../examples/plugins/study-helper.atelier-plugin),
uses only declarative contributions and these verbs.

## Permission model

Permissions are an allowlist; the host enforces each one. Broad read/write
capabilities are flagged higher-risk in the install dialog.

| Permission | Risk | Grants |
| --- | --- | --- |
| `ui.commands` | low | Add Command Palette commands |
| `ui.sidebar` | low | Add sidebar items |
| `ui.tabs` | low | Add tab / overflow items |
| `ui.quickActions` | low | Add quick actions |
| `ui.styles` | medium | Apply plugin styles |
| `notes.readCurrent` | medium | Read the current note |
| `notes.create` | medium | Create notes |
| `notes.writeCurrent` | high | Modify the current note |
| `tasks.read` | medium | Read the task list |
| `tasks.create` | medium | Create tasks |
| `timeline.read` | medium | Read timeline entries |
| `timeline.create` | medium | Create timeline blocks |
| `navigation` | low | Switch views |
| `storage.local` | low | Store the plugin's own JSON |

There is intentionally **no `workspace.readAll`** broad-read permission.

## Sandboxed runtime

When `runtime.type` is `sandboxed-script` and `runtime.code` is non-empty, the code
runs **only** inside an isolated iframe:

- `sandbox="allow-scripts"` — **never** `allow-same-origin`.
- CSP `default-src 'none'; script-src 'unsafe-inline'; connect-src 'none'; img-src data:` —
  **no network** (no fetch/XHR/WebSocket), no host DOM, no host storage, no cookies.
- The iframe is hidden and offscreen.

Plugin code receives a constrained `atelier` API and talks to the host over a
validated `postMessage` bridge:

```js
// runtime.code runs as:  function (atelier) { … }
atelier.registerCommand({ id, label, hint, action });
atelier.navigate('today');
const note = await atelier.readCurrentNote();      // needs notes.readCurrent
await atelier.createNote({ title, content });      // needs notes.create
await atelier.createTask({ title, due });          // needs tasks.create
const tasks = await atelier.listTasks();           // needs tasks.read
await atelier.storageSet('key', value);            // needs storage.local
const v = await atelier.storageGet('key');
atelier.toast('Hello from my plugin');
```

Every bridge message is checked for: correct shape, matching plugin id, a fresh
**unguessable session token**, the right `event.source` window, an **operation
allowlist**, and the relevant **permission grant**. The host never invokes functions
by arbitrary string name, and uses **no `eval` and no `new Function`**. Plugin-created
notes/tasks/timeline blocks go through Sutra's normal stores — never a parallel one.

## Lifecycle

1. **Import** — parsed, size-checked, validated, sanitized; a review dialog lists
   permissions and features. Installs **disabled**.
2. **Enable** — declarative contributions are applied; runtime plugins are mounted
   in their sandbox.
3. **Disable / Uninstall** — styles, commands, sidebar/tab items, quick actions,
   templates, runtime listeners, and the sandbox iframe are removed immediately;
   affected UI re-renders. Plugin-local data is kept or deleted per your choice.
4. **Failure isolation** — if a plugin throws during init, only that plugin is
   disabled for the session and its error is recorded; Sutra and other plugins keep
   working.
5. **Restore re-review** — after JSON / `.sutra` (or legacy `.atelier`) import on a
   new device, every runtime plugin returns **disabled with `reviewRequired: true`**.
   It cannot run until you **Review & trust** and enable it again.

## Minimal example

```json
{
  "schemaVersion": 1,
  "id": "example.hello",
  "name": "Hello",
  "version": "1.0.0",
  "permissions": ["ui.commands", "navigation"],
  "contributions": {
    "commands": [
      { "id": "go-today", "label": "Hello: Go to Today", "action": "navigate:today" }
    ]
  },
  "runtime": { "type": "none", "code": "" }
}
```

Save as `hello.sutra-plugin` (or the legacy `hello.atelier-plugin`), then
**Settings ▸ Customization ▸ Plugins ▸ Import plugin…**.
