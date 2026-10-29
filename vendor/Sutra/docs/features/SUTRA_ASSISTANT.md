# Sutra Assistant

_Sutra is a private, local-first workspace for students. The local Assistant
experience is available in every fresh workspace; connecting an AI provider is
optional. Sutra Assistant is the part of Sutra that can answer questions, summarize
your work, and propose changes you approve. This document explains exactly what
it does, what stays on your device, and what (only ever) leaves it._

---

## 1. Two distinct things: the Assistant and the Intelligence

It helps to separate two pieces that are easy to conflate.

- **Sutra Assistant** is the **contextual chat panel** — the conversational
  surface you open from the **Sutra Assistant launcher** (the assistant icon
  button at the bottom-right of the screen; also reachable as **Ask Sutra**).
  It is where you type a question, read a reply, and accept or decline proposed
  edits. The launcher and panel header use the dedicated Sutra Assistant icon —
  see [Brand Assets](BRAND_ASSETS.md) for the canonical asset and its usage.

- **Sutra Intelligence** is the **local signal layer** that sits underneath it.
  It reads only your own workspace and derives plain, factual signals:
  **overdue work, workload, schedule conflicts, weak areas, review backlog, and
  next steps**. It is implemented as a single derivation pass
  (`deriveStudentContext`) over your local data. **Sutra Intelligence does not
  call any server itself** — it computes these signals on-device and hands them
  to the Assistant as context.

The mental model: **Sutra Intelligence understands your situation locally; the
Assistant is the conversation, and it only reaches the network when you send a
message to an AI provider you have chosen.**

### Local signals vs. remote provider calls

| | Sutra Intelligence (local signals) | AI provider call (remote) |
|---|---|---|
| Where it runs | In your browser, on your device | On the provider's servers |
| What it touches | Your local workspace only | The text of your request + any context you allow |
| When it happens | Continuously / on demand, no network | Only when you send a message |
| Who you trust | Just yourself | The provider you selected |

Sutra runs **no model servers of its own**. There is no Sutra backend in the
loop. When a reply requires a language model, the request goes **directly from
your browser to the provider you chose**.

---

## 2. The "Powered by Sutra Intelligence" badge

Directly under the Assistant panel header sits a small badge that names the
local signal layer and explains where data goes.

- **Stable hook:** `data-sutra-component="assistant-intelligence-badge"`
- **Title:** **Powered by Sutra Intelligence**
- **Subtitle:** **Local signals from your workspace.**
- **Tooltip / accessible label** (shown on hover, tap, or focus; also the
  badge's `aria-label`):

  > Sutra Intelligence analyzes local workspace signals such as overdue work,
  > workload, schedule conflicts, weak areas, review backlog, and next steps.
  > AI requests are sent only to the provider you choose.

The badge is not decoration — it is the always-present statement of the privacy
boundary. The dynamic context-chip row (which shows what the Assistant can
currently see) anchors directly after the badge.

---

## 3. Workspace Access — how much the Assistant can see

You control how much of your workspace the Assistant is allowed to read when it
builds context for a request. This is the **Workspace Access** setting, with
three levels:

- **Current Screen Only** — the Assistant sees only what is on the screen you
  are looking at right now. The tightest scope.
- **Current Area** — the Assistant sees the feature area you are working in
  (for example, the current notes, the current homework view), not your entire
  workspace.
- **Full Workspace Context** — the Assistant may draw on signals from across
  your whole workspace (notes, tasks, homework, AP Study, Review, and so on),
  by way of Sutra Intelligence's derived signals.

Choose the narrowest level that still lets the Assistant be useful. Whatever you
pick, the context is assembled **locally** first; only the portion needed for
your message is included when a request is sent to your chosen provider.

With local routing enabled, requests such as “search my notes for…” and “what do
my notes say about…” run entirely on-device and return quoted, clickable note
evidence without requiring a provider.

### Selected-text awareness

The Assistant is aware of **text you have selected**. If you highlight a passage
in a note before asking a question, that selection becomes part of the context
for your request — useful for "rewrite this," "explain this," or "turn this into
flashcards." Selection awareness respects your Workspace Access level.

---

## 4. Conversation behavior

### Single Request vs. Conversation Memory

The Assistant has two memory modes:

- **Single Request** — each message is treated on its own. The Assistant does
  not carry prior turns forward. Best when you want clean, independent answers
  and the least context leaving your device per request.
- **Conversation Memory** — the Assistant remembers earlier turns in the current
  conversation so you can follow up naturally ("now make it shorter," "do the
  same for chapter 3").

Visible conversations are saved locally by default so both the docked panel and
full Assistant view share the same chats. You can disable **Save chat history**
or clear chats at any time. Saved chats are included in encrypted Sutra backups
by default; plaintext recovery includes them only when you explicitly enable
that separate option. API keys, hidden prompts, action fences, and provider
reasoning are never stored with chats.

### Suggested Prompts

When you open the panel, **Suggested Prompts** offer ready-made starting points
drawn from your current context, so you do not have to phrase everything from
scratch.

---

## 5. Suggested Actions, Suggested Changes, and applying them

The Assistant does not silently rewrite your workspace. When it wants to change
something, it proposes — you decide.

- **Suggested Actions** — the Assistant can propose concrete actions in your
  workspace (creating a note, adding a task, scheduling a time block, building a
  review deck, and similar).
- **Suggested Changes** — proposed edits are shown as **Apply / Decline cards**.
  Nothing changes until you click **Apply**; **Decline** dismisses the proposal.
- **Missing-payload repair** — if a provider clearly promises a Timeline
  change but omits its structured action payload, Sutra can recover only named,
  concrete dates from the immediately preceding user message and turn them into
  the same review cards. Vague or explicitly uncertain dates are skipped; the
  repair never applies anything by itself.
- **Confirm Before Applying Changes** — a setting that requires an explicit
  confirmation step before any proposed change is written, for an extra guardrail.
- **Insert into Note** — drop the Assistant's response (or generated content)
  directly into the note you are working in.
- **Anchored note edits** — rewrites can carry note, version, block, and
  character anchors. Sutra shows before/after hunks, lets you approve or decline
  each hunk, checkpoints the prior version, and refuses a stale proposal until
  it is rebased or regenerated.
- **Structural note operations** — heading renames, block moves, deduplication,
  and splits use the same anchored hunk review. Merges preserve every source
  note and append provenance links; tag changes, backlinks, and structured-field
  conversions also produce activity receipts and undo snapshots.

Items the Assistant creates — notes, tasks, timeline blocks, homework, review
decks — flow into the same normal stores as anything you make by hand, so they
persist and travel in backups exactly like the rest of your workspace.

### Grounded answers and Sources used

When a question may depend on your notes, Sutra builds a local, chunked index of
unlocked notes and retrieves ranked quoted spans using text, fuzzy, metadata,
backlink, and recency signals. Grounded replies show a **Sources used** panel
with note title, heading path, exact excerpt, update date, confidence, and why
the source matched. Source links open the note directly. Locked-note bodies are
excluded by default; if you explicitly ask about an identified locked page,
Assistant asks for one-time permission and the page PIN before including that
page in the current request. The grant does not unlock the editor, change saved
privacy settings, or authorize later requests. Without that grant, safe metadata
may identify a locked source without quoting or linking its contents.
Context collection also preserves the canonical locked document: the blank
editor privacy surface must never be copied back into the protected note.

The **What Sutra knows about me** view combines readable-note counts, explicit
memories and their source links, current Assistant permissions, and detected
project context. It is a transparency and management view over the same local
Notes Knowledge Core, not a second hidden profile store.

### How this was answered

Pre-send disclosures and every local or provider response include a compact,
keyboard-accessible **How this was answered** receipt. Local receipts say that no
provider was contacted and name the local engine, inspected workspace areas,
referenced object types, and whether saved memory influenced the result. Provider
receipts identify provider/model, Workspace Access, selected text and conversation
inclusion, live-validated source titles and object types, attachment processing
paths, deterministic engines, proposed actions, transmission status, and the
categories sent. Stale or deleted sources render as **Source no longer available**
without a deep link. Receipts never contain credentials, locked-note bodies, raw
prompts, full context, sensitive memory text, or provider reasoning.

A configured OpenAI-compatible localhost endpoint is a model provider for receipt
purposes: its receipt names **Local endpoint** and the model, and reports the
categories sent to that on-device endpoint. It is not mislabeled as a deterministic local answer.

### Context selection and request budgets

Provider context is selected deterministically in this order: explicit targets,
current screen, selected text, linked notes/assignments, course context, due or
active work, enabled relevant memories, then recent conversation when enabled.
Locked sources, disabled/expired memories, secrets, credentials, unrelated areas,
and unnecessary history are excluded. An explicitly requested locked page is the
exception only after the one-time permission and page-PIN flow for that request;
the grant is page-scoped and is not persisted. Model-aware budgets reserve answer capacity
and account for attachments. Oversized structured records are compressed locally
while retaining identifiers, titles, dates, relationships, and source links; Sutra
does not split a record mid-object. The receipt discloses reductions and offers a
control to narrow future context.

### Untrusted material and prompt-injection defense

Notes, attachments, LMS imports, pasted documents, URLs, and provider output are
untrusted data. Sutra fences imported text explicitly, audits the final request for
scope and privacy, blocks unsafe URL schemes and unsafe attachment types, and
sanitizes rendered markup. Untrusted content cannot expand Workspace Access,
select a provider, change security settings, authorize a write, save memory,
initiate backup/sync, or create a non-certified action. Only the certified action
registry can define an action type, and every write still requires its normal
preview and approval.

### Structured tutoring and academic integrity

Provider-connected tutoring modes are **Explain, Hint First, Check My Attempt,
Quiz Me, Diagnose My Mistake, Create Practice, Turn This Into Review Cards, Build
a Study Plan, Compare My Work to a Rubric, Summarize My Notes,** and **Teach From
My Materials**. They reuse the same Notes, Homework, Review, Testing Hub, Course
Hub, Assignment Studio, Timeline, and Focus data. Without a provider, Sutra does
not simulate a free-text tutor; Guided Local Mode offers provider setup and direct
links to local study tools.

Hint First reveals one progressively stronger hint at a time. Check My Attempt
keeps the student's work, identifies the first meaningful error, and suggests the
next correction. Quiz Me asks one question at a time and waits. Mistake diagnosis
classifies conceptual, arithmetic, syntax, or reading errors. Teach From My
Materials lists what it actually used and separates source-grounded claims from
general model knowledge. Likely active assessments receive hints, concept help,
attempt checking, or analogous practice instead of silent completion. Writing help
can outline, revise, organize real sources, and flag unsupported claims, but never
fabricates citations, quotes, interviews, experiments, or data.

### Study-material quality and regeneration

Generated quizzes, practice, cards, and guides run through deterministic checks
for duplicates and near-duplicates, repeated choices, answer leakage, malformed
keys, multiple correct choices, missing explanations, unsupported types, empty or
oversized sections, weak requested-topic coverage, unsafe markup, duplicate cards,
and missing source attribution. A quality report shows coverage, gaps, duplicates,
leakage, explanations, sources, and sections needing regeneration. **Regenerate
this section** changes only the selected generated Testing Hub question, previews
the replacement, reruns validation, supports Stop/Retry, logs Activity, and offers
Undo when authoritative state confirms it is safe.

---

## 6. Assistant Activity + undo

Every change the Assistant **applies** is recorded locally in **Assistant
Activity** — a running log of what was done and when. Each applied action can be
**undone** from the log. The activity log lives entirely on your device. It is
**not a secret**, so it does travel inside your `.sutra` backups (stored under
the key `sutra:activityLog:v1`, migrated from the legacy `flow:activityLog:v1`).

Targets are resolved by stable canonical ID before preview, before receipt/deep
link rendering, immediately before Apply, and before Undo. Deleted or invented
IDs fail closed; renamed objects keep working; same-titled objects remain
distinguishable. A material change after Preview refreshes the preview and renews
confirmation. Batch execution orders dependencies, reports conflicts and partial
failures, rolls back compensating steps where possible, and uses idempotency keys
so Retry cannot duplicate tasks, homework, blocks, note insertions, cards, plans,
or memories. Sutra reports Undo/rollback success only after authoritative state
confirms it.

Multi-step workspace plans use stable step IDs and explicit dependencies that may
reference only earlier steps. The review surface shows those dependencies and
will not apply a dependent step before its prerequisites. Review is intentionally
available before write or destructive permission is granted; Apply performs the
permission check. Every plan preview also binds to a bounded live-target snapshot.
If a referenced task, note, course, deck, or Timeline block changes after review,
the entire plan fails closed as stale before its first mutation and must be
reviewed again.

Canvas and Slides use two high-level typed action pairs rather than exposing raw
page writes: `canvas_create_board` / `canvas_edit_board` and
`slides_create_deck` / `slides_edit_deck`. Edit actions are limited to the
current unlocked surface, stable page/slide/element/object IDs, and at most 24
reviewed operations. Their pure operation engine validates the complete batch
before any mutation, then the owning Canvas or Slides bridge commits through the
canonical page persistence path. Activity keeps field-level, fingerprint-bound
undo data so a later student edit is never silently overwritten. Slides actions
support text, shapes, charts, arrangement, order, notes, theme, and size, but
never remote image fetching or image-element mutation.

---

## 7. Providers, model, and keys

You bring your own AI provider. Sutra supports:

- **OpenAI**
- **Anthropic Claude**
- **Google Gemini**
- **Groq**
- **OpenRouter**
- **NVIDIA NIM**
- **Mistral AI**
- **Together AI**
- **DeepSeek**
- **xAI (Grok)**
- **Perplexity (Sonar)**
- **Custom OpenAI-Compatible Endpoint** (also referred to as the **Local
  endpoint**) — point Sutra at any OpenAI-compatible API, including one you run
  yourself on your own machine or network.

For each provider you choose, you specify the exact **Model ID** to use (the
provider's own model identifier). Your provider, model choices, and the custom
endpoint configuration are **preferences** — they are saved with your workspace
and travel in backups, so a restored workspace keeps its setup.

The setup wizard can test the connection, discover available models, show
detected input capabilities, and explain the provider's cost/privacy boundary
before selection. Local endpoints use the same health/model-discovery step.

Sutra extracts TXT, Markdown, CSV, code, DOCX, PPTX, and XLSX content locally
within bounded limits. Supported models can receive PDFs and images natively.
Optional local integrations may register an on-device OCR or transcription
processor for scans, audio, and video; only the resulting bounded text is sent.
Without such a processor, Sutra blocks unsupported media and recommends a local
TXT/VTT transcript or a compatible model instead of silently dropping the file.

Both Assistant surfaces support cancellation, timeout reporting, retry, stale
chat protection, and offline local routes. If a streaming provider disconnects
after returning text, Sutra saves the partial response with an interruption
label before offering retry rather than discarding what already arrived.

### Durable history, backups, and Sutra Sync

When **Save chat history** is enabled, the visible conversation store is durable
user data. It preserves conversation/message order, ids, roles, content,
timestamps, titles, provider/model labels, claim types, citations/sources,
grounding metadata, memory-used ids, durable action receipts, favorites,
partial-response markers, archive/pin state, and forward-compatible fields.
Creating, updating, emptying, or clearing history participates in the same
confirmed local-save seam as workspace edits.

- Encrypted `.sutra` backups include sanitized visible history by default;
  plaintext JSON includes it only after the user enables the separate plaintext
  recovery option.
- With optional Sutra Sync enabled, durable history is included in the encrypted
  sync projection regardless of the plaintext JSON option. A second device
  restores both the local mirror and the live Assistant runtime/UI; empty
  histories are synchronized as real values rather than ignored.
- An untouched generated blank conversation is not durable user content and is
  reconstructed locally. A user-created empty thread is durable and does sync.
- In-flight requests, streaming buffers, abort controllers, typing indicators,
  temporary diagnostics, hidden prompts/reasoning, raw provider payloads, and
  uncommitted messages never enter backups or sync.

### API keys are session-only by default

Provider **API keys live in this browser session only by default**
(`sessionStorage`). This is the safest mode. You can explicitly choose
“Remember API keys on this device” in Settings ▸ Assistant; remembered keys are
encrypted in the device-local credential vault.

The remembered-credential option protects against casual browser-database
inspection and keeps keys out of exports and Sync. It does not add a separate
passphrase gate and cannot protect a key from malicious code already executing
in Sutra's origin. Session-only storage remains the safer default.

In both modes, keys are:

- **never written to workspace storage** (they are not in localStorage or the
  workspace IndexedDB; remembered keys use a separate encrypted vault),
- **never included in Google Drive sync snapshots** and never uploaded as Sutra
  workspace data,
- **never included in any export** (`.sutra` or JSON) or Sutra Sync operation,
  snapshot, asset, diagnostic, or recovery kit.

Because keys are session-scoped by default, you re-enter your key when you start
a new session or after importing a workspace on a new device. If you opt in to
remembering them, Sutra restores them on that device only. The provider and
model **choices** come back automatically in either mode.

---

## 7a. Getting an API key — step by step (free & paid)

You don't need to pay to use the Sutra Assistant. Several providers have a **free
tier**, and you can also run a model **locally for free**. Paid providers
(OpenAI, Anthropic) generally give the strongest results but require a billing
balance.

### Which to pick

| Provider | Cost | Good for | Where |
|---|---|---|---|
| **Groq** | **Free tier** (fast, generous) | The easiest free start | console.groq.com |
| **Google Gemini** | **Free tier** (generous) | Strong free models | aistudio.google.com |
| **OpenRouter** | Pay-as-you-go, **some free models** | One key, many models | openrouter.ai |
| **Local / Custom endpoint** | **Free** (your hardware) | Fully offline, no key | Ollama / LM Studio |
| **OpenAI** | Paid (add credit) | Top-tier GPT models | platform.openai.com |
| **Anthropic Claude** | Paid (add credit) | Top-tier Claude models | console.anthropic.com |
| **NVIDIA NIM / Mistral / Together AI** | Provider-specific | Hosted open models through OpenAI-compatible APIs | Their provider console |
| **DeepSeek / xAI / Perplexity** | Provider-specific | Text-first assistant chat and approved action proposals | Their provider console |

> Tip: start with **Groq** or **Google Gemini** — both are free and take about two
> minutes to set up.

### Where you paste the key in Sutra

1. Open the Sutra Assistant (the assistant icon button, bottom-right).
2. Click the **provider chip** in the panel header to open **Provider & Model**,
   choose your provider, and enter the exact **Model ID**.
3. Enter the **API key** in **Settings ▸ Assistant ▸ Your API Keys** (one field
   per provider). Session-only storage is the default; the optional encrypted
   vault requires your local secret after restart. Keys and vault envelopes are
   never exported.

---

### Groq — free

1. Go to **https://console.groq.com** and sign in (Google/GitHub or email).
2. Open **API Keys** in the left menu → **Create API Key**, name it (e.g.
   "Sutra"), and **copy** it (you won't be able to see it again).
3. In Sutra: provider **Groq**, paste the key in Settings ▸ Assistant, and set a
   current Groq **Model ID** from the console's model list.

### Google Gemini — free

1. Go to **https://aistudio.google.com** and sign in with a Google account.
2. Click **Get API key** → **Create API key** (you can use a new or existing
   Google Cloud project) and **copy** it.
3. In Sutra: provider **Google Gemini**, paste the key, set a current Gemini
   **Model ID** (shown in AI Studio).

### OpenRouter — free models + pay-as-you-go

1. Go to **https://openrouter.ai** and create an account.
2. Open **Keys** (account menu) → **Create Key** and **copy** it.
3. In Sutra: provider **OpenRouter**. To stay free, choose a **Model ID that ends
   in `:free`** from OpenRouter's model list; paid models need account credit.

### NVIDIA NIM, Mistral AI, and Together AI

These are first-class provider choices using Sutra's audited OpenAI-compatible
request path. Create a key in the provider's console, paste it into the matching
field in **Settings ▸ Assistant ▸ API keys**, select the provider, then use
**Refresh models** or enter the exact current model ID.

- NVIDIA API Catalog / hosted NIM uses `integrate.api.nvidia.com`.
- Mistral uses `api.mistral.ai` and includes Mistral/Pixtral model families.
- Together uses `api.together.xyz` and namespaced model IDs such as
  `provider/model-name`.

Availability and pricing belong to each provider. Sutra does not silently route
between them, and all three keys remain session-only and export-excluded.

### DeepSeek, xAI (Grok), and Perplexity (Sonar)

These are implemented provider choices, not placeholder entries. Sutra sends
their requests through its audited OpenAI-compatible request path and they can
answer messages and propose the same approval-required Sutra actions as the
other remote providers.

1. Create an API key in the provider's own console, then paste it into the
   matching field in **Settings ▸ Assistant ▸ Your API Keys**.
2. Choose the matching provider in the Assistant's **Provider & Model** picker.
   DeepSeek and xAI can refresh their model list after you configure a key;
   Perplexity provides its supported Sonar choices in the picker.
3. Treat these as **text-first** integrations. Sutra only enables a native image
   attachment when its local capability registry recognizes the selected model;
   it does not claim native PDF, document, audio, or video support for these
   providers. Sutra also leaves provider-specific thinking controls at their
   defaults rather than sending an unverified reasoning parameter.

Provider model IDs, availability, and pricing change independently of Sutra.
Use the exact model identifier shown by that provider and rely on Sutra's
compatibility message before attaching a file.

### Local / Custom OpenAI-Compatible endpoint — free, offline

1. Install a local runner such as **Ollama** (ollama.com) or **LM Studio**
   (lmstudio.ai) and download a model.
2. Start its OpenAI-compatible server (Ollama exposes one at
   `http://localhost:11434/v1`; LM Studio at `http://localhost:1234/v1`).
3. In Sutra: choose the **Local / Custom OpenAI-Compatible endpoint**, set the
   **base URL** and **Model ID** in Settings ▸ Assistant. A key is usually not
   required (use any placeholder if a field is mandatory). Nothing leaves your
   machine.

Text, Markdown, CSV, code, DOCX, PPTX, and XLSX can be converted to bounded
inert text locally. Compatible models may receive selected PDFs or images
natively. Unsupported scans, audio, and video are blocked rather than silently
dropped, and the attachment chip explains the safest supported next step.

### OpenAI — paid

1. Go to **https://platform.openai.com** and sign in.
2. Add a payment method and a small credit balance under **Billing** (OpenAI's
   API has no ongoing free tier).
3. Open **API keys** → **Create new secret key**, **copy** it (shown once).
4. In Sutra: provider **OpenAI**, paste the key, set a current OpenAI **Model ID**.

### Anthropic Claude — paid

1. Go to **https://console.anthropic.com** and sign in.
2. Add credit under **Billing / Plans**.
3. Open **API Keys** → **Create Key**, **copy** it (shown once).
4. In Sutra: provider **Anthropic Claude**, paste the key, set a current Claude
   **Model ID**.

> **Model IDs change over time.** Use the exact identifier the provider lists
> today (Sutra lets you type any Model ID), rather than a hard-coded name. If a
> request fails with a "model not found" error, your Model ID is the first thing
> to check.

> **Keep your keys private.** Treat an API key like a password — anyone with it
> can spend on your account. Don't paste keys into shared documents. Because
> Sutra stores keys only in the browser session, closing the tab clears them.

---

## 8. Durable conversation ownership and sync

Durable visible conversations are owned by
`appData.assistantChatHistory` (workspace schema v7). The historical
`sutra:assistantChats:v1` and current-chat localStorage keys are compatibility
mirrors: an existing profile imports them once, canonical state wins same-id
ties, and every later write flows canonical workspace → mirror. Startup and
remote sync hydrate the live dock/full-page Assistant from canonical state.
An empty or stale browser mirror therefore cannot overwrite a newer synchronized
conversation. An untouched generated “New chat” remains ephemeral composer
state.

With Save chat history enabled, thread/message ids, order, roles, content,
timestamps, sources/citations, grounding, durable receipts, memory-used ids, and
supported thread metadata travel only inside encrypted operations/snapshots.
API keys, OAuth/Supabase tokens, passphrases, streaming buffers, abort
controllers, typing/in-flight state, and transient token/latency diagnostics
never enter the workspace projection.

## 9. Privacy boundaries (summary)

- **Sutra Intelligence runs locally** and calls no server.
- **AI requests go browser → the provider you chose**, and nowhere else. Sutra
  operates no model servers and no relay.
- **API keys never enter workspace data** and are never exported; they remain
  session-only unless you explicitly enable encrypted device-local remembering.
- **Visible conversation history** is saved locally when enabled, included in
  encrypted backups by default, and included in plaintext recovery only by
  explicit opt-in.
- **What is sent to the provider** is your message plus the context permitted by
  your **Workspace Access** level (and your current selection, if any) — not your
  whole workspace by default.
- The **Powered by Sutra Intelligence** badge keeps this boundary visible at all
  times.

For the full local-first picture, see [`PRIVACY_AND_LOCAL_FIRST.md`](../privacy-security/PRIVACY_AND_LOCAL_FIRST.md).

---

## 10. Mobile and tablet behavior

The Assistant panel is built to remain usable on small screens:

- The panel **fits the viewport** rather than overflowing it.
- The composer **stays usable with the software keyboard open**, so you can keep
  typing without the input being covered.
- **Action cards stack** vertically so Apply/Decline targets stay tappable.
- The **badge stays compact**; its subtitle may wrap to a second line.

On tablets the panel follows the same responsive rules, sizing to the available
space while preserving the header, badge, and composer.

---

## 11. Offline behavior

Sutra itself runs offline — opening the workspace, reading and editing notes,
and reviewing local signals all work with no connection, because **Sutra
Intelligence is local**. What requires a connection is a **provider call**: if
you are offline (or your provider/endpoint is unreachable), sending a message to
the AI cannot complete. The Local / Custom OpenAI-Compatible endpoint is the way
to keep even the AI side on your own machine or network.

---

## 12. Limitations

- **The Assistant cannot answer with a model while offline** unless you have
  configured a reachable Local / Custom OpenAI-Compatible endpoint.
- **Reply quality and capabilities depend on the provider and Model ID you
  choose** — Sutra does not host or guarantee any specific model's behavior.
- **Image/attachment understanding requires a vision-capable model.** If your
  selected model is text-only, attaching images is not supported; choose a
  vision-capable model from your provider.
- **The Assistant proposes, you apply.** It will not change your workspace
  without your Apply/confirm action — by design.
- **Context is bounded by Workspace Access.** At **Current Screen Only**, the
  Assistant genuinely cannot reason about data on other screens.

---

## 13. Troubleshooting

**The Assistant won't return a model answer.**
Confirm you have selected a provider and entered its API key for this session. Check that you are online,
or that your Local / Custom endpoint is running and reachable.

**My API key disappeared.**
Expected. Re-enter it for the current browser session. Provider/model choices
remain remembered; credentials are never persisted or exported.

**The Assistant doesn't seem to know about my other notes/tasks.**
Check **Workspace Access**. **Current Screen Only** and **Current Area**
intentionally limit what it can see. Raise it to **Full Workspace Context** if
you want cross-workspace awareness.

**I attached an image and it was ignored.**
Your selected model is likely text-only. Switch to a vision-capable model
(for example, a current GPT-4-class, Claude 3+, or Gemini 1.5+ model) on a
provider that supports image input.

**It applied a change I didn't want.**
Open **Assistant Activity** and **undo** the action. To prevent this in future,
enable **Confirm Before Applying Changes**.

**Replies don't remember earlier messages.**
You are in **Single Request** mode. Switch to **Conversation Memory** if you
want follow-up turns to carry context.

**The badge tooltip won't show on mobile.**
The tooltip is available on hover, **tap**, and focus. Tap the badge (or its `i`
indicator) to reveal it.

---

## 14. Developer notes (stable hooks & globals)

- **Badge hook:** `data-sutra-component="assistant-intelligence-badge"`.
- **Window bridge globals (canonical):** `window.sutraAssistant` (the Assistant
  API) and `window.sutraIntelligence` (the local signal layer, exposing
  `deriveStudentContext`). `window.getSutraAssistantContext` returns the current
  assistant context.
- **Legacy aliases (retained so existing code/plugins keep working):**
  `window.flowAssistant`, `window.getFlowAssistantContext`, and
  `window.flowIntelligence` point at the same objects.
- **Source:** `src/features/assistant/flow-assistant.js` (panel + actions) and
  `src/features/assistant/flow-intelligence.js` (`deriveStudentContext`).

---

## 15. The action harness (workspace actions, references, undo)

The 2026-06 Assistant upgrade added a centralized, validated action harness so
the Assistant can take real, reviewable actions across the workspace.

### `window.SutraAssistantActions`

A stable facade over the single action registry:
`registerAction`, `getActionDefinition`, `listActions`, `validateAction`,
`validateBatch`, `resolveReferences`, `classifyRisk`, `buildPreview`,
`applyAction`, `applyBatch`, `undoAction`, `getUndoSupport`, `logActivity`,
`getActivityLog`, and `riskLevels` (`read_only | low | medium | high`).

### Risk policy

- **read_only** (grade math, signal explanations) — runs immediately; renders
  the locally computed result; never mutates anything.
- **low** (create one note/task/card/block; complete or reopen ONE clearly
  identified task) — may auto-apply only under the existing
  `assistant.confirmationMode = auto_low` preference, never in batches.
- **medium** (multi-task status changes, reschedules, decks, milestones,
  multi-block plans, imports) — always shows a readable preview + approval.
- **high** (deletes, selection replacement, recovery plans, bulk imports) —
  always requires explicit approval; auto-apply is impossible.

There is deliberately **no task-delete action**, and archiving homework is
rejected — completing, rescheduling, or archiving (planner tasks only, with
`archived: true` + `isActive: false`, object preserved) are the only paths.

### Task mutations span BOTH stores

`update_task_status`, `reschedule_tasks`, and `change_task_priority` resolve
ids/titles across planner tasks (`appData.tasks`) and homework
(`hwTasks:v2`), skip homework mirror tasks (`origin === 'homework'`), refresh
Today / All Due / Homework / Course Hub / notifications / Workspace Pulse, and
write store-appropriate undo payloads into the Activity record
(`sutra:activityLog:v1`, which rides `.sutra` exports).

### Conversational references

`resolveTargetPhrase` resolves "those", "all four", "the first two", "the
overdue ones", "tomorrow's items", and keyword phrases ("the Chemistry tasks")
against (1) items mentioned in the last assistant reply, (2) the last local
overdue listing, and (3) live workspace tasks. Ambiguity always produces a
clarifying question, never a guess. Local commands handled without any model
call: overdue listing, complete/reopen/archive/reschedule phrasing, "undo
that", "what should I do today" (deterministic briefing),
"make a recovery plan", schedule-conflict scans, and Grade Planner Q&A
("can I still get an A in X?", "what if I score 85", "rank missing work") —
all grade math comes from `SutraGradePlanner.engine`, never the model.

### New preferences (normalized in `appSettings.preferences.assistant`)

`planning.latestWorkTime`, `planning.blockMinutes`, `planning.breakMinutes`,
`planning.weekends`, `planning.gradeImpactFirst`, `planning.includeReviewDebt`,
`planning.proactivity` (quiet/balanced/proactive), and
`onboarding.continueWithoutAi`. Editable from the context editor
("Edit" on the WORKING FROM card or "View exact context").

### Provider registry

`window.SutraProviderMeta` centralizes provider metadata (label, description,
key dashboard URL, docs URL, requiresKey) for OpenAI, Anthropic, Gemini, Groq,
OpenRouter, NVIDIA NIM, Mistral AI, Together AI, DeepSeek, xAI, Perplexity, and
a Local endpoint. Its presence-only
`hasKey` / `hasAnyKey` booleans and `openKeySettings(provider)` feed the
empty-state "Connect an AI provider" card and the Assistant guide. Raw keys
never pass through it.

---

## 16. Intelligence reliability + diagnostics (`SutraIntelligenceDiagnostics`)

Every remote provider request runs through the single core
`performIntelligenceRequest` in `src/core/app.js`. Its deterministic
reliability + observability logic lives in one pure, dual-mode module,
`src/features/assistant/intelligence-diagnostics.js`
(`window.SutraIntelligenceDiagnostics`), so it is unit-testable with no browser
and cannot drift from the docs or tests. `app.js` delegates to it and keeps an
exact inline fallback for the case where the module failed to load.

### Error classification

`classifyHttpError(status, message)` returns a fixed category. A 4xx whose body
names a context/token limit (`context length`, `maximum context`, `too many
tokens`, `reduce the length`, `context_length_exceeded`, …) is classified
`context-length` (with the guidance *"The request is too large. Lower Workspace
Access or remove an attachment."*) instead of the generic `unsupported-endpoint`
— but an unrelated 400 stays `unsupported-endpoint` (matching is deliberately
not broad). `context-length` and `stream-stalled` are first-class members of
`ERROR_CATEGORIES` and never fall through to `unknown`.

For an OpenAI-compatible adapter, a 400 response that explicitly rejects
`max_tokens` and tells Sutra to use `max_completion_tokens` gets one bounded
compatibility retry: Sutra moves the existing output limit to the named field
and resends the same request. This is response-driven rather than inferred from
model names, and it consumes the existing retry budget. Unrelated 400s are not
retried. Anthropic and Gemini keep their separate request formats.

### Usage normalization (missing ≠ zero)

`extractUsage(providerType, data)` normalizes provider usage to
`{ available, inputTokens, outputTokens, totalTokens, cacheReadTokens,
cacheWriteTokens, rawProviderUsage }`. Absent usage is `available: false` with
`null` fields — **never a measured zero**. All access is defensive; a malformed
usage block returns unavailable and never breaks the response. Per-provider
sources:

| Provider | input | output | total | cache read | cache write |
| --- | --- | --- | --- | --- | --- |
| OpenAI-compatible | `usage.prompt_tokens` | `usage.completion_tokens` | `usage.total_tokens` | `usage.prompt_tokens_details.cached_tokens` (where exposed) | — |
| Anthropic | `usage.input_tokens` | `usage.output_tokens` | input+output+cache | `usage.cache_read_input_tokens` | `usage.cache_creation_input_tokens` |
| Gemini | `usageMetadata.promptTokenCount` | `usageMetadata.candidatesTokenCount` | `usageMetadata.totalTokenCount` | `usageMetadata.cachedContentTokenCount` | — |

Streaming captures usage event-by-event (`extractStreamEventUsage` +
`mergeUsage` + `finalizeStreamUsage`): Anthropic's `message_start` (input/cache)
and `message_delta` (output) are merged and the total is recomputed from
components. `stream_options: { include_usage: true }` is sent only to providers
where it is supported (`supportsStreamUsageOption` — OpenAI, OpenRouter, Groq,
DeepSeek, xAI, Perplexity; **never** arbitrary local endpoints).

### Cache visibility

Existing provider caching (Anthropic `cache_control`, Gemini `cachedContents`)
is **surfaced, not changed**. A cache-hit row appears only when
`cacheReadTokens > 0`. No new cache directives are added.

### Retry + one authoritative deadline

The fetch/classify step runs in a bounded retry loop (default **1** retry,
`opts.maxRetries` overrides). A single deadline `startedAt + effectiveTimeoutMs`
covers the initial request, backoff, retry, and stream consumption — retries do
**not** get a fresh budget. A retry happens only when: no visible text has
streamed yet, the failure is retryable (`isRetryable` → transient
`500/502/503/504`, or `rate-limit` / `provider-overload`; a generic
`provider-error` without a qualifying status is **not** retried), enough
deadline remains, and the request was not aborted. `Retry-After` is honored
(delta-seconds **and** HTTP-date, capped) via `parseRetryAfter`; otherwise a
jittered 800–1500 ms backoff. Backoff is abortable — cancelling during a wait
ends cleanly. `retryCount` rides the result and diagnostics.

### Stream idle watchdog + partial preservation

`consumeIntelligenceStream` resets a per-chunk idle timer; **45 s** of silence
cancels the reader and returns `{ stalled: true }` with the partial text, which
`performIntelligenceRequest` classifies `stream-stalled` (distinct from
`timeout`). A hard mid-stream failure preserves `partialText` and is **never
replayed**. Timers/readers/controllers are cleaned up on every exit path.

### Reasoning-aware timeout

`computeEffectiveTimeout` scales the baseline up for an active reasoning plan
(effort multiplier + budget-token add-on + long-running-op bump), clamped to a
hard ceiling. A normal `auto` chat has no active plan and stays on the tight
default. An **explicit caller `timeoutMs` is authoritative and is not scaled**
unless the caller passes `scaleTimeoutForReasoning: true`.

### Final constants (single source of truth — the module)

| Constant | Value | Meaning |
| --- | --- | --- |
| `DEFAULT_REQUEST_TIMEOUT_MS` | 180000 | Baseline chat timeout (3 min) |
| `DEFAULT_MAX_RETRIES` | 1 | Bounded automatic retries |
| `RETRY_JITTER_MIN_MS` / `MAX_MS` | 800 / 1500 | Fallback backoff window |
| `RETRY_AFTER_MAX_MS` | 60000 | Cap on a provider-declared backoff |
| `MIN_RETRY_BUDGET_MS` | 4000 | Don't retry with less deadline left than this |
| `STREAM_IDLE_TIMEOUT_MS` | 45000 | Idle silence → `stream-stalled` |
| `TIMEOUT_CEILING_MS` | 330000 | Hard ceiling even with reasoning scaling (5.5 min) |
| effort multipliers | minimal/low 1, medium 1.5, high 2, xhigh 2.5, max 3 | Reasoning timeout scaling |
| Retry-eligible statuses | 500, 502, 503, 504 | Plus `rate-limit` / `provider-overload` |
| `include_usage` providers | openai, openrouter, groq, deepseek, xai, perplexity | Never arbitrary local |

### Result object + diagnostics (in-memory only)

`performIntelligenceRequest` **adds** fields without removing any existing ones:
`usage`, `retryCount`, `partial`, `partialText`, `streamStalled`,
`reasoningPlan`, `effectiveTimeoutMs`, `latencyMs`. The in-memory diagnostics
ring buffer (`intelligenceDiagnostics`, **cap 60**) records token *counts* and
timing only — never prompts, document text, or keys — and is **never persisted
or transmitted**. `window.SutraIntelligence.getDiagnosticsSummary()` aggregates
that buffer (average latency over measured requests, session token totals with
unavailable usage excluded, retry / stalled / partial / cache-hit counts).

Per-response stats surface as a **progressive-disclosure "Response details"
chip** (a native `<details>`, keyboard-operable, announcing expand/collapse)
beneath the provenance receipt, rendered via `SutraDOMSafety` (no `innerHTML`).
The stats live in a session-scoped `Map` keyed by an ephemeral message id and
are dropped on reload — they are **not** added to `chatStore`/`appData` or the
persistence inventory.

**Provider-specific usage limitations:** cache-read tokens depend on the
provider actually returning them (OpenAI exposes `cached_tokens` only where the
prompt was cache-eligible; Gemini reports `cachedContentTokenCount` only when a
`cachedContents` resource was used; Anthropic reports cache tokens only when a
`cache_control` breakpoint hit). Streamed OpenAI-compatible usage requires
`include_usage` support; where a provider omits usage entirely, the chip shows
latency alone.
