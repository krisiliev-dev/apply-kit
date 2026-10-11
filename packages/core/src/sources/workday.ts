// Workday CXS search (unofficial: what every myworkdayjobs.com careers page calls itself).
// POST {origin}/wday/cxs/{tenant}/{site}/jobs with {appliedFacets, limit, offset, searchText}.
// Tenants reject limit > 20, and `total` is only reliable on the first page, so a check pages
// 20 at a time and fails rather than return a partial list. A country is applied through the
// tenant's own location facet id, read from the first response (ids differ between tenants).
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { field, keyPart, readJson, splitShorthand } from "./shared.ts";

export interface WorkdayConfig {
  /** The careers page, e.g. https://dxctechnology.wd1.myworkdayjobs.com/en-US/DXCJobs */
  url: string;
  /** Country name as the tenant's location facet states it ("Bulgaria"), or null for every job. */
  country: string | null;
  /** Company name for the postings; defaults to the tenant ("dxctechnology"). */
  company: string | null;
}

interface WorkdayPosting {
  title?: string;
  externalPath?: string;
  locationsText?: string;
  bulletFields?: string[];
}

interface WorkdayFacet {
  facetParameter?: string;
  descriptor?: string;
  id?: string;
  values?: WorkdayFacet[];
}

interface WorkdayPage {
  total?: number;
  jobPostings?: WorkdayPosting[];
  facets?: WorkdayFacet[];
}

/** The most a tenant may request per page. */
const pageSize = 20;
/** Past this, paging gets impolite (25 requests per check): ask for a country instead. */
const maxJobs = 500;
const countryFacets = new Set(["locationcountry", "location_country", "country"]);
const host = /^([a-z0-9-]+)\.(wd\d+)\.myworkdayjobs\.com$/i;

export const workday: SourceAdapter<WorkdayConfig> = {
  kind: "workday",
  category: "ats",
  label: "Workday",

  parseConfig(raw) {
    const [text, countryText] = typeof raw === "string" ? splitShorthand(raw, 2) : [field(raw, "url") ?? "", field(raw, "country") ?? ""];
    const site = parseCareersUrl(text!);
    return { url: site.url, country: countryText || null, company: field(raw, "company") || null };
  },

  key: (c) => {
    const s = parseCareersUrl(c.url);
    return [`${s.tenant}.${s.pod}`, s.site, c.country].filter(Boolean).map((p) => keyPart(p!)).join("/");
  },
  defaultName: (c) => c.company ?? parseCareersUrl(c.url).tenant,

  async fetchPostings(config, { fetch }) {
    const site = parseCareersUrl(config.url);
    const endpoint = `${site.origin}/wday/cxs/${site.tenant}/${site.site}/jobs`;
    const search = async (appliedFacets: Record<string, string[]>, offset: number) => {
      const res = await fetch(endpoint, {
        method: "POST",
        headers: { "content-type": "application/json", accept: "application/json" },
        body: JSON.stringify({ appliedFacets, limit: pageSize, offset, searchText: "" }),
      });
      const page = await readJson<WorkdayPage>(res, "Workday");
      if (!Array.isArray(page.jobPostings)) throw new Error("Workday returned no job list");
      return page;
    };

    let first = await search({}, 0);
    let facets: Record<string, string[]> = {};
    if (config.country) {
      const found = findCountry(first.facets ?? [], config.country);
      if (found === "no-country-facet") throw new Error(`This Workday site has no country filter, so "${config.country}" can't be applied`);
      if (!found) return []; // The tenant lists nothing in that country right now.
      facets = { [found.param]: [found.id] };
      first = await search(facets, 0);
    }

    const total = Number(first.total ?? 0);
    if (total > maxJobs) {
      throw new Error(`Workday lists ${total} jobs here, more than the ${maxJobs} apply-kit pages through; add a country to this source`);
    }
    const postings = [...first.jobPostings!];
    while (postings.length < total) {
      const page = await search(facets, postings.length);
      postings.push(...page.jobPostings!);
      if (page.jobPostings!.length < pageSize && postings.length < total) break;
    }
    if (postings.length < total) {
      throw new Error(`Workday stopped after ${postings.length} of ${total} jobs, so this check is incomplete`);
    }

    const byId = new Map<string, FoundPosting>();
    for (const p of postings) {
      const posting = toPosting(p, config.url, config.company ?? site.tenant);
      if (posting) byId.set(posting.externalId, posting);
    }
    return [...byId.values()];
  },
};

function parseCareersUrl(text: string) {
  let u: URL;
  try {
    u = new URL(text);
  } catch {
    throw new Error(`A Workday source needs a careers link like "https://company.wd1.myworkdayjobs.com/Careers", got ${JSON.stringify(text)}`);
  }
  const m = host.exec(u.hostname);
  const segments = u.pathname.split("/").filter(Boolean);
  const siteName = segments.at(-1);
  if (u.protocol !== "https:" || !m || !siteName || !/^[\w-]+$/.test(siteName)) {
    throw new Error(`A Workday source needs a careers link on myworkdayjobs.com like "https://company.wd1.myworkdayjobs.com/Careers", got ${JSON.stringify(text)}`);
  }
  const origin = `https://${u.hostname.toLowerCase()}`;
  return { origin, tenant: m[1]!.toLowerCase(), pod: m[2]!.toLowerCase(), site: siteName, url: `${origin}/${segments.join("/")}` };
}

/** The tenant's facet id for a country, null if the tenant has no jobs there, or a marker if it has no country facet. */
function findCountry(facets: WorkdayFacet[], country: string): { param: string; id: string } | null | "no-country-facet" {
  let sawCountryFacet = false;
  const walk = (list: WorkdayFacet[]): { param: string; id: string } | null => {
    for (const f of list) {
      if (f.facetParameter && countryFacets.has(f.facetParameter.toLowerCase())) {
        sawCountryFacet = true;
        const v = f.values?.find((x) => x.descriptor?.trim().toLowerCase() === country.trim().toLowerCase() && x.id);
        if (v) return { param: f.facetParameter, id: v.id! };
      }
      const inner = f.values ? walk(f.values) : null;
      if (inner) return inner;
    }
    return null;
  };
  const found = walk(facets);
  return found ?? (sawCountryFacet ? null : "no-country-facet");
}

function toPosting(p: WorkdayPosting, careersUrl: string, company: string): FoundPosting | null {
  if (!p.externalPath || !p.title) return null;
  // The requisition id ends the path ("…_51562726"); the path itself is the fallback identity.
  const reqId = /_([A-Za-z0-9-]+)$/.exec(p.externalPath)?.[1] ?? p.externalPath;
  return {
    externalId: reqId,
    url: careersUrl + p.externalPath,
    title: p.title.trim(),
    company,
    location: p.locationsText?.trim() || null,
    salary: null,
    // The list only says "Posted 11 Days Ago"; the real date needs the detail endpoint.
    postedAt: null,
    descriptionHtml: null,
  };
}
