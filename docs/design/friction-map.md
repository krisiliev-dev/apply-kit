# Friction map

Raw input for design step 1 (Frame). Goal of apply-kit, in the user's words: **do every step of the job-application process that is time-consuming or creates friction.**

★ = named by the user (2026-10-11). Rank column: fill in 1–5 (5 = hurts most) to decide what gets built first.

| Stage | Friction | Rank |
|---|---|---|
| **Finding** | ★ Dealbreakers buried at the end of postings (required certificate, 5+ years, language, visa) | 1 |
| | Same job on many boards, recruiter sites and the company page: re-reading duplicates | 1 |
| | Ghost / stale / reposted jobs | 2 |
| | Salary hidden or vague, so time is spent before learning it's too low | 2 |
| | Agency posts hiding the employer: can't research it or tell if already applied | 1 |
| | Language/location traps ("Sofia" posts in Bulgarian, "remote" = one country only, sponsorship in the last line) | 1 |
| | Checking ~10 sites daily instead of being alerted to good matches | 1 |
| **Deciding** | Researching each company (what they do, size, reviews, funding, stack, stability) | 1 |
| | Judging fit and spotting gaps before investing time | 2 |
| | Remembering whether you already applied, or were rejected recently | 2 |
| **Preparing** | ★ Tailoring the CV to every job | 5 |
| | Cover letters (sometimes required, each needs tailoring) | 5 |
| | Screening questions that repeat with small variations ("Why us?", "Tell me about a time…") | 4 |
| | Salary-expectation fields without knowing the band | 2 |
| | Version chaos: which CV went to which company | 2 |
| | Proofreading; checking the CV survives the company's ATS parser | 4 |
| **Applying** | ★ Re-typing the whole CV into company job portals | 5 |
| | Creating an account on every ATS (Workday: one login per company) | 4 |
| | The same standard questions every time (right to work, notice period, diversity, "how did you hear") | 5 |
| | File format/size requirements | 1 |
| **Networking** | ★ Finding the recruiter / hiring manager and messaging them on LinkedIn | 3 |
| | Finding any connection at the company (ex-colleagues, alumni) for a referral | 1 |
| | Writing a personal message for each, then following up | 2 |
| **After applying** | Tracking status across email, portals and LinkedIn | 5 |
| | Knowing when to follow up, and writing it | 3 |
| | Inbox flood of confirmations/rejections that must be matched to applications | 4 |
| | Interview scheduling back-and-forth, time zones | 2 |
| **Interviews** | Prep per interview: company research, likely questions, stories matched to the job | 3 |
| | Take-home tasks and technical prep | 3 |
| | Thank-you notes; notes after each round | 1 |
| **Offers** | Comparing offers (salary, benefits, remote, growth) and negotiating | 2 |
| | Politely withdrawing from other processes | 1 |
| **Throughout** | Motivation and rejection fatigue: seeing progress (applications/week, response rate) | 5 |
| | Learning what works: which CV version, source or role type gets responses | 3 |

## Boundaries (shape the design)

1. **LinkedIn**: the app may find the likely recruiter and draft the message; it must not send messages or drive the user's LinkedIn session (ToS, account bans). The user clicks send. See `docs/research/previous-agent/project-discovery-sourcing.md`.
2. **Submitting**: the app may pre-fill portals as completely as possible, but the user presses the final Submit, so a bad AI answer never goes out in their name. How close to one click it gets is a design decision.
3. **Personal data** stays local and out of git.

## Related knowledge

- `docs/knowledge/cv-writing-and-evaluation.md`: tailoring rules, no-fabrication guards, the 6-second scan
- `docs/knowledge/application-tactics.md`: fit check, cover letters, follow-up cadence, interviews, salary
- `docs/knowledge/job-discovery.md`: sources, dealbreaker/fit scoring, email alerts, capture and autofill
