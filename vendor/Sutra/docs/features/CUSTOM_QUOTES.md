# Custom Quotes

Sutra combines its source-audited built-in quote bank with optional quotes that
belong to the workspace. Open **Settings > Appearance > Quotes** or choose
**Manage** beneath the sidebar quote to:

- add, edit, and delete personal quotes;
- use built-in quotes, personal quotes, or both;
- filter the rotation by categories such as motivational, inspirational,
  self-affirmation, love, personal, focus, resilience, and learning; and
- independently show or hide the collection in the sidebar and Custom Tab
  Motivation widgets.

Closing the manager restores keyboard focus to the launcher, including when
opened by a pointer in Safari. The shared modal manager owns this restoration.

The sidebar still selects deterministically for the local calendar day. The
**Another** control advances only the current session and does not create save
or Sync churn. Custom Tab widgets keep their existing per-widget rotation index
but now read from the same filtered collection.

## Persistence and privacy

Custom quote state is stored under `settings.preferences.quotes`:

- `showInSidebar`
- `showInCustomTabs`
- `sourceMode`
- `enabledCategories`
- `customQuotes[]` (`id`, `text`, `author`, `category`, `createdAt`, `updatedAt`)

This is canonical workspace data. It is normalized and bounded to 200 custom
quotes, included in normal local saves and `.sutra` backups, and synchronized
inside the encrypted atomic Settings record. It has no localStorage mirror and
does not make network requests. The decision matrix and nested fields are
recorded in `docs/architecture/persistence-inventory.json`.

Built-in quotes remain static data in `src/data/daily-lock-in-quotes.js`; their
source audit remains `docs/features/DAILY_QUOTES_SOURCE_AUDIT.md`.
