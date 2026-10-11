# Discover: heuristic evaluation

Design step 7. One evaluator, 2026-10-11. Screens: hi-fi `feed.html`, `job.html` and `sources.html`, 8 states each. Checked against Nielsen's 10 heuristics (H1–H10) and four domain criteria:

- **(a) Trust in completeness:** the user can see that discovery missed nothing.
- **(b) Triage speed:** about 30 new jobs a day.
- **(c) Honesty of ranking and extraction:** the user can see how jobs are ranked and where extracted facts came from.
- **(d) Consistency:** the three screens agree with each other.

The bar comes from [PRODUCT.md](../PRODUCT.md), [flows.md](../flows.md) (moment of truth 1: "the first morning Feed"), [concepts.md](../concepts.md), [GLOSSARY.md](../../../GLOSSARY.md) and [DESIGN.md](../DESIGN.md).

**Method.** Every state was opened from the review bar and walked through at 1280px and 400px, in light and dark. The browser pane was hidden, so no screenshots were taken. Layout, overflow, positions and contrast were measured from the live page instead. The J/K/S/X keyboard shortcuts are not wired up in the prototypes, so they were judged from what each screen promises.

Severity uses Nielsen's scale: 4 catastrophe, 3 major, 2 minor, 1 cosmetic.

## Summary

| ID | Sev | Screen · state | Heuristic · criterion | Finding |
|---|---|---|---|---|
| D-01 | 3 | Feed · all row states vs Job · Normal | H1, H4 · (c) | Feed row chips leave out the job's one required gap (Kubernetes). The why-line says "2 of 3 met", but the Job page says 4 of 6 met and 1 gap |
| D-02 | 3 | Feed · Normal; Job · Pass, Closed; Sources · Drop, Remove | H6, H3 · (a) | Passed and Closed jobs have no place in the Feed, although the copy points to "Passed" and "All jobs › Closed" |
| D-03 | 3 | Job · Pass, Closed; Feed · Hidden | H1, H3 · (c) | The ranking learns from passes, unhides and a pre-ticked boost, but no screen lists what it learned or lets the user undo it |
| D-04 | 3 | Feed · Unusual drop vs Sources · Unusual drop | H4, H5 · (a)(d) | The drop rule contradicts itself and the wireframe decision. Jobs close on their own after 3 empty checks, and the Feed offers a one-click close of about 30 jobs with no count, wait option or undo |
| D-05 | 3 | Sources · Normal (email-alert rows) | H1 · (a) | Email-alert sources have no rule for going quiet, yet they are the only route to LinkedIn, Google and jobs.bg |
| D-06 | 2 | Feed · Normal, Hidden; Sources · Normal, Coverage | H1 · (a)(d) | The counts don't add up: are the 23 new jobs before or after the 7 hidden? 14 sources or 15? Segments 8+2+3 ≠ 15. Does "in the Feed" include hidden jobs? |
| D-07 | 2 | Feed · Normal and every other state | H6, H1 · (a) | The hidden pile is a footer link about 2,400px down, and it is missing in 5 of 8 states. The Hidden view covers today only and has no way back |
| D-08 | 2 | Job · Normal, Low confidence; Feed · No match | H4 · (c) | Dealbreaker values disagree: a 5-year cut-off, yet "5+ required would become a gap"; a €2,300 minimum here and €2,000 in the profile wireframe |
| D-09 | 2 | Job · Normal | H4 · (c) | The fit check lists "CISSP preferred" under Gaps, two panels above "Preferred items never count as gaps" |
| D-10 | 2 | Feed · all; Job · Normal, Low confidence | H2, H10 · (c) | Fit is shown as an unexplained 0–100 score, which the glossary says to avoid. Provisional fits look certain in the Feed |
| D-11 | 2 | Feed · Checking sources | H3, H5 · (b) | New rows stream into a list sorted by fit while the user is triaging, so the focused row and click targets move |
| D-12 | 2 | Job · Error | H9 · (a) | If the posting can't be read, it is retried only when the user saves the job, and the Feed has no row state for "not read" |
| D-13 | 2 | Job · Pass | H5 · (c) | The pass reason comes pre-selected ("Skills gap too big"), so X then Enter trains the ranking on a reason the user never chose |
| D-14 | 2 | Sources · Normal | H1, H6 | Selecting a row updates a detail panel about 1,100px below it. Rows can't be reached by keyboard, and row actions sit behind "⋯" |
| D-15 | 2 | Feed · Failed, Drop, Overflow, Checking | H4 · (d)(b) | Banner states drop the Feed's controls: search, segments, filters, bulk bar, shortcuts and hidden link |
| D-16 | 2 | Feed · Hidden | H2, H5 | The difference between "Unhide" and "Not a dealbreaker for me" is unclear, and the header copy contradicts the wireframe note |
| D-17 | 2 | Feed, Sources at narrow widths | H8 · (b) | At 400px the Fit column scrolls off-screen. The Sources table scrolls even at 1024px, and its segmented control is clipped at 400px |
| D-18 | 1 | Feed · Normal, Overflow | H8 · (b) | Long titles are cut to one line, hiding the specialty ("…(Fraud and Risk Engineering)") |
| D-19 | 1 | Feed · Normal | H7 · (b) | With a mouse, saving or passing one row takes checkbox, then bulk button. There's no per-row action |
| D-20 | 1 | Job · Normal, Low confidence | H7 · (b) | The decision panel isn't sticky. The page is 1,872px tall, so the user scrolls back up to act |
| D-21 | 1 | Feed · Normal, No match; Job | H4 · (d) | Wording drifts: "on 3 sites" vs "3 postings merged". The filter chips in No match don't exist in the normal toolbar |
| D-22 | 1 | Sources · Add, not found | H3 | Nexo is added to the watchlist automatically, with no undo |
| D-23 | 1 | Sources · Coverage check | H7 | The user must count and type the number of results even when the results link would give it |

**Counts:** severity 4: 0 · severity 3: 5 · severity 2: 12 · severity 1: 6.

## Details

### D-01 · Sev 3 · Feed row chips hide the real gap
- **Where:** Feed, every row state (Normal, Checking sources, Source failed, Unusual drop, After a week away), compared with Job · Normal for Kestrel "Security Engineer".
- **What's wrong:** The row shows `3+ years ✓`, `SIEM ✓` and `CISSP preferred ◐`, and the why-line says "2 of 3 met". The Job page finds 6 requirements: 4 met, 1 required gap (Kubernetes security) and 1 preferred item not held. So the Feed hides the only required gap and shows a preferred item instead, and its numbers differ from the fit check's.
- **Why it matters:** The Scan table was chosen so the user can triage from the row without opening it (concepts.md). If a row can hide a required gap, every row needs checking on the Job page, which removes the speed win. It also goes against "gaps are flagged, never covered up".
- **Fix:** Choose chips in a fixed order: every gap first, then partly met, then met. Add a "+3 met" overflow chip so the total is visible. Build the why-line from the same counts as the fit check, for example "Security angle · 4 of 5 required met · gap: Kubernetes".

### D-02 · Sev 3 · Passed and Closed jobs have no place to live
- **Where:** Feed · Normal (segments are New / Saved / All open). Job · Pass ("The job moves to Passed"). Job · Closed ("It stays here"). Sources · Drop and Remove ("visible under All jobs › Closed").
- **What's wrong:** Three screens send the user to places that don't exist. Passed and Closed jobs can't be reached from the Feed.
- **Why it matters:** "Nothing disappears silently" depends on the user being able to find what left the list. A job passed by mistake, or one of 34 SumUp jobs closed by the drop rule, is gone in practice.
- **Fix:** Turn the Feed's third segment into "All", with a status filter: Open, Saved, Passed, Hidden, Closed. Change every reference in the copy to that label. Have the Pass toast and the close actions link straight to the filtered view.

### D-03 · Sev 3 · The ranking learns where the user can't see it
- **Where:**
  - Job · Pass: "The reason trains the ranking", whatever the checkbox says.
  - Job · Closed: "Put new Kestrel security jobs at the top of the Feed" is **ticked by default**.
  - Feed · Hidden: "unhide the job and the rule learns".
- **What's wrong:** Boosts and penalties build up, but no screen lists them. The Profile wireframe lists dealbreakers only. The why-line never says a job was boosted or pushed down.
- **Why it matters:** Ranking that drifts unseen is the opposite of "the user decides" and of an explainable sort. A job pushed onto page 2 is hidden in all but name, so trust in completeness wears away without anyone noticing.
- **Fix:**
  - Learn only from explicit opt-ins: the checkbox on the pass form, and an unticked boost on the Closed page.
  - Add a "Ranking rules" list next to Dealbreakers. Each rule shows where it came from, when it was added, how many jobs it moves today, and an undo.
  - Have the why-line name any learned adjustment, for example "boosted: Kestrel security roles".

### D-04 · Sev 3 · The unusual-drop rule contradicts itself, and the Feed's close action is risky
- **Where:** Feed · Unusual drop. Sources · Unusual drop.
- **What's wrong:**
  - **The rule differs between screens:**
    - The Feed says the jobs stay open "until the next check confirms it".
    - Sources says "until you decide or the next 2 checks agree", and that if nobody acts the jobs close.
    - The wireframe decision says "You decide whether it's real; until then nothing is closed."
  - **The numbers differ:** the Feed says "about 30", the banner "30–36", the detail "34 jobs".
  - **The actions differ:** the Feed offers one button, "They're gone, close them", with no count, no Wait option and no undo. Sources offers three choices and names the 34 jobs.
- **Why it matters:** This is the scenario that broke trust in the old app, which closed jobs whenever a source failed. A broken or migrated feed that closes 34 jobs on its own, or after one hasty click, is exactly the silent loss the principle forbids.
- **Fix:**
  - Decide one rule and write it the same way everywhere. Recommended: never auto-close. After 3 empty checks, raise the drop to a Needs-you item and keep the jobs open, marked "unconfirmed".
  - Give the Feed banner the same actions as Sources, with the count in the label ("Close 34 jobs"), followed by an undo toast.
  - Use "34 jobs, usually 30–36" on both screens.

### D-05 · Sev 3 · Nothing warns when an email alert goes quiet
- **Where:** Sources · Normal, email-alert rows: LinkedIn, jobs.bg and Google Careers alerts.
- **What's wrong:** The warning rule ("less than half of its lowest count in the last 14 checks, or 0…") works per check, so it doesn't fit email. Google Careers last emailed on 3 Oct and is still "Working". If an alert gets unsubscribed, a saved search expires, or the iCloud forward breaks for one sender, nothing turns amber. The mailbox tile shows only the last email across all alerts.
- **Why it matters:** PRODUCT.md uses email alerts because Google, Apple, Meta, LinkedIn and jobs.bg can't be scraped, and they are the user's biggest names. Coverage is riskiest assumption #1. These are also the sources most likely to break without a sound.
- **Fix:**
  - Give each alert an expected rhythm, learned from its history. Warn when silence lasts more than about twice the usual gap, for example: "No LinkedIn alert email in 5 days; usually 6–12 a week. Check the saved search."
  - Add a mailbox-wide warning for no mail in 24 hours.
  - In the rule box for email sources, state the email rule, not the per-check rule.

### D-06 · Sev 2 · The counts don't add up
- **Where:** Feed · Normal and Hidden. Sources · Normal and Coverage check.
- **What's wrong:**
  - "23 new since yesterday" and "7 hidden today": are the 23 counted before or after hiding?
  - The topbar and page head say 14 sources, but the table's "All" segment says 15 (Manual capture is counted).
  - The segments sum to 8 + 2 + 3 = 13. Public API (Amazon) and Manual have no segment.
  - Coverage says "39 of 41 already in the Feed". Does that include hidden jobs?
  - The prototype Hidden view says "7 hidden" but lists 4 jobs. That's sample data, but in this product the spec should show numbers that agree.
- **Why it matters:** On the first morning, numbers that agree are the cheapest evidence of completeness. Any gap between them reads as "something is missing".
- **Fix:**
  - Put one accounting line on the Feed: "30 found since yesterday · 23 shown · 7 hidden · 4 seen on more than one source".
  - Settle whether Manual capture counts as a source and use that count everywhere. Add "Public API" and "Added by you" segments.
  - Split the coverage result into "in Feed · hidden (with reason) · missing".

### D-07 · Sev 2 · The hidden pile is hard to reach
- **Where:** Feed, all states.
- **What's wrong:**
  - "Show 7 hidden jobs and why" appears only in the footer of the Normal state. With 23 rows of 87px each, it sits about 2,400px down at 1280px.
  - It is missing from Checking sources, Source failed, Unusual drop, After a week away and (as a link) No match.
  - The Hidden view covers "today" only, with no date range and no way back to New other than the main nav.
- **Why it matters:** PRODUCT.md promises "the hidden pile is one click away". flows.md names visible hidden reasons as one of the two things that decide moment of truth 1.
- **Fix:** Put "Hidden 7" in the segmented control, or link it in the page meta line ("23 new · 7 hidden"), in every state. Give the Hidden view the same segments, with a "since" picker.

### D-08 · Sev 2 · Dealbreaker values disagree between screens
- **Where:**
  - Job · Normal: "under your 5-year cut-off", "your minimum (€2,300)".
  - Job · Low confidence: "5+ required: This would become a gap for you".
  - Feed · No match: "hidden because it asks for 5+ years".
  - Profile wireframe: "Asks for more than 4 years", "Salary stated and below €2,000".
- **What's wrong:** Under a 5-year cut-off, "5+ required" would hide the job, not turn it into a gap. The thresholds also differ from the Profile wireframe.
- **Why it matters:** The user is asked to settle an extraction question based on what each answer would do. If the stated effect is wrong, the answer is wrong, and the ranking can't be explained.
- **Fix:** Generate this copy from the one stored rule. Option text: "5+ required: this would hide the job (your cut-off is 5 years)". Align the hi-fi screens with the Profile values, or update Profile.

### D-09 · Sev 2 · Gaps vs "preferred never counts as a gap"
- **Where:** Job · Normal.
- **What's wrong:** The fit check's Gaps row shows `Kubernetes security ✕` and `CISSP preferred ◐`. Two panels below, the Requirements table says of CISSP: "Preferred items never count as gaps".
- **Why it matters:** A product that says it is honest contradicts itself on the same page, so the user starts doubting the other facts too.
- **Fix:** Show only Kubernetes under Gaps. Add a row "Preferred, not held: CISSP (left out, not claimed)".

### D-10 · Sev 2 · Fit is an unexplained score
- **Where:** Feed, every row ("91 fit"). Job · Normal ("91 fit · #1 today"). Job · Low confidence ("~72").
- **What's wrong:**
  - The glossary says "Fit check… Avoid: score, match rating", yet the biggest number on every row is a score.
  - Nothing shows how 91 is made up, or why 91 is "strong" and 76 is not.
  - The Job page marks a provisional fit ("~72", "provisional"), but a Feed row for a job with unanswered facts would show a plain number.
- **Why it matters:** The why-line explains roughly why a job ranks where it does, not the exact order. The user is meant to trust the sort enough to stop scrolling by row 10.
- **Fix:**
  - Add a disclosure on the number that breaks it down: angle match, required items met, dealbreakers clear, location and salary, learned adjustments (see D-03).
  - Show verdict bands next to the number (Strong / Good / Stretch). Update the glossary to say the number is allowed and what it means.
  - In the Feed, show provisional fits as "~72" with a "2 facts need you" chip.

### D-11 · Sev 2 · Rows move while the Feed is checking sources
- **Where:** Feed · Checking sources ("new jobs appear as each source finishes").
- **What's wrong:** In a list sorted by fit, new arrivals land above the user's position. The focused row, and the row under the pointer, shift down. J/K focus and a pending click can land on the wrong job.
- **Why it matters:** The morning check runs at 07:30 and catch-up runs on wake, exactly when the user starts triaging. Passing or saving the wrong job undermines trust.
- **Fix:** Keep the list still while the user is active. Gather arrivals into a pill, "5 more found · show", that merges them on click or when the user is idle. Keep focus on the same job.

### D-12 · Sev 2 · A failed read is retried only if the job is saved
- **Where:** Job · Error ("Save the job and it's retried automatically at the next check").
- **What's wrong:** This implies that unsaved jobs whose read failed are never retried. The Feed has no row state for a job without a fit check, so where it sorts, and whether it gets noticed, is undefined.
- **Why it matters:** A failed read can quietly turn a good job into one the user never sees, a silent loss caused by extraction instead of a source.
- **Fix:** Retry every failed read at the next check. Give the Feed row a "Not read yet · retrying 08:00" state, shown in a small group above the ranked list or pinned at the top, never sorted to the bottom.

### D-13 · Sev 2 · The pass reason is pre-selected
- **Where:** Job · Pass.
- **What's wrong:** "Skills gap too big" is checked by default, and "X opens this", so pressing X then Enter passes with that reason. The reason trains the ranking (D-03).
- **Why it matters:** At around 30 jobs a day, defaults get accepted, and the training data drifts toward one reason.
- **Fix:** Pre-select nothing, or label the suggestion "Suggested: skills gap (Kubernetes)". Add number keys 1–5 for reasons so the keyboard path stays fast and deliberate.

### D-14 · Sev 2 · Sources detail is far from the row
- **Where:** Sources · Normal.
- **What's wrong:** "Select a row to see its history" updates `#detail-normal`. At 1280×900 that panel starts at about 1,532px, while the table starts at 402px, so the change happens out of sight. Rows aren't focusable (`tabindex -1`) and have no button role. "Check now", "Pause" and "Remove" are behind a "⋯" menu.
- **Why it matters:** Source health is the trust instrument. If its details can't be found, the summary tiles are all the user ever reads.
- **Fix:** Expand the history inline under the selected row, or open it in a side drawer. Make the source name a button. Show "Check now" inline on failing or unusual rows.

### D-15 · Sev 2 · Banner states drop the Feed's controls
- **Where:** Feed · Source failed, Unusual drop, After a week away, Checking sources.
- **What's wrong:** These states show the banner and a bare table. Search, segments, filters, the bulk bar, the shortcut hint, the hidden link and (except After a week away) the pager are all gone.
- **Why it matters:** A failing source is a normal morning, not a separate mode. The user still has 19 jobs to triage and needs the same tools.
- **Fix:** Treat banners as a layer above an unchanged Feed. Specify them that way, so the build doesn't fork the layout.

### D-16 · Sev 2 · "Unhide" vs "Not a dealbreaker for me"
- **Where:** Feed · Hidden.
- **What's wrong:** Both buttons sit on every row. The header says that unhiding makes "the rule learn". The wireframe note says "Not a dealbreaker for me" changes the rule. Which one affects future jobs is unclear.
- **Why it matters:** One button affects one job, the other affects every future job. Picking the wrong one either changes nothing or quietly widens or narrows the Feed.
- **Fix:**
  - Rename the buttons "Show this job" (no rule change) and "Change this rule…".
  - "Change this rule…" opens the rule, with "affects 3 jobs today", and an undo.
  - Fix the header copy to match.

### D-17 · Sev 2 · Narrow windows hide what triage needs
- **Where:** Feed and Sources at narrow widths. Job at 400px.
- **What's wrong:**
  - At 400px the Feed table scrolls inside its panel (660px of content in 366px), so Salary and Fit are off-screen. In After a week away it is 832px.
  - The Sources table already scrolls at a 1024px viewport (813 in 751). At 400px its segmented control spills out of the panel and is clipped.
  - On the Job page at 400px, "Prepare package" sits 1,022px down in Normal and 1,839px down in Low confidence.
- **Why it matters:** The platform is a laptop browser, but a half-width split window (around 640–800px) is realistic. The fit number is the sort key and has to stay visible.
- **Fix:**
  - Below about 760px, render Feed rows as two-line cards with Fit on the title line and chips underneath.
  - In Sources, drop the Type and Normal columns below 1100px and let the segmented control wrap.
  - On the Job page, put the decision panel straight after the job header at narrow widths.

### D-18 · Sev 1 · Long titles are cut to one line
- **Where:** Feed · Normal and After a week away. Titles use `nowrap` with an ellipsis, 296px wide at 400px.
- **What's wrong / why:** "Senior Application Security Engineer, Payments Platform (Fraud and Risk Engineering)" loses its distinguishing tail. The full title is only in a tooltip.
- **Fix:** Let titles wrap to two lines, clamped at two, and keep the company on its own line.

### D-19 · Sev 1 · No per-row action with a mouse
- **Where:** Feed · Normal.
- **What's wrong / why:** Saving or passing one job with the mouse takes a checkbox click, then a bulk button. Keyboard users have S and X, but the mouse path is slower than it needs to be at around 30 jobs a day.
- **Fix:** Show Save and Pass buttons on row hover or focus, in the empty space to the right of the why-line.

### D-20 · Sev 1 · The decision panel scrolls away
- **Where:** Job · Normal (1,872px tall at 1280) and Low confidence.
- **Fix:** Make the side column sticky (`position: sticky; top: …`) so Prepare, Save and Pass stay in view while the user reads Requirements and Key facts.

### D-21 · Sev 1 · Wording and filter drift
- **Where:** Feed vs Job. Feed · No match.
- **What's wrong:**
  - The Feed says "on 3 sites" but the Job page says "3 postings merged". The glossary term is posting, and one of the three is an email alert, not a site.
  - No match shows the chips "Remote EU only" and "Salary from €4,000", which the normal toolbar can't produce ("Sofia + Remote EU" and "Relocation" only, no salary filter).
- **Fix:** Use "seen in 3 postings". Define the full filter set once and use it in both states.

### D-22 · Sev 1 · Watchlist entry added without asking
- **Where:** Sources · Add, not found.
- **What's wrong / why:** "Nexo is saved to your watchlist as 'no feed, watched via alerts'" happens on its own. It's helpful, but it's a change the user didn't make, and there's no undo.
- **Fix:** Add a "Remove from watchlist" link next to "Back to sources", or make it an explicit "Keep watching Nexo via alerts" button.

### D-23 · Sev 1 · The coverage check asks for a number it could read
- **Where:** Sources · Coverage check.
- **What's wrong / why:** "Results you saw" is required even when the results link is pasted for dev.bg or jobs.bg, and that link already gives the count. It adds friction to a check that is meant to happen weekly.
- **Fix:** Make the count optional when a link is given, and fill it in from the page.

## What works well

- **Failure semantics:** "A failure never closes anything". The Source failing state splits dev.bg's 12 jobs into Kept open, Still covered, At risk and Missing. This is the best answer to moment of truth 1 in the set.
- **Low-confidence extraction:** each unclear fact is quoted with its source line ("kestrel.greenhouse.io, line 41"), the reading is suggested with its reasoning, and "Only for this job. The posting itself isn't changed." Every key fact has "Show where". This meets criterion (c).
- **Merged postings are visible and reversible:** the Job page shows all 3 postings, why the target was chosen, "94% same text", and a Split button.
- **Applied before** shows the earlier role, the quoted rejection reason and what has changed since.
- **Remove company** names exactly what happens to 9 jobs, a draft package and applications. It offers Pause instead and gives a 10-second undo.
- **Coverage check** explains each miss ("filed under IT management, which you don't watch") with a one-click fix, and keeps a history.
- **No match** names the near misses ("2 remote design jobs list no salary") instead of just saying "no results".
- **Disabled buttons always explain themselves** (Closed, Loading, Error), and the source-health pill is in the same topbar place on all three screens.
- **Contrast** passes in both themes. Checked: why-line 4.83:1 light and 5.09:1 dark; chips 5.07–5.75:1.

## Resolution

Applied 2026-10-11 to `hifi/feed.html`, `job.html` and `sources.html`, using the product owner's rules (now in DESIGN.md, "Rules from the Discover review"). Checked in the browser: every state at 320, 400 and 1280 px in light and dark, with no page-level horizontal overflow, one h1 per state, no skipped heading levels, no console errors, and a real Tab pass on each page's normal state.

| ID | Status | What changed |
|---|---|---|
| D-01 | Fixed | Feed rows show every gap, then every partly-met item, then a "+N met" chip. Why-lines are built from the same counts. Kestrel now reads the same everywhere: 6 requirements, 4 met, 1 partly (CISSP, preferred), 1 gap (Kubernetes security) |
| D-02 | Fixed | Feed views are New / Saved / All open / Passed & closed. A new "Passed & closed" state lists passed jobs with their reason (Undo pass) and closed jobs with how they closed (Reopen). Every reference to "Passed" or "All jobs › Closed" now links to `feed.html#passed` |
| D-03 | Fixed | A "Ranking: 3 learned adjustments · review" link sits by the sort control and points to Profile › Dealbreakers & search. Why-lines name adjustments ("ranked lower: you passed 2 similar bank roles", "ranked higher: you boosted Lumen Health", the night-shift rule). The pass-form and closed-job learning checkboxes default to off, and the copy says where each one is listed and undone. The Ranking rules list itself belongs to the Profile screen, outside this feature |
| D-04 | Fixed | One rule on both screens: nothing closes on its own. Jobs stay open, and after 2 more zero checks a Needs-you item asks. Both screens offer "Close 34 SumUp jobs", followed by an Undo toast. The number is "34, usually 30–36" everywhere |
| D-05 | Fixed | Email alerts have a learned cadence (daily, every 2 days). More than 3× the usual gap shows "Quiet longer than usual" in amber, with an icon and text. Google Careers alerts (last email 3 Oct) is the example, and the health pill counts it as unusual on all three pages. The email rule box and a 24-hour mailbox-wide warning are stated |
| D-06 | Fixed | Every state has an accounting line (found = new + hidden). 14 sources everywhere: segments 8 + 1 + 2 + 3 = 14, and Manual capture is explained as not one of the 14. Coverage is split into in Feed / hidden / missing. The Hidden view lists 7 of 7. List footers say "Showing N of M". Segment counts update on pass, save and undo |
| D-07 | Fixed | "Hidden N" is a toolbar toggle in every Feed state. The Hidden view keeps the toolbar, so the way back is the same toggle or New. Its scope is the current view ("since yesterday") |
| D-08 | Fixed | Aligned with the Profile wireframe: hidden above 4 years, minimum €2,000. The "5+ required" option now says it would hide the job |
| D-09 | Fixed | Gaps lists only Kubernetes security. A separate "Partly met" row shows CISSP (preferred, not held) with "never counts as a gap" |
| D-10 | Fixed in part | The Fit header has a "?" tooltip, also wired as `aria-describedby`. The Normal state shows a one-time "Fit is…" hint. The Job page has a "What makes up 91?" breakdown with Strong / Good / Stretch bands. Provisional fits show as "~74 provisional" with a "2 facts need you" chip. Not done: updating the glossary entry (GLOSSARY.md is outside this change) |
| D-11 | Fixed | During Checking sources, new jobs wait under an "N new jobs found · Show them" bar. Showing them merges in fit order without moving focus. Progress is simulated live |
| D-12 | Fixed | Failed reads are retried at the next check whether the job is saved or not. The Feed pins a "Not read yet" group above the ranked list |
| D-13 | Fixed | No pass reason is pre-selected, and the reason is optional. Number keys weren't added: single-key shortcuts now live only in the Feed table (A11Y-02) |
| D-14 | Fixed | Each source name is a button that expands the history inline under its row (`aria-expanded`), with Check now / Pause / Remove… inside. Failing and unusual rows get an inline "Check now" (or "Check mailbox"). The "⋯" menu is gone |
| D-15 | Fixed | Banner states keep the full toolbar, bulk bar, shortcuts, Hidden toggle and footer. Banners are a layer above an unchanged Feed |
| D-16 | Fixed | The buttons are now "Show this job" (no rule change) and "Change this rule…". The header explains both |
| D-17 | Fixed | Below 760 px, Feed rows become two-line cards: Fit on the title line, where and salary under the company, chips and then the why-line. Sources drops the Type and Normal columns below 1100 px (and Last check below 560 px), and its segmented control wraps. In Job · Low confidence, the provisional fit and the decision come before the questions at narrow widths |
| D-18 | Fixed | Titles wrap and clamp at 2 lines. The `title` tooltip is removed |
| D-19 | Fixed | Save and Pass buttons appear on row hover or focus, and always on touch or narrow screens |
| D-20 | Skipped | A sticky side column would hide the Postings and History panels when the column is taller than the viewport. This needs the decision panel split from the side column, which is a build-time layout change |
| D-21 | Fixed | "Seen in N postings" everywhere. One filter set (Angle, Location, Salary, Relocation) used in both the toolbar and No match |
| D-22 | Fixed | "Remove Nexo from watchlist" button, with an Undo toast |
| D-23 | Fixed | "Results you saw" is optional when a link is pasted, and apply-kit reads the count from the page |
