# Career review differential review

## Executive assessment

Baseline: a35bcab. Scope: career timeline grouping, explicit role reconciliation, retained versions, source aliases, keep-separate decisions, API and UI integration. Personal profile data was neither used in tests nor included in artifacts. This is a targeted review, not an exhaustive audit.

State mutations and their new API boundary received detailed review. Presentation changes received accessibility, React lifecycle and responsive-layout checks. No authentication or portal behavior changed. Remaining semantic risk is handled by explicit comparison and conflict selection: suggestions cannot establish that two roles are the same.

## Changes and invariants

- A local deterministic grouping step suggests overlapping employer periods and renders work and education lanes. It never mutates profile rows or invokes AI.
- Explicit reconciliation validates distinct active period IDs, fingerprint, classification, nonempty titles/employers, month formats and date ordering. Source disputes must be resolved first.
- Reconciliation runs inside an immediate transaction. A new unconfirmed period keeps all descriptions, classifications and attached facts. Source mapping retains original rows and prior citations. Identical compatible unflagged facts can consolidate, preserving all sources. Multiple confirmed copies remain separate.
- Existing confirmation rules remain in force. The UI reuses the prior review card and bulk-confirmation API rather than introducing another confirmation path.
- Undo uses the existing snapshot/fingerprint mechanism. It restores parent/discard fields and source links, and removes the new canonical row. Later edits, imports, separation decisions or newer analyses cannot be overwritten.
- API mutations require JSON and typed selection metadata behind the existing localhost/CORS protections. No new paid or external call was added.

## Baseline and blast radius

Read profile save/confirm/discard semantics and original source tracking before changes. Git blame traces draft decisions to 16b38510, confirmation checks to 1e1a127a and revision/restore behavior to 23abe1d0. These checks remain intact. The prior profile/source and undo paths have roughly 20 direct references in preparation and app code; the new timeline/reconciliation surface has 24 references including callers. Review concentrated on imports, preserved sources, existing consolidation and setup/Profile counts.

## Verified findings, fixed

Independent adversarial review used fictional in-memory fixtures and identified three defects:

1. Orphaned active facts disappeared from the timeline after their parent was discarded. They now appear in the unattached review section.
2. Later imports recreated a reconciled employer alias or reopened a resolved conflict. Exact known source versions now resolve to the canonical piece before generic disagreement and duplicate matching; new facts attach to that canonical role.
3. Keep-separate choices were ignored by AI consolidation and could disappear after another reconciliation created a new canonical ID. Timeline suggestions and AI proposals now consult saved pair choices through original-source identities. The original pair rows stay unchanged, so undo does not lose them.

Each finding received a failing regression before its fix. The reviewer spot-checked fixes and exact-fact consolidation and reported no additional concrete defects. No private data, live services or paid AI were used by the reviewer.

## Verification and limits

Full suite: 107 files, 1,425 tests passed. TypeScript build and ESLint passed. Vite production build passed with the existing large-bundle advisory. Focused tests cover grouping, persistent separations, explicit resolution, original versions, sources, exact facts, undo, stale inputs, invalid dates, post-merge imports and API request guards.

Browser checks use fictional profiles only. Heuristics deliberately over-group some promotions or study stages; users can exclude versions and save keep-separate choices. Semantic duplicate detection for differently worded facts remains in the existing AI panel. Verified Bulgarian titles remain in source versions and require verification for the combined title. Undo is bounded rather than overwriting subsequent work.

Final browser verification on a fictional profile: Desktop comparison left conflicting title/employer/end fields unselected; selection and custom employer entry worked; keep-separate, reset, combine, preserved-original inspection and undo completed through the UI. Setup review rendered the timeline at 375px with no horizontal page overflow. The comparison table owns its horizontal scrolling. Screenshots were visually inspected. One QA locator timed out after fixture restart because a different source version headed the group; the refreshed snapshot supplied the visible locator, and the full flow then passed.

The local database was backed up before service restart. The updated live timeline API answered successfully and aggregate accounting included all 150 active pieces. Only aggregate counts were emitted; no personal source contents were inspected or copied into artifacts. No real-profile merge or other review decision was applied.
