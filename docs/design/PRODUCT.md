# apply-kit: Product frame

Design step 1 (Frame). Decided with the user on 2026-10-11 through a grilling session. Input: [friction-map.md](friction-map.md) rankings.

## Purpose

Do every step of the job-application process that is time-consuming or creates friction, so applying to many jobs takes minutes each without lowering quality.

## User

One person: the owner (Kris). Personal tool, never released publicly. No accounts, no hosting for others; personal data stays local or with providers that don't train on it.

**Search profile**
- **Fields:** anything in computer science; most comfortable with full-stack development, cybersecurity and design.
- **Locations, in priority:** Sofia (on-site/hybrid) **and** remote within European time zones (±2h of Sofia), equally first; relocation to Switzerland or Spain as a separate, lower-priority list. Everything else hidden with a visible reason.
- **Languages:** English CVs by default; Bulgarian supported.

## Jobs to be done (build order)

0. **Discover.** "When new jobs appear anywhere I'd want to work, I want them gathered, de-duplicated and screened in one view, so I stop searching 10 sites and never miss a good fit."
   - Sources: official ATS feeds (Greenhouse, Lever, Ashby, Recruitee, Personio, Teamtailor, SmartRecruiters, Workday), Microsoft/Amazon public JSON, aggregators and Bulgarian boards (dev.bg, Jooble…), and **email job alerts** for sites that forbid scraping (Google, Apple, Meta, LinkedIn, jobs.bg). See [model and career-site research](../research/2026-10-models-and-career-sites.md).
   - A **company watchlist** the user edits, pre-filled with Sofia employers: international companies, local firms and startups.
   - Dealbreakers pulled out of every posting (certificates, years, languages, visa, salary, location/remote) with a quick fit check.
   - Also accepts a single pasted link or captured page.
1. **Prepare.** "When I find a job I want, I want a tailored application package in minutes, so I can apply to many jobs without lowering quality."
   - CV tailored from **one master profile** via the closest of **three angles** (developer, security, design); cover letter in the user's voice; screening-question answers; ATS parse check.
2. **Apply.** "When a company sends me to their portal, I want the forms already filled, so I never retype my CV or the same standard answers."
   - Browser extension fills everything it can (work history, education, standard and screening questions, the right CV file, help with account creation). **The user reviews and presses Submit.**
3. **Track.** "When I have many applications open, I want to see where each stands and what I've achieved, so I stay organised and motivated."
   - Automatic status tracking, confirmation/rejection emails matched to applications, follow-up reminders, visible progress (applications/week, response rate, what's working).

## Success measures

- **Time per application:** found → submitted in **under 10 minutes**, portal included.
- **Zero retyping:** work history or a standard answer is never typed into a portal twice.
- **Nothing lost:** every application tracked automatically, no spreadsheet.
- **Quality held:** every CV sent is tailored and passes the ATS check; nothing crosses the honesty line.
- Response rate is shown, not targeted (the market drives it too).

## Principles and rules

- **Nothing disappears silently.** Every collected job is kept; filters only sort and hide, each hidden job shows why, and the hidden pile is one click away. A **source health panel** shows each source's last check, count and errors, and warns loudly on failure, zero results or a sharp drop. Periodic **coverage checks** compare against a manual search.
- **Honesty line:** anything that survives an interview question and a reference check. Allowed: stronger verbs, confident framing of real contributions, emphasis, favourable but plausible rounding, side projects as experience. Never: invented employers, titles, dates, degrees, certificates, skills the user couldn't discuss for 5 minutes, baseless numbers. Near-the-line edits are flagged for approval; gaps are flagged, never covered up.
- **The user's voice:** CVs and cover letters are generated, written to sound like the user. Voice is learned from the user's past cover letters (local only, never committed) and from every edit made to drafts.
- **The user presses Submit**, sends every message, and writes DMs; the app never acts in the user's name.
- **Lean:** the fewest screens that serve the four jobs.

## Constraints

- **AI:** DeepSeek V4.1 Flash for every task by default, via **OpenRouter pinned to non-China hosts**, so personal data is never stored in China or used for training. Model is a setting; a hard monthly spending cap. Expected cost: a few dollars to ~$10/month.
- **Email:** an iCloud rule forwards everything sent to the job address (kris@krisiliev.dev) to a **dedicated mailbox only the app reads** (read-only). Personal iCloud mail is never accessed.
- **Legal/ToS:** official APIs and feeds, polite polling where robots.txt allows, email alerts where scraping is forbidden. No automation of LinkedIn sessions or bot-protected sites.
- **Privacy:** real CVs, profile and voice samples stay out of git.
- **Platform:** laptop browser plus an extension. No mobile app.

## Non-goals (first version)

- Other users, accounts or public release.
- Automatic submitting; automated LinkedIn or bot-protected sites.
- LinkedIn DMs or outreach messages written for the user (judged low value: generic recruiter messages tend to annoy).
- Referral finding (done personally with ex-colleagues).
- Mobile app.
- Offer comparison and negotiation.
- Full interview coaching: only a light prep sheet per job.

## Riskiest assumptions (test early)

1. **Coverage:** official feeds + watchlist + email alerts together catch nearly every relevant Sofia/remote job. Test: coverage checks against manual searches in the first weeks.
2. **Extraction accuracy:** a cheap model reliably pulls dealbreakers (years, certificates, language, location) from messy postings, including Bulgarian ones. Test: a hand-labelled sample of ~50 postings.
3. **Tailoring quality:** DeepSeek V4.1 Flash writes CVs and letters that sound like the user and respect the honesty line. Test: blind comparison against the user's own writing and one stronger model.
4. **Portal filling:** the extension can fill the main ATS portals (Workday, Greenhouse, Lever, SmartRecruiters, Workable) well enough to beat 10 minutes. Test: 5 real portals early.
5. **Email matching:** forwarded emails can be matched to the right application automatically. Test: the user's real inbox history.

## Decisions from the wireframe review (2026-10-11)

- **Background work** runs on the laptop first: every 30 minutes, 07:00–23:00, while it's awake, catching up on wake. Move to a small always-on server only if jobs arrive late.
- **Statuses** gain **Accepted**. Accepting an offer offers to withdraw the other open applications, each with a polite draft the user sends. Declining an offer counts as Withdrawn.
- **Thank-you notes** are due within 24 hours of the interview time.
- **Response rate** counts rejections as replies and excludes applications under 14 days old.
- **Follow-ups** are sent by the user from their own mail; the app learns it via "Mark sent" (optional tip: BCC the job mailbox). iCloud forwards only incoming mail.
- **Voice**: short excerpts of past letters are sent with each draft (via the pinned non-China hosts); full samples stay on the laptop.
- **Bulgarian postings** are read directly and shown in English with the original quotes, and the **whole application (CV, cover letter, screening answers) is generated in Bulgarian** by default, switchable per package.
- **CV design**: a fixed, ATS-tested template designed in step 5; the AI fills content only. Single column, one restrained accent, one page. Photo off by default, switchable per package and suggested for local Bulgarian employers. Package shows the exact PDF before approval.
- **Extension capture**: click-only capture of a single job page or of a whole search-results page the user is viewing (LinkedIn included; the user accepts the small account risk). The extension never scrolls, pages or opens listings by itself. Email alerts stay a parallel route.

## Open questions for later steps

- Exactly how the voice samples and master profile are stored locally.
