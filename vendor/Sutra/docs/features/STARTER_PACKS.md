# Starter Packs

Starter Packs set up a whole Sutra workspace in one step. Pick a goal — AP season,
college apps, SAT/ACT prep, a robotics build, senior year, a research project,
freelancing, or a personal life system — preview exactly what it creates, then
apply all of it or just the parts you want. Everything is **local**, and every
applied pack can be **undone** as one batch.

## What a pack can create

| Artifact | Where it lands |
|---|---|
| Notes | Notes / Pages |
| Courses | Course Hub (and a Homework lane) |
| Review decks | Review (with starter cards) |
| Timeline blocks | Timeline / calendar |
| Tasks | Today / Planner |
| College checklist rows | College tracker |

## How to use it

1. Open **Settings → Integrations → Starter Packs**, or use the **Starter Packs**
   button on the All Due empty state.
2. Click a pack to see a **preview** of every artifact it will create, grouped by
   type, each group with a checkbox.
3. Choose **Apply all** or untick groups and choose **Apply selected**.
4. Right after applying you get an **Undo this pack** button that removes the
   whole batch. (Undo is available for the most recent apply in the current
   session.)

## Built-in packs

`AP Student`, `College Apps`, `SAT/ACT Prep`, `TSA Project`, `Robotics Team`,
`Senior Year`, `Research Project`, `Business / Freelancer`, `Personal Life OS`.

## Local-first & privacy

- Packs are **plain local data** in `src/features/workspace/starter-packs.data.js`
  (`window.SUTRA_STARTER_PACKS`). There is **no marketplace** and no network fetch.
- Applying a pack only calls Sutra's existing create functions, so every artifact
  round-trips through `.sutra` backups exactly like hand-made data.
- No secrets are involved; nothing a pack creates is excluded from export.

## Custom packs (import / export)

- **Export custom packs** downloads any packs you've imported as
  `sutra-starter-packs.json` (the same JSON shape as the built-ins).
- **Import custom pack** accepts pasted JSON of one pack or an array of packs.
  Imported packs are stored **device-local** (not in `.sutra`) and appear in the
  browser tagged `custom`.

Pack JSON shape:

```json
{
  "id": "my-pack",
  "name": "My Pack",
  "icon": "📦",
  "description": "What this pack sets up.",
  "artifacts": {
    "courses": [{ "name": "Course", "type": "class", "color": "#7c9cf2" }],
    "notes": [{ "title": "Note", "content": "<h2>Note</h2>" }],
    "decks": [{ "name": "Deck", "subject": "Topic", "cards": [{ "prompt": "Q", "answer": "A" }] }],
    "timeBlocks": [{ "title": "Block", "daysFromNow": 1, "start": "17:00", "end": "18:00", "category": "study" }],
    "tasks": [{ "title": "Task", "daysFromNow": 1, "priority": "high" }],
    "collegeChecklist": [{ "college": "School" }]
  }
}
```

## Developer surface

`window.SutraStarterPacks` exposes `list()`, `getById(id)`, `counts(pack)`,
`apply(packId, selection)` → `{ id, packName, created:[{kind,id,title}] }`,
`undo(batch)` → removed count, plus `open()` / `close()`.

Starter Packs are **separate from plugins** — they are seed data, not code.
