// Coverage checks: Kris searches a site by hand, tells apply-kit what he searched and what he saw,
// and the engine compares that with the Feed. Every listing is found (in the Feed, or kept out of
// the main list with a reason) or missing, with the most likely reason and a fix. Checks are kept
// as history; a missing listing that later arrives counts as fixed.
import type { SqlDatabase } from "./ports.ts";
import { locationsCompatible, matchKey, normaliseCompany } from "./matching.ts";
import { placeOf } from "./locations.ts";
import type { SearchSettings } from "./search-settings.ts";
import { senders, type SenderKey } from "./sources/email/senders.ts";
import { words } from "./words.ts";

/** One job Kris saw in his manual search, as he saw it. */
export interface CoverageListing {
  title: string;
  company: string;
  location?: string | null;
  /** The listing's link, if he has it: an exact link match is the surest. */
  url?: string | null;
}

export interface CoverageInput {
  /** The site he searched ("dev.bg", "LinkedIn"). */
  site: string;
  /** The search words he used. */
  query: string;
  location?: string | null;
  /** How many results he saw. Defaults to the number of listings. */
  resultCount?: number | null;
  /** The results he saw: listings, or pasted text with one per line ("Title · Company · Location" or a link). */
  listings?: CoverageListing[] | string;
  /**
   * The results page's link. dev.bg's (robots-permitted) is read once for its listings and count;
   * other sites are refused, since they forbid reading them (capture them with the extension instead).
   */
  resultsUrl?: string | null;
}

/** Hosts whose results pages a coverage check may read. */
export function isReadableResultsPage(url: string): boolean {
  try {
    return /^(www\.)?dev\.bg$/i.test(new URL(url).hostname);
  } catch {
    return false;
  }
}

export const unreadableResultsPage =
  "apply-kit reads results pages from dev.bg only. For other sites, paste the listings or type the number of results.";

/** What a listing matched, when apply-kit has it. */
export type FoundStatus = "in-feed" | "hidden";

/** Why a listing is missing, or why a found one isn't in the main Feed, in plain words. */
export interface CoverageReason {
  kind: CoverageReasonKind;
  text: string;
  /** The Source the reason is about, if any. */
  sourceId?: string;
  /** When it started (failing since, the last check), ISO 8601, for reasons about a Source. */
  at?: string | null;
}

export type CoverageReasonKind =
  // Missing:
  | "source-failing" | "source-paused" | "source-removed" | "not-listed" | "outside-locations" | "not-covered"
  // Found, but not in the main list:
  | "relocation" | "passed" | "closed";

/** One thing Kris can do about a reason, best first. `label` is the button text. */
export type CoverageFix =
  | { kind: "add-company"; company: string; label: string }
  | { kind: "check-source"; sourceId: string; label: string }
  | { kind: "resume-source"; sourceId: string; label: string }
  | { kind: "add-source"; source: { kind: string; config: unknown; name: string }; label: string }
  | { kind: "adjust-locations"; place: string; label: string }
  | { kind: "show-relocation"; label: string }
  | { kind: "undo"; decisionId: string; label: string }
  | { kind: "reopen"; jobId: string; label: string };

/** One listing's outcome. */
export interface CoverageResultListing {
  title: string;
  company: string;
  location: string | null;
  url: string | null;
  status: FoundStatus | "missing";
  /** The Job it matched, when found. */
  jobId: string | null;
  /** Null for a listing in the main Feed. */
  reason: CoverageReason | null;
  fixes: CoverageFix[];
  /** For a missing listing: the Job it has become since, once apply-kit has it (it's fixed); else null. */
  fixedBy: string | null;
}

/** One coverage check in the history. */
export interface CoverageSummary {
  id: string;
  at: string;
  site: string;
  query: string;
  location: string | null;
  /** Results Kris saw. */
  saw: number;
  /** Listings he gave. */
  listed: number;
  /** Of those, or of the results he saw when he gave none, how many apply-kit had (in the Feed or kept out of it). */
  appHad: number;
  missing: number;
  /** Missing listings apply-kit has now. */
  fixed: number;
}

export interface CoverageHistory {
  /** Newest first. */
  checks: CoverageSummary[];
  lastCheckAt: string | null;
  /** True when the last check is a week old or there is none: the Sources screen asks for one. */
  due: boolean;
}

/** How often a coverage check is asked for (weekly, the rhythm for the first month). */
export const coverageDueAfterMs = 7 * 24 * 60 * 60_000;

/** Stores a check and its listings, with each listing's outcome as it was then. */
export function storeCoverageCheck(db: SqlDatabase, r: CoverageResult): void {
  db.prepare(
    "INSERT INTO coverage_check (id, checked_at, site, query, location, result_count, app_had) VALUES (?, ?, ?, ?, ?, ?, ?)",
  ).run(r.id, r.at, r.site, r.query, r.location, r.totals.saw, r.totals.appHad);
  const insert = db.prepare(
    `INSERT INTO coverage_listing (check_id, position, title, company, location, url, status, job_id, reason)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  r.listings.forEach((l, i) => insert.run(
    r.id, i, l.title, l.company, l.location, l.url, l.status, l.jobId,
    l.reason ? JSON.stringify({ reason: l.reason, fixes: l.fixes }) : null,
  ));
}

/** The Job a missing listing has become since, if any. */
function fixedBy(db: SqlDatabase, l: CoverageListing, liveJob: (jobId: string) => string | null): string | null {
  const hit = matchListing(db, l);
  return hit ? liveJob(hit.job_id) : null;
}

/** A stored check as it was, with missing listings that have arrived since marked fixed. */
export function loadCoverageCheck(db: SqlDatabase, id: string, liveJob: (jobId: string) => string | null): CoverageResult | null {
  const c = db.prepare("SELECT * FROM coverage_check WHERE id = ?").get(id);
  if (!c) return null;
  const listings = db.prepare("SELECT * FROM coverage_listing WHERE check_id = ? ORDER BY position").all(id).map((r): CoverageResultListing => {
    const stored = r.reason == null ? null : JSON.parse(String(r.reason)) as { reason: CoverageReason; fixes: CoverageFix[] };
    const listing = { title: String(r.title), company: String(r.company), location: text(r.location), url: text(r.url) };
    const status = String(r.status) as CoverageResultListing["status"];
    return {
      ...listing, status, jobId: text(r.job_id), reason: stored?.reason ?? null, fixes: stored?.fixes ?? [],
      fixedBy: status === "missing" ? fixedBy(db, listing, liveJob) : null,
    };
  });
  return { id, at: String(c.checked_at), site: String(c.site), query: String(c.query), location: text(c.location), listings, totals: totalsOf(listings, Number(c.result_count), Number(c.app_had)) };
}

export function coverageHistory(db: SqlDatabase, now: Date, liveJob: (jobId: string) => string | null): CoverageHistory {
  const checks = db.prepare("SELECT id FROM coverage_check ORDER BY checked_at DESC, rowid DESC").all().map((row): CoverageSummary => {
    const c = loadCoverageCheck(db, String(row.id), liveJob)!;
    return {
      id: c.id, at: c.at, site: c.site, query: c.query, location: c.location,
      saw: c.totals.saw, listed: c.totals.listed, appHad: c.totals.appHad, missing: c.totals.missing,
      fixed: c.listings.filter((l) => l.fixedBy).length,
    };
  });
  const lastCheckAt = checks[0]?.at ?? null;
  return { checks, lastCheckAt, due: !lastCheckAt || now.getTime() - Date.parse(lastCheckAt) >= coverageDueAfterMs };
}

/** `appHad` is the listings found, unless he gave none: then it's what was counted in the Feed. */
export function totalsOf(listings: CoverageResultListing[], saw: number, appHad?: number): CoverageTotals {
  const inFeed = listings.filter((l) => l.status === "in-feed").length;
  const hidden = listings.filter((l) => l.status === "hidden").length;
  const missing = listings.filter((l) => l.status === "missing").length;
  return { saw, listed: listings.length, appHad: appHad ?? inFeed + hidden, found: inFeed + hidden, inFeed, hidden, missing };
}

/**
 * Whether a Job answers a manual search: every search word is in its title or company (whole words,
 * Latin or Cyrillic), and its place agrees with the searched location (a missing one agrees).
 */
export function answersSearch(job: { title: string; company: string; location: string | null }, query: string, location: string | null): boolean {
  const have = new Set(words(`${job.title} ${job.company}`));
  const want = words(query);
  return want.every((w) => have.has(w)) && (!location || locationsCompatible(job.location, location));
}

/**
 * Listings pasted as text, one per line: "Title · Company · Location" (also split by "|", " - ",
 * " – ", tabs, or "Title at Company"), or a link alone. Blank lines are skipped.
 */
export function parseListings(pasted: string): CoverageListing[] {
  return pasted.split(/\r?\n/).map((l) => l.trim()).filter(Boolean).map((line): CoverageListing => {
    if (/^https?:\/\/\S+$/i.test(line)) return { title: "", company: "", location: null, url: line };
    let parts = line.split(/\s*[·|\t]\s*|\s+[-–—]\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length === 1) parts = line.split(/\s+at\s+/i).map((p) => p.trim()).filter(Boolean);
    const [title = line, company = "", ...rest] = parts;
    return { title, company, location: rest.join(", ") || null, url: null };
  });
}

const text = (v: unknown): string | null => (v == null ? null : String(v));

export interface CoverageTotals {
  /** Results Kris saw. */
  saw: number;
  /** Listings he gave. */
  listed: number;
  /**
   * How many apply-kit had: the listings found or, when he gave no listings, the Jobs (in any view)
   * that answer his search (see answersSearch). An estimate then: sites also search posting text.
   */
  appHad: number;
  /** Listings found: in the Feed, or kept out of the main list (see each one's reason). */
  found: number;
  inFeed: number;
  hidden: number;
  missing: number;
}

export interface CoverageResult {
  id: string;
  at: string;
  site: string;
  query: string;
  location: string | null;
  listings: CoverageResultListing[];
  totals: CoverageTotals;
}

/** What coverage needs to know about a found Job. */
export interface FoundJob {
  id: string;
  state: "new" | "saved" | "passed" | "closed";
  place: { tier: string; label: string };
  passed?: { decisionId: string };
  closed?: { how: string };
}

/** Whether a found Job is in the main Feed and, if not, why and how to bring it in. */
export function whereFound(job: FoundJob): { status: FoundStatus; reason: CoverageReason | null; fixes: CoverageFix[] } {
  const inPassed = "It's in Passed & closed.";
  if (job.state === "passed") {
    return {
      status: "hidden",
      reason: { kind: "passed", text: `You passed it. ${inPassed}` },
      fixes: job.passed ? [{ kind: "undo", decisionId: job.passed.decisionId, label: "Undo the pass" }] : [],
    };
  }
  if (job.state === "closed") {
    return {
      status: "hidden",
      reason: { kind: "closed", text: `It was closed (${job.closed?.how ?? "no reason recorded"}). ${inPassed}` },
      fixes: [{ kind: "reopen", jobId: job.id, label: "Reopen it" }],
    };
  }
  if (job.place.tier === "relocation") {
    const where = job.place.label.replace(/^Relocation:\s*/, "");
    return {
      status: "hidden",
      reason: { kind: "relocation", text: `It's a relocation job (${where}): relocation jobs show only with the Relocation filter on.` },
      fixes: [{ kind: "show-relocation", label: "Turn on Relocation" }],
    };
  }
  return { status: "in-feed", reason: null, fixes: [] };
}

/** A company's own job system (ATS or public jobs API) on the watchlist, or removed from it. */
export interface CompanySource {
  id: string;
  name: string;
  /** "Greenhouse", "Lever". */
  label: string;
  kind: string;
  config: unknown;
  status: "not-checked" | "working" | "failing" | "quiet" | "paused" | "removed";
  failingSince: string | null;
  lastGoodCheckAt: string | null;
}

/**
 * The company's own Sources: ones named after it, or that listed any of its jobs. Watched ones
 * first (working, then failing, then paused), removed ones last.
 */
function sourcesOfCompany(db: SqlDatabase, company: string, sources: CompanySource[]): CompanySource[] {
  const name = normaliseCompany(company);
  if (!name) return [];
  const listedIt = new Set(
    db.prepare("SELECT DISTINCT source_id, company FROM posting").all()
      .filter((r) => normaliseCompany(String(r.company)) === name).map((r) => String(r.source_id)),
  );
  const rank: Record<CompanySource["status"], number> = { working: 0, quiet: 0, "not-checked": 1, failing: 2, paused: 3, removed: 4 };
  return sources
    .filter((s) => listedIt.has(s.id) || normaliseCompany(s.name) === name)
    .sort((a, b) => rank[a.status] - rank[b.status]);
}

export interface MissingContext {
  db: SqlDatabase;
  /** The site searched. */
  site: string;
  sources: CompanySource[];
  /** Senders whose alert emails are connected (Sources on the watchlist). */
  alertSenders: Set<string>;
  locations: SearchSettings["locations"];
}

/** Why a listing apply-kit doesn't have is missing, and what to do about it. */
export function whyMissing(
  l: { title: string; company: string; location: string | null },
  ctx: MissingContext,
): { reason: CoverageReason; fixes: CoverageFix[] } {
  const company = l.company || "This company";
  const own = sourcesOfCompany(ctx.db, l.company, ctx.sources)[0];
  if (own) {
    const named = `${own.name} (${own.label})`;
    const { id: sourceId } = own;
    switch (own.status) {
      case "failing":
        return {
          reason: { kind: "source-failing", sourceId, at: own.failingSince, text: `${company}'s jobs come from ${named}, which is failing. New jobs can't arrive until it works again.` },
          fixes: [{ kind: "check-source", sourceId, label: `Try ${own.name} now` }],
        };
      case "paused":
        return {
          reason: { kind: "source-paused", sourceId, at: null, text: `${company}'s jobs come from ${named}, which you paused.` },
          fixes: [{ kind: "resume-source", sourceId, label: `Resume ${own.name}` }],
        };
      case "removed":
        return {
          reason: { kind: "source-removed", sourceId, at: null, text: `You removed ${named}, which listed ${company}'s jobs.` },
          fixes: [{ kind: "add-source", source: { kind: own.kind, config: own.config, name: own.name }, label: `Add ${own.name} back` }],
        };
      default:
        return {
          reason: {
            kind: "not-listed", sourceId, at: own.lastGoodCheckAt,
            text: `${named} didn't list it at its last check. It may be newer than that check, or listed only on other sites.`,
          },
          fixes: [{ kind: "check-source", sourceId, label: `Check ${own.name} now` }],
        };
    }
  }
  const addCompany: CoverageFix[] = l.company ? [{ kind: "add-company", company: l.company, label: `Add ${l.company} to your watchlist` }] : [];
  if (l.location && placeOf({ location: l.location }, ctx.locations).tier === "other") {
    return {
      reason: { kind: "outside-locations", text: `It's in ${l.location}, outside your locations, so your searches don't look for it.` },
      fixes: [{ kind: "adjust-locations", place: l.location, label: "Change your locations" }, ...addCompany],
    };
  }
  const sender = alertSenderOf(ctx.site);
  const connectAlerts: CoverageFix[] = sender && !ctx.alertSenders.has(sender)
    ? [{ kind: "add-source", source: { kind: "email", config: sender, name: senders[sender].name }, label: `Connect ${senders[sender].name}` }]
    : [];
  if (!l.company) {
    return { reason: { kind: "not-covered", text: "None of your sources listed this job. Paste its title and company to see why." }, fixes: connectAlerts };
  }
  return {
    reason: { kind: "not-covered", text: `${company} isn't on your watchlist, and none of your sources listed this job.` },
    fixes: [...addCompany, ...connectAlerts],
  };
}

/** The alert sender of a site Kris searched by hand ("LinkedIn", "jobs.bg"), if it sends job alerts. */
function alertSenderOf(site: string): SenderKey | null {
  const w = site.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "");
  if (/^linkedin\b/.test(w)) return "linkedin";
  if (/^jobs\.bg\b/.test(w)) return "jobsbg";
  if (/^google\b/.test(w)) return "google";
  return null;
}

interface PostingCandidate { id: string; job_id: string; url: string; title: string; company: string; location: string | null; match_key: string | null }

/** The Job a listing is, or null. A link match wins; then company and title, with agreeing locations. */
export function matchListing(db: SqlDatabase, l: CoverageListing): PostingCandidate | null {
  const cols = "id, job_id, url, title, company, location, match_key";
  if (l.url) {
    const byUrl = db.prepare(`SELECT ${cols} FROM posting WHERE url = ? LIMIT 1`).get(l.url) as unknown as PostingCandidate | undefined;
    if (byUrl) return byUrl;
  }
  const key = matchKey({ company: l.company, title: l.title });
  if (key) {
    const rows = db.prepare(`SELECT ${cols} FROM posting WHERE match_key = ? ORDER BY first_seen_at, id`).all(key) as unknown as PostingCandidate[];
    const hit = rows.find((r) => locationsCompatible(r.location, l.location ?? null));
    if (hit) return hit;
  }
  return null;
}


