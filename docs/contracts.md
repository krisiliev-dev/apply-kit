# What Prepare hands to Apply and Track

Prepare (spec #51) is the only owner of the master profile, the answer bank, the voice and packages. Apply (#23) and Track (#24) read them through the preparation engine, never its tables. The operations are grouped as two types in `packages/core/src/preparation/engine.ts`, and the data they return is in `packages/core/src/preparation/contracts.ts` (all exported from `@apply-kit/core`). Settled in ticket #67.

## The approved package

- **Approving freezes a version.** "Approve package" (step 5) needs every step approved and the ATS check passing, or its failing checks accepted knowingly. The CV and letter PDFs are frozen by SHA-256 in `packages/<id>/v<version>/` (written once) and copied to the Packages folder (`APPLY_KIT_PACKAGES_DIR`, default `~/Documents/apply-kit Packages`), per ADR 0003. The version's data (`ApprovedPackage`) is stored as JSON and never changes.
- **Editing reopens.** Any edit to an approved part reopens its step and the later ones; the package is a draft again (`packageForApply` answers "not approved yet") until it's approved as the next version. The earlier version and its files stay as they were.
- **Submitted once.** `markPackageSubmitted` marks the version approved now as submitted (with when, how and the portal URL). A second mark returns the first with `alreadyMarked`; `undoPackageSubmitted` takes it back. Once submitted, that version is the package "as sent": later edits make a new version and never change it.

## `PrepareForApply` (fill engine: #38, #39, #41)

| Need | Call |
|---|---|
| Contact details split for forms, roles, education, skills | `profileForApply()` |
| Match the page to a package: by the target posting's `jobRef` (`{ portal, board, jobId }`) | `approvedPackages()` |
| The package for a Job, or "your package isn't approved yet" | `packageForApply({ jobId })` / `({ packageId })` / `({ jobRef })` (the page's portal job reference against any posting of the package's Job; added in #38 for the draft-package state) |
| The CV or letter to attach, exactly as approved (bytes, name, SHA-256, Packages-folder copy for "Show in Finder") | `packageFile(id, "cv" \| "letter")` (Apply's fill engine copies a file approval couldn't copy to the Packages folder on first use, #39) |
| The answer bank: find, add (with job and portal as source), record a use, record a portal edit | `findAnswer`, `saveAnswer`, `recordAnswerUse`, `recordPortalEdit` |
| The answer bank's entries (their kind, to check a close wording suits the field; their questions, to name a near match as "a different question") | `listAnswers()` (added in #40) |
| Draft a needs-you answer (honesty-checked, within the cap and the form's limit) | `draftAnswer(packageId, { question, maxChars?, maxWords?, language? })` |
| Mark as submitted / Undo | `markPackageSubmitted(id, { via, portalUrl })`, `undoPackageSubmitted(id)`: called by the fill engine's `markSubmitted` / `undoMarkSubmitted` (#41) right after Track's `recordSubmission` / `undoSubmission` (Track #35 may move the call into record submission) |

## `PrepareForTrack` (#35)

| Need | Call |
|---|---|
| The Package as sent (CV label for What's working, language, answers, letter text, frozen files) | `packageSnapshot(id)`, `packageFile(id, which, version)` |
| A confirmation email for an approved package with no Application (story 82) | `approvedWithoutApplication()` |
| Record submission sets the package's state | `markPackageSubmitted`, `undoPackageSubmitted` |
| An interview story into Profile, unconfirmed, with its source | `addUnconfirmedPiece({ text, source })` (shaped like Track's `MasterProfile.addUnconfirmedPiece`) |
| Master profile pieces a follow-up draft may draw on, with where each sits | `profileEvidence({ requirements, language })` (Track's `MasterProfile.evidence`) |
| True stories for the prep sheet (confirmed achievements) | `profileStories()` (Track's `MasterProfile.stories`) |
| Voice for follow-up drafts, and Kris's edits as evidence | `voiceContext({ language, purpose: "follow-up" })` (rules and excerpts sent with each draft), `recordVoiceEdit(edit)` (once per follow-up, when what Kris marked sent differs from the draft) |

The tracker's `profile` and `voice` ports are made from the preparation engine with `trackPortsFrom(preparation)` (`packages/core/src/track-prepare.ts`); the service wires them in `app/src/main.ts`.

## What Apply hands to Track (#41)

"Mark as submitted" (the panel on a portal's confirmation page, "I've submitted this" on an unknown form, or the Job page) goes through the fill engine's `markSubmitted({ sessionId } | { packageId }, { portalUrl, via })`, which calls the tracker's **record submission**, `recordSubmission({ jobId, job, angle, packageId, portal, portalUrl, submittedAt, via })`. #41 added it in its minimal form: it creates the Application in Applied (`createdHow: "submission"`, its `submission` kept: package, portal, portal URL, when, how), once per package (asked again, it returns the first, `alreadyRecorded`), and creates nothing when the Job already has an open Application made another way (`already-open`). `undoSubmission(applicationId)` takes it off the list, refused once the Application has any later Event. Track #35 extended it: the new Application's Event is "Submitted → Applied"; a Job whose open Application was made another way (by hand, "I applied", from an email) gets the package attached to that one (an Event "Package attached", its Status and date applied kept; `undoSubmission` takes the package off it again), and only a Job whose open Application already has another package gets `already-open`. The Application stores the package's CV label as its CV version (What's working) and shows Prepare's `packageSnapshot` as the Package as sent.

A confirmation email about no Application, tied to an approved package from `approvedWithoutApplication()` (by its company, and its job title between several), waits in Needs you as "Mark Applied, dated …?" (`needsYou().packageConfirmations`), never an Application on its own. Answering `answerPackageConfirmation(emailId, "mark-applied")` records the submission dated the email (`via: "email"`), calls `markPackageSubmitted` and files the email on it (undone with `undoPackageConfirmation`); `"not-this"` leaves the email to match by hand.
