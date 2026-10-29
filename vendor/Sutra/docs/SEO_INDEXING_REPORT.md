# Sutra SEO & Google Indexing Pass — Report

Date: 2026-06-18
Scope: Make Sutra crawlable, canonicalized, and ready for Google indexing across its three public deployments. This does **not** guarantee indexing. Google decides if and when pages are indexed; this work removes the technical blockers and gives Google clean, consistent signals.

> ## ⚠️ UPDATE (2026-06-18, later) — Canonical changed to GitHub Pages
>
> After reviewing Google Search Console, the canonical was switched from `sutra-two.vercel.app` to **`https://tanujranjith.github.io/Sutra/HomePage.html`**, because the github.io property is the only one **verified and already indexed** in Search Console, and the repo's automated deploy targets GitHub Pages. **Sections 1–7 below were written for the original sutra-two plan; the URLs in them are now superseded by the github.io canonical.** What actually shipped:
>
> - **Canonical / OG / Twitter / JSON-LD** in `HomePage.html` and `index.html` → `https://tanujranjith.github.io/Sutra/HomePage.html` (images under `https://tanujranjith.github.io/Sutra/assets/...`).
> - **`sitemap.xml`** now lists `https://tanujranjith.github.io/Sutra/HomePage.html` and `.../Sutra.html`.
> - **`robots.txt`** points to `https://tanujranjith.github.io/Sutra/sitemap.xml`.
> - **`vercel.json`** redirect for the old `note-flow-atelier` host now targets the github.io canonical.
>
> **Search Console actions I completed (github.io property):**
> 1. Submitted the sitemap **`https://tanujranjith.github.io/Sutra/sitemap.xml`** (shows "Couldn't fetch" until you deploy the new files — that is expected).
> 2. Inspected **`https://tanujranjith.github.io/Sutra/HomePage.html`** (was "not on Google / unknown") and clicked **Request indexing** — confirmed "Indexing requested".
>
> **You still need to:** push these changes so GitHub Pages redeploys (the sitemap/robots/canonical only go live after deploy). Once deployed, re-open the sitemap row — it should move from "Couldn't fetch" to "Success", and re-run URL Inspection → Request indexing on the homepage so Google crawls the updated metadata.
>
> **Caveat for github.io project sites:** robots.txt is only auto-honored at the domain root (`https://tanujranjith.github.io/robots.txt`), which this repo does not control (the app lives under `/Sutra/`). That is fine here because the sitemap was submitted **directly** in Search Console, which does not rely on robots.txt.

---

## 1. Canonical URL chosen

**Primary canonical URL: `https://sutra-two.vercel.app/HomePage.html`**

This was set per your instruction. Every public entry page now declares this single canonical, so the duplicate deployments stop competing in search.

> Important consideration: the repository's **automated production deploy targets GitHub Pages** (`.github/workflows/deploy.yml` builds `.deploy/` and publishes to `https://tanujranjith.github.io/Sutra/`). The two Vercel deployments (`sutra-two`, `note-flow-atelier`) are served from the same repo but are not driven by a workflow in this repo. Because the canonical now points at `sutra-two.vercel.app`, you must make sure **that** deployment stays current (auto-deploys from `main`). If `sutra-two` ever goes stale or offline, the canonical will point at a worse copy than the GitHub Pages one. If you would rather make GitHub Pages the canonical, the only change needed is to swap the canonical/OG/Twitter/JSON-LD/sitemap/robots URLs back to `https://tanujranjith.github.io/Sutra/...` — tell me and I will flip them.

All three URLs serve **identical static HTML**, so the same canonical tag is correct on every deployment. That is the cleanest way to consolidate duplicates that are built from one repo.

---

## 2. Files changed

| File | Change |
|------|--------|
| `HomePage.html` | New SEO title, description, `keywords`, `author`. Canonical + OG + Twitter now point at `sutra-two.vercel.app/HomePage.html` with absolute image URLs. Added JSON-LD (`WebSite` + `SoftwareApplication` + `Person`). Hero copy reworded to include the branded terms. |
| `index.html` | Title/description aligned. Canonical + OG + Twitter point at the canonical HomePage URL so this redirect page never competes. Meta-refresh redirect to `HomePage.html` preserved. |
| `robots.txt` (new) | `User-agent: * / Allow: /` plus `Sitemap:` pointer to the canonical sitemap. |
| `sitemap.xml` (new) | Lists only canonical pages on `sutra-two.vercel.app` (`HomePage.html`, `Sutra.html`). Duplicate deployment URLs deliberately excluded. |
| `vercel.json` (new) | Host-scoped 308 redirect: any request to `note-flow-atelier.vercel.app` → `https://sutra-two.vercel.app/HomePage.html`. Scoped by host so it never affects `sutra-two`. |
| `scripts/build-deploy-artifact.mjs` | Added `robots.txt` + `sitemap.xml` to the deploy allowlist and the required-source list so they ship in `.deploy/`. |
| `scripts/sutra-deploy-artifact-check.mjs` | Added `robots.txt` + `sitemap.xml` to the required-artifact list so the build is verified to contain them. |
| `scripts/sutra-network-check.mjs` | Allowlisted the new metadata origins (`sutra-two.vercel.app`, `note-flow-atelier.vercel.app`, `schema.org`, `github.com`) used in canonical/OG/JSON-LD. (These are metadata only and are never fetched by the app.) |
| `docs/SEO_INDEXING_REPORT.md` (new) | This report. |

---

## 3. Metadata added (summary)

- **Title:** `Sutra | Student OS for School, Projects, and Life`
- **Description:** local-first student OS / private student workspace for school, projects, tasks, notes, and planning.
- **Canonical:** `https://sutra-two.vercel.app/HomePage.html`
- **Open Graph + Twitter card:** `summary_large_image`, absolute `og:image`/`twitter:image` at `https://sutra-two.vercel.app/assets/brand/sutra/generated/social-preview.png` (1200×630, already exists in the repo).
- **theme-color:** `#07111f`; **application-name:** `Sutra`; **author:** `Tanuj Ranjith`.
- **Keywords (light, not stuffed):** Sutra, student OS, student workspace, local-first, notes, assignments, planning, school, projects, tasks, student productivity, Tanuj Ranjith.
- **JSON-LD:** `WebSite` + `SoftwareApplication` (category `EducationApplication`, free, browser-based) + `Person` (Tanuj Ranjith). Validated as parseable JSON.

### Branded search relevance
The visible homepage now naturally contains: **Sutra**, **Tanuj Ranjith** (founder note + footer), **student OS**, **student workspace**, **local-first**, and **school, projects, tasks, notes, and planning** (hero paragraph). No repeated/spammed terms.

---

## 4. Duplicate URL handling

| Deployment | Handling |
|-----------|----------|
| `sutra-two.vercel.app/HomePage.html` | **Canonical / primary.** Listed in sitemap. |
| `note-flow-atelier.vercel.app/HomePage.html` | **Redirect + canonical.** `vercel.json` issues a permanent (308) redirect of this host to the canonical URL *if this deployment builds from this repo*. As a fallback, the canonical tag in the served HTML also points to the primary URL. Not listed in the sitemap. |
| `tanujranjith.github.io/Sutra/HomePage.html` | **Cross-domain canonical only.** GitHub Pages cannot do a server redirect for the same static file, and adding a JS redirect would break the working app on that domain, so it keeps serving the app but declares the primary canonical. Not listed in the sitemap. |

GitHub was intentionally *not* given a redirect page because the GitHub Pages URL is currently the repo's real auto-deployed app and a redirect would break it.

---

## 5. Crawlability check (Task 6)

- No `noindex` tags anywhere. `robots.txt` allows all.
- CSP is unchanged and does not block crawling (it governs runtime connections, not crawlers). `check:csp` still passes.
- The landing page (`HomePage.html`) is **real static HTML**, not script-rendered: the hero, feature sections, founder note, and footer text are all present in the HTML source, so crawlers can read what Sutra is without executing JS.
- The app shell (`Sutra.html`) is the interactive application; it is included in the sitemap at lower priority. The marketing/landing page is the primary indexable surface.

---

## 6. Verification run

- `npm run build:deploy` → success; `robots.txt` and `sitemap.xml` are staged into `.deploy/`.
- `npm run check:deploy` → validates the new files are present in the artifact. (One unrelated failure exists — see Limitations.)
- `check:csp`, `check:network`, `check:encoding`, `check:responsive`, `check:brand` → **pass**.
- JSON-LD parses as valid JSON (`WebSite`, `SoftwareApplication`, `Person`).
- `sitemap.xml` parses as well-formed XML.

---

## 7. Manual steps you need to do

### Deployment settings
1. **Vercel — `sutra-two` project:** confirm it auto-deploys from the `main` branch so the canonical URL always serves the latest build. This is now the URL Google will treat as the real Sutra.
2. **Vercel — `note-flow-atelier` project:** 
   - If it builds from this repo, the new `vercel.json` host redirect takes effect on the next deploy — verify by visiting `https://note-flow-atelier.vercel.app/` and confirming it lands on `https://sutra-two.vercel.app/HomePage.html`.
   - If it does **not** build from this repo (separate/old project), either delete the project or add a redirect in **Vercel → note-flow-atelier → Settings → Redirects/Domains** pointing to the canonical URL. The canonical tag is the fallback either way.
3. **GitHub Pages:** no change needed. It keeps serving the app and declares the canonical. (Optional: if you ever want GitHub Pages to be the canonical, ask me to flip the URLs.)
4. **Social image:** already present at `assets/brand/sutra/generated/social-preview.png` (1200×630) and referenced with absolute URLs. Nothing to add.

### Google Search Console checklist
1. **Add/verify the canonical property.** Add `https://sutra-two.vercel.app/` in Search Console and complete verification (HTML tag or DNS). Prefer a URL-prefix property for `https://sutra-two.vercel.app/`.
2. **Submit the sitemap.** Sitemaps → submit `https://sutra-two.vercel.app/sitemap.xml`.
3. **URL Inspection on the canonical homepage.** Inspect `https://sutra-two.vercel.app/HomePage.html`; confirm it is crawlable and that Google reads the canonical as itself.
4. **Request indexing.** On that inspection, click **Request indexing**.
5. **Inspect the old URLs.** Inspect `https://note-flow-atelier.vercel.app/HomePage.html` and `https://tanujranjith.github.io/Sutra/HomePage.html`; confirm Google reports the **Google-selected canonical** as the `sutra-two` URL (for note-flow, that it follows the redirect).
6. **Monitor** indexing status and Search appearance over the next days/weeks. Consolidation of duplicates can take time.

> You may also want to add `https://tanujranjith.github.io/` and `https://note-flow-atelier.vercel.app/` as properties temporarily, just to watch the canonical consolidation happen, then drop them.

---

## 8. Limitations & notes

- **Indexing is not guaranteed.** This work makes Sutra crawlable and gives clean canonical signals. Google decides whether/when to index.
- **The repo's automated deploy is GitHub Pages, but the canonical is a Vercel URL.** This is intentional per your instruction, but it means the canonical's freshness depends on the `sutra-two` Vercel project, which is not controlled by a workflow in this repo. Keep that deployment alive and current.
- **`vercel.json` only helps if `note-flow-atelier` builds from this repo.** If it is a disconnected project, you must handle the redirect in the Vercel dashboard (or delete it). Canonical tags cover the case where the redirect cannot apply.
- **Resolved (2026-06-19 maintenance pass):** the earlier `Sutra.html` reference to `supabase/README.md` (excluded from the deploy allowlist) is gone, and the remaining in-app "Setup guide" link in `src/core/app.js` was repointed to the GitHub repo URL — a relative `supabase/README.md` href 404s on the hosted build. `check:deploy` no longer fails on this item.
- **Sitemap `lastmod`** is set to today (2026-06-18); update it when the pages meaningfully change.
