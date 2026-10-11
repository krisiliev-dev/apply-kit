# apply-kit: Architecture

Decided with the user on 2026-10-11 through a grilling session. Product context: [PRODUCT.md](design/PRODUCT.md). Hard-to-reverse choices are recorded in [docs/adr/](adr/).

## Shape

```
 Chrome (job portals, LinkedIn, jobs.bg)          Browser tab
 ┌──────────────────────────┐                    ┌───────────────────┐
 │ apply-kit extension (WXT)│                    │ apply-kit UI      │
 │ fill portal · capture    │                    │ React + Vite      │
 └────────────┬─────────────┘                    └─────────┬─────────┘
              │ localhost only, paired once                │ localhost
              ▼                                            ▼
 ┌─────────────────────────────────────────────────────────────────────┐
 │ apply-kit service (Node + Hono), started at login by launchd        │
 │  API · scheduler (every 30 min, 07:00–23:00, catch-up on wake)      │
 │  sources (ATS feeds, public APIs, aggregators) · IMAP mail reader    │
 │  extraction · tailoring · PDF (headless Chrome via Playwright)       │
 └───────┬───────────────────────┬──────────────────────┬──────────────┘
         ▼                       ▼                      ▼
  SQLite (Application Support)  OpenRouter (DeepSeek,   Gmail (dedicated job
  ← repo `data/` shortcut       non-China hosts)        mailbox, IMAP read-only)
```

## Decisions

| Area | Decision | Why |
|---|---|---|
| Browser | **Chrome** for applying; Safari stays the everyday browser. WXT keeps a Safari build possible later | Chrome loads unpacked extensions directly; Safari needs an Xcode wrapper and re-enabling unsigned extensions every launch |
| App form | **Local service + browser tab**, no desktop app. launchd starts the service at login | Single user; background checks need a long-running process; a desktop shell adds installers and updates for nothing |
| Stack | **TypeScript everywhere.** Hono (API + scheduler in one Node process), React + Vite UI styled from `docs/design/tokens.css`, WXT extension, Vercel AI SDK → OpenRouter | One language and shared types across service, UI and extension; lighter than the old Next.js app, which this tool doesn't need |
| Data | **One SQLite file** in `~/Library/Application Support/apply-kit/`, with a gitignored `data` symlink in the repo. Nightly backup copy to a folder the user picks (iCloud Drive fine for backups); one-click export | One place to look; safe from `git clean`, repo copies and code searches |
| Secrets | **Gitignored `.env`** in the repo holds config and keys (OpenRouter key, Gmail app password). Agents never open `.env` (rule in CLAUDE.md) | User's choice for simplicity; keys are removed once the search ends |
| AI | DeepSeek V4.1 Flash for every task via OpenRouter, providers pinned to non-China hosts; hard monthly cap in the app and as the OpenRouter key's credit limit | PRODUCT.md constraint |
| PDFs | HTML template → headless Chrome (Playwright) → PDF; fonts embedded, ligatures off. Every PDF is text-extracted and checked before approval | Preview equals the uploaded file; ATS-safe in English and Bulgarian |
| Extension ↔ service | Talks only to `localhost`, paired once with a code the user approves; stores nothing, shows "app not running" when it can't reach the service | No website can read the profile through it; no stale copies of personal data |
| Mail | A new **Gmail** address used only for job mail; iCloud rule forwards kris@krisiliev.dev to it; read over IMAP with an app password | Free; the old ingestion was built and tested against Gmail |
| Notifications | **None.** Employers' emails are notification enough; everything else waits in the app | User's choice |
| Repo | New code replaces the archive on `main` (archive stays in history and the `archive-2026-10` tag). Layout below | Clean start with history kept |

## Repo layout

```
apply-kit/
├── app/              service (Hono API, scheduler, mail, PDF) + ui/ (React + Vite)
├── extension/        WXT browser extension (Chrome first)
├── packages/core/    domain types and rules: sources, extraction, tailoring, honesty line
├── docs/             design, knowledge, research, ADRs, this file
├── data -> ~/Library/Application Support/apply-kit   (gitignored symlink)
└── .env              (gitignored)
```

## Open, to settle when building

- Exact SQLite access layer (plain SQL vs a thin query builder) and migration tool.
- How tailoring prompts and the honesty-line checks are tested (fixture CVs and postings, snapshot plus rule assertions).
