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

Click the toolbar icon:

- Total entry count.
- Search / filter across questions and answers.
- Edit an entry (saved as a new version; history kept).
- Delete an entry.
- **Export JSON** / **Import JSON** (merge mode) — for backup or moving between
  browsers.

## Paraphrase (TODO)

`src/paraphrase/index.ts` exposes:

```ts
paraphrase(text: string, ctx: ParaphraseContext): Promise<string>
```

Currently a stub that returns the input unchanged. The next iteration will
wire it to the CV-maker paraphrase API so repeated long-form answers get
rephrased per-application (same facts, different wording). The
`embedQuestion` background handler is similarly stubbed; it returns `null`
so callers can feature-detect.

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
  manifest.ts           MV3 manifest (defineManifest from @crxjs/vite-plugin)
  background/
    index.ts            service worker — owns IndexedDB, message bus
  content/
    observer.ts         content script entry — DOM walk + MutationObserver
    fieldContext.ts     label derivation, field-kind enum, page heuristic
    suggest.ts          shadow-DOM tooltip (Accept / Edit / Skip)
    capture.ts          blur capture + framework-safe value writing
  store/
    db.ts               idb wrapper — single typed AutofillDB
    match.ts            exact + Jaccard fuzzy match (vector TODO)
  paraphrase/
    index.ts            stub (TODO: CV-maker API)
  popup/
    index.html
    main.tsx
    App.tsx             React popup — list / search / edit / import / export
    styles.css          Tailwind v4 entry + ink/paper theme
  shared/
    types.ts            message contract + AnswerRecord shape
    message.ts          typed chrome.runtime.sendMessage wrapper
    normalize.ts        text normalization + Jaccard
```
