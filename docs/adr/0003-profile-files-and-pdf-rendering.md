# Profile, voice samples and generated PDFs live in the app's data folder; PDFs come from one HTML template printed by headless Chrome

Answers PRODUCT.md's open question on how the master profile and voice samples are stored, and settles how package PDFs are made. Everything personal stays in the Application Support folder from ADR 0001, outside the repo, so it can't be committed, found by code searches or deleted by `git clean`.

- **Structured data in SQLite.** Profile pieces (with their source quote and where the number comes from), angles, the answer bank (per-language text and the phrasings it matches), voice rules, packages, their drafts, flags and decisions are rows in the same database as Discover. One place, one backup, transactions across a package and the pieces it uses, and plain SQL queries for requirement → evidence matching. Profile has a one-click JSON export for portability.
- **Files the user brings** (old CVs, the LinkedIn export, voice samples, the optional photo) are copied into a `files/` folder next to the database, named by their SHA-256 hash, with the original name, type and import time in the database. Their extracted text is stored in the database. Removing a file in Profile deletes the copy, its text and any voice excerpts from it; confirmed pieces drafted from it stay, with their quote.
- **Voice samples** stay whole on the laptop. Each draft sends only the learned voice rules and a few short excerpts (about 150 words in all) through the pinned non-China hosts, and every model call records which excerpts it sent, so the Package can show them.
- **Generated PDFs** are files in `packages/<package id>/`. A draft render replaces the previous draft file. Approving a package freezes its files: the package records each file's path, SHA-256 and size, and the extension uploads exactly those bytes. An approved file is never re-rendered; reopening a step makes a new draft that needs approval again. On approval the frozen files are also copied, under their ASCII file names, to a user-visible Packages folder (a setting, by default inside the user's Documents), so Kris can attach them by hand or find them from the extension's "Show in Finder"; the copy in the data folder stays the source of truth.
- **Rendering:** one fixed HTML template per document (CV, cover letter), filled from structured content (the model never writes markup), styled with the `--doc-*` tokens, and printed by headless Chromium through Playwright (`page.pdf`, A4, CSS page size). Fonts (Geologica, Onest, both OFL with Cyrillic) are bundled as local files and embedded, never fetched at render time; ligatures are off; the PDF is tagged, with its language and a title. Page count and overflow are read from the PDF itself.
- **Preview and ATS check read the same file.** The UI shows the PDF with pdf.js (canvas plus its text layer); the service extracts the text with pdf.js for the parse check. No third-party parsing service sees a CV; an external ATS parser is used only once, by hand, to validate the template in English and Bulgarian.

## Considered options

- **Profile as Markdown or JSON files the user can edit by hand:** rejected. Two sources of truth with the database, and evidence matching needs queries; the JSON export covers portability.
- **PDFs as BLOBs in SQLite:** rejected. Every nightly backup would carry them, and plain files can be opened in Preview and streamed to the extension as they are.
- **A PDF library (pdfkit, react-pdf) instead of Chromium:** rejected. Its layout and Cyrillic shaping would differ from the HTML template the design is reviewed in, and Chromium is already the tool the build validates text order with.
- **A hosted ATS parser for every package:** rejected. It sends the CV to a third party and costs money per check; local extraction shows what matters (lost fields, reading order, dates).

## Consequences

The service depends on Playwright and a downloaded Chromium (about 150 MB, installed once). Backups must copy `files/` and `packages/` with the database. Tests render through a fake document renderer at the engine seam; one smoke test renders the real template and extracts its text.
