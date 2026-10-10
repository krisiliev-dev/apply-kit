# CV-maker Capture (browser extension)

Captures job postings from **your own logged-in sessions** — LinkedIn, jobs.bg,
Indeed, Glassdoor, or any career page — and pushes them into CV-maker's
discovery pool. It reads only the page you're already viewing in your own
browser session. No bot, no scraping of a site that forbids it, nothing
evaded — which is exactly why it's the legitimate way to reach LinkedIn and
jobs.bg (whose own automated access is gated).

## Install (unpacked)

1. Make sure the CV-maker app is running (`cd ~/code/cv-maker && npm run dev` →
   http://localhost:3000).
2. Open `chrome://extensions` in Chrome/Edge/Arc/Brave.
3. Toggle **Developer mode** (top-right).
4. **Load unpacked** → select this `extension/` folder.
5. Click the extension icon → set **App URL** if it isn't `http://localhost:3000`,
   and leave **Auto-capture** on.

## Use

- **Browse normally** while logged in. On LinkedIn job pages, jobs.bg, Indeed,
  and Glassdoor it auto-captures the postings on the page as you view them.
- On **any other** job/career page, click the extension icon → **Capture this
  page**.
- Captures appear in the app at **/discover** (and via the MCP `list_postings`
  tool), tagged by source (`LinkedIn`, `jobs.bg`, `Captured`, …) and scored
  against your CV.

## How it extracts

1. **schema.org `JobPosting` JSON-LD** in the live DOM — the reliable path;
   LinkedIn job-detail pages and many career sites embed it.
2. **Heuristic fallback** — the page's main `<h1>` as the title plus a
   best-effort company guess, for detail pages without JSON-LD.

## Honest limitations

- DOM/heuristic extraction is **best-effort**; site markup changes, so some
  list pages may capture little. Job **detail** pages (with JSON-LD) are the
  most reliable. If a site you care about captures poorly, open it and tell the
  CV-maker chat what's on the page — the extractor can be tuned per site.
- The app must be running and reachable at the configured App URL.
- Captures POST to the app's open `/api/discover/ingest` endpoint (fine for
  local single-user use).
