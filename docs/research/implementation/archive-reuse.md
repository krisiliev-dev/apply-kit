# Archive reuse guide (cv-maker / autofill-extension → apply-kit Discover)

**Where the archive lives now:** ticket #2 merged on `discover` (060f386), and the archive dirs are gone from the working tree. Read files with `git show 0e01bba:<path>` (or the `archive-2026-10` tag / `archive/cv-maker-applications-tracker` branch). All line numbers below are from `0e01bba`.

Companion notes: `ats-apis.md` (endpoints, field maps, fixtures), `docs/knowledge/job-discovery.md` (the bug list this builds on).

Verdict key: **PORT** = copy the logic, adapt to the new types. **REWRITE** = keep the idea, change the code. **DROP** = don't reuse.

## 0. Cross-cutting changes for every adapter

The old contract is `fetchPostings(ref): Promise<JobPosting[]>`, with every error swallowed into `[]` (`types.ts:43` shape). Change three things everywhere:
1. **Typed result, not `[]`.** `{ok:true, postings, complete}` / `{ok:false, error}`. Every old adapter has `if (!res.ok) { if (404||429) return []; return []; }` (e.g. `greenhouse.ts:30-35`). That is exactly bug 2: a failure reads as "zero jobs" and expiry closes everything.
2. **Stable ids from vendor ids.** Old `stableId([...])` (`id.ts:6`, FNV-1a 32-bit) hashed `kind+url+postedAt` for greenhouse/lever/ashby (`greenhouse.ts:54`, `lever.ts:49`, `ashby.ts:66`), so every edit made a new row. New: `"{kind}:{sourceKey}:{vendorId}"` as a plain string (no hash needed; SQLite TEXT PK), or a canonical URL when there's no vendor id.
3. **Inject `fetch` and the clock.** The old adapters call the global `fetch` and `Date.now()` and read `process.env` directly (`jooble.ts:33`, `jobapis.ts:88`). The engine must inject them so fixtures drive the tests.

Shared helpers to write once in `packages/core` (currently duplicated 5×): `htmlToText` (decode entities **then** strip tags: Greenhouse's `content` is HTML-escaped, see `greenhouse.ts:90`; the others only strip), `humanizeSlug` (`greenhouse.ts:66`, `lever.ts:84`, `ashby.ts:94`), `parseDate`.

## 1. Source adapters

### Greenhouse — `cv-maker/lib/discovery/sources/greenhouse.ts` — PORT with fixes
- Request: `GET https://boards-api.greenhouse.io/v1/boards/{slug}/jobs?content=true`, `accept: application/json`, no timeout.
- Response used: `{ jobs: [{ id, title, absolute_url, location:{name}, content, updated_at, metadata:[{name,value}], company_name }] }`.
- Keep: `findMetadataValue` (`:74`) for salary-ish custom fields; the entity-decoding `htmlToText` (`:90`).
- Fix: id → `id` (job post id), not `absolute_url+updated_at` (`:54`). postedAt → `first_published` (now in the list response), not `updated_at`. Add a timeout. Salary: also offer the detail call `?pay_transparency=true` (see ats-apis.md).

### Lever — `sources/lever.ts` — PORT with fixes
- Request: `GET https://api.lever.co/v0/postings/{slug}?mode=json`. Response: an array of `{ id, text, hostedUrl, applyUrl, createdAt, categories{location,team,commitment,department}, descriptionPlain, description, additionalPlain, salaryDescriptionPlain, salaryRange{min,max,currency} }`.
- Keep: `formatSalary` (`:65`), but carry `salaryRange.interval` too, and store structured min/max/currency instead of a string.
- Fix: id → `p.id` (`:49` used hostedUrl+createdAt). Support the EU host `api.eu.lever.co` (not handled at all). Description: `descriptionPlain` alone misses `lists[]` (the requirements bullets live there). Concatenate `openingPlain`, `descriptionBodyPlain`, `lists[].text + content`, `additionalPlain`. Use `workplaceType` and `country` (both ignored). Respect `Crawl-delay: 1`.

### Ashby — `sources/ashby.ts` — PORT with fixes
- Request: `GET https://api.ashbyhq.com/posting-api/job-board/{slug}?includeCompensation=true`, retry with `=false` on any non-OK (`:31-41`). Response used: `{ jobs:[{ id, title, locationName, publishedDate, jobUrl, descriptionHtml, descriptionPlain, compensation }], organizationName }`.
- **Field names are stale:** the live API returns `location` (not `locationName`) and `publishedAt` (not `publishedDate`), and has **no `organizationName`** (`ashby.ts:16-19,51`). So the old adapter produced no location and no date, and always used the humanised slug as company. Verified against today's fixture.
- Keep: `extractAshbyCompensation` (`:81`); the 400 retry. Add `isRemote`, `workplaceType`, `secondaryLocations`; skip `isListed:false`. id → `id`.

### SmartRecruiters — `sources/smartrecruiters.ts` — PORT with fixes
- Request: `GET https://api.smartrecruiters.com/v1/companies/{companyId}/postings?limit=100[&country=xx]`, 15 s timeout. Ref `"companyId"` or `"companyId:cc"` via `parseRef` (`:12`, keep). Response used: `{ content:[{ id, uuid, name, releasedDate, company{name}, location{city,region,country,remote} }] }`.
- URL built as `https://jobs.smartrecruiters.com/{companyId}/{id}` (`:59`): keep it, already stable (`stableId(["smartrecruiters", url])`).
- Fix: paginate (`offset` until `totalFound`; the old code is single-page, max 100). Use `location.hybrid`/`fullLocation`. Fetch detail `/postings/{id}` for the description (list has none), only for postings in Kris's locations. Expiry key must include the country (`BoschGroup` vs `BoschGroup:bg` collided: old bug 4, `run/route.ts` keyed on `source.company`).

### Workday — `sources/workday.ts` — PORT `parseRef`, REWRITE the fetch
- Request: `POST {origin}/wday/cxs/{tenant}/{site}/jobs`, body `{limit:20, offset, searchText:"", appliedFacets:{}}`, loop `offset < 100` (`:44`). Response used: `{ total, jobPostings:[{ title, locationsText, externalPath }] }`. URL = `${origin}/${site}${externalPath}` (`:61`).
- Keep: `parseRef` (`:12`, careers URL → origin/tenant/site).
- Fix: the **100 cap** (`:44`) silently truncates (Broadcom has 385). Filter with `appliedFacets.locationCountry` instead. **Partial results on error**: the `catch {}` at `:72` returns whatever was collected as if complete, so expiry then closes the rest. Mark it `complete:false`. id → req id from `bulletFields[0]` / `externalPath` suffix. Fetch the detail for date + description.

### dev.bg — `sources/devbg.ts` — PORT the parser (`parseDevBg`, `:44`, pure and cheerio-based)
- Request: one `GET` of a category URL (`https://dev.bg/company/jobs/it-security/`), browser UA, 20 s timeout, no pagination. Parse `.job-list-item` → `a[href*="/company/jobads/"]`, `.job-title`, `.company-name`, `.badge` (with `.badge-tooltip` removed).
- Fix: id → `data-job-id` attribute (present live) instead of `careerpage+url+title` (`:80`). Location regex at `:73-75` uses `\b…софия\b`, which never matches Cyrillic (it falls through to `badges[0]`, so it worked by accident). Parse `.date` ("9 окт.") into postedAt (Bulgarian month map). Source kind should be `devbg`, not `careerpage`. Fixture: `notes/fixtures/devbg.html`. Old test: `cv-maker/tests/discovery/devbg.test.ts`.

### Jooble — `sources/jooble.ts` — PORT
- Request: `POST https://jooble.org/api/{KEY}`, body `{keywords, location, page:"1"}`, 15 s timeout. Ref `"keywords|location"` (`parseRef`, `:12`). Response used: `{ jobs:[{ title, location, snippet, salary, source, link, company, updated, type }] }`.
- Keep: field mapping (`:55-70`), `id` from link (stable). Fix: throw → typed `{ok:false, error:"auth"}` when the key is missing (`:34`). The key is in the URL path, so never log the URL. Page beyond 1 if `totalCount` > results. Remember `Bulgaria`, not `Sofia`.

### Reed — `sources/jobapis.ts:87 fetchReed` — PORT
- Request: `GET https://www.reed.co.uk/api/1.0/search?resultsToTake=100&keywords&locationName`, header `authorization: Basic base64("KEY:")` (`:94`). Response used: `{ results:[{ jobId, jobTitle, employerName, locationName, minimumSalary, maximumSalary, currency, jobDescription, date (dd/mm/yyyy), jobUrl }] }`.
- Keep: `parseUkDate` (`:35`), salary assembly (`:101-104`). id → `jobId`. Add `resultsToSkip` paging.

### EURES — `sources/jobapis.ts:248 fetchEures` — PORT
- Request: `POST https://europa.eu/eures/api/jv-searchengine/public/jv-search/search`, the full body at `:251-277` (resultsPerPage 50, page 1, `sortSearch:"MOST_RECENT"`, keywords or `occupationUris`, `locationCodes:[cc]`, `requestLanguage:"en"`, every other filter `[]`/`null`). Response used: `{ jvs:[{ id, title, description, creationDate, locationMap, employer{name}, translations{en{title,description}} }] }`. URL `https://europa.eu/eures/portal/jv-se/jv-details/{id}?lang=en`.
- Keep: `ICT_SECURITY_OCCUPATIONS` (`:220`) + the alias swap (`CYBER_ALIASES`, `:228`). Generalise it to per-angle ESCO lists (dev, sec, design) in source config, not a hard-coded alias check.
- Fix: location = `Object.keys(locationMap)` gives "BE, NL" (ISO2), which no alias matched (gotcha in job-discovery.md). Map ISO2 → country names. Many postings have no English translation (today's fixture: Dutch only).

### Not in the new spec, so don't port: Remotive, Jobicy, The Muse, Findwork (`jobapis.ts:122/146/180/299`), Arbeitnow, HN (`hnHiring.ts`), the generic RSS adapter. **But** reuse the `fast-xml-parser` setup from `sources/rss.ts:35-39` (`ignoreAttributes:false, attributeNamePrefix:"@_"`) for **Teamtailor RSS** and **Personio XML**. `resolveLink` (`rss.ts:97`) handles string vs `@_href` links.

### New adapters with no archive code: Recruitee, Personio, Teamtailor, Microsoft, Amazon (see ats-apis.md + fixtures).

## 2. Location / Cyrillic normalisation — `cv-maker/lib/discovery/location.ts` — REWRITE (keep the data)
- Keep the map (`:7-17`): софия→sofia, пловдив→plovdiv, варна, бургас, русе, българия (+ misspelling българиа)→bulgaria, дистанционно→remote, хибрид→hybrid, белград→belgrade. Extend it with: стара загора, велико търново, плевен, благоевград, сливен, габрово, шумен, добрич; "град софия"/"гр. софия"/"sofia city"/"sofia-grad"; "в офиса"/"офис"→on-site; "частично дистанционно"→hybrid; "изцяло дистанционно"→remote. ISO codes: BG/BGR → bulgaria; plus ISO2 → country for EURES, SR `country:"bg"`, Amazon `BGR`, Workday "BGR - SOFIA".
- Fix the matcher (`locationMatches`, `:28`): plain `includes` gives "uk"⊂"ukraine" and "eu" inside words. New: Unicode tokenise (`/[\p{L}\p{N}]+/gu`, from `autofill-extension/src/shared/normalize.ts:3`), then match whole tokens / token sequences. Never use `\b` with Cyrillic (JS `\b` is ASCII-only, `devbg.ts:73`, `content.js:135`).
- Location groups (spec): Sofia and remote-EU first (equal), relocation (Switzerland, Spain) separate. Make "remote" only count as remote-EU when no non-EU restriction is present ("Remote - US" must not match). Old tests worth reading: `cv-maker/tests/discovery/location.test.ts`.

## 3. Email-alert parsing — `cv-maker/lib/discovery/email/` — PORT parsers, REWRITE transport
**Transport `imap.ts:23 fetchRecentAlerts`** — REWRITE:
- Old: `imapflow` 1.x, `imap.gmail.com:993`, `getMailboxLock(mailbox)` **without `readOnly`** (`:51`). That's SELECT, not EXAMINE, against the spec's read-only rule. Searches `since now-14d`, takes the last 60 UIDs, fetches `{source:true}`, `simpleParser` → `{from, subject, html|textAsHtml, date}`.
- New: `getMailboxLock(box, { readOnly: true })` (imapflow 2.x supports it, see stack.md §8). Checkpoint `(uidValidity, lastUid)` in SQLite. Record `messageId` + `uid` per parsed email (spec: quiet-alert detection needs per-sender email timestamps). Mail reader is an injected port.

**Parsers `parse.ts:12 parseAlertEmail`** — PORT, routed by `From`:
- LinkedIn (`:26`): `a[href*="/jobs/view/"]`, id `/jobs/view/(\d+)`, canonical `https://www.linkedin.com/jobs/view/{id}`, company/location = the first two segments of `closest("td, tr, table, div")` text split on `\s{2,}|·|\|` (`:41-45`). **Keep the canonicalisation**; id = `linkedin:{jobId}`. The closest-container heuristic is fragile; re-tune on real emails.
- jobs.bg (`:57`): `a[href*="/job/"]` matching `/job/\d{4,}`, company hard-coded "jobs.bg", href used raw (possibly a tracking redirect). Fix: extract the numeric id → `https://www.jobs.bg/job/{id}`, and parse the company from the card.
- Generic (`:83`): any `http` anchor with 5–140 chars matching `JOB_TITLE_RE` (`:80`), deduped by title, max 40. Keep it as a fallback but mark these postings low-confidence.
- New senders in the spec without archive parsers: Google, Apple, Meta careers alerts, Workday alerts, MyGreenhouse. Need real sample emails for fixtures. **The archive's parsers were tuned on synthetic fixtures** (`cv-maker/tests/discovery/emailParse.test.ts`), so collect real ones first (forward a few alerts to the job mailbox, save `.eml` with personal bits redacted).
- Fix: postings from email used `capturedAt` in the id (`ingestBuffer.ts:52`), so every repeat alert duplicated. Use the canonical job URL/id. Strip tracking params (`utm_*`, `trk`, `refId`, `trackingId`).

## 4. JSON-LD capture extraction — PORT into ONE shared module (`packages/core`, DOM-free)
Two near-identical copies exist:
- Server: `cv-maker/lib/discovery/sources/careerpage.ts` → `extractJsonLd` (`:83`), `flattenLd` (`:112`, arrays + `@graph`), `isJobPosting` (`:129`, string or array `@type`), `jobPostingFromLd` (`:136`), helpers `orgName` (`:243`), `jobLocation` (`:249`, first `jobLocation.address` → locality/region/country), `remoteHint` (`:263`, `jobLocationType` TELECOMMUTE).
- Extension: `cv-maker/extension/content.js` → `fromJsonLd` (`:49`) + `salaryFromLd` (`:34`, MonetaryAmount `value.minValue/maxValue/value` + `unitText` + `currency`).
- Merge into one pure function `extractJobPostingsFromLd(jsonTexts: string[], pageUrl)` that both the server (paste-a-link, #17) and the extension (#18) call. Take the union of fields: careerpage lacks salary, content.js lacks `remoteHint`/`datePosted`. Also read `identifier.value` (often the ATS req id: a good stable id), `validThrough` (expiry signal), `employmentType`, `applicantLocationRequirements` (remote eligibility: important for remote-EU), and all `jobLocation[]` entries (the old code took only `[0]`).
- Fixes: description cut to 1200 (careerpage `:159`) vs 4000 (extension). Store the full text for AI extraction and truncate only for display. `url` fallback `node.url ?? sameAs ?? pageUrl` (`:145`) is good. Strip HTML with a real parser, not regex, and decode entities.
- DOM fallbacks to keep in the extension only: the `fromHeuristic` h1 + company guess (`content.js:97`), and the **jobs.bg detail special case** `fromJobsBg` (`content.js:117`: `.job-view-title`, company from og:title `обява за работа от X` / `job ad from X`, Cyrillic city regex without `\b`, canonical URL, description+salary from the same-origin `#customJobIframe`). Verified on real pages per the research note.
- Per-site selector adapters from `autofill-extension/src/content/jobCapture.ts` (LinkedIn `:63`, Indeed, Glassdoor; selector lists semantic-first then testids, `canonicalUrl()` `:55`). Useful for single-page capture on LinkedIn, where JSON-LD is often absent when signed in.
- **DROP** the v1 auto-capture (`content.js:203-232`, `autoCapture: true` default, `setInterval` URL polling). Keep v2's click-only rule (`jobCapture.ts:10`). Search-results capture (spec #74) is new: read only rendered list cards, never scroll or page.
- Old tests: `cv-maker/tests/discovery/careerpage.test.ts`.

## 5. Extension ↔ service sync — REWRITE, borrow pieces
- `autofill-extension/src/background/discoverySync.ts`: paired POST to `/api/pair/ingest` with `authorization: Bearer {token}` + `x-device-id`, body `{items:[payload]}` (`:88-100`). On 401/403 stop and ask to re-pair. Batches of 25 every 5 min via `chrome.alarms`, legacy unauthenticated fallback (`syncOneLegacy`, `:64`). **Drop the legacy path**, and send immediately on click rather than on a 5-minute alarm.
- `autofill-extension/src/shared/pairing.ts`: the token is stored in **`chrome.storage.sync`** (`:32`), which syncs to the Google account. Use `storage.local` (or `storage.session` + re-pair). Keep `normalizeWebAppUrl` (`:88`). Drop the unused ECDSA keypair.
- `autofill-extension/src/store/db.ts`: IndexedDB `discoveryQueue` (by-url, by-sync). The spec says the extension "stores nothing", so at most keep an in-memory retry while the service is down, and show "app not running".

## 6. Autofill matching (not Discover; for the later Apply feature) — PORT as-is
- `autofill-extension/src/content/fieldContext.ts`: `deriveLabel` (`:52`, label[for] → wrapping label → aria-labelledby → aria-label → placeholder → nearest legend/heading/.question within 5 ancestors (`:89`) → humanised name → "Unlabeled field"), `SKIP_INPUT_TYPES` (`:6`), `fieldKindOf` (`:27`), `pageLooksLikeApplication` (`:149`, ≥2 of 10 keywords).
- `autofill-extension/src/shared/normalize.ts`: `normalizeQuestion` (`:3`, Unicode-safe `\p{L}\p{N}`), `tokenize` (`:12`), `jaccard` (`:69`). **Reuse `tokenize` now for Discover location/title matching** (fixes "Cyrillic stripped from ranking": old `scoring.ts:148` kept only `[a-z0-9+.#-]`).
- `autofill-extension/src/store/match.ts:14 findBestMatch`: exact normalised question (conf 1.0, −0.15 if the field kind differs) → fuzzy Jaccard ≥ 0.45. Thresholds are invented.
- `autofill-extension/src/content/capture.ts:77 setNativeValue`: native value setter + `input`/`change` events so React forms register edits. Needed for Apply.

## 7. Bugs to not repeat (checklist for the engine tests)
1. Failure → `[]` → expiry closes everything (all adapters; `run/route.ts:113-120` also marked rejected sources as crawled).
2. Timestamp ids (`greenhouse.ts:54`, `lever.ts:49`, `ashby.ts:66`, `ingestBuffer.ts:52`).
3. Partial pagination treated as complete (`workday.ts:72`).
4. Stale Ashby field names (`locationName`/`publishedDate`/`organizationName`) give silently empty fields. Assert on fields in fixture tests.
5. Shared expiry key across ref variants (SmartRecruiters `company` without country).
6. Captured/emailed postings never expire (fall into `default: return p.source.kind`). Spec: re-verify via ATS, or mark "unverified after 30 days".
7. Orphans on source delete (`serverStore.ts:226`). Removal closes only uncovered jobs with reason "source removed".
8. `\b` around Cyrillic (`devbg.ts:73`); ASCII-only tokenizer (`scoring.ts:148`); substring alias matching (`location.ts:36`).
9. Open CORS `*` with no auth on ingest (`app/api/discover/ingest`).
10. IMAP opened read-write (`imap.ts:51`).
11. Salary floor without currency conversion (`scoring.ts:222,361`). New: store amount + currency + period, convert to EUR for the dealbreaker.
