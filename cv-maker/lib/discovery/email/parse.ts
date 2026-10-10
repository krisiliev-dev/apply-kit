import * as cheerio from "cheerio";
import type { IngestPayload } from "../types";

// Parse a job-alert email's HTML into capture payloads. Sender-specific where
// we know the layout (LinkedIn, jobs.bg), generic anchor heuristic otherwise.
// Best-effort: alert-email HTML varies, so this is tuned from real samples.

function clean(s: string): string {
  return (s || "").replace(/\s+/g, " ").trim();
}

export function parseAlertEmail(opts: {
  from: string;
  subject?: string;
  html: string;
  date?: number;
}): IngestPayload[] {
  const fromLc = (opts.from || "").toLowerCase();
  const at = opts.date || Date.now();
  if (!opts.html) return [];
  if (/linkedin\.com/.test(fromLc)) return parseLinkedIn(opts.html, at);
  if (/jobs\.bg/.test(fromLc)) return parseJobsBg(opts.html, at);
  return parseGeneric(opts.html, fromLc, at);
}

function parseLinkedIn(html: string, at: number): IngestPayload[] {
  const $ = cheerio.load(html);
  const out: IngestPayload[] = [];
  const seen = new Set<string>();
  $('a[href*="/jobs/view/"]').each((_i, a) => {
    const href = $(a).attr("href") || "";
    const m = href.match(/\/jobs\/view\/(\d+)/);
    if (!m) return;
    const title = clean($(a).text());
    if (!title || title.length < 3) return;
    const url = `https://www.linkedin.com/jobs/view/${m[1]}`;
    if (seen.has(url)) return;
    seen.add(url);
    // Company/location usually sit as separate lines in the same card.
    const container = $(a).closest("td, tr, table, div");
    const lines = clean(container.text())
      .split(/\s{2,}|·|\|/)
      .map((s) => s.trim())
      .filter((l) => l && l !== title);
    out.push({
      source: "linkedin",
      url,
      title,
      company: lines[0] || "LinkedIn",
      location: lines[1],
      capturedAt: at,
    });
  });
  return out;
}

function parseJobsBg(html: string, at: number): IngestPayload[] {
  const $ = cheerio.load(html);
  const out: IngestPayload[] = [];
  const seen = new Set<string>();
  $('a[href*="/job/"]').each((_i, a) => {
    const href = $(a).attr("href") || "";
    if (!/\/job\/\d{4,}/.test(href)) return;
    const title = clean($(a).text());
    if (!title || title.length < 3) return;
    if (seen.has(href)) return;
    seen.add(href);
    out.push({
      source: "jobsbg",
      site: "jobs.bg",
      url: href,
      title,
      company: "jobs.bg",
      capturedAt: at,
    });
  });
  return out;
}

const JOB_TITLE_RE =
  /(engineer|developer|analyst|security|devops|sre|architect|manager|consultant|specialist|administrator|pentester|researcher|lead|scientist|designer)/i;

function parseGeneric(html: string, fromLc: string, at: number): IngestPayload[] {
  const $ = cheerio.load(html);
  const site = (fromLc.split("@")[1] || "email").replace(/[>\s].*$/, "");
  const out: IngestPayload[] = [];
  const seen = new Set<string>();
  $('a[href^="http"]').each((_i, a) => {
    const title = clean($(a).text());
    const href = $(a).attr("href") || "";
    if (!title || title.length < 5 || title.length > 140) return;
    if (!JOB_TITLE_RE.test(title)) return;
    if (seen.has(title)) return;
    seen.add(title);
    out.push({ source: "capture", site, url: href, title, company: site, capturedAt: at });
  });
  return out.slice(0, 40);
}
