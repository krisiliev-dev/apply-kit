# CV writing and evaluation: what the old prototype knew

Pulled from the archived `cv-maker/` prototype. Sources: `lib/evaluation/*`, `app/api/cv-evaluate/**`, `app/api/review/**`, `app/api/paraphrase/**`, plus `README.md`. All paths below are relative to `cv-maker/`. The only persona in the repo is the fictional demo "Ines Valverde".

**Evidence levels**
- **cited**: the code names a study or source. **No rule in these files cites anything.** No study, no URL, no data. The only external reference is Affinda's API docs (`lib/evaluation/affinda.ts:22`), and those cover the API, not CV practice.
- **convention**: common recruiting or CV-writing practice that people would broadly recognise.
- **invented**: a number or weight the previous agent picked. Several comments admit this ("tuned to feel right on our seeded CVs", `archetypeDetector.ts:48`).

---

## 1. Pipeline at a glance

One evaluation runs 8 layers and blends 6 of them into a 0–100 score (`lib/evaluation/evaluate.ts:51`, `types.ts:1-10`).

| Layer | What it checks | How | In composite? |
|---|---|---|---|
| Parseability | Can an ATS parser pull out the core fields? | Render to A4 PDF, send to the Affinda parser | Yes |
| Keywords | How many of the job's keywords appear in the CV | Substring match | Yes |
| Recruiter-eye | A senior recruiter's 15-second triage | LLM, given the CV as plain text | Yes |
| Six-second | What sticks after a first glance | LLM, given the rendered PDF | Yes (when it can run) |
| Numbers | Outcome claims with no metric | Regex | Yes |
| Proof | Bullets with no link to evidence | Field check | Yes |
| Archetype (boilerplate) | Clichés and filler phrases | Regex list | No, warnings only |
| Tenure | Job-hopping and gaps | Date math | No, warnings only |

Design principle stated in `score.ts:41-45`: keep the overall score tied to "verifiable facts". The softer heuristics (archetype, tenure) produce warnings but don't move the number.

---

## 2. The 6-second scan (`lib/evaluation/sixSecondTest.ts`)

**Evidence: convention.** The "recruiters spend ~6 seconds on a CV" idea is popular (it usually traces back to the Ladders eye-tracking study, 2012/2018). The code never cites it, though. The 0–100 scale and the thresholds are **invented**.

**What the model is asked to do** (system prompt at `:75-87`). It plays a senior technical recruiter with "about SIX SECONDS per CV" and no re-reads. It gets the **rendered PDF**, not the text (`:22-24`), because layout is what's being tested. Temperature is 0.2 to get an "honest gut" read (`:119`). The user prompt says: "Do not study the PDF" (`:153`). It reports:
- `nameRead` and `currentRoleRead`, left empty if not clear. The prompt says "do not guess" (`:80`).
- `seniorityImpression`: junior / mid / senior / staff / unclear.
- `strongestSignal`: must quote the actual phrase seen (e.g. "Staff Engineer at Stripe"), not a category (`:81`).
- `oneThingRemembered`: the single detail you'd recall unaided 10 minutes later (`:82`).
- `misreadings`: anything misread or confusing at a glance.
- `scannabilityScore` (0–100, a gut number). Low: walls of text, tiny fonts, graphs as images. High: clean hierarchy, bold headline plus company (`:84`).
- Up to 4 concrete `warnings`. The prompt's example is "Move name to top-left; currently lost under logo", which it says beats "improve visibility" (`:85`).

**Hard checks after the reply** (`:174-215`):
- The model's name read doesn't match the parser's name (case- and whitespace-insensitive), or no name came back → **error**: "didn't identify your name correctly at a glance".
- The model's current role doesn't contain the parsed title and company (or any word longer than 3 characters from it) → **error**: "Current role isn't readable at a glance". If nothing came back: "make the most recent title more prominent".
- Scannability below 50 with no warnings → add a fallback warning: "Try larger name, bolder recent role, fewer walls of text" (`:208`).

**Writing rules this implies:** put the name large at the top. Make the most recent title and company bold and immediately findable. Avoid dense paragraphs, tiny type and charts rendered as images. Make one memorable detail pop.

---

## 3. What recruiters look for: recruiter-eye triage (`lib/evaluation/recruiterEye.ts`)

**Evidence: convention** (standard recruiter red flags). The odds→score mapping is **invented**.

The persona "skim[s] hundreds of CVs per day" and gives about **15 seconds** (`:63`). The prompt says: be terse, honest, no hedging, "Do not be nice" (`:79`). It receives the flattened CV text (first 8,000 characters), the target role, and when available the job title, company, first 800 characters of the description and up to 8 requirements (`:133-160`).

Output fields (`:35-59`):
- **strongestSignal**: the one thing that makes you keep reading. Quote the line.
- **biggestWeakness**: the one thing most likely to get the CV tossed. "Be direct, not polite."
- **concreteImprovement**: one specific next change, not general advice.
- **flaggedIssues** (up to 6, no padding). Five categories:
  - **Unclear section headers**, e.g. "Stuff" instead of "Experience".
  - **Inconsistent verb tenses** across bullets.
  - **Buzzwords with no evidence**: "passionate", "synergy", "results-driven".
  - **Over-claiming**, e.g. "rebuilt the entire platform" from someone with 6 months' tenure. Treated as an **error**, the harshest issue (`score.ts:278`).
  - **Format issues** a human catches: walls of text, orphan lines, odd capitalisation.
- **interviewOdds**: Low / Mid / High, a gut call on whether this earns a phone screen.

Note: the two LLM passes disagree on the attention budget (15s here, 6s in the skim test). Both numbers are rhetorical.

---

## 4. Quantified impact and numbers (`lib/evaluation/numberInspector.ts`)

**Evidence: convention** ("quantify your achievements" is near-universal CV advice). The rule is applied mechanically: every outcome verb must carry a metric. Treat that strictness as **invented**.

**Rule:** a bullet that claims an outcome must include a number, percentage, money figure, or scope word.
- Example from `:9-11`: weak "Improved site performance". Strong "Cut p95 latency 38% (700ms → 430ms) across 3M MAU". The strong version has a percentage, a before→after baseline and a scale.

**Outcome verbs that trigger the check** (`:20-29`): improve/increase/reduce/decrease/drive; ship/deliver/launch/roll out; scale/grow/expand/accelerate; lead/manage/direct/own; build/architect/design/redesign/rebuild; cut/save; migrate/convert/transform/overhaul/refactor; optimise/stabilise/automate/streamline.

**What counts as "has a number"** (`:32-48`):
- Digits (12, 1,234, 3.14), percentages, currency symbols ($ € £ ¥), magnitudes (5k, 10M, bn).
- Scope words, even without digits:
  - Quantity: millions, thousands, hundreds, dozens.
  - Who: users, customers, clients, tenants, employees, engineers, teams.
  - Load: requests, rps, qps, tps.
  - Business metrics: revenue, ARR, MRR, GMV, NRR, CAC, LTV, bookings.
  - Time and performance: ms, seconds, hours, p50/p95/p99, latency, throughput, uptime.

Score = bullets with a metric ÷ outcome bullets × 100 (100 if there are none). The check is deliberately conservative: missing a weak bullet is preferred over flagging cosmetic lines (`:18-19`).

Weakness: a scope word alone ("improved latency for users") passes. So the check rewards jargon, not measurement.

---

## 5. Proof / evidence (`lib/evaluation/proofInspector.ts`)

**Evidence: invented** as a scoring rule. "Link to a portfolio or GitHub" is conventional for some fields, but expecting a link on every bullet is not standard practice.

**Rule:** every experience bullet should carry a `proofUrl` pointing to the artifact behind it: a commit, a published piece, a dashboard, a demo (`:7-10`). A text block counts as a bullet if its layer name contains `exp`/`experience`/`bullet`, or it starts with a bullet marker (• - * ◦). Users can override per bullet with `proofRequired`.

Score = bullets with proof ÷ bullets × 100. This carries **7.5% of the composite**. A strong CV with no links therefore loses up to 7.5 points.

---

## 6. Tenure and gaps (`lib/evaluation/tenureInspector.ts`, `app/api/cv-evaluate/tenure-frame/route.ts`)

**Evidence: convention** for the general concern ("job-hopper" flags, unexplained gaps). The specific thresholds are **invented**. One message claims recruiters "often use" an 18-month threshold (`:76`) but cites nothing.

**Rules** (`:19-23`, roles assumed listed most-recent-first):
1. **Two consecutive stints under 12 months each** → warn. Penalty −25.
2. **Average tenure under 18 months across the last 4 roles** (needs at least 3 roles with parseable dates) → warn. Penalty −20.
3. **Gap of more than 3 months** between one role ending and the next starting → info. Penalty −8 each.

Score starts at 100 and is not part of the composite. Dates accepted: `2022`, `2022-05`, `05/2022`, `May 2022`, `present/current`. Anything else is ignored rather than counted against you, which keeps false positives low (`:26-29`).

Caveats:
- A year-only date is read as January, which can manufacture gaps or short stints.
- An unparseable end date silently becomes "present" (`:184-187`).

**Reframing advice, from an LLM prompt** (`tenure-frame/route.ts:129-146`). Given the flagged pattern, write 1–2 one-line sentences for the profile summary that:
- **own the pattern rather than hide it**
- reframe it "as an intentional operating mode, not a flaw"
- are concrete: reference a skill or a pace, "not a vibe"
- have no preamble, markdown or quotes

Example shapes from the prompt:
- "Operator-type — thrives on 6–12 month ship cycles and chooses assignments accordingly."
- "Two deliberate breaks in the last five years for full-stack learning sprints; both shipped."

Output is capped at 2 lines under 280 characters each and cached for 10 minutes.

**Evidence: convention**, with one caution. "Own it, frame it" is mainstream advice, but the examples drift toward spin. A future agent must not invent reasons such as learning sprints that didn't happen.

---

## 7. Keywords / ATS (`lib/evaluation/keywords.ts`, `score.ts:150-219`, `locate.ts`)

### Keyword coverage
**Evidence: convention** (mirror the job ad's language for ATS and human matching). The floors and caps are **invented**.
- Coverage = the job's keywords found in the CV text ÷ total, using case-insensitive normalised substring match (`:57-63`, `:231-241`).
- When ATS-parsed text is available it is used in preference to raw text. Rationale: "that's the real signal" (`:195-197`). Without a parse, a warning notes that words visible to a human "may be … lost to a parser" (`:253-256`).
- **Warning floor:**
  - Editor evaluation: below 50% coverage (`:209`).
  - Tailored-draft flow: below 45% (`:101`).
  - The first 6–8 missing keywords are listed.
- **Score is capped at 95** because "keyword overlap alone shouldn't be a perfect score" (`:259-261`).
- **No job attached → neutral 70** (`:217-228`).
- Missing keywords are pointed at the nearest text block that contains them (`locate.ts:41`).

### Parseability (Affinda)
**Evidence: convention** that ATS parsers must find contact details and work history. The field weights are **invented**.

Field weights (`score.ts:172-181`):

| Field | Weight |
|---|---|
| workExperience | 25 |
| name | 12 |
| email | 12 |
| education | 10 |
| skills | 10 |
| phone | 8 |
| summary | 8 |
| location | 6 |

- Bonus of +3 for each extra work entry beyond the first, up to +9. Score = obtained ÷ 100.
- **Red flag:** more than 10 text blocks but zero parsed work history → error: "likely an image-based or structurally-broken layout" (`:207-210`).
- Parser unavailable → neutral 60. The aim is to neither pretend the CV parses nor tank a score the user can't act on (`:161-162`).
- A coverage heatmap (`locate.ts:70-119`) marks text blocks that look like an email, phone number or name but weren't extracted. This is a useful visual: it shows which lines the parser lost.
- Reading order is modelled as top-to-bottom, then left-to-right, in 4 mm rows. This "matches how an ATS tends to flow-extract" and is admitted to be imperfect for multi-column layouts (`extractText.ts:3-6`). **Convention:** single-column layouts parse more reliably.

### Tailored-draft guardrails (`keywords.ts:99-190`, used by `/api/jobs/draft`)
**Evidence: invented** numbers. The intent is sound.
- **Hallucination guard:** every company in the draft must appear in the base CV, and every role title should match verbatim. Otherwise warn "drafter may have invented it."
- **Bullet length cap: 160 characters.**
- **Summary over 420 characters** → "aim for a tight 2–3 sentences".
- Draft score = 0.6 × keyword coverage + 0.3 × truthfulness (share of entries not invented) + 0.1 × bullet discipline (share of bullets under the cap).

---

## 8. Boilerplate phrases ("archetypes") (`lib/evaluation/archetypes.ts`, `archetypeDetector.ts`)

> Naming note: in this codebase "archetype" means **boilerplate-phrase category**, not CV personas or career archetypes. The code has no CV-type archetypes.

**Evidence: convention.** Anti-cliché lists are standard CV advice. The scoring is **invented**.

About 40 phrases in 5 categories. Matching is case-insensitive with word boundaries. Exceptions are built in so that "dynamic programming", "Java guru" and "cross-functional team" don't trigger.

| Category | Phrases → replacement tactic |
|---|---|
| **Vague achievement** | results-driven/oriented → show the result. track record → "two dated outcomes beat one track-record claim". proven/demonstrated ability → prove with an example. strong/solid background → name systems or companies. extensive/significant/vast experience → years + domain ("6 years in fintech payments"). wide/broad range of → list the 2–3 that matter. **responsible for → a verb + outcome ("Owned X", "Shipped X")**. helped to / assisted in / contributed to → say exactly what you did, or cut it. end-to-end → name the ends ("from design spec to prod rollout"). spearheaded → "Led" plus the outcome. |
| **Filler adjective** | passionate → delete ("inferred from what you built"). dedicated → delete unless followed by an object. hard-working, motivated, enthusiastic → delete ("Motivation isn't evidence"). detail-oriented/meticulous → cite a caught bug or a spec you wrote. innovative/cutting-edge → say what was new. dynamic → describe the motion. world-class/best-in-class → give a verifiable comparison. |
| **Corporate cliché** | synergy → "Integrated X with Y". leverage → "used" or "built on". value-add → name it in nouns (revenue, users). move the needle → which needle, by how much. think outside the box → show it by example. go-getter/self-starter → what you started unasked. low-hanging fruit → name the fruit. game-changer → describe the change. best practices → name two. rockstar/ninja/guru → drop the label. |
| **Generic collaboration** | team player → pairing, review culture, mentorship count. excellent communication → link docs, talks, resolved threads. cross-functional → name the functions and the shipped artifact. stakeholders → name them ("two enterprise customers"). interpersonal/people skills → mentoring, hiring, reviews. collaborative environment → RFC culture, pairing, critique. |
| **Pace cliché** | fast-paced → a concrete cadence ("weekly releases"). hit the ground running → what you shipped in your first 30 days. thrive under pressure → a specific incident or deadline. wear many hats → the two biggest hats. dynamic/ever-changing environment → team size or reorg cadence. ground floor / zero to one → how early (employee #, pre-PMF, pre-seed). |

Scoring: 100 − 5 per *distinct* phrase. Repeating the same cliché doesn't compound the penalty (`archetypeDetector.ts:13-17`, `:47-51`). Matches are info-level unless one text block collects more than 3, which escalates to a warning (`score.ts:351-367`). Not part of the composite because it "mostly overlaps recruiter-eye" (`score.ts:37-38`).

---

## 9. Scoring model (`lib/evaluation/score.ts:23-145`)

**Evidence: invented** throughout. The weights carry rationale comments but no data.

| Layer | With six-second | Without six-second |
|---|---|---|
| Parseability | 30% | 35% |
| Keywords | 25% | 30% |
| Recruiter-eye | 15% | 20% |
| Six-second scannability | 15% | — |
| Numbers | 7.5% | 7.5% |
| Proof | 7.5% | 7.5% |
| Archetype, Tenure | 0% | 0% |

Rationale given: "machine-readability is still the floor", "job match is the biggest qualifier", recruiter-eye is "subjective but signal-rich" (`:31-33`).

- **Recruiter → number** (`:135-145`): Low = 35, Mid = 65, High = 85, then −3 per flagged issue (max −15). Unavailable = 60.
- **Neutral defaults when a layer can't run:**
  - Parse 60
  - Recruiter 60
  - Six-second 60
  - Keywords with no job 70
  - Numbers/proof with no bullets 100

  These defaults distort the score heavily. A CV evaluated with no API keys and no job lands around 70 regardless of quality.
- Oddity: the six-second test is gated on `AFFINDA_API_KEY` even though it only needs the PDF and an LLM (`evaluate.ts:104-116`).
- **Severity ladder for warnings:**
  - **error**: name or role not readable at a glance, over-claiming, zero parsed work history.
  - **warn**: most other issues.
  - **info**: missing keywords, gaps, single boilerplate hits.

---

## 10. Rewriting / paraphrasing rules

### Auto-refine loop (`lib/evaluation/refine.ts`)
**Evidence: convention** for the guardrails. The target and iteration count are **invented**.
- Loop: evaluate → if overall < **80** (target; the API allows 50–100) and iterations < **3** (max 5), ask the LLM for patches → re-evaluate → keep the **best-scoring** version, not the last (`:29-30`, `:143`).
- The model may only rewrite existing text by id. It cannot move, add or delete anything, because "The editor is the user's thing" (`:22-26`).
- System prompt rules (`:219-228`), paraphrased:
  - **Never invent companies, roles, dates, metrics or accomplishments.**
  - Prefer rewording over expansion. Keep the spirit of the original.
  - For parse warnings: put contact details as clean, standalone or clearly labelled text.
  - For missing keywords: "only surface a keyword if the user actually has the experience."
  - For buzzwords and over-claiming: compress and make concrete, "citing what's already in the text."
  - "Fewer high-impact edits beat many marginal ones." At most 8 edits, highest-severity warnings first.
- Stops early if the model proposes no edits.

Risk: the loop optimises toward the invented composite, so it can learn to stuff keywords and scope words.

### Paraphrase (`app/api/paraphrase/route.ts:59-60`)
A one-line prompt: "Paraphrase the input preserving meaning and tone, adapting slightly to the context". Plain text only, no preamble. Input is capped at 6,000 characters, context at 2,000. It's a generic helper with no CV-specific rules. **Evidence: n/a.**

### Application review diagnostic (`app/api/review/summarize/route.ts:64-72`)
Not CV writing, but useful outcome-analysis rules. **Evidence: convention.**
- Input: 90 days of funnel data (applied → screen → interview → offer, plus rejected, withdrawn, ghosted), per-CV-variant response and interview rates, the stage where losses concentrate, 13-week trend, time to response, and recurring rejection lessons.
- Output rules:
  - 3–5 sentences, no lists, second person.
  - Specific to the numbers; no generic advice like "keep applying!" or "network more".
  - Name the stage that concentrates losses, the best-performing variant, and any week-over-week collapse.
  - End with **one** concrete adjustment, "not a menu".
  - No filler ("overall", "in summary", "it seems").
- No applications → "the patterns only appear with signal" (`:47-51`).

---

## 11. Common mistakes (consolidated checklist)

1. Name or current role not instantly findable (six-second, error).
2. Image-based or multi-column layout that loses work history or contact details in parsing (parse, error).
3. Over-claiming relative to tenure or seniority (recruiter, error).
4. Outcome verbs with no number, baseline or scale.
5. "Responsible for…" duty lists instead of owned outcomes.
6. Filler adjectives and clichés (passionate, results-driven, team player, fast-paced).
7. Low keyword overlap with the target posting (below roughly 50%).
8. Inconsistent tense; vague headers; walls of text.
9. Bullets over ~160 characters; summary over ~420 characters (more than 2–3 sentences).
10. Unexplained short-stint patterns or gaps over 3 months. Own them in one concrete line.
11. When tailoring: inventing employers, titles, metrics, or keywords you can't back up.

---

## 12. Reusable for the new app

**Strongest, worth rebuilding**
- **No-fabrication guardrails**: refine prompt rules, company/role hallucination check against the base CV, "only add a keyword if the experience is real". Cheap, high-value, and directly protect the user.
- **Six-second test on the rendered PDF**, cross-checked against parser output for name and role. It tests layout, which a text-only review can't. The quote-the-phrase and don't-guess rules reduce flattering hallucinations.
- **Parser-coverage heatmap**: shows exactly which lines an ATS dropped. Concrete and actionable.
- **Boilerplate list with a replacement tactic for each phrase.** The suggestions are good advice on their own and work fully offline. Keep them as editor hints, not as a score.
- **Recruiter-eye output shape**: one strongest signal, one biggest weakness, one concrete fix, at most 6 issues, "do not pad". A good structured-critique template.
- **Keep-best-iteration refine** that only edits text, plus the review diagnostic's "one adjustment, not a menu" rule.

**Weak, don't carry over as-is**
- **The composite score and all its weights**: invented, uncalibrated, and heavily distorted by neutral defaults (60/70/100). If a single number is shown, label it heuristic, or drop it in favour of per-layer pass/fail findings.
- **Proof-URL on every bullet**: not standard practice; penalises normal CVs.
- **Number inspector's scope-word escape hatch**: "users" or "latency" counts as a metric. Tighten it to require digits, or have an LLM judge whether a measurable claim is present.
- **Tenure thresholds** (12/18/3 months, −25/−20/−8) and the year-only=January date parsing. Keep them as soft prompts only. Strip spin from the reframing prompt and require facts the user supplied.
- **Substring keyword matching**: no synonyms or stemming ("JS" vs "JavaScript"), and no weighting of required vs nice-to-have.
- **Inconsistent attention budgets** (15s vs 6s), and the six-second layer gated on the wrong API key.
- **Any claim framed as research-backed**: nothing in this code cites a source. If the new app makes "recruiters do X" claims, source them properly (see `docs/research/`).
