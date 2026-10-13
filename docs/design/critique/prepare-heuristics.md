# Prepare: heuristic evaluation

Design step 7. One evaluator, 2026-10-13. Screens: hi-fi `onboarding.html` (Setup, 10 states), `profile.html` (8 states), `package.html` (14 states) and `cv-template.html` (4 documents). Checked against Nielsen's 10 heuristics (H1–H10) and four domain criteria:

- **(a) Honesty line:** nothing the user can't defend in an interview reaches a CV, letter or answer, and near-the-line edits and gaps are always a conscious decision ([PRODUCT.md](../PRODUCT.md), principles).
- **(b) Speed:** found → package approved inside the 10-minute budget, with the portal still to go.
- **(c) Trust and audit:** every line of a package traces to a profile piece, and the user can see what was sent to the model.
- **(d) Consistency:** the Prepare screens agree with each other and with Discover (vocabulary from [GLOSSARY.md](../../../GLOSSARY.md), counts, components from [DESIGN.md](../DESIGN.md)).

The bar comes from PRODUCT.md, [flows.md](../flows.md) (moment of truth 2: "the first tailored CV"), [concepts.md](../concepts.md) (Package = guided steps with the requirement map and flags; onboarding = import → coach → keeps learning) and the Discover review rules in DESIGN.md.

**Method.** Each state was walked through from its review bar, reading the markup and copy against each heuristic, at the three layout breakpoints the page CSS defines (≥ 961 px two columns, 641–960 px one column, ≤ 640 px stacked rows). No browser was available in this session, so nothing was measured from a live render; layout claims come from the CSS. Severity uses Nielsen's scale: 4 catastrophe, 3 major, 2 minor, 1 cosmetic.

## Summary

| ID | Sev | Screen · state | Heuristic · criterion | Finding | Status |
|---|---|---|---|---|---|
| P-01 | 3 | Package · every step | H5, H4 · (a)(d) | The stepper lets any step be approved in any order, so the letter could be approved before the CV's flags are decided and contradict them | Fixed |
| P-02 | 3 | Package · CV, Kubernetes gap | H5 · (a) | "I have experience the profile doesn't know about" sends an answer to the coach, but nothing says the resulting CV line comes back for a decision: it could enter the CV unseen | Fixed |
| P-03 | 3 | Setup · Interview vs Profile · Learned pieces | H4 · (a)(d) | Pieces the coach writes in setup count as confirmed straight away, while pieces learned in a package need an explicit Confirm. Same source (the user's own answer), two trust rules | Fixed |
| P-04 | 3 | Package · Target posting | H3, H5 | Switching the package language rewrites all three parts. The copy doesn't say it costs money or what happens to edits and flag decisions already made | Fixed |
| P-05 | 3 | Package · Generating | H5, H4 · (d) | "Start reviewing" jumps straight to the CV, skipping the target posting that decides the language and screening questions the CV is drafted for | Fixed |
| P-06 | 2 | Package · CV preview → ATS check | H5 · (b) | A parse failure (internship dates) is first shown at step 5, after the CV is approved, so the fix re-opens work the user thought was done | Fixed |
| P-07 | 2 | Profile · all states | H1, H4 · (d) | Counts disagree: the nav badge says 3, but 3 learned pieces plus 1 portal-changed answer need the user | Fixed |
| P-08 | 2 | Package · Cover letter | H1 · (c) | "Short excerpts were sent with this draft" without showing which, for the most personal data in the app | Fixed |
| P-09 | 2 | Package · Approved | H1 | The hand-off ("the extension fills the form") doesn't say whether the extension is connected | Fixed |
| P-10 | 2 | Package · CV requirements → evidence | H6 · (c) | Evidence names a profile piece but gives no way to open it, so checking a claim against its source means navigating away and searching | Fixed |
| P-11 | 2 | Job page (Discover) ↔ Package | H6, H3 | Leaving mid-package is promised to be safe, but the Job page and Feed row have no design for "Continue package (step 2 of 5)" or "Package ready" | Spec |
| P-12 | 2 | Profile · Answer bank → Bulgarian package | H5 · (a) | Most screening answers exist only in English. A Bulgarian package has no stated rule for them: translate silently, leave blank, or mix languages | Spec + DESIGN |
| P-13 | 2 | Profile · Edit piece while a package is open | H1 · (c) | Editing a piece says "future packages only", but an unapproved package in progress keeps drafting from the old wording with no notice | Spec |
| P-14 | 2 | Package · CV changes | H7 · (b) | The CV step is long (6 evidence rows, 2 flags, 7 edits) and its one decision sits at the very end | Fixed |
| P-15 | 1 | Package · ATS check fix | H5 | The internship "To" month can be set before "From" | Spec |
| P-16 | 1 | Package · side panel | H8 | The "1 of 10 min" meter could pressure a careful package. It should never turn red or count down | Spec |
| P-17 | 1 | Package · CV preview | H5 | "Download PDF" before approval gives a file indistinguishable from the approved one | Fixed |

**Counts:** severity 4: 0 · severity 3: 5 (all fixed in the hi-fi) · severity 2: 9 (5 fixed, 4 carried into the spec) · severity 1: 3 (1 fixed).

## Details

### P-01 · Sev 3 · Steps can be approved out of order
- **Where:** `package.html`, stepper in every state; Cover letter and Screening answers states.
- **What's wrong:** Every step in the stepper is a link and every step has its own Approve, so the user can approve the letter (which says "led one of them") before deciding the CV flag that sets that wording, or approve answers drafted for a target posting that later changes.
- **Why it matters:** The concept was chosen for "a guaranteed full pass" (concepts.md). A letter that contradicts its CV is exactly what an interviewer catches, and it breaks the honesty line by accident.
- **Fix (done):** Steps are approved in order; any step can be read and edited ahead. A step's Approve waits for the steps before it, and its reason says so ("after the CV"). The rule is stated under the stepper, and the letter's checks tie back to the CV decision. Recorded in DESIGN.md (Package stepper).

### P-02 · Sev 3 · A gap answer could slip into the CV unseen
- **Where:** `package.html` · 2 CV changes & flags, the Kubernetes gap flag, third option.
- **What's wrong:** The option sends the user's answer to the coach, "used for this job only", but doesn't say what happens next. Read literally, the coach could rewrite the CV with a Kubernetes line the user never saw.
- **Why it matters:** Gaps are "flagged, never covered up". A model turning "played with k3s once" into "Kubernetes" on the CV is the honesty failure the whole step exists to stop (moment of truth 2).
- **Fix (done):** The copy now says the drafted line comes back as a flag to approve, and the piece is used for this job only until confirmed in Profile. Spec: a learned piece never changes a CV line without a new flag.

### P-03 · Sev 3 · Two trust rules for the same kind of piece
- **Where:** `onboarding.html` · B Coach interview ("From this interview" panel); `profile.html` · Learned pieces to confirm.
- **What's wrong:** A piece written by the coach from the user's answer during setup is simply saved; a piece written from the user's answer during a package waits as Unconfirmed.
- **Why it matters:** The user can't predict which pieces are trusted, and the setup path lets a stretched rewrite in without a look. It's the same model doing the same rewrite.
- **Fix (done):** Interview pieces show as they're written, can be edited or removed, and are confirmed in one list on "Finish and confirm 5 pieces". Near-the-line ones always need their own OK. Package-learned pieces keep their Confirm. One rule: a piece written by the model is confirmed by the user before it's used beyond the place it came from.

### P-04 · Sev 3 · Language switch: cost and lost work unstated
- **Where:** `package.html` · 1 Target posting, Language.
- **What's wrong:** "Switching later rewrites all three parts together." Nothing says it calls the model again (cost, budget cap) or whether the user's letter edits and flag decisions survive.
- **Why it matters:** A user who has already decided two flags and edited the letter could lose that work with one click (H3, no undo). Bulgarian packages are a stated default, so this switch will be used.
- **Fix (done):** The option states the cost (about $0.03) and that current drafts and decisions are kept as earlier drafts. Spec: flag decisions carry over to the new language when the underlying piece is the same; drafts are paged, so switching back is free.

### P-05 · Sev 3 · "Start reviewing" skips step 1
- **Where:** `package.html` · Generating, the CV row's button.
- **What's wrong:** The wireframe's shortcut to the CV skips the target posting, which decides the language and the screening questions.
- **Why it matters:** It contradicts P-01's order and invites approving a CV drafted for the wrong language or posting.
- **Fix (done):** One "Start reviewing" button below the list starts at step 1, with "the CV, which needs you most, comes next". Step 1 is normally one click.

### P-06 · Sev 2 · ATS failures found late
- **Where:** `package.html` · 2 CV preview and 5 ATS check.
- **Fix (done):** The parse check runs on every render (it's local and fast), and the CV preview's "This file" panel shows its result with a link to the fix. Step 5 stays the full report.

### P-07 · Sev 2 · Badge counts disagree
- **Where:** `profile.html`, top nav and section links.
- **Fix (done):** The nav badge counts everything that needs the user (4); each section link carries its own share (Master profile 3, Answer bank 1), so the parts add up to the whole, as in the Discover rule on counts.

### P-08 · Sev 2 · Sent voice excerpts are invisible
- **Where:** `package.html` · 3 Cover letter, Voice panel.
- **Fix (done):** "Sent with this draft: 3 excerpts, 140 words" opens the exact excerpts and the sample each came from. Spec: every model call records which excerpts it sent.

### P-09 · Sev 2 · Extension state unknown at hand-off
- **Where:** `package.html` · Approved.
- **Fix (done):** A status line says whether the extension is connected and that the files and answers stay on the page to copy if it isn't. The status comes from the Apply feature's pairing; Prepare only shows it.

### P-10 · Sev 2 · Evidence can't be opened
- **Where:** `package.html` · 2 CV changes & flags, requirements → evidence.
- **Fix (done):** Each evidence line links to its piece in Profile (shown on the incident-response row; the rule applies to every row).

### P-11 · Sev 2 · No way back into a half-done package
- **Where:** Discover's Job page decision panel and Feed row, against Package · Generating ("leave and come back").
- **Fix (spec):** The Job page's Prepare button reads "Continue package · step 2 of 5" while one is in progress and "Package ready" once approved, and the Feed row shows the same as a chip. Built in the Prepare ticket that enables the button.

### P-12 · Sev 2 · Bulgarian packages and English-only answers
- **Where:** `profile.html` · Answer bank (Languages column) and Edit answer.
- **Fix (spec + DESIGN):** In a Bulgarian package an answer with no Bulgarian version is translated as a draft marked "Answer bank · translated", never silently filled, and the user can save the translation back to the bank. The extension fills only the version in the package's language.

### P-13 · Sev 2 · Profile edits don't reach open packages
- **Where:** `profile.html` · Edit piece ("Used in"), against a package that isn't approved yet.
- **Fix (spec):** An unapproved package whose pieces changed shows "Your profile changed since this draft" with the affected lines and a "Redraft these lines" action. Approved packages never change.

### P-14 · Sev 2 · The decision sits at the end of a long step
- **Where:** `package.html` · 2 CV changes & flags.
- **Fix (done):** A sticky action bar (new component) keeps Back, the reason and Approve in reach. Flags are listed with jump links at the top of the step.

### P-15 · Sev 1 · "To" before "From"
- **Fix (spec):** The "To" list starts at the chosen "From" month.

### P-16 · Sev 1 · Time meter as pressure
- **Fix (spec):** The time against the 10-minute goal is shown neutrally, never in red and never as a countdown. It exists so the user sees the tool is saving time, not to rush the honesty decisions.

### P-17 · Sev 1 · Draft PDFs look final
- **Fix (done):** Before approval the button reads "Download draft PDF"; the file is the same render, but only the approved file is what the extension uploads.

## What works

- **The honesty decisions are conscious.** Flag options are never pre-selected, each says how it holds up in an interview, and a wording that crosses the line ("led all 3") isn't offered at all.
- **Gaps stay visible.** CISSP reads "left out, not claimed", Kubernetes is a named gap, and the ATS check counts deliberate gaps as a pass, with the reason.
- **Nothing is lost on failure.** Model timeouts, the budget cap and an unreadable scanned CV each say what still works and offer a way forward that needs no model.
- **The document is the file.** Previews are the exact PDF, the template is fixed, and tightening a long CV never shrinks type or margins.
