# apply-kit

A personal tool that finds jobs, prepares tailored applications, fills application portals and tracks outcomes for one job seeker. It runs entirely on your Mac: a small local service with the UI in a browser tab, and all data in one SQLite file.

**Discover**, **Prepare**, **Apply** and **Track** are implemented: find a job, review a tailored package, fill the application on your click, and track replies and follow-ups. The old prototypes (`cv-maker/`, `autofill-extension/`) live on in git history and the `archive-2026-10` tag.

## Layout

| Path | What |
|---|---|
| `app/` | Local service: Hono API, scheduler, mail reader and PDF rendering, in `app/src/` |
| `app/ui/` | React + Vite UI. `app/ui/src/styles/tokens.css` and `components.css` are the design system's single copy |
| `packages/core/` | Discovery engine and domain rules. Its dependencies (fetch, clock, database, AI extractor, mail reader) are injected |
| `extension/` | Chrome-first WXT extension: a side panel that captures the job page, or the search results, you're viewing, and (from the Apply spec) fills application portals when you click |
| `docs/` | Product, design, architecture ([ARCHITECTURE.md](docs/ARCHITECTURE.md)), ADRs, research |
| `data` | Gitignored shortcut to `~/Library/Application Support/apply-kit`, where the database lives |

## Setup

Needs Node 22 (`nvm use` reads `.nvmrc`) and pnpm.

```sh
pnpm install
pnpm run setup:data      # creates the Application Support folder and the `data` shortcut
cp .env.example .env     # then fill in the settings you need (names only in the example)
pnpm --filter @apply-kit/app exec playwright install chromium-headless-shell   # prints CVs and letters to PDF (about 100 MB, once)
```

CV and cover-letter PDFs are printed from one fixed template per document by headless Chromium and read back with pdf.js, both on this laptop (ADR 0003). To check the template by eye, open `/api/dev/documents/cv` (or `cover-letter`; add `?language=bg` and `&photo=1`) on the running service; `/api/dev/documents/cv/check` shows the text read back and the ATS check. Without Chromium the rendering smoke test is skipped with a message.

Add companies on the Sources screen (**Add company**: a name or a careers link; apply-kit detects the job system). The **Sofia starter watchlist** panel there adds the 46 companies from `docs/design/watchlist-draft.md` with a verified feed in one step (repeatable; Sources you paused or removed stay that way) and lists the 29 without a feed with the LinkedIn or jobs.bg alert that still catches their jobs. Sources can also be seeded in `.env` as `APPLY_KIT_SOURCES` (comma-separated `kind:value`, e.g. `greenhouse:payhawkio`), which is the only way to add search, aggregator and email-alert Sources for now. Source types and their values:

| Type | Value | Notes |
|---|---|---|
| `greenhouse` | board token (`payhawkio`) | |
| `lever` | site (`siteground`) or jobs link | EU accounts: `https://jobs.eu.lever.co/{site}`. Requests to Lever are spaced 1 s apart (its crawl delay). |
| `ashby` | board name (`Dext-Careers`, case-sensitive) or jobs.ashbyhq.com link | |
| `recruitee` | company (`accedia`) or careers-site link | |
| `personio` | account (`acme`) or `https://acme.jobs.personio.com` | |
| `teamtailor` | company (`superhosting`) or careers-site link | |
| `smartrecruiters` | company id, optionally with a country (`Gameloft:bg`) | |

Lever and Ashby don't state the company's name, so the Source's name is a guess from its value. Every Source request identifies apply-kit and goes one at a time per host. On each start, `APPLY_KIT_SOURCES` adds only Sources that were never added before: one you paused or removed on the Sources screen stays paused or removed even though it is still in the setting (add it again on the Sources screen to bring it back, or take it out of the setting). Settings › Sources (`/settings/sources`) shows each Source's health, and **Try now** retries a failed one. **Pause** stops checking a Source and closes nothing. **Remove…** first shows exactly which open Jobs would close (only those no other Source lists; paused Sources still count as listing them) and which stay open; removed Jobs close with "Source removed", Undo brings the Source and its Jobs back, and passed Jobs are never touched.

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

### Paste a job link

On the Feed (first run, or **Add job** in the toolbar), paste a job's link to add that one job. apply-kit reads the page once (its JSON-LD JobPosting, otherwise the page's heading and main text), only where the site's robots.txt allows it, and the Job is merged, ranked and read like any other. A link already in the Feed opens its Job. LinkedIn, jobs.bg, Google, Apple and Meta careers, Indeed and Glassdoor are never fetched, and a page behind bot protection is never retried: apply-kit keeps the link and asks you to paste the job's text instead. Pasted jobs aren't a Source to check, so they never close because a check missed them; one that no job system lists shows **Unverified after 30 days** and stays in the Feed.

### Chrome extension (capture and application filling)

Capture the job page you're viewing in Chrome, or every listing a search results page shows (LinkedIn and jobs.bg included), with one click.

1. `pnpm build:extension`, then in Chrome open `chrome://extensions`, turn on **Developer mode**, choose **Load unpacked** and pick `extension/.output/chrome-mv3`. (`pnpm --filter @apply-kit/extension dev` opens a Chrome with it loaded and reloads on change.)
2. With the service running, open apply-kit › **Settings** › **Pair the extension**, click the apply-kit icon in Chrome (it opens apply-kit's side panel) and type the 6-digit code. The code works once, for 10 minutes. Paired extensions are listed there and can be unpaired.
3. On a job page or a page of search results, click the apply-kit icon, choose **Capture** in the panel's switch if it isn't already, then **Capture this page** (or **Capture search results**). The panel shows each listing as New, Already in Feed, Hidden (with the dealbreaker) or Couldn't read; **Add to Feed** stores them under the Source "Captured · <site>".

On one of the six portals apply-kit knows (Workday, Greenhouse, Lever, SmartRecruiters, Workable, Ashby) the panel opens on **Fill this application** and names the portal and the job from the page's address. The first time, it asks once to **Allow the 6 portals** (Chrome's prompt for those sites only; **Not now** works, and then you click the apply-kit icon on each new site before filling). **Fill this page** (also `Alt+Shift+F`, remappable at `chrome://extensions/shortcuts`) matches an approved package, fills recognised fields, attaches its documents, and reports what needs your attention. Use Undo to restore fields changed by that fill. Review the portal yourself before submitting.

Capture reads a page only when you click, as Chrome has rendered it: capture never scrolls, clicks, pages or opens listings, and has no access to any site until you open it on that tab (`activeTab`). Scroll or open the next page yourself, then capture again; listings already captured are recognised. It talks only to the service on this laptop (default `http://127.0.0.1:4310`; change it under **Service address** when pairing) and keeps nothing but that address and its pairing token. When the service isn't running it says so and retries. A captured job is re-checked on the company's own job system when apply-kit watches one (it closes when that stops listing it); otherwise it shows **Unverified after 30 days** and stays in the Feed.

During filling, guarded clicks can choose form options and add or remove work-history entries. The extension never clicks Next, Submit, consent, account creation or sign-in. Account help fills your email and points you to Chrome’s password manager; passwords are never read or stored. A recent verification email from the matching portal can appear as a link that you open yourself.

On other company forms, the panel starts with a copy list of your approved answers and documents. **Fill clear fields** is a separate opt-in for clearly labelled fields; ambiguous questions stay for you. If a portal changes, use **Report field** in the panel and review reports in Settings.

For Bulgarian packages, enter verified Bulgarian equivalents on role and skill pieces in Profile. Saving confirms that wording is equivalent; employers and dates retain their original values. Without a verified equivalent, the original title or skill is used.

### First application

1. Open **Profile**, add your contact details and confirmed work history, skills and reusable answers. Check the preparation checklist.
2. Open a job in the Feed and prepare its package. Review the target, CV, letter, answers and ATS check, then approve it.
3. Open the company application and click **Fill this page** in the paired extension. Review every page and press Next and Submit yourself.
4. Confirm **I submitted** in the panel. **Applications** keeps the approved files, events and follow-ups; sending email remains your action.

The first five real applications are a calibration trial, not an automated test. Use [the trial sheet](docs/research/implementation/portal-trial.md) to record portal differences and timing; no live applications have been submitted by the implementation checks.

### Job mailbox (email alerts)

Job-alert emails (LinkedIn, jobs.bg, Google Careers, Workday, MyGreenhouse) are read from a Gmail address used only for job mail, over IMAP and **read-only**: apply-kit opens one folder with EXAMINE, never marks mail read, moves or deletes anything.

1. Create the dedicated Gmail account and turn on 2-Step Verification (Google requires it for app passwords).
2. Create an app password at [myaccount.google.com/apppasswords](https://myaccount.google.com/apppasswords) (name it "apply-kit").
3. In `.env`: `GMAIL_ADDRESS` (the job address), `GMAIL_APP_PASSWORD` (spaces are fine) and optionally `GMAIL_MAILBOX` (a Gmail label; default `INBOX`).
4. On icloud.com › Mail › Settings › Rules, forward job mail from your usual address to the job Gmail. Either forward everything, or add one rule per alert sender (from contains `linkedin.com`, `jobs.bg`, `google.com`, `myworkday.com`, `greenhouse`). Point each site's alerts at your usual address, or straight at the job Gmail.
5. Add the alert Sources to `APPLY_KIT_SOURCES`: `email:linkedin,email:jobsbg,email:google,email:workday,email:mygreenhouse` (only the ones you use), then restart.
6. Optional: set `MY_EMAIL_ADDRESSES` to the address(es) you send mail from. When you send a follow-up, BCC the job Gmail and the next read marks that follow-up sent for you.

The mailbox is read at each scheduled check. Each alert learns its usual rhythm; one with no email for more than 3× its usual gap shows **Quiet longer than usual** on Sources. If Gmail refuses the app password (revoked, or the Google password changed), Sources says so with these steps; create a new app password and restart.

### Start at login

```sh
nvm use                  # the Node 22 whose path goes into the LaunchAgent
pnpm service:install     # builds the UI, installs ~/Library/LaunchAgents/dev.krisiliev.apply-kit.plist and starts it
```

Logs go to `~/Library/Logs/apply-kit/`. `pnpm service:status` shows whether it is running; `pnpm service:uninstall` removes it. Run install again after upgrading Node or moving the repo.

Reading postings (requirements, key facts) uses OpenRouter: set `OPENROUTER_API_KEY` and a hard monthly cap `AI_MONTHLY_CAP_USD` (e.g. `10`). Without a cap nothing is read and jobs stay in the Feed unscreened. `OPENROUTER_MODEL` and `OPENROUTER_PROVIDERS` are optional; China-hosted providers are always excluded. If one host is unavailable, requests can fail over only within the configured non-China allow-list, still subject to the privacy policy and price ceiling.

Use `pnpm run setup:data`, not `pnpm setup`: the latter is a pnpm built-in that edits your shell profile.

## Commands

| Command | Does |
|---|---|
| `pnpm start` | Builds the UI and starts the service; open http://localhost:4310 (or your `PORT`) |
| `pnpm dev` | Service with reload plus the Vite dev server; open http://localhost:5173 (it proxies `/api` to the service) |
| `pnpm service:install` / `service:uninstall` / `service:status` | Start the service at login with launchd (see above) |
| `pnpm build:extension` | Builds the Chrome extension into `extension/.output/chrome-mv3` (load it unpacked) |
| `pnpm test` | Runs the tests (Vitest) |
| `pnpm lint` | ESLint across the workspace |
| `pnpm typecheck` | TypeScript project build, no output files |
| `pnpm eval:extraction` | Checks how well postings are read (see below). Costs money; not part of `pnpm test` |
| `pnpm eval:tailoring` | Checks tailoring quality: packages for fictional profiles (see below). Costs money; not part of `pnpm test` |
| `pnpm eval:tailoring:verdicts` | Records your verdicts on the latest blind comparison sheet, then writes its report |

### Extraction accuracy check

Start the service once before running either evaluation: both require its persistent spending ledger.

`pnpm eval:extraction` runs the real extractor over 50 hand-labelled postings in `eval/extraction/postings/` (English and Bulgarian; dev, security, design) and prints accuracy per fact type: F1 for requirements, years, languages, certificates and locations; accuracy for the remote rule, work authorisation, salary and posting language; then the same per language and field. It reads the same `.env` settings as the service (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_PROVIDERS`) and refuses to run without the key or without `AI_MONTHLY_CAP_USD`. Its spending is booked in the service's monthly ledger, and it won't start if its conservative estimate (printed before the run) is more than what is left of this month's cap.

Each run saves a report to `eval/extraction/reports/` (gitignored) with every posting's extracted facts and scores; the next run shows the change against the newest report, so a new model (`OPENROUTER_MODEL`) or prompt can be compared. Labelling rules for adding or fixing postings: `eval/extraction/labelling-rules.md`.

### Tailoring quality check

Run it before changing the writer's model or prompts. `pnpm eval:tailoring` writes a package (CV, cover letter, screening answers) with the real writer for each case in `eval/tailoring/cases.json`: three fictional profiles (`eval/tailoring/profiles/`: security, developer, design) tailored to eight real postings from the extraction set, three of them in Bulgarian. Each package is written by the preparation engine exactly as the app writes one, but in a throwaway in-memory database, so your own profile and packages are never touched. The report lists, per package, every line the honesty validator refused (word for word, with why), the flags (near the line, gaps), stock phrases, length (CV pages and lines on page 2, letter words against the target, answers against their limit) and cost. CVs and letters are printed with headless Chromium, so page fit is the real one; the PDFs are kept beside the report.

It reads the same `.env` settings as the service (`OPENROUTER_API_KEY`, `OPENROUTER_MODEL`, `OPENROUTER_PROVIDERS`, `AI_MONTHLY_CAP_USD`), books its spending in the service's monthly ledger, and won't start if its estimate is more than what is left of this month's cap. One model costs a few cents; a stronger comparison model costs more (its estimate is printed before anything runs).

To compare voice and quality against a stronger model, also set:

- `EVAL_STRONGER_MODEL`: the OpenRouter id of the model to compare against
- `EVAL_STRONGER_MAX_PRICE`: the highest price it may cost, USD per million prompt and completion tokens (default `3,15`)
- `EVAL_STRONGER_PROVIDERS`: an allow-list of hosts for it, if `OPENROUTER_PROVIDERS` doesn't host it (China-hosted providers are always dropped)

Then the run writes only a blind comparison sheet: each case's two versions as Version A and Version B, in an order that changes from case to case. Fill in `Verdict (A, B or same):` and `Why:` for every case and run `pnpm eval:tailoring:verdicts`; it refuses until every case has a verdict, then reveals which model wrote which and writes the report with your verdicts. Runs are saved in `eval/tailoring/reports/` (gitignored).

Only made-up people belong in the repository's set: it refuses a profile not marked `"fictional": true`. To try real samples, keep a set with the same layout (`cases.json`, `profiles/`, optionally `postings/`) inside the data folder and point `APPLY_KIT_TAILORING_SET` at it; its reports are written beside it, never into the repository.

## Rules carried forward

- Never commit real CVs, profile data or secrets. Personal data stays local (`.gitignore` covers `.env*`, PDFs/DOCX/Pages, personal folders and `data`).
- No automation that drives authenticated LinkedIn/jobs.bg sessions or defeats bot protection. Use official APIs, email alerts and user-driven capture instead.
- The app drafts and pre-fills; you send messages and press Submit.
