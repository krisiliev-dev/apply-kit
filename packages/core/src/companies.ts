// Adding a company: from a name or a careers link, find which job system (ATS) it uses.
// One probe per job system, each one request through the engine's polite fetch; a careers link is
// read once and searched for links to a job system. Nothing here touches the database.
import { isInYourLocations } from "./locations.ts";
import type { SourceAdapter } from "./sources/adapter.ts";
import { humanizeSlug } from "./sources/normalise.ts";
import { adapters, kindLabel } from "./sources/registry.ts";

/**
 * How one job system's probe went:
 * - waiting: not asked yet (the careers page is read first);
 * - checking: asked, no answer yet;
 * - found: it lists this company's jobs (`source` is what to add);
 * - not-found: it doesn't know this company;
 * - needs-link: it can't be guessed from a name (Workday): a careers link is needed;
 * - needs-search: the company's own careers search (Microsoft, Amazon): add it with search words;
 * - error: the probe failed, so this system is unknown either way.
 */
export type ProbeStatus = "waiting" | "checking" | "found" | "not-found" | "needs-link" | "needs-search" | "error";

export interface SystemProbe {
  /** The Source type ("greenhouse"). */
  kind: string;
  label: string;
  status: ProbeStatus;
  /** What was asked for, as the system names it ("payhawk"), or null when nothing could be tried. */
  tried: string | null;
  /** Where the guess came from: the company name, the link Kris gave, or a link on the careers page. */
  via: "name" | "link" | "careers-page" | null;
  /** Set when found: open jobs it lists, or null when there are too many to count in one request. */
  openJobs?: number | null;
  /** Set when found: how many are in Kris's locations, or null when that needs a full check. */
  inLocations?: number | null;
  /** Set when found: the Source to add. */
  source?: { kind: string; config: unknown; name: string };
  /** Set when that Source is already on the watchlist (paused ones included). */
  sourceId?: string;
  /** Why it wasn't found, or what went wrong, in plain words. */
  message?: string;
}

/** Ways to still catch a company's jobs when no job system lists them, best first. */
export type Fallback =
  | { kind: "email-alert"; recommended: true }
  | {
      kind: "aggregators";
      /** Jobs from this company the aggregators and job sites listed in the last 30 days. */
      jobs: number;
      /** The aggregator and job-site Sources that listed them (empty when none did). */
      sources: { id: string; name: string; jobs: number }[];
    }
  | { kind: "different-link" };

export interface CompanyDetection {
  input: string;
  company: string;
  /** The careers link Kris gave, normalised, or null for a name. */
  link: string | null;
  /** The careers page as read once, or null when no link was given (or it was a job system's own page). */
  careersPage: { url: string; outcome: "reading" | "read" | "not-found" | "error"; message?: string } | null;
  systems: SystemProbe[];
  /** True once every probe has answered. */
  finished: boolean;
  /** Empty while detecting and when something was found. */
  fallbacks: Fallback[];
}

export interface DetectOptions {
  /** Called with a fresh snapshot when detection starts and each time a probe answers. */
  onProgress?(detection: CompanyDetection): void;
}

export interface DetectDeps {
  /** The engine's polite fetch for a Source type (one request at a time per host, user agent, timeout). */
  fetchFor(kind: string): typeof fetch;
  setting(name: string): string | undefined;
  /** The watchlist Source with this id, if any (removed ones don't count). */
  existingSource(id: string): string | undefined;
  /** Jobs from this company seen on aggregator and job-site Sources in the last 30 days. */
  aggregatorJobs(company: string, slug: string): { id: string; name: string; jobs: number }[];
}

/** Job systems in the order the Sources screen lists them. */
const atsOrder = ["greenhouse", "lever", "ashby", "recruitee", "smartrecruiters", "personio", "teamtailor", "workday"];

/** Company search APIs that are a company's own job system. */
const ownSearch: Record<string, { names: string[]; host: RegExp; example: string }> = {
  microsoft: { names: ["microsoft"], host: /(^|\.)microsoft\.com$/, example: "security engineer|Dublin" },
  amazon: { names: ["amazon", "aws", "amazonwebservices"], host: /(^|\.)amazon\.jobs$|(^|\.)amazon\.[a-z.]+$/, example: "security engineer|BGR" },
};

/** Links to each job system as they appear in a URL or on a careers page. */
const linkPatterns: Record<string, RegExp> = {
  greenhouse: /(?:boards|job-boards)(?:\.eu)?\.greenhouse\.io\/(?:embed\/job_board(?:\/js)?\?for=)?([a-z0-9_-]+)|boards-api\.greenhouse\.io\/v1\/boards\/([a-z0-9_-]+)/gi,
  lever: /jobs\.(?:eu\.)?lever\.co\/[a-z0-9._-]+/gi,
  ashby: /jobs\.ashbyhq\.com\/[a-z0-9._%-]+/gi,
  recruitee: /\b[a-z0-9-]+\.recruitee\.com/gi,
  smartrecruiters: /(?:jobs|careers)\.smartrecruiters\.com\/[a-z0-9_-]+/gi,
  personio: /\b[a-z0-9-]+\.jobs\.personio\.(?:de|com)/gi,
  teamtailor: /\b[a-z0-9-]+\.teamtailor\.com/gi,
  workday: /\b[a-z0-9-]+\.wd\d+\.myworkdayjobs\.com(?:\/[a-z0-9_-]+)+/gi,
};

/** Subdomains of job-system hosts that aren't a company's board. */
const notABoard = new Set(["www", "app", "api", "jobs", "careers", "support", "help", "embed", "assets", "static", "cdn", "boards"]);

/** Legal-form words dropped when turning a name into a board guess ("Kestrel Payments Ltd" → "kestrelpayments"). */
const legalForms = /\b(ltd|llc|inc|gmbh|ag|ad|ead|ood|eood|plc|bv|sa|srl|corp|co|limited|group)\b\.?/gi;

/** The board name most job systems would use for a company name: lower case, letters and digits only. */
export function slugFor(name: string): string {
  return name.normalize("NFKD").replace(/[̀-ͯ]/g, "").toLowerCase().replace(legalForms, "").replace(/[^a-z0-9]/g, "");
}

/** A careers link (with or without https://), or null if the text reads as a company name. */
function asLink(text: string): URL | null {
  const t = text.trim();
  if (/\s/.test(t) || !/^(https?:\/\/)?[a-z0-9-]+(\.[a-z0-9-]+)+([/?#].*)?$/i.test(t)) return null;
  try {
    const u = new URL(/^https?:\/\//i.test(t) ? t : `https://${t}`);
    return u.protocol === "https:" || u.protocol === "http:" ? u : null;
  } catch {
    return null;
  }
}

/** The first link to `kind` in some text, as that job system's config, or null. */
function findConfig(kind: string, text: string): unknown {
  const adapter = adapters[kind]!;
  for (const m of text.matchAll(linkPatterns[kind]!)) {
    let raw: string = m[0];
    if (kind === "greenhouse") raw = (m[1] ?? m[2] ?? "").toLowerCase();
    else if (kind === "workday") raw = `https://${raw.replace(/\/(job|details)\/.*$/i, "")}`;
    else raw = `https://${raw}`;
    const sub = /^https:\/\/([^./]+)\./.exec(raw)?.[1]?.toLowerCase();
    if (["recruitee", "personio", "teamtailor"].includes(kind) && sub && notABoard.has(sub)) continue;
    if (kind === "greenhouse" && (!raw || raw === "embed")) continue;
    try {
      return adapter.parseConfig(raw);
    } catch {
      // Not a usable board link; try the next one.
    }
  }
  return null;
}

/** Each job system's own hosts. */
const systemHosts: Record<string, RegExp> = {
  greenhouse: /(^|\.)greenhouse\.io$/,
  lever: /(^|\.)lever\.co$/,
  ashby: /(^|\.)ashbyhq\.com$/,
  recruitee: /\.recruitee\.com$/,
  smartrecruiters: /(^|\.)smartrecruiters\.com$/,
  personio: /\.jobs\.personio\.(de|com)$/,
  teamtailor: /\.teamtailor\.com$/,
  workday: /\.myworkdayjobs\.com$/,
};

/** The job system whose own pages this link is on, if any. */
function systemOfLink(url: URL): string | null {
  const host = url.hostname.toLowerCase();
  return atsOrder.find((kind) => systemHosts[kind]!.test(host) && findConfig(kind, url.href) !== null) ?? null;
}

/** Thrown when a probe would need a second page: it already knows enough. */
class EnoughForAProbe extends Error {}

export async function detectCompany(input: string, deps: DetectDeps, options: DetectOptions = {}): Promise<CompanyDetection> {
  const text = input.trim();
  if (!text) throw new Error("Type a company name or paste a link to its careers page");
  const url = asLink(text);
  const linkKind = url ? systemOfLink(url) : null;
  const linkConfig = url && linkKind ? findConfig(linkKind, url.href) : null;

  const company = !url
    ? text
    : humanizeSlug(linkKind ? adapters[linkKind]!.defaultName(linkConfig) : domainLabel(url));
  const slug = slugFor(linkKind ? adapters[linkKind]!.defaultName(linkConfig) : url ? domainLabel(url) : text);

  const own = Object.keys(ownSearch).filter((k) =>
    ownSearch[k]!.names.includes(slug) || (url && ownSearch[k]!.host.test(url.hostname.toLowerCase())));

  const d: CompanyDetection = {
    input: text,
    company,
    link: url ? url.href : null,
    careersPage: url && !linkKind ? { url: url.href, outcome: "reading" } : null,
    systems: [...atsOrder, ...own].map((kind) => ({ kind, label: kindLabel(kind), status: "waiting", tried: null, via: null })),
    finished: false,
    fallbacks: [],
  };
  const report = () => options.onProgress?.(structuredClone(d));
  report();

  // A careers page on the company's own site: read it once and look for links to a job system.
  let page = "";
  if (d.careersPage) {
    try {
      const res = await deps.fetchFor("careers-page")(url!.href, { headers: { accept: "text/html" } });
      if (res.ok) {
        page = (await res.text()).slice(0, 2_000_000);
        d.careersPage = { url: url!.href, outcome: "read" };
      } else {
        d.careersPage = {
          url: url!.href,
          outcome: res.status === 404 || res.status === 410 ? "not-found" : "error",
          message: res.status === 404 || res.status === 410 ? "page not found" : `answered ${res.status}`,
        };
      }
    } catch (err) {
      d.careersPage = { url: url!.href, outcome: "error", message: err instanceof Error ? err.message : String(err) };
    }
  }

  const plans = d.systems.map((probe) => {
    const kind = probe.kind;
    if (kind in ownSearch) {
      Object.assign(probe, {
        status: "needs-search", message: `${probe.label} has its own careers search: add it with search words like "${ownSearch[kind]!.example}"`,
      });
      return null;
    }
    let config: unknown = null;
    if (kind === linkKind) {
      config = linkConfig;
      probe.via = "link";
    } else if (page && (config = findConfig(kind, page)) !== null) {
      probe.via = "careers-page";
    } else if (kind === "workday") {
      Object.assign(probe, { status: "needs-link", message: "Workday can't be found from a name: paste their myworkdayjobs.com careers link" });
      return null;
    } else if (slug) {
      try {
        config = adapters[kind]!.parseConfig(slug);
        probe.via = "name";
      } catch {
        config = null;
      }
    }
    if (config === null) {
      Object.assign(probe, { status: "needs-link", message: "Couldn't make a board name from this company name: paste their careers link" });
      return null;
    }
    probe.status = "checking";
    probe.tried = adapters[kind]!.key(config);
    return { probe, config };
  });
  report();

  await Promise.all(plans.map(async (plan) => {
    if (!plan) return;
    const { probe, config } = plan;
    Object.assign(probe, await probeOne(adapters[probe.kind]!, config, deps));
    if (probe.status === "found") {
      const adapter = adapters[probe.kind]!;
      const name = probe.via === "name" ? company : (company || adapter.defaultName(config));
      probe.source = { kind: probe.kind, config, name };
      const id = deps.existingSource(`${probe.kind}:${adapter.key(config)}`);
      if (id) probe.sourceId = id;
    }
    report();
  }));

  d.finished = true;
  if (!d.systems.some((s) => s.status === "found" || s.status === "needs-search")) {
    const sources = deps.aggregatorJobs(company, slug);
    d.fallbacks = [
      { kind: "email-alert", recommended: true },
      { kind: "aggregators", jobs: sources.reduce((n, s) => n + s.jobs, 0), sources },
      { kind: "different-link" },
    ];
  }
  report();
  return d;
}

/** One probe: a single request (a retry after a refused one is allowed, paging is not). */
async function probeOne(adapter: SourceAdapter<unknown>, config: unknown, deps: DetectDeps): Promise<Partial<SystemProbe>> {
  const base = deps.fetchFor(adapter.kind);
  let first: { status: number; total: number | null } | null = null;
  let answered = false;
  const once: typeof fetch = async (input, init) => {
    if (answered) throw new EnoughForAProbe("A probe reads one page");
    const res = await base(input, init);
    answered = res.ok;
    if (!first || res.ok) first = { status: res.status, total: res.ok ? await totalIn(res.clone()) : null };
    return res;
  };
  const notThere = (message: string) => ({ status: "not-found" as const, message });
  try {
    const postings = await adapter.fetchPostings(config, { fetch: once, setting: deps.setting });
    // SmartRecruiters answers an unknown company with an empty list, so empty means not there.
    if (postings.length === 0 && adapter.kind === "smartrecruiters") return notThere("No jobs under this name");
    return { status: "found", openJobs: postings.length, inLocations: postings.filter((p) => isInYourLocations(p.location)).length };
  } catch (err) {
    const f = first as { status: number; total: number | null } | null;
    if (f && f.status >= 200 && f.status < 300) {
      if (f.total !== null || err instanceof EnoughForAProbe) return { status: "found", openJobs: f.total, inLocations: null };
      return notThere("It answered, but not with a job list");
    }
    if (f && (f.status === 404 || f.status === 410)) return notThere("Not on this job system");
    return { status: "error", message: err instanceof Error ? err.message : String(err) };
  }
}

/** The total a paged job list states up front (SmartRecruiters' totalFound, Workday's total), if any. */
async function totalIn(res: Response): Promise<number | null> {
  try {
    const body = (await res.json()) as { totalFound?: unknown; total?: unknown };
    const n = body.totalFound ?? body.total;
    return typeof n === "number" && Number.isFinite(n) ? n : null;
  } catch {
    return null;
  }
}

/** The company part of a careers site's host: careers.kestrel.com → "kestrel". */
function domainLabel(url: URL): string {
  const parts = url.hostname.toLowerCase().replace(/^(www|careers|jobs|career|join)\./, "").split(".");
  if (parts.length >= 3 && /^(co|com|org|net)$/.test(parts.at(-2)!)) return parts.at(-3)!;
  return parts.length >= 2 ? parts.at(-2)! : parts[0]!;
}
