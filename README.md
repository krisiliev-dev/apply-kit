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

Lever and Ashby don't state the company's name, so the Source's name is a guess from its value. Every Source request identifies apply-kit and goes one at a time per host. They are added on every start. Settings › Sources (`/settings/sources`) shows each Source's health, and **Try now** retries a failed one.

| Kind | Value | Notes |
|---|---|---|
| `greenhouse` | board token, e.g. `payhawkio` | |
| `workday` | careers link, optionally `\|Country`, e.g. `https://dxctechnology.wd1.myworkdayjobs.com/DXCJobs\|Bulgaria` | the country uses the site's own location filter |
| `microsoft` | `query\|place`, e.g. `security engineer\|Dublin` | newest 100 |
| `amazon` | `query\|ISO3 country`, e.g. `security engineer\|BGR` | newest 100 |
| `devbg` | dev.bg category, e.g. `it-security` | |
| `jooble` | `keywords\|location`, e.g. `security\|Bulgaria` | needs `JOOBLE_API_KEY` |
| `reed` | `keywords\|location`, e.g. `security\|London` | needs `REED_API_KEY` |
| `eures` | `keywords\|ISO2 country`, e.g. `cyber\|bg` | cyber keywords search by ESCO occupation |

A Source whose key setting is missing shows as failing on the Sources screen with the setting's name.

While the service runs it checks Sources every 30 minutes between 07:00 and 23:00 (local time), and after the Mac wakes it catches up within a minute if a check was missed. Change this with `APPLY_KIT_CHECK_EVERY_MINUTES` and `APPLY_KIT_CHECK_WINDOW` (e.g. `08:00-20:00`). **Check now** on the Feed checks straight away.

### Job mailbox (email alerts)

Job-alert emails (LinkedIn, jobs.bg, Google Careers, Workday, MyGreenhouse) are read from a Gmail address used only for job mail, over IMAP and **read-only**: apply-kit opens one folder with EXAMINE, never marks mail read, moves or deletes anything.

1. Create the dedicated Gmail account and turn on 2-Step Verification (Google requires it for app passwords).
2. Create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (name it "apply-kit").
3. In `.env`: `GMAIL_ADDRESS` (the job address), `GMAIL_APP_PASSWORD` (spaces are fine) and optionally `GMAIL_MAILBOX` (a Gmail label; default `INBOX`).
4. On icloud.com › Mail › Settings › Rules, forward job mail from your usual address to the job Gmail. Either forward everything, or add one rule per alert sender (from contains `linkedin.com`, `jobs.bg`, `google.com`, `myworkday.com`, `greenhouse`). Point each site's alerts at your usual address, or straight at the job Gmail.
5. Add the alert Sources to `APPLY_KIT_SOURCES`: `email:linkedin,email:jobsbg,email:google,email:workday,email:mygreenhouse` (only the ones you use), then restart.

The mailbox is read at each scheduled check. Each alert learns its usual rhythm; one with no email for more than 3× its usual gap shows **Quiet longer than usual** on Sources. If Gmail refuses the app password (revoked, or the Google password changed), Sources says so with these steps; create a new app password and restart.

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
