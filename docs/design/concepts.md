# apply-kit: Concepts

Design step 3 (Diverge, then converge). Method: parallel concepts (Dow, Glienke & Klemmer, 2010), then concept selection against criteria fixed in advance. Each set differs in **what the user does**, not in looks; all mockups share one greyscale visual language so the behaviour is the only variable.

Clickable mockups: see the Concepts artifact (link in the session / commit message).

## Selection criteria (fixed before choosing)

Weighted 1–3. Each concept is scored 1–5 per criterion by the user.

| Criterion | Weight | From |
|---|---|---|
| **Speed**: time from opening the screen to the decision or action it exists for | 3 | Success measure: under 10 min per application |
| **Trust**: the user can see nothing was missed, invented or decided behind their back | 3 | Principles: nothing disappears silently; honesty line |
| **Effort per day**: clicks/reads needed at ~30 new jobs and ~10 open applications a day | 2 | Friction ranks |
| **Learnability**: obvious on day one without instructions | 1 | Single user, but used daily |
| **Build cost**: how much has to be built before it's useful | 1 | Lean principle |

## 1. Feed

**Question:** how does the user get through ~30 new jobs a day quickly while trusting nothing was missed?

| | Concept | What the user does | What it tests |
|---|---|---|---|
| A | **Triage queue** | Sees one job at a time with its dealbreakers and fit check; presses Prepare, Save or Pass (with a reason); keyboard-driven, works toward "inbox zero" | Whether focused one-at-a-time decisions beat scanning |
| B | **Scan table** | Sees all new jobs as dense rows with requirement chips; sorts, filters and multi-selects; opens a job only when interested | Whether overview and comparison beat focus |
| C | **Daily shortlist** | Gets a ranked shortlist of the top ~5 with the reason each made it; everything else collapsed into "also new" and "hidden (with reasons)" | How much ranking the user will delegate to the system |

## 2. Package (step inside a Job)

**Question:** how does the user review and approve a tailored package fast, while staying sure it's true and sounds like them?

| | Concept | What the user does | What it tests |
|---|---|---|---|
| A | **Guided steps** | Walks through target posting → CV changes → cover letter → screening answers → ATS check, approving each before the next | Whether a fixed sequence feels safer than freedom |
| B | **Requirement map** | Sees the posting's requirements on the left, each linked to the profile evidence used in the CV on the right; edits inline; gaps shown as red rows | Whether evidence-per-requirement builds the most trust |
| C | **Exceptions only** | Sees only what needs a human: near-the-line edits, gaps and low-confidence answers; everything else is collapsed as "ready"; one Approve | How far the user will let the system decide |

## 3. Applications

**Question:** how does the user see where everything stands and act on what needs attention?

| | Concept | What the user does | What it tests |
|---|---|---|---|
| A | **Grouped list** | Scans applications grouped by status (collapsible, board-like), changes status inline; stats strip on top | Whether status is the right organising axis |
| B | **Action queue** | Starts from "needs you": follow-ups due, emails to confirm, interviews to prep; everything quiet sits below | Whether the entry point should be actions rather than status |
| C | **Activity timeline** | Reads a chronological stream of events (emails, status changes) across applications; stats chart inline | Whether events, not applications, are the natural unit |

## 4. Master profile onboarding

**Question:** how does the user end up with a rich, confirmed master profile with the least effort?

| | Concept | What the user does | What it tests |
|---|---|---|---|
| A | **Import, then review** | Drops in old CVs and a LinkedIn export; the system drafts profile pieces; the user confirms or edits each card | Whether the system's first draft is good enough to start from |
| B | **Coach interview** | Has a conversation, role by role, with an AI coach that mines achievements and numbers; imports only feed its questions | Whether talking surfaces stronger material than editing |
| C | **Just in time** | Imports one CV and starts applying today; the profile grows from gap questions asked during tailoring | Whether a thin start plus learning beats a big upfront effort |

## Decision (2026-10-11)

| Screen | Chosen | User's reason | Carried over from the others |
|---|---|---|---|
| **Feed** | **B · Scan table**, sorted by fit by default | Freedom to choose what to apply for, with the most suitable roles at the top | From C: each row shows a one-line "why it ranks here" so the sort is explainable. From A: keyboard shortcuts for save/pass on the focused row |
| **Package** | **A · Guided steps** | Be sure everything is done correctly before sending | From B: the CV step shows each requirement next to the evidence used. From C: flagged items (near the line, gaps, low confidence) are highlighted inside their step so they can't be missed |
| **Applications** | **B on top of A**: action queue, then the grouped list | Best of both: what needs me first, the full picture below | Stats strip stays above both. C's weekly chart lives in the stats strip |
| **Profile onboarding** | **A → B → C**, in sequence | Import gives the AI a base; then it questions what it wrote plus gaps and forgotten skills; then it keeps learning from answers given during applications | All three concepts kept, as phases |

What the rejected options taught us:
- **Feed A (triage)**: forcing a decision on every job is too slow at ~30 a day; focus matters less than freedom. **Feed C (shortlist)**: delegating the choice entirely loses trust, but the ranking itself is wanted as the default sort.
- **Package B (map)** and **C (exceptions)**: evidence and flagging build trust, but the user wants a guaranteed full pass, not a shortcut. Both survive as content inside the guided steps.
- **Applications C (timeline)**: events aren't the organising unit; a status and action view is.

Onboarding interview scope (phase B): verify what was imported, ask about gaps in the CV timeline, and probe for skills the user has likely developed but not written down.

