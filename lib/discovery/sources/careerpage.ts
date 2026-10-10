import * as cheerio from "cheerio";
import type { JobPosting } from "../types";
import { stableId } from "../id";

// Crawler for arbitrary careers pages / job boards registered as
// careerpage/board sources. Strategy, most → least reliable:
//   1. schema.org JobPosting JSON-LD in the raw HTML (the gold standard — many
//      ATS + career sites emit it).
//   2. If nothing found and the page looks JS-rendered, render with puppeteer
//      and re-extract JSON-LD.
//   3. Anchor heuristic: links that look like individual job postings.
//
// Always best-effort — any failure yields []. Respect the page: a single GET,
// a realistic UA, no login, no pagination crawling.

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

const MAX_POSTINGS = 60;

export async function fetchPostings(pageUrl: string): Promise<JobPosting[]> {
  const now = Date.now();
  let html = await fetchHtml(pageUrl);

  let postings = html ? extractJsonLd(pageUrl, html, now) : [];

  // JS-rendered page with no server-side JSON-LD → render and retry.
  if (postings.length === 0) {
    const rendered = await renderHtml(pageUrl);
    if (rendered) {
      html = rendered;
      postings = extractJsonLd(pageUrl, rendered, now);
    }
  }

  // Last resort: scrape anchors that look like postings.
  if (postings.length === 0 && html) {
    postings = extractAnchors(pageUrl, html, now);
  }

  return dedupe(postings).slice(0, MAX_POSTINGS);
}

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const res = await fetch(url, {
      headers: { "user-agent": UA, accept: "text/html,*/*" },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return await res.text();
  } catch {
    return null;
  }
}

// puppeteer is heavy; import it lazily and never let a launch failure throw.
async function renderHtml(url: string): Promise<string | null> {
  try {
    const mod = await import("puppeteer");
    const puppeteer = mod.default ?? mod;
    const browser = await puppeteer.launch({ headless: true });
    try {
      const page = await browser.newPage();
      await page.setUserAgent(UA);
      await page.goto(url, { waitUntil: "networkidle2", timeout: 20_000 });
      return await page.content();
    } finally {
      await browser.close();
    }
  } catch {
    return null;
  }
}

// ————————————————————————————————————————————————
// 1. JSON-LD JobPosting extraction
// ————————————————————————————————————————————————

type JsonLdNode = Record<string, unknown> & { "@type"?: unknown };

function extractJsonLd(
  pageUrl: string,
  html: string,
  now: number,
): JobPosting[] {
  const $ = cheerio.load(html);
  const site = domainOf(pageUrl);
  const out: JobPosting[] = [];

  $('script[type="application/ld+json"]').each((_, el) => {
    const raw = $(el).contents().text();
    if (!raw.trim()) return;
    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      return;
    }
    for (const node of flattenLd(parsed)) {
      if (!isJobPosting(node)) continue;
      const posting = jobPostingFromLd(node, pageUrl, site, now);
      if (posting) out.push(posting);
    }
  });

  return out;
}

// JSON-LD can be a single object, an array, or wrapped in @graph.
function flattenLd(parsed: unknown): JsonLdNode[] {
  const nodes: JsonLdNode[] = [];
  const visit = (v: unknown) => {
    if (Array.isArray(v)) {
      v.forEach(visit);
    } else if (v && typeof v === "object") {
      const obj = v as JsonLdNode;
      nodes.push(obj);
      if (Array.isArray((obj as { "@graph"?: unknown })["@graph"])) {
        visit((obj as { "@graph"?: unknown })["@graph"]);
      }
    }
  };
  visit(parsed);
  return nodes;
}

function isJobPosting(node: JsonLdNode): boolean {
  const t = node["@type"];
  if (typeof t === "string") return t === "JobPosting";
  if (Array.isArray(t)) return t.includes("JobPosting");
  return false;
}

function jobPostingFromLd(
  node: JsonLdNode,
  pageUrl: string,
  site: string,
  now: number,
): JobPosting | null {
  const title = asString(node.title) ?? asString(node.name);
  if (!title) return null;

  const url = asString(node.url) ?? firstString(node.sameAs) ?? pageUrl;
  const company =
    orgName(node.hiringOrganization) ?? asString((node as { publisher?: unknown }).publisher) ?? site;
  const location = jobLocation(node.jobLocation) ?? remoteHint(node);
  const postedAt = parseDate(asString(node.datePosted));
  const description = asString(node.description);

  return {
    id: stableId(["careerpage", url, title]),
    source: { kind: "careerpage", url: pageUrl, site },
    url,
    title,
    company,
    location,
    description: description ? stripHtml(description).slice(0, 1200) : undefined,
    postedAt,
    fetchedAt: now,
  };
}

// ————————————————————————————————————————————————
// 3. Anchor heuristic (fallback)
// ————————————————————————————————————————————————

const JOB_HREF_RE = /(\/jobs?\/|\/careers?\/|\/positions?\/|\/vacanc|\/opening|\/job-|gh_jid=|lever\.co\/|ashbyhq\.com\/)/i;
const JOB_TEXT_RE =
  /\b(engineer|developer|analyst|security|devops|sre|architect|manager|consultant|specialist|administrator|pentester|researcher|lead)\b/i;

function extractAnchors(
  pageUrl: string,
  html: string,
  now: number,
): JobPosting[] {
  const $ = cheerio.load(html);
  const site = domainOf(pageUrl);
  const out: JobPosting[] = [];

  $("a[href]").each((_, el) => {
    const href = $(el).attr("href") ?? "";
    const text = $(el).text().replace(/\s+/g, " ").trim();
    if (!text || text.length < 4 || text.length > 140) return;
    const looksJob = JOB_HREF_RE.test(href) || JOB_TEXT_RE.test(text);
    if (!looksJob) return;
    const url = absUrl(pageUrl, href);
    if (!url) return;
    out.push({
      id: stableId(["careerpage", url, text]),
      source: { kind: "careerpage", url: pageUrl, site },
      url,
      title: text,
      company: site,
      location: undefined,
      fetchedAt: now,
    });
  });

  return out;
}

// Pure, network-free extractors — exported for testing.
export function extractJsonLdPostings(
  pageUrl: string,
  html: string,
  now: number = Date.now(),
): JobPosting[] {
  return extractJsonLd(pageUrl, html, now);
}

export function extractAnchorPostings(
  pageUrl: string,
  html: string,
  now: number = Date.now(),
): JobPosting[] {
  return extractAnchors(pageUrl, html, now);
}

// ————————————————————————————————————————————————
// Helpers
// ————————————————————————————————————————————————

function dedupe(postings: JobPosting[]): JobPosting[] {
  const seen = new Set<string>();
  return postings.filter((p) => {
    if (seen.has(p.id)) return false;
    seen.add(p.id);
    return true;
  });
}

function asString(v: unknown): string | undefined {
  return typeof v === "string" && v.trim() ? v.trim() : undefined;
}

function firstString(v: unknown): string | undefined {
  if (Array.isArray(v)) return asString(v[0]);
  return asString(v);
}

function orgName(v: unknown): string | undefined {
  if (typeof v === "string") return asString(v);
  if (v && typeof v === "object") return asString((v as { name?: unknown }).name);
  return undefined;
}

function jobLocation(v: unknown): string | undefined {
  const node = Array.isArray(v) ? v[0] : v;
  if (!node || typeof node !== "object") return undefined;
  const addr = (node as { address?: unknown }).address;
  const a = Array.isArray(addr) ? addr[0] : addr;
  if (!a || typeof a !== "object") return asString((node as { name?: unknown }).name);
  const o = a as Record<string, unknown>;
  return (
    [asString(o.addressLocality), asString(o.addressRegion), asString(o.addressCountry)]
      .filter(Boolean)
      .join(", ") || undefined
  );
}

function remoteHint(node: JsonLdNode): string | undefined {
  const t = node.jobLocationType;
  if (typeof t === "string" && /telecommute|remote/i.test(t)) return "Remote";
  return undefined;
}

function parseDate(s: string | undefined): number | undefined {
  if (!s) return undefined;
  const ts = Date.parse(s);
  return Number.isFinite(ts) ? ts : undefined;
}

function domainOf(urlStr: string): string {
  try {
    return new URL(urlStr).hostname.replace(/^www\./, "");
  } catch {
    return "careerpage";
  }
}

function absUrl(base: string, href: string): string | undefined {
  try {
    return new URL(href, base).toString();
  } catch {
    return undefined;
  }
}

function stripHtml(html: string): string {
  return html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}
