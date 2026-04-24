# CV Maker

A visual CV editor with an AI copilot, a job-application tracker, a discovery queue, an evaluation pipeline, and a career-advisor lens — all in one local-first web app. Each CV is a free-canvas document you edit by clicking, dragging, resizing — or by asking the copilot in plain English.

## Local-only design

Nothing is deployed anywhere. Data lives in your browser's localStorage; the app runs on `localhost` via `npm run dev` (or the `bin/cv` helper — see below). Portability is via the Settings → Backup page: download your state as a JSON blob, import it on another machine or after a wipe. There's no server-side database, no sync service, no account.

The fictional **Ines Valverde** demo persona is the only "seed" in the repo — everything under `content/cvs/` and `content/profile.ts` is fake. Your real profile never has to touch version control.

### Bringing your own data

Three paths:

1. **Use the editor.** Open `/cv/<any-slug>` — a blank canvas appears. Add blocks, type, and let the AI copilot do the repetitive work. Everything persists to localStorage automatically.
2. **Import a backup.** If you've already used the app and exported a JSON backup, the first-run onboarding wizard and the Settings → Backup tab both accept it.
3. **Local override (advanced).** Copy `content/profile.ts` to `content/profile.local.ts` and import that instead in your own fork. Matching `*.local.ts` files are already gitignored — they won't be committed. Keep the schema identical so the evaluation pipeline and seed logic still work.

### Ollama / local models

Settings → Models lets you swap the provider per-feature: Anthropic hosted, or any OpenAI-compatible local server (tested with Ollama's `/v1`). Presets cover Claude Sonnet 4.6 / Haiku 4.5 / Opus 4.7 and two common Ollama tags; you can also paste any model name + base URL. The provider-swap agent owns route wiring; this tab just stores the choice.

### Backups

Settings → Backup:

- **Download backup (.json)** — one-shot pretty-printed export of every `cv-maker:*` localStorage key. Pairing-device tokens are excluded.
- **Choose backup folder (Chromium only)** — uses the File System Access API. The app then writes a daily rolling file (`cv-maker-YYYY-MM-DD.json`) to that folder on the cadence you pick (15m / 30m / 1h / 2h). Keeps the last 7 days and auto-prunes older ones. Safari/Firefox fall back to manual download.
- **Restore from backup…** — picks up a previously exported file, confirms what's about to be replaced, then writes it back and reloads.

### Start commands

If you'd rather not type `npm run dev` every time:

```
bin/cv start     # kills any stale dev server on :3000 and runs npm run dev
bin/cv open      # opens http://localhost:3000 in your default browser
bin/cv backup    # prints instructions for downloading the current backup
bin/cv help      # list commands
```

Override the port with `CV_MAKER_PORT=3001 bin/cv start`.

## Running it

```
npm install
npm run dev
```

Then <http://localhost:3000>. Click a CV variant to open the editor.

For any AI feature, create `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
# Optional — unlocks parseability + six-second test:
AFFINDA_API_KEY=your-key
```

Every AI route gracefully falls back to a 400 with a copy-paste instruction when keys are missing — nothing crashes.

## Architecture

The app has grown to roughly 17 routes, one editor, one tracker, a discovery queue, and an evaluation pipeline. Organising principle: **three lenses** (applicant, recruiter, career advisor) layered over **one canvas editor** and **one persistent application record**. Everything is local-first — nothing leaves the browser except prompt bodies to `/api/*`.

```
app/
  page.tsx                      home — lists CV variants, demo controls
  layout.tsx                    root layout + font registration
  globals.css                   Tailwind theme + editor chrome + print CSS

  cv/[slug]/page.tsx            mounts the Editor for <slug>
  cv/compare/page.tsx           side-by-side diff of two variants

  jobs/page.tsx                 paste a job → parse → draft a tailored CV
  jobs/[appId]/page.tsx         per-application job view (ATS prefill + fit + parsed job)

  applications/page.tsx         tracker dashboard + status filter + effort budget
  applications/new/page.tsx     manual entry form
  applications/[id]/page.tsx    per-app detail: cover letter, prep, salary, rejection, follow-ups
  applications/review/page.tsx  90-day diagnostic

  discover/page.tsx             ranked postings (Greenhouse/Lever/Ashby/HN/RSS + extension)
  discover/preferences/page.tsx watchlist + RSS feeds config

  advisor/page.tsx              index — four lenses
  advisor/narrative/page.tsx    the story your CV is telling, plus alternatives
  advisor/skills/page.tsx       gap analysis across target-role postings
  advisor/ceiling/page.tsx      stretch / in-range / below-level classification
  advisor/decisions/page.tsx    decision-support (offer, stay-vs-go, pivot)

  api/                          See below

components/
  editor/            canvas, toolbar, inspector, chat, eval panels
  applications/     fit check, interview prep, pre-screen, salary, follow-ups, cover letter
  home/             demo controls
  errors/           shared ApiKeyHint error display

lib/
  doc/              editor document model + zustand store + persist + compare
  ai/               system prompt + tool schemas + tool dispatch
  app/              application record, store, followups, export, analytics, effort budget
  advisor/          advisor store + types + pacing
  discovery/        ingest buffer, scoring, persistence
  evaluation/       parseability, keywords, recruiter-eye, six-second, numbers, proof,
                    archetypes, tenure, refine loop, score history, diff
  export/           ATS-friendly plain-text generator (cv-plain.txt)
  jobs/             registry + tailored-CV seeding + ATS schema detection
  types.ts          CVContent (typed content source of truth)

content/
  profile.ts        stable demo persona
  cvs/<slug>.ts     typed CV content used as the initial seed
  cvs/index.ts      variant registry

references/         drop reference images here to share with Claude
```

### API surface

Grouped by feature:

```
/api/chat                    AI copilot (streaming, client-side tool execution)
/api/cover-letter            cover letter draft (streaming)
/api/paraphrase              inline rewrite helper

/api/cv-evaluate             full CV evaluation (non-streaming)
/api/cv-evaluate/refine      iterative refine loop (NDJSON progress)
/api/cv-evaluate/tenure-frame one-liner tenure framing

/api/jobs/parse              job URL/text → structured ParsedJob
/api/jobs/draft              job + base CV → tailored CV content
/api/jobs/ats-schema         detect + fetch Greenhouse/Lever/Ashby/etc. schema

/api/apply-fit/check         "should I even apply?" verdict
/api/pre-screen/draft        short-answer drafts for screening fields
/api/interview/research      company research for prep
/api/interview/generate      likely-question generator (STAR)
/api/salary/parse            offer text → structured offer
/api/salary/analyze          market context + counter-offer email
/api/rejection/extract       rejection text → structured signals + lessons
/api/follow-up/draft         follow-up email drafts
/api/review/summarize        90-day diagnostic summary

/api/advisor/narrative       the story your CV tells
/api/advisor/skills          skill-gap analysis
/api/advisor/ceiling         role-tier classification
/api/advisor/decisions       decision support
/api/advisor/pacing          (static — live computed client-side)

/api/discover/fetch          multi-source job-posting fetch (Greenhouse/Lever/Ashby/HN/RSS)
/api/discover/ingest         extension-push ingest buffer
```

Every AI route checks `process.env.ANTHROPIC_API_KEY` (and `AFFINDA_API_KEY` where relevant) up front and returns a 400 with a clean error message when missing. Client-side, `components/errors/ApiKeyHint.tsx` renders a unified hint for those failures.

## Editing in the canvas

- **Click** a block to select it. **Shift-click** to add to selection.
- **Drag** to move. **Handles** on the edges/corners resize. Snap lines show alignment to page margins, centers, and other blocks.
- **Arrow keys** nudge 1mm. **Shift + arrows** nudge 10mm.
- **⌘D** duplicate, **Del** delete, **Esc** deselect.
- **⌘Z / ⌘⇧Z** undo / redo (includes AI edits).
- **⌘ + scroll** zoom the canvas.

Right pane tabs:
- **Inspector** — transform + typography + theme. With nothing selected, this shows global theme (colors, fonts).
- **Chat** — AI copilot. Ask for any change in plain English.
- **Eval** — evaluation pipeline: parseability, keyword alignment, recruiter-eye read, 6-second test, number/proof/archetype/tenure inspectors, score history sparkline, iterative refine loop.

Toolbar **Export** dropdown:
- **Print / PDF** — opens the native print dialog; print CSS scales to A4 exactly.
- **Plain text (.txt)** — ATS-friendly single-column rendering (`<slug>-plain.txt`). If a typed CVContent is registered for the slug, it's used directly; otherwise nodes are walked in reading order.

Toolbar **Compare** button (shown when ≥2 variants exist) opens `/cv/compare`.

## Making a new CV variant

Two options:

1. **In-app**: visit `/cv/<any-slug>` — a blank page opens. Add blocks with the toolbar or ask the copilot to build something out.
2. **Seeded from typed content**: add a `.ts` file under `content/cvs/`, register it in `content/cvs/index.ts`, then open `/cv/<slug>`. The first time you open a slug, the seed converts your typed content into editable blocks. From then on, edits persist to localStorage.

## How Claude talks to the document

The AI chat panel uses Vercel AI SDK v6 with `@ai-sdk/anthropic`. On every turn, the client sends the current document and selected-node IDs to `/api/chat`. The server prepends that as a structured summary into the system prompt, then streams a response with tool calls. The tools have no server-side `execute` function — the client's `onToolCall` handler runs them against the Zustand store, then returns the result so the model can see what happened.

Tools available to the model: `addText`, `addImage`, `addShape`, `updateNodeTransform`, `updateTextContent`, `updateTextStyle`, `deleteNode`, `duplicateNode`, `setTheme`. Schemas live in `lib/ai/tools.ts`.

## Application bundle export

On any application detail page, **Export bundle** produces a zip:

- `cover-letter.txt` — if generated.
- `cv.json` — full editor document dump.
- `cv-plain.txt` — ATS-friendly plain text (companion to `cv.json`).
- `README.md` — per-bundle instructions.

## Reference images

Drop images into `references/`. Tell Claude the filename (e.g. *"match the layout of `references/magazine-spread.png`"*) — Claude reads images directly.

## Roadmap

Shape: three lenses — **applicant** (your outcomes), **recruiter** (how your CV actually gets read), **career advisor** (the longer arc). Everything previously queued now ships.

### Shipped

**Editor**
- Free-canvas editor with snap guides, undo/redo, layers, inspector, alignment, distribution
- AI copilot with client-side tool execution; streams responses; accepts reference images
- Palette presets + theme controls
- Printable A4 output via print CSS; ATS-friendly plain-text export (.txt)
- **Multi-variant side-by-side diff** (`/cv/compare`) — preview A vs. B at 40%, stats, diff summary

**Applicant lens**
- Application tracking dashboard (`/applications`) with CRUD, status pipeline, CSV export
- Manual-entry form (`/applications/new`)
- Cover letter generator (streaming, tone + word-target); included in zip bundle
- Bundle export — `cover-letter.txt` + `cv.json` + `cv-plain.txt` + README
- Tailored-CV drafting from job post (`/jobs` → `/api/jobs/parse` + `/api/jobs/draft`)
- ATS prefill (Greenhouse + Ashby real schemas; Lever + Workday + SmartRecruiters + Teamtailor stub fallbacks)
- "Should I even apply?" fit check, surfaced on `/jobs/[appId]` + `/discover` modal
- Pre-screen question drafter — per-field streaming drafts against profile + posting
- Interview prep — company research + STAR-format likely questions, per-question "mark practiced"
- Salary negotiation — offer parse + market context + counter-offer email
- Follow-up orchestration — auto-staged cadences (post-apply/screen/interview/offer); per-row regenerate/snooze/mark-sent
- Effort-budget banner + `/applications/review` 90-day diagnostic
- Rejection → lessons loop — structured signal extraction per application

**Recruiter lens — evaluation**
- Affinda parseability (skip-with-warning when key missing)
- Keyword alignment vs. parsed job
- Recruiter-eye LLM pass
- Iterative refinement loop (NDJSON progress stream)
- Parseability heatmap overlay
- Score history + sparkline
- 6-second test simulator (requires PDF render + Affinda)
- "Where's the number?" inspector (static, live on every keystroke)
- Proof-of-work links per bullet + canvas pill + Inspector fields
- Generic-archetype detector (40 curated phrases, 5 categories)
- Tenure-pattern warnings + optional one-liner framing

**Career-advisor lens**
- Career narrative engine — detected story + alternative framings
- Skill-gap analysis — aggregate required skills across target-role postings
- Strategic ceiling/floor — stretch/in-range/below-level classification
- Decision-support agents — offer evaluation, stay-vs-go, pivot
- Pacing + burnout awareness — sprint detection + guidance, persisted per session

**Discovery**
- `/discover` — watchlist (Greenhouse/Lever/Ashby) + HN Who-is-hiring + RSS + extension postings
- Scoring against registered CVs; per-source filter chips
- Preferences page (`/discover/preferences`) for watchlist + feeds
- Fit-check modal from posting rows

**Tooling & demo**
- Demo seed (Ines Valverde persona + 3 CV variants + 8 sample applications)
- Chrome MV3 autofill extension — Q&A store, form observer, inline suggestions
- Extension: LinkedIn / Indeed / Glassdoor posting capture into discovery queue

### What's next

- **Real deploy (Vercel)** — current build is production-clean and locally hosted; next step is provisioning on Vercel (env vars, preview deployments, maybe KV for the pair inbox).
- **KV-backed pair-inbox** — the pairing-flow agent currently stores captured postings in localStorage; promote that to a shared key-value store so the extension and the web app can hand off across devices.
- **Actual usage feedback loop** — after a few weeks of real applications, feed outcomes back in: which tailorings converted to screens, which archetype-flags correlated with rejections, which advisor framings we acted on. Only worth building once volume exists.

Parked pending data + real usage:
- **Rejection-as-data (aggregate)** — beyond per-rejection lessons, pattern-find across ≥50 rejections (*"you stall at technical screens for companies of size X"*).
- **Copilot-initiated actions** — today the chat only edits the doc on request; let it flag issues proactively when the user types obvious regressions.
- **Collaboration** — the editor is single-user by design; shared drafts (over the pair inbox) would unlock review loops.
