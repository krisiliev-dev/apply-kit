// Reading one job page's HTML: its JSON-LD JobPosting first, then the page itself (heading, site
// name and main text) for career pages that don't embed one. Pure: the engine does the fetching.
import { parse } from "node-html-parser";
import { htmlToText, decodeEntities } from "../extraction/text.ts";
import { cleanText } from "../sources/normalise.ts";
import { jobPostingsFromLd, type LdJobPosting } from "./jsonld.ts";

/** A page read without JSON-LD needs at least this much text to count as a job posting. */
const minPageText = 400;

export interface PageReading {
  /** The job the page describes, or null when it doesn't look like one job posting. */
  posting: LdJobPosting | null;
  /** How it was read. */
  via: "json-ld" | "page" | null;
  /** The page's own title, to start from when Kris pastes the text himself. */
  pageTitle: string | null;
  /** The site's name (og:site_name), when stated. */
  siteName: string | null;
}

export function readJobPage(html: string, pageUrl: string): PageReading {
  const root = parse(html, { blockTextElements: { script: true, style: true, noscript: true } });
  const meta = (prop: string) => cleanText(decodeEntities(root.querySelector(`meta[property="${prop}"], meta[name="${prop}"]`)?.getAttribute("content") ?? "")) || null;
  const pageTitle = meta("og:title") ?? (cleanText(decodeEntities(root.querySelector("title")?.text ?? "")) || null);
  const siteName = meta("og:site_name");

  const ld = root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.rawText);
  const postings = jobPostingsFromLd(ld, pageUrl);
  // A page listing several jobs (a careers index) isn't one job: Kris pastes the job's own link.
  if (postings.length === 1) {
    const p = postings[0]!;
    const fromPage = !p.descriptionHtml ? mainHtml(root) : null;
    return { posting: { ...p, company: p.company ?? siteName, descriptionHtml: p.descriptionHtml ?? fromPage }, via: "json-ld", pageTitle, siteName };
  }
  if (postings.length > 1) return { posting: null, via: null, pageTitle, siteName };

  const heading = cleanText(decodeEntities(root.querySelector("h1")?.text ?? "")) || null;
  const body = mainHtml(root);
  if (!heading || !body || htmlToText(body).length < minPageText) return { posting: null, via: null, pageTitle, siteName };
  return {
    posting: {
      identifier: null, url: pageUrl, title: heading, company: siteName, location: null, salary: null,
      postedAt: null, validThrough: null, employmentType: null, descriptionHtml: body,
    },
    via: "page",
    pageTitle,
    siteName,
  };
}

/** The page's main content as HTML: <main>, else <article>, else <body>, without navigation and scripts. */
function mainHtml(root: ReturnType<typeof parse>): string | null {
  const main = root.querySelector("main") ?? root.querySelector("article") ?? root.querySelector("body");
  if (!main) return null;
  for (const el of main.querySelectorAll("script, style, noscript, nav, header, footer, form, button, svg")) el.remove();
  const out = main.innerHTML.trim();
  return out || null;
}
