import type { JobPosting } from "../types";
import { stableId } from "../id";

// Free job-board API adapters: Reed (UK incl. Manchester), Remotive + Jobicy
// (remote), The Muse, Findwork. All legitimate public APIs. They share one
// JobPosting source kind "jobapi" with a `provider` tag (keeps the type/UI
// ripple to one kind while staying per-provider visible).
//
// Source ref format: "<keywords>" or "<keywords>|<location>"
//   e.g. "cyber security|Manchester", "security engineer|Sofia".

const UA =
  "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 " +
  "(KHTML, like Gecko) Chrome/124.0 Safari/537.36";

export function parseRef(ref: string): { keywords: string; location?: string } {
  const [keywords, location] = (ref || "").split("|");
  return {
    keywords: (keywords || "").trim(),
    location: location && location.trim() ? location.trim() : undefined,
  };
}

function strip(html: string): string {
  return (html || "").replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
}

function parseIso(s: unknown): number | undefined {
  if (typeof s !== "string" || !s) return undefined;
  const t = Date.parse(s);
  return Number.isFinite(t) ? t : undefined;
}

// Reed dates are "dd/mm/yyyy".
function parseUkDate(s: unknown): number | undefined {
  if (typeof s !== "string") return undefined;
  const m = s.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  if (!m) return parseIso(s);
  return new Date(`${m[3]}-${m[2]}-${m[1]}`).getTime() || undefined;
}

type Fields = {
  url: string;
  title: string;
  company: string;
  location?: string;
  salary?: string;
  description?: string;
  postedAt?: number;
};

function posting(provider: string, query: string, f: Fields, now: number): JobPosting | null {
  if (!f.url || !f.title) return null;
  return {
    id: stableId(["jobapi", provider, f.url]),
    source: { kind: "jobapi", provider, query },
    url: f.url,
    title: f.title,
    company: f.company || `via ${provider}`,
    location: f.location || undefined,
    salary: f.salary || undefined,
    description: f.description || undefined,
    postedAt: f.postedAt,
    fetchedAt: now,
  };
}

async function getJson<T>(url: string, init?: RequestInit): Promise<T | null> {
  try {
    const res = await fetch(url, {
      ...init,
      headers: { "user-agent": UA, accept: "application/json", ...(init?.headers ?? {}) },
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) return null;
    return (await res.json()) as T;
  } catch {
    return null;
  }
}

function keep<T>(arr: (T | null)[]): T[] {
  return arr.filter((x): x is T => x !== null);
}

// ————— Reed (UK; needs free REED_API_KEY) —————
export async function fetchReed(ref: string): Promise<JobPosting[]> {
  const key = process.env.REED_API_KEY;
  if (!key) throw new Error("REED_API_KEY not set in .env.local (free key at reed.co.uk/developers).");
  const { keywords, location } = parseRef(ref);
  const params = new URLSearchParams({ resultsToTake: "100" });
  if (keywords) params.set("keywords", keywords);
  if (location) params.set("locationName", location);
  const auth = "Basic " + Buffer.from(`${key}:`).toString("base64");
  const data = await getJson<{ results?: Array<Record<string, unknown>> }>(
    `https://www.reed.co.uk/api/1.0/search?${params}`,
    { headers: { authorization: auth } },
  );
  const now = Date.now();
  return keep(
    (data?.results ?? []).map((r) => {
      const min = r.minimumSalary as number | null;
      const max = r.maximumSalary as number | null;
      const salary =
        min != null || max != null
          ? `${(r.currency as string) || "GBP"} ${min ?? ""}${max != null ? `–${max}` : ""}`.replace(/\s+/g, " ").trim()
          : undefined;
      return posting("reed", ref, {
        url: (r.jobUrl as string) || (r.jobId ? `https://www.reed.co.uk/jobs/${r.jobId}` : ""),
        title: (r.jobTitle as string) || "",
        company: (r.employerName as string) || "via Reed",
        location: r.locationName as string,
        salary,
        description: r.jobDescription ? strip(r.jobDescription as string).slice(0, 4000) : undefined,
        postedAt: parseUkDate(r.date),
      }, now);
    }),
  );
}

// ————— Remotive (remote; no auth) —————
export async function fetchRemotive(ref: string): Promise<JobPosting[]> {
  const { keywords } = parseRef(ref);
  const params = new URLSearchParams({ limit: "50" });
  if (keywords) params.set("search", keywords);
  const data = await getJson<{ jobs?: Array<Record<string, unknown>> }>(
    `https://remotive.com/api/remote-jobs?${params}`,
  );
  const now = Date.now();
  return keep(
    (data?.jobs ?? []).map((j) =>
      posting("remotive", ref, {
        url: (j.url as string) || "",
        title: (j.title as string) || "",
        company: (j.company_name as string) || "via Remotive",
        location: (j.candidate_required_location as string) || "Remote",
        salary: (j.salary as string) || undefined,
        description: j.description ? strip(j.description as string).slice(0, 4000) : undefined,
        postedAt: parseIso(j.publication_date),
      }, now),
    ),
  );
}

// ————— Jobicy (remote; no auth) — filter recent feed by keyword —————
export async function fetchJobicy(ref: string): Promise<JobPosting[]> {
  const { keywords } = parseRef(ref);
  const data = await getJson<{ jobs?: Array<Record<string, unknown>> }>(
    "https://jobicy.com/api/v2/remote-jobs?count=50",
  );
  const now = Date.now();
  const kw = keywords.toLowerCase();
  return keep(
    (data?.jobs ?? [])
      .filter((j) => {
        if (!kw) return true;
        return `${j.jobTitle ?? ""} ${j.jobExcerpt ?? ""}`.toLowerCase().includes(kw);
      })
      .map((j) => {
        const min = j.salaryMin as number | null;
        const max = j.salaryMax as number | null;
        const salary =
          min || max
            ? `${(j.salaryCurrency as string) || ""} ${min ?? ""}${max ? `–${max}` : ""}`.replace(/\s+/g, " ").trim()
            : undefined;
        return posting("jobicy", ref, {
          url: (j.url as string) || "",
          title: (j.jobTitle as string) || "",
          company: (j.companyName as string) || "via Jobicy",
          location: (j.jobGeo as string) || "Remote",
          salary,
          description: j.jobExcerpt ? strip(j.jobExcerpt as string).slice(0, 4000) : undefined,
          postedAt: parseIso(j.pubDate),
        }, now);
      }),
  );
}

// ————— The Muse (no auth) — filter recent jobs by keyword/location —————
export async function fetchThemuse(ref: string): Promise<JobPosting[]> {
  const { keywords, location } = parseRef(ref);
  const kw = keywords.toLowerCase();
  const loc = (location || "").toLowerCase();
  const now = Date.now();
  const out: JobPosting[] = [];
  for (let page = 0; page < 3; page++) {
    const data = await getJson<{ results?: Array<Record<string, unknown>> }>(
      `https://www.themuse.com/api/public/jobs?page=${page}`,
    );
    const results = data?.results ?? [];
    if (results.length === 0) break;
    for (const r of results) {
      const name = (r.name as string) || "";
      const contents = (r.contents as string) || "";
      const locs = ((r.locations as Array<{ name?: string }>) || []).map((l) => l.name).filter(Boolean);
      if (kw && !`${name} ${strip(contents)}`.toLowerCase().includes(kw)) continue;
      if (loc && !locs.join(" ").toLowerCase().includes(loc) && !/flexible|remote/i.test(locs.join(" "))) continue;
      const p = posting("themuse", ref, {
        url: ((r.refs as { landing_page?: string }) || {}).landing_page || "",
        title: name,
        company: ((r.company as { name?: string }) || {}).name || "via The Muse",
        location: locs.join(", ") || undefined,
        description: contents ? strip(contents).slice(0, 4000) : undefined,
        postedAt: parseIso(r.publication_date),
      }, now);
      if (p) out.push(p);
    }
  }
  return out;
}

// ————— EURES (EU/EEA public portal; no auth) —————
// The official EURES portal's own search endpoint — public JSON, no key. Covers
// EU/EEA + Switzerland (not the UK, post-Brexit). ref is "keywords|location?"
// where location is a 2-letter country code (e.g. "security engineer|de").
//
// EURES postings are local-language, so free-text keyword search is noisy. When
// the keywords name a cyber/ICT-security role we instead filter by ESCO
// occupation URIs (language-independent taxonomy) for clean, EU-wide results.
const ICT_SECURITY_OCCUPATIONS = [
  "http://data.europa.eu/esco/occupation/a44a1dc5-be08-4840-8bd5-770c4ac1ca6d", // ICT security technician
  "http://data.europa.eu/esco/occupation/0ce5a9f4-e00a-4bbe-b255-3c63407167a4", // ICT security consultant
  "http://data.europa.eu/esco/occupation/7754d570-9519-48c2-b1c9-8e165f8bca0f", // ICT security manager
  "http://data.europa.eu/esco/occupation/276ba420-ef09-4a0e-b215-2c2e2f80ad28", // chief ICT security officer
  "http://data.europa.eu/esco/occupation/0c448a27-10ec-43ba-b880-d9938bade424", // digital forensics expert
  "http://data.europa.eu/esco/occupation/76ef0a87-6afe-4560-b5d0-9a086abe45c5", // ethical hacker
];
const CYBER_ALIASES = new Set([
  "cyber",
  "cybersecurity",
  "cyber security",
  "ict security",
  "information security",
  "infosec",
]);

type EuresJv = {
  id?: string;
  title?: string;
  description?: string;
  creationDate?: number;
  numberOfPosts?: number;
  locationMap?: Record<string, string[]>;
  employer?: { name?: string };
  translations?: Record<string, { title?: string; description?: string }>;
};

export async function fetchEures(ref: string): Promise<JobPosting[]> {
  const { keywords, location } = parseRef(ref);
  const byOccupation = CYBER_ALIASES.has(keywords.toLowerCase());
  const body = {
    resultsPerPage: 50,
    page: 1,
    sortSearch: "MOST_RECENT",
    keywords:
      byOccupation || !keywords
        ? []
        : [{ keyword: keywords, specificSearchCode: "EVERYWHERE" }],
    publicationPeriod: null,
    occupationUris: byOccupation ? ICT_SECURITY_OCCUPATIONS : [],
    skillUris: [],
    requiredExperienceCodes: [],
    positionScheduleCodes: [],
    sectorCodes: [],
    educationAndQualificationLevelCodes: [],
    positionOfferingCodes: [],
    locationCodes: location ? [location.toLowerCase()] : [],
    euresFlagCodes: [],
    otherBenefitsCodes: [],
    requiredLanguages: [],
    minNumberPost: null,
    sessionId: "cv-maker",
    requestLanguage: "en",
  };
  const data = await getJson<{ jvs?: EuresJv[] }>(
    "https://europa.eu/eures/api/jv-searchengine/public/jv-search/search",
    { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) },
  );
  const now = Date.now();
  return keep(
    (data?.jvs ?? []).map((jv) => {
      const en = jv.translations?.en;
      const title = en?.title || jv.title || "";
      const desc = en?.description || jv.description || "";
      const id = jv.id || "";
      return posting("eures", ref, {
        url: id ? `https://europa.eu/eures/portal/jv-se/jv-details/${encodeURIComponent(id)}?lang=en` : "",
        title,
        company: jv.employer?.name || "via EURES",
        location: jv.locationMap ? Object.keys(jv.locationMap).join(", ") : undefined,
        description: desc ? strip(desc).slice(0, 4000) : undefined,
        postedAt: typeof jv.creationDate === "number" ? jv.creationDate : undefined,
      }, now);
    }),
  );
}

// ————— Findwork (needs free FINDWORK_API_KEY) —————
export async function fetchFindwork(ref: string): Promise<JobPosting[]> {
  const key = process.env.FINDWORK_API_KEY;
  if (!key) throw new Error("FINDWORK_API_KEY not set in .env.local (free key at findwork.dev).");
  const { keywords, location } = parseRef(ref);
  const params = new URLSearchParams();
  if (keywords) params.set("search", keywords);
  if (location) params.set("location", location);
  const data = await getJson<{ results?: Array<Record<string, unknown>> }>(
    `https://findwork.dev/api/jobs/?${params}`,
    { headers: { authorization: `Token ${key}` } },
  );
  const now = Date.now();
  return keep(
    (data?.results ?? []).map((r) =>
      posting("findwork", ref, {
        url: (r.url as string) || "",
        title: (r.role as string) || "",
        company: (r.company_name as string) || "via Findwork",
        location: r.remote ? "Remote" : (r.location as string) || undefined,
        description: r.text ? strip(r.text as string).slice(0, 4000) : undefined,
        postedAt: parseIso(r.date_posted),
      }, now),
    ),
  );
}
