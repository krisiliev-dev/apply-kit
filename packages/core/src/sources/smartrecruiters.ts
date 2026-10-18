// SmartRecruiters public postings API: GET api.smartrecruiters.com/v1/companies/{company}/postings
// ?country={cc}&limit=100&offset={n}. No key is needed for public postings. Paged (limit max 100) until
// `totalFound` is reached. Big companies list thousands worldwide, so a Source is usually one country,
// and the country is part of the Source's identity. The list has no description (detail endpoint only).
import type { FoundPosting, SourceAdapter } from "./adapter.ts";
import { readJson } from "./shared.ts";
import { cleanText, countryName, formatLocation, place, toIsoUtc, type Workplace } from "./normalise.ts";

export interface SmartRecruitersConfig {
  company: string;
  /** ISO 3166 alpha-2, lower case; absent means every country. */
  country?: string;
}

interface SmartRecruitersPosting {
  id: string;
  name: string;
  company?: { identifier?: string | null; name?: string | null } | null;
  releasedDate?: string | null;
  location?: {
    city?: string | null; region?: string | null; country?: string | null;
    remote?: boolean | null; hybrid?: boolean | null; fullLocation?: string | null;
  } | null;
}

interface SmartRecruitersPage {
  totalFound?: number;
  content?: SmartRecruitersPosting[];
}

const companyId = /^[a-z0-9][a-z0-9._-]*$/i;
const pageSize = 100;
/** More pages than this means something is wrong (or the Source needs a country filter). */
const maxPages = 50;

export const smartrecruiters: SourceAdapter<SmartRecruitersConfig> = {
  kind: "smartrecruiters",
  category: "ats",
  label: "SmartRecruiters",

  parseConfig(raw) {
    const obj = typeof raw === "object" && raw !== null ? (raw as Record<string, unknown>) : {};
    let company = typeof raw === "string" ? raw.trim() : typeof obj.company === "string" ? obj.company.trim() : "";
    let country = typeof obj.country === "string" ? obj.country.trim() : "";
    const url = /^(?:https?:\/\/)?(?:jobs|careers)\.smartrecruiters\.com\/([^/?#]+)/i.exec(company);
    if (url) company = url[1]!;
    else if (typeof raw === "string" && company.includes(":")) [company, country] = company.split(":", 2) as [string, string];
    if (!companyId.test(company)) {
      throw new Error(`A SmartRecruiters source needs a SmartRecruiters company id like "Gameloft" (optionally "Gameloft:bg"), got ${JSON.stringify(raw)}`);
    }
    if (country && !countryName(country)) {
      throw new Error(`A SmartRecruiters country must be a two-letter country code like "bg", got ${JSON.stringify(country)}`);
    }
    return { company, ...(country ? { country: country.toLowerCase() } : {}) };
  },

  key: (c) => (c.country ? `${c.company}:${c.country}` : c.company),
  defaultName: (c) => (c.country ? `${c.company} (${countryName(c.country)})` : c.company),

  async fetchDescription(config,posting,{fetch}) {
    const body=await readJson<{jobAd?:{sections?:Record<string,{text?:unknown}>}}>(await fetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(config.company)}/postings/${encodeURIComponent(posting.externalId)}`),"SmartRecruiters job detail");
    return ["companyDescription","jobDescription","qualifications","additionalInformation"].map(key=>body.jobAd?.sections?.[key]?.text).filter((text):text is string=>typeof text==="string"&&!!text.trim()).join("\n")||null;
  },

  async fetchPostings(config, { fetch }) {
    const found: SmartRecruitersPosting[] = [];
    for (let page = 0; ; page++) {
      if (page === maxPages) throw new Error(`SmartRecruiters company "${config.company}" lists more than ${maxPages * pageSize} postings; add it per country`);
      const query = `${config.country ? `country=${config.country}&` : ""}limit=${pageSize}&offset=${found.length}`;
      const res = await fetch(`https://api.smartrecruiters.com/v1/companies/${encodeURIComponent(config.company)}/postings?${query}`);
      if (!res.ok) throw new Error(`SmartRecruiters answered ${res.status} for company "${config.company}"`);
      const body = (await res.json()) as SmartRecruitersPage;
      if (!Array.isArray(body.content)) throw new Error(`SmartRecruiters company "${config.company}" returned no postings list`);
      found.push(...body.content);
      if (body.content.length === 0 || found.length >= (body.totalFound ?? 0)) break;
    }
    return found.map((p) => toPosting(p, config.company));
  },
};

function toPosting(p: SmartRecruitersPosting, company: string): FoundPosting {
  const l = p.location ?? {};
  const workplace: Workplace = l.remote ? "remote" : l.hybrid ? "hybrid" : null;
  return {
    externalId: p.id,
    // The public job page; the API's own `ref` is an API URL.
    url: `https://jobs.smartrecruiters.com/${encodeURIComponent(company)}/${encodeURIComponent(p.id)}`,
    title: cleanText(p.name),
    company: cleanText(p.company?.name) || company,
    location: formatLocation([cleanText(l.fullLocation) || place(l.city, l.region, countryName(l.country))], workplace),
    salary: null,
    postedAt: toIsoUtc(p.releasedDate),
    descriptionHtml: null,
  };
}
