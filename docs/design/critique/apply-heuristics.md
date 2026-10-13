# Apply: heuristic evaluation

Design step 7. One evaluator, 2026-10-13. Screen: hi-fi [`extension-fill.html`](../hifi/extension-fill.html), the extension's side panel next to a mock portal, first draft with 16 states (a 17th, "Different job", was added as a fix). Checked against Nielsen's 10 heuristics (H1–H10) and four domain criteria:

- **(a) The user stays in charge:** apply-kit never submits, never navigates, never acts without a click, never touches passwords or terms, and nothing is learned silently.
- **(b) Speed:** found → submitted in under 10 minutes, portal included; zero retyping ([PRODUCT.md](../PRODUCT.md) success measures).
- **(c) Correctness and honesty:** the right package goes to the right job; every filled value says where it came from; drafts stay inside the honesty line.
- **(d) Consistency:** with Capture (the same panel), the Discover rules in [DESIGN.md](../DESIGN.md), and the glossary.

The bar comes from PRODUCT.md, [flows.md](../flows.md) (moment of truth 3: "the first real portal, likely Workday"), the approved [extension wireframe](../wireframes/extension.html), [GLOSSARY.md](../../../GLOSSARY.md) and DESIGN.md.

**Method.** Every state was read from the source and walked in the order a real application runs (Workday: setup → detected → filling → filled → CV → questions → review → confirmation → marked; then Greenhouse without a package, SmartRecruiters with a failed upload, a Bulgarian company form, and the two error states). No browser was available in this session, so layout was judged from the CSS (grid breakpoints, min widths, overflow rules) and the page's script was run in a DOM (linkedom) to confirm every state renders and every input has a label. Contrast pairs were computed from the tokens. Treat layout findings as code-verified; do a visual pass at 320, 360 and 480px panel widths before sign-off.

Severity uses Nielsen's scale: 4 catastrophe, 3 major, 2 minor, 1 cosmetic. **Every 3 and 4 is fixed in the hi-fi or written into the spec as required behaviour**; the Status column says which.

## Summary

| ID | Sev | State | Heuristic · criterion | Finding | Status |
|---|---|---|---|---|---|
| AP-01 | 4 | Filled, CV, Questions (session model) | H5 · (c) | "The package stays with this tab until you submit or close it" means a tab that moves to another job at the same company would be filled with the first job's CV and answers | **Fixed:** every Fill re-checks the tab's job reference against the session's package; new state "Different job"; spec rule |
| AP-02 | 3 | Filled → next page | H1 · (c) | The panel can't see Workday move to the next step, so after Save and Continue it still shows "My Information · 6 filled" as if current | **Fixed:** address/title change moves the list under "Earlier pages" with "New page? Click Fill this page"; design note + spec |
| AP-03 | 3 | CV, Questions, Didn't stick, CV didn't attach | H3, H4 · (a) | "Undo this page" exists only in the Filled state; three other filled pages have no undo | **Fixed:** Undo this page on every page apply-kit filled |
| AP-04 | 3 | All paired states | H6, H4 · (d) | The panel replaces the Capture popup, but nothing shows how to get to Capture from it | **Fixed:** Fill / Capture segmented switch under the header |
| AP-05 | 3 | Review | H5 · (a)(c) | "I've submitted this" sits in the footer of the Review page, the one place it's most likely to be pressed *before* submitting, creating a false Application | **Fixed:** removed from Review; marking happens on the confirmation page, on unknown forms, or from the Job page |
| AP-06 | 3 | Single-page portals (Greenhouse, Lever, Ashby) | H7 · (b) zero retyping | Answers typed directly on the portal were offered for the answer bank only on Workday's Review page; single-page portals have none, so those answers were lost | **Fixed:** also offered on "Did you submit?" and on each re-fill |
| AP-07 | 3 | Filled (first fill) | H10, H6 · (c) | The marks apply-kit puts on the portal (pine tick, pink "?") are explained only in the review legend under the mock, which isn't product | **Fixed:** one-line key in the panel under the first filled list |
| AP-08 | 3 | CV attached (wireframe carry-over) | H3, H1 · (a) | The wireframe removed Workday's duplicate job entries automatically and then reported it; that changes the portal without a click | **Fixed in the draft already:** reported with "Remove the 2 duplicates" / "Keep them" |
| AP-09 | 3 | No package (wireframe carry-over) | H5 · (c) quality held | "Fill name and email only" would fill a portal with no tailored CV and create an application apply-kit can't track | **Fixed in the draft already:** dropped; capture → prepare → return |
| AP-10 | 2 | Filled | H4 | The needs-you button reads "Fill "Sofia, Sofia City"" and doesn't change when the other option is chosen | **Fixed:** "Fill City" |
| AP-11 | 2 | Allow portals | H2, H5 | Chrome's permission prompt wording ("read and change your data on…") is scarier than what apply-kit does; the panel explains it first, but only once | Spec: the explanation stays reachable from the panel's settings |
| AP-12 | 2 | Questions | H7 · (b) | Three needs-you items take three separate Fill clicks | Kept: salary is "ask each time" on purpose; a "Fill all as suggested" would bypass it. Revisit after the portal trial |
| AP-13 | 2 | Account | H1 | "Verification email … Waiting" depends on Track's mailbox reading; without it the line would wait forever | Spec: shown only when the job mailbox is connected; otherwise "Check the job mailbox for Workday's email" |
| AP-14 | 2 | Not a known portal | H5 · (a) | "I've submitted this" on an unknown form has no confirmation step | Kept: the Undo on the marked state covers it (it stays until the panel closes) |
| AP-15 | 2 | Marked | H3 | A 10-second toast undo (Discover pattern) is too short when the mistake shows only after rereading the portal | **Fixed in the draft already:** Undo stays in the panel until it closes |
| AP-16 | 2 | Filling | H1 | Per-field announcements would flood a screen reader during a 2-second fill | Spec: announce at start and end only (see apply-a11y.md) |
| AP-17 | 2 | CV didn't attach | H9 | "Show in Finder" assumes the package PDF exists as a file on disk; Prepare stores it in the database | Spec: the service writes approved package files to a Packages folder (assumed contract with Prepare) |
| AP-18 | 1 | Context card | H8 | The "where" line was typed in capitals, which some screen readers spell out | **Fixed:** sentence case with CSS uppercase |
| AP-19 | 1 | All | H4 · (d) | "Fill this page" on a confirmation page reads oddly | Kept: one predictable primary action; on a confirmation page it asks "Did you submit?" instead, said in the Review footer |

## Findings

### AP-01 · Severity 4 · The wrong package could fill a different job

**Where:** the session model behind Filled, CV attached and Questions ("the package stays with this tab until you mark it submitted or close the tab").

**Problem.** Kris often has two jobs open at one company (Kestrel has a Security Engineer and a Cloud Security Analyst). If the tab moves from one to the other, a session that simply "holds the package for the tab" would attach the Security Engineer CV and its screening answers to the Cloud Security Analyst application. That breaks (c) at the worst moment: it's invisible until a recruiter reads it.

**Fix (done).** Every Fill reads the portal's job reference from the page first and compares it with the session's package target. A different job ends the session and matches again; the new "Different job" state says so in a warning banner, names both jobs, and confirms nothing was filled from the old package. Pages without a job reference (sign-in, account creation) continue the session only on the same portal host and company. The spec makes this a tested rule of the fill engine.

### AP-02 · Severity 3 · A stale list looks current

**Where:** Filled, then Workday's Save and Continue.

**Problem.** The panel acts only on clicks, so it can't read the new step by itself. After Save and Continue it would keep showing "My Information · 6 filled · 1 needs you" beside a page that's now My Experience.

**Fix (done).** The panel listens only to the tab's address and title (available for granted portal hosts, no page read). When either changes, the current list moves under "Earlier pages" and the panel shows "New page? Click Fill this page". Same-address SPA steps that keep the title fall back to the page name shown in the panel's heading, which comes from the portal's own step label.

### AP-03 · Severity 3 · Undo missing on most pages

**Problem.** "Undo this page" appeared only in Filled. CV attached, Questions, Didn't stick and CV didn't attach had none, so the escape hatch vanished exactly where more was filled.

**Fix (done).** Every page apply-kit filled shows Undo this page. It restores the values each field had before apply-kit touched it (kept in the page by the filler, so it works even if the app stops).

### AP-04 · Severity 3 · Capture has no way in

**Problem.** The side panel replaces the Capture popup (ADR 0005), but no state showed Capture.

**Fix (done).** A Fill / Capture segmented control sits under the header in every paired state. It switches the panel's view in place (DESIGN.md: segmented controls never navigate). Fill is chosen on a recognised portal, Capture elsewhere.

### AP-05 · Severity 3 · "I've submitted this" on the Review page

**Problem.** The Review page is where Kris is about to submit. A footer button there invites marking first and submitting later, or not at all, creating an Application that was never sent.

**Fix (done).** Removed from Review. The footer says that after Submit, Fill this page on the following page asks "Did you submit?". Manual marking stays on unknown forms (no confirmation to detect) and on the Job page in apply-kit.

### AP-06 · Severity 3 · Typed answers lost on single-page portals

**Problem.** Answers Kris typed on the portal were offered to the answer bank on Workday's Review page only. Greenhouse, Lever and Ashby have no review page, so those answers would be retyped next time: a direct miss on "zero retyping".

**Fix (done).** Typed answers are collected on every re-fill and offered again on "Did you submit?", each with its own tick, saved when Kris marks the application submitted.

### AP-07 · Severity 3 · Page marks unexplained

**Problem.** The tick and "?" marks on the portal were explained only by the hi-fi's legend, which isn't part of the product.

**Fix (done).** The first filled list ends with "On the page: a tick marks each field apply-kit filled, a "?" each field that needs you. Select a row to see its field."

### AP-08, AP-09 · Severity 3 · Carried over from the wireframe, fixed in the draft

The wireframe removed Workday's duplicate entries automatically and offered "Fill name and email only" without a package. Both were changed before this review (report-then-click; dropped), and are listed so the wireframe isn't built as drawn.

### AP-10 to AP-19

Minor and cosmetic findings are in the summary table with their status. AP-11, AP-13, AP-16 and AP-17 are carried into the spec as behaviour.

## What works

- The context card names the job and *why* it's the match (job ID equals the target posting) on every page.
- Sources are always in words (Profile, Answer bank, Package, CV version, You, Skipped · your rule), and the page marks add a shape to every colour.
- The boundary line ("Fills only when you click. Never presses Next or Submit.") sits in the same place in every state.
- The honest-progress rule from the wireframe holds: "Page 2 of 5" only because Workday prints its steps; elsewhere no total is claimed.
- Account creation is a checklist where the one step only Kris can do (the password) gets the most help and apply-kit never touches the value.
