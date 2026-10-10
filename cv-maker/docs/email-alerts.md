# Email-alert ingestion (LinkedIn + jobs.bg, via Gmail)

The legitimate way to pull **LinkedIn** and **jobs.bg** roles automatically: let
those platforms email you saved-search alerts (you opt in), and have CV-maker
read *your own inbox* over IMAP and parse the alerts into the discovery pool. No
site scraping — you're processing mail the platforms chose to send you.

## One-time setup

1. **Gmail app password**
   - Enable 2-Step Verification on your Google account.
   - Create an **App password** (Google Account → Security → App passwords).
   - Add to `~/code/cv-maker/.env.local`:
     ```
     GMAIL_USER=you@gmail.com
     GMAIL_APP_PASSWORD=xxxx xxxx xxxx xxxx
     # optional: a Gmail label to read instead of the whole inbox
     GMAIL_MAILBOX=job-alerts
     ```
   - Restart the dev server.

2. **Create saved-search alerts**
   - **LinkedIn**: run a job search (e.g. "Security Engineer", Sofia / Remote),
     then **Set alert** → email, daily.
   - **jobs.bg**: run a search, save it / subscribe to email notifications.

3. **(Recommended) Filter alerts to a label**
   - In Gmail, make a filter: `from:(linkedin.com OR jobs.bg) subject:(job OR обява OR alert)` → **Apply label** `job-alerts` (and optionally skip inbox).
   - Set `GMAIL_MAILBOX=job-alerts` so the sync only reads that label.

## Use

- Trigger a sync from the agent (MCP tool **`sync_email`**) or:
  ```
  curl -X POST http://localhost:3000/api/discover/email-sync
  ```
- It reads the last 14 days of the mailbox, parses LinkedIn/jobs.bg/other alert
  emails, and merges postings into the pool (deduped by id, so re-running is
  safe). Results show in `/discover`, scored against your CV.

## Hands-off scheduling

- **While the app is open:** Settings → General → *Auto-refresh discovery* runs
  all sources + email ingestion on an interval (default 6h).
- **Always-on (even with the app closed):** point a system cron / `launchd` at
  the two endpoints, e.g. every 6 hours:
  ```cron
  0 */6 * * * curl -s -X POST http://localhost:3000/api/discover/run >/dev/null
  5 */6 * * * curl -s -X POST http://localhost:3000/api/discover/email-sync >/dev/null
  ```
  (Requires the dev server running.) This is the legitimate "automatic pull":
  aggregators + ATS + the alert emails LinkedIn/jobs.bg send you — no scraping.

## Notes / limitations

- Alert-email HTML varies and changes; the parsers are **best-effort**. If a
  sender captures poorly, forward me one alert email's HTML and I'll tune the
  parser for that sender.
- The app reads your inbox read-only and never sends mail. The app-password is
  in `.env.local` (gitignored) — keep it there.
