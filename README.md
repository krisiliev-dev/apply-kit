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

- Color palette swatches + theme presets
- ATS-friendly plain-text export (parallel to the designed PDF)
- Job post → tailored CV suggestions
- Multi-variant side-by-side + diff
- Cover letter generation
- Application tracking dashboard
