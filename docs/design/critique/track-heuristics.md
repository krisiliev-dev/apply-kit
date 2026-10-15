# Track: heuristic evaluation

Design step 7. One evaluator, 2026-10-13. Screens: hi-fi [`applications.html`](../hifi/applications.html) (13 states, two dialogs) and [`application.html`](../hifi/application.html) (12 states, one dialog), compared with the wireframes they came from. Checked against Nielsen's 10 heuristics (H1–H10) and four domain criteria:

- **(a) Nothing lost:** every application, email and due follow-up has a visible home; nothing changes silently.
- **(b) The user sends:** the app drafts and records; it never sends, withdraws or replies for the user, and never implies it does.
- **(c) Motivation:** stats and rejections support momentum during a search full of rejection, without pressure or false precision.
- **(d) Consistency:** Track agrees with PRODUCT.md decisions, the glossary, the Discover screens and the real system (ARCHITECTURE.md, the mail code).

**Method.** Every state was opened from the review bar and rendered headless at 1280px and 400px, in light and dark, with a script that also reported script errors and anything wider than the viewport (none after fixes). Screenshots were read for layout, overlap and hierarchy. Severity: 4 catastrophe, 3 major, 2 minor, 1 cosmetic.

## Summary

| ID | Sev | Screen · state | Heuristic · criterion | Finding | Status |
|---|---|---|---|---|---|
| T-01 | 3 | Applications · mailbox failing (wireframe) | H2, H9 · (d) | The fix told the user to make an Apple app-specific password; the job mailbox is Gmail, read over IMAP with a Google app password | Fixed |
| T-02 | 3 | Application · interview (wireframe) | H4 · (d) | Thank-you note due "2 days after Interviewing began"; PRODUCT.md decided "within 24 hours of the interview time" | Fixed |
| T-03 | 3 | Applications · no applications (wireframe) | H3, H7 · (a) | "You never add one by hand": no way to record an application made outside apply-kit, so its replies stay unmatched forever | Fixed |
| T-04 | 3 | Application · accepted → withdraw others | H3, H5 · (b) | A pre-ticked list of every open application with one confirm reads like a mass withdrawal the app performs | Fixed |
| T-05 | 3 | Application · stepper (all states) | H1 · (a) | Steps the Application never went through (Applied → Interviewing directly) were drawn as done | Fixed |
| T-06 | 3 | Applications · Needs you (wireframe) | H8 · (c) | Every rejection became a "write a lesson" queue item; at ~70% rejections the queue fills with chores about failure | Fixed |
| T-07 | 2 | Applications · email to match | H4 · (d) | The Stats strip disappeared in this one state | Fixed |
| T-08 | 2 | Applications · 214 applications | H1, H7 | "Review 6 drafts" opened a dialog that said "1 of 1" with no way to the next draft | Fixed |
| T-09 | 2 | Applications · weekly chart | H1 · (c) | The "so far" label collided with the pace line and the previous bar | Fixed |
| T-10 | 2 | Applications · list, row status select | H3, H5 · (a) | A status change applies on change; a closing status (Rejected, Withdrawn) cancels follow-ups at once | Build rule |
| T-11 | 2 | Applications · Applied group | H1 · (a) | After its one nudge, a quiet Application's "Next" column is empty, so a ghosted application looks like nothing is happening | Build rule |
| T-12 | 2 | Applications · normal | H1 · (a) | Status changes made by email since the last visit are only visible in the "Last event" column | Build rule |
| T-13 | 2 | Application · moved by email | H3 | "Undo" on an automatic move and "Not a rejection? Undo" need one shared meaning (Status back, email kept, matcher learns) | Spec rule |
| T-14 | 1 | Applications · Feed and Job markers | H4 · (d) | The prior-rejection chip reuses the `partly` chip; it is a fact, not a requirement state | Build rule |
| T-15 | 1 | Application · offer | H2 | The date input shows the browser's locale format (12/01/2026) next to "Tue 1 Dec" elsewhere | Build rule |
| T-16 | 1 | Applications · list | H8 | A Bulgarian job title doubles its length in the list (both languages) | Build rule |

**Counts:** severity 4: 0 · severity 3: 6 (all fixed) · severity 2: 7 (3 fixed, 4 carried as build or spec rules) · severity 1: 3.

## Details

### T-01 · Sev 3 · The mailbox fix named the wrong provider
- **Where:** Applications · "Mailbox sign-in failed" (wireframe: "At appleid.apple.com, create a new app-specific password").
- **What's wrong:** ARCHITECTURE.md and the shipped mail reader read a dedicated **Gmail** mailbox with an app password from `GMAIL_APP_PASSWORD`; iCloud only forwards to it. Following the wireframe's steps fixes nothing.
- **Fix (done):** The banner uses the same wording as Discover's `mailboxFix` for `auth`: new app password at myaccount.google.com/apppasswords, put it in GMAIL_APP_PASSWORD, restart. A separate "Mailbox not connected" state covers `not-configured`. Both say what still works. The spec makes Track reuse the one mailbox problem vocabulary so the two can't drift.

### T-02 · Sev 3 · Thank-you timing contradicted a decision
- **Where:** Application · interview and thank-you.
- **What's wrong:** The wireframe kept the old prototype's +2 days after the status change. PRODUCT.md (wireframe review) decided "within 24 hours of the interview time". A note sent two days later reads as an afterthought.
- **Fix (done):** The thank-you note is anchored on the interview's start time: draft ready when the interview ends, due 24 hours after it starts. The interview state says "due by Fri 16 Oct, 14:00"; the thank-you state counts down to 16:00. With no interview time known, no thank-you is scheduled and the Next step asks for the time.

### T-03 · Sev 3 · No way to add an application by hand
- **Where:** Applications · no applications; Job page.
- **What's wrong:** Applications made on a company site directly, through a recruiter or before apply-kit existed would never exist, so their confirmations and rejections land in "Email to match" forever and Stats undercount.
- **Fix (done):** "Add application" in the page header and empty state (a dialog: a Job in apply-kit, or company + title + optional link; date applied, status now, optional contact address). "I applied without apply-kit…" on the Job page opens it with the Job chosen. "A new Application" is also an answer in "Email to match".

### T-04 · Sev 3 · Withdrawing looked like something the app does
- **Where:** Application · Accepted → withdraw others.
- **What's wrong:** The first draft pre-ticked every open application. Criterion (b): the user sends every message, and a Status that says Withdrawn must mean the user actually withdrew.
- **Fix (done):** No checkboxes. Each open Application gets its own polite draft (in the posting's language), Copy and Open in Mail, "Keep this one open", and "Mark sent · Withdrawn". The Status moves only on Mark sent. Unsent ones wait in Needs you as "Withdrawal to send". Declining an offer moves to Withdrawn with the reason "declined offer".

### T-05 · Sev 3 · The stepper invented history
- **Where:** Application · interview, offer, accepted (Medora, Ardent Labs went Applied → Interviewing).
- **What's wrong:** Screening showed a done check though no screening happened. The timeline beside it said otherwise; the user can't trust either.
- **Fix (done):** A skipped step is struck through, has no check, and reads "(skipped)" to screen readers. The engine derives done/skipped from Status Events, not from the step order.

### T-06 · Sev 3 · Rejections became chores
- **Where:** Applications · Needs you (wireframe had "Rejection logged · one-line lesson").
- **What's wrong:** Motivation is a 5-ranked friction. At 200 applications with most ending in rejection, a lesson prompt per rejection turns the action queue into a list of failures to process, and pushes real actions (follow-ups, interviews) down.
- **Fix (done):** Rejections never enter Needs you. The rejected Application page offers an optional one-line lesson and likely reason, nothing pre-selected, and says what it changes in Stats ("a rejection is a reply").

### T-07 to T-09 · Sev 2 · Fixed
- **T-07:** Stats strip added to the email-to-match state.
- **T-08:** The draft dialog shows "1 of 6" and a "Next draft" button when opened from a grouped item.
- **T-09:** The current week's value moved into the x-axis label ("This week: 3 so far"); chart text gets a surface halo.

### T-10 · Sev 2 · Closing statuses apply instantly
- **Fix (build rule):** Rejected and Withdrawn from the row select still apply immediately (one action is the point of quick change) but always with the 10-second undo toast, and undo restores any follow-up the change cancelled. Accepted opens the accept flow instead of applying silently.

### T-11 · Sev 2 · Quiet applications look idle
- **Fix (build rule):** After the nudge is marked sent, "Next" reads "No reply for N days". There is no automatic ghosted status; the Status list stays as decided.

### T-12 · Sev 2 · Overnight changes are easy to miss
- **Fix (build rule):** When the user opens Applications, a one-line summary above Needs you lists what email changed since their last visit ("Since yesterday: Varna Trust Bank moved to Screening by email · 1 confirmation matched"), each linking to the Application. No queue item, since nothing needs the user.

### T-13 · Sev 2 · One meaning of undo for matched email
- **Fix (spec rule):** Undoing an email's effect always restores the previous Status and the follow-ups it cancelled, keeps the email on the timeline marked "not a Status change", and records the correction for the matcher.

### T-14 to T-16 · Sev 1
- **T-14:** Use a neutral `applied` chip style (added in track.css) for "Applied before" facts on Feed rows; keep `partly` for requirements.
- **T-15:** Show dates in the app's own format next to the native input.
- **T-16:** In the list, show the job title in the posting's language only; the English translation lives on the Application page.

## What works

- Needs you puts the next action first in every state, and every item has exactly one primary action.
- Every Event names its cause (by email, by you, by apply-kit), and automatic moves show their match signals and undo.
- The mailbox states say what still works, so the screen stays trusted while mail is down.
- Response rate explains its rule inline and shows how many applications are excluded; What's working says "too few" instead of drawing trends from 3 data points.
- Nothing on either screen can send a message.
