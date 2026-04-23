import "server-only";
import * as cheerio from "cheerio";

// Server-only: pull a job description out of a URL.
// We refuse sites that forbid scraping in their ToS (LinkedIn, Indeed) so the
// user is prompted to paste the text manually.

export type FetchJobResult =
  | { ok: true; text: string; url: string; title?: string }
  | { ok: false; reason: "blocked" | "network" | "empty"; message: string };

const BLOCKED_HOSTS = [
  "linkedin.com",
  "www.linkedin.com",
  "indeed.com",
  "www.indeed.com",
  "uk.indeed.com",
  "de.indeed.com",
];

function isBlocked(u: URL) {
  return BLOCKED_HOSTS.some((h) => u.hostname === h || u.hostname.endsWith(`.${h}`));
}

export async function fetchJobFromUrl(input: string): Promise<FetchJobResult> {
  let url: URL;
  try {
    url = new URL(input);
  } catch {
    return { ok: false, reason: "network", message: "That doesn't look like a URL." };
  }

  if (isBlocked(url)) {
    return {
      ok: false,
      reason: "blocked",
      message:
        "LinkedIn and Indeed forbid scraping in their Terms. Paste the job description text directly instead.",
    };
  }

  let res: Response;
  try {
    res = await fetch(url.toString(), {
      redirect: "follow",
      headers: {
        // Real-looking UA: many job boards return 403 for a default fetch UA.
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Safari/605.1.15",
        accept: "text/html,application/xhtml+xml",
      },
    });
  } catch (e) {
    return {
      ok: false,
      reason: "network",
      message: e instanceof Error ? e.message : "Network error fetching URL.",
    };
  }

  if (!res.ok) {
    return {
      ok: false,
      reason: "network",
      message: `Fetch failed with status ${res.status}.`,
    };
  }

  const html = await res.text();
  const $ = cheerio.load(html);

  // Drop noise that would only confuse the model.
  $("script, style, noscript, svg, header nav, footer, iframe").remove();

  const title = $("title").first().text().trim() || $("h1").first().text().trim();

  // Try a few likely containers before falling back to body.
  const candidates = [
    "[class*='job-description']",
    "[class*='jobDescription']",
    "[id*='job-description']",
    "[class*='posting']",
    "article",
    "main",
    "body",
  ];
  let text = "";
  for (const sel of candidates) {
    const el = $(sel).first();
    if (el.length) {
      const t = el.text().replace(/\s+\n/g, "\n").replace(/\n{3,}/g, "\n\n").trim();
      if (t.length > 400) {
        text = t;
        break;
      }
    }
  }
  if (!text) text = $("body").text().trim();

  // Cap it — models don't need 200KB.
  text = text.replace(/[ \t]+/g, " ").replace(/\n{3,}/g, "\n\n").slice(0, 12000);

  if (text.length < 80) {
    return {
      ok: false,
      reason: "empty",
      message:
        "Couldn't extract readable text from that page. Paste the description directly.",
    };
  }

  return { ok: true, text, url: url.toString(), title };
}
