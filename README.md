# apply-kit

A personal tool that finds jobs, prepares tailored applications, fills application portals and tracks outcomes for one job seeker. It runs entirely on your Mac: a small local service with the UI in a browser tab, and all data in one SQLite file.

The first feature being built is **Discover**: one trustworthy Feed of every relevant job (spec: GitHub issue #1). The old prototypes (`cv-maker/`, `autofill-extension/`) live on in git history and the `archive-2026-10` tag.

## Layout

| Path | What |
|---|---|
| `app/` | Local service: Hono API (and later the scheduler, mail reader and PDF), in `app/src/` |
| `app/ui/` | React + Vite UI. `app/ui/src/styles/tokens.css` and `components.css` are the design system's single copy |
| `packages/core/` | Discovery engine and domain rules. Its dependencies (fetch, clock, database, AI extractor, mail reader) are injected |
| `extension/` | Chrome-first WXT extension (placeholder for now) |
| `docs/` | Product, design, architecture ([ARCHITECTURE.md](docs/ARCHITECTURE.md)), ADRs, research |
| `data` | Gitignored shortcut to `~/Library/Application Support/apply-kit`, where the database lives |

## Setup

Needs Node 22 (`nvm use` reads `.nvmrc`) and pnpm.

```sh
pnpm install
pnpm run setup:data      # creates the Application Support folder and the `data` shortcut
cp .env.example .env     # then fill in the settings you need (names only in the example)
```

Until adding companies on the Sources screen is built, Sources are set in `.env` as `APPLY_KIT_SOURCES` (comma-separated `kind:value`, e.g. `greenhouse:payhawkio`). Source types and their values:

| Type | Value | Notes |
|---|---|---|
| `greenhouse` | board token (`payhawkio`) | |
| `lever` | site (`siteground`) or jobs link | EU accounts: `https://jobs.eu.lever.co/{site}`. Requests to Lever are spaced 1 s apart (its crawl delay). |
| `ashby` | board name (`Dext-Careers`, case-sensitive) or jobs.ashbyhq.com link | |
| `recruitee` | company (`accedia`) or careers-site link | |
| `personio` | account (`acme`) or `https://acme.jobs.personio.com` | |
| `teamtailor` | company (`superhosting`) or careers-site link | |
| `smartrecruiters` | company id, optionally with a country (`Gameloft:bg`) | |

Lever and Ashby don't state the company's name, so the Source's name is a guess from its value. Every Source request identifies apply-kit and goes one at a time per host. They are added on every start; use **Check now** on the Feed to fetch. Settings › Sources (`/settings/sources`) shows each Source's health, and **Try now** retries a failed one.

Use `pnpm run setup:data`, not `pnpm setup`: the latter is a pnpm built-in that edits your shell profile.

## Commands

| Command | Does |
|---|---|
| `pnpm start` | Builds the UI and starts the service; open http://localhost:4310 (or your `PORT`) |
| `pnpm dev` | Service with reload plus the Vite dev server; open http://localhost:5173 (it proxies `/api` to the service) |
| `pnpm test` | Runs the tests (Vitest) |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | TypeScript project build, no output files |

## Rules carried forward

- Never commit real CVs, profile data or secrets. Personal data stays local (`.gitignore` covers `.env*`, PDFs/DOCX/Pages, personal folders and `data`).
- No automation that drives authenticated LinkedIn/jobs.bg sessions or defeats bot protection. Use official APIs, email alerts and user-driven capture instead.
- The app drafts and pre-fills; you send messages and press Submit.
