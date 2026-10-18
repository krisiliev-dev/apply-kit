// Workday CXS search (unofficial: what every myworkdayjobs.com careers page calls itself).
// POST {origin}/wday/cxs/{tenant}/{site}/jobs with {appliedFacets, limit, offset, searchText}.
// Tenants reject limit > 20, and `total` is only reliable on the first page, so a check pages
// 20 at a time and fails rather than return a partial list. A country is applied through the
// tenant's own location facet id, read from the first response (ids differ between tenants); a tenant
// without a country facet is filtered by every place in that country from its locations facet.
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
/** Tenants without a country facet (HPE, Mastercard) list each place instead: "Sofia, Sofia, Bulgaria". */
const locationFacets = new Set(["locations", "location"]);
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

  async fetchDescription(config, posting, {fetch}) {
    const site=parseCareersUrl(config.url), link=new URL(posting.url), root=new URL(config.url);
    if(link.origin!==site.origin || !link.pathname.startsWith(root.pathname+"/job/")) throw new Error("The Workday posting link does not match its source");
    const path=link.pathname.slice(root.pathname.length);
    const body=await readJson<{jobPostingInfo?:{jobDescription?:unknown}}>(await fetch(`${site.origin}/wday/cxs/${site.tenant}/${site.site}${path}`),"Workday job detail");
    return typeof body.jobPostingInfo?.jobDescription==="string"?body.jobPostingInfo.jobDescription.trim()||null:null;
  },

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
      facets = { [found.param]: found.ids };
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

/**
 * The tenant's facet ids for a country, null if the tenant has no jobs there, or a marker if it can't
 * filter by country. A country facet is used when there is one; otherwise every value of the
 * locations facet whose last part is that country ("Sofia, Bulgaria (Puzl Office)" is in Bulgaria).
 */
function findCountry(facets: WorkdayFacet[], country: string): { param: string; ids: string[] } | null | "no-country-facet" {
  const wanted = country.trim().toLowerCase();
  const all: WorkdayFacet[] = [];
  const walk = (list: WorkdayFacet[]) => {
    for (const f of list) {
      if (f.facetParameter) all.push(f);
      if (f.values) walk(f.values);
    }
  };
  walk(facets);
  const byCountry = all.filter((f) => countryFacets.has(f.facetParameter!.toLowerCase()));
  if (byCountry.length > 0) {
    for (const f of byCountry) {
      const v = f.values?.find((x) => x.descriptor?.trim().toLowerCase() === wanted && x.id);
      if (v) return { param: f.facetParameter!, ids: [v.id!] };
    }
    return null;
  }
  const byPlace = all.find((f) => locationFacets.has(f.facetParameter!.toLowerCase()));
  if (!byPlace) return "no-country-facet";
  const countryOf = (descriptor: string) => descriptor.split(",").at(-1)!.replace(/\(.*\)/, "").trim().toLowerCase();
  const ids = (byPlace.values ?? []).filter((x) => x.id && x.descriptor && countryOf(x.descriptor) === wanted).map((x) => x.id!);
  return ids.length > 0 ? { param: byPlace.facetParameter!, ids } : null;
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
