# Workspace Entity Registry

The Workspace Entity Registry is Sutra's canonical, local-only contract for
describing records that can be found, opened, or acted on across feature
boundaries.

It does **not** replace `appData`, Homework storage, feature workspaces, or any
other canonical store. It persists no records and owns no user data.

## Runtime pieces

- `src/domain/workspace-entity-registry.js` is a DOM-free, dual-mode registry.
  It normalizes entity descriptors, resolves stable `type:id` references,
  delegates exact open/actions, isolates adapter failures, and publishes
  invalidation revisions.
- `src/features/workspace/workspace-entity-adapters.js` maps live canonical
  Sutra records into that contract. It reads the existing `flowAtelier` bridge
  and a transient sensitive-stripped sync projection for fields not currently
  exposed there, then delegates changes to existing canonical feature APIs.
- `window.SutraWorkspaceEntityRegistry` is the registered cross-feature API.

The projection excludes credentials and sync operations. Settings and UI state
are not registered as entities. Adapters must never mutate the transient
snapshot or records returned by an existing bridge.

## Entity contract

Every normalized descriptor includes:

- `key`: stable `<type>:<id>` reference;
- `type` and canonical `id`;
- `title`, searchable `text`, and `keywords`;
- optional `courseId`, `parentKey`, status, and dates;
- an exact `deepLink` description;
- bounded, credential-key-stripped metadata;
- factual privacy state (`searchable`, `locked`, `private`, and reason).

Adapters own the existing open/action implementation. The registry exposes only
action descriptors and invokes the adapter when a caller explicitly chooses an
action.

## Privacy and safety

- Locked entities are normalized with a generic locked label and empty
  text/keywords until the established feature reports them unlocked.
- Private-vault documents expose only a locked descriptor and are not
  searchable.
- Credential-shaped metadata keys are removed recursively.
- The registry and adapters make no network requests.
- Derived descriptors and future indexes must never enter workspace exports,
  backups, or Sutra Sync.
- Adapter failures are reported and isolated; one feature cannot break
  collection for the rest of the workspace.

## Adding an entity type

Register one adapter with:

1. a stable lowercase adapter `id`;
2. a synchronous `collect()` that reads the canonical store;
3. an `open()` handler that delegates to the existing exact-open flow;
4. optional actions that delegate to canonical mutation APIs;
5. explicit locked/private behavior;
6. unit coverage and, when applicable, a live bridge assertion.

Do not add a parallel persistence field or copy records into the registry.

## Invalidation

Established feature events invalidate the registry and clear its one-microtask
read cache. The registry also exposes `invalidate()` so later mutation seams can
publish more specific changes. This lets the future universal search index
update incrementally without polling or turning the derived index into
workspace state.
