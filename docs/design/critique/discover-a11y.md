# Discover hi-fi: accessibility audit (design step 8)

Scope: `docs/design/hifi/feed.html`, `job.html`, `sources.html`, with the shared `docs/design/components.css` and `docs/design/tokens.css`. Standard: WCAG 2.2 AA, plus the pinned Web Interface Guidelines in `.claude/skills/web-design-guidelines/command.md`.

How it was tested (2026-10-11): each page was served at `http://127.0.0.1:8766/hifi/` and every review-bar state was clicked through in the built-in browser. Each state was loaded in an isolated frame at 320, 400, 640 and 1280 px wide, in both themes (`data-theme="light"` and `data-theme="dark"`, which mirror the `prefers-color-scheme` tokens). The 640 px run stands in for 1280 px at 200% zoom. Every page was also run with the WCAG 1.4.12 text-spacing override at 400 px. Contrast was computed from the rendered colours, with blending and opacity applied, for every visible text node. Token pairs were then re-checked by hand. Semantics were read from the source and the rendered DOM. Keyboard behaviour comes from the DOM and the event handlers: another agent was using the same browser pane at the same time, so long sequences of real Tab presses could not be run reliably. Treat the keyboard findings as code-verified, and do a quick manual Tab pass before sign-off.

The review bar is review chrome, not product. It is covered only in A11Y-30.

## Summary

| Severity | Count |
|---|---|
| Blocker | 1 |
| Serious | 7 |
| Moderate | 12 |
| Minor | 10 |
| **Total** | **30** |

| ID | Sev | Screen · state | WCAG / rule | Issue (one line) |
|---|---|---|---|---|
| A11Y-01 | Blocker | Sources · Normal | 2.1.1 Keyboard | Source rows open their history only on a mouse click, so keyboard users can't see any source's history |
| A11Y-02 | Serious | Feed, Job (all) | 2.1.4 Character Key Shortcuts | Page-wide single-key shortcuts (J K S X, Enter) with no way to turn them off or remap them; the "cursor" row isn't real focus |
| A11Y-03 | Serious | Job · Pass; Sources · Remove | 2.4.7 Focus Visible, 1.4.11 | The focus ring on dark "ink" surfaces (toast) is 2.20:1 in light and 1.70:1 in dark |
| A11Y-04 | Serious | Job · Pass; Sources · Remove | 1.4.3 Contrast (Minimum) | On hover, the toast's Undo text drops to 1.09:1 (light) and 1.04:1 (dark) |
| A11Y-05 | Serious | Sources · Normal at ≤400 px | 1.4.10 Reflow, 2.4.7 | The sources panel is clipped: "Add search or alert", the Type column and the ⋯ menu are cut off and can't be reached |
| A11Y-06 | Serious | All, sticky topbar | 2.4.11 Focus Not Obscured (Minimum) | No `scroll-padding-top`, so shift-Tab can hide the focused element under the 82–149 px sticky header |
| A11Y-07 | Serious | Job · Pass; Sources · Remove | 4.1.3 Status Messages, 2.2.1 Timing Adjustable | Undo toast: unreliable announcement, no focus plan, and a 10 s undo window |
| A11Y-08 | Serious | Feed · Checking sources; Job · Loading; topbar health | 4.1.3 Status Messages | Async source checks and reading progress aren't announced; `aria-busy` silences Job's own live region |
| A11Y-09 | Moderate | Job · Low-confidence | 1.4.3 | `.chip.ask` (bloom on bloom-soft) is 4.36:1 at 12 px |
| A11Y-10 | Moderate | Feed · toolbar | 1.4.3 | Unpressed filter count (`.filter .n`, opacity .75) is 4.11:1 |
| A11Y-11 | Moderate | All inputs, dark | 1.4.3 | Placeholder uses the browser default #757575, which is 3.50:1 on the dark surface |
| A11Y-12 | Moderate | All inputs | 2.4.7 Focus Visible, 1.4.11 | `.input:focus` removes the outline; the only cue is a 1 px border colour change (2.17:1) and a 1.2:1 halo |
| A11Y-13 | Moderate | Feed segmented, nav, Sources rail | 1.4.11 Non-text Contrast | The selected-state fill is 1.10–1.25:1, and dark mode drops the shadow |
| A11Y-14 | Moderate | Job · fit check "Gaps"; Feed chips | 1.3.1 Info and Relationships | Gap vs partly-met chips have no text state for screen readers; Feed chips announce the state twice |
| A11Y-15 | Moderate | Job · Loading | 1.3.1 | Done / in progress / next steps are shown only by icon and colour |
| A11Y-16 | Moderate | Feed · First run; Sources (several); Job · Bulgarian | 1.3.1, 2.4.6 Headings and Labels | Missing h1, skipped h2 levels, and an h3 before the h1 |
| A11Y-17 | Moderate | Sources · rail | 1.4.1 Use of Color, 1.1.1 | The red or amber rail dot has no text alternative |
| A11Y-18 | Moderate | Feed toolbar; Sources ⋯ | 4.1.2 Name, Role, Value | Menu buttons have no `aria-haspopup`/`aria-expanded`; "✕ remove filter" chips are announced as pressed toggles |
| A11Y-19 | Moderate | Sources · Add · not found at 320 px | 1.4.10 Reflow | `.btn { white-space: nowrap }` makes long labels scroll the page sideways |
| A11Y-20 | Moderate | Sources · Remove | 4.1.2, 2.4.3 Focus Order | Dialog spec has no `aria-modal`, initial focus, focus trap, Esc or focus return |
| A11Y-21 | Minor | Feed, Job, Sources | 4.1.2 / ARIA | `aria-label` on generic `span`/`div` (new dot, badge, skeleton, Decide panel, board) is ignored or unreliable |
| A11Y-22 | Minor | All | 2.4.1 Bypass Blocks (guideline) | No skip link (landmarks are enough to pass) |
| A11Y-23 | Minor | Feed · After a week away | 1.4.4 Resize Text / guideline | Truncated job titles are only available in a `title` tooltip |
| A11Y-24 | Minor | Feed, Job, Sources banners | 4.1.3 / guideline | `role="status"`/`alert` is used on static banners, and inconsistently between Feed and Sources |
| A11Y-25 | Minor | Feed tables | 1.3.1 | Empty `<th>` cells for the checkbox and action columns |
| A11Y-26 | Minor | Job postings; Sources suggestions | 2.4.4 Link Purpose (In Context) / guideline | Repeated "Open ↗", "Show where", "Make target" and "Add" labels; the ↗ glyph is read aloud |
| A11Y-27 | Minor | Job · Save; Bulgarian language switch | 4.1.2 / guideline | Save is both `aria-pressed` and relabelled; the language-switch result isn't announced |
| A11Y-28 | Minor | Sources · history chart | 1.4.11 | The "normal range" band is 1.25:1 (fill) and 2.48:1 (dashes) in light mode |
| A11Y-29 | Minor | Feed, Sources inputs | Guideline (Forms) | Link fields lack `type="url"`; no `name` or `autocomplete` |
| A11Y-30 | Minor | Review bar (chrome only) | 4.1.2, 1.4.11 | Tablist without tab panels or arrow keys; focus ring 2.20:1 on ink |

## What passes

Verified, so the redesign doesn't break these:

- **Text tokens.** All body and meta pairs pass in both themes. Lowest light values: ink-3 on surface-sunken 4.64, ink-3 on met-soft (the focused row) 4.83, met chip 5.61, partly chip 5.75, gap chip 5.07, badge 5.34, primary button 6.71, health pill "bad" text 6.30. Dark mode: no text failure in any state.
- **Banner buttons.** `border-color: currentColor` on tinted backgrounds is 5.07:1 or better.
- **Disabled controls.** Exempt from contrast. The disabled "Prepare package" buttons explain why with `aria-describedby`.
- **Reduced motion.** `.spin` and `.skel` animate only under `prefers-reduced-motion: no-preference`. The rest is short colour fades plus a 120 ms chevron rotation, which is fine.
- **Target size (2.5.8).** Every control is at least 24 px except the 16 px checkboxes and the 27×18 px "Fit ↓" sort button. Both pass on the spacing exception, because no other target sits within a 24 px circle.
- **Tables.** `aria-sort="descending"` on Fit with a real `<button>`. `progressbar` and `meter` have min, max and now values. Inputs are labelled through `<label for>` or `aria-label`. Fieldsets have legends. `lang="bg"` is set on Bulgarian quotes and the original text. The chart is `role="img"` with a full data summary. Disclosures use `aria-expanded` and `aria-controls`.
- **Reflow.** Feed and Job reflow cleanly at 320, 400 and 640 px, and under the text-spacing override. Their tables scroll inside `.table-wrap`, which the 1.4.10 data-table exception allows.
- **Colour alone.** Requirement chips carry an icon shape and text, and the Feed adds an sr-only state. Board tiles and the health pill carry text. Chart failures are marked with an ✕ glyph, not just a red band.

## Details

### A11Y-01 · Blocker · Source history is mouse-only
- **Where:** `sources.html` Normal state. Click handler at `sources.html:494-498`; rows rendered at `:458-460`; the instruction "Select a row to see its history" is at `:151`.
- **WCAG:** 2.1.1 Keyboard (A).
- **What fails:** The `click` listener sits on `<tbody>` and rows have no focusable element. The only control in each row is the ⋯ button, which the handler deliberately ignores. A keyboard user can never open any source's history. The panel at `:154` only ever shows the default (dev.bg). The `.is-focused` row style is also only applied by mouse.
- **Fix:** Make the source name the control: `<button class="src-name" aria-expanded aria-controls="detail-normal">SumUp</button>`, styled as text. Then either move focus to the detail panel's `<h3 tabindex="-1">` on activation, or keep `aria-live` but announce only a short line ("Showing history for SumUp"), not the whole panel. Add a system rule for clickable rows in `components.css`: rows are never the only target; one cell holds the real button or link (the Feed already does this with the title link).

### A11Y-02 · Serious · Single-key shortcuts and a fake cursor
- **Where:** `feed.html:60` (J K Enter S X hint), `job.html:163`, `:213`, `:532` (S, X, Esc). Row cursor styles at `components.css:129-130` (`tr.is-focused`).
- **WCAG:** 2.1.4 Character Key Shortcuts (A); related to 2.4.3 Focus Order.
- **What fails:** As designed, these are page-wide printable-key shortcuts. Speech-input users trigger them by accident, and they clash with screen-reader quick keys. J/K move a visual "focused row" that isn't DOM focus, so screen-reader and keyboard focus fall out of sync with what is on screen.
- **Fix:** Specify that shortcuts (a) never fire while focus is in a text field, (b) can be turned off or remapped in Settings, or only work while the job table or job page has focus, and (c) J/K move real focus to the row's title link (`.t`), with `.is-focused` driven by `:focus-within` so the visual and real cursor are the same thing. Add this to the component spec, and add `tr:focus-within td { background: var(--met-soft) }` in `components.css`.

### A11Y-03 · Serious · Focus ring invisible on ink surfaces
- **Where:** `components.css:12` (`:focus-visible { outline: 2px solid var(--focus) }`) combined with `.toast` at `:116`, which has an `--ink` background. Affects the Undo button at `job.html:535` and `sources.html:361`, and the review bar.
- **WCAG:** 2.4.7 Focus Visible (AA), 1.4.11 Non-text Contrast (AA).
- **What fails:** `--focus` against `--ink` is 2.20:1 in light and 1.70:1 in dark. Undo, the recovery action, gets a ring you can barely see.
- **Fix:** Add a token for inverse surfaces in `components.css`: `.toast :focus-visible, .review :focus-visible { outline-color: var(--ground) }`. That gives 12.93:1 in light and 14.75:1 in dark. Better still, add `--focus-inverse` to `tokens.css` and `tokens.json`.

### A11Y-04 · Serious · Toast Undo disappears on hover
- **Where:** `components.css:51` (`.btn.ghost:hover { background: var(--surface-sunken) }`) together with `:117` (`.toast .btn.ghost { color: var(--ground) }`).
- **WCAG:** 1.4.3 Contrast (Minimum).
- **What fails:** On hover the Undo label is ground on surface-sunken: 1.09:1 in light, 1.04:1 in dark.
- **Fix:** `.toast .btn.ghost:hover { background: color-mix(in srgb, var(--ground) 16%, transparent) }`, which keeps the text at ground on near-ink, or underline on hover instead of filling.

### A11Y-05 · Serious · Sources panel clipped at ≤400 px
- **Where:** `sources.html:141-150`, the toolbar and table inside `.panel.flush`. Root cause in `components.css:42-43`: `.panel` is `display: grid` with an implicit `auto` track, and `.flush` sets `overflow: hidden`.
- **WCAG:** 1.4.10 Reflow (AA); 2.4.7 (focus moves to controls that can't be seen).
- **What fails:** At 400 px the segmented control's min-content width (four nowrap buttons) widens the grid track to 414 px inside a 353 px panel. The right 62 px is clipped, which cuts off "Add search or alert", the table-foot text, and even at full scroll the Type column and the ⋯ "More for …" buttons. At 320 px, 141 px is clipped. Confirmed by measurement and screenshot.
- **Fix:** In `components.css`: `.panel { grid-template-columns: minmax(0, 1fr) }`, or `.panel > * { min-width: 0 }`. Then `.toolbar .segmented { max-width: 100% }`, which already exists at `sources.html:32`, can actually scroll. This is systemic, so fix it in the component, not per page.

### A11Y-06 · Serious · Sticky header can cover the focused element
- **Where:** `components.css:23` (`.topbar { position: sticky }`). No `scroll-padding-top` anywhere. Also `sources.html:13` hard-codes the rail's `top: 84px`.
- **WCAG:** 2.4.11 Focus Not Obscured (Minimum) (AA).
- **What fails:** The topbar is 82 px tall at 1280 and 640 px (that is, 200% zoom), 117 px at 400 px, and 149 px at 320 px or with text spacing. Shift-Tab and in-page anchors (`#q-salary`, `#mailbox`) scroll targets to the top edge, under the header. A 23 px row link can be fully hidden. At 320 px with 400% zoom the header takes over half the viewport.
- **Fix:** In `components.css`: `html { scroll-padding-top: calc(var(--topbar-h, 72px) + var(--s-3)) }`, with `--topbar-h` set per breakpoint. Below 720 px, make the topbar `position: static`, or collapse the nav into one row so it isn't a permanent 117–149 px band. Base the rail's `top` on the same variable.

### A11Y-07 · Serious · Undo toast: announcement, focus and time limit
- **Where:** `job.html:535` and `:673-674` (`role="status"` on an element toggled from `hidden`); `job.html:534` (spec: "the next job opens"); `sources.html:360-361` ("10 seconds to undo").
- **WCAG:** 4.1.3 Status Messages (AA), 2.2.1 Timing Adjustable (A), 2.4.3 Focus Order.
- **What fails:** A live region that goes from `display: none` to visible is often not announced, because it has to exist before its content changes. After "Pass", focus stays on a submit button that is about to vanish when the next job opens, and nothing says where focus goes. A 10 s auto-dismissing Undo is a time limit that keyboard and screen-reader users can miss.
- **Fix:** Keep one always-present `<div class="sr-only" role="status" aria-live="polite">` per page and inject the message text into it. Move focus to the next job's `<h1 tabindex="-1">`. Pause the toast timer while it has hover or focus, give it at least 20 s or keep it until the next action, and provide a lasting undo path ("Passed" list, "Closed" list). Document this in the toast component.

### A11Y-08 · Serious · Async source checks are silent
- **Where:**
  - Feed · Checking sources, `feed.html:71-76`: the "9 of 14 done" text and the progressbar update with no live region, and new rows arrive silently.
  - Topbar health pill, `feed.html:38` and its JS at `:174-179`: the text changes to "1 source failing" with no announcement.
  - Feed · Source failed "Try now" (`:98`) and Sources "Try now" / "Check all now" (`sources.html:133`, `:179`, `:198`): no result message is specified.
  - Job · Loading, `job.html:442` and `:451`: `aria-busy="true"` is on the whole `<section>`, which contains the step list's `role="status"`. Assistive technology may hold back that region's updates until busy clears.
- **WCAG:** 4.1.3 Status Messages (AA).
- **Fix:** Put the Feed progress sentence (`.meta` under the h1) in `aria-live="polite"`, throttled to "Checked 9 of 14 sources, 3 jobs so far". Announce the end state ("Check finished: 23 new jobs, 1 source failed"). Make the health-pill text `aria-live="polite"`, or route it through the page's status region. Every "Try now" ends in a status message ("dev.bg answered: 12 jobs" or "still no answer, next try 09:00"). On Job, move `aria-busy` onto the skeleton panels only (`:459`, `:467`). Add `aria-valuetext="9 of 14 sources"` to the progressbars (`feed.html:72`, `sources.html:296`) and the meter (`sources.html:385`).

### A11Y-09 · Moderate · "Needs you" chip below 4.5:1
- **Where:** `components.css:68` (`.chip.ask`), duplicated at `job.html:55`. Used at `job.html:286`, `:293`, `:306`, and in the requirements row "Needs you". Token at `tokens.css:8`.
- **WCAG:** 1.4.3 (12 px weight 500 is normal-size text).
- **What fails:** `--bloom` #b0466a on `--bloom-soft` #f7e3ea is 4.36:1 in light mode. Dark mode passes at 5.92.
- **Fix:** Darken light `--bloom` to #a33d62. That gives 5.04:1 on bloom-soft and 6.17:1 on white, and also helps the badge and `.status.offer`. Change `tokens.css` and `tokens.json` (`palette.bloom.600`) together. Remove the duplicate `.chip.ask/.closed/.target` rules from `job.html:55-57`; they already live in components.css.

### A11Y-10 · Moderate · Filter count text too faint
- **Where:** `components.css:74` (`.filter .n { opacity: .75 }`). The count markup is shared by the segmented counts on Feed (`feed.html:51`) and Sources (`sources.html:143`); the `.n` rule matches only inside `.filter`, but the pattern is the same.
- **WCAG:** 1.4.3.
- **What fails:** ink-2 at 75% on surface is 4.11:1 at 13 px.
- **Fix:** Drop the opacity and use `color: var(--ink-3)` when unpressed (5.78:1) and `inherit` when pressed.

### A11Y-11 · Moderate · Placeholder contrast in dark mode
- **Where:** No `::placeholder` rule in `components.css`. Affects `feed.html:48`, `:92`; `job.html:530`; `sources.html:274`, `:337`, `:378`.
- **WCAG:** 1.4.3. The placeholders carry the hint and example ("e.g. Kestrel Payments or kestrel.com/careers", "https://").
- **What fails:** The browser default #757575 on dark `--surface` #19231f is 3.50:1. It passes in light at 4.6.
- **Fix:** `.input::placeholder { color: var(--ink-3); opacity: 1 }`, which gives 5.78:1 in light and 5.94:1 in dark. Per the guideline, placeholders should also end with "…" and show a pattern.

### A11Y-12 · Moderate · Weak input focus indicator
- **Where:** `components.css:96` (`.input:focus { outline: none; border-color: var(--focus); box-shadow: 0 0 0 3px var(--met-soft) }`).
- **WCAG:** 2.4.7 Focus Visible; 1.4.11 for the indicator. Guideline: never `outline: none` without an equivalent replacement.
- **What fails:** The 1 px border shifts from `--border-control` to `--focus`, a 2.17:1 change. The met-soft halo is 1.20:1 against surface in light and 1.17:1 in dark. Focus in a field is hard to see, especially in the search pill.
- **Fix:** `.input:focus-visible { outline: 2px solid var(--focus); outline-offset: 1px }`, or `box-shadow: 0 0 0 2px var(--focus)`, and keep the border change as decoration. Use `:focus-visible`, which always matches text inputs.

### A11Y-13 · Moderate · Selected state barely distinguishable
- **Where:** `components.css:88` (`.segmented button[aria-pressed="true"]`), `:29` (`.nav a[aria-current="page"]`), `sources.html:17` (rail current).
- **WCAG:** 1.4.11 Non-text Contrast (the visual state of a component).
- **What fails:** The selected fill against the track or ground is 1.25:1 and 1.14:1 in light, and 1.15:1 and 1.10:1 in dark, where `--shadow-raised: none` also removes the shadow. The remaining cues are an ink-2 to ink text shift and weight 500 to 600, which are weak for low-vision users.
- **Fix:** Give selected items a 3:1 boundary or indicator, for example `box-shadow: inset 0 0 0 1px var(--border-control)` (3.09:1 light, 3.24:1 dark), or a 2 px `--action` underline or left bar on nav and rail items. Systemic, so do it in `components.css`.

### A11Y-14 · Moderate · Chip state missing for screen readers
- **Where:** `job.html:181` (Gaps: "Kubernetes security" is gap, "CISSP preferred" is partly). The `data-i` chips get only an `aria-hidden` icon (`:555`). Also `feed.html:152` and `job.html:650`.
- **WCAG:** 1.3.1 Info and Relationships.
- **What fails:** In the fit check, a screen-reader user hears two gap names and can't tell a missing requirement from a partly met one. The Feed chips do the opposite: they combine `title="partly met"` with sr-only ", partly met", so some screen readers announce the state twice.
- **Fix:** Build one chip helper that always appends `<span class="sr-only">, missing</span>` (or met, or partly met) and never sets `title`. Use it for the `data-i` chips too.

### A11Y-15 · Moderate · Reading-progress steps lack text state
- **Where:** `job.html:453-457` (`.steps` with `.done`, `.now`, `.next`).
- **WCAG:** 1.3.1.
- **What fails:** Done, in progress and next are conveyed by a check icon (`aria-hidden`), a spinner (`aria-hidden`), a dashed ring, and ink-3 colour.
- **Fix:** Add sr-only prefixes ("Done:", "In progress:", "Next:"), or `aria-current="step"` on the current item plus an sr-only "completed" on done items.

### A11Y-16 · Moderate · Heading structure gaps
- **Where:**
  - Feed · First run, `feed.html:89`: the only heading is an h2, so the state has no h1.
  - Sources · Remove, `sources.html:346-348`: no h1; the page starts at the dialog's h2.
  - Sources · Normal goes from h1 to h3 (`:157`, `:166`, and the detail panel at `:480` and `:485`).
  - Sources · Add (`:280`) and detecting (`:311`) also go h1 to h3.
  - Sources · Add · not found, `:321-333`: an h3 parent with h3 children.
  - Sources · Coverage, `:400`: an h3 directly after an h2 in a different panel.
  - Job · Bulgarian, `job.html:353`: when "View original" is open, the original's h3 comes before the page h1.
- **WCAG:** 1.3.1, 2.4.6 Headings and Labels. Guideline: headings should be hierarchical.
- **Fix:** Every state gets one h1. The First-run empty state takes `<h1>` styled at h2 size. The Remove state keeps the source name as its h1. Panel titles on Sources become h2 (the `.panel h2` styling already exists in job.html; move it to components.css as `.panel > h2, .panel-h h2`). On Not found, the "Other ways…" heading becomes h2 with h3 children. Give the Bulgarian original `role="region" aria-label="Original posting"` and make its heading h2, or place the panel after the job head.

### A11Y-17 · Moderate · Rail status dot is colour only
- **Where:** `sources.html:18-20`, `:120`, toggled at `:553`.
- **WCAG:** 1.4.1 Use of Color, 1.1.1 Non-text Content.
- **What fails:** The red (failing) or amber (unusual) dot next to "Sources & watchlist" has no text and no shape difference.
- **Fix:** Add an sr-only label ("1 source failing" or "1 unusual") inside the link, and use a different shape for warn, for example the ring or "!" glyph from the tile icons.

### A11Y-18 · Moderate · Menus and removable filters lack the right semantics
- **Where:** `feed.html:53` ("Angle: all ▾"), `:57` ("Sort: best fit ▾"), `sources.html:460` (⋯ "More for …"). Removable filters at `feed.html:113` ("Angle: design ✕" with `aria-pressed="true"`).
- **WCAG:** 4.1.2 Name, Role, Value.
- **What fails:**
  - The menu triggers have no `aria-haspopup` or `aria-expanded`, and the ▾ glyph is read aloud.
  - The ✕ chips are announced as "Angle: design ✕, toggle button, pressed", while activating them actually removes the filter. The "✕" is read as "multiplication x".
  - These buttons are missing `type="button"`; harmless outside forms, but needed in the app.
- **Fix:** Menu triggers get `aria-haspopup="menu" aria-expanded="false"` (or `listbox`), and the arrow glyphs get `aria-hidden="true"` (put them in a span). Removable chips become plain buttons with `aria-label="Remove filter: Angle, design"` and an `aria-hidden` ✕. After removal, focus moves to the next chip or to "Clear all".

### A11Y-19 · Moderate · Nowrap buttons break reflow at 320 px
- **Where:** `components.css:46` (`.btn { white-space: nowrap }`). Seen at `sources.html:330` ("Add Nexo to dev.bg and Jooble searches"); also at risk: `feed.html:105` ("They're gone, close them") and `:114`.
- **WCAG:** 1.4.10 Reflow (320 CSS px).
- **What fails:** At 320 px the Not-found state scrolls sideways (page 338 px wide in a 305 px viewport). Under text spacing at 400 px it reaches 409 px.
- **Fix:** `.btn { white-space: normal; text-wrap: balance; text-align: center }`, keeping `min-height`. Or keep nowrap only on `.btn.sm` and icon buttons.

### A11Y-20 · Moderate · Remove dialog behaviour unspecified
- **Where:** `sources.html:347` (`role="dialog"` rendered inline).
- **WCAG:** 4.1.2, 2.4.3 Focus Order, 2.1.2 No Keyboard Trap.
- **What fails:** This is fine as a static depiction, but the hi-fi is the spec. It has no `aria-modal`, no initial focus (it should land on "Pause instead" or Cancel, not the destructive button), no Esc, no focus return to the ⋯ button, and nothing making the background inert.
- **Fix:** Specify a native `<dialog>` opened with `showModal()` (it gives inertness and Esc for free), initial focus on the safe action, and focus returned to the trigger. Add this to the dialog component in components.css and DESIGN.md.

### A11Y-21 · Minor · `aria-label` on generic elements
- **Where:**
  - New dot: `feed.html:155` (`<span class="new-dot" aria-label="New">`).
  - Badge: `feed.html:33`, `job.html:151`, `sources.html:108` (`<span class="badge" aria-label="4 need you">`).
  - Skeleton: `job.html:446` (`aria-label="Salary loading"`).
  - Decide panels: `job.html:209`, `:260`, `:333`, `:384`, `:423`, `:470`, `:500` (`<div aria-label="Decide">`).
  - Board: `sources.html:135`, `:185`, `:233` (`<div class="board" aria-label=…>`).
- **WCAG:** 4.1.2. ARIA 1.2 prohibits naming the generic role, so screen readers ignore it inconsistently ("Applications 4", with no "need you").
- **Fix:** Replace with sr-only text (`<span class="sr-only">New: </span>`, `<span aria-hidden="true">4</span><span class="sr-only">, 4 need you</span>`). Give the Decide panels and the board `role="group"` (or a `<section>` with an sr-only heading, which also helps heading navigation to the main action).

### A11Y-22 · Minor · No skip link
- **Where:** All three pages; `<main id="main">` exists but nothing links to it.
- **WCAG:** 2.4.1 Bypass Blocks passes through landmarks. The guideline asks for a skip link.
- **Fix:** Add `<a class="skip" href="#main">Skip to content</a>` as the first focusable element, plus a `.skip` style in components.css that is visible on focus.

### A11Y-23 · Minor · Truncated titles only in a tooltip
- **Where:** `components.css:134` (`.table .t { max-width: 44ch; white-space: nowrap; text-overflow: ellipsis }`) and `feed.html:155` (`title`). Visible in Feed · After a week away.
- **WCAG:** 1.4.4 Resize Text and 1.4.13 good practice. A `title` tooltip can't be reached by keyboard or touch.
- **Fix:** Clamp to 2 lines (`display: -webkit-box; -webkit-line-clamp: 2`) instead of a single-line ellipsis, and drop `title`.

### A11Y-24 · Minor · Live-region roles on static banners
- **Where:**
  - `role="status"`: `feed.html:98`, `:105`; `job.html:231`, `:283`, `:349`, `:405`; `sources.html:227`.
  - `role="alert"`: `job.html:486`, `sources.html:179`.
  - Static toast: `sources.html:361`.
- **WCAG:** 4.1.3 (correct use).
- **What fails:** These banners are present at page load, so the roles add little; when the states are injected in the app they will be chatty. The same "source didn't respond" error is `status` on Feed and `alert` on Sources.
- **Fix:** Rule for the banner component: use `role="alert"` only for errors that appear after the user acts; plain banners rendered at load need no live role. Make Feed and Sources match.

### A11Y-25 · Minor · Empty table headers
- **Where:** `feed.html:75`, `:100`, `:107`, `:127` (empty `th.col-check`); `:120` (Hidden jobs, empty actions header).
- **WCAG:** 1.3.1.
- **Fix:** Use `<th class="col-check"><span class="sr-only">Select</span></th>` (or `<td>` where there is no checkbox column), and `<th><span class="sr-only">Actions</span></th>`, as Sources already does at `sources.html:450`.

### A11Y-26 · Minor · Repeated and ambiguous control labels
- **Where:**
  - `job.html:631` ("Make target", "Open ↗" on each posting).
  - `job.html:610` ("Show where" on each fact).
  - `job.html:395`.
  - `sources.html:282-286` ("Add" ×5), `:390` ("Add the job").
- **WCAG:** 2.4.4 passes because the context is in the same block; 2.4.9 (AAA) and the guideline ask for specific labels.
- **Fix:** Add sr-only context ("Open kestrel.greenhouse.io posting", "Show where: Salary", "Add Accedia"). Put ↗ in `aria-hidden="true"` and add "(opens site)" if the link opens a new tab.

### A11Y-27 · Minor · Toggle and switch feedback
- **Where:** `job.html:657` (Save sets `aria-pressed` and changes the text to "Saved"); `job.html:664-668` (Bulgarian/English switch rewrites `#bg-lang-text` and the primary label silently).
- **WCAG:** 4.1.2 (stable name for toggle buttons) and 4.1.3.
- **Fix:** Keep the label "Save" with `aria-pressed`, and show "Saved" visually through a pressed style. Alternatively, change the text and drop `aria-pressed`. Add `aria-live="polite"` to `#bg-lang-text`.

### A11Y-28 · Minor · Chart "normal range" band low contrast
- **Where:** `sources.html:511` (band `fill: var(--surface-sunken)`, dashes `var(--border-control)`).
- **WCAG:** 1.4.11 (graphical objects). Mitigated: the legend gives the range in text and the chart's `aria-label` lists the values.
- **What fails:** In light mode the band fill is 1.25:1 against surface and the dashed edges are 2.48:1 against the band.
- **Fix:** Draw the band edges in `--ink-3` (4.6:1 or better), or label the band's top and bottom values on the y-axis.

### A11Y-29 · Minor · Form field types
- **Where:** `feed.html:92` (job link), `sources.html:274`, `:337`, `:378` (URLs), `:374-376`.
- **Rule:** Web Interface Guidelines, Forms: correct `type`, a meaningful `name`, and `autocomplete`. Not a WCAG 1.3.5 failure, because these fields don't collect personal data.
- **Fix:** Use `type="url"` with `inputmode="url"` on link fields, add `name`, set `autocomplete="off"` on search and URL fields, and `spellcheck="false"` on URL fields.

### A11Y-30 · Minor · Review bar (review chrome, brief)
- **Where:** `components.css:156-161`, and the switcher JS at `feed.html:181`, `job.html:686`, `sources.html:556`.
- **What fails:** `role="tab"` buttons have no `tabpanel` or `aria-controls`, every tab is a separate Tab stop instead of using arrow keys, and the focus ring is 2.20:1 (fixed by A11Y-03). The button border is 2.87:1 in light and 2.17:1 in dark. It isn't product, so either use plain buttons with `aria-pressed`, or leave it as is.

## Systemic fixes, in priority order

1. `components.css` `.panel { grid-template-columns: minmax(0, 1fr) }` (A11Y-05).
2. `html { scroll-padding-top: … }` and a static topbar below 720 px (A11Y-06).
3. Inverse focus ring and toast hover (A11Y-03, A11Y-04).
4. `.input:focus-visible` outline and `.input::placeholder` colour (A11Y-11, A11Y-12).
5. A 3:1 selected-state indicator for `.segmented`, `.nav` and the rail (A11Y-13).
6. Light `--bloom` to #a33d62 in tokens.css and tokens.json (A11Y-09), and drop the `.filter .n` opacity (A11Y-10).
7. `.btn` allowed to wrap (A11Y-19).
8. A chip helper that always adds an sr-only state (A11Y-14).
9. Spec rules for the toast/status region, single-key shortcuts and clickable rows (A11Y-01, A11Y-02, A11Y-07, A11Y-08).

## Resolution

Applied 2026-10-11 to `hifi/feed.html`, `job.html` and `sources.html`. Systemic fixes were already made in `components.css` and `tokens.css` and are marked Skipped here. No page-local style overrides them any more: job.html's duplicate chip rules are removed, and the Sources rail now carries the selected outline itself.

Verified in the browser at 320, 400 and 1280 px, in light and dark, for all 25 states:
- no page-level horizontal overflow
- exactly one h1 per state, with no skipped heading levels
- no duplicate ids
- no console errors

A real keyboard pass (Tab and Shift-Tab through each page's normal state) showed a visible focus ring on every stop, nothing hidden under the sticky topbar, and Enter opening Sources history. Feed J/K/S/X, the arrow keys and turning shortcuts off were checked with real key presses, and so were the Remove dialog's focus and Esc. The pass was keyboard only; no screen reader was used.

| ID | Status | What changed |
|---|---|---|
| A11Y-01 | Fixed | Each source name is a `<button aria-expanded aria-controls>` that opens the history inline under its row. Enter and Space work |
| A11Y-02 | Fixed | Single-key shortcuts fire only while focus is inside a Feed jobs table, and a visible "Keyboard shortcuts: on · Turn off" toggle sits in the bulk bar. Rows use a roving tabindex, so the list is one Tab stop, the cursor is real focus, and Enter opens the job. The arrow keys still work when shortcuts are off. The Job page no longer has single-key shortcuts: Previous and Next are buttons, and only Esc remains |
| A11Y-03 | Skipped | Fixed in components.css (`.toast :focus-visible`). The new toasts use `.toast` |
| A11Y-04 | Skipped | Fixed in components.css (toast ghost hover) |
| A11Y-05 | Skipped | Fixed in components.css (`.panel` minmax). Page-local: the Sources segmented control now wraps, and the ⋯ column is gone |
| A11Y-06 | Skipped | Fixed in components.css (`scroll-padding-top`). Confirmed by the Shift-Tab pass |
| A11Y-07 | Fixed | One always-present `role="status"` toast host per page. Undo lasts 15 s with a visible countdown that pauses on hover or focus, plus a Dismiss button. After a pass, focus moves to the next row (Feed) or the next job's h1 (Job). Undo restores the row and focus. Lasting undo path: Passed & closed |
| A11Y-08 | Fixed | Feed check progress is in `aria-live="polite"`, and its progressbar has `aria-valuetext`. The bar announces when queued jobs merge, and the end state is announced. Health pill changes go through the polite region. "Try now", "Check now" and "Check all now" end with a status message. Job: `aria-busy` is moved from the section to the skeleton panels. The detecting progressbar and coverage meter have `aria-valuetext` |
| A11Y-09 | Skipped | Token darkened in tokens.css. job.html's duplicate `.chip.ask/.closed/.target` and `.status.rejected` rules are removed |
| A11Y-10 | Skipped | components.css |
| A11Y-11 | Skipped | components.css. Placeholders now end with "…" |
| A11Y-12 | Skipped | components.css |
| A11Y-13 | Fixed for the Sources rail | Page-local outline on the current rail item. Segmented control and nav are fixed in components.css |
| A11Y-14 | Fixed | Every requirement chip adds sr-only state text, and no `title` is used. The Job fit check's Gaps and Partly met chips say "missing" or "partly met" |
| A11Y-15 | Fixed | sr-only "Done:", "In progress:" and "Next:" prefixes, and `aria-current="step"` |
| A11Y-16 | Fixed | One h1 in every state. First run has an h1 styled like an h2. Remove has the source as its h1. Sources panel titles are h2. Not found uses an h2 with h3 children. The Bulgarian original is a region after the job head, with an h2 |
| A11Y-17 | Fixed | The rail mark uses a shape (✕ for failing, ! for unusual) plus sr-only text such as ", 1 source unusual" |
| A11Y-18 | Fixed | The Feed Angle, Location, Salary and Sort controls are disclosure buttons with `aria-expanded`/`aria-controls`, a working popover (Esc closes it) and hidden ▾. Removable filters are plain buttons labelled "Remove filter: Angle, design" with a hidden ✕. Every button has `type="button"`. The Sources ⋯ menu is removed. Not simulated: removing a filter and moving focus to the next chip |
| A11Y-19 | Skipped | components.css. Confirmed: no overflow at 320 px |
| A11Y-20 | Fixed | Remove is a native `<dialog>` opened with `showModal()`. Focus starts on "Pause instead", Esc and Cancel close it, and focus returns to "Remove from watchlist…". Confirming shows the Undo toast |
| A11Y-21 | Fixed | The new dot, badge and skeleton use sr-only text. Decide panels, the board and the mail path use `role="group"` |
| A11Y-22 | Fixed | A skip link on each page, styled page-locally. It could move to components.css later |
| A11Y-23 | Fixed | Titles clamp at 2 lines, and `title` is removed |
| A11Y-24 | Fixed | No live roles on banners present at load, on any page. Live announcements go through the page's status region |
| A11Y-25 | Fixed | Header cells say "Select all shown" and "Actions" (sr-only) |
| A11Y-26 | Fixed | sr-only context on Open, Make target, Show where, Add, Pause, Remove, Save, Pass and Undo. ↗ is `aria-hidden` |
| A11Y-27 | Fixed | Save is a plain button whose text changes, with no `aria-pressed`, and it announces politely. The Bulgarian language text is `aria-live="polite"` |
| A11Y-28 | Fixed | Band edges are drawn in `--ink-3`, and the legend matches |
| A11Y-29 | Fixed | Link fields use `type="url"`, `inputmode="url"`, `spellcheck="false"`, a `name` and `autocomplete="off"` |
| A11Y-30 | Skipped | Review chrome, not product |
