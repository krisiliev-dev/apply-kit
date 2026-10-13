# Prepare hi-fi: accessibility audit

Scope: `docs/design/hifi/onboarding.html`, `profile.html`, `package.html`, `cv-template.html` and their shared script `prepare.js`, with the shared `app/ui/src/styles/components.css` (including the new Prepare components) and `tokens.css`. Standard: WCAG 2.2 AA, plus the Discover audit's rules already in DESIGN.md.

**How it was tested (2026-10-13).** No browser was available in this session, so this is a code-and-token audit, not a rendered one:

- **Markup:** every file parsed for balanced tags, duplicate ids and broken `for` / `aria-describedby` / `aria-controls` / `aria-labelledby` references (none left). Semantics, names, roles and focus handling were read from the source and the state script.
- **Contrast:** computed from the token values for every text and UI pair the new components use, in both themes (script results below).
- **Layout and reflow:** judged from the CSS breakpoints. Before sign-off, do a rendered pass at 320, 400 and 1280 px, at 200% zoom and with the 1.4.12 text-spacing override, in both themes, and a manual Tab pass through every package state.

The review bar is review chrome, not product, and is out of scope (its focus ring now uses `--ground`, as A11Y-03 in the Discover audit asked).

## Summary

| Severity | Count | Fixed in the hi-fi | Carried into the spec | Pass, noted |
|---|---|---|---|---|
| Blocker | 0 | – | – | – |
| Serious | 5 | 5 | – | – |
| Moderate | 8 | 6 | 2 | – |
| Minor | 4 | – | 2 | 2 |

| ID | Sev | Screen · state | WCAG | Issue | Status |
|---|---|---|---|---|---|
| PA-01 | Serious | Package · CV, Kubernetes gap | 4.1.2 Name, Role, Value | A radio button carried `aria-expanded` and toggled a hidden field on every click | Fixed |
| PA-02 | Serious | Package · Approve with an open flag | 2.4.3 Focus Order, 4.1.3 | Pressing an `aria-disabled` Approve left focus on the button; the alert explaining why wasn't focused or reliably announced | Fixed |
| PA-03 | Serious | Package · every step | 2.4.11 Focus Not Obscured | The new sticky action bar can cover the field that has focus when tabbing down a long step | Fixed |
| PA-04 | Serious | Package, Setup · side columns | 1.4.10 Reflow, 2.4.11 | Sticky side columns taller than the viewport (200% zoom, short laptop screens) hide their lower half, which can't be scrolled to | Fixed |
| PA-05 | Serious | Package · Cover letter | 1.3.1, 1.4.1 Use of Color | "Written for Kestrel" is shown only as a highlight inside the editor, invisible to screen readers | Fixed |
| PA-06 | Moderate | Setup · Import; Profile · Voice | 2.4.7 Focus Visible | File inputs are visually hidden, so their focus ring is invisible | Fixed |
| PA-07 | Moderate | Package · previews; CV template | 2.1.1 Keyboard | Document frames scroll (A4 is wider than a phone) but can't be focused to scroll by keyboard | Fixed |
| PA-08 | Moderate | Profile · Edit piece | 2.5.8 Target Size | Tag remove buttons are 20 × 20 px and sit next to each other | Fixed |
| PA-09 | Moderate | Package · Generating | 4.1.3 Status Messages | Parts finishing ("3 of 5 parts ready") aren't announced | Fixed |
| PA-10 | Moderate | Package · aria-disabled Approves | 3.3.1 Error Identification | Pressing Approve on Screening answers, ATS check or a two-page CV did nothing | Fixed |
| PA-11 | Moderate | Package · CV and letter previews | 1.3.1, 2.4.6 | The page's own headings ("Summary", "Experience") appear in the screen's heading outline; the name was a second h1 | Partly fixed · spec |
| PA-12 | Moderate | Generated PDFs | 1.3.1, 3.1.1 Language of Page | PDFs must be tagged, in reading order, with their language, or a screen-reader user can't check their own CV | Spec |
| PA-13 | Moderate | Setup · Interview | 4.1.3 | "Coach is writing…" and the automatic retry countdown need to be announced once, not every second | Fixed |
| PA-14 | Minor | Profile · Edit answer | 3.1.2 Language of Parts | Bulgarian phrasings sit in an English textarea without `lang` | Spec |
| PA-15 | Minor | Package · previews at "Fit" | 1.4.4 Resize Text | At Fit the A4 page is scaled to about 62%, so body text is about 8 px | Spec |
| PA-16 | Minor | Profile · Answer bank | 1.4.10 | Long answers are clamped to two lines | Pass, with note |
| PA-17 | Minor | All | 2.5.8 | The 16 px radios and checkboxes | Pass (spacing exception) |

## Contrast (computed from tokens)

All new text pairs pass 4.5:1 and all new UI boundaries pass 3:1, in both themes.

| Pair (where) | Light | Dark |
|---|---|---|
| `ink-3` on `surface` (meta, choice help, step sub-labels) | 5.78 | 5.94 |
| `ink-3` on `surface-sunken` (parse labels, doc-frame bar) | 4.64 | 6.80 |
| `partly` on `surface` (NEAR THE LINE label, flag edge) | 6.77 | 10.74 |
| `partly` on `partly-soft` (page chip "2 pages") | 5.75 | 9.06 |
| `gap` on `surface` (GAP label, failed step) | 6.30 | 8.06 |
| `gap` on `gap-soft` ("no dates found" in parse) | 5.07 | 7.27 |
| `bloom` on `surface` (flagged step sub-label) | 6.17 | 6.60 |
| `bloom` on `bloom-soft` (Needs you chip, flagged step icon) | 5.04 | 5.92 |
| `met` on `surface` (done step sub-label) | 6.71 | 9.50 |
| `met` on 55% `met-soft` (resolved flag label) | 6.10 | 8.73 |
| `ink` on 70% `met-soft` (inserted text in a change) | 13.00 | 12.09 |
| `ink` on `bloom-soft` (letter highlight) | 12.03 | 12.05 |
| `ground` on `ink` (current Profile section link) | 12.93 | 14.75 |
| `on-action` on `bloom` (section count) | 6.17 | 7.57 |
| `border-control` on `surface` (drop zone dashes, choice borders) | 3.09 | 3.24 |
| `focus` on `ground` (focus ring) | 5.89 | 8.70 |
| Document: text / muted / accent on white | 14.74 / 7.03 / 8.17 | same (documents are always white) |

## Details

### PA-01 · Serious · A radio that pretends to be a disclosure
- **Where:** `package.html`, CV state, Kubernetes gap flag, third option (was `data-toggle` plus `aria-expanded` on `<input type="radio">`).
- **What failed:** `aria-expanded` isn't allowed on a radio, and the click toggle hid the field again on a second click while the radio stayed checked.
- **Fix (done):** The radio has `value="have"` and `aria-controls`; the field shows through `.flag:has(input[value="have"]:checked) .k8s-ev`. Rule for the build: show follow-up fields from the checked state, never from clicks.

### PA-02 · Serious · Refusals must move focus to their reason
- **Where:** `package.html`, CV state Approve (`aria-disabled="true"`) → "Approve with an open flag".
- **Fix (done):** The alert has `role="alert"`, `tabindex="-1"` and `data-autofocus`; `prepare.js` focuses it on entering the state. Its "Go to the flag" link lands on the open flag, whose heading takes focus. The stuck Approve keeps `aria-describedby` pointing at "1 flag left: incident response wording".

### PA-03 · Serious · Sticky action bar over the focused field
- **Where:** `.actionbar` (now in `components.css`).
- **Fix (done):** `html:has(.actionbar) { scroll-padding-bottom: 112px }` keeps focused elements clear of the bar, and the bar becomes static under 560 px of viewport height (200% zoom on a laptop).

### PA-04 · Serious · Sticky side columns cut off
- **Where:** `.side` in `package.html` and `onboarding.html`.
- **Fix (done):** Sticky only at ≥ 961 px wide and ≥ 820 px tall; otherwise the column flows after the main one.

### PA-05 · Serious · Highlights only in colour
- **Where:** `package.html`, Cover letter editor (`<mark>` inside a `contenteditable` textbox).
- **Fix (done):** The editor keeps its highlights, and a text line under it names them: "4 sentences were written for Kestrel: the opening sentence and the first three sentences of paragraph 3." The highlight also has an underline, not only a fill. Build: the editor is a labelled multi-line textbox (`role="textbox"`, `aria-multiline`), and the word count is its description.

### PA-06 · Moderate · Invisible focus on file inputs
- **Fix (done):** `label.btn:has(+ input[type="file"]:focus-visible)` draws the focus ring on the visible label (`components.css`).

### PA-07 · Moderate · Scrollable document frames
- **Fix (done):** Every `.doc-frame` has `tabindex="0"`, `role="region"` and a name ("CV preview, page 1 of 1").

### PA-08 · Moderate · Small tag buttons
- **Fix (done):** Tag remove buttons are at least 24 × 24 px.

### PA-09 · Moderate · Silent generation progress
- **Fix (done):** The "3 of 5 parts ready" heading row is `aria-live="polite"`; the progress bar has `aria-valuetext`. Build: announce each finished part once ("CV ready, 2 flags for you"), not every tick.

### PA-10 · Moderate · Approve that does nothing
- **Fix (done):** Every `aria-disabled` Approve names its reason (`aria-describedby`) and, when pressed, moves focus to what blocks it (the salary question, the first month select, the "how to fit one page" choices) and announces "Can't approve yet: …".

### PA-11 · Moderate · Document headings in the page outline
- **Fix (partly done):** The name in previews is no longer an `h1` (one h1 per view). **Spec:** the app shows the real PDF (rendered with pdf.js, with its text layer for selection and screen readers) inside the named region, so the document's own structure isn't mixed into the screen's headings.

### PA-12 · Moderate · Accessible PDFs
- **Spec:** Generated PDFs are tagged with headings and lists in reading order, set `/Lang` (`en` or `bg`) and a title ("Nia Koleva · CV · Kestrel Payments"), and keep real text. The ATS check's text extraction doubles as the reading-order check.

### PA-13 · Moderate · Interview status
- **Fix (done):** The transcript is a `role="log"` (polite). The timeout banner is a single `role="alert"`; its countdown number isn't live, so only the start and the outcome are announced.

### PA-14 · Minor · Mixed-language phrasings
- **Spec:** Each phrasing is its own row with a language, so Bulgarian ones get `lang="bg"`.

### PA-15 · Minor · Small text at Fit
- **Spec:** Fit is an overview; 100% (default on narrow screens is Fit, then the user can switch) and browser zoom both work, and the file can be downloaded. Remember the user's last zoom.

### PA-16 · Minor · Clamped answers
- **Pass:** the clamp is visual only; the full text is in the DOM and in Edit.

### PA-17 · Minor · Small radios and checkboxes
- **Pass:** 16 px controls with no other target within 24 px, and every label is clickable.

## What already works

- One h1 per state; steps are an ordered list in a named `nav`, with `aria-current="step"`.
- States are never shown by colour alone: step icons differ in shape (number, tick, cross, dashed ring, spinner) and every state has a text sub-label; flags carry a label and an icon.
- Every form field has a visible label above it, help under the label, errors under the field tied with `aria-describedby`, and an error summary that links to each field.
- `lang="bg"` on the Bulgarian CV and the Bulgarian answer fields.
- Motion: the only animation is the spinner, which respects `prefers-reduced-motion`.
