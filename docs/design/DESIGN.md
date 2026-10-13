# apply-kit: Design system

Design step 5. Direction **Vitosha**, chosen 2026-10-11 from three directions ([directions.html](directions.html)). Live specimen: [system.html](system.html). Tokens: [tokens.json](tokens.json) (source of truth, W3C DTCG) and [tokens.css](../../app/ui/src/styles/tokens.css) (same values for the app; change both together). Shared component styles: [components.css](../../app/ui/src/styles/components.css). Both CSS files moved into the UI package on 2026-10-11 so the app and the hi-fi screens use one copy.

## Intent

- **Who:** one person, Kris, on a laptop most mornings, working through ~30 new jobs and ~10 open applications, during a search that involves rejection.
- **Feel:** calm and encouraging, but dense enough to work fast. Like a clear morning on Vitosha: stone, pine, one flower.
- **Domain:** correspondence, letterheads, the A4 page, applications as a journey, progress as a climb.

## Principles

1. **Pink is a signal, not a colour.** Alpine pink (`--bloom`) appears only for things that need the user and for wins (offer, accepted, beating your pace). Everywhere else pine and stone do the work.
2. **Progress is an ascent.** The signature element: cumulative applications drawn as a climbing line, because volume and consistency are what the user controls.
3. **Calm density.** 15px body, information-dense tables; air goes between groups, not inside rows.
4. **Documents stay documents.** CVs and letters always print on white with one pine accent, in a fixed ATS-safe template that the app theme never touches.
5. **Shape plus colour.** No state is shown by colour alone: requirement chips carry icons, statuses differ in fill and outline, flags carry a mark.

## Tokens (summary)

| Group | Values |
|---|---|
| Colour | Alias tokens only: `ground`, `surface`, `surface-sunken`, `ink`/`ink-2`/`ink-3`, `rule`, `border-control`, `action`(+hover, on-action), `bloom`(+soft), `met`/`partly`/`gap` (+soft), `focus`; `doc-*` for documents. Light and dark defined; all text pairs ≥ 4.5:1, control borders ≥ 3:1 (verified 2026-10-11) |
| Type | **Geologica** (headings, numbers, CV name/sections), **Onest** (everything else). Both have full Cyrillic. Scale 1.25 from 15px: 12 · 13 · 15 · 18 · 22 · 28 · 35 · 44. Hierarchy by weight and colour before size |
| Space | 4px base: 2 · 4 · 8 · 12 · 16 · 20 · 24 · 32 · 40 · 56 |
| Radius | sheet 3 · small 6 · control 10 · card 14 · pill 999 (buttons, chips, statuses) |
| Elevation | `raised` (soft two-layer, light mode only; dark uses rules) · `overlay` (menus, dialogs, toasts) |
| Motion | 120 / 200 / 320ms; standard ease in, faster ease out; only in response to user actions; reduced motion respected |

Fonts: Bricolage Grotesque and Figtree (the original Vitosha pair) were replaced because neither has Cyrillic, which Bulgarian applications require.

## Components

| Component | Variants and states | Rules |
|---|---|---|
| **Button** | primary, secondary, ghost, danger × default, hover, focus, disabled, working | One primary per view; label says what happens; disabled always has a written reason nearby |
| **Requirement chip** | met, partly, gap, hidden-reason | Icon per state; hidden-reason is dashed and always readable |
| **Status** | applied, screening, interviewing, offer, accepted, rejected, withdrawn | Filled = momentum; pink only for offer/accepted; closed statuses fade |
| **Feed row** | default, focused (keyboard), selected, hidden | Title leads, why-line explains rank, fit is the only big number |
| **Needs-you item** | open, done (fades then leaves) | Pink edge is the only pink in a list |
| **Stepper** | done, current, flagged, upcoming | Flagged steps can't be approved until resolved |
| **Banner** | info, success, warning, error | What happened, what it means, what to do; no apologies |
| **Form field** | text, select, textarea with count, checkbox/radio × default, focus, error, disabled | Labels above, help under label, errors under field, validated on blur |
| **Segmented control** | 2–4 options | Switches a view in place; never navigates |
| **Stat + ascent** | stat tile, ascent chart | Endpoint pink only on a week that beats your pace |
| **Empty state** | per screen | Says what will appear and offers the first step |
| **Toast** | confirmation, with undo | Uses the action's own words ("Passed", "Saved") |

## Documents: CV and cover letter

- **A4, single column, reverse-chronological**, standard headings (Experience, Skills, Education; localised in Bulgarian), **one page**, margins 18mm, body 9.5–10pt Onest, headings Geologica.
- **One accent:** pine deep `#24584a` on the name and section titles only (8.2:1 on white).
- **ATS safety:** fonts embedded, ligatures disabled, real selectable text, no tables/columns/icons/skill bars, contact details in the body (not a header/footer region).
- **Photo:** slot off by default, switchable per package, suggested for local Bulgarian employers.
- **Language:** English or Bulgarian, same template and fonts; Bulgarian postings default to Bulgarian.
- **Fixed template:** the AI fills content and never changes layout. The cover letter shares the letterhead.
- **To validate when built:** run the generated PDFs through text extraction (e.g. `pdftotext`) and at least one ATS parser to confirm every field reads correctly, in both languages.

## Rules from the Discover review (2026-10-11)

From the heuristic evaluation and accessibility audit in `critique/`:

- **Gaps are never hidden.** Feed rows always show every gap and every partly-met requirement; only met items may collapse into "+N met". Row counts match the Job page exactly. Preferred items are never gaps.
- **Every job has a home.** Feed views are New, Saved, All open, and Passed & closed. Hidden jobs are one click away from the toolbar in every state.
- **The ranking never learns silently.** Every learned adjustment is listed and undoable, why-lines mention it when it changed a rank, and learning options default to off. Pass reasons are never pre-selected.
- **Nothing closes by itself.** An unusual drop keeps jobs open; after 2 more zero checks the user is asked. Any bulk close states the count and can be undone.
- **Quiet alerts are flagged.** Email-alert sources learn their usual cadence; more than 3× the usual gap shows "Quiet longer than usual".
- **Lists don't move under you.** Rows found while you're reading queue behind a "N new jobs found · show" bar.
- **Keyboard shortcuts are opt-out and scoped.** Single-key shortcuts work only inside the jobs table, use real focus (roving tabindex), and can be turned off.
- **Async changes are announced** politely (source checks, health, toasts); toasts give at least 10 seconds to undo and move focus sensibly.
- `--bloom` (light) darkened to `#a33d62` so pink text passes on its soft background (5.0:1).

## Extension side panel (from the Apply hi-fi, 2026-10-13)

Hi-fi: [hifi/extension-fill.html](hifi/extension-fill.html). Chrome's side panel, 320–480px wide (designed at 360). It hosts Capture and Fill; same tokens and components as the app.

| Component | Variants and states | Rules |
|---|---|---|
| **Panel frame** | header (brand, connection), Fill / Capture switch, body, sticky footer | Footer holds the one primary action and the boundary line ("Fills only when you click. Never presses Next or Submit.") in every state; the document sets `scroll-padding-bottom` to the footer height |
| **Context card** | matched, no package, different job, unknown portal | Names portal, company and job, and *why* it matched (job ID equals the package's target posting). The job title is the panel's h1 |
| **Field row** | Profile, Answer bank, Package, CV version, You, Filling…, Waiting, Needs you, Skipped · your rule, Added by the portal, Didn't stick | A button (≥ 44px) that shows the field on the page. Reading order: label, value, source. Source always in words; chip colour follows the chip rules |
| **Needs-you item** (panel) | choice, number, long text with count, yes/no | Pink edge (the `.needs` pattern). Question, basis line (where the suggestion came from), the answer control, "Fill …", "Show on page", and "Save to answer bank" where reusable |
| **Page marks** (on the portal) | filled (pine edge + tick), needs you (pink edge + ?), check it (amber edge + half circle), didn't stick (red edge + cross) | Drawn as an outline and a positioned badge with `pointer-events: none`, `aria-hidden`; never change the portal's layout, tab order or values; removed by Undo |
| **Copy row** | default, copied | Label (in the form's language, with English meaning), value, Copy; "Copied" for 2 s and announced |
| **Checklist** | numbered steps, done | For sequences only Kris can finish (account creation) |

### Rules from the Apply review

- **Never act without a click.** Each fill is one click (or the keyboard command) on one page; the panel never reacts to page loads beyond noting that the address or title changed.
- **Never the wrong package.** Every fill re-checks the job in the tab against the package; a different job is said out loud and never filled from the old package.
- **Never overwrite silently.** A field that already has a value is kept and marked; portal-added entries (Workday's CV parsing) are reported and removed only on a click.
- **Undo on every filled page**, working even if the app stops.
- **Nothing learned silently.** Saving an answer to the answer bank is a visible, per-question tick; typed-on-the-portal answers are offered, not taken.
- **Marking is a confirmation, not a guess.** "Mark as submitted" sits on the confirmation page (or unknown forms), never on a review page; its Undo stays until the panel closes.
- **Honest progress.** Show the portal's own step count only when the portal prints it; otherwise "this page".
- `--ink-3` on `--surface-sunken` is 4.64:1: don't use it there below 12px or at normal weight below 13px.

## How to use this in later steps

- Hi-fi screens (step 6) apply these tokens to the wireframes in `wireframes/`. Tokens only: no raw hex, no one-off spacing.
- New components get specified here (variants, states, rules) before they're built.
- Keep `.interface-design/system.md` in sync so every session applies the same decisions.
