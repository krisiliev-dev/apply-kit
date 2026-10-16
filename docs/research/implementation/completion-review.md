# Completion review — 16 October 2026

Scope: changes from `5f789e9` through the completed Apply / reviewed Track integration. Review concentrated on extension page mutations, session identity, package selection, account handling, verification links, local API boundaries and shared AI spending. This is a targeted differential review, not an exhaustive security audit.

## Findings fixed

- A portal button disguised as an option could have submitted a form. The shared action guard now rejects implicit and explicit submit buttons before allowing option controls. Regression tests cover both forms.
- Consent expressed as a Yes/No or select question could have passed a checkbox-only guard. Consent checks now cover all field kinds and the enclosing question/group. Regression tests cover these controls.
- Navigation while a fill awaited data could have delivered an old package to a different page. Commands now bind to the captured address and Chrome document ID; mutation guards also stop a same-document URL change. Engine answers reject a different job reference. Regression tests cover page and job changes.
- Track used separate preflight checks for AI tasks. Track now uses the same reservation budget as extraction and preparation, including billed failures. Voice context is recorded only when an accepted call actually starts.
- Generic submission undo bypassed Prepare’s submission state and later-event guards. It now goes through the submission-specific undo operation.

History and callers: `git blame` on the shared action guard identified its original click-only boundary (`cdb97fa9`) and the widening needed for portal widgets. The shared guard has 27 references across portal action paths and tests, so mutations were checked across the six portal adapters rather than only Workday. The reviewed Track merge preserves Prepare’s submission guard.

- Evaluation spending before the first service start was only held in memory. Evaluations now refuse to run without the persistent service ledger; regression tests cover a missing database and missing spending table.

- Live extraction returned language names instead of ISO codes, which could choose English for a Bulgarian posting. The model contract now states the code explicitly; new outputs and cached readings normalise the two supported package languages. Regression tests cover model output and cached job views.
- Rejected structured responses could lose billed usage in extraction and Track. The provider boundary now preserves that usage for every structured AI call; regression tests cover classification, drafting and interview preparation.

- A reproduced extraction failure ended at 4,000 output tokens, including 2,400 reasoning tokens, with incomplete JSON. Extraction now disables reasoning explicitly; the same posting returned complete JSON with zero reasoning tokens. A full accuracy comparison was temporarily blocked by upstream rate limits.
- Provider routing disabled all failover, so one host’s upstream rate limit failed requests despite a wider approved allow-list. Failover now remains inside that allow-list, with deny-data-collection, parameter support, excluded providers and the price ceiling retained. Request-shape regression tests cover extraction, writing and Track. OpenRouter documents the independent `only` restriction and fallback control in its [provider routing documentation](https://openrouter.ai/docs/guides/routing/provider-selection).

## Verification

The integrated suite passed 1,399 tests across 104 files; TypeScript and ESLint passed. UI and extension production builds were also checked. Chrome checks with the production filler covered basic field fill and undo on all six recorded portals, plus native file attachment/undo on Greenhouse and password-value exclusion on a synthetic account form. The app’s real PDF preview, application status/undo, light/dark appearance and 375/768/1280px layouts were checked with fictional data. These are smoke checks, not full live portal trials. Fixtures use fictional people and recorded forms. Tests cover password-value exclusion, denied navigation/consent actions, undo, cross-job and tenant matching, recent same-portal verification links, file fallbacks, unknown-form copy mode, and verified Bulgarian role/skill equivalents.

## Limits and first use

Portal fixtures cannot establish compatibility with every employer’s current custom form. Real accounts, consent, submission, sending email and the five-application timing trial remain manual. Issue #50 stays open for that evidence. Verification email sender matching is a relevance filter, not an authentication guarantee; links are displayed for the user to review and open, never followed automatically. No personal documents, mailbox contents or credential values were inspected for this review.
