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

Until adding companies on the Sources screen is built, Sources are set in `.env` as `APPLY_KIT_SOURCES` (comma-separated `kind:value`, e.g. `greenhouse:payhawkio`). They are added on every start. Settings › Sources (`/settings/sources`) shows each Source's health, and **Try now** retries a failed one.

While the service runs it checks Sources every 30 minutes between 07:00 and 23:00 (local time), and after the Mac wakes it catches up within a minute if a check was missed. Change this with `APPLY_KIT_CHECK_EVERY_MINUTES` and `APPLY_KIT_CHECK_WINDOW` (e.g. `08:00-20:00`). **Check now** on the Feed checks straight away.

### Start at login

```sh
nvm use                  # the Node 22 whose path goes into the LaunchAgent
pnpm service:install     # builds the UI, installs ~/Library/LaunchAgents/dev.krisiliev.apply-kit.plist and starts it
```

Logs go to `~/Library/Logs/apply-kit/`. `pnpm service:status` shows whether it is running; `pnpm service:uninstall` removes it. Run install again after upgrading Node or moving the repo.

Reading postings (requirements, key facts) uses OpenRouter: set `OPENROUTER_API_KEY` and a hard monthly cap `AI_MONTHLY_CAP_USD` (e.g. `10`). Without a cap nothing is read and jobs stay in the Feed unscreened. `OPENROUTER_MODEL` and `OPENROUTER_PROVIDERS` are optional; China-hosted providers are always excluded.

Use `pnpm run setup:data`, not `pnpm setup`: the latter is a pnpm built-in that edits your shell profile.

## Commands

| Command | Does |
|---|---|
| `pnpm start` | Builds the UI and starts the service; open http://localhost:4310 (or your `PORT`) |
| `pnpm dev` | Service with reload plus the Vite dev server; open http://localhost:5173 (it proxies `/api` to the service) |
| `pnpm service:install` / `service:uninstall` / `service:status` | Start the service at login with launchd (see above) |
| `pnpm test` | Runs the tests (Vitest) |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | TypeScript project build, no output files |

## Rules carried forward

- Never commit real CVs, profile data or secrets. Personal data stays local (`.gitignore` covers `.env*`, PDFs/DOCX/Pages, personal folders and `data`).
- No automation that drives authenticated LinkedIn/jobs.bg sessions or defeats bot protection. Use official APIs, email alerts and user-driven capture instead.
- The app drafts and pre-fills; you send messages and press Submit.
