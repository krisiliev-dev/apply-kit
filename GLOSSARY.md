# apply-kit

A personal tool that finds jobs, prepares tailored applications, fills application portals and tracks outcomes for one job seeker.

## Finding jobs

**Source**:
A place postings come from: an ATS feed, a public jobs API, an aggregator, an email alert or a manual capture.
_Avoid_: Feed (when meaning a single source), board, provider

**Check**:
One look at a source for the postings it lists right now, recorded with its time, outcome (worked, error, timeout or rate limited), the count in the user's locations and the total. A failed check never changes the source's postings.
_Avoid_: Sync, crawl, refresh

**Normal volume**:
How many postings a source usually lists per check (median and range), learned from its recent good checks.
_Avoid_: Baseline, average

**Unusual drop**:
A check that lists less than half of a source's normal volume. Its jobs stay open; after two more checks just as low the user is asked to confirm, and only that confirmation closes them.
_Avoid_: Outage, failure (a drop is a check that worked)

**Capped search**:
A source that returns only its top results for a query (Jooble, Reed, EURES, Microsoft, Amazon), so a posting missing from one check never counts as gone.
_Avoid_: Partial source

**Capture**:
Adding the job page, or the listings of a search results page, that the user is viewing in Chrome, with one click in the extension. Captured postings belong to the Source "Captured · <site>"; nothing is captured without a click.
_Avoid_: Scrape, crawl, import

**Unverified**:
A captured or pasted job that nothing has seen for 30 days (no checked Source lists it and it wasn't captured again). It stays in the feed, marked, and is never closed for it.
_Avoid_: Stale, expired

**Company**:
An employer that posts jobs.
_Avoid_: Employer, organisation, client

**Watchlist**:
The companies the user wants checked directly, regardless of which boards they post on.
_Avoid_: Favourites, target list

**Posting**:
One copy of a job as found on one source.
_Avoid_: Listing, ad, job (when meaning a single copy)

**Job**:
A single real opportunity at a company, merged from every posting that describes it.
_Avoid_: Posting, vacancy, role (when meaning the opportunity)

**Feed**:
The unified, de-duplicated list of jobs the user browses.
_Avoid_: Inbox, results, dashboard

**Coverage check**:
A comparison of a search the user ran by hand on a site against what the app has: each job seen there is in the Feed, kept out of the main list (with the reason), or missing (with the likely reason and a fix). Kept as history.
_Avoid_: Audit, sync check

## Judging fit

**Requirement**:
Something a job asks for, such as years of experience, a certificate, a language, a location, visa status or salary.
_Avoid_: Criterion, qualification

**Dealbreaker**:
A requirement the user cannot or will not meet; a job with one is hidden, always with the reason shown.
_Avoid_: Blocker, filter

**Hidden job**:
A job kept out of the main feed because of a dealbreaker or filter, still visible with its reason.
_Avoid_: Filtered out, rejected, removed

**Fit check**:
The quick verdict on a job: closest angle, dealbreakers and gaps.
_Avoid_: Score, match rating

**Fit**:
A 0–100 number for how well a job matches the user's profile and preferences, always shown with the reasons behind it; it orders the feed.
_Avoid_: Score, match %, rating

**Learned adjustment**:
A few Fit points added to or taken from jobs like one the user passed (with "rank lower" ticked), showed from the hidden pile (with "rank higher" ticked) or boosted. Created only when the user opts in, listed with what created it, named in the why-line of every job it moves, and undoable. It never hides a job.
_Avoid_: Penalty, training, learned rule

**Boost**:
A learned adjustment the user asks for directly: new jobs at a company (of one angle) rank higher.
_Avoid_: Favourite, pin

## Preparing

**Master profile**:
The single source of truth for the user's experience, skills and education.
_Avoid_: Base CV, resume, profile (unqualified)

**Profile piece**:
One unit of the master profile (a role, achievement, skill or education entry) with its tags, angle, source and whether the user has confirmed it.
_Avoid_: Bullet, item, entry, fact

**Angle**:
One of the base framings of the master profile (developer, security, design) that tailoring starts from.
_Avoid_: Variant, persona, template

**Package**:
Everything prepared for one job: target posting, CV version, cover letter, screening answers and ATS check result.
_Avoid_: Application (before it is submitted), bundle, kit

**Target posting**:
The posting a package will be submitted through, by default the company's own career page.
_Avoid_: Apply link, destination

**CV version**:
A CV tailored from the master profile for one job.
_Avoid_: Tailored resume, variant

**Cover letter**:
A letter written for one job in the user's voice.

**Answer bank**:
The user's reusable answers to standard and screening questions.
_Avoid_: Q&A store, autofill data

**Voice sample**:
A piece of the user's own writing used to match their voice.

## Applying

**Portal**:
The company's application site where a package is submitted: one of the supported job systems (Workday, Greenhouse, Lever, SmartRecruiters, Workable, Ashby) or a company's own form.
_Avoid_: ATS (when meaning the page), site, careers page

**Fill**:
The extension entering values into the portal page the user is viewing, from the approved package, the master profile and the answer bank, only when the user clicks, one page at a time. It never presses Next or Submit.
_Avoid_: Autofill, auto-apply

**Filler**:
The extension's knowledge of one portal: how to recognise its pages, read their fields and fill them. A generic filler covers forms of unknown portals, by opt-in.
_Avoid_: Adapter (used for sources), bot, script

**Fill session**:
One approved package loaded for one browser tab, from the first fill until the user marks it submitted, the tab closes or the tab moves to a different job.
_Avoid_: Run, autofill session

**Needs-you field**:
A portal field the extension couldn't fill with confidence; it's marked on the page and shown in the panel, with a draft or suggestion and its basis where one exists.
_Avoid_: Unknown field, error

**Mark as submitted**:
The user's confirmation, after pressing the portal's Submit, that turns the package into an Application. A portal's confirmation page only prompts it.
_Avoid_: Log, record (as verbs for this)

**Field report**:
The structure of one portal field the extension couldn't handle (label, kind, attributes, never values), saved locally by the user so a filler can be fixed.
_Avoid_: Bug report, telemetry

## After applying

**Application**:
A package that has been submitted for a job; created when the user marks it as submitted.
_Avoid_: Package (once submitted), submission

**Status**:
Where an application stands: applied, screening, interviewing, offer, accepted, rejected or withdrawn.
_Avoid_: Stage, progress (for a single application)

**Event**:
Something that happened to an application, such as an email, a status change or a note.
_Avoid_: Activity, update

**Follow-up**:
A due reminder to nudge an application after a status change.
_Avoid_: Reminder (unqualified), chaser

**Stats**:
The user's overall numbers across applications, such as applications per week, response rate and what is working.
_Avoid_: Progress, analytics, insights
