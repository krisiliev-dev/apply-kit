# Job discovery: what the cv-maker prototype learned

Reference for rebuilding job discovery in the new app. It was pulled out of the archived `cv-maker/` prototype, which is read-only. It **builds on** `docs/research/previous-agent/project-discovery-sourcing.md` (the "research note"). That note already covers which sources were picked for the Sofia / Manchester / remote-EU cybersecurity search, the yields people observed, the LinkedIn/jobs.bg boundary, and the EURES ESCO trick. This doc adds what the code shows: exact endpoints, ref formats, id and expiry rules, scoring math, extraction order, and the bugs.

Evidence tags:
- **verified**: a code comment or the research note records a real run with an observed yield.
- **convention**: a standard public API or pattern, used as documented, with no recorded yield.
- **invented**: an arbitrary choice (a weight or threshold) that nothing calibrated.

---

## 1. Architecture in one paragraph

Source adapters (`cv-maker/lib/discovery/sources/*.ts`) each return `JobPosting[]` (`cv-maker/lib/discovery/types.ts:43`). They swallow their own errors and return `[]`. `POST /api/discover/run` (`cv-maker/app/api/discover/run/route.ts:91`) gathers postings from two places:
- The **aggregator** (`cv-maker/lib/discovery/aggregate.ts`): Greenhouse, Lever and Ashby slugs, RSS feeds and HN. These come from prefs plus registry sources folded in by `effectivePrefs` (`cv-maker/lib/doc/serverStore.ts:324`).
- The **direct** sources in the registry: careerpage/board, SmartRecruiters, Workday, Jooble, Arbeitnow and the jobapi providers.

All sources run under `Promise.allSettled`. The run merges results into a JSON-file pool (`~/.cv-maker/data/discovery-postings.json`) and then expires missing postings. Email alerts (`/api/discover/email-sync`) and extension captures (`/api/discover/ingest`) write to the same pool. **Scoring runs on the client** (`cv-maker/lib/discovery/store.ts:61`), because the CVs live in localStorage. The `/discover` page sorts by `locationRank`, then by `score` (`cv-maker/app/discover/page.tsx:255`). An MCP bridge (`cv-maker/mcp/server.mjs:204+`) exposes the same functions: `run_discovery`, `list_postings`, `add_source`, `set_discovery_prefs` and `sync_email`.

---

## 2. Source adapters

Every adapter returns `[]` on a non-2xx response, a parse error or a timeout. Most use a 15 s `AbortSignal.timeout`. Greenhouse, Lever, Ashby, HN and RSS have no timeout.

| Adapter (file) | Endpoint | Auth / cost | Ref format | Returns | Quirks | Yield / evidence |
|---|---|---|---|---|---|---|
| **Greenhouse** `sources/greenhouse.ts:25` | `GET boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true` | none, free | board slug | title, url, location.name, HTML content (entity-decoded and stripped), `updated_at`, salary from `metadata[]` keys containing "salary"/"compensation" | Company name is humanized from the slug when `company_name` is absent. **id includes `updated_at`** (see §4). | convention |
| **Lever** `sources/lever.ts:29` | `GET api.lever.co/v0/postings/{slug}?mode=json` | none | slug | `text`→title, `hostedUrl`, `categories.location`, `descriptionPlain`, `salaryRange{min,max,currency}` | Company is always the humanized slug | convention |
| **Ashby** `sources/ashby.ts:30` | `GET api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true` | none | slug | title, `jobUrl`, `locationName`, `publishedDate`, compensation tier summary, `organizationName` | Some boards return 400 for `includeCompensation=true`, so the adapter retries with `false` | convention |
| **SmartRecruiters** `sources/smartrecruiters.ts:29` | `GET api.smartrecruiters.com/v1/companies/{id}/postings?limit=100[&country=xx]` | none | `companyId` or `companyId:cc` | name, location parts, `releasedDate`, company.name | No description (the list endpoint only). URL is built as `jobs.smartrecruiters.com/{id}/{postingId}`. Single page, max 100. | **verified**: `BoschGroup:bg` gave 14 Sofia roles |
| **Workday** `sources/workday.ts:29` | `POST {origin}/wday/cxs/{tenant}/{site}/jobs` with body `{limit:20,offset,searchText:"",appliedFacets:{}}` | none | the careers URL, e.g. `https://a1group.wd3.myworkdayjobs.com/bg-BG/A1_Jobs` | title, `locationsText`, `externalPath` | Tenant = first hostname label; site = last path segment. Paginates 20 at a time, **capped at 100**. No dates or description. Company = source label. | verified (A1 is registered; yield not recorded) |
| **Arbeitnow** `sources/arbeitnow.ts:26` | `GET arbeitnow.com/api/job-board-api` | none | keyword, or `""`/`*` for all | title, company, remote flag, location, tags, `created_at` (in seconds) | Keyword filtering is done **client-side** on the recent feed. Location becomes `Remote (X)` when remote. | convention |
| **Jooble** `sources/jooble.ts:32` | `POST jooble.org/api/{KEY}` with body `{keywords, location, page:"1"}` | `JOOBLE_API_KEY` (free). Throws if missing. | `keywords` or `keywords\|location` | title, link, company/source, location, salary, snippet, updated | Key sits in the URL path. Use `Bulgaria`, not `Sofia`, which returns 0. With no location, results flood with US roles. Fetches page 1 only. | **verified**: `cyber security\|Bulgaria` gave about 11 Sofia roles |
| **Reed** `sources/jobapis.ts:87` | `GET reed.co.uk/api/1.0/search?keywords&locationName&resultsToTake=100` | `REED_API_KEY` (free), Basic auth `KEY:` | `keywords\|location` | title, employer, location, min/max salary plus currency, description, date in `dd/mm/yyyy` | The only free source that covers UK cities | **verified**: about 162 Manchester cyber roles, with salaries |
| **Remotive** `jobapis.ts:122` | `GET remotive.com/api/remote-jobs?search&limit=50` | none | keywords | `candidate_required_location`, salary, description | server-side search | verified, low yield |
| **Jobicy** `jobapis.ts:146` | `GET jobicy.com/api/v2/remote-jobs?count=50` | none | keywords | `jobGeo`, salary min/max, excerpt | client-side keyword filter, so few hits (1–17) | verified, low |
| **The Muse** `jobapis.ts:180` | `GET themuse.com/api/public/jobs?page=0..2` | none | `keywords\|location` | name, locations[], contents, `landing_page` | Client-side keyword and location filter over 3 pages. Lets `flexible`/`remote` through. | verified, low |
| **Findwork** `jobapis.ts:299` | `GET findwork.dev/api/jobs/?search&location` | `FINDWORK_API_KEY`, `Token` auth | `keywords\|location` | role, company, remote, text | Small general board with loose search. About 88 hits, mostly not cyber. | verified, noisy |
| **EURES** `jobapis.ts:248` | `POST europa.eu/eures/api/jv-searchengine/public/jv-search/search` | none | `keywords\|cc` (2-letter country) | title/description (the `translations.en` version is preferred), employer, `locationMap` keys, `creationDate` | When the keyword is a cyber alias, it swaps free text for 6 hard-coded ESCO ICT-security occupation URIs (`jobapis.ts:220`). Not the UK. BG plus the occupation filter gives 0. | **verified**: about 50 clean results per run, EU-wide |
| **HN Who's Hiring** `sources/hnHiring.ts:93` | Algolia `search_by_date?tags=story,author_whoishiring` to find the thread, then Firebase `item/{id}.json` for each kid | none | optional threadId | one posting per top-level comment. The first line is split on `\| — – - :` into company/title/location. | Capped at **120 comments**, fetched in parallel. The location heuristic treats any `[A-Z]{2}` token as a location. HTML scrape kept as a fallback. | verified (the old HTML scrape silently returned 0) |
| **RSS/Atom** `sources/rss.ts:41` | any feed URL | none | feed URL | item/entry title, link (string or `@_href`), date, description | Company = channel title. Location is only `remote/hybrid/on-site` sniffed from the description. | convention. WWR feeds listed in research note. |
| **dev.bg** `sources/devbg.ts:27` | `GET` a category page, e.g. `dev.bg/company/jobs/it-security/` | none (robots.txt allows it) | page URL (routed by hostname in `run/route.ts:76`) | `.job-list-item`→`.job-title`, `.company-name`, `.badge` (tooltip removed), link `/company/jobads/` | One GET, browser User-Agent, **no pagination**. No dates or description. | **verified**: about 20 Sofia security roles |
| **Generic careerpage** `sources/careerpage.ts:22` | `GET` any URL | none | page URL | Order: (1) JSON-LD `JobPosting` in raw HTML, (2) **puppeteer render** then JSON-LD again, (3) anchor heuristic (`JOB_HREF_RE`/`JOB_TEXT_RE`, `:169`) | Max 60 postings. Description cut to 1200 chars. Anchor mode gives title only, with company = domain. | convention |

**Dropped / never built:** Adzuna (has no Bulgaria). jobs.bg crawling (Cloudflare bot gate). LinkedIn automation. Proxycurl, Bright Data and Coresignal (sued, or paid). See the research note.

**Related, not discovery:**
- `cv-maker/lib/jobs/fetch.ts` pulls one JD by URL for tailoring. It hard-refuses `linkedin.com` and `indeed.com` hosts (`fetch.ts:12`) and tells the user to paste the text instead. It then tries containers in order (`[class*=job-description]` → `article` → `main` → `body`), keeps the first one longer than 400 chars, and caps the text at 12k.
- `cv-maker/lib/jobs/ats.ts` detects six ATSes from a URL, to read application-form schemas.
- `cv-maker/lib/jobs/registry.ts` is only the CV-variant registry and has no discovery logic.

---

## 3. ToS and legal boundary — **verified** (researched 2026-05, held under pressure)

| Allowed | Why |
|---|---|
| Public ATS JSON APIs (Greenhouse, Lever, Ashby, SmartRecruiters, Workday CXS) | Published, unauthenticated endpoints the vendor intends for job boards |
| Licensed aggregator APIs (Jooble, Reed, Remotive, Jobicy, The Muse, Findwork, Arbeitnow, EURES) | The provider redistributes under its own terms. Free tier with a key or no key. |
| Server-rendered boards whose robots.txt allows the path (dev.bg) | One polite GET with no pagination |
| HN through Algolia/Firebase | Official public APIs |
| **Email alerts** the user opted into, read from their own inbox over IMAP | The platform pushes the mail, so nothing is pulled from its servers. This is the compliant "automatic" route to LinkedIn and jobs.bg. |
| **User-driven** extension capture of the page the user is viewing | Their browser, their session, their screen |

| Off-limits | Why |
|---|---|
| Any automation driving an authenticated LinkedIn session | LinkedIn's User Agreement bans automated access, even from your own session. hiQ confirmed this is contractual breach even for public data. Declined even when the user claimed permission. |
| Crawling jobs.bg | Even robots.txt sits behind a Cloudflare challenge. Crawling would mean defeating bot detection. |
| Server-side fetching of LinkedIn/Indeed URLs | Blocked in `lib/jobs/fetch.ts` |
| Paid scraped-data vendors | Proxycurl used fake accounts (sued, shut down). The others are paid, which breaks the no-budget constraint. |

**Grey area to fix in the rebuild:** the old `cv-maker/extension` **auto-captures** on LinkedIn, Indeed and Glassdoor whenever the URL changes (`extension/content.js:203-232`, default `autoCapture: true`). The later `autofill-extension` deliberately went **click-to-capture only**: "Clicking the pill is the ONLY way to persist anything" (`autofill-extension/src/content/jobCapture.ts:10`). Keep the click-only rule. It keeps capture clearly user-driven.

---

## 4. Normalization, dedupe, expiry

**Posting shape** (`types.ts:43`): `{id, source:{kind,…}, url, title, company, location?, salary?, description?, postedAt?, fetchedAt}`, plus `closedAt` in the server pool (`serverStore.ts:244`). Salary is always a **free-text string**. Location is a raw string. HTML is stripped with a regex in each adapter. Descriptions are cut to 1200 chars (careerpage) or 4000 (APIs, captures). — *convention*

**Ids**: FNV-1a 32-bit hash, base36, of `parts.join("|")` (`cv-maker/lib/discovery/id.ts:6`). The inputs differ per adapter, and that is where the bugs come from:

| Adapter | id inputs | Consequence |
|---|---|---|
| greenhouse / lever / ashby / hn / rss | kind + url + **postedAt** | Greenhouse uses `updated_at`, so **every edit makes a new id**. The old row is closed, and its saved/dismissed state (keyed by id) is lost. |
| smartrecruiters / workday / jooble / arbeitnow / jobapi | kind (+provider) + url | stable (good) |
| careerpage / dev.bg | `"careerpage"` + url + title | stable unless the title changes |
| extension capture & email | source + url + **capturedAt** (`ingestBuffer.ts:52`) | **Every recapture, and every alert email repeating a job, creates a duplicate.** The "deduped by id, re-run is safe" claim in `docs/email-alerts.md` holds only for the same email. |

No posting is deduped across sources: the same role found on Jooble, dev.bg and an ATS shows up as three rows. A 32-bit hash also carries a small collision risk at scale. → **Rebuild:** use a canonical-URL key (drop tracking params, normalize host), plus a fuzzy `company+title+city` key for cross-source merging.

**Merge** (`serverStore.ts:260`): when ids match, the new record is spread over the old one and `closedAt` is cleared, so a posting that reappears is reopened. — *convention*

**Expiry** (`run/route.ts:126-136`, `serverStore.ts:275,303`): each posting maps to a source key: `greenhouse:{slug}`, `workday:{tenant}`, `smartrecruiters:{companyId}`, `careerpage:{url}`, `jooble:{ref}`, `jobapi:{provider}:{ref}`, `hn-hiring:latest`, and so on. After a run, any open posting whose key was crawled but whose id is missing from this run's results gets `closedAt = now`. `GET /api/discover/postings` returns only open postings (`?includeClosed=1` returns all). — *convention*

**Known bugs / gotchas:**
1. **Orphaned postings** (verified in the research note). Deleting a source (`serverStore.ts:226`) never touches its postings, and expiry only covers keys crawled in that run, so the orphans stay forever. There is no purge endpoint; a past cleanup meant hand-editing the JSON.
2. **A transient failure closes everything.** Adapters return `[]` on 429/5xx/timeout, and the route also pushes a source's key into `crawledKeys` when the source rejected (`run/route.ts:113-120`). So one rate-limited run marks every posting from that source closed, and the next good run reopens them. → Only expire when the fetch actually succeeded, and require N consecutive misses.
3. Captured, email and `linkedin`/`jobsbg` postings fall to `default: return p.source.kind` and **never expire**.
4. SmartRecruiters `BoschGroup` and `BoschGroup:bg` share one expiry key, so disabling one makes the other's run close its postings.
5. The ingest buffer (`ingestBuffer.ts`) is in memory: it is lost on restart and not shared across instances. It became redundant once ingest also wrote to the file pool (`ingest/route.ts:47`).
6. `/api/discover/ingest` is **open CORS `*` with no auth**. The later autofill extension added device pairing with a Bearer token plus `x-device-id` (`autofill-extension/src/background/discoverySync.ts:88`).
7. The 15-minute cache exists only in the legacy `/api/discover/fetch` route. `/run` has no cache.

---

## 5. Scoring and ranking — mostly **invented** (unit tests exist, nothing was calibrated)

File: `cv-maker/lib/discovery/scoring.ts`. This is lexical scoring only, with no embeddings (TODO at `:14`). Tests in `cv-maker/tests/discovery/scoring.test.ts` and `location.test.ts` only check that orderings come out right; they do not check accuracy.

**Hard rejects** (score 0, `hardReject: true`, hidden by `store.ts:157`), applied in order:
1. **Title denylist** (`:319`): a case-insensitive substring match against `prefs.titleDenylist`.
2. **Region / work auth** (`:235`):
   - If `remoteOnly` is set and the location doesn't match `\bremote\b|\banywhere\b`, reject.
   - Empty `workAuth` passes everything.
   - A bare "remote" or "anywhere", with no other alphabetic token left, passes as global.
   - Otherwise the location must **contain** one of the aliases for some `workAuth` code (`regionAliases`, `:265`). Codes: US, CA, UK, EU (EU cities plus Bulgarian cities), BG, DE, PT, ES, FR, NL. An unknown code falls back to its lowercased self.
3. **Salary floor** (`:222,361`): takes the first number in the salary string, applies a `k` multiplier, and ignores values under 1000. It is labelled "USD-equivalent" but **does no currency conversion**, so BGN, GBP and EUR are compared raw. A missing salary always passes.

**Soft score** (`:419`), clamped to 0–1:
```
0.30 × titleSim  +  0.25 × min(1, 4 × jaccard)  +  0.30 × cyber  +  0.10 × fresh  +  0.05 locBoost  −  dismissPenalty
```
- **titleSim** (`:195`): the overlap of posting-title tokens with `cv.targetRole` / `cv.profile.title` tokens, divided by the smaller token set. Best over all CVs.
- **jaccard** (`:160`): token-set Jaccard between the whole CV (role, summary, bullets, tags, skills) and the posting (title, company, location, description). It is stretched ×4 because raw values sit around 0–0.15.
- **cyber** (`:116`): 38 terms (`:71`). Each term found in the title adds 0.34; each found only in the body adds 0.07. Capped at 1, so 3 title hits saturate it. Watch the substring traps: `"iam"` matches "W**iam**"/"Liam", and `"compliance"`, `"threat"` and `"firewall"` are broad.
- **fresh** (`:211`): ≤3 days → 1. Linear decay to 0.1 at 30 days. Unknown date → 0.5.
- **locBoost**: +0.05 if any preferred location matches.
- **dismissPenalty** (`:385`): −0.15 if you dismissed a posting at the same company, else −0.10 if a dismissed title has titleSim > 0.7.

**Ranking:** sort first by **`locationRank`** (`:135`): index of the first matching `preferredLocations` entry (Sofia=0, Manchester=1…), then `n` for remote, then `n+1` for anything else. **Score** is only the tiebreaker within a tier (`app/discover/page.tsx:255`). So any Sofia role beats every Manchester or remote role, whatever its relevance; this was intended and has a test (`scoring.test.ts:76`).

**"Why" strings** (`:430-451`) show at most three reasons, in this order: location → cyber ≥0.34 → title ≥0.5 (strong) or >0 (partial) → overlap ≥0.3 → fresh ≥0.9 or ≤0.3 → dismiss penalty.

**Cyrillic normalization** (`cv-maker/lib/discovery/location.ts`) — **verified fix**:
- A 10-entry map: софия→sofia, пловдив, варна, бургас, русе, българия (plus misspelling българиа), дистанционно→remote, хибрид→hybrid, белград→belgrade.
- Matching lowercases, substitutes, then checks substring `includes`.
- It fixed a real bug: every Sofia role was being hard-rejected because Bulgaria was missing from EU.

**Scoring gotchas:**
- `tokenize` (`:148`) strips everything outside `[a-z0-9+.#-]`. **Bulgarian-language postings get zero title and keyword overlap** and score only on cyber, freshness and location. The autofill extension's tokenizer uses `\p{L}` and handles this properly.
- Alias matching is a plain substring check: `"uk"` matches "Ukraine", `"eu"` matches inside unrelated words, and `" us "` needs surrounding spaces.
- EURES locations are bare country codes ("AT, MT") that no alias covers. With `workAuth:["UK","EU"]` they are likely hard-rejected, even though the research note counts them as "clean ~50/run". Verify before reusing.
- In `devbg.ts:76`, `\bсофия\b` never matches, because JS `\b` doesn't bind around Cyrillic. The extension code itself notes this (`extension/content.js:135`).

---

## 6. Email-alert ingestion — **convention** (the parsers were tuned on synthetic fixtures, not real samples)

- **Transport** (`cv-maker/lib/discovery/email/imap.ts`): `imapflow` + `mailparser` over `imap.gmail.com:993`, using a Gmail app password.
  - Env vars: `GMAIL_USER`, `GMAIL_APP_PASSWORD`, optional `GMAIL_MAILBOX` (a label; default INBOX) and `GMAIL_IMAP_HOST`.
  - Read-only search covers `since: now − 14d`, takes the last 60 UIDs, and uses the HTML part (or `textAsHtml`).
- **Parsing** (`email/parse.ts`) routes on the `From` header:
  - **LinkedIn**: anchors matching `/jobs/view/(\d+)` are canonicalized to `linkedin.com/jobs/view/{id}`. Company and location are the first two segments of the enclosing cell's text, split on double spaces, `·` or `|`.
  - **jobs.bg**: anchors matching `/job/\d{4,}`. Company is hard-coded to "jobs.bg", and the href is used raw, so it may be a tracking URL.
  - **Generic**: any `http` anchor whose 5–140 char text matches a job-title regex, deduped by title, max 40.
- Postings go through `payloadToPosting`, and `postedAt` is the email's date.
- Setup uses a Gmail filter `from:(linkedin.com OR jobs.bg)` that labels mail `job-alerts` (`cv-maker/docs/email-alerts.md`).
- Gaps: no UID or `\Seen` checkpoint (it rescans 14 days every time), duplicate ids across emails (§4), no OAuth (an app password needs 2FA and is a long-lived secret).

---

## 7. Browser-extension capture

**v1: `cv-maker/extension/`** (no-build MV3, load unpacked). It is a content script on LinkedIn `/jobs/*`, jobs.bg, Indeed and Glassdoor, plus injection on demand through `activeTab` + `scripting` from the popup. Extraction order (`extension/content.js:171`):
1. **schema.org `JobPosting` JSON-LD** in the live DOM. It flattens arrays and `@graph`, takes title/name, `hiringOrganization.name`, the first `jobLocation.address` (locality/region/country), salary from `baseSalary`/`estimatedSalary` MonetaryAmount (min–max/value plus unitText), and the description stripped and cut to 4000.
2. **Heuristic**: the first `<h1>` (3–160 chars). Company comes from `[class*=company]`/`a[href*="/company/"]`, else the second segment of `document.title`.
3. **jobs.bg special case** (detail pages only; list pages are anchor-less MDC SPA):
   - title from `.job-view-title`
   - company parsed from og:title (`обява за работа от X` / `job ad from X`)
   - city found by a regex with no `\b`
   - URL from canonical
   - description and salary (`лв|bgn|eur|€…`) from the same-origin `#customJobIframe.contentDocument`

It watches SPA navigation by polling `location.href` every 1.5 s. The background worker dedupes by `source|url|title` per session and POSTs each posting to `/api/discover/ingest`. *Evidence: verified for jobs.bg detail pages (research note); otherwise convention, described as "best-effort".*

**v2: `autofill-extension/src/content/jobCapture.ts`** (Vite/TS):
- Per-site adapters with `isJobPage()` and `extract()` for LinkedIn `/jobs/view/`, Indeed and Glassdoor. Each walks a list of selectors, semantic first and testids as fallback, and prefers the canonical URL.
- It hooks `history.pushState`/`replaceState` instead of polling.
- A **shadow-DOM "pill"** has to be clicked to capture. Captures queue in IndexedDB (`discoveryQueue`, indexed by url and synced flag, `store/db.ts`).
- A `chrome.alarms` tick every 5 minutes syncs in batches of 25 to `/api/pair/ingest` with Bearer auth. On 401/403 it stops early and the popup prompts a re-pair; the legacy unauthenticated path is kept as a fallback.

---

## 8. Autofill Q&A matching — **invented** thresholds

Source: `autofill-extension/src/`.
- **Label derivation** (`content/fieldContext.ts:52`) checks, in order:
  1. `label[for=id]`
  2. the wrapping `<label>`
  3. `aria-labelledby`
  4. `aria-label`
  5. `placeholder`
  6. the nearest legend/heading/`.question` containing the field, up to 5 ancestors
  7. the humanized `name`
  8. `"Unlabeled field"`

  Password, hidden, submit and search inputs are skipped. Suggestions are gated by `pageLooksLikeApplication()`, which needs at least 2 of 10 keywords such as "apply", "resume" or "sponsorship" (`:149`).
- **Normalization** (`shared/normalize.ts:3`): lowercase, collapse whitespace, keep only `\p{L}\p{N}` plus `? ' -` (so it is Unicode/Cyrillic-safe), and drop a stopword list that includes "please", "kindly" and "tell".
- **Matching tiers** (`store/match.ts:14`):
  1. **Exact**: the normalized question is looked up through the IndexedDB `by-question` index. Confidence 1.0, minus 0.15 if the field kind (text/textarea/select/checkbox/radio/file) differs.
  2. **Fuzzy**: a linear scan of token Jaccard over every record. Keep matches at **≥ 0.45**, subtract 0.15 for a kind mismatch, and take the best.
  3. TODO: embeddings. `paraphrase/index.ts` calls `/api/paraphrase` with an 8 s timeout and falls back to the original text.
- **Learning loop** (`content/observer.ts:68-110`): on focus of an empty field, it queries and shows the suggestion card (Tab accepts, Esc skips, Edit lets you change it). On blur, it saves the value unless it equals the focus-time value or the accepted suggestion. History is append-only per question and skips a value identical to the last one; the latest answer wins (`background/index.ts:83`).
- Values are written through the native value setter, then `input`/`change` events are dispatched so React sees the edit (`content/capture.ts:77`).

---

## 9. Scheduling — **convention**

- In-app: `components/sync/DiscoveryAutoRefresh.tsx` runs a first tick 45 s after mount, then every `max(30, autoRefreshIntervalMinutes)` minutes (default 360). Each tick POSTs `/api/discover/run` and then `/api/discover/email-sync`. It only runs while a browser tab is open.
- Always-on: system cron or launchd hitting the same two endpoints every 6 h (`cv-maker/docs/email-alerts.md`). This needs the dev server running.
- Extension sync: `chrome.alarms` every 5 min.
- Missing: per-source cadence, backoff, run history, and any per-adapter rate-limit awareness. `/run` crawls everything in parallel with `maxDuration = 300`.

---

## Reusable for the new app

**Keep (port almost as-is):**
- **The adapter contract**: `fetch(ref) → JobPosting[]`, keyed by the `kind:ref` registry with `allSettled` isolation. Add a typed result `{ok, postings} | {ok:false, error}` so a failure is never mistaken for "zero jobs".
- **Reed** (Manchester), **Jooble with `|Bulgaria`** (Sofia), **dev.bg it-security**, **SmartRecruiters** and **Workday CXS** (Sofia enterprises: Bosch, A1), and **EURES with ESCO occupation filtering** (remote-EU cyber). These carry the verified yield.
- **Greenhouse, Lever and Ashby** for a company watchlist. They are cheap and reliable, but fix the Greenhouse id.
- **The JSON-LD-first extraction** (`careerpage.ts` and `extension/content.js`), with `@graph` flattening and MonetaryAmount salary. It works the same on the server and in the extension, so share one module.
- **The email-alert route** as the compliant way to reach LinkedIn and jobs.bg. Add a UID checkpoint and URL-based ids.
- **Click-to-capture from the autofill extension** (v2), with pairing and token auth plus the IndexedDB queue.
- **The Cyrillic location map and location-tier-first ranking.** Extend the map, and make the tokenizer Unicode-aware like `autofill-extension/src/shared/normalize.ts`.
- **The autofill label-derivation chain and the exact → fuzzy match tiers.**

**Drop or redo:**
- The v1 auto-capture extension, which is ToS grey. Also drop the in-memory ingest buffer, the legacy `/api/discover/fetch` route and the localStorage scoring state.
- Ids built from `postedAt`/`capturedAt`. Use canonical-URL ids plus cross-source fuzzy dedupe.
- Expiry that fires on failed fetches. Also drop the missing orphan purge: deleting a source must cascade, or mark its postings closed.
- The invented weights (0.30/0.25/0.30/0.10, 0.34/0.07, ×4 stretch). Treat them as placeholders, and calibrate against labelled saves and dismisses, or replace them with embeddings. Also fix substring alias matching (word boundaries, country codes) and the salary floor with no currency conversion.
- **Low-value adapters**: Jobicy, The Muse and Findwork (low or noisy yield), Arbeitnow (unverified), HN (US-heavy, weak fit for the target). Keep them only behind a toggle.
- Puppeteer in the careerpage path. It is heavy and rarely needed; prefer JSON-LD, or the extension, for JS-rendered sites.
