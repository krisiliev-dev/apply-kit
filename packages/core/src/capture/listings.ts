// Reading a page Kris captured with the extension: the job page Kris is viewing, or every listing a
// search results page shows. Pure: it reads only the HTML the extension sent (the page as Chrome
// rendered it at the click), never fetches anything, and never sees cards the site hasn't rendered
// yet (those are only counted). LinkedIn and jobs.bg have their own readers; any other site is read
// like a pasted link (JSON-LD first, then the page itself).
import { parse, type HTMLElement } from "node-html-parser";
import { decodeEntities } from "../extraction/text.ts";
import { cleanText, formatLocation, toIsoUtc } from "../sources/normalise.ts";
import { jobPostingsFromLd } from "./jsonld.ts";
import { jobLinkFrom } from "./links.ts";
import { readJobPage } from "./page.ts";

/** What the extension sends: the tab's address and rendered HTML, plus same-origin frames (jobs.bg puts descriptions in one). */
export interface CapturedPage {
  url: string;
  html: string;
  frames?: { id: string | null; html: string }[];
}

export type MissingField = "company" | "location" | "description";

/** One listing as the page shows it. Fields the page doesn't show are null. */
export interface CapturedListing {
  /** The job's own link (tracking dropped), or null when the card has none. */
  url: string | null;
  title: string | null;
  company: string | null;
  location: string | null;
  salary: string | null;
  postedAt: string | null;
  descriptionHtml: string | null;
  /** Why it can't be added (no title, no link), or null when it can. */
  problem: string | null;
}

export interface PageListings {
  /** "job": one job page. "search": a list of jobs. "none": neither could be found. */
  kind: "job" | "search" | "none";
  /** The site as Kris knows it ("LinkedIn", "jobs.bg", "careers.orbitly.example"). */
  site: string;
  /** The host the listings were captured on, "www." dropped. */
  host: string;
  listings: CapturedListing[];
  /** Cards the site hasn't rendered yet (further down the list). Never fetched, only counted. */
  notLoaded: number;
}

type Root = ReturnType<typeof parse>;

const text = (el: HTMLElement | null | undefined) => cleanText(decodeEntities(el?.text ?? "")) || null;
const first = (root: HTMLElement, selectors: string[]) => {
  for (const s of selectors) {
    const t = text(root.querySelector(s));
    if (t) return t;
  }
  return null;
};

export function readCapturedPage(page: CapturedPage): PageListings {
  let url: URL;
  try {
    url = new URL(page.url);
  } catch {
    return { kind: "none", site: page.url, host: page.url, listings: [], notLoaded: 0 };
  }
  const host = url.hostname.toLowerCase().replace(/^www\./, "");
  const root = parse(page.html, { blockTextElements: { script: true, style: true, noscript: true } });
  if (/(^|\.)linkedin\.com$/.test(host)) return { site: "LinkedIn", host: "linkedin.com", ...linkedin(root, url) };
  if (/(^|\.)jobs\.bg$/.test(host)) return { site: "jobs.bg", host: "jobs.bg", ...jobsBg(root, url, page.frames ?? []) };
  return { site: host, host, ...generic(page.html, root, url) };
}

type Read = Pick<PageListings, "kind" | "listings" | "notLoaded">;
const none: Read = { kind: "none", listings: [], notLoaded: 0 };

function listing(fields: Partial<CapturedListing>): CapturedListing {
  const l: CapturedListing = {
    url: null, title: null, company: null, location: null, salary: null, postedAt: null, descriptionHtml: null, problem: null, ...fields,
  };
  if (!l.problem && !l.title) l.problem = "No job title on this card";
  else if (!l.problem && !l.url) l.problem = "No link to the job on this card";
  return l;
}

/** The job's own link, tracking dropped (LinkedIn search links become the job's page). */
function jobLink(href: string | null | undefined, base: URL): string | null {
  if (!href) return null;
  try {
    return jobLinkFrom(new URL(decodeEntities(href), base).href)?.href ?? null;
  } catch {
    return null;
  }
}

/** "Sofia, Bulgaria (Hybrid)" → "Sofia, Bulgaria · Hybrid"; "(On-site)" is dropped. */
function workplaceLocation(raw: string | null): string | null {
  if (!raw) return null;
  const m = /\((remote|hybrid|on-site|onsite)\)\s*$/i.exec(raw);
  const placeText = m ? raw.slice(0, m.index).trim() : raw;
  const kind = m?.[1]!.toLowerCase();
  return formatLocation([placeText], kind === "remote" ? "remote" : kind === "hybrid" ? "hybrid" : null);
}

// LinkedIn: signed-in pages (job page, search with its detail pane) and signed-out ones.

function linkedin(root: Root, url: URL): Read {
  const isSearch = /^\/jobs\/(search|collections)/.test(url.pathname);
  const cards = root.querySelectorAll("[data-occludable-job-id], ul.jobs-search__results-list > li");
  if (isSearch || cards.length > 1) return linkedinSearch(root, url);
  return linkedinJob(root, url);
}

/** The detail pane or job page: the top card and the description LinkedIn shows. */
function linkedinDetail(root: Root, base: URL): CapturedListing | null {
  const title = first(root, [
    ".job-details-jobs-unified-top-card__job-title h1", "h1.jobs-unified-top-card__job-title", "h1.top-card-layout__title",
  ]);
  if (!title) return null;
  const titleLink = root.querySelector(".job-details-jobs-unified-top-card__job-title a")?.getAttribute("href");
  const primary = first(root, [
    ".job-details-jobs-unified-top-card__primary-description-container",
    ".jobs-unified-top-card__primary-description",
    ".topcard__flavor--bullet",
  ]);
  const prefs = root.querySelectorAll(".job-details-preferences-and-skills span, .job-details-jobs-unified-top-card__job-insight span").map(text);
  const workplace = prefs.find((p) => /^(remote|hybrid|on-site)$/i.test(p ?? ""));
  const place = primary?.split(" · ")[0]?.trim() ?? null;
  const desc = root.querySelector("#job-details") ?? root.querySelector(".jobs-description__content") ?? root.querySelector(".description__text");
  return listing({
    url: jobLink(titleLink, base),
    title,
    company: first(root, [
      ".job-details-jobs-unified-top-card__company-name a", ".job-details-jobs-unified-top-card__company-name", ".topcard__org-name-link",
    ]),
    location: workplaceLocation(place && workplace ? `${place} (${workplace})` : place),
    descriptionHtml: desc?.innerHTML.trim() || null,
  });
}

function linkedinJob(root: Root, url: URL): Read {
  // Signed out, LinkedIn embeds JSON-LD like any career page.
  const ld = jobPostingsFromLd(root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.rawText), url.href);
  const link = jobLinkFrom(url.href)?.href ?? null;
  if (ld.length === 1) {
    const p = ld[0]!;
    return { kind: "job", notLoaded: 0, listings: [listing({ ...p, url: link ?? jobLink(p.url, url) })] };
  }
  const detail = linkedinDetail(root, url);
  if (!detail) return none;
  return { kind: "job", notLoaded: 0, listings: [listing({ ...detail, url: link ?? detail.url, problem: null })] };
}

function linkedinSearch(root: Root, url: URL): Read {
  const listings: CapturedListing[] = [];
  let notLoaded = 0;
  // Signed in: one <li data-occludable-job-id> per result; LinkedIn renders a card's content only near the viewport.
  for (const li of root.querySelectorAll("[data-occludable-job-id]")) {
    const card = li.querySelector("[data-job-id]") ?? li.querySelector(".job-card-container");
    if (!card || !cleanText(li.text)) {
      notLoaded++;
      continue;
    }
    const titleEl = card.querySelector(".job-card-list__title--link") ?? card.querySelector("a.job-card-container__link");
    const title = text(titleEl?.querySelector("strong")) ?? text(titleEl);
    const id = li.getAttribute("data-occludable-job-id") ?? card.getAttribute("data-job-id");
    const byId = title && id && /^\d+$/.test(id) ? `https://www.linkedin.com/jobs/view/${id}/` : null;
    listings.push(listing({
      url: jobLink(titleEl?.getAttribute("href"), url) ?? byId,
      title,
      company: first(card, [".artdeco-entity-lockup__subtitle", ".job-card-container__primary-description", ".job-card-container__company-name"]),
      location: workplaceLocation(first(card, [".job-card-container__metadata-wrapper li", ".artdeco-entity-lockup__caption"])),
      salary: first(card, [".artdeco-entity-lockup__metadata .job-card-container__metadata-item"]),
      postedAt: toIsoUtc(card.querySelector("time")?.getAttribute("datetime")),
    }));
  }
  // Signed out: the public search list.
  for (const li of root.querySelectorAll("ul.jobs-search__results-list > li")) {
    const card = li.querySelector(".base-card") ?? li;
    const urn = card.getAttribute("data-entity-urn")?.match(/(\d+)$/)?.[1];
    const href = card.querySelector("a.base-card__full-link")?.getAttribute("href");
    listings.push(listing({
      url: jobLink(href, url) ?? (urn ? `https://www.linkedin.com/jobs/view/${urn}/` : null),
      title: first(card, [".base-search-card__title"]),
      company: first(card, [".base-search-card__subtitle"]),
      location: workplaceLocation(first(card, [".job-search-card__location"])),
      salary: first(card, [".job-search-card__salary-info"]),
      postedAt: toIsoUtc(card.querySelector("time")?.getAttribute("datetime")),
    }));
  }
  // The open detail pane describes one of the listings: its text fills that listing in.
  const detail = linkedinDetail(root, url);
  const current = url.searchParams.get("currentJobId");
  const openLink = detail?.url ?? (current ? `https://www.linkedin.com/jobs/view/${current}/` : null);
  const open = openLink ? listings.find((l) => l.url === openLink) : undefined;
  if (open && detail) open.descriptionHtml = detail.descriptionHtml;
  return listings.length ? { kind: "search", listings, notLoaded } : notLoaded ? { kind: "search", listings, notLoaded } : none;
}

// jobs.bg: job pages keep the description in a same-origin frame; search results are cards.

const jobsBgCities = /(София|Sofia|Пловдив|Plovdiv|Варна|Varna|Бургас|Burgas|Русе|Ruse|Стара Загора|Плевен|Велико Търново|Благоевград|Дистанционно|Remote)/i;

function jobsBgId(href: string | null | undefined): string | null {
  const id = href ? /\/job\/(\d{4,})/.exec(href)?.[1] : null;
  return id ? `https://www.jobs.bg/job/${id}` : null;
}

function jobsBgWorkplace(parts: (string | null)[]): string | null {
  const city = parts.map((p) => p && jobsBgCities.exec(p)?.[1]).find(Boolean) ?? null;
  const hybrid = parts.some((p) => p && /хибридн|hybrid/i.test(p));
  const remote = parts.some((p) => p && /дистанционн|remote/i.test(p));
  if (city && /^(Дистанционно|Remote)$/i.test(city)) return formatLocation([], "remote");
  return formatLocation([city], remote ? "remote" : hybrid ? "hybrid" : null);
}

function jobsBg(root: Root, url: URL, frames: NonNullable<CapturedPage["frames"]>): Read {
  const title = text(root.querySelector(".job-view-title"));
  if (title) {
    const og = cleanText(decodeEntities(root.querySelector('meta[property="og:title"]')?.getAttribute("content") ?? ""));
    const company = /(?:обява за работа от|job ad from)\s+(.+)$/i.exec(og)?.[1]?.trim()
      ?? text(root.querySelector('a[href*="/company/"]'));
    const canonical = root.querySelector('link[rel="canonical"]')?.getAttribute("href")
      ?? root.querySelector('meta[property="og:url"]')?.getAttribute("content");
    const frame = frames.find((f) => f.id === "customJobIframe") ?? frames[0];
    const body = frame ? parse(frame.html).querySelector("body")?.innerHTML.trim() || null : null;
    const options = root.querySelectorAll(".options span").map(text);
    return {
      kind: "job",
      notLoaded: 0,
      listings: [listing({
        url: jobsBgId(canonical) ?? jobsBgId(url.pathname) ?? jobLinkFrom(url.href)?.href ?? null,
        title,
        company: company || null,
        location: jobsBgWorkplace([og, ...options]),
        descriptionHtml: body,
      })],
    };
  }
  const cards = root.querySelectorAll(".mdc-card");
  if (cards.length === 0) return none;
  const listings = cards.map((card) => {
    const a = card.querySelector('a[href*="/job/"]');
    const info = (text(card.querySelector(".card-info")) ?? "").split(";").map((s) => cleanText(s));
    const titleAttr = a?.getAttribute("title");
    return listing({
      url: jobsBgId(a?.getAttribute("href")),
      title: (titleAttr ? cleanText(decodeEntities(titleAttr)) : null) || cleanText((text(card.querySelector(".card-title")) ?? "").replace(/^work\s+/, "")) || null,
      company: text(card.querySelector(".secondary-text")) ?? text(card.querySelector('a[href*="/company/"]')),
      location: jobsBgWorkplace(info),
      salary: info.find((s) => /\d.*(BGN|лв|EUR|€)/i.test(s)) ?? null,
      postedAt: jobsBgDate(info[0]),
    });
  });
  return { kind: "search", notLoaded: 0, listings };
}

/** "10.10.26" → 2026-10-10. */
function jobsBgDate(s: string | undefined): string | null {
  const m = s ? /^(\d\d)\.(\d\d)\.(\d\d)$/.exec(s) : null;
  return m ? `20${m[3]}-${m[2]}-${m[1]}T00:00:00.000Z` : null;
}

// Any other site: like a pasted link, plus pages listing several jobs in JSON-LD.

function generic(html: string, root: Root, url: URL): Read {
  const ld = jobPostingsFromLd(root.querySelectorAll('script[type="application/ld+json"]').map((s) => s.rawText), url.href);
  if (ld.length > 1) return { kind: "search", notLoaded: 0, listings: ld.map((p) => listing({ ...p, url: jobLink(p.url, url) })) };
  const { posting } = readJobPage(html, url.href);
  if (!posting) return none;
  return { kind: "job", notLoaded: 0, listings: [listing({ ...posting, url: jobLinkFrom(url.href)?.href ?? posting.url })] };
}

/** The fields a listing that can be added doesn't have. */
export function missingFields(l: CapturedListing, kind: PageListings["kind"]): MissingField[] {
  const out: MissingField[] = [];
  if (!l.company) out.push("company");
  if (!l.location) out.push("location");
  if (kind === "job" && !l.descriptionHtml) out.push("description");
  return out;
}
