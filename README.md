# CV Maker

A visual CV editor with an AI copilot. Each CV is a free-canvas document you edit by clicking, dragging, resizing — or by asking the copilot in plain English.

## Running it

```
npm install
npm run dev
```

Then <http://localhost:3000>. Click a CV variant to open the editor.

For the AI copilot, create `.env.local`:

```
ANTHROPIC_API_KEY=sk-ant-...
```

## Architecture

```
app/
  page.tsx                   home — lists CV variants
  cv/[slug]/page.tsx         mounts the Editor for <slug>
  api/chat/route.ts          AI SDK streaming endpoint with tool defs
  layout.tsx                 root layout + font registration
  globals.css                Tailwind theme + editor chrome + print CSS

components/editor/
  Editor.tsx                 four-region layout: toolbar + layers + canvas + right pane
  Canvas.tsx                 zoomable viewport
  PageView.tsx               A4 page wrapper — mounts nodes, handles selection
  NodeView.tsx               renders one text/image/shape node
  SelectionOverlay.tsx       react-moveable — drag, resize, snap
  Toolbar.tsx                add blocks, undo/redo, zoom, grid, print
  LayersPanel.tsx            left rail — tree of blocks, reorder, hide/lock
  Inspector.tsx              right pane — transform + typography + theme
  ChatPanel.tsx              right pane (alt tab) — AI copilot
  useEditorShortcuts.ts      keyboard: arrow nudge, ⌘D, del, ⌘Z, esc
  usePersist.ts              load/save per-slug document to localStorage
  useTemporal.ts             undo/redo bindings

lib/doc/
  types.ts                   Node / Page / Theme / CvDocument
  store.ts                   Zustand + zundo (undo history)
  seed.ts                    seeds a CV doc from typed content
  persist.ts                 localStorage I/O
  units.ts                   mm ↔ px conversion (96 DPI)

lib/ai/
  tools.ts                   zod schemas for model tools (shared client+server)
  system.ts                  copilot system prompt + doc summary injector
  applyTool.ts               executes tool calls against the doc store

content/
  profile.ts                 stable identity (seeded into new variants)
  cvs/<slug>.ts              typed CV content used as the initial seed
  cvs/index.ts               variant registry

references/                  drop reference images here to share with Claude
```

## Editing in the canvas

- **Click** a block to select it. **Shift-click** to add to selection.
- **Drag** to move. **Handles** on the edges/corners resize. Snap lines show alignment to page margins, centers, and other blocks.
- **Arrow keys** nudge 1mm. **Shift + arrows** nudge 10mm.
- **⌘D** duplicate, **Del** delete, **Esc** deselect.
- **⌘Z / ⌘⇧Z** undo / redo (includes AI edits).
- **⌘ + scroll** zoom the canvas.

Right pane has two tabs:
- **Inspector** — transform + typography + theme. With nothing selected, this shows global theme (colors, fonts).
- **Chat** — AI copilot. Ask for any change in plain English. See `components/editor/ChatPanel.tsx` for example prompts.

## Making a new CV variant

Two options:

1. **In-app**: visit `/cv/<any-slug>` — a blank page opens. Add blocks with the toolbar or ask the copilot to build something out.
2. **Seeded from typed content**: add a `.ts` file under `content/cvs/`, register it in `content/cvs/index.ts`, then open `/cv/<slug>`. The first time you open a slug, the seed converts your typed content into editable blocks. From then on, edits persist to localStorage.

## How Claude talks to the document

The AI chat panel uses Vercel AI SDK v6 with `@ai-sdk/anthropic`. On every turn, the client sends the current document and selected-node IDs to `/api/chat`. The server prepends that as a structured summary into the system prompt, then streams a response with tool calls. The tools have no server-side `execute` function — the client's `onToolCall` handler runs them against the Zustand store, then returns the result so the model can see what happened.

Tools available to the model: `addText`, `addImage`, `addShape`, `updateNodeTransform`, `updateTextContent`, `updateTextStyle`, `deleteNode`, `duplicateNode`, `setTheme`. Schemas live in `lib/ai/tools.ts`.

## Exporting

Click **print / pdf** in the toolbar (or ⌘P). Print CSS hides editor chrome, scales the page to exact A4, and strips the dark canvas background.

## Reference images

Drop images into `references/`. Tell Claude the filename (e.g. *"match the layout of `references/magazine-spread.png`"*) — Claude reads images directly.

## Roadmap

Shape: three lenses — **applicant** (your outcomes), **recruiter** (how your CV actually gets read), **career advisor** (the longer arc). Items move from Queued → In progress → Shipped as work lands.

### Shipped
- Palette presets + theme controls
- Cover letter generator (streaming, tone + word-target, bundle export)
- Application tracking dashboard (`/applications`) with CRUD, status pipeline, CSV export
- Tailored-CV drafting from job post (`/jobs` → `/api/jobs/parse` + `/api/jobs/draft`)
- ATS prefill (Greenhouse + Ashby real schemas; Lever + Workday + SmartRecruiters + Teamtailor stub fallbacks)
- `/discover` — watchlist (Greenhouse/Lever/Ashby) + HN Who-is-hiring + RSS + extension-ingested postings + scoring
- Demo seed (Ines Valverde persona + 3 CV variants + 8 sample applications)
- Chrome MV3 autofill extension — Q&A store, form observer, inline suggestions
- Extension: LinkedIn / Indeed / Glassdoor posting capture into discovery queue

### In progress
- CV evaluation system — Affinda parseability + keyword alignment + recruiter-eye LLM pass + iterative refinement loop + parseability heatmap + score history (agent running)

### Queued — recruiter lens
- **6-second test simulator** — renders the CV, shows to a model for 6 seconds, asks what stuck. Catches the scannability failure that kills most CVs.
- **"Where's the number?" inspector** — flags every bullet lacking scope, metric, or baseline. Forces specificity.
- **Proof-of-work links** — every bullet gets a structured artifact slot (commit URL, published piece, dashboard); empty proof = visible warning.
- **Generic-archetype detector** — AI compares draft vs. 100 boilerplate CV archetypes; flags boilerplate phrasing.
- **Tenure-pattern warnings** — two consecutive sub-year stints? Flag + optional framing prompt.
- **Pre-screen question drafter** — short-answer fields ("why us?", "describe a failure") drafted in-tool against your knowledge base.

### Queued — applicant lens
- **Rejection → lessons loop** — capture rejection emails / ghostings; AI extracts signal per application; patterns aggregate over time.
- **Interview prep module** — when an application moves to `screen`/`interview`, generate likely questions from the posting + public company writing; STAR-format practice answers sourced from profile.
- **Salary negotiation** — paste an offer; get market context + leverage analysis + counter-offer draft.
- **"Should I even apply?"** — honest pre-screen surfacing *weaknesses* for this role, not just strengths.
- **Effort budget** — track "~20 high-quality applications / month" and show when you're overspending on low-signal volume.
- **Follow-up orchestration** — calibrated nudges at the right intervals with drafted emails (not spam).

### Queued — career advisor lens
- **Career narrative engine** — read full history + applied roles; identify the story you're (often unintentionally) telling; propose alternative framings.
- **Skill gap analysis** — aggregate required skills across target-role postings; flag ubiquitous ones you lack; suggest concrete acquisition paths.
- **Strategic ceiling / floor** — cluster target roles into stretch / in-range / below-level; discourage below-level unless intentional.
- **Quarterly review** — every 90 days, surface response-rate trends, funnel-stall points, time-to-offer, which variants outperformed; diagnostic prompts rather than dashboards.
- **Rejection-as-data (aggregate)** — beyond per-rejection lessons, pattern-find across 50 rejections ("you stall at technical screens for companies of size X — here's why").
- **Decision-support agents** — offer evaluation, stay-vs-go, pivot decisions, scoped to your full history.
- **Pacing + burnout awareness** — notice sprints; push for quality over volume.

### Priority order (next 3 to build)

1. **6-second test simulator + "where's the number?" inspector** — directly improves every CV you ship; extends the CV-eval system in flight.
2. **Rejection → lessons loop + quarterly aggregate view** — closes the outcome-learning loop the tool currently lacks.
3. **Interview prep + pre-screen drafter** — massive conversion-rate lever once applications reach `screen`.

Everything below priority 3 is parked pending data from 1–3 and real usage. Skill-gap and narrative-engine work best once there's volume flowing through the system.
