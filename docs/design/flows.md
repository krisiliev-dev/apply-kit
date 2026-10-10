# apply-kit: Journey, structure and objects

Design step 2 (Map). Based on [PRODUCT.md](PRODUCT.md) and the rankings in [friction-map.md](friction-map.md). Method: journey mapping (Kalbach, *Mapping Experiences*). Persona: Kris, the only user. Journey boundaries: from "a new job exists somewhere" to "outcome known, lessons kept".

## 1. Journey map

Emotion scale: −3 (miserable) to +3 (great). **As-is** is the current manual process; **to-be** is the target with apply-kit.

| Stage | Goal | As-is: actions and pain (rank) | Emotion as-is → to-be | To-be: what apply-kit does |
|---|---|---|---|---|
| **1. Discover** | See every relevant new job | Checks ~10 boards and company sites; re-reads duplicates; can't search Google/Apple/Meta in one place; worries about missing jobs (1–2) | −1 → +2 | Feeds, watchlist and email alerts land in one **Feed**, de-duplicated; source health shows nothing is broken; hidden jobs keep a visible reason |
| **2. Judge fit** | Decide quickly whether it's worth it | Reads the whole posting to find dealbreakers at the end; researches the company; checks whether already applied (1–2) | −1 → +2 | Dealbreakers, salary, location and a fit check are pulled out up front; "applied before" shown; one click to **Prepare** or **Pass** |
| **3. Prepare** | A strong, honest, tailored package | Rewrites the CV per job, writes a cover letter, answers screening questions, worries about ATS parsing (**5, 5, 4, 4**) | −2 → +2 | Picks the closest **angle**, tailors the CV from the master profile, drafts the letter in Kris's voice, drafts answers, runs the ATS check; flags gaps and near-the-line edits; Kris reviews the diff and approves |
| **4. Apply** | Submit without retyping | Creates yet another ATS account; retypes CV and standard answers into the portal; uploads files (**5, 5, 4**) | −3 → +1 | The extension recognises the portal, fills every field from the approved package and the **answer bank**, attaches the right CV; Kris checks and presses Submit; the application is logged automatically |
| **5. Track** | Know where everything stands | Confirmation and rejection emails pile up; status lives in his head or a spreadsheet; unsure when to follow up (**5, 4**, 3) | −2 → +1 | Forwarded emails are matched to applications and move their status; follow-ups surface when due; nothing needs manual logging |
| **6. Outcome and learning** | Stay motivated; get better | Rejections hurt with no sense of progress; no idea which CV or source works (**5**, 3) | −2 → +1 | **Progress** view: applications/week, response rate, streaks; which angle, source and role type get replies; rejection logged with a lesson and no dwelling |

### Emotional curve

```
 +3 |
 +2 |   to-be   ●───────●───────●
 +1 |          /                 \───────●───────●
  0 |─────────/─────────────────────────────────────
 -1 |   ●───────●                         as-is
 -2 |                   ●               ●───────●
 -3 |                           ●
      Discover  Judge  Prepare  Apply   Track  Outcome
```

The biggest gains are at **Prepare** and **Apply**, matching the user's 5-ranked frictions. Track and Outcome stay below +2 because rejections still hurt; the goal there is clarity and momentum, not joy.

## 2. Moments of truth

1. **The first morning Feed.** If Kris doesn't trust that it's complete, he goes back to searching manually and the product fails. Source health and visible hidden reasons decide this.
2. **The first tailored CV.** It must read like him and stay within the honesty line. One invented skill or one robotic paragraph and he stops trusting every package.
3. **The first real portal (likely Workday).** If filling breaks on the most common, most hated portal, the 10-minute goal dies.
4. **The first rejection email.** Matched automatically and turned into progress and a lesson, it keeps him going; lost in the inbox, it's just another sting.

## 3. Top opportunities (impact × feasibility)

| # | Opportunity | Impact | Feasibility | Why |
|---|---|---|---|---|
| 1 | Tailored package from master profile + angles, in Kris's voice | Very high | High | Ranked 5; LLMs are good at this with strong rules |
| 2 | Portal filling from an answer bank | Very high | Medium | Ranked 5; portals vary, Workday is hard; old autofill extension is a starting point |
| 3 | One de-duplicated Feed with dealbreakers up front | High | High | Feeds the whole journey; official APIs make it reliable |
| 4 | Email-driven tracking | High | Medium | Ranked 5/4; matching emails to applications needs care |
| 5 | Progress and learning view | Medium-high | High | Ranked 5 for motivation; cheap once tracking exists |

## 4. Structure (first proposal)

Four main areas plus the browser extension. Fewer screens than the old prototype's ~17 routes; each maps to a job in PRODUCT.md. Decided with the user 2026-10-11.

```
apply-kit
├── Feed              (job 0)  new jobs, de-duplicated; filters; "hidden" pile with reasons
│   └── Job           (jobs 0–1) postings, dealbreakers, fit check → Prepare / Pass
│       └── Package   (job 1)  a step inside the Job: target posting, tailored CV (diff vs master),
│                              cover letter, screening answers, ATS check → Approve
├── Applications      (job 3)  stats strip + small chart on top (applications/week, response rate,
│                              what's working); list with board-like qualities: grouped by status,
│                              quick status change, follow-ups due
│   └── Application            status stepper, timeline of events and matched emails, the package sent
├── Profile                    master profile, three angles, answer bank, voice samples
└── Settings                   sources & watchlist, source health, mailbox, model & budget cap

Browser extension     (jobs 0, 2)
├── Capture this page          add a job from any site you're viewing
└── Fill this application      fill the portal from the approved package; mark as submitted
```

Settled: Package is a step inside the Job and shows which posting it targets; Applications is a list with board-like qualities; per-application status shows in each Application and in the list, and overall stats sit at the top of Applications (no separate Progress screen). Step 3 explores concrete layouts for these.

## 5. Domain objects (proposed glossary)

| Term | Meaning | Notes |
|---|---|---|
| **Source** | Where postings come from: an ATS feed, a public API, an aggregator, an email alert, or a manual capture | Has health: last check, count, errors |
| **Company** | An employer; may be on the **watchlist** | One company has many sources and jobs |
| **Posting** | One copy of a job as found on one source | Raw; several postings can describe one job |
| **Job** | The de-duplicated opportunity Kris sees: one or more postings merged | The unit of the Feed. "Posting" ≠ "Job" |
| **Requirement** | Something a job asks for: years, certificate, language, location, visa, salary | Extracted from the posting text |
| **Dealbreaker** | A requirement Kris can't or won't meet | Drives hiding (always with the reason) |
| **Fit check** | Quick verdict: angle match, dealbreakers, gaps | Shown before any effort |
| **Master profile** | The single source of truth for Kris's experience, skills, education | Local only, never in git |
| **Angle** | One of three base framings of the master profile: developer, security, design | Tailoring starts from the closest angle |
| **CV version** | A tailored CV produced for one job | Linked to the job and the application |
| **Cover letter** | A tailored letter for one job, in Kris's voice | |
| **Answer bank** | Reusable answers to standard and screening questions, learned over time | Feeds Package and the extension |
| **Package** | Everything prepared for one job: CV version, cover letter, screening answers, ATS check result | Approved by Kris before applying |
| **Application** | A submitted package for a job, with a status | Created when Kris submits |
| **Status** | Where an application stands: applied, screening, interviewing, offer, rejected, withdrawn | Moved by emails or manually |
| **Event** | Something that happened to an application: an email, a status change, a note | Builds the timeline |
| **Follow-up** | A reminder (and optional draft) to nudge an application | Due dates from status changes |
| **Voice sample** | Writing by Kris used to match his voice | Local only |

Confirmed terms are recorded in [`GLOSSARY.md`](../../GLOSSARY.md).
