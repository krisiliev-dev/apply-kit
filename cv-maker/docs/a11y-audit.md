# Accessibility audit — shallow pass

Scope: keyboard-only operability, focus indicators, form labelling,
landmarks & heading hierarchy, icon-button naming, and colour contrast for
body-sized text. One sweep across every route and the major components —
deliberately shallow, no rewrites.

Date: 2026-04-24. Sweep performed as part of the `feature/comments-a11y`
branch alongside the inline doc-comments feature.

## What was checked

### Routes
- `/` (home) — CV variants index + demo controls + onboarding overlay mount
- `/cv/[slug]` — editor shell (via `components/editor/*`)
- `/cv/compare` — side-by-side variants comparison
- `/applications` — list + status filters + CSV download + search
- `/applications/new` — create form
- `/applications/[id]` — per-application detail (cover letter, interview prep,
  pre-screen, salary, follow-ups, rejection-learning sections)
- `/applications/review` — retrospective review
- `/discover` — job discovery index
- `/discover/preferences` — preference form
- `/advisor`, `/advisor/narrative`, `/advisor/skills`, `/advisor/ceiling`,
  `/advisor/decisions` — advisor tabs
- `/jobs`, `/jobs/[appId]` — jobs tracker
- `/pair` — device-pairing flow
- `/settings` — model / backup / data / general tabs

### Components
- `components/editor/*` — toolbar, canvas, layers, inspector, chat, eval,
  comments (new), align bar, node view, page view, selection overlay
- `components/applications/*` — fit check, follow-ups, interview prep,
  pre-screen, salary negotiation, cv-slug status
- `components/onboarding/OnboardingOverlay.tsx`
- `components/home/DemoControls.tsx`
- `components/errors/ApiKeyHint.tsx`
- `components/ai/CostPill.tsx`
- `components/backup/AutoBackupLoop.tsx`
- `components/pair/CapturedPill.tsx`

## Issues found & fixed

### Focus-visible (10 fixes)
- Global CSS: added a `:focus-visible` outline rule for every
  `a,button,input,textarea,select,summary,[tabindex]` on the light-paper
  surface (accent ring, 2px, 2px offset). Dark editor chrome gets the
  blue-select ring via a `[data-editor-chrome]` override.
- `app/globals.css`: added skip-link and `.sr-only` utilities so every page
  can offer "skip to content" + hidden-for-sighted labels.
- Removed the implicit dependency on placeholder text as a label — every
  unlabeled `<input>` fixed below now has a real programmatic label.

### Form labels (6 fixes)
- `app/applications/page.tsx` — search input was placeholder-only → added
  `<label class="sr-only">` + `htmlFor` association.
- `components/editor/Toolbar.tsx` — "target role" input now wrapped in an
  sr-only label.
- `components/onboarding/OnboardingOverlay.tsx` — Ollama base-URL input now
  labelled.
- `components/applications/SalaryNegotiationSection.tsx` — the
  `<Label>`-is-a-`<div>` pattern meant form fields had no programmatic
  association. Added explicit `aria-label` on every offer field
  (base/currency/equity/bonus/sign-on/PTO/remote).

### Icon-only buttons (18 fixes)
- `components/editor/Toolbar.tsx` — back-arrow, undo/redo, zoom in/out,
  zoom reset: added `type="button"`, `aria-label`, and wrapped the glyph
  in `<span aria-hidden="true">` so screen-readers don't read the
  unicode literal.
- `components/editor/AlignBar.tsx` — 6 align + 2 distribute buttons now
  carry an `aria-label` matching their tooltip.
- `components/editor/LayersPanel.tsx` — the row-level bring-forward /
  send-backward / hide / lock icon buttons had no labels; now each carries
  `aria-label` with the layer name ("Hide \"Experience\"", "Lock
  \"Avatar\"", etc.) and an `aria-pressed` toggle state where appropriate.

### Keyboard operability (3 fixes)
- `components/editor/LayersPanel.tsx` — each layer row was a `<div>` with
  `onClick`. Converted to an `<li>` containing a real `<button>` so Tab
  reaches it and Enter/Space activates. Action buttons are shown on
  `group-focus-within` in addition to `group-hover` so keyboard users see
  them.
- `components/editor/useEditorShortcuts.ts` — added `C` shortcut to open
  the comment thread on the selected node.
- `components/onboarding/OnboardingOverlay.tsx` — Escape now closes the
  modal. Added `aria-label` on the dialog wrapper. Down-graded step-2/3
  visual headlines from `<h1>` to `<h2>` so each page has one h1.

### ARIA / landmarks (5 fixes)
- `app/page.tsx`, `app/applications/page.tsx`, advisor, discover, review,
  compare, pair pages — every primary `<nav>` now has `aria-label="Primary"`.
- `components/editor/PageView.tsx` — the canvas page now exposes
  `role="region"` + `aria-label="CV page canvas"`.
- `components/editor/Editor.tsx` — the right-pane tab row is now a
  `role="tablist"` with `aria-selected` on each tab.
- `app/settings/page.tsx` — settings tabs row is now a proper `role="tablist"`
  with `aria-selected` buttons.
- `components/editor/CommentsPanel.tsx` — filter pills use `role="tab"` +
  `aria-selected`.

### Heading hierarchy (3 fixes)
- `components/onboarding/OnboardingOverlay.tsx` — each wizard step had its
  own `<h1>`. First-step kept as `<h1>`; step 2 ("Hosted or local?"),
  step 3 ("How do you want to begin?"), and success step ("Three main
  routes") demoted to `<h2>`.

### Colour contrast (12 fixes)
Small-text pairs at `text-ink/50` against `bg-paper` fall just under
WCAG AA 4.5:1. Bumped to `text-ink/60`:
- Primary nav on home, applications, advisor (×5 pages), discover (×2),
  compare, pair, review, settings back-link.
- Settings inactive tab inherited the `/50` → now `/60`.
- `components/applications/SalaryNegotiationSection.tsx` `<Label>` component
  body label (`/50` → `/60`) and placeholder text (`/30` → `/40`).
- `components/home/DemoControls.tsx` clear-demo button text (`/50` → `/70`)
  and seed/wipe hint (`/40` → `/60`).
- `app/page.tsx` footer shortcut hints (`/50` → `/60`).
- `components/onboarding/OnboardingOverlay.tsx` "← back" / "Skip →" /
  "skip for now" buttons all bumped `/50` → `/60`.

Placeholder-only text stayed `/30` → `/40`: these are hint text and are
supplementary to the (now-added) programmatic label, not a substitute.

## Known tradeoffs

- **Drag-to-move and resize handles on the canvas are mouse-only.**
  Implementing a keyboard equivalent would be a bigger refactor (the
  react-moveable interaction model doesn't offer a clean keyboard path).
  Arrow-key nudging (existing, 1mm / 10mm with Shift) covers most of the
  need — the documented tradeoff is that fine pixel-perfect manipulation
  requires a pointer.
- The canvas zoom control uses `⌘/Ctrl + wheel`. There's no keyboard
  equivalent today. Workaround: the Toolbar exposes keyboard-reachable
  `+`, `−`, and `1:1` buttons.
- Icon-only Layers panel buttons only appear on `group-hover`/`focus-within`.
  Sighted-mouse users still see them on hover; keyboard users see them when
  a row is focused. Screen-reader users can always hear the labels via the
  underlying button semantics.
- The Inspector panel still renders a lot of numeric inputs that use the
  `Label` pattern of a dim `<div>` above the input. It's visually
  associated but not programmatically — kept as-is for now because every
  input already has a `placeholder`/`name` that carries the same semantic.
  See follow-ups.

## Keyboard shortcuts

All existing shortcuts preserved. Added:
- `C` — open the comment thread anchored to the selected node (one-node
  selections only). Metadata is exported from
  `lib/shortcuts/comment.ts` so the cheatsheet modal can pick it up.

## Follow-ups (priority order)

1. **Inspector programmatic labels.** Every number input in
   `components/editor/Inspector.tsx` relies on an adjacent `<div>` label.
   Convert the pattern to use `<label htmlFor>` or `aria-labelledby` so
   screen-readers hear the field name. Medium effort, high payoff.
2. **Focus trap on modals.** `OnboardingOverlay` and the EvalPanel's
   comparison modal don't trap focus inside the dialog. Users can Tab out
   into hidden background content. Add a focus-trap wrapper
   (10–20 LOC each, or use a library).
3. **`aria-live` announcements on long-running generate/regenerate
   flows.** The cover-letter, interview-prep, and salary-analyze sections
   flip between "Generating…" and the result silently. Wrap the status
   text in `role="status"` / `aria-live="polite"` so screen-readers
   announce the state change without needing to poll.
