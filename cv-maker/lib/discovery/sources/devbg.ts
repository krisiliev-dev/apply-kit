import * as cheerio from "cheerio";
import type { JobPosting } from "../types";
import { stableId } from "../id";

// Site-specific adapter for dev.bg — the main Bulgarian tech job board.
// dev.bg is server-rendered and its robots.txt permits the job listings, so a
// single GET + targeted parse is enough (no headless browser). Point this at a
// category page like https://dev.bg/company/jobs/it-security/ and it extracts
// the job cards. We keep it polite: one GET, realistic UA, no pagination.
//
// Markup (as of 2026): each card is `.job-list-item` with `.job-title`,
// `.company-name`, `.badge` (remote/hybrid/location), and a detail link to
// `/company/jobads/<slug>/`.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function isDevBg(url: string): boolean {
  try {
    return /(^|\.)dev\.bg$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export async function fetchPostings(pageUrl: string): Promise<JobPosting[]> {
  let html: string;
  try {
    const res = await fetch(pageUrl, {
      headers: { "user-agent": UA, accept: "text/html" },
      redirect: "follow",
      signal: AbortSignal.timeout(20_000),
    });
    if (!res.ok) return [];
    html = await res.text();
  } catch {
    return [];
  }
  return parseDevBg(pageUrl, html);
}

// Pure parser — exported for testing.
export function parseDevBg(
  pageUrl: string,
  html: string,
  now: number = Date.now(),
): JobPosting[] {
  const $ = cheerio.load(html);
  const out: JobPosting[] = [];

  $(".job-list-item").each((_, el) => {
    const card = $(el);
    const href = card.find('a[href*="/company/jobads/"]').first().attr("href");
    if (!href) return;
    const url = absUrl(pageUrl, href);
    if (!url) return;

    const title = clean(card.find(".job-title").first().text());
    if (!title) return;

    const company = clean(card.find(".company-name").first().text()) || "dev.bg";

    const badges = card
      .find(".badge")
      .map((_i, b) => {
        const $b = $(b);
        // The hybrid/remote badges embed a long explanatory tooltip; drop it.
        $b.find(".badge-tooltip").remove();
        return clean($b.text());
      })
      .get()
      .filter(Boolean);
    const located =
      badges.find((t) =>
        /\b(remote|hybrid|on-?site|sofia|plovdiv|varna|burgas|bulgaria|софия)\b/i.test(t),
      ) ?? badges[0];
    const location = located ? located.slice(0, 48) : undefined;

    out.push({
      id: stableId(["careerpage", url, title]),
      source: { kind: "careerpage", url: pageUrl, site: "dev.bg" },
      url,
      title,
      company,
      location: location || undefined,
      fetchedAt: now,
    });
  });

  return out;
}

function clean(s: string): string {
  return s.replace(/\s+/g, " ").trim();
}

function absUrl(base: string, href: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}
