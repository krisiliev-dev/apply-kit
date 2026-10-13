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

## After applying

**Application**:
A Job the user has applied to, with a Status: created when a Package is marked submitted, when the user presses "I applied" on a Job, or when the user adds one by hand (for applications made outside apply-kit). At most one open Application per Job.
_Avoid_: Package (once submitted), submission

**Status**:
Where an application stands: applied, screening, interviewing, offer, accepted, rejected or withdrawn. Rejected and withdrawn are closed; declining an offer is withdrawn. A Status changes only through an Event, caused by the user or by a matched email.
_Avoid_: Stage, progress (for a single application)

**Event**:
Something that happened to an application, such as a matched email, a status change, a follow-up marked sent, an interview or a note. Every Event names its cause: by email, by you, or by apply-kit.
_Avoid_: Activity, update

**Matched email**:
An email from the job mailbox tied to one application, with its kind (confirmation, rejection, interview invitation, offer, request for information or other) and the signals it matched on. A low-confidence match never changes anything until the user picks the application.
_Avoid_: Linked email, parsed email

**Reply**:
An email from the employer that is a human response to an application: a rejection, an invitation, a request for information or an offer. An automatic confirmation is not a reply.
_Avoid_: Response (unqualified), answer

**Response rate**:
Replies divided by applications at least 14 days old. Rejections count as replies.
_Avoid_: Success rate, conversion

**Follow-up**:
A due action on an application that the user carries out themselves: a nudge after applying, a thank-you note after an interview, a check-in after interviews go quiet, a note to self after an offer, or a withdrawal note. Usually comes with a draft; done when the user marks it sent (or done).
_Avoid_: Reminder (unqualified), chaser

**Mark sent**:
The user telling apply-kit that they sent a drafted message from their own mail. apply-kit never sends mail itself.
_Avoid_: Send, auto-send

**Interview**:
A scheduled conversation with an employer for one application, with its time, format, people and round. Its start time anchors the thank-you note, due within 24 hours.
_Avoid_: Meeting, call (when meaning a recorded interview)

**Prep sheet**:
A light, per-application page for an interview: company facts with their source, and likely questions mapped to the posting's requirements and to true stories from the master profile. Never writes a story the user doesn't have.
_Avoid_: Interview coaching, interview guide

**Needs you**:
The short queue at the top of Applications of things only the user can do now: a follow-up or thank-you due, an email to match, an upcoming interview, an offer to answer, a withdrawal to send.
_Avoid_: Inbox, notifications, to-do

**Stats**:
The user's overall numbers across applications: applications per week, response rate, interviews, and what is working by angle, source and CV version.
_Avoid_: Progress, analytics, insights
