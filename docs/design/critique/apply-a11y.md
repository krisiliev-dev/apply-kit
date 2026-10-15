# Apply hi-fi: accessibility audit (design step 8, design side)

Scope: [`docs/design/hifi/extension-fill.html`](../hifi/extension-fill.html) with the shared `app/ui/src/styles/tokens.css` and `components.css`. Standard: WCAG 2.2 AA, plus the pinned Web Interface Guidelines in `.claude/skills/web-design-guidelines/`. The side panel is what gets built; the mock portal stands for a third-party page apply-kit doesn't control, and is audited only where apply-kit changes it (the marks it adds).

How it was tested (2026-10-13): no browser was available in this session. The page's script was run in a DOM (linkedom) to confirm all 17 states render and to list every input without a label (none). Contrast was computed from the token values for every text and UI pair the page introduces, in light and dark. Semantics, focus order and live regions were read from the source. Treat every finding as code-verified; before the build is signed off, do a manual pass in Chrome's real side panel with the keyboard and VoiceOver, at panel widths 320, 360 and 480px, in both themes and with 200% zoom.

The review bar is review chrome, not product (AX-16 only).

## Summary

| Severity | Found | Fixed in hi-fi | Carried into the spec |
|---|---|---|---|
| Serious | 5 | 3 | 2 |
| Moderate | 8 | 3 | 5 |
| Minor | 3 | 0 | 2 (1 accepted) |

| ID | Sev | State | WCAG / rule | Issue | Status |
|---|---|---|---|---|---|
| AX-01 | Serious | All filled lists | 1.3.2 Meaningful Sequence | Field rows read "Given Name, Profile, Kris": the source chip came before the value in the DOM | **Fixed:** DOM order label → value → source; the grid places the chip on the right |
| AX-02 | Serious | All, panel footer | 2.4.11 Focus Not Obscured (Minimum) | The sticky footer (primary action + boundary line) can cover the focused control at the bottom of a long panel | **Fixed in hi-fi** with `scroll-padding-bottom`; spec: the panel document sets it to the footer's height |
| AX-03 | Serious | Filling → Filled | 4.1.3 Status Messages | The result of a fill (how many filled, how many need you) appears without an announcement, and focus stays on the button with nothing said | Spec: announce politely at start ("Filling My Information") and end ("6 filled, 1 needs you"); after the fill, focus moves to the first needs-you item, else stays on Fill this page |
| AX-04 | Serious | Questions | 4.1.3, 2.2 | The character counter was a live region and announced every keystroke | **Fixed:** counter is visible only; "50 characters left" is announced once when crossing the threshold |
| AX-05 | Serious | Didn't stick, CV didn't attach | 3.3.1 Error Identification | Errors must name the field in text and sit with role="alert" | Pass in hi-fi (banner/alert + field name); spec keeps it |
| AX-06 | Moderate | All | 1.3.1, 2.4.6 Headings and Labels | The panel document has no h1 of its own (the hi-fi borrows the page's) | Spec: the panel's h1 is the job title in the context card ("Security Engineer · Sofia"), or the state's title when there's no job; page and question headings are h2 |
| AX-07 | Moderate | Every "Show on page" | 2.4.3 Focus Order, 2.1.1 | Focus can't be moved from the side panel into the page programmatically, so a keyboard user can't reach the field just shown | Spec: Show on page scrolls the field into view, outlines it for 2 s and focuses it in the page; the panel adds "Press F6 to move to the page" the first time it's used |
| AX-08 | Moderate | Context card | 1.3.1 | The "where" line was typed in capitals and may be spelled out letter by letter | **Fixed:** sentence case in the markup, uppercase by CSS |
| AX-09 | Moderate | Not a known portal | 3.1.2 Language of Parts | Bulgarian form labels in the copy list weren't marked `lang="bg"` | **Fixed:** Bulgarian label and value spans carry `lang="bg"`; the English meaning follows |
| AX-10 | Moderate | Marks on the portal | 1.4.1 Use of Color, 1.4.11 | The marks apply-kit adds to the portal must not rely on colour and must not change the portal's layout, tab order or accessibility tree | Pass in hi-fi: each mark has a shape (tick, ?, half circle, cross) and a 3 px edge ≥ 5.4:1. Spec: marks are drawn as an outline plus a positioned badge with `pointer-events: none` and `aria-hidden`, and removed by Undo; the panel list is the accessible record |
| AX-11 | Moderate | Allow portals, Not a known portal | 2.5.8 Target Size (Minimum) | Copy buttons and small ghost buttons must be ≥ 24 px | Pass: `.btn.sm` is 30 px; field rows are 44 px; radio and checkbox rows are ≥ 24 px |
| AX-12 | Moderate | Context card | 1.4.3 Contrast (Minimum) | `--ink-3` on `--surface-sunken` is 4.64:1 in light: passes, with almost no margin | Accepted; noted in DESIGN.md: don't put `--ink-3` text on `--surface-sunken` below 12 px or at normal weight below 13 px |
| AX-13 | Moderate | Pair | 3.3.1, 3.3.2 | The pairing error must appear under the field with role="alert" and the field marked `aria-invalid` | Spec (the existing popup already does the alert; add `aria-invalid`) |
| AX-14 | Minor | Filling | 2.3.3 Animation from Interactions | Spinner animates | Pass: `.spin` only animates with `prefers-reduced-motion: no-preference` |
| AX-15 | Minor | All | 2.1.4 Character Key Shortcuts | The "Fill this page" keyboard shortcut (Alt+Shift+F) must use a modifier and be remappable | Spec: declared as a Chrome command, remappable at chrome://extensions/shortcuts |
| AX-16 | Minor | Review bar | 4.1.2 | The state tabs have no `aria-controls` | Accepted: review chrome only, same as Discover |

## Contrast checked (computed from tokens)

| Pair | Light | Dark | Use |
|---|---|---|---|
| `--ink-3` / `--ground` | 5.07 | 6.52 | portal tag, legend |
| `--ink-3` / `--surface-sunken` | 4.64 | 6.80 | context card "where" line |
| `--ink-2` / `--surface-sunken` | 6.33 | 10.45 | callouts |
| `--bloom` / `--surface` | 6.17 | 6.60 | needs-you marks and edges |
| `--gap` / `--surface` | 6.30 | 8.06 | didn't-stick marks |
| `--partly` / `--surface` | 6.77 | 10.74 | check-it marks |
| `--met` / `--surface` | 6.71 | 9.50 | filled edges and ticks |
| `--border-control` / `--surface` | 3.09 | 3.24 | inputs, portal field outlines (UI, ≥ 3:1) |
| `--bloom` / `--ground` | 5.42 | 7.24 | Submit ring on the review page |

Chip pairs (`met`, `ask`, `partly`, `gap`, `closed`, `neutral`) are unchanged from the Discover audit.

## Keyboard path (from the source)

Header → Fill / Capture switch → context card (static) → needs-you items (each: answer control, Fill, Show on page, Save to answer bank) → field rows (each a button: Show on page) → Undo this page → footer primary. The primary action is last in tab order but always visible (sticky). The Chrome command reaches Fill this page from anywhere in the page.
