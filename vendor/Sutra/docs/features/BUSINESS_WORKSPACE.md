# Business workspace

Business is an optional, local-first work pack. Its canonical durable state is
the single `businessWorkspace` payload, containing projects, clients,
invoices, finance rows, opportunities, meetings, proposals, tasks, documents,
goals, notes, and activity. It does not create a separate browser store.

## Operating workflow

The overview gives a small operational picture, while every record can open in
the detail panel with its linked project/client context. Quick actions create
canonical records and meetings can schedule through the existing Timeline
bridge.

**Run the business** is a deterministic, local queue rather than another task
list. It ranks existing overdue and near-term deadlines first, then active
projects with a low health score. A queue item opens its source record; business
tasks may also be completed directly. The queue is derived on every render and
never persists, syncs, or exports as independent state.

## Privacy and portability

Business data lives inside the regular workspace payload. It is covered by the
persistence inventory, encrypted `.sutra` exports, local restore, and the
existing field-level Sutra Sync projection. There are no automatic network
requests or provider credentials in the Business pack.
