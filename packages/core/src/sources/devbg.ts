// dev.bg category pages (server-rendered HTML; robots.txt allows /company/jobs/ for every crawler but JoobleBot).
// GET https://dev.bg/company/jobs/{category}/ and any /page/N/ it links to. One card per posting:
// div.job-list-item[data-job-id] holds the title, company, location badge and link.
import { parse, type HTMLElement } from "node-html-parser";
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { field } from "./shared.ts";

export interface DevBgConfig {
  /** Category slug from the dev.bg URL, e.g. "it-security" or "back-end-development". */
  category: string;
}

const slug = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;
/** A category longer than this many pages is far bigger than any dev.bg has; stop there. */
const maxPages = 10;

export const devbg: SourceAdapter<DevBgConfig> = {
  kind: "devbg",
  category: "aggregator",
  label: "dev.bg",

  parseConfig(raw) {
    const category = (typeof raw === "string" ? raw : field(raw, "category") ?? "").trim().toLowerCase();
    if (!slug.test(category)) {
      throw new Error(`A dev.bg source needs a category from its jobs URL like "it-security", got ${JSON.stringify(raw)}`);
    }
    return { category };
  },

  key: (c) => c.category,
  defaultName: (c) => `dev.bg · ${c.category}`,

  async fetchPostings(config, { fetch }) {
    const base = `https://dev.bg/company/jobs/${config.category}/`;
    const load = async (url: string) => {
      const res = await fetch(url, { headers: { accept: "text/html" } });
      if (!res.ok) throw new Error(`dev.bg answered ${res.status} for ${config.category}`);
      return parse(await res.text());
    };

    const first = await load(base);
    const cards = first.querySelectorAll(".job-list-item");
    if (cards.length === 0 && !first.querySelector(".job-list")) {
      throw new Error(`dev.bg's ${config.category} page has no job list (the page layout may have changed)`);
    }
    const lastPage = Math.min(maxPages, pageCount(first, base));
    for (let n = 2; n <= lastPage; n++) cards.push(...(await load(`${base}page/${n}/`)).querySelectorAll(".job-list-item"));

    const byId = new Map<string, FoundPosting>();
    for (const card of cards) {
      const posting = toPosting(card);
      if (posting) byId.set(posting.externalId, posting);
    }
    return [...byId.values()];
  },
};

/**
 * Every job card on one dev.bg page (a category or a search-results page), for coverage checks.
 * Throws if the page has no job list at all (a different page, or the layout changed).
 */
export function devbgPageListings(html: string): FoundPosting[] {
  const page = parse(html);
  if (!page.querySelector(".job-list") && page.querySelectorAll(".job-list-item").length === 0) {
    throw new Error("That dev.bg page has no job list: paste the link to a page of search results");
  }
  const byId = new Map<string, FoundPosting>();
  for (const card of page.querySelectorAll(".job-list-item")) {
    const posting = toPosting(card);
    if (posting) byId.set(posting.externalId, posting);
  }
  return [...byId.values()];
}

/** The highest /page/N/ of this category the page links to (1 if none). */
function pageCount(page: HTMLElement, base: string): number {
  let last = 1;
  for (const a of page.querySelectorAll("a[href]")) {
    const href = a.getAttribute("href") ?? "";
    if (!href.startsWith(`${base}page/`)) continue;
    const n = Number(/page\/(\d+)\/?$/.exec(href)?.[1]);
    if (Number.isInteger(n) && n > last) last = n;
  }
  return last;
}

function toPosting(card: HTMLElement): FoundPosting | null {
  const id = card.getAttribute("data-job-id")?.trim();
  const link = card.querySelectorAll("a[href]").map((a) => a.getAttribute("href")!).find((h) => h.includes("/company/jobads/"));
  const title = text(card.querySelector(".job-title"));
  if (!id || !/^\d+$/.test(id) || !link || !title) return null;
  const badge = card.querySelector(".badge");
  badge?.querySelectorAll(".badge-tooltip").forEach((t) => t.remove());
  return {
    externalId: id,
    url: link,
    title,
    company: text(card.querySelector(".company-name")) || "dev.bg",
    // As stated, e.g. "София" or "Fully Remote"; location matching understands Cyrillic.
    location: text(badge) || null,
    salary: null,
    // Cards say "9 окт." with no year, and adapters don't read the clock: left unknown.
    postedAt: null,
    descriptionHtml: null,
  };
}

const text = (el: HTMLElement | null | undefined) => (el?.text ?? "").replace(/\s+/g, " ").trim();
