# CV Autofill — Chrome MV3 Extension

A browser extension that watches you fill out job-application forms, quietly
builds a local Q&A knowledge base, and suggests your previous answers the next
time a similar question shows up.

**The extension never auto-submits. You always press the real submit button.**

---

## Build & load

```bash
npm install
npm run build
```

That produces a `dist/` folder. To load it in Chrome:

1. Open `chrome://extensions`.
2. Toggle **Developer mode** (top right).
3. Click **Load unpacked** and select the `dist/` folder.
4. Pin the extension from the toolbar if you want the popup button handy.

For development with HMR: `npm run dev` (then load `dist/` as unpacked;
`@crxjs/vite-plugin` rebuilds in place).

## How the Q&A store works

- Every time you blur a form field with a value different from both the focus
  value and any suggestion, the content script sends a `saveAnswer` message to
  the background service worker.
- The service worker normalizes the question text (lowercased, stopwords
  stripped, punctuation squashed) and either appends to the existing record or
  creates a new one. History is kept — each `AnswerRecord` has a list of
  `{ value, at, url }` entries.
- Storage is IndexedDB (via `idb`) inside the extension context. Nothing leaves
  your browser.
- On focus of a new field, the content script asks for the best match:
  1. **Exact match** on normalized question (index lookup).
  2. **Fuzzy fallback** — Jaccard token similarity over all records, with a
     small penalty when the field kind (text vs. textarea vs. select…) differs.
- If a match passes the confidence floor, a shadow-DOM tooltip appears below
  the field with **Accept / Edit / Skip** and keyboard shortcuts (Tab to
  accept, Esc to dismiss).

## What is a "recognized form"?

Heuristic, deliberately loose. A form is treated as a job-application form if:

- The page as a whole looks like one — title + body contain at least two of:
  `apply`, `application`, `resume`, `cv`, `cover letter`, `work authorization`,
  `sponsorship`, `why do you want`, `tell us about`, `years of experience`.
- Or, the specific `<form>` element's inner text mentions
  `apply|application|resume|cv|cover letter`.

If neither is true, the observer stays silent on that form — no tooltips, no
captures. This is intentional so we don't pollute the store with login emails,
search queries, etc.

The detector runs once on `document_idle` and again whenever a `MutationObserver`
notices new nodes (SPA re-renders like Greenhouse, Lever, Ashby, Workday).

## Popup

Click the toolbar icon. The popup has two tabs:

### Q&A tab

- Total entry count.
- Search / filter across questions and answers.
- Edit an entry (saved as a new version; history kept).
- Delete an entry.
- **Export JSON** / **Import JSON** (merge mode) — for backup or moving between
  browsers.

### Discovery tab

- Count of captured jobs (total / synced / pending).
- List of captured postings (title, company, location, salary, source, date).
- Per row: *Open URL*, *Sync now* (while pending), *Delete*.
- Footer: **Web app URL** config + **Sync all now** button.

## Discovery queue (LinkedIn / Indeed / Glassdoor)

A second content script (`src/content/jobCapture.ts`) runs **only** on the
three job boards. When the current URL is a job-detail page, it pulls the
posting's title, company, location, salary, description, and posted-at from
the DOM already rendered in your tab, and drops a small pill into the
bottom-right of the viewport: *"Save to discovery queue"*.

- **No scraping.** The extension only reads the DOM of pages you're already
  viewing. It never makes background HTTP requests to LinkedIn / Indeed /
  Glassdoor, never follows links, never paginates.
- **No auto-capture.** Nothing is saved until you click the pill.
- Captured jobs are written to a second IndexedDB object store
  (`discoveryQueue`) before any network attempt — works fully offline.
- After a successful local save, the background worker POSTs the record to
  `${cvMakerBaseUrl}/api/discover/ingest`. 2xx marks it synced; anything
  else (404, network error, 5xx) leaves it pending and the next sync retries.
- Configure `cvMakerBaseUrl` from the popup's Discovery tab. Default
  `http://localhost:3000`. Stored in `chrome.storage.sync` under
  `cvMakerBaseUrl`.

## Paraphrase

`src/paraphrase/index.ts` exposes:

```ts
paraphrase(text: string, ctx: ParaphraseContext): Promise<string>
```

It POSTs `{ text, context }` to `${cvMakerBaseUrl}/api/paraphrase`. If the
endpoint is absent (404), unreachable, or slow (>8s timeout), it falls back
to returning the input unchanged — so the autofill pipeline keeps working
even before the web app ships its paraphrase endpoint. The
`embedQuestion` background handler is still stubbed (heavier endpoint,
deferred); it returns `null` so callers can feature-detect.

## Out of scope right now

Each of these is flagged in `src/content/observer.ts` as a `// TODO`:

- Real LLM paraphrase.
- Cross-device sync / encryption.
- Auth between the extension and the CV-maker web app.
- Auto-submit (this one is a permanent no, not a TODO).
- Captcha / anti-bot handling.
- Advanced field-kind detection (rich text editors, combobox popovers, date
  pickers, tag inputs).

## Layout

```
src/
  manifest.ts                MV3 manifest (defineManifest from @crxjs/vite-plugin)
  background/
    index.ts                 service worker — owns IndexedDB, message bus
    discoverySync.ts         POSTs captured jobs to CV-maker /api/discover/ingest
  content/
    observer.ts              autofill content script — DOM walk + MutationObserver
    fieldContext.ts          label derivation, field-kind enum, page heuristic
    suggest.ts               shadow-DOM tooltip (Accept / Edit / Skip)
    capture.ts               blur capture + framework-safe value writing
    jobCapture.ts            LinkedIn/Indeed/Glassdoor capture pill (DOM-only)
  store/
    db.ts                    idb wrapper — answers + discoveryQueue stores
    match.ts                 exact + Jaccard fuzzy match (vector TODO)
  paraphrase/
    index.ts                 POST ${cvMakerBaseUrl}/api/paraphrase (defensive)
  popup/
    index.html
    main.tsx
    App.tsx                  shell + Q&A/Discovery tab switch
    panels/
      QAPanel.tsx            list / search / edit / import / export
      DiscoveryPanel.tsx     captured jobs + sync controls + base-URL config
    styles.css               Tailwind v4 entry + ink/paper theme
  shared/
    types.ts                 message contract + AnswerRecord + CapturedJob
    message.ts               typed chrome.runtime.sendMessage wrapper
    normalize.ts             text normalization + Jaccard
    config.ts                chrome.storage.sync wrapper (cvMakerBaseUrl)
```
