# Profile consolidation review

Scope: uncommitted changes from 5b930e4 adding cross-import AI duplicate proposals, local preview/apply/undo persistence, source aggregation and Profile/setup controls. Targeted differential review, not an exhaustive audit. All test data is fictional.

## Invariants and boundaries

The model supplies existing IDs and explanations only. The core rejects unknown and overlapping IDs, incompatible kinds, numeric differences (including precision and hedge direction), disputes, scanned-text flags, incompatible classifications, conflicting Bulgarian equivalents and multiple confirmed decisions. Employment guards distinguish periods, employers, seniority and known locations. Date precision cannot be lost. Unique role descriptions stay separate. Facts spanning roles require the corresponding eligible role merge.

Preview cannot mutate profile pieces. Apply uses an immediate SQLite transaction, preserves the displayed keeper and original rows, reparents children, and aggregates all source citations. No confirmation is performed. Undo restores the original parent/discard fields and source mappings only when the profile fingerprint still matches and no newer analysis exists. JSON mutation guards retain the existing localhost/CORS boundary. AI calls retain configured provider routing and the shared monthly budget; quotes and contact fields are excluded from the reconciliation prompt.

## Adversarial review findings and fixes

An independent adversarial reviewer reproduced three defects using in-memory fixtures:

- Future imports matched hidden merged roles and silently skipped new role-linked achievements. The shared profile lookup now excludes consolidation originals while retaining ordinary discarded pieces for existing import semantics. An import-after-merge regression verifies the achievement survives under the canonical role.
- Quantity comparison rounded values and omitted hedge direction. It now compares exact parsed values and directions; regressions cover opposing bounds and nearby percentages.
- Keeper selection could prefer a year-only date and missing city. It now prefers richer entries and blocks any remaining loss of date precision or conflicting location.

All three received failing tests before fixes. Source-link flattening, fingerprint checks and transactional undo had no further verified findings in this focused review.

## Verification

- Full Vitest suite: 106 files, 1,415 tests passed.
- TypeScript build and ESLint passed; git diff whitespace check passed.
- Vite production build passed (existing large-chunk advisory remains).
- Real browser on a fictional in-memory profile: preview, selected merge and undo passed; 375px viewport had no horizontal overflow.
- Local database backed up before live service restart. Real profile processing uses the normal API; personal content is excluded from this report and test artifacts.

Limits: semantic equivalence still requires user review. The model can miss duplicates or suggest an incorrect match, so merges require selection and retain sources. Undo deliberately refuses to overwrite edits/imports or a newer analysis. Timeline-heavy uncertain matches remain separate. No external portal behavior changed.
