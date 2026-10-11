// Lever postings API: GET api.lever.co/v0/postings/{site}?mode=json (EU accounts: api.eu.lever.co).
// No auth; without `limit` the whole list comes back in one response. A site on the wrong host
// answers 404. robots.txt asks for Crawl-delay: 1, so requests to Lever are spaced 1 s apart.
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { cleanText, countryName, formatLocation, formatSalary, humanizeSlug, joinHtml, place, toIsoUtc, type Workplace } from "./normalise.ts";

export interface LeverConfig {
  site: string;
  /** Which Lever host the account lives on. */
  region: "global" | "eu";
  /** Lever doesn't say the company's name; this is used when given. */
  company?: string;
}

interface LeverPosting {
  id: string;
  text: string;
  hostedUrl: string;
  createdAt?: number | null;
  country?: string | null;
  workplaceType?: string | null;
  categories?: { location?: string | null; allLocations?: string[] | null } | null;
  opening?: string | null;
  description?: string | null;
  descriptionBody?: string | null;
  lists?: { text?: string | null; content?: string | null }[] | null;
  additional?: string | null;
  salaryRange?: { min?: number | null; max?: number | null; currency?: string | null; interval?: string | null } | null;
  salaryDescriptionPlain?: string | null;
}

const siteName = /^[a-z0-9][a-z0-9._-]*$/i;

const hostFor = { global: "lever.co", eu: "eu.lever.co" } as const;

export const lever: SourceAdapter<LeverConfig> = {
  kind: "lever",
  category: "ats",
  label: "Lever",
  crawlDelayMs: 1000,

  parseConfig(raw) {
    const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    const given = typeof raw === "string" ? raw.trim() : obj.site;
    let site = typeof given === "string" ? given.trim() : "";
    let region: LeverConfig["region"] = obj.region === "eu" ? "eu" : "global";
    // A jobs page or API URL (jobs.lever.co/{site}, jobs.eu.lever.co/{site}/..., api.eu.lever.co/v0/postings/{site}).
    const url = /^(?:https?:\/\/)?(?:jobs|api)\.(eu\.)?lever\.co\/(?:v0\/postings\/)?([^/?#]+)/i.exec(site);
    if (url) {
      region = url[1] ? "eu" : "global";
      site = url[2]!;
    }
    if (!siteName.test(site)) {
      throw new Error(`A Lever source needs a Lever site name like "siteground" or its jobs.lever.co link, got ${JSON.stringify(raw)}`);
    }
    const company = typeof obj.company === "string" && obj.company.trim() ? cleanText(obj.company) : undefined;
    return { site: site.toLowerCase(), region, ...(company ? { company } : {}) };
  },

  key: (c) => (c.region === "eu" ? `eu:${c.site}` : c.site),
  defaultName: (c) => c.company ?? humanizeSlug(c.site),

  async fetchPostings(config, { fetch }) {
    const res = await fetch(`https://api.${hostFor[config.region]}/v0/postings/${config.site}?mode=json`);
    if (res.status === 404) {
      const other = config.region === "eu" ? "global" : "eu";
      throw new Error(
        `Lever has no site "${config.site}" on its ${config.region === "eu" ? "EU" : "global"} host. ` +
        `If the company uses the other one, add it as https://jobs.${hostFor[other]}/${config.site}`,
      );
    }
    if (!res.ok) throw new Error(`Lever answered ${res.status} for site "${config.site}"`);
    const body = (await res.json()) as unknown;
    if (!Array.isArray(body)) throw new Error(`Lever site "${config.site}" returned no postings list`);
    const company = lever.defaultName(config);
    return (body as LeverPosting[]).map((p) => toPosting(p, company));
  },
};

const intervals: Record<string, string> = {
  "per-year-salary": "year", "per-month-salary": "month", "per-week-salary": "week",
  "per-day-wage": "day", "per-hour-wage": "hour",
};

function toPosting(p: LeverPosting, company: string): FoundPosting {
  const all = p.categories?.allLocations?.length ? p.categories.allLocations : [p.categories?.location];
  // Lever's `country` is one ISO code for the posting, so it only qualifies a single location.
  const places = all.length === 1 ? [place(all[0], countryName(p.country))] : all;
  const workplace: Workplace = p.workplaceType === "remote" ? "remote" : p.workplaceType === "hybrid" ? "hybrid" : null;
  const range = p.salaryRange;
  return {
    externalId: p.id,
    url: p.hostedUrl,
    title: cleanText(p.text),
    company,
    location: formatLocation(places, workplace),
    salary: (range && formatSalary({ ...range, period: intervals[range.interval ?? ""] ?? null }))
      || cleanText(p.salaryDescriptionPlain) || null,
    postedAt: toIsoUtc(p.createdAt),
    descriptionHtml: joinHtml([
      ...(p.opening || p.descriptionBody ? [p.opening, p.descriptionBody] : [p.description]),
      ...(p.lists ?? []).map((l) => (l.content ? `<h3>${escapeHtml(l.text ?? "")}</h3><ul>${l.content}</ul>` : null)),
      p.additional,
    ]),
  };
}

const escapeHtml = (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
