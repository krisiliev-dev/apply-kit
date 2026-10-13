# Source adapter API notes (checked 2026-10-11)

Fixtures are in `notes/fixtures/`. Each is one real response captured on 2026-10-11, trimmed to 2–3 postings, with descriptions cut and emails/street addresses redacted. Raw sizes are noted so you know what's been trimmed.

Evidence: **doc** = checked against the official docs today. **live** = confirmed by today's request. **unofficial** = no public docs; the endpoint is what the vendor's own site calls (keep polling low and expect it to change).

General rules for every adapter (from the spec + old bugs):
- Return a typed result: `{ ok: true, postings, complete: boolean } | { ok: false, error: { kind: "http"|"timeout"|"parse"|"auth", status? } }`. A 404 on a known board is `ok:false` (board renamed or deleted), **not** "zero jobs". If pagination stops early the result is `complete: false`, and the engine must not expire anything from a partial result. (The archive's Workday adapter returned partial pages from a `catch` as if they were complete.)
- Stable Posting id = `source kind + vendor's own job id` (or canonical URL when there's no id). **Never** a timestamp (archive bug: Greenhouse `updated_at` in the id).
- 15 s timeout, one request at a time per host, identify with a UA like `apply-kit/0.1 (personal job search; contact: <repo url>)`.
- Scheduler cadence is 30 min. For big boards that's more than needed: allow a per-source minimum interval (e.g. Microsoft/Amazon/EURES every 2–6 h).

## Field mapping summary

| Adapter | Stable id | Title | Company | Location | Remote | Salary | URL | Posted | Description |
|---|---|---|---|---|---|---|---|---|---|
| Greenhouse | `id` (job post id) | `title` | `company_name` | `location.name`, `offices[].location` | none (parse location text) | `metadata[]` custom fields; `pay_input_ranges` only on the detail endpoint | `absolute_url` | `first_published` (now in list too) | `content` (HTML-escaped HTML) with `content=true` |
| Lever | `id` (uuid) | `text` | none (store on source) | `categories.location`, `categories.allLocations[]`, `country` | `workplaceType` | `salaryRange{currency,interval,min,max}`, `salaryDescriptionPlain` | `hostedUrl` | `createdAt` (ms; present live, not in docs) | `openingPlain` + `descriptionBodyPlain` + `lists[]` + `additionalPlain` |
| Ashby | `id` (uuid; present live, not in docs) | `title` | none (store on source) | `location`, `secondaryLocations[]`, `address.postalAddress` | `isRemote`, `workplaceType` | `compensation.compensationTierSummary` / `scrapeableCompensationSalarySummary` | `jobUrl` | `publishedAt` | `descriptionPlain` |
| Recruitee | `id` (or `guid`) | `title` | `company_name` | `locations[]{city,country_code}`, `city`, `country_code` | `remote`, `hybrid`, `on_site` | `salary{min,max,period,currency}` | `careers_url` | `published_at` | `description` + `requirements` (HTML) |
| Personio | `<id>` | `<name>` | `<subcompany>` or source | `<office>` + `<additionalOffices>` | none | none (rarely in text) | build `https://{co}.jobs.personio.de/job/{id}` | `<createdAt>` | `<jobDescriptions><jobDescription><name/><value>CDATA</value>` |
| Teamtailor | `<guid>` | `<title>` | channel `<title>` | `<tt:locations><tt:location><tt:city>/<tt:country>` | `<remoteStatus>` (`none`/`hybrid`/`fully`…) | none | `<link>` | `<pubDate>` (RFC 822) | `<description>` (escaped HTML) |
| SmartRecruiters | `id` | `name` | `company.name` | `location{city,region,country,fullLocation}` | `location.remote`, `location.hybrid` | none in list | build `https://jobs.smartrecruiters.com/{companyId}/{id}` or `postingUrl` from detail | `releasedDate` | detail endpoint only (`jobAd.sections`) |
| Workday | req id = last `_NNN` of `externalPath` / `bulletFields[0]` | `title` | source label | `locationsText` (e.g. "BGR - SOFIA") | detail only | none | `{origin}/{site}{externalPath}` (+ locale prefix optional) | only relative text "Posted 11 Days Ago"; real date in detail | detail endpoint only |
| Microsoft | `id` (or `displayJobId`) | `name` | "Microsoft" | `locations[]`, `standardizedLocations[]` | `workLocationOption` (`onsite`/`hybrid`/`remote`?) | none | `https://apply.careers.microsoft.com` + `positionUrl` | `postedTs` (unix s) | not in search; detail endpoint (unverified) |
| Amazon | `id_icims` (or `id` uuid) | `title` | `company_name` (legal entity) | `normalized_location`, `city`, `country_code` (ISO3), `locations[]` (JSON strings) | `locations[].type` (`ONSITE`…) | none | `https://www.amazon.jobs` + `job_path` | `posted_date` ("May 19, 2026") | `description` + `basic_qualifications` + `preferred_qualifications` |
| dev.bg | `data-job-id` on the card | `.job-title` | `.company-name` | `.badge` text (Cyrillic, e.g. "София") | badge text (remote/hybrid) | none on list | `a.overlay-link[href*="/company/jobads/"]` | `.date` ("9 окт.", no year) | none (detail page) |
| Jooble | `id` if present, else canonical `link` | `title` | `company` | `location` | none (type/snippet text) | `salary` (free text) | `link` (Jooble redirect) | `updated` | `snippet` (HTML) |
| Reed | `jobId` | `jobTitle` | `employerName` | `locationName` | none | `minimumSalary`/`maximumSalary` + `currency` | `jobUrl` | `date` ("dd/mm/yyyy") | `jobDescription` (snippet; full text in details) |
| EURES | `id` (opaque base64) | `translations.en.title` ?? `title` | `employer.name` | `locationMap` keys (ISO2) → values (NUTS codes, e.g. BE213) | none | none in search | build `https://europa.eu/eures/portal/jv-se/jv-details/{id}?lang=en` | `creationDate` (ms) | `translations.en.description` ?? `description` (local language) |

---

## Greenhouse (doc + live) — fixture `greenhouse.json` (payhawkio, raw 44 jobs / 382 KB)
- `GET https://boards-api.greenhouse.io/v1/boards/{board_token}/jobs?content=true`. No auth. No pagination: the whole board in one response (`meta.total`). `content=true` adds `content`, `departments`, `offices`.
- Detail: `GET …/jobs/{job_id}?pay_transparency=true` adds `pay_input_ranges[]{min_cents,max_cents,currency_type,title,blurb}`. Use it only for jobs that pass the location filter (one extra request each).
- EU boards (`job-boards.eu.greenhouse.io/...`) are served by the same API host (live: payhawk `absolute_url` is on the EU host).
- `content` is **HTML-escaped HTML** (`&lt;p&gt;`): decode entities first, then strip tags. The list response also has `first_published`, `requisition_id`, `language`, `company_name`.
- robots.txt only disallows `/embed/`. No published rate limit; one request per board per check is fine.
- Docs: https://docs.greenhouse.io/job-board.html (moved from developers.greenhouse.io).

## Lever (doc + live) — fixture `lever.json` (siteground, raw 5 / 33 KB)
- `GET https://api.lever.co/v0/postings/{site}?mode=json`; **EU accounts:** `https://api.eu.lever.co/v0/postings/{site}?mode=json`. A site on the wrong host returns `404 {"ok":false,"error":"Document not found"}` (live). When adding a source, try global, then EU, and store the host on the source.
- Params: `skip`, `limit` (pagination), filters `location`, `commitment`, `team`, `department`, `level` (case-sensitive, repeatable = OR), `group`. Without `limit` the full list comes back. No auth for reads.
- Fields (doc): `id, text, categories{location,commitment,team,department,allLocations}, country (ISO2), opening(Plain), description(Plain), descriptionBody(Plain), lists[], additional(Plain), hostedUrl, applyUrl, workplaceType (unspecified|on-site|remote|hybrid), salaryRange{currency,interval,min,max}, salaryDescription(Plain)`. `createdAt` (ms) is present live but not documented, so treat it as optional.
- robots.txt for api.lever.co and jobs.lever.co: `Crawl-delay: 1`. Space requests 1 s apart across Lever sources.
- Docs: https://github.com/lever/postings-api

## Ashby (doc + live) — fixture `ashby.json` (Dext-Careers, raw 6 / 88 KB)
- `GET https://api.ashbyhq.com/posting-api/job-board/{JOB_BOARD_NAME}?includeCompensation=true`. No auth. No pagination. The board name is case-sensitive as in `jobs.ashbyhq.com/{name}`.
- Live response: `{ apiVersion, jobs[] }`. Each job has `id` (uuid, undocumented but present), `title, department, team, employmentType, location, secondaryLocations[], publishedAt, isListed, isRemote, workplaceType, address.postalAddress, jobUrl, applyUrl, descriptionHtml, descriptionPlain, compensation{compensationTierSummary, scrapeableCompensationSalarySummary, compensationTiers[], summaryComponents[]}`. Compensation is **per job** (the docs example shows it top-level; the live response has it per job).
- **No `organizationName`** in the live response (the archive read it; it falls back to the humanised slug). Store the company name on the Source instead.
- Skip `isListed: false`. The archive retried with `includeCompensation=false` on 400; keep that.
- Docs: https://developers.ashbyhq.com/docs/public-job-posting-api

## Recruitee (doc + live) — fixture `recruitee.json` (accedia, raw 5 / 29 KB)
- `GET https://{company}.recruitee.com/api/offers/` (also on custom domains: `https://careers.dronamics.com/api/offers/`). Optional `department`, `tag` filters. No auth, no pagination documented (all published offers). 404 → `{"error":"Not Found"}`.
- `location` can be misleading ("Remote job" while `city` is Sofia and `hybrid: true`); prefer `locations[]` + the remote/hybrid/on_site flags. `mailbox_email` is a per-offer apply inbox: don't store it.
- Docs: https://docs.recruitee.com/reference/offers

## Personio XML (doc + live) — fixture `personio.xml` (personio itself, 1 position)
- `GET https://{account}.jobs.personio.de/xml` (optional `?language=en|de|…`; worked live, but the docs page doesn't document it). Old `{account}-jobs.personio.de` was retired in 2021. Some accounts use `.jobs.personio.com`; try both when detecting.
- Root `<workzag-jobs>`, one `<position>` each: `id, subcompany, office, additionalOffices/office, department, recruitingCategory, name, jobDescriptions/jobDescription{name,value(CDATA HTML)}, employmentType, seniority, schedule, yearsOfExperience (e.g. 7-10), keywords, occupation, occupationCategory, createdAt`.
- No job URL in the feed: build `https://{account}.jobs.personio.de/job/{id}` (convention; check on the first real source). `yearsOfExperience` is a free structured hint for the "max years" dealbreaker.
- Parse with fast-xml-parser (keep CDATA). None of the watchlist companies uses Personio yet; the adapter is for added companies.
- Docs: https://developer.personio.de/docs/retrieving-open-job-positions

## Teamtailor RSS (doc + live) — fixture `teamtailor.xml` (superhosting, 1 item)
- `GET https://{company}.teamtailor.com/jobs.rss` (or `{custom careers domain}/jobs.rss`). The first 100 jobs by default; page with `?offset=100` and/or `?per_page=200` (official support article). Fetch until fewer than per_page items come back.
- Item: `title, description (escaped HTML), pubDate, link, remoteStatus, guid, tt:locations/tt:location{tt:name,tt:address,tt:zip,tt:city,tt:country}, tt:department, tt:role`. Namespace `xmlns:tt="https://teamtailor.com/locations"`. The channel `title` is the company. City names may be Cyrillic in `tt:name`; use `tt:city`.
- Docs: https://support.teamtailor.com/en/articles/11171756-rss-feed-how-to-guide

## SmartRecruiters (doc + live) — fixture `smartrecruiters.json` (Gameloft, country=bg)
- `GET https://api.smartrecruiters.com/v1/companies/{companyIdentifier}/postings?country=bg&limit=100&offset=0`. The spec lists security as **none / `x-smarttoken` key / OAuth**; the key or OAuth scope is needed only for `destination=INTERNAL*`, so public postings without a key is documented behaviour, not a loophole.
- Params: `q, limit (max 100), offset, destination, locationType[] (REMOTE|HYBRID|ONSITE|ANY), country, region, city, department, jobAdId, language, releasedAfter, customField`. Paginate with `offset` until `offset+limit >= totalFound` (the archive fetched only 100; Bosch has 4933 in total, so always filter by country).
- Response `{offset, limit, totalFound, content[]}`; each item has `id, uuid, name, jobAdId, refNumber, ref (API detail URL), company{identifier,name}, releasedDate, location{city,region,country,remote,hybrid,fullLocation}, industry, department, function, typeOfEmployment, experienceLevel, customField[], language, visibility`. The spec includes `creator{name}` (a recruiter's name: **don't store it**; null in today's sample).
- Detail: `GET …/postings/{id}` → `jobAd.sections{companyDescription,jobDescription,qualifications,additionalInformation}{title,text}`, `applyUrl`, `postingUrl`, `active`. Needed for extraction (the list has no description). Note from the spec: content edits only show after the job is re-posted.
- Expiry key must include the country filter (`smartrecruiters:BoschGroup:bg`; old bug 4).
- Docs: https://developers.smartrecruiters.com/reference/v1listpostings.md , https://developers.smartrecruiters.com/reference/v1getposting.md

## Workday CXS (unofficial, live) — fixture `workday.json` (dxctechnology/DXCJobs, searchText "Sofia", limit 3)
- `POST {origin}/wday/cxs/{tenant}/{site}/jobs` with JSON `{"appliedFacets":{},"limit":20,"offset":0,"searchText":""}`. **limit max 20** (larger values are rejected by most tenants). Response `{ total, jobPostings[]{title, externalPath, locationsText, postedOn, bulletFields[]}, facets[], userAuthenticated }`.
- Parse a careers URL `https://{tenant}.wd{N}.myworkdayjobs.com/{locale?}/{site}` → tenant = first host label, site = last path segment (the archive's `parseRef`). The cxs tenant is almost always the host label, but verify on add (404 means a mismatch).
- **Filter server-side by country** instead of `searchText` or paging everything: `facets[]` lists `locationCountry` values with ids (live, DXC: Bulgaria `25f4875dc598484dbeee857eb2d81652`; possibly a Workday-global id, but read it per tenant rather than assuming that); send `"appliedFacets":{"locationCountry":["<id>"]}`. Some tenants name the facet `locations` / `Location_Country`, so read it from the first response's facets.
- `total` is only reliable on the first page (offset 0); store it then. Page until `offset >= total`; the archive's 100 cap silently truncated big tenants. Treat a truncated fetch as `complete:false`.
- Detail: `GET {origin}/wday/cxs/{tenant}/{site}{externalPath}` → `jobPostingInfo{ title, jobDescription (HTML), location, additionalLocations[], timeType, startDate (ISO), jobReqId, externalUrl, remoteType? }` (convention, widely used; not captured today). Needed for posted date + description.
- Often behind bot protection; one search POST per check, never crawl. Grey area per the research doc: polite, low frequency.

## Microsoft (unofficial, live) — fixture `microsoft.json` (query "security engineer", Dublin, raw 14 hits)
- `GET https://apply.careers.microsoft.com/api/pcsx/search?domain=microsoft.com&query={q}&location={place}&start={n}&sort_by=timestamp`. No auth. **Page size is fixed at 10** (`num` ignored); page with `start += 10` until `start >= data.count`.
- Response `{ status, error{message,body}, data{ count, positions[], appliedFilters{includeRemote, includeRelocation}, sortBy, … } }`. Position: `id, displayJobId, atsJobId, name, locations[] ("Ireland, Dublin, Dublin"), standardizedLocations[] ("Dublin, D, IE"), postedTs, creationTs (unix seconds), department, workLocationOption, locationFlexibility, positionUrl ("/careers/job/{id}")`.
- `location=Bulgaria` returned `count: 0` today (watchlist note: no Sofia roles). Useful for remote-EU queries; `includeRemote` defaults to 1.
- robots.txt: `Disallow: /` but explicitly `Allow: /api/pcsx` and `/careers`. A position-detail endpoint exists under `/api/pcsx/` (not verified); otherwise use the user's paste/capture for the full text.

## Amazon (unofficial, live) — fixture `amazon.json` (base_query "security engineer", raw 283 hits)
- `GET https://www.amazon.jobs/en/search.json?base_query={q}&result_limit=10&offset=0&sort=recent` (+ location filters). No auth. Response `{ error, hits, facets, jobs[], content, job_posting_search_request }`.
- `loc_query=Dublin, Ireland` **did not filter** (the results were Seattle). Filter by country with `normalized_country_code[]=IRL` (ISO-3; `BGR` returned 0 per the watchlist note), or `country=IRL`, and check `country_code` on each job client-side anyway. Not verified today; confirm on the first build.
- Job: `id (uuid), id_icims, title, company_name, job_path, location, locations[] (each a JSON string: parse it), normalized_location, city, country_code (ISO3), posted_date ("May 19, 2026"), updated_time ("12 days"), description, basic_qualifications, preferred_qualifications, job_schedule_type, url_next_step, team, job_category`.
- The qualifications fields come pre-split into required/preferred, which is useful for extraction.
- robots.txt only disallows `/internal` paths.

## dev.bg (server-rendered HTML, live) — fixture `devbg.html` (it-security, 3 of 21 cards)
- `GET https://dev.bg/company/jobs/{category}/` (e.g. `it-security/`). robots.txt (live) disallows only an events path for `*` (and everything for JoobleBot). One GET per category, with a polite UA.
- Card `div.job-list-item[data-job-id]`: **use `data-job-id` as the stable id** (the archive used url+title). `h6.job-title`, `span.company-name`, `span.date` ("9 окт." = Bulgarian month abbreviation, no year: infer the year so it isn't in the future), `span.badge` (location; the `img alt` and text are Cyrillic, e.g. "София"; tooltips in `.badge-tooltip`), link `a.overlay-link[href*="/company/jobads/"]`.
- 21 cards on page 1 today, with no pagination links found. If a category grows past one page, look for `/page/N/` links before assuming completeness.
- Archive bug: `\b…софия\b` never matches (JS `\b` is ASCII-only); match Cyrillic with `(?<![\p{L}])софия(?![\p{L}])` under the `u` flag, or normalise first.

## Jooble (key required; shape from archive, verified yield) — no fixture (key is in `.env`)
- `POST https://jooble.org/api/{API_KEY}` with JSON `{ "keywords": "...", "location": "Bulgaria", "page": "1" }` (other fields some docs mention: `radius`, `salary`, `ResultOnPage`, `datecreatedfrom`, `companysearch`; unconfirmed). Response `{ totalCount, jobs[]{ title, location, snippet, salary, source, type, link, company, updated, id } }`.
- The official page (https://jooble.org/api/about) shows docs only after a key request. Treat the key as a secret; it sits in the URL path, so **never log request URLs**.
- Known quirks (archive, verified): `Sofia` returns 0, so use `Bulgaria`. With no location the results flood with US roles. `link` is a Jooble redirect (`jooble.org/desc/…`), so cross-source merge needs the title+company+city key.
- Capture a fixture with the real key in the implementing session (from the app, not by reading `.env` here).

## Reed (doc; key required) — no fixture
- `GET https://www.reed.co.uk/api/1.0/search?keywords=&locationName=&distanceFromLocation=10&resultsToTake=100&resultsToSkip=0` (also `minimumSalary, maximumSalary, permanent, contract, fullTime, postedByDirectEmployer, graduate, employerId`). Auth: **Basic with the API key as username, empty password**. `resultsToTake` max 100; page with `resultsToSkip`.
- Search fields (archive + docs): `jobId, employerId, employerName, jobTitle, locationName, minimumSalary, maximumSalary, currency, expirationDate, date (dd/mm/yyyy), jobDescription (snippet), applications, jobUrl`. Details: `GET /api/1.0/jobs/{jobId}` adds full description, yearly min/max, salaryType, contractType, jobType, externalUrl.
- UK only. Low relevance for Sofia/EU-remote, but the spec keeps it. No published rate limit.
- Docs: https://www.reed.co.uk/developers/jobseeker

## EURES (unofficial portal API, live) — fixture `eures.json` (2 ESCO ICT-security occupations, raw 1395 hits)
- `POST https://europa.eu/eures/api/jv-searchengine/public/jv-search/search` with the full body the archive uses (`cv-maker/lib/discovery/sources/jobapis.ts:220-268`): `resultsPerPage (≤50), page, sortSearch "MOST_RECENT", keywords[{keyword, specificSearchCode:"EVERYWHERE"}], occupationUris[], locationCodes ["bg"], requestLanguage "en", sessionId`, plus every other filter array empty. No auth. Response `{ numberRecords, jvs[], facets }`.
- jv: `id, title, description (local language HTML), creationDate, lastModificationDate (ms), numberOfPosts, locationMap {ISO2: [NUTS codes]}, euresFlag, jobCategoriesCodes [ESCO URIs], positionScheduleCodes, positionOfferingCode, employer{name, website…}, availableLanguages, translationType, translations{lang:{title,description}}`.
- Today's sample: the first results were **Dutch-only** postings (no `en` translation). Extraction must handle any EU language, or keep EURES behind a language filter (`requiredLanguages` / `availableLanguages`).
- Location is `ISO2` + NUTS (e.g. `BE213`), so map ISO2 → country name before location matching (old gotcha: "AT, MT" never matched aliases).
- ESCO occupation URIs: look them up at https://esco.ec.europa.eu/en/classification/occupation_main. The archive's 6 ICT-security URIs are at `jobapis.ts:220`. For dev/design angles add software developer / UX designer occupations.
- No official public API docs for this search endpoint (the portal's own backend). It's the EU public employment portal, open data in spirit; keep it to 1 call per check, every few hours.
