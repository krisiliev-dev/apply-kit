# Track hi-fi: accessibility audit

Scope: [`hifi/applications.html`](../hifi/applications.html), [`hifi/application.html`](../hifi/application.html), the shared [`hifi/track.css`](../hifi/track.css) and [`hifi/track.js`](../hifi/track.js), on top of `app/ui/src/styles/tokens.css` and `components.css`. Standard: WCAG 2.2 AA, plus the rules already set by the Discover audit ([discover-a11y.md](discover-a11y.md)) and DESIGN.md.

How it was tested (2026-10-13): every review-bar state was rendered headless in Chromium at 1280 and 400 px, in light and dark (`prefers-color-scheme`), with a script that reports script errors and any element wider than the viewport (none remain). Contrast was computed from the token values, with opacity blended in. Semantics and keyboard behaviour were read from the source and the rendered DOM; native `<dialog>` with `showModal()` supplies the focus trap and Esc. No screen-reader run yet: do a quick VoiceOver pass on the built screens before sign-off.

The review bar is review chrome. It now uses a group of `aria-pressed` buttons instead of a tablist without panels (fixes Discover's A11Y-30 for these pages).

## Summary

| Severity | Count | Fixed in hi-fi | Carried to build |
|---|---|---|---|
| Blocker | 0 | 0 | 0 |
| Serious | 4 | 4 | 0 |
| Moderate | 7 | 5 | 2 |
| Minor | 5 | 1 | 4 |

| ID | Sev | Screen · state | WCAG | Issue | Status |
|---|---|---|---|---|---|
| TA-01 | Serious | Applications · weekly chart | 1.4.11 Non-text Contrast | The current week's bar was `met-soft` on white: 1.20:1 (light), 1.17:1 (dark) | Fixed: hatched with `action` stripes (6.71:1 / 7.93:1) |
| TA-02 | Serious | Application · stepper | 1.4.3 Contrast | Not-current Rejected/Withdrawn were faded to 60%: 2.39:1 (light) | Fixed: full colour, dashed outline; current one solid and bold |
| TA-03 | Serious | Applications · Needs you after "Mark sent"; withdraw list | 1.4.3 Contrast | Done items faded to 55% opacity: 2.62:1 | Fixed: sunken background, grey edge, "DONE" in the kind line |
| TA-04 | Serious | Both · toasts | 4.1.3 Status Messages | The toast had `role="status"` and also went through the polite announcer, so it was read twice | Fixed: announced once; undo window 10 s, paused on hover and focus, focus returns to the control that caused it |
| TA-05 | Moderate | Applications · email to match | 3.3.1 Error Identification, 1.3.1 | The "choose where it belongs" error wasn't tied to the radio group | Fixed: `aria-describedby` on the fieldset, `role="alert"` on the message, focus to the first option |
| TA-06 | Moderate | Application · timeline Undo | 2.5.8 Target Size (Minimum) | "Undo" was an inline text button about 18 px tall | Fixed: small button (30 px) |
| TA-07 | Moderate | Application · prep sheet | 2.5.3 Label in Name | Column header showed "Done" but was announced "Practised" | Fixed: visible "Practised" |
| TA-08 | Moderate | Applications · weekly chart | 2.1.1 Keyboard | Only the current week's bar is focusable; earlier weeks are reachable only by pointer | Fixed for content: "Show as table" gives every value; carry to build: arrow keys move between bars |
| TA-09 | Moderate | Applications · row status select | 3.2.2 On Input | Some platforms fire `change` while arrowing through a closed select, applying each Status in turn | Build: apply on `change` only when the select is open or on blur/Enter; always with undo |
| TA-10 | Moderate | Application · Accepted → withdraw others | 4.1.2, 2.4.3 | The hi-fi shows the withdrawal step as an inline mock (`aria-modal="false"`) | Build: a real modal `<dialog>`, focus on its heading, Esc keeps everything open and returns to the Status control |
| TA-11 | Moderate | Applications · draft dialog with several drafts | 2.4.3 Focus Order | "Next draft" must move focus to the new draft's heading and announce "Draft 2 of 6" | Fixed in the counter; carry focus move to build |
| TA-12 | Minor | Applications · Needs you | 1.3.1 / guideline | Kind lines are written in capitals in the source ("FOLLOW-UP DUE TODAY"); some screen readers spell capitals out | Build: sentence case in the source, `text-transform: uppercase` in CSS |
| TA-13 | Minor | Applications · list | 3.1.2 Language of Parts | Bulgarian job titles in the list have no `lang="bg"` (the Application page and quotes do) | Build |
| TA-14 | Minor | Both · chart text | 1.4.4 / guideline | Chart labels are 11 px (below the 12 px caption token); contrast passes (5.78:1) | Build: use `--fs-caption` |
| TA-15 | Minor | Applications · Next column | 1.4.1 Use of Color | Due items are pink plus a dot; the words say "due today", so colour isn't alone | Pass, noted |
| TA-16 | Minor | Application · date inputs | guideline | Native date inputs show the browser's locale format | Build: show the app's date beside it |

## Checked and passing

- **Contrast of new pairs** (light / dark): bloom kind captions on surface 6.17 / 6.60; `by email` tag ink-2 on surface-sunken 6.33 / 10.45; skipped steps ink-3 on ground 5.07 / 6.52; What's-working fill (action) on its track 5.61 / 6.80 and on surface 6.71 / 7.93; dashed status outlines (border-control) 3.09 / 3.24.
- **Statuses never by colour alone:** status pills carry their name; closed ones have a hollow dot; skipped steps are struck through with "(skipped)" for screen readers; event causes carry an icon and "by email / by you / by apply-kit".
- **Dialogs:** native `<dialog>` + `showModal()`: focus moves to the first field or heading, Tab stays inside, Esc closes, focus returns to the opener.
- **Headings:** one h1 per state; Needs you and the list are h2; status groups are h3 with the disclosure button inside the heading.
- **Labels:** every row status select has a visually hidden label naming the job and company; search, filters and selects are labelled.
- **Reflow:** no horizontal page scroll at 400 px in any state, light or dark; tables reflow to two columns (job and status) with the other facts under the title.
- **Reduced motion:** the only motion is the disclosure chevron and the spinner, both off under `prefers-reduced-motion`.
- **Chart:** single series, one hue; the current week is hatched, the win state is pink and labelled "above pace", every bar has a tooltip on hover or focus, and a table view holds every value.
