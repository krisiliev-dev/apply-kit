# Application tactics: what the old prototype knew

Pulled from the archived `cv-maker/` prototype. Sources: `app/api/{apply-fit,pre-screen,cover-letter,follow-up,interview,salary,rejection,jobs,advisor,review}/**`, `lib/app/{followupCadence,effortBudget,analytics,coverLetterExport}.ts`, `lib/advisor/*`, `lib/jobs/ats.ts`, the `/jobs`, `/applications` and `/advisor` pages, and `README.md`. All paths below are relative to `cv-maker/`. The only persona in the repo is the fictional demo "Ines Valverde".

**Evidence levels**
- **cited**: the code names a source. Almost nothing here does. The salary feature tells the user to check levels.fyi, Glassdoor or friends, but that is a pointer for checking numbers, not a source for the rule. Pacing cites "the roadmap", which is an internal planning doc and not evidence.
- **convention**: common job-search practice most career advisers would recognise.
- **invented**: a threshold or ratio the previous agent picked, with no reason given.

**Not relevant here:** `lib/ai/system.ts`, `lib/ai/tools.ts`, `lib/ai/applyTool.ts` and `app/api/chat/route.ts` are the copilot for the visual CV *editor* (node positions, fonts, a 18 mm margin grid). They hold no application advice. `app/api/base/route.ts` only stores the base profile and CV.

---

## 0. The old app never submitted applications

This is confirmed in code, not just in docs:
- The ATS panel says so in a comment: "We NEVER submit." (`app/jobs/[appId]/JobDetailView.tsx:352`). The UI shows "Values are prefilled locally. Nothing is submitted." (`:379`). It ends with an "Open application form" link to the real apply URL, opened in a new tab (`:382-390`).
- `lib/jobs/ats.ts:14-15`: none of the ATS APIs accept anonymous submissions. The app reads the form schema only "to render a prefilled form — the user copies fields into the real application."
- File fields are never filled. The UI tells the user to attach the CV PDF in the real form (`JobDetailView.tsx:449-452`).
- Follow-ups, counter-offers and cover letters are **drafts only**. No mail-sending code exists (no SMTP or Gmail-send calls). The MCP `sync_email` tool *reads* job-alert mail over IMAP (`mcp/server.mjs:405`). Follow-up rows are marked "sent" by hand.
- The browser extension only *captures* postings from pages the user is already viewing (`extension/README.md`). The MCP server has 15 tools and none of them applies (`mcp/server.mjs`).

---

## 1. Should I apply? (fit check)

**Evidence level: invented.** The verdict buckets and list sizes are design choices. "Surface weaknesses first" is a stance, not sourced.

Source: `app/api/apply-fit/check/route.ts:23-101`. One LLM call compares the parsed posting with the base CV and profile.

- **Verdict, one of four** (`:24-28`):
  - `strong`: apply.
  - `plausible`: decent chance.
  - `stretch`: long shot, but possible.
  - `misaligned`: "don't waste your energy". The UI strikes this badge through (`components/applications/FitCheckCard.tsx:33`).
- **Output fields:**
  - 2–4 strengths and 2–4 weaknesses, both specific. Example weaknesses: missing years, missing domain, missing stack, seniority mismatch.
  - 1–4 "delta questions" to clarify *before* applying, e.g. whether a stack requirement is firm or just a preference.
  - An `effortEstimate` of the tailoring cost: low (CV close as-is), mid (meaningful reframing) or high (big rewrite or domain shift).
  - A one-sentence `honest` take, under 35 words.
- **Rules** (`:94-101`):
  - Weaknesses come first.
  - Banned generic advice: "tailor your CV", "great potential", "consider highlighting more".
  - The verdict must not be a diplomatic hedge.
  - Coupling rule: a fit the candidate can't realistically reach is high effort, and usually stretch or misaligned.
- The voice is "a brutally honest career friend": it does not encourage misaligned applications.
- **Weakness:** the verdict is pure LLM judgement. No scored criteria, no must-have vs nice-to-have weighting, no reproducibility.

## 2. Ceiling / floor: is this role at my level?

**Evidence level: convention** for the idea that applying below level hurts. **Invented** for the cut-offs.

Source: `app/api/advisor/ceiling/route.ts:35-40, 152-170`. Classifies up to 40 target roles (`:101`).

- **Tiers:**
  - `below`: under the current level. Wastes the application. Below-level applying is "usually a mistake (under-paid, bored, signals desperation)".
  - `in-range`: a direct fit.
  - `stretch`: one step up. Credible only with strong prep, and "not 'might get lucky'".
  - `aspirational`: 2+ levels up, or needs credentials the candidate lacks (PhD, C-suite). Long-term only.
- **Level comes from the CV:** years, titles held, scope (IC / lead / staff / director) and domain depth. Salary and location are explicitly *not* level signals ("noisy").
- **`readyForStretch`** is true only when the gaps to close are ≤3 items, each closable in about a month. "Most candidates are not ready; don't inflate."
- Every classification must cite specific CV evidence.

## 3. Pre-screen short answers

**Evidence level: convention** (concrete openers, no clichés). **Invented** for the 120-word default and the word clamps.

Source: `app/api/pre-screen/draft/route.ts:34-116`. Covers the "why us?", "describe a failure" and "why this role?" fields.

- **Structure per answer:**
  1. One concrete opener: an observation, a moment, or a counter-intuitive framing.
  2. One or two anchors from the CV: a project, a team, something shipped.
  3. Optionally, one forward-looking sentence specific to this company.
- **Length:**
  - A word limit is a hard ceiling. Hit it or come in about 10% under.
  - With no limit, aim for about 120 words.
  - Limits are clamped to 20–800 (`:83`).
- **Banned:**
  - Openers: "I'm excited to apply", "I have always been passionate about".
  - Hedges: "I believe", "I think", "I feel".
  - Passive voice.
  - Buzzwords: results-driven, passionate, dynamic, synergy.
  - Sign-off filler: "thanks for considering", "looking forward to…".
- Each answer must stand alone and never refer to another answer.
- **Tones** (`:34-43`): direct is the default.
  - direct: declarative, low-adjective, start with a concrete moment.
  - warm: personal, not syrupy, no flattery.
  - witty: at most one light line across *all* answers.
  - neutral: plain.
- Never invent experience. The CV is the only pool to draw from.

## 4. Cover letters

**Evidence level: convention** for the hook-first structure, the banned clichés and "no fabrication". **Invented** for the exact 3-paragraph shape and the 220-word default.

Source: `app/api/cover-letter/route.ts:30-101`.

- **Exactly three paragraphs** (`:80-83`):
  1. A hook about the company, the role or the problem space (*not* about yourself), then a one-sentence pivot to fit.
  2. The single strongest alignment, anchored in ONE concrete CV example, with numbers if the CV has them.
  3. Forward-looking: what the candidate wants to do in this role specifically. Close in one sentence.
- **Length:**
  - Default target is 220 words ±15%, with a hard cap of target + 50.
  - The user can set the target, clamped to 120–400 (`:70, 130-133`).
- **Banned:**
  - "I'm thrilled", "I'm excited to apply", "results-driven", "passionate", "dynamic".
  - Contact-me filler: the recipient already has the details.
- **Output format:**
  - Body only: no greeting, sign-off, name or address block.
  - The export wraps the body in a placeholder greeting and sign-off ("Dear {company} team," … "Sincerely,") and the README says to edit them before sending (`lib/app/coverLetterExport.ts:34-41, 55`).
- **Tones:**
  - Same four as pre-screen; default `direct`.
  - `witty` allows at most one subtle line, and "never a joke that undercuts the pitch" (`:30-39`).
- **Missing job data:** if there is no parsed job, stay role-agnostic but still concrete.
- **Alternative seed:** the ATS prefill seeds any "cover"/"why" field with a short template: name and title, the first two requirements, a `[Add a concrete story here…]` placeholder, then "CV attached" (`JobDetailView.tsx:559-565`).
- **Export bundle:**
  - `cover-letter.txt`, `cv.json`, an ATS-friendly `cv-plain.txt`, and a README (`coverLetterExport.ts:8-13`).

## 5. CV tailoring per application (rules that touch applying)

**Evidence level: convention** for truthfulness, mirroring the posting's vocabulary and impact-first bullets. **Invented** for 160 characters, 3 bullets, a ~5-year window and a target score of 80.

Source: `app/api/jobs/draft/route.ts:372-410`. "Your job is emphasis, not addition."

- **Hard rules:**
  - No invented companies, titles, dates, technologies or numbers.
  - Keep every role and education entry unchanged.
  - Never add a skill the user didn't list. Example: if the CV has no Kubernetes and the job wants it, leave it out, because "keyword coverage is a soft target — truthfulness is not."
- **Soft rules:**
  - ≤3 bullets per role by default (range 1–8), each ≤160 characters and starting with a past-tense verb.
  - Adopt the posting's term for the *same* concept, e.g. "monitoring" becomes "observability". Don't do it for non-synonyms.
  - Relevance may beat recency only within the last ~5 years.
  - Rewrite the summary to lead with the single strongest alignment.
  - Put matching skills first within each skill group.
  - Return 3–6 `tailoringNotes` so the user can audit the changes.
- **Refinement loop:** if the evaluator scores the draft under 80, it loops up to 3 times (`:36`, `lib/evaluation/refine.ts:29-30`).
- **Job parsing** extracts 5–15 concrete keywords a CV should echo and must not invent salary, location or requirements (`app/api/jobs/parse/route.ts:29, 79`).

## 6. Follow-up cadence

**Evidence level: convention** for the shape: nudge about a week after applying, thank-you notes soon after calls. **Invented** for the exact day counts and word ranges. Nothing is cited.

Source: `lib/app/followupCadence.ts:5-9, 37-62, 154-164`. Deterministic, no AI. A follow-up is staged automatically when the application's status changes. There is at most one pending row per kind per application (`:85-90`).

| Kind | Trigger | Due | Anchor | Style / length |
|---|---|---|---|---|
| post-apply nudge | status → applied | **+7 days** | date the application was created | Light, one paragraph, re-flags interest without pressure. 70–110 words |
| after-screen thanks | status → screen | **+3 days** | status change | Warm; mention one concrete topic from the call; confirm interest. 90–130 words |
| after-interview thanks | status → interview | **+2 days** | status change | Stronger; specific to technical or strategic topics; invite the next step. 100–150 words |
| offer reminder | status → offer | **+1 day** | status change | Note-to-self about the deadline, *not* an email to the company. Under 80 words |
| custom | manual | +3 days | now | Neutral |

- **Other timings:**
  - Snooze pushes a row back +3 days (`components/applications/FollowUpsSection.tsx:85, 258`).
  - "Due soon" means scheduled within the next 2 days (`lib/app/followupStore.ts:83-90`).
  - Older applications get a post-apply row backfilled at created + 7 days (`followupCadence.ts:114-144`).
- **Draft rules** (`app/api/follow-up/draft/route.ts:94-101`):
  - Plain body only: no subject, greeting or sign-off.
  - "Concise and warm, never fawning".
  - Banned: "I wanted to reach out to express my deep interest", "as per my previous email", "I'm thrilled".
  - Reference one specific detail from the role or background. Never invent; if there's nothing to reference, keep it brief and honest.
  - Context passed in: company, role, status, URL, top 5 requirements, notes, apply date (`:103-116`).
- **Offer self-reminder** (`:63-70`): state the deadline context, one clarifying question to answer and one action. "Never 'you've got this'."
- **Gaps:**
  - Thank-yous at +2/+3 days are later than the common "within 24 hours" advice.
  - There is no second nudge, and no "stop after N follow-ups" rule.
  - Ghosting is set by hand with two labels: ghosted ≤2 weeks / >2 weeks (`lib/app/types.ts:78-79`). There is no automatic ghost detection.

## 7. Interview prep

**Evidence level: convention** for STAR and a behavioural-heavy mix. **Invented** for the percentages and the 12-question default.

Sources: `app/api/interview/generate/route.ts:32-34, 36-86, 198-227` and `app/api/interview/research/route.ts:61-73`. The prep section appears once status is screen, interview or offer (`app/applications/[id]/page.tsx:196-198`).

- **Question count:** 12 by default, clamped to 4–24.
- **Question mix:**
  - ~50% behavioural: collaboration, failure, ambiguity, scope, conflict.
  - ~25% technical, only if the role is technical; otherwise that share goes to behavioural and situational.
  - ~15% values / culture-fit: why this company and this stage.
  - ~10% situational, e.g. "day 30, given this stack".
  - System design is a separate kind, for roles where architecture rounds are standard.
- **Each question carries:**
  - The question phrased the way an interviewer would ask it, not as a topic.
  - A 1–2 sentence rationale for why *this* company asks it, grounded in the posting, the company stage, or a follow-up trap in the CV.
- **STAR answers:**
  - Written in the "I" voice, about 120–180 words across the four parts.
  - Situation is 1–2 sentences; Action is 2–4 sentences with concrete verbs; Result uses only numbers the CV has.
  - Each must name its CV source.
  - If the CV has no truthful source, give no answer and note that the user should prepare it from outside the current CV. The question still stays in the deck.
- **Avoid** "tell me about yourself" unless it is framed around a signal in the posting.
- **Company research:**
  - A 3–5 sentence characterisation, plus 3–6 one-line signals, each tagged with a source (`[posting]`, `[Glassdoor]`, `[user notes]`, `[pre-training]`).
  - Uncertain claims are marked "(unverified)".
  - No URLs unless the user pasted them. No scraping (there is a TODO to add web search).
- Questions can be marked "practiced" (README:238).

## 8. Salary research and negotiation

**Evidence level: convention** for "sign-on and equity bend more easily than base", "open with gratitude" and "verify on levels.fyi". **Invented** for the ≤15% base cap. **Cited** only in the sense that it points users to levels.fyi, Glassdoor and friends for verification.

Sources: `app/api/salary/parse/route.ts:21-63, 94-101` and `app/api/salary/analyze/route.ts:27-117`.

- **Parsing offers:**
  - "180k" becomes 180000. A range becomes its midpoint.
  - Currency symbols map to codes (£ → GBP, € → EUR); default is USD.
  - Bonus percentages stay as text.
  - Don't confuse equity value with base.
  - Ignore vague "generous PTO". Never invent missing amounts.
- **Market context:**
  - Comes from model pre-training only, with no live data.
  - Every analysis must open with: "Approximate; verify on levels.fyi / glassdoor / friends before negotiating." The server adds it if the model drops it (`:137-142`).
- **Output fields:**
  - 2–5 leverage points, which must map to the CV.
  - 1–4 **risks**: things *not* to push on.
  - A counter: a one-line headline (e.g. "base + equity"), an email body and a 2–3 sentence rationale.
- **Counter rules** (`:114`):
  - Ask for a realistic delta: a **base bump of at most 15%** of the offer.
  - Sign-on and equity are "usually softer asks; consider those first".
  - Never propose an outlandish number.
- **Email** (`:115`):
  - About 150 words (±30).
  - Open with *specific* gratitude, state the counter concretely, close open to discussion.
  - Neither aggressive nor sycophantic. No "I'm excited to".
- **Offer evaluation** (`app/api/advisor/decisions/route.ts:160-165`):
  - Read equity sceptically unless the company is late-stage.
  - Check the manager: have they shipped, and will they defend you in performance cycles?
  - Watch for title inflation.
  - Look at runway and headcount: "A 'senior' title at a dying company is not a promotion."
  - Weigh the opportunity cost.

## 9. Handling rejection

**Evidence level: invented** for the taxonomy and fields. **Convention** for "learn from rejections, but don't over-read form letters".

Source: `app/api/rejection/extract/route.ts:19-66, 134-143`, with kinds in `lib/app/types.ts:73-92`.

- **Outcome kinds:**
  - auto-rejection
  - post-screen loss
  - post-interview loss
  - final-round loss
  - ghosted ≤2 weeks
  - ghosted >2 weeks
  - self-withdrawn
  - offer declined by me
- **Extracted signals:**
  - Cited reasons: exact phrases only. Must be empty if no text was pasted, so quotes are never invented.
  - Inferred reasons, which must be specific to this case.
  - Tone: curt, standard, warm or template. No message means "template".
  - Seniority feedback (under / over / fit), a salary-mismatch flag, and any compensation hint (e.g. "outside our band").
  - `stageLost`: the furthest stage reached.
- **Outputs:**
  - A one-sentence summary, under 30 words. If it's a form letter, say so and keep the inferences cautious.
  - **1–3 lessons, specific to this rejection.** Banned: "tailor your CV", "network more", "practice behavioural questions". A good example pairs a lesson with the stage and company type, e.g. lead with the shipping-speed story for early-stage post-screen losses where pace was cited.
- **Across many rejections:**
  - Recurring lessons are grouped by token overlap: two lessons match if they share ≥4 significant words or have Jaccard overlap ≥0.5 (`lib/app/analytics.ts:356-477`).
  - The top 5 themes are shown.

## 10. Effort budget, pacing, application volume

**Evidence level: invented.** Every threshold. The burn-rate comment says the README references them, but no outside source is given. Pacing says "~20/month — matches the roadmap's effort-budget hint" (`lib/advisor/pacing.ts:15`).

**Effort budget** (`lib/app/effortBudget.ts:11-15, 23, 87-124`):
- **Defaults:**
  - Target: 20 applications per 30 days. Configurable from 1 to 200 (`:146`).
  - Drafts are excluded.
- **Measures:**
  - Quality ratio: the share of applications with both a tailored CV and parsed job data.
  - Response rate: the share *not* auto-rejected and not lost at the resume stage.
- **Burn-rate states:**

| State | Rule | Guidance |
|---|---|---|
| spray | > 1.5 × target **and** quality < 50% | "Spray-and-pray territory. Cut volume, raise tailoring." |
| over | > 1.2 × target | "Volume is high; watch for burnout." |
| on-track | 0.7–1.2 × target | shows tailored % and response % |
| under | < 0.7 × target | "Space to add N high-quality ones". With zero: "Either on purpose, or ghost-hunting." |

**Pacing / sprint detection** (`lib/advisor/pacing.ts:4-8, 15, 45-47, 119-155`):
- **Inputs:**
  - Sustainable pace defaults to **5 per week**, or the monthly target ÷ 4.
- **Sprint rule:**
  - A sprint means more than ceil(1.3 × pace) applications in the last 7 days **and** no gap of 2+ days in that window. The gap condition is there so steady, spaced-out applying isn't flagged.
- **Guidance, in priority order:**
  1. None in 30 days: fine, no action.
  2. Sprint: take a 1–2 day pause, because "quality tends to drop faster than volume rises".
  3. Above pace but not a sprint: watch tailoring quality.
  4. None in 7 days: recovery or a lull, both fine.
  5. 14+ days without a 2-day break: a rest day "improves the next cover letter more than the raw volume does".

The overall stance is **quality over volume**: high volume with low tailoring is flagged as a problem, and so is never resting.

## 11. Career-advisor lenses

**Evidence level: convention** for most of the decision heuristics. The "well-known pattern" in stay-vs-go is *claimed* but uncited. **Invented** for list sizes and the skill-gap tiers.

- **Narrative** (`app/api/advisor/narrative/route.ts:30-75, 148-166`):
  - First, name the story the CV is telling, often unintentionally. Lead with what a hiring manager picks up "in 6 seconds". Say it plainly if the CV is scattered.
  - Then propose 2–3 genuinely different framings, labelled in 2–4 words (e.g. "The operator", "The specialist").
  - Each framing needs ≥2 cited pieces of CV evidence (otherwise drop it) and 1–4 risks: what the framing undersells.
  - Uses up to 40 recent applications.
- **Skills** (`app/api/advisor/skills/route.ts:33-97, 193-220`):
  - Collect required skills across the user's target postings (the page uses the last 80 discovery postings, `app/advisor/skills/page.tsx:30`).
  - **Critical gap:** demanded by more than half the postings and missing from the CV. **Nice-to-have gap:** demanded by ≥2 postings but under half.
  - Add an adjacency note when the user has something close ("Vue → React").
  - Don't flag trivial variants (Next.js vs Next.js App Router).
  - **Acquisition paths:** never "take a course" or "read a book". Name a specific project, course or public artifact. Give effort in calendar weeks at 5–10 hrs/week, from 1 to 52; "don't say learn Rust in 2 weeks". Aim for 3–6 paths.
- **Decisions** (`app/api/advisor/decisions/route.ts:38-77, 149-180`):
  - Output: pros and cons (1–8 each), 3–8 probing questions (e.g. "Ask for the pre-IPO cap table", not "think about equity"), a **one-sentence recommendation starting with a verb**, and a confidence level. Confidence must be low when the input is thin.
  - Name it, gently, when the user seems to be rationalising.
  - **Stay vs go:**
    - Is career capital still compounding?
    - What is the manager or project change risk?
    - People overweight the certainty of staying and underweight drift. They also underweight onboarding pain.
    - A sub-2-year exit is a signal; so is 6 years without growth.
  - **Pivot:**
    - Name the bridge, or say there isn't one.
    - What is the salary delta, and how long to recover?
    - List specific transferable skills.
    - Note life-stage realities without moralising.
    - Consider a "0.5 step" adjacent role first.
- **Ceiling:** see §2.

## 12. ATS-specific prefill

**Evidence level: cited** in the sense that it follows each vendor's public API docs, which are linked in comments. The field mapping is **invented** (name heuristics).

Source: `lib/jobs/ats.ts:4-15, 71-170, 197-232`; prefill mapping in `app/jobs/[appId]/JobDetailView.tsx:505-557`.

| ATS | Detected from | Form schema |
|---|---|---|
| Greenhouse | `boards.greenhouse.io/<co>/jobs/<id>`, `job-boards.greenhouse.io/...` | Real (`questions[]` from the board API) |
| Ashby | `jobs.ashbyhq.com/<co>/<id>` | Real (`applicationFormDefinition.sections[].fields`) |
| Lever | `jobs.lever.co/<co>/<id>` | Metadata + standard-field stub (no public form schema) |
| Workday | `<tenant>.wdN.myworkdayjobs.com/.../<site>/job/.../<reqId>` | Metadata + stub. The real form is per-tenant and session-gated, and reversing it would be "brittle and violate ToS" (`:441-445`) |
| SmartRecruiters | `careers.` / `jobs.smartrecruiters.com/<Co>/<id>` | Metadata + stub |
| Teamtailor | `<sub>.teamtailor.com/jobs/<id>-slug` | Metadata + stub |

- **Standard stub fields:**
  - first name, last name, email, phone, location, LinkedIn, website, resume (file), cover letter
  - work authorisation (yes/no)
  - visa sponsorship now or later (yes/no)
- Stub forms show a banner telling the user to check the real form.
- **Prefill by field name:**
  - first / last / full name, email, phone, LinkedIn, GitHub and website come from profile links.
  - location / city.
  - any "cover" or "why" field gets the cover-letter seed (§4).
  - Everything else is left blank: the authorisation, sponsorship and custom questions are never guessed.
- Each field has a copy button.

## 13. Analytics and funnel metrics

**Evidence level: convention** for funnel and response-rate tracking. **Invented** for the 90-day window, the histogram buckets and the >50% stall flag.

Source: `lib/app/analytics.ts`; diagnostic prompt in `app/api/review/summarize/route.ts:64-72`.

- **Statuses:** draft → applied → screen → interview → offer, plus rejected / withdrawn / ghosted-short / ghosted-long (`lib/app/types.ts:8-17`).
- **Funnel:**
  - Counts the *highest stage reached*: an application rejected after an interview counts toward both interview and rejected.
  - Window is 90 days (`:29, 55-100`).
- **Weekly response rate:**
  - 13 weekly buckets.
  - An application counts as "responded" if it ever moved past applied (`:113-159`).
- **Time to first response:**
  - Buckets: ≤3d, 4–7d, 8–14d, 15–30d, 31–60d, 61d+. Also shows the median (`:171-214`).
- **CV variant performance:**
  - Per tailored CV: response rate (screen / applied) and interview rate.
  - Ranked by interview rate first (`:243-275`).
- **Stall pattern:**
  - If >50% of losses happen at one stage (with ≥2 losses), flag "Most losses: <stage>. Consider prep focus there." (`:292-329`).
- **Diagnostic:**
  - 3–5 sentences in second person, specific to the numbers.
  - Name a concentrated stage or a winning variant.
  - End with **one** concrete adjustment. No "keep applying!".
  - The UI says patterns emerge at around 10 applications (`app/applications/review/page.tsx:89`).

---

## Cross-cutting principles (the real house style)

1. **Never fabricate.** Every generator treats the base CV as the only truth, and fit, STAR, leverage, narrative and skill gaps must all cite CV entries. This is the most consistent rule in the codebase.
2. **Honest over encouraging.** "Brutally honest career friend" shows up in fit, decisions and ceiling. Generic advice is explicitly banned, with lists of bad examples.
3. **Shared banned-phrase list:** thrilled / excited to apply / passionate / results-driven / dynamic / synergy / hedges ("I believe/think/feel") / contact-me filler.
4. **One strong thing:** one CV example per cover letter, one adjustment per diagnostic, one-sentence verdicts.
5. **The human stays in the loop:** drafts, copy buttons and an "Open application form" link. Nothing is sent.

## Reusable for the new app

**Strongest, worth rebuilding:**
- **The no-fabrication contract**, with CV-source citations on every claim (`sourcedFrom`, evidence lists) and "omit rather than invent" (STAR fallback, empty `citedReasons`). It is cheap to keep and builds a lot of trust.
- **The fit check as a gate before effort:** verdict, weaknesses-first, delta questions and tailoring-effort estimate. Make it more deterministic: score must-haves vs nice-to-haves before the LLM writes the prose.
- **Ceiling tiers**, especially calling out *below-level* roles and the strict `readyForStretch` rule.
- **Status-driven follow-up staging** with dedupe and snooze. Rebuild it with editable per-user offsets, add a second-nudge or stop rule, and move thank-yous to about 24 hours.
- **Effort budget + sprint detection**, with "quality ratio" as a first-class metric. The spray rule (high volume and low tailoring) is a useful idea even though the numbers are arbitrary.
- **Rejection → lessons → recurring themes**, plus the stall-stage flag. A closed learning loop most trackers lack.
- **Highest-stage funnel + variant performance:** concrete and testable.
- **ATS handling:** detect the vendor, use a real schema where one exists (Greenhouse, Ashby), stub honestly elsewhere, never guess authorisation or sponsorship answers, never submit.
- **Banned-phrase lists and "bad lesson" counter-examples** in prompts: easy to port into lint checks on generated text.

**Weak, rethink or drop:**
- **Market salary ranges from model pre-training.** The disclaimer helps, but the numbers are still guesses. Use real data or leave ranges out. The ≤15% base cap is arbitrary.
- **All numeric thresholds** (7/3/2/1 days, 20 per month, 5 per week, 1.3×/1.5×/1.2×/0.7×, 50% stall, 90-day window) are uncited. Expose them as settings and label them as defaults.
- **The fixed 3-paragraph / 220-word cover letter** and the prefill seed template. Fine as defaults; too rigid as rules.
- **Interview "company research"** without web access is model memory tagged "(unverified)", so its value is low.
- **"Response rate"** in the effort budget means "not auto-rejected", which differs from the review page's "moved past applied". Pick one definition.
- **Rejection theme grouping** by token overlap is crude. Embeddings or manual tags would be better.
- **Ghosting** is manual. Derive it from time since the last event.
